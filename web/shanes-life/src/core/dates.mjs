// Dates: appointment/vet/birthday/event/holiday/visit/renewal/vaccine, plus arbitrary
// on-the-fly kinds -- Git #3136, built on the real tables migration 014 already created.
//
// Design handoff README, screen 8's lead-time table is the one real vocabulary that exists
// today: appointment 1, vet 1, birthday 10, want-to-go 14, federal holiday 7, visit 3,
// renewal 21, vaccine 30. `kind` stays free text (014's own decision) -- "mom's coming to
// visit the 12th-18th" creating a Visits kind on the fly is the whole point of the contract's
// Section 3, and a lookup miss here is not an error, it is exactly that on-the-fly moment:
// the caller gets a `newCategory: true` flag back and a real category row is minted for it.

import { many, one, query, transaction } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";
import { ensureCategory } from "./categories.mjs";

/** Screen 8's own lead-time table, verbatim. Anything not in here is a genuinely new kind. */
export const LEAD_DAYS_BY_KIND = Object.freeze({
  appointment: 1,
  vet: 1,
  birthday: 10,
  event: 14, // "want-to-go"
  holiday: 7,
  visit: 3,
  renewal: 21,
  vaccine: 30,
});

const SUBJECT_TYPES = new Set(["self", "pet", "person"]);

function coerceAtTime(value) {
  if (value === undefined || value === null || value === "") return null;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(String(value))) {
    throw badRequest(`atTime must be HH:MM (24h): ${value}`);
  }
  return value;
}

function coerceAtDate(value, field = "atDate") {
  if (!value) throw badRequest(`${field} is required`);
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw badRequest(`${field} is not a valid date (YYYY-MM-DD): ${value}`);
  }
  return s;
}

/**
 * Resolve the real lead_days for a create/update: an explicit value always wins; otherwise the
 * known table; otherwise a genuinely on-the-fly kind defaults to 7 (the middle of the real
 * table, not a guess dressed as a rule -- Claude can always pass leadDays explicitly instead).
 */
function resolveLeadDays(kind, explicit) {
  if (explicit !== undefined && explicit !== null) {
    const n = Number(explicit);
    if (!Number.isInteger(n) || n < 0) throw badRequest("leadDays must be a non-negative integer");
    return n;
  }
  return LEAD_DAYS_BY_KIND[kind] ?? 7;
}

export async function createDate({
  userId,
  kind,
  title,
  atDate,
  atTime = null,
  intervalDays = null,
  leadDays,
  provider = null,
  subjectType = "self",
  subjectId = null,
  category = null,
  categoryMeta = {},
  source = "web",
  notes = null,
}) {
  const cleanKind = String(kind || "").trim().toLowerCase().slice(0, 40);
  if (!cleanKind) throw badRequest("kind is required");
  const cleanTitle = String(title ?? "").trim();
  if (!cleanTitle) throw badRequest("title is required");
  if (!SUBJECT_TYPES.has(subjectType)) throw badRequest(`subjectType must be one of: ${[...SUBJECT_TYPES].join(", ")}`);
  if (intervalDays !== null && intervalDays !== undefined) {
    const n = Number(intervalDays);
    if (!Number.isInteger(n) || n <= 0) throw badRequest("intervalDays must be a positive integer");
    intervalDays = n;
  }

  // On-the-fly category: a kind outside the known lead-time table is exactly the "genuinely
  // novel capture" the contract calls out -- mint a real category row for it (defaulting the
  // slug to the kind itself when the caller doesn't pass one) so the Dates room's "New
  // category" badge has something real to point at.
  const isKnownKind = cleanKind in LEAD_DAYS_BY_KIND;
  let categorySlug = null;
  if (category || !isKnownKind) {
    const cat = await ensureCategory(category || cleanKind, categoryMeta || {}, { createdBy: source === "mcp" ? "claude" : "shane" });
    categorySlug = cat.slug;
  }

  const row = await one(
    `INSERT INTO dates
       (user_id, kind, category, title, at_date, at_time, interval_days, lead_days,
        provider, subject_type, subject_id, source, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      userId,
      cleanKind,
      categorySlug,
      cleanTitle.slice(0, 300),
      coerceAtDate(atDate),
      coerceAtTime(atTime),
      intervalDays,
      resolveLeadDays(cleanKind, leadDays),
      provider ? String(provider).trim().slice(0, 200) : null,
      subjectType,
      subjectId,
      source,
      notes ? String(notes).slice(0, 5000) : null,
    ],
  );
  return { ...row, newCategory: categorySlug !== null && !isKnownKind };
}

/**
 * pg parses a `date` column into a real JS Date at LOCAL midnight, not UTC (confirmed live:
 * inserting '2026-09-08' round-trips as a Date whose *local* Y/M/D is 2026-09-08, while its own
 * `toISOString()` -- always UTC -- can read a different calendar day depending on the server's
 * offset). Reading it back with `toISOString().slice(0,10)` is therefore wrong; local getters are
 * the only way to recover the calendar date pg actually stored. A plain string (already
 * "YYYY-MM-DD...") just gets its first 10 characters taken, same as everywhere else in this file.
 */
function toISODateString(value) {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/** Whole calendar days between two "YYYY-MM-DD" strings, via UTC-anchored Dates so a DST
 *  transition falling inside the range (e.g. Nov 1 2026) never shaves an hour off a day-count
 *  computed from local wall-clock milliseconds. */
function daysBetween(fromISODate, toISODate) {
  const from = Date.UTC(...fromISODate.split("-").map(Number));
  const to = Date.UTC(...toISODate.split("-").map(Number));
  return Math.round((to - from) / 86_400_000);
}

function addDaysToISODate(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/**
 * The real occurrence a recurring date should show next: the stored at_date/at_time if it is
 * still upcoming, otherwise the stored date walked forward by interval_days until it is. A
 * one-off (interval_days NULL) always returns its own stored date -- it either surfaces once and
 * is done, or Shane marks it done explicitly.
 */
export function nextOccurrence(row, today = new Date()) {
  const storedDate = toISODateString(row.at_date);
  if (!row.interval_days) return { atDate: storedDate, atTime: row.at_time };
  const todayISO = toISODateString(today);
  const diffDays = daysBetween(storedDate, todayISO);
  if (diffDays <= 0) return { atDate: storedDate, atTime: row.at_time };
  const steps = Math.ceil(diffDays / row.interval_days);
  return { atDate: addDaysToISODate(storedDate, steps * row.interval_days), atTime: row.at_time };
}

/**
 * The Dates room list: real user dates (recurring ones projected to their next real occurrence)
 * plus real federal holidays (global, not user-scoped) merged in as `kind: 'holiday'` rows, all
 * ordered by when they actually next surface. `withinDays` is the tray/room's own "This week /
 * This month / Later" grouping input -- the caller groups, this just returns everything sorted
 * with a real `surfacesOn` and `dueInDays` so grouping never has to re-derive the math.
 */
export async function listDates(userId, { includeDone = false, horizonDays = 400 } = {}) {
  const rows = await many(
    `SELECT d.*, c.label AS category_label, c.icon AS category_icon, c.color AS category_color
       FROM dates d
       LEFT JOIN categories c ON c.slug = d.category
      WHERE d.user_id = $1 ${includeDone ? "" : "AND d.done_at IS NULL"}`,
    [userId],
  );

  const holidays = await many(
    `SELECT id, name, observed_on, source
       FROM federal_holidays
      WHERE observed_on >= current_date - interval '2 days'
        AND observed_on <= current_date + ($1 || ' days')::interval
      ORDER BY observed_on`,
    [Math.min(Number(horizonDays) || 400, 800)],
  );

  const today = new Date();
  const todayISO = toISODateString(today);
  const items = [];

  for (const row of rows) {
    const occ = nextOccurrence(row, today);
    const dueInDays = daysBetween(todayISO, occ.atDate);
    if (dueInDays > horizonDays) continue;
    items.push({
      ...row,
      at_date: occ.atDate,
      at_time: occ.atTime,
      due_in_days: dueInDays,
      surfaces_in_days: dueInDays - row.lead_days,
    });
  }

  for (const h of holidays) {
    const observedOn = toISODateString(h.observed_on);
    const dueInDays = daysBetween(todayISO, observedOn);
    items.push({
      id: `holiday:${h.id}`,
      kind: "holiday",
      category: null,
      title: h.name,
      at_date: observedOn,
      at_time: null,
      interval_days: null,
      lead_days: LEAD_DAYS_BY_KIND.holiday,
      provider: null,
      subject_type: "self",
      subject_id: null,
      source: h.source,
      notes: null,
      done_at: null,
      due_in_days: dueInDays,
      surfaces_in_days: dueInDays - LEAD_DAYS_BY_KIND.holiday,
      isFederalHoliday: true,
    });
  }

  items.sort((a, b) => new Date(a.at_date) - new Date(b.at_date));
  return items;
}

export async function getDate(userId, dateId) {
  const row = await one(
    `SELECT d.*, c.label AS category_label, c.icon AS category_icon, c.color AS category_color
       FROM dates d
       LEFT JOIN categories c ON c.slug = d.category
      WHERE d.id = $1 AND d.user_id = $2`,
    [dateId, userId],
  );
  if (!row) return null;

  row.asks = await many(
    `SELECT id, text, asked_at, created_at FROM date_asks WHERE date_id = $1 ORDER BY created_at`,
    [dateId],
  );
  const visits = await many(
    `SELECT id, visited_on, notes, created_at FROM date_visits WHERE date_id = $1 ORDER BY visited_on DESC`,
    [dateId],
  );
  for (const visit of visits) {
    visit.photos = await many(
      `SELECT id, media_id, url, label, created_at FROM date_photos WHERE visit_id = $1 ORDER BY created_at`,
      [visit.id],
    );
  }
  row.visits = visits;
  return row;
}

export async function getOwnedDate(userId, dateId) {
  return one("SELECT * FROM dates WHERE id = $1 AND user_id = $2", [dateId, userId]);
}

const UPDATABLE = {
  title: (v) => String(v).trim().slice(0, 300),
  at_time: coerceAtTime,
  provider: (v) => (v === null ? null : String(v).trim().slice(0, 200)),
  notes: (v) => (v === null ? null : String(v).slice(0, 5000)),
  lead_days: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw badRequest("leadDays must be a non-negative integer");
    return n;
  },
  interval_days: (v) => {
    if (v === null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw badRequest("intervalDays must be a positive integer");
    return n;
  },
};

export async function updateDate(userId, dateId, patch) {
  const existing = await getOwnedDate(userId, dateId);
  if (!existing) throw notFound("Date not found");

  const sets = [];
  const params = [dateId, userId];
  const mapped = {
    title: patch.title,
    at_time: patch.atTime,
    provider: patch.provider,
    notes: patch.notes,
    lead_days: patch.leadDays,
    interval_days: patch.intervalDays,
  };
  for (const [column, value] of Object.entries(mapped)) {
    if (value === undefined) continue;
    params.push(UPDATABLE[column](value));
    sets.push(`${column} = $${params.length}`);
  }
  if (patch.atDate !== undefined) {
    params.push(coerceAtDate(patch.atDate));
    sets.push(`at_date = $${params.length}`);
  }
  if (patch.done !== undefined) {
    sets.push(patch.done ? "done_at = now()" : "done_at = NULL");
  }
  if (sets.length === 0) throw badRequest("No updatable fields supplied");
  sets.push("updated_at = now()");

  await query(`UPDATE dates SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2`, params);
  return getDate(userId, dateId);
}

export async function deleteDate(userId, dateId) {
  const { rowCount } = await query("DELETE FROM dates WHERE id = $1 AND user_id = $2", [dateId, userId]);
  if (rowCount === 0) throw notFound("Date not found");
}

// -- "next time at dr fonji ask about ..." --------------------------------------------------

export async function addAsk(userId, dateId, text) {
  const owned = await getOwnedDate(userId, dateId);
  if (!owned) throw notFound("Date not found");
  const clean = String(text ?? "").trim();
  if (!clean) throw badRequest("text is required");
  return one(
    `INSERT INTO date_asks (date_id, text) VALUES ($1, $2) RETURNING id, text, asked_at, created_at`,
    [dateId, clean.slice(0, 2000)],
  );
}

/**
 * Attach a question to whatever a provider's NEXT upcoming appointment turns out to be --
 * exactly the capture grammar's "next time at dr fonji ask about ..." entry point, which by
 * definition does not know the date's id. Case-insensitive match on provider name; picks the
 * soonest not-done date for that provider that is still ahead of today.
 */
export async function attachAskToProvider(userId, provider, text) {
  const target = await one(
    `SELECT id FROM dates
      WHERE user_id = $1 AND done_at IS NULL AND lower(provider) = lower($2) AND at_date >= current_date
      ORDER BY at_date ASC
      LIMIT 1`,
    [userId, provider],
  );
  if (!target) throw notFound(`No upcoming appointment on file for provider "${provider}"`);
  const ask = await addAsk(userId, target.id, text);
  return { dateId: target.id, ask };
}

export async function setAskAsked(userId, dateId, askId, asked = true) {
  const owned = await getOwnedDate(userId, dateId);
  if (!owned) throw notFound("Date not found");
  const row = await one(
    `UPDATE date_asks SET asked_at = CASE WHEN $3 THEN now() ELSE NULL END
      WHERE id = $1 AND date_id = $2
      RETURNING id, text, asked_at, created_at`,
    [askId, dateId, Boolean(asked)],
  );
  if (!row) throw notFound("Ask not found");
  return row;
}

// -- "Notes and photos, by visit" -----------------------------------------------------------

export async function addVisit(userId, dateId, { visitedOn = null, notes = null, photos = [] } = {}) {
  const owned = await getOwnedDate(userId, dateId);
  if (!owned) throw notFound("Date not found");
  const on = visitedOn ? coerceAtDate(visitedOn, "visitedOn") : new Date().toISOString().slice(0, 10);

  return transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO date_visits (date_id, visited_on, notes) VALUES ($1,$2,$3) RETURNING *`,
      [dateId, on, notes ? String(notes).slice(0, 5000) : null],
    );
    const visit = rows[0];
    visit.photos = [];
    for (const photo of Array.isArray(photos) ? photos : []) {
      if (!photo?.mediaId && !photo?.url) continue;
      const { rows: photoRows } = await client.query(
        `INSERT INTO date_photos (visit_id, media_id, url, label) VALUES ($1,$2,$3,$4) RETURNING *`,
        [visit.id, photo.mediaId ?? null, photo.url ?? null, photo.label ? String(photo.label).slice(0, 200) : null],
      );
      visit.photos.push(photoRows[0]);
    }
    return visit;
  });
}

export async function addVisitPhoto(userId, dateId, visitId, { mediaId = null, url = null, label = null } = {}) {
  const owned = await getOwnedDate(userId, dateId);
  if (!owned) throw notFound("Date not found");
  if (!mediaId && !url) throw badRequest("mediaId or url is required");
  const visit = await one("SELECT id FROM date_visits WHERE id = $1 AND date_id = $2", [visitId, dateId]);
  if (!visit) throw notFound("Visit not found");
  return one(
    `INSERT INTO date_photos (visit_id, media_id, url, label) VALUES ($1,$2,$3,$4) RETURNING *`,
    [visitId, mediaId, url, label ? String(label).slice(0, 200) : null],
  );
}

// -- day-before appointment reminders (the contract's one clock exception) -------------------

/**
 * Everything the reminder job (server.mjs's daily sweep) needs: real dates whose lead-time
 * window is exactly "day-before" (appointment/vet, per the contract's stated exception) that
 * occur tomorrow and have not already had a reminder nudge queued for them today.
 */
export async function findDueDayBeforeReminders(userId) {
  return many(
    `SELECT d.id, d.kind, d.title, d.provider, d.at_date, d.at_time
       FROM dates d
      WHERE d.user_id = $1
        AND d.done_at IS NULL
        AND d.kind IN ('appointment', 'vet')
        AND d.at_date = current_date + interval '1 day'
        AND NOT EXISTS (
          SELECT 1 FROM nudge_events n
           WHERE n.user_id = d.user_id
             AND n.kind = 'appointment'
             AND n.payload->>'dateId' = d.id::text
             AND n.day = current_date
        )`,
    [userId],
  );
}
