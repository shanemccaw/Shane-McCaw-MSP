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
import { db, tenantEngineSnapshotsTable, mspCustomersTable, clientServicesTable, servicesTable, projectsTable, kanbanTasksTable, invoicesTable, reportsTable, notificationsTable, messagesTable } from "@workspace/db";
import { eq, desc, and, count, inArray, or, asc } from "drizzle-orm";

const router: IRouter = Router();

// ── Friendly translation helpers ──────────────────────────────────────────────

type OverallStatus = "on_track" | "attention_needed" | "action_required";

function slaOverall(output: SlaEngineOutput): OverallStatus {
  if (output.activeBreaches > 0) return "action_required";
  if (output.warningTimers > 0) return "attention_needed";
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
  const { activeBreaches, warningTimers, runningTimers } = output;
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
  const pct = output.compliancePct;
  if (output.runningTimers === 0) return "No open requests";
  if (pct === 100) return "100% on time";
  return `${pct}% resolved within target this period`;
}

function responsePerformanceLabel(output: SlaEngineOutput): "well_within" | "approaching_limit" | "overdue" {
  const { activeBreaches, warningTimers } = output;
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
        activeWarnings: output.warningTimers,
        activeIssues: output.activeBreaches,
        openRequests: output.runningTimers,
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

// ── GET /api/portal/dashboard ─────────────────────────────────────────────────

router.get(
  "/portal/dashboard",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;
    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    try {
      const snapshots = await db
        .select({
          engineKey: tenantEngineSnapshotsTable.engineKey,
          score: tenantEngineSnapshotsTable.score,
          breakdown: tenantEngineSnapshotsTable.breakdown,
          runId: tenantEngineSnapshotsTable.runId,
          capturedAt: tenantEngineSnapshotsTable.capturedAt,
        })
        .from(tenantEngineSnapshotsTable)
        .where(eq(tenantEngineSnapshotsTable.customerId, customerId))
        .orderBy(desc(tenantEngineSnapshotsTable.capturedAt));

      const scores: Record<string, number> = {};
      const pillars: Record<string, any> = {};
      let compositeScore = 0;
      let compositeCount = 0;
      let runId: string | null = null;
      let generatedAt: string | null = null;

      for (const snap of snapshots) {
        if (scores[snap.engineKey] === undefined && snap.score !== null) {
          scores[snap.engineKey] = snap.score;
          compositeScore += snap.score;
          compositeCount++;
          
          if (!runId && snap.runId) runId = snap.runId;
          if (!generatedAt && snap.capturedAt) generatedAt = snap.capturedAt.toISOString();

          // Extract findings/recommendations from breakdown
          const breakdown = Array.isArray(snap.breakdown) ? snap.breakdown : [];
          const findings: string[] = [];
          const recommendations: string[] = [];
          
          for (const item of breakdown) {
            if (typeof item === "object" && item !== null) {
              const b = item as Record<string, any>;
              if (b.finding) findings.push(String(b.finding));
              else if (b.message) findings.push(String(b.message));
              else if (b.label) findings.push(String(b.label));

              if (b.recommendation) recommendations.push(String(b.recommendation));
              else if (b.action) recommendations.push(String(b.action));
            }
          }

          pillars[snap.engineKey] = {
            score: snap.score,
            status: "complete",
            findings,
            recommendations,
          };
        }
      }

      // Determine type_attributes / modules to mount
      const activeServices = await db
        .select({ typeAttributes: servicesTable.typeAttributes })
        .from(clientServicesTable)
        .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
        .where(
          and(
            eq(clientServicesTable.clientUserId, req.user!.id),
            eq(clientServicesTable.status, "active")
          )
        );

      const dashboardModules = new Set<string>();
      const enabledModules = new Set<string>();
      
      for (const service of activeServices) {
        const attrs = service.typeAttributes as Record<string, unknown> | null;
        if (attrs && Array.isArray(attrs.dashboardModules)) {
          for (const mod of attrs.dashboardModules) {
            if (typeof mod === "string") dashboardModules.add(mod);
          }
        }
        if (attrs && Array.isArray(attrs.enabledModules)) {
          for (const mod of attrs.enabledModules) {
            if (typeof mod === "string") enabledModules.add(mod);
          }
        }
      }
      
      const type_attributes = dashboardModules.size > 0 
        ? Array.from(dashboardModules) 
        : (enabledModules.size > 0 ? Array.from(enabledModules) : ["priority-health", "security", "copilot", "cost"]);

      const [customer] = await db
        .select({ status: mspCustomersTable.status })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, customerId))
        .limit(1);

      const telemetryStatus = customer?.status === "onboarding" ? "in_progress" : "completed";

      // ── Merge existing dashboard fields for customer-home.tsx ──
      const userId = req.user!.id;
      const projects = await db.select().from(projectsTable)
        .where(and(eq(projectsTable.clientUserId, userId), eq(projectsTable.status, "active")))
        .orderBy(desc(projectsTable.updatedAt)).limit(5);

      type EnrichedProject = typeof projects[0] & {
        currentTask: { stepNumber: number; totalSteps: number; title: string } | null;
      };
      let enrichedProjects: EnrichedProject[];

      if (projects.length > 0) {
        const projectIds = projects.map(p => p.id);
        const allTasks = await db.select({
          id: kanbanTasksTable.id,
          title: kanbanTasksTable.title,
          order: kanbanTasksTable.order,
          column: kanbanTasksTable.column,
          projectId: kanbanTasksTable.projectId,
        }).from(kanbanTasksTable)
          .where(inArray(kanbanTasksTable.projectId, projectIds))
          .orderBy(asc(kanbanTasksTable.order));

        const tasksByProject = new Map<number, typeof allTasks>();
        for (const task of allTasks) {
          if (!task.projectId) continue;
          const arr = tasksByProject.get(task.projectId) ?? [];
          arr.push(task);
          tasksByProject.set(task.projectId, arr);
        }

        enrichedProjects = projects.map(p => {
          const tasks = tasksByProject.get(p.id) ?? [];
          const inProgressTask = tasks.find(t => t.column === "in_progress");
          if (!inProgressTask) return { ...p, currentTask: null };
          const stepNumber = tasks.indexOf(inProgressTask) + 1;
          return {
            ...p,
            currentTask: { stepNumber, totalSteps: tasks.length, title: inProgressTask.title },
          };
        });
      } else {
        enrichedProjects = [];
      }

      const clientServicesResult = await db.select({
        cs: clientServicesTable,
        service: servicesTable,
      }).from(clientServicesTable)
        .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
        .where(and(eq(clientServicesTable.clientUserId, userId), or(eq(clientServicesTable.status, "active"), eq(clientServicesTable.status, "paused"))))
        .orderBy(desc(clientServicesTable.purchasedAt)).limit(6);

      const invoices = await db.select().from(invoicesTable)
        .where(eq(invoicesTable.clientUserId, userId))
        .orderBy(desc(invoicesTable.createdAt)).limit(5);

      const reports = await db.select().from(reportsTable)
        .where(eq(reportsTable.clientUserId, userId))
        .orderBy(desc(reportsTable.createdAt)).limit(3);

      const [{ unread }] = await db.select({ unread: count() }).from(notificationsTable)
        .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));

      const [{ unreadMessages }] = await db.select({ unreadMessages: count() }).from(messagesTable)
        .where(and(eq(messagesTable.clientUserId, userId), eq(messagesTable.readByClient, false)));

      res.json({
        scores: {
          security: scores.security ?? 0,
          health: scores.health ?? 0,
          governance: scores.governance ?? 0,
          drift: scores.drift ?? 0,
          sla: scores.sla ?? 0,
          scope_creep: scores.scope_creep ?? 0,
          ...scores
        },
        telemetryStatus,
        type_attributes,
        results: {
          status: telemetryStatus === "in_progress" ? "running" : "complete",
          runId,
          generatedAt,
          summary: {
            compositeScore: compositeCount > 0 ? Math.round(compositeScore / compositeCount) : null,
            priorityItems: [],
          },
          pillars
        },
        projects: enrichedProjects,
        clientServices: clientServicesResult,
        invoices,
        reports,
        unreadNotifications: unread,
        unreadMessages
      });
    } catch (err) {
      logger.error({ err, customerId }, "portal-customer-engines: dashboard failed");
      res.status(500).json({ error: "Unable to load dashboard data." });
    }
  },
);

// ── GET /api/portal/assessment-results ────────────────────────────────────────

router.get(
  "/portal/assessment-results",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;
    const userId = req.user!.id;
    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    try {
      const activeServices = await db
        .select({ typeAttributes: servicesTable.typeAttributes })
        .from(clientServicesTable)
        .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
        .where(
          and(
            eq(clientServicesTable.clientUserId, userId),
            eq(clientServicesTable.status, "active")
          )
        );

      const enabledModules = new Set<string>();
      for (const service of activeServices) {
        const attrs = service.typeAttributes as Record<string, unknown> | null;
        if (attrs && Array.isArray(attrs.enabledModules)) {
          for (const mod of attrs.enabledModules) {
            if (typeof mod === "string") {
              enabledModules.add(mod);
            }
          }
        }
      }

      res.json({
        enabledModules: Array.from(enabledModules),
      });
    } catch (err) {
      logger.error({ err, customerId }, "portal-customer-engines: assessment-results failed");
      res.status(500).json({ error: "Unable to load assessment results." });
    }
  },
);

export default router;
