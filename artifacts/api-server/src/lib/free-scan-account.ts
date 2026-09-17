/**
 * free-scan-account.ts — Git #4329 (Feature #1352, Free Scan).
 *
 * The scoped login a paid Free Scan Prospect creates in the Checkout design's
 * `acctScreen` block: an emailed six-digit code proves the billing mailbox, a
 * password is set, and a second factor (authenticator app or text message) is
 * enrolled — after which the Prospect is signed in.
 *
 * ── What this account opens, and what it deliberately does not ───────────────
 * It opens ONE engagement: that Prospect's own `free_scan_engagements` row, and
 * through it their own scan results and the SOW they signed (the public
 * free-scan routes accept its session as a third identity door, beside the live
 * `sessionId` and the emailed return token — see `resolveActor` in
 * routes/public-free-scan-sow.ts).
 *
 * It is NOT a Portal login, per Shane's scope correction on #4329:
 *   • the credential lives in `free_scan_accounts`, never on `users`, so
 *     `/auth/login` has nothing to accept;
 *   • no `client_services` row is written, so `hasRealEntitlement()`
 *     (routes/auth.ts, #656) is exactly as closed as it was — `/setup-password`
 *     and `/forgot-password` still refuse this Prospect;
 *   • nothing is written to `mfa_enrollments`, so a later real Portal account
 *     starts clean;
 *   • the session token is an HS256 JWT signed with a key DERIVED for this
 *     purpose from JWT_SECRET, so `requireAuth` — which verifies with JWT_SECRET
 *     itself — rejects it as a bad signature, and it is only ever sent to
 *     `/api/public/free-scan/*` (cookie path).
 *
 * ── Security properties ───────────────────────────────────────────────────────
 *   - CSPRNG codes, only bcrypt hashes at rest, never logged or audited.
 *   - Every code's attempt budget is spent BEFORE the guess is judged, in a
 *     single conditional UPDATE, so a crash cannot hand out a free guess.
 *   - A resend supersedes: a new code replaces the old hash and resets its budget.
 *   - A completed account is never re-created or overwritten through the flow
 *     credential — the flow credential is not a recovery door.
 *   - If the billing address changes before the account is complete, every
 *     proof gathered against the old address is discarded.
 *   - `sessionVersion` is carried in every token and bumped on sign-out and on
 *     completion, so a stale token is dead server-side, not just client-side.
 *   - Password sign-in has a per-account lockout on top of the per-IP limiter.
 *   - Recovery of either factor (Git #4483) lives in free-scan-account-recovery.ts:
 *     the emailed code alone resets the password but never re-enrols a factor.
 */

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash } from "crypto";
import type { CookieOptions, Request, Response } from "express";
import { generateSecret, generateURI, verifySync } from "otplib";
import {
  db,
  freeScanAccountsTable,
  freeScanEngagementsTable,
  type FreeScanAccount,
  type FreeScanEngagement,
} from "@workspace/db";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { generateSixDigitCode } from "./purchase-account-flow.ts";
import { decryptTotp, encryptTotp, sendSmsOtp } from "../routes/mfa.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "auth" });

export const ACCOUNT_COOKIE = "fs_acct";
/** The only routes the session cookie is ever sent to. */
export const ACCOUNT_COOKIE_PATH = "/api/public/free-scan";

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const LOGIN_CHALLENGE_TTL_SECONDS = 10 * 60;
/** The design's own foot copy: "The code expires in ten minutes." */
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const SMS_CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// ── Stage ─────────────────────────────────────────────────────────────────────

export type AccountStage = "code" | "password" | "mfa" | "complete";

/** Where an account stands in the design's three substeps. Derived, never stored. */
export function accountStage(account: FreeScanAccount | null): AccountStage {
  if (!account || !account.emailVerifiedAt) return "code";
  if (!account.passwordHash) return "password";
  if (!account.mfaEnrolledAt) return "mfa";
  return "complete";
}

export async function loadAccountForEngagement(engagementId: number): Promise<FreeScanAccount | null> {
  const [row] = await db
    .select()
    .from(freeScanAccountsTable)
    .where(eq(freeScanAccountsTable.engagementId, engagementId))
    .limit(1);
  return row ?? null;
}

// ── Password policy (the design's three rules, verbatim) ──────────────────────

export function passwordMeetsPolicy(password: string): boolean {
  return password.length >= 12 && /[A-Z]/.test(password) && /[0-9]/.test(password);
}

// ── Step 1: emailed code ──────────────────────────────────────────────────────

export class FreeScanAccountError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/**
 * Issue a fresh code for this engagement's account, creating the account row on
 * first use. Returns the plaintext code exactly once, for the caller's email.
 */
export async function issueEmailCode(
  engagement: FreeScanEngagement,
  billingEmail: string,
): Promise<{ code: string; expiresAt: Date; account: FreeScanAccount }> {
  const email = billingEmail.trim().toLowerCase();
  if (!email) throw new FreeScanAccountError("email_missing");

  const existing = await loadAccountForEngagement(engagement.id);
  if (existing && accountStage(existing) === "complete") throw new FreeScanAccountError("account_exists");

  const code = generateSixDigitCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS);
  const now = new Date();

  if (!existing) {
    const [created] = await db
      .insert(freeScanAccountsTable)
      .values({ engagementId: engagement.id, email, emailCodeHash: codeHash, emailCodeExpiresAt: expiresAt })
      .onConflictDoNothing({ target: freeScanAccountsTable.engagementId })
      .returning();
    if (created) return { code, expiresAt, account: created };
  }

  const current = existing ?? (await loadAccountForEngagement(engagement.id));
  if (!current) throw new Error("free-scan account: row vanished after an insert conflict");
  if (accountStage(current) === "complete") throw new FreeScanAccountError("account_exists");

  const addressChanged = current.email !== email;
  const [updated] = await db
    .update(freeScanAccountsTable)
    .set({
      email,
      emailCodeHash: codeHash,
      emailCodeExpiresAt: expiresAt,
      emailCodeAttempts: 0,
      // Proof gathered against a different address proves nothing about this one.
      ...(addressChanged
        ? {
            emailVerifiedAt: null,
            passwordHash: null,
            passwordSetAt: null,
            mfaMethod: null,
            totpSecretEncrypted: null,
            phone: null,
            smsCodeHash: null,
            smsCodeExpiresAt: null,
            smsCodeAttempts: 0,
          }
        : {}),
      updatedAt: now,
    })
    .where(eq(freeScanAccountsTable.id, current.id))
    .returning();
  return { code, expiresAt, account: updated ?? current };
}

export type CodeCheck = "ok" | "invalid" | "expired" | "too_many_attempts" | "no_code";

/**
 * Judge an emailed code. The attempt is counted first, in the same statement
 * that proves the budget is not already spent.
 */
export async function checkEmailCode(account: FreeScanAccount, code: string): Promise<CodeCheck> {
  if (!account.emailCodeHash || !account.emailCodeExpiresAt) return "no_code";
  if (account.emailCodeExpiresAt.getTime() < Date.now()) return "expired";

  const [spent] = await db
    .update(freeScanAccountsTable)
    .set({ emailCodeAttempts: sql`${freeScanAccountsTable.emailCodeAttempts} + 1` })
    .where(and(eq(freeScanAccountsTable.id, account.id), lt(freeScanAccountsTable.emailCodeAttempts, MAX_CODE_ATTEMPTS)))
    .returning({ id: freeScanAccountsTable.id });
  if (!spent) return "too_many_attempts";

  if (!(await bcrypt.compare(code, account.emailCodeHash))) return "invalid";

  await db
    .update(freeScanAccountsTable)
    .set({ emailVerifiedAt: new Date(), emailCodeHash: null, emailCodeExpiresAt: null, updatedAt: new Date() })
    .where(eq(freeScanAccountsTable.id, account.id));
  return "ok";
}

// ── Step 2: password ──────────────────────────────────────────────────────────

export type SetPasswordResult = "ok" | "email_unverified" | "email_mismatch" | "email_in_use" | "account_exists" | "weak_password";

export async function setAccountPassword(
  account: FreeScanAccount,
  billingEmail: string,
  password: string,
): Promise<SetPasswordResult> {
  const stage = accountStage(account);
  if (stage === "complete") return "account_exists";
  if (stage === "code") return "email_unverified";
  // The address proven must still be the engagement's billing address.
  if (account.email !== billingEmail.trim().toLowerCase()) return "email_mismatch";
  if (!passwordMeetsPolicy(password)) return "weak_password";

  const [clash] = await db
    .select({ id: freeScanAccountsTable.id })
    .from(freeScanAccountsTable)
    .where(
      and(
        sql`lower(${freeScanAccountsTable.email}) = ${account.email}`,
        isNotNull(freeScanAccountsTable.passwordHash),
        sql`${freeScanAccountsTable.id} <> ${account.id}`,
      ),
    )
    .limit(1);
  if (clash) return "email_in_use";

  const passwordHash = await bcrypt.hash(password, 12);
  await db
    .update(freeScanAccountsTable)
    .set({ passwordHash, passwordSetAt: new Date(), updatedAt: new Date() })
    .where(eq(freeScanAccountsTable.id, account.id));
  return "ok";
}

// ── Step 3: second factor ─────────────────────────────────────────────────────

/**
 * Begin (or resume) authenticator-app enrollment. A pending secret is reused so a
 * refresh does not silently invalidate a key the Prospect already added.
 */
export async function beginTotpEnrollment(account: FreeScanAccount): Promise<{ secret: string; otpauthUri: string }> {
  let secret: string | null = null;
  if (account.mfaMethod === "totp" && account.totpSecretEncrypted) {
    try {
      secret = decryptTotp(account.totpSecretEncrypted);
    } catch (err) {
      log.warn({ err, accountId: account.id }, "free-scan account: pending TOTP secret unreadable — issuing a new one");
    }
  }
  if (!secret) {
    secret = generateSecret();
    await db
      .update(freeScanAccountsTable)
      .set({ mfaMethod: "totp", totpSecretEncrypted: encryptTotp(secret), updatedAt: new Date() })
      .where(eq(freeScanAccountsTable.id, account.id));
  }
  const otpauthUri = generateURI({ issuer: "Shane McCaw Consulting", label: account.email, secret });
  return { secret, otpauthUri };
}

export function totpValid(encryptedSecret: string | null, code: string): boolean {
  if (!encryptedSecret) return false;
  try {
    return verifySync({ token: code.replace(/\s/g, ""), secret: decryptTotp(encryptedSecret), epochTolerance: 30 }).valid;
  } catch {
    // otplib throws on a malformed token/secret (#3863) — that is a wrong code, not a 500.
    return false;
  }
}

async function markEnrolled(account: FreeScanAccount): Promise<FreeScanAccount> {
  const [updated] = await db
    .update(freeScanAccountsTable)
    .set({
      mfaEnrolledAt: new Date(),
      smsCodeHash: null,
      smsCodeExpiresAt: null,
      smsCodeAttempts: 0,
      sessionVersion: sql`${freeScanAccountsTable.sessionVersion} + 1`,
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(freeScanAccountsTable.id, account.id))
    .returning();
  return updated ?? account;
}

export async function completeTotpEnrollment(account: FreeScanAccount, code: string): Promise<FreeScanAccount | null> {
  if (accountStage(account) !== "mfa" || account.mfaMethod !== "totp") return null;
  if (!totpValid(account.totpSecretEncrypted, code)) return null;
  return markEnrolled(account);
}

/** E.164-ish normalisation: digits with an optional leading +. */
export function normalisePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export async function issueSmsCode(accountId: number, phone: string): Promise<void> {
  const code = generateSixDigitCode();
  await db
    .update(freeScanAccountsTable)
    .set({
      smsCodeHash: await bcrypt.hash(code, 10),
      smsCodeExpiresAt: new Date(Date.now() + SMS_CODE_TTL_MS),
      smsCodeAttempts: 0,
      updatedAt: new Date(),
    })
    .where(eq(freeScanAccountsTable.id, accountId));
  // The platform's one SMS sender (mfa.ts, Twilio). Throws on a real send failure.
  await sendSmsOtp(phone, code);
}

export async function beginSmsEnrollment(account: FreeScanAccount, phone: string): Promise<void> {
  await db
    .update(freeScanAccountsTable)
    .set({ mfaMethod: "sms", phone, totpSecretEncrypted: null, updatedAt: new Date() })
    .where(eq(freeScanAccountsTable.id, account.id));
  await issueSmsCode(account.id, phone);
}

export async function checkSmsCode(account: FreeScanAccount, code: string): Promise<CodeCheck> {
  if (!account.smsCodeHash || !account.smsCodeExpiresAt) return "no_code";
  if (account.smsCodeExpiresAt.getTime() < Date.now()) return "expired";
  const [spent] = await db
    .update(freeScanAccountsTable)
    .set({ smsCodeAttempts: sql`${freeScanAccountsTable.smsCodeAttempts} + 1` })
    .where(and(eq(freeScanAccountsTable.id, account.id), lt(freeScanAccountsTable.smsCodeAttempts, MAX_CODE_ATTEMPTS)))
    .returning({ id: freeScanAccountsTable.id });
  if (!spent) return "too_many_attempts";
  if (!(await bcrypt.compare(code, account.smsCodeHash))) return "invalid";
  await db
    .update(freeScanAccountsTable)
    .set({ smsCodeHash: null, smsCodeExpiresAt: null, updatedAt: new Date() })
    .where(eq(freeScanAccountsTable.id, account.id));
  return "ok";
}

export async function completeSmsEnrollment(account: FreeScanAccount, code: string): Promise<{ result: CodeCheck; account: FreeScanAccount | null }> {
  if (accountStage(account) !== "mfa" || account.mfaMethod !== "sms" || !account.phone) {
    return { result: "no_code", account: null };
  }
  const result = await checkSmsCode(account, code);
  if (result !== "ok") return { result, account: null };
  return { result, account: await markEnrolled(account) };
}

// ── Tokens ────────────────────────────────────────────────────────────────────

function signingKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  // Derived, so no token minted here can ever verify under requireAuth's key.
  return createHash("sha256").update(`free-scan-account-session:v1|${secret}`).digest();
}

type TokenType = "fsa_session" | "fsa_login";

interface AccountTokenClaims {
  typ: TokenType;
  aid: number;
  eid: number;
  ver: number;
}

function signToken(typ: TokenType, account: FreeScanAccount, ttlSeconds: number): string {
  const claims: AccountTokenClaims = { typ, aid: account.id, eid: account.engagementId, ver: account.sessionVersion };
  return jwt.sign(claims, signingKey(), { algorithm: "HS256", expiresIn: ttlSeconds });
}

function verifyToken(token: string, typ: TokenType): AccountTokenClaims | null {
  try {
    const claims = jwt.verify(token, signingKey(), { algorithms: ["HS256"] }) as Partial<AccountTokenClaims>;
    if (claims.typ !== typ || typeof claims.aid !== "number" || typeof claims.eid !== "number" || typeof claims.ver !== "number") {
      return null;
    }
    return claims as AccountTokenClaims;
  } catch {
    return null;
  }
}

async function loadLive(claims: AccountTokenClaims): Promise<{ account: FreeScanAccount; engagement: FreeScanEngagement } | null> {
  const [row] = await db
    .select({ account: freeScanAccountsTable, engagement: freeScanEngagementsTable })
    .from(freeScanAccountsTable)
    .innerJoin(freeScanEngagementsTable, eq(freeScanEngagementsTable.id, freeScanAccountsTable.engagementId))
    .where(eq(freeScanAccountsTable.id, claims.aid))
    .limit(1);
  if (!row) return null;
  if (row.account.engagementId !== claims.eid) return null;
  if (row.account.sessionVersion !== claims.ver) return null;
  if (accountStage(row.account) !== "complete") return null;
  // The account is the paid engagement's; an engagement that is somehow no
  // longer paid opens nothing.
  if (row.engagement.status !== "paid") return null;
  return row;
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Strict: every free-scan mutation is a JSON POST from this site's own pages.
    sameSite: "strict",
    path: ACCOUNT_COOKIE_PATH,
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

export function setAccountSessionCookie(res: Response, account: FreeScanAccount): void {
  res.cookie(ACCOUNT_COOKIE, signToken("fsa_session", account, SESSION_TTL_SECONDS), cookieOptions());
}

export function clearAccountSessionCookie(res: Response): void {
  const { maxAge: _maxAge, ...opts } = cookieOptions();
  res.clearCookie(ACCOUNT_COOKIE, opts);
}

/** The signed-in account behind this request's cookie, or null. Never throws. */
export async function resolveAccountSession(
  req: Request,
): Promise<{ account: FreeScanAccount; engagement: FreeScanEngagement } | null> {
  const raw = (req.cookies as Record<string, unknown> | undefined)?.[ACCOUNT_COOKIE];
  if (typeof raw !== "string" || !raw) return null;
  const claims = verifyToken(raw, "fsa_session");
  if (!claims) return null;
  try {
    return await loadLive(claims);
  } catch (err) {
    log.error({ err }, "free-scan account: session lookup failed");
    return null;
  }
}

/** Kill every outstanding session for this account. */
export async function revokeAccountSessions(accountId: number): Promise<void> {
  await db
    .update(freeScanAccountsTable)
    .set({ sessionVersion: sql`${freeScanAccountsTable.sessionVersion} + 1`, updatedAt: new Date() })
    .where(eq(freeScanAccountsTable.id, accountId));
}

// ── Sign-in ───────────────────────────────────────────────────────────────────

let dummyHashPromise: Promise<string> | null = null;
/** A real bcrypt(12) hash to compare against when no account matches, so timing says nothing. */
export function dummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash("free-scan-account:no-such-account", 12);
  return dummyHashPromise;
}

export type PasswordSignIn =
  | { ok: true; account: FreeScanAccount; challenge: string }
  | { ok: false; reason: "invalid" | "locked" };

/**
 * First half of sign-in. A wrong address and a wrong password are
 * indistinguishable to the caller; a bcrypt compare runs either way.
 */
export async function passwordSignIn(email: string, password: string): Promise<PasswordSignIn> {
  const normalised = email.trim().toLowerCase();
  const [account] = await db
    .select()
    .from(freeScanAccountsTable)
    .where(and(sql`lower(${freeScanAccountsTable.email}) = ${normalised}`, isNotNull(freeScanAccountsTable.mfaEnrolledAt)))
    .limit(1);

  if (!account || !account.passwordHash) {
    await bcrypt.compare(password, await dummyHash());
    return { ok: false, reason: "invalid" };
  }

  const check = await verifyAccountPassword(account, password);
  if (check !== "ok") return { ok: false, reason: check };

  if (account.mfaMethod === "sms" && account.phone) await issueSmsCode(account.id, account.phone);

  return { ok: true, account, challenge: signToken("fsa_login", account, LOGIN_CHALLENGE_TTL_SECONDS) };
}

/**
 * Judge an account's password under the per-account lockout. Shared by sign-in
 * and the recovery steps that require the password (#4483), so a guess made
 * through recovery spends the same budget as one made at sign-in.
 */
export async function verifyAccountPassword(account: FreeScanAccount, password: string): Promise<"ok" | "invalid" | "locked"> {
  if (!account.passwordHash) {
    await bcrypt.compare(password, await dummyHash());
    return "invalid";
  }
  if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) return "locked";

  if (!(await bcrypt.compare(password, account.passwordHash))) {
    const failures = account.failedLoginCount + 1;
    await db
      .update(freeScanAccountsTable)
      .set({
        failedLoginCount: failures >= LOCKOUT_THRESHOLD ? 0 : failures,
        lockedUntil: failures >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_DURATION_MS) : account.lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(freeScanAccountsTable.id, account.id));
    return failures >= LOCKOUT_THRESHOLD ? "locked" : "invalid";
  }

  await db
    .update(freeScanAccountsTable)
    .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(freeScanAccountsTable.id, account.id));
  return "ok";
}

export type SecondFactorSignIn =
  | { ok: true; account: FreeScanAccount; engagement: FreeScanEngagement }
  | { ok: false; reason: "challenge_invalid" | "code_invalid" | "code_expired" | "too_many_attempts" };

/** Second half of sign-in: the challenge from `passwordSignIn` plus a second-factor code. */
export async function secondFactorSignIn(challenge: string, code: string): Promise<SecondFactorSignIn> {
  const claims = verifyToken(challenge, "fsa_login");
  if (!claims) return { ok: false, reason: "challenge_invalid" };
  const live = await loadLive(claims);
  if (!live) return { ok: false, reason: "challenge_invalid" };

  const { account } = live;
  if (account.mfaMethod === "totp") {
    if (!totpValid(account.totpSecretEncrypted, code)) return { ok: false, reason: "code_invalid" };
  } else {
    const result = await checkSmsCode(account, code);
    if (result === "too_many_attempts") return { ok: false, reason: "too_many_attempts" };
    if (result === "expired" || result === "no_code") return { ok: false, reason: "code_expired" };
    if (result !== "ok") return { ok: false, reason: "code_invalid" };
  }

  const [updated] = await db
    .update(freeScanAccountsTable)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(freeScanAccountsTable.id, account.id))
    .returning();
  return { ok: true, account: updated ?? account, engagement: live.engagement };
}
