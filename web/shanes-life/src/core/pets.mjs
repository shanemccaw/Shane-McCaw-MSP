// Pets (Git #3141, filed as its own Feature while building #3136 -- Section 6 of the design
// contract pack: "all of it," real per-pet profiles, multiple pets supported).
//
// Real schema already existed unused since migration 015 (Git #3107): pets, pet_vaccines,
// pet_care, pet_records. This module is the first thing that actually reads/writes them.
//
// Per Section 6, three real pieces reuse systems already built rather than reinventing them:
//   - Vet visits reuse the Dates system (dates.mjs) -- a vet visit is a `kind: 'vet'` date with
//     subjectType 'pet' / subjectId this pet's id. This module doesn't touch the dates table;
//     getPet() reads it back read-only so a pet's profile shows its real appointment history.
//   - Feeding/meds reuse the Meds batch system (medications.mjs) -- pet_care.batch is merged
//     into the SAME batch trays as Shane's own medications there, not duplicated here.
//   - Records reuse the same media-or-url photo-chip pattern as date_photos.
// What's genuinely pet-specific and lives here: the per-pet identity, and vaccine tracking
// (pet_vaccines) -- vaccines have their own real due_on/fine_until the vet gives directly,
// which is a different concern from booking the calendar appointment to go get one.

import { many, one, query } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";

const MAX_NAME_LEN = 200;
const MAX_NOTE_LEN = 5000;
const MAX_BATCH_LEN = 60;
const MAX_LABEL_LEN = 200;

function coerceDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw badRequest(`${field} is not a valid date (YYYY-MM-DD): ${value}`);
  }
  return s;
}

function toISODateString(value) {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function daysBetween(fromISODate, toISODate) {
  const from = Date.UTC(...fromISODate.split("-").map(Number));
  const to = Date.UTC(...toISODate.split("-").map(Number));
  return Math.round((to - from) / 86_400_000);
}

// -- pets ------------------------------------------------------------------------------------

export async function getOwnedPet(userId, petId) {
  return one("SELECT * FROM pets WHERE id = $1 AND user_id = $2", [petId, userId]);
}

export async function createPet(userId, { name, species = null, breed = null, born = null, notes = null } = {}) {
  const cleanName = String(name ?? "").trim().slice(0, MAX_NAME_LEN);
  if (!cleanName) throw badRequest("name is required");
  return one(
    `INSERT INTO pets (user_id, name, species, breed, born, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      userId,
      cleanName,
      species ? String(species).trim().slice(0, 100) : null,
      breed ? String(breed).trim().slice(0, 100) : null,
      coerceDate(born, "born"),
      notes ? String(notes).slice(0, MAX_NOTE_LEN) : null,
    ],
  );
}

const UPDATABLE_PET = {
  name: (v) => String(v).trim().slice(0, MAX_NAME_LEN),
  species: (v) => (v === null ? null : String(v).trim().slice(0, 100)),
  breed: (v) => (v === null ? null : String(v).trim().slice(0, 100)),
  born: (v) => coerceDate(v, "born"),
  notes: (v) => (v === null ? null : String(v).slice(0, MAX_NOTE_LEN)),
};

export async function updatePet(userId, petId, patch = {}) {
  const existing = await getOwnedPet(userId, petId);
  if (!existing) throw notFound("Pet not found");

  const sets = [];
  const params = [petId, userId];
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined || !(column in UPDATABLE_PET)) continue;
    params.push(UPDATABLE_PET[column](value));
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) throw badRequest("No updatable fields supplied");
  sets.push("updated_at = now()");

  await query(`UPDATE pets SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2`, params);
  return getOwnedPet(userId, petId);
}

export async function deletePet(userId, petId) {
  const { rowCount } = await query("DELETE FROM pets WHERE id = $1 AND user_id = $2", [petId, userId]);
  if (rowCount === 0) throw notFound("Pet not found");
}

/**
 * The Pets room list: every real pet, each with its soonest real vaccine due (if any) already
 * computed with dueInDays/surfacesInDays -- same shape dates.listDates uses -- so the room's
 * card can go amber the moment a vaccine enters its lead window without recomputing anything.
 */
export async function listPets(userId) {
  const pets = await many("SELECT * FROM pets WHERE user_id = $1 ORDER BY name", [userId]);
  if (pets.length === 0) return [];

  const vaccines = await many(
    `SELECT v.* FROM pet_vaccines v
       JOIN pets p ON p.id = v.pet_id
      WHERE p.user_id = $1 AND v.due_on IS NOT NULL
      ORDER BY v.due_on`,
    [userId],
  );

  const todayISO = toISODateString(new Date());
  const nextByPet = new Map();
  for (const v of vaccines) {
    if (nextByPet.has(v.pet_id)) continue;
    const dueOn = toISODateString(v.due_on);
    nextByPet.set(v.pet_id, {
      id: v.id,
      name: v.name,
      dueOn,
      dueInDays: daysBetween(todayISO, dueOn),
      surfacesInDays: daysBetween(todayISO, dueOn) - v.lead_days,
      leadDays: v.lead_days,
    });
  }

  return pets.map((p) => ({ ...p, nextVaccine: nextByPet.get(p.id) ?? null }));
}

/**
 * One pet's full profile: itself, every vaccine, every care (feeding/meds) item, every record,
 * and its real vet-visit history read back from the Dates system (subjectType 'pet') -- read-
 * only here, dates.mjs owns writes to that table.
 */
export async function getPet(userId, petId) {
  const pet = await getOwnedPet(userId, petId);
  if (!pet) return null;

  pet.vaccines = await many(
    "SELECT * FROM pet_vaccines WHERE pet_id = $1 ORDER BY due_on NULLS LAST, name",
    [petId],
  );
  pet.care = await many(
    "SELECT * FROM pet_care WHERE pet_id = $1 ORDER BY batch, position, created_at",
    [petId],
  );
  pet.records = await many(
    "SELECT * FROM pet_records WHERE pet_id = $1 ORDER BY created_at DESC",
    [petId],
  );
  pet.vetDates = await many(
    `SELECT id, kind, title, at_date, at_time, provider, notes, done_at
       FROM dates
      WHERE user_id = $1 AND subject_type = 'pet' AND subject_id = $2
      ORDER BY at_date DESC`,
    [userId, petId],
  );
  return pet;
}

// -- vaccines ----------------------------------------------------------------------------------

async function requireOwnedPet(userId, petId) {
  const pet = await getOwnedPet(userId, petId);
  if (!pet) throw notFound("Pet not found");
  return pet;
}

export async function createVaccine(
  userId,
  petId,
  { name, intervalDays = null, lastOn = null, dueOn = null, fineUntil = null, leadDays = 30 } = {},
) {
  await requireOwnedPet(userId, petId);
  const cleanName = String(name ?? "").trim().slice(0, MAX_NAME_LEN);
  if (!cleanName) throw badRequest("name is required");
  if (intervalDays !== null && intervalDays !== undefined) {
    const n = Number(intervalDays);
    if (!Number.isInteger(n) || n <= 0) throw badRequest("intervalDays must be a positive integer");
    intervalDays = n;
  }
  const cleanLeadDays = Number(leadDays);
  if (!Number.isInteger(cleanLeadDays) || cleanLeadDays < 0) throw badRequest("leadDays must be a non-negative integer");

  return one(
    `INSERT INTO pet_vaccines (pet_id, name, interval_days, last_on, due_on, fine_until, lead_days)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      petId,
      cleanName,
      intervalDays,
      coerceDate(lastOn, "lastOn"),
      coerceDate(dueOn, "dueOn"),
      coerceDate(fineUntil, "fineUntil"),
      cleanLeadDays,
    ],
  );
}

const UPDATABLE_VACCINE = {
  name: (v) => String(v).trim().slice(0, MAX_NAME_LEN),
  interval_days: (v) => {
    if (v === null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw badRequest("intervalDays must be a positive integer");
    return n;
  },
  last_on: (v) => coerceDate(v, "lastOn"),
  due_on: (v) => coerceDate(v, "dueOn"),
  fine_until: (v) => coerceDate(v, "fineUntil"),
  lead_days: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw badRequest("leadDays must be a non-negative integer");
    return n;
  },
};

async function getOwnedVaccine(userId, petId, vaccineId) {
  return one(
    `SELECT v.* FROM pet_vaccines v
       JOIN pets p ON p.id = v.pet_id
      WHERE v.id = $1 AND v.pet_id = $2 AND p.user_id = $3`,
    [vaccineId, petId, userId],
  );
}

export async function updateVaccine(userId, petId, vaccineId, patch = {}) {
  const existing = await getOwnedVaccine(userId, petId, vaccineId);
  if (!existing) throw notFound("Vaccine not found");

  const mapped = {
    name: patch.name,
    interval_days: patch.intervalDays,
    last_on: patch.lastOn,
    due_on: patch.dueOn,
    fine_until: patch.fineUntil,
    lead_days: patch.leadDays,
  };
  const sets = [];
  const params = [vaccineId];
  for (const [column, value] of Object.entries(mapped)) {
    if (value === undefined) continue;
    params.push(UPDATABLE_VACCINE[column](value));
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) throw badRequest("No updatable fields supplied");
  sets.push("updated_at = now()");

  await query(`UPDATE pet_vaccines SET ${sets.join(", ")} WHERE id = $1`, params);
  return getOwnedVaccine(userId, petId, vaccineId);
}

/**
 * "Got the shot" -- the real vet-visit outcome: sets last_on to when it was given (default
 * today) and, when a real cycle interval is on file, projects due_on forward from THAT date --
 * matching the migration's own comment that a vet-given date always beats the computed one, so
 * this is only ever the fallback until the vet's own next-due date is entered explicitly.
 */
export async function markVaccineGiven(userId, petId, vaccineId, { givenOn } = {}) {
  const existing = await getOwnedVaccine(userId, petId, vaccineId);
  if (!existing) throw notFound("Vaccine not found");
  const on = givenOn ? coerceDate(givenOn, "givenOn") : toISODateString(new Date());
  const dueOn = existing.interval_days
    ? (() => {
        const [y, m, d] = on.split("-").map(Number);
        const next = new Date(Date.UTC(y, m - 1, d + existing.interval_days));
        return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
      })()
    : existing.due_on;

  await query(
    "UPDATE pet_vaccines SET last_on = $2, due_on = $3, updated_at = now() WHERE id = $1",
    [vaccineId, on, dueOn],
  );
  return getOwnedVaccine(userId, petId, vaccineId);
}

export async function deleteVaccine(userId, petId, vaccineId) {
  const existing = await getOwnedVaccine(userId, petId, vaccineId);
  if (!existing) throw notFound("Vaccine not found");
  await query("DELETE FROM pet_vaccines WHERE id = $1", [vaccineId]);
}

/**
 * Every real vaccine, for every real pet the user has, whose lead window has already opened --
 * the read the day-before-style reminder sweep needs, same shape as dates.findDueDayBeforeReminders
 * but on the vaccine's own lead_days rather than a fixed day-before.
 */
export async function findDueVaccineReminders(userId) {
  return many(
    `SELECT v.id, v.name AS vaccine_name, v.due_on, v.lead_days, p.id AS pet_id, p.name AS pet_name
       FROM pet_vaccines v
       JOIN pets p ON p.id = v.pet_id
      WHERE p.user_id = $1
        AND v.due_on IS NOT NULL
        AND v.due_on <= current_date + (v.lead_days || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM nudge_events n
           WHERE n.user_id = p.user_id
             AND n.kind = 'vaccine'
             AND n.payload->>'vaccineId' = v.id::text
             AND n.day = current_date
        )`,
    [userId],
  );
}

// -- care (feeding/meds, merged into the Meds batch trays) --------------------------------------

export async function createCare(userId, petId, { name, batch, detail = null, position = 0 } = {}) {
  await requireOwnedPet(userId, petId);
  const cleanName = String(name ?? "").trim().slice(0, MAX_NAME_LEN);
  if (!cleanName) throw badRequest("name is required");
  const cleanBatch = String(batch ?? "").trim().toLowerCase();
  if (!cleanBatch) throw badRequest("batch is required");

  return one(
    `INSERT INTO pet_care (pet_id, name, batch, detail, position)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [petId, cleanName, cleanBatch.slice(0, MAX_BATCH_LEN), detail ? String(detail).trim().slice(0, MAX_NOTE_LEN) : null, Number.isFinite(Number(position)) ? Math.trunc(Number(position)) : 0],
  );
}

const UPDATABLE_CARE = {
  name: (v) => String(v).trim().slice(0, MAX_NAME_LEN),
  batch: (v) => {
    const b = String(v).trim().toLowerCase();
    if (!b) throw badRequest("batch is required");
    return b.slice(0, MAX_BATCH_LEN);
  },
  detail: (v) => (v === null ? null : String(v).trim().slice(0, MAX_NOTE_LEN)),
  position: (v) => Math.trunc(Number(v)),
};

async function getOwnedCare(userId, petId, careId) {
  return one(
    `SELECT c.* FROM pet_care c
       JOIN pets p ON p.id = c.pet_id
      WHERE c.id = $1 AND c.pet_id = $2 AND p.user_id = $3`,
    [careId, petId, userId],
  );
}

export async function updateCare(userId, petId, careId, patch = {}) {
  const existing = await getOwnedCare(userId, petId, careId);
  if (!existing) throw notFound("Care item not found");

  const sets = [];
  const params = [careId];
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined || !(column in UPDATABLE_CARE)) continue;
    params.push(UPDATABLE_CARE[column](value));
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) throw badRequest("No updatable fields supplied");

  await query(`UPDATE pet_care SET ${sets.join(", ")} WHERE id = $1`, params);
  return getOwnedCare(userId, petId, careId);
}

export async function deleteCare(userId, petId, careId) {
  const existing = await getOwnedCare(userId, petId, careId);
  if (!existing) throw notFound("Care item not found");
  await query("DELETE FROM pet_care WHERE id = $1", [careId]);
}

/**
 * Every real pet-care item for this user, grouped by batch -- what medications.getMedsToday
 * merges into its own batch trays so a pet's feeding/meds shows up in exactly the same swipe as
 * Shane's own, per Section 6 ("the same real shape ... just attached to a different subject").
 */
export async function listCareByBatch(userId) {
  const rows = await many(
    `SELECT c.id, c.name, c.batch, c.detail, p.id AS pet_id, p.name AS pet_name
       FROM pet_care c
       JOIN pets p ON p.id = c.pet_id
      WHERE p.user_id = $1
      ORDER BY c.batch, c.position, c.created_at`,
    [userId],
  );
  const byBatch = new Map();
  for (const row of rows) {
    if (!byBatch.has(row.batch)) byBatch.set(row.batch, []);
    byBatch.get(row.batch).push(row);
  }
  return byBatch;
}

// -- records (photo chips) ----------------------------------------------------------------------

export async function addRecord(userId, petId, { mediaId = null, url = null, label = null } = {}) {
  await requireOwnedPet(userId, petId);
  if (!mediaId && !url) throw badRequest("mediaId or url is required");
  return one(
    `INSERT INTO pet_records (pet_id, media_id, url, label) VALUES ($1,$2,$3,$4) RETURNING *`,
    [petId, mediaId, url, label ? String(label).trim().slice(0, MAX_LABEL_LEN) : null],
  );
}

export async function deleteRecord(userId, petId, recordId) {
  await requireOwnedPet(userId, petId);
  const { rowCount } = await query(
    "DELETE FROM pet_records WHERE id = $1 AND pet_id = $2",
    [recordId, petId],
  );
  if (rowCount === 0) throw notFound("Record not found");
}
