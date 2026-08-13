/**
 * copilot-assessment-remediation.ts
 *
 * POST /api/portal/copilot-assessment/remediation-detail — Copilot Assessment
 * epic (#183), Phase 11 / #195. Accepts one finding (label/category/severity,
 * the exact shape UseCaseIssueModal.tsx already worked with) plus an optional
 * real-context bag, and returns real AI-generated "what this means" detail +
 * remediation steps via remediation-detail-generator.ts. Stateless — nothing
 * is persisted, same convention as copilot-assessment-personas.ts (#186);
 * re-issued whenever a user opens the modal on a given finding.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { resolveMspId } from "../lib/resolve-msp-id.ts";
import { resolveBillingMspId } from "../lib/ai-billing.ts";
import {
  generateRemediationDetail,
  type RemediationIssueInput,
  type RemediationContextInput,
} from "../lib/remediation-detail-generator.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

const VALID_CATEGORIES = new Set(["blocker", "sensitivity", "friction"]);
const VALID_SEVERITIES = new Set(["High", "Medium", "Low"]);

function isValidIssue(body: unknown): body is RemediationIssueInput {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.label === "string" &&
    b.label.length > 0 &&
    typeof b.category === "string" &&
    VALID_CATEGORIES.has(b.category) &&
    typeof b.severity === "string" &&
    VALID_SEVERITIES.has(b.severity)
  );
}

function sanitizeContext(body: unknown): RemediationContextInput | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const context: RemediationContextInput = {};
  if (typeof b.role === "string") context.role = b.role;
  if (typeof b.department === "string") context.department = b.department;
  if (typeof b.industry === "string") context.industry = b.industry;
  if (typeof b.personaName === "string") context.personaName = b.personaName;
  if (typeof b.personaRole === "string") context.personaRole = b.personaRole;
  if (typeof b.useCaseCluster === "string") context.useCaseCluster = b.useCaseCluster;
  if (Array.isArray(b.collaborationPattern)) context.collaborationPattern = b.collaborationPattern.filter((v): v is string => typeof v === "string");
  if (Array.isArray(b.sensitivitySet)) context.sensitivitySet = b.sensitivitySet.filter((v): v is string => typeof v === "string");
  return Object.keys(context).length > 0 ? context : undefined;
}

router.post(
  "/portal/copilot-assessment/remediation-detail",
  requireAuth,
  async (req: Request, res: Response) => {
    const { issue, context } = req.body as { issue?: unknown; context?: unknown };

    if (!isValidIssue(issue)) {
      res.status(400).json({ error: "issue is required and must have label/category/severity" });
      return;
    }

    const user = req.user!;
    const mspId = await resolveMspId(req);
    const billingMspId = resolveBillingMspId(user) ?? mspId;
    const customerId = user.customerId ?? null;

    try {
      const result = await generateRemediationDetail(
        issue,
        sanitizeContext(context),
        {
          mspId: billingMspId,
          customerId,
          triggerSource: "copilot_assessment_remediation_modal",
        },
      );
      res.json(result);
    } catch (err) {
      log.error({ err, userId: user.id, label: issue.label }, "copilot-assessment-remediation: generation failed");
      res.status(503).json({ error: "Remediation guidance is temporarily unavailable. Please try again shortly." });
    }
  },
);

export default router;
