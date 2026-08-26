/**
 * purchase-account-flow.ts — the generalized core of the inline account-creation
 * flow (Git #1310, Phase 1 of Epic #1309).
 *
 * Extracted from routes/public-assessment-account.ts (#437/#438), which built
 * this exact flow for the $5,000 Copilot Assessment funnel and keyed every step
 * on that funnel's checkout-session. Nothing about the flow's security model was
 * actually assessment-specific — the session table (`checkout_sessions`) is the
 * same server-side purchase session every Buy.tsx product (monitoring /
 * retainer / packs) checks out through (#1302/#1306), so this module lifts the
 * flow's core operations out where any paid purchase session can run them:
 *
 *   resolvePaidPurchaseSession — the ordering gate: unexpired AND already `paid`
 *   issueVerificationCode      — CSPRNG six-digit code, bcrypt-hashed at rest,
 *                                superseding any previous unverified code
 *   checkVerificationCode      — the attempt-budgeted comparison (count BEFORE
 *                                judging, hard cap per issued code)
 *   getVerifiedEmail           — the proven-mailbox fact the password/MFA steps
 *                                gate on
 *   attachPasswordToAccount    — bcrypt(12) attach; never overwrites an
 *                                existing credential through a checkout session
 *   resolvePortalHandoffUser   — (#1313, Phase 4) whether this session may mint
 *                                a portal auto-login token, and for whom — only
 *                                ever the account created through this session
 *
 * The assessment route file is deliberately NOT rewritten to delegate here in
 * this phase — it fronts a live paid funnel with no existing automated test
 * coverage, so swapping its internals is all risk and no new capability while
 * this generalized path proves itself. Its logic and this module must be kept
 * in agreement; when the generalized path has been battle-proven (Phase 8 of
 * #1309 wiring Buy.tsx end to end), collapsing that file onto this core is the
 * natural cleanup.
 *
 * Every security property is preserved un-simplified, per #1310:
 *  - the `paid` + unexpired session gate on every operation
 *  - CSPRNG code generation (a credential, however short-lived — never
 *    Math.random)
 *  - only the bcrypt hash of the code at rest, never the six digits
 *  - resend supersedes: previously-issued unverified codes are destroyed, an
 *    already-verified row is left alone so later steps still see the proof
 *  - the attempt budget is counted on the issued code's row BEFORE the guess is
 *    judged, so a crash between compare and increment can never hand out a free
 *    guess, and the budget follows the code rather than the caller's IP
 *  - the verified address must still be the session's own address at
 *    password/MFA time, so a code proven against one mailbox can never complete
 *    an account under another
 *  - an account that already has a password is never overwritten — a checkout
 *    session is not a credential-recovery door (/auth/forgot-password is)
 *
 * One deliberate generalization beyond the assessment flow: the assessment
 * funnel provisions its users row at M365-consent time (provisionProspectAccount
 * in consent.ts) and therefore treats a missing row at password time as an
 * upstream defect (`account_missing`). Buy.tsx flows include products whose
 * consent step is skippable (Retainer — `connectOffered`'s scanSkipped escape
 * hatch, per Shane's product flow in #1309), so no earlier step is guaranteed
 * to have created the account. attachPasswordToAccount therefore takes a
 * provisionIfMissing option: the purchase path provisions through the SAME
 * proven provisionProspectAccount used at consent time (idempotent, tenant-
 * linking, lead-converting), never an improvised second account-creation door.
 */

import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import {
  db,
  checkoutSessionsTable,
  checkoutEmailVerificationsTable,
  usersTable,
  servicesTable,
} from "@workspace/db";
import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { provisionProspectAccount } from "./direct-tenant-provisioning.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "auth" });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Long enough to find the mail and type it, short enough to be worth little if leaked. */
export const CODE_TTL_MS = 15 * 60 * 1000;
/** Six digits is a 1-in-a-million guess — only safe with a hard cap on tries. */
export const MAX_CODE_ATTEMPTS = 5;

export interface PaidPurchaseSession {
  id: string;
  productSlug: string;
  email: string;
  fullName: string;
  company: string | null;
  industry: string | null;
  tenantId: string | null;
  /**
   * Git #1313 — the users.id whose password was attached THROUGH this
   * session's own flow (attachPasswordToAccount `ok` outcome), null until
   * then. The portal-handoff gate keys on this, never on an email lookup: a
   * signup-exchange token is a full no-MFA-challenge login, so it may only
   * ever be minted for the account this very session created.
   */
  accountUserId: number | null;
}

export type SessionResolution =
  | { ok: true; session: PaidPurchaseSession }
  | { ok: false; status: 400 | 404 | 409; error: "session_invalid" | "session_expired" | "payment_required" };

/**
 * The session an account-creation operation may act on: unexpired, and already
 * `paid`. Anything earlier in the flow has no business reaching these steps, and
 * enforcing that here rather than only in the client's stage machine is what
 * makes the ordering real. Identical gate to the assessment flow's
 * resolvePaidSession — any productSlug, no funnel assumption.
 */
export async function resolvePaidPurchaseSession(rawSessionId: unknown): Promise<SessionResolution> {
  const sessionId = typeof rawSessionId === "string" ? rawSessionId : "";
  if (!UUID_RE.test(sessionId)) {
    return { ok: false, status: 400, error: "session_invalid" };
  }

  const [row] = await db
    .select({
      id: checkoutSessionsTable.id,
      productSlug: checkoutSessionsTable.productSlug,
      status: checkoutSessionsTable.status,
      email: checkoutSessionsTable.email,
      fullName: checkoutSessionsTable.fullName,
      company: checkoutSessionsTable.company,
      industry: checkoutSessionsTable.industry,
      tenantId: checkoutSessionsTable.tenantId,
      accountUserId: checkoutSessionsTable.accountUserId,
    })
    .from(checkoutSessionsTable)
    .where(
      and(
        eq(checkoutSessionsTable.id, sessionId),
        gte(checkoutSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) {
    return { ok: false, status: 404, error: "session_expired" };
  }
  if (row.status !== "paid") {
    return { ok: false, status: 409, error: "payment_required" };
  }

  return {
    ok: true,
    session: {
      id: row.id,
      productSlug: row.productSlug,
      email: row.email,
      fullName: row.fullName,
      company: row.company,
      industry: row.industry,
      tenantId: row.tenantId,
      accountUserId: row.accountUserId,
    },
  };
}

export function generateSixDigitCode(): string {
  // CSPRNG, not Math.random — this is a credential, however short-lived.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** `s****e@company.com` — enough for the buyer to recognise the address, not enough to harvest it. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 6))}${local[local.length - 1]}@${domain}`;
}

/**
 * Issue a fresh six-digit code for the session, destroying every
 * previously-issued unverified code first so a resend genuinely supersedes
 * rather than leaving several live codes for the same address. An
 * already-verified row is left alone so the password step can still see that
 * this session's email was proven.
 *
 * Returns the PLAINTEXT code exactly once, for the caller to put in the email —
 * it is never logged, never audited, and only its bcrypt hash is stored.
 */
export async function issueVerificationCode(
  session: PaidPurchaseSession,
): Promise<{ code: string; expiresAt: Date; email: string }> {
  const email = session.email.trim().toLowerCase();
  if (!email) {
    throw new Error("email_missing");
  }

  const code = generateSixDigitCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await db
    .delete(checkoutEmailVerificationsTable)
    .where(
      and(
        eq(checkoutEmailVerificationsTable.sessionId, session.id),
        isNull(checkoutEmailVerificationsTable.verifiedAt),
      ),
    );

  await db.insert(checkoutEmailVerificationsTable).values({
    sessionId: session.id,
    email,
    codeHash,
    expiresAt,
  });

  return { code, expiresAt, email };
}

export type CodeCheckResult =
  | { outcome: "no_code_issued" }
  | { outcome: "already_verified" }
  | { outcome: "code_expired" }
  | { outcome: "too_many_attempts" }
  | { outcome: "code_incorrect"; attemptsRemaining: number }
  | { outcome: "verified"; attempts: number };

/**
 * Judge a submitted code against the newest row for this session. Attempts are
 * counted on the row, not just per-IP, so the budget follows the issued code
 * rather than the network path the guesses arrive from — and the attempt is
 * counted BEFORE the comparison, so a crash between compare and increment can
 * never hand out a free guess.
 */
export async function checkVerificationCode(sessionId: string, code: string): Promise<CodeCheckResult> {
  const [record] = await db
    .select()
    .from(checkoutEmailVerificationsTable)
    .where(eq(checkoutEmailVerificationsTable.sessionId, sessionId))
    .orderBy(desc(checkoutEmailVerificationsTable.id))
    .limit(1);

  if (!record) return { outcome: "no_code_issued" };

  // Already proven — replaying the same code is a no-op, not a failure. A
  // double-submit or a back-button must not strand a buyer who is already past
  // this step.
  if (record.verifiedAt) return { outcome: "already_verified" };

  if (record.expiresAt.getTime() < Date.now()) return { outcome: "code_expired" };

  if (record.attempts >= MAX_CODE_ATTEMPTS) return { outcome: "too_many_attempts" };

  await db
    .update(checkoutEmailVerificationsTable)
    .set({ attempts: record.attempts + 1 })
    .where(eq(checkoutEmailVerificationsTable.id, record.id));

  const matches = await bcrypt.compare(code, record.codeHash);
  if (!matches) {
    return {
      outcome: "code_incorrect",
      attemptsRemaining: Math.max(0, MAX_CODE_ATTEMPTS - (record.attempts + 1)),
    };
  }

  await db
    .update(checkoutEmailVerificationsTable)
    .set({ verifiedAt: new Date() })
    .where(eq(checkoutEmailVerificationsTable.id, record.id));

  return { outcome: "verified", attempts: record.attempts + 1 };
}

/**
 * The proven-mailbox fact: the newest VERIFIED row for this session, but only
 * when the address it proved is still the session's own current address — so a
 * code proven against one mailbox can never complete an account under another.
 */
export async function getVerifiedEmail(session: PaidPurchaseSession): Promise<string | null> {
  const email = session.email.trim().toLowerCase();

  // Newest VERIFIED row, exactly as the assessment flow reads it — a later
  // unverified resend does not undo proof already established for this session.
  const [verified] = await db
    .select({ email: checkoutEmailVerificationsTable.email })
    .from(checkoutEmailVerificationsTable)
    .where(
      and(
        eq(checkoutEmailVerificationsTable.sessionId, session.id),
        isNotNull(checkoutEmailVerificationsTable.verifiedAt),
      ),
    )
    .orderBy(desc(checkoutEmailVerificationsTable.id))
    .limit(1);

  if (!verified) return null;
  if (verified.email !== email) {
    log.warn(
      { sessionId: session.id },
      "purchase account flow: REFUSED — the verified address is not the session's current address",
    );
    return null;
  }
  return email;
}

export type AttachPasswordResult =
  | { outcome: "email_not_verified" }
  | { outcome: "account_missing" }
  | { outcome: "already_set"; userId: number }
  | { outcome: "ok"; userId: number; provisioned: boolean };

/**
 * Attach a bcrypt(12) hash to the buyer's account. Requires a verified code for
 * this session whose proven address is still the session's own.
 *
 * provisionIfMissing: the generalized Buy.tsx path provisions a missing users
 * row through the SAME provisionProspectAccount the consent flow uses (role
 * "CustomerUser" — these are paid purchases, not assessment prospects). The
 * assessment funnel's own semantics (missing row = upstream defect) are
 * available by passing false.
 *
 * An account that ALREADY has a password is never overwritten (`already_set`) —
 * a repeat buyer's existing credential must not be replaceable through a
 * checkout session; /auth/forgot-password is the door for that.
 */
export async function attachPasswordToAccount(
  session: PaidPurchaseSession,
  password: string,
  opts: { provisionIfMissing: boolean },
): Promise<AttachPasswordResult> {
  const email = await getVerifiedEmail(session);
  if (!email) return { outcome: "email_not_verified" };

  let [user] = await db
    .select({ id: usersTable.id, passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  let provisioned = false;
  if (!user) {
    if (!opts.provisionIfMissing) return { outcome: "account_missing" };

    const result = await provisionProspectAccount({
      email,
      fullName: session.fullName,
      company: session.company,
      industry: session.industry,
      tenantId: session.tenantId,
      role: "CustomerUser",
    });
    if (!result) return { outcome: "account_missing" };
    provisioned = true;

    [user] = await db
      .select({ id: usersTable.id, passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(eq(usersTable.id, result.userId))
      .limit(1);
    if (!user) return { outcome: "account_missing" };

    log.info(
      { sessionId: session.id, userId: user.id, productSlug: session.productSlug },
      "purchase account flow: provisioned account inline (no consent-time provisioning ran for this session)",
    );
  }

  if (user.passwordHash) {
    return { outcome: "already_set", userId: user.id };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));

  // Git #1313 — the durable "this session completed account creation for THIS
  // user" fact the portal-handoff endpoint gates on. Recorded only on the `ok`
  // outcome: an `already_set` account was never created through this session,
  // so it must never become handoff-eligible from here.
  await db
    .update(checkoutSessionsTable)
    .set({ accountUserId: user.id })
    .where(eq(checkoutSessionsTable.id, session.id));

  return { outcome: "ok", userId: user.id, provisioned };
}

export type PortalHandoffEligibility =
  | { outcome: "account_not_completed" }
  | { outcome: "email_not_verified" }
  | { outcome: "account_missing" }
  | { outcome: "email_mismatch" }
  | { outcome: "password_not_set" }
  | { outcome: "ok"; userId: number };

/**
 * Git #1313 (Epic #1309 Phase 4) — whether this session may mint a portal
 * auto-login (signup-exchange) token right now, and for whom.
 *
 * The gate chain, hardest fact first:
 *  - `accountUserId` must be recorded on the session — the account's password
 *    was attached through THIS session's own flow. A pre-existing account is
 *    never reachable this way (signup-exchange issues a full session with no
 *    MFA challenge, so minting for any other account would turn a leaked
 *    session UUID + mailbox access into an MFA bypass).
 *  - the session's mailbox must still be PROVEN (verified code, address
 *    unchanged) — the same re-check every other step in this flow makes on
 *    every call rather than trusting its earlier self.
 *  - that user row must still exist, still carry the session's own verified
 *    address (an account whose email was changed after creation is no longer
 *    provably the buyer's), and still have its password set.
 */
export async function resolvePortalHandoffUser(session: PaidPurchaseSession): Promise<PortalHandoffEligibility> {
  if (session.accountUserId == null) return { outcome: "account_not_completed" };

  const email = await getVerifiedEmail(session);
  if (!email) return { outcome: "email_not_verified" };

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.id, session.accountUserId))
    .limit(1);

  if (!user) return { outcome: "account_missing" };
  if (user.email !== email) {
    log.warn(
      { sessionId: session.id, userId: user.id },
      "portal handoff: REFUSED — the completed account no longer carries the session's verified address",
    );
    return { outcome: "email_mismatch" };
  }
  if (!user.passwordHash) return { outcome: "password_not_set" };

  return { outcome: "ok", userId: user.id };
}

/**
 * Git #1315 (Epic #1309, Phase 6) — the session's product category
 * (`services.category`), so the portal-handoff caller can tell each landing
 * phase (5/6/7) which product this was without re-deriving it. The same
 * reliable discriminator #1307/#1310/#1311/#1312 already settled on — never
 * the raw `productSlug`, which varies per tier/seat-count within one category
 * (six real retainer rows alone). Returns null for a slug with no catalog
 * row; the caller degrades to the pre-#1315 handoff behavior rather than
 * failing the mint over a lookup that is advisory, not load-bearing.
 */
export async function resolveProductCategory(productSlug: string): Promise<string | null> {
  const [row] = await db
    .select({ category: servicesTable.category })
    .from(servicesTable)
    .where(eq(servicesTable.slug, productSlug))
    .limit(1);
  return row?.category ?? null;
}
