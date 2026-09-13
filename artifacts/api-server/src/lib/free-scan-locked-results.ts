/**
 * free-scan-locked-results.ts — the locked/teaser Free Scan results payload for
 * one customer (tenants.id).
 *
 * Extracted from GET /api/public/free-scan/results (Git #1358,
 * routes/public-free-scan-results.ts) so the Free Scan return link (Git #1359,
 * routes/public-free-scan-return.ts) serves the exact same locked projection —
 * one place decides what a Prospect is shown, whichever door they came in by.
 * The two routes differ ONLY in how they resolve the customerId: the checkout
 * sessionId for the live flow, the emailed return-link token for a return visit.
 *
 * Reads the same real computation, `buildPillarSummary(customerId)`
 * (pillar-summary-stats.ts), that GET /api/portal/pillars serves the
 * authenticated portal from. No new scoring, no fixture data.
 *
 * Before reading, calls `ensureProspectFreeScanBackstop` (Git #3946) so a
 * Prospect whose consent-time scan trigger failed before it ever inserted a
 * run gets one kicked off here instead, and this reports "scanning" rather than
 * an empty/broken results view.
 *
 * LOCKED, per #1358's own directive ("real pillar scores, real finding counts
 * visible; full remediation detail/write-access locked behind conversion"):
 * every pillar score and every real finding — severity, title, the actual
 * evidence items, why it matters — is returned. What is deliberately NEVER put
 * on this wire at all is `PillarFinding.recommendation` (the real fix/action) —
 * that is the one field Monitoring pays for, and it is a server-side omission
 * here, not a client-side hide.
 */

import { buildPillarSummary } from "./pillar-summary-stats.ts";
import { ensureProspectFreeScanBackstop } from "./prospect-free-scan-backstop.ts";
import { logger } from "./logger.ts";

// Same channel /portal/pillars' own route logs under (engine.dashboard) — this
// is that exact computation, just reached through a different identity door.
const log = logger.child({ channel: "engine.dashboard" });

export type FreeScanLockedResults = Record<string, unknown> & { status: "scanning" | "ready" };

/** Throws only if buildPillarSummary itself fails; the backstop is non-fatal. */
export async function buildFreeScanLockedResults(customerId: number): Promise<FreeScanLockedResults> {
  // Idempotent no-op if the consent-time trigger already landed a run; fires
  // one (fire-and-forget) if it genuinely never did. Never blocks the
  // response — the read below reports the real state either way.
  try {
    await ensureProspectFreeScanBackstop(customerId);
  } catch (err) {
    log.error(
      { err, customerId },
      "free-scan results: backstop check failed (non-fatal — proceeding to read real state)",
    );
  }

  const payload = await buildPillarSummary(customerId);

  // Real, not implied: `activeRunId` is only ever set while a run genuinely
  // has status pending/running (ACTIVE_RUN_STATUSES); `findingsRunId` is only
  // set once some run has actually produced findings. A Prospect is "ready"
  // only once a run has settled AND at least one run has ever produced
  // findings to show.
  const ready = payload.activeRunId === null && payload.findingsRunId !== null;
  if (!ready) {
    return {
      status: "scanning",
      activeRunId: payload.activeRunId,
      findingsRunId: payload.findingsRunId,
    };
  }

  // The real annual licence-waste figure, straight off the Licensing pillar's
  // own stat (`licensing.annualWaste`) — the SAME number the authenticated
  // dashboard renders, never re-derived here.
  const licensingCard = payload.pillars.find((p) => p.pillar === "licensing");
  const annualWasteDollars = licensingCard?.stats.find((s) => s.id === "licensing.annualWaste")?.value ?? null;

  let totalFindings = 0;
  let criticalFindings = 0;
  for (const pillar of payload.pillars) {
    totalFindings += pillar.findingCounts.critical + pillar.findingCounts.warning;
    criticalFindings += pillar.findingCounts.critical;
  }

  return {
    status: "ready",
    generatedAt: payload.generatedAt,
    totalFindings,
    criticalFindings,
    annualWasteDollars,
    pillars: payload.pillars.map((p) => ({
      pillar: p.pillar,
      score: p.score,
      evaluation: p.evaluation,
      findingCounts: p.findingCounts,
      findings: p.findings.map((f) => ({
        severity: f.severity,
        checkKey: f.checkKey,
        title: f.title,
        description: f.description ?? null,
        whyItMatters: f.whyItMatters ?? null,
        evidence: f.evidence ?? null,
        // `recommendation` is deliberately never serialized here — see file header.
      })),
    })),
  };
}
