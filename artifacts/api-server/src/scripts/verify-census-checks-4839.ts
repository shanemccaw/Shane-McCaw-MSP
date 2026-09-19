// Git #4839 — live verification that the four census checks now report a FILTERED count.
//
//   node artifacts/api-server/run-script.mjs src/scripts/verify-census-checks-4839.ts <tenant GUID>
//
// Runs sharepoint:site-label-coverage, sharepoint:storage-near-limit, teams:inactive-teams and
// teams:guest-membership through the same executeMonitorCheck() a scan uses (persistProfile=false,
// so the score is not disturbed), plus governance:sensitivity-label-adoption, and checks the
// cross-signal the issue was filed on: a tenant with zero sensitivity labels cannot have labelled sites.
// Exit 0 = every check ok and consistent; 2 = a check errored or the cross-check contradicts.

import { inArray } from "drizzle-orm";
import { db, monitorChecksTable } from "@workspace/db";
import { executeMonitorCheck } from "../lib/monitor-executor.ts";

const tenantId = process.argv[2];
if (!tenantId) {
  console.error("usage: verify-census-checks-4839.ts <tenant GUID>");
  process.exit(1);
}

const CENSUS: Record<string, string> = {
  "sharepoint:site-label-coverage": "sitesWithLabelCount",
  "sharepoint:storage-near-limit": "sitesNearStorageLimitCount",
  "teams:inactive-teams": "inactiveTeamCount",
  "teams:guest-membership": "teamsWithGuestsCount",
};
const LABELS_KEY = "governance:sensitivity-label-adoption";

const keys = [...Object.keys(CENSUS), LABELS_KEY];
const checks = await db.select().from(monitorChecksTable).where(inArray(monitorChecksTable.key, keys));
const missing = keys.filter((k) => !checks.some((c) => c.key === k));
if (missing.length) {
  console.error(`unknown check key(s): ${missing.join(", ")}`);
  process.exit(1);
}

const values: Record<string, unknown> = {};
let failed = false;
for (const key of keys) {
  const check = checks.find((c) => c.key === key)!;
  const started = Date.now();
  const result = await executeMonitorCheck({
    check,
    tenantId,
    triggerId: `verify-4839:${key}:${started}`,
    skipIdempotency: true,
    persistProfile: false,
  });
  const field = CENSUS[key] ?? "sensitivityLabelCount";
  values[key] = result.extractedProperties[field];
  if (result.status !== "ok") failed = true;
  console.log(JSON.stringify({
    checkKey: key,
    status: result.status,
    executor: check.executorType,
    [field]: result.extractedProperties[field],
    _itemCount: result.itemCount,
    errorMessage: result.errorMessage ?? null,
    elapsedMs: Date.now() - started,
  }));
}

const labels = values[LABELS_KEY];
const labelled = values["sharepoint:site-label-coverage"];
const consistent = !(labels === 0 && typeof labelled === "number" && labelled > 0);
console.log(JSON.stringify({ crossCheck: "no labels exist => no labelled sites", sensitivityLabelCount: labels, sitesWithLabelCount: labelled, consistent }));
process.exit(failed || !consistent ? 2 : 0);
