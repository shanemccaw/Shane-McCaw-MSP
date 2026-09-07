// Real accounts.
//
// There is deliberately no public sign-up route. This is Shane's own account-gated app
// (contract Section 9), so accounts are created out-of-band with `npm run create-user`.
// Anyone who reaches the app without a registered passkey sees the sign-in screen and nothing
// else.
//
// There is no password here at all -- not a weaker one, none. Sign-in is a WebAuthn assertion
// (src/auth/webauthn.mjs); a user row with no passkey registered against it simply cannot sign
// in, which is exactly right for the window between `create-user` and enrolment.

import { many, one, query } from "../db.mjs";
import { badRequest } from "../http.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createUser({ email, name }) {
  const cleanEmail = String(email || "").trim();
  if (!EMAIL_RE.test(cleanEmail)) throw badRequest(`"${cleanEmail}" is not a valid email address`);
  const cleanName = String(name || "").trim();
  if (!cleanName) throw badRequest("name is required");

  const existing = await one("SELECT id FROM users WHERE lower(email) = lower($1)", [cleanEmail]);
  if (existing) throw badRequest(`An account already exists for ${cleanEmail}`);

  return one(
    `INSERT INTO users (email, name)
     VALUES ($1,$2)
     RETURNING id, email, name, created_at`,
    [cleanEmail, cleanName.slice(0, 120)],
  );
}

export async function findUserByEmail(email) {
  return one(
    "SELECT id, email, name, is_active, created_at FROM users WHERE lower(email) = lower($1)",
    [String(email || "").trim()],
  );
}

export async function markSignedIn(userId) {
  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
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
