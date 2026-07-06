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
    name: "Presentation Phase Generator",
    description: "Triggered when a client advances past the SOW step. Reads the scoped SOW HTML, asks AI to propose project phases with price weights, and saves them back to the presentation. Pushes SSE progress to the client's browser in real time.",
    triggerType: "event",
    eventName: "presentation.phases_requested",
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 40 },
          data: { nodeType: "start", label: "Phases Requested" },
        },
        {
          id: "emit1",
          type: "emit_event",
          position: { x: 300, y: 160 },
          data: {
            nodeType: "emit_event",
            label: "Progress: Reading SOW",
            eventName: "presentation.phase_gen.progress",
            extraPayload: JSON.stringify({ message: "Reading your Statement of Work", current: 1, total: 4 }),
          },
        },
        {
          id: "ask",
          type: "ask_ai",
          position: { x: 300, y: 300 },
          data: {
            nodeType: "ask_ai",
            label: "Generate Phases",
            model: "claude-haiku-4-5",
            systemExpr: "You are a project planning assistant for a Microsoft 365 consulting business. Return ONLY valid JSON — no preamble, no markdown, no code blocks. The JSON must be a flat array of phase objects.",
            promptExpr: "You are planning a Microsoft 365 consulting project called \"{{projectTitle}}\" with a total value of ${{totalPrice}} USD.\n\nThe client has selected the following scope items:\n{{selectedPhases}}\n\nSOW content excerpt (use this to understand the project scope):\n{{sowHtml}}\n\nGenerate 3\u20135 distinct project phases for this engagement. Each phase should represent a logical milestone (e.g. Discovery & Assessment, Environment Configuration, Migration, Training, Hypercare).\n\nRules:\n- priceWeight values must sum to exactly 1.0\n- Each phase gets 2\u20134 concise subtasks (strings, no numbering)\n- Keep titles short (3\u20136 words)\n- Descriptions: 1\u20132 sentences, professional tone\n- Return ONLY a JSON array, no markdown, no preamble\n\nReturn this exact shape (an array, nothing else):\n[\n  {\n    \"title\": \"Phase title\",\n    \"description\": \"What this phase accomplishes.\",\n    \"priceWeight\": 0.25,\n    \"subtasks\": [\"Subtask one\", \"Subtask two\", \"Subtask three\"]\n  }\n]",
          },
        },
        {
          id: "emit2",
          type: "emit_event",
          position: { x: 300, y: 440 },
          data: {
            nodeType: "emit_event",
            label: "Progress: Identifying Phases",
            eventName: "presentation.phase_gen.progress",
            extraPayload: JSON.stringify({ message: "Identifying project phases", current: 2, total: 4 }),
          },
        },
        {
          id: "comp",
          type: "compose",
          position: { x: 300, y: 580 },
          data: {
            nodeType: "compose",
            label: "Extract JSON",
            inputs: "{{aiResponse}}",
            parseAsJson: true,
          },
        },
        {
          id: "emit3",
          type: "emit_event",
          position: { x: 300, y: 720 },
          data: {
            nodeType: "emit_event",
            label: "Progress: Calculating Pricing",
            eventName: "presentation.phase_gen.progress",
            extraPayload: JSON.stringify({ message: "Calculating phase pricing", current: 3, total: 4 }),
          },
        },
        {
          id: "save",
          type: "system_action",
          position: { x: 300, y: 860 },
          data: {
            nodeType: "system_action",
            label: "Save Phases",
            task: "save_presentation_phases",
          },
        },
        {
          id: "ask_title",
          type: "ask_ai",
          position: { x: 300, y: 1000 },
          data: {
            nodeType: "ask_ai",
            label: "Generate Project Title",
            model: "claude-haiku-4-5",
            systemExpr: "You are a Microsoft 365 consulting project naming assistant. Return ONLY valid JSON — no preamble, no markdown, no code blocks.",
            promptExpr: "Generate a concise, professional engagement title (5–10 words) for a Microsoft 365 consulting project.\n\nClient name: {{clientName}}\nSelected scope items: {{selectedPhases}}\nTotal project value: ${{totalPrice}} USD\n\nRules:\n- The title must be specific to the scope (e.g. \"Microsoft 365 Security & Copilot Readiness for Contoso Corp\" or \"SharePoint Intranet Modernisation & Teams Governance for Acme Inc\")\n- Include the client name if known\n- Do NOT include price, dates, or phase counts\n- Return ONLY this JSON: { \"projectTitle\": \"Your title here\" }",
          },
        },
        {
          id: "comp_title",
          type: "compose",
          position: { x: 300, y: 1140 },
          data: {
            nodeType: "compose",
            label: "Extract Title",
            inputs: "{{aiResponse}}",
            parseAsJson: true,
          },
        },
        {
          id: "save_title",
          type: "system_action",
          position: { x: 300, y: 1280 },
          data: {
            nodeType: "system_action",
            label: "Save Project Title",
            task: "save_presentation_title",
          },
        },
        {
          id: "emit4",
          type: "emit_event",
          position: { x: 300, y: 1420 },
          data: {
            nodeType: "emit_event",
            label: "Complete",
            eventName: "presentation.phase_gen.complete",
            extraPayload: JSON.stringify({ done: true, projectTitle: "{{projectTitle}}" }),
          },
        },
        {
          id: "end",
          type: "end",
          position: { x: 300, y: 1560 },
          data: { nodeType: "end", label: "Done" },
        },
      ],
      edges: [
        { id: "e1", source: "start",      target: "emit1"     },
        { id: "e2", source: "emit1",      target: "ask"       },
        { id: "e3", source: "ask",        target: "emit2"     },
        { id: "e4", source: "emit2",      target: "comp"      },
        { id: "e5", source: "comp",       target: "emit3"     },
        { id: "e6", source: "emit3",      target: "save"      },
        { id: "e7", source: "save",       target: "ask_title" },
        { id: "e8", source: "ask_title",  target: "comp_title"},
        { id: "e9", source: "comp_title", target: "save_title"},
        { id: "e10", source: "save_title", target: "emit4"    },
        { id: "e11", source: "emit4",     target: "end"       },
      ],
    },
  },
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
          id: "calc_pricing",
          type: "action",
          position: { x: 150, y: 610 },
          data: {
            nodeType: "action",
            actionType: "calculate_pricing",
            label: "Write SOW Pricing Lines",
            documentId: "{{documentId}}",
          },
        },
        {
          id: "emit",
          type: "action",
          position: { x: 150, y: 750 },
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
          position: { x: 150, y: 890 },
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
        { id: "e1", source: "start",        target: "check"       },
        { id: "e2", source: "check",        target: "branch"      },
        { id: "e3", source: "branch",       target: "generate",   sourceHandle: "true"  },
        { id: "e4", source: "branch",       target: "end_active", sourceHandle: "false" },
        { id: "e5", source: "generate",     target: "calc_pricing" },
        { id: "e7", source: "calc_pricing", target: "emit"        },
        { id: "e6", source: "emit",         target: "end_retried" },
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
  {
    name: "SOW Generation",
    description: "Generates a Consolidated SOW document for a client engagement. Accepts clientUserId, projectId, and title from the trigger payload. On generation failure, refreshes the M365 profile and intelligence tables before retrying, then sends a failure notification if the retry also fails.",
    triggerType: "event",
    eventName: "sow.generate",
    triggerEnabled: false,
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 400, y: 50 },
          data: { nodeType: "start", label: "Generate SOW" },
        },
        {
          // generate_document executor resolves clientId from node.data.clientId
          // or node.data.customerId — NOT clientUserId. We use clientId here with
          // the {{clientUserId}} interpolation so the payload value flows through.
          id: "gen_sow",
          type: "action",
          position: { x: 400, y: 190 },
          data: {
            nodeType: "action",
            actionType: "generate_document",
            label: "Generate Consolidated SOW",
            docType: "consolidated_sow",
            docCategory: "consulting",
            clientId: "{{clientUserId}}",
            projectId: "{{projectId}}",
            title: "{{title}}",
          },
        },
        {
          id: "end_ok",
          type: "end",
          position: { x: 400, y: 370 },
          data: { nodeType: "end", label: "SOW Generated" },
        },
        {
          // update_m365_profile (promoted action type) requires runbookName.
          // clientId drives the ClientId runbook parameter.
          id: "refresh_profile",
          type: "update_m365_profile",
          position: { x: 700, y: 370 },
          data: {
            nodeType: "update_m365_profile",
            label: "Refresh M365 Profile",
            runbookName: "Update-M365-Profile",
            clientId: "{{clientUserId}}",
          },
        },
        {
          // update_intelligence_tables executor reads node.data.clientId.
          id: "refresh_intel",
          type: "update_intelligence_tables",
          position: { x: 700, y: 510 },
          data: {
            nodeType: "update_intelligence_tables",
            label: "Refresh Intelligence Tables",
            clientId: "{{clientUserId}}",
          },
        },
        {
          id: "retry_sow",
          type: "action",
          position: { x: 700, y: 650 },
          data: {
            nodeType: "action",
            actionType: "generate_document",
            label: "Retry: Generate Consolidated SOW",
            docType: "consolidated_sow",
            docCategory: "consulting",
            clientId: "{{clientUserId}}",
            projectId: "{{projectId}}",
            title: "{{title}}",
          },
        },
        {
          id: "notify_fail",
          type: "create_notification",
          position: { x: 700, y: 830 },
          data: {
            nodeType: "create_notification",
            label: "Notify: SOW Generation Failed",
            title: "SOW generation failed for project {{projectId}}",
            body: "Both the initial attempt and the recovery retry failed. Check the run logs and verify that M365 profile data is available.",
            type: "general",
          },
        },
        {
          id: "end_fail",
          type: "end",
          position: { x: 700, y: 970 },
          data: { nodeType: "end", label: "Failed" },
        },
      ],
      edges: [
        { id: "e1", source: "start",          target: "gen_sow"        },
        { id: "e2", source: "gen_sow",         target: "end_ok"         },
        { id: "e3", source: "gen_sow",         target: "refresh_profile", sourceHandle: "onError" },
        { id: "e4", source: "refresh_profile", target: "refresh_intel"  },
        { id: "e5", source: "refresh_intel",   target: "retry_sow"      },
        { id: "e6", source: "retry_sow",       target: "end_ok"         },
        { id: "e7", source: "retry_sow",       target: "notify_fail",   sourceHandle: "onError" },
        { id: "e8", source: "notify_fail",     target: "end_fail"       },
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
               metadata    = COALESCE(wf_definitions.metadata, '{}'::jsonb) || '{"system":true}'::jsonb,
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

        // Patch v3: insert calc_pricing node between generate and emit.
        // Guard: fires only when the calc_pricing node is not already present.
        await pool.query(
          `UPDATE wf_versions
              SET graph = jsonb_set(
                jsonb_set(
                  graph,
                  '{nodes}',
                  (graph->'nodes') || $2::jsonb
                ),
                '{edges}',
                (
                  SELECT jsonb_agg(
                    CASE
                      WHEN edge->>'source' = 'generate' AND edge->>'target' = 'emit'
                      THEN jsonb_build_object(
                             'id',     'e5',
                             'source', 'generate',
                             'target', 'calc_pricing'
                           )
                      ELSE edge
                    END
                  ) || $3::jsonb
                  FROM jsonb_array_elements(graph->'edges') AS edge
                )
              )
           WHERE definition_id = $1
             AND NOT graph->'nodes' @> '[{"id":"calc_pricing"}]'`,
          [
            defId,
            JSON.stringify([{
              id: "calc_pricing",
              type: "action",
              position: { x: 150, y: 610 },
              data: {
                nodeType: "action",
                actionType: "calculate_pricing",
                label: "Write SOW Pricing Lines",
                documentId: "{{documentId}}",
              },
            }]),
            JSON.stringify([{
              id: "e7",
              source: "calc_pricing",
              target: "emit",
            }]),
          ],
        );
        logger.info({ defId }, "seed-system-workflows: patched SOW Auto-Retry — inserted calc_pricing node");
      } else if (seed.name === "SOW Generation") {
        // Patch v1: fix contract mismatches between the original seeded graph and the
        // workflow executor field conventions. Guard fires when gen_sow still uses
        // the old clientUserId field instead of clientId on its data object.
        //
        // Fixes applied to existing graphs in deployed environments:
        //  • gen_sow, retry_sow:    rename data.clientUserId → data.clientId
        //                           add     data.docCategory = "consulting"
        //  • refresh_profile:       rename data.clientUserId → data.clientId
        //                           add     data.runbookName = "Update-M365-Profile"
        //  • refresh_intel:         rename data.clientUserId → data.clientId
        await pool.query(
          `UPDATE wf_versions
              SET graph = jsonb_set(
                graph,
                '{nodes}',
                (
                  SELECT jsonb_agg(
                    CASE
                      WHEN node->>'id' IN ('gen_sow', 'retry_sow')
                      THEN jsonb_set(
                             jsonb_set(
                               (node #- '{data,clientUserId}'),
                               '{data,clientId}', $2::jsonb
                             ),
                             '{data,docCategory}', '"consulting"'::jsonb
                           )
                      WHEN node->>'id' = 'refresh_profile'
                      THEN jsonb_set(
                             jsonb_set(
                               (node #- '{data,clientUserId}'),
                               '{data,clientId}', $2::jsonb
                             ),
                             '{data,runbookName}', '"Update-M365-Profile"'::jsonb
                           )
                      WHEN node->>'id' = 'refresh_intel'
                      THEN jsonb_set(
                             (node #- '{data,clientUserId}'),
                             '{data,clientId}', $2::jsonb
                           )
                      ELSE node
                    END
                  )
                  FROM jsonb_array_elements(graph->'nodes') AS node
                )
              )
           WHERE definition_id = $1
             AND graph->'nodes' @> '[{"id":"gen_sow","data":{"clientUserId":"{{clientUserId}}"}}]'`,
          [defId, JSON.stringify("{{clientUserId}}")],
        );
        logger.info({ defId }, "seed-system-workflows: patched SOW Generation — fixed clientId field contract for generate_document, update_m365_profile, and update_intelligence_tables nodes");
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
