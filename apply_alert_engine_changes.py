#!/usr/bin/env python3
"""
Applies the Alert Engine setInterval -> Workflow migration via direct string
replacement instead of git apply. Run from the repo root:

    python3 apply_alert_engine_changes.py

Each edit is verified: if the expected old text isn't found, that file is
skipped and reported (nothing is guessed or partially applied). Safe to run
more than once -- if the new text is already present, that edit is skipped
as "already applied" rather than erroring.
"""

import sys

EDITS = [
    {
        "file": "artifacts/api-server/src/index.ts",
        "label": "index.ts import",
        "old": 'import { initAlertEngine } from "./lib/alert-engine";',
        "new": 'import { ensureAlertEngineReady } from "./lib/alert-engine";',
    },
    {
        "file": "artifacts/api-server/src/index.ts",
        "label": "index.ts startup call",
        "old": (
            "  // Ensures alert tables, seeds default rules, starts polling every 5 minutes.\n"
            "  initAlertEngine(5 * 60 * 1000).catch((err: unknown) => {\n"
            '    logger.warn({ err }, "alert-engine: init failed (non-fatal)");\n'
            "  });"
        ),
        "new": (
            "  // Ensures alert tables exist and default rules are seeded. Evaluation itself\n"
            '  // now runs via the "__system__: Alert Rule Evaluation" seeded Workflow (see\n'
            "  // seed-system-workflows.ts) instead of a setInterval poller.\n"
            "  ensureAlertEngineReady().catch((err: unknown) => {\n"
            '    logger.warn({ err }, "alert-engine: init failed (non-fatal)");\n'
            "  });"
        ),
    },
    {
        "file": "artifacts/api-server/src/lib/alert-engine.ts",
        "label": "alert-engine.ts export evaluateRules",
        "old": "async function evaluateRules(): Promise<void> {",
        "new": "export async function evaluateRules(): Promise<void> {",
    },
    {
        "file": "artifacts/api-server/src/lib/alert-engine.ts",
        "label": "alert-engine.ts remove setInterval / add ensureAlertEngineReady",
        "old": (
            "let alertInterval: ReturnType<typeof setInterval> | null = null;\n"
            "\n"
            "/**\n"
            " * Initialize the alert engine: ensure tables, seed default rules, start polling.\n"
            " * Safe to call multiple times \u2014 only one interval is started.\n"
            " */\n"
            "export async function initAlertEngine(pollIntervalMs = 5 * 60 * 1000): Promise<void> {\n"
            "  try {\n"
            "    await ensureAlertTables();\n"
            "    await seedDefaultRules();\n"
            '    logger.info({ pollIntervalMs }, "alert-engine: initialized");\n'
            "  } catch (err) {\n"
            '    logger.warn({ err }, "alert-engine: init failed (non-fatal)");\n'
            "    return;\n"
            "  }\n"
            "\n"
            "  if (alertInterval !== null) return;\n"
            "\n"
            "  alertInterval = setInterval(() => {\n"
            "    evaluateRules().catch((err: unknown) => {\n"
            '      logger.warn({ err }, "alert-engine: evaluation cycle failed (non-fatal)");\n'
            "    });\n"
            "  }, pollIntervalMs);\n"
            "\n"
            "  if (alertInterval.unref) alertInterval.unref();\n"
            "\n"
            "  // Run once immediately after a short delay to let DB pool warm up\n"
            "  setTimeout(() => {\n"
            "    evaluateRules().catch((err: unknown) => {\n"
            '      logger.warn({ err }, "alert-engine: initial evaluation failed (non-fatal)");\n'
            "    });\n"
            "  }, 15_000);\n"
            "}\n"
            "\n"
            "export function stopAlertEngine(): void {\n"
            "  if (alertInterval !== null) {\n"
            "    clearInterval(alertInterval);\n"
            "    alertInterval = null;\n"
            "  }\n"
            "}"
        ),
        "new": (
            "/**\n"
            " * Ensure alert tables exist and default rules are seeded. Called once at server\n"
            " * startup. Does NOT start any polling loop \u2014 evaluation is triggered by the\n"
            ' * "__system__: Alert Rule Evaluation" seeded Workflow (see seed-system-workflows.ts),\n'
            " * which fires evaluateRules() via the alert_evaluate_rules workflow node every 5\n"
            " * minutes on its own schedule trigger.\n"
            " */\n"
            "export async function ensureAlertEngineReady(): Promise<void> {\n"
            "  try {\n"
            "    await ensureAlertTables();\n"
            "    await seedDefaultRules();\n"
            '    logger.info("alert-engine: tables ensured, default rules seeded");\n'
            "  } catch (err) {\n"
            '    logger.warn({ err }, "alert-engine: startup init failed (non-fatal)");\n'
            "  }\n"
            "}"
        ),
    },
    {
        "file": "artifacts/api-server/src/lib/workflow-executor.ts",
        "label": "workflow-executor.ts import",
        "old": 'import { logger } from "./logger";',
        "new": (
            'import { logger } from "./logger";\n'
            'import { evaluateRules as runAlertRuleEvaluation } from "./alert-engine";'
        ),
    },
    {
        "file": "artifacts/api-server/src/lib/workflow-executor.ts",
        "label": "workflow-executor.ts dry-run case",
        "old": (
            '    case "reconcile_orphaned_runs":\n'
            '      return { dryRun: true, reconciled: false, task: (node.data.task as string | undefined) ?? "reconcile_orphaned_runs", note: "dry run \u2014 reconciliation skipped" };\n'
        ),
        "new": (
            '    case "reconcile_orphaned_runs":\n'
            '      return { dryRun: true, reconciled: false, task: (node.data.task as string | undefined) ?? "reconcile_orphaned_runs", note: "dry run \u2014 reconciliation skipped" };\n'
            "\n"
            '    case "alert_evaluate_rules":\n'
            '      return { dryRun: true, evaluated: false, note: "dry run \u2014 alert rule evaluation skipped" };\n'
        ),
    },
    {
        "file": "artifacts/api-server/src/lib/workflow-executor.ts",
        "label": "workflow-executor.ts execution case",
        "old": (
            "        } else {\n"
            "          await reconcileOrphanedRuns();\n"
            "          await reconcileStalledPhases();\n"
            "          await reconcileLateStuckQueuedCompletions();\n"
            '          logger.info("wf-executor: reconcile_orphaned_runs completed");\n'
            "          output = { reconciled: true, task: rorTask };\n"
            "        }\n"
            "        break;\n"
            "      }\n"
        ),
        "new": (
            "        } else {\n"
            "          await reconcileOrphanedRuns();\n"
            "          await reconcileStalledPhases();\n"
            "          await reconcileLateStuckQueuedCompletions();\n"
            '          logger.info("wf-executor: reconcile_orphaned_runs completed");\n'
            "          output = { reconciled: true, task: rorTask };\n"
            "        }\n"
            "        break;\n"
            "      }\n"
            "\n"
            '      case "alert_evaluate_rules": {\n'
            "        await runAlertRuleEvaluation();\n"
            '        logger.info("wf-executor: alert_evaluate_rules completed");\n'
            "        output = { evaluated: true };\n"
            "        break;\n"
            "      }\n"
        ),
    },
    {
        "file": "artifacts/api-server/src/lib/seed-system-workflows.ts",
        "label": "seed-system-workflows.ts new entry",
        "old": (
            '        { id: "act",   type: "reconcile_orphaned_runs", position: { x: 100, y: 230 }, data: { nodeType: "reconcile_orphaned_runs", label: "Reconcile Late Stuck-Queued", task: "reconcile_late_stuck_queued" } },\n'
            '        { id: "end",   type: "end",                     position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },\n'
            "      ],\n"
            "      edges: [\n"
            '        { id: "e1", source: "start", target: "act" },\n'
            '        { id: "e2", source: "act",   target: "end" },\n'
            "      ],\n"
            "    },\n"
            "  },\n"
        ),
        "new": (
            '        { id: "act",   type: "reconcile_orphaned_runs", position: { x: 100, y: 230 }, data: { nodeType: "reconcile_orphaned_runs", label: "Reconcile Late Stuck-Queued", task: "reconcile_late_stuck_queued" } },\n'
            '        { id: "end",   type: "end",                     position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },\n'
            "      ],\n"
            "      edges: [\n"
            '        { id: "e1", source: "start", target: "act" },\n'
            '        { id: "e2", source: "act",   target: "end" },\n'
            "      ],\n"
            "    },\n"
            "  },\n"
            "  {\n"
            '    name: "__system__: Alert Rule Evaluation",\n'
            '    description: "Runs every 5 minutes to evaluate platform alert rules (DLQ backlog, billing failures, SLA breaches, event bus backlog, job failure rate) and deliver alerts via Exchange Online email and browser push. Replaces the old alert-engine.ts setInterval poller.",\n'
            '    triggerType: "schedule",\n'
            '    cron: "*/5 * * * *",\n'
            "    graph: {\n"
            "      nodes: [\n"
            '        { id: "start", type: "start",               position: { x: 100, y: 100 }, data: { nodeType: "start", label: "Cron */5 min" } },\n'
            '        { id: "act",   type: "alert_evaluate_rules", position: { x: 100, y: 230 }, data: { nodeType: "alert_evaluate_rules", label: "Evaluate Alert Rules" } },\n'
            '        { id: "end",   type: "end",                 position: { x: 100, y: 360 }, data: { nodeType: "end", label: "Done" } },\n'
            "      ],\n"
            "      edges: [\n"
            '        { id: "e1", source: "start", target: "act" },\n'
            '        { id: "e2", source: "act",   target: "end" },\n'
            "      ],\n"
            "    },\n"
            "  },\n"
        ),
    },
    {
        "file": "artifacts/api-server/src/routes/admin-observability.test.ts",
        "label": "admin-observability.test.ts mock rename",
        "old": "  initAlertEngine: vi.fn(),",
        "new": "  ensureAlertEngineReady: vi.fn(),",
    },
    {
        "file": "lib/db/src/schema/index.ts",
        "label": "schema.ts WfNode type union",
        "old": (
            "    // System (internal / seeded workflows)\n"
            '    | "reconcile_orphaned_runs"\n'
            '    | "kanban_auto_fire"\n'
            '    | "msp_dunning_advance"\n'
            '    | "msp_overage_meter"\n'
        ),
        "new": (
            "    // System (internal / seeded workflows)\n"
            '    | "reconcile_orphaned_runs"\n'
            '    | "kanban_auto_fire"\n'
            '    | "msp_dunning_advance"\n'
            '    | "msp_overage_meter"\n'
            '    | "alert_evaluate_rules"\n'
        ),
    },
    {
        "file": "artifacts/api-server/src/lib/node-type-registry.ts",
        "label": "node-type-registry.ts entry",
        "old": (
            "  {\n"
            '    nodeType: "reconcile_orphaned_runs",\n'
            "    isAIDependent: false,\n"
            '    description: "Reconciles orphaned workflow runs \u2014 no AI",\n'
            "  },\n"
        ),
        "new": (
            "  {\n"
            '    nodeType: "reconcile_orphaned_runs",\n'
            "    isAIDependent: false,\n"
            '    description: "Reconciles orphaned workflow runs \u2014 no AI",\n'
            "  },\n"
            "  {\n"
            '    nodeType: "alert_evaluate_rules",\n'
            "    isAIDependent: false,\n"
            '    description: "Evaluates platform alert rules and delivers via Exchange Online / push \u2014 no AI",\n'
            "  },\n"
        ),
    },
    {
        "file": "artifacts/api-server/src/routes/admin-workflows.ts",
        "label": "admin-workflows.ts nodeDef registration",
        "old": (
            '  nodeDef("reconcile_orphaned_runs", "Reconcile Orphaned Runs", "MSP / System", "Scans for workflow runs that are stuck in \'running\' state and resolves them (marks as failed or completes them if the job finished).", [{ key: "task", type: "string", description: "Reconciliation task name (informational)." }], ["reconciled", "task"], ["default"]),\n'
        ),
        "new": (
            '  nodeDef("reconcile_orphaned_runs", "Reconcile Orphaned Runs", "MSP / System", "Scans for workflow runs that are stuck in \'running\' state and resolves them (marks as failed or completes them if the job finished).", [{ key: "task", type: "string", description: "Reconciliation task name (informational)." }], ["reconciled", "task"], ["default"]),\n'
            '  nodeDef("alert_evaluate_rules", "Evaluate Alert Rules", "MSP / System", "Evaluates platform alert rules (DLQ backlog, billing failures, SLA breaches, event bus backlog, job failure rate) and delivers alerts via Exchange Online email and browser push.", [], ["evaluated"], ["default"]),\n'
        ),
    },
]


def main():
    any_missing = False
    for edit in EDITS:
        path = edit["file"]
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
        except FileNotFoundError:
            print(f"[MISSING FILE] {path}  (edit: {edit['label']})")
            any_missing = True
            continue

        if edit["new"] in content:
            print(f"[already applied] {edit['label']}")
            continue

        count = content.count(edit["old"])
        if count == 0:
            print(f"[NOT FOUND] {edit['label']} in {path}")
            print("  --> expected old text was not found verbatim. Skipping this edit.")
            any_missing = True
            continue
        if count > 1:
            print(
                f"[AMBIGUOUS] {edit['label']} in {path} matched {count} times, expected 1. Skipping."
            )
            any_missing = True
            continue

        content = content.replace(edit["old"], edit["new"], 1)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"[applied] {edit['label']}")

    print()
    if any_missing:
        print(
            "DONE WITH ISSUES -- one or more edits were skipped. See [NOT FOUND]/[AMBIGUOUS]/[MISSING FILE] above."
        )
        sys.exit(1)
    else:
        print("ALL EDITS APPLIED (or already present). Run `pnpm run typecheck` next.")
        sys.exit(0)


if __name__ == "__main__":
    main()
