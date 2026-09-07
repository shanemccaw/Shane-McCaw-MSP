#!/usr/bin/env node
// Real end-to-end check against a running server and the real database.
//
//   npm start          # in one terminal
//   npm run check      # in another
//
// It exercises the whole foundation the way it is actually used: sign in with a real account,
// capture something, have MCP classify it into a brand-new category nobody coded for, mint a
// no-login share link, tick an item off through that link with no cookie at all, and confirm the
// tick is visible to the signed-in owner. Nothing is stubbed and nothing is faked -- every
// assertion is against real rows.
//
// It creates a disposable account (check+<timestamp>@shanes.life) and deletes it at the end, so
// running it never leaves residue in real data.

import { closePool, one, query } from "../src/db.mjs";
import { runMigrations } from "../src/migrate.mjs";
import { createUser } from "../src/core/users.mjs";
import { issueMcpToken } from "../src/core/mcp-tokens.mjs";

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
const password = `check-${stamp}-passphrase`;
// A slug no code anywhere in this repo has ever heard of -- the point of the extensibility test.
const noveltyCategory = `check_novelty_${stamp}`;
let userId = null;

async function main() {
  await runMigrations({ log: () => {} });

  // 0. the server is actually up
  const health = await http("/healthz", { auth: false });
  if (!check("server is up and the database is reachable", health.status === 200 && health.json?.db === "up", JSON.stringify(health.json))) {
    return;
  }

  // 1. real account, real login
  const user = await createUser({ email, name: "Check Account", password });
  userId = user.id;

  const badLogin = await http("/api/auth/login", { method: "POST", body: { email, password: "wrong-password-entirely" }, auth: false });
  check("a wrong password is refused", badLogin.status === 401, `status ${badLogin.status}`);
  check("the refusal does not say whether the account exists", badLogin.json?.error === "That email and password do not match an account.", badLogin.json?.error);

  cookie = null;
  const anon = await http("/api/entities", { auth: false });
  check("the API refuses an unauthenticated read", anon.status === 401, `status ${anon.status}`);

  const login = await http("/api/auth/login", { method: "POST", body: { email, password } });
  check("a real login succeeds", login.status === 200 && login.json?.user?.email === email, JSON.stringify(login.json));
  check("login sets an HttpOnly session cookie", /sl_session=/.test(cookie || ""), cookie ? "cookie set" : "no cookie");

  const me = await http("/api/me");
  check("the session identifies the right account", me.json?.user?.email === email);

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

  // 7. revocation really revokes
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

try {
  await main();
} catch (err) {
  failures++;
  results.push(`FAIL  unexpected error -- ${err.stack || err.message}`);
} finally {
  // Clean up: the disposable account and everything it owns, plus the throwaway category.
  if (userId) {
    await query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
    await query("DELETE FROM categories WHERE slug = $1", [noveltyCategory]).catch(() => {});
  }
  await closePool();
  console.log("");
  for (const line of results) console.log(line);
  console.log("");
  console.log(`${results.length - failures}/${results.length} checks passed against ${BASE}`);
  process.exitCode = failures === 0 ? 0 : 1;
}
