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
const log = logger.child({ channel: "workflow.run" });
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
  allowManualTrigger?: boolean;
  /** Schedule triggers only: per-record fan-out over a SELECT (see triggerScheduledWorkflows). */
  fanOutMode?: "per_record" | "batched";
  fanOutQuery?: string;
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
        { id: "e1", source: "start", target: "gate" },
        { id: "e2", source: "gate", target: "charge", sourceHandle: "approved" },
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
        { id: "e1", source: "start", target: "find_client" },
        { id: "e2", source: "find_client", target: "resolve_pkg" },
        { id: "e3", source: "resolve_pkg", target: "get_pkg" },
        { id: "e4", source: "get_pkg", target: "execute_pkg" },
        { id: "e5", source: "execute_pkg", target: "branch" },
        { id: "e6", source: "branch", target: "notify_ok", sourceHandle: "true" },
        { id: "e7", source: "branch", target: "notify_fail", sourceHandle: "false" },
        { id: "e8", source: "notify_ok", target: "end" },
        { id: "e9", source: "notify_fail", target: "end" },
      ],
    },
  },
  // ── Weekly Retargeting Rescan — Free/Assessment Tenants (#166, sub-issue of #161) ──
  {
    name: "__system__: Weekly Retargeting Rescan — Free/Assessment Tenants",
    description:
      "Weekly schedule-triggered rescan for Free/Assessment-tier tenants (mspRole), so " +
      "retargeting/upgrade messaging always has fresh telemetry instead of a stale " +
      "one-time snapshot from consent time. Per-record fan-out: the trigger's " +
      "fan_out_query selects every active users row with mspRole IN ('Free','Assessment') " +
      "whose tenant's Graph consent is still 'granted' (not revoked/pending/declined), and " +
      "fires one run per row carrying clientId (users.id), tenantId (Azure AD tenant GUID), " +
      "and packageKey. packageKey is the same 'core:security-baseline' fallback the " +
      "consent.granted path (consent.ts) already uses when a Free/Assessment order carries " +
      "no product-specific package — deliberately not a per-product lookup, since this " +
      "workflow's only job is to keep baseline telemetry fresh, not re-run whatever paid " +
      "package a customer once purchased. " +
      "Graph is a verbatim copy of 'Run Assessment' (find_object → find_object → " +
      "monitor_get_package → monitor_execute_package) — reuses the exact same full-scan " +
      "node, no new scan logic, just the schedule + tenant filter wrapped around it. " +
      "Explicitly NOT a Monitoring subscription — does not touch msp_subscriptions or any " +
      "billing/monitoring_tier config; this is a pure Workflow Engine definition.",
    triggerType: "schedule",
    cron: "0 3 * * 1", // Every Monday at 03:00 server time
    triggerEnabled: true,
    fanOutMode: "per_record",
    fanOutQuery:
      "SELECT u.id AS \"clientId\", t.tenant_id AS \"tenantId\", " +
      "COALESCE(s.type_attributes->>'packageKey', 'core:security-baseline') AS \"packageKey\" " +
      "FROM users u " +
      "JOIN tenants t ON t.id = u.tenant_id " +
      "LEFT JOIN client_services cs ON cs.client_user_id = u.id AND cs.status = 'active' " +
      "LEFT JOIN services s ON s.id = cs.service_id " +
      "WHERE u.msp_role IN ('Free', 'Assessment') AND u.is_active = true " +
      "AND t.consent->'graph'->>'status' = 'granted'",
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 60 },
          data: { nodeType: "start", label: "Weekly Schedule (Free/Assessment fan-out)" },
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
            label: "Rescan Complete",
            title: "Weekly retargeting rescan executed successfully",
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
            label: "Rescan Issues",
            title: "Weekly retargeting rescan completed with issues",
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
        { id: "e1", source: "start", target: "find_client" },
        { id: "e2", source: "find_client", target: "resolve_pkg" },
        { id: "e3", source: "resolve_pkg", target: "get_pkg" },
        { id: "e4", source: "get_pkg", target: "execute_pkg" },
        { id: "e5", source: "execute_pkg", target: "branch" },
        { id: "e6", source: "branch", target: "notify_ok", sourceHandle: "true" },
        { id: "e7", source: "branch", target: "notify_fail", sourceHandle: "false" },
        { id: "e8", source: "notify_ok", target: "end" },
        { id: "e9", source: "notify_fail", target: "end" },
      ],
    },
  },
  // ── Weekly Copilot Assessment Rescan — Assessment-tier Tenants (Git #1058, part of #454) ──
  {
    name: "__system__: Weekly Copilot Assessment Rescan",
    description:
      "Weekly schedule-triggered rescan for Assessment-tier (paid) customers only, so the " +
      "assessment dashboard can eventually show real score drift over time instead of a " +
      "single stale snapshot from purchase time. Reuses the exact same monitor_execute_package " +
      "scan engine runDiagnostics() calls internally (diagnostics-runner.ts -> monitor-executor.ts) " +
      "— no new scan logic, no new backend engine, just the schedule + tenant filter wrapped " +
      "around it, same discipline as 'Weekly Retargeting Rescan' below (which this is cloned " +
      "from and does NOT modify). Per-record fan-out: the trigger's fan_out_query resolves each " +
      "Assessment-tier customer's REAL purchased package by joining client_services -> services " +
      "on the active purchase (type_attributes->>'packageKey'), falling back to " +
      "'core:security-baseline' only when no active purchase resolves. Sunday 03:00 schedule, " +
      "distinct from the retargeting workflow's Monday slot, and scoped to mspRole = 'Assessment' " +
      "only (not 'Free') since this is paid-tier drift-tracking, not a pre-purchase nurture rescan. " +
      "Deliberately passive: no remediation work, no alerting beyond the standard rescan-complete " +
      "notification, and does NOT touch msp_subscriptions or any billing/monitoring_tier config — " +
      "this is a pure Workflow Engine definition.",
    triggerType: "schedule",
    cron: "0 3 * * 0", // Every Sunday at 03:00 server time
    triggerEnabled: true,
    fanOutMode: "per_record",
    fanOutQuery:
      "SELECT u.id AS \"clientId\", t.tenant_id AS \"tenantId\", " +
      "COALESCE(s.type_attributes->>'packageKey', 'core:security-baseline') AS \"packageKey\" " +
      "FROM users u " +
      "JOIN tenants t ON t.id = u.tenant_id " +
      "LEFT JOIN client_services cs ON cs.client_user_id = u.id AND cs.status = 'active' " +
      "LEFT JOIN services s ON s.id = cs.service_id " +
      "WHERE u.msp_role = 'Assessment' AND u.is_active = true " +
      "AND t.consent->'graph'->>'status' = 'granted'",
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 60 },
          data: { nodeType: "start", label: "Weekly Schedule (Assessment-tier fan-out)" },
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
            label: "Rescan Complete",
            title: "Weekly Copilot Assessment rescan complete",
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
            label: "Rescan Issues",
            title: "Weekly Copilot Assessment rescan completed with issues",
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
        { id: "e1", source: "start", target: "find_client" },
        { id: "e2", source: "find_client", target: "resolve_pkg" },
        { id: "e3", source: "resolve_pkg", target: "get_pkg" },
        { id: "e4", source: "get_pkg", target: "execute_pkg" },
        { id: "e5", source: "execute_pkg", target: "branch" },
        { id: "e6", source: "branch", target: "notify_ok", sourceHandle: "true" },
        { id: "e7", source: "branch", target: "notify_fail", sourceHandle: "false" },
        { id: "e8", source: "notify_ok", target: "end" },
        { id: "e9", source: "notify_fail", target: "end" },
      ],
    },
  },
  // ── Daily Monitoring Rescan — Paid Foundation/Growth/Premier Subscribers (Git #1163, #1127-B2) ──
  {
    name: "__system__: Daily Monitoring Rescan — Paid Subscribers",
    description:
      "Daily schedule-triggered rescan for PAYING monitoring subscribers, so a purchased " +
      "Foundation/Growth/Premier tier actually delivers the recurring cadence the marketing site " +
      "advertises ('runs daily'; the daily end of the 'hourly-daily' band — every monitor_checks " +
      "row is frequency='daily' bar one). This closes #1127-B2 / #1163 Item 2: before this, a paid " +
      "monitoring tier fired only the single on-purchase run (consent.granted -> 'Run Assessment') " +
      "and then never rescanned — the two weekly rescans below cover Free/Assessment nurture tenants " +
      "ONLY (by mspRole), never paid subscribers. " +
      "Per-record fan-out: the trigger's fan_out_query resolves every ACTIVE monitoring purchase " +
      "directly from client_services -> services (service_type='monitoring_tier'), whose graph " +
      "consent is still 'granted', and fires one run per subscription carrying clientId " +
      "(client_services.client_user_id), tenantId (Azure AD tenant GUID), and the subscription's " +
      "REAL purchased packageKey (type_attributes->>'packageKey' — core:foundation/core:growth/" +
      "core:premier post-#1163; core:foundation is a safe fallback, never core:security-baseline, " +
      "since a real monitoring_tier row always carries a packageKey). All three tiers run daily: the " +
      "package the subscriber bought is exactly what reruns, so the nested check set (30/133/137) is " +
      "already tier-correct without a per-tier cadence branch. " +
      "Graph is a verbatim copy of 'Run Assessment' / the weekly rescans (find_object -> find_object " +
      "-> monitor_get_package -> monitor_execute_package) — reuses the exact same full-scan node, no " +
      "new scan logic, just the daily schedule + paid-subscriber filter wrapped around it. Explicitly " +
      "does NOT touch msp_subscriptions or any billing/monitoring_tier config; this is a pure Workflow " +
      "Engine definition. (Active paid monitoring subscribers = 0 at ship time — the #1127-B1 " +
      "purchase-provisioning gap is a separate issue — so this is zero-impact today and correctly " +
      "wired for when subscriptions exist.)",
    triggerType: "schedule",
    cron: "30 3 * * *", // Every day at 03:30 server time (after the Sun/Mon 03:00 weekly nurture rescans)
    triggerEnabled: true,
    fanOutMode: "per_record",
    fanOutQuery:
      "SELECT cs.client_user_id AS \"clientId\", t.tenant_id AS \"tenantId\", " +
      "COALESCE(s.type_attributes->>'packageKey', 'core:foundation') AS \"packageKey\" " +
      "FROM client_services cs " +
      "JOIN services s ON s.id = cs.service_id AND s.service_type = 'monitoring_tier' " +
      "JOIN users u ON u.id = cs.client_user_id " +
      "JOIN tenants t ON t.id = u.tenant_id " +
      "WHERE cs.status = 'active' AND u.is_active = true " +
      "AND t.consent->'graph'->>'status' = 'granted'",
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 60 },
          data: { nodeType: "start", label: "Daily Schedule (paid-subscriber fan-out)" },
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
            label: "Rescan Complete",
            title: "Daily monitoring rescan executed successfully",
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
            label: "Rescan Issues",
            title: "Daily monitoring rescan completed with issues",
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
        { id: "e1", source: "start", target: "find_client" },
        { id: "e2", source: "find_client", target: "resolve_pkg" },
        { id: "e3", source: "resolve_pkg", target: "get_pkg" },
        { id: "e4", source: "get_pkg", target: "execute_pkg" },
        { id: "e5", source: "execute_pkg", target: "branch" },
        { id: "e6", source: "branch", target: "notify_ok", sourceHandle: "true" },
        { id: "e7", source: "branch", target: "notify_fail", sourceHandle: "false" },
        { id: "e8", source: "notify_ok", target: "end" },
        { id: "e9", source: "notify_fail", target: "end" },
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
        { id: "e1", source: "start", target: "get_signals" },
        { id: "e2", source: "get_signals", target: "gen_sow" },
        { id: "e3", source: "gen_sow", target: "notify_ok" },
        { id: "e4", source: "gen_sow", target: "notify_fail", sourceHandle: "onError" },
        { id: "e5", source: "notify_ok", target: "end_ok" },
        { id: "e6", source: "notify_fail", target: "end_fail" },
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
        { id: "e1", source: "start", target: "emit1" },
        { id: "e2", source: "emit1", target: "ask" },
        { id: "e3", source: "ask", target: "emit2" },
        { id: "e4", source: "emit2", target: "comp" },
        { id: "e5", source: "comp", target: "emit3" },
        { id: "e6", source: "emit3", target: "save" },
        { id: "e7", source: "save", target: "ask_title" },
        { id: "e8", source: "ask_title", target: "comp_title" },
        { id: "e9", source: "comp_title", target: "save_title" },
        { id: "e10", source: "save_title", target: "emit4" },
        { id: "e11", source: "emit4", target: "end" },
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
        { id: "e2", source: "gen", target: "pub" },
        { id: "e3", source: "pub", target: "end" },
      ],
    },
  },
  {
    name: "Generate Campaign from Current Events",
    description:
      "Checks daily for a hot Microsoft 365 / cloud news story and, when one clears the hot-score " +
      "threshold, auto-builds a draft marketing campaign from it. Uses fetch_news_headlines with " +
      "autoBuildCampaign enabled — that node fetches real headlines (NewsAPI, RSS fallback), asks " +
      "Claude to pick the hottest story and write a campaign brief, and inserts the campaigns row " +
      "itself when isHot is true. The notHot branch is intentionally left unwired — a quiet day " +
      "produces no campaign and no noise. Edit the topics/hotScoreThreshold on the Fetch News " +
      "Headlines node to tune what counts as newsworthy.",
    triggerType: "schedule",
    cron: "0 7 * * *",
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 80 },
          data: { nodeType: "start", label: "Every Day 07:00 UTC" },
        },
        {
          id: "fetch_news",
          type: "fetch_news_headlines",
          position: { x: 300, y: 220 },
          data: {
            nodeType: "fetch_news_headlines",
            label: "Fetch News Headlines",
            topics: "Microsoft 365, Copilot AI, SharePoint, Power Platform, Azure, Microsoft Viva, Project Online",
            maxResults: 10,
            hotScoreThreshold: 60,
            autoBuildCampaign: true,
          },
        },
        {
          id: "log_confirm",
          type: "report_progress",
          position: { x: 300, y: 360 },
          data: {
            nodeType: "report_progress",
            label: "Log Campaign Created",
            message: "Auto-built campaign {{campaignId}} from hot news story \"{{newsTopic}}\" (hotScore {{hotScore}}).",
          },
        },
        {
          id: "end",
          type: "end",
          position: { x: 300, y: 500 },
          data: { nodeType: "end", label: "Done" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "fetch_news" },
        { id: "e2", source: "fetch_news", target: "log_confirm", sourceHandle: "hot" },
        { id: "e3", source: "log_confirm", target: "end" },
      ],
    },
  },
  {
    name: "__system__: Alert Rule Evaluation",
    description: "Runs every 5 minutes to evaluate platform alert rules (DLQ backlog, billing failures, SLA breaches, event bus backlog, job failure rate, overdue risk-acceptance reviews — #1513) and deliver alerts via Exchange Online email and browser push. Replaces the old alert-engine.ts setInterval poller.",
    triggerType: "schedule",
    cron: "*/5 * * * *",
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Cron */5 min" } },
        { id: "act", type: "alert_evaluate_rules", position: { x: 100, y: 230 }, data: { nodeType: "alert_evaluate_rules", label: "Evaluate Alert Rules" } },
        { id: "end", type: "end", position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "act" },
        { id: "e2", source: "act", target: "end" },
      ],
    },
  },
  // ── Policy Engine — Continuous Evaluation (Git #1549) ─────────────────────
  //
  // Two seeded workflows, ONE node type (policy_evaluate_due,
  // policy-engine-nodes.ts) — #1549's SETTLED "two triggers" requirement, as a
  // visible Workflow Engine node rather than a bare scheduler. The schedule
  // workflow is the DIVERGENCE trigger (an existing VIP removed from a group by
  // hand, caught on evaluation): it carries no payload, so the node sweeps
  // every active standing policy across every opted-in tenant. The event
  // workflow is the EVENT trigger: msp-standing-policies.ts calls
  // fireWorkflowsForEvent("policy.standing_policy.activated", { customerId })
  // when a new policy is authored active, so that ONE tenant is evaluated
  // immediately rather than waiting for the next hourly sweep. Both gate on
  // tenants.policy_engine_opt_in (default OFF) inside the node itself — see
  // policy-engine-evaluator.ts for the honest not_evaluable/skipped_not_opted_in
  // outcomes this records (#1548 enactment and #1553 finding-generation are
  // separate, not-yet-built issues; this loop only detects and records).
  {
    name: "__system__: Policy Engine — Continuous Evaluation",
    description:
      "Hourly reconciliation sweep (matching the established monitoring-cadence convention, #1163) " +
      "over every active standing policy across every tenant that has opted in to the Policy Engine. " +
      "This is the 'not an onboarding-only trigger' half of #1549 — the DIVERGENCE trigger that catches " +
      "drift introduced by hand between events. Records one policy_evaluation_runs row per policy " +
      "considered via the policy_evaluate_due node; does not execute an SOP (#1548) or write a finding " +
      "(#1553).",
    triggerType: "schedule",
    cron: "0 * * * *", // Hourly
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Cron hourly" } },
        { id: "evaluate", type: "policy_evaluate_due", position: { x: 100, y: 230 }, data: { nodeType: "policy_evaluate_due", label: "Evaluate Due Standing Policies (all tenants)" } },
        { id: "end", type: "end", position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "evaluate" },
        { id: "e2", source: "evaluate", target: "end" },
      ],
    },
  },
  {
    name: "__system__: Policy Engine — Evaluate on Policy Change",
    description:
      "The EVENT half of #1549's two triggers: fires immediately when a standing policy is authored " +
      "active (policy.standing_policy.activated, dispatched by msp-standing-policies.ts via " +
      "fireWorkflowsForEvent), scoping the same policy_evaluate_due node to just that one tenant " +
      "(payload.customerId) instead of waiting for the next hourly sweep.",
    triggerType: "event",
    eventNames: ["policy.standing_policy.activated"],
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "policy.standing_policy.activated" } },
        { id: "evaluate", type: "policy_evaluate_due", position: { x: 100, y: 230 }, data: { nodeType: "policy_evaluate_due", label: "Evaluate Due Standing Policies (this tenant)" } },
        { id: "end", type: "end", position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "evaluate" },
        { id: "e2", source: "evaluate", target: "end" },
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
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Cron 03:00" } },
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
        { id: "end", type: "end", position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "cleanup" },
        { id: "e2", source: "cleanup", target: "end" },
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
        { id: "end", type: "end", position: { x: 100, y: 620 }, data: { nodeType: "end", label: "Done" } },
        { id: "end_skip", type: "end", position: { x: 250, y: 360 }, data: { nodeType: "end", label: "No escalations" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "check" },
        { id: "e2", source: "check", target: "branch" },
        { id: "e3", source: "branch", target: "notify", sourceHandle: "true" },
        { id: "e4", source: "branch", target: "end_skip", sourceHandle: "false" },
        { id: "e5", source: "notify", target: "end" },
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
        { id: "end", type: "end", position: { x: 100, y: 750 }, data: { nodeType: "end", label: "Done" } },
        { id: "end_skip", type: "end", position: { x: 250, y: 490 }, data: { nodeType: "end", label: "Nothing due" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "fix_stale" },
        { id: "e2", source: "fix_stale", target: "claim" },
        { id: "e3", source: "claim", target: "branch" },
        { id: "e4", source: "branch", target: "notify", sourceHandle: "true" },
        { id: "e5", source: "branch", target: "end_skip", sourceHandle: "false" },
        { id: "e6", source: "notify", target: "end" },
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
        { id: "e1", source: "start", target: "check" },
        { id: "e2", source: "check", target: "branch" },
        { id: "e3", source: "branch", target: "generate", sourceHandle: "true" },
        { id: "e4", source: "branch", target: "exhausted", sourceHandle: "false" },
        { id: "e8", source: "exhausted", target: "notify_exhausted", sourceHandle: "true" },
        { id: "e9", source: "exhausted", target: "end_active", sourceHandle: "false" },
        { id: "e10", source: "notify_exhausted", target: "end_exhausted" },
        { id: "e5", source: "generate", target: "calc_pricing" },
        { id: "e7", source: "calc_pricing", target: "emit" },
        { id: "e6", source: "emit", target: "end_retried" },
      ],
    },
  },
  {
    // Git #613: `agreement_signed` is never actually fired anywhere in the
    // backend (confirmed by grep — only referenced in admin-panel display/
    // category lists) — this trigger has been dead since it was written. Left
    // in place as historical record per this project's "don't clean up other
    // sessions'/history's stale rows" convention, but its `create` node's
    // fields are kept in sync with `create_phased_invoices`'s real current
    // contract (checkoutSessionId, not the old projectId/quick_win_presentations
    // shape) so the admin Workflow Builder doesn't show a node whose saved
    // data no longer matches its own node-type definition. The real, live
    // v1.1 trigger is the separate manual workflow below.
    name: "Agreement Signed: Phased Invoice Setup",
    description: "[Legacy/unreachable — agreement_signed is never fired] Historical event-triggered graph for the old projectId/quick_win_presentations phased-invoicing path. Superseded by the manual 'Pay-by-Phase: Generate Remaining Invoices' workflow (Git #613), which fires off the live checkout_sessions cart instead.",
    triggerType: "event",
    eventName: "agreement_signed",
    triggerEnabled: false,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 400, y: 50 }, data: { nodeType: "start", label: "agreement_signed" } },
        { id: "cond1", type: "condition", position: { x: 400, y: 190 }, data: { nodeType: "condition", label: "Is Phased Plan?", expression: "paymentPlan == 'phased'" } },
        { id: "create", type: "create_phased_invoices", position: { x: 200, y: 340 }, data: { nodeType: "create_phased_invoices", label: "Create Phased Invoices", checkoutSessionId: "{{checkoutSessionId}}" } },
        { id: "notify", type: "create_notification", position: { x: 200, y: 480 }, data: { nodeType: "create_notification", label: "Notify: Invoices Created", title: "Phase invoices created for {{clientName}}", body: "{{phaseCount}} draft Stripe invoices created (total {{totalScheduled}} cents).", type: "general" } },
        { id: "end1", type: "end", position: { x: 200, y: 620 }, data: { nodeType: "end", label: "Done" } },
        { id: "end2", type: "end", position: { x: 600, y: 340 }, data: { nodeType: "end", label: "Done (full plan — no action)" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "cond1" },
        { id: "e2", source: "cond1", target: "create", sourceHandle: "yes" },
        { id: "e3", source: "create", target: "notify" },
        { id: "e4", source: "notify", target: "end1" },
        { id: "e5", source: "cond1", target: "end2", sourceHandle: "no" },
      ],
    },
  },
  {
    // Git #613 (v1.1, split from #611 — the Zoho-webhook self-serve auto-fire
    // is #611's v1.2, explicitly out of scope here). Manual trigger only:
    // Shane fires this once, by hand, after confirming a checkout_sessions
    // row is a paid Pay-by-Phase signature (assessment_sow_agreements
    // paymentPlan="phased", status="paid") — see the
    // POST /api/admin/checkout-sessions/:id/create-phased-invoices route,
    // which resolves this exact workflow definition by name and fires it
    // with { checkoutSessionId } as the payload.
    name: "Pay-by-Phase: Generate Remaining Invoices",
    description: "Manual trigger (Git #613). Given a paid Pay-by-Phase checkout_sessions row, creates draft Stripe invoices for its remaining phases (2..N) — each phase's own full price, the final phase credited the deposit already collected at signing — and stores the deposit payment method as the customer default for future charges. Fire this once, by hand, after confirming the deposit + Phase 1 charge succeeded. Does NOT auto-charge anything (Zoho phase-completion auto-fire is Git #611, v1.2, deferred).",
    triggerType: "manual",
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 300, y: 60 }, data: { nodeType: "start", label: "Manual: Generate Phase 2+ Invoices" } },
        { id: "create", type: "create_phased_invoices", position: { x: 300, y: 200 }, data: { nodeType: "create_phased_invoices", label: "Create Phased Invoices", checkoutSessionId: "{{checkoutSessionId}}" } },
        { id: "notify", type: "create_notification", position: { x: 300, y: 340 }, data: { nodeType: "create_notification", label: "Notify: Invoices Created", title: "Phase invoices created", body: "{{phaseCount}} draft Stripe invoices created (total {{totalScheduled}} cents) for checkout session {{checkoutSessionId}}.", type: "general" } },
        { id: "end1", type: "end", position: { x: 300, y: 480 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "create" },
        { id: "e2", source: "create", target: "notify" },
        { id: "e3", source: "notify", target: "end1" },
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
          position: { x: 400, y: 50 },
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
          position: { x: 50, y: 640 },
          data: { nodeType: "edit_stripe_invoice", label: "Update Invoice Due Date", stripeInvoiceIdExpr: "{{stripeInvoiceId}}", dueDateExpr: "{{newDueDate}}", descriptionExpr: "", footerExpr: "" },
        },
        {
          id: "notify",
          type: "create_notification",
          position: { x: 50, y: 780 },
          data: { nodeType: "create_notification", label: "Notify: Due Date Synced", title: "Invoice due date updated for project {{projectId}}", body: "Stripe draft invoice {{stripeInvoiceId}} due date was shifted to {{newDueDate}} after the phase delivery date changed.", type: "general" },
        },
        {
          id: "end1",
          type: "end",
          position: { x: 50, y: 920 },
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
        { id: "e1", source: "start", target: "cond1" },
        { id: "e2", source: "cond1", target: "find", sourceHandle: "yes" },
        { id: "e3", source: "cond1", target: "end_not_phased", sourceHandle: "no" },
        { id: "e4", source: "find", target: "cond2" },
        { id: "e5", source: "cond2", target: "edit", sourceHandle: "yes" },
        { id: "e6", source: "cond2", target: "end_no_invoice", sourceHandle: "no" },
        { id: "e7", source: "edit", target: "notify" },
        { id: "e8", source: "notify", target: "end1" },
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
        { id: "start", type: "start", position: { x: 400, y: 50 }, data: { nodeType: "start", label: "phase_completed" } },
        { id: "cond1", type: "condition", position: { x: 400, y: 190 }, data: { nodeType: "condition", label: "Has Invoice & Phased Plan?", expression: "stripeInvoiceId && paymentPlan == 'phased'" } },
        { id: "charge", type: "charge_stripe_invoice", position: { x: 200, y: 340 }, data: { nodeType: "charge_stripe_invoice", label: "Charge Invoice", invoiceId: "{{stripeInvoiceId}}" } },
        { id: "cond2", type: "condition", position: { x: 200, y: 480 }, data: { nodeType: "condition", label: "Charge Succeeded?", expression: "chargeStatus == 'succeeded'" } },
        { id: "notifyOk", type: "create_notification", position: { x: 50, y: 630 }, data: { nodeType: "create_notification", label: "Notify: Charge Succeeded", title: "Phase payment collected: {{amountCharged}}", body: "Stripe auto-charge succeeded for phase invoice {{stripeInvoiceId}}. Payment intent: {{stripePaymentIntentId}}.", type: "general" } },
        { id: "end1", type: "end", position: { x: 50, y: 770 }, data: { nodeType: "end", label: "Done" } },
        { id: "notifyFail", type: "create_notification", position: { x: 380, y: 630 }, data: { nodeType: "create_notification", label: "Notify: Charge Failed", title: "⚠️ Phase charge failed for {{clientName}} — check Stripe", body: "Auto-charge failed for invoice {{stripeInvoiceId}} on project {{projectId}}. Log into Stripe to investigate and retry the payment.", type: "general" } },
        { id: "end2", type: "end", position: { x: 380, y: 770 }, data: { nodeType: "end", label: "Done" } },
        { id: "end3", type: "end", position: { x: 620, y: 340 }, data: { nodeType: "end", label: "Done (not applicable)" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "cond1" },
        { id: "e2", source: "cond1", target: "charge", sourceHandle: "yes" },
        { id: "e3", source: "charge", target: "cond2" },
        { id: "e4", source: "cond2", target: "notifyOk", sourceHandle: "yes" },
        { id: "e5", source: "notifyOk", target: "end1" },
        { id: "e6", source: "cond2", target: "notifyFail", sourceHandle: "no" },
        { id: "e7", source: "notifyFail", target: "end2" },
        { id: "e8", source: "cond1", target: "end3", sourceHandle: "no" },
      ],
    },
  },
  // ── Sales Offer Engine — auto-trigger on diagnostics completion ────────────
  {
    name: "__system__: Diagnostics Completion — Generate Sales Offers",
    description:
      "Triggered when a diagnostics run finishes (diagnostics-runner.ts, event diagnostics.run_completed). " +
      "Only acts when the run's graded evaluable-check coverage is sufficient (coverageSufficient == true, " +
      "computed by evaluateDocGateCoverage in doc-gate-coverage.ts — the same >=50% real-coverage bar as " +
      "assessment_doc_gate and the CIO narrative). A permanently-'partial' run with majority real signal " +
      "(e.g. two known unrunnable checks) still generates offers; a failed or near-dark run — too few " +
      "checks producing a real result to score candidates against — is skipped. Runs sales_offer_generate for " +
      "the completed customer, which scores fired signals against active rule groups and persists any new " +
      "candidates as draft sales_offers rows (persistSalesOfferCandidates also fires a per-offer customer " +
      "notification on insert). Offers land in state 'draft' and require an MSP operator to review and " +
      "send them (PATCH /api/sales-offers/:id/state) before they appear as 'sent' in the customer portal " +
      "or Mission Control's finding→offer feed — this workflow only generates candidates, it never sends.",
    triggerType: "event",
    eventNames: ["diagnostics.run_completed"],
    triggerEnabled: true,
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 60 },
          data: { nodeType: "start", label: "diagnostics.run_completed" },
        },
        {
          id: "branch",
          type: "condition",
          position: { x: 300, y: 200 },
          // Graded coverage gate (NOT literal finalStatus): diagnostics-runner
          // grades every finished run with evaluateDocGateCoverage and carries
          // the decision on the event payload as coverageSufficient. A 'partial'
          // run with >=50% real evaluable coverage passes; failed/near-dark runs
          // (and legacy payloads without the field) evaluate false and skip.
          data: { nodeType: "condition", label: "Coverage Sufficient?", expression: "coverageSufficient == true" },
        },
        {
          id: "generate",
          type: "sales_offer_generate",
          position: { x: 150, y: 340 },
          data: {
            nodeType: "sales_offer_generate",
            label: "Generate Sales Offer Candidates",
            tenantId: "{{customerId}}",
            mspId: "{{mspId}}",
          },
        },
        {
          id: "branch_found",
          type: "condition",
          position: { x: 150, y: 480 },
          data: { nodeType: "condition", label: "Any Candidates?", expression: "candidateCount > 0" },
        },
        {
          id: "notify",
          type: "create_notification",
          position: { x: 0, y: 620 },
          data: {
            nodeType: "create_notification",
            label: "Notify: Offer Candidates Generated",
            title: "New sales offer candidate(s) ready for review",
            body: "{{candidateCount}} offer candidate(s) generated from diagnostics run {{runId}} (customer {{customerId}}). Review and send from Sales Offers.",
            type: "general",
          },
        },
        { id: "end_notified", type: "end", position: { x: 0, y: 760 }, data: { nodeType: "end", label: "Done" } },
        { id: "end_none", type: "end", position: { x: 300, y: 620 }, data: { nodeType: "end", label: "No new candidates" } },
        { id: "end_skip", type: "end", position: { x: 450, y: 340 }, data: { nodeType: "end", label: "Coverage insufficient — skip" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "branch" },
        { id: "e2", source: "branch", target: "generate", sourceHandle: "true" },
        { id: "e3", source: "branch", target: "end_skip", sourceHandle: "false" },
        { id: "e4", source: "generate", target: "branch_found" },
        { id: "e5", source: "branch_found", target: "notify", sourceHandle: "true" },
        { id: "e6", source: "branch_found", target: "end_none", sourceHandle: "false" },
        { id: "e7", source: "notify", target: "end_notified" },
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
        { id: "e1", source: "start", target: "gen_sow" },
        { id: "e2", source: "gen_sow", target: "end_ok" },
        { id: "e3", source: "gen_sow", target: "refresh_profile", sourceHandle: "onError" },
        { id: "e4", source: "refresh_profile", target: "refresh_intel" },
        { id: "e5", source: "refresh_intel", target: "retry_sow" },
        { id: "e6", source: "retry_sow", target: "end_ok" },
        { id: "e7", source: "retry_sow", target: "notify_fail", sourceHandle: "onError" },
        { id: "e8", source: "notify_fail", target: "end_fail" },
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
SELECT json_agg(row_to_json(row)) AS "assignments"
FROM (
  SELECT
    tn.tenant_id             AS "tenantId",
    mc.key                   AS "checkKey",
    mc.label                 AS "label",
    mc.endpoint              AS "contentType",
    mc.mapping::text         AS "mapping",
    mc.severity_rules::text  AS "severityRules"
  FROM tenants tn
  CROSS JOIN monitor_checks mc
  WHERE tn.consent->'graph'->>'status' = 'granted'
    AND mc.frequency       = 'live'
    AND mc.status          = 'active'
  ORDER BY tn.tenant_id, mc.key
  LIMIT 500
) row
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
            tenantId: "{{assignment.tenantId}}",
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
            tenantId: "{{assignment.tenantId}}",
            contentType: "{{assignment.contentType}}",
            checkKey: "{{assignment.checkKey}}",
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
            body: "{{criticalCount}} critical audit event(s) found in the last cycle. Check Monitoring → Monitor Checks for details.",
            type: "alert",
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
        { id: "e1", source: "start", target: "get_assignments" },
        { id: "e2", source: "get_assignments", target: "loop" },
        // foreach body edges
        { id: "e3", source: "loop", target: "ensure_sub", sourceHandle: "body" },
        { id: "e4", source: "ensure_sub", target: "poll_activity" },
        // foreach done edge → post-loop check
        { id: "e5", source: "loop", target: "check_critical", sourceHandle: "done" },
        { id: "e6", source: "check_critical", target: "cond" },
        // condition branches
        { id: "e7", source: "cond", target: "emit_ev", sourceHandle: "yes" },
        { id: "e8", source: "cond", target: "end_noop", sourceHandle: "no" },
        // post-alert
        { id: "e9", source: "emit_ev", target: "notify" },
        { id: "e10", source: "notify", target: "send_alert_email" },
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
  {
    name: "__system__: Engine Score Retention & Rollup",
    description: "Runs nightly at 04:00 UTC. Compacts tenant_engine_snapshots rows older than 90 days into engine_score_daily_rollup (one row per customer/engine/day, preserving the day's final score and every distinct signal that changed that day), then deletes only the original rows already confirmed present in the rollup \u2014 never deletes anything that wasn't safely preserved first.",
    triggerType: "schedule",
    cron: "0 4 * * *",
    allowManualTrigger: false,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Cron 04:00" } },
        {
          id: "rollup",
          type: "sql_query",
          position: { x: 100, y: 230 },
          data: {
            nodeType: "sql_query",
            label: "Compact Into Daily Rollup",
            query: "WITH inserted AS (INSERT INTO engine_score_daily_rollup (customer_id, msp_id, engine_key, day, score, changed_signal_keys) SELECT s.customer_id, s.msp_id, s.engine_key, DATE(s.captured_at) AS day, (ARRAY_AGG(s.score ORDER BY s.captured_at DESC))[1] AS score, COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('signalKey', d.signal_key, 'direction', d.direction)) FROM engine_score_signal_deltas d JOIN tenant_engine_snapshots s2 ON s2.id = d.history_id WHERE s2.customer_id = s.customer_id AND s2.engine_key = s.engine_key AND DATE(s2.captured_at) = DATE(s.captured_at)), '[]'::jsonb) AS changed_signal_keys FROM tenant_engine_snapshots s WHERE s.captured_at < NOW() - INTERVAL '90 days' AND s.customer_id IS NOT NULL GROUP BY s.customer_id, s.msp_id, s.engine_key, DATE(s.captured_at) ON CONFLICT (customer_id, engine_key, day) DO NOTHING RETURNING 1) SELECT COUNT(*)::int AS rolled_up_count FROM inserted",
          },
        },
        {
          id: "purge",
          type: "sql_query",
          position: { x: 100, y: 360 },
          data: {
            nodeType: "sql_query",
            label: "Delete Rolled-Up Rows",
            query: "WITH deleted AS (DELETE FROM tenant_engine_snapshots s WHERE s.captured_at < NOW() - INTERVAL '90 days' AND EXISTS (SELECT 1 FROM engine_score_daily_rollup r WHERE r.customer_id = s.customer_id AND r.engine_key = s.engine_key AND r.day = DATE(s.captured_at)) RETURNING s.id) SELECT COUNT(*)::int AS deleted_count FROM deleted",
          },
        },
        { id: "end", type: "end", position: { x: 100, y: 490 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "rollup" },
        { id: "e2", source: "rollup", target: "purge" },
        { id: "e3", source: "purge", target: "end" },
      ],
    }
  },
  // ── Platform Log Stream Retention Prune ─────────────────────────────────────
  {
    name: "Platform Log Stream Retention Prune",
    description: "Runs nightly at 02:00 UTC. Deletes platform_log_stream rows older than the configured retention window (default 7 days). Scope is the debug/log firehose only — exception tracking and business events are explicitly excluded and have their own, separate (currently unset) retention policies.",
    triggerType: "schedule",
    cron: "0 2 * * *",
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 60 },
          data: { nodeType: "start", label: "Daily 02:00 UTC" },
        },
        {
          id: "prune",
          type: "platform_log_stream_prune",
          position: { x: 300, y: 180 },
          data: { nodeType: "platform_log_stream_prune", label: "Prune log stream", retentionDays: 7 },
        },
        {
          id: "end",
          type: "end",
          position: { x: 300, y: 300 },
          data: { nodeType: "end", label: "Done" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "prune" },
        { id: "e2", source: "prune", target: "end" },
      ],
    },
  },
  // ── Tenant Configuration Snapshot Retention Prune (Git #2114) ───────────────
  {
    name: "__system__: Tenant Configuration Snapshot Retention Prune",
    description:
      "Runs nightly at 03:00 UTC. Keeps the most recent keepPerTenant (default 20) " +
      "non-running tenant_config_snapshots per tenant and deletes the rest — the real " +
      "retention policy for #1795/#1796's full-fidelity snapshot store, which had no " +
      "bound before this (34 MB / 50,176 object rows per full snapshot, measured " +
      "live). Never deletes a snapshot a config_diffs row (base or head, any diff, " +
      "ever) or a config_snapshot_baselines row still references — see " +
      "config-snapshot-retention-nodes.ts for why that exclusion has to be enforced " +
      "in application code rather than left to config_diffs' own ON DELETE CASCADE. " +
      "Deleting a snapshot header cascades to its objects and resource-status rows " +
      "by existing FK, so this is one DELETE per pruned snapshot. Every run is logged " +
      "to config_snapshot_prune_runs.",
    triggerType: "schedule",
    cron: "0 3 * * *",
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 60 },
          data: { nodeType: "start", label: "Daily 03:00 UTC" },
        },
        {
          id: "prune",
          type: "config_snapshot_prune",
          position: { x: 300, y: 180 },
          data: { nodeType: "config_snapshot_prune", label: "Prune Configuration Snapshots", keepPerTenant: 20 },
        },
        {
          id: "end",
          type: "end",
          position: { x: 300, y: 300 },
          data: { nodeType: "end", label: "Done" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "prune" },
        { id: "e2", source: "prune", target: "end" },
      ],
    },
  },
  // ── MSP Portfolio Risk Snapshot ─────────────────────────────────────────────
  {
    name: "__system__: MSP Portfolio Risk Snapshot",
    description: "Runs daily at 01:00 UTC to compute and persist portfolio risk scores for all active MSPs.",
    triggerType: "schedule",
    cron: "0 1 * * *",
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Start" } },
        {
          id: "snapshot",
          type: "msp_score_snapshot",
          position: { x: 100, y: 200 },
          data: {
            nodeType: "msp_score_snapshot",
            label: "Compute & Record MSP Portfolio Risk",
          },
        },
        { id: "end", type: "end", position: { x: 100, y: 300 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "snapshot" },
        { id: "e2", source: "snapshot", target: "end" },
      ],
    },
  },
  // ── M365 Service Health Sampling ────────────────────────────────────────────
  {
    name: "__system__: M365 Service Health Sampling",
    description: "Runs hourly (matching the m365:service-health check's declared frequency). Fetches /admin/serviceAnnouncement/healthOverviews for every consented tenant and persists one row per service into m365_service_health_samples, so M365 Third-Party SLA Uptime Percentage can be computed over real history instead of a live-fetch-only snapshot.",
    triggerType: "schedule",
    cron: "0 * * * *",
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Hourly" } },
        {
          id: "sample",
          type: "m365_health_sample",
          position: { x: 100, y: 200 },
          data: {
            nodeType: "m365_health_sample",
            label: "Sample M365 Service Health (all tenants)",
          },
        },
        { id: "end", type: "end", position: { x: 100, y: 300 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "sample" },
        { id: "e2", source: "sample", target: "end" },
      ],
    },
  },
  // ── M365 Roadmap Sync (#1530, part of #1494) ────────────────────────────────
  {
    name: "__system__: M365 Roadmap Sync",
    description:
      "Runs nightly (02:00 UTC). Fetches the PUBLIC, unauthenticated Microsoft 365 Roadmap v1 feed " +
      "(https://www.microsoft.com/releasecommunications/api/v1/m365) — 1,000+ items in a single request — " +
      "and upserts each roadmap feature into m365_roadmap_items keyed by the Microsoft feature ID (the " +
      "cross-source join key Message Center posts carry). Persists each item's cloud instances (Worldwide / " +
      "GCC / GCC High / DoD) so the standing gov/GCC exclusion (#1537) is enforced from real data. Degrades " +
      "honestly: Microsoft relocated this endpoint once already (15 Mar 2025), so on a failed/relocated/" +
      "shape-changed fetch the sync records the failure in m365_roadmap_sync_state without wiping items or " +
      "advancing last_success_at — stale roadmap data is never presented as current, and fixture content is " +
      "never substituted. A single request per night (deliberately low-frequency against an unauthenticated " +
      "public endpoint); v2 OData targeted queries are a separate, bounded path on the same node (mode:'v2').",
    triggerType: "schedule",
    cron: "0 2 * * *",
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Nightly 02:00 UTC" } },
        {
          id: "sync",
          type: "m365_roadmap_sync",
          position: { x: 100, y: 200 },
          data: {
            nodeType: "m365_roadmap_sync",
            label: "Sync M365 Roadmap (v1 full snapshot)",
            mode: "v1",
          },
        },
        { id: "end", type: "end", position: { x: 100, y: 300 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "sync" },
        { id: "e2", source: "sync", target: "end" },
      ],
    },
  },
  // ── M365 Changes Routing (#1534, part of #1494) ─────────────────────────────
  {
    name: "__system__: M365 Changes Routing",
    description:
      "Runs daily (04:00 UTC), after the M365 resolution sweep so the day's per-tenant counts land first. " +
      "The third stage of the M365 Changes pipeline after interpretation (#1532) and resolution (#1533): for " +
      "every confirmed interpretation × tenant that has a resolution, it decides what the resolved change " +
      "BECOMES. Shane's settled rule (#1534): a measured, non-zero, structurally-dated change AUTO-CREATES a " +
      "Change Request in msp_change_requests with Microsoft as the implementer (per #1497 every change gets a " +
      "CR, including auto-approved ones — a Microsoft change the tenant cannot refuse is a CR from the moment " +
      "it is announced); an undated (incl. #1536's 'date unclear') or zero-affected change PROPOSES a CR only " +
      "(recorded in m365_change_routings, never created); a not-measured resolution routes nothing. Idempotent: " +
      "one routing decision per (interpretation × customer), and a CR is created exactly once (ledger + a " +
      "partial unique index both guard it). The declined→accepted-risk path (#1514) is a separate, " +
      "customer-driven transition, not part of this sweep. A pure Workflow Engine definition — no bare " +
      "scheduler — that touches no billing/monitoring config.",
    triggerType: "schedule",
    cron: "0 4 * * *",
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Daily 04:00 UTC" } },
        {
          id: "route",
          type: "m365_route_changes",
          position: { x: 100, y: 200 },
          data: {
            nodeType: "m365_route_changes",
            label: "Route Resolved Microsoft Changes",
          },
        },
        { id: "end", type: "end", position: { x: 100, y: 300 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "route" },
        { id: "e2", source: "route", target: "end" },
      ],
    },
  },
  // ── Remediation Tracker — on-demand pointed verify (#1540) ──────────────────
  {
    name: "__system__: Remediation Pointed Verification",
    description:
      "#1540 — 'Done means verified, never claimed. A human marking an item complete is a claim " +
      "awaiting proof, not a state change.' Fired by portal-remediation-tracker.ts's " +
      "POST /steps/:stepId/verify on the customer's own on-demand 'Verify' click — re-runs THIS " +
      "step's mapped monitor check(s) against the tenant right now (not the next scheduled full " +
      "package scan) and writes verified/drift straight to remediation_tracker_steps.verificationState. " +
      "A visible Workflow Engine node (remediation_pointed_verify), not a bare route-side function call.",
    triggerType: "event",
    eventNames: ["remediation.verify_requested"],
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Verify Requested" } },
        {
          id: "verify",
          type: "remediation_pointed_verify",
          position: { x: 100, y: 200 },
          data: {
            nodeType: "remediation_pointed_verify",
            label: "Pointed Verify Remediation Step",
            customerId: "{{customerId}}",
            stepId: "{{stepId}}",
          },
        },
        { id: "end", type: "end", position: { x: 100, y: 300 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "verify" },
        { id: "e2", source: "verify", target: "end" },
      ],
    },
  },
  // ── Zoho Queue Drain (Zoho Integration Foundation, #82) ─────────────────────
  {
    name: "Zoho Queue Drain",
    description: "Runs every 5 minutes. Claims a bounded batch (20) of pending zoho.* jobs from msp_job_queue with FOR UPDATE SKIP LOCKED and dispatches each to its registered Zoho job handler with at most 5 concurrent Zoho API calls (conservative against Zoho's 5–25 per-org concurrency limits). Every Zoho write in the platform is queued and drained through this workflow so each sync batch is a visible, logged run — never a bare setInterval loop.",
    triggerType: "schedule",
    cron: "*/5 * * * *",
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Every 5 minutes" } },
        {
          id: "drain",
          type: "zoho_batch_drain",
          position: { x: 100, y: 200 },
          data: {
            nodeType: "zoho_batch_drain",
            label: "Drain pending zoho.* jobs (batch 20, concurrency 5)",
            batchSize: 20,
            concurrency: 5,
          },
        },
        { id: "end", type: "end", position: { x: 100, y: 300 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "drain" },
        { id: "e2", source: "drain", target: "end" },
      ],
    },
  },
  // ── Zoho Books Daily AI Cost Rollup (#87) ────────────────────────────────
  {
    name: "Zoho Books Daily AI Cost Rollup",
    description: "Runs daily at 05:00 UTC. Sums the prior UTC day's ai_usage_events.costCents (reusing the Phase 4 AI Billing day-bucketing logic in ai-billing-analytics.ts) and posts ONE zoho_books_create_expense job for that day, idempotent via a reference_number of the date. A $0 day is skipped rather than posting a $0 expense. The actual Zoho write happens on the next Zoho Queue Drain, same as every other Zoho Books job.",
    triggerType: "schedule",
    cron: "0 5 * * *",
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Daily at 05:00 UTC" } },
        {
          id: "rollup",
          type: "zoho_books_daily_ai_rollup",
          position: { x: 100, y: 200 },
          data: {
            nodeType: "zoho_books_daily_ai_rollup",
            label: "Sum prior day's AI cost, queue Zoho Books expense",
          },
        },
        { id: "end", type: "end", position: { x: 100, y: 300 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "rollup" },
        { id: "e2", source: "rollup", target: "end" },
      ],
    },
  },
  // ── EngageBay Queue Drain (EngageBay Webhooks + Workflow Nodes, #105) ───────
  {
    name: "EngageBay Queue Drain",
    description: "Runs every 5 minutes. Claims a bounded batch (20) of pending engagebay_* jobs from msp_job_queue with FOR UPDATE SKIP LOCKED and dispatches each to its registered EngageBay job handler with at most 5 concurrent EngageBay API calls (conservative — EngageBay publishes no per-org concurrency limit, unlike Zoho's documented 5–25). Every EngageBay write in the platform is queued and drained through this workflow so each sync batch is a visible, logged run — never a bare setInterval loop.",
    triggerType: "schedule",
    cron: "*/5 * * * *",
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Every 5 minutes" } },
        {
          id: "drain",
          type: "engagebay_batch_drain",
          position: { x: 100, y: 200 },
          data: {
            nodeType: "engagebay_batch_drain",
            label: "Drain pending engagebay_* jobs (batch 20, concurrency 5)",
            batchSize: 20,
            concurrency: 5,
          },
        },
        { id: "end", type: "end", position: { x: 100, y: 300 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "drain" },
        { id: "e2", source: "drain", target: "end" },
      ],
    },
  },
  {
    name: "__system__: Signal Policy Evaluation",
    description: "Runs every 15 minutes. Evaluates all active Signal Policy Engine rules (policy_rules) against every customer with a currently-fired signal, firing configured workflow events for anything that qualifies — this is the final step connecting a fired/stabilized signal to a real dispatched alert.",
    triggerType: "schedule",
    cron: "*/15 * * * *",
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Every 15 min" } },
        {
          id: "evaluate",
          type: "evaluate_signal_policies",
          position: { x: 100, y: 230 },
          data: {
            nodeType: "evaluate_signal_policies",
            label: "Evaluate Signal Policies",
          },
        },
        { id: "end", type: "end", position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start",    target: "evaluate" },
        { id: "e2", source: "evaluate", target: "end"      },
      ],
    },
  },
  // ── Assessment Document Generation — Service-Mapped, Sequenced SOW ─────────
  {
    name: "__system__: Assessment Document Generation — Service-Mapped, Sequenced SOW",
    description:
      "Two-sided 'wait for both' gate for Assessment/Free-tier document generation. " +
      "Fires on diagnostics.run_completed OR portal.first_login; the shared assessment_doc_gate " +
      "node re-checks ALL conditions against live DB (assessment-tier + scan-completed + logged-in) " +
      "plus idempotency, so whichever condition becomes true second is the run that proceeds — and no " +
      "AI credit is ever spent on a lead who never logs in. On eligibility it resolves the service's " +
      "associated documents, generates each sequentially (retry-on-failure, live run-ID progress), then " +
      "generates the consolidated SOW AFTER the rest exist (so it grounds against them), then builds the " +
      "customer presentation from the customer-visible documents + the SOW. Emits assessment.docs.completed " +
      "on success and assessment.docs.failed on unrecoverable failure. Replaces the retired " +
      "assessment-doc-trigger.ts / autoFireAllDocumentCards hidden mechanism.",
    triggerType: "event",
    eventNames: ["diagnostics.run_completed", "portal.first_login"],
    triggerEnabled: true,
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 400, y: 40 },
          data: { nodeType: "start", label: "Scan completed OR first login" },
        },
        {
          // Ported two-sided gate — resolves clientUserId/projectId/serviceId from
          // either trigger payload and returns eligible=true only when
          // assessment-tier + logged-in + scan-completed and not already generated.
          id: "gate",
          type: "action",
          position: { x: 400, y: 170 },
          data: {
            nodeType: "action",
            actionType: "assessment_doc_gate",
            label: "Assessment Doc Gate (wait for both)",
            userId: "{{userId}}",
            customerId: "{{customerId}}",
            tenantId: "{{tenantId}}",
          },
        },
        {
          id: "cond_eligible",
          type: "condition",
          position: { x: 400, y: 300 },
          data: {
            nodeType: "condition",
            label: "Both conditions met?",
            expression: "{{eligible}} == true",
          },
        },
        {
          // Deliverable 2 — resolve the assessment service + its associated documents.
          // documentsToGenerate excludes any SOW entry (SOW is generated separately).
          id: "find_service",
          type: "find_object",
          position: { x: 250, y: 430 },
          data: {
            nodeType: "find_object",
            label: "Find Service + Associated Docs",
            objectType: "service",
            fieldName: "id",
            fieldValueExpr: "{{serviceId}}",
          },
        },
        {
          id: "progress_start",
          type: "report_progress",
          position: { x: 250, y: 550 },
          data: {
            nodeType: "report_progress",
            label: "Progress: Preparing",
            message: "Preparing your assessment documents…",
            step: "0",
            total: "{{documentCount}}",
          },
        },
        {
          id: "loop",
          type: "foreach",
          position: { x: 250, y: 670 },
          data: {
            nodeType: "foreach",
            label: "For Each Document",
            arrayPath: "documentsToGenerate",
            itemAlias: "doc",
          },
        },
        {
          id: "progress_doc",
          type: "report_progress",
          position: { x: 100, y: 800 },
          data: {
            nodeType: "report_progress",
            label: "Progress: Generating doc",
            message: "Generating {{doc.title}}…",
            step: "{{itemIndex}}",
            total: "{{itemsTotal}}",
          },
        },
        {
          // Generic per-document generation. docCategory/docType/title come from the
          // service's associated-documents mapping (item alias "doc").
          id: "gen_doc",
          type: "action",
          position: { x: 100, y: 920 },
          data: {
            nodeType: "action",
            actionType: "generate_document",
            label: "Generate {{doc.title}}",
            docType: "{{doc.docType}}",
            docCategory: "{{doc.category}}",
            docTitle: "{{doc.title}}",
            clientId: "{{clientUserId}}",
            projectId: "{{projectId}}",
          },
        },
        {
          // Single retry (mirrors the SOW Generation retry idiom). No onError edge:
          // a second failure is an unhandled body error → the whole run fails
          // (status='failed' + run-ID SSE error), so no presentation is built.
          id: "gen_doc_retry",
          type: "action",
          position: { x: 300, y: 920 },
          data: {
            nodeType: "action",
            actionType: "generate_document",
            label: "Retry: {{doc.title}}",
            docType: "{{doc.docType}}",
            docCategory: "{{doc.category}}",
            docTitle: "{{doc.title}}",
            clientId: "{{clientUserId}}",
            projectId: "{{projectId}}",
          },
        },
        {
          id: "progress_sow",
          type: "report_progress",
          position: { x: 400, y: 800 },
          data: {
            nodeType: "report_progress",
            label: "Progress: SOW",
            message: "Generating your statement of work…",
          },
        },
        {
          // Consolidated SOW runs AFTER the foreach so generateConsolidatedSowDocument
          // grounds against the now-existing documents for this customer.
          id: "gen_sow",
          type: "action",
          position: { x: 400, y: 920 },
          data: {
            nodeType: "action",
            actionType: "generate_document",
            label: "Generate Consolidated SOW",
            docType: "consolidated_sow",
            docCategory: "consulting",
            clientId: "{{clientUserId}}",
            projectId: "{{projectId}}",
            title: "Statement of Work",
          },
        },
        {
          id: "refresh_profile",
          type: "update_m365_profile",
          position: { x: 650, y: 920 },
          data: {
            nodeType: "update_m365_profile",
            label: "Refresh M365 Profile",
            runbookName: "Update-M365-Profile",
            clientId: "{{clientUserId}}",
          },
        },
        {
          id: "refresh_intel",
          type: "update_intelligence_tables",
          position: { x: 650, y: 1040 },
          data: {
            nodeType: "update_intelligence_tables",
            label: "Refresh Intelligence Tables",
            clientId: "{{clientUserId}}",
          },
        },
        {
          id: "retry_sow",
          type: "action",
          position: { x: 650, y: 1160 },
          data: {
            nodeType: "action",
            actionType: "generate_document",
            label: "Retry: Generate Consolidated SOW",
            docType: "consolidated_sow",
            docCategory: "consulting",
            clientId: "{{clientUserId}}",
            projectId: "{{projectId}}",
            title: "Statement of Work",
          },
        },
        {
          // Build the customer-facing deliverable list from the actually-delivered
          // documents: customer-visible associated docs (per the service config) +
          // the SOW. Internal-only docs (customerVisible=false) are excluded.
          id: "build_doc_list",
          type: "sql_query",
          position: { x: 400, y: 1160 },
          data: {
            nodeType: "sql_query",
            label: "Build Presentation Doc List",
            query:
              "SELECT COALESCE(json_agg(json_build_object('name', d.title) ORDER BY d.created_at), '[]'::json) AS \"docs\" " +
              "FROM insights_generated_documents d " +
              "WHERE d.customer_id = $1::int AND d.status = 'delivered' AND (" +
              "  d.doc_type = 'consolidated_sow' OR d.doc_type = ANY(" +
              "    SELECT jd->>'docType' FROM services s, jsonb_array_elements(COALESCE(s.associated_documents, '[]'::jsonb)) jd " +
              "    WHERE s.id = $2::int AND (jd->>'customerVisible')::boolean = true" +
              "  )" +
              ")",
            params: ["{{clientUserId}}", "{{serviceId}}"],
          },
        },
        {
          id: "progress_pres",
          type: "report_progress",
          position: { x: 400, y: 1280 },
          data: {
            nodeType: "report_progress",
            label: "Progress: Presentation",
            message: "Building your presentation…",
          },
        },
        {
          // Creates the client_presentations row fresh, at the very end, including
          // only customer-visible documents + the SOW (from build_doc_list).
          id: "build_pres",
          type: "build_presentation",
          position: { x: 400, y: 1400 },
          data: {
            nodeType: "build_presentation",
            label: "Build Client Presentation",
            clientName: "{{clientName}}",
            clientEmail: "{{clientEmail}}",
            projectTitle: "Your Microsoft 365 Assessment",
            documents: "{{steps.build_doc_list.docs}}",
          },
        },
        {
          id: "success_emit",
          type: "emit_event",
          position: { x: 400, y: 1520 },
          data: {
            nodeType: "emit_event",
            label: "Emit assessment.docs.completed",
            eventType: "assessment.docs.completed",
            extraPayload: JSON.stringify({
              presentationId: "{{steps.build_pres.presentationId}}",
              clientUserId: "{{clientUserId}}",
              projectId: "{{projectId}}",
              customerId: "{{customerId}}",
            }),
          },
        },
        {
          id: "end_ok",
          type: "end",
          position: { x: 400, y: 1640 },
          data: { nodeType: "end", label: "Documents Delivered" },
        },
        {
          id: "fail_emit",
          type: "emit_event",
          position: { x: 750, y: 1400 },
          data: {
            nodeType: "emit_event",
            label: "Emit assessment.docs.failed",
            eventType: "assessment.docs.failed",
            extraPayload: JSON.stringify({
              reason: "SOW generation failed after retry",
              clientUserId: "{{clientUserId}}",
              projectId: "{{projectId}}",
              customerId: "{{customerId}}",
            }),
          },
        },
        {
          id: "end_fail",
          type: "end",
          position: { x: 750, y: 1520 },
          data: { nodeType: "end", label: "Generation Failed" },
        },
        {
          id: "end_skip",
          type: "end",
          position: { x: 600, y: 430 },
          data: { nodeType: "end", label: "Not eligible yet — waiting for other condition" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "gate" },
        { id: "e2", source: "gate", target: "cond_eligible" },
        { id: "e3", source: "cond_eligible", target: "find_service", sourceHandle: "yes" },
        { id: "e4", source: "cond_eligible", target: "end_skip", sourceHandle: "no" },
        { id: "e5", source: "find_service", target: "progress_start" },
        { id: "e6", source: "progress_start", target: "loop" },
        // foreach body: progress → generate (+retry). No retry onError = fail-run.
        { id: "e7", source: "loop", target: "progress_doc", sourceHandle: "body" },
        { id: "e8", source: "progress_doc", target: "gen_doc" },
        { id: "e9", source: "gen_doc", target: "gen_doc_retry", sourceHandle: "onError" },
        // foreach done → sequenced SOW generation
        { id: "e10", source: "loop", target: "progress_sow", sourceHandle: "done" },
        { id: "e11", source: "progress_sow", target: "gen_sow" },
        { id: "e12", source: "gen_sow", target: "build_doc_list" },
        // SOW recovery + retry (mirrors SOW Generation workflow)
        { id: "e13", source: "gen_sow", target: "refresh_profile", sourceHandle: "onError" },
        { id: "e14", source: "refresh_profile", target: "refresh_intel" },
        { id: "e15", source: "refresh_intel", target: "retry_sow" },
        { id: "e16", source: "retry_sow", target: "build_doc_list" },
        { id: "e17", source: "retry_sow", target: "fail_emit", sourceHandle: "onError" },
        // presentation build + success
        { id: "e18", source: "build_doc_list", target: "progress_pres" },
        { id: "e19", source: "progress_pres", target: "build_pres" },
        { id: "e20", source: "build_pres", target: "success_emit" },
        { id: "e21", source: "success_emit", target: "end_ok" },
        // failure terminal
        { id: "e22", source: "fail_emit", target: "end_fail" },
      ],
    },
  },
  {
    name: "__system__: Engagement Offer Evaluation",
    description: "Runs every 15 minutes. Evaluates all active Engagement Offer Engine rules against every lead with activity in the last 24 hours, firing configured workflow events for anything that crosses its behavioral engagement thresholds — connects raw browsing behavior to a dispatched engagement offer.",
    triggerType: "schedule",
    cron: "*/15 * * * *",
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Every 15 min" } },
        {
          id: "evaluate",
          type: "evaluate_engagement_offers",
          position: { x: 100, y: 230 },
          data: {
            nodeType: "evaluate_engagement_offers",
            label: "Evaluate Engagement Offers",
          },
        },
        { id: "end", type: "end", position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start",    target: "evaluate" },
        { id: "e2", source: "evaluate", target: "end"      },
      ],
    },
  },
  {
    name: "__system__: Engagement Offer Delayed Follow-Up Dispatch",
    description:
      "Runs every 15 minutes. Finds engagement_offer_firings rows with no Delayed " +
      "Follow-Up run dispatched yet (fired in the last 24 hours) and spawns one per " +
      "firing. The actual session-end lookup + 2-hour delay + bundle-offer email lives " +
      "in the spawned '__system__: Engagement Offer Delayed Follow-Up' run, not here — " +
      "this dispatcher only decides WHICH firings need a run and starts it. " +
      "Design note: the Engagement Offer Engine emits rule.eventName on fire (a " +
      "per-rule-configurable DB column), but engagement_offer_rules has never been " +
      "seeded in this codebase (no code or manual SQL inserts a row), so no real " +
      "eventName value could be confirmed. Polling engagement_offer_firings directly " +
      "avoids depending on that unconfirmed value.",
    triggerType: "schedule",
    cron: "*/15 * * * *",
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Every 15 min" } },
        {
          id: "dispatch",
          type: "dispatch_engagement_followups",
          position: { x: 100, y: 230 },
          data: { nodeType: "dispatch_engagement_followups", label: "Dispatch Pending Followups" },
        },
        { id: "end", type: "end", position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start",    target: "dispatch" },
        { id: "e2", source: "dispatch", target: "end"      },
      ],
    },
  },
  {
    // Git #1796. Manual trigger ONLY, and that is the decision the issue made:
    // the collector must be a visible Workflow Engine node rather than a bare
    // scheduler, but the cadence at which snapshots should be taken is a separate
    // question with its own issue. So this seeds with triggerType "manual" — no
    // trigger row is created, nothing fires it on its own, and an operator runs
    // it from the Workflow list when a snapshot is wanted.
    //
    // Read-only against the customer tenant. The `ask_for_input` step exists so
    // the tenant is named deliberately at run time rather than defaulted to
    // anything — a snapshot silently taken against the wrong tenant would be
    // evidence attributed to the wrong customer.
    name: "__system__: Tenant Configuration Snapshot",
    description:
      "Captures a full, point-in-time configuration snapshot of one customer tenant into the " +
      "tenant_config_snapshots store (#1795/#1796). Iterates every collectable resource type in " +
      "config_snapshot_resource_types — never a hardcoded list — reading each one whole over " +
      "Microsoft Graph (v1.0 and beta) or the ps-execution container, and stores the real objects " +
      "verbatim. STRICTLY READ-ONLY: every call is a GET or a Get-* cmdlet, and nothing in this " +
      "workflow writes to a tenant. Partial success is a real outcome — a resource that could not " +
      "be read is recorded with its honest reason (permission, licence, service not configured, no " +
      "executor, throttle) and never silently omitted, and the snapshot's isComplete flag says " +
      "plainly whether the picture is whole. Prompts for the tenants.id to snapshot and an optional " +
      "resource cap. Manual trigger only: collection cadence is a separate decision, not made here.",
    triggerType: "manual",
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 300, y: 60 }, data: { nodeType: "start", label: "Snapshot Requested" } },
        {
          id: "ask_tenant",
          type: "ask_for_input",
          position: { x: 300, y: 200 },
          data: {
            nodeType: "ask_for_input",
            label: "Which Tenant",
            // `variableName` (not `name`) is the key both the executor's
            // `ask_for_input` case and the operator run dialog read. A `number`
            // field is deliberate over the `customer` entity picker: this needs a
            // `tenants.id`, and the picker's option ids come from a different
            // endpoint — naming the column in the label leaves no room to supply
            // the wrong identifier.
            fields: [
              {
                id: "csc-tenant-id",
                variableName: "tenantId",
                label: "Customer tenants.id (NOT the Entra tenant GUID — the collector resolves that itself)",
                type: "number",
                required: true,
              },
              {
                id: "csc-max-resources",
                variableName: "maxResources",
                label: "Max resource types to target (leave blank for every collectable type)",
                type: "number",
                required: false,
              },
            ],
          },
        },
        {
          id: "collect",
          type: "config_snapshot_collect",
          position: { x: 300, y: 360 },
          data: {
            nodeType: "config_snapshot_collect",
            label: "Collect Configuration Snapshot",
            tenantId: "{{tenantId}}",
            maxResources: "{{maxResources}}",
            triggerRef: "manual operator run",
          },
        },
        { id: "end", type: "end", position: { x: 300, y: 520 }, data: { nodeType: "end", label: "Snapshot Sealed" } },
      ],
      edges: [
        { id: "e1", source: "start",      target: "ask_tenant" },
        { id: "e2", source: "ask_tenant", target: "collect"    },
        { id: "e3", source: "collect",    target: "end"        },
      ],
    },
  },
  {
    name: "__system__: Engagement Offer Delayed Follow-Up",
    description:
      "Per-lead run, spawned by '__system__: Engagement Offer Delayed Follow-Up " +
      "Dispatch' (never run directly — triggerType is 'manual' so no trigger row is " +
      "created, matching the run_workflow child-run convention). Payload: leadId, " +
      "firingId, ruleId, ruleName, eligibleServiceIds, discountPct, leadEmail, " +
      "leadName, serviceNames. Looks up the lead's actual last-seen analytics session " +
      "time (not this run's start time — the triggering firing can happen mid-session " +
      "while the lead is still browsing), falls back to the firing time if no session " +
      "is found, waits until 2 hours after that, then emails the bundle offer. Can be " +
      "cancelled mid-flight by '__system__: Engagement Offer Purchase Cancellation " +
      "Guard' if the lead buys an eligible service before the email goes out.",
    triggerType: "manual",
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 300, y: 60 }, data: { nodeType: "start", label: "Engagement Offer Fired" } },
        {
          id: "get_session_end",
          type: "action",
          position: { x: 300, y: 200 },
          data: {
            nodeType: "action",
            actionType: "sql_query",
            label: "Get Session End Time",
            query:
              "SELECT COALESCE(" +
              "(SELECT s.last_seen_at FROM analytics_sessions s WHERE s.session_id = " +
              "(SELECT metadata->>'sessionId' FROM lead_intent_events WHERE lead_id = {{leadId}} " +
              "AND metadata->>'sessionId' IS NOT NULL ORDER BY occurred_at DESC LIMIT 1)), " +
              "(SELECT fired_at FROM engagement_offer_firings WHERE id = {{firingId}})" +
              ") + INTERVAL '2 hours' AS follow_up_at",
          },
        },
        {
          id: "wait",
          type: "delay",
          position: { x: 300, y: 340 },
          data: { nodeType: "delay", label: "Wait Until Session End + 2h", mode: "until_timestamp", timestamp: "{{follow_up_at}}" },
        },
        {
          id: "send_offer",
          type: "action",
          position: { x: 300, y: 480 },
          data: {
            nodeType: "action",
            actionType: "send_email",
            label: "Send Bundle Offer",
            to: "{{leadEmail}}",
            subject: "A bundle just for you, {{leadName}} — {{discountPct}}% off",
            htmlBody:
              "<p>Hi {{leadName}},</p>" +
              "<p>Based on what you've been exploring, we put together a bundle: <strong>{{serviceNames}}</strong> " +
              "at <strong>{{discountPct}}% off</strong>.</p>" +
              "<p>This offer is time-limited — reply to this email or book a call to lock it in.</p>",
          },
        },
        { id: "end", type: "end", position: { x: 300, y: 620 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start",           target: "get_session_end" },
        { id: "e2", source: "get_session_end", target: "wait"            },
        { id: "e3", source: "wait",             target: "send_offer"     },
        { id: "e4", source: "send_offer",       target: "end"            },
      ],
    },
  },
  {
    name: "__system__: Engagement Offer Purchase Cancellation Guard",
    description:
      "Fires on purchase.completed (the real checkout-completion event — confirmed via " +
      "the Stripe webhook handler in portal.ts's onboarding_purchase branch, emitted " +
      "with clientId + serviceIds on the modern document-routing purchase shape). If the " +
      "purchaser has a pending Delayed Follow-Up run whose rule eligibleServiceIds " +
      "overlaps the purchased serviceIds, cancels that run so the lead never gets " +
      "emailed a bundle discount for something they already bought at full price. " +
      "KNOWN GAP: the OTHER purchase.completed emission (packageKey-only, monitoring-" +
      "package purchases) carries no serviceIds, so this guard has nothing to compare " +
      "and correctly no-ops for that purchase shape.",
    triggerType: "event",
    eventNames: ["purchase.completed"],
    triggerEnabled: true,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 300, y: 60 }, data: { nodeType: "start", label: "Purchase Completed" } },
        {
          id: "guard",
          type: "cancel_conflicting_engagement_followup",
          position: { x: 300, y: 200 },
          data: {
            nodeType: "cancel_conflicting_engagement_followup",
            label: "Cancel Conflicting Followup",
            clientId: "{{clientId}}",
            serviceIds: "{{serviceIds}}",
          },
        },
        { id: "end", type: "end", position: { x: 300, y: 340 }, data: { nodeType: "end", label: "Done" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "guard" },
        { id: "e2", source: "guard", target: "end"   },
      ],
    },
  },
  // ── Content Studio LinkedIn Dispatcher (Phase F, Git #686) ────────────────
  {
    name: "__system__: Content Studio LinkedIn Dispatcher",
    description:
      "Runs every 5 minutes. Per-record fan-out over content_posts: fan_out_query " +
      "selects every row with status = 'scheduled' AND scheduled_for <= NOW(), firing " +
      "one run per due post with { id, body } as the payload. Posts via the existing " +
      "post_linkedin node (LINKEDIN_ACCESS_TOKEN/LINKEDIN_ORG_ID, UGC Posts API) — " +
      "reused as-is, not reimplemented. On success, a sql_query node marks the row " +
      "'posted'. On failure, the workflow engine's own retry node re-runs post_linkedin " +
      "up to 3 times with a 60s delay between attempts (its 'error' edge target, per the " +
      "engine's documented retry/backoff mechanism — see triggerScheduledWorkflows()'s " +
      "doc comment and the retry node's own implementation in this file's sibling " +
      "workflow-executor.ts); once exhausted, its 'exhausted' edge marks the row 'failed' " +
      "and creates an operator notification, matching the DLQ/escalation pattern every " +
      "other seeded workflow with a failure path uses (create_notification). Marking the " +
      "row 'failed' is also what makes it stop reappearing in this same trigger's next " +
      "fan-out — the query only ever selects 'scheduled' rows, so once status moves to " +
      "'posted' or 'failed' the row is naturally excluded going forward. " +
      "content_posts itself and the admin CRUD around it (create/edit/delete, never " +
      "posting) are owned by contentStudioStore.ts / admin-content-studio.ts — this " +
      "workflow is the only thing that ever calls LinkedIn.",
    triggerType: "schedule",
    cron: "*/5 * * * *",
    triggerEnabled: true,
    fanOutMode: "per_record",
    fanOutQuery: "SELECT id, body FROM content_posts WHERE status = 'scheduled' AND scheduled_for <= NOW()",
    graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 300, y: 60 },
          data: { nodeType: "start", label: "Scheduled Post Due (fan-out)" },
        },
        {
          id: "post",
          type: "post_linkedin",
          position: { x: 300, y: 200 },
          data: {
            nodeType: "post_linkedin",
            label: "Post to LinkedIn",
            postBody: "{{body}}",
          },
        },
        {
          id: "mark_posted",
          type: "sql_query",
          position: { x: 150, y: 340 },
          data: {
            nodeType: "sql_query",
            label: "Mark Posted",
            query: "UPDATE content_posts SET status = 'posted', updated_at = NOW() WHERE id = $1::int",
            params: ["{{id}}"],
          },
        },
        {
          id: "end_ok",
          type: "end",
          position: { x: 150, y: 480 },
          data: { nodeType: "end", label: "Posted" },
        },
        {
          id: "retry",
          type: "retry",
          position: { x: 500, y: 340 },
          data: {
            nodeType: "retry",
            label: "Retry LinkedIn Post",
            maxAttempts: 3,
            delaySeconds: 60,
          },
        },
        {
          id: "mark_failed",
          type: "sql_query",
          position: { x: 500, y: 480 },
          data: {
            nodeType: "sql_query",
            label: "Mark Failed",
            query: "UPDATE content_posts SET status = 'failed', updated_at = NOW() WHERE id = $1::int",
            params: ["{{id}}"],
          },
        },
        {
          id: "notify_operator",
          type: "create_notification",
          position: { x: 500, y: 620 },
          data: {
            nodeType: "create_notification",
            label: "Notify: LinkedIn Post Failed",
            title: "LinkedIn post #{{id}} failed after retries",
            body: "Content Studio post {{id}} failed to publish to LinkedIn after 3 attempts. Check it in Content Studio's Queue and retry or edit it manually.",
            type: "general",
          },
        },
        {
          id: "end_failed",
          type: "end",
          position: { x: 500, y: 760 },
          data: { nodeType: "end", label: "Failed — operator notified" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "post" },
        { id: "e2", source: "post", target: "mark_posted" },
        { id: "e3", source: "post", target: "retry", sourceHandle: "error" },
        { id: "e4", source: "mark_posted", target: "end_ok" },
        { id: "e5", source: "retry", target: "mark_failed", sourceHandle: "exhausted" },
        { id: "e6", source: "mark_failed", target: "notify_operator" },
        { id: "e7", source: "notify_operator", target: "end_failed" },
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
      const metadataJson = JSON.stringify({ system: true, allowManualTrigger: seed.allowManualTrigger ?? true });
      const defResult = await pool.query<{ id: number }>(
        `INSERT INTO wf_definitions (name, description, concurrency_limit, metadata)
         VALUES ($1, $2, 1, $3::jsonb)
         ON CONFLICT (name) DO UPDATE
           SET description = EXCLUDED.description,
               metadata    = COALESCE(wf_definitions.metadata, '{}'::jsonb) || $3::jsonb,
               updated_at  = NOW()
         RETURNING id`,
        [seed.name, seed.description, metadataJson],
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
        log.info({ defId, name: seed.name }, "seed-system-workflows: pinned default v1");
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
        log.info({ defId }, "seed-system-workflows: patched publish_article node to draftOnly:true");
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
        log.info({ defId }, "seed-system-workflows: patched SOW Auto-Retry sql_query, condition, and edge handles");

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
        log.info({ defId }, "seed-system-workflows: patched SOW Auto-Retry age threshold 120000 → 300000");

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
        log.info({ defId }, "seed-system-workflows: patched SOW Auto-Retry — inserted calc_pricing node");

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
        log.info({ defId }, "seed-system-workflows: patched SOW Auto-Retry — added fail-count circuit breaker");
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
        log.info({ defId }, "seed-system-workflows: patched SOW Generation — fixed clientId field contract for generate_document, update_m365_profile, and update_intelligence_tables nodes");
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
        log.info({ defId }, "seed-system-workflows: patched Presentation Phase Generator — replaced system_action nodes with sql_query");
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
        log.info({ defId }, "seed-system-workflows: patched Workflow Cleanup — replaced system_action with sql_query");
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
        log.info({ defId }, "seed-system-workflows: patched Escalation Check — replaced system_action with composable sql_query + condition + notification graph");
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
        log.info({ defId }, "seed-system-workflows: patched Monthly Insights — replaced system_action with sql_query + condition + notification graph");
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
        log.info({ defId }, "seed-system-workflows: patched MSP Dunning State Machine — replaced system_action with msp_dunning_advance");
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
        log.info({ defId }, "seed-system-workflows: patched MSP Overage Metering — replaced system_action with msp_overage_meter");
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
        log.info({ defId }, "seed-system-workflows: patched On Purchase — added monitor_get_package between find_object and monitor_execute_package");
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
          log.info({ defId }, "seed-system-workflows: removed purchase.completed trigger from On Purchase — Run Monitoring Package (now consent.granted-only)");
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
        log.info({ defId }, "seed-system-workflows: patched Live Activity Monitor — fixed dead linkPath, added send_alert_email node");
      } else if (seed.name === "__system__: Diagnostics Completion — Generate Sales Offers") {
        // Patch v1: graded coverage gate. The strict finalStatus == 'completed'
        // branch NEVER fired for tenants whose runs are permanently 'partial'
        // (confirmed live: every real run's branch_path was [start, branch,
        // end_skip] despite real findings + fired signals). Replace with the
        // shared evaluateDocGateCoverage decision, carried on the event payload
        // as coverageSufficient (see diagnostics-runner.ts). Guard: fires only
        // while the old expression is still present — no-ops once patched.
        await pool.query(
          `UPDATE wf_versions
              SET graph = $2::jsonb
           WHERE definition_id = $1
             AND version_number = 1
             AND graph->'nodes' @> '[{"id":"branch","data":{"expression":"finalStatus == ''completed''"}}]'`,
          [defId, JSON.stringify(seed.graph)],
        );
        log.info({ defId }, "seed-system-workflows: patched Generate Sales Offers — graded coverage gate (coverageSufficient) replaces strict finalStatus check");
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
          await pool.query(
            `INSERT INTO wf_triggers (definition_id, type, config, enabled)
             VALUES ($1, 'startup', '{}'::jsonb, true)`,
            [defId],
          );
        } else if (seed.triggerType === "schedule" && seed.cron) {
          const nextRun = computeNextCronRun(seed.cron);
          const scheduleConfig: Record<string, unknown> = { cron: seed.cron };
          if (seed.fanOutMode && seed.fanOutQuery) {
            scheduleConfig.fan_out_mode = seed.fanOutMode;
            scheduleConfig.fan_out_query = seed.fanOutQuery;
          }
          await pool.query(
            `INSERT INTO wf_triggers (definition_id, type, config, next_run_at, enabled)
             VALUES ($1, 'schedule', $2::jsonb, $3, true)`,
            [defId, JSON.stringify(scheduleConfig), nextRun],
          );
        }
        log.info({ defId, name: seed.name, triggerType: seed.triggerType }, "seed-system-workflows: trigger created");
      }
    }

    log.info({ count: SYSTEM_WORKFLOWS.length }, "seed-system-workflows: all system workflows seeded");
  } catch (err) {
    log.warn({ err }, "seed-system-workflows: seeding failed (non-fatal)");
  }
}
