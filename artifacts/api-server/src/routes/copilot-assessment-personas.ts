/**
 * copilot-assessment-personas.ts
 *
 * POST /api/portal/copilot-assessment/personas — Copilot Assessment epic
 * (#183), Phase 3 / #186. Accepts the quiz-taker's real structured QuizProfile
 * (#184) and returns ~5 AI-generated archetypal personas via
 * persona-generation-engine.ts. Stateless — nothing is persisted; the wizard
 * keeps assessment state in local React state (see copilot-assessment.tsx's
 * own doc comment), and this call is re-issued whenever the personas step is
 * (re)entered.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { resolveMspId } from "../lib/resolve-msp-id.ts";
import { resolveBillingMspId } from "../lib/ai-billing.ts";
import { generatePersonaStories, type PersonaGenerationQuizProfile } from "../lib/persona-generation-engine.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

function isValidQuizProfile(body: unknown): body is PersonaGenerationQuizProfile {
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

router.post(
  "/portal/copilot-assessment/personas",
  requireAuth,
  async (req: Request, res: Response) => {
    const { quizProfile } = req.body as { quizProfile?: unknown };

    if (!isValidQuizProfile(quizProfile)) {
      res.status(400).json({ error: "quizProfile is required and must match the QuizProfile shape" });
      return;
    }

    const user = req.user!;
    const mspId = await resolveMspId(req);
    const billingMspId = resolveBillingMspId(user) ?? mspId;
    const customerId = user.customerId ?? null;

    try {
      const personas = await generatePersonaStories({
        quizProfile,
        mspId: billingMspId,
        customerId,
      });
      res.json({ personas });
    } catch (err) {
      log.error({ err, userId: user.id }, "copilot-assessment-personas: generation failed");
      res.status(503).json({ error: "Persona generation is temporarily unavailable. Please try again shortly." });
    }
  },
);

export default router;
