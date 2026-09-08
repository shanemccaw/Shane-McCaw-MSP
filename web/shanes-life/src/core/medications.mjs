// Medications (Git #3135, sub-issue of #3086's Epic: Shane's Life).
//
// Contract pack Section 3: "Medication system: batched by time of day, single swipe to
// complete, split into auto-refill and manual-watch tiers." Design/design_handoff_shanes_life/
// "Shanes Life 07 - Meds.dc.html" is the real reference this module serves: a batch card per
// time of day with one slide-to-complete action, and a Refills section split into "Needs you"
// (manual-watch) and "Handled automatically" (auto-refill).
//
// "Single swipe per batch, not per-pill" (README's non-negotiable) means completion is a real
// row per (user, batch, day) -- med_batch_log -- not one row per medication per day. There is
// deliberately no adherence history surfaced anywhere (the design's own "Why": "no adherence
// history, no streak: yesterday isn't shown anywhere") -- today's state is the only thing read
// back, even though the log itself keeps every real day forever.

import { many, one, query } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";

const REFILL_TIERS = new Set(["auto", "manual"]);
const MAX_NAME_LEN = 200;
const MAX_NOTE_LEN = 2000;
const MAX_BATCH_LEN = 60;

function cleanBatch(batch) {
  const text = String(batch ?? "").trim().toLowerCase();
  if (!text) throw badRequest("batch is required");
  return text.slice(0, MAX_BATCH_LEN);
}

function coerceDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} is not a valid date: ${value}`);
  return d.toISOString().slice(0, 10);
}

/** Ownership check + the raw row, used by every mutation below. */
export async function getOwnedMedication(userId, medicationId) {
  return one(
    `SELECT id, name, dose_note, batch, refill_tier, supply_days, next_refill_on, refill_note,
            position, created_at, updated_at
       FROM medications WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
    [medicationId, userId],
  );
}

/**
 * Create one real medication. `refillTier` defaults to 'manual' -- the safer default is to
 * surface as needing attention rather than silently assume auto-refill for something that
 * isn't.
 */
export async function createMedication(
  userId,
  { name, doseNote, batch, refillTier = "manual", supplyDays, nextRefillOn, refillNote, position = 0 } = {},
) {
  const cleanName = String(name ?? "").trim().slice(0, MAX_NAME_LEN);
  if (!cleanName) throw badRequest("name is required");
  const cleanTier = String(refillTier ?? "manual").trim().toLowerCase();
  if (!REFILL_TIERS.has(cleanTier)) throw badRequest(`refillTier must be one of: ${[...REFILL_TIERS].join(", ")}`);

  const row = await one(
    `INSERT INTO medications
       (user_id, name, dose_note, batch, refill_tier, supply_days, next_refill_on, refill_note, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, name, dose_note, batch, refill_tier, supply_days, next_refill_on, refill_note,
               position, created_at, updated_at`,
    [
      userId,
      cleanName,
      doseNote ? String(doseNote).trim().slice(0, MAX_NOTE_LEN) : null,
      cleanBatch(batch),
      cleanTier,
      supplyDays === undefined || supplyDays === null ? null : Math.max(0, Math.trunc(Number(supplyDays))),
      coerceDate(nextRefillOn, "nextRefillOn"),
      refillNote ? String(refillNote).trim().slice(0, MAX_NOTE_LEN) : null,
      Number.isFinite(Number(position)) ? Math.trunc(Number(position)) : 0,
    ],
  );
  return row;
}

const UPDATABLE = {
  name: (v) => String(v).trim().slice(0, MAX_NAME_LEN),
  dose_note: (v) => (v === null ? null : String(v).trim().slice(0, MAX_NOTE_LEN)),
  batch: (v) => cleanBatch(v),
  supply_days: (v) => (v === null ? null : Math.max(0, Math.trunc(Number(v)))),
  next_refill_on: (v) => coerceDate(v, "nextRefillOn"),
  refill_note: (v) => (v === null ? null : String(v).trim().slice(0, MAX_NOTE_LEN)),
  position: (v) => Math.trunc(Number(v)),
};

export async function updateMedication(userId, medicationId, patch = {}) {
  const existing = await getOwnedMedication(userId, medicationId);
  if (!existing) throw notFound("Medication not found");

  const sets = [];
  const params = [medicationId, userId];
  const mapped = {
    name: patch.name,
    dose_note: patch.doseNote,
    batch: patch.batch,
    supply_days: patch.supplyDays,
    next_refill_on: patch.nextRefillOn,
    refill_note: patch.refillNote,
    position: patch.position,
  };
  for (const [column, value] of Object.entries(mapped)) {
    if (value === undefined) continue;
    params.push(UPDATABLE[column](value));
    sets.push(`${column} = $${params.length}`);
  }

  if (patch.refillTier !== undefined) {
    const cleanTier = String(patch.refillTier).trim().toLowerCase();
    if (!REFILL_TIERS.has(cleanTier)) throw badRequest(`refillTier must be one of: ${[...REFILL_TIERS].join(", ")}`);
    params.push(cleanTier);
    sets.push(`refill_tier = $${params.length}`);
  }

  if (sets.length === 0) throw badRequest("No updatable fields supplied");
  sets.push("updated_at = now()");

  await query(`UPDATE medications SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2`, params);
  return getOwnedMedication(userId, medicationId);
}

export async function archiveMedication(userId, medicationId) {
  const owned = await getOwnedMedication(userId, medicationId);
  if (!owned) throw notFound("Medication not found");
  await query("UPDATE medications SET archived_at = now() WHERE id = $1", [medicationId]);
}

/**
 * "Ordered it" (design screen 6's real refill action): advances the manual-watch due date by
 * `supply_days` from today, same real math as a fresh fill actually lasting that long. If
 * supply_days was never set, this still moves the date forward from whatever it already was (or
 * today if unset) by 30 days -- a real, sane default rather than refusing the action outright.
 */
export async function markMedicationOrdered(userId, medicationId) {
  const owned = await getOwnedMedication(userId, medicationId);
  if (!owned) throw notFound("Medication not found");
  const days = owned.supply_days || 30;
  const base = owned.next_refill_on ? new Date(owned.next_refill_on) : new Date();
  const from = base > new Date() ? base : new Date();
  from.setDate(from.getDate() + days);
  const nextRefillOn = from.toISOString().slice(0, 10);
  await query(
    "UPDATE medications SET next_refill_on = $2, updated_at = now() WHERE id = $1",
    [medicationId, nextRefillOn],
  );
  return getOwnedMedication(userId, medicationId);
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Today's real tray state: batches (grouped by `batch`, each with its items and whether it has
 * already been swiped complete today), and the refills split into "needs you" / "handled
 * automatically" -- the two real sections screen 6 draws, bucketed purely by refill_tier per
 * #3135's own scope ("auto-refill items need no real action ... manual-watch items surface as a
 * real, distinct thing"), not by how close a due date is.
 *
 * Section 6 (Pets, #3141): a pet's feeding/meds is "the same real shape as Shane's own, just
 * attached to a different subject" -- real pet_care rows sharing a batch name (e.g. 'morning')
 * are merged straight into that same batch here, so one real swipe completes Shane's own meds
 * and his pets' feeding/meds together, through the same med_batch_log row.
 */
export async function getMedsToday(userId) {
  const meds = await many(
    `SELECT id, name, dose_note, batch, refill_tier, supply_days, next_refill_on, refill_note,
            position, created_at, updated_at
       FROM medications
      WHERE user_id = $1 AND archived_at IS NULL
      ORDER BY batch, position, created_at`,
    [userId],
  );
  const petCare = await many(
    `SELECT c.id, c.name, c.batch, c.detail, p.name AS pet_name
       FROM pet_care c
       JOIN pets p ON p.id = c.pet_id
      WHERE p.user_id = $1
      ORDER BY c.batch, c.position, c.created_at`,
    [userId],
  );

  const today = todayDateString();
  const takenRows = await many(
    "SELECT batch, taken_at FROM med_batch_log WHERE user_id = $1 AND taken_on = $2",
    [userId, today],
  );
  const takenByBatch = new Map(takenRows.map((r) => [r.batch, r.taken_at]));

  const batchOrder = [];
  const byBatch = new Map();
  for (const med of meds) {
    if (!byBatch.has(med.batch)) {
      byBatch.set(med.batch, []);
      batchOrder.push(med.batch);
    }
    byBatch.get(med.batch).push({
      id: med.id,
      name: med.name,
      doseNote: med.dose_note,
      refillTier: med.refill_tier,
    });
  }
  for (const care of petCare) {
    if (!byBatch.has(care.batch)) {
      byBatch.set(care.batch, []);
      batchOrder.push(care.batch);
    }
    byBatch.get(care.batch).push({
      id: care.id,
      name: `${care.pet_name} -- ${care.name}`,
      doseNote: care.detail,
      isPetCare: true,
      petName: care.pet_name,
    });
  }

  const batches = batchOrder.map((batch) => ({
    batch,
    items: byBatch.get(batch),
    takenToday: takenByBatch.has(batch),
    takenAt: takenByBatch.get(batch) ?? null,
  }));

  const needsYou = meds
    .filter((m) => m.refill_tier === "manual")
    .map((m) => ({
      id: m.id,
      name: m.name,
      nextRefillOn: m.next_refill_on,
      refillNote: m.refill_note,
      daysLeft:
        m.next_refill_on == null
          ? null
          : Math.round((new Date(m.next_refill_on) - new Date(today)) / 86_400_000),
    }));

  const handled = meds
    .filter((m) => m.refill_tier === "auto")
    .map((m) => ({ id: m.id, name: m.name, nextRefillOn: m.next_refill_on }));

  return { batches, refills: { needsYou, handled } };
}

/**
 * Mark a whole batch taken for today. Idempotent: swiping (or saying "took my morning meds")
 * twice in the same day is a no-op the second time, matching UNIQUE (user_id, batch, taken_on).
 */
export async function markBatchTaken(userId, batch, { source = "web", takenOn } = {}) {
  const cleanBatchName = cleanBatch(batch);
  const day = takenOn ? coerceDate(takenOn, "takenOn") : todayDateString();
  const row = await one(
    `INSERT INTO med_batch_log (user_id, batch, taken_on, source)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, batch, taken_on) DO UPDATE SET taken_at = med_batch_log.taken_at
     RETURNING batch, taken_on, taken_at`,
    [userId, cleanBatchName, day, source === "mcp" ? "mcp" : "web"],
  );
  return row;
}

/** Undo (design's real 5s Undo pattern, Section 8): clears today's swipe for a batch. */
export async function unmarkBatchTaken(userId, batch, { takenOn } = {}) {
  const cleanBatchName = cleanBatch(batch);
  const day = takenOn ? coerceDate(takenOn, "takenOn") : todayDateString();
  const { rowCount } = await query(
    "DELETE FROM med_batch_log WHERE user_id = $1 AND batch = $2 AND taken_on = $3",
    [userId, cleanBatchName, day],
  );
  if (rowCount === 0) throw notFound("That batch was not marked taken today");
}
