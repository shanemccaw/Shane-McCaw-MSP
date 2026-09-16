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
 *
 * #4374 (issue 4 of #4370) — the PRE-CONSENT door, for the account-first
 * checkout order (#4376: account -> consent -> pay). Same operations, a
 * different ordering gate, and a different provisioning call:
 *
 *   resolvePreConsentPurchaseSession — unexpired, still `pending`, no tenant,
 *                                      and a product with a `*Pending` rung
 *   createPreConsentAccount          — verified mailbox -> bcrypt(12) ->
 *                                      provisionPendingAccount (insert-only,
 *                                      password set, `*Pending` rung)
 *   resolvePreConsentAccountUser     — the account THIS session created, for
 *                                      the MFA-enrollment and status steps
 *
 * issueVerificationCode / checkVerificationCode / getVerifiedEmail are shared
 * with the paid door unchanged — they never read the session's status. Every
 * security property listed above still holds on this door except the one it
 * exists to relax (`paid`); in its place the session must be demonstrably
 * BEFORE consent, so this door can never mint a password onto a session whose
 * tenant is already linked.
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
import {
  provisionProspectAccount,
  provisionPendingAccount,
  resolveProspectRole,
  promoteMspUserToCustomer,
  pendingRoleForCategory,
  isPendingProspectRole,
  type PendingProspectRole,
} from "./direct-tenant-provisioning.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "auth" });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Long enough to find the mail and type it, short enough to be worth little if leaked. */
export const CODE_TTL_MS = 15 * 60 * 1000;
/** Six digits is a 1-in-a-million guess — only safe with a hard cap on tries. */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * A checkout session as the account-creation operations see it. Despite the
 * name, the shape carries no payment fact: which sessions may reach those
 * operations is decided by the resolver that produced it —
 * resolvePaidPurchaseSession (#1310) or resolvePreConsentPurchaseSession
 * (#4374, which returns this shape extended).
 */
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
 * row through the SAME provisionProspectAccount the consent flow uses — these
 * are paid purchases, not assessment prospects, so the role is never `Free`.
 * #3972/#4373 — which of `Customer` / `RetainerConsented` / the product's own
 * `*Pending` rung (`RetainerPending` / `MonitoringPending` / `PackPending`) it
 * gets is resolveProspectRole's call, keyed on the session's real product
 * category and whether session.tenantId is set (null on a skipped-consent
 * Retainer buy — see public-purchase-payment.ts's read-consent-optional skip).
 * The assessment funnel's own semantics (missing row = upstream defect) are
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

    // #3972/#4373 — real product type decides the role, not a blanket Customer:
    // no tenant is the product's own `*Pending` rung (RetainerPending for a
    // skipped-consent Retainer buy; MonitoringPending/PackPending once #4374's
    // pre-consent door makes a tenant-less Monitoring/Pack arrival real);
    // Retainer with a tenant is RetainerConsented; monitoring/pack (and anything
    // else) with a tenant stays Customer.
    const category = await resolveProductCategory(session.productSlug);
    const result = await provisionProspectAccount({
      email,
      fullName: session.fullName,
      company: session.company,
      industry: session.industry,
      tenantId: session.tenantId,
      role: resolveProspectRole(category, !!session.tenantId?.trim()),
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

  // #4392 (Shane, 2026-09-16) — the buyer is promoted to `Customer` on payment.
  // This is the one point in the flow where both facts the promotion needs
  // hold: `session` is a PaidPurchaseSession (resolvePaidPurchaseSession only
  // yields one for a paid, unexpired row) and `email` was just re-proven above.
  // Runs for the returning buyer too, before the `already_set` return below:
  // an account created before consent (#4374's door, real password from day
  // one) that consented into `MonitoringConsented`/`PackConsented` and then
  // paid arrives here exactly as `already_set`, and it is the case #4392 is
  // about. Guarded inside (only Free / MonitoringConsented / PackConsented
  // move; RetainerConsented and every *Pending rung stay), so a real
  // Customer/MSPAdmin returning buyer is a no-op. Non-fatal.
  await promoteMspUserToCustomer(user.id);

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

// ── #4374 — the pre-consent door ─────────────────────────────────────────────

/**
 * The catalog categories that have a `*Pending` / `*Consented` rung pair
 * (#4370) and therefore a real pre-consent account state to create. Anything
 * else — the assessment funnel, an uncatalogued slug, a NULL category — is
 * refused rather than defaulted: pendingRoleForCategory's RetainerPending
 * fallback exists for the consent callback's defence-in-depth, not as a reason
 * to create a password-bearing account for a product with no pending state.
 */
export const PRE_CONSENT_ACCOUNT_CATEGORIES: readonly string[] = Object.freeze([
  "monitoring",
  "config_pack",
  "retainer",
]);

export interface PreConsentPurchaseSession extends PaidPurchaseSession {
  /** `services.category` — one of PRE_CONSENT_ACCOUNT_CATEGORIES. */
  productCategory: string;
  /** The rung an account created through this session is inserted at. */
  pendingRole: PendingProspectRole;
}

export type PreConsentSessionResolution =
  | { ok: true; session: PreConsentPurchaseSession }
  | {
      ok: false;
      status: 400 | 404 | 409;
      error:
        | "session_invalid"
        | "session_expired"
        | "already_paid"
        | "consent_already_granted"
        | "product_not_eligible";
    };

/**
 * The ordering gate for the pre-consent door: unexpired, still `pending`, no
 * tenant attached, and a product with a `*Pending` rung. The mirror image of
 * resolvePaidPurchaseSession — that door refuses anything before payment, this
 * one refuses anything at or after consent:
 *
 *   - `paid`       -> already_paid: the post-payment door (#1310) owns that
 *                     session's account stage.
 *   - `consented`, or any tenant_id recorded -> consent_already_granted: a
 *                     tenant is (being) linked, and a `*Pending` account must
 *                     never be created alongside it — that is exactly the
 *                     state users_role_scope_check and the #3973 swap exist to
 *                     rule out.
 *   - `expired`    -> session_expired, same as a lapsed expires_at.
 */
export async function resolvePreConsentPurchaseSession(rawSessionId: unknown): Promise<PreConsentSessionResolution> {
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
      category: servicesTable.category,
    })
    .from(checkoutSessionsTable)
    .leftJoin(servicesTable, eq(servicesTable.slug, checkoutSessionsTable.productSlug))
    .where(
      and(
        eq(checkoutSessionsTable.id, sessionId),
        gte(checkoutSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row || row.status === "expired") {
    return { ok: false, status: 404, error: "session_expired" };
  }
  if (row.status === "paid") {
    return { ok: false, status: 409, error: "already_paid" };
  }
  if (row.status !== "pending" || row.tenantId?.trim()) {
    return { ok: false, status: 409, error: "consent_already_granted" };
  }
  if (!row.category || !PRE_CONSENT_ACCOUNT_CATEGORIES.includes(row.category)) {
    return { ok: false, status: 409, error: "product_not_eligible" };
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
      productCategory: row.category,
      pendingRole: pendingRoleForCategory(row.category),
    },
  };
}

export type CreatePreConsentAccountResult =
  | { outcome: "email_not_verified" }
  | { outcome: "already_created"; userId: number }
  | { outcome: "account_exists"; hasPassword: boolean }
  | { outcome: "ok"; userId: number; role: PendingProspectRole };

/**
 * Create the buyer's real account before consent: proven mailbox, then the
 * platform's one password hash (bcrypt, cost 12 — auth.ts and
 * attachPasswordToAccount use exactly this), then provisionPendingAccount's
 * insert-only `*Pending` row.
 *
 *   - `already_created` — this session already created an account for this
 *     address (a double-submit, a back button, a refreshed tab). Nothing is
 *     re-written, the password in this request is ignored, and the flow simply
 *     moves on to MFA — the same no-op-not-failure doctrine verify-code applies
 *     to an already-verified code.
 *   - `account_exists` — any OTHER account already holds this address. Never
 *     modified here; the buyer signs in (or recovers via /auth/forgot-password).
 *     The userId is deliberately not returned to the caller: this outcome is
 *     reachable before payment by anyone who can read the mailbox's code, and
 *     an internal id is no business of theirs.
 *
 * On `ok` the session records accountUserId — the same durable "created
 * through THIS session" fact the paid door's portal handoff gates on, so a
 * buyer who creates their account here and pays later is handoff-eligible for
 * the account they made, and for no other.
 */
export async function createPreConsentAccount(
  session: PreConsentPurchaseSession,
  password: string,
): Promise<CreatePreConsentAccountResult> {
  const email = await getVerifiedEmail(session);
  if (!email) return { outcome: "email_not_verified" };

  if (session.accountUserId != null) {
    const [own] = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, session.accountUserId))
      .limit(1);
    if (own && own.email === email) return { outcome: "already_created", userId: own.id };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await provisionPendingAccount({
    email,
    passwordHash,
    fullName: session.fullName,
    company: session.company,
    role: session.pendingRole,
  });

  if (result.outcome === "account_exists") {
    log.info(
      { sessionId: session.id, hasPassword: result.hasPassword },
      "pre-consent account: address already has an account — sign-in required, nothing modified",
    );
    return { outcome: "account_exists", hasPassword: result.hasPassword };
  }

  await db
    .update(checkoutSessionsTable)
    .set({ accountUserId: result.userId, updatedAt: new Date() })
    .where(eq(checkoutSessionsTable.id, session.id));

  return { outcome: "ok", userId: result.userId, role: session.pendingRole };
}

export type PreConsentAccountUser =
  | { outcome: "email_not_verified" }
  | { outcome: "account_not_created" }
  | { outcome: "account_missing" }
  | { outcome: "email_mismatch" }
  | { outcome: "not_pending" }
  | { outcome: "ok"; userId: number; email: string; passwordSet: boolean };

/**
 * The account a pre-consent session may continue to act on (MFA enrollment,
 * status): only the one it created (accountUserId), only while the mailbox is
 * still proven and still that account's address, and only while the account is
 * still at a `*Pending` rung. Keyed on accountUserId rather than an email
 * lookup, so an existing account at the same address — which createPreConsentAccount
 * refused to touch — can never have MFA enrolled onto it through this door.
 */
export async function resolvePreConsentAccountUser(session: PreConsentPurchaseSession): Promise<PreConsentAccountUser> {
  const email = await getVerifiedEmail(session);
  if (!email) return { outcome: "email_not_verified" };
  if (session.accountUserId == null) return { outcome: "account_not_created" };

  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      passwordHash: usersTable.passwordHash,
      mspRole: usersTable.mspRole,
    })
    .from(usersTable)
    .where(eq(usersTable.id, session.accountUserId))
    .limit(1);

  if (!user) return { outcome: "account_missing" };
  if (user.email !== email) {
    log.warn(
      { sessionId: session.id, userId: user.id },
      "pre-consent account: REFUSED — the created account no longer carries the session's verified address",
    );
    return { outcome: "email_mismatch" };
  }
  if (!isPendingProspectRole(user.mspRole)) return { outcome: "not_pending" };

  return { outcome: "ok", userId: user.id, email, passwordSet: Boolean(user.passwordHash) };
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
