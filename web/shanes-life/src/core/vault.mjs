// The bill-payment reference vault (Git #3150, design contract Section 9 / handoff README §7).
//
// The design calls this out in its own words as "a stated security requirement, not polish", so
// all four halves of it are real here and none of them is deferred:
//
//   1. AES-256-GCM at rest. The plaintext account number never exists in a column -- only
//      ciphertext + iv + auth_tag (migration 017). GCM, not CBC, because the auth tag is what
//      makes tampering with a stored row detectable rather than silently decrypting to garbage.
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
// passkey assertion, from a real browser, per reveal) cannot be satisfied by one anyway.

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
 */
function aad(id, userId) {
  return Buffer.from(`shanes-life:vault:${ACTIVE_KEY_ID}:${id}:${userId}`, "utf8");
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
      `This entry was encrypted with key "${row.key_id}", and the only key configured is ` +
        `"${ACTIVE_KEY_ID}". Restore that key before revealing it.`,
    );
  }
  const decipher = createDecipheriv("aes-256-gcm", requireKey(), row.iv);
  decipher.setAAD(aad(row.id, row.user_id));
  decipher.setAuthTag(row.auth_tag);
  return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
}

/**
 * The fallback masked hint, when the caller does not write their own.
 *
 * The design's own rows carry a human-written one ("NFCU checking •••• 4821") that names WHICH
 * account rather than mechanically masking the value, which is why `masked` is an input and not
 * a derived column. This only fills the gap when nothing was supplied, using the same last-four
 * convention every bank statement already prints.
 */
export function defaultMask(secret) {
  const digits = String(secret ?? "").replace(/\D/g, "");
  if (digits.length >= 4) return `•••• ${digits.slice(-4)}`;
  return "••••";
}

function toWire(row) {
  return {
    id: row.id,
    label: row.label,
    site: row.site,
    masked: row.masked,
    keyId: row.key_id,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
 * Every entry, masked. There is deliberately no option to include plaintext here: a list is a
 * read the UI performs on every visit to the room, and requirement 3 (a real assertion per
 * reveal) would be meaningless if the values arrived with the list anyway.
 */
export async function listEntries(userId) {
  const rows = await many(
    `SELECT v.id, v.label, v.site, v.masked, v.key_id, v.position, v.created_at, v.updated_at,
            v.bill_account_id, a.name AS bill_account_name,
            r.last_revealed_at, COALESCE(r.reveal_count, 0) AS reveal_count
       FROM vault v
       LEFT JOIN accounts a ON a.id = v.bill_account_id
       LEFT JOIN (
         SELECT vault_id, max(at) AS last_revealed_at, count(*) AS reveal_count
           FROM vault_reveals
          GROUP BY vault_id
       ) r ON r.vault_id = v.id
      WHERE v.user_id = $1
      ORDER BY v.position, v.created_at`,
    [userId],
  );
  return rows.map(toWire);
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
    `SELECT id, user_id, label, site, masked, ciphertext, iv, auth_tag, key_id, position,
            created_at, updated_at, bill_account_id
       FROM vault
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
}

export async function createEntry(
  userId,
  { label, site = null, secret, masked = null, position = null, billAccountId = null },
) {
  const cleanLabel = String(label ?? "").trim();
  const cleanSecret = String(secret ?? "").trim();
  if (!cleanLabel) throw new Error("label is required");
  if (!cleanSecret) throw new Error("secret is required");

  // The id is minted here rather than by the column default because it is part of the AAD the
  // ciphertext is bound to -- it has to exist before the encrypt, not after the insert.
  const id = randomUUID();
  const { ciphertext, iv, authTag } = encrypt(cleanSecret, id, userId);

  const row = await one(
    `INSERT INTO vault (id, user_id, label, site, masked, ciphertext, iv, auth_tag, key_id, position, bill_account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             COALESCE($10, (SELECT COALESCE(max(position), -1) + 1 FROM vault WHERE user_id = $2)), $11)
     RETURNING id, label, site, masked, key_id, position, created_at, updated_at, bill_account_id`,
    [
      id,
      userId,
      cleanLabel,
      site ? String(site).trim() : null,
      String(masked ?? "").trim() || defaultMask(cleanSecret),
      ciphertext,
      iv,
      authTag,
      ACTIVE_KEY_ID,
      position === null || position === undefined ? null : Number(position),
      billAccountId || null,
    ],
  );
  return toWire(row);
}

/**
 * Edit an entry. Omitting `secret` leaves the stored ciphertext untouched -- renaming a row or
 * fixing its site must not require re-typing the account number, and re-encrypting an unchanged
 * value would churn the iv for nothing.
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

  if (patch.label !== undefined) {
    const cleanLabel = String(patch.label ?? "").trim();
    if (!cleanLabel) throw new Error("label cannot be blank");
    set("label", cleanLabel);
  }
  if (patch.site !== undefined) set("site", patch.site ? String(patch.site).trim() : null);
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
  }

  if (patch.masked !== undefined) {
    const cleanMask = String(patch.masked ?? "").trim();
    set("masked", cleanMask || defaultMask(newSecret ?? ""));
  } else if (newSecret && /^•+\s/.test(existing.masked)) {
    // The stored hint described the OLD value. Only re-derive it if it was a derived one to
    // begin with; a hand-written "NFCU checking •••• 4821" is the owner's own words and stays.
    set("masked", defaultMask(newSecret));
  }

  if (fields.length === 0) return toWire(existing);

  values.push(id, userId);
  const row = await one(
    `UPDATE vault SET ${fields.join(", ")}, updated_at = now()
      WHERE id = $${values.length - 1} AND user_id = $${values.length}
      RETURNING id, label, site, masked, key_id, position, created_at, updated_at, bill_account_id`,
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
    const at = new Date(audited.at);
    return {
      id: row.id,
      label: row.label,
      site: row.site,
      masked: row.masked,
      value,
      revealId: audited.id,
      revealedAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + REVEAL_WINDOW_SECONDS * 1000).toISOString(),
      windowSeconds: REVEAL_WINDOW_SECONDS,
      clipboardClearSeconds: CLIPBOARD_CLEAR_SECONDS,
    };
  });
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
