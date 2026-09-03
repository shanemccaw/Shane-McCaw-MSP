/**
 * monitoring-onboarding-scan.ts — Git #1314 (Epic #1309 Phase 5).
 *
 * Guarantees a real monitoring scan is kicked off for a newly-onboarded
 * Monitoring customer completing the generalized purchase flow
 * (public-purchase-account.ts: purchase → read consent #1311 → account #1310 →
 * portal login #1313 → THIS scan).
 *
 * ── What already exists (investigation, not assumption) ───────────────────────
 * A scan trigger already exists: the shared GET /api/consent/callback
 * (consent.ts) fires runDiagnostics() fire-and-forget at consent time, resolving
 * the ordered product's monitoring packageKey from
 * services.type_attributes->>'packageKey'. Because read consent is REQUIRED for
 * a monitoring purchase (read-consent-flow.ts:
 * readConsentRequirementForServiceType — only "retainer" may skip it), that
 * callback is ALWAYS reached, so a real scan is normally already running before
 * the buyer even finishes account setup. There is NO customer-facing self-serve
 * trigger — the portal's only trigger, POST /portal/diagnostics/debug-trigger-scan,
 * is hard-gated to testbed tenants.
 *
 * ── What this module adds ─────────────────────────────────────────────────────
 * It does NOT re-run the scan the consent callback already fires. It is the
 * first-class, IDEMPOTENT guarantee the new purchase flow itself owns: at the
 * moment the account is completed, if — and only if — no diagnostic run yet
 * exists for the completed account's tenant, it kicks one off. That closes the
 * one gap the consent-callback side-effect leaves open: were that fire-and-forget
 * run to fail before it inserted its msp_diagnostic_runs row (a transient error
 * at the very start of the run), a paid monitoring customer would otherwise land
 * on an empty dashboard with no way to trigger a scan themselves. The
 * skip-if-a-run-exists check means the common case (consent already fired one) is
 * a no-op, never a duplicate scan — runDiagnostics has no skip-if-recent guard,
 * so this module, not runDiagnostics, is where onboarding de-duplication lives.
 *
 * Scoped to monitoring products only (serviceType "monitoring_tier"); Retainer
 * (optional consent) and Quick-Start Packs (config_pack, whose own dry-run scan
 * is a separate phase) are out of #1314's scope.
 */

import { db, servicesTable, usersTable, mspDiagnosticRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.ts";
import type { PaidPurchaseSession } from "./purchase-account-flow.ts";

// The real scan engine's channel (monitor-executor.ts) — this is a scan
// trigger, so it rides the same channel rather than inventing a new leaf.
const log = logger.child({ channel: "engine.monitor" });

export type MonitoringScanKickoffResult =
  | { fired: false; reason: "not_monitoring" | "account_not_completed" | "no_tenant_link" | "already_kicked_off" }
  | { fired: true; reason: "kicked_off"; customerId: number; packageKey: string | undefined };

/** The one runDiagnostics option this module ever sets. */
export interface OnboardingScanTriggerOpts {
  customerId: number;
  packageKey?: string;
  isAssessmentTriggered: boolean;
}

export interface EnsureMonitoringScanDeps {
  /**
   * The scan trigger. Defaults to the real runDiagnostics, dynamically imported
   * to avoid the circular-load concern consent.ts documents at its own call
   * site. Injectable so a test can assert the decision without firing a real,
   * Graph-hitting scan.
   */
  triggerScan?: (opts: OnboardingScanTriggerOpts) => Promise<unknown>;
}

/**
 * Ensure a monitoring scan has been kicked off for the account this purchase
 * session completed. Idempotent and safe to call more than once (e.g. a resumed
 * Buy.tsx tab): it fires at most one onboarding scan per customer.
 *
 * The DB decision (product gate, tenant resolution, run-exists check) is
 * awaited; the scan itself is fired fire-and-forget so it never delays the
 * caller's response.
 */
export async function ensureMonitoringScanKickoff(
  session: PaidPurchaseSession,
  deps: EnsureMonitoringScanDeps = {},
): Promise<MonitoringScanKickoffResult> {
  // 1. Monitoring products only (this phase's scope). packageKey comes from the
  //    same services.type_attributes->>'packageKey' the consent callback reads,
  //    so the onboarding scan runs the customer's real monitoring package (or
  //    falls through to runDiagnostics' canonical baseline when the product
  //    declares none — never a literal "default", which yields an empty scan).
  const [svc] = await db
    .select({
      serviceType: servicesTable.serviceType,
      typeAttributes: servicesTable.typeAttributes,
    })
    .from(servicesTable)
    .where(eq(servicesTable.slug, session.productSlug))
    .limit(1);

  if (svc?.serviceType !== "monitoring_tier") {
    return { fired: false, reason: "not_monitoring" };
  }
  const rawPackageKey = svc.typeAttributes?.["packageKey"];
  const packageKey = typeof rawPackageKey === "string" && rawPackageKey.trim() ? rawPackageKey : undefined;

  // 2. Resolve the completed account's tenant. accountUserId is set only on the
  //    attachPasswordToAccount `ok` outcome (purchase-account-flow.ts) — i.e.
  //    the account was genuinely completed through THIS session. users.tenant_id
  //    IS the tenants.id runDiagnostics accepts as customerId.
  if (session.accountUserId == null) {
    return { fired: false, reason: "account_not_completed" };
  }
  const [user] = await db
    .select({ tenantId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, session.accountUserId))
    .limit(1);

  const customerId = user?.tenantId ?? null;
  if (customerId == null) {
    // The account has no tenant link — provisioning failed upstream (the paid,
    // non-functional-account state consent.ts also shouts about). Nothing valid
    // to scope a scan to; a run with no real tenant would only fail its
    // pre-flight. Log loudly rather than fire a doomed run.
    log.error(
      { sessionId: session.id, userId: session.accountUserId, productSlug: session.productSlug },
      "monitoring onboarding scan: completed account has no tenant link — cannot scope a scan",
    );
    return { fired: false, reason: "no_tenant_link" };
  }

  // 3. Idempotency: if any diagnostic run already exists for this customer, the
  //    scan is already handled (the consent callback fires one for every
  //    monitoring purchase). Skip rather than double-scan.
  const [existing] = await db
    .select({ runId: mspDiagnosticRunsTable.runId })
    .from(mspDiagnosticRunsTable)
    .where(eq(mspDiagnosticRunsTable.customerId, customerId))
    .limit(1);

  if (existing) {
    log.info(
      { sessionId: session.id, customerId, existingRunId: existing.runId },
      "monitoring onboarding scan: a run already exists for this customer — skipping (consent-time scan already covered it)",
    );
    return { fired: false, reason: "already_kicked_off" };
  }

  // 4. No run yet — kick one off. Fire-and-forget so account completion is never
  //    delayed by a scan. isAssessmentTriggered:false — this is a routine
  //    monitoring scan, not the Assessment funnel's document-generating scan.
  const triggerScan =
    deps.triggerScan ??
    (async (opts: OnboardingScanTriggerOpts) => {
      const { runDiagnostics } = await import("./diagnostics-runner.js");
      return runDiagnostics(opts);
    });

  void triggerScan({ customerId, packageKey, isAssessmentTriggered: false })
    .then(() =>
      log.info(
        { sessionId: session.id, customerId, packageKey: packageKey ?? "core:security-baseline" },
        "monitoring onboarding scan: kicked off for newly-onboarded monitoring customer (no consent-time run had landed)",
      ),
    )
    .catch((err) =>
      log.error(
        { err, sessionId: session.id, customerId },
        "monitoring onboarding scan: kickoff failed (non-fatal — buyer still lands in the portal)",
      ),
    );

  return { fired: true, reason: "kicked_off", customerId, packageKey };
}
