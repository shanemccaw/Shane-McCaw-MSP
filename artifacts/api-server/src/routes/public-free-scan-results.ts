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
 * The backstop call and the LOCKED projection (PillarFinding.recommendation is
 * never serialized) live in lib/free-scan-locked-results.ts, shared with the
 * Free Scan return link (Git #1359) so both doors serve the same payload.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { resolveFlowSession, resolveConsentedTenant } from "./consent.ts";
import { buildFreeScanLockedResults } from "../lib/free-scan-locked-results.ts";
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

  try {
    res.json(await buildFreeScanLockedResults(customer.id));
  } catch (err) {
    log.error({ err, customerId: customer.id }, "free-scan results: buildPillarSummary failed");
    res.status(500).json({ error: "Failed to compute scan results" });
  }
});

export default router;
