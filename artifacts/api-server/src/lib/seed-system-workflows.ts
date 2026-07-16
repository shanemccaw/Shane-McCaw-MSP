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
  triggerType: "startup" | "schedule" | "event" | "manual";
  cron?: string;
  /** Single event name — inserts one trigger row. */
  eventName?: string;
  /** Multiple event names — inserts one trigger row per event name. Takes precedence over eventName when provided. */
  eventNames?: string[];
  triggerEnabled?: boolean;
  graph: {
    nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>;
  };
}

const SYSTEM_WORKFLOWS: SystemWorkflowSeed[] = [
  {
    name: "__system__: MSP SOW Charge Approval",
    description:
      "Triggered when an MSP customer signs a SOW. Pauses for MSP approval " +
      "(MSPAdmin or a team member with canApprovePurchases) before charging the " +
      "MSP's card on file — SOWs can run $10-30k, so this never auto-fires. " +
      "On approval, charges via charge_msp_card and emails the approver a confirmation.",
    triggerType: "event",
    eventNames: ["sow.signed"],
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 300, y: 80 }, data: { nodeType: "start", label: "SOW Signed" } },
        {
          id: "gate",
          type: "approval_gate",
          position: { x: 300, y: 220 },
          data: {
            nodeType: "approval_gate",
            label: "MSP Charge Approval",
            approverRole: "msp_approver",
            timeoutSeconds: 259200,
          },
        },
        {
          id: "charge",
          type: "action",
          position: { x: 300, y: 380 },
          data: {
            nodeType: "action",
            actionType: "charge_msp_card",
            label: "Charge MSP Card",
            sowId: "{{sowId}}",
            mspId: "{{mspId}}",
            amountCents: "{{amountCents}}",
            actorUserId: "{{actorUserId}}",
          },
        },
        {
          id: "notify",
          type: "action",
          position: { x: 300, y: 520 },
          data: {
            nodeType: "action",
            actionType: "send_email",
            label: "Confirm Charge to MSP",
            mspId: "{{mspId}}",
            subject: "SOW charge processed",
            htmlBody: "<p>The approved SOW charge for {{amountCents}} cents has been processed. Status: {{status}}.</p>",
          },
        },
        { id: "end", type: "end", position: { x: 300, y: 660 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start",  target: "gate" },
        { id: "e2", source: "gate",   target: "charge", sourceHandle: "approved" },
        { id: "e3", source: "charge", target: "notify" },
        { id: "e4", source: "notify", target: "end" },
      ],
    },
  },
  // ── On Purchase — Run Monitoring Package ──────────────────────────────────
  {
    name: "Run Assessment",
    description:
      "Triggered when a client grants monitoring consent (tenant admin OAuth consent, pre-payment). " +
      "Gathers real M365 telemetry so the tenant can be advertised to and so document generation " +
      "(a separate workflow, 'On Purchase — Generate Engagement Documents') has real signal data once " +
      "payment completes. Expects the event payload to carry: clientId (user record ID), packageKey " +
      "(monitoring package slug), and tenantId (Azure AD tenant GUID). " +
      "Graph: (1) find_object resolves the client record by clientId. " +
      "(2) find_object resolves and validates the monitoring_package record from the DB using the packageKey from the event payload — this is the package-resolution step that confirms the package is active and loads its metadata before execution. " +
      "(3) monitor_execute_package runs all checks for the resolved package against the tenant. " +
      "Per-check progress is emitted to the run timeline via the SSE progress channel. " +
      "Deliberately does NOT generate any documents — see 'On Purchase — Generate Engagement Documents' for that, gated on actual payment so AI credits aren't spent on abandoned checkouts.",
    triggerType: "event",
    eventNames: ["consent.granted"],
    triggerEnabled: true,
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 60 },
          data: { nodeType: "start", label: "Purchase / Consent Event" },
        },
        {
          id: "find_client",
          type: "find_object",
          position: { x: 300, y: 200 },
          data: {
            nodeType: "find_object",
            label: "Resolve Client Record",
            objectType: "client",
            fieldName: "id",
            fieldValueExpr: "{{clientId}}",
          },
        },
        {
          // Resolves and validates the monitoring package from the DB by the event-payload key.
          // Outputs: packageKey, packageId, packageLabel, status, checkCount, engines.
          id: "resolve_pkg",
          type: "find_object",
          position: { x: 300, y: 340 },
          data: {
            nodeType: "find_object",
            label: "Resolve Monitoring Package",
            objectType: "monitoring_package",
            fieldName: "key",
            fieldValueExpr: "{{packageKey}}",
          },
        },
        {
          // Loads full package metadata (check list, engine list) using the canonical key
          // emitted by the find_object step above.
          id: "get_pkg",
          type: "monitor_get_package",
          position: { x: 300, y: 480 },
          data: {
            nodeType: "monitor_get_package",
            label: "Load Package Metadata",
            packageKey: "{{steps.resolve_pkg.packageKey}}",
          },
        },
        {
          id: "execute_pkg",
          type: "monitor_execute_package",
          position: { x: 300, y: 620 },
          data: {
            nodeType: "monitor_execute_package",
            label: "Execute Monitor Checks",
            packageKey: "{{steps.get_pkg.packageKey}}",
            tenantId: "{{tenantId}}",
          },
        },
        {
          id: "branch",
          type: "condition",
          position: { x: 300, y: 760 },
          data: { nodeType: "condition", label: "Checks Passed?", expression: "runStatus == 'completed'" },
        },
        {
          id: "notify_ok",
          type: "create_notification",
          position: { x: 150, y: 900 },
          data: {
            nodeType: "create_notification",
            label: "Monitoring Complete",
            title: "Monitoring package executed successfully",
            body: "Package {{steps.get_pkg.packageLabel}} completed with {{steps.execute_pkg.checksOk}} of {{steps.execute_pkg.checksTotal}} checks passing for {{steps.find_client.name}}.",
            type: "general",
          },
        },
        {
          id: "notify_fail",
          type: "create_notification",
          position: { x: 450, y: 900 },
          data: {
            nodeType: "create_notification",
            label: "Monitoring Issues",
            title: "Monitoring run completed with issues",
            body: "Package {{steps.get_pkg.packageLabel}} for {{steps.find_client.name}} finished with status {{steps.execute_pkg.runStatus}}. {{steps.execute_pkg.checksError}} check(s) failed, {{steps.execute_pkg.consentRevoked}} consent-revoked.",
            type: "general",
          },
        },
        {
          id: "end",
          type: "end",
          position: { x: 300, y: 1040 },
          data: { nodeType: "end", label: "Done" },
        },
      ],
      edges: [
        { id: "e1", source: "start",       target: "find_client"  },
        { id: "e2", source: "find_client", target: "resolve_pkg"  },
        { id: "e3", source: "resolve_pkg", target: "get_pkg"      },
        { id: "e4", source: "get_pkg",     target: "execute_pkg"  },
        { id: "e5", source: "execute_pkg", target: "branch"       },
        { id: "e6", source: "branch",      target: "notify_ok",   sourceHandle: "true"  },
        { id: "e7", source: "branch",      target: "notify_fail", sourceHandle: "false" },
        { id: "e8", source: "notify_ok",   target: "end"          },
        { id: "e9", source: "notify_fail", target: "end"          },
      ],
    },
  },
  // ── On Purchase — Generate Engagement Documents ────────────────────────────
  {
    name: "On Purchase — Generate Engagement Documents",
    description:
      "Triggered when purchase.completed fires (payment confirmed — see portal.ts processStripeEvent, " +
      "onboarding_purchase branch). Deliberately separate from 'On Purchase — Run Monitoring Package', " +
      "which now runs on consent.granted only. Split rationale: monitoring/telemetry runs at consent " +
      "time (pre-payment) so the tenant has real data to advertise against; document generation runs " +
      "only after payment confirms, since AI generation burns credits that shouldn't be spent on " +
      "abandoned checkouts. Expects payload: clientId, packageKey, tenantId. " +
      "KNOWN LIMITATION (tracked separately as item #3, signal derivation rules build-out): " +
      "get_tenant_signals reads clientM365ProfilesTable + scriptRunResultsTable (legacy manual-script " +
      "tables), not tenantMonitorProfilesTable (what monitor_execute_package actually writes). Until #3 " +
      "ships, tenants onboarded purely via modern Graph-consent monitoring will only fire the " +
      "'alwaysInclude' signal, so the generated SOW will only include alwaysInclude-tagged " +
      "engagement_projects — a real but reduced-value baseline document, not a defect in this workflow.",
    triggerType: "event",
    eventNames: ["purchase.completed"],
    triggerEnabled: true,
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 60 },
          data: { nodeType: "start", label: "Purchase Completed" },
        },
        {
          id: "get_signals",
          type: "get_tenant_signals",
          position: { x: 300, y: 200 },
          data: {
            nodeType: "get_tenant_signals",
            label: "Get Tenant Signals",
            clientId: "{{clientId}}",
          },
        },
        {
          // generate_document is dispatched via the generic "action" node type —
          // actionType selects the branch. docCategory MUST be "consulting" or the
          // executor silently falls through to the generic report path and ignores
          // signalsOverride entirely (workflow-executor.ts:1878).
          id: "gen_sow",
          type: "action",
          position: { x: 300, y: 340 },
          data: {
            nodeType: "action",
            actionType: "generate_document",
            label: "Generate Consolidated SOW",
            docType: "consolidated_sow",
            docCategory: "consulting",
            clientId: "{{clientId}}",
            signalsOverride: "{{signals}}",
          },
        },
        {
          id: "notify_ok",
          type: "create_notification",
          position: { x: 150, y: 480 },
          data: {
            nodeType: "create_notification",
            label: "Document Generated",
            title: "Engagement document generated",
            body: "Consolidated SOW generated for client {{clientId}} using {{steps.get_signals.signalCount}} fired signal(s).",
            type: "general",
          },
        },
        {
          id: "end_ok",
          type: "end",
          position: { x: 150, y: 620 },
          data: { nodeType: "end", label: "Done" },
        },
        {
          id: "notify_fail",
          type: "create_notification",
          position: { x: 450, y: 480 },
          data: {
            nodeType: "create_notification",
            label: "Document Generation Failed",
            title: "Engagement document generation failed",
            body: "SOW generation failed for client {{clientId}}. Check run logs.",
            type: "general",
          },
        },
        {
          id: "end_fail",
          type: "end",
          position: { x: 450, y: 620 },
          data: { nodeType: "end", label: "Failed" },
        },
      ],
      edges: [
        { id: "e1", source: "start",       target: "get_signals" },
        { id: "e2", source: "get_signals", target: "gen_sow"     },
        { id: "e3", source: "gen_sow",     target: "notify_ok"   },
        { id: "e4", source: "gen_sow",     target: "notify_fail", sourceHandle: "onError" },
        { id: "e5", source: "notify_ok",   target: "end_ok"      },
        { id: "e6", source: "notify_fail", target: "end_fail"    },
      ],
    },
  },
  // ── MSP Dunning State Machine ─────────────────────────────────────────────
  {
    name: "MSP Dunning State Machine",
    description: "Runs daily. For every past-due platform subscription, advances the dunning state based on how many days have elapsed since payment failure. Configurable thresholds: Day 3 → reminder_sent, Day 7 → suspended (new onboarding blocked), Day 14 → access_revoked, Day 30 → archival_flagged. Payment success (via Stripe webhook) resets dunning instantly.",
    triggerType: "schedule",
    cron: "0 8 * * *",
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 60 },
          data: { nodeType: "start", label: "Daily 08:00 UTC" },
        },
        {
          id: "dunning",
          type: "msp_dunning_advance",
          position: { x: 300, y: 200 },
          data: {
            nodeType: "msp_dunning_advance",
            label: "Advance Dunning States",
            // Configurable day thresholds — edit these to adjust dunning timing
            dayReminder: 3,
            daySuspend: 7,
            dayRevoke: 14,
            dayArchive: 30,
          },
        },
        {
          id: "end",
          type: "end",
          position: { x: 300, y: 340 },
          data: { nodeType: "end", label: "Done" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "dunning" },
        { id: "e2", source: "dunning", target: "end" },
      ],
    },
  },
  // ── MSP Overage Metering ───────────────────────────────────────────────────
  {
    name: "MSP Overage Metering",
    description: "Runs on the 1st of each month. Counts active customer tenants for every active MSP platform subscription, compares against the tier's included tenant allowance, and records overage events for billing. MSPs are never hard-blocked for overage — the flat fee covers the allowance; overage is billed at the configured per-tenant rate.",
    triggerType: "schedule",
    cron: "0 6 1 * *",
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 60 },
          data: { nodeType: "start", label: "1st of Month 06:00 UTC" },
        },
        {
          id: "meter",
          type: "msp_overage_meter",
          position: { x: 300, y: 200 },
          data: {
            nodeType: "msp_overage_meter",
            label: "Meter Tenant Overage",
          },
        },
        {
          id: "end",
          type: "end",
          position: { x: 300, y: 340 },
          data: { nodeType: "end", label: "Done" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "meter" },
        { id: "e2", source: "meter", target: "end" },
      ],
    },
  },
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
          type: "sql_query",
          position: { x: 300, y: 860 },
          data: {
            nodeType: "sql_query",
            label: "Save Phases",
            query: "WITH raw AS (SELECT gen_random_uuid()::text AS id, COALESCE(elem->>'title','Phase') AS title, COALESCE(elem->>'description','') AS descr, COALESCE(elem->'subtasks','[]'::jsonb) AS subtasks, COALESCE((elem->>'priceWeight')::numeric, 1.0/GREATEST(jsonb_array_length($1::jsonb),1)) AS wt, ordinality AS rn FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS t(elem, ordinality)), total AS (SELECT GREATEST(SUM(wt),0.0001) AS s FROM raw), priced AS (SELECT id, title, descr, subtasks, rn, ROUND($2::numeric * wt / (SELECT s FROM total), 2) AS price FROM raw), upd AS (UPDATE quick_win_presentations SET sow_phases=(SELECT jsonb_agg(jsonb_build_object('id',id,'title',title,'description',descr,'price',price,'selected',true,'subtasks',subtasks) ORDER BY rn) FROM priced), selected_phase_ids=(SELECT jsonb_agg(id ORDER BY rn) FROM priced), updated_at=NOW() WHERE id=$3::int RETURNING id) SELECT (SELECT COUNT(*)::int FROM priced) AS phase_count",
            params: ["{{value}}", "{{totalPrice}}", "{{presentationId}}"],
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
          type: "sql_query",
          position: { x: 300, y: 1280 },
          data: {
            nodeType: "sql_query",
            label: "Save Project Title",
            query: "UPDATE quick_win_presentations SET project_title=$1, updated_at=NOW() WHERE id=$2::int RETURNING project_title AS \"projectTitle\"",
            params: ["{{value.projectTitle}}", "{{presentationId}}"],
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
        { id: "start", type: "start",                   position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Startup" } },
        { id: "act",   type: "reconcile_orphaned_runs", position: { x: 100, y: 230 }, data: { nodeType: "reconcile_orphaned_runs", label: "Reconcile Orphaned Runs", task: "reconcile_orphaned_runs" } },
        { id: "end",   type: "end",                     position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "act" },
        { id: "e2", source: "act",   target: "end" },
      ],
    },
  },
  {
    name: "__system__: Late Auto-Fire Reconciliation",
    description: "Runs every 5 minutes to correct kanban cards that were falsely marked failed by the stuck-queued bail-out if Azure has since completed the job.",
    triggerType: "schedule",
    cron: "*/5 * * * *",
    graph: {
      nodes: [
        { id: "start", type: "start",                   position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Cron */5 min" } },
        { id: "act",   type: "reconcile_orphaned_runs", position: { x: 100, y: 230 }, data: { nodeType: "reconcile_orphaned_runs", label: "Reconcile Late Stuck-Queued", task: "reconcile_late_stuck_queued" } },
        { id: "end",   type: "end",                     position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "act" },
        { id: "e2", source: "act",   target: "end" },
      ],
    },
  },
  {
    name: "__system__: Alert Rule Evaluation",
    description: "Runs every 5 minutes to evaluate platform alert rules (DLQ backlog, billing failures, SLA breaches, event bus backlog, job failure rate) and deliver alerts via Exchange Online email and browser push. Replaces the old alert-engine.ts setInterval poller.",
    triggerType: "schedule",
    cron: "*/5 * * * *",
    graph: {
      nodes: [
        { id: "start", type: "start",               position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Cron */5 min" } },
        { id: "act",   type: "alert_evaluate_rules", position: { x: 100, y: 230 }, data: { nodeType: "alert_evaluate_rules", label: "Evaluate Alert Rules" } },
        { id: "end",   type: "end",                 position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
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
        { id: "start",  type: "start",     position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Cron 03:00" } },
        {
          id: "cleanup",
          type: "sql_query",
          position: { x: 100, y: 230 },
          data: {
            nodeType: "sql_query",
            label: "Delete Old Runs",
            query: "WITH deleted AS (DELETE FROM wf_runs WHERE created_at < NOW() - INTERVAL '90 days' RETURNING id) SELECT COUNT(*)::int AS deleted FROM deleted",
          },
        },
        { id: "end",    type: "end",      position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start",   target: "cleanup" },
        { id: "e2", source: "cleanup", target: "end"     },
      ],
    },
  },
  {
    name: "__system__: Escalation Check",
    description: "Daily check (08:00 UTC) for manual script cards stalled in Waiting on Customer for more than 7 days. Creates an in-app notification if any are found.",
    triggerType: "schedule",
    cron: "0 8 * * *",
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Cron 08:00" } },
        {
          id: "check",
          type: "sql_query",
          position: { x: 100, y: 230 },
          data: {
            nodeType: "sql_query",
            label: "Find Stalled Cards",
            query: "SELECT COUNT(*)::int AS stalled_count FROM kanban_tasks kt JOIN projects p ON p.id = kt.project_id WHERE kt.\"column\" = 'waiting_on_customer' AND kt.task_type = 'manualScript' AND kt.updated_at < NOW() - INTERVAL '7 days' AND (kt.task_metadata->>'lastEscalationAlertSentAt' IS NULL OR (kt.task_metadata->>'lastEscalationAlertSentAt')::timestamptz < NOW() - INTERVAL '24 hours')",
          },
        },
        {
          id: "branch",
          type: "condition",
          position: { x: 100, y: 360 },
          data: { nodeType: "condition", label: "Any Stalled?", expression: "stalled_count > 0" },
        },
        {
          id: "notify",
          type: "create_notification",
          position: { x: 100, y: 490 },
          data: {
            nodeType: "create_notification",
            label: "Escalation Alert",
            title: "{{stalled_count}} manual script card(s) need escalation",
            body: "{{stalled_count}} kanban card(s) have been in Waiting on Customer for more than 7 days without a recent escalation alert.",
            type: "general",
          },
        },
        { id: "end",      type: "end", position: { x: 100, y: 620 }, data: { nodeType: "end", label: "Done" } },
        { id: "end_skip", type: "end", position: { x: 250, y: 360 }, data: { nodeType: "end", label: "No escalations" } },
      ],
      edges: [
        { id: "e1", source: "start",  target: "check"    },
        { id: "e2", source: "check",  target: "branch"   },
        { id: "e3", source: "branch", target: "notify",   sourceHandle: "true"  },
        { id: "e4", source: "branch", target: "end_skip", sourceHandle: "false" },
        { id: "e5", source: "notify", target: "end"      },
      ],
    },
  },
  {
    name: "__system__: Monthly Insights",
    description: "Monthly insights automation runner (cron 0 9 1 * *) — claims all enabled insights automations whose next_run_at has arrived and advances their schedule by 30 days.",
    triggerType: "schedule",
    cron: "0 9 1 * *",
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Cron 1st of month" } },
        {
          id: "fix_stale",
          type: "sql_query",
          position: { x: 100, y: 230 },
          data: {
            nodeType: "sql_query",
            label: "Fix Stale Automations",
            query: "UPDATE insights_automations SET next_run_at = NOW() WHERE enabled = true AND next_run_at IS NULL",
          },
        },
        {
          id: "claim",
          type: "sql_query",
          position: { x: 100, y: 360 },
          data: {
            nodeType: "sql_query",
            label: "Claim Due Automations",
            query: "WITH due AS (SELECT id FROM insights_automations WHERE enabled = true AND next_run_at IS NOT NULL AND next_run_at <= NOW() ORDER BY id), claimed AS (UPDATE insights_automations SET next_run_at = NOW() + INTERVAL '30 days' WHERE id IN (SELECT id FROM due)) SELECT COUNT(*)::int AS fired_count FROM due",
          },
        },
        {
          id: "branch",
          type: "condition",
          position: { x: 100, y: 490 },
          data: { nodeType: "condition", label: "Any Fired?", expression: "fired_count > 0" },
        },
        {
          id: "notify",
          type: "create_notification",
          position: { x: 100, y: 620 },
          data: {
            nodeType: "create_notification",
            label: "Insights Run Report",
            title: "Monthly Insights: {{fired_count}} automation(s) scheduled",
            body: "{{fired_count}} insights automation(s) were claimed this cycle. Their next_run_at windows have been advanced by 30 days.",
            type: "general",
          },
        },
        { id: "end",      type: "end", position: { x: 100, y: 750 }, data: { nodeType: "end", label: "Done" } },
        { id: "end_skip", type: "end", position: { x: 250, y: 490 }, data: { nodeType: "end", label: "Nothing due" } },
      ],
      edges: [
        { id: "e1", source: "start",    target: "fix_stale" },
        { id: "e2", source: "fix_stale", target: "claim"    },
        { id: "e3", source: "claim",    target: "branch"    },
        { id: "e4", source: "branch",   target: "notify",   sourceHandle: "true"  },
        { id: "e5", source: "branch",   target: "end_skip", sourceHandle: "false" },
        { id: "e6", source: "notify",   target: "end"       },
      ],
    },
  },
  {
    name: "__system__: Kanban Auto-fire",
    description: "Handles kanban.card_moved events to auto-fire scripts and document generation for client cards.",
    triggerType: "startup",
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "kanban.card_moved" } },
        {
          id: "guard",
          type: "condition",
          position: { x: 100, y: 230 },
          data: { nodeType: "condition", label: "Has Client?", expression: "clientUserId > 0" },
        },
        {
          id: "execute",
          type: "kanban_auto_fire",
          position: { x: 100, y: 360 },
          data: { nodeType: "kanban_auto_fire", label: "Auto-fire Card", clientId: "{{clientUserId}}", action: "{{action}}" },
        },
        { id: "end",      type: "end", position: { x: 100, y: 490 }, data: { nodeType: "end", label: "Done" } },
        { id: "end_skip", type: "end", position: { x: 250, y: 230 }, data: { nodeType: "end", label: "No client — skip" } },
      ],
      edges: [
        { id: "e1", source: "start",   target: "guard"    },
        { id: "e2", source: "guard",   target: "execute",  sourceHandle: "true"  },
        { id: "e3", source: "guard",   target: "end_skip", sourceHandle: "false" },
        { id: "e4", source: "execute", target: "end"       },
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
            query: "SELECT latest.status, EXTRACT(EPOCH FROM (NOW() - latest.created_at)) * 1000 AS age_ms, (SELECT COUNT(*) FROM insights_generated_documents f WHERE f.project_id = {{projectId}} AND f.doc_type = 'consolidated_sow' AND f.status = 'failed' AND f.created_at > NOW() - INTERVAL '60 minutes') AS fail_count FROM insights_generated_documents latest WHERE latest.project_id = {{projectId}} AND latest.doc_type = 'consolidated_sow' ORDER BY latest.created_at DESC LIMIT 1",
          },
        },
        {
          id: "branch",
          type: "condition",
          position: { x: 300, y: 330 },
          data: {
            nodeType: "condition",
            label: "Should Retry?",
            // Circuit breaker: never fire another regeneration attempt once this
            // project has racked up 3+ failed consolidated_sow rows in the last
            // hour — a deterministic AI/data problem won't fix itself by retrying,
            // and without this cap the stall-check + this workflow retry forever
            // (see "regenerating and regenerating but never producing" reports).
            expression: "(status != 'generating' || age_ms > 300000) && fail_count < 3",
          },
        },
        {
          id: "exhausted",
          type: "condition",
          position: { x: 480, y: 330 },
          data: {
            nodeType: "condition",
            label: "Retry Budget Exhausted?",
            expression: "fail_count >= 3",
          },
        },
        {
          id: "notify_exhausted",
          type: "create_notification",
          position: { x: 620, y: 470 },
          data: {
            nodeType: "create_notification",
            label: "Notify: SOW Auto-Retry Exhausted",
            title: "Consolidated SOW generation stuck (project {{projectId}})",
            body: "Automatic retries were stopped after 3 consecutive failures in the last hour. Investigate and regenerate manually from the Insights & Outputs admin panel.",
            type: "general",
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
          position: { x: 340, y: 470 },
          data: { nodeType: "end", label: "Already generating — skip" },
        },
        {
          id: "end_exhausted",
          type: "end",
          position: { x: 620, y: 610 },
          data: { nodeType: "end", label: "Retry budget exhausted — admin notified" },
        },
      ],
      edges: [
        { id: "e1", source: "start",           target: "check"           },
        { id: "e2", source: "check",           target: "branch"          },
        { id: "e3", source: "branch",          target: "generate",       sourceHandle: "true"  },
        { id: "e4", source: "branch",          target: "exhausted",      sourceHandle: "false" },
        { id: "e8", source: "exhausted",       target: "notify_exhausted", sourceHandle: "true"  },
        { id: "e9", source: "exhausted",       target: "end_active",       sourceHandle: "false" },
        { id: "e10", source: "notify_exhausted", target: "end_exhausted" },
        { id: "e5", source: "generate",        target: "calc_pricing"    },
        { id: "e7", source: "calc_pricing",    target: "emit"            },
        { id: "e6", source: "emit",            target: "end_retried"     },
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

  // ── Live Activity Monitor (Mode B — near-real-time audit-log change detection) ──
  {
    name: "__system__: Live Activity Monitor",
    description:
      "Runs every 5 minutes. For every active live-frequency monitor check × consented tenant, " +
      "ensures the O365 Management Activity API subscription is live (starts it if absent), " +
      "polls for new audit events since the last watermark, applies the check's severity rules, " +
      "and writes tenant_monitor_profile rows for any critical changes. Fires a " +
      "monitor.critical_change event and creates an admin notification if anything critical " +
      "was detected in the cycle. Requires MT_APP_CLIENT_ID + MT_APP_CLIENT_SECRET secrets " +
      "and ActivityFeed.Read application permission on the multi-tenant App Registration.",
    triggerType: "schedule",
    cron: "*/5 * * * *",
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 400, y: 40 },
          data: { nodeType: "start", label: "Every 5 min" },
        },
        {
          // Fetch all (tenant × live-check) combinations where tenant has granted consent.
          // Returns assignments: [{tenantId, checkKey, label, contentType, mapping, severityRules}]
          id: "get_assignments",
          type: "action",
          position: { x: 400, y: 160 },
          data: {
            nodeType: "action",
            actionType: "sql_query",
            label: "Get Live-Frequency Assignments",
            query: `
SELECT json_agg(row_to_json(t)) AS "assignments"
FROM (
  SELECT
    tc.tenant_id             AS "tenantId",
    mc.key                   AS "checkKey",
    mc.label                 AS "label",
    mc.endpoint              AS "contentType",
    mc.mapping::text         AS "mapping",
    mc.severity_rules::text  AS "severityRules"
  FROM tenant_consent tc
  CROSS JOIN monitor_checks mc
  WHERE tc.consent_status = 'granted'
    AND mc.frequency       = 'live'
    AND mc.status          = 'active'
  ORDER BY tc.tenant_id, mc.key
  LIMIT 500
) t
`.trim(),
          },
        },
        {
          // ForEach iterates over assignments; body: ensure_sub → poll_activity
          id: "loop",
          type: "foreach",
          position: { x: 400, y: 300 },
          data: {
            nodeType: "foreach",
            label: "For Each Assignment",
            arrayPath: "assignments",
            itemAlias: "assignment",
          },
        },
        {
          // Body node 1: ensure subscription is active for this tenant+contentType
          id: "ensure_sub",
          type: "monitor_subscription_ensure",
          position: { x: 700, y: 300 },
          data: {
            nodeType: "monitor_subscription_ensure",
            label: "Ensure Subscription",
            tenantId:    "{{assignment.tenantId}}",
            contentType: "{{assignment.contentType}}",
          },
        },
        {
          // Body node 2: poll for new audit events since the stored watermark
          id: "poll_activity",
          type: "monitor_poll_activity",
          position: { x: 900, y: 300 },
          data: {
            nodeType: "monitor_poll_activity",
            label: "Poll Audit Activity",
            tenantId:    "{{assignment.tenantId}}",
            contentType: "{{assignment.contentType}}",
            checkKey:    "{{assignment.checkKey}}",
          },
        },
        {
          // After the foreach loop: check if any critical profiles were written this cycle
          id: "check_critical",
          type: "action",
          position: { x: 400, y: 440 },
          data: {
            nodeType: "action",
            actionType: "sql_query",
            label: "Check for Critical Events",
            query: `
SELECT
  CASE WHEN COUNT(*) > 0 THEN true ELSE false END AS "criticalChangeDetected",
  COUNT(*) AS "criticalCount"
FROM tenant_monitor_profiles
WHERE created_at > NOW() - INTERVAL '6 minutes'
  AND severity_matched IS NOT NULL
  AND trigger_id LIKE 'wf-run-%'
`.trim(),
          },
        },
        {
          id: "cond",
          type: "condition",
          position: { x: 400, y: 580 },
          data: {
            nodeType: "condition",
            label: "Critical Change?",
            expression: "{{criticalChangeDetected}} == true",
          },
        },
        {
          id: "emit_ev",
          type: "emit_event",
          position: { x: 600, y: 700 },
          data: {
            nodeType: "emit_event",
            label: "Emit monitor.critical_change",
            eventName: "monitor.critical_change",
            payload: JSON.stringify({ criticalCount: "{{criticalCount}}", source: "live_activity_monitor" }),
          },
        },
        {
          id: "notify",
          type: "create_notification",
          position: { x: 600, y: 840 },
          data: {
            nodeType: "create_notification",
            label: "Create Admin Notification",
            title: "Live Monitor: Critical Change Detected",
            body:  "{{criticalCount}} critical audit event(s) found in the last cycle. Check Monitoring → Monitor Checks for details.",
            type:  "alert",
            // TODO: swap to /delivery/monitor-profiles once the dedicated global
            // Monitor Profiles page is built — /delivery/monitor-checks is an
            // honest stopgap in the meantime, not the ideal destination.
            linkPath: "/delivery/monitor-checks",
          },
        },
        {
          id: "send_alert_email",
          type: "action",
          position: { x: 600, y: 900 },
          data: {
            nodeType: "action",
            actionType: "send_email",
            label: "Email Critical Alert",
            // 'to' omitted deliberately — falls back to process.env.ADMIN_EMAIL /
            // CRM_ADMIN_EMAIL in the executor, matching the notify_major_changes convention.
            subject: "Live Monitor: {{criticalCount}} Critical Change(s) Detected",
            htmlBody: "<p><strong>{{criticalCount}}</strong> critical audit event(s) were found in the last monitoring cycle.</p><p>Check the Admin Panel → Delivery → Monitor Checks for details.</p>",
          },
        },
        {
          id: "end",
          type: "end",
          position: { x: 600, y: 980 },
          data: { nodeType: "end", label: "Done" },
        },
        {
          id: "end_noop",
          type: "end",
          position: { x: 200, y: 700 },
          data: { nodeType: "end", label: "No Changes" },
        },
      ],
      edges: [
        { id: "e1",  source: "start",          target: "get_assignments" },
        { id: "e2",  source: "get_assignments", target: "loop" },
        // foreach body edges
        { id: "e3",  source: "loop",            target: "ensure_sub",    sourceHandle: "body" },
        { id: "e4",  source: "ensure_sub",      target: "poll_activity" },
        // foreach done edge → post-loop check
        { id: "e5",  source: "loop",            target: "check_critical", sourceHandle: "done" },
        { id: "e6",  source: "check_critical",  target: "cond" },
        // condition branches
        { id: "e7",  source: "cond",            target: "emit_ev",       sourceHandle: "yes" },
        { id: "e8",  source: "cond",            target: "end_noop",      sourceHandle: "no"  },
       // post-alert
        { id: "e9",  source: "emit_ev",         target: "notify" },
        { id: "e10", source: "notify",          target: "send_alert_email" },
        { id: "e11", source: "send_alert_email", target: "end" },
      ],
    },
  },
  // ── Purchase — Route Document Generation ──────────────────────────────────
  {
    name: "Purchase — Route Document Generation",
    description: "Triggered on purchase.completed. Iterates over serviceIds in payment metadata, resolves their packageKeys, and routes to Generate Engagement Document workflow.",
    triggerType: "event",
    eventNames: ["purchase.completed"],
    triggerEnabled: true,
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 60 },
          data: { nodeType: "start", label: "Purchase Completed" },
        },
        {
          id: "emit_received",
          type: "action",
          position: { x: 300, y: 200 },
          data: {
            nodeType: "action",
            actionType: "emit_event",
            label: "Emit Purchase Received",
            eventType: "purchase_readiness.received",
            extraPayload: JSON.stringify({ status: "purchase_received" }),
          },
        },
        {
          id: "loop",
          type: "foreach",
          position: { x: 300, y: 340 },
          data: {
            nodeType: "foreach",
            label: "For Each Purchased Service",
            arrayPath: "serviceIds",
            itemAlias: "serviceId",
          },
        },
        {
          id: "resolve_doc_type",
          type: "sql_query",
          position: { x: 150, y: 480 },
          data: {
            nodeType: "sql_query",
            label: "Resolve Document Type",
            query: `SELECT CASE WHEN type_attributes->>'packageKey' IS NOT NULL THEN 'consolidated_sow' ELSE 'default' END AS "docType", type_attributes->>'packageKey' AS "packageKey" FROM services WHERE id = $1::int LIMIT 1`,
            params: ["{{serviceId}}"],
          },
        },
        {
          id: "switch_doc_type",
          type: "switch_case",
          position: { x: 150, y: 620 },
          data: {
            nodeType: "switch_case",
            label: "Route Document Type",
            switchExpr: "{{steps.resolve_doc_type.docType}}",
            cases: [
              { id: "consolidated_sow", matchValue: "consolidated_sow", label: "Consolidated SOW" },
            ],
          },
        },
        {
          id: "gen_doc",
          type: "action",
          position: { x: 50, y: 760 },
          data: {
            nodeType: "action",
            actionType: "run_workflow",
            label: "Generate Engagement Document",
            workflowName: "Generate Engagement Document",
            inputMapping: [
              { key: "clientId", expr: "{{clientId}}" },
              { key: "tenantId", expr: "{{tenantId}}" },
              { key: "packageKey", expr: "{{steps.resolve_doc_type.packageKey}}" },
            ],
          },
        },
        {
          id: "end_loop",
          type: "end",
          position: { x: 250, y: 760 },
          data: { nodeType: "end", label: "Done Service" },
        },
        {
          id: "end",
          type: "end",
          position: { x: 450, y: 480 },
          data: { nodeType: "end", label: "Done" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "emit_received" },
        { id: "e2", source: "emit_received", target: "loop" },
        { id: "e3", source: "loop", target: "resolve_doc_type", sourceHandle: "body" },
        { id: "e4", source: "resolve_doc_type", target: "switch_doc_type" },
        { id: "e5", source: "switch_doc_type", target: "gen_doc", sourceHandle: "consolidated_sow" },
        { id: "e6", source: "switch_doc_type", target: "end_loop", sourceHandle: "default" },
        { id: "e7", source: "gen_doc", target: "end_loop" },
        { id: "e8", source: "loop", target: "end", sourceHandle: "done" },
      ],
    },
  },
  // ── Generate Engagement Document ──────────────────────────────────────────
  {
    name: "Generate Engagement Document",
    description: "Invoked programmatically to check payment status and assessment status, wait until ready, and generate Consolidated SOW.",
    triggerType: "manual",
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 60 },
          data: { nodeType: "start", label: "Start Generation" },
        },
        {
          id: "emit_checking",
          type: "action",
          position: { x: 300, y: 180 },
          data: {
            nodeType: "action",
            actionType: "emit_event",
            label: "Emit Checking Readiness",
            eventType: "purchase_readiness.checking",
            extraPayload: JSON.stringify({ status: "checking_readiness" }),
          },
        },
        {
          id: "check_paid",
          type: "sql_query",
          position: { x: 180, y: 300 },
          data: {
            nodeType: "sql_query",
            label: "Check Payment",
            query: `SELECT CASE WHEN status = 'paid' THEN true ELSE false END AS "hasPaid" FROM checkout_sessions WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 1`,
            params: ["{{tenantId}}"],
          },
        },
        {
          id: "check_assessment",
          type: "sql_query",
          position: { x: 420, y: 300 },
          data: {
            nodeType: "sql_query",
            label: "Check Assessment Status",
            query: `SELECT status AS "assessmentRunStatus" FROM wf_runs WHERE definition_id = (SELECT id FROM wf_definitions WHERE name = 'Run Assessment' LIMIT 1) AND payload->>'tenantId' = $1 ORDER BY created_at DESC LIMIT 1`,
            params: ["{{tenantId}}"],
          },
        },
        {
          id: "delay_until_ready",
          type: "delay",
          position: { x: 300, y: 420 },
          data: {
            nodeType: "delay",
            label: "Wait for Telemetry & Payment",
            mode: "until_condition",
            expression: "steps.check_paid.hasPaid == true && steps.check_assessment.assessmentRunStatus == 'completed'",
            abortExpression: "steps.check_assessment.assessmentRunStatus == 'failed' || steps.check_assessment.assessmentRunStatus == 'cancelled'",
            refreshNodeIds: ["check_paid", "check_assessment"],
            interval: 5,
            timeout: 30,
          },
        },
        {
          id: "branch",
          type: "condition",
          position: { x: 300, y: 540 },
          data: {
            nodeType: "condition",
            label: "Condition Met?",
            expression: "steps.delay_until_ready.conditionMet == true",
          },
        },
        {
          id: "branch_abort",
          type: "condition",
          position: { x: 500, y: 660 },
          data: {
            nodeType: "condition",
            label: "Aborted?",
            expression: "steps.delay_until_ready.aborted == true",
          },
        },
        {
          id: "emit_ready",
          type: "action",
          position: { x: 100, y: 660 },
          data: {
            nodeType: "action",
            actionType: "emit_event",
            label: "Emit Ready",
            eventType: "purchase_readiness.ready",
          },
        },
        {
          id: "get_signals",
          type: "get_tenant_signals",
          position: { x: 100, y: 780 },
          data: {
            nodeType: "get_tenant_signals",
            label: "Get Tenant Signals",
            clientId: "{{clientId}}",
          },
        },
        {
          id: "emit_analyzing",
          type: "action",
          position: { x: 100, y: 900 },
          data: {
            nodeType: "action",
            actionType: "emit_event",
            label: "Emit Analyzing",
            eventType: "purchase_readiness.analyzing",
            extraPayload: JSON.stringify({ signalCount: "{{steps.get_signals.signalCount}}" }),
          },
        },
        {
          id: "gen_sow",
          type: "action",
          position: { x: 100, y: 1020 },
          data: {
            nodeType: "action",
            actionType: "generate_document",
            label: "Generate Consolidated SOW",
            docType: "consolidated_sow",
            docCategory: "consulting",
            clientId: "{{clientId}}",
            signalsOverride: "{{signals}}",
          },
        },
        {
          id: "emit_complete",
          type: "action",
          position: { x: 100, y: 1140 },
          data: {
            nodeType: "action",
            actionType: "emit_event",
            label: "Emit Complete",
            eventType: "purchase_readiness.complete",
            extraPayload: JSON.stringify({ documentId: "{{steps.gen_sow.documentId}}" }),
          },
        },
        {
          id: "notify_success",
          type: "create_notification",
          position: { x: 100, y: 1260 },
          data: {
            nodeType: "create_notification",
            label: "Notify: Document Generated",
            title: "Engagement document generated",
            body: "Consolidated SOW generated successfully for client {{clientId}}.",
            type: "general",
          },
        },
        {
          id: "end_success",
          type: "end",
          position: { x: 100, y: 1380 },
          data: { nodeType: "end", label: "Completed Successfully" },
        },
        {
          id: "emit_doc_failed",
          type: "action",
          position: { x: 250, y: 1140 },
          data: {
            nodeType: "action",
            actionType: "emit_event",
            label: "Emit Doc Failed",
            eventType: "purchase_readiness.doc_failed",
          },
        },
        {
          id: "notify_doc_failed",
          type: "create_notification",
          position: { x: 250, y: 1260 },
          data: {
            nodeType: "create_notification",
            label: "Notify: Doc Generation Failed",
            title: "Engagement document generation failed",
            body: "SOW generation failed for client {{clientId}}. Check run logs.",
            type: "general",
          },
        },
        {
          id: "end_doc_failed",
          type: "end",
          position: { x: 250, y: 1380 },
          data: { nodeType: "end", label: "Failed Doc Generation" },
        },
        {
          id: "emit_telemetry_failed",
          type: "action",
          position: { x: 400, y: 780 },
          data: {
            nodeType: "action",
            actionType: "emit_event",
            label: "Emit Telemetry Failed",
            eventType: "purchase_readiness.telemetry_failed",
          },
        },
        {
          id: "notify_telemetry_failed",
          type: "create_notification",
          position: { x: 400, y: 900 },
          data: {
            nodeType: "create_notification",
            label: "Notify: Assessment Failed",
            title: "Assessment run failed",
            body: "Assessment run for tenant {{tenantId}} failed or was cancelled. SOW could not be generated.",
            type: "general",
          },
        },
        {
          id: "end_telemetry_failed",
          type: "end",
          position: { x: 400, y: 1020 },
          data: { nodeType: "end", label: "Telemetry Failed — Manual Review" },
        },
        {
          id: "emit_still_processing",
          type: "action",
          position: { x: 600, y: 780 },
          data: {
            nodeType: "action",
            actionType: "emit_event",
            label: "Emit Still Processing",
            eventType: "purchase_readiness.still_processing",
          },
        },
        {
          id: "notify_timeout",
          type: "create_notification",
          position: { x: 600, y: 900 },
          data: {
            nodeType: "create_notification",
            label: "Notify: Timeout",
            title: "SOW Generation Timed Out",
            body: "SOW generation for client {{clientId}} timed out waiting for telemetry. Manual follow-up required.",
            type: "general",
          },
        },
        {
          id: "end_timeout",
          type: "end",
          position: { x: 600, y: 1020 },
          data: { nodeType: "end", label: "Timed Out — Manual Review" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "emit_checking" },
        { id: "e2", source: "emit_checking", target: "check_paid" },
        { id: "e3", source: "emit_checking", target: "check_assessment" },
        { id: "e4", source: "check_paid", target: "delay_until_ready" },
        { id: "e5", source: "check_assessment", target: "delay_until_ready" },
        { id: "e6", source: "delay_until_ready", target: "branch" },
        { id: "e7", source: "branch", target: "emit_ready", sourceHandle: "true" },
        { id: "e8", source: "branch", target: "branch_abort", sourceHandle: "false" },
        { id: "e9", source: "branch_abort", target: "emit_telemetry_failed", sourceHandle: "true" },
        { id: "e10", source: "branch_abort", target: "emit_still_processing", sourceHandle: "false" },
        { id: "e11", source: "emit_ready", target: "get_signals" },
        { id: "e12", source: "get_signals", target: "emit_analyzing" },
        { id: "e13", source: "emit_analyzing", target: "gen_sow" },
        { id: "e14", source: "gen_sow", target: "emit_complete" },
        { id: "e15", source: "gen_sow", target: "emit_doc_failed", sourceHandle: "onError" },
        { id: "e16", source: "emit_complete", target: "notify_success" },
        { id: "e17", source: "notify_success", target: "end_success" },
        { id: "e18", source: "emit_doc_failed", target: "notify_doc_failed" },
        { id: "e19", source: "notify_doc_failed", target: "end_doc_failed" },
        { id: "e20", source: "emit_telemetry_failed", target: "notify_telemetry_failed" },
        { id: "e21", source: "notify_telemetry_failed", target: "end_telemetry_failed" },
        { id: "e22", source: "emit_still_processing", target: "notify_timeout" },
        { id: "e23", source: "notify_timeout", target: "end_timeout" },
      ],
    },
  },
];

export async function seedSystemWorkflows(): Promise<void> {
  try {
    // One-time migration patch to rename the consent-triggered monitoring package
    // workflow to "Run Assessment" and cleanup trigger events before seeding
    await pool.query(
      `UPDATE wf_definitions SET name = 'Run Assessment'
       WHERE name = 'On Purchase — Run Monitoring Package'`
    );
    await pool.query(
      `DELETE FROM wf_triggers
       WHERE definition_id = (SELECT id FROM wf_definitions WHERE name = 'Run Assessment')
         AND type = 'event'
         AND config->>'eventName' = 'purchase.completed'`
    );

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

        // Patch v4: circuit breaker. Without this, a deterministically-failing
        // generation (e.g. AI/signal drift that can never self-resolve) retries
        // forever every time the client's stall-check fires — this is the root
        // cause of "the SOW just keeps regenerating and never finishes" reports.
        // Adds a fail_count column to the sql_query, tightens the retry branch
        // to require fail_count < 3, and adds an "exhausted" sub-branch that
        // notifies an admin instead of retrying once the budget is spent.
        // Guard: fires only when the old two-column SELECT (no fail_count) is
        // still present.
        await pool.query(
          `UPDATE wf_versions
              SET graph = jsonb_set(
                jsonb_set(
                  jsonb_set(
                    graph,
                    '{nodes}',
                    (
                      SELECT jsonb_agg(
                        CASE
                          WHEN node->'data'->>'actionType' = 'sql_query'
                          THEN jsonb_set(node, '{data,query}', $2::jsonb)
                          WHEN node->>'id' = 'branch'
                          THEN jsonb_set(node, '{data,expression}', $3::jsonb)
                          ELSE node
                        END
                      )
                      FROM jsonb_array_elements(graph->'nodes') AS node
                    )
                  ),
                  '{nodes}',
                  (graph->'nodes') || $4::jsonb
                ),
                '{edges}',
                (
                  SELECT jsonb_agg(
                    CASE
                      WHEN edge->>'source' = 'branch' AND edge->>'sourceHandle' = 'false'
                      THEN jsonb_build_object('id', 'e4', 'source', 'branch', 'target', 'exhausted', 'sourceHandle', 'false')
                      ELSE edge
                    END
                  ) || $5::jsonb
                  FROM jsonb_array_elements(graph->'edges') AS edge
                )
              )
           WHERE definition_id = $1
             AND NOT graph->'nodes' @> '[{"id":"exhausted"}]'`,
          [
            defId,
            JSON.stringify(
              "SELECT latest.status, EXTRACT(EPOCH FROM (NOW() - latest.created_at)) * 1000 AS age_ms, (SELECT COUNT(*) FROM insights_generated_documents f WHERE f.project_id = {{projectId}} AND f.doc_type = 'consolidated_sow' AND f.status = 'failed' AND f.created_at > NOW() - INTERVAL '60 minutes') AS fail_count FROM insights_generated_documents latest WHERE latest.project_id = {{projectId}} AND latest.doc_type = 'consolidated_sow' ORDER BY latest.created_at DESC LIMIT 1",
            ),
            JSON.stringify("(status != 'generating' || age_ms > 300000) && fail_count < 3"),
            JSON.stringify([
              {
                id: "exhausted",
                type: "condition",
                position: { x: 480, y: 330 },
                data: { nodeType: "condition", label: "Retry Budget Exhausted?", expression: "fail_count >= 3" },
              },
              {
                id: "notify_exhausted",
                type: "create_notification",
                position: { x: 620, y: 470 },
                data: {
                  nodeType: "create_notification",
                  label: "Notify: SOW Auto-Retry Exhausted",
                  title: "Consolidated SOW generation stuck (project {{projectId}})",
                  body: "Automatic retries were stopped after 3 consecutive failures in the last hour. Investigate and regenerate manually from the Insights & Outputs admin panel.",
                  type: "general",
                },
              },
              {
                id: "end_exhausted",
                type: "end",
                position: { x: 620, y: 610 },
                data: { nodeType: "end", label: "Retry budget exhausted — admin notified" },
              },
            ]),
            JSON.stringify([
              { id: "e8", source: "exhausted", target: "notify_exhausted", sourceHandle: "true" },
              { id: "e9", source: "exhausted", target: "end_active", sourceHandle: "false" },
              { id: "e10", source: "notify_exhausted", target: "end_exhausted" },
            ]),
          ],
        );
        logger.info({ defId }, "seed-system-workflows: patched SOW Auto-Retry — added fail-count circuit breaker");
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
      } else if (seed.name === "Presentation Phase Generator") {
        // Patch v1: replace deprecated system_action nodes with composable sql_query nodes.
        // Guard: fires when the save node still carries type:"system_action".
        const savePhrasesQuery = "WITH raw AS (SELECT gen_random_uuid()::text AS id, COALESCE(elem->>'title','Phase') AS title, COALESCE(elem->>'description','') AS descr, COALESCE(elem->'subtasks','[]'::jsonb) AS subtasks, COALESCE((elem->>'priceWeight')::numeric, 1.0/GREATEST(jsonb_array_length($2::jsonb),1)) AS wt, ordinality AS rn FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS t(elem, ordinality)), total AS (SELECT GREATEST(SUM(wt),0.0001) AS s FROM raw), priced AS (SELECT id, title, descr, subtasks, rn, ROUND($3::numeric * wt / (SELECT s FROM total), 2) AS price FROM raw), upd AS (UPDATE quick_win_presentations SET sow_phases=(SELECT jsonb_agg(jsonb_build_object('id',id,'title',title,'description',descr,'price',price,'selected',true,'subtasks',subtasks) ORDER BY rn) FROM priced), selected_phase_ids=(SELECT jsonb_agg(id ORDER BY rn) FROM priced), updated_at=NOW() WHERE id=$4::int RETURNING id) SELECT (SELECT COUNT(*)::int FROM priced) AS phase_count";
        const saveTitleQuery = "UPDATE quick_win_presentations SET project_title=$1, updated_at=NOW() WHERE id=$2::int RETURNING project_title AS \"projectTitle\"";
        await pool.query(
          `UPDATE wf_versions
              SET graph = jsonb_set(
                graph,
                '{nodes}',
                (
                  SELECT jsonb_agg(
                    CASE
                      WHEN node->>'id' = 'save' AND node->>'type' = 'system_action'
                      THEN jsonb_build_object(
                             'id', 'save', 'type', 'sql_query',
                             'position', node->'position',
                             'data', jsonb_build_object(
                               'nodeType', 'sql_query', 'label', 'Save Phases',
                               'query', $2::text,
                               'params', $3::jsonb
                             ))
                      WHEN node->>'id' = 'save_title' AND node->>'type' = 'system_action'
                      THEN jsonb_build_object(
                             'id', 'save_title', 'type', 'sql_query',
                             'position', node->'position',
                             'data', jsonb_build_object(
                               'nodeType', 'sql_query', 'label', 'Save Project Title',
                               'query', $4::text,
                               'params', $5::jsonb
                             ))
                      ELSE node
                    END
                  )
                  FROM jsonb_array_elements(graph->'nodes') AS node
                )
              )
           WHERE definition_id = $1
             AND graph->'nodes' @> '[{"id":"save","type":"system_action"}]'`,
          [
            defId,
            savePhrasesQuery,
            JSON.stringify(["{{value}}", "{{totalPrice}}", "{{presentationId}}"]),
            saveTitleQuery,
            JSON.stringify(["{{value.projectTitle}}", "{{presentationId}}"]),
          ],
        );
        logger.info({ defId }, "seed-system-workflows: patched Presentation Phase Generator — replaced system_action nodes with sql_query");
      } else if (seed.name === "__system__: Orphan Reconciliation") {
        // Patch v1: replace system_action node with reconcile_orphaned_runs typed node.
        // Guard: fires when the act node still uses type:"system_action".
        await pool.query(
          `UPDATE wf_versions
              SET graph = jsonb_set(
                graph,
                '{nodes}',
                (
                  SELECT jsonb_agg(
                    CASE
                      WHEN node->>'id' = 'act' AND node->>'type' = 'system_action'
                      THEN jsonb_build_object(
                             'id', 'act', 'type', 'reconcile_orphaned_runs',
                             'position', node->'position',
                             'data', jsonb_build_object(
                               'nodeType', 'reconcile_orphaned_runs',
                               'label', 'Reconcile Orphaned Runs',
                               'task', 'reconcile_orphaned_runs'
                             ))
                      ELSE node
                    END
                  )
                  FROM jsonb_array_elements(graph->'nodes') AS node
                )
              )
           WHERE definition_id = $1
             AND graph->'nodes' @> '[{"id":"act","type":"system_action"}]'`,
          [defId],
        );
        logger.info({ defId }, "seed-system-workflows: patched Orphan Reconciliation — replaced system_action with reconcile_orphaned_runs");
      } else if (seed.name === "__system__: Late Auto-Fire Reconciliation") {
        // Patch v1: replace system_action node with reconcile_orphaned_runs typed node (task: reconcile_late_stuck_queued).
        await pool.query(
          `UPDATE wf_versions
              SET graph = jsonb_set(
                graph,
                '{nodes}',
                (
                  SELECT jsonb_agg(
                    CASE
                      WHEN node->>'id' = 'act' AND node->>'type' = 'system_action'
                      THEN jsonb_build_object(
                             'id', 'act', 'type', 'reconcile_orphaned_runs',
                             'position', node->'position',
                             'data', jsonb_build_object(
                               'nodeType', 'reconcile_orphaned_runs',
                               'label', 'Reconcile Late Stuck-Queued',
                               'task', 'reconcile_late_stuck_queued'
                             ))
                      ELSE node
                    END
                  )
                  FROM jsonb_array_elements(graph->'nodes') AS node
                )
              )
           WHERE definition_id = $1
             AND graph->'nodes' @> '[{"id":"act","type":"system_action"}]'`,
          [defId],
        );
        logger.info({ defId }, "seed-system-workflows: patched Late Auto-Fire Reconciliation — replaced system_action with reconcile_orphaned_runs");
      } else if (seed.name === "__system__: Workflow Cleanup") {
        // Patch v1: replace system_action node with sql_query DELETE and replace edges.
        // Guard: fires when the act node still uses type:"system_action".
        await pool.query(
          `UPDATE wf_versions
              SET graph = $2::jsonb
           WHERE definition_id = $1
             AND version_number = 1
             AND graph->'nodes' @> '[{"id":"act","type":"system_action"}]'`,
          [defId, JSON.stringify(seed.graph)],
        );
        logger.info({ defId }, "seed-system-workflows: patched Workflow Cleanup — replaced system_action with sql_query");
      } else if (seed.name === "__system__: Escalation Check") {
        // Patch v1: replace single system_action node with sql_query + condition + create_notification graph.
        // Guard: fires when the act node still uses type:"system_action".
        await pool.query(
          `UPDATE wf_versions
              SET graph = $2::jsonb
           WHERE definition_id = $1
             AND version_number = 1
             AND graph->'nodes' @> '[{"id":"act","type":"system_action"}]'`,
          [defId, JSON.stringify(seed.graph)],
        );
        logger.info({ defId }, "seed-system-workflows: patched Escalation Check — replaced system_action with composable sql_query + condition + notification graph");
      } else if (seed.name === "__system__: Monthly Insights") {
        // Patch v1: replace single system_action node with fix_stale + claim sql_queries + condition + notification graph.
        // Guard: fires when the act node still uses type:"system_action".
        await pool.query(
          `UPDATE wf_versions
              SET graph = $2::jsonb
           WHERE definition_id = $1
             AND version_number = 1
             AND graph->'nodes' @> '[{"id":"act","type":"system_action"}]'`,
          [defId, JSON.stringify(seed.graph)],
        );
        logger.info({ defId }, "seed-system-workflows: patched Monthly Insights — replaced system_action with sql_query + condition + notification graph");
      } else if (seed.name === "__system__: Kanban Auto-fire") {
        // Patch v1: replace single system_action node with condition + monitor_execute_package graph.
        // Guard: fires when the act node still uses type:"system_action".
        await pool.query(
          `UPDATE wf_versions
              SET graph = $2::jsonb
           WHERE definition_id = $1
             AND version_number = 1
             AND graph->'nodes' @> '[{"id":"act","type":"system_action"}]'`,
          [defId, JSON.stringify(seed.graph)],
        );
        logger.info({ defId }, "seed-system-workflows: patched Kanban Auto-fire — replaced system_action with condition + kanban_auto_fire");
        // Patch v2: rename monitor_execute_package execute node → kanban_auto_fire (type collision fix).
        // Guard: fires only when execute node still has the old type name.
        await pool.query(
          `UPDATE wf_versions
              SET graph = $2::jsonb
           WHERE definition_id = $1
             AND version_number = 1
             AND graph->'nodes' @> '[{"id":"execute","type":"monitor_execute_package"}]'`,
          [defId, JSON.stringify(seed.graph)],
        );
        logger.info({ defId }, "seed-system-workflows: patched Kanban Auto-fire v2 — renamed execute node type monitor_execute_package → kanban_auto_fire");
      } else if (seed.name === "MSP Dunning State Machine") {
        // Patch v1: replace system_action node with msp_dunning_advance typed node.
        // Guard: fires when the dunning node still uses type:"system_action".
        await pool.query(
          `UPDATE wf_versions
              SET graph = $2::jsonb
           WHERE definition_id = $1
             AND version_number = 1
             AND graph->'nodes' @> '[{"id":"dunning","type":"system_action"}]'`,
          [defId, JSON.stringify(seed.graph)],
        );
        logger.info({ defId }, "seed-system-workflows: patched MSP Dunning State Machine — replaced system_action with msp_dunning_advance");
      } else if (seed.name === "MSP Overage Metering") {
        // Patch v1: replace system_action node with msp_overage_meter typed node.
        // Guard: fires when the meter node still uses type:"system_action".
        await pool.query(
          `UPDATE wf_versions
              SET graph = $2::jsonb
           WHERE definition_id = $1
             AND version_number = 1
             AND graph->'nodes' @> '[{"id":"meter","type":"system_action"}]'`,
          [defId, JSON.stringify(seed.graph)],
        );
        logger.info({ defId }, "seed-system-workflows: patched MSP Overage Metering — replaced system_action with msp_overage_meter");
      } else if (seed.name === "Run Assessment") {
        // Patch v1: upgrade graphs seeded without monitor_get_package (find_object → execute_pkg directly).
        // Guard: fires when execute_pkg node takes its packageKey from resolve_pkg (not get_pkg),
        // meaning monitor_get_package was absent in that version.
        await pool.query(
          `UPDATE wf_versions
              SET graph = $2::jsonb
           WHERE definition_id = $1
             AND version_number = 1
             AND graph->'nodes' @> '[{"id":"execute_pkg","data":{"packageKey":"{{steps.resolve_pkg.packageKey}}"}}]'`,
          [defId, JSON.stringify(seed.graph)],
        );
        logger.info({ defId }, "seed-system-workflows: patched On Purchase — added monitor_get_package between find_object and monitor_execute_package");
        // Patch v2: remove the purchase.completed trigger — document generation now lives in its
        // own workflow ("On Purchase — Generate Engagement Documents"), gated on actual payment.
        // This workflow should only run on consent.granted (telemetry, pre-payment).
        // Guard: only deletes if a purchase.completed trigger still exists for this definition —
        // safe to re-run, no-ops once already removed.
        const purchaseTriggerDeleted = await pool.query(
          `DELETE FROM wf_triggers
            WHERE definition_id = $1
              AND type = 'event'
              AND config->>'eventName' = 'purchase.completed'`,
          [defId],
        );
        if ((purchaseTriggerDeleted.rowCount ?? 0) > 0) {
          logger.info({ defId }, "seed-system-workflows: removed purchase.completed trigger from On Purchase — Run Monitoring Package (now consent.granted-only)");
        }
      } else if (seed.name === "__system__: Live Activity Monitor") {
        // Patch v2: fix the dead /delivery/engines/msp linkPath placeholder (Bug #1) and
        // add a real send_alert_email node so critical alerts are also emailed, not just
        // written to the in-app bell. Guard: fires when the old dead linkPath is still present.
        await pool.query(
          `UPDATE wf_versions
              SET graph = $2::jsonb
           WHERE definition_id = $1
             AND version_number = 1
             AND graph->'nodes' @> '[{"id":"notify","data":{"linkPath":"/delivery/engines/msp"}}]'`,
          [defId, JSON.stringify(seed.graph)],
        );
        logger.info({ defId }, "seed-system-workflows: patched Live Activity Monitor — fixed dead linkPath, added send_alert_email node");
      }

      // 3. Ensure trigger exists (skip if any trigger already present for this def)
      const existingTrigger = await pool.query<{ id: number }>(
        `SELECT id FROM wf_triggers WHERE definition_id = $1 LIMIT 1`,
        [defId],
      );

      if (existingTrigger.rowCount === 0) {
        if (seed.triggerType === "event" && (seed.eventNames?.length || seed.eventName)) {
          // Explicit event trigger(s). eventNames (array) takes precedence over eventName.
          const enabled = seed.triggerEnabled !== false;
          const names = seed.eventNames?.length ? seed.eventNames : [seed.eventName!];
          for (const evName of names) {
            await pool.query(
              `INSERT INTO wf_triggers (definition_id, type, config, enabled)
               VALUES ($1, 'event', $2::jsonb, $3)`,
              [defId, JSON.stringify({ eventName: evName }), enabled],
            );
          }
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
