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

import { many, one } from "../db.mjs";
import { badRequest } from "../http.mjs";

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
 *  never disagree about what "the accounts" are. */
async function loadMoneyAccounts() {
  const [gateAccounts, billAccounts, reserveAccounts] = await Promise.all([
    loadRoleAccounts(ROLE_INCOME_GATE),
    loadRoleAccounts(ROLE_BILL),
    loadRoleAccounts(ROLE_RESERVE),
  ]);
  return { gateAccounts, billAccounts, reserveAccounts };
}

// ---------------------------------------------------------------------------
// Budget Day
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** A `date` column comes back as a local-midnight Date; rebuild it as a UTC calendar date so day
 *  arithmetic can never be knocked sideways by a timezone offset. */
function asUtcDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function isoDate(value) {
  return asUtcDate(value).toISOString().slice(0, 10);
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
        storedNextPayDate: isoDate(anchor),
        nextPayDate: isoDate(next),
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
    budgetDay: computeBudgetDay(incomeSources, asOf),
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

/** Budget Day on its own, for the tray card that does not need the whole gate. */
export async function getBudgetDay(asOf = new Date()) {
  const sources = await many(
    `SELECT id, name, person, pay_frequency_days, expected_per_cycle, next_pay_date, is_active
       FROM income_sources WHERE is_active ORDER BY next_pay_date NULLS LAST, name`,
  );
  return computeBudgetDay(sources, asOf);
}
