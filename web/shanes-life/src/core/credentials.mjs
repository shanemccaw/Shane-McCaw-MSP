// Real passkey storage: registered credentials, and the single-use out-of-band tokens that
// bootstrap the first one.
//
// The enrolment token is the actual security control on registration (see the note at the top of
// src/auth/webauthn.mjs about why attestation is not verified). It is minted at a real terminal
// on Shane's own machine by `npm run enroll-passkey`, shown once, single-use, and expires. There
// is no route anywhere that mints one from the browser -- if there were, a passkey-only app
// would have a self-service enrolment path, which is a password-reset email with extra steps.

import { many, one, query } from "../db.mjs";
import { badRequest } from "../http.mjs";
import { fingerprint, mintToken } from "../auth/tokens.mjs";

export const ENROLLMENT_TTL_MINUTES = 30;

export async function listCredentials(userId) {
  return many(
    `SELECT id, credential_id, label, transports, backed_up, created_at, last_used_at
       FROM webauthn_credentials
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY created_at`,
    [userId],
  );
}

export async function countCredentials(userId) {
  const row = await one(
    "SELECT count(*)::int AS n FROM webauthn_credentials WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
  return row?.n ?? 0;
}

export async function findCredential(credentialId) {
  return one(
    `SELECT c.id, c.user_id, c.credential_id, c.public_key, c.sign_count, c.label,
            u.email, u.name, u.is_active
       FROM webauthn_credentials c
       JOIN users u ON u.id = c.user_id
      WHERE c.credential_id = $1 AND c.revoked_at IS NULL`,
    [String(credentialId)],
  );
}

export async function storeCredential(userId, credential, label = "Passkey") {
  return one(
    `INSERT INTO webauthn_credentials
       (user_id, credential_id, public_key, sign_count, transports, aaguid, label, backed_up)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, credential_id, label, created_at`,
    [
      userId,
      credential.credentialId,
      credential.publicKey,
      credential.signCount,
      credential.transports,
      credential.aaguid,
      String(label || "Passkey").slice(0, 80),
      credential.backedUp,
    ],
  );
}

export async function touchCredential(credentialId, signCount, backedUp) {
  await query(
    `UPDATE webauthn_credentials
        SET sign_count = GREATEST(sign_count, $2), last_used_at = now(), backed_up = $3
      WHERE credential_id = $1`,
    [credentialId, Number(signCount || 0), Boolean(backedUp)],
  );
}

/**
 * Revoking the last passkey would lock the account out of an app that has no other way in, so it
 * is refused. Adding the replacement first is the real answer, and the error says so.
 */
export async function revokeCredential(userId, id) {
  const remaining = await countCredentials(userId);
  if (remaining <= 1) {
    throw badRequest(
      "That is the only passkey on this account. Add another one first — there is no password to fall back on.",
    );
  }
  const row = await one(
    `UPDATE webauthn_credentials SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id, credential_id, label`,
    [id, userId],
  );
  if (!row) throw badRequest("No such passkey.");
  return row;
}

// ---------------------------------------------------------------------------
// enrolment tokens
// ---------------------------------------------------------------------------

/** Returns the raw token exactly once. Only its SHA-256 is written. */
export async function mintEnrollment(userId, label = "Passkey") {
  const token = mintToken(32);
  const row = await one(
    `INSERT INTO webauthn_enrollments (user_id, token_hash, label, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)
     RETURNING id, expires_at`,
    [userId, fingerprint(token), String(label || "Passkey").slice(0, 80), String(ENROLLMENT_TTL_MINUTES)],
  );
  return { token, id: row.id, expiresAt: row.expires_at };
}

/** Look up a live enrolment without consuming it -- used to build the registration options. */
export async function peekEnrollment(token) {
  if (!token) return null;
  return one(
    `SELECT e.id, e.user_id, e.label, u.email, u.name, u.is_active
       FROM webauthn_enrollments e
       JOIN users u ON u.id = e.user_id
      WHERE e.token_hash = $1 AND e.used_at IS NULL AND e.expires_at > now()`,
    [fingerprint(token)],
  );
}

/**
 * Consume it, atomically. Same shape as consumeChallenge: the UPDATE ... WHERE used_at IS NULL
 * RETURNING is what makes "single use" true under two simultaneous requests rather than merely
 * intended.
 */
export async function consumeEnrollment(token, credentialId) {
  if (!token) return null;
  return one(
    `UPDATE webauthn_enrollments
        SET used_at = now(), credential_id = $2
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING id, user_id, label`,
    [fingerprint(token), credentialId ?? null],
  );
}
