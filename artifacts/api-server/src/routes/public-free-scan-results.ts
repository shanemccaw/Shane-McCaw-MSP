/**
 * public-free-scan-results.ts — Git #1358 (Phase 6 of Epic #1352, Free Scan).
 *
 *   GET /api/public/free-scan/results?sessionId=<uuid>
 *
 * The locked/teaser view of a Free Scan Prospect's REAL scan results — reads
 * the exact same real computation, `buildPillarSummary(customerId)`
 * (pillar-summary-stats.ts), that GET /api/portal/pillars serves the entire
 * authenticated customer portal from. No new scoring, no fixture data — the
 * only new thing here is HOW the customerId is resolved for a caller who has
 * no portal session at all.
 *
 * A Free Scan Prospect is deliberately never issued a JWT: #656's
 * `hasRealEntitlement()` gate (see routes/auth.ts) blocks /setup-password and
 * /forgot-password for a passwordless, pre-entitlement account, and
 * lib/free-scan-prospect.test.ts regression-locks that a Prospect's shell
 * account has no client_services row and therefore cannot pass that gate.
 * `/api/portal/pillars` itself is gated behind `requireCapability("ladder.free")`,
 * which needs a JWT this caller structurally cannot hold. So this route
 * resolves identity the same way `public-purchase-packs.ts`'s own
 * session-scoped reads do: from the free-scan checkout `sessionId` the
 * browser already tracks (used since Git #1361 to poll consent-status),
 * through the same `resolveFlowSession` → `resolveConsentedTenant` pair —
 * never from a customerId the caller supplies.
 *
 * Before reading, calls `ensureProspectFreeScanBackstop` (Git #3946) so a
 * Prospect whose consent-time scan trigger failed before it ever inserted a
 * run gets one kicked off here instead, and this route reports "scanning"
 * rather than an empty/broken results view.
 *
 * LOCKED, per #1358's own directive ("real pillar scores, real finding
 * counts visible; full remediation detail/write-access locked behind
 * conversion") and the marketing page's own promise ("The findings are yours
 * free"): every pillar score and every real finding — severity, title, the
 * actual evidence items, why it matters — is returned. What is deliberately
 * NEVER put on this wire at all is `PillarFinding.recommendation` (the real
 * fix/action) — that is the one field Monitoring pays for, and it is a
 * server-side omission here, not a client-side hide.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { resolveFlowSession, resolveConsentedTenant } from "./consent.ts";
import { buildPillarSummary } from "../lib/pillar-summary-stats.ts";
import { ensureProspectFreeScanBackstop } from "../lib/prospect-free-scan-backstop.ts";
import { logger } from "../lib/logger.ts";

// Same channel /portal/pillars' own route logs under (engine.dashboard) — this
// is that exact computation, just reached through a different identity door.
const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

router.get("/public/free-scan/results", async (req: Request, res: Response): Promise<void> => {
  const session = await resolveFlowSession(req.query.sessionId, res);
  if (!session) return;

  const customer = await resolveConsentedTenant(session, res);
  if (!customer) return;

  // Idempotent no-op if the consent-time trigger already landed a run; fires
  // one (fire-and-forget) if it genuinely never did. Never blocks the
  // response — the read below reports the real state either way.
  try {
    await ensureProspectFreeScanBackstop(customer.id);
  } catch (err) {
    log.error(
      { err, customerId: customer.id },
      "free-scan results: backstop check failed (non-fatal — proceeding to read real state)",
    );
  }

  let payload;
  try {
    payload = await buildPillarSummary(customer.id);
  } catch (err) {
    log.error({ err, customerId: customer.id }, "free-scan results: buildPillarSummary failed");
    res.status(500).json({ error: "Failed to compute scan results" });
    return;
  }

  // Real, not implied: `activeRunId` is only ever set while a run genuinely
  // has status pending/running (ACTIVE_RUN_STATUSES); `findingsRunId` is only
  // set once some run has actually produced findings. A Prospect is "ready"
  // only once a run has settled AND at least one run has ever produced
  // findings to show.
  const ready = payload.activeRunId === null && payload.findingsRunId !== null;
  if (!ready) {
    res.json({
      status: "scanning",
      activeRunId: payload.activeRunId,
      findingsRunId: payload.findingsRunId,
    });
    return;
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

  res.json({
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
  });
});

export default router;
