#!/usr/bin/env node
// Real end-to-end selftest for the Financial Ledger (Git #4863).
//
//   ADMIN_DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/postgres npm run selftest-financial-events
//
// It builds a DISPOSABLE scratch database (never a shared one), creates only the three tables the
// ledger touches (users, activity_log, debts -- debts trimmed to the columns the ledger reads),
// applies the REAL migrations/075_financial_events.sql, then drives the REAL log_financial_event /
// list_financial_events tool handlers and asserts on real rows. The scratch database is dropped at
// the end. ADMIN_DATABASE_URL is only used to CREATE/DROP that scratch database.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const admin = process.env.ADMIN_DATABASE_URL;
if (!admin) {
  console.error("ADMIN_DATABASE_URL is required (a connection to any existing database, used only to create/drop the scratch one).");
  process.exit(2);
}

const scratchName = `fe_selftest_${Date.now()}`;
const adminUrl = new URL(admin);
const scratchUrl = new URL(admin);
scratchUrl.pathname = `/${scratchName}`;

const adminPool = new pg.Pool({ connectionString: adminUrl.toString(), max: 1 });
await adminPool.query(`CREATE DATABASE ${scratchName}`);

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures += 1;
}
async function rejects(label, fn, pattern) {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (e) {
    check(label, pattern.test(String(e.message)), `threw: ${e.message}`);
  }
}

try {
  process.env.DATABASE_URL = scratchUrl.toString();
  const { pool } = await import("../src/db.mjs");
  const dir = dirname(fileURLToPath(import.meta.url));

  await pool.query(`
    CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL);
    CREATE TABLE activity_log (
      id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
      user_id uuid REFERENCES users(id) ON DELETE SET NULL, actor text NOT NULL, actor_label text,
      action text NOT NULL, entity_id uuid, detail jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE debts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creditor_name text NOT NULL, balance numeric);
  `);
  await pool.query(readFileSync(resolve(dir, "../migrations/075_financial_events.sql"), "utf8"));

  const { rows: [user] } = await pool.query(`INSERT INTO users (email) VALUES ('selftest@example.invalid') RETURNING id`);
  const { rows: [other] } = await pool.query(`INSERT INTO users (email) VALUES ('other@example.invalid') RETURNING id`);
  await pool.query(`INSERT INTO debts (creditor_name, balance) VALUES ('Chrysler Capital', 1000), ('Chase Sapphire', 10), ('Chase Freedom', 20)`);
  const { rows: [chrysler] } = await pool.query(`SELECT id FROM debts WHERE creditor_name = 'Chrysler Capital'`);

  const { TOOLS_BY_NAME } = await import("../src/mcp/tools.mjs");
  const ctx = { user: { id: user.id }, label: "selftest" };
  const log = (args) => TOOLS_BY_NAME.get("log_financial_event").handler(args, ctx);
  const list = async (args = {}) => (await TOOLS_BY_NAME.get("list_financial_events").handler(args, ctx)).events;

  check("both tools are registered", TOOLS_BY_NAME.has("log_financial_event") && TOOLS_BY_NAME.has("list_financial_events"));

  const payment = await log({ eventType: "payment", amount: 351.31, source: "FPL", occurredOn: "2026-09-18", note: "PAID: Home FPL electric bill $351.31" });
  const transfer = await log({ eventType: "transfer", amount: 898.78, fromAccount: "Navy Federal H1 Mortgage", toAccount: "Auto Insurance", occurredOn: "2026-09-17" });
  const notice = await log({ eventType: "notice", source: "Chrysler", debtId: "chrysler", occurredOn: "2026-09-16", note: "Past-due notice" });

  check("payment cents stored exactly", payment.amountCents === 35131 && payment.amount === 351.31, JSON.stringify(payment));
  check("payment is unlinked", payment.debtId === null);
  check("transfer keeps from/to accounts", transfer.fromAccount === "Navy Federal H1 Mortgage" && transfer.toAccount === "Auto Insurance");
  check("notice resolved debt by name (prefix, case-insensitive)", notice.debtId === chrysler.id && notice.debtCreditor === "Chrysler Capital", JSON.stringify(notice));
  check("notice with no amount stores NULL", notice.amount === null && notice.amountCents === null);
  const defaulted = await log({ eventType: "other" });
  check("occurredOn defaults to today", defaulted.occurredOn === new Date().toISOString().slice(0, 10) || /^\d{4}-\d{2}-\d{2}$/.test(defaulted.occurredOn), defaulted.occurredOn);

  await rejects("ambiguous debt name asks", () => log({ eventType: "payment", debtId: "Chase" }), /matches Chase Freedom, Chase Sapphire -- say which one/);
  await rejects("unmatched debt name asks", () => log({ eventType: "payment", debtId: "Nonexistent Bank" }), /no debt called/);
  await rejects("missing eventType rejected", () => log({}), /eventType is required/);
  await rejects("bad date rejected", () => log({ eventType: "payment", occurredOn: "09/18/2026" }), /YYYY-MM-DD/);
  const { rows: [{ count }] } = await pool.query(`SELECT count(*)::int AS count FROM financial_events`);
  check("rejected calls wrote nothing", count === 4, `count=${count}`);

  check("list: no filter returns all, newest first", (await list()).map((e) => e.id).join() === [defaulted.id, payment.id, transfer.id, notice.id].join());
  check("list: filter by debtId (id)", (await list({ debtId: chrysler.id })).map((e) => e.id).join() === notice.id);
  check("list: filter by debtId (name)", (await list({ debtId: "Chrysler Capital" })).map((e) => e.id).join() === notice.id);
  check("list: filter by source substring", (await list({ source: "fpl" })).map((e) => e.id).join() === payment.id);
  check("list: filter by eventType", (await list({ eventType: "TRANSFER" })).map((e) => e.id).join() === transfer.id);
  check("list: date range", (await list({ from: "2026-09-17", to: "2026-09-18" })).map((e) => e.id).join() === [payment.id, transfer.id].join());
  check("list: combined filters", (await list({ eventType: "notice", from: "2026-09-16", to: "2026-09-16", debtId: "chrysler" })).length === 1);
  check("list: no-match filter is empty", (await list({ source: "zzz" })).length === 0);
  check("list: '%' in source is literal, not a wildcard", (await list({ source: "%" })).length === 0);
  const otherCtx = { user: { id: other.id }, label: "selftest" };
  check("list: scoped to the calling user", (await TOOLS_BY_NAME.get("list_financial_events").handler({}, otherCtx)).events.length === 0);
  const { rows: audit } = await pool.query(`SELECT count(*)::int AS n FROM activity_log WHERE action = 'money.financial_event.log'`);
  check("each write audited", audit[0].n === 4, `n=${audit[0].n}`);

  await pool.query(`DELETE FROM debts WHERE id = $1`, [chrysler.id]);
  const afterDelete = await list({ eventType: "notice" });
  check("deleting a debt keeps the event, unlinks it", afterDelete.length === 1 && afterDelete[0].debtId === null && afterDelete[0].note === "Past-due notice");

  await pool.end();
} finally {
  await adminPool.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
  await adminPool.end();
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
