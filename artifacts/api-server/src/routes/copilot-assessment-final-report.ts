/**
 * copilot-assessment-final-report.ts
 *
 * POST /api/portal/copilot-assessment/final-report — Copilot Assessment epic
 * (#183), Phase 8 / #191. Accepts the quiz-taker's real QuizProfile, the real
 * generated PersonaStory[] (#186) already held in the wizard's client-side
 * state, and the real user-configured GovernanceState, then returns a
 * 6-8 sentence executive narrative plus the real deterministic ROI score via
 * final-report-narrative-generator.ts. Stateless, same convention as
 * copilot-assessment-personas.ts — nothing persisted, re-issued whenever the
 * report step is (re)entered.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { resolveMspId } from "../lib/resolve-msp-id.ts";
import { resolveBillingMspId } from "../lib/ai-billing.ts";
import {
  generateFinalReportNarrative,
  type FinalReportQuizProfile,
  type FinalReportPersona,
  type FinalReportGovernance,
} from "../lib/final-report-narrative-generator.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

function isValidQuizProfile(body: unknown): body is FinalReportQuizProfile {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.role === "string" &&
    typeof b.department === "string" &&
    typeof b.industry === "string" &&
    Array.isArray(b.collaboration) &&
    Array.isArray(b.sensitivity) &&
    typeof b.workflowStyle === "string" &&
    Array.isArray(b.outcomePriorities) &&
    typeof b.draftingLoad === "number" &&
    typeof b.researchLoad === "number" &&
    typeof b.communicationLoad === "number" &&
    typeof b.repetitiveLoad === "number" &&
    Array.isArray(b.toolUsage) &&
    typeof b.aiComfort === "string"
  );
}

function isValidPersona(body: unknown): body is FinalReportPersona {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.id === "string" &&
    typeof b.name === "string" &&
    typeof b.role === "string" &&
    typeof b.department === "string" &&
    typeof b.useCaseCluster === "string" &&
    Array.isArray(b.sensitivitySet) &&
    Array.isArray(b.collaborationPattern) &&
    Array.isArray(b.outcomePriorities) &&
    typeof b.riskScore === "number" &&
    typeof b.feasibilityScore === "number" &&
    typeof b.adoptionFriction === "number" &&
    Array.isArray(b.sensitivityExposure) &&
    Array.isArray(b.collaborationFriction) &&
    !!b.valuePotential &&
    typeof b.valuePotential === "object" &&
    !!b.shortStory &&
    typeof b.shortStory === "object"
  );
}

function isValidGovernance(body: unknown): body is FinalReportGovernance {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.ca01 === "boolean" &&
    typeof b.pim === "boolean" &&
    typeof b.sensitivityLabels === "boolean" &&
    (b.dlp === "off" || b.dlp === "moderate" || b.dlp === "strict")
  );
}

router.post(
  "/portal/copilot-assessment/final-report",
  requireAuth,
  async (req: Request, res: Response) => {
    const { quizProfile, personas, governance } = req.body as {
      quizProfile?: unknown;
      personas?: unknown;
      governance?: unknown;
    };

    if (!isValidQuizProfile(quizProfile)) {
      res.status(400).json({ error: "quizProfile is required and must match the QuizProfile shape" });
      return;
    }
    if (!Array.isArray(personas) || personas.length === 0 || !personas.every(isValidPersona)) {
      res.status(400).json({ error: "personas is required and must be a non-empty array of PersonaStory objects" });
      return;
    }
    if (!isValidGovernance(governance)) {
      res.status(400).json({ error: "governance is required and must match the GovernanceState shape" });
      return;
    }

    const user = req.user!;
    const mspId = await resolveMspId(req);
    const billingMspId = resolveBillingMspId(user) ?? mspId;
    const customerId = user.customerId ?? null;

    try {
      const result = await generateFinalReportNarrative({
        quizProfile,
        personas,
        governance,
        attribution: {
          mspId: billingMspId,
          customerId,
          triggerSource: "copilot-assessment-final-report",
        },
      });
      res.json(result);
    } catch (err) {
      log.error({ err, userId: user.id }, "copilot-assessment-final-report: generation failed");
      res.status(503).json({ error: "Final report generation is temporarily unavailable. Please try again shortly." });
    }
  },
);

export default router;
