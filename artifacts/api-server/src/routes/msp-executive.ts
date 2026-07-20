/**
 * msp-executive.ts
 *
 * MSP Executive Mode — a stripped-down leadership view for the MSP owner. Two
 * ranked lists over the caller's whole book (top-risk tenants, top-opportunity
 * tenants) plus an AI-generated Partner QBR (quarterly business review) document.
 *
 * Deliberately a simplified COMPANION to the full customers list (customers.tsx),
 * not a replacement — it surfaces only the handful of things leadership acts on.
 *
 * Routes:
 *   GET  /api/msp/executive            (MSPOperator+) — top risks + top opportunities + roll-up
 *   GET  /api/msp/executive/qbr        (MSPAdmin+)    — current quarter's cached QBR (no generation)
 *   POST /api/msp/executive/qbr/generate (MSPAdmin+)  — generate/regenerate the current quarter's QBR
 *
 * Scoping mirrors msp-alerts.ts exactly: mspId from the session JWT via
 * resolveMspIdStrict (no ?mspId= override), and staff customer-scoping folded
 * into every book query at the DB level via resolveStaffScopedCustomerIds.
 *
 * The two lists respect staff scoping (an MSPOperator sees only their assigned
 * customers). The Partner QBR is a whole-book leadership artifact and is gated to
 * MSPAdmin+ — it is intentionally generated over the entire book, not scoped.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireRole, resolveStaffScopedCustomerIds } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { gatherExecutiveBook } from "../lib/msp-executive-data.ts";
import { getCurrentPartnerQbr, getOrGeneratePartnerQbr, currentQuarterKey } from "../lib/partner-qbr-generator.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

// ── Top risks + top opportunities (scoped to the caller's book) ────────────────
router.get("/msp/executive", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }

    const scopedIds = await resolveStaffScopedCustomerIds(req.user!);
    const book = await gatherExecutiveBook(mspId, scopedIds);
    res.json(book);
  } catch (err) {
    log.error({ err }, "msp-executive: GET /msp/executive failed");
    res.status(500).json({ error: "Failed to load executive view" });
  }
});

// ── Current quarter's cached Partner QBR (viewing never triggers generation) ───
router.get("/msp/executive/qbr", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }

    const qbr = await getCurrentPartnerQbr(mspId);
    res.json({ quarterKey: currentQuarterKey(), qbr });
  } catch (err) {
    log.error({ err }, "msp-executive: GET /msp/executive/qbr failed");
    res.status(500).json({ error: "Failed to load QBR" });
  }
});

// ── Generate / regenerate the current quarter's Partner QBR ────────────────────
router.post("/msp/executive/qbr/generate", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }

    const force = req.body?.force === true;
    const qbr = await getOrGeneratePartnerQbr(mspId, { force });
    if (qbr === null) {
      res.status(422).json({ error: "No customers in your book to review yet." });
      return;
    }
    if (qbr.status === "failed") {
      res.status(502).json({ error: qbr.errorMessage ?? "QBR generation failed", qbr });
      return;
    }
    res.json({ qbr });
  } catch (err) {
    log.error({ err }, "msp-executive: POST /msp/executive/qbr/generate failed");
    res.status(500).json({ error: "Failed to generate QBR" });
  }
});

export default router;
