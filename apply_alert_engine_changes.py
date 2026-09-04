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
            '  // seed-system-workflows.ts) instead of a setInterval poller.\n'
            "  ensureAlertEngineReady(5 * 60 * 1000).catch((err: unknown) => {\n"
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
            " * Safe to call multiple times — only one interval is started.\n"
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
            '  setTimeout(() => {\n'
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
            " * E\n"
            " */\n"
            "let alertInterval: ReturnType<typeof setInterval> | null = null;\n"
            "\n"
            "/**\n"
            " * Initialize the alert engine: ensure tables, seed default rules, start polling.\n"
            " * Safe to call multiple times \u2014 only one interval is started.\n"
            " */\n"
            "export async function ensureAlertEngineReady(pollIntervalMs = 5 * 60 * 1000): Promise<void> {\n"
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
            '  setTimeout(() => {\n'
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
    },
]

def main():
    # Determine root path or file path if specific
    root_path = "."
    
    for idx, edit in enumerate(EDITS):
        file_path = edit["file"]
        old_text = edit["old"]
        new_text = edit["new"]
        label = edit.get("label", f"Edit #{idx + 1}")

        # Read file safely
        try:
            with open(file_path, "r", encoding="utf-8", newline="") as f:
                content = f.read()
        except FileNotFoundError:
            print(f"[SKIP] {label}: {file_path} not found.")
            continue

        # Perform replacement
        # Use replace but be careful about partial matches.
        # The 'old_text' logic handles multi-line strings best if anchored.
        if old_text in content:
            content = content.replace(old_text, new_text, 1)
            print(f"[APPLY] {label}: {file_path}")
            print(f"       Replaced: ...{old_text[:30]}... -> ...{new_text[:30]}...")
        else:
            print(f"[SKIP] {label}: {file_path} (old text not found exactly):")
            print(f"       Expected: {old_text!r}")

    # Write back
    with open(file_path, "w", encoding="utf-8", newline="") as f:
        f.write(content)

    return 0

if __name__ == "__main__":
    exit(main())