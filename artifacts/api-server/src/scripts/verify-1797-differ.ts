/**
 * verify-1797-differ.ts — run the configuration differ against two REAL snapshots and
 * print the real result (Git #1797).
 *
 * #1797 requires the differ to be proven live rather than argued for: "run against two
 * real testbed snapshots taken at different times and record the real result." This
 * script is that run. It exists for the same reason `verify-1847-service-availability.ts`
 * and `collect-config-snapshot.ts` do — to exercise the real path from a terminal against
 * real data and print the evidence, including the parts a summary would lose.
 *
 * It makes NO tenant call at all. The differ reads the snapshot store and writes the diff
 * store; both are local database tables. Whatever tenant risk existed was taken by the
 * collector, not here.
 *
 *   node --import tsx src/scripts/verify-1797-differ.ts <baseSnapshotRowId> <headSnapshotRowId> [options]
 *
 *     --mode <m>          drift | baseline_assessment | tenant_compare | promotion
 *     --resources k1,k2   restrict the comparison to these resource keys
 *     --derive-rules      MEASURE volatility from this diff and write observed_volatile
 *                         rules. Only legitimate when the two snapshots are of the same
 *                         tenant with no intervening configuration change.
 *     --dry-run-rules     compute the volatility candidates without writing them
 *     --determinism       run the SAME pair twice with the cache off and compare the two
 *                         results row for row, which is how "stable and ordered" is
 *                         checked rather than asserted
 *     --limit <n>         how many sample changes to print (default 25)
 */

import { db } from "@workspace/db";
import {
  tenantConfigSnapshotsTable,
  configDiffsTable,
  configDiffChangesTable,
  configDiffResourceStatusTable,
  type ConfigDiffMode,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { diffSnapshots, deriveVolatilityRules } from "../lib/config-snapshot-differ.ts";

const line = (s = "") => console.log(s);
const flag = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (n: string) => process.argv.includes(`--${n}`);

const baseArg = process.argv[2];
const headArg = process.argv[3];
if (!/^\d+$/.test(baseArg ?? "") || !/^\d+$/.test(headArg ?? "")) {
  console.error(
    "usage: verify-1797-differ.ts <baseSnapshotRowId> <headSnapshotRowId> "
    + "[--mode drift] [--resources k1,k2] [--derive-rules] [--dry-run-rules] "
    + "[--determinism] [--limit n]",
  );
  process.exit(1);
}

const baseId = Number(baseArg);
const headId = Number(headArg);
const mode = (flag("mode") ?? "drift") as ConfigDiffMode;
const limit = Number(flag("limit") ?? 25);
const resourceKeys = flag("resources")?.split(",").map((s) => s.trim()).filter(Boolean);

async function main() {
  line();
  line("=".repeat(78));
  line(`#1797 configuration differ — snapshot ${baseId} (base) vs ${headId} (head), mode "${mode}"`);
  line("=".repeat(78));

  // ── The inputs, stated from the database rather than assumed ──────────────
  const headers = await db.select().from(tenantConfigSnapshotsTable)
    .where(sql`${tenantConfigSnapshotsTable.id} in (${baseId}, ${headId})`);
  line();
  line("INPUTS (read back from tenant_config_snapshots)");
  for (const id of [baseId, headId]) {
    const h = headers.find((x) => x.id === id);
    if (!h) { line(`  ${id}: DOES NOT EXIST`); continue; }
    line(`  ${id === baseId ? "base" : "head"} #${h.id} ${h.snapshotId}`);
    line(`       tenant ${h.tenantId} (${h.entraTenantId})`);
    line(`       captured ${h.capturedAt.toISOString()}  status=${h.status}  is_complete=${h.isComplete}`);
    line(`       targeted=${h.resourceTypesTargeted} collected=${h.resourceTypesCollected} `
      + `empty=${h.resourceTypesEmpty} partial=${h.resourceTypesPartial} `
      + `skipped=${h.resourceTypesSkipped} failed=${h.resourceTypesFailed} objects=${h.objectCount}`);
  }

  // ── The run ───────────────────────────────────────────────────────────────
  const t0 = Date.now();
  const result = await diffSnapshots({
    mode, baseSnapshotRowId: baseId, headSnapshotRowId: headId,
    resourceKeys, trigger: "manual",
    triggerRef: "verify-1797-differ.ts",
    useCache: false,
  });

  // A `--determinism` re-run REPLACES the stored diff for this pair, so anything read
  // after that point must follow the surviving row.
  let effectiveDiffRowId = result.diffRowId;

  line();
  line("RESULT");
  line(`  diff row ${result.diffRowId}  ${result.diffId}`);
  line(`  status=${result.status}  is_complete=${result.isComplete}  ${result.durationMs}ms `
    + `(wall ${Date.now() - t0}ms)`);
  line(`  ruleset ${result.rulesetFingerprint.slice(0, 16)}… (${result.rulesetSize} active rules)`);
  line();
  line("  RESOURCE COMPARABILITY — the absence/unreadability rule, measured");
  line(`    comparable            ${result.resourceTypesCompared}`);
  line(`    partially_comparable  ${result.resourceTypesPartial}`);
  line(`    not_comparable        ${result.resourceTypesNotComparable}`);
  line();
  line("  OBJECTS");
  line(`    paired          ${result.objectsPaired}`);
  line(`    added           ${result.objectsAdded}`);
  line(`    removed         ${result.objectsRemoved}`);
  line(`    indeterminate   ${result.objectsIndeterminate}   (present one side, set known incomplete)`);
  line(`    unpairable      ${result.objectsUnpairable}   (content-hash identity)`);
  line();
  line("  CHANGES");
  line(`    total        ${result.changesTotal}`);
  line(`    significant  ${result.changesSignificant}`);
  line(`    ignored      ${result.changesIgnored}   (stored, not dropped)`);
  if (result.truncated) line("    *** TRUNCATED — result marked incomplete ***");

  // ── THE CORRECTNESS ASSERTION, checked against the stored rows ────────────
  //
  // The claim under test is not "the differ found things" but "the differ did not
  // fabricate a deletion". Every add/remove row must belong to a resource whose
  // comparability is `comparable`; any other row would be a false deletion of exactly the
  // kind #1797 says destroys trust in the feature.
  const [violation] = await db.select({
    n: sql<number>`count(*)::int`,
  }).from(configDiffChangesTable)
    .innerJoin(configDiffResourceStatusTable, and(
      eq(configDiffResourceStatusTable.diffRowId, configDiffChangesTable.diffRowId),
      eq(configDiffResourceStatusTable.resourceKey, configDiffChangesTable.resourceKey),
    ))
    .where(and(
      eq(configDiffChangesTable.diffRowId, result.diffRowId),
      sql`${configDiffChangesTable.changeKind} in ('object_added','object_removed')`,
      sql`${configDiffResourceStatusTable.comparability} <> 'comparable'`,
    ));

  line();
  line("CORRECTNESS CHECK — add/remove rows on a resource that was NOT fully comparable");
  line(`  violations: ${violation?.n ?? 0}   ${(violation?.n ?? 0) === 0 ? "PASS" : "*** FAIL ***"}`);

  // What the uncomparable resources actually said, so the number above is auditable.
  const notComparable = await db.select({
    resourceKey: configDiffResourceStatusTable.resourceKey,
    baseStatus: configDiffResourceStatusTable.baseStatus,
    baseSkipReason: configDiffResourceStatusTable.baseSkipReason,
    headStatus: configDiffResourceStatusTable.headStatus,
    headSkipReason: configDiffResourceStatusTable.headSkipReason,
    baseObjectCount: configDiffResourceStatusTable.baseObjectCount,
    headObjectCount: configDiffResourceStatusTable.headObjectCount,
  }).from(configDiffResourceStatusTable)
    .where(and(
      eq(configDiffResourceStatusTable.diffRowId, result.diffRowId),
      sql`${configDiffResourceStatusTable.comparability} = 'not_comparable'`,
      sql`(${configDiffResourceStatusTable.baseObjectCount} > 0
           OR ${configDiffResourceStatusTable.headObjectCount} > 0)`,
    )).orderBy(asc(configDiffResourceStatusTable.resourceKey)).limit(10);

  if (notComparable.length > 0) {
    line();
    line("  Resources with REAL OBJECTS on one side that were withheld rather than reported");
    line("  as deletions (this is the rule doing its job — each of these would have been a");
    line("  fabricated add/remove under a naive differ):");
    for (const r of notComparable) {
      line(`    ${r.resourceKey}`);
      line(`      base ${r.baseStatus}/${r.baseSkipReason ?? "-"} (${r.baseObjectCount} objects)`
        + `  head ${r.headStatus}/${r.headSkipReason ?? "-"} (${r.headObjectCount} objects)`);
    }
  }

  // ── Sample the real changes ───────────────────────────────────────────────
  const sample = await db.select().from(configDiffChangesTable)
    .where(and(
      eq(configDiffChangesTable.diffRowId, result.diffRowId),
      eq(configDiffChangesTable.isIgnored, false),
    ))
    .orderBy(asc(configDiffChangesTable.sequence)).limit(limit);

  line();
  line(`SIGNIFICANT CHANGES (first ${sample.length} of ${result.changesSignificant}, in stored order)`);
  for (const c of sample) {
    const trim = (v: unknown) => {
      const s = JSON.stringify(v);
      return s === undefined ? "-" : s.length > 90 ? `${s.slice(0, 90)}…` : s;
    };
    line(`  #${c.sequence} [${c.changeKind}] ${c.resourceKey}`);
    line(`      object ${c.objectDisplayName ?? c.objectIdentity} (${c.identityStrategy})`);
    if (c.propertyPath) line(`      ${c.propertyPath}`);
    if (c.oldValuePresent) line(`        old: ${trim(c.oldValue)}`);
    if (c.newValuePresent) line(`        new: ${trim(c.newValue)}`);
  }

  const byKind = await db.select({
    kind: configDiffChangesTable.changeKind,
    ignored: configDiffChangesTable.isIgnored,
    n: sql<number>`count(*)::int`,
  }).from(configDiffChangesTable)
    .where(eq(configDiffChangesTable.diffRowId, result.diffRowId))
    .groupBy(configDiffChangesTable.changeKind, configDiffChangesTable.isIgnored)
    .orderBy(sql`count(*) desc`);
  if (byKind.length > 0) {
    line();
    line("CHANGES BY KIND");
    for (const k of byKind) line(`  ${String(k.n).padStart(7)}  ${k.kind}${k.ignored ? "  (ignored)" : ""}`);
  }

  const topPaths = await db.select({
    resourceKey: configDiffChangesTable.resourceKey,
    path: configDiffChangesTable.propertyPathNormalized,
    objects: sql<number>`count(distinct ${configDiffChangesTable.objectIdentity})::int`,
    n: sql<number>`count(*)::int`,
  }).from(configDiffChangesTable)
    .where(and(
      eq(configDiffChangesTable.diffRowId, result.diffRowId),
      eq(configDiffChangesTable.isIgnored, false),
      sql`${configDiffChangesTable.propertyPathNormalized} is not null`,
    ))
    .groupBy(configDiffChangesTable.resourceKey, configDiffChangesTable.propertyPathNormalized)
    .orderBy(sql`count(distinct ${configDiffChangesTable.objectIdentity}) desc`).limit(15);
  if (topPaths.length > 0) {
    line();
    line("MOST-MOVED PROPERTY PATHS — the measurement that produces observed_volatile rules");
    for (const p of topPaths) {
      line(`  ${String(p.objects).padStart(6)} objects  ${String(p.n).padStart(6)} rows  ${p.resourceKey}  ${p.path}`);
    }
  }

  // ── Determinism, checked rather than asserted ─────────────────────────────
  if (has("determinism")) {
    line();
    line("DETERMINISM — same pair, cache off, twice; compared row for row");
    // `useCache: false` REPLACES the stored diff for this key (the key is unique), so run
    // 1's rows must be read out BEFORE run 2 deletes them. `diff_row_id` is deliberately
    // not among the selected columns: it differs by construction and comparing it would
    // fail every time while proving nothing.
    const rowsOf = (id: number) => db.select({
      sequence: configDiffChangesTable.sequence,
      resourceKey: configDiffChangesTable.resourceKey,
      objectIdentity: configDiffChangesTable.objectIdentity,
      changeKind: configDiffChangesTable.changeKind,
      propertyPath: configDiffChangesTable.propertyPath,
      oldValue: configDiffChangesTable.oldValue,
      newValue: configDiffChangesTable.newValue,
      isIgnored: configDiffChangesTable.isIgnored,
    }).from(configDiffChangesTable).where(eq(configDiffChangesTable.diffRowId, id))
      .orderBy(asc(configDiffChangesTable.sequence));

    const a = await rowsOf(result.diffRowId);

    const second = await diffSnapshots({
      mode, baseSnapshotRowId: baseId, headSnapshotRowId: headId,
      resourceKeys, trigger: "manual",
      triggerRef: "verify-1797-differ.ts determinism re-run",
      useCache: false,
    });
    const b = await rowsOf(second.diffRowId);
    // Run 1's row no longer exists; everything below must read run 2's.
    effectiveDiffRowId = second.diffRowId;
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    line(`  run 1: diff ${result.diffRowId}, ${a.length} rows`);
    line(`  run 2: diff ${second.diffRowId}, ${b.length} rows`);
    line(`  identical (sequence, kind, path and both values, row for row): `
      + `${sa === sb ? "YES — PASS" : "NO — *** FAIL ***"}`);
    if (sa !== sb) {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
          line(`  first divergence at index ${i}:`);
          line(`    run 1: ${JSON.stringify(a[i])}`);
          line(`    run 2: ${JSON.stringify(b[i])}`);
          break;
        }
      }
    }
  }

  // ── Rule 4: derive the noise ruleset from the measurement ─────────────────
  if (has("derive-rules") || has("dry-run-rules")) {
    line();
    line(`VOLATILITY RULES ${has("dry-run-rules") ? "(dry run — nothing written)" : "(written)"}`);
    const derived = await deriveVolatilityRules({
      diffRowId: effectiveDiffRowId,
      dryRun: has("dry-run-rules"),
    });
    if (derived.length === 0) {
      line("  none — no property path moved in enough distinct objects to be called volatile.");
    }
    for (const r of derived) {
      line(`  ${String(r.objectCount).padStart(6)} objects  ${r.resourceKey}  ${r.propertyPathPattern}`
        + `${r.created ? "  [created]" : has("dry-run-rules") ? "" : "  [already existed]"}`);
    }
  }

  // ── Read the stored header back, rather than trusting the return value ────
  const [stored] = await db.select().from(configDiffsTable)
    .where(eq(configDiffsTable.id, effectiveDiffRowId)).limit(1);
  line();
  line("STORED HEADER, re-read from config_diffs");
  line(`  status=${stored.status} sealed_at=${stored.sealedAt?.toISOString() ?? "-"} `
    + `is_complete=${stored.isComplete} differ_version=${stored.differVersion}`);
  line(`  changes_total=${stored.changesTotal} significant=${stored.changesSignificant} `
    + `ignored=${stored.changesIgnored}`);
  if (stored.notes) line(`  notes: ${stored.notes}`);

  line();
  line("done.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
