// "Who fixed what" -- real service-provider contact log (Git #3156, migration 016).
//
// Design handoff, capture grammar item 7: "plumber is Ray 321-555-0142" -> Who fixed what.
// README's own row shape: name / what they did . when / phone (`did` + `fixed_on` are that
// "what . when", per migration 016's own comment -- `when` is a reserved SQL word). This is a
// real, growing log, not a single latest-state record per person: the same plumber can show up
// twice for two different jobs, and both are real history worth keeping.

import { many, one } from "../db.mjs";
import { badRequest } from "../http.mjs";

function normaliseName(name) {
  const n = String(name || "").trim().slice(0, 200);
  if (!n) throw badRequest("name is required");
  return n;
}

function optionalText(value, max = 500) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim().slice(0, max);
  return v || null;
}

function normaliseFixedOn(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest("fixedOn must be a real date");
  return value;
}

/** File a real "who fixed what" entry. Always a new log row -- see module note above. */
export async function recordContact(userId, { name, phone, did, house, fixedOn, trade }) {
  const n = normaliseName(name);
  const phone_ = optionalText(phone, 60);
  const did_ = optionalText(did, 1000);
  const house_ = optionalText(house, 80);
  const trade_ = optionalText(trade, 120);
  const fixedOn_ = normaliseFixedOn(fixedOn);

  return one(
    `INSERT INTO contacts (user_id, name, phone, did, house, fixed_on, trade)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, phone, did, house, fixed_on, trade, created_at, updated_at`,
    [userId, n, phone_, did_, house_, fixedOn_, trade_],
  );
}

/** Every real "who fixed what" entry, newest first. */
export async function listContacts(userId, { trade = null, limit = 200 } = {}) {
  const params = [userId];
  let filter = "";
  if (trade) {
    params.push(trade);
    filter = `AND lower(trade) = lower($${params.length})`;
  }
  params.push(Math.min(Number(limit) || 200, 500));
  return many(
    `SELECT id, name, phone, did, house, fixed_on, trade, created_at, updated_at
       FROM contacts
      WHERE user_id = $1 ${filter}
      ORDER BY coalesce(fixed_on, created_at::date) DESC, created_at DESC
      LIMIT $${params.length}`,
    params,
  );
}

/** Real search over name/trade/what-they-did -- "who fixed the water heater" / "the plumber". */
export async function searchContacts(userId, q) {
  const query = String(q || "").trim();
  if (!query) return [];
  return many(
    `SELECT id, name, phone, did, house, fixed_on, trade, created_at, updated_at
       FROM contacts
      WHERE user_id = $1
        AND (lower(name) LIKE '%' || lower($2) || '%'
             OR lower(coalesce(trade, '')) LIKE '%' || lower($2) || '%'
             OR lower(coalesce(did, '')) LIKE '%' || lower($2) || '%')
      ORDER BY coalesce(fixed_on, created_at::date) DESC, created_at DESC
      LIMIT 50`,
    [userId, query],
  );
}

/**
 * Real signal for the Today tray's "At the Rental" balloon (Git #3164, README "Later, by
 * moment": "while the water-heater quote is still urgent in Money" -- Money has no urgent/quote
 * concept built yet, but this app already has a real, honest stand-in: a contacts row with no
 * `fixed_on` IS an open job, per this module's own header comment ("a real, growing log"). The
 * most recent one logged against a house that mentions "rental" is exactly the design's own
 * example shape ("Water heater quote · call Marcus"): `did` is the quote/job, `name` is who to
 * call. Returns null when nothing is open against the Rental.
 */
export async function getOpenRentalJob(userId) {
  return one(
    `SELECT name, did FROM contacts
      WHERE user_id = $1 AND fixed_on IS NULL AND lower(coalesce(house, '')) LIKE '%rental%'
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId],
  );
}
