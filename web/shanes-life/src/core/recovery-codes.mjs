// Account-recovery codes -- the real fallback for a passkey-only app with no password (Git
// #3246). Ten single-use codes, minted at real account setup (or retroactively for an existing
// one), delivered by email; typing one back in recovers access with zero passkeys on the
// account. Redeeming one immediately invalidates AND regenerates the WHOLE set, not just the
// one code used -- standard recovery-code hygiene, and it means a partially-exposed mailed set
// cannot be replayed piecemeal after the first legitimate recovery.
//
// Hashed exactly like every other bearer secret in this app (src/auth/tokens.mjs's
// fingerprint/mintToken discipline) -- only the SHA-256 of the normalised code is ever written.

import { randomInt } from "node:crypto";
import { one, query } from "../db.mjs";
import { fingerprint } from "../auth/tokens.mjs";
import * as mailer from "./mailer.mjs";

export const CODE_COUNT = 10;

// Crockford-ish, minus visually ambiguous characters (0/O, 1/I/L) -- these get typed by hand
// from a printed or emailed page.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUP_LENGTH = 5;

function generateOneCode() {
  let raw = "";
  for (let i = 0; i < GROUP_LENGTH * 2; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, GROUP_LENGTH)}-${raw.slice(GROUP_LENGTH)}`;
}

/** Strip everything but real alphabet characters and upper-case, so "abcde fghjk" === "ABCDE-FGHJK". */
export function normalizeCode(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function hashCode(code) {
  return fingerprint(normalizeCode(code));
}

export async function countUnusedRecoveryCodes(userId) {
  const row = await one(
    "SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL",
    [userId],
  );
  return row?.n ?? 0;
}

export async function recoveryCodeStatus(userId) {
  const row = await one(
    `SELECT count(*) FILTER (WHERE used_at IS NULL)::int AS unused, max(created_at) AS generated_at
       FROM recovery_codes
      WHERE user_id = $1`,
    [userId],
  );
  return { unused: row?.unused ?? 0, generatedAt: row?.generated_at ?? null };
}

/**
 * Replace the ENTIRE set for this user with a fresh batch of CODE_COUNT codes -- any codes left
 * over from a previous batch (used or not) stop working the instant this runs. Emails the new
 * set to `email` when Graph mail is configured; returns the plaintext codes either way, so the
 * caller (a route response, or a terminal script) can show them once even if the email fails --
 * they are never stored or logged anywhere in plaintext, and this is the only place they exist.
 */
export async function generateRecoveryCodes(userId, email) {
  const codes = [];
  for (let i = 0; i < CODE_COUNT; i++) codes.push(generateOneCode());

  await query("DELETE FROM recovery_codes WHERE user_id = $1", [userId]);
  for (const code of codes) {
    await query("INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)", [userId, hashCode(code)]);
  }

  let emailSent = false;
  let emailError = null;
  if (email) {
    try {
      await mailer.sendMail({
        to: email,
        subject: "Shane's Life — your account recovery codes",
        text:
          `These ${CODE_COUNT} codes get you back into Shane's Life if you ever lose the device ` +
          `holding your passkey. Each one works once. Using any single code invalidates this ` +
          `whole set and mails you a brand-new one, so keep this email until you use one.\n\n` +
          codes.join("\n") +
          `\n\nIf you did not request these, someone already has enough access to your account ` +
          `to ask for them -- check Settings -> Passkeys.`,
      });
      emailSent = true;
    } catch (err) {
      emailError = err.message;
    }
  }

  return { codes, emailSent, emailError };
}

/**
 * Atomically claim a code -- the UPDATE ... WHERE used_at IS NULL RETURNING is what makes
 * "single use" true under two simultaneous redemptions, the same pattern webauthn.mjs's
 * consumeChallenge and credentials.mjs's consumeEnrollment already use.
 */
export async function consumeRecoveryCode(rawCode) {
  const normalized = normalizeCode(rawCode);
  if (!normalized) return null;
  return one(
    `UPDATE recovery_codes SET used_at = now()
      WHERE code_hash = $1 AND used_at IS NULL
      RETURNING id, user_id`,
    [hashCode(normalized)],
  );
}
