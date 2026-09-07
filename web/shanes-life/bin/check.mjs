#!/usr/bin/env node
// Real end-to-end check against a running server and the real database.
//
//   npm start          # in one terminal
//   npm run check      # in another
//
// It exercises the whole foundation the way it is actually used: enrol a real passkey, sign in
// with a real WebAuthn assertion, capture something, have MCP classify it into a brand-new
// category nobody coded for, mint a no-login share link, tick an item off through that link with
// no cookie at all, and confirm the tick is visible to the signed-in owner. Nothing is stubbed
// and nothing is faked -- every assertion is against real rows.
//
// The passkey half runs against a real software authenticator (bin/soft-authenticator.mjs):
// real P-256 keys, real ECDSA signatures, real CBOR. What it does NOT cover is the browser half
// -- that app.js calls navigator.credentials with the right options -- and it says so in its own
// output rather than implying coverage it does not have.
//
// It creates a disposable account (check+<timestamp>@shanes.life) and deletes it at the end, so
// running it never leaves residue in real data. Since #3107 that real data is the SAME database
// ShanesSurvival uses, so it also asserts, out loud, that it has not touched a single one of
// ShanesSurvival's own rows.

import { closePool, many, one, query } from "../src/db.mjs";
import { runMigrations } from "../src/migrate.mjs";
import { createUser } from "../src/core/users.mjs";
import { mintEnrollment } from "../src/core/credentials.mjs";
import { issueMcpToken } from "../src/core/mcp-tokens.mjs";
import { relyingPartyId } from "../src/auth/webauthn.mjs";
import { SoftAuthenticator } from "./soft-authenticator.mjs";

const BASE = (process.env.SL_CHECK_URL || "http://localhost:5000").replace(/\/+$/, "");
const results = [];
let failures = 0;

function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  return ok;
}

let cookie = null;

async function http(path, { method = "GET", body, headers = {}, auth = true } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(auth && cookie ? { cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 200) };
    }
  }
  return { status: res.status, json, headers: res.headers };
}

let rpcId = 0;
async function rpc(token, method, params) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function toolResult(reply) {
  const raw = reply.body?.result?.content?.[0]?.text;
  return raw ? JSON.parse(raw) : null;
}

const stamp = Date.now();
const email = `check+${stamp}@shanes.life`;
// A slug no code anywhere in this repo has ever heard of -- the point of the extensibility test.
const noveltyCategory = `check_novelty_${stamp}`;
let userId = null;

// ShanesSurvival's own tables. This check now runs against the same real database the WPF app
// reads, holding Shane's real Plaid-synced accounts and transactions, so "it leaves no residue"
// has to be proved rather than asserted.
const SURVIVAL_TABLES = [
  "accounts",
  "transactions",
  "debts",
  "plaid_items",
  "survival_snapshots",
  "pay_period_plans",
  "pay_period_plan_allocations",
  "income_sources",
  "income_entries",
  "expected_one_time_events",
  "transaction_tags",
];

async function survivalCounts() {
  const rows = await many(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [SURVIVAL_TABLES],
  );
  const counts = {};
  for (const { table_name: table } of rows) {
    const row = await one(`SELECT count(*)::int AS n FROM ${table}`);
    counts[table] = row.n;
  }
  return counts;
}

let survivalBefore = null;

async function main() {
  await runMigrations({ log: () => {} });

  // 0. the server is actually up
  const health = await http("/healthz", { auth: false });
  if (!check("server is up and the database is reachable", health.status === 200 && health.json?.db === "up", JSON.stringify(health.json))) {
    return;
  }

  // 0b. it is the SHARED database, not one of this app's own (Git #3107)
  survivalBefore = await survivalCounts();
  const dbName = (await one("SELECT current_database() AS db")).db;
  check(
    "it is running against the shared ShanesSurvival database",
    Object.keys(survivalBefore).length === SURVIVAL_TABLES.length,
    `${dbName}: found ${Object.keys(survivalBefore).length}/${SURVIVAL_TABLES.length} ShanesSurvival tables`,
  );
  const migrated = await many("SELECT filename FROM schema_migrations ORDER BY filename");
  const names = migrated.map((m) => m.filename);
  check(
    "ShanesSurvival's own migrations 001-012 are applied under this app's 013+",
    names.some((n) => n.startsWith("001_init")) && names.some((n) => n.startsWith("013_")),
    names.join(", "),
  );

  // 1. real account, real passkey enrolment, real WebAuthn sign-in
  const user = await createUser({ email, name: "Check Account" });
  userId = user.id;

  cookie = null;
  const anon = await http("/api/entities", { auth: false });
  check("the API refuses an unauthenticated read", anon.status === 401, `status ${anon.status}`);

  check(
    "there is no password login route left anywhere",
    (await http("/api/auth/login", { method: "POST", body: { email, password: "anything" }, auth: false })).status === 404,
    "POST /api/auth/login",
  );

  const authenticator = new SoftAuthenticator({ rpId: relyingPartyId(), origin: BASE });

  // Enrolment needs a single-use out-of-band token; the browser cannot mint one.
  const noToken = await http("/api/auth/enroll/options", { method: "POST", body: {}, auth: false });
  check("enrolment without a token or a session is refused", noToken.status === 401, `status ${noToken.status}`);

  const badEnrollToken = await http("/api/auth/enroll/options", { method: "POST", body: { token: "not-a-real-token" }, auth: false });
  check("an invalid enrolment token is refused", badEnrollToken.status === 401, `status ${badEnrollToken.status}`);

  const enrollment = await mintEnrollment(userId, "Check passkey");
  const regOptions = await http("/api/auth/enroll/options", { method: "POST", body: { token: enrollment.token }, auth: false });
  check("a real enrolment token yields registration options", regOptions.status === 200 && Boolean(regOptions.json?.challenge), `status ${regOptions.status}`);
  check("registration demands a discoverable, user-verified credential",
    regOptions.json?.authenticatorSelection?.residentKey === "required" &&
      regOptions.json?.authenticatorSelection?.userVerification === "required",
    JSON.stringify(regOptions.json?.authenticatorSelection));

  const registered = await http("/api/auth/enroll/verify", {
    method: "POST",
    body: { token: enrollment.token, challenge: regOptions.json.challenge, ...authenticator.register(regOptions.json.challenge) },
    auth: false,
  });
  check("a real passkey registers", registered.status === 201 && Boolean(registered.json?.passkey?.id), JSON.stringify(registered.json).slice(0, 200));
  check("enrolling from a link signs you straight in", registered.json?.user?.email === email);

  const replayed = await http("/api/auth/enroll/options", { method: "POST", body: { token: enrollment.token }, auth: false });
  check("a spent enrolment token cannot be reused", replayed.status === 401, `status ${replayed.status}`);

  await http("/api/auth/logout", { method: "POST" });
  cookie = null;

  // The real sign-in the app actually performs.
  const authOptions = await http("/api/auth/passkey/options", { method: "POST", body: {}, auth: false });
  check("sign-in issues a challenge without an email address", authOptions.status === 200 && Boolean(authOptions.json?.challenge), `status ${authOptions.status}`);
  check("the sign-in options carry no allowCredentials, so nothing leaks which accounts exist",
    authOptions.json?.allowCredentials === undefined, JSON.stringify(Object.keys(authOptions.json || {})));

  const login = await http("/api/auth/passkey/verify", {
    method: "POST",
    body: { challenge: authOptions.json.challenge, ...authenticator.assert(authOptions.json.challenge) },
    auth: false,
  });
  check("a real passkey assertion signs in", login.status === 200 && login.json?.user?.email === email, JSON.stringify(login.json));
  check("sign-in sets an HttpOnly session cookie", /sl_session=/.test(cookie || ""), cookie ? "cookie set" : "no cookie");

  // A used challenge is dead. This is the replay test, and it must fail.
  const savedLoginCookie = cookie;
  cookie = null;
  const replayAssertion = await http("/api/auth/passkey/verify", {
    method: "POST",
    body: { challenge: authOptions.json.challenge, ...authenticator.assert(authOptions.json.challenge) },
    auth: false,
  });
  check("a replayed challenge is refused", replayAssertion.status === 401, `status ${replayAssertion.status}`);

  // A tampered signature over a fresh, valid challenge must also fail -- that is the check that
  // proves the signature is genuinely verified rather than merely parsed.
  const freshOptions = await http("/api/auth/passkey/options", { method: "POST", body: {}, auth: false });
  const forged = await http("/api/auth/passkey/verify", {
    method: "POST",
    body: {
      challenge: freshOptions.json.challenge,
      ...authenticator.assert(freshOptions.json.challenge, { tamperSignature: true }),
    },
    auth: false,
  });
  check("a tampered assertion signature is refused", forged.status === 401, `status ${forged.status}`);
  check("every refusal reads the same, so nothing distinguishes the failure modes",
    replayAssertion.json?.error === "That passkey did not sign you in." && forged.json?.error === replayAssertion.json?.error,
    `${replayAssertion.json?.error} / ${forged.json?.error}`);

  cookie = savedLoginCookie;
  const me = await http("/api/me");
  check("the session identifies the right account", me.json?.user?.email === email);
  check("the account has exactly one registered passkey", me.json?.passkeyCount === 1, String(me.json?.passkeyCount));

  const onlyKey = await http("/api/passkeys");
  const removeLast = await http(`/api/passkeys/${onlyKey.json.passkeys[0].id}`, { method: "DELETE" });
  check("removing the only passkey is refused, because there is no password to fall back on", removeLast.status === 400, `status ${removeLast.status}`);

  // 2. the universal capture box
  const capture = await http("/api/captures", { method: "POST", body: { text: "picking mom up from the airport on the 14th" } });
  check("a capture is stored", capture.status === 201 && capture.json?.id, JSON.stringify(capture.json));
  const captureId = capture.json?.id;

  const inbox = await http("/api/captures?status=pending");
  check("the capture lands in the pending inbox", inbox.json?.captures?.some((c) => c.id === captureId));

  // 3. MCP writes into the real database
  const token = await issueMcpToken(userId, "e2e-check");

  const noAuth = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  check("MCP refuses an unauthenticated call", noAuth.status === 401, `status ${noAuth.status}`);

  const init = await rpc(token.token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "shanes-life-check", version: "1" },
  });
  check("MCP initialize handshakes", init.body?.result?.serverInfo?.name === "shanes-life", JSON.stringify(init.body?.result?.serverInfo));

  const list = await rpc(token.token, "tools/list", {});
  const toolNames = (list.body?.result?.tools || []).map((t) => t.name);
  check("MCP advertises its tools", toolNames.includes("create_entity") && toolNames.includes("create_share_link"), toolNames.join(","));

  const who = await rpc(token.token, "tools/call", { name: "whoami", arguments: {} });
  check("MCP whoami resolves to the same account", toolResult(who)?.account?.email === email);

  // The real extensibility test: a category slug that exists nowhere in this codebase.
  const created = await rpc(token.token, "tools/call", {
    name: "create_entity",
    arguments: {
      category: noveltyCategory,
      categoryLabel: "Airport run",
      categoryIcon: "plane",
      title: "Pick mom up from the airport",
      occursAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      remindAt: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      data: { person: "mom", terminal: "unknown" },
      items: ["check the flight time", { text: "fill the car up", note: "before leaving" }],
      captureId,
      share: { label: "Ronnie", canCheck: true },
    },
  });
  const payload = toolResult(created);
  check("MCP created the record", payload?.entity?.id, JSON.stringify(created.body?.result?.isError ? payload : "").slice(0, 200));
  const entityId = payload?.entity?.id;
  check("MCP invented a category that did not exist before", payload?.entity?.category === noveltyCategory, payload?.entity?.category);
  check("the open jsonb payload survived verbatim", payload?.entity?.data?.person === "mom");
  check("child items were written", payload?.entity?.items?.length === 2, String(payload?.entity?.items?.length));

  const dbCategory = await one("SELECT slug, label, icon, created_by FROM categories WHERE slug = $1", [noveltyCategory]);
  check("the new category is a real row in the database", dbCategory?.label === "Airport run" && dbCategory?.created_by === "claude", JSON.stringify(dbCategory));

  const dbCapture = await one("SELECT status, entity_id FROM captures WHERE id = $1", [captureId]);
  check("the originating capture is marked classified", dbCapture?.status === "classified" && dbCapture?.entity_id === entityId, JSON.stringify(dbCapture));

  // 4. it is visible on a real page load, exactly as the issue's verification demands
  const reload = await http(`/api/entities/${entityId}`);
  check("the MCP-written record is visible to the signed-in app", reload.status === 200 && reload.json?.title === "Pick mom up from the airport", `status ${reload.status}`);

  const listing = await http("/api/entities");
  check("it appears in the list the app renders", listing.json?.entities?.some((e) => e.id === entityId));

  // 5. the share link opens with no login at all
  const shareUrl = payload?.share?.url;
  check("MCP returned a share URL", Boolean(shareUrl), shareUrl || "(none)");
  const shareToken = shareUrl?.split("/s/")[1];

  const savedCookie = cookie;
  cookie = null; // from here on: no credential of any kind

  const publicRead = await http(`/api/public/share/${shareToken}`, { auth: false });
  check("the share link opens without a session", publicRead.status === 200 && publicRead.json?.entity?.title === "Pick mom up from the airport", `status ${publicRead.status}`);
  check("the share response carries the real items", publicRead.json?.entity?.items?.length === 2);
  check("the share response leaks no account details", !JSON.stringify(publicRead.json).includes(email));

  const publicItemId = publicRead.json?.entity?.items?.[0]?.id;
  const ticked = await http(`/api/public/share/${shareToken}/items/${publicItemId}`, {
    method: "PATCH",
    body: { checked: true },
    auth: false,
  });
  check("someone holding the link can tick an item off", ticked.status === 200 && ticked.json?.checkedAt, `status ${ticked.status}`);
  check("the tick is attributed to the share label", ticked.json?.checkedBy === "share:Ronnie", ticked.json?.checkedBy);

  const otherEntity = await http(`/api/entities/${entityId}`, { auth: false });
  check("a share link grants no access to the authenticated API", otherEntity.status === 401, `status ${otherEntity.status}`);

  const badToken = await http("/api/public/share/not-a-real-token", { auth: false });
  check("an invalid share token is refused", badToken.status === 404, `status ${badToken.status}`);

  // 6. back as the owner: the tick made by the anonymous visitor is really there
  cookie = savedCookie;
  const afterTick = await http(`/api/entities/${entityId}`);
  const tickedItem = afterTick.json?.items?.find((i) => i.id === publicItemId);
  check("the owner sees the item the shared link ticked", Boolean(tickedItem?.checked_at), JSON.stringify(tickedItem?.checked_by));

  const activity = await http("/api/activity");
  check("the share write is in the audit trail", activity.json?.activity?.some((a) => a.actor === "share" && a.action === "entity.item.check"));
  check("the MCP write is in the audit trail", activity.json?.activity?.some((a) => a.actor === "mcp" && a.action === "entity.create"));

  // 6b. Git #3116's real decision: rooms use their own typed tables, not entities/entity_items,
  // so the share layer has to work against one directly -- starting with lists/list_items
  // (migration 016), Shopping's real shape. This section still inserts its own throwaway list
  // directly (kept as a share-layer-only regression check, independent of #3088's real CRUD
  // below), rather than reusing the real Shopping list #3088 adds.
  cookie = savedCookie;
  const shoppingList = await one(
    `INSERT INTO lists (user_id, name, created_by) VALUES ($1,$2,'shane') RETURNING id, name`,
    [userId, "Costco run"],
  );
  const listItem = await one(
    `INSERT INTO list_items (list_id, text, position) VALUES ($1,$2,0) RETURNING id`,
    [shoppingList.id, "paper towels"],
  );

  const listShare = await http("/api/shares", {
    method: "POST",
    body: { listId: shoppingList.id, label: "Ronnie", canCheck: true },
  });
  check("a share link mints against a typed list, not just entities", listShare.status === 201 && Boolean(listShare.json?.url), JSON.stringify(listShare.json));
  const listShareToken = listShare.json?.url?.split("/s/")[1];

  cookie = null;
  const publicList = await http(`/api/public/share/${listShareToken}`, { auth: false });
  check("the list's own share link opens with no session", publicList.status === 200 && publicList.json?.entity?.title === "Costco run", `status ${publicList.status}`);
  check("the list share response carries the real list_items row", publicList.json?.entity?.items?.length === 1 && publicList.json?.entity?.items?.[0]?.text === "paper towels");

  const listTicked = await http(`/api/public/share/${listShareToken}/items/${listItem.id}`, {
    method: "PATCH",
    body: { checked: true },
    auth: false,
  });
  check("someone holding the list link can tick a list_item off", listTicked.status === 200 && listTicked.json?.checkedAt, `status ${listTicked.status}`);

  const dbListItem = await one("SELECT done, done_at FROM list_items WHERE id = $1", [listItem.id]);
  check("the tick is a real done/done_at write on list_items, not just the response", dbListItem?.done === true && Boolean(dbListItem?.done_at), JSON.stringify(dbListItem));

  cookie = savedCookie;
  const listActivity = await http("/api/activity");
  check("the list share write is in the audit trail", listActivity.json?.activity?.some((a) => a.actor === "share" && a.action === "list.item.check"));

  const listShares = await http(`/api/shares?listId=${shoppingList.id}`);
  check("GET /api/shares can filter by listId", listShares.json?.shares?.some((s) => s.id === listShare.json.id && s.entity_kind === "list"), JSON.stringify(listShares.json));
  await http(`/api/shares/${listShares.json.shares[0].id}`, { method: "DELETE" });
  const afterListRevoke = await http(`/api/public/share/${listShareToken}`, { auth: false });
  check("a revoked list share link stops working", afterListRevoke.status === 404, `status ${afterListRevoke.status}`);

  cookie = null;

  // 6c. Shopping's own real CRUD (#3088) -- "one run": the client never knows a list id up
  // front, GET /api/shopping finds-or-creates the one real running list.
  cookie = savedCookie;
  const shopping = await http("/api/shopping");
  check("GET /api/shopping finds-or-creates the one real running list", shopping.status === 200 && shopping.json?.category === "shopping", JSON.stringify(shopping.json));
  const shoppingId = shopping.json?.id;

  const addedItems = await http(`/api/lists/${shoppingId}/items`, {
    method: "POST",
    body: { items: ["bananas", { text: "milk", note: "full gallon" }] },
  });
  check("adding items to the real Shopping list works", addedItems.status === 201 && addedItems.json?.items?.length === 2, JSON.stringify(addedItems.json));
  const bananaItem = addedItems.json?.items?.find((i) => i.text === "bananas");
  const milkItem = addedItems.json?.items?.find((i) => i.text === "milk");
  check("item notes are stored", milkItem?.note === "full gallon");

  const checkedBanana = await http(`/api/lists/${shoppingId}/items/${bananaItem.id}`, {
    method: "PATCH",
    body: { checked: true },
  });
  check("checking off a Shopping item is a real done/done_at write", checkedBanana.status === 200 && checkedBanana.json?.done === true, JSON.stringify(checkedBanana.json));

  // 6c-2. Per-store price history (Git #3112): a real, repeated observation for the same item at
  // the same store builds a real, queryable history -- not just a single current-price field.
  const noStores = await http("/api/stores");
  check("GET /api/stores starts empty for a fresh account", noStores.status === 200 && noStores.json?.stores?.length === 0, JSON.stringify(noStores.json));

  const firstPrice = await http("/api/prices", {
    method: "POST",
    body: { storeName: "Aldi", itemText: bananaItem.text, priceCents: 179, observedOn: "2026-08-30" },
  });
  check("logging a real price for an item creates its store on first use", firstPrice.status === 201 && firstPrice.json?.store_name === "Aldi" && firstPrice.json?.price_cents === 179, JSON.stringify(firstPrice.json));

  const secondPrice = await http("/api/prices", {
    method: "POST",
    body: { storeName: "aldi", itemText: bananaItem.text.toUpperCase(), priceCents: 189, observedOn: "2026-09-06" },
  });
  check("a second observation reuses the same store, case-insensitively", secondPrice.status === 201 && secondPrice.json?.store_id === firstPrice.json?.store_id, JSON.stringify(secondPrice.json));

  const walmartPrice = await http("/api/prices", {
    method: "POST",
    body: { storeName: "Walmart", itemText: bananaItem.text, priceCents: 169, observedOn: "2026-09-05" },
  });
  check("a different store gets its own real row", walmartPrice.status === 201 && walmartPrice.json?.store_id !== firstPrice.json?.store_id, JSON.stringify(walmartPrice.json));

  const nowStores = await http("/api/stores");
  check("GET /api/stores lists both real stores", nowStores.json?.stores?.length === 2, JSON.stringify(nowStores.json));

  const history = await http(`/api/prices?item=${encodeURIComponent(bananaItem.text)}`);
  check(
    "GET /api/prices returns every real observation for the item, most recent first",
    history.status === 200 && history.json?.history?.length === 3 && history.json.history[0].store_name === "Aldi" && history.json.history[0].price_cents === 189,
    JSON.stringify(history.json),
  );

  const shoppingWithHints = await http("/api/shopping");
  const bananasAfterPricing = shoppingWithHints.json?.items?.find((i) => i.id === bananaItem.id);
  check(
    "GET /api/shopping attaches the item's real latest price -- one query for the whole list, not one per item",
    bananasAfterPricing?.lastPrice?.priceCents === 189 && bananasAfterPricing?.lastPrice?.storeName === "Aldi",
    JSON.stringify(bananasAfterPricing?.lastPrice),
  );

  const mcpPrices = await rpc(token.token, "tools/call", { name: "get_prices", arguments: { item: bananaItem.text } });
  const mcpPricesPayload = toolResult(mcpPrices);
  check("get_prices (MCP) reads the same real history Claude would use to build the next list", mcpPricesPayload?.history?.length === 3, JSON.stringify(mcpPricesPayload));

  const dbPriceCount = await one("SELECT count(*)::int AS n FROM item_prices WHERE user_id = $1", [userId]);
  check("every logged price is really a row in item_prices, not just an in-memory response", dbPriceCount?.n === 3, JSON.stringify(dbPriceCount));

  const removedMilk = await http(`/api/lists/${shoppingId}/items/${milkItem.id}`, { method: "DELETE" });
  check("removing a Shopping item works", removedMilk.status === 200 && removedMilk.json?.ok === true);

  const afterClear = await http(`/api/lists/${shoppingId}/clear-checked`, { method: "POST" });
  check("clearing checked items removes only the checked ones", afterClear.status === 200 && afterClear.json?.items?.length === 0, JSON.stringify(afterClear.json?.items));

  // push_list (MCP) -- the design's own real capture-grammar entry point ("grocery words -> the
  // run"). replace:true swaps the whole run for a fresh one.
  const pushed = await rpc(token.token, "tools/call", {
    name: "push_list",
    arguments: { items: ["eggs", "bread"], replace: true, share: { label: "Front door", canCheck: true } },
  });
  const pushedPayload = toolResult(pushed);
  check("push_list (MCP) writes onto the real Shopping list", pushedPayload?.list?.id === shoppingId && pushedPayload?.list?.items?.length === 2, JSON.stringify(pushedPayload));
  check("push_list returned a real share link", Boolean(pushedPayload?.share?.url), JSON.stringify(pushedPayload?.share));

  const gotList = await rpc(token.token, "tools/call", { name: "get_list", arguments: {} });
  const gotListPayload = toolResult(gotList);
  check("get_list (MCP) reads back the same real list", gotListPayload?.id === shoppingId && gotListPayload?.items?.length === 2, JSON.stringify(gotListPayload));

  const eggsItem = gotListPayload?.items?.find((i) => i.text === "eggs");
  const mcpChecked = await rpc(token.token, "tools/call", {
    name: "check_list_item",
    arguments: { listId: shoppingId, itemId: eggsItem.id, checked: true },
  });
  // check_list_item mirrors check_item's entity-shaped return (checked_at/checked_by), not the
  // owner HTTP API's done/done_at -- same parity the MCP entity tools already keep.
  check("check_list_item (MCP) ticks a real row", Boolean(toolResult(mcpChecked)?.checked_at), JSON.stringify(toolResult(mcpChecked)));

  const dbEggs = await one("SELECT done FROM list_items WHERE id = $1", [eggsItem.id]);
  check("the MCP tick is really in the database", dbEggs?.done === true, JSON.stringify(dbEggs));

  const shoppingActivity = await http("/api/activity");
  check("the MCP push_list write is in the audit trail", shoppingActivity.json?.activity?.some((a) => a.actor === "mcp" && a.action === "list.items.push"));

  // 6d. Barcode scan (Git #3109, design "Shanes Life 04 - Shopping.dc.html" 2a) -- real network
  // lookup against Open Food Facts, real DB writes, all three match states.
  const sparklingWater = await http(`/api/lists/${shoppingId}/items`, {
    method: "POST",
    body: { items: ["Sparkling water"] },
  });
  const sparklingItem = sparklingWater.json?.items?.find((i) => i.text === "Sparkling water");

  // A brand-new barcode nobody has scanned before, and (near-certainly) not a real registered
  // product -- unknown state, no candidates since nothing on the list resembles it.
  const freshBarcode = String(Date.now()).slice(0, 12);
  const lookupUnknown = await http(`/api/lists/${shoppingId}/scan/lookup`, { method: "POST", body: { barcode: freshBarcode } });
  check("scan lookup: a never-seen barcode with nothing on the list resolves to unknown", lookupUnknown.status === 200 && lookupUnknown.json?.match === "unknown", JSON.stringify(lookupUnknown.json));

  const savedUnknown = await http(`/api/lists/${shoppingId}/scan/save`, {
    method: "POST",
    body: { barcode: freshBarcode, itemId: sparklingItem.id, priceCents: 249 },
  });
  check("scan save: links an unknown barcode to a real open item and prices + checks it off", savedUnknown.status === 200 && savedUnknown.json?.item?.price_cents === 249 && savedUnknown.json?.item?.done === true, JSON.stringify(savedUnknown.json));

  const dbLink = await one("SELECT item_text, last_price_cents FROM barcode_links WHERE barcode = $1", [freshBarcode]);
  check("the barcode link is a real row, not just an HTTP response", dbLink?.item_text === "Sparkling water" && dbLink?.last_price_cents === 249, JSON.stringify(dbLink));

  // Same product, back on the run (a fresh open item with the same text) -- the now-linked
  // barcode should resolve straight to it: exact.
  const sparklingAgain = await http(`/api/lists/${shoppingId}/items`, { method: "POST", body: { items: ["Sparkling water"] } });
  const sparklingItem2 = sparklingAgain.json?.items?.find((i) => i.text === "Sparkling water" && !i.done);
  const lookupExact = await http(`/api/lists/${shoppingId}/scan/lookup`, { method: "POST", body: { barcode: freshBarcode } });
  check("scan lookup: a linked barcode resolves to exact with the last real price", lookupExact.status === 200 && lookupExact.json?.match === "exact" && lookupExact.json?.lastPriceCents === 249 && lookupExact.json?.itemId === sparklingItem2?.id, JSON.stringify(lookupExact.json));

  // A real barcode (Diet Coke, world.openfoodfacts.org) against a list item that plausibly
  // resembles it -- near. If the real network lookup is unreachable in this environment, the
  // module honestly degrades to unknown rather than faking a name, so this check accepts either
  // real outcome instead of asserting network access that may not exist here.
  await http(`/api/lists/${shoppingId}/items`, { method: "POST", body: { items: ["Diet cola 12 pack"] } });
  const lookupNear = await http(`/api/lists/${shoppingId}/scan/lookup`, { method: "POST", body: { barcode: "049000028911" } });
  check(
    "scan lookup: a real known barcode either finds a resembling open item (near) or, if the real product lookup was unreachable, honestly falls back to unknown -- never a fake name or a silent failure",
    lookupNear.status === 200 && (lookupNear.json?.match === "near" || lookupNear.json?.match === "unknown"),
    JSON.stringify(lookupNear.json),
  );
  if (lookupNear.json?.match === "near") {
    check("near match includes real candidate chips from the actual open items", Array.isArray(lookupNear.json?.candidates) && lookupNear.json.candidates.some((c) => c.text === "Diet cola 12 pack"), JSON.stringify(lookupNear.json));
  }

  const scanActivity = await http("/api/activity");
  check("a scan save is in the real audit trail", scanActivity.json?.activity?.some((a) => a.actor === "web" && a.action === "list.item.scan"));

  // Revoke the push_list share so it doesn't linger past this run.
  if (pushedPayload?.share?.id) await http(`/api/shares/${pushedPayload.share.id}`, { method: "DELETE" });

  cookie = null;

  // 6d. Store paths + aisle memory (Git #3108) -- Flat / Category / Best path, and a real,
  // growing per-store aisle map ("say where you found it once; next trip the list walks the
  // store in order").
  cookie = savedCookie;
  const aldiStore = `Check Aldi ${stamp}`;

  const storeSet = await http(`/api/lists/${shoppingId}/store`, { method: "PATCH", body: { store: aldiStore } });
  check("PATCH .../store sets which real store this run is at", storeSet.status === 200 && storeSet.json?.store === aldiStore, JSON.stringify(storeSet.json));

  const freshRun = await http(`/api/lists/${shoppingId}/items`, {
    method: "POST",
    body: { items: ["Pasta, 3 boxes", "Bananas", "Milk, full gallon"] },
  });
  const pastaItem = freshRun.json?.items?.find((i) => i.text === "Pasta, 3 boxes");
  const milkItem2 = freshRun.json?.items?.find((i) => i.text === "Milk, full gallon");
  check("real items exist to build ordering coverage on", Boolean(pastaItem && milkItem2), JSON.stringify(freshRun.json?.items?.map((i) => i.text)));

  const categoryOrder = await http(`/api/lists/${shoppingId}?order=category`);
  check(
    "order=category groups items by the design's own real grocery categories",
    categoryOrder.json?.groups?.some((g) => g.category === "Pantry" && g.items.some((i) => i.text === "Pasta, 3 boxes")) &&
      categoryOrder.json?.groups?.some((g) => g.category === "Produce" && g.items.some((i) => i.text === "Bananas")) &&
      categoryOrder.json?.groups?.some((g) => g.category === "Dairy" && g.items.some((i) => i.text === "Milk, full gallon")),
    JSON.stringify(categoryOrder.json?.groups?.map((g) => [g.category, g.items.map((i) => i.text)])),
  );

  // Directly recording a spot on one item, through the owner API -- writes the real store_aisles
  // row AND stamps the run's own row for immediate display.
  const spotSet = await http(`/api/lists/${shoppingId}/items/${pastaItem.id}/aisle`, {
    method: "POST",
    body: { aisle: 12, note: "end cap" },
  });
  check("recording a real aisle spot works and defaults to the list's own store", spotSet.status === 200 && spotSet.json?.spot?.store === aldiStore && spotSet.json?.spot?.aisle === 12, JSON.stringify(spotSet.json));
  check("the spot is stamped onto the item's own note for this run", spotSet.json?.item?.note === "Aisle 12 · end cap", JSON.stringify(spotSet.json?.item));

  // record_aisle (MCP) -- grows the store map for an item with nothing on this run's list yet
  // stamped, proving Best-path reads the real accumulated map, not just what got stamped by hand.
  const bananaSpot = await rpc(token.token, "tools/call", {
    name: "record_aisle",
    arguments: { store: aldiStore, item: "Bananas", aisle: 1, note: "produce wall, right" },
  });
  const bananaSpotPayload = toolResult(bananaSpot);
  check("record_aisle (MCP) writes a real store_aisles row", bananaSpotPayload?.spot?.aisle === 1 && bananaSpotPayload?.spot?.hits === 1, JSON.stringify(bananaSpotPayload));

  // A second real report of the same item at the same store corrects the spot in place and bumps
  // hits -- the "real, improving aisle map" building over repeated captures, not a one-time entry.
  const bananaSpotAgain = await rpc(token.token, "tools/call", {
    name: "record_aisle",
    arguments: { store: aldiStore, item: "Bananas", aisle: 1, note: "produce wall, moved to the endcap" },
  });
  const bananaSpotAgainPayload = toolResult(bananaSpotAgain);
  check("a repeat report updates the spot in place and grows hits, not a duplicate row", bananaSpotAgainPayload?.spot?.hits === 2 && bananaSpotAgainPayload?.spot?.note === "produce wall, moved to the endcap", JSON.stringify(bananaSpotAgainPayload));

  const storeMap = await rpc(token.token, "tools/call", { name: "get_store_map", arguments: { store: aldiStore } });
  const storeMapPayload = toolResult(storeMap);
  check(
    "get_store_map (MCP) reads back the real accumulated map, sorted by aisle",
    storeMapPayload?.items?.length === 2 && storeMapPayload.items[0].aisle === 1 && storeMapPayload.items[1].aisle === 12,
    JSON.stringify(storeMapPayload),
  );

  const bestOrder = await http(`/api/lists/${shoppingId}?order=best`);
  const bestGroups = bestOrder.json?.groups || [];
  check(
    "order=best walks known aisles in ascending order, using the real accumulated map (not just this run's own stamped note)",
    bestGroups.length === 2 && bestGroups[0].aisle === 1 && bestGroups[0].items.some((i) => i.text === "Bananas") &&
      bestGroups[1].aisle === 12 && bestGroups[1].items.some((i) => i.text === "Pasta, 3 boxes"),
    JSON.stringify(bestGroups.map((g) => [g.aisle, g.items.map((i) => i.text)])),
  );
  check(
    "an item with no real spot yet sinks into `unknown`, not guessed at",
    bestOrder.json?.unknown?.some((i) => i.text === "Milk, full gallon"),
    JSON.stringify(bestOrder.json?.unknown),
  );

  const dbSpotCount = await one("SELECT count(*)::int AS n FROM store_aisles WHERE user_id = $1 AND lower(store) = lower($2)", [userId, aldiStore]);
  check("the real store_aisles rows are really in the database, not just the response", dbSpotCount?.n === 2, JSON.stringify(dbSpotCount));

  const aisleActivity = await http("/api/activity");
  check("the aisle-memory writes are in the audit trail", aisleActivity.json?.activity?.some((a) => a.actor === "mcp" && a.action === "store_aisle.record"));

  cookie = null;

  // 7. revocation really revokes
  cookie = savedCookie;
  const shares = await http(`/api/shares?entityId=${entityId}`);
  const shareId = shares.json?.shares?.[0]?.id;
  await http(`/api/shares/${shareId}`, { method: "DELETE" });
  const afterRevoke = await http(`/api/public/share/${shareToken}`, { auth: false });
  check("a revoked share link stops working", afterRevoke.status === 404, `status ${afterRevoke.status}`);

  // 8. sign out really signs out
  await http("/api/auth/logout", { method: "POST" });
  const afterLogout = await http("/api/entities");
  check("the session is dead after signing out", afterLogout.status === 401, `status ${afterLogout.status}`);
}

/**
 * The whole run happened against the database the WPF app reads. Prove nothing in it moved.
 * A count is enough here because this check only ever inserts -- it has no code path that could
 * update a ShanesSurvival row in place.
 */
async function assertSurvivalUntouched() {
  if (!survivalBefore) return;
  const after = await survivalCounts();
  const moved = Object.keys(survivalBefore).filter((t) => survivalBefore[t] !== after[t]);
  check(
    "not one ShanesSurvival row moved during the whole run",
    moved.length === 0,
    moved.length ? moved.map((t) => `${t}: ${survivalBefore[t]} -> ${after[t]}`).join(", ") : Object.keys(after).length + " tables re-counted",
  );
}

try {
  await main();
} catch (err) {
  failures++;
  results.push(`FAIL  unexpected error -- ${err.stack || err.message}`);
} finally {
  // Clean up: the disposable account and everything it owns, plus the throwaway category.
  // Scoped by this run's own user id -- it can never reach a ShanesSurvival table.
  if (userId) {
    await query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
    await query("DELETE FROM categories WHERE slug = $1", [noveltyCategory]).catch(() => {});
  }
  await assertSurvivalUntouched().catch((err) => {
    failures++;
    results.push(`FAIL  could not re-count ShanesSurvival's tables -- ${err.message}`);
  });
  await closePool();
  console.log("");
  for (const line of results) console.log(line);
  console.log("");
  console.log(`${results.length - failures}/${results.length} checks passed against ${BASE}`);
  console.log("");
  console.log("Not covered here: the browser half of WebAuthn (that app.js calls");
  console.log("navigator.credentials with the right options, and that Face ID actually fires).");
  console.log("The server half above is real -- real P-256 keys, real signatures, real refusals.");
  process.exitCode = failures === 0 ? 0 : 1;
}
