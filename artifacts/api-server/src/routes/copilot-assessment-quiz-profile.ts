/**
 * copilot-assessment-quiz-profile.ts
 *
 * GET  /api/portal/copilot-assessment/quiz-profile
 * PUT  /api/portal/copilot-assessment/quiz-profile
 *
 * Copilot Assessment epic (#183), #237. The one *stateful* route in the
 * /portal/copilot-assessment/* namespace — its siblings (personas,
 * final-report, remediation-detail) are all deliberately stateless
 * regenerate-on-demand endpoints. This one exists because the wizard's
 * completed QuizProfile previously lived only in copilot-assessment.tsx's
 * local React state, so a customer who completed the 13-step quiz and then
 * came back after a session gap was forced to redo all of it.
 *
 * Storage: tenants.copilot_assessment jsonb, under the "quiz" key — the same
 * single-keyed-jsonb-column convention as tenants.consent (see msp.ts). Read
 * and written under the caller's OWN tenant id from the JWT (never a body or
 * query parameter), so one tenant can never read or overwrite another's quiz.
 *
 * ID space: the JWT's customerId claim carries tenants.id post-Tenant/User
 * refactor — the same lookup GET /portal/diagnostics/testbed-status already
 * does (`tenantsTable.where(eq(tenantsTable.id, customerId))`).
 *
 * Deliberately NOT here: mid-quiz partial-answer autosave. #237 scopes this to
 * a COMPLETED profile surviving a session gap; partial progress is a separate
 * fast-follow.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  type CopilotQuizProfile,
  type CopilotAssessmentStateMap,
} from "@workspace/db";
import { requireRole } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

/** tenants.id from the caller's own JWT claim. Never trusted from the request body. */
function resolveTenantId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !Number.isNaN(id) ? id : null;
}

/**
 * Same field-by-field validation copilot-assessment-personas.ts applies to an
 * incoming quizProfile, kept local rather than shared: this route must reject a
 * malformed body *before* it becomes a stored row that every later read hands
 * back, so its check is a persistence gate, not a call-site precondition.
 */
function isValidQuizProfile(body: unknown): body is CopilotQuizProfile {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const isStringArray = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === "string");
  const isLoad = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
  // The five fields #270 stopped dropping. Checked as OPTIONAL, not required:
  // a client on an older bundle (or a re-save of a profile restored from a
  // pre-#270 row) genuinely has none of them, and rejecting that would lock a
  // returning customer out of saving rather than surface a real error.
  const isOptionalStringArray = (v: unknown): boolean => v === undefined || v === null || isStringArray(v);
  const isOptionalString = (v: unknown): boolean => v === undefined || v === null || typeof v === "string";
  return (
    typeof b.role === "string" &&
    typeof b.department === "string" &&
    typeof b.industry === "string" &&
    isStringArray(b.collaboration) &&
    isStringArray(b.sensitivity) &&
    typeof b.workflowStyle === "string" &&
    isStringArray(b.outcomePriorities) &&
    isLoad(b.draftingLoad) &&
    isLoad(b.researchLoad) &&
    isLoad(b.communicationLoad) &&
    isLoad(b.repetitiveLoad) &&
    isStringArray(b.toolUsage) &&
    typeof b.aiComfort === "string" &&
    (b.company === undefined || b.company === null || typeof b.company === "string") &&
    (b.phone === undefined || b.phone === null || typeof b.phone === "string") &&
    isOptionalStringArray(b.personaClusters) &&
    isOptionalStringArray(b.targetPersonas) &&
    isOptionalStringArray(b.useCaseClusters) &&
    isOptionalString(b.adoptionSpeed) &&
    isOptionalString(b.changeManagement)
  );
}

/** Drop anything the client sent that isn't part of the frozen shape. */
function normalizeQuizProfile(profile: CopilotQuizProfile): CopilotQuizProfile {
  return {
    role: profile.role,
    department: profile.department,
    company: profile.company ?? null,
    phone: profile.phone ?? null,
    industry: profile.industry,
    collaboration: profile.collaboration,
    sensitivity: profile.sensitivity,
    workflowStyle: profile.workflowStyle,
    outcomePriorities: profile.outcomePriorities,
    draftingLoad: profile.draftingLoad,
    researchLoad: profile.researchLoad,
    communicationLoad: profile.communicationLoad,
    repetitiveLoad: profile.repetitiveLoad,
    toolUsage: profile.toolUsage,
    aiComfort: profile.aiComfort,
    // #270 — an absent value normalizes to empty/null rather than to a
    // plausible-looking default, so a restored pre-#270 profile never reads as
    // "this customer selected nothing" when the question was never asked.
    personaClusters: profile.personaClusters ?? [],
    targetPersonas: profile.targetPersonas ?? [],
    useCaseClusters: profile.useCaseClusters ?? [],
    adoptionSpeed: profile.adoptionSpeed ?? null,
    changeManagement: profile.changeManagement ?? null,
  };
}

// ── GET — the restore path ────────────────────────────────────────────────────
// Returns { quizProfile: null } (200, not 404) when the tenant has never
// completed the quiz: "no saved quiz" is an ordinary, expected answer for a
// first-time customer, and the client treats a failed fetch as "show the quiz"
// anyway, so a 404 would only make the two cases harder to tell apart.
router.get(
  "/portal/copilot-assessment/quiz-profile",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);
    if (tenantId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const [row] = await db
        .select({ copilotAssessment: tenantsTable.copilotAssessment })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId))
        .limit(1);

      const quiz = (row?.copilotAssessment as CopilotAssessmentStateMap | undefined)?.quiz;
      if (!quiz?.profile) {
        res.json({ quizProfile: null, completedAt: null });
        return;
      }

      res.json({ quizProfile: quiz.profile, completedAt: quiz.completedAt ?? null });
    } catch (err) {
      log.error({ err, tenantId }, "GET /portal/copilot-assessment/quiz-profile failed");
      res.status(500).json({ error: "Failed to load saved quiz profile" });
    }
  },
);

// ── PUT — the save path, called on quiz completion ────────────────────────────
// Idempotent overwrite: a retake replaces the stored profile outright rather
// than accumulating versions. Merges into the existing copilot_assessment map
// instead of replacing it, so a later phase's key under the same column is not
// wiped by a quiz retake.
router.put(
  "/portal/copilot-assessment/quiz-profile",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = resolveTenantId(req);
    if (tenantId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const { quizProfile } = req.body as { quizProfile?: unknown };
    if (!isValidQuizProfile(quizProfile)) {
      res.status(400).json({ error: "quizProfile is required and must match the QuizProfile shape" });
      return;
    }

    try {
      const [row] = await db
        .select({ copilotAssessment: tenantsTable.copilotAssessment })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId))
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "Tenant not found" });
        return;
      }

      const existing = (row.copilotAssessment as CopilotAssessmentStateMap | undefined) ?? {};
      const completedAt = new Date().toISOString();
      const next: CopilotAssessmentStateMap = {
        ...existing,
        quiz: {
          profile: normalizeQuizProfile(quizProfile),
          completedAt,
          completedByUserId: req.user?.id ?? null,
        },
      };

      await db
        .update(tenantsTable)
        .set({ copilotAssessment: next, updatedAt: new Date() })
        .where(eq(tenantsTable.id, tenantId));

      log.info({ tenantId, userId: req.user?.id }, "copilot-assessment quiz profile saved");
      res.json({ saved: true, completedAt });
    } catch (err) {
      log.error({ err, tenantId }, "PUT /portal/copilot-assessment/quiz-profile failed");
      res.status(500).json({ error: "Failed to save quiz profile" });
    }
  },
);

export default router;
