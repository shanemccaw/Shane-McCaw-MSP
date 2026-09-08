// The vault (Git #3150, generalised into a real full password vault by Git #3242).
//
// It started as the bill-payment reference vault the design contract calls out in Section 9 in
// its own words as "a stated security requirement, not polish". #3242 widened what it holds --
// every real login, not just "which website + which account number" -- and deliberately widened
// nothing else: the security model below is the same one, applied to a larger surface, because a
// password manager holding a bank login has strictly more to lose than one holding a bill
// reference, not less.
//
//   1. AES-256-GCM at rest. The plaintext never exists in a column -- only ciphertext + iv +
//      auth_tag (migration 017; migration 052 adds the same triple for notes). GCM, not CBC,
//      because the auth tag is what makes tampering with a stored row detectable rather than
//      silently decrypting to garbage.
//   2. The key lives OUTSIDE the database (`SL_VAULT_KEY`, base64, read once in config.mjs), so
//      a database dump on its own -- the realistic loss scenario for a one-person app on a
//      hosted Postgres -- decrypts nothing.
//   3. A fresh passkey assertion per reveal. Enforced in the route, not here, but see
//      `reveal()`'s required `credentialId`: this module refuses to decrypt without the id of
//      the credential that actually authorised it, so there is no way to call it from a code
//      path that skipped the assertion and still get a plaintext back.
//   4. An audit row per reveal, in the same transaction as the decrypt -- `vault_reveals`, a
//      real table, not a log line that can be lost on a restart.
//
// Deliberately NOT exposed over MCP. Every other core module in this app has a matching MCP tool
// so Claude can read and write it from any conversation; this one does not, and that is a
// decision rather than an omission -- a bearer-token plane reachable from a chat is exactly the
// wrong place to be able to read Shane's bank account number, and requirement 3 above (a real
// passkey assertion, from a real browser, per reveal) cannot be satisfied by one anyway. #3242
// makes that call harder to regret rather than easier: the same plane would now reach every
// password he has.
//
// Two kinds of row, one table (migration 052). One vault means one key, one audit trail, one
// reveal path; a second table would have meant a second copy of each of those, and the second
// copy of a security control is the one that rots.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { many, one, query, transaction } from "../db.mjs";

/** The design's own number: "full value shown 20 s". The client counts it down; the response
 *  carries the real deadline so the two can never drift apart. */
export const REVEAL_WINDOW_SECONDS = 20;

/** The design's own number: "Copy clears the clipboard in 60 s." */
export const CLIPBOARD_CLEAR_SECONDS = 60;

/** Which key encrypted a row. Stored per row (migration 017's `key_id`) so a future rotation can
 *  re-wrap old rows instead of orphaning them. One active key today. */
export const ACTIVE_KEY_ID = "v1";

/** Migration 052's `vault_kind_check`, mirrored here so a bad `kind` is a real error message
 *  rather than a constraint-violation stack trace. */
export const KINDS = ["bill_reference", "login"];

const IV_BYTES = 12; // GCM's own recommended nonce length
const KEY_BYTES = 32; // AES-256

/**
 * Thrown when `SL_VAULT_KEY` is missing or the wrong length. A distinct class because the route
 * turns it into a 503 with a real explanation -- the vault being unusable is a real deployment
 * fact worth saying out loud, and it must never quietly degrade into storing anything readable.
 */
export class VaultKeyUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = "VaultKeyUnavailable";
  }
}

export function keyIsConfigured() {
  return Boolean(config.vaultKey) && config.vaultKey.length === KEY_BYTES;
}

function requireKey() {
  if (!config.vaultKey) {
    throw new VaultKeyUnavailable(
      "SL_VAULT_KEY is not set, so the vault cannot encrypt or decrypt anything. Generate 32 " +
        "bytes of base64 randomness and set it in the environment (see .env.example).",
    );
  }
  if (config.vaultKey.length !== KEY_BYTES) {
    throw new VaultKeyUnavailable(
      `SL_VAULT_KEY decodes to ${config.vaultKey.length} bytes; AES-256-GCM needs exactly ${KEY_BYTES}.`,
    );
  }
  return config.vaultKey;
}

/**
 * Additional authenticated data. Not secret -- its job is to bind a ciphertext to the exact row
 * and owner it was written for, so lifting `ciphertext`/`iv`/`auth_tag` out of one row and into
 * another (or another user's) fails the tag check instead of decrypting cleanly.
 *
 * `field` extends that binding to WHICH column the ciphertext belongs in (Git #3242): the notes
 * blob and the password blob live in the same row under the same key, so without a discriminator
 * one could be moved into the other's columns and would still decrypt cleanly. "secret"
 * deliberately produces the original, un-suffixed string -- every row written before #3242 was
 * sealed with that exact AAD, and changing it would make each of them undecryptable.
 */
function aad(id, userId, field = "secret") {
  const base = `shanes-life:vault:${ACTIVE_KEY_ID}:${id}:${userId}`;
  return Buffer.from(field === "secret" ? base : `${base}:${field}`, "utf8");
}

function encrypt(plaintext, id, userId, field = "secret") {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", requireKey(), iv);
  cipher.setAAD(aad(id, userId, field));
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function assertKeyMatches(row) {
  if (row.key_id !== ACTIVE_KEY_ID) {
    throw new VaultKeyUnavailable(
      `This entry was encrypted with key "${row.key_id}", and the only key configured is ` +
        `"${ACTIVE_KEY_ID}". Restore that key before revealing it.`,
    );
  }
}

function decrypt(row) {
  assertKeyMatches(row);
  const decipher = createDecipheriv("aes-256-gcm", requireKey(), row.iv);
  decipher.setAAD(aad(row.id, row.user_id));
  decipher.setAuthTag(row.auth_tag);
  return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
}

/** The notes blob, or null when the row has none. Migration 052's `vault_notes_triple_check`
 *  guarantees the three columns are all present or all absent, so one null test covers it. */
function decryptNotes(row) {
  if (!row.notes_ciphertext) return null;
  assertKeyMatches(row);
  const decipher = createDecipheriv("aes-256-gcm", requireKey(), row.notes_iv);
  decipher.setAAD(aad(row.id, row.user_id, "notes"));
  decipher.setAuthTag(row.notes_auth_tag);
  return Buffer.concat([decipher.update(row.notes_ciphertext), decipher.final()]).toString("utf8");
}

/**
 * The fallback masked hint, when the caller does not write their own.
 *
 * The design's own bill-reference rows carry a human-written one that names WHICH account rather
 * than mechanically masking the value, which is why `masked` is an input and not a derived
 * column. This only fills the gap when nothing was supplied, using the same last-four convention
 * every bank statement already prints.
 *
 * A LOGIN never gets last-four treatment, and never a dot run the length of the password (Git
 * #3242). Both leak: the last four characters of a password are four of its characters, and its
 * length is the single most useful thing an attacker can learn about it for free. A password's
 * mask is a fixed-width row of dots that says nothing at all about what is behind it.
 */
export function defaultMask(secret, kind = "bill_reference") {
  if (kind === "login") return "•".repeat(12);
  const digits = String(secret ?? "").replace(/\D/g, "");
  if (digits.length >= 4) return `•••• ${digits.slice(-4)}`;
  return "••••";
}

function normaliseKind(kind, fallback = "bill_reference") {
  if (kind === undefined || kind === null || kind === "") return fallback;
  const clean = String(kind).trim();
  if (!KINDS.includes(clean)) throw new Error(`kind must be one of: ${KINDS.join(", ")}`);
  return clean;
}

function toWire(row) {
  return {
    id: row.id,
    kind: row.kind ?? "bill_reference",
    label: row.label,
    site: row.site,
    username: row.username ?? null,
    masked: row.masked,
    keyId: row.key_id,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Real password age (migration 052). Distinct from updatedAt, which also moves when a row is
    // merely renamed -- "when did I last change this password" is a question only this answers.
    secretUpdatedAt: row.secret_updated_at ?? null,
    // Whether there ARE notes, never the notes themselves: they are encrypted alongside the
    // password and come back only from a real reveal, exactly as it does.
    hasNotes: Boolean(row.has_notes ?? row.notes_ciphertext ?? false),
    lastRevealedAt: row.last_revealed_at ?? null,
    revealCount: Number(row.reveal_count ?? 0),
    // Git #3212: which real bill account this entry is the payment reference for, if any -- the
    // bill detail sheet's "Payment reference in Vault ->" link reads this the other direction
    // (findEntryForBillAccount below), and this is what lets the vault room itself show which
    // entries are already linked.
    billAccountId: row.bill_account_id ?? null,
    billAccountName: row.bill_account_name ?? null,
  };
}

/**
 * Every entry, masked, optionally filtered by kind and by a real search term.
 *
 * There is deliberately no option to include plaintext here: a list is a read the UI performs on
 * every visit to the room, and requirement 3 (a real assertion per reveal) would be meaningless
 * if the values arrived with the list anyway.
 *
 * Search (Git #3242) runs in the database over the columns that are genuinely not secret --
 * label, site, username. It can never match on a password, because there is no plaintext password
 * to match against; that is a real property of the encryption rather than a restraint this query
 * chose. Searching ciphertext would mean decrypting every row on every keystroke, which is
 * precisely the "one check, everything readable" model this vault refuses.
 */
export async function listEntries(userId, { kind = null, q = null } = {}) {
  const params = [userId];
  let filter = "";

  if (kind) {
    params.push(normaliseKind(kind));
    filter += ` AND v.kind = $${params.length}`;
  }

  const term = String(q ?? "").trim();
  if (term) {
    // Escaped so a literal % or _ in the term searches for those characters rather than acting as
    // a wildcard, and wrapped here rather than in SQL so the parameter stays a single value.
    params.push(`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const p = `$${params.length}`;
    filter += ` AND (v.label ILIKE ${p} OR v.site ILIKE ${p} OR v.username ILIKE ${p})`;
  }

  const rows = await many(
    `SELECT v.id, v.kind, v.label, v.site, v.username, v.masked, v.key_id, v.position,
            v.created_at, v.updated_at, v.secret_updated_at,
            (v.notes_ciphertext IS NOT NULL) AS has_notes,
            v.bill_account_id, a.name AS bill_account_name,
            r.last_revealed_at, COALESCE(r.reveal_count, 0) AS reveal_count
       FROM vault v
       LEFT JOIN accounts a ON a.id = v.bill_account_id
       LEFT JOIN (
         SELECT vault_id, max(at) AS last_revealed_at, count(*) AS reveal_count
           FROM vault_reveals
          GROUP BY vault_id
       ) r ON r.vault_id = v.id
      WHERE v.user_id = $1${filter}
      ORDER BY v.position, v.created_at`,
    params,
  );
  return rows.map(toWire);
}

/** Real per-kind totals for the room's filter row, counted over the WHOLE vault rather than over
 *  whatever the current search happens to match -- a count that shrank as you typed would be
 *  answering a different question than the one the filter asks. */
export async function countsByKind(userId) {
  const rows = await many(
    "SELECT kind, count(*)::int AS n FROM vault WHERE user_id = $1 GROUP BY kind",
    [userId],
  );
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const row of rows) counts[row.kind] = row.n;
  counts.all = KINDS.reduce((sum, k) => sum + counts[k], 0);
  return counts;
}

/** The real "Payment reference in Vault ->" lookup the bill detail sheet (Git #3212) jumps
 *  through: does a vault entry already name this bill account as what it's the reference for.
 *  Returns null rather than an empty object -- "no entry linked yet" is a real, distinct state
 *  from "an entry exists" the UI has to render differently (no link at all vs. a real jump). */
export async function findEntryForBillAccount(userId, billAccountId) {
  if (!billAccountId) return null;
  const row = await one(
    `SELECT id, label FROM vault WHERE user_id = $1 AND bill_account_id = $2 LIMIT 1`,
    [userId, billAccountId],
  );
  return row ? { id: row.id, label: row.label } : null;
}

async function ownedRow(userId, id) {
  return one(
    `SELECT id, user_id, kind, label, site, username, masked, ciphertext, iv, auth_tag,
            notes_ciphertext, notes_iv, notes_auth_tag, key_id, position,
            created_at, updated_at, secret_updated_at, bill_account_id
       FROM vault
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
}

export async function createEntry(
  userId,
  {
    kind = "bill_reference",
    label,
    site = null,
    username = null,
    secret,
    notes = null,
    masked = null,
    position = null,
    billAccountId = null,
  },
) {
  const cleanKind = normaliseKind(kind);
  const cleanLabel = String(label ?? "").trim();
  // Trimmed at the ends but never otherwise touched: leading/trailing whitespace on a pasted
  // password is nearly always the paste's fault, and an interior space is the owner's.
  const cleanSecret = String(secret ?? "").trim();
  const cleanNotes = String(notes ?? "").trim();
  if (!cleanLabel) throw new Error("label is required");
  if (!cleanSecret) throw new Error("secret is required");

  // The id is minted here rather than by the column default because it is part of the AAD the
  // ciphertext is bound to -- it has to exist before the encrypt, not after the insert.
  const id = randomUUID();
  const { ciphertext, iv, authTag } = encrypt(cleanSecret, id, userId);
  const noteBlob = cleanNotes ? encrypt(cleanNotes, id, userId, "notes") : null;

  const row = await one(
    `INSERT INTO vault (id, user_id, kind, label, site, username, masked, ciphertext, iv, auth_tag,
                        notes_ciphertext, notes_iv, notes_auth_tag, key_id, position, bill_account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             COALESCE($15, (SELECT COALESCE(max(position), -1) + 1 FROM vault WHERE user_id = $2)), $16)
     RETURNING id, kind, label, site, username, masked, key_id, position, created_at, updated_at,
               secret_updated_at, (notes_ciphertext IS NOT NULL) AS has_notes, bill_account_id`,
    [
      id,
      userId,
      cleanKind,
      cleanLabel,
      site ? String(site).trim() : null,
      username ? String(username).trim() : null,
      String(masked ?? "").trim() || defaultMask(cleanSecret, cleanKind),
      ciphertext,
      iv,
      authTag,
      noteBlob?.ciphertext ?? null,
      noteBlob?.iv ?? null,
      noteBlob?.authTag ?? null,
      ACTIVE_KEY_ID,
      position === null || position === undefined ? null : Number(position),
      billAccountId || null,
    ],
  );
  return toWire(row);
}

/**
 * Edit an entry. Omitting `secret` leaves the stored ciphertext untouched -- renaming a row or
 * fixing its site must not require re-typing the password, and re-encrypting an unchanged value
 * would churn the iv and falsify `secret_updated_at` for nothing.
 */
export async function updateEntry(userId, id, patch = {}) {
  const existing = await ownedRow(userId, id);
  if (!existing) return null;

  const fields = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  const kind = patch.kind === undefined ? existing.kind : normaliseKind(patch.kind, existing.kind);
  if (patch.kind !== undefined) set("kind", kind);

  if (patch.label !== undefined) {
    const cleanLabel = String(patch.label ?? "").trim();
    if (!cleanLabel) throw new Error("label cannot be blank");
    set("label", cleanLabel);
  }
  if (patch.site !== undefined) set("site", patch.site ? String(patch.site).trim() : null);
  if (patch.username !== undefined) {
    set("username", patch.username ? String(patch.username).trim() : null);
  }
  if (patch.position !== undefined) set("position", Number(patch.position));
  if (patch.billAccountId !== undefined) set("bill_account_id", patch.billAccountId || null);

  const newSecret =
    patch.secret === undefined || patch.secret === null ? null : String(patch.secret).trim();
  if (newSecret) {
    const { ciphertext, iv, authTag } = encrypt(newSecret, existing.id, userId);
    set("ciphertext", ciphertext);
    set("iv", iv);
    set("auth_tag", authTag);
    set("key_id", ACTIVE_KEY_ID);
    // The real answer to "when did I last change this password", and the only place it is
    // written -- so it can never drift into meaning "when did I last rename this row".
    set("secret_updated_at", new Date());
  }

  // `notes: ""` is a real instruction to clear them, distinct from omitting the field entirely,
  // which leaves whatever is stored alone. All three columns move together either way, so
  // migration 052's triple constraint holds.
  if (patch.notes !== undefined) {
    const cleanNotes = String(patch.notes ?? "").trim();
    const noteBlob = cleanNotes ? encrypt(cleanNotes, existing.id, userId, "notes") : null;
    set("notes_ciphertext", noteBlob?.ciphertext ?? null);
    set("notes_iv", noteBlob?.iv ?? null);
    set("notes_auth_tag", noteBlob?.authTag ?? null);
  }

  const derivedMask = /^•/.test(String(existing.masked ?? ""));
  if (patch.masked !== undefined) {
    const cleanMask = String(patch.masked ?? "").trim();
    set("masked", cleanMask || defaultMask(newSecret ?? "", kind));
  } else if (newSecret && derivedMask) {
    // The stored hint described the OLD value. Only re-derive it if it was a derived one to begin
    // with; a hand-written "NFCU checking ... 4821" is the owner's own words and stays.
    set("masked", defaultMask(newSecret, kind));
  } else if (patch.kind !== undefined && kind === "login" && derivedMask) {
    // Converting a bill reference into a login: a last-four mask carried over would still be
    // showing four real characters of what is now being treated as a password.
    set("masked", defaultMask("", "login"));
  }

  if (fields.length === 0) return toWire(existing);

  values.push(id, userId);
  const row = await one(
    `UPDATE vault SET ${fields.join(", ")}, updated_at = now()
      WHERE id = $${values.length - 1} AND user_id = $${values.length}
      RETURNING id, kind, label, site, username, masked, key_id, position, created_at, updated_at,
                secret_updated_at, (notes_ciphertext IS NOT NULL) AS has_notes, bill_account_id`,
    values,
  );
  return row ? toWire(row) : null;
}

export async function deleteEntry(userId, id) {
  const { rowCount } = await query("DELETE FROM vault WHERE id = $1 AND user_id = $2", [id, userId]);
  return rowCount > 0;
}

/**
 * Decrypt one entry and record that it happened.
 *
 * `credentialId` is required and not defaulted on purpose: it is the id of the passkey that just
 * passed a real assertion for this reveal, and requiring it here means there is no way to reach a
 * plaintext from a code path that skipped that step. The audit insert and the decrypt share one
 * transaction, so a reveal that is handed back to the caller is always a reveal that was written
 * down -- the audit row cannot be the thing that fails after the secret is already out.
 *
 * Notes come back with the password rather than costing a second assertion (Git #3242): they are
 * encrypted with the same key, in the same row, for the same reason, and the recovery codes that
 * end up in them are worth no less than the password they sit beside. One assertion, one row,
 * everything that row holds, one audit line saying so.
 */
export async function reveal(userId, id, { credentialId, ip = null, userAgent = null }) {
  if (!credentialId) throw new Error("reveal requires the credential that authorised it");
  const row = await ownedRow(userId, id);
  if (!row) return null;

  return transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO vault_reveals (vault_id, user_id, credential_id, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, at`,
      [row.id, userId, credentialId, ip, userAgent],
    );
    const audited = rows[0];
    // Deliberately after the audit insert: if the decrypt throws (a tampered row, a wrong key)
    // the transaction rolls back and no reveal is claimed -- and if the INSERT throws, we never
    // decrypt at all. Either way "a plaintext was returned" and "a row says so" stay in step.
    const value = decrypt(row);
    const notes = decryptNotes(row);
    const at = new Date(audited.at);
    return {
      id: row.id,
      kind: row.kind ?? "bill_reference",
      label: row.label,
      site: row.site,
      username: row.username ?? null,
      masked: row.masked,
      value,
      notes,
      revealId: audited.id,
      revealedAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + REVEAL_WINDOW_SECONDS * 1000).toISOString(),
      windowSeconds: REVEAL_WINDOW_SECONDS,
      clipboardClearSeconds: CLIPBOARD_CLEAR_SECONDS,
    };
  });
}

/**
 * Git #3271 (Vault room's house-grid tile): "lit while a reveal is open" -- read back from the
 * real vault_reveals audit trail rather than trusted from a client-side countdown, so a stale or
 * closed tab can never leave the tile lit. `at > now() - REVEAL_WINDOW_SECONDS` is the same real
 * 20-second window reveal() itself hands back as `expiresAt`, checked here across every entry
 * this user owns rather than one specific id -- the tile lights for ANY open reveal, not a
 * particular row.
 */
export async function hasOpenReveal(userId) {
  const row = await one(
    `SELECT 1
       FROM vault_reveals r
       JOIN vault v ON v.id = r.vault_id
      WHERE v.user_id = $1
        AND r.at > now() - ($2 || ' seconds')::interval
      LIMIT 1`,
    [userId, REVEAL_WINDOW_SECONDS],
  );
  return Boolean(row);
}

/** The audit trail for one entry, newest first. Reads its own table, never the ciphertext. */
export async function revealHistory(userId, id, limit = 20) {
  return many(
    `SELECT r.id, r.at, r.credential_id, r.ip, r.user_agent, c.label AS credential_label
       FROM vault_reveals r
       JOIN vault v ON v.id = r.vault_id
       LEFT JOIN webauthn_credentials c ON c.credential_id = r.credential_id
      WHERE r.vault_id = $1 AND v.user_id = $2
      ORDER BY r.at DESC
      LIMIT $3`,
    [id, userId, Math.min(Number(limit) || 20, 100)],
  );
}

// -- LastPass CSV import (Git #3247) -------------------------------------------------------
//
// #3242 shipped storage, search and reveal for real logins but deliberately no way to get an
// existing LastPass export in other than typing every row by hand -- and deliberately no MCP
// tool either (see this file's own header). This is the route the issue calls for instead: one
// authenticated, non-MCP request that parses a LastPass CSV in memory and calls createEntry (or
// updateEntry, for a re-import) per row. The raw upload is never written anywhere -- not to
// `media`, not to `captures`, not to a log line -- it exists only for the lifetime of this call.

/** A minimal RFC4180 CSV tokenizer -- LastPass quotes any field containing a comma, a quote or a
 *  newline (the `extra`/notes column routinely has all three), so a naive `.split(",")` silently
 *  shreds real rows. Doubled quotes (`""`) are the escape for a literal `"` inside a quoted
 *  field, same as every other CSV writer. */
function parseCsvRecords(text) {
  const clean = String(text ?? "").replace(/^\uFEFF/, ""); // strip a BOM if Excel added one
  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") pushField();
    else if (c === "\r") continue; // swallow; \n (or end of input) drives the record break
    else if (c === "\n") pushRecord();
    else field += c;
  }
  if (field.length > 0 || record.length > 0) pushRecord();

  // A trailing newline produces one bogus single-empty-field record; drop it rather than
  // pretending it's a blank row worth reporting a result for.
  return records.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** LastPass's own export header: `url,username,password,extra,name,grouping,fav`. Column order
 *  is read from the header row rather than assumed, so a re-ordered or partially-trimmed export
 *  (Google Sheets round-trip, etc.) still parses correctly. */
function parseLastPassCsv(text) {
  const records = parseCsvRecords(text);
  if (records.length === 0) throw new Error("The CSV is empty.");
  const header = records[0].map((h) => String(h ?? "").trim().toLowerCase());
  if (!header.includes("password")) {
    throw new Error('The CSV has no "password" column -- is this really a LastPass export?');
  }
  return records.slice(1).map((cols) => {
    const row = {};
    header.forEach((name, idx) => (row[name] = cols[idx] ?? ""));
    return row;
  });
}

/** The hostname a login's `site` is really about, so `https://www.navyfederal.org/login` and
 *  `navyfederal.org` are recognised as the same entry on a re-import. Falls back to the raw
 *  trimmed lowercase string when it isn't a URL at all, rather than dropping the match entirely. */
function normaliseSiteForMatch(site) {
  const s = String(site ?? "").trim().toLowerCase();
  if (!s) return "";
  try {
    return new URL(s.includes("://") ? s : `https://${s}`).hostname.replace(/^www\./, "");
  } catch {
    return s;
  }
}

function matchKey(site, username) {
  const s = normaliseSiteForMatch(site);
  const u = String(username ?? "").trim().toLowerCase();
  if (!s && !u) return null;
  return `${s}::${u}`;
}

/**
 * Import every `login` row of a LastPass CSV for one user.
 *
 * Re-importing the same file updates the matching existing entry (by site + username) rather
 * than creating a duplicate -- the issue flagged this as worth deciding, and a duplicate-free
 * re-import is the one that makes "just export again after adding a few passwords" a safe thing
 * to do. A row with no matching site/username creates a new entry, same as the add form.
 *
 * Every row's real outcome comes back (created/updated/error) so a partial import is visible
 * rather than silently swallowing the rows that failed -- csv row 4 having no password is a
 * fact worth showing, not a fact worth hiding behind an overall "done".
 */
export async function importLoginsFromCsv(userId, csvText) {
  const rows = parseLastPassCsv(csvText);

  const existing = await many(
    "SELECT id, site, username FROM vault WHERE user_id = $1 AND kind = 'login'",
    [userId],
  );
  const byKey = new Map();
  for (const row of existing) {
    const key = matchKey(row.site, row.username);
    if (key) byKey.set(key, row.id);
  }

  const results = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  rows.forEach((row, index) => {
    // CSV row numbers as a human would count them: 1 is the header, so the first data row is 2.
    const rowNumber = index + 2;
    const label = String(row.name ?? "").trim() || String(row.url ?? "").trim() || "Untitled login";
    const site = String(row.url ?? "").trim() || null;
    const username = String(row.username ?? "").trim() || null;
    const secret = String(row.password ?? "").trim();
    const notes = String(row.extra ?? "").trim();

    if (!site && !username && !secret && !String(row.name ?? "").trim()) {
      skipped++; // a genuinely blank line LastPass sometimes leaves at the end of the export
      return;
    }
    if (!secret) {
      errors++;
      results.push({ row: rowNumber, label, status: "error", error: "password is required" });
      return;
    }

    results.push({ row: rowNumber, label, site, username, secret, notes });
  });

  // Sequential, not Promise.all: each createEntry/updateEntry is its own INSERT/UPDATE, and a
  // real vault import running dozens of individual writes concurrently against the same table
  // for the same user buys nothing but row-lock contention.
  for (const pending of results) {
    if (pending.status === "error") continue;
    const { row, label, site, username, secret, notes } = pending;
    const key = matchKey(site, username);
    const existingId = key ? byKey.get(key) : null;
    try {
      let entry;
      if (existingId) {
        entry = await updateEntry(userId, existingId, { label, site, username, secret, notes });
        updated++;
        Object.assign(pending, { status: "updated", id: entry.id });
      } else {
        entry = await createEntry(userId, { kind: "login", label, site, username, secret, notes });
        created++;
        if (key) byKey.set(key, entry.id); // duplicate rows within the same file collapse to one
        Object.assign(pending, { status: "created", id: entry.id });
      }
    } catch (err) {
      errors++;
      Object.assign(pending, { status: "error", error: err.message });
    }
    delete pending.secret; // never let the plaintext linger in the result past its one write
  }

  return {
    results: results.map(({ secret: _secret, ...rest }) => rest),
    summary: { total: rows.length, created, updated, skipped, errors },
  };
}
