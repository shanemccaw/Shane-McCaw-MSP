// Real income-matching rules + transaction auto-scan (Git #3169).
//
// A real port of `shanemccaw/Finance-Tracker`'s `IncomeRule` + `income.tsx`'s own
// `scanTransactions()` (`:282-355`, read via FINANCE_TRACKER_AUDIT.md section 1 before this was
// built): "for every account referenced by an active rule, fetch transactions, match credit
// transactions by matchText/matchType, de-dupe by transaction id, bulk-add income entries." Same
// real, transparent, debuggable text-match model (contains/starts-with/exact, optional amount
// range) as that app -- not an opaque ML categorizer, per the issue's own words.
//
// Two real differences from the Finance-Tracker original, both deliberate:
//   1. No live Plaid call here. #3107 already unified the database, so the real transactions
//      this scans are already synced into ShanesSurvival's own `transactions` table (its own
//      PlaidSyncService does the real Plaid work); this module just reads that shared table
//      through the SAME real Postgres money.mjs already reads.
//   2. Real amount range on the INCOME rule, not just the bill-side TransactionRule -- the audit
//      itself flags Finance-Tracker's asymmetry ("amountMin/amountMax... not in the analogous
//      Income Rule editor, which has no amount filter at all") and the issue's own scope asks
//      for it here from the start.
//
// Plaid sign convention (confirmed in catches.mjs's own detectors and PlaidSyncService.cs):
// amount > 0 is money OUT (a debit/spend), amount < 0 is money IN (a credit/deposit) -- so a
// "credit transaction" for income-matching purposes is `amount < 0`, and the real income entry
// gets created with the positive, human-facing dollar amount (`Math.abs`).
//
// Contract pack Section 8 ("no forms, anywhere, ever") is why rule CRUD lives here as plain
// functions called from MCP tools (tools.mjs) -- the same architecture already used for
// set_habit/set_food_preferences/add_income_rule-shaped tools -- rather than a multi-field add/
// edit form in the web app. The web UI (public/app.js) only ever reads rules and fires
// single-click actions (Scan, Delete, Set primary), the same class of interaction as Catches'
// "Got it" button or Vault's Reveal button, which Section 8's own rule doesn't reach.

import { many, one, transaction } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";
import { resolveAccount, toCents, toDollars } from "./money.mjs";

export const MATCH_TYPES = Object.freeze(["contains", "starts_with", "exact"]);

// Same real 90-day window Finance-Tracker's own scanTransactions() used.
const DEFAULT_LOOKBACK_DAYS = 90;

function parseOptionalAmount(value, label) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw badRequest(`${label} must be a non-negative number of dollars`);
  return Math.round(n * 100);
}

async function loadResolvePools() {
  const [accounts, sources] = await Promise.all([
    many(`SELECT id, name FROM accounts ORDER BY name`),
    many(`SELECT id, name, is_primary FROM income_sources ORDER BY name`),
  ]);
  return { accounts, sources };
}

/** Resolve a name Shane actually said to a real account or income source, reusing money.mjs's
 *  own exact/prefix/substring/no-space tiers (`resolveAccount`) so "which real row did he mean"
 *  never disagrees between this feature and simulate_transfer/what-if. */
async function resolveNamed(name, label) {
  if (!name) throw badRequest(`${label} is required`);
  const { accounts, sources } = await loadResolvePools();
  const pools = label === "account" ? { account: accounts } : { source: sources };
  const result = resolveAccount(name, pools);
  if (result.status === "unknown") throw badRequest(`No ${label} called "${name}".`);
  if (result.status === "ambiguous") {
    throw badRequest(`"${name}" matches ${result.matches.join(", ")} -- say which one.`);
  }
  if (result.status !== "ok") throw badRequest(`${label} is required`);
  return result.row;
}

// ---------------------------------------------------------------------------
// income sources -- listing + the real, editable primary flag
// ---------------------------------------------------------------------------

/** Every real income source, primary first -- the real, editable setting the Finance-Tracker
 *  audit's own gap calls for ("no way to change which income source is primary"). Unlike that
 *  app, nothing in this app's own gate/Budget Day math keys off this flag (computeBudgetDay
 *  already treats every active source equally); it is a real label Shane can set and see, not a
 *  rewire of math that already works across multiple real sources. */
function sourceOut(row) {
  return {
    id: row.id,
    name: row.name,
    person: row.person,
    payFrequencyDays: row.pay_frequency_days,
    expectedPerCycle: toDollars(toCents(row.expected_per_cycle)),
    nextPayDate: row.next_pay_date,
    isActive: row.is_active,
    isPrimary: row.is_primary,
  };
}

export async function listIncomeSources() {
  const rows = await many(
    `SELECT id, name, person, pay_frequency_days, expected_per_cycle, next_pay_date, is_active, is_primary
       FROM income_sources
      ORDER BY is_primary DESC, next_pay_date NULLS LAST, name`,
  );
  return rows.map(sourceOut);
}

/** Sets exactly one real income source as primary, clearing any previous one in the same real
 *  transaction -- the partial unique index (migration 044) is the structural backstop, this is
 *  the normal path. Matches by name (Shane's own words) OR a real id, same dual-shape
 *  convenience as updateRule below. */
export async function setPrimarySource(nameOrId) {
  const source = await resolveSourceByNameOrId(nameOrId);
  const row = await transaction(async (client) => {
    await client.query(`UPDATE income_sources SET is_primary = false WHERE is_primary AND id != $1`, [source.id]);
    const { rows } = await client.query(
      `UPDATE income_sources SET is_primary = true WHERE id = $1
       RETURNING id, name, person, pay_frequency_days, expected_per_cycle, next_pay_date, is_active, is_primary`,
      [source.id],
    );
    return rows[0];
  });
  return sourceOut(row);
}

async function resolveSourceByNameOrId(nameOrId) {
  if (!nameOrId) throw badRequest("incomeSource is required");
  const byId = await one(
    `SELECT id, name FROM income_sources WHERE id::text = $1`,
    [String(nameOrId)],
  ).catch(() => null); // a non-uuid string throws in Postgres -- treat it as "not an id" instead
  if (byId) return byId;
  return resolveNamed(nameOrId, "source");
}

async function resolveAccountByNameOrId(nameOrId) {
  if (!nameOrId) throw badRequest("account is required");
  const byId = await one(`SELECT id, name FROM accounts WHERE id::text = $1`, [String(nameOrId)]).catch(() => null);
  if (byId) return byId;
  return resolveNamed(nameOrId, "account");
}

// ---------------------------------------------------------------------------
// rule CRUD
// ---------------------------------------------------------------------------

function ruleOut(row) {
  return {
    id: row.id,
    name: row.name,
    accountId: row.account_id,
    accountName: row.account_name,
    sourceId: row.source_id,
    sourceName: row.source_name,
    matchType: row.match_type,
    matchText: row.match_text,
    minAmount: toDollars(toCents(row.min_amount)),
    maxAmount: toDollars(toCents(row.max_amount)),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listRules({ includeInactive = false } = {}) {
  const rows = await many(
    `SELECT r.id, r.name, r.account_id, a.name AS account_name, r.source_id, s.name AS source_name,
            r.match_type, r.match_text, r.min_amount, r.max_amount, r.is_active, r.created_at, r.updated_at
       FROM income_rules r
       JOIN accounts a ON a.id = r.account_id
       JOIN income_sources s ON s.id = r.source_id
      ${includeInactive ? "" : "WHERE r.is_active"}
      ORDER BY r.created_at`,
  );
  return rows.map(ruleOut);
}

function validateMatchType(matchType) {
  if (!MATCH_TYPES.includes(matchType)) {
    throw badRequest(`matchType must be one of: ${MATCH_TYPES.join(", ")}`);
  }
}

/** `account`/`incomeSource` are matched by name (Shane's own words, e.g. "DirectDeposit" /
 *  "NASA Salary") or a real id -- same resolution simulate_transfer already uses, so an
 *  ambiguous or unknown name is reported rather than guessed. */
export async function createRule({ name, account, incomeSource, matchType = "contains", matchText, minAmount, maxAmount, isActive = true }) {
  const trimmedName = String(name ?? "").trim();
  if (!trimmedName) throw badRequest("name is required");
  const trimmedMatch = String(matchText ?? "").trim();
  if (!trimmedMatch) throw badRequest("matchText is required");
  validateMatchType(matchType);
  const minCents = parseOptionalAmount(minAmount, "minAmount");
  const maxCents = parseOptionalAmount(maxAmount, "maxAmount");
  if (minCents !== undefined && maxCents !== undefined && minCents > maxCents) {
    throw badRequest("minAmount must not be greater than maxAmount");
  }

  const accountRow = await resolveAccountByNameOrId(account);
  const sourceRow = await resolveSourceByNameOrId(incomeSource);

  const row = await one(
    `INSERT INTO income_rules (name, account_id, source_id, match_type, match_text, min_amount, max_amount, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, name, account_id, source_id, match_type, match_text, min_amount, max_amount, is_active, created_at, updated_at`,
    [
      trimmedName,
      accountRow.id,
      sourceRow.id,
      matchType,
      trimmedMatch,
      minCents === undefined ? null : toDollars(minCents),
      maxCents === undefined ? null : toDollars(maxCents),
      isActive,
    ],
  );
  return ruleOut({ ...row, account_name: accountRow.name, source_name: sourceRow.name });
}

/** Additive-keep, same convention as money.mjs's setHabit: an omitted field keeps its current
 *  value rather than clearing it. */
export async function updateRule(id, patch = {}) {
  const existing = await one(`SELECT * FROM income_rules WHERE id = $1`, [id]);
  if (!existing) throw notFound("Income rule not found");

  const trimmedName = patch.name === undefined ? existing.name : String(patch.name).trim();
  if (!trimmedName) throw badRequest("name must not be blank");
  const matchType = patch.matchType === undefined ? existing.match_type : patch.matchType;
  validateMatchType(matchType);
  const trimmedMatch = patch.matchText === undefined ? existing.match_text : String(patch.matchText).trim();
  if (!trimmedMatch) throw badRequest("matchText must not be blank");

  const minCents = patch.minAmount === undefined ? toCents(existing.min_amount) : parseOptionalAmount(patch.minAmount, "minAmount") ?? null;
  const maxCents = patch.maxAmount === undefined ? toCents(existing.max_amount) : parseOptionalAmount(patch.maxAmount, "maxAmount") ?? null;
  if (minCents !== null && maxCents !== null && minCents > maxCents) {
    throw badRequest("minAmount must not be greater than maxAmount");
  }

  const accountRow = patch.account === undefined ? { id: existing.account_id } : await resolveAccountByNameOrId(patch.account);
  const sourceRow = patch.incomeSource === undefined ? { id: existing.source_id } : await resolveSourceByNameOrId(patch.incomeSource);
  const isActive = patch.isActive === undefined ? existing.is_active : Boolean(patch.isActive);

  const row = await one(
    `UPDATE income_rules
        SET name = $1, account_id = $2, source_id = $3, match_type = $4, match_text = $5,
            min_amount = $6, max_amount = $7, is_active = $8, updated_at = now()
      WHERE id = $9
      RETURNING id, name, account_id, source_id, match_type, match_text, min_amount, max_amount, is_active, created_at, updated_at`,
    [
      trimmedName,
      accountRow.id,
      sourceRow.id,
      matchType,
      trimmedMatch,
      minCents === null ? null : toDollars(minCents),
      maxCents === null ? null : toDollars(maxCents),
      isActive,
      id,
    ],
  );
  const names = await one(
    `SELECT a.name AS account_name, s.name AS source_name FROM accounts a, income_sources s
      WHERE a.id = $1 AND s.id = $2`,
    [row.account_id, row.source_id],
  );
  return ruleOut({ ...row, ...names });
}

export async function deleteRule(id) {
  const row = await one(`DELETE FROM income_rules WHERE id = $1 RETURNING id`, [id]);
  if (!row) throw notFound("Income rule not found");
  return { ok: true, id: row.id };
}

// ---------------------------------------------------------------------------
// matching -- pure, exported so it is testable without a database
// ---------------------------------------------------------------------------

/** `rule` is a listRules()-shaped row (camelCase) or the raw DB row -- both carry matchType/
 *  matchText (or match_type/match_text) and optional min/max amount. `txn` needs amount,
 *  merchant_name, name. Pure and side-effect free. */
export function matchesRule(rule, txn) {
  const matchType = rule.matchType ?? rule.match_type;
  const matchTextRaw = rule.matchText ?? rule.match_text;
  const minAmount = rule.minAmount ?? rule.min_amount;
  const maxAmount = rule.maxAmount ?? rule.max_amount;

  const desc = String(txn.merchant_name || txn.name || "").toLowerCase();
  const needle = String(matchTextRaw ?? "").toLowerCase();
  const textMatch =
    matchType === "contains" ? desc.includes(needle) : matchType === "starts_with" ? desc.startsWith(needle) : desc === needle;
  if (!textMatch) return false;

  const amountAbsCents = Math.abs(toCents(txn.amount) ?? 0);
  const minCents = toCents(minAmount);
  const maxCents = toCents(maxAmount);
  if (minCents !== null && amountAbsCents < minCents) return false;
  if (maxCents !== null && amountAbsCents > maxCents) return false;
  return true;
}

// ---------------------------------------------------------------------------
// the real scan action
// ---------------------------------------------------------------------------

/**
 * "For every account referenced by an active rule, read real transactions, match real credit
 * transactions, de-dupe by real transaction id, bulk-create real income entries" -- the issue's
 * own words, and Finance-Tracker's own scanTransactions() shape.
 *
 * Real, honest handling of a real pre-existing gap found while building this: income_entries can
 * already carry real rows recorded by hand (ShanesSurvival's own RecordEntryAsync MCP tool)
 * before this feature -- or before a transaction's account was ever rule-covered -- with no
 * transaction_id at all. Deduping on transaction_id alone would not recognise those as already
 * logged and would create a real duplicate the first time a rule matches the same real deposit.
 * So a match first tries to CLAIM an existing untracked entry with the same source/date/amount
 * (linking it to its real transaction, closing the historical gap honestly) before ever
 * inserting a new row -- and the unique partial index on transaction_id (migration 044) is the
 * structural backstop against a genuine duplicate either way.
 */
export async function scanTransactions({ lookbackDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  const rules = await listRules({ includeInactive: false });
  if (rules.length === 0) {
    return {
      scannedAccounts: 0,
      transactionsScanned: 0,
      matched: 0,
      created: 0,
      linked: 0,
      alreadyLogged: 0,
      entries: [],
      warnings: ["No active income rules -- add one (ask Claude) before scanning."],
    };
  }

  const rulesByAccount = new Map();
  for (const r of rules) {
    if (!rulesByAccount.has(r.accountId)) rulesByAccount.set(r.accountId, []);
    rulesByAccount.get(r.accountId).push(r);
  }
  const accountIds = [...rulesByAccount.keys()];

  const txns = await many(
    `SELECT t.id, t.account_id, t.amount, t.date, t.merchant_name, t.name,
            (e.id IS NOT NULL) AS already_logged
       FROM transactions t
       LEFT JOIN income_entries e ON e.transaction_id = t.id
      WHERE t.account_id = ANY($1)
        AND t.amount < 0
        AND t.date >= current_date - ($2 || ' days')::interval
      ORDER BY t.date`,
    [accountIds, lookbackDays],
  );

  const alreadyLogged = txns.filter((t) => t.already_logged).length;
  const candidates = txns.filter((t) => !t.already_logged);

  const toCreate = [];
  for (const txn of candidates) {
    const accountRules = rulesByAccount.get(txn.account_id) ?? [];
    for (const rule of accountRules) {
      if (matchesRule(rule, txn)) {
        toCreate.push({ txn, rule });
        break; // first matching rule wins, same as Finance-Tracker's own scan
      }
    }
  }

  let created = 0;
  let linked = 0;
  const entries = [];
  if (toCreate.length > 0) {
    await transaction(async (client) => {
      for (const { txn, rule } of toCreate) {
        const amountDollars = toDollars(Math.abs(toCents(txn.amount)));
        const notes = `Matched rule "${rule.name}": ${txn.merchant_name || txn.name}`;

        // First, try to claim a real pre-existing untracked entry for this exact source/date/
        // amount rather than assume none exists -- see this function's own header.
        const linkResult = await client.query(
          `UPDATE income_entries
              SET transaction_id = $1, notes = COALESCE(notes, $2)
            WHERE source_id = $3 AND date = $4 AND amount = $5 AND transaction_id IS NULL
            RETURNING id, source_id, date, amount, notes, transaction_id`,
          [txn.id, notes, rule.sourceId, txn.date, amountDollars],
        );
        if (linkResult.rows[0]) {
          linked += 1;
          entries.push(linkResult.rows[0]);
          continue;
        }

        const insertResult = await client.query(
          `INSERT INTO income_entries (source_id, date, amount, notes, transaction_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
           RETURNING id, source_id, date, amount, notes, transaction_id`,
          [rule.sourceId, txn.date, amountDollars, notes, txn.id],
        );
        if (insertResult.rows[0]) {
          created += 1;
          entries.push(insertResult.rows[0]);
        }
        // A conflict here means a concurrent scan already claimed this exact transaction --
        // real dedupe doing its job, not an error.
      }
    });
  }

  return {
    scannedAccounts: accountIds.length,
    transactionsScanned: txns.length,
    matched: toCreate.length,
    created,
    linked,
    alreadyLogged,
    entries: entries.map((e) => ({
      id: e.id,
      sourceId: e.source_id,
      date: e.date,
      amount: toDollars(toCents(e.amount)),
      notes: e.notes,
      transactionId: e.transaction_id,
    })),
    warnings: [],
  };
}
