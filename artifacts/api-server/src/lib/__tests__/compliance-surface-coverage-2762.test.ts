/**
 * Git #2762 — compliance-surface coverage gap: 10 new PowerShell-backed
 * monitor_checks closing real config_resources gaps (surface='compliance',
 * availability='available_now', check_coverage_count=0 before this build).
 *
 * This replays the REAL shipped config
 * (lib/db/migrations/manual/2026-09-04-compliance-surface-coverage-2762.sql)
 * — mapping/severity_rules read straight out of the migration file, not
 * restated — through the real applyMapping / classifySeverity, mirroring
 * #1301's zero-dlp-policies-check test precedent, so behaviour is pinned by
 * the shipped rows.
 *
 * WHAT THIS FILE CANNOT DO: run the live PS container (ca-ps-execution-dev
 * was unreachable this session — the local dev-server it depends on is down,
 * see build-journal/2762.md). It proves the api-server half of each check —
 * that the real mapping produces the right derived field from a given item
 * shape, and that the real severity_rules fire/don't-fire correctly against
 * it — using item shapes built from real evidence (#1793's
 * ps_capability_survey_results: live-observed property_names where the
 * tenant has live instances, derived_property_names from the real M365DSC
 * schema otherwise — see the migration's own header for which is which per
 * check).
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
    "../../../../../lib/db/migrations/manual/2026-09-04-compliance-surface-coverage-2762.sql",
    import.meta.url,
  ),
);

/** Pull each check's own mapping / severity_rules JSON literals out of the
 *  shipped migration's INSERT, keyed by check key — the INSERT lists several
 *  rows in one statement, so each row's own three jsonb blocks (properties,
 *  mapping, severity_rules, in that column order) are isolated by key first. */
function readShippedConfig(checkKey: string): { mapping: MappingRule[]; severityRules: SeverityRule[] } {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
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
  // SQL string literal, BEFORE the jsonb cast ever sees it (confirmed against
  // the real inserted row — `psql ... SELECT mapping FROM monitor_checks`
  // shows single-quoted countWhere expressions, not doubled). Reading the raw
  // .sql file text bypasses that SQL-level unescaping, so it must be done
  // here too or countWhere('...') parses as a doubled-quote string monitor-
  // executor.ts's own regex was never meant to match.
  const unescape = (s: string) => s.replace(/''/g, "'");
  const mapping = JSON.parse(unescape(jsonbBlocks[1]));
  const severityRules = JSON.parse(unescape(jsonbBlocks[2]));
  return { mapping, severityRules };
}

describe("#2762 compliance:retention-policy-coverage", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:retention-policy-coverage");

  it("fires critical on zero policies, no warning", () => {
    const extracted = applyMapping([], mapping, []);
    expect(extracted.retentionPolicyCount).toBe(0);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("critical");
  });

  it("fires warning (not critical) when a policy exists but is disabled", () => {
    const extracted = applyMapping([{ Name: "Legal Hold", Enabled: false }], mapping, []);
    expect(extracted.retentionPolicyCount).toBe(1);
    expect(extracted.disabledRetentionPolicies).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("does not fire for enabled policies", () => {
    const extracted = applyMapping([{ Name: "Legal Hold", Enabled: true }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2762 compliance:retention-rule-no-action", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:retention-rule-no-action");

  it("fires warning when a rule has no RetentionComplianceAction", () => {
    const extracted = applyMapping([{ Name: "Rule A", RetentionComplianceAction: null }], mapping, []);
    expect(extracted.rulesWithoutAction).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("does not fire when every rule has an action", () => {
    const extracted = applyMapping([{ Name: "Rule A", RetentionComplianceAction: "Keep" }], mapping, []);
    expect(extracted.rulesWithoutAction).toBe(0);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2762 compliance:dlp-rules-not-enforcing", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:dlp-rules-not-enforcing");

  it("flags a disabled rule as warning", () => {
    const extracted = applyMapping(
      [{ Name: "R1", Disabled: true, BlockAccess: true, Quarantine: false, RemoveRMSTemplate: false }],
      mapping, [],
    );
    expect(extracted.disabledDlpRules).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("flags a detection-only rule (no enforcement action) as info, not warning", () => {
    const extracted = applyMapping(
      [{ Name: "R2", Disabled: false, BlockAccess: false, Quarantine: false, RemoveRMSTemplate: false }],
      mapping, [],
    );
    expect(extracted.disabledDlpRules).toBe(0);
    expect(extracted.detectionOnlyDlpRules).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });

  it("does not fire for an enabled, enforcing rule", () => {
    const extracted = applyMapping(
      [{ Name: "R3", Disabled: false, BlockAccess: true, Quarantine: false, RemoveRMSTemplate: false }],
      mapping, [],
    );
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2762 compliance:app-conditional-access-policy-disabled", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:app-conditional-access-policy-disabled");

  it("fires info on zero policies", () => {
    const extracted = applyMapping([], mapping, []);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });

  it("fires warning when a policy is disabled", () => {
    const extracted = applyMapping([{ Name: "P1", Enabled: false }], mapping, []);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });
});

describe("#2762 compliance:device-config-policy-weak-password", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:device-config-policy-weak-password");

  it("fires warning when an enabled policy does not require a password", () => {
    const extracted = applyMapping([{ Name: "P1", Enabled: true, PasswordRequired: false }], mapping, []);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("does not fire when the policy requires a password", () => {
    const extracted = applyMapping([{ Name: "P1", Enabled: true, PasswordRequired: true }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });

  it("does not fire for a disabled policy lacking PasswordRequired (not actively enforced)", () => {
    const extracted = applyMapping([{ Name: "P1", Enabled: false, PasswordRequired: false }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2762 compliance:sensitive-info-type-custom", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:sensitive-info-type-custom");

  it("counts custom (non-out-of-box) types and fires info", () => {
    const extracted = applyMapping(
      [{ Id: "1", IsOutOfBox: true }, { Id: "2", IsOutOfBox: false }],
      mapping, [],
    );
    expect(extracted.sensitiveInfoTypeCount).toBe(2);
    expect(extracted.customSensitiveInfoTypes).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });

  it("does not fire when every type is out-of-box", () => {
    const extracted = applyMapping([{ Id: "1", IsOutOfBox: true }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2762 compliance:protection-alert-policy-disabled", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:protection-alert-policy-disabled");

  it("fires warning when a default (IsSystemRule) alert is disabled", () => {
    const extracted = applyMapping(
      [{ Name: "Malware campaign", Disabled: true, IsSystemRule: true }],
      mapping, [],
    );
    expect(extracted.disabledSystemAlerts).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("fires only info when a custom (non-system) alert is disabled", () => {
    const extracted = applyMapping(
      [{ Name: "Custom alert", Disabled: true, IsSystemRule: false }],
      mapping, [],
    );
    expect(extracted.disabledAlerts).toBe(1);
    expect(extracted.disabledSystemAlerts).toBe(0);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });

  it("does not fire when nothing is disabled", () => {
    const extracted = applyMapping(
      [{ Name: "A", Disabled: false, IsSystemRule: true }],
      mapping, [],
    );
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2762 compliance:role-group-empty-membership", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:role-group-empty-membership");

  it("fires info when a role group has zero members", () => {
    const extracted = applyMapping([{ Name: "Compliance Administrator", Members: [] }], mapping, []);
    expect(extracted.emptyRoleGroups).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });

  it("does not fire when every role group has members", () => {
    const extracted = applyMapping([{ Name: "Compliance Administrator", Members: ["user@tenant.com"] }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2762 compliance:record-tag-missing-reviewer", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:record-tag-missing-reviewer");

  it("fires warning for a regulatory tag with no reviewer", () => {
    const extracted = applyMapping(
      [{ Name: "GDPR Record", Regulatory: true, ReviewerEmail: "" }],
      mapping, [],
    );
    expect(extracted.regulatoryTagsWithoutReviewer).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("does not fire for a regulatory tag that has a reviewer", () => {
    const extracted = applyMapping(
      [{ Name: "GDPR Record", Regulatory: true, ReviewerEmail: "reviewer@tenant.com" }],
      mapping, [],
    );
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });

  it("does not fire for a non-regulatory tag with no reviewer", () => {
    const extracted = applyMapping(
      [{ Name: "General", Regulatory: false, ReviewerEmail: null }],
      mapping, [],
    );
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2762 compliance:retention-event-type-unlinked", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:retention-event-type-unlinked");

  it("fires info for an enabled event type with no linked compliance tags", () => {
    const extracted = applyMapping(
      [{ Name: "Employee Departure", Disabled: false, ComplianceTags: [] }],
      mapping, [],
    );
    expect(extracted.eventTypesWithoutTags).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });

  it("does not fire when tags are linked", () => {
    const extracted = applyMapping(
      [{ Name: "Employee Departure", Disabled: false, ComplianceTags: ["HR Record"] }],
      mapping, [],
    );
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });

  it("does not fire for a disabled event type lacking tags (not actively evaluated)", () => {
    const extracted = applyMapping(
      [{ Name: "Old Trigger", Disabled: true, ComplianceTags: [] }],
      mapping, [],
    );
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});
