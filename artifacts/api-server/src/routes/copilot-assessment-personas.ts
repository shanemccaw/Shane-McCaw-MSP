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
 *
 * SSE STREAMING (#283) — Shane hit a real 502 here. This was a single
 * blocking call with zero response bytes flowing to the client for the
 * entire generation; a reverse-proxy idle-connection timeout (distinct from,
 * and typically shorter than, any max-duration timeout) reads that silence
 * as a dead upstream and kills the connection. Converted to SSE, mirroring
 * admin-ps-scripts.ts's existing pattern in this codebase: real progress
 * events (derived from the model's actual streamed character count, never a
 * fabricated stage) keep bytes flowing throughout.
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

/** Rough expected output size for a 5-persona JSON array — used only to derive an honest 0-100 progress pct from real streamed characters, same heuristic convention as admin-ps-scripts.ts. */
const EXPECTED_CHARS = 9_000;

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

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendSSE = (event: Record<string, unknown>): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    sendSSE({ type: "phase", label: "Sending your profile to M365 Copilot…", pct: 5 });

    let lastEmittedPct = 5;
    try {
      const personas = await generatePersonaStories({
        quizProfile,
        mspId: billingMspId,
        customerId,
        onProgress: (charsReceived) => {
          if (lastEmittedPct === 5) {
            sendSSE({ type: "phase", label: "Generating your persona cohort…", pct: 15 });
            lastEmittedPct = 15;
          }
          const pct = Math.min(90, Math.round(15 + (charsReceived / EXPECTED_CHARS) * 75));
          if (pct >= lastEmittedPct + 3) {
            lastEmittedPct = pct;
            sendSSE({ type: "progress", pct });
          }
        },
      });
      sendSSE({ type: "phase", label: "Finalizing personas…", pct: 95 });
      sendSSE({ type: "done", payload: { personas } });
    } catch (err) {
      log.error({ err, userId: user.id }, "copilot-assessment-personas: generation failed");
      sendSSE({ type: "error", message: "Persona generation is temporarily unavailable. Please try again shortly." });
    }
    res.end();
  },
);

export default router;
