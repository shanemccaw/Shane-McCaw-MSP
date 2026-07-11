/**
 * portal-customer-engines.ts
 *
 * Customer-facing SLA and Scope Creep status endpoints.
 *
 * These routes translate internal engine outputs into plain-language,
 * customer-safe summaries. No raw scores, rule keys, escalation details,
 * or internal operator data are returned — only what a customer needs to
 * know about their service health.
 *
 * Auth: requireRole("CustomerUser") — MSP JWT with CustomerUser role.
 * The customer's own ID is read from the JWT claim (req.user.customerId).
 *
 * Routes:
 *   GET /api/portal/customer/sla-status
 *   GET /api/portal/customer/scope-status
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireRole } from "../middlewares/requireAuth";
import { runSlaEngineForTenant, type SlaEngineOutput } from "../lib/sla-engine";
import { runScopeCreepEngineForTenant, type ScopeCreepEngineOutput } from "../lib/scope-creep-engine";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Friendly translation helpers ──────────────────────────────────────────────

type OverallStatus = "on_track" | "attention_needed" | "action_required";

function slaOverall(output: SlaEngineOutput): OverallStatus {
  if (output.score.activeBreaches > 0) return "action_required";
  if (output.score.warningTimers > 0) return "attention_needed";
  return "on_track";
}

function slaHeadline(status: OverallStatus): string {
  switch (status) {
    case "on_track":
      return "Your service is running smoothly";
    case "attention_needed":
      return "A few requests need attention";
    case "action_required":
      return "Some requests are overdue — we're on it";
  }
}

function slaSubtext(output: SlaEngineOutput, status: OverallStatus): string {
  const { activeBreaches, warningTimers, runningTimers } = output.score;
  if (status === "on_track") {
    if (runningTimers === 0) return "No open requests at the moment. Everything is resolved.";
    return `All ${runningTimers} open request${runningTimers === 1 ? "" : "s"} are being handled within your agreed response times.`;
  }
  if (status === "attention_needed") {
    return `${warningTimers} request${warningTimers === 1 ? " is" : "s are"} approaching the response time limit. Our team is prioritising ${warningTimers === 1 ? "it" : "them"} now.`;
  }
  return `${activeBreaches} request${activeBreaches === 1 ? " has" : "s have"} exceeded the response time target. Our team has been notified and is actively working on resolution.`;
}

function slaComplianceLabel(output: SlaEngineOutput): string {
  const pct = output.score.compliancePct;
  if (output.score.runningTimers === 0) return "No open requests";
  if (pct === 100) return "100% on time";
  return `${pct}% resolved within target this period`;
}

function responsePerformanceLabel(output: SlaEngineOutput): "well_within" | "approaching_limit" | "overdue" {
  const { activeBreaches, warningTimers } = output.score;
  if (activeBreaches > 0) return "overdue";
  if (warningTimers > 0) return "approaching_limit";
  return "well_within";
}

function friendlySlaPerformance(p: "well_within" | "approaching_limit" | "overdue"): string {
  switch (p) {
    case "well_within": return "Well within targets";
    case "approaching_limit": return "Approaching response limit";
    case "overdue": return "Requires immediate attention";
  }
}

// ── Scope Creep helpers ────────────────────────────────────────────────────────

function scopeOverall(output: ScopeCreepEngineOutput): OverallStatus {
  if (output.score.openViolations > 0) return "action_required";
  if (output.score.openDetections > 0) return "attention_needed";
  return "on_track";
}

function scopeHeadline(status: OverallStatus): string {
  switch (status) {
    case "on_track":
      return "Your project is on scope";
    case "attention_needed":
      return "Some scope changes have been detected";
    case "action_required":
      return "Scope review required";
  }
}

function scopeSubtext(output: ScopeCreepEngineOutput, status: OverallStatus): string {
  const { openDetections, openViolations } = output.score;
  if (status === "on_track") {
    return "No significant changes have been detected to your agreed scope of work. Everything is progressing as planned.";
  }
  if (status === "attention_needed") {
    return `We've detected ${openDetections} change${openDetections === 1 ? "" : "s"} to the agreed scope. Your team is reviewing ${openDetections === 1 ? "it" : "them"} and will be in touch if any action is needed.`;
  }
  return `${openViolations} scope ${openViolations === 1 ? "concern requires" : "concerns require"} discussion. Your service manager will reach out to align on next steps.`;
}

type ItemStatus = "ok" | "notice" | "alert";

function driftStatus(output: ScopeCreepEngineOutput): ItemStatus {
  const driftItems = output.breakdown.filter(e => e.detectionType === "drift" && e.exceeded);
  if (driftItems.length === 0) return "ok";
  if (output.score.openViolations > 0) return "alert";
  return "notice";
}

function expansionStatus(output: ScopeCreepEngineOutput): ItemStatus {
  const items = output.breakdown.filter(e => e.detectionType === "expansion" && e.exceeded);
  if (items.length === 0) return "ok";
  if (output.score.openViolations > 0) return "alert";
  return "notice";
}

function timelineStatus(output: ScopeCreepEngineOutput): ItemStatus {
  const items = output.breakdown.filter(e => e.detectionType === "timeline_slip" && e.exceeded);
  if (items.length === 0) return "ok";
  if (output.score.openViolations > 0) return "alert";
  return "notice";
}

function driftMessage(status: ItemStatus, count: number): string {
  if (status === "ok") return "Deliverables are aligned with the original agreement.";
  if (status === "notice") return `${count} deliverable change${count === 1 ? " has" : "s have"} been noted and are under review.`;
  return `Deliverable changes require alignment with your service manager.`;
}

function expansionMessage(status: ItemStatus, count: number): string {
  if (status === "ok") return "No additional work has been identified outside the agreed scope.";
  if (status === "notice") return `${count} addition${count === 1 ? " has" : "s have"} been identified and are being assessed.`;
  return `Scope additions need to be discussed and formally agreed before proceeding.`;
}

function timelineMessage(status: ItemStatus, count: number): string {
  if (status === "ok") return "The project timeline is on track.";
  if (status === "notice") return `${count} timeline adjustment${count === 1 ? " has" : "s have"} been detected and are being reviewed.`;
  return `Timeline changes require discussion with your service manager.`;
}

// ── GET /api/portal/customer/sla-status ───────────────────────────────────────

router.get(
  "/portal/customer/sla-status",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;
    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    try {
      const output = await runSlaEngineForTenant(customerId);
      const overall = slaOverall(output);
      const performance = responsePerformanceLabel(output);

      res.json({
        overall,
        headline: slaHeadline(overall),
        subtext: slaSubtext(output, overall),
        complianceLabel: slaComplianceLabel(output),
        activeWarnings: output.score.warningTimers,
        activeIssues: output.score.activeBreaches,
        openRequests: output.score.runningTimers,
        responsePerformance: performance,
        responsePerformanceLabel: friendlySlaPerformance(performance),
        updatedAt: output.timestamp,
      });
    } catch (err) {
      logger.error({ err, customerId }, "portal-customer-engines: sla-status failed");
      res.status(500).json({ error: "Unable to load your service status right now. Please try again shortly." });
    }
  },
);

// ── GET /api/portal/customer/scope-status ─────────────────────────────────────

router.get(
  "/portal/customer/scope-status",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;
    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    try {
      const output = await runScopeCreepEngineForTenant(customerId);
      const overall = scopeOverall(output);

      const driftItems = output.breakdown.filter(e => e.detectionType === "drift" && e.exceeded);
      const expansionItems = output.breakdown.filter(e => e.detectionType === "expansion" && e.exceeded);
      const timelineItems = output.breakdown.filter(e => e.detectionType === "timeline_slip" && e.exceeded);

      const ds = driftStatus(output);
      const es = expansionStatus(output);
      const ts = timelineStatus(output);

      res.json({
        overall,
        headline: scopeHeadline(overall),
        subtext: scopeSubtext(output, overall),
        openItems: output.score.openDetections + output.score.openViolations,
        areas: [
          {
            key: "deliverables",
            label: "Deliverable Changes",
            status: ds,
            message: driftMessage(ds, driftItems.length),
          },
          {
            key: "scope",
            label: "Scope Additions",
            status: es,
            message: expansionMessage(es, expansionItems.length),
          },
          {
            key: "timeline",
            label: "Timeline",
            status: ts,
            message: timelineMessage(ts, timelineItems.length),
          },
        ],
        updatedAt: output.timestamp,
      });
    } catch (err) {
      logger.error({ err, customerId }, "portal-customer-engines: scope-status failed");
      res.status(500).json({ error: "Unable to load your project status right now. Please try again shortly." });
    }
  },
);

export default router;
