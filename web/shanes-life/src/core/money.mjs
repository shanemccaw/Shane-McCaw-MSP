// The real money data-access layer (Git #3137).
//
// #3107 already unified the database: this app and ShanesSurvival's WPF app read and write the
// SAME real Postgres. So there is nothing to import, copy or sync here -- `accounts`, `debts`,
// `income_sources` and `expected_one_time_events` are ShanesSurvival's own real tables, and this
// module reads them directly.
//
// What it does add is the math, ported from the real, proven logic in
//   desktop/ShanesSurvival/src/ShanesSurvival.Core/Dashboard/DashboardService.cs
// rather than reinvented, because the two surfaces showing different numbers for the same
// balances would be worse than either of them being wrong on its own. The port is deliberately
// literal, including the parts that look like they could be tidied away:
//
//   * shortfall = max(0, target_amount - current_balance), per bill account.
//   * A bill missing a target OR a balance is EXCLUDED from the total and warned about -- never
//     silently treated as $0 (fully funded) or as fully unfunded. This is the most load-bearing
//     line in the C# and the easiest one to "clean up" into a lie.
//   * reserve_total = sum of role='reserve' balances, same exclusion+warning convention.
//     role='emergency_fund' is NOT a reserve -- DashboardService counts only 'reserve', and
//     matching it matters more than whether that is the ideal model.
//   * total_available = Income Gate balance + reserve_total.
//   * top line ("available to spend") = total_available - total shortfall.
//   * isCovered = top line >= 0.
//   * With no Income Gate account, or a gate whose balance Plaid has not delivered yet,
//     total_available and the top line are NULL, not 0 -- "unknown" and "nothing" are different
//     answers and the C# is careful about it.
//
// Money is handled as integer cents everywhere inside this module. Postgres numeric arrives as a
// string precisely so it does not lose precision on the way in, and summing eleven float dollars
// would hand that straight back (0.1 + 0.2). C# uses `decimal` for the same reason.
//
// Nothing here writes to ShanesSurvival's tables, and simulateTransfer structurally cannot:
// Plaid is read-only and NFCU has no Transfer product, so a "transfer" is arithmetic on copies
// of real balances and nothing else.
//
// -- Git #3162 real architectural check: Finance-Tracker's bill envelope model does NOT
//    transfer here, and was deliberately not ported. Recorded so a future session doesn't
//    retry it blindly. ------------------------------------------------------------------
//
// `FINANCE_TRACKER_AUDIT.md` (shanemccaw/Finance-Tracker, read 2026-09-08) ranks the
// envelope model -- `bill.assigned` (this-cycle contribution, resets on "New Cycle") kept
// separate from `bill.envelopeBalance` (a persistent pocket), reassignment applying a DELTA
// rather than an overwrite -- as its single most reusable pattern. It solves a real problem
// there: Finance-Tracker has ONE pooled checking account and every bill is a virtual split of
// it, tracked entirely in a client-side JSONB blob, so the app itself has to be the ledger of
// "how much of that one balance is earmarked for what."
//
// That problem does not exist here. `accounts.role = 'bill'` rows (migration 003) are each a
// real, separate, Plaid-linked bank account -- confirmed by `accounts.plaid_item_id NOT NULL`
// (migration 001: every account row requires a real Plaid item, there is no manual/virtual
// account) and by the contract pack's own real correction, confirmed the same day this issue
// was worked (`web/shanes-life/docs/shanes-life-design-contract-pack.md`, commit e6e7a2841):
// "Moving money from Direct Deposit into separate real bill/category accounts is literally
// envelope-style budgeting -- that mechanism is the real system, not a side effect of it."
// The envelope split already happens, for real, at the bank -- Shane moves real dollars
// between real NFCU sub-accounts, and Plaid sync (not this module) is what keeps
// `current_balance` current. There is nothing left for a shadow ledger to do except disagree
// with the real balance it would be shadowing, which is exactly the failure this module's own
// header above exists to prevent (two surfaces, two different numbers).
//
// Two more confirmations this is a real architectural mismatch, not just an unbuilt feature:
//   * `migrations/011_bill_last_paid_date.sql`'s own comment is explicit that `last_paid_date`
//     is "informational only... does not touch the existing bill_status/gate_status shortfall
//     math, which stays keyed off target_amount vs. current_balance" -- i.e. ShanesSurvival
//     already made this same call for the one place a Finance-Tracker-style ledger write
//     (`toggleBillPaid` debiting `envelopeBalance`) could have landed, and chose not to.
//   * There is no "New Cycle" reset anywhere in this app's model, and none is needed: a real
//     bank balance is never zeroed by the app, so there is nothing analogous to
//     `bill.assigned` resetting each cycle for a delta to be computed against.
// Bill/account mutations (target_amount, last_paid_date, role) are ShanesSurvival's own MCP
// tools' job (`desktop/ShanesSurvival/src/ShanesSurvival.Mcp/Tools/FinanceTools.cs`), not
// this module's -- another reason a parallel envelope-assignment mutation does not belong here.
//
// Scope 2 of #3162 asked the same honest question of the `persist()`/`latestStateRef` stale-
// closure fix (Finance-Tracker's #2-ranked pattern) and the answer is the same "no, and here is
// the real evidence": this app's whole frontend (`web/shanes-life/public/*.js`) has no
// debounced client-side autosave, no `AsyncStorage`-style local cache, and no optimistic
// update of a client-held blob to go stale in the first place -- confirmed by grepping the
// entire `public/` tree for `debounce`/`localStorage`/`AsyncStorage` (money.mjs's own routes
// are the only ones money-related, and every one of them is a plain `fetch` via the shared
// `api()` helper in `app.js`, request in, JSON response out, nothing cached client-side
// between calls). Server-authoritative, exactly as this issue suspected. If Shane's Life's
// client ever grows real local optimistic state for Money, re-read
// `FINANCE_TRACKER_AUDIT.md` section 5 item 2 before inventing a fix from scratch.
//
// Scope 3 (Plaid webhooks) is real and still open -- neither app has one today, and this repo
// is the one with a real internet-reachable server to receive them (ShanesSurvival is a
// desktop app with no public endpoint). It is a genuinely large, separate feature (signature
// verification, item-health classification, reconnect-flow wiring), so per this issue's own
// text it was filed as its own follow-up Feature rather than squeezed in here: #3185.

import { many, one } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";
import * as lists from "./lists.mjs";
import * as prices from "./prices.mjs";

/** Roles as ShanesSurvival's own migrations 003/006/008 define them. */
const ROLE_INCOME_GATE = "income_gate";
const ROLE_BILL = "bill";
const ROLE_RESERVE = "reserve";

// ---------------------------------------------------------------------------
// cents helpers
// ---------------------------------------------------------------------------

/** Postgres numeric (a string) or null -> integer cents or null. Never returns NaN: a value that
 *  does not parse is treated as absent, which routes it into the warn-and-exclude path rather
 *  than poisoning a sum. */
export function toCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Integer cents -> a real Number of dollars, for JSON. */
export function toDollars(cents) {
  return cents === null || cents === undefined ? null : Math.round(cents) / 100;
}

/** Cents -> "$1,230.22" / "-$5,239.69", matching the design's own `money()` output. */
export function formatMoney(cents) {
  if (cents === null || cents === undefined) return null;
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${whole}.${frac}`;
}

/** A real dollar amount from an untrusted caller (HTTP body / MCP arg) -> integer cents. */
export function parseAmountCents(value, label = "amount", { allowNegative = false } = {}) {
  if (value === null || value === undefined || value === "") {
    throw badRequest(`${label} is required`);
  }
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) throw badRequest(`${label} must be a number of dollars`);
  if (!allowNegative && n < 0) throw badRequest(`${label} must not be negative`);
  if (Math.abs(n) > 100_000_000) throw badRequest(`${label} is out of range`);
  return Math.round(n * 100);
}

// ---------------------------------------------------------------------------
// real reads
// ---------------------------------------------------------------------------

/**
 * Real accounts for one role, in the same order DashboardService loads them (ORDER BY name), so
 * "which account is the Income Gate when more than one carries the role" resolves identically in
 * both apps.
 */
export async function loadRoleAccounts(role) {
  return many(
    `SELECT id, name, current_balance, target_amount, is_gate, due_day, last_paid_date
       FROM accounts
      WHERE role = $1
      ORDER BY name`,
    [role],
  );
}

/** Every real habit for a user -- the model the "really" line subtracts (migration 026). */
export async function listHabits(userId, { includeInactive = false } = {}) {
  return many(
    `SELECT id, name, amount_per_cycle, unit_label, unit_cost, log_source, is_active, note, updated_at
       FROM money_habits
      WHERE user_id = $1 ${includeInactive ? "" : "AND is_active"}
      ORDER BY is_active DESC, amount_per_cycle DESC, name`,
    [userId],
  );
}

/**
 * Upsert one real habit model. Additive in the same sense as setFoodPreferences: an omitted field
 * keeps its current value rather than clearing it, so "cigarettes are more like $160 now" does
 * not wipe the unit price stated a month earlier.
 */
export async function setHabit(
  userId,
  { name, amountPerCycle, unitLabel, unitCost, logSource, isActive, note } = {},
) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw badRequest("name is required");
  if (trimmed.length > 120) throw badRequest("name is too long");
  if (
    amountPerCycle === undefined &&
    unitLabel === undefined &&
    unitCost === undefined &&
    logSource === undefined &&
    isActive === undefined &&
    note === undefined
  ) {
    throw badRequest(
      "nothing to set: pass at least one of amountPerCycle, unitLabel, unitCost, logSource, isActive, note",
    );
  }

  const existing = await one(
    `SELECT id, amount_per_cycle, unit_label, unit_cost, log_source, is_active, note
       FROM money_habits WHERE user_id = $1 AND lower(name) = lower($2)`,
    [userId, trimmed],
  );
  if (!existing && amountPerCycle === undefined) {
    throw badRequest("amountPerCycle is required when a habit is first stated");
  }

  const amountCents =
    amountPerCycle === undefined
      ? toCents(existing.amount_per_cycle)
      : parseAmountCents(amountPerCycle, "amountPerCycle");
  const unitCostCents =
    unitCost === undefined
      ? existing
        ? toCents(existing.unit_cost)
        : null
      : unitCost === null
        ? null
        : parseAmountCents(unitCost, "unitCost");

  const keep = (incoming, current) => (incoming === undefined ? current : incoming);

  return one(
    `INSERT INTO money_habits (user_id, name, amount_per_cycle, unit_label, unit_cost, log_source, is_active, note, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (user_id, lower(name)) DO UPDATE
        SET amount_per_cycle = EXCLUDED.amount_per_cycle,
            unit_label       = EXCLUDED.unit_label,
            unit_cost        = EXCLUDED.unit_cost,
            log_source       = EXCLUDED.log_source,
            is_active        = EXCLUDED.is_active,
            note             = EXCLUDED.note,
            updated_at       = now()
     RETURNING id, name, amount_per_cycle, unit_label, unit_cost, log_source, is_active, note, updated_at`,
    [
      userId,
      trimmed,
      toDollars(amountCents),
      keep(unitLabel, existing ? existing.unit_label : null),
      toDollars(unitCostCents),
      keep(logSource, existing ? existing.log_source : null),
      keep(isActive, existing ? existing.is_active : true),
      keep(note, existing ? existing.note : null),
    ],
  );
}

// ---------------------------------------------------------------------------
// the math -- a literal port of DashboardService.ComputeAsync
// ---------------------------------------------------------------------------

/**
 * Pure. Takes already-loaded real rows and returns the gate arithmetic in cents. Split out from
 * the loading so whatIf and simulateTransfer can re-run it over MUTATED COPIES of the same real
 * balances without a second round trip -- and so it is testable without a database.
 */
export function computeGateMath({ gateAccounts, billAccounts, reserveAccounts }) {
  const warnings = [];

  // -- Income Gate --------------------------------------------------------
  let gateBalance = null;
  let gateName = null;
  if (gateAccounts.length === 0) {
    warnings.push(
      "No account assigned the Income Gate role yet — assign one in ShanesSurvival's \"Assign Account Roles…\".",
    );
  } else {
    if (gateAccounts.length > 1) {
      warnings.push(
        `${gateAccounts.length} accounts are assigned Income Gate — using "${gateAccounts[0].name}". ` +
          "Only one should carry this role.",
      );
    }
    gateName = gateAccounts[0].name;
    gateBalance = toCents(gateAccounts[0].current_balance);
    if (gateBalance === null) {
      warnings.push(`"${gateAccounts[0].name}" has no real balance from Plaid yet — run a sync.`);
    }
  }

  // -- bills --------------------------------------------------------------
  const bills = billAccounts.map((account) => {
    const target = toCents(account.target_amount);
    const balance = toCents(account.current_balance);
    let warning = null;
    let shortfall = null;
    if (target === null) warning = "target not set";
    else if (balance === null) warning = "balance unknown — Sync Now";
    else shortfall = Math.max(0, target - balance);

    return {
      id: account.id,
      name: account.name,
      targetCents: target,
      balanceCents: balance,
      isGate: Boolean(account.is_gate),
      dueDay: account.due_day ?? null,
      lastPaidDate: account.last_paid_date ?? null,
      shortfallCents: shortfall,
      funded: shortfall === null ? null : shortfall === 0,
      warning,
    };
  });

  for (const bill of bills) {
    if (bill.warning) warnings.push(`"${bill.name}": ${bill.warning} — excluded from total shortfall.`);
  }

  const totalShortfall = bills.reduce((sum, b) => sum + (b.shortfallCents ?? 0), 0);

  // -- reserves -----------------------------------------------------------
  const reserves = reserveAccounts.map((account) => ({
    id: account.id,
    name: account.name,
    balanceCents: toCents(account.current_balance),
  }));
  for (const reserve of reserves) {
    if (reserve.balanceCents === null) {
      warnings.push(
        `"${reserve.name}" has no real balance from Plaid yet — run a sync. Excluded from reserve total.`,
      );
    }
  }
  const reserveTotal = reserves.reduce((sum, r) => sum + (r.balanceCents ?? 0), 0);

  // -- the two lines everything else hangs off -----------------------------
  const totalAvailable = gateBalance === null ? null : gateBalance + reserveTotal;
  const topLine = totalAvailable === null ? null : totalAvailable - totalShortfall;

  // Same ordering DashboardService applies: gate bills first, each sorted by shortfall desc,
  // with an unknown shortfall sorting last (it uses -1 for exactly this).
  const byShortfallDesc = (a, b) => (b.shortfallCents ?? -1) - (a.shortfallCents ?? -1);
  const gateBills = bills.filter((b) => b.isGate).sort(byShortfallDesc);
  const otherBills = bills.filter((b) => !b.isGate).sort(byShortfallDesc);

  // "$X spoken for - Tesla, Electric, Yard" -- the design's own unfunded list, biggest first.
  const unfunded = bills.filter((b) => b.shortfallCents !== null && b.shortfallCents > 0).sort(byShortfallDesc);

  return {
    warnings,
    gateName,
    gateBalanceCents: gateBalance,
    bills,
    gateBills,
    otherBills,
    unfunded,
    totalShortfallCents: totalShortfall,
    reserves,
    reserveTotalCents: reserveTotal,
    totalAvailableCents: totalAvailable,
    topLineCents: topLine,
    isCovered: topLine === null ? null : topLine >= 0,
  };
}

/** Load every real account this math needs, in one place, so a simulation and a live read can
 *  never disagree about what "the accounts" are. Exported for wins.mjs's automatic-trigger
 *  detection (Git #3151), which needs the same real bill shortfalls without a second query. */
export async function loadMoneyAccounts() {
  const [gateAccounts, billAccounts, reserveAccounts] = await Promise.all([
    loadRoleAccounts(ROLE_INCOME_GATE),
    loadRoleAccounts(ROLE_BILL),
    loadRoleAccounts(ROLE_RESERVE),
  ]);
  return { gateAccounts, billAccounts, reserveAccounts };
}

// ---------------------------------------------------------------------------
// Accounts view (Git #3170) -- every real account, sectioned by role, with Plaid connection
// health. Ported from Finance-Tracker's `app/(tabs)/accounts.tsx` (FINANCE_TRACKER_AUDIT.md §1)
// in shape only: sectioned list + % funded badge + masked last-4 + Plaid-linked badge +
// "N underfunded" + Total Envelope Balance + Connected Banks. NOT ported: Finance-Tracker's
// own Plaid Link/exchange flow (this app already has real accounts synced by ShanesSurvival;
// linking a NEW bank is that app's job, not this UI's) and the bill-envelope ledger (money.mjs's
// own header above already covers why that model doesn't transfer here).
//
// Real, deliberate scope line drawn at "Disconnect"/"Reconnect": this module's own header states
// plainly that nothing here writes to ShanesSurvival's tables, and #3162 recorded that
// account/bill mutations are ShanesSurvival's own MCP tools' job, not this module's. A live
// Plaid item disconnect/reconnect is exactly that kind of mutation (and a real external Plaid
// API call besides) -- it is #3168's job ("Feature: Plaid webhooks + reconnect/update-mode flow"),
// the sibling Feature #3170's own issue text says this ties into. So Connected Banks here is a
// real, honest READ of `plaid_items.health_status`/`last_synced_at` -- same idiom the Cars/Vault/
// Wins tabs used before they were their own real Features: showing the real reconnect-needed
// state now, saying plainly that the reconnect action itself isn't wired here yet, rather than
// faking a button that does nothing.

const ACCOUNT_ROLE_SECTIONS = [
  { role: ROLE_INCOME_GATE, label: "Income Gate" },
  { role: ROLE_BILL, label: "Bills" },
  { role: "reserve", label: "Reserves" },
  { role: "emergency_fund", label: "Emergency Fund" },
  { role: "spend", label: "Spending" },
  { role: null, label: "Uncategorized" },
];

/** Plaid's own real health values (migration 041) that mean "the real bank connection needs
 *  Shane's attention" -- everything else (ok, pending_disconnect, revoked, error) either needs
 *  no action from here or is already past the point a reconnect banner would help. */
const RECONNECT_NEEDED_HEALTH = new Set(["login_required", "pending_expiration"]);

function accountBalanceStatus({ role, targetCents, balanceCents, shortfallCents }) {
  if (role !== ROLE_BILL) return null; // % funded / underfunded is a bill concept only.
  if (targetCents === null || balanceCents === null) return null; // unknown, not short.
  if (shortfallCents === 0) return "funded";
  // A gate bill going unfunded is more urgent than a non-gate one -- same red/amber split
  // already used for Protected vs. Urgent on the Now tab.
  return "short";
}

/**
 * Every real account, sectioned by role, plus Total Envelope Balance and Connected Banks.
 * One query, one real read -- no separate round trip per section.
 */
export async function getAccountsOverview(userId) {
  const rows = await many(
    `SELECT a.id, a.name, a.role, a.current_balance, a.target_amount, a.is_gate, a.due_day,
            a.mask, a.plaid_item_id,
            pi.institution_name, pi.health_status, pi.last_synced_at
       FROM accounts a
       JOIN plaid_items pi ON pi.id = a.plaid_item_id
      ORDER BY a.name`,
  );

  const warnings = [];
  let totalEnvelopeCents = 0;
  let totalEnvelopeKnown = false;

  const accountsById = new Map();
  for (const row of rows) {
    const balanceCents = toCents(row.current_balance);
    const targetCents = toCents(row.target_amount);
    const shortfallCents =
      row.role === ROLE_BILL && targetCents !== null && balanceCents !== null
        ? Math.max(0, targetCents - balanceCents)
        : null;

    if (balanceCents === null) {
      warnings.push(`"${row.name}" has no real balance from Plaid yet -- run a sync.`);
    } else {
      totalEnvelopeCents += balanceCents;
      totalEnvelopeKnown = true;
    }

    const account = {
      id: row.id,
      name: row.name,
      role: row.role,
      isGate: Boolean(row.is_gate),
      dueDay: row.due_day ?? null,
      balanceCents,
      balanceFormatted: formatMoney(balanceCents),
      targetCents,
      targetFormatted: formatMoney(targetCents),
      shortfallCents,
      shortfallFormatted: shortfallCents === null ? null : formatMoney(shortfallCents),
      funded: shortfallCents === null ? null : shortfallCents === 0,
      masked: row.mask ? `•••• ${row.mask}` : null,
      institutionName: row.institution_name,
      plaidHealthStatus: row.health_status,
      reconnectRequired: RECONNECT_NEEDED_HEALTH.has(row.health_status),
      status: null,
    };
    account.status = accountBalanceStatus({
      role: account.role,
      targetCents: account.targetCents,
      balanceCents: account.balanceCents,
      shortfallCents: account.shortfallCents,
    });
    accountsById.set(account.id, account);
  }

  const accounts = [...accountsById.values()];

  const sections = ACCOUNT_ROLE_SECTIONS.map(({ role, label }) => {
    const sectionAccounts = accounts.filter((a) => a.role === role);
    if (sectionAccounts.length === 0) return null;

    const funded = sectionAccounts.filter((a) => a.funded === true).length;
    const underfunded = sectionAccounts.filter((a) => a.funded === false).length;
    const known = funded + underfunded;

    return {
      role,
      label,
      accounts: sectionAccounts,
      underfundedCount: underfunded,
      fundedPercent: known === 0 ? null : Math.round((funded / known) * 100),
    };
  }).filter(Boolean);

  // Real per-institution Connected Banks card -- one row per plaid_items row actually in use,
  // not every plaid_items row ever created (an item with zero remaining accounts is not "connected"
  // from this screen's point of view).
  const byInstitution = new Map();
  for (const row of rows) {
    if (!byInstitution.has(row.plaid_item_id)) {
      byInstitution.set(row.plaid_item_id, {
        id: row.plaid_item_id,
        institutionName: row.institution_name,
        healthStatus: row.health_status,
        lastSyncedAt: row.last_synced_at,
        reconnectRequired: RECONNECT_NEEDED_HEALTH.has(row.health_status),
        accountCount: 0,
      });
    }
    byInstitution.get(row.plaid_item_id).accountCount += 1;
  }
  const connectedBanks = [...byInstitution.values()].sort((a, b) =>
    a.institutionName.localeCompare(b.institutionName),
  );

  return {
    sections,
    totalEnvelopeCents: totalEnvelopeKnown ? totalEnvelopeCents : null,
    totalEnvelopeFormatted: totalEnvelopeKnown ? formatMoney(totalEnvelopeCents) : null,
    connectedBanks,
    warnings,
  };
}

/**
 * A pure, real-time preview of what a NEW target amount would mean for one bill account --
 * "short by $X, needs funds from [the Income Gate]" -- computed the instant Shane types a
 * number, same idiom as whatIf()/simulateTransfer(). This NEVER writes `target_amount`:
 * per this module's own header, account/bill mutations are ShanesSurvival's own MCP tools' job
 * (`FinanceTools.cs`), not this one's. The real save action, when Shane wants one, goes through
 * that tool, not this endpoint -- this is the live warning the design asks for, not the write.
 */
export async function previewAccountTarget(accountId, hypotheticalTargetDollars) {
  const hypotheticalCents = parseAmountCents(hypotheticalTargetDollars, "target");
  const account = await one(
    `SELECT id, name, role, current_balance FROM accounts WHERE id = $1`,
    [accountId],
  );
  if (!account) throw badRequest("No account with that id.");
  if (account.role !== ROLE_BILL) {
    throw badRequest(`"${account.name}" is not a bill account -- it has no funding target.`);
  }

  const balanceCents = toCents(account.current_balance);
  if (balanceCents === null) {
    return {
      accountId,
      accountName: account.name,
      answerable: false,
      text: `"${account.name}" has no real balance from Plaid yet -- run a sync.`,
    };
  }

  const shortfallCents = Math.max(0, hypotheticalCents - balanceCents);
  const gateAccounts = await loadRoleAccounts(ROLE_INCOME_GATE);
  const gateName = gateAccounts[0]?.name ?? null;

  return {
    accountId,
    accountName: account.name,
    answerable: true,
    hypotheticalTarget: toDollars(hypotheticalCents),
    balance: toDollars(balanceCents),
    shortfall: toDollars(shortfallCents),
    funded: shortfallCents === 0,
    text:
      shortfallCents === 0
        ? `Fully funded at ${formatMoney(hypotheticalCents)}.`
        : `Short ${formatMoney(shortfallCents)}${gateName ? ` — needs funds from ${gateName}` : ""}.`,
  };
}

// ---------------------------------------------------------------------------
// Budget Day
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/**
 * A `date` column comes back from pg as a LOCAL-midnight Date (2026-09-11 arrives as
 * 2026-09-11T04:00:00Z in EDT); rebuild it as the same calendar day at UTC midnight so day
 * arithmetic can never be knocked sideways by a timezone offset.
 *
 * Call this exactly once per value. Feeding an already-normalised UTC-midnight Date back through
 * it reads the LOCAL getters of a UTC midnight and walks the date back a day west of Greenwich --
 * which is precisely how a real Sep 11 payday first rendered here as "Thu, Sep 10".
 */
function asUtcDate(value) {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  }
  const d = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** An already-normalised UTC-midnight Date -> "YYYY-MM-DD". Never re-normalises. */
function utcIso(utcDate) {
  return utcDate.toISOString().slice(0, 10);
}

/** A raw database date value -> "YYYY-MM-DD", normalising exactly once. */
function isoDate(value) {
  return utcIso(asUtcDate(value));
}

/** "Fri, Sep 18" -- the design's own payLine format, computed from a real date. */
function formatPayDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    date.getUTCMonth()
  ];
  return `${day}, ${month} ${date.getUTCDate()}`;
}

/**
 * "Budget Day = `income_sources.next_pay_date`, every `pay_frequency_days` (14)."
 *
 * next_pay_date is a stored real date that only moves when a pay period is actually planned, so
 * it can be in the past. Rolling it forward by whole cycles here is what stops the card claiming
 * a payday that already happened -- without writing to ShanesSurvival's own row, which is its to
 * own. A source with a stale date and no usable cycle length cannot be rolled at all, and says so
 * (`stale: true`) rather than being quietly dropped or shown as if it were today.
 *
 * `asOf` is a real Date -- the SERVER's, never the client's, same rule as the critter roll.
 */
export function computeBudgetDay(sources, asOf = new Date()) {
  const active = sources.filter((s) => s.is_active !== false && s.next_pay_date);
  if (active.length === 0) return null;

  const today = new Date(Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()));

  const upcoming = active
    .map((source) => {
      const anchor = asUtcDate(source.next_pay_date);
      const cycleRaw = Number(source.pay_frequency_days);
      const cycle = Number.isFinite(cycleRaw) && cycleRaw > 0 ? cycleRaw : null;

      let next = anchor;
      let rolled = 0;
      if (next < today && cycle) {
        const cyclesBehind = Math.ceil((today - next) / (cycle * MS_PER_DAY));
        next = new Date(next.getTime() + cyclesBehind * cycle * MS_PER_DAY);
        rolled = cyclesBehind;
      }

      const daysAway = Math.round((next - today) / MS_PER_DAY);
      return {
        id: source.id,
        name: source.name,
        person: source.person ?? null,
        payFrequencyDays: cycle,
        expectedPerCycle: toDollars(toCents(source.expected_per_cycle)),
        storedNextPayDate: utcIso(anchor),
        nextPayDate: utcIso(next),
        daysAway,
        isToday: daysAway === 0,
        // A real signal that ShanesSurvival has not planned a pay period in a while, not a
        // display detail -- and the only honest answer when the date is behind and uncyclable.
        rolledForwardCycles: rolled,
        stale: next < today || rolled > 0,
      };
    })
    .sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name));

  const next = upcoming[0];
  return {
    ...next,
    // "next check Fri, Sep 18 - 12 days"
    line:
      next.daysAway < 0
        ? `last check ${formatPayDate(next.nextPayDate)} · ${-next.daysAway} ${next.daysAway === -1 ? "day" : "days"} ago`
        : `next check ${formatPayDate(next.nextPayDate)} · ${next.daysAway} ${next.daysAway === 1 ? "day" : "days"}`,
    sources: upcoming,
  };
}

/** Days in a given UTC year/month (0-indexed month), for rolling a day-of-month `due_day`
 *  forward across a short month without landing on a date that does not exist (Feb 30). */
function daysInUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** The next real occurrence of a `due_day` (1-31) on or after `today`, clamped to the length of
 *  whatever month it lands in -- a due_day of 31 falls on the 28th/29th/30th in a shorter month,
 *  same convention ShanesSurvival's own due-day accounts already use. Returns null for accounts
 *  with no due_day set (nothing to roll). */
function nextDueDate(dueDay, today) {
  if (!dueDay) return null;
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  let candidate = new Date(Date.UTC(year, month, Math.min(dueDay, daysInUtcMonth(year, month))));
  if (candidate < today) {
    const nextMonth = month + 1;
    candidate = new Date(
      Date.UTC(
        year + Math.floor(nextMonth / 12),
        nextMonth % 12,
        Math.min(dueDay, daysInUtcMonth(year + Math.floor(nextMonth / 12), nextMonth % 12)),
      ),
    );
  }
  return candidate;
}

/**
 * Real due-versus-available math for Budget Day: which real bills come due BEFORE the next real
 * paycheck lands, and how much of each is still unfunded. Distinct from `totalShortfallCents`
 * (every bill, whenever it's due) -- this is specifically "what has to be covered before more
 * income arrives," the real question Budget Day exists to answer. A bill with no `due_day` set
 * cannot be dated, so it is left out of this list (still counted in the overall total shortfall
 * elsewhere) rather than guessed into a bucket it was never assigned to.
 */
export function computeDueBeforeNextCheck(bills, nextPayDateIso, asOf = new Date()) {
  if (!nextPayDateIso) return { bills: [], totalCents: 0, coveredByLanding: null };
  const today = new Date(Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()));
  const nextPayDate = asUtcDate(nextPayDateIso);

  const due = bills
    .filter((b) => b.dueDay != null)
    .map((b) => ({ ...b, dueDate: nextDueDate(b.dueDay, today) }))
    .filter((b) => b.dueDate && b.dueDate < nextPayDate)
    .sort((a, b) => a.dueDate - b.dueDate || (b.shortfallCents ?? 0) - (a.shortfallCents ?? 0));

  const totalCents = due.reduce((sum, b) => sum + (b.shortfallCents ?? 0), 0);

  return {
    bills: due.map((b) => ({
      id: b.id,
      name: b.name,
      dueDate: utcIso(b.dueDate),
      amount: toDollars(b.shortfallCents),
      amountFormatted: formatMoney(b.shortfallCents),
      warning: b.warning,
    })),
    totalCents,
    total: toDollars(totalCents),
    totalFormatted: formatMoney(totalCents),
  };
}

/**
 * The real "extreme couponing" surfacing (contract pack Section 3): given the real running
 * Shopping list, what does this week's real weekly-ad cross-store data (#3110, core/prices.mjs)
 * say about where those items are cheapest right now, plus any matching coupons -- pointed at
 * Budget Day's specific paycheck rather than a generic "some deals exist" notice. Reuses the
 * SAME weekly-ad verdict Shopping's own list view decorates onto items
 * (`prices.attachWeeklyAdVerdicts`) -- no separate couponing engine, no AI inference of its own.
 * An empty or all-done list, or a week with nothing pushed yet, is a real "nothing to report"
 * state, not an error.
 */
export async function getBudgetDayCouponing(userId) {
  const list = await lists.getOrCreateShoppingList(userId);
  const detail = await lists.getListDetail(userId, list.id);
  const openItems = detail.items.filter((i) => !i.done).map((i) => ({ text: i.text }));

  if (openItems.length === 0) {
    return { listId: list.id, itemCount: 0, matchedCount: 0, storeWins: [], couponMatches: 0, estimatedSavings: 0, estimatedSavingsFormatted: null, text: null };
  }

  await prices.attachLatestPrices(userId, openItems);
  await prices.attachWeeklyAdVerdicts(userId, openItems);

  const storeWinCounts = new Map();
  let couponMatches = 0;
  let savingsCents = 0;
  let matchedCount = 0;

  for (const item of openItems) {
    const verdict = item.weeklyAdVerdict;
    if (!verdict) continue;
    matchedCount += 1;
    if (verdict.store) storeWinCounts.set(verdict.store, (storeWinCounts.get(verdict.store) ?? 0) + 1);
    if (verdict.coupon) {
      couponMatches += 1;
      if (verdict.coupon.discountCents) savingsCents += verdict.coupon.discountCents;
    }
    if (verdict.priceCents != null && item.lastPrice?.priceCents != null && item.lastPrice.priceCents > verdict.priceCents) {
      savingsCents += item.lastPrice.priceCents - verdict.priceCents;
    }
  }

  const storeWins = [...storeWinCounts.entries()]
    .map(([store, count]) => ({ store, count }))
    .sort((a, b) => b.count - a.count || a.store.localeCompare(b.store));

  const text =
    matchedCount === 0
      ? null
      : [
          `Claude read this week's ads: ${storeWins.map((w) => `${w.store} wins ${w.count}`).join(", ")}.`,
          couponMatches > 0 ? `${couponMatches} coupon${couponMatches === 1 ? "" : "s"} match${couponMatches === 1 ? "es" : ""}.` : null,
          savingsCents > 0 ? `About ${formatMoney(savingsCents)} off the usual run.` : null,
        ]
          .filter(Boolean)
          .join(" ");

  return {
    listId: list.id,
    itemCount: openItems.length,
    matchedCount,
    storeWins,
    couponMatches,
    estimatedSavings: toDollars(savingsCents),
    estimatedSavingsFormatted: savingsCents > 0 ? formatMoney(savingsCents) : null,
    text,
  };
}

/**
 * Enriches a `computeBudgetDay` result with the real landed amount, the real due-versus-available
 * math (bills due before the next check lands), and the real extreme-couponing surfacing -- the
 * three things that turn "next check Fri, Sep 18" into an actual real Budget Day ritual (Git
 * #3152). `bills` is `computeGateMath`'s own bill rows so shortfall/dueDay agree with everything
 * else on the Money screen. Returns `null` unchanged when there is no real Budget Day yet (no
 * active income source) -- nothing to enrich.
 */
async function enrichBudgetDay(base, { userId, bills }) {
  if (!base) return null;
  const landedAmountCents = toCents(base.expectedPerCycle);
  const dueBeforeNextCheck = computeDueBeforeNextCheck(bills, base.nextPayDate);
  const couponing = await getBudgetDayCouponing(userId);

  return {
    ...base,
    landedAmount: base.expectedPerCycle,
    landedAmountFormatted: formatMoney(landedAmountCents),
    dueBeforeNextCheck,
    coveredByLanding:
      landedAmountCents === null ? null : landedAmountCents >= dueBeforeNextCheck.totalCents,
    couponing,
  };
}

/**
 * The real pay-cycle window smoke_log entries are bucketed into for the "this cycle" / "last
 * cycle" split (Git #3154) -- the same real cycle Budget Day above and the habit "really" line
 * are already denominated in (`income_sources.pay_frequency_days`), not a second, disagreeing
 * idea of a cycle. Derived from computeBudgetDay's own real earliest-upcoming-source pick rather
 * than duplicating that resolution.
 *
 * No active income source to derive a real cycle from -> falls back to a trailing 14-day window
 * (the one real pay_frequency_days value in this database today), flagged `approximate: true`
 * rather than silently presented as the authoritative cycle.
 */
function resolvePayCycleWindow(sources, asOf = new Date()) {
  const budgetDay = computeBudgetDay(sources, asOf);
  if (budgetDay && budgetDay.payFrequencyDays) {
    const cycleEnd = asUtcDate(budgetDay.nextPayDate);
    const cycleStart = new Date(cycleEnd.getTime() - budgetDay.payFrequencyDays * MS_PER_DAY);
    const previousCycleStart = new Date(cycleStart.getTime() - budgetDay.payFrequencyDays * MS_PER_DAY);
    return { cycleStart, cycleEnd, previousCycleStart, payFrequencyDays: budgetDay.payFrequencyDays, approximate: false };
  }
  const fallbackDays = 14;
  const today = new Date(Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()));
  const cycleEnd = new Date(today.getTime() + MS_PER_DAY); // exclusive upper bound; includes today
  const cycleStart = new Date(cycleEnd.getTime() - fallbackDays * MS_PER_DAY);
  const previousCycleStart = new Date(cycleStart.getTime() - fallbackDays * MS_PER_DAY);
  return { cycleStart, cycleEnd, previousCycleStart, payFrequencyDays: fallbackDays, approximate: true };
}

// ---------------------------------------------------------------------------
// the public surface
// ---------------------------------------------------------------------------

function billOut(bill) {
  return {
    id: bill.id,
    name: bill.name,
    target: toDollars(bill.targetCents),
    balance: toDollars(bill.balanceCents),
    shortfall: toDollars(bill.shortfallCents),
    funded: bill.funded,
    isGate: bill.isGate,
    dueDay: bill.dueDay,
    lastPaidDate: bill.lastPaidDate ? isoDate(bill.lastPaidDate) : null,
    warning: bill.warning,
  };
}

function habitTotalCents(habits) {
  return habits.reduce((sum, h) => sum + (toCents(h.amount_per_cycle) ?? 0), 0);
}

// ---------------------------------------------------------------------------
// the real smoking tracker (Git #3154) -- migration 017's smoke_log, unwired until now
// ---------------------------------------------------------------------------

/**
 * `smoked` / `bought a pack` -> +1 pack, in `smoke_log` (017). Priced from whichever active
 * habit points at this log (`money_habits.log_source = 'smoke_log'`, 027) via its own stated
 * `unit_cost` -- never a hardcoded dollar figure; the design's "$8.40" is that habit's own real
 * `unitCost`, stated once via `set_habit`, not a literal here.
 *
 * No such habit configured yet -> the pack still logs (a slip logged late is better than one
 * refused) at amount $0, with a warning -- the same warn-and-exclude convention
 * computeGateMath already uses for a bill with no target/balance, applied here to price instead.
 */
export async function logSmoke(userId, { packs } = {}) {
  const packCount = packs === undefined || packs === null ? 1 : Number(packs);
  if (!Number.isFinite(packCount) || packCount <= 0) {
    throw badRequest("packs must be a positive number");
  }

  const habit = await one(
    `SELECT unit_cost FROM money_habits
      WHERE user_id = $1 AND log_source = 'smoke_log' AND is_active AND unit_cost IS NOT NULL
      ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  );
  const unitCostCents = habit ? toCents(habit.unit_cost) : null;
  const amountCents = unitCostCents === null ? 0 : Math.round(unitCostCents * packCount);

  const row = await one(
    `INSERT INTO smoke_log (user_id, packs, amount)
     VALUES ($1, $2, $3)
     RETURNING id, logged_at, packs, amount`,
    [userId, packCount, toDollars(amountCents)],
  );

  return {
    id: row.id,
    loggedAt: row.logged_at,
    packs: Number(row.packs),
    amount: toDollars(toCents(row.amount)),
    warning:
      unitCostCents === null
        ? "No active habit with logSource 'smoke_log' has a unitCost set -- logged at $0. " +
          "Call set_habit with unitCost (e.g. 8.40) to price this and future entries."
        : null,
  };
}

/**
 * The design's own real financial-confrontation line (`Shanes Life - First Slice Prototype.dc.html`,
 * `smokeText`): "Still $X to fund this cycle. Last cycle, $Y went to cigarettes: N packs. This
 * cycle so far: N packs, $Z." Shown only while a real shortfall exists (Section 8's no-guilt
 * principle, deliberately overridden here per Shane's own confirmation in the design contract
 * pack's Section 3). `thisCycle`/`lastCycle` are bucketed by the real pay-cycle window
 * (`resolvePayCycleWindow`), not a calendar month, matching every other cycle-denominated number
 * on this screen.
 */
export async function getSmokeSummary(userId, { asOf = new Date(), sources = null, shortfallCents = null } = {}) {
  const incomeSources =
    sources ??
    (await many(
      `SELECT id, name, person, pay_frequency_days, expected_per_cycle, next_pay_date, is_active
         FROM income_sources WHERE is_active`,
    ));
  const window = resolvePayCycleWindow(incomeSources, asOf);

  const rows = await many(
    `SELECT logged_at, packs, amount FROM smoke_log
      WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3
      ORDER BY logged_at`,
    [userId, window.previousCycleStart.toISOString(), window.cycleEnd.toISOString()],
  );

  const bucket = (from, to) =>
    rows.reduce(
      (acc, r) => {
        const at = new Date(r.logged_at);
        if (at < from || at >= to) return acc;
        return { packs: acc.packs + Number(r.packs), amountCents: acc.amountCents + (toCents(r.amount) ?? 0) };
      },
      { packs: 0, amountCents: 0 },
    );

  const thisCycle = bucket(window.cycleStart, window.cycleEnd);
  const lastCycle = bucket(window.previousCycleStart, window.cycleStart);
  const show = shortfallCents !== null && shortfallCents > 0;
  const packWord = (n) => (n === 1 ? "pack" : "packs");

  return {
    cycleStart: utcIso(window.cycleStart),
    cycleEnd: utcIso(window.cycleEnd),
    approximateCycle: window.approximate,
    thisCycle: { packs: thisCycle.packs, spent: toDollars(thisCycle.amountCents) },
    lastCycle: { packs: lastCycle.packs, spent: toDollars(lastCycle.amountCents) },
    show,
    text: show
      ? `Still ${formatMoney(shortfallCents)} to fund this cycle. Last cycle, ${formatMoney(lastCycle.amountCents)} ` +
        `went to cigarettes: ${lastCycle.packs} ${packWord(lastCycle.packs)}. This cycle so far: ` +
        `${thisCycle.packs} ${packWord(thisCycle.packs)}, ${formatMoney(thisCycle.amountCents)}.`
      : null,
  };
}

/**
 * The real gate status: everything the Money "Now" and "Bills" tabs are drawn from, plus the
 * habit model, Budget Day, and the critical debts the design's "Protected" section shows in red.
 */
export async function getGateStatus(userId, { asOf = new Date() } = {}) {
  const [accounts, habits, incomeSources, criticalDebts, events] = await Promise.all([
    loadMoneyAccounts(),
    listHabits(userId),
    many(
      `SELECT id, name, person, pay_frequency_days, expected_per_cycle, next_pay_date, is_active
         FROM income_sources WHERE is_active ORDER BY next_pay_date NULLS LAST, name`,
    ),
    many(
      `SELECT id, creditor_name, balance, minimum_payment, is_critical, is_delinquent, days_past_due, notes
         FROM debts WHERE is_critical ORDER BY balance DESC NULLS LAST`,
    ),
    // "One-time pending events (+$6,000 roof reimbursement, -$2,500 deductible) not counted until
    // real" -- returned alongside the math, deliberately never folded into it.
    many(
      `SELECT id, description, direction, amount, status, expected_date, contingency_notes
         FROM expected_one_time_events
        WHERE realized_at IS NULL
        ORDER BY expected_date NULLS LAST, description`,
    ),
  ]);

  const math = computeGateMath(accounts);
  const habitCents = habitTotalCents(habits);
  const reallyCents = math.topLineCents === null ? null : math.topLineCents - habitCents;
  const smoking = await getSmokeSummary(userId, {
    asOf,
    sources: incomeSources,
    shortfallCents: math.totalShortfallCents,
  });

  // "the one bar": amber fill = shortfall / available, red at 100% when short.
  const spokenForPercent =
    math.totalAvailableCents === null
      ? null
      : math.isCovered
        ? Math.min(100, Math.round((math.totalShortfallCents / Math.max(1, math.totalAvailableCents)) * 100))
        : 100;

  return {
    asOf: asOf.toISOString(),
    gate: { name: math.gateName, balance: toDollars(math.gateBalanceCents) },
    reserves: math.reserves.map((r) => ({ id: r.id, name: r.name, balance: toDollars(r.balanceCents) })),
    reserveTotal: toDollars(math.reserveTotalCents),
    totalAvailable: toDollars(math.totalAvailableCents),
    totalShortfall: toDollars(math.totalShortfallCents),
    // The 40px number on the screen.
    availableToSpend: toDollars(math.topLineCents),
    availableToSpendFormatted: formatMoney(math.topLineCents),
    isCovered: math.isCovered,
    spokenForPercent,
    unfundedNames: math.unfunded.map((b) => b.name),
    bills: math.bills.map(billOut),
    gateBills: math.gateBills.map(billOut),
    otherBills: math.otherBills.map(billOut),
    habit: {
      totalPerCycle: toDollars(habitCents),
      really: toDollars(reallyCents),
      // Only a real, stated habit produces a line. No habit stated -> no line, rather than a line
      // reading "$0.00 a cycle" about a habit nobody has.
      line:
        habitCents > 0 && reallyCents !== null
          ? `${habits.map((h) => h.name).join(", ")} usually run ${formatMoney(habitCents)} a cycle. ` +
            `Counting that: ${formatMoney(reallyCents)} really.`
          : null,
      habits: habits.map((h) => ({
        id: h.id,
        name: h.name,
        amountPerCycle: toDollars(toCents(h.amount_per_cycle)),
        unitLabel: h.unit_label,
        unitCost: toDollars(toCents(h.unit_cost)),
        logSource: h.log_source,
        note: h.note,
      })),
    },
    // Git #3154: "Cigarettes, in plain numbers", shown only while `smoking.show` is true.
    smoking,
    budgetDay: await enrichBudgetDay(computeBudgetDay(incomeSources, asOf), { userId, bills: math.bills }),
    protectedDebts: criticalDebts.map((d) => ({
      id: d.id,
      creditor: d.creditor_name,
      balance: toDollars(toCents(d.balance)),
      minimumPayment: toDollars(toCents(d.minimum_payment)),
      isDelinquent: d.is_delinquent,
      daysPastDue: d.days_past_due,
      notes: d.notes,
    })),
    // Not counted until real -- the design says so in as many words.
    pendingEvents: events.map((e) => ({
      id: e.id,
      description: e.description,
      direction: e.direction,
      amount: toDollars(toCents(e.amount)),
      status: e.status,
      expectedDate: e.expected_date ? isoDate(e.expected_date) : null,
      contingencyNotes: e.contingency_notes,
      countedInMath: false,
    })),
    warnings: math.warnings,
  };
}

/**
 * "What if I spend 60."  top - habit - amount. Negative names the largest-shortfall account as
 * the first thing to go unfunded, exactly as the prototype's own whatIf() does.
 */
export async function whatIf(userId, amountDollars) {
  const amountCents = parseAmountCents(amountDollars, "amount");
  const [accounts, habits] = await Promise.all([loadMoneyAccounts(), listHabits(userId)]);
  const math = computeGateMath(accounts);

  if (math.topLineCents === null) {
    return {
      amount: toDollars(amountCents),
      answerable: false,
      text: "Cannot answer that yet — there is no real Income Gate balance to spend from.",
      warnings: math.warnings,
    };
  }

  const habitCents = habitTotalCents(habits);
  const leftCents = math.topLineCents - habitCents - amountCents;
  const first = math.unfunded[0] ?? null;
  const habitNames = habits.map((h) => h.name.toLowerCase()).join(", ");

  const text =
    leftCents >= 0
      ? `Still covered. ${formatMoney(leftCents)} left${habitNames ? ` after the usual ${habitNames}` : ""}. ` +
        "Everything funded stays funded."
      : `Short ${formatMoney(-leftCents)}. ` +
        (first ? `${first.name} would be the first thing left unfunded.` : "Something has to give.");

  return {
    amount: toDollars(amountCents),
    answerable: true,
    headline: `If you spend ${formatMoney(amountCents)}`,
    availableToSpend: toDollars(math.topLineCents),
    habitPerCycle: toDollars(habitCents),
    left: toDollars(leftCents),
    stillCovered: leftCents >= 0,
    firstUnfunded: first
      ? { id: first.id, name: first.name, shortfall: toDollars(first.shortfallCents) }
      : null,
    text,
    warnings: math.warnings,
  };
}

/**
 * Resolve a name Shane actually said ("Tesla", "direct deposit") to a real account.
 *
 * The prototype hardcodes a `/direct|deposit|gate|checking|nfcu/` regex for the gate side and
 * first-word prefix matching for bills. That works against seven fixture bills; against the real
 * ones it does not -- "H1 Electric" and "H2 Electric" share no useful first word, and the real
 * gate account is named "DirectDeposit", not "Direct Deposit". So this matches against the real
 * loaded rows instead: exact, then prefix, then substring, across gate + bill + reserve accounts.
 * An ambiguous match is reported as ambiguous rather than silently resolved to whichever row
 * sorted first -- naming the wrong account in a borrowed-from-bill warning is worse than asking
 * which one.
 */
export function resolveAccount(name, pools) {
  const needle = String(name ?? "").trim().toLowerCase();
  if (!needle) return { status: "missing" };

  const candidates = [];
  for (const [kind, rows] of Object.entries(pools)) {
    for (const row of rows) candidates.push({ kind, row });
  }

  const tiers = [
    candidates.filter((c) => c.row.name.toLowerCase() === needle),
    candidates.filter((c) => c.row.name.toLowerCase().startsWith(needle)),
    candidates.filter((c) => c.row.name.toLowerCase().includes(needle)),
    // Last resort: ignore spacing, so "direct deposit" still finds "DirectDeposit".
    candidates.filter((c) => c.row.name.toLowerCase().replace(/\s+/g, "").includes(needle.replace(/\s+/g, ""))),
  ];
  for (const tier of tiers) {
    if (tier.length === 1) return { status: "ok", ...tier[0] };
    if (tier.length > 1) return { status: "ambiguous", matches: tier.map((c) => c.row.name) };
  }

  return { status: "unknown" };
}

/**
 * "Move 200 from Direct Deposit to Tesla."
 *
 * NEVER EXECUTES. Plaid is read-only and NFCU has no Transfer product, both confirmed before this
 * was built -- so this applies the move to COPIES of the real balances, recomputes the same math,
 * and reports what changes. The footer the design puts under the result box says exactly this out
 * loud: "Never moves money. Do it at NFCU, then it syncs."
 */
export async function simulateTransfer(userId, { amount, from, to }) {
  const amountCents = parseAmountCents(amount, "amount");
  if (amountCents === 0) throw badRequest("amount must be more than zero");
  const accounts = await loadMoneyAccounts();

  const pools = {
    gate: accounts.gateAccounts,
    bill: accounts.billAccounts,
    reserve: accounts.reserveAccounts,
  };
  const source = resolveAccount(from, pools);
  const destination = resolveAccount(to, pools);

  const problem = (side, result, raw) => {
    if (result.status === "missing") return `${side} account is required.`;
    if (result.status === "unknown") return `There is no account called "${String(raw ?? "").trim()}".`;
    if (result.status === "ambiguous") {
      return `"${String(raw ?? "").trim()}" matches ${result.matches.join(", ")} — say which one.`;
    }
    return null;
  };
  const fromProblem = problem("Source", source, from);
  const toProblem = problem("Destination", destination, to);
  if (fromProblem || toProblem) {
    return { executed: false, resolvable: false, text: [fromProblem, toProblem].filter(Boolean).join(" ") };
  }
  if (source.row.id === destination.row.id) {
    return {
      executed: false,
      resolvable: false,
      text: `"${source.row.name}" is both sides of that move — nothing would change.`,
    };
  }

  // Copies. The real rows are never touched.
  const clone = (rows) => rows.map((r) => ({ ...r }));
  const simulated = {
    gateAccounts: clone(accounts.gateAccounts),
    billAccounts: clone(accounts.billAccounts),
    reserveAccounts: clone(accounts.reserveAccounts),
  };
  const findCopy = (id) =>
    [...simulated.gateAccounts, ...simulated.billAccounts, ...simulated.reserveAccounts].find((r) => r.id === id);

  const sourceCopy = findCopy(source.row.id);
  const destCopy = findCopy(destination.row.id);
  const sourceBalance = toCents(sourceCopy.current_balance);
  const destBalance = toCents(destCopy.current_balance);
  if (sourceBalance === null || destBalance === null) {
    const blind = sourceBalance === null ? sourceCopy.name : destCopy.name;
    return {
      executed: false,
      resolvable: false,
      text: `No real balance from Plaid yet for "${blind}" — a move cannot be simulated against an unknown balance.`,
    };
  }
  sourceCopy.current_balance = toDollars(sourceBalance - amountCents);
  destCopy.current_balance = toDollars(destBalance + amountCents);

  const before = computeGateMath(accounts);
  const after = computeGateMath(simulated);

  const destAfter = after.bills.find((b) => b.id === destination.row.id) ?? null;
  const parts = [];
  if (destAfter && destAfter.shortfallCents !== null) {
    const over = destAfter.balanceCents - destAfter.targetCents;
    parts.push(
      destAfter.shortfallCents === 0
        ? `${destAfter.name} funded${over > 0 ? `, ${formatMoney(over)} over its target` : ""}`
        : `${destAfter.name} still short ${formatMoney(destAfter.shortfallCents)}`,
    );
  } else {
    parts.push(`${destCopy.name} goes to ${formatMoney(destBalance + amountCents)}`);
  }
  parts.push(
    after.topLineCents === null
      ? "available to spend stays unknown"
      : `available to spend becomes ${formatMoney(after.topLineCents)}`,
  );
  const others = after.unfunded.filter((b) => b.id !== destination.row.id);
  parts.push(
    others.length
      ? `${others.map((b) => b.name).join(" and ")} still short ` +
          `${formatMoney(others.reduce((sum, b) => sum + b.shortfallCents, 0))}`
      : "nothing else goes unfunded",
  );

  // Borrowed-from-bill: the source is money already spoken for by a real bill.
  const borrowed =
    source.kind === "bill"
      ? `That pulls from ${source.row.name}'s own bill money. Borrowed-from-bill, so it gets flagged.`
      : null;
  const sourceAfter = after.bills.find((b) => b.id === source.row.id) ?? null;

  const sentence = parts.join(" · ");
  return {
    // Structural, not a flag: nothing in this module can move money.
    executed: false,
    resolvable: true,
    amount: toDollars(amountCents),
    from: {
      id: source.row.id,
      name: source.row.name,
      kind: source.kind,
      balanceAfter: toDollars(sourceBalance - amountCents),
    },
    to: {
      id: destination.row.id,
      name: destination.row.name,
      kind: destination.kind,
      balanceAfter: toDollars(destBalance + amountCents),
    },
    headline: `Move ${formatMoney(amountCents)} from ${source.row.name} to ${destination.row.name}`,
    text: sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".",
    borrowedFromBill: borrowed,
    before: {
      availableToSpend: toDollars(before.topLineCents),
      totalShortfall: toDollars(before.totalShortfallCents),
    },
    after: {
      availableToSpend: toDollars(after.topLineCents),
      totalShortfall: toDollars(after.totalShortfallCents),
      sourceShortfall: sourceAfter ? toDollars(sourceAfter.shortfallCents) : null,
      destinationShortfall: destAfter ? toDollars(destAfter.shortfallCents) : null,
    },
    footer: "Never moves money. Do it at NFCU, then it syncs.",
    warnings: after.warnings,
  };
}

// ---------------------------------------------------------------------------
// bill due-date + Tax Levy notifications (Git #3161)
// ---------------------------------------------------------------------------

/** Real reuse, not a duplicate tracker (contract Section 3): a bill's due date is already
 *  `accounts.due_day` -- this surfaces the SAME real data as a due-soon nudge instead of keeping
 *  a second due-date store. Three days' notice is enough to check `getGateStatus`/`whatIf` and
 *  move money before the date lands -- shorter than the 21-day `renewal` lead time (dates.mjs)
 *  because a bill recurs monthly, not annually; a month's worth of advance notice would mean it
 *  is almost always "due soon." */
const BILL_LEAD_DAYS = 3;

/** A debt with its own real `due_day` (today, only the $242/month Tax Levy installment --
 *  migration 037) gets more lead time than a routine bill: Section 3 calls this one out by name
 *  as "high-stakes enough to warrant its own real, distinct nudge." */
const DEBT_LEAD_DAYS = 5;

/** `dueDay` (1-31) resolved against `today` -> `{ dueDate, daysAway }` when that real occurrence
 *  falls within `leadDays`, else null. Reuses the same `nextDueDate` month-end clamping Budget
 *  Day's own due-before-next-check math already relies on. */
function dueSoon(dueDay, today, leadDays) {
  const due = nextDueDate(dueDay, today);
  if (!due) return null;
  const daysAway = Math.round((due - today) / MS_PER_DAY);
  return daysAway >= 0 && daysAway <= leadDays ? { dueDate: utcIso(due), daysAway } : null;
}

/**
 * Real bills (`accounts.role='bill'`) whose real due date falls within the lead window and have
 * not already had a `kind: 'bill'` reminder queued today -- same day-scoped dedup convention as
 * `dates.findDueDayBeforeReminders` / `pets.findDueVaccineReminders`: re-fires daily while the
 * window stays open (a bill that's still short deserves the next day's nudge too), and a new
 * month's occurrence naturally produces a different `dueDate` once the old one passes.
 */
export async function findDueBillReminders(userId, { asOf = new Date() } = {}) {
  const today = new Date(Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()));
  const bills = await loadRoleAccounts(ROLE_BILL);

  const candidates = [];
  for (const b of bills) {
    if (!b.due_day) continue;
    const soon = dueSoon(b.due_day, today, BILL_LEAD_DAYS);
    if (!soon) continue;
    const target = toCents(b.target_amount);
    const balance = toCents(b.current_balance);
    // Same warn-and-exclude convention as computeGateMath: an unknown balance still reports the
    // real target owed (better than no number at all), just not a computed shortfall.
    const amountCents = target === null ? null : balance === null ? target : Math.max(0, target - balance);
    candidates.push({ id: b.id, name: b.name, dueDate: soon.dueDate, daysAway: soon.daysAway, amountCents });
  }
  if (candidates.length === 0) return [];

  const already = await many(
    `SELECT payload->>'accountId' AS account_id FROM nudge_events
      WHERE user_id = $1 AND kind = 'bill' AND day = current_date`,
    [userId],
  );
  const seen = new Set(already.map((r) => r.account_id));
  return candidates.filter((c) => !seen.has(c.id));
}

/**
 * Real debts (`debts.due_day`) whose due date falls within their own, longer lead window --
 * today, only the real $242/month Tax Levy installment (Treasury Offset Program, migration 037).
 * A genuinely separate kind (`'debt_due'`) from bill reminders, and a genuinely separate table
 * (ShanesSurvival's `debts`, not `accounts`) -- Section 3's "own real, distinct nudge... not
 * lumped anonymously into the general bill list" without this needing to name any creditor
 * specially: any debt that gets a real due_day is distinct by construction.
 */
export async function findDueDebtReminders(userId, { asOf = new Date() } = {}) {
  const today = new Date(Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()));
  const debts = await many(
    `SELECT id, creditor_name, balance, minimum_payment, due_day FROM debts WHERE due_day IS NOT NULL`,
  );

  const candidates = [];
  for (const d of debts) {
    const soon = dueSoon(d.due_day, today, DEBT_LEAD_DAYS);
    if (!soon) continue;
    candidates.push({
      id: d.id,
      name: d.creditor_name,
      dueDate: soon.dueDate,
      daysAway: soon.daysAway,
      amountCents: toCents(d.minimum_payment),
    });
  }
  if (candidates.length === 0) return [];

  const already = await many(
    `SELECT payload->>'debtId' AS debt_id FROM nudge_events
      WHERE user_id = $1 AND kind = 'debt_due' AND day = current_date`,
    [userId],
  );
  const seen = new Set(already.map((r) => r.debt_id));
  return candidates.filter((c) => !seen.has(c.id));
}

/** Budget Day on its own, for the tray card that does not need the whole gate. */
export async function getBudgetDay(userId, { asOf = new Date() } = {}) {
  const [sources, accounts] = await Promise.all([
    many(
      `SELECT id, name, person, pay_frequency_days, expected_per_cycle, next_pay_date, is_active
         FROM income_sources WHERE is_active ORDER BY next_pay_date NULLS LAST, name`,
    ),
    loadMoneyAccounts(),
  ]);
  const base = computeBudgetDay(sources, asOf);
  return enrichBudgetDay(base, { userId, bills: computeGateMath(accounts).bills });
}

// ---------------------------------------------------------------------------
// Bankruptcy/debt tracker (Git #3163) -- a real overlay on ShanesSurvival's own `debts` table
// ---------------------------------------------------------------------------
//
// Ported from Finance-Tracker's `BankruptcyItem` (FinanceContext.tsx:160-169, 1087-1112) --
// fully modeled and CRUD'd there, but FINANCE_TRACKER_AUDIT.md's own §6 calls it a "dead
// sub-feature": no screen ever read `finance.bankruptcyItems` or called a mutator. Confirmed by
// Shane directly: genuinely wanted, just never got surfaced.
//
// Real, investigated decision (also independently on record in
// docs/shanes-life-design-contract-pack.md Section 12): ShanesSurvival's own `debts` table
// already carries the real bankruptcy-relevant debts (H1 Mortgage arrears, the Treasury
// Offset/IRS installment), both already `is_critical`. This overlays Finance-Tracker's fields
// (`debt_type`, `original_balance`/`current_balance` payoff tracking, `last_payment_date`) plus
// an explicit `included_in_bankruptcy` flag onto that SAME table (migration 041) -- not a second,
// disconnected list. `creditor`/`currentBalance`/`notes` already existed as `creditor_name`/
// `balance`/`notes`; only the genuinely new fields were added.

function debtOut(d) {
  return {
    id: d.id,
    creditor: d.creditor_name,
    balance: toDollars(toCents(d.balance)),
    minimumPayment: toDollars(toCents(d.minimum_payment)),
    isDelinquent: d.is_delinquent,
    daysPastDue: d.days_past_due,
    isCritical: d.is_critical,
    dueDay: d.due_day,
    debtType: d.debt_type,
    originalBalance: toDollars(toCents(d.original_balance)),
    lastPaymentDate: d.last_payment_date ? isoDate(d.last_payment_date) : null,
    includedInBankruptcy: d.included_in_bankruptcy,
    notes: d.notes,
    updatedAt: d.updated_at,
  };
}

const DEBT_COLUMNS = `id, creditor_name, balance, minimum_payment, is_delinquent, days_past_due, is_critical,
       due_day, debt_type, original_balance, last_payment_date, included_in_bankruptcy, notes, updated_at`;

/** Every real debt, bankruptcy-filing ones first -- the Bankruptcy tab's own real list. */
export async function listDebts() {
  const rows = await many(
    `SELECT ${DEBT_COLUMNS} FROM debts
      ORDER BY included_in_bankruptcy DESC, is_critical DESC, balance DESC NULLS LAST`,
  );
  return rows.map(debtOut);
}

export async function getDebt(id) {
  const row = await one(`SELECT ${DEBT_COLUMNS} FROM debts WHERE id = $1`, [id]);
  if (!row) throw notFound("Debt not found");
  return debtOut(row);
}

/** Add a real debt row. Every field beyond creditor/balance is optional -- most debts in this
 *  table (Git #3161's due_day work included) started with only a subset known. */
export async function createDebt({
  creditor,
  balance,
  minimumPayment = null,
  isDelinquent = false,
  daysPastDue = 0,
  isCritical = false,
  dueDay = null,
  debtType = null,
  originalBalance = null,
  lastPaymentDate = null,
  includedInBankruptcy = false,
  notes = null,
} = {}) {
  const trimmedCreditor = String(creditor ?? "").trim();
  if (!trimmedCreditor) throw badRequest("creditor is required");
  const balanceCents = parseAmountCents(balance, "balance");
  const minimumPaymentCents = minimumPayment === null || minimumPayment === "" ? null : parseAmountCents(minimumPayment, "minimumPayment");
  const originalBalanceCents = originalBalance === null || originalBalance === "" ? null : parseAmountCents(originalBalance, "originalBalance");
  if (dueDay !== null && (!Number.isInteger(Number(dueDay)) || dueDay < 1 || dueDay > 31)) {
    throw badRequest("dueDay must be an integer between 1 and 31");
  }

  const row = await one(
    `INSERT INTO debts (creditor_name, balance, minimum_payment, is_delinquent, days_past_due, is_critical,
                         due_day, debt_type, original_balance, last_payment_date, included_in_bankruptcy, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${DEBT_COLUMNS}`,
    [
      trimmedCreditor,
      toDollars(balanceCents),
      minimumPaymentCents === null ? null : toDollars(minimumPaymentCents),
      Boolean(isDelinquent),
      Number(daysPastDue) || 0,
      Boolean(isCritical),
      dueDay,
      debtType ? String(debtType).trim() : null,
      originalBalanceCents === null ? null : toDollars(originalBalanceCents),
      lastPaymentDate,
      Boolean(includedInBankruptcy),
      notes ? String(notes) : null,
    ],
  );
  return debtOut(row);
}

/** Partial update -- only the fields present in `updates` are touched, same idiom as
 *  updateBankruptcyItem's `Partial<BankruptcyItem>` in Finance-Tracker. */
export async function updateDebt(id, updates = {}) {
  const existing = await one(`SELECT ${DEBT_COLUMNS} FROM debts WHERE id = $1`, [id]);
  if (!existing) throw notFound("Debt not found");

  const sets = [];
  const values = [];
  let i = 1;

  const put = (column, value) => {
    sets.push(`${column} = $${i++}`);
    values.push(value);
  };

  if ("creditor" in updates) {
    const trimmed = String(updates.creditor ?? "").trim();
    if (!trimmed) throw badRequest("creditor must not be empty");
    put("creditor_name", trimmed);
  }
  if ("balance" in updates) put("balance", toDollars(parseAmountCents(updates.balance, "balance")));
  if ("minimumPayment" in updates) {
    put("minimum_payment", updates.minimumPayment === null || updates.minimumPayment === "" ? null : toDollars(parseAmountCents(updates.minimumPayment, "minimumPayment")));
  }
  if ("isDelinquent" in updates) put("is_delinquent", Boolean(updates.isDelinquent));
  if ("daysPastDue" in updates) put("days_past_due", Number(updates.daysPastDue) || 0);
  if ("isCritical" in updates) put("is_critical", Boolean(updates.isCritical));
  if ("dueDay" in updates) {
    const d = updates.dueDay;
    if (d !== null && (!Number.isInteger(Number(d)) || d < 1 || d > 31)) throw badRequest("dueDay must be an integer between 1 and 31");
    put("due_day", d);
  }
  if ("debtType" in updates) put("debt_type", updates.debtType ? String(updates.debtType).trim() : null);
  if ("originalBalance" in updates) {
    put("original_balance", updates.originalBalance === null || updates.originalBalance === "" ? null : toDollars(parseAmountCents(updates.originalBalance, "originalBalance")));
  }
  if ("lastPaymentDate" in updates) put("last_payment_date", updates.lastPaymentDate);
  if ("includedInBankruptcy" in updates) put("included_in_bankruptcy", Boolean(updates.includedInBankruptcy));
  if ("notes" in updates) put("notes", updates.notes ? String(updates.notes) : null);

  if (sets.length === 0) return debtOut(existing);

  sets.push(`updated_at = now()`);
  values.push(id);
  const row = await one(`UPDATE debts SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${DEBT_COLUMNS}`, values);
  return debtOut(row);
}

export async function deleteDebt(id) {
  const row = await one(`DELETE FROM debts WHERE id = $1 RETURNING id`, [id]);
  if (!row) throw notFound("Debt not found");
  return { id: row.id };
}
