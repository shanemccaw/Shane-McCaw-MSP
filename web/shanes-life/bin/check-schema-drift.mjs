#!/usr/bin/env node
// Standalone entry point for the live schema-drift audit (Git #3177). Runs the same check
// `runMigrations` already runs (non-fatally) on every real server boot, but as an explicit,
// scriptable command that exits non-zero on drift -- for a manual check, or a CI/pre-deploy step.
//
// See scripts/check-schema-drift.mjs for the real logic and the #3153 finding this exists for.

import { closePool, pool } from "../src/db.mjs";
import { auditSchemaDrift, formatDriftReport } from "../../../scripts/check-schema-drift.mjs";

try {
  const report = formatDriftReport(await auditSchemaDrift(pool));
  if (report) {
    console.error(report);
    process.exitCode = 1;
  } else {
    console.log("[check-schema-drift] OK -- no untracked tables/columns found live");
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
