#!/usr/bin/env node
/**
 * #2037 — Phase 3 verification: planOnly dry-run of the app-governance-v1
 * config pack (authored in
 * lib/db/migrations/manual/2026-09-12-app-governance-write-pack-2037.sql)
 * against the real testbed tenant (tenants.id = 1,
 * c4c814d4-3afe-441e-9145-62461d0a4fd3 / mccawsoft2.onmicrosoft.com). Same
 * shape #1925 used for its Phase 3 proof — buildConfigPackDryRun resolves
 * every step's real endpoint/body/variables and reads real live tenant state;
 * IT NEVER WRITES. No write app / write consent needed for a dry run.
 *
 * Usage (from artifacts/api-server):
 *   pnpm exec tsx scripts/verify-app-governance-write-pack-2037.mts
 */

import { buildConfigPackDryRun } from "../src/lib/config-pack-dry-run.ts";

const TESTBED_CUSTOMER_ID = 1;

async function main() {
  console.log("── planOnly dry-run: app-governance-v1 vs testbed tenant 1 ──────────");
  const dryRun = await buildConfigPackDryRun("app-governance-v1", TESTBED_CUSTOMER_ID);

  console.log(`pack: ${dryRun.packKey} (${dryRun.label})`);
  console.log(`gated: ${dryRun.gated}, executable: ${dryRun.executable}`);
  if (dryRun.missingOperatorVariables.length > 0) {
    console.log(`missing operator variables: ${dryRun.missingOperatorVariables.join(", ")}`);
  }
  console.log(`readAt: ${dryRun.readAt}`);
  console.log(`steps: ${dryRun.actions.length}`);

  let allBound = true;
  for (const a of dryRun.actions) {
    const boundOk = a.templateId !== null && a.method !== null && a.endpoint !== null;
    if (!boundOk) allBound = false;
    console.log(
      `\n[${a.checkKey ?? "(no check)"}] ${a.templateId}\n` +
      `  ${a.method} ${a.endpoint}\n` +
      `  changeKind=${a.changeKind} reversible=${a.reversible} gatedHere=${a.gatedHere}\n` +
      `  plannedWrite=${JSON.stringify(a.plannedWrite)}\n` +
      `  missingVariables=${JSON.stringify(a.missingVariables)}\n` +
      `  currentState.fetched=${a.currentState.fetched} status=${a.currentState.status ?? "n/a"} note=${a.currentState.note ?? ""}\n` +
      `  alreadySatisfied=${a.alreadySatisfied}`,
    );
  }

  console.log(`\n── RESULT ─────────────────────────────────────────────────────────`);
  console.log(allBound ? "PASS — every step resolved a real endpoint/method" : "FAIL — a step did not resolve");
  process.exit(allBound ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err?.message ?? err);
  if (err?.code) console.error("code:", err.code);
  process.exit(1);
});
