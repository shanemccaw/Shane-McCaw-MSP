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
  triggerType: "startup" | "schedule" | "event";
  cron?: string;
  eventName?: string;
  triggerEnabled?: boolean;
  graph: {
    nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>;
  };
}

const SYSTEM_WORKFLOWS: SystemWorkflowSeed[] = [
  {
    name: "Weekly Article Generator",
    description: "Generates a new Microsoft 365 article every Monday at 09:00 UTC and publishes it to the consulting site. Edit the topic in the generate_article node to customise what gets written.",
    triggerType: "schedule",
    cron: "0 9 * * 1",
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 80 },
          data: { nodeType: "start", label: "Every Monday 09:00 UTC" },
        },
        {
          id: "gen",
          type: "generate_article",
          position: { x: 300, y: 220 },
          data: {
            nodeType: "generate_article",
            label: "Generate Article",
            topic: "Microsoft 365 productivity tips for modern teams",
            category: "M365 Best Practices",
          },
        },
        {
          id: "pub",
          type: "publish_article",
          position: { x: 300, y: 360 },
          data: {
            nodeType: "publish_article",
            label: "Save as Draft",
            titleExpr: "{{articleTitle}}",
            draftOnly: true,
          },
        },
        {
          id: "end",
          type: "end",
          position: { x: 300, y: 500 },
          data: { nodeType: "end", label: "Published" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "gen" },
        { id: "e2", source: "gen",   target: "pub" },
        { id: "e3", source: "pub",   target: "end" },
      ],
    },
  },
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
  {
    // Starter skeleton for SOW scope-reduction automations.
    // Created with the trigger DISABLED — enable it in the Workflow Generator
    // and add action nodes (e.g. send_email, send_sms) before going live.
    name: "SOW Scope Reduced — Re-engagement",
    description: "Triggered when a client deselects phases and regenerates a lower-value SOW. Add your re-engagement actions (email, SMS, CRM update) and enable the trigger when ready.",
    triggerType: "event",
    eventName: "sow.scope_reduced",
    triggerEnabled: false,
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 80 },
          data: { nodeType: "start", label: "sow.scope_reduced" },
        },
        {
          id: "end",
          type: "end",
          position: { x: 300, y: 220 },
          data: { nodeType: "end", label: "Done — add actions above" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "end" },
      ],
    },
  },
  {
    name: "SOW Generation Auto-Retry",
    description: "Triggered when a client has been waiting on the SOW-pending step for 2 minutes with no document. Checks the most recent consolidated_sow row for the project, then retries generation if it has failed or never started. Emits sow.generation_retried for audit.",
    triggerType: "event",
    eventName: "sow.generation_stalled",
    triggerEnabled: true,
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 50 },
          data: { nodeType: "start", label: "sow.generation_stalled" },
        },
        {
          id: "check",
          type: "action",
          position: { x: 300, y: 190 },
          data: {
            nodeType: "action",
            actionType: "sql_query",
            label: "Fetch Latest SOW Row",
            query: "SELECT status, EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS age_ms FROM insights_generated_documents WHERE project_id = {{projectId}} AND doc_type = 'consolidated_sow' ORDER BY created_at DESC LIMIT 1",
          },
        },
        {
          id: "branch",
          type: "condition",
          position: { x: 300, y: 330 },
          data: {
            nodeType: "condition",
            label: "Should Retry?",
            expression: "status != 'generating' || age_ms > 300000",
          },
        },
        {
          id: "generate",
          type: "action",
          position: { x: 150, y: 470 },
          data: {
            nodeType: "action",
            actionType: "generate_document",
            label: "Regenerate Consolidated SOW",
            docType: "consolidated_sow",
            docCategory: "consulting",
            clientId: "{{customerId}}",
            projectId: "{{projectId}}",
          },
        },
        {
          id: "emit",
          type: "action",
          position: { x: 150, y: 610 },
          data: {
            nodeType: "action",
            actionType: "emit_event",
            label: "Emit sow.generation_retried",
            eventName: "sow.generation_retried",
            extraPayload: "{\"presentationId\":\"{{presentationId}}\"}",
          },
        },
        {
          id: "end_retried",
          type: "end",
          position: { x: 150, y: 750 },
          data: { nodeType: "end", label: "Retried" },
        },
        {
          id: "end_active",
          type: "end",
          position: { x: 480, y: 470 },
          data: { nodeType: "end", label: "Already generating — skip" },
        },
      ],
      edges: [
        { id: "e1", source: "start",    target: "check"      },
        { id: "e2", source: "check",    target: "branch"     },
        { id: "e3", source: "branch",   target: "generate",  sourceHandle: "true"  },
        { id: "e4", source: "branch",   target: "end_active", sourceHandle: "false" },
        { id: "e5", source: "generate", target: "emit"       },
        { id: "e6", source: "emit",     target: "end_retried" },
      ],
    },
  },
  {
    name: "Agreement Signed: Phased Invoice Setup",
    description: "Fires when a client signs the engagement agreement and initiates Stripe checkout with the phased payment plan. Creates one draft Stripe invoice per SOW phase (80% total), stores the deposit payment method as the customer default for future auto-charges, and writes the stripeInvoiceId back to each workflow step row.",
    triggerType: "event",
    eventName: "agreement_signed",
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start",  type: "start",                  position: { x: 400, y:  50 }, data: { nodeType: "start",                  label: "agreement_signed" } },
        { id: "cond1",  type: "condition",               position: { x: 400, y: 190 }, data: { nodeType: "condition",               label: "Is Phased Plan?",                 expression: "paymentPlan == 'phased'" } },
        { id: "create", type: "create_phased_invoices",  position: { x: 200, y: 340 }, data: { nodeType: "create_phased_invoices",  label: "Create Phased Invoices",          projectId: "{{projectId}}", clientEmail: "{{clientEmail}}", clientName: "{{clientName}}", depositSessionId: "{{stripeSessionId}}" } },
        { id: "notify", type: "create_notification",     position: { x: 200, y: 480 }, data: { nodeType: "create_notification",     label: "Notify: Invoices Created",        title: "Phase invoices created for {{clientName}}", body: "{{phaseCount}} draft Stripe invoices created (total {{totalScheduled}} cents). They will be auto-charged when each phase is marked complete.", type: "general" } },
        { id: "end1",   type: "end",                     position: { x: 200, y: 620 }, data: { nodeType: "end",                     label: "Done" } },
        { id: "end2",   type: "end",                     position: { x: 600, y: 340 }, data: { nodeType: "end",                     label: "Done (full plan — no action)" } },
      ],
      edges: [
        { id: "e1", source: "start",  target: "cond1"  },
        { id: "e2", source: "cond1",  target: "create", sourceHandle: "yes" },
        { id: "e3", source: "create", target: "notify" },
        { id: "e4", source: "notify", target: "end1"   },
        { id: "e5", source: "cond1",  target: "end2",   sourceHandle: "no" },
      ],
    },
  },
  {
    name: "Sync Stripe invoice due date when phase delivery shifts",
    description: "Triggered when an admin changes a phase delivery date. Guards on a phased payment plan, looks up the draft Stripe invoice for the project, and updates its due date to match the new delivery date. Enable the trigger and verify the paymentPlan condition applies to your event payload before going live.",
    triggerType: "event",
    eventName: "phase.delivery_date_changed",
    triggerEnabled: false,
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 400, y:  50 },
          data: { nodeType: "start", label: "phase.delivery_date_changed" },
        },
        {
          id: "cond1",
          type: "condition",
          position: { x: 400, y: 190 },
          data: { nodeType: "condition", label: "Is Phased Plan?", expression: "paymentPlan == 'phased'" },
        },
        {
          id: "find",
          type: "find_object",
          position: { x: 200, y: 340 },
          data: { nodeType: "find_object", label: "Find Stripe Invoice", objectType: "stripe_invoice", fieldName: "projectId", fieldValueExpr: "{{projectId}}" },
        },
        {
          id: "cond2",
          type: "condition",
          position: { x: 200, y: 490 },
          data: { nodeType: "condition", label: "Invoice Found?", expression: "found == true" },
        },
        {
          id: "edit",
          type: "edit_stripe_invoice",
          position: { x:  50, y: 640 },
          data: { nodeType: "edit_stripe_invoice", label: "Update Invoice Due Date", stripeInvoiceIdExpr: "{{stripeInvoiceId}}", dueDateExpr: "{{newDueDate}}", descriptionExpr: "", footerExpr: "" },
        },
        {
          id: "notify",
          type: "create_notification",
          position: { x:  50, y: 780 },
          data: { nodeType: "create_notification", label: "Notify: Due Date Synced", title: "Invoice due date updated for project {{projectId}}", body: "Stripe draft invoice {{stripeInvoiceId}} due date was shifted to {{newDueDate}} after the phase delivery date changed.", type: "general" },
        },
        {
          id: "end1",
          type: "end",
          position: { x:  50, y: 920 },
          data: { nodeType: "end", label: "Done" },
        },
        {
          id: "end_no_invoice",
          type: "end",
          position: { x: 380, y: 640 },
          data: { nodeType: "end", label: "Done (no draft invoice)" },
        },
        {
          id: "end_not_phased",
          type: "end",
          position: { x: 620, y: 340 },
          data: { nodeType: "end", label: "Done (not a phased plan)" },
        },
      ],
      edges: [
        { id: "e1", source: "start",        target: "cond1"         },
        { id: "e2", source: "cond1",        target: "find",          sourceHandle: "yes" },
        { id: "e3", source: "cond1",        target: "end_not_phased",sourceHandle: "no"  },
        { id: "e4", source: "find",         target: "cond2"         },
        { id: "e5", source: "cond2",        target: "edit",          sourceHandle: "yes" },
        { id: "e6", source: "cond2",        target: "end_no_invoice",sourceHandle: "no"  },
        { id: "e7", source: "edit",         target: "notify"        },
        { id: "e8", source: "notify",       target: "end1"          },
      ],
    },
  },
  {
    name: "Phase Completed: Auto-Charge Invoice",
    description: "Fires when an admin marks a project phase (workflow step) as completed. If the phase has a linked Stripe invoice and the payment plan is phased, finalizes and immediately charges the draft invoice. Sends an admin notification on both success and failure — failed charges do not throw, allowing a downstream condition to branch.",
    triggerType: "event",
    eventName: "phase_completed",
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start",   type: "start",                 position: { x: 400, y:  50 }, data: { nodeType: "start",                 label: "phase_completed" } },
        { id: "cond1",   type: "condition",              position: { x: 400, y: 190 }, data: { nodeType: "condition",              label: "Has Invoice & Phased Plan?",      expression: "stripeInvoiceId && paymentPlan == 'phased'" } },
        { id: "charge",  type: "charge_stripe_invoice",  position: { x: 200, y: 340 }, data: { nodeType: "charge_stripe_invoice",  label: "Charge Invoice",                  invoiceId: "{{stripeInvoiceId}}" } },
        { id: "cond2",   type: "condition",              position: { x: 200, y: 480 }, data: { nodeType: "condition",              label: "Charge Succeeded?",               expression: "chargeStatus == 'succeeded'" } },
        { id: "notifyOk",type: "create_notification",    position: { x:  50, y: 630 }, data: { nodeType: "create_notification",    label: "Notify: Charge Succeeded",        title: "Phase payment collected: {{amountCharged}}", body: "Stripe auto-charge succeeded for phase invoice {{stripeInvoiceId}}. Payment intent: {{stripePaymentIntentId}}.", type: "general" } },
        { id: "end1",    type: "end",                    position: { x:  50, y: 770 }, data: { nodeType: "end",                    label: "Done" } },
        { id: "notifyFail",type: "create_notification",  position: { x: 380, y: 630 }, data: { nodeType: "create_notification",    label: "Notify: Charge Failed",           title: "⚠️ Phase charge failed for {{clientName}} — check Stripe", body: "Auto-charge failed for invoice {{stripeInvoiceId}} on project {{projectId}}. Log into Stripe to investigate and retry the payment.", type: "general" } },
        { id: "end2",    type: "end",                    position: { x: 380, y: 770 }, data: { nodeType: "end",                    label: "Done" } },
        { id: "end3",    type: "end",                    position: { x: 620, y: 340 }, data: { nodeType: "end",                    label: "Done (not applicable)" } },
      ],
      edges: [
        { id: "e1", source: "start",    target: "cond1"     },
        { id: "e2", source: "cond1",    target: "charge",    sourceHandle: "yes" },
        { id: "e3", source: "charge",   target: "cond2"     },
        { id: "e4", source: "cond2",    target: "notifyOk",  sourceHandle: "yes" },
        { id: "e5", source: "notifyOk", target: "end1"      },
        { id: "e6", source: "cond2",    target: "notifyFail",sourceHandle: "no"  },
        { id: "e7", source: "notifyFail",target: "end2"     },
        { id: "e8", source: "cond1",    target: "end3",      sourceHandle: "no"  },
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
      } else if (seed.name === "Weekly Article Generator") {
        // One-time patch: ensure the publish_article node has draftOnly: true.
        // This fixes already-seeded environments where v1 was created before
        // the draft-review feature was added.
        await pool.query(
          `UPDATE wf_versions
              SET graph = jsonb_set(
                graph,
                '{nodes}',
                (
                  SELECT jsonb_agg(
                    CASE
                      WHEN node->>'type' = 'publish_article'
                      THEN jsonb_set(
                             jsonb_set(node, '{data,draftOnly}', 'true'::jsonb),
                             '{data,label}', '"Save as Draft"'::jsonb
                           )
                      ELSE node
                    END
                  )
                  FROM jsonb_array_elements(graph->'nodes') AS node
                )
              )
           WHERE definition_id = $1
             AND (
               graph->'nodes' @> '[{"type":"publish_article","data":{"draftOnly":false}}]'
               OR NOT graph->'nodes' @> '[{"type":"publish_article","data":{"draftOnly":true}}]'
             )`,
          [defId],
        );
        logger.info({ defId }, "seed-system-workflows: patched publish_article node to draftOnly:true");
      } else if (seed.name === "SOW Generation Auto-Retry") {
        // Patch v1: fix old graphs seeded before the sql_query handler was implemented.
        //  1. sql_query node: adds age_ms to SELECT so the condition can gate on recency
        //  2. condition expression: status != 'generating' || age_ms > 300000
        //  3. branch edges: yes/no → true/false (executor routes condition edges as true/false)
        // Guard fires when the old bare-SELECT query or old yes/no handles are present.
        await pool.query(
          `UPDATE wf_versions
              SET graph = jsonb_set(
                jsonb_set(
                  graph,
                  '{nodes}',
                  (
                    SELECT jsonb_agg(
                      CASE
                        WHEN node->'data'->>'actionType' = 'sql_query'
                        THEN jsonb_set(node, '{data,query}', $2::jsonb)
                        WHEN node->'data'->>'nodeType' = 'condition'
                        THEN jsonb_set(node, '{data,expression}', $3::jsonb)
                        ELSE node
                      END
                    )
                    FROM jsonb_array_elements(graph->'nodes') AS node
                  )
                ),
                '{edges}',
                (
                  SELECT jsonb_agg(
                    CASE
                      WHEN edge->>'sourceHandle' = 'yes' THEN jsonb_set(edge, '{sourceHandle}', '"true"')
                      WHEN edge->>'sourceHandle' = 'no'  THEN jsonb_set(edge, '{sourceHandle}', '"false"')
                      ELSE edge
                    END
                  )
                  FROM jsonb_array_elements(graph->'edges') AS edge
                )
              )
           WHERE definition_id = $1
             AND (
               graph->'nodes' @> '[{"data":{"actionType":"sql_query","query":"SELECT status FROM insights_generated_documents"}}]'
               OR graph->'edges' @> '[{"sourceHandle":"yes"}]'
             )`,
          [
            defId,
            JSON.stringify("SELECT status, EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS age_ms FROM insights_generated_documents WHERE project_id = {{projectId}} AND doc_type = 'consolidated_sow' ORDER BY created_at DESC LIMIT 1"),
            JSON.stringify("status != 'generating' || age_ms > 300000"),
          ],
        );
        logger.info({ defId }, "seed-system-workflows: patched SOW Auto-Retry sql_query, condition, and edge handles");

        // Patch v2: upgrade the age threshold from 120 000 ms (2 min) to 300 000 ms (5 min).
        // Fires only on graphs that already have the new SELECT (with age_ms) but still
        // carry the old 120000 guard so the skip window was shorter than intended.
        await pool.query(
          `UPDATE wf_versions
              SET graph = jsonb_set(
                graph,
                '{nodes}',
                (
                  SELECT jsonb_agg(
                    CASE
                      WHEN node->'data'->>'nodeType' = 'condition'
                       AND node->'data'->>'expression' = $2
                      THEN jsonb_set(node, '{data,expression}', $3::jsonb)
                      ELSE node
                    END
                  )
                  FROM jsonb_array_elements(graph->'nodes') AS node
                )
              )
           WHERE definition_id = $1
             AND graph->'nodes' @> $4::jsonb`,
          [
            defId,
            "status != 'generating' || age_ms > 120000",
            JSON.stringify("status != 'generating' || age_ms > 300000"),
            JSON.stringify([{ data: { nodeType: "condition", expression: "status != 'generating' || age_ms > 120000" } }]),
          ],
        );
        logger.info({ defId }, "seed-system-workflows: patched SOW Auto-Retry age threshold 120000 → 300000");
      }

      // 3. Ensure trigger exists (skip if any trigger already present for this def)
      const existingTrigger = await pool.query<{ id: number }>(
        `SELECT id FROM wf_triggers WHERE definition_id = $1 LIMIT 1`,
        [defId],
      );

      if (existingTrigger.rowCount === 0) {
        if (seed.triggerType === "event" && seed.eventName) {
          // Explicit event trigger (e.g. sow.scope_reduced). Respects triggerEnabled (default: true).
          const enabled = seed.triggerEnabled !== false;
          await pool.query(
            `INSERT INTO wf_triggers (definition_id, type, config, enabled)
             VALUES ($1, 'event', $2::jsonb, $3)`,
            [defId, JSON.stringify({ eventName: seed.eventName }), enabled],
          );
        } else if (seed.triggerType === "startup") {
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
