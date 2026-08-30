/**
 * collect-config-snapshot.ts — run the #1796 tenant configuration snapshot
 * collector against a real tenant and print the real result.
 *
 * READ-ONLY against the customer tenant. Every Graph call is a GET and every
 * PowerShell call resolves to a `Get-*` entry in the ps-execution container's
 * code-owned allowlist. Nothing here writes to a tenant, and the only rows it
 * writes are the platform's own snapshot rows.
 *
 * The Workflow Engine node `config_snapshot_collect` is the production entry point
 * and the seeded `__system__: Tenant Configuration Snapshot` workflow is how an
 * operator runs it. This script exists for the same reason
 * `verify-1847-service-availability.ts` does: to exercise the real path from a
 * terminal, against the real tenant, and print the evidence — including every skip
 * with its reason, which is the part a summary would lose.
 *
 *   node --import tsx src/scripts/collect-config-snapshot.ts <tenants.id> [options]
 *
 *     --max <n>           cap how many registry resource types this run targets
 *     --transports a,b    restrict to transports (graph, powershell, …)
 *     --surfaces a,b      restrict to surfaces
 *     --resources k1,k2   collect only these resource keys
 *     --budget-ms <n>     wall-clock budget for the whole run
 *     --max-pages <n>     pages per resource before it is recorded `partial`
 *     --concurrency <n>   resources read at once
 *     --trigger-ref <s>   free text recorded on the snapshot header
 */

import {
  collectTenantConfigSnapshot,
  SnapshotPreconditionError,
  type SnapshotResourceOutcome,
} from "../lib/config-snapshot-collector.ts";

const tenantIdArg = process.argv[2];
if (!tenantIdArg || !/^\d+$/.test(tenantIdArg)) {
  console.error(
    "usage: collect-config-snapshot.ts <tenants.id> [--max n] [--transports graph] [--surfaces …] [--resources …] [--budget-ms n] [--max-pages n] [--concurrency n] [--trigger-ref s]",
  );
  process.exit(1);
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function numFlag(name: string): number | undefined {
  const v = flag(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`--${name} must be a positive number, got "${v}"`);
    process.exit(1);
  }
  return n;
}
function listFlag(name: string): string[] | undefined {
  const v = flag(name);
  if (!v) return undefined;
  const parts = v.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

const line = (s = "") => console.log(s);

async function main() {
  const tenantId = Number(tenantIdArg);
  line(`\n=== #1796 configuration snapshot — tenants.id ${tenantId} ===\n`);

  let lastLoggedAt = Date.now();

  const result = await collectTenantConfigSnapshot({
    tenantId,
    trigger: "manual",
    triggerRef: flag("trigger-ref") ?? "collect-config-snapshot.ts",
    maxResources: numFlag("max"),
    transports: listFlag("transports"),
    surfaces: listFlag("surfaces"),
    resourceKeys: listFlag("resources"),
    timeBudgetMs: numFlag("budget-ms"),
    maxPagesPerResource: numFlag("max-pages"),
    concurrency: numFlag("concurrency"),
    onProgress: (evt) => {
      // A heartbeat rather than a line per resource — a whole-tenant run targets
      // over a thousand types and a per-resource log would bury the result.
      const now = Date.now();
      if (evt.status === "collected" || now - lastLoggedAt > 15_000) {
        lastLoggedAt = now;
        line(
          `    [${String(evt.index + 1).padStart(4)}/${evt.total}] ${evt.resourceKey} → ${evt.status}` +
            (evt.objectCount ? ` (${evt.objectCount} objects)` : "") +
            (evt.skipReason ? ` [${evt.skipReason}]` : ""),
        );
      }
    },
  });

  line();
  line(`snapshot        : ${result.snapshotId} (row ${result.snapshotRowId})`);
  line(`tenant          : tenants.id ${result.tenantId} / entra ${result.entraTenantId}`);
  line(`status          : ${result.status}   isComplete: ${result.isComplete}`);
  line(`duration        : ${(result.durationMs / 1000).toFixed(1)}s`);
  line(`resource types  : ${result.resourceTypesTargeted} targeted`);
  line(`   collected    : ${result.resourceTypesCollected}`);
  line(`   empty        : ${result.resourceTypesEmpty}`);
  line(`   partial      : ${result.resourceTypesPartial}`);
  line(`   skipped      : ${result.resourceTypesSkipped}`);
  line(`   failed       : ${result.resourceTypesFailed}`);
  line(`objects stored  : ${result.objectCount}`);
  if (result.error) line(`run error       : ${result.error}`);

  // Every skip and failure, grouped by its REAL reason. This is the part #1796
  // asked to be recorded: a snapshot that cannot say why it is incomplete is
  // indistinguishable from a tenant that simply has less in it.
  const notOk = result.outcomes.filter((o) => o.status !== "collected" && o.status !== "empty");
  if (notOk.length > 0) {
    const byReason = new Map<string, SnapshotResourceOutcome[]>();
    for (const o of notOk) {
      const k = `${o.status}/${o.skipReason ?? "-"}`;
      const list = byReason.get(k);
      if (list) list.push(o);
      else byReason.set(k, [o]);
    }
    line(`\n--- every non-collected outcome, by real reason (${notOk.length} of ${result.resourceTypesTargeted}) ---`);
    for (const [reason, list] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
      line(`\n  ${reason}  × ${list.length}`);
      const sample = list[0];
      line(`    example  : ${sample.resourceKey}`);
      if (sample.httpStatus !== null) {
        line(`    http     : ${sample.httpStatus}${sample.errorCode ? ` ${sample.errorCode}` : ""}`);
      }
      if (sample.reasonDetail) line(`    reason   : ${sample.reasonDetail.slice(0, 300)}`);
    }
  }

  // Every resource that returned objects — a cheap fidelity sanity check that the
  // store really holds whole objects rather than a handful of stubs.
  const collected = result.outcomes
    .filter((o) => o.status === "collected" || o.status === "partial")
    .sort((a, b) => b.objectCount - a.objectCount);
  if (collected.length > 0) {
    line(`\n--- every resource that returned objects (${collected.length}) ---`);
    for (const o of collected) {
      line(`  ${String(o.objectCount).padStart(6)}  ${o.resourceKey}  [${o.readTransport}, ${o.durationMs}ms]`);
    }
  }
  line();
}

main().then(
  () => process.exit(0),
  (e) => {
    if (e instanceof SnapshotPreconditionError) {
      console.error(`\nPrecondition failed — nothing was written: ${e.message}\n`);
      process.exit(1);
    }
    console.error(e);
    process.exit(1);
  },
);
