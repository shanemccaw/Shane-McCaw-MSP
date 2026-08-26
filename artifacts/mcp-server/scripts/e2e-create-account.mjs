#!/usr/bin/env node
// Live end-to-end proof for create_account (Git #1321): seeds a REAL paid
// checkout_sessions row + a verification-code row with a KNOWN code (bcrypt
// via pgcrypto — so NO email is ever sent by this harness), then drives the
// full flow over the real MCP stdio chain against the live local api-server:
// status → wrong code → right code → set_password (real users row provisioned
// through the real provisionProspectAccount) → already_set refusal. Every
// server-side gate is exercised for real; all seeded/provisioned rows are
// swept afterwards (including the lead_staging/msp_job_queue rows the real
// provisioning path stages, so no .invalid lead ever drains into Zoho).
//
//   node scripts/e2e-create-account.mjs
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const { loadEnvLocal } = await import("../src/env.ts");
loadEnvLocal();
const { default: pg } = await import("pg");
const dbc = new pg.Client({ connectionString: process.env.DATABASE_URL });
await dbc.connect();

const RUN_TAG = randomBytes(4).toString("hex");
const EMAIL = `mcp-1321-${RUN_TAG}@mcp-1321-e2e.invalid`;
const CODE = "731945";
const WRONG_CODE = "000000";
const PASSWORD = `E2e-Passw0rd-${RUN_TAG}`;

// ── Seed: one paid session with a known (never-emailed) code, one paid
//    session with no email at all (proves send_verification_code's wiring
//    through the real route without sending real mail).
const { rows: [sessB] } = await dbc.query(
  `INSERT INTO checkout_sessions (product_slug, full_name, email, company, status, expires_at)
   VALUES ('retainer-focus', 'MCP E2E Buyer 1321', $1, 'MCP E2E Co', 'paid', now() + interval '1 hour')
   RETURNING id`,
  [EMAIL],
);
const { rows: [sessA] } = await dbc.query(
  `INSERT INTO checkout_sessions (product_slug, full_name, email, status, expires_at)
   VALUES ('retainer-focus', 'MCP E2E NoMail 1321', '', 'paid', now() + interval '1 hour')
   RETURNING id`,
);
await dbc.query(
  `INSERT INTO checkout_email_verifications (session_id, email, code_hash, attempts, expires_at)
   VALUES ($1, $2, crypt($3, gen_salt('bf', 10)), 0, now() + interval '15 minutes')`,
  [sessB.id, EMAIL, CODE],
);

const child = spawn(process.execPath, [join(pkgDir, "src", "index.ts")], {
  stdio: ["pipe", "pipe", "inherit"],
  cwd: pkgDir,
  env: process.env,
});

let buffer = "";
const pending = new Map();
let nextId = 1;
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 60_000);
    pending.set(id, (msg) => { clearTimeout(timer); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"); }
const failures = [];
function check(label, ok, detail) { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures.push(label); }
function parse(r) { try { return JSON.parse(r?.content?.[0]?.text ?? "null"); } catch { return null; } }
function errText(r) { return (r?.content?.[0]?.text ?? "").slice(0, 200); }
const call = (args) => request("tools/call", { name: "create_account", arguments: args });

try {
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e-create-account", version: "0.0.0" } });
  notify("notifications/initialized", {});
  const tools = await request("tools/list", {});
  check("tools/list contains create_account", (tools?.tools ?? []).some((t) => t.name === "create_account"), "");

  // Session gate: a UUID with no session behind it answers the route's own 404.
  const ghost = await call({ action: "status", sessionId: "00000000-0000-4000-8000-000000000000" });
  check("unknown session refused with the route's session_expired", ghost?.isError && errText(ghost).includes("session_expired"), errText(ghost));

  const s0 = parse(await call({ action: "status", sessionId: sessB.id }));
  check("status: fresh session honestly unverified", s0?.emailVerified === false && s0?.passwordSet === false && s0?.productSlug === "retainer-focus", JSON.stringify(s0));

  // send_verification_code wiring, no real mail: the emailless session hits the
  // real route and comes back with its real 409 refusal.
  const send = await call({ action: "send_verification_code", sessionId: sessA.id });
  check("send_verification_code reaches the real route (email_missing 409)", send?.isError && errText(send).includes("email_missing"), errText(send));

  const wrong = await call({ action: "verify_code", sessionId: sessB.id, code: WRONG_CODE });
  check("wrong code refused (code_incorrect, budget counted)", wrong?.isError && errText(wrong).includes("code_incorrect"), errText(wrong));

  const right = parse(await call({ action: "verify_code", sessionId: sessB.id, code: CODE }));
  check("right code verifies", right?.ok === true, JSON.stringify(right));

  const setRes = await call({ action: "set_password", sessionId: sessB.id, password: PASSWORD });
  const set = parse(setRes);
  check(
    "set_password completes the account (real users row provisioned)",
    !setRes?.isError && set?.ok === true && set?.accountProvisioned === true && typeof set?.portalUrl === "string" && set?.signupTokenWithheld === true,
    setRes?.isError ? errText(setRes) : JSON.stringify(set),
  );
  check("signupToken never transits the result", !(setRes?.content?.[0]?.text ?? "").includes("signupToken="), "");

  const again = await call({ action: "set_password", sessionId: sessB.id, password: PASSWORD });
  check("repeat set_password refused (already_set — never overwrites)", again?.isError && errText(again).includes("already_set"), errText(again));

  const s1 = parse(await call({ action: "status", sessionId: sessB.id }));
  check("status: account honestly complete", s1?.emailVerified === true && s1?.passwordSet === true, JSON.stringify(s1));

  // The real users row + credential must exist.
  // provisionProspectAccount writes the legacy customer role value 'client'
  // (CustomerUser is the portal-facing mapping of it, not the column literal).
  const { rows: userRows } = await dbc.query(`SELECT id, role, password_hash FROM users WHERE email = $1`, [EMAIL]);
  check("real users row exists with a bcrypt credential", userRows.length === 1 && ["client", "CustomerUser"].includes(userRows[0].role) && String(userRows[0].password_hash ?? "").startsWith("$2"), JSON.stringify({ role: userRows[0]?.role, hash: String(userRows[0]?.password_hash ?? "").slice(0, 4) }));

  // Git #1325 audit trail: every call landed, secrets redacted.
  const { rows: audits } = await dbc.query(
    `SELECT outcome, entity_id, metadata FROM msp_audit_logs
      WHERE action_type = 'mcp.tool.create_account' AND occurred_at > now() - interval '3 minutes'
      ORDER BY occurred_at`,
  );
  const mine = audits.filter((r) => [sessA.id, sessB.id, "00000000-0000-4000-8000-000000000000"].includes(r.entity_id));
  // 8 tool calls above → 8 finalized rows (attempt rows finalized to success/failure).
  check("msp_audit_logs holds finalized rows for every call (Git #1325)", mine.length >= 8 && mine.every((r) => r.outcome === "success" || r.outcome === "failure"), `${mine.length} rows: ${mine.map((r) => `${(r.metadata?.params?.action ?? "?")}:${r.outcome}`).join(", ")}`);
  const secretRows = mine.filter((r) => r.metadata?.params?.action === "verify_code" || r.metadata?.params?.action === "set_password");
  check(
    "code/password REDACTED in the audit trail",
    secretRows.length >= 4 && secretRows.every((r) => {
      const p = r.metadata?.params ?? {};
      return (p.code === undefined || p.code === "[redacted]") && (p.password === undefined || p.password === "[redacted]");
    }) && !JSON.stringify(mine).includes(PASSWORD) && !JSON.stringify(mine).includes(CODE),
    `${secretRows.length} secret-bearing rows checked`,
  );
  check("signupToken absent from the audited result", !JSON.stringify(mine).includes("signupToken="), "");
} catch (err) {
  check("e2e create_account run", false, err instanceof Error ? err.message : String(err));
} finally {
  child.kill();
  // ── Sweep every row this run created (mirrors purchase-account-flow.test.ts).
  try {
    // Sessions first: checkout_sessions.account_user_id FKs the users row.
    await dbc.query(`DELETE FROM checkout_email_verifications WHERE session_id IN ($1, $2)`, [sessA.id, sessB.id]);
    await dbc.query(`DELETE FROM checkout_sessions WHERE id IN ($1, $2)`, [sessA.id, sessB.id]);
    const { rows: users } = await dbc.query(`SELECT id FROM users WHERE email = $1`, [EMAIL]);
    for (const u of users) {
      await dbc.query(`DELETE FROM signup_exchange_tokens WHERE user_id = $1`, [u.id]);
    }
    await dbc.query(`DELETE FROM users WHERE email = $1`, [EMAIL]);
    await dbc.query(`DELETE FROM lead_staging WHERE email LIKE '%@mcp-1321-e2e.invalid'`);
    await dbc.query(`DELETE FROM msp_job_queue WHERE payload::text LIKE '%mcp-1321-e2e.invalid%'`);
    console.log("cleanup: all seeded/provisioned rows swept");
  } catch (err) {
    check("cleanup", false, err instanceof Error ? err.message : String(err));
  }
  await dbc.end();
}
process.exit(failures.length ? 1 : 0);
