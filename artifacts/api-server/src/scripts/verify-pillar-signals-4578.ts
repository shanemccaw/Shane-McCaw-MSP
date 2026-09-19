// Git #4578 — live verification of the pillar page's SIGNALS grid, CONFIG DRIFT
// BASELINE panel and Licensing SKU ledger against the REAL local database.
//
//   node artifacts/api-server/run-script.mjs src/scripts/verify-pillar-signals-4578.ts <tenants.id>
//
// (the testbed tenant "McCawSoft" is tenants.id 2080)
//
// Read-only: calls buildPillarSummary — the exact function behind
// GET /api/portal/pillars — and cross-checks every card it produced against the
// raw tenant_monitor_profiles / drift_* rows. The dispatch's requirement is the
// headline: an unmeasurable card is unmeasurable with its real reason, never a
// zero. Exits 1 on any failed assertion.

import { and, desc, eq } from "drizzle-orm";
import { db, tenantsTable, tenantMonitorProfilesTable, driftCollectionStatusTable } from "@workspace/db";
import { buildPillarSummary } from "../lib/pillar-summary-stats.ts";
import { resolveLicenseSkuLedger } from "../lib/license-waste-source.ts";
import { PILLAR_SIGNAL_SPECS } from "../lib/pillar-signal-specs.ts";

const tenantRowId = Number(process.argv[2]);
if (!Number.isInteger(tenantRowId) || tenantRowId <= 0) {
  console.error("usage: verify-pillar-signals-4578.ts <tenants.id>");
  process.exit(1);
}

const [tenant] = await db
  .select({ id: tenantsTable.id, name: tenantsTable.customerName, tenantId: tenantsTable.tenantId })
  .from(tenantsTable)
  .where(eq(tenantsTable.id, tenantRowId))
  .limit(1);
if (!tenant?.tenantId) {
  console.error(`tenants.id=${tenantRowId} not found or has no M365 tenant id`);
  process.exit(1);
}

let failures = 0;
let checks = 0;
function assert(cond: boolean, message: string, detail?: unknown) {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.error(`  FAIL  ${message}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}

console.log(`Verifying tenant ${tenant.name} (tenants.id=${tenant.id}, ${tenant.tenantId})`);
const payload = await buildPillarSummary(tenant.id);

// ── SIGNALS ──────────────────────────────────────────────────────────────────
const latestRow = new Map<string, { status: string; props: Record<string, unknown> }>();
{
  const rows = await db
    .select({
      checkKey: tenantMonitorProfilesTable.checkKey,
      status: tenantMonitorProfilesTable.status,
      props: tenantMonitorProfilesTable.extractedProperties,
    })
    .from(tenantMonitorProfilesTable)
    .where(eq(tenantMonitorProfilesTable.tenantId, tenant.tenantId))
    .orderBy(desc(tenantMonitorProfilesTable.collectedAt));
  for (const r of rows) {
    if (!latestRow.has(r.checkKey)) {
      latestRow.set(r.checkKey, { status: r.status, props: (r.props ?? {}) as Record<string, unknown> });
    }
  }
}

const tally = { total: 0, measured: 0, na: 0, byReason: {} as Record<string, number>, byTier: {} as Record<string, number> };
const cards = new Map<string, ReturnType<typeof flat>[number]>();
function flat() {
  return payload.pillars.flatMap((p) =>
    (p.signals?.groups ?? []).flatMap((g) => g.cards.map((card) => ({ pillar: p.pillar, card }))),
  );
}
for (const { pillar, card } of flat()) {
  tally.total += 1;
  tally.byTier[card.tier] = (tally.byTier[card.tier] ?? 0) + 1;
  cards.set(`${pillar}:${card.checkKey}`, { pillar, card });
  const row = latestRow.get(card.checkKey);

  if (card.tier === "na") {
    tally.na += 1;
    tally.byReason[card.unavailableReason ?? "?"] = (tally.byReason[card.unavailableReason ?? "?"] ?? 0) + 1;
    assert(card.value == null && card.text == null, `${card.checkKey}: an unmeasurable card carries no value or text`, card);
    assert(card.delta == null, `${card.checkKey}: an unmeasurable card carries no delta`, card);
    assert(!!card.unavailableReason, `${card.checkKey}: an unmeasurable card carries its real reason`, card);
    if (row && row.status !== "ok") {
      const expected = { license_gap: "license_gap", service_not_configured: "service_not_configured", error: "check_error" }[row.status];
      if (expected) assert(card.unavailableReason === expected, `${card.checkKey}: reason matches stored status ${row.status}`, card);
    }
    if (!row) assert(["never_run", "inactive_in_catalog", "not_in_scan_package"].includes(card.unavailableReason ?? ""), `${card.checkKey}: never-observed reason`, card);
  } else {
    tally.measured += 1;
    assert(row?.status === "ok" || row?.status === "partial", `${card.checkKey}: a measured card is backed by an ok row`, { card, row: row?.status });
    assert(card.value != null || card.text != null, `${card.checkKey}: a measured card shows something`, card);
    const spec = PILLAR_SIGNAL_SPECS[pillar as keyof typeof PILLAR_SIGNAL_SPECS]
      .flatMap((g) => g.cards)
      .find((c) => c.checkKey === card.checkKey)!;
    if (spec.value.format === "count" && row) {
      const raw = row.props[spec.value.field];
      assert(card.value === raw, `${card.checkKey}: value ${card.value} === stored ${spec.value.field}=${JSON.stringify(raw)}`, card);
    }
  }
}
console.log(`\nSIGNALS  ${tally.total} cards · ${tally.measured} measured · ${tally.na} unmeasurable`);
console.log("  by tier  ", tally.byTier);
console.log("  by reason", tally.byReason);
// Reasons that could mean a spec/field mismatch rather than a real gap — list them so they are eyeballed.
for (const reason of ["no_data", "non_numeric_value", "gate_skipped"]) {
  const which = flat().filter(({ card }) => card.unavailableReason === reason).map(({ pillar, card }) => pillar + "/" + card.checkKey);
  console.log("  " + reason + ":", which.join(", "));
}
assert(tally.total === 180, "all 180 design cards are served", tally.total);

// The named cases the dispatch asks for, live.
const pick = (pillar: string, key: string) => cards.get(`${pillar}:${key}`)?.card;
const expectCard = (pillar: string, key: string, want: Record<string, unknown>) => {
  const card = pick(pillar, key);
  assert(!!card, `${pillar}/${key} is on the grid`);
  if (card) for (const [k, v] of Object.entries(want)) assert((card as unknown as Record<string, unknown>)[k] === v, `${key}: ${k} === ${JSON.stringify(v)}`, card);
  return card;
};
console.log("\nNamed cases");
const gap = expectCard("security", "identity:mfa-registration", { tier: "na", value: null, unavailableReason: "license_gap" });
console.log("  licence gap        ", gap && { reason: gap.unavailableReason, feature: gap.licenseFeature });
const svc = expectCard("health", "devices:enrollment-status", { tier: "na", value: null, unavailableReason: "service_not_configured" });
console.log("  service not set up ", svc && { reason: svc.unavailableReason, service: svc.serviceName });
const inactive = expectCard("governance", "sharepoint:anonymous-links", { tier: "na", value: null, unavailableReason: "inactive_in_catalog" });
console.log("  inactive in catalog", inactive && inactive.unavailableReason);
const never = pick("security", "exchange:auto-forwarding-rules");
assert(!!never && never.tier === "na" && never.value == null && (never.unavailableReason === "never_run" || never.unavailableReason === "not_in_scan_package"), "exchange:auto-forwarding-rules: never observed → unmeasurable", never);
console.log("  never observed     ", never && never.unavailableReason);
const zero = expectCard("governance", "teams:ownerless-teams", { value: 0 });
console.log("  REAL zero stays 0  ", zero && { value: zero.value, tier: zero.tier });
const bad = pick("security", "identity:ca-mfa-coverage");
console.log("  security defaults  ", bad && { value: bad.value, reason: bad.unavailableReason, tier: bad.tier });
const nonNumeric = pick("licensing", "sharepoint:storage-utilization");
console.log("  non-numeric field  ", nonNumeric && { value: nonNumeric.value, reason: nonNumeric.unavailableReason });

// ── DRIFT ────────────────────────────────────────────────────────────────────
console.log("\nDRIFT");
const statusRows = await db
  .select()
  .from(driftCollectionStatusTable)
  .where(eq(driftCollectionStatusTable.tenantId, tenant.tenantId));
const served = payload.pillars.flatMap((p) => p.drift.map((d) => ({ pillar: p.pillar, ...d })));
for (const s of statusRows) {
  const d = served.find((x) => x.domainKey === s.domainKey);
  console.log(`  ${s.domainKey.padEnd(28)} stored=${s.status}${s.reason ? `(${s.reason})` : ""}  served=`, d ? { pillar: d.pillar, state: d.state, reason: d.reason, deviations: d.deviationCount } : "NOT SERVED (check resolves to no pillar)");
  if (d) {
    const want = s.status === "not_comparable" ? "not_comparable" : s.status === "error" ? "error" : "tracked";
    assert(d.state === want, `${s.domainKey}: served state ${d.state} matches collector status ${s.status}`, d);
    if (want !== "tracked") assert(d.reason === s.reason, `${s.domainKey}: the collector's own reason is carried`, d);
  }
}
assert(statusRows.length === 0 || served.length > 0, "at least one drift domain reaches a pillar page");

// ── LEDGER ───────────────────────────────────────────────────────────────────
console.log("\nSKU LEDGER");
const ledger = await resolveLicenseSkuLedger(tenant.tenantId);
const wire = payload.licenseSkuLedger;
assert((ledger == null) === (wire == null), "ledger presence matches resolveLicenseSkuLedger");
if (ledger && wire) {
  assert(wire.rows.length === ledger.rows.length, "ledger row count matches", { wire: wire.rows.length, direct: ledger.rows.length });
  assert(wire.excluded.length === ledger.excluded.length, "ledger excluded count matches", { wire: wire.excluded.length, direct: ledger.excluded.length });
  console.log(`  ${wire.rows.length} priced row(s), ${wire.excluded.length} excluded`, wire.excluded.map((e) => `${e.skuPartNumber}(${e.reason})`).join(", "));
}

// Same payload also proves the cards' history came from stored rows.
const [{ n }] = (await db.execute(
  (await import("drizzle-orm")).sql`select count(*)::int as n from tenant_monitor_profiles where tenant_id = ${tenant.tenantId}`,
)).rows as { n: number }[];
console.log(`\n${checks} assertions, ${failures} failed (over ${n} stored observations)`);
void and;
process.exit(failures === 0 ? 0 : 1);
