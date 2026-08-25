/**
 * Git #1301 — compliance:zero-dlp-policies critical finding check.
 *
 * A deliberately-broken tenant (no CA, no DLP) produced a real critical CA
 * finding (identity:ca-policy-count's `caPolicyCount == 0`) but NO DLP finding:
 * compliance:weak-dlp-policies only counts the WEAK subset (container-side
 * PostFilter), so a tenant with ZERO DLP policies has nothing for it to count.
 * This check is the DLP-domain equivalent of the CA raw-count -> eq-0 ->
 * critical pattern, backed by a new UNFILTERED get-all-dlp-policies cmdlet.
 *
 * This replays the REAL shipped config
 * (lib/db/migrations/manual/2026-08-25-zero-dlp-policies-check-1301.sql) — the
 * mapping and severity_rules are read out of the migration file, not restated —
 * through the real applyMapping / classifySeverity / buildFindingTitle so the
 * behaviour is pinned by the shipped rows, not by the test's own copy.
 *
 * WHAT THIS FILE CANNOT DO: run the live PS container. Get-DlpCompliancePolicy
 * goes through the ps-execution container, which is not reachable from this
 * environment (the same reason compliance:weak-dlp-policies surfaces status
 * "error" on the testbed). It proves the api-server half — that a genuine
 * zero-policy result classifies critical and an errored result never fakes one.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";

// applyMapping/classifySeverity are pure, but monitor-executor.ts imports
// @workspace/db at module scope, which throws without a DATABASE_URL.
vi.mock("@workspace/db", () => ({
  db: {},
  monitorChecksTable: {},
  monitoringPackagesTable: {},
  monitoringPackageChecksTable: {},
  tenantMonitorProfilesTable: {},
  tenantCheckItemDetailsTable: {},
  tenantsTable: {},
}));

import { applyMapping, classifySeverity } from "../monitor-executor";
import type { MappingRule, SeverityRule } from "../monitor-executor";

const MIGRATION_PATH = fileURLToPath(
  new URL(
    "../../../../../lib/db/migrations/manual/2026-08-25-zero-dlp-policies-check-1301.sql",
    import.meta.url,
  ),
);

const CHECK_KEY = "compliance:zero-dlp-policies";

/** Pull the mapping / severity_rules JSON literals straight out of the shipped
 *  migration's INSERT so the test asserts against what actually ships. */
function readShippedConfig(): { mapping: MappingRule[]; severityRules: SeverityRule[] } {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  const jsonbBlocks = [...sql.matchAll(/'(\[[\s\S]*?\])'::jsonb/g)].map(m => m[1]);
  // The INSERT lists properties ([]), mapping, severity_rules in that order —
  // find the first block that mentions dlpPoliciesCount as a mapping, and the
  // first that carries a severity.
  const mapping = jsonbBlocks
    .map(b => JSON.parse(b))
    .find(arr => Array.isArray(arr) && arr.some((r: any) => r?.targetField === "dlpPoliciesCount"));
  const severityRules = jsonbBlocks
    .map(b => JSON.parse(b))
    .find(arr => Array.isArray(arr) && arr.some((r: any) => r?.severity && r?.expression));
  return { mapping, severityRules };
}

describe("#1301 compliance:zero-dlp-policies", () => {
  const { mapping, severityRules } = readShippedConfig();

  it("ships a count(Name) -> dlpPoliciesCount mapping (mirrors CA's count -> caPolicyCount)", () => {
    expect(mapping).toBeTruthy();
    expect(mapping).toContainEqual(
      expect.objectContaining({ transform: "count", sourceField: "Name", targetField: "dlpPoliciesCount" }),
    );
  });

  it("ships exactly one severity rule: dlpPoliciesCount == 0 -> critical, with a real label", () => {
    expect(severityRules).toHaveLength(1);
    const rule = severityRules[0];
    expect(rule.expression.replace(/\s/g, "")).toBe("dlpPoliciesCount==0");
    expect(rule.severity).toBe("critical");
    expect(rule.label && rule.label.length).toBeGreaterThan(0);
    // Never surfaces the raw key to the customer.
    expect(rule.label).not.toContain(CHECK_KEY);
  });

  it("classifies a genuine zero-policy tenant as critical (label becomes the finding title)", () => {
    // Unfiltered Get-DlpCompliancePolicy returned an empty list -> count 0.
    const extracted = applyMapping([], mapping, []);
    expect(extracted.dlpPoliciesCount).toBe(0);
    const match = classifySeverity(severityRules, extracted);
    expect(match?.severity).toBe("critical");
    // buildFindingTitle returns exactly this label for a matched rule (#408);
    // asserted here as a real string so the customer-facing headline is pinned.
    expect(match?.label).toBe("No DLP policies exist — data loss prevention is absent on this tenant");
  });

  it("does NOT fire for a tenant that has DLP policies (count > 0)", () => {
    const items = [{ Name: "Default DLP" }, { Name: "PII Rule" }, { Name: "Finance Rule" }];
    const extracted = applyMapping(items, mapping, []);
    expect(extracted.dlpPoliciesCount).toBe(3);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });

  it("an errored collection never fakes a critical (no dlpPoliciesCount -> no match)", () => {
    // Confirmed against real profile rows: an errored PS DLP check persists
    // extracted_properties=NULL, so dlpPoliciesCount is simply absent — the
    // eq-0 rule must not match a missing value into a false critical. (And
    // diagnostics-runner independently forces status=error -> info.)
    expect(classifySeverity(severityRules, {})).toBeNull();
    expect(classifySeverity(severityRules, { _rawGraphError: "cmdlet_unavailable" })).toBeNull();
  });
});
