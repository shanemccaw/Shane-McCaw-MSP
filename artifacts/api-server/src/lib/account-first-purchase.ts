/**
 * account-first-purchase.ts — the server half of the account-first checkout
 * order (Git #4377, issue 1 of Feature #4376; Packs joined by #4378).
 *
 * Feature #4370 made a real account possible BEFORE consent (the `*Pending`
 * rungs, #4374's pre-consent door, #4373's promote-on-consent swap). This file
 * is what makes that order hold for the products that use it, and what lets a
 * buyer who left mid-purchase come back to it:
 *
 *   1. checkAccountFirstConsentReady — the read-consent URL for a Monitoring or
 *      Pack session is only minted once the session is bound (accountUserId) to
 *      a real account at the session's own address with a password and at
 *      least one active MFA method. Consent is never granted on behalf of an
 *      anonymous checkout session for these products again. The client's stage
 *      machine orders the screens; this is what makes the order real.
 *
 *   2. findResumablePurchase — the returning-buyer door. A buyer who closed the
 *      tab, crashed, or came back on another device signs in with the account
 *      they created (a real /auth/login + MFA challenge) and gets back the
 *      checkout session that account owns. A session that has lapsed past its
 *      24h expiry is renewed for its authenticated owner rather than lost: the
 *      session carries the consent, the verified address and accountUserId, so
 *      replacing it with a fresh one would strand every later step
 *      (payment gate, #4392 promotion, portal handoff) that keys on those.
 *
 *   3. updateMonitoringSelection — tier and seats live on the session row
 *      (productSlug + seats), and with an account bound to the session the page
 *      can no longer throw the session away on every tier click the way it did
 *      when the session was anonymous. Tier stays changeable up to payment; the
 *      seat count locks once the tenant is connected (the page's own "locks in
 *      when you connect" rule, now enforced server-side).
 */

import {
  db,
  checkoutSessionsTable,
  servicesTable,
  usersTable,
  mfaEnrollmentsTable,
  webauthnCredentialsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { seatBandViolationMessage } from "./catalog-pricing.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "auth" });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Catalog categories whose Buy.tsx path is account → consent → pay. Retainer is
 * deliberately absent: its consent is optional (#1311) and its reorder is its
 * own decision (#4380 / #4383).
 */
export const ACCOUNT_FIRST_CATEGORIES: readonly string[] = Object.freeze(["monitoring", "config_pack"]);

/** Same TTL checkout-session creation grants (public-services.ts). */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How far back a signed-in buyer's own unfinished purchase is still offered
 * for resumption. Past this the buyer starts a new purchase rather than
 * reviving a month-old selection and price.
 */
export const RESUME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function activeMfaMethodCount(userId: number): Promise<number> {
  const [enrollments, passkeys] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(mfaEnrollmentsTable)
      .where(
        and(
          eq(mfaEnrollmentsTable.userId, userId),
          eq(mfaEnrollmentsTable.enabled, true),
          ne(mfaEnrollmentsTable.method, "passkey"),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(webauthnCredentialsTable)
      .where(eq(webauthnCredentialsTable.userId, userId)),
  ]);
  return (enrollments[0]?.n ?? 0) + (passkeys[0]?.n ?? 0);
}

export type AccountFirstConsentReadiness =
  | { outcome: "not_account_first" }
  | { outcome: "ready"; userId: number }
  | { outcome: "account_required"; reason: "no_account" | "account_missing" | "email_mismatch" | "password_not_set" | "mfa_not_enrolled" };

/**
 * Whether a session may be handed a read-consent URL under the account-first
 * order. Any category outside ACCOUNT_FIRST_CATEGORIES (Retainer, assessments,
 * the free scan) is `not_account_first` and untouched.
 */
export async function checkAccountFirstConsentReady(session: {
  id: string;
  email: string;
  accountUserId: number | null;
  category: string | null;
}): Promise<AccountFirstConsentReadiness> {
  if (!session.category || !ACCOUNT_FIRST_CATEGORIES.includes(session.category)) {
    return { outcome: "not_account_first" };
  }
  if (session.accountUserId == null) return { outcome: "account_required", reason: "no_account" };

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.id, session.accountUserId))
    .limit(1);

  if (!user) return { outcome: "account_required", reason: "account_missing" };
  if (user.email !== session.email.trim().toLowerCase()) {
    log.warn(
      { sessionId: session.id, userId: user.id },
      "account-first consent: REFUSED — the session's account no longer carries the session's address",
    );
    return { outcome: "account_required", reason: "email_mismatch" };
  }
  if (!user.passwordHash) return { outcome: "account_required", reason: "password_not_set" };
  if ((await activeMfaMethodCount(user.id)) === 0) {
    return { outcome: "account_required", reason: "mfa_not_enrolled" };
  }
  return { outcome: "ready", userId: user.id };
}

/**
 * checkAccountFirstConsentReady for a session known only by id (the read-consent
 * URL route), with the category the caller already resolved from the catalog.
 * Out-of-scope categories return without touching the database.
 */
export async function checkAccountFirstConsentReadyForSession(
  sessionId: string,
  category: string | null,
): Promise<AccountFirstConsentReadiness> {
  if (!category || !ACCOUNT_FIRST_CATEGORIES.includes(category)) return { outcome: "not_account_first" };

  const [row] = await db
    .select({ id: checkoutSessionsTable.id, email: checkoutSessionsTable.email, accountUserId: checkoutSessionsTable.accountUserId })
    .from(checkoutSessionsTable)
    .where(eq(checkoutSessionsTable.id, sessionId))
    .limit(1);
  if (!row) return { outcome: "account_required", reason: "no_account" };

  return checkAccountFirstConsentReady({ ...row, category });
}

export interface ResumablePurchase {
  sessionId: string;
  productSlug: string;
  productCategory: string;
  seats: number;
  status: "pending" | "consented" | "paid";
  tenantConnected: boolean;
  email: string;
  fullName: string;
  company: string | null;
  /** True when the session had lapsed and this call extended it. */
  renewed: boolean;
}

/**
 * The signed-in buyer's most recent unfinished account-first purchase: a
 * session this account owns (accountUserId), still at the account's address,
 * for an account-first product, created within RESUME_WINDOW_MS. `paid`
 * sessions are included — a buyer who paid and lost the tab before the portal
 * handoff (or, for Packs, before the post-payment write-access steps) resumes
 * there. A lapsed session is renewed for SESSION_TTL_MS.
 *
 * The caller must have authenticated the user; this function trusts userId.
 */
export async function findResumablePurchase(userId: number): Promise<ResumablePurchase | null> {
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return null;

  const [row] = await db
    .select({
      id: checkoutSessionsTable.id,
      productSlug: checkoutSessionsTable.productSlug,
      seats: checkoutSessionsTable.seats,
      status: checkoutSessionsTable.status,
      tenantId: checkoutSessionsTable.tenantId,
      email: checkoutSessionsTable.email,
      fullName: checkoutSessionsTable.fullName,
      company: checkoutSessionsTable.company,
      expiresAt: checkoutSessionsTable.expiresAt,
      category: servicesTable.category,
    })
    .from(checkoutSessionsTable)
    .innerJoin(servicesTable, eq(servicesTable.slug, checkoutSessionsTable.productSlug))
    .where(
      and(
        eq(checkoutSessionsTable.accountUserId, user.id),
        sql`lower(trim(${checkoutSessionsTable.email})) = ${user.email}`,
        inArray(checkoutSessionsTable.status, ["pending", "consented", "paid"]),
        inArray(servicesTable.category, [...ACCOUNT_FIRST_CATEGORIES]),
        gte(checkoutSessionsTable.createdAt, new Date(Date.now() - RESUME_WINDOW_MS)),
      ),
    )
    .orderBy(desc(checkoutSessionsTable.updatedAt), desc(checkoutSessionsTable.createdAt))
    .limit(1);

  if (!row || !row.category) return null;

  let renewed = false;
  if (row.expiresAt.getTime() < Date.now()) {
    const now = new Date();
    await db
      .update(checkoutSessionsTable)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS), updatedAt: now })
      .where(eq(checkoutSessionsTable.id, row.id));
    renewed = true;
    log.info(
      { sessionId: row.id, userId: user.id, status: row.status },
      "account-first resume: lapsed purchase session renewed for its signed-in owner",
    );
  }

  return {
    sessionId: row.id,
    productSlug: row.productSlug,
    productCategory: row.category,
    seats: row.seats,
    status: row.status as ResumablePurchase["status"],
    tenantConnected: !!row.tenantId?.trim(),
    email: user.email,
    fullName: row.fullName,
    company: row.company,
    renewed,
  };
}

export type MonitoringSelectionResult =
  | { ok: true; productSlug: string; seats: number }
  | {
      ok: false;
      status: 400 | 404 | 409;
      error:
        | "session_invalid"
        | "session_expired"
        | "already_paid"
        | "not_monitoring"
        | "product_not_found"
        | "seats_locked"
        | "seat_band_mismatch";
      message?: string;
    };

/**
 * Re-point an unpaid Monitoring session at a different tier/seat selection in
 * place. Keyed on the session UUID, like every other purchase-session step.
 *
 *   - `paid` sessions are refused: what was charged is what was bought.
 *   - Monitoring → Monitoring only, and only onto a real public catalog row.
 *   - Once a tenant is connected the seat count is fixed (seats_locked); a tier
 *     change is still allowed, which keeps the same seat band.
 *   - The seat count must sit inside the target row's band — the same rule the
 *     payment intent enforces, checked here so the page learns it at the click.
 */
export async function updateMonitoringSelection(
  rawSessionId: unknown,
  productSlug: string,
  seats: number,
): Promise<MonitoringSelectionResult> {
  const sessionId = typeof rawSessionId === "string" ? rawSessionId : "";
  if (!UUID_RE.test(sessionId)) return { ok: false, status: 400, error: "session_invalid" };

  const [session] = await db
    .select({
      id: checkoutSessionsTable.id,
      status: checkoutSessionsTable.status,
      seats: checkoutSessionsTable.seats,
      tenantId: checkoutSessionsTable.tenantId,
      category: servicesTable.category,
    })
    .from(checkoutSessionsTable)
    .leftJoin(servicesTable, eq(servicesTable.slug, checkoutSessionsTable.productSlug))
    .where(and(eq(checkoutSessionsTable.id, sessionId), gte(checkoutSessionsTable.expiresAt, new Date())))
    .limit(1);

  if (!session || session.status === "expired") return { ok: false, status: 404, error: "session_expired" };
  if (session.status === "paid") return { ok: false, status: 409, error: "already_paid" };
  if (session.category !== "monitoring") return { ok: false, status: 409, error: "not_monitoring" };

  const [target] = await db
    .select({
      slug: servicesTable.slug,
      category: servicesTable.category,
      visibility: servicesTable.visibility,
      typeAttributes: servicesTable.typeAttributes,
    })
    .from(servicesTable)
    .where(eq(servicesTable.slug, productSlug))
    .limit(1);

  if (!target || target.category !== "monitoring" || target.visibility !== "public") {
    return { ok: false, status: 404, error: "product_not_found" };
  }

  const tenantConnected = !!session.tenantId?.trim();
  if (tenantConnected && seats !== session.seats) {
    return { ok: false, status: 409, error: "seats_locked" };
  }

  const bandViolation = seatBandViolationMessage(target, seats);
  if (bandViolation) {
    return { ok: false, status: 409, error: "seat_band_mismatch", message: bandViolation };
  }

  await db
    .update(checkoutSessionsTable)
    .set({ productSlug, seats, updatedAt: new Date() })
    .where(and(eq(checkoutSessionsTable.id, session.id), ne(checkoutSessionsTable.status, "paid")));

  log.info(
    { sessionId: session.id, productSlug, seats, tenantConnected },
    "account-first checkout: monitoring selection updated on the session",
  );
  return { ok: true, productSlug, seats };
}
