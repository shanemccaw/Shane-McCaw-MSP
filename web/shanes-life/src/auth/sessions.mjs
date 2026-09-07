// Real server-side sessions. The browser holds an opaque random token in an HttpOnly cookie;
// the database holds only its SHA-256, so a database read yields nothing a person can sign in
// with. Sessions are revocable (sign out, sign out everywhere) -- which a stateless JWT is not,
// and revocability is the reason this app does not use one.

import { config } from "../config.mjs";
import { one, query } from "../db.mjs";
import { fingerprint, mintToken } from "./tokens.mjs";

export const SESSION_COOKIE = "sl_session";

export async function createSession(userId, { userAgent, ip, credentialId = null } = {}) {
  const token = mintToken(32);
  const ttlSeconds = config.sessionTtlDays * 24 * 60 * 60;
  const row = await one(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip, credential_id, last_verified_at)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval, $4, $5, $6, now())
     RETURNING id, expires_at`,
    [userId, fingerprint(token), String(ttlSeconds), userAgent ?? null, ip ?? null, credentialId],
  );
  return { token, ttlSeconds, sessionId: row.id, expiresAt: row.expires_at };
}

/**
 * Record that this session just passed a fresh passkey assertion.
 *
 * The vault reveal is why this exists: the design requires a NEW assertion per reveal even inside
 * a live session, so "how long ago did they last actually prove it was them" has to be a real
 * stored fact rather than an assumption that a valid cookie implies presence.
 */
export async function markSessionVerified(token, credentialId = null) {
  if (!token) return null;
  const row = await one(
    `UPDATE sessions
        SET last_verified_at = now(), credential_id = COALESCE($2, credential_id)
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
      RETURNING last_verified_at`,
    [fingerprint(token), credentialId],
  );
  return row?.last_verified_at ?? null;
}

/**
 * Resolve a cookie token to a live user, and slide the last-seen stamp forward.
 * Returns null for missing / unknown / expired / revoked / deactivated -- the caller must not
 * be able to tell those apart.
 */
export async function resolveSession(token) {
  if (!token) return null;
  const row = await one(
    `SELECT s.id AS session_id, s.expires_at, s.credential_id, s.last_verified_at,
            u.id, u.email, u.name, u.is_active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()`,
    [fingerprint(token)],
  );
  if (!row || !row.is_active) return null;

  // Sliding window: touch at most once a minute so a chatty client is not a write per request.
  await query(
    `UPDATE sessions
        SET last_seen_at = now()
      WHERE id = $1 AND last_seen_at < now() - interval '1 minute'`,
    [row.session_id],
  );

  return {
    sessionId: row.session_id,
    credentialId: row.credential_id,
    lastVerifiedAt: row.last_verified_at,
    user: { id: row.id, email: row.email, name: row.name },
  };
}

export async function revokeSession(token) {
  if (!token) return;
  await query(
    "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [fingerprint(token)],
  );
}

export async function revokeAllSessions(userId) {
  const { rowCount } = await query(
    "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
  return rowCount;
}

/** Housekeeping: drop rows that can never authenticate again. Called on a slow timer. */
export async function purgeDeadSessions() {
  const { rowCount } = await query(
    `DELETE FROM sessions
      WHERE expires_at < now() - interval '7 days'
         OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`,
  );
  return rowCount;
}
