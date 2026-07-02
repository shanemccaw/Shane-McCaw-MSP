/**
 * seed-system-workflows.ts
 *
 * Idempotent upsert of system workflow definitions on server startup.
 * Each definition is identified by a stable name — if it already exists,
 * only missing triggers are added. The v1 "default" version is inserted
 * once and never overwritten (is_default = true).
 *
 * System definitions carry metadata.system = true, which:
 *  - Shows a "System" badge in the Workflow list UI
 *  - Hides the delete button
 *  - Surfaces a "Revert to default" action in the version history panel
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";
import { computeNextCronRun } from "./workflow-executor";

interface SystemWorkflowSeed {
  name: string;
  description: string;
  triggerType: "startup" | "schedule";
  cron?: string;
  graph: {
    nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>;
  };
}

const SYSTEM_WORKFLOWS: SystemWorkflowSeed[] = [
  {
    name: "__system__: Orphan Reconciliation",
    description: "Runs once on server startup to recover kanban cards orphaned by a mid-run restart and detect stalled phases.",
    triggerType: "startup",
    graph: {
      nodes: [
        { id: "start", type: "start",         position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Startup" } },
        { id: "act",   type: "system_action",  position: { x: 100, y: 230 }, data: { nodeType: "system_action", label: "Reconcile Orphaned Runs", task: "reconcile_orphaned_runs" } },
        { id: "end",   type: "end",            position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "act" },
        { id: "e2", source: "act",   target: "end" },
      ],
    },
  },
  {
    name: "__system__: Workflow Cleanup",
    description: "Nightly job (03:00 UTC) that deletes workflow runs older than 90 days.",
    triggerType: "schedule",
    cron: "0 3 * * *",
    graph: {
      nodes: [
        { id: "start", type: "start",         position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Cron 03:00" } },
        { id: "act",   type: "system_action",  position: { x: 100, y: 230 }, data: { nodeType: "system_action", label: "Cleanup Old Runs", task: "cleanup_old_runs" } },
        { id: "end",   type: "end",            position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "act" },
        { id: "e2", source: "act",   target: "end" },
      ],
    },
  },
  {
    name: "__system__: Escalation Check",
    description: "Daily check (08:00 UTC) for manual script cards stalled in Waiting on Customer.",
    triggerType: "schedule",
    cron: "0 8 * * *",
    graph: {
      nodes: [
        { id: "start", type: "start",         position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Cron 08:00" } },
        { id: "act",   type: "system_action",  position: { x: 100, y: 230 }, data: { nodeType: "system_action", label: "Check Escalations", task: "check_escalations" } },
        { id: "end",   type: "end",            position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "act" },
        { id: "e2", source: "act",   target: "end" },
      ],
    },
  },
  {
    name: "__system__: Monthly Insights",
    description: "Monthly insights automation runner (cron 0 9 1 * *) — fires all enabled insights automations whose next_run_at has arrived.",
    triggerType: "schedule",
    cron: "0 9 1 * *",
    graph: {
      nodes: [
        { id: "start", type: "start",         position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Cron 1st of month" } },
        { id: "act",   type: "system_action",  position: { x: 100, y: 230 }, data: { nodeType: "system_action", label: "Run Monthly Insights", task: "run_monthly_insights" } },
        { id: "end",   type: "end",            position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "act" },
        { id: "e2", source: "act",   target: "end" },
      ],
    },
  },
  {
    name: "__system__: Kanban Auto-fire",
    description: "Handles kanban.card_moved events to auto-fire Azure runbook scripts and document generation for client cards.",
    triggerType: "startup",
    graph: {
      nodes: [
        { id: "start", type: "start",         position: { x: 100, y: 100 }, data: { nodeType: "start", label: "kanban.card_moved" } },
        { id: "act",   type: "system_action",  position: { x: 100, y: 230 }, data: { nodeType: "system_action", label: "Auto-fire Kanban Card", task: "auto_fire_kanban" } },
        { id: "end",   type: "end",            position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "act" },
        { id: "e2", source: "act",   target: "end" },
      ],
    },
  },
];

export async function seedSystemWorkflows(): Promise<void> {
  try {
    for (const seed of SYSTEM_WORKFLOWS) {
      // 1. Upsert definition (idempotent by name)
      const defResult = await pool.query<{ id: number }>(
        `INSERT INTO wf_definitions (name, description, concurrency_limit, metadata)
         VALUES ($1, $2, 1, '{"system":true}'::jsonb)
         ON CONFLICT (name) DO UPDATE
           SET description = EXCLUDED.description,
               metadata    = '{"system":true}'::jsonb,
               updated_at  = NOW()
         RETURNING id`,
        [seed.name, seed.description],
      );
      const defId = defResult.rows[0]?.id;
      if (!defId) continue;

      // 2. Pin v1 default version — only insert if not already present
      const existingV1 = await pool.query<{ id: number }>(
        `SELECT id FROM wf_versions WHERE definition_id = $1 AND version_number = 1 LIMIT 1`,
        [defId],
      );

      if (existingV1.rowCount === 0) {
        await pool.query(
          `INSERT INTO wf_versions (definition_id, version_number, label, status, graph, is_default)
           VALUES ($1, 1, 'v1 — Default (system)', 'published', $2::jsonb, true)`,
          [defId, JSON.stringify(seed.graph)],
        );
        logger.info({ defId, name: seed.name }, "seed-system-workflows: pinned default v1");
      }

      // 3. Ensure trigger exists (skip if any trigger already present for this def)
      const existingTrigger = await pool.query<{ id: number }>(
        `SELECT id FROM wf_triggers WHERE definition_id = $1 LIMIT 1`,
        [defId],
      );

      if (existingTrigger.rowCount === 0) {
        if (seed.triggerType === "startup") {
          // Startup trigger: fire once on init, no next_run_at
          // Special case: Kanban Auto-fire uses event trigger, not startup
          if (seed.name.includes("Kanban")) {
            await pool.query(
              `INSERT INTO wf_triggers (definition_id, type, config, enabled)
               VALUES ($1, 'event', '{"eventName":"kanban.card_moved"}'::jsonb, true)`,
              [defId],
            );
          } else {
            await pool.query(
              `INSERT INTO wf_triggers (definition_id, type, config, enabled)
               VALUES ($1, 'startup', '{}'::jsonb, true)`,
              [defId],
            );
          }
        } else if (seed.triggerType === "schedule" && seed.cron) {
          const nextRun = computeNextCronRun(seed.cron);
          await pool.query(
            `INSERT INTO wf_triggers (definition_id, type, config, next_run_at, enabled)
             VALUES ($1, 'schedule', $2::jsonb, $3, true)`,
            [defId, JSON.stringify({ cron: seed.cron }), nextRun],
          );
        }
        logger.info({ defId, name: seed.name, triggerType: seed.triggerType }, "seed-system-workflows: trigger created");
      }
    }

    logger.info({ count: SYSTEM_WORKFLOWS.length }, "seed-system-workflows: all system workflows seeded");
  } catch (err) {
    logger.warn({ err }, "seed-system-workflows: seeding failed (non-fatal)");
  }
}
