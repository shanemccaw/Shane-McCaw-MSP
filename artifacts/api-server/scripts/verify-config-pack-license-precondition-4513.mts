#!/usr/bin/env node
/**
 * #4513 — live verification that quickstart-v1 is REFUSED on the real testbed
 * tenant (tenants.id = 2080, mccawsoft2.onmicrosoft.com — no Entra ID P1) before
 * anything is written: typed `license_required`, Security Defaults unchanged, no
 * workflow definition/version/run created.
 *
 * mccawsoft2 is also Shane's production M365 tenant, so this harness is built to
 * be unable to write: it calls the real run path ONLY after the shared
 * `prepareConfigPackRun` has already returned a precondition refusal, and aborts
 * otherwise. Every Graph call here is a read through the read app.
 *
 * Usage (from artifacts/api-server):
 *   pnpm exec tsx --env-file=../../.env.local scripts/verify-config-pack-license-precondition-4513.mts
 */

import { db, wfDefinitionsTable, wfRunsTable, wfVersionsTable } from "@workspace/db";
import { count, eq } from "drizzle-orm";
import { graphFetchForTenant } from "../src/lib/graph.ts";
import {
  ConfigPackError,
  prepareConfigPackRun,
  runConfigPackForCustomer,
} from "../src/lib/config-pack-orchestrator.ts";

const TESTBED_CUSTOMER_ID = 2080;
const PACK_KEY = "quickstart-v1";

async function securityDefaultsEnabled(tenantId: string): Promise<unknown> {
  const res = await graphFetchForTenant(tenantId, "/policies/identitySecurityDefaultsEnforcementPolicy");
  if (!res.ok) return `read failed: ${res.status}`;
  return ((await res.json()) as { isEnabled?: unknown }).isEnabled;
}

async function writeFootprint() {
  const [runs] = await db.select({ n: count() }).from(wfRunsTable);
  const [defs] = await db.select({ n: count() }).from(wfDefinitionsTable);
  const [versions] = await db.select({ n: count() }).from(wfVersionsTable);
  return { wfRuns: runs?.n ?? 0, wfDefinitions: defs?.n ?? 0, wfVersions: versions?.n ?? 0 };
}

async function main() {
  const ctx = await prepareConfigPackRun({ packKey: PACK_KEY, customerId: TESTBED_CUSTOMER_ID });
  const tenantId = ctx.customer.tenantId;
  console.log(`customer ${ctx.customer.id} (${ctx.customer.name}) tenant ${tenantId} isTestbed=${ctx.customer.isTestbed}`);
  console.log(`missingVariables: ${JSON.stringify(ctx.missingVariables)}`);
  console.log(`preconditionRefusal: ${ctx.preconditionRefusal?.code ?? "null"}`);

  if (ctx.preconditionRefusal?.code !== "license_required") {
    console.error("ABORT — prepareConfigPackRun did not refuse license_required. Not calling the run path against a live tenant.");
    process.exit(2);
  }
  console.log(`  message: ${ctx.preconditionRefusal.message}`);
  console.log(`  details: ${JSON.stringify(ctx.preconditionRefusal.details)}`);

  const sdBefore = await securityDefaultsEnabled(tenantId);
  const before = await writeFootprint();
  console.log(`before: securityDefaults.isEnabled=${String(sdBefore)} footprint=${JSON.stringify(before)}`);

  let refusedCode: string | null = null;
  try {
    await runConfigPackForCustomer({
      packKey: PACK_KEY,
      customerId: TESTBED_CUSTOMER_ID,
      triggeredBy: `verify-4513:${PACK_KEY}:customer:${TESTBED_CUSTOMER_ID}`,
    });
    console.error("FAIL — runConfigPackForCustomer did not refuse");
  } catch (err) {
    if (err instanceof ConfigPackError) {
      refusedCode = err.code;
      console.log(`runConfigPackForCustomer refused: ${err.code} — ${err.message}`);
    } else {
      console.error("FAIL — unexpected non-ConfigPackError:", err);
    }
  }

  const sdAfter = await securityDefaultsEnabled(tenantId);
  const after = await writeFootprint();
  console.log(`after:  securityDefaults.isEnabled=${String(sdAfter)} footprint=${JSON.stringify(after)}`);

  const unchanged = sdBefore === sdAfter && JSON.stringify(before) === JSON.stringify(after);
  const pass = refusedCode === "license_required" && unchanged;
  console.log(`\n── RESULT ── ${pass ? "PASS" : "FAIL"} (refused=${refusedCode}, tenant + engine state unchanged=${unchanged})`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err?.message ?? err);
  process.exit(1);
});
