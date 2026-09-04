/**
 * Git #2763 — directory-surface coverage gap: 6 new Graph-backed monitor_checks
 * closing real config_resources gaps (surface='directory',
 * availability='available_now', check_coverage_count=0 before this build).
 *
 * This replays the REAL shipped config
 * (lib/db/migrations/manual/2026-09-04-directory-surface-coverage-2763.sql)
 * — mapping/severity_rules read straight out of the migration file, not
 * restated — through the real applyMapping / classifySeverity, mirroring
 * #2762's own test precedent, so behaviour is pinned by the shipped rows.
 *
 * Every "real shape" item below is a REAL object (or a trimmed version of one)
 * returned by a live GET against the testbed tenant (mccawsoft2.onmicrosoft.com,
 * tenants.id=1, app-only) during this session — see build-journal/2763.md for
 * the real probe transcript. The "risky shape" items are synthetic, used only
 * to prove each severity_rules branch actually fires — this tenant did not
 * happen to be in a risky state for every check at probe time (e.g. zero
 * cloud-licensing assignment errors, zero partner contracts today).
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
    "../../../../../lib/db/migrations/manual/2026-09-04-directory-surface-coverage-2763.sql",
    import.meta.url,
  ),
);

/** Pull each check's own mapping / severity_rules JSON literals out of the
 *  shipped migration's INSERT, keyed by check key — the INSERT lists several
 *  rows in one statement, so each row's own jsonb blocks (properties, mapping,
 *  severity_rules, engines, in that column order) are isolated by key first. */
function readShippedConfig(checkKey: string): { mapping: MappingRule[]; severityRules: SeverityRule[] } {
  // Normalize CRLF -> LF before any boundary matching below. This repo's
  // core.autocrlf=true (no .gitattributes override for .sql/.ts) means a
  // fresh checkout of this same migration file lands with CRLF line endings
  // on Windows — an LF-only "\n),\n(" boundary search silently never matches
  // then, and the row window falls through to the file's single trailing
  // "\n);", swallowing every row after the target one. Confirmed live: this
  // is exactly what made #2762's own copy of this same pattern
  // (compliance-surface-coverage-2762.test.ts) fail in this worktree despite
  // its own migration file being byte-for-byte unchanged since that build —
  // filed as a real finding rather than silently patched there. Normalizing
  // here makes THIS file's copy of the pattern correct regardless of which
  // line ending the checkout produces.
  const sql = readFileSync(MIGRATION_PATH, "utf8").replace(/\r\n/g, "\n");
  const keyIdx = sql.indexOf(`'${checkKey}',`);
  expect(keyIdx, `check key ${checkKey} not found in migration`).toBeGreaterThan(-1);
  // Each VALUES row ends with "),\n(" or ");" — take the row's own text window.
  const rowEnd = sql.indexOf("\n),\n(", keyIdx);
  const rowEndAlt = sql.indexOf("\n);", keyIdx);
  const end = rowEnd === -1 ? rowEndAlt : (rowEndAlt === -1 ? rowEnd : Math.min(rowEnd, rowEndAlt));
  const rowText = sql.slice(keyIdx, end === -1 ? undefined : end);
  const jsonbBlocks = [...rowText.matchAll(/'(\[[\s\S]*?\])'::jsonb/g)].map(m => m[1]);
  // Column order: properties, mapping, severity_rules, engines — all four are
  // jsonb arrays, so all four match the same regex.
  expect(jsonbBlocks.length, `expected 4 jsonb blocks (properties, mapping, severity_rules, engines) for ${checkKey}`).toBe(4);
  // Postgres unescapes a doubled '' to a literal ' when it parses the outer
  // SQL string literal, BEFORE the jsonb cast ever sees it — reading the raw
  // .sql file text bypasses that SQL-level unescaping, so it must be done
  // here too or countWhere('...') parses wrong (same #2762 precedent).
  const unescape = (s: string) => s.replace(/''/g, "'");
  const mapping = JSON.parse(unescape(jsonbBlocks[1]));
  const severityRules = JSON.parse(unescape(jsonbBlocks[2]));
  return { mapping, severityRules };
}

describe("#2763 directory:cloud-licensing-allotment-exhausted", () => {
  const { mapping, severityRules } = readShippedConfig("directory:cloud-licensing-allotment-exhausted");

  it("fires warning on the real testbed shape (allottedUnits=1, consumedUnits=1 IS exhausted — real tenant data)", () => {
    // Real observed shape: GET /admin/cloudLicensing/allotments on the testbed
    // tenant returned allottedUnits=1, consumedUnits=1 — genuinely exhausted.
    const extracted = applyMapping(
      [{ id: "a1", allottedUnits: 1, consumedUnits: 1 }],
      mapping, [],
    );
    expect(extracted.allotmentCount).toBe(1);
    expect(extracted.exhaustedAllotments).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("does not fire when a pool has headroom", () => {
    const extracted = applyMapping(
      [{ id: "a1", allottedUnits: 10, consumedUnits: 4 }],
      mapping, [],
    );
    expect(extracted.exhaustedAllotments).toBe(0);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });

  it("does not fire on an empty (never-allotted) pool (allottedUnits=0)", () => {
    const extracted = applyMapping(
      [{ id: "a1", allottedUnits: 0, consumedUnits: 0 }],
      mapping, [],
    );
    expect(extracted.exhaustedAllotments).toBe(0);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2763 directory:cloud-licensing-assignment-errors", () => {
  const { mapping, severityRules } = readShippedConfig("directory:cloud-licensing-assignment-errors");

  it("does not fire on the real testbed shape (zero errors today)", () => {
    const extracted = applyMapping([], mapping, []);
    expect(extracted.assignmentErrorCount).toBe(0);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });

  it("fires warning the moment an assignment error appears (synthetic risky shape)", () => {
    const extracted = applyMapping([{ id: "e1" }], mapping, []);
    expect(extracted.assignmentErrorCount).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });
});

describe("#2763 directory:cloud-licensing-assignment-disabled-plans", () => {
  const { mapping, severityRules } = readShippedConfig("directory:cloud-licensing-assignment-disabled-plans");

  it("does not fire on the real testbed shape (disabledServicePlanIds: [] on all 6)", () => {
    const extracted = applyMapping(
      [{ id: "s1", disabledServicePlanIds: [] }, { id: "s2", disabledServicePlanIds: [] }],
      mapping, [],
    );
    expect(extracted.assignmentCount).toBe(2);
    expect(extracted.assignmentsWithDisabledPlans).toBe(0);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });

  it("fires info when an assignment has a disabled service plan (synthetic risky shape)", () => {
    const extracted = applyMapping(
      [{ id: "s1", disabledServicePlanIds: ["f20fedf3-f3c3-43c3-8267-2bfdd51c0939"] }],
      mapping, [],
    );
    expect(extracted.assignmentsWithDisabledPlans).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });
});

describe("#2763 directory:service-health-active-incidents", () => {
  const { mapping, severityRules } = readShippedConfig("directory:service-health-active-incidents");

  it("fires warning on the real testbed shape (2 real unresolved advisories, 0 unresolved incidents)", () => {
    // Real observed shape: 100 issues, isResolved {true:98,false:2},
    // classification {advisory:62,incident:38}; the 2 unresolved were both
    // classification=advisory. This proves the warning rule does NOT
    // over-fire on an unresolved advisory.
    const extracted = applyMapping(
      [
        { id: "EX1441488", isResolved: false, classification: "advisory" },
        { id: "EX1465910", isResolved: false, classification: "advisory" },
        { id: "CW1218323", isResolved: true, classification: "advisory" },
      ],
      mapping, [],
    );
    expect(extracted.activeIssueCount).toBe(2);
    expect(extracted.activeIncidentCount).toBe(0);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });

  it("fires warning (not just info) when an unresolved issue is classification=incident (synthetic risky shape)", () => {
    const extracted = applyMapping(
      [{ id: "IC1", isResolved: false, classification: "incident" }],
      mapping, [],
    );
    expect(extracted.activeIncidentCount).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("does not fire when every issue is resolved", () => {
    const extracted = applyMapping(
      [{ id: "R1", isResolved: true, classification: "incident" }],
      mapping, [],
    );
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2763 directory:partner-delegated-admin-relationships", () => {
  const { mapping, severityRules } = readShippedConfig("directory:partner-delegated-admin-relationships");

  it("does not fire on the real testbed shape (zero contracts today)", () => {
    const extracted = applyMapping([], mapping, []);
    expect(extracted.partnerContractCount).toBe(0);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });

  it("fires info when a partner contract exists (synthetic risky shape)", () => {
    const extracted = applyMapping([{ id: "c1" }], mapping, []);
    expect(extracted.partnerContractCount).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });
});

describe("#2763 directory:org-contact-provisioning-errors", () => {
  const { mapping, severityRules } = readShippedConfig("directory:org-contact-provisioning-errors");

  it("does not fire on the real testbed shape (2 real contacts, both provisioning-error-free)", () => {
    // Real observed shape: GET /contacts on the testbed tenant returned 2
    // contacts, both with serviceProvisioningErrors: [] and
    // onPremisesProvisioningErrors: [].
    const extracted = applyMapping(
      [
        { id: "49d6f4dc-59b1-4abc-9adf-c967aebef0a6", serviceProvisioningErrors: [], onPremisesProvisioningErrors: [] },
        { id: "5b8decc4-369e-4d8b-bd31-16a4244251d3", serviceProvisioningErrors: [], onPremisesProvisioningErrors: [] },
      ],
      mapping, [],
    );
    expect(extracted.orgContactCount).toBe(2);
    expect(extracted.contactsWithProvisioningErrors).toBe(0);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });

  it("fires warning when a contact has a service provisioning error (synthetic risky shape)", () => {
    const extracted = applyMapping(
      [{ id: "c1", serviceProvisioningErrors: [{ errorDetail: "TargetOwnerMismatch" }], onPremisesProvisioningErrors: [] }],
      mapping, [],
    );
    expect(extracted.contactsWithProvisioningErrors).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("fires warning when a contact has an on-premises provisioning error (synthetic risky shape)", () => {
    const extracted = applyMapping(
      [{ id: "c1", serviceProvisioningErrors: [], onPremisesProvisioningErrors: [{ errorDetail: "PropertyConflict" }] }],
      mapping, [],
    );
    expect(extracted.contactsWithProvisioningErrors).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });
});
