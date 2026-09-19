// The real Financial Ledger (Git #4863): dated payment / transfer / notice events.
//
// `debts` is ShanesSurvival's own single-user table (no user_id), so a debt is resolved by id or
// by creditor name across all rows, the same tiered matching log_car_maintenance uses for vehicle
// names. An ambiguous or unmatched name throws asking, never guesses and never silently leaves
// the event unlinked -- an unlinked event is only ever what the caller asked for (no debt given).

import { many, one } from "../db.mjs";
import { badRequest } from "../http.mjs";
import { parseAmountCents, toDollars } from "./money.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const COLUMNS = `e.id, e.event_type, e.amount_cents, e.from_account, e.to_account, e.source, e.debt_id,
       d.creditor_name AS debt_creditor, e.occurred_on::text AS occurred_on, e.note, e.created_at`;

function out(row) {
  return {
    id: row.id,
    eventType: row.event_type,
    amount: row.amount_cents === null ? null : toDollars(row.amount_cents),
    amountCents: row.amount_cents,
    fromAccount: row.from_account,
    toAccount: row.to_account,
    source: row.source,
    debtId: row.debt_id,
    debtCreditor: row.debt_creditor ?? null,
    occurredOn: row.occurred_on,
    note: row.note,
    createdAt: row.created_at,
  };
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function cleanDate(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  if (!ISO_DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    throw badRequest(`${label} must be a real YYYY-MM-DD date`);
  }
  return s;
}

/** Resolve a debt by real id, or by creditor name (exact, then prefix, then substring). */
export async function resolveDebt(idOrName) {
  const needle = String(idOrName ?? "").trim();
  if (!needle) throw badRequest("debt is required");
  if (UUID_RE.test(needle)) {
    const row = await one(`SELECT id, creditor_name FROM debts WHERE id = $1`, [needle]);
    if (!row) throw badRequest(`There is no debt with id ${needle}. Call list_debts to see real debts.`);
    return row;
  }
  const all = await many(`SELECT id, creditor_name FROM debts ORDER BY creditor_name`);
  const lower = needle.toLowerCase();
  const tiers = [
    all.filter((d) => d.creditor_name.toLowerCase() === lower),
    all.filter((d) => d.creditor_name.toLowerCase().startsWith(lower)),
    all.filter((d) => d.creditor_name.toLowerCase().includes(lower)),
  ];
  for (const tier of tiers) {
    if (tier.length === 1) return tier[0];
    if (tier.length > 1) {
      throw badRequest(`"${needle}" matches ${tier.map((d) => d.creditor_name).join(", ")} -- say which one.`);
    }
  }
  throw badRequest(`There is no debt called "${needle}". Call list_debts to see real creditor names, or omit debtId to log this unlinked.`);
}

async function getEvent(userId, id) {
  const row = await one(
    `SELECT ${COLUMNS} FROM financial_events e LEFT JOIN debts d ON d.id = e.debt_id WHERE e.id = $1 AND e.user_id = $2`,
    [id, userId],
  );
  return out(row);
}

export async function logEvent(userId, args = {}) {
  const eventType = cleanText(args.eventType);
  if (!eventType) throw badRequest("eventType is required (e.g. payment, transfer, notice, balance_update, legal, other)");
  const amountCents =
    args.amount === null || args.amount === undefined || args.amount === ""
      ? null
      : parseAmountCents(args.amount, "amount");
  const debt = args.debtId ? await resolveDebt(args.debtId) : null;
  const occurredOn = cleanDate(args.occurredOn, "occurredOn");

  const inserted = await one(
    `INSERT INTO financial_events (user_id, event_type, amount_cents, from_account, to_account, source, debt_id, occurred_on, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::date, CURRENT_DATE), $9)
     RETURNING id`,
    [userId, eventType, amountCents, cleanText(args.fromAccount), cleanText(args.toAccount), cleanText(args.source), debt?.id ?? null, occurredOn, cleanText(args.note)],
  );
  return getEvent(userId, inserted.id);
}

/** Real ledger rows, newest first. Every filter is optional; `source` is a case-insensitive substring. */
export async function listEvents(userId, args = {}) {
  const params = [userId];
  const where = ["e.user_id = $1"];
  if (args.debtId) {
    const debt = await resolveDebt(args.debtId);
    params.push(debt.id);
    where.push(`e.debt_id = $${params.length}`);
  }
  if (cleanText(args.source)) {
    params.push(`%${cleanText(args.source).replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`e.source ILIKE $${params.length}`);
  }
  if (cleanText(args.eventType)) {
    params.push(cleanText(args.eventType).toLowerCase());
    where.push(`lower(e.event_type) = $${params.length}`);
  }
  const from = cleanDate(args.from, "from");
  const to = cleanDate(args.to, "to");
  if (from) {
    params.push(from);
    where.push(`e.occurred_on >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`e.occurred_on <= $${params.length}::date`);
  }
  const limit = Math.min(Math.max(Number.parseInt(args.limit ?? 100, 10) || 100, 1), 500);
  params.push(limit);
  const rows = await many(
    `SELECT ${COLUMNS} FROM financial_events e LEFT JOIN debts d ON d.id = e.debt_id
      WHERE ${where.join(" AND ")}
      ORDER BY e.occurred_on DESC, e.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map(out);
}
