// Money -> Cars (Git #3149, design contract pack Section 3: "real per-vehicle financial
// tracking... so a real question like 'is this car actually worth keeping given what it
// costs' has a real, aggregated answer instead of scattered numbers across different bills").
//
// `vehicles` (identity, loan_bill_id, insurance_amount, registration_due/amount,
// maintenance_interval_miles, next_maintenance_on/note) already exists -- migration 017
// (Git #3107) created it, though nothing had read or written it until now.
// `vehicle_maintenance_log` (031) is new: real maintenance spend history, without which the
// "real, aggregated all-in $/mo" the card promises would either omit maintenance or invent a
// number for it.
//
// The all-in total mirrors 017's own comment: "computed from the linked real bill account plus
// insurance and amortised registration, never stored as a literal." Concretely:
//   loan payment/mo  = the linked accounts.target_amount (0 if no loan_bill_id) -- the real
//                       monthly bill amount Money already tracks for this loan, through the
//                       same account row get_gate_status reads. Loan BALANCE (what's still owed)
//                       is reported alongside it read-only, straight off the same account.
//   insurance/mo     = vehicles.insurance_amount, stated directly (not amortised -- it is
//                       already a per-cycle figure, same convention as money_habits).
//   registration/mo  = vehicles.registration_amount / 12 -- amortised, because it is a lump due
//                       once a year, not a monthly bill.
//   maintenance/mo   = the trailing-12-month real spend from vehicle_maintenance_log / 12 --
//                       amortised the same way, and genuinely $0 (not unknown) when nothing has
//                       been logged yet, since "no maintenance logged" is a real, honest answer.
// $/yr is each of those *12 (the loan and insurance components already are monthly; annualising
// them is not "the same as $/mo *12" by coincidence -- summing the real annual components and
// summing the real monthly components and multiplying by 12 land on the same number precisely
// because none of the four components has its own irregular within-year cadence).
//
// Registration and maintenance reminders reuse Dates' own real lead-time vocabulary
// (dates.mjs's LEAD_DAYS_BY_KIND) rather than inventing a second table of numbers -- registration
// is exactly the 'renewal' kind dates.mjs already prices at 21 days' lead; maintenance has no
// named kind of its own, so it gets dates.mjs's own fallback for a genuinely novel kind (7 days),
// imported as the same constant, not retyped. What is NOT reused is dates.mjs's day-interval
// rolling (nextOccurrence): maintenance_interval_miles is a MILEAGE interval, and next_maintenance
// _on/note (017) stay a directly-stated date, same as a birthday or a visit.
//
// Git #3217 (migration 060) closes the "no real odometer feed" half of that gap: a vehicle
// marked tesla_synced gets a real, periodically-synced current_mileage off Tesla's own
// vehicle_state.odometer (core/tesla.mjs's getVehicleState). This does NOT replace
// next_maintenance_on as the calendar reminder -- there is still no honest way to project a
// future CALENDAR date from an odometer reading without a real trip-history/driving-rate feed
// this app doesn't have. What it does add is a real, live "how many of the interval's miles are
// already used up" figure, and a real "overdue by mileage" fact once that figure passes zero --
// both computed only from numbers that are either directly Tesla-sourced or Shane-stated
// (maintenance_interval_miles, a logged entry's own mileage), never a guessed rate of travel.
//
// Real charging-session sync (also #3217, same migration) is a separate concern from mileage --
// see syncChargingSessionsFromTesla below and tesla.mjs's getChargingHistory for the real,
// investigated limitation on cost (Tesla's API exposes no cost field to a personal developer
// account; cost_estimate_cents is always Shane's own rate x real kWh, never Tesla's own number).

import { many, one, query } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";
import { toCents, toDollars, formatMoney } from "./money.mjs";
import { LEAD_DAYS_BY_KIND } from "./dates.mjs";
import * as teslaCore from "./tesla.mjs";
import { TeslaError } from "./tesla.mjs";

const REGISTRATION_LEAD_DAYS = LEAD_DAYS_BY_KIND.renewal; // 21 -- a car's registration IS a renewal.
const MAINTENANCE_LEAD_DAYS = 7; // dates.mjs's own fallback for an on-the-fly kind with no table entry.

const MS_PER_DAY = 86_400_000;

/** A `date` column back from pg, or an ISO string -> local-midnight-safe "YYYY-MM-DD". */
function isoDate(value) {
  if (!value) return null;
  const s = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const d = new Date(value);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}

function daysUntil(dateStr, asOf) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  return Math.round((target - today) / MS_PER_DAY);
}

/** A reminder shape shared by registration and maintenance -- null when there is nothing to show. */
function reminder(dateStr, leadDays, asOf) {
  if (!dateStr) return null;
  const dueInDays = daysUntil(dateStr, asOf);
  return {
    on: dateStr,
    leadDays,
    dueInDays,
    dueSoon: dueInDays <= leadDays,
    overdue: dueInDays < 0,
  };
}

export async function getOwnedVehicle(userId, vehicleId) {
  return one("SELECT * FROM vehicles WHERE id = $1 AND user_id = $2", [vehicleId, userId]);
}

/** Trailing-12-month real spend for one vehicle, in cents. $0 (not null) when nothing is logged. */
async function maintenanceSpendCents(vehicleId, asOf) {
  const row = await one(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM vehicle_maintenance_log
      WHERE vehicle_id = $1 AND performed_on >= ($2::date - interval '365 days')`,
    [vehicleId, isoDate(asOf.toISOString())],
  );
  return toCents(row.total) ?? 0;
}

/** The single most recent real maintenance entry, or null when nothing has ever been logged --
 *  this is what drives both the client's "just now" sticker (a freshly-seen entry it hasn't
 *  shown before) and the "was $X before today's $Y" delta line below. */
async function latestMaintenanceEntry(vehicleId) {
  return one(
    `SELECT id, performed_on, description, amount, mileage, created_at
       FROM vehicle_maintenance_log
      WHERE vehicle_id = $1
      ORDER BY performed_on DESC, created_at DESC
      LIMIT 1`,
    [vehicleId],
  );
}

/**
 * The real, live "how much of the interval is used up" figure (Git #3217) -- only computed when
 * every real number it needs actually exists: a real synced odometer reading, a real interval
 * Shane set, and a real mileage on the most recent logged maintenance entry to measure from. Any
 * one of those missing means "unknown," not a guess -- there is deliberately no fallback that
 * assumes a starting mileage of 0 or invents a driving rate.
 */
function mileageStatus(vehicle, lastEntry) {
  if (!vehicle.tesla_synced || vehicle.current_mileage === null || vehicle.current_mileage === undefined) return null;
  if (!vehicle.maintenance_interval_miles) return null;
  const lastMileage = lastEntry?.mileage ?? null;
  if (lastMileage === null || vehicle.current_mileage < lastMileage) {
    // A last-logged mileage doesn't exist yet, or the synced reading is somehow behind it (a
    // stale sync racing a fresher manual log) -- either way there is no honest delta to report.
    return { currentMileage: vehicle.current_mileage, milesSinceLastService: null, milesUntilNextByMileage: null, overdueByMileage: false };
  }
  const milesSinceLastService = vehicle.current_mileage - lastMileage;
  const milesUntilNextByMileage = vehicle.maintenance_interval_miles - milesSinceLastService;
  return {
    currentMileage: vehicle.current_mileage,
    milesSinceLastService,
    milesUntilNextByMileage,
    overdueByMileage: milesUntilNextByMileage <= 0,
  };
}

/**
 * One real vehicle card's worth of numbers: identity, the linked loan bill account (read-only,
 * through the same `accounts` row get_gate_status uses), and the all-in $/mo and $/yr totals.
 */
async function buildCard(vehicle, asOf) {
  let loan = null;
  let loanMonthlyCents = 0;
  if (vehicle.loan_bill_id) {
    const account = await one(
      "SELECT id, name, current_balance, target_amount, due_day, role FROM accounts WHERE id = $1",
      [vehicle.loan_bill_id],
    );
    if (account) {
      const targetCents = toCents(account.target_amount);
      const balanceCents = toCents(account.current_balance);
      loanMonthlyCents = targetCents ?? 0;
      loan = {
        accountId: account.id,
        accountName: account.name,
        // "balance" here is Money's own bill-sinking-fund balance (what's saved toward the
        // payment), the same field get_gate_status reads -- not the loan's outstanding
        // principal, which this app has no real source for (ShanesSurvival tracks payoff
        // balances in `debts`, keyed by creditor name, not by account id).
        paymentDue: toDollars(targetCents),
        savedTowardPayment: toDollars(balanceCents),
        dueDay: account.due_day,
      };
    } else {
      // The FK is ON DELETE SET NULL, so this really can only mean the link is stale in a way
      // the database itself would have already cleared -- but a vehicle whose linked account
      // genuinely vanished should say so, not silently show $0.
      loan = { accountId: vehicle.loan_bill_id, missing: true };
    }
  }

  const insuranceMonthlyCents = toCents(vehicle.insurance_amount) ?? 0;
  const registrationAnnualCents = toCents(vehicle.registration_amount) ?? 0;
  const registrationMonthlyCents = Math.round(registrationAnnualCents / 12);
  const maintenanceAnnualCents = await maintenanceSpendCents(vehicle.id, asOf);
  const maintenanceMonthlyCents = Math.round(maintenanceAnnualCents / 12);

  const allInMonthlyCents = loanMonthlyCents + insuranceMonthlyCents + registrationMonthlyCents + maintenanceMonthlyCents;
  const allInYearlyCents =
    loanMonthlyCents * 12 + insuranceMonthlyCents * 12 + registrationAnnualCents + maintenanceAnnualCents;

  // Design 1f's "$41/mo, was $34 before today's $84" -- the real 12-month average recomputed
  // with the single most recent entry pulled back out, so the client can show the real delta
  // that one entry made. Only meaningful when that entry actually falls inside the trailing-12-
  // month window this card is already summing (it always will, being the newest); null entirely
  // when nothing has ever been logged.
  const lastEntry = await latestMaintenanceEntry(vehicle.id);
  const lastEntryAmountCents = lastEntry ? toCents(lastEntry.amount) ?? 0 : 0;
  const previousMaintenanceAnnualCents = lastEntry ? Math.max(0, maintenanceAnnualCents - lastEntryAmountCents) : null;
  const previousMaintenanceMonthlyCents = previousMaintenanceAnnualCents === null ? null : Math.round(previousMaintenanceAnnualCents / 12);

  return {
    id: vehicle.id,
    name: vehicle.name,
    position: vehicle.position,
    loan,
    insurance: { amountPerMonth: toDollars(insuranceMonthlyCents) },
    registration: {
      amountPerYear: toDollars(registrationAnnualCents),
      reminder: reminder(isoDate(vehicle.registration_due), REGISTRATION_LEAD_DAYS, asOf),
    },
    maintenance: {
      intervalMiles: vehicle.maintenance_interval_miles,
      spendLast12Months: toDollars(maintenanceAnnualCents),
      averagePerMonth: toDollars(maintenanceMonthlyCents),
      previousAveragePerMonth: previousMaintenanceMonthlyCents === null ? null : toDollars(previousMaintenanceMonthlyCents),
      next: vehicle.next_maintenance_on
        ? { ...reminder(isoDate(vehicle.next_maintenance_on), MAINTENANCE_LEAD_DAYS, asOf), note: vehicle.next_maintenance_note }
        : null,
      // Real, live mileage-based status (Git #3217) -- null entirely when this vehicle isn't
      // Tesla-synced or the numbers it needs aren't all real yet. See mileageStatus's own header.
      byMileage: mileageStatus(vehicle, lastEntry),
      lastEntry: lastEntry
        ? {
            id: lastEntry.id,
            performedOn: isoDate(lastEntry.performed_on),
            description: lastEntry.description,
            amount: toDollars(lastEntryAmountCents),
            mileage: lastEntry.mileage,
          }
        : null,
    },
    tesla: {
      synced: vehicle.tesla_synced,
      mileageSyncedAt: vehicle.mileage_synced_at,
    },
    allInPerMonth: toDollars(allInMonthlyCents),
    allInPerMonthFormatted: formatMoney(allInMonthlyCents),
    allInPerYear: toDollars(allInYearlyCents),
    allInPerYearFormatted: formatMoney(allInYearlyCents),
  };
}

/** The whole Cars tab: every real vehicle, ordered the way Shane arranged them. */
export async function listVehicles(userId, { asOf = new Date() } = {}) {
  const rows = await many("SELECT * FROM vehicles WHERE user_id = $1 ORDER BY position, name", [userId]);
  return Promise.all(rows.map((row) => buildCard(row, asOf)));
}

export async function getVehicle(userId, vehicleId, { asOf = new Date() } = {}) {
  const row = await getOwnedVehicle(userId, vehicleId);
  if (!row) throw notFound("Vehicle not found");
  const [card, log] = await Promise.all([
    buildCard(row, asOf),
    many(
      "SELECT id, performed_on, description, amount, mileage FROM vehicle_maintenance_log WHERE vehicle_id = $1 ORDER BY performed_on DESC, created_at DESC",
      [vehicleId],
    ),
  ]);
  return {
    ...card,
    maintenanceLog: log.map((l) => ({
      id: l.id,
      performedOn: isoDate(l.performed_on),
      description: l.description,
      amount: toDollars(toCents(l.amount)),
      mileage: l.mileage,
    })),
  };
}

function parseOptionalAmount(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw badRequest(`${label} must be a non-negative number of dollars`);
  return n;
}

export async function createVehicle(
  userId,
  { name, loanBillId = null, insuranceAmount = null, registrationDue = null, registrationAmount = null, maintenanceIntervalMiles = null } = {},
) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw badRequest("name is required");
  if (trimmed.length > 120) throw badRequest("name is too long");

  if (loanBillId) {
    const account = await one("SELECT id FROM accounts WHERE id = $1", [loanBillId]);
    if (!account) throw badRequest("loanBillId does not match a real account");
  }
  const insurance = parseOptionalAmount(insuranceAmount, "insuranceAmount");
  const registration = parseOptionalAmount(registrationAmount, "registrationAmount");
  if (maintenanceIntervalMiles !== null && maintenanceIntervalMiles !== undefined) {
    const n = Number(maintenanceIntervalMiles);
    if (!Number.isInteger(n) || n <= 0) throw badRequest("maintenanceIntervalMiles must be a positive integer");
    maintenanceIntervalMiles = n;
  } else {
    maintenanceIntervalMiles = null;
  }

  const positionRow = await one(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM vehicles WHERE user_id = $1",
    [userId],
  );
  const position = positionRow.next;

  const row = await one(
    `INSERT INTO vehicles (user_id, name, loan_bill_id, insurance_amount, registration_due, registration_amount, maintenance_interval_miles, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [userId, trimmed, loanBillId, insurance, registrationDue, registration, maintenanceIntervalMiles, position],
  );
  return getVehicle(userId, row.id);
}

const UPDATABLE = {
  name: (v) => {
    const trimmed = String(v ?? "").trim();
    if (!trimmed) throw badRequest("name cannot be blank");
    return trimmed.slice(0, 120);
  },
  loan_bill_id: async (v) => {
    if (v === null) return null;
    const account = await one("SELECT id FROM accounts WHERE id = $1", [v]);
    if (!account) throw badRequest("loanBillId does not match a real account");
    return v;
  },
  insurance_amount: (v) => parseOptionalAmount(v, "insuranceAmount"),
  registration_due: (v) => (v === null ? null : String(v).slice(0, 10)),
  registration_amount: (v) => parseOptionalAmount(v, "registrationAmount"),
  maintenance_interval_miles: (v) => {
    if (v === null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw badRequest("maintenanceIntervalMiles must be a positive integer");
    return n;
  },
  position: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw badRequest("position must be a non-negative integer");
    return n;
  },
};

export async function updateVehicle(userId, vehicleId, patch = {}) {
  const existing = await getOwnedVehicle(userId, vehicleId);
  if (!existing) throw notFound("Vehicle not found");

  const mapped = {
    name: patch.name,
    loan_bill_id: patch.loanBillId,
    insurance_amount: patch.insuranceAmount,
    registration_due: patch.registrationDue,
    registration_amount: patch.registrationAmount,
    maintenance_interval_miles: patch.maintenanceIntervalMiles,
    position: patch.position,
  };
  const sets = [];
  const params = [vehicleId, userId];
  for (const [column, value] of Object.entries(mapped)) {
    if (value === undefined) continue;
    const cleaned = await UPDATABLE[column](value);
    params.push(cleaned);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) throw badRequest("No updatable fields supplied");
  sets.push("updated_at = now()");

  await query(`UPDATE vehicles SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2`, params);
  return getVehicle(userId, vehicleId);
}

export async function deleteVehicle(userId, vehicleId) {
  const { rowCount } = await query("DELETE FROM vehicles WHERE id = $1 AND user_id = $2", [vehicleId, userId]);
  if (rowCount === 0) throw notFound("Vehicle not found");
}

/**
 * Log real maintenance that actually happened. Optionally restates next_maintenance_on/note in
 * the same call ("oil change done, next one around March" said in one breath) -- additive like
 * money.mjs's setHabit: omitted fields leave the existing next-due date alone rather than
 * clearing it.
 */
export async function logMaintenance(
  userId,
  vehicleId,
  { description, amount, performedOn = null, mileage = null, nextMaintenanceOn, nextMaintenanceNote } = {},
) {
  const vehicle = await getOwnedVehicle(userId, vehicleId);
  if (!vehicle) throw notFound("Vehicle not found");

  const trimmedDescription = String(description ?? "").trim();
  if (!trimmedDescription) throw badRequest("description is required");
  const amountValue = parseOptionalAmount(amount, "amount");
  if (amountValue === null) throw badRequest("amount is required");
  if (mileage !== null && mileage !== undefined) {
    const n = Number(mileage);
    if (!Number.isInteger(n) || n < 0) throw badRequest("mileage must be a non-negative integer");
    mileage = n;
  } else {
    mileage = null;
  }

  await one(
    `INSERT INTO vehicle_maintenance_log (vehicle_id, user_id, performed_on, description, amount, mileage)
     VALUES ($1, $2, COALESCE($3::date, current_date), $4, $5, $6)
     RETURNING id`,
    [vehicleId, userId, performedOn, trimmedDescription, amountValue, mileage],
  );

  if (nextMaintenanceOn !== undefined || nextMaintenanceNote !== undefined) {
    const sets = [];
    const params = [vehicleId, userId];
    if (nextMaintenanceOn !== undefined) {
      params.push(nextMaintenanceOn === null ? null : String(nextMaintenanceOn).slice(0, 10));
      sets.push(`next_maintenance_on = $${params.length}`);
    }
    if (nextMaintenanceNote !== undefined) {
      params.push(nextMaintenanceNote === null ? null : String(nextMaintenanceNote).trim().slice(0, 500));
      sets.push(`next_maintenance_note = $${params.length}`);
    }
    sets.push("updated_at = now()");
    await query(`UPDATE vehicles SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2`, params);
  }

  return getVehicle(userId, vehicleId);
}

/**
 * Real Undo (design 1f: "Logged $84.00 on the Kia Forte... Undo", five seconds to reverse it) --
 * removes exactly the one maintenance log row, scoped to both the vehicle and the user so a
 * stale/foreign id can't delete someone else's entry. Does not touch next_maintenance_on/note --
 * those were a separate, optional statement in the same logMaintenance call and undoing the cost
 * entry shouldn't silently un-set a due date that was true regardless.
 */
export async function deleteMaintenanceEntry(userId, vehicleId, entryId) {
  const vehicle = await getOwnedVehicle(userId, vehicleId);
  if (!vehicle) throw notFound("Vehicle not found");
  const { rowCount } = await query(
    "DELETE FROM vehicle_maintenance_log WHERE id = $1 AND vehicle_id = $2 AND user_id = $3",
    [entryId, vehicleId, userId],
  );
  if (rowCount === 0) throw notFound("Maintenance entry not found");
  return getVehicle(userId, vehicleId);
}

/**
 * Registration/maintenance reminders due within their real lead time, across every vehicle --
 * the same shape as findDueVaccineReminders/findDueDayBeforeReminders, for whichever room ends
 * up surfacing them in the notification tray.
 */
export async function findDueCarReminders(userId, { asOf = new Date() } = {}) {
  const vehicles = await many("SELECT * FROM vehicles WHERE user_id = $1", [userId]);
  const out = [];
  for (const v of vehicles) {
    const reg = reminder(isoDate(v.registration_due), REGISTRATION_LEAD_DAYS, asOf);
    if (reg && reg.dueSoon) {
      out.push({ vehicleId: v.id, vehicleName: v.name, kind: "registration", ...reg });
    }
    const maint = v.next_maintenance_on ? reminder(isoDate(v.next_maintenance_on), MAINTENANCE_LEAD_DAYS, asOf) : null;
    if (maint && maint.dueSoon) {
      out.push({ vehicleId: v.id, vehicleName: v.name, kind: "maintenance", note: v.next_maintenance_note, ...maint });
    }
    // Real, live mileage-overdue fact (Git #3217) -- distinct `kind` from the date-based
    // "maintenance" reminder above so a vehicle with both a stale next_maintenance_on AND real
    // odometer evidence of being overdue surfaces both real signals rather than one masking the
    // other. dueInDays has no real meaning here (this isn't a calendar countdown) -- 0 sorts it
    // alongside "due today" in the shared dueInDays-ascending order, which is an honest fit since
    // "overdue by mileage" is exactly as urgent as "due today," not less.
    const byMileage = mileageStatus(v, await latestMaintenanceEntry(v.id));
    if (byMileage?.overdueByMileage) {
      out.push({
        vehicleId: v.id,
        vehicleName: v.name,
        kind: "maintenance_mileage",
        dueInDays: 0,
        overdue: true,
        dueSoon: true,
        milesSinceLastService: byMileage.milesSinceLastService,
        intervalMiles: v.maintenance_interval_miles,
      });
    }
  }
  return out.sort((a, b) => a.dueInDays - b.dueInDays);
}

/**
 * Real, explicit "this Money vehicle IS the connected Tesla" link (Git #3217) -- a dedicated
 * setter rather than folding tesla_synced into the generic UPDATABLE patch path, because it
 * carries a real invariant the generic path doesn't enforce: at most one real vehicle per user
 * is ever marked synced (there is exactly one real Tesla connection per user, tesla_accounts'
 * own unique index), so turning it on for one vehicle turns it off for every other, atomically.
 */
export async function setTeslaSynced(userId, vehicleId, enabled) {
  const vehicle = await getOwnedVehicle(userId, vehicleId);
  if (!vehicle) throw notFound("Vehicle not found");
  if (enabled) {
    await query("UPDATE vehicles SET tesla_synced = false, updated_at = now() WHERE user_id = $1 AND id != $2", [userId, vehicleId]);
  }
  await query("UPDATE vehicles SET tesla_synced = $3, updated_at = now() WHERE id = $1 AND user_id = $2", [vehicleId, userId, Boolean(enabled)]);
  return getVehicle(userId, vehicleId);
}

/**
 * The real 6-hour housekeeping sweep's odometer half (Git #3217) -- reads Tesla's real
 * vehicle_state.odometer for whichever one vehicle is marked tesla_synced and persists it.
 * Returns a real, honest status rather than throwing for any of the ordinary "nothing to do"
 * cases (no synced vehicle, Tesla not connected, no odometer data yet) -- same discipline
 * tesla.mjs's checkLowBatteryForCommute already uses.
 */
export async function syncOdometerFromTesla(userId) {
  const vehicle = await one("SELECT id, current_mileage FROM vehicles WHERE user_id = $1 AND tesla_synced = true", [userId]);
  if (!vehicle) return { synced: false, reason: "no_tesla_synced_vehicle" };

  let state;
  try {
    state = await teslaCore.getVehicleState(userId);
  } catch (err) {
    if (err instanceof TeslaError) return { synced: false, reason: err.code || "tesla_error", message: err.message };
    throw err;
  }
  if (state.odometerMiles === null) return { synced: false, reason: "no_odometer_data" };

  await query("UPDATE vehicles SET current_mileage = $2, mileage_synced_at = now(), updated_at = now() WHERE id = $1", [
    vehicle.id,
    state.odometerMiles,
  ]);
  return { synced: true, vehicleId: vehicle.id, currentMileage: state.odometerMiles, previousMileage: vehicle.current_mileage };
}

/** Every real synced charging session for this user, newest first -- the Cars detail page's own
 *  Charging section. costEstimateCents is always Shane's own rate x real kWh, see tesla.mjs's
 *  getChargingHistory header for why it is never a Tesla-sourced figure. */
export async function listChargingSessions(userId, { limit = 20 } = {}) {
  const rows = await many(
    `SELECT id, started_at, location, energy_added_kwh, cost_estimate_cents, synced_at
       FROM tesla_charging_sessions WHERE user_id = $1 ORDER BY started_at DESC NULLS LAST, synced_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    location: r.location,
    energyAddedKwh: r.energy_added_kwh === null ? null : Number(r.energy_added_kwh),
    costEstimate: r.cost_estimate_cents === null ? null : toDollars(r.cost_estimate_cents),
    syncedAt: r.synced_at,
  }));
}

/**
 * The real 6-hour housekeeping sweep's charging half (Git #3217). Pulls Tesla's real charging
 * sessions (energy added, timestamp, location -- see tesla.mjs's getChargingHistory for the real,
 * investigated limitation on cost) and upserts them, computing a cost ESTIMATE off Shane's own
 * real charge_cost_per_kwh (migration 056) x real kWh when both are known. Idempotent: a repeat
 * sync of the same real session (migration 060's tesla_session_key unique index) just refreshes
 * synced_at/the estimate rather than duplicating the row.
 */
export async function syncChargingSessionsFromTesla(userId) {
  let sessions;
  try {
    sessions = await teslaCore.getChargingHistory(userId);
  } catch (err) {
    if (err instanceof TeslaError) return { synced: false, reason: err.code || "tesla_error", message: err.message };
    throw err;
  }
  if (sessions.length === 0) return { synced: true, count: 0 };

  const settings = await teslaCore.getCommuteSettings(userId);
  const costPerKwh = settings?.chargeCostPerKwh ?? null;

  let count = 0;
  for (const s of sessions) {
    const costEstimateCents = costPerKwh !== null && s.energyAddedKwh !== null ? Math.round(s.energyAddedKwh * costPerKwh * 100) : null;
    await query(
      `INSERT INTO tesla_charging_sessions (user_id, tesla_session_key, started_at, location, energy_added_kwh, cost_estimate_cents, raw, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
       ON CONFLICT (user_id, tesla_session_key) DO UPDATE SET
         started_at = EXCLUDED.started_at, location = EXCLUDED.location,
         energy_added_kwh = EXCLUDED.energy_added_kwh, cost_estimate_cents = EXCLUDED.cost_estimate_cents,
         raw = EXCLUDED.raw, synced_at = now()`,
      [userId, s.sessionKey, s.startedAt, s.location, s.energyAddedKwh, costEstimateCents, JSON.stringify(s.raw)],
    );
    count += 1;
  }
  return { synced: true, count };
}
