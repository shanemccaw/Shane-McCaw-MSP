/**
 * system-action-handlers.ts
 *
 * Handlers for the `system_action` workflow node type.
 * Each handler maps a task name to a server-side function.
 * Imported by workflow-executor.ts to avoid circular dependencies.
 */

import { pool, db } from "@workspace/db";
import { insightsAutomationsTable, quickWinPresentationsTable, workflowStepsTable } from "@workspace/db";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger.ts";
import { reconcileOrphanedRuns, reconcileStalledPhases, reconcileLateStuckQueuedCompletions, autoFireFirstBacklogScript, autoFireDocumentCard, autoFireRunWorkflowCards } from "./kanban-auto-fire.ts";
import { executeAutomation, nextRunFromCron } from "../routes/admin-insights.ts";
import { checkManualScriptEscalations } from "./manual-script-escalation.ts";

export async function handleSystemAction(
  task: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (task) {

    case "reconcile_orphaned_runs": {
      await reconcileOrphanedRuns();
      await reconcileStalledPhases();
      await reconcileLateStuckQueuedCompletions();
      logger.info("system_action: reconcile_orphaned_runs completed");
      return { reconciled: true };
    }

    case "reconcile_late_stuck_queued": {
      await reconcileLateStuckQueuedCompletions();
      logger.info("system_action: reconcile_late_stuck_queued completed");
      return { reconciled: true };
    }

    case "cleanup_old_runs": {
      const result = await pool.query(
        `DELETE FROM wf_runs WHERE created_at < NOW() - INTERVAL '90 days'`,
      );
      const deleted = result.rowCount ?? 0;
      if (deleted > 0) {
        logger.info({ deleted }, "system_action: cleanup_old_runs — deleted old runs");
      }
      return { deleted };
    }

    case "check_escalations": {
      const result = await checkManualScriptEscalations();
      logger.info(result, "system_action: check_escalations completed");
      return { alerted: result.alerted, cardIds: result.cardIds };
    }

    case "run_monthly_insights": {
      const stale = await db
        .select({ id: insightsAutomationsTable.id, cronExpression: insightsAutomationsTable.cronExpression })
        .from(insightsAutomationsTable)
        .where(and(eq(insightsAutomationsTable.enabled, true), sql`next_run_at IS NULL`));

      for (const row of stale) {
        await db.update(insightsAutomationsTable)
          .set({ nextRunAt: nextRunFromCron(row.cronExpression) })
          .where(eq(insightsAutomationsTable.id, row.id));
      }

      const due = await db
        .select({ id: insightsAutomationsTable.id, cronExpression: insightsAutomationsTable.cronExpression, nextRunAt: insightsAutomationsTable.nextRunAt })
        .from(insightsAutomationsTable)
        .where(and(eq(insightsAutomationsTable.enabled, true), isNotNull(insightsAutomationsTable.nextRunAt), sql`next_run_at <= NOW()`));

      let fired = 0;
      for (const row of due) {
        const nextRun = nextRunFromCron(row.cronExpression);
        const claimed = await db.update(insightsAutomationsTable)
          .set({ nextRunAt: nextRun })
          .where(and(eq(insightsAutomationsTable.id, row.id), sql`next_run_at = ${row.nextRunAt}`))
          .returning({ id: insightsAutomationsTable.id });

        if (claimed.length === 0) continue;
        fired++;
        executeAutomation(row.id).catch((err: unknown) => {
          logger.warn({ err, automationId: row.id }, "system_action: run_monthly_insights — automation error (non-fatal)");
        });
      }

      logger.info({ fired }, "system_action: run_monthly_insights completed");
      return { fired };
    }

    case "auto_fire_kanban": {
      const clientUserId = payload.clientUserId as number | undefined;
      const action = (payload.action as string | undefined) ?? "both";

      if (!clientUserId) {
        return { skipped: true, reason: "no clientUserId in payload" };
      }

      if (action === "script" || action === "both") {
        autoFireFirstBacklogScript(clientUserId).catch((err: unknown) => {
          logger.warn({ err, clientUserId }, "system_action: auto_fire_kanban script error (non-fatal)");
        });
      }
      if (action === "document" || action === "both") {
        autoFireDocumentCard(clientUserId).catch((err: unknown) => {
          logger.warn({ err, clientUserId }, "system_action: auto_fire_kanban document error (non-fatal)");
        });
      }
      if (action === "workflow" || action === "both") {
        autoFireRunWorkflowCards(clientUserId).catch((err: unknown) => {
          logger.warn({ err, clientUserId }, "system_action: auto_fire_kanban run_workflow error (non-fatal)");
        });
      }

      return { fired: true, clientUserId, action };
    }

    case "save_presentation_title": {
      const presId = typeof payload.presentationId === "number"
        ? payload.presentationId
        : typeof payload.presentationId === "string"
        ? parseInt(payload.presentationId, 10)
        : NaN;
      if (isNaN(presId)) {
        logger.warn({ payload }, "save_presentation_title: missing or invalid presentationId");
        return { saved: false, error: "missing presentationId" };
      }

      // Try to extract projectTitle from the compose node output (payload.value or payload.projectTitle)
      let projectTitle: string | null = null;
      const raw = payload.value ?? payload.projectTitle;
      if (typeof raw === "string" && raw.trim()) {
        projectTitle = raw.trim();
      } else if (raw && typeof raw === "object" && "projectTitle" in (raw as Record<string, unknown>)) {
        const pt = (raw as Record<string, unknown>).projectTitle;
        if (typeof pt === "string" && pt.trim()) projectTitle = pt.trim();
      }

      if (!projectTitle) {
        logger.warn({ payload }, "save_presentation_title: no projectTitle found in payload — skipping");
        return { saved: false, reason: "no projectTitle" };
      }

      await db.update(quickWinPresentationsTable)
        .set({ projectTitle, updatedAt: new Date() })
        .where(eq(quickWinPresentationsTable.id, presId));

      logger.info({ presId, projectTitle }, "save_presentation_title: saved");
      return { saved: true, projectTitle };
    }

    case "save_presentation_phases": {
      const presId = typeof payload.presentationId === "number"
        ? payload.presentationId
        : typeof payload.presentationId === "string"
        ? parseInt(payload.presentationId, 10)
        : NaN;
      if (isNaN(presId)) {
        logger.warn({ payload }, "save_presentation_phases: missing or invalid presentationId");
        return { saved: false, error: "missing presentationId" };
      }

      const totalPrice = typeof payload.totalPrice === "number"
        ? payload.totalPrice
        : typeof payload.totalPrice === "string"
        ? parseFloat(payload.totalPrice)
        : 0;

      let rawPhases: unknown = payload.value;
      if (typeof rawPhases === "string") {
        // Strip markdown code fences before parsing — AI often wraps JSON in ```json … ``` blocks.
        const fenceStripped = rawPhases.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
        try { rawPhases = JSON.parse(fenceStripped || rawPhases); } catch { rawPhases = []; }
      }
      if (!Array.isArray(rawPhases) || rawPhases.length === 0) {
        logger.warn({ presId, rawPhases }, "save_presentation_phases: no phases in payload.value");
        return { saved: false, error: "no phases array in payload" };
      }

      const rawArr = rawPhases as Array<{ title?: string; description?: string; priceWeight?: number; subtasks?: string[] }>;

      const totalWeight = rawArr.reduce((sum, p) => sum + (typeof p.priceWeight === "number" ? p.priceWeight : 0), 0) || 1;
      let remaining = totalPrice;
      const resolvedPhases = rawArr.map((p, i) => {
        const weight = typeof p.priceWeight === "number" ? p.priceWeight : 1 / rawArr.length;
        let price: number;
        if (i === rawArr.length - 1) {
          price = Math.round(remaining * 100) / 100;
        } else {
          price = Math.round((totalPrice * (weight / totalWeight)) * 100) / 100;
          remaining -= price;
        }
        return {
          id: randomUUID(),
          title: String(p.title ?? `Phase ${i + 1}`),
          description: String(p.description ?? ""),
          price,
          selected: true,
          subtasks: Array.isArray(p.subtasks) ? p.subtasks.map(String) : [],
        };
      });

      await db.update(quickWinPresentationsTable)
        .set({
          sowPhases: resolvedPhases,
          selectedPhaseIds: resolvedPhases.map(p => p.id),
          updatedAt: new Date(),
        })
        .where(eq(quickWinPresentationsTable.id, presId));

      // Also persist phases as rows in the project phases (workflow_steps) table if projectId is linked
      try {
        const [presRow] = await db
          .select({ projectId: quickWinPresentationsTable.projectId })
          .from(quickWinPresentationsTable)
          .where(eq(quickWinPresentationsTable.id, presId))
          .limit(1);
        if (presRow?.projectId) {
          const projId = presRow.projectId;
          await db.delete(workflowStepsTable).where(eq(workflowStepsTable.projectId, projId));
          for (let i = 0; i < resolvedPhases.length; i++) {
            const phase = resolvedPhases[i]!;
            await db.insert(workflowStepsTable).values({
              projectId: projId,
              title: phase.title,
              description: phase.description,
              status: "pending",
              order: i,
            });
          }
          logger.info({ presId, projId, phaseCount: resolvedPhases.length }, "save_presentation_phases: workflow_steps upserted");
        }
      } catch (stepErr) {
        logger.warn({ presId, stepErr }, "save_presentation_phases: workflow_steps upsert failed — non-fatal");
      }

      logger.info({ presId, phaseCount: resolvedPhases.length }, "save_presentation_phases: phases saved");
      return { saved: true, phaseCount: resolvedPhases.length, resolvedPhases };
    }

    default:
      logger.warn({ task }, "system_action: unknown task — no-op");
      return { skipped: true, reason: `unknown task: ${task}` };
  }
}
