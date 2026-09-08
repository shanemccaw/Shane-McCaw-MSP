#!/usr/bin/env node
// Real end-to-end check of the Plaid webhook receiver (Git #3168).
//
//   npm run selftest-plaid-webhook
//
// What it genuinely proves, against the REAL local database:
//   * the ES256 Plaid-Verification check accepts a correctly-signed webhook and rejects a
//     tampered body, a downgraded alg, a stale timestamp, and a missing header
//   * a real ITEM: ERROR / ITEM_LOGIN_REQUIRED webhook flips a real plaid_items row to
//     login_required and writes a real plaid_webhook_events row
//   * ITEM: LOGIN_REPAIRED puts it back
//   * TRANSACTIONS: SYNC_UPDATES_AVAILABLE records that data is waiting without pretending to sync
//   * a webhook for an item_id this database has never seen is recorded, not rejected
//
// What it does NOT prove, and says so rather than implying otherwise: that Plaid's own servers
// can reach a deployed URL, and that a real key fetched from /webhook_verification_key/get
// verifies. Both need a real public HTTPS deployment and live Plaid credentials; the key here is
// this process's own P-256 pair, seeded through the module's documented test seam.
//
// It works on a disposable plaid_items row (institution name zz-selftest-3168) and deletes it in
// a finally block, so running it never touches one of Shane's real bank connections. Same
// discipline as bin/check.mjs's disposable user.

import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { Readable } from "node:stream";
import { closePool, one, many, query } from "../src/db.mjs";
import { __test, verifyWebhook } from "../src/core/plaid.mjs";
import { handlePlaidWebhook } from "../src/routes/plaid-webhook.mjs";

const TEST_KID = "selftest-3168-kid";
const TEST_INSTITUTION = "zz-selftest-3168";
const TEST_PLAID_ITEM_ID = `selftest-item-${Date.now()}`;

const results = [];
let failures = 0;

function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  return ok;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicJwk = publicKey.export({ format: "jwk" });
__test.seedVerificationKey(TEST_KID, { kty: "EC", crv: "P-256", x: publicJwk.x, y: publicJwk.y });

/** Build a real ES256 JWS exactly the shape Plaid puts in the Plaid-Verification header. */
function signWebhook(rawBody, { alg = "ES256", kid = TEST_KID, iat = Math.floor(Date.now() / 1000), bodyHash } = {}) {
  const header = b64url(JSON.stringify({ alg, kid, typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iat,
      request_body_sha256: bodyHash ?? createHash("sha256").update(rawBody).digest("hex"),
    }),
  );
  const signer = createSign("sha256");
  signer.update(`${header}.${claims}`);
  signer.end();
  // JWS ES256 signatures are raw r||s, not DER -- the same encoding the verifier asks for.
  const signature = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64url(signature)}`;
}

/** Drive the real handler with a real request/response pair, no HTTP server in the way. */
async function deliver(body, { signed = true, jwtOptions = {}, headerOverride = undefined } = {}) {
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  const req = Readable.from([raw]);
  req.headers = {};
  const jwt = headerOverride !== undefined ? headerOverride : signed ? signWebhook(raw, jwtOptions) : undefined;
  if (jwt) req.headers["plaid-verification"] = jwt;

  let status = null;
  let payload = null;
  const res = {
    writeHead(code) {
      status = code;
      return res;
    },
    end(text) {
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { raw: String(text) };
        }
      }
      return res;
    },
    setHeader() {},
    getHeader() {},
  };

  await handlePlaidWebhook(req, res, { ip: `selftest-${Math.random()}`, log: () => {} });
  return { status, payload };
}

let itemId = null;

async function main() {
  // ---- verification unit checks (no database) ------------------------------------------------
  const sampleBody = Buffer.from(JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR" }), "utf8");

  const good = await verifyWebhook(signWebhook(sampleBody), sampleBody);
  check("valid ES256 signature verifies", good.ok, good.reason ?? "");

  const tampered = await verifyWebhook(signWebhook(sampleBody), Buffer.from(`${sampleBody.toString()} `, "utf8"));
  check("tampered body is rejected", !tampered.ok && /hash/i.test(tampered.reason || ""), tampered.reason ?? "");

  const wrongAlg = await verifyWebhook(
    `${b64url(JSON.stringify({ alg: "HS256", kid: TEST_KID }))}.${b64url("{}")}.${b64url("x")}`,
    sampleBody,
  );
  check("alg downgrade is rejected", !wrongAlg.ok && /alg/i.test(wrongAlg.reason || ""), wrongAlg.reason ?? "");

  const stale = await verifyWebhook(
    signWebhook(sampleBody, { iat: Math.floor(Date.now() / 1000) - 6 * 60 }),
    sampleBody,
  );
  check("stale timestamp is rejected", !stale.ok && /5 minutes/i.test(stale.reason || ""), stale.reason ?? "");

  const missing = await verifyWebhook(undefined, sampleBody);
  check("missing Plaid-Verification header is rejected", !missing.ok, missing.reason ?? "");

  // ---- real receiver, real database ---------------------------------------------------------
  const created = await one(
    `INSERT INTO plaid_items (plaid_item_id, access_token, institution_name)
     VALUES ($1, $2, $3) RETURNING id`,
    [TEST_PLAID_ITEM_ID, "selftest-not-a-real-access-token", TEST_INSTITUTION],
  );
  itemId = created.id;

  const loginRequired = await deliver({
    webhook_type: "ITEM",
    webhook_code: "ERROR",
    item_id: TEST_PLAID_ITEM_ID,
    error: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "the login details of this item have changed" },
  });
  check("ITEM:ERROR is accepted", loginRequired.status === 200, `status ${loginRequired.status}`);
  check("ITEM:ERROR is applied", loginRequired.payload?.applied === true);

  let row = await one("SELECT * FROM plaid_items WHERE id = $1", [itemId]);
  check("item health is login_required", row.health_status === "login_required", row.health_status);
  check("item health code recorded", row.health_code === "ITEM_LOGIN_REQUIRED", String(row.health_code));
  check("last_webhook_at stamped", row.last_webhook_at !== null);

  const events = await many("SELECT * FROM plaid_webhook_events WHERE item_id = $1 ORDER BY id", [itemId]);
  check("webhook event row written", events.length === 1, `${events.length} rows`);
  check("event recorded as verified", events[0]?.verified === true);
  check("event payload stored verbatim", events[0]?.payload?.error?.error_code === "ITEM_LOGIN_REQUIRED");

  // A repeat is not news: Plaid re-sends ITEM: ERROR on every failed call.
  const repeat = await deliver({
    webhook_type: "ITEM",
    webhook_code: "ERROR",
    item_id: TEST_PLAID_ITEM_ID,
    error: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "the login details of this item have changed" },
  });
  check("repeated ITEM:ERROR is recorded but not re-applied", repeat.payload?.applied === false);

  const pendingExpiry = await deliver({
    webhook_type: "ITEM",
    webhook_code: "PENDING_EXPIRATION",
    item_id: TEST_PLAID_ITEM_ID,
    consent_expiration_time: "2027-01-01T00:00:00Z",
  });
  row = await one("SELECT * FROM plaid_items WHERE id = $1", [itemId]);
  check("PENDING_EXPIRATION applies", pendingExpiry.payload?.applied === true, row.health_status);
  check("consent expiry stored", row.consent_expires_at !== null, String(row.consent_expires_at));

  await deliver({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED", item_id: TEST_PLAID_ITEM_ID });
  row = await one("SELECT * FROM plaid_items WHERE id = $1", [itemId]);
  check("LOGIN_REPAIRED clears health", row.health_status === "ok", row.health_status);

  await deliver({
    webhook_type: "TRANSACTIONS",
    webhook_code: "SYNC_UPDATES_AVAILABLE",
    item_id: TEST_PLAID_ITEM_ID,
  });
  row = await one("SELECT * FROM plaid_items WHERE id = $1", [itemId]);
  check("transactions marked pending for the desktop sync", row.transactions_pending_since !== null);
  check("sync_cursor untouched by this app", row.sync_cursor === null, String(row.sync_cursor));

  const unsigned = await deliver(
    { webhook_type: "ITEM", webhook_code: "ERROR", item_id: TEST_PLAID_ITEM_ID },
    { signed: false },
  );
  check("unsigned webhook is refused", unsigned.status === 403, `status ${unsigned.status}`);
  const rejected = await one(
    "SELECT * FROM plaid_webhook_events WHERE item_id IS NULL AND plaid_item_id = $1 AND verified = false",
    [TEST_PLAID_ITEM_ID],
  );
  check("refused webhook is still recorded as evidence", rejected !== null, rejected?.note ?? "no row");

  const unknownItem = await deliver({
    webhook_type: "ITEM",
    webhook_code: "ERROR",
    item_id: "item-this-database-has-never-seen",
    error: { error_code: "ITEM_LOGIN_REQUIRED" },
  });
  check("unknown item_id answers 200 so Plaid stops retrying", unknownItem.status === 200);
  const orphan = await one(
    "SELECT * FROM plaid_webhook_events WHERE plaid_item_id = $1",
    ["item-this-database-has-never-seen"],
  );
  check("unknown item_id is still recorded", orphan !== null && orphan.verified === true);

  // Nothing here may have touched a real bank connection.
  const realItems = await many("SELECT health_status FROM plaid_items WHERE institution_name <> $1", [TEST_INSTITUTION]);
  check(
    "real bank rows left untouched",
    realItems.every((r) => r.health_status === "ok"),
    realItems.map((r) => r.health_status).join(","),
  );
}

try {
  await main();
} catch (err) {
  failures++;
  results.push(`FAIL  threw -- ${err.stack || err.message}`);
} finally {
  // Disposable rows go, always -- including on the failure path.
  if (itemId) await query("DELETE FROM plaid_webhook_events WHERE item_id = $1", [itemId]).catch(() => {});
  await query("DELETE FROM plaid_webhook_events WHERE plaid_item_id IN ($1, $2)", [
    TEST_PLAID_ITEM_ID,
    "item-this-database-has-never-seen",
  ]).catch(() => {});
  if (itemId) await query("DELETE FROM plaid_items WHERE id = $1", [itemId]).catch(() => {});
  const leftover = await one("SELECT count(*)::int AS n FROM plaid_items WHERE institution_name = $1", [
    TEST_INSTITUTION,
  ]).catch(() => ({ n: -1 }));
  check("disposable test rows cleaned up", leftover.n === 0, `${leftover.n} left`);
  await closePool().catch(() => {});
}

console.log(results.join("\n"));
console.log(
  failures === 0
    ? `\nALL ${results.length} CHECKS PASSED`
    : `\n${failures} of ${results.length} CHECKS FAILED`,
);
console.log(
  "\nNot covered here (needs a real public HTTPS deployment + live Plaid credentials): that Plaid's\n" +
    "own servers can reach the deployed /api/plaid/webhook, and that a key fetched from\n" +
    "/webhook_verification_key/get verifies a genuinely Plaid-signed body.",
);
process.exitCode = failures === 0 ? 0 : 1;
