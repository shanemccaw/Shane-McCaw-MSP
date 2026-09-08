// Important documents -- wills, life insurance, and the like (Git #3244, migration 052).
//
// Same real security tier as the bill-payment vault (src/core/vault.mjs), per the issue's own
// explicit lean: AES-256-GCM at rest, the key living outside the database (SL_VAULT_KEY), a
// fresh passkey assertion required to decrypt, and a real per-reveal audit row. This module
// reuses the SAME key rather than provisioning a second one -- there is exactly one real secret
// to protect (bank account numbers vs. policy/beneficiary/executor details) and one key to lose
// track of is enough.
//
// Different content type from the vault on purpose (the issue's own words: "these are real
// documents/policies, not credentials"): doc_type/name/location/summary_hint are real plaintext
// columns so the room's own search (findDocument/searchDocuments below) can answer "where's my
// will" directly, with no passkey prompt for a lookup that isn't actually secret. Only the
// genuinely sensitive part -- provider, policy number, beneficiary, executor, where the original
// sits, whatever else matters for that one document -- lives in the encrypted `details` blob,
// exactly the same reveal-gated shape as the vault's secret.
//
// Deliberately NOT exposed over MCP, same precedent and same reasoning as vault.mjs: a
// bearer-token plane reachable from a chat is the wrong place to read a will's contents or a
// beneficiary's name, and the passkey-per-reveal requirement below cannot be satisfied from a
// code path that never had a real browser assertion to begin with.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { many, one, query, transaction } from "../db.mjs";
import { badRequest } from "../http.mjs";

/** Same real window as the vault's own reveal (vault.mjs REVEAL_WINDOW_SECONDS) -- one shared
 *  UX idiom for "a secret is on screen," not a second number to keep in sync by hand. */
export const REVEAL_WINDOW_SECONDS = 20;

export const ACTIVE_KEY_ID = "v1";

const IV_BYTES = 12;
const KEY_BYTES = 32;

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
      "SL_VAULT_KEY is not set, so important documents cannot be encrypted or decrypted. This " +
        "is the same key the vault uses -- see .env.example.",
    );
  }
  if (config.vaultKey.length !== KEY_BYTES) {
    throw new VaultKeyUnavailable(
      `SL_VAULT_KEY decodes to ${config.vaultKey.length} bytes; AES-256-GCM needs exactly ${KEY_BYTES}.`,
    );
  }
  return config.vaultKey;
}

/** Binds a ciphertext to the exact row+owner it was written for -- distinct namespace from the
 *  vault's own AAD (vault.mjs's `aad`) so a row lifted from one table into the other fails the
 *  auth-tag check instead of decrypting cleanly, even though both use the same underlying key. */
function aad(id, userId) {
  return Buffer.from(`shanes-life:important-documents:${ACTIVE_KEY_ID}:${id}:${userId}`, "utf8");
}

function encrypt(plaintext, id, userId) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", requireKey(), iv);
  cipher.setAAD(aad(id, userId));
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function decrypt(row) {
  if (row.key_id !== ACTIVE_KEY_ID) {
    throw new VaultKeyUnavailable(
      `This document was encrypted with key "${row.key_id}", and the only key configured is ` +
        `"${ACTIVE_KEY_ID}". Restore that key before revealing it.`,
    );
  }
  const decipher = createDecipheriv("aes-256-gcm", requireKey(), row.iv);
  decipher.setAAD(aad(row.id, row.user_id));
  decipher.setAuthTag(row.auth_tag);
  return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
}

function normaliseDocType(docType) {
  const t = String(docType ?? "").trim().slice(0, 120);
  if (!t) throw badRequest("doc type is required");
  return t;
}

function normaliseName(name) {
  const n = String(name ?? "").trim().slice(0, 200);
  if (!n) throw badRequest("name is required");
  return n;
}

function normaliseLocation(location) {
  if (location === undefined || location === null) return null;
  const l = String(location).trim().slice(0, 300);
  return l || null;
}

function normaliseHint(hint) {
  if (hint === undefined || hint === null) return null;
  const h = String(hint).trim().slice(0, 200);
  return h || null;
}

function toWire(row) {
  return {
    id: row.id,
    docType: row.doc_type,
    name: row.name,
    location: row.location,
    summaryHint: row.summary_hint,
    hasDetails: Boolean(row.has_details ?? true),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRevealedAt: row.last_revealed_at ?? null,
    revealCount: Number(row.reveal_count ?? 0),
  };
}

/** Every document, no encrypted content -- what the room's own list renders. */
export async function listDocuments(userId) {
  const rows = await many(
    `SELECT d.id, d.doc_type, d.name, d.location, d.summary_hint, d.position,
            d.created_at, d.updated_at,
            r.last_revealed_at, COALESCE(r.reveal_count, 0) AS reveal_count
       FROM important_documents d
       LEFT JOIN (
         SELECT document_id, max(at) AS last_revealed_at, count(*) AS reveal_count
           FROM important_document_reveals
          GROUP BY document_id
       ) r ON r.document_id = d.id
      WHERE d.user_id = $1
      ORDER BY d.position, d.created_at`,
    [userId],
  );
  return rows.map(toWire);
}

/** Real, deterministic search over doc_type/name/location -- item 2 of the issue's scope
 *  ("where's my will", "who's my life insurance beneficiary" answered directly from stored
 *  data). Same idiom as things.mjs's searchThings: no AI call, case-insensitive substring,
 *  never touches the encrypted `details` blob. "Who's my beneficiary" is answered by finding
 *  the right document here, then a single Reveal tap for the encrypted specifics -- the same
 *  two-step shape the vault already uses for "which account is this bill's reference." */
export async function searchDocuments(userId, q) {
  const query_ = String(q ?? "").trim();
  if (!query_) return [];
  const rows = await many(
    `SELECT id, doc_type, name, location, summary_hint, position, created_at, updated_at
       FROM important_documents
      WHERE user_id = $1
        AND (lower(doc_type) LIKE '%' || lower($2) || '%'
             OR lower(name) LIKE '%' || lower($2) || '%'
             OR lower(coalesce(location, '')) LIKE '%' || lower($2) || '%')
      ORDER BY updated_at DESC
      LIMIT 50`,
    [userId, query_],
  );
  return rows.map(toWire);
}

async function ownedRow(userId, id) {
  return one(
    `SELECT id, user_id, doc_type, name, location, summary_hint, ciphertext, iv, auth_tag,
            key_id, position, created_at, updated_at
       FROM important_documents
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
}

export async function createDocument(
  userId,
  { docType, name, location = null, summaryHint = null, details, position = null },
) {
  const cleanType = normaliseDocType(docType);
  const cleanName = normaliseName(name);
  const cleanDetails = String(details ?? "").trim();
  if (!cleanDetails) throw badRequest("details is required -- what matters at a glance for this document");

  const id = randomUUID();
  const { ciphertext, iv, authTag } = encrypt(cleanDetails, id, userId);

  const row = await one(
    `INSERT INTO important_documents
       (id, user_id, doc_type, name, location, summary_hint, ciphertext, iv, auth_tag, key_id, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             COALESCE($11, (SELECT COALESCE(max(position), -1) + 1 FROM important_documents WHERE user_id = $2)))
     RETURNING id, doc_type, name, location, summary_hint, position, created_at, updated_at`,
    [
      id,
      userId,
      cleanType,
      cleanName,
      normaliseLocation(location),
      normaliseHint(summaryHint),
      ciphertext,
      iv,
      authTag,
      ACTIVE_KEY_ID,
      position === null || position === undefined ? null : Number(position),
    ],
  );
  return toWire(row);
}

/** Omitting `details` leaves the encrypted blob untouched -- correcting a location or the
 *  summary hint must not require re-typing the policy number, same reasoning as vault's
 *  updateEntry. */
export async function updateDocument(userId, id, patch = {}) {
  const existing = await ownedRow(userId, id);
  if (!existing) return null;

  const fields = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  if (patch.docType !== undefined) set("doc_type", normaliseDocType(patch.docType));
  if (patch.name !== undefined) set("name", normaliseName(patch.name));
  if (patch.location !== undefined) set("location", normaliseLocation(patch.location));
  if (patch.summaryHint !== undefined) set("summary_hint", normaliseHint(patch.summaryHint));
  if (patch.position !== undefined) set("position", Number(patch.position));

  const newDetails =
    patch.details === undefined || patch.details === null ? null : String(patch.details).trim();
  if (newDetails) {
    const { ciphertext, iv, authTag } = encrypt(newDetails, existing.id, userId);
    set("ciphertext", ciphertext);
    set("iv", iv);
    set("auth_tag", authTag);
    set("key_id", ACTIVE_KEY_ID);
  }

  if (fields.length === 0) return toWire(existing);

  values.push(id, userId);
  const row = await one(
    `UPDATE important_documents SET ${fields.join(", ")}, updated_at = now()
      WHERE id = $${values.length - 1} AND user_id = $${values.length}
      RETURNING id, doc_type, name, location, summary_hint, position, created_at, updated_at`,
    values,
  );
  return row ? toWire(row) : null;
}

export async function deleteDocument(userId, id) {
  const { rowCount } = await query(
    "DELETE FROM important_documents WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return rowCount > 0;
}

/** Decrypt one document's details and record that it happened -- same shape as vault.mjs's
 *  reveal: the audit insert and the decrypt share one transaction, so a reveal handed back to
 *  the caller is always one that was written down. */
export async function reveal(userId, id, { credentialId, ip = null, userAgent = null }) {
  if (!credentialId) throw new Error("reveal requires the credential that authorised it");
  const row = await ownedRow(userId, id);
  if (!row) return null;

  return transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO important_document_reveals (document_id, user_id, credential_id, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, at`,
      [row.id, userId, credentialId, ip, userAgent],
    );
    const audited = rows[0];
    const details = decrypt(row);
    const at = new Date(audited.at);
    return {
      id: row.id,
      docType: row.doc_type,
      name: row.name,
      location: row.location,
      details,
      revealId: audited.id,
      revealedAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + REVEAL_WINDOW_SECONDS * 1000).toISOString(),
      windowSeconds: REVEAL_WINDOW_SECONDS,
    };
  });
}

export async function revealHistory(userId, id, limit = 20) {
  return many(
    `SELECT r.id, r.at, r.credential_id, r.ip, r.user_agent, c.label AS credential_label
       FROM important_document_reveals r
       JOIN important_documents d ON d.id = r.document_id
       LEFT JOIN webauthn_credentials c ON c.credential_id = r.credential_id
      WHERE r.document_id = $1 AND d.user_id = $2
      ORDER BY r.at DESC
      LIMIT $3`,
    [id, userId, Math.min(Number(limit) || 20, 100)],
  );
}

/** Git #3271 (Vault room's house-grid tile, which folds Documents' own reveal in): same real
 *  "is a reveal open right now" read as vault.mjs's own hasOpenReveal(), against this module's
 *  separate important_document_reveals audit trail -- Documents keeps its own table/key/reveal
 *  path (see this file's header), so the Vault tile has to check both real reveal trails, not
 *  just vault.mjs's, to answer "is ANYTHING in the room currently revealed" honestly. */
export async function hasOpenReveal(userId) {
  const row = await one(
    `SELECT 1
       FROM important_document_reveals r
       JOIN important_documents d ON d.id = r.document_id
      WHERE d.user_id = $1
        AND r.at > now() - ($2 || ' seconds')::interval
      LIMIT 1`,
    [userId, REVEAL_WINDOW_SECONDS],
  );
  return Boolean(row);
}
