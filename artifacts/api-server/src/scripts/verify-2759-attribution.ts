/**
 * verify-2759-attribution.ts — run the configuration-change attribution pass against
 * REAL stored diffs and print the real result (Git #2759).
 *
 * Same purpose and shape as `verify-1797-differ.ts`: exercise the real path from a
 * terminal, against the real local database, and print the evidence — including the
 * parts a summary would lose, like how many change requests and risk decisions actually
 * resolved to a configuration resource versus how many silently could not.
 *
 * It makes NO tenant call. Everything it touches is a local table: it READS
 * `msp_change_requests`, `msp_risk_decisions`, `cr_executions`, the pack/template chain
 * and the resource registry, and WRITES only `config_change_*`. It never modifies a
 * change request, a risk decision, or the sealed diff.
 *
 *   node --import tsx src/scripts/verify-2759-attribution.ts [diffRowId ...] [--endpoints]
 *
 *     (no ids)      attribute every sealed diff in the store
 *     --endpoints   also print the endpoint → resource-key resolution table, which is
 *                   the bridge everything else rests on
 */

import { db, configDiffsTable, configChangeScopesTable, configChangeLifecycleTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import {
  attributeDiff,
  readDiffVerdictRollup,
  resolveEndpointToResource,
} from "../lib/config-change-attribution.ts";

const line = (s = "") => console.log(s);

/** Endpoint shapes that really occur in the store, one per source that writes them. */
const SAMPLE_ENDPOINTS = [
  "GET /v1.0/identity/conditionalAccess/policies/custom-exemption",
  "/identity/conditionalAccess/policies/{{policyId}}",
  "/admin/sharepoint/settings",
  "/users/{{userId}}",
  "/groups/{{groupId}}/members/$ref",
  "exchange-online://Set-Mailbox",
  "/applications",
  "/security/secureScores",
  "/nonsense/not-a-registered-resource",
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const showEndpoints = args.includes("--endpoints");
  const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);

  if (showEndpoints) {
    line("── endpoint → resource key (registry lookup, not string surgery) ──");
    for (const e of SAMPLE_ENDPOINTS) {
      const r = await resolveEndpointToResource(e);
      line(`  ${e}`);
      line(`      ${r ? `${r.resourceKey}   object=${r.objectIdentity ?? "(any)"}   via ${r.matchedGraphPath}` : "(no registered resource — no scope written)"}`);
    }
    line();
  }

  const targets = ids.length > 0
    ? ids
    : (await db.select({ id: configDiffsTable.id }).from(configDiffsTable)
      .where(eq(configDiffsTable.status, "sealed")).orderBy(asc(configDiffsTable.id))).map((r) => r.id);

  if (targets.length === 0) {
    line("No sealed diffs in the store — nothing to attribute. That is a real, honest result, not a failure.");
    return;
  }

  for (const diffRowId of targets) {
    const res = await attributeDiff(diffRowId);
    line(`── diff ${diffRowId} (tenant ${res.tenantId}) ──`);
    line(`  window            ${res.window.from} → ${res.window.to}`);
    line(`  scopes derived    ${res.scopesDerived}   eligible for this window: ${res.scopesEligible}`);
    line(`  changes           ${res.changesAttributed}`);
    for (const [verdict, n] of Object.entries(res.verdicts)) line(`    ${verdict.padEnd(20)} ${n}`);
    line(`  lifecycle         opened ${res.lifecycleOpened} · resolved ${res.lifecycleResolved} · reopened ${res.lifecycleReopened}`);
    const rollup = await readDiffVerdictRollup(diffRowId);
    line(`  change requests   ${rollup.changeRequests.length ? rollup.changeRequests.map((c) => `${c.ref ?? c.id} (${c.changes})`).join(", ") : "(none explain any part of this diff)"}`);
    line(`  risk decisions    ${rollup.riskDecisions.length ? rollup.riskDecisions.map((c) => `${c.ref ?? c.id} (${c.changes})`).join(", ") : "(none cover any part of this diff)"}`);
    line(`  contested         ${rollup.contestedCount}`);
    line();
  }

  const scopes = await db.select().from(configChangeScopesTable);
  line(`── scope bridge: ${scopes.length} row(s) ──`);
  for (const s of scopes.slice(0, 25)) {
    line(`  #${s.id} ${s.sourceKind} cr=${s.changeRequestId ?? "-"} rbd=${s.riskDecisionId ?? "-"} ${s.resourceKey} obj=${s.objectIdentity ?? "(any)"} basis=${s.basis} ref=${s.basisRef ?? "-"}`);
  }

  const lifecycle = await db.select().from(configChangeLifecycleTable);
  const byStatus = lifecycle.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  line();
  line(`── lifecycle: ${lifecycle.length} tracked setting(s) — ${JSON.stringify(byStatus)}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
