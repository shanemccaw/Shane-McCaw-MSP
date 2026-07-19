/**
 * assessment-doc-trigger.ts
 *
 * Fires engagement-document generation for **Free / Assessment-tier orders only**,
 * gated on genuine customer engagement rather than payment.
 *
 * Background
 * ----------
 * Regular paid monitoring subscriptions generate their engagement documents from
 * the payment-gated "On Purchase — Generate Engagement Documents" workflow, so AI
 * credits are never spent on abandoned checkouts. Assessment/Free orders have no
 * payment to gate on — the whole point of a free assessment is producing real
 * documents *before* payment, as the lead-gen hook — but we still don't want to
 * burn AI credit on a customer who consented and then vanished. So we gate on the
 * same idea (real engagement) via a different signal: the customer must have both
 *
 *   1. a completed diagnostics/telemetry scan (msp_diagnostic_runs.status='completed'), AND
 *   2. actually logged into the portal at least once (a real user_sessions row).
 *
 * Neither alone is sufficient, and either can happen first (the scan runs on
 * consent, pre-login; the customer may log in before or after it finishes). So
 * this is a two-sided "wait for both" — whichever becomes true second is what
 * fires generation:
 *
 *   - diagnostics.run_completed → onDiagnosticsRunCompleted() (checks: has logged in?)
 *   - first-login endpoint       → onFirstLoginComplete()       (checks: scan done?)
 *
 * Both funnel through the single {@link maybeFireAssessmentDocs} gate, which
 * re-checks *all* conditions against live DB state (never trusting that an event
 * merely fired — events can be missed or replayed), then reuses the existing
 * {@link autoFireAllDocumentCards} mechanism verbatim to bulk-fire every eligible
 * document_generation kanban card in the customer's project.
 *
 * Why user_sessions for "has logged in":
 *   - msp_users.last_login_at is defined in the schema but is never written
 *     anywhere in the codebase — it is effectively always null, unusable.
 *   - users.sharepoint_site_url (what first-login provisioning writes) only lands
 *     on *successful* Graph provisioning ~60s after login, and stays null forever
 *     if provisioning fails or Graph creds are absent — so it would wrongly block
 *     doc-gen for a genuinely-engaged customer.
 *   - user_sessions gets a row per real login (auth.ts / mfa.ts createSession),
 *     making "a standard user_sessions row exists" the authoritative, provisioning-
 *     independent "this customer has logged in at least once" signal.
 *
 * Double-fire safety (a customer logging in right as their scan completes):
 *   - The in-flight Set below collapses concurrent gate calls per user.
 *   - autoFireAllDocumentCards itself atomically moves eligible cards to
 *     in_progress before dispatching any AI call, so a redundant later call finds
 *     no backlog cards and no-ops. This is the durable, cross-process layer.
 */

import {
  db,
  mspUsersTable,
  tenantConsentTable,
  mspCustomersTable,
  clientServicesTable,
  servicesTable,
  mspDiagnosticRunsTable,
  userSessionsTable,
} from "@workspace/db";
import { and, eq, or } from "drizzle-orm";
import { logger } from "./logger";
import { autoFireAllDocumentCards } from "./kanban-auto-fire";

const log = logger.child({ channel: "engine.kanban" });

/** Users whose gate is mid-evaluation in this process — collapses concurrent kicks. */
const inFlight = new Set<number>();

interface CustomerContext {
  customerId: number | null;
  tenantId: string | null;
}

/**
 * Resolve a customer's msp_customers.id and Azure AD tenantId from a users.id.
 * Best-effort — any field may come back null if the linkage isn't stamped yet.
 * Bridges the two id-spaces documented in the memory "Engine id-space: users.id
 * vs msp_customers.id": there is no direct FK on msp_customers, so we go through
 * msp_users (userId → customerId) and tenant_consent (clientUserId → tenantId).
 */
async function resolveCustomerContextForUser(userId: number): Promise<CustomerContext> {
  let customerId: number | null = null;
  let tenantId: string | null = null;

  const [mspUser] = await db
    .select({ customerId: mspUsersTable.customerId })
    .from(mspUsersTable)
    .where(eq(mspUsersTable.userId, userId))
    .limit(1);
  if (mspUser?.customerId != null) customerId = mspUser.customerId;

  const [consent] = await db
    .select({ tenantId: tenantConsentTable.tenantId, customerId: tenantConsentTable.customerId })
    .from(tenantConsentTable)
    .where(eq(tenantConsentTable.clientUserId, userId))
    .limit(1);
  if (consent?.tenantId != null) tenantId = consent.tenantId;
  if (customerId == null && consent?.customerId != null) customerId = consent.customerId;

  // Fall back to the customer row's tenantId if consent didn't carry one.
  if (tenantId == null && customerId != null) {
    const [customer] = await db
      .select({ tenantId: mspCustomersTable.tenantId })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.id, customerId))
      .limit(1);
    if (customer?.tenantId != null) tenantId = customer.tenantId;
  }

  return { customerId, tenantId };
}

/**
 * Resolve the client users.id for a completed diagnostics run, given its
 * customerId (msp_customers.id) and/or tenantId from the run payload.
 * tenant_consent.clientUserId is preferred — it is the exact user who consented;
 * msp_users is the fallback bridge from the customer org.
 */
async function resolveUserIdForRun(ctx: { customerId?: number | null; tenantId?: string | null }): Promise<number | null> {
  if (ctx.tenantId) {
    const [consent] = await db
      .select({ clientUserId: tenantConsentTable.clientUserId })
      .from(tenantConsentTable)
      .where(eq(tenantConsentTable.tenantId, ctx.tenantId))
      .limit(1);
    if (consent?.clientUserId != null) return consent.clientUserId;
  }

  if (ctx.customerId != null) {
    const [mspUser] = await db
      .select({ userId: mspUsersTable.userId })
      .from(mspUsersTable)
      .where(eq(mspUsersTable.customerId, ctx.customerId))
      .limit(1);
    if (mspUser?.userId != null) return mspUser.userId;
  }

  return null;
}

/**
 * True when this user has purchased/ordered an Assessment-tier product
 * (services.delivery_type = 'assessment'). This is the discriminator that keeps
 * regular paid monitoring subscriptions (delivery_type='bundle_subscription')
 * completely untouched by this trigger — they have no assessment client_service,
 * so the gate is a pure no-op for them.
 */
async function isAssessmentTierOrder(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: clientServicesTable.id })
    .from(clientServicesTable)
    .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
    .where(and(eq(clientServicesTable.clientUserId, userId), eq(servicesTable.deliveryType, "assessment")))
    .limit(1);
  return row != null;
}

/**
 * True when a diagnostics/telemetry scan has actually COMPLETED for this
 * customer (DB source of truth, not merely "an event fired"). Matches the
 * completed-only bar used by the "Diagnostics Completion — Generate Sales
 * Offers" workflow: a partial/failed run has incomplete findings and is not a
 * reliable basis to spend AI credit generating engagement documents.
 */
async function hasCompletedScan(userId: number): Promise<boolean> {
  const { customerId, tenantId } = await resolveCustomerContextForUser(userId);
  if (customerId == null && tenantId == null) return false;

  const scopeConds = [];
  if (customerId != null) scopeConds.push(eq(mspDiagnosticRunsTable.customerId, customerId));
  if (tenantId != null) scopeConds.push(eq(mspDiagnosticRunsTable.tenantId, tenantId));

  const [row] = await db
    .select({ id: mspDiagnosticRunsTable.id })
    .from(mspDiagnosticRunsTable)
    .where(and(eq(mspDiagnosticRunsTable.status, "completed"), scopeConds.length === 1 ? scopeConds[0] : or(...scopeConds)))
    .limit(1);
  return row != null;
}

/**
 * True when the customer has genuinely logged into the portal at least once —
 * a real, non-impersonation user_sessions row exists (revoked or not; a revoked
 * session still proves a past login). See the module header for why this beats
 * last_login_at / sharepoint_site_url.
 */
async function hasLoggedIn(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: userSessionsTable.id })
    .from(userSessionsTable)
    .where(and(eq(userSessionsTable.userId, userId), eq(userSessionsTable.sessionType, "standard")))
    .limit(1);
  return row != null;
}

/**
 * The single two-sided gate. Fires document generation only when the order is
 * Assessment-tier AND the scan has completed AND the customer has logged in.
 * Safe to call from either trigger side and repeatedly — the in-flight Set plus
 * autoFireAllDocumentCards' own card-level idempotency prevent double-firing.
 *
 * @param assumeLoggedIn set by the first-login side (the call IS the login
 *   event), which skips the user_sessions check to avoid a lag/deadlock race
 *   where the freshly-created session row isn't yet visible.
 */
async function maybeFireAssessmentDocs(
  userId: number,
  opts: { source: "diagnostics" | "first-login"; assumeLoggedIn: boolean },
): Promise<void> {
  if (inFlight.has(userId)) {
    log.debug({ userId, source: opts.source }, "assessment-doc-trigger: gate already evaluating for user — skipping duplicate");
    return;
  }
  inFlight.add(userId);
  try {
    if (!(await isAssessmentTierOrder(userId))) {
      log.debug({ userId, source: opts.source }, "assessment-doc-trigger: not an assessment-tier order — no-op");
      return;
    }

    const loggedIn = opts.assumeLoggedIn || (await hasLoggedIn(userId));
    if (!loggedIn) {
      log.info({ userId, source: opts.source }, "assessment-doc-trigger: scan done but customer has not logged in yet — waiting for first login");
      return;
    }

    if (!(await hasCompletedScan(userId))) {
      log.info({ userId, source: opts.source }, "assessment-doc-trigger: customer logged in but scan not completed yet — waiting for diagnostics.run_completed");
      return;
    }

    log.info({ userId, source: opts.source }, "assessment-doc-trigger: both conditions met (assessment + scan + login) — firing document generation");
    await autoFireAllDocumentCards(userId);
  } catch (err) {
    log.warn({ err, userId, source: opts.source }, "assessment-doc-trigger: gate evaluation failed (non-fatal)");
  } finally {
    inFlight.delete(userId);
  }
}

/**
 * Diagnostics-side trigger. Call fire-and-forget from the diagnostics runner
 * when a run reaches a terminal state. Only genuinely completed runs proceed;
 * the customer's users.id is resolved from the run's customer/tenant context.
 */
export async function onDiagnosticsRunCompleted(run: {
  customerId?: number | null;
  tenantId?: string | null;
  finalStatus: string;
}): Promise<void> {
  if (run.finalStatus !== "completed") return;

  const userId = await resolveUserIdForRun({ customerId: run.customerId, tenantId: run.tenantId });
  if (userId == null) {
    log.debug(
      { customerId: run.customerId, tenantId: run.tenantId },
      "assessment-doc-trigger: could not resolve client users.id for completed run — skipping (no client user to fire docs for)",
    );
    return;
  }

  await maybeFireAssessmentDocs(userId, { source: "diagnostics", assumeLoggedIn: false });
}

/**
 * First-login-side trigger. Call fire-and-forget when the customer's first-login
 * flow runs (the /portal/first-login/provision endpoint) — that firing *is* the
 * login event, so we assume the login condition is met and only need to confirm
 * the scan has completed.
 */
export async function onFirstLoginComplete(userId: number): Promise<void> {
  await maybeFireAssessmentDocs(userId, { source: "first-login", assumeLoggedIn: true });
}
