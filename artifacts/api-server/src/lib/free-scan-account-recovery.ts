/**
 * free-scan-account-recovery.ts — Git #4483 (Feature #1352, Free Scan).
 *
 * Self-serve recovery for the scoped Free Scan engagement account (#4329,
 * lib/free-scan-account.ts). Before this, a Prospect who had paid for a SOW and
 * then lost their password or their phone had no way back to their engagement
 * short of Shane deleting the `free_scan_accounts` row by hand.
 *
 * Everything here reads and writes `free_scan_accounts` only. It does not touch
 * `/auth/forgot-password`, `users`, `mfa_enrollments` or `client_services`, so
 * the #656 entitlement gate is exactly as closed as #4329 left it.
 *
 * ── The two recoveries, and why they are not symmetrical ──────────────────────
 * The account has two factors: the password and the enrolled second factor. The
 * emailed code proves the mailbox, which is neither of them. So:
 *
 *   Lost password — emailed code -> new password. Sessions are revoked and the
 *     Prospect is NOT signed in: they sign in with the new password AND their
 *     existing second factor. Mailbox access alone therefore never opens the
 *     engagement.
 *
 *   Lost authenticator — emailed code + the CURRENT password, then an operator
 *     approval made after an identity check outside this request (the out-of-band
 *     step), then — within the approval window — emailed code + password again,
 *     and only then may a replacement factor be enrolled. The emailed code alone
 *     can never both reset the password and re-enrol a factor: a password reset
 *     cancels any pending or approved factor reset, so a mailbox-only attacker who
 *     resets the password lands back in front of the operator check.
 *
 * ── Security properties ───────────────────────────────────────────────────────
 *   - Recovery codes are CSPRNG, bcrypt-hashed, never logged, and have their own
 *     columns — a creation code can never be spent as a recovery code or vice versa.
 *   - The attempt is counted before the guess is judged (one conditional UPDATE).
 *   - Per-account send cap (RECOVERY_SENDS_PER_WINDOW per day, one per minute) on
 *     top of the per-IP limiter, so distributed guessing gets a bounded number of
 *     codes to guess at.
 *   - "Is there an account at this address?" is never answered: send-code replies
 *     the same either way, and every wrong verify reads as `invalid`.
 *   - A recovery token is bound to `recovery_nonce`. Every consuming action
 *     compare-and-swaps the nonce, so a token is single-use and a fresh code
 *     verification invalidates every older token.
 *   - The replacement factor is held in `pending_*` columns and only swapped in
 *     once proven; the live factor is never overwritten by an unproven one.
 *   - `session_version` is bumped on a password reset and on a factor
 *     replacement, killing every outstanding session and sign-in challenge.
 */

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { generateSecret, generateURI } from "otplib";
import {
  db,
  freeScanAccountsTable,
  freeScanEngagementsTable,
  tenantsTable,
  type FreeScanAccount,
  type FreeScanEngagement,
} from "@workspace/db";
import { and, desc, eq, gt, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { generateSixDigitCode } from "./purchase-account-flow.ts";
import { encryptTotp, decryptTotp } from "../routes/mfa.ts";
import {
  checkSmsCode,
  dummyHash,
  issueSmsCode,
  MAX_CODE_ATTEMPTS,
  passwordMeetsPolicy,
  totpValid,
  verifyAccountPassword,
} from "./free-scan-account.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "auth" });

export const RECOVERY_CODE_TTL_MS = 10 * 60 * 1000;
const RECOVERY_TOKEN_TTL_SECONDS = 20 * 60;
export const RECOVERY_SENDS_PER_WINDOW = 5;
const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECOVERY_RESEND_GAP_MS = 60 * 1000;
/** How long an operator approval stays usable before the Prospect must ask again. */
export const MFA_RESET_APPROVAL_TTL_MS = 72 * 60 * 60 * 1000;

// ── Lookup ────────────────────────────────────────────────────────────────────

/** Only a COMPLETE account is recoverable; an incomplete one finishes setup instead. */
async function loadCompleteAccountByEmail(email: string): Promise<FreeScanAccount | null> {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return null;
  const [row] = await db
    .select()
    .from(freeScanAccountsTable)
    .where(and(sql`lower(${freeScanAccountsTable.email}) = ${normalised}`, isNotNull(freeScanAccountsTable.mfaEnrolledAt)))
    .limit(1);
  return row ?? null;
}

export type MfaResetState = "none" | "pending" | "approved" | "approval_expired" | "denied";

export function mfaResetState(account: FreeScanAccount, now = Date.now()): MfaResetState {
  switch (account.mfaResetStatus) {
    case "pending":
      return "pending";
    case "denied":
      return "denied";
    case "approved":
      return account.mfaResetApprovalExpiresAt && account.mfaResetApprovalExpiresAt.getTime() > now ? "approved" : "approval_expired";
    default:
      return "none";
  }
}

/** Every column a password reset or a finished factor replacement clears. */
const CLEARED_MFA_RESET = {
  mfaResetStatus: null,
  mfaResetRequestedAt: null,
  mfaResetDecidedAt: null,
  mfaResetDecidedBy: null,
  mfaResetDecisionNote: null,
  mfaResetApprovalExpiresAt: null,
  pendingMfaMethod: null,
  pendingTotpSecretEncrypted: null,
  pendingPhone: null,
} as const;

// ── Step 1: the emailed recovery code ─────────────────────────────────────────

export type RecoveryCodeIssue =
  | { status: "sent"; code: string; expiresAt: Date; account: FreeScanAccount }
  | { status: "no_account" }
  | { status: "throttled"; account: FreeScanAccount };

/**
 * Issue a recovery code for the complete account at this address. The caller
 * must answer the Prospect identically for every status.
 */
export async function issueRecoveryCode(email: string): Promise<RecoveryCodeIssue> {
  const account = await loadCompleteAccountByEmail(email);
  if (!account) {
    // Same bcrypt cost as a real issue, so the reply's timing says nothing.
    await bcrypt.hash("free-scan-account-recovery:no-such-account", 10);
    return { status: "no_account" };
  }

  const code = generateSixDigitCode();
  const codeHash = await bcrypt.hash(code, 10);
  const now = Date.now();
  const nowDate = new Date(now);
  const expiresAt = new Date(now + RECOVERY_CODE_TTL_MS);
  const windowCutoff = new Date(now - RECOVERY_WINDOW_MS);
  // A code issued less than a minute ago expires later than this.
  const resendBound = new Date(now + RECOVERY_CODE_TTL_MS - RECOVERY_RESEND_GAP_MS);
  const t = freeScanAccountsTable;
  const windowExpired = or(isNull(t.recoveryCodeWindowStartedAt), lt(t.recoveryCodeWindowStartedAt, windowCutoff));

  // The cap and the resend gap are judged in the same statement that spends them,
  // so two concurrent requests cannot both slip under the cap.
  const [updated] = await db
    .update(t)
    .set({
      recoveryCodeHash: codeHash,
      recoveryCodeExpiresAt: expiresAt,
      recoveryCodeAttempts: 0,
      recoveryCodeSends: sql`CASE WHEN ${windowExpired} THEN 1 ELSE ${t.recoveryCodeSends} + 1 END`,
      recoveryCodeWindowStartedAt: sql`CASE WHEN ${windowExpired} THEN ${nowDate.toISOString()}::timestamptz ELSE ${t.recoveryCodeWindowStartedAt} END`,
      updatedAt: nowDate,
    })
    .where(
      and(
        eq(t.id, account.id),
        isNotNull(t.mfaEnrolledAt),
        or(windowExpired, lt(t.recoveryCodeSends, RECOVERY_SENDS_PER_WINDOW)),
        or(isNull(t.recoveryCodeExpiresAt), lte(t.recoveryCodeExpiresAt, resendBound)),
      ),
    )
    .returning();

  if (!updated) return { status: "throttled", account };
  return { status: "sent", code, expiresAt, account: updated };
}

export type RecoveryCodeCheck =
  | { ok: true; account: FreeScanAccount; engagement: FreeScanEngagement; token: string }
  | { ok: false; reason: "invalid" | "too_many_attempts"; account: FreeScanAccount | null };

/**
 * Judge a recovery code. On success mint a fresh nonce — which invalidates every
 * older recovery token — and discard any half-proven replacement factor.
 */
export async function checkRecoveryCode(email: string, code: string): Promise<RecoveryCodeCheck> {
  const account = await loadCompleteAccountByEmail(email);
  if (!account || !account.recoveryCodeHash || !account.recoveryCodeExpiresAt) {
    await bcrypt.compare(code, await dummyHash());
    return { ok: false, reason: "invalid", account };
  }
  if (account.recoveryCodeExpiresAt.getTime() < Date.now()) return { ok: false, reason: "invalid", account };

  const t = freeScanAccountsTable;
  const [spent] = await db
    .update(t)
    .set({ recoveryCodeAttempts: sql`${t.recoveryCodeAttempts} + 1` })
    .where(and(eq(t.id, account.id), eq(t.recoveryCodeHash, account.recoveryCodeHash), lt(t.recoveryCodeAttempts, MAX_CODE_ATTEMPTS)))
    .returning({ id: t.id });
  if (!spent) return { ok: false, reason: "too_many_attempts", account };

  if (!(await bcrypt.compare(code, account.recoveryCodeHash))) return { ok: false, reason: "invalid", account };

  const nonce = randomBytes(24).toString("base64url");
  const [updated] = await db
    .update(t)
    .set({
      recoveryNonce: nonce,
      recoveryCodeHash: null,
      recoveryCodeExpiresAt: null,
      pendingMfaMethod: null,
      pendingTotpSecretEncrypted: null,
      pendingPhone: null,
      updatedAt: new Date(),
    })
    // The hash must still be the one just judged — a resend in between supersedes it.
    .where(and(eq(t.id, account.id), eq(t.recoveryCodeHash, account.recoveryCodeHash)))
    .returning();
  if (!updated) return { ok: false, reason: "invalid", account };

  const [engagement] = await db.select().from(freeScanEngagementsTable).where(eq(freeScanEngagementsTable.id, updated.engagementId)).limit(1);
  if (!engagement || engagement.status !== "paid") return { ok: false, reason: "invalid", account };

  return { ok: true, account: updated, engagement, token: signRecoveryToken(updated, nonce) };
}

// ── Recovery token ────────────────────────────────────────────────────────────

interface RecoveryClaims {
  typ: "fsa_recover";
  aid: number;
  eid: number;
  rn: string;
}

function recoveryKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  // A key of its own: a recovery token is not a session, a sign-in challenge, or
  // anything requireAuth could verify.
  return createHash("sha256").update(`free-scan-account-recovery:v1|${secret}`).digest();
}

function signRecoveryToken(account: FreeScanAccount, nonce: string): string {
  const claims: RecoveryClaims = { typ: "fsa_recover", aid: account.id, eid: account.engagementId, rn: nonce };
  return jwt.sign(claims, recoveryKey(), { algorithm: "HS256", expiresIn: RECOVERY_TOKEN_TTL_SECONDS });
}

function nonceMatches(stored: string | null, presented: string): boolean {
  if (!stored) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface RecoveryContext {
  account: FreeScanAccount;
  engagement: FreeScanEngagement;
  nonce: string;
}

/** The account a recovery token opens, or null. Never throws. */
export async function resolveRecoveryToken(token: string): Promise<RecoveryContext | null> {
  let claims: Partial<RecoveryClaims>;
  try {
    claims = jwt.verify(token, recoveryKey(), { algorithms: ["HS256"] }) as Partial<RecoveryClaims>;
  } catch {
    return null;
  }
  if (claims.typ !== "fsa_recover" || typeof claims.aid !== "number" || typeof claims.eid !== "number" || typeof claims.rn !== "string") {
    return null;
  }
  try {
    const [row] = await db
      .select({ account: freeScanAccountsTable, engagement: freeScanEngagementsTable })
      .from(freeScanAccountsTable)
      .innerJoin(freeScanEngagementsTable, eq(freeScanEngagementsTable.id, freeScanAccountsTable.engagementId))
      .where(eq(freeScanAccountsTable.id, claims.aid))
      .limit(1);
    if (!row) return null;
    if (row.account.engagementId !== claims.eid) return null;
    if (!row.account.mfaEnrolledAt) return null;
    if (row.engagement.status !== "paid") return null;
    if (!nonceMatches(row.account.recoveryNonce, claims.rn)) return null;
    return { account: row.account, engagement: row.engagement, nonce: claims.rn };
  } catch (err) {
    log.error({ err }, "free-scan account recovery: token lookup failed");
    return null;
  }
}

// ── Lost password ─────────────────────────────────────────────────────────────

export type PasswordReset =
  | { ok: true; account: FreeScanAccount; token: string; cancelledMfaReset: MfaResetState }
  | { ok: false; reason: "weak_password" | "token_invalid" };

/**
 * Set a new password on the strength of the emailed code. Revokes every session,
 * clears the lockout, and cancels any factor reset in flight. Does not sign in.
 * Returns a fresh recovery token so the Prospect can go straight on to report a
 * lost authenticator too — which still needs the operator approval.
 */
export async function resetPasswordWithRecovery(ctx: RecoveryContext, password: string): Promise<PasswordReset> {
  if (!passwordMeetsPolicy(password)) return { ok: false, reason: "weak_password" };
  const passwordHash = await bcrypt.hash(password, 12);
  const nextNonce = randomBytes(24).toString("base64url");
  const cancelled = mfaResetState(ctx.account);

  const t = freeScanAccountsTable;
  const [updated] = await db
    .update(t)
    .set({
      passwordHash,
      passwordSetAt: new Date(),
      sessionVersion: sql`${t.sessionVersion} + 1`,
      failedLoginCount: 0,
      lockedUntil: null,
      recoveryNonce: nextNonce,
      ...CLEARED_MFA_RESET,
      updatedAt: new Date(),
    })
    .where(and(eq(t.id, ctx.account.id), eq(t.recoveryNonce, ctx.nonce)))
    .returning();
  if (!updated) return { ok: false, reason: "token_invalid" };
  return { ok: true, account: updated, token: signRecoveryToken(updated, nextNonce), cancelledMfaReset: cancelled };
}

// ── Lost authenticator: the request ───────────────────────────────────────────

export type MfaResetRequest =
  | { ok: true; state: "requested" | "already_pending" | "already_approved"; account: FreeScanAccount }
  | { ok: false; reason: "invalid_password" | "account_locked" | "token_invalid" };

/**
 * Ask for the second factor to be replaced. Needs the emailed code (the token)
 * AND the current password; lodges a request an operator must approve.
 */
export async function requestMfaReset(ctx: RecoveryContext, password: string): Promise<MfaResetRequest> {
  const pw = await verifyAccountPassword(ctx.account, password);
  if (pw === "locked") return { ok: false, reason: "account_locked" };
  if (pw !== "ok") return { ok: false, reason: "invalid_password" };

  const state = mfaResetState(ctx.account);
  if (state === "pending") return { ok: true, state: "already_pending", account: ctx.account };
  if (state === "approved") return { ok: true, state: "already_approved", account: ctx.account };

  const t = freeScanAccountsTable;
  const [updated] = await db
    .update(t)
    .set({
      mfaResetStatus: "pending",
      mfaResetRequestedAt: new Date(),
      mfaResetDecidedAt: null,
      mfaResetDecidedBy: null,
      mfaResetDecisionNote: null,
      mfaResetApprovalExpiresAt: null,
      recoveryNonce: null,
      updatedAt: new Date(),
    })
    .where(and(eq(t.id, ctx.account.id), eq(t.recoveryNonce, ctx.nonce)))
    .returning();
  if (!updated) return { ok: false, reason: "token_invalid" };
  return { ok: true, state: "requested", account: updated };
}

// ── Lost authenticator: re-enrolment after approval ──────────────────────────

export type ReenrolGate = { ok: true } | { ok: false; reason: "not_approved" | "invalid_password" | "account_locked" };

async function gateReenrolment(ctx: RecoveryContext, password: string): Promise<ReenrolGate> {
  if (mfaResetState(ctx.account) !== "approved") return { ok: false, reason: "not_approved" };
  const pw = await verifyAccountPassword(ctx.account, password);
  if (pw === "locked") return { ok: false, reason: "account_locked" };
  if (pw !== "ok") return { ok: false, reason: "invalid_password" };
  return { ok: true };
}

export async function beginRecoveryTotp(
  ctx: RecoveryContext,
  password: string,
): Promise<{ ok: true; secret: string; otpauthUri: string } | Extract<ReenrolGate, { ok: false }>> {
  const gate = await gateReenrolment(ctx, password);
  if (!gate.ok) return gate;

  let secret: string | null = null;
  if (ctx.account.pendingMfaMethod === "totp" && ctx.account.pendingTotpSecretEncrypted) {
    try {
      secret = decryptTotp(ctx.account.pendingTotpSecretEncrypted);
    } catch (err) {
      log.warn({ err, accountId: ctx.account.id }, "free-scan account recovery: pending TOTP secret unreadable — issuing a new one");
    }
  }
  if (!secret) {
    secret = generateSecret();
    await db
      .update(freeScanAccountsTable)
      .set({ pendingMfaMethod: "totp", pendingTotpSecretEncrypted: encryptTotp(secret), pendingPhone: null, updatedAt: new Date() })
      .where(and(eq(freeScanAccountsTable.id, ctx.account.id), eq(freeScanAccountsTable.recoveryNonce, ctx.nonce)));
  }
  return { ok: true, secret, otpauthUri: generateURI({ issuer: "Shane McCaw Consulting", label: ctx.account.email, secret }) };
}

export async function beginRecoverySms(
  ctx: RecoveryContext,
  password: string,
  phone: string,
): Promise<{ ok: true } | Extract<ReenrolGate, { ok: false }>> {
  const gate = await gateReenrolment(ctx, password);
  if (!gate.ok) return gate;
  await db
    .update(freeScanAccountsTable)
    .set({ pendingMfaMethod: "sms", pendingPhone: phone, pendingTotpSecretEncrypted: null, updatedAt: new Date() })
    .where(and(eq(freeScanAccountsTable.id, ctx.account.id), eq(freeScanAccountsTable.recoveryNonce, ctx.nonce)));
  // Texted to the NEW number: proving it is the point of this step.
  await issueSmsCode(ctx.account.id, phone);
  return { ok: true };
}

export type RecoveryEnrolment =
  | { ok: true; account: FreeScanAccount }
  | { ok: false; reason: "not_approved" | "no_pending_factor" | "code_invalid" | "code_expired" | "too_many_attempts" | "token_invalid" };

/**
 * Prove the replacement factor and swap it in. Revokes every session; the caller
 * signs the Prospect in on the new session version.
 */
export async function completeRecoveryEnrolment(ctx: RecoveryContext, code: string): Promise<RecoveryEnrolment> {
  const account = ctx.account;
  if (mfaResetState(account) !== "approved") return { ok: false, reason: "not_approved" };

  if (account.pendingMfaMethod === "totp") {
    if (!totpValid(account.pendingTotpSecretEncrypted, code)) return { ok: false, reason: "code_invalid" };
  } else if (account.pendingMfaMethod === "sms" && account.pendingPhone) {
    const result = await checkSmsCode(account, code);
    if (result === "too_many_attempts") return { ok: false, reason: "too_many_attempts" };
    if (result === "expired" || result === "no_code") return { ok: false, reason: "code_expired" };
    if (result !== "ok") return { ok: false, reason: "code_invalid" };
  } else {
    return { ok: false, reason: "no_pending_factor" };
  }

  const t = freeScanAccountsTable;
  const [updated] = await db
    .update(t)
    .set({
      mfaMethod: account.pendingMfaMethod,
      totpSecretEncrypted: account.pendingMfaMethod === "totp" ? account.pendingTotpSecretEncrypted : null,
      phone: account.pendingMfaMethod === "sms" ? account.pendingPhone : null,
      mfaEnrolledAt: new Date(),
      smsCodeHash: null,
      smsCodeExpiresAt: null,
      smsCodeAttempts: 0,
      sessionVersion: sql`${t.sessionVersion} + 1`,
      failedLoginCount: 0,
      lockedUntil: null,
      recoveryNonce: null,
      ...CLEARED_MFA_RESET,
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    })
    // Still approved, still this token, and still the factor that was just proven.
    .where(
      and(
        eq(t.id, account.id),
        eq(t.recoveryNonce, ctx.nonce),
        eq(t.mfaResetStatus, "approved"),
        gt(t.mfaResetApprovalExpiresAt, new Date()),
        eq(t.pendingMfaMethod, account.pendingMfaMethod),
      ),
    )
    .returning();
  if (!updated) return { ok: false, reason: "token_invalid" };
  return { ok: true, account: updated };
}

// ── Operator side ─────────────────────────────────────────────────────────────

export interface MfaResetQueueRow {
  accountId: number;
  email: string;
  mfaMethod: "totp" | "sms" | null;
  phoneLast4: string | null;
  state: MfaResetState;
  requestedAt: string | null;
  decidedAt: string | null;
  decidedBy: number | null;
  decisionNote: string | null;
  approvalExpiresAt: string | null;
  passwordSetAt: string | null;
  lastLoginAt: string | null;
  accountCreatedAt: string;
  engagement: { id: number; sowReference: string; signerName: string | null; signerRole: string | null; paidAt: string | null };
  tenant: { id: number; name: string | null; domain: string | null };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Every account with a factor reset on file, pending first, newest first. */
export async function listMfaResetRequests(): Promise<MfaResetQueueRow[]> {
  const rows = await db
    .select({ account: freeScanAccountsTable, engagement: freeScanEngagementsTable, tenantName: tenantsTable.customerName, tenantDomain: tenantsTable.domain })
    .from(freeScanAccountsTable)
    .innerJoin(freeScanEngagementsTable, eq(freeScanEngagementsTable.id, freeScanAccountsTable.engagementId))
    .leftJoin(tenantsTable, eq(tenantsTable.id, freeScanEngagementsTable.customerId))
    .where(isNotNull(freeScanAccountsTable.mfaResetStatus))
    .orderBy(sql`CASE WHEN ${freeScanAccountsTable.mfaResetStatus} = 'pending' THEN 0 ELSE 1 END`, desc(freeScanAccountsTable.mfaResetRequestedAt));

  return rows.map(({ account: a, engagement: e, tenantName, tenantDomain }) => ({
    accountId: a.id,
    email: a.email,
    mfaMethod: a.mfaMethod,
    phoneLast4: a.phone ? a.phone.slice(-4) : null,
    state: mfaResetState(a),
    requestedAt: iso(a.mfaResetRequestedAt),
    decidedAt: iso(a.mfaResetDecidedAt),
    decidedBy: a.mfaResetDecidedBy,
    decisionNote: a.mfaResetDecisionNote,
    approvalExpiresAt: iso(a.mfaResetApprovalExpiresAt),
    passwordSetAt: iso(a.passwordSetAt),
    lastLoginAt: iso(a.lastLoginAt),
    accountCreatedAt: a.createdAt.toISOString(),
    engagement: { id: e.id, sowReference: e.sowReference, signerName: e.signerName, signerRole: e.signerRole, paidAt: iso(e.paidAt) },
    tenant: { id: e.customerId, name: tenantName ?? null, domain: tenantDomain ?? null },
  }));
}

export type MfaResetDecision =
  | { ok: true; account: FreeScanAccount; engagement: FreeScanEngagement }
  | { ok: false; reason: "not_found" | "not_pending" };

/** Approve or deny a PENDING request. The note records how identity was checked. */
export async function decideMfaReset(
  accountId: number,
  decision: "approve" | "deny",
  operatorUserId: number,
  note: string,
): Promise<MfaResetDecision> {
  const t = freeScanAccountsTable;
  const now = new Date();
  const [updated] = await db
    .update(t)
    .set({
      mfaResetStatus: decision === "approve" ? "approved" : "denied",
      mfaResetDecidedAt: now,
      mfaResetDecidedBy: operatorUserId,
      mfaResetDecisionNote: note,
      mfaResetApprovalExpiresAt: decision === "approve" ? new Date(now.getTime() + MFA_RESET_APPROVAL_TTL_MS) : null,
      updatedAt: now,
    })
    .where(and(eq(t.id, accountId), eq(t.mfaResetStatus, "pending")))
    .returning();

  if (!updated) {
    const [exists] = await db.select({ id: t.id }).from(t).where(eq(t.id, accountId)).limit(1);
    return { ok: false, reason: exists ? "not_pending" : "not_found" };
  }
  const [engagement] = await db.select().from(freeScanEngagementsTable).where(eq(freeScanEngagementsTable.id, updated.engagementId)).limit(1);
  if (!engagement) return { ok: false, reason: "not_found" };
  return { ok: true, account: updated, engagement };
}
