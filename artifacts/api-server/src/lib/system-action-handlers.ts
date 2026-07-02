/**
 * system-action-handlers.ts
 *
 * Handlers for the `system_action` workflow node type.
 * Each handler maps a task name to a server-side function.
 * Imported by workflow-executor.ts to avoid circular dependencies.
 */

import { pool, db } from "@workspace/db";
import { insightsAutomationsTable } from "@workspace/db";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { logger } from "./logger";
import { reconcileOrphanedRuns, reconcileStalledPhases, autoFireFirstBacklogScript, autoFireDocumentCard } from "./kanban-auto-fire";
import { executeAutomation, nextRunFromCron } from "../routes/admin-insights";
import { checkManualScriptEscalations } from "./manual-script-escalation";

export async function handleSystemAction(
  task: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (task) {

    case "reconcile_orphaned_runs": {
      await reconcileOrphanedRuns();
      await reconcileStalledPhases();
      logger.info("system_action: reconcile_orphaned_runs completed");
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

      return { fired: true, clientUserId, action };
    }

    default:
      logger.warn({ task }, "system_action: unknown task — no-op");
      return { skipped: true, reason: `unknown task: ${task}` };
  }
}
