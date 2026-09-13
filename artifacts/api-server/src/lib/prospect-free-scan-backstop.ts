/**
 * prospect-free-scan-backstop.ts — Git #3946 (Feature #2745, Epic #1352).
 *
 * ── Corrected scope (read this before touching `ensureMonitoringScanKickoff`) ──
 * #3946 originally audited `ensureMonitoringScanKickoff` (monitoring-onboarding-
 * scan.ts) and concluded Free Scan needed a second call into it. That premise
 * was wrong and was corrected on the issue before this build: the real, live
 * scan trigger for every consented checkout session — including a Free Scan
 * Prospect's — is the generic one already built into GET /api/consent/callback
 * (consent.ts), which provisions the Prospect and fires runDiagnostics with the
 * real customerId and the corrected `core:free-scan-full` packageKey (#1169).
 * A second call site duplicating that trigger is not needed and risks a
 * redundant/duplicate scan. `ensureMonitoringScanKickoff` itself is NOT
 * modified by this file — it is a different, paid-Monitoring-purchase-specific
 * contract and stays exactly as #1314 built it.
 *
 * ── What THIS module actually is ────────────────────────────────────────────
 * The real, narrower gap: `ensureMonitoringScanKickoff` exists for paid
 * Monitoring customers specifically because the consent-time fire-and-forget
 * run can fail before it ever inserts its msp_diagnostic_runs row — and a paid
 * customer landing on an empty dashboard has no self-serve retry. The exact
 * same risk exists for a Free Scan Prospect landing on Phase 6's locked
 * results view (#1358) with no scan ever having actually started. This module
 * is that same backstop shape, scoped to the Free Scan Prospect flow: given a
 * customerId already resolved by the caller, no-op if a diagnostic run already
 * exists (the consent-time scan already covered it), otherwise kick one off
 * with the free-scan package.
 *
 * ── No caller yet, by design ────────────────────────────────────────────────
 * This is pure engine-layer work. The real intended callers are Phase 6
 * (#1358, the locked results view a Prospect lands on) and Phase 7 (#1359, the
 * return-link flow) of #1352 — both still open/unbuilt as of this commit. This
 * function is not wired into either; it is additive engine-layer work they
 * will call once they land. Not orphaned/dead code.
 */

import { db, mspDiagnosticRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.ts";

// Same channel ensureMonitoringScanKickoff rides — this is a scan trigger too.
const log = logger.child({ channel: "engine.monitor" });

/** The one runDiagnostics option this module ever sets. */
export interface ProspectFreeScanTriggerOpts {
  customerId: number;
  packageKey: "core:free-scan-full";
  isAssessmentTriggered: true;
}

export type ProspectFreeScanBackstopResult =
  | { fired: false; reason: "already_kicked_off"; customerId: number; existingRunId: string }
  | { fired: true; reason: "kicked_off"; customerId: number };

export interface EnsureProspectFreeScanDeps {
  /**
   * The scan trigger. Defaults to the real runDiagnostics, dynamically
   * imported to avoid the circular-load concern consent.ts documents at its
   * own call site (the same reason ensureMonitoringScanKickoff imports it
   * dynamically). Injectable so a test can assert the decision without firing
   * a real, Graph-hitting scan.
   */
  triggerScan?: (opts: ProspectFreeScanTriggerOpts) => Promise<unknown>;
}

/**
 * Ensure a Free Scan has been kicked off for a Prospect's customerId. Idempotent
 * and safe to call more than once: it fires at most one scan per customer.
 *
 * The caller resolves and passes the real customerId — this function does not
 * resolve Prospect identity itself. The idempotency check (existing-run lookup)
 * is awaited; the scan itself is fired fire-and-forget so it never delays the
 * caller's response, matching ensureMonitoringScanKickoff's own pattern.
 */
export async function ensureProspectFreeScanBackstop(
  customerId: number,
  deps: EnsureProspectFreeScanDeps = {},
): Promise<ProspectFreeScanBackstopResult> {
  // Idempotency: if any diagnostic run already exists for this customer, the
  // scan is already handled (the consent callback fires one for every
  // consented checkout session, including Free Scan). Skip rather than
  // double-scan.
  const [existing] = await db
    .select({ runId: mspDiagnosticRunsTable.runId })
    .from(mspDiagnosticRunsTable)
    .where(eq(mspDiagnosticRunsTable.customerId, customerId))
    .limit(1);

  if (existing) {
    log.info(
      { customerId, existingRunId: existing.runId },
      "prospect free-scan backstop: a run already exists for this customer — skipping (consent-time scan already covered it)",
    );
    return { fired: false, reason: "already_kicked_off", customerId, existingRunId: existing.runId };
  }

  // No run yet — kick one off. Fire-and-forget so the caller (Phase 6/7's
  // locked-results/return-link flow) is never delayed by a scan.
  const triggerScan =
    deps.triggerScan ??
    (async (opts: ProspectFreeScanTriggerOpts) => {
      const { runDiagnostics } = await import("./diagnostics-runner.ts");
      return runDiagnostics(opts);
    });

  void triggerScan({ customerId, packageKey: "core:free-scan-full", isAssessmentTriggered: true })
    .then(() =>
      log.info(
        { customerId, packageKey: "core:free-scan-full" },
        "prospect free-scan backstop: kicked off for Prospect (no consent-time run had landed)",
      ),
    )
    .catch((err) =>
      log.error(
        { err, customerId },
        "prospect free-scan backstop: kickoff failed (non-fatal — caller's own flow still proceeds)",
      ),
    );

  return { fired: true, reason: "kicked_off", customerId };
}
