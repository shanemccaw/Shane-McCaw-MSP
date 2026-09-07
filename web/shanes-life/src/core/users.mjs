// Real accounts.
//
// There is deliberately no public sign-up route. This is Shane's own account-gated app
// (contract pack Section 9), so accounts are created out-of-band with `npm run create-user`.
// Anyone who reaches the app without credentials sees a login form and nothing else.

import { many, one, query } from "../db.mjs";
import { badRequest } from "../http.mjs";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../auth/passwords.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createUser({ email, name, password }) {
  const cleanEmail = String(email || "").trim();
  if (!EMAIL_RE.test(cleanEmail)) throw badRequest(`"${cleanEmail}" is not a valid email address`);
  const cleanName = String(name || "").trim();
  if (!cleanName) throw badRequest("name is required");
  const weak = validatePasswordStrength(password);
  if (weak) throw badRequest(weak);

  const existing = await one("SELECT id FROM users WHERE lower(email) = lower($1)", [cleanEmail]);
  if (existing) throw badRequest(`An account already exists for ${cleanEmail}`);

  const hashed = await hashPassword(password);
  return one(
    `INSERT INTO users (email, name, password_hash, password_salt, password_params)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, email, name, created_at`,
    [cleanEmail, cleanName.slice(0, 120), hashed.password_hash, hashed.password_salt, hashed.password_params],
  );
}

export async function setPassword(userId, password) {
  const weak = validatePasswordStrength(password);
  if (weak) throw badRequest(weak);
  const hashed = await hashPassword(password);
  const row = await one(
    `UPDATE users SET password_hash = $2, password_salt = $3, password_params = $4
      WHERE id = $1 RETURNING id, email`,
    [userId, hashed.password_hash, hashed.password_salt, hashed.password_params],
  );
  if (!row) throw badRequest("No such user");
  return row;
}

/**
 * Returns { ok: true, user } or { ok: false, reason }.
 * Reasons are for the audit log only -- the login route must answer with one generic message,
 * so the response never reveals whether an address has an account.
 */
export async function authenticate(email, password) {
  const row = await one(
    `SELECT id, email, name, is_active, password_hash, password_salt, password_params
       FROM users WHERE lower(email) = lower($1)`,
    [String(email || "").trim()],
  );
  if (!row) {
    // Still spend the work factor, so a missing account is not measurably faster than a wrong
    // password. Without this, response timing enumerates which addresses exist.
    await hashPassword(String(password || "x").slice(0, 512));
    return { ok: false, reason: "login_unknown_user" };
  }
  const good = await verifyPassword(String(password ?? ""), row);
  if (!good) return { ok: false, reason: "login_bad_password", userId: row.id };
  if (!row.is_active) return { ok: false, reason: "login_inactive", userId: row.id };

  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [row.id]);
  return { ok: true, user: { id: row.id, email: row.email, name: row.name } };
}

export async function listUsers() {
  return many(
    "SELECT id, email, name, is_active, created_at, last_login_at FROM users ORDER BY created_at",
  );
}

export async function recordAuthEvent({ email, userId = null, event, ip = null, userAgent = null }) {
  await query(
    "INSERT INTO auth_events (email, user_id, event, ip, user_agent) VALUES ($1,$2,$3,$4,$5)",
    [email ? String(email).slice(0, 320) : null, userId, event, ip, userAgent ? String(userAgent).slice(0, 400) : null],
  );
}
