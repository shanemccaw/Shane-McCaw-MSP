/**
 * Git #470 — copilot:sensitivity-labels-exist and governance:sensitivity-label-adoption
 * both returned severity "ok" on a genuine labelCount/sensitivityLabelCount of 0
 * because their stored severity_rules were empty arrays. This replays the fix's
 * severity_rules (lib/db/migrations/manual/2026-08-06-sensitivity-label-severity-rules-470.sql)
 * against the real extracted_properties captured for tenant
 * c4c814d4-3afe-441e-9145-62461d0a4fd3, run 2e21d478-8783-427c-968d-6b48199b0e96.
 */

import { describe, it, expect, vi } from "vitest";

// classifySeverity() is pure, but monitor-executor.ts imports @workspace/db at
// module scope, which throws without a DATABASE_URL (none in this environment).
vi.mock("@workspace/db", () => ({
  db: {},
  monitorChecksTable: {},
  monitoringPackagesTable: {},
  monitoringPackageChecksTable: {},
  tenantMonitorProfilesTable: {},
  tenantsTable: {},
}));

import { classifySeverity } from "./monitor-executor";
import type { SeverityRule } from "./monitor-executor";

// Mirrors the migration's UPDATE for copilot:sensitivity-labels-exist.
const SENSITIVITY_LABELS_EXIST_RULES: SeverityRule[] = [
  {
    severity: "warning",
    expression: "labelCount == 0",
    label:
      "No sensitivity labels are configured in this tenant — Copilot cannot classify or protect content sensitivity without labels in place",
  },
];

// Mirrors the migration's UPDATE for governance:sensitivity-label-adoption.
const SENSITIVITY_LABEL_ADOPTION_RULES: SeverityRule[] = [
  {
    severity: "warning",
    expression: "sensitivityLabelCount == 0",
    label:
      "No sensitivity labels have been adopted in this tenant — content is not being classified for governance or compliance",
  },
];

// governance:auto-labeling-coverage's real stored rule (reference — untouched by #470).
const AUTO_LABELING_COVERAGE_RULES: SeverityRule[] = [
  {
    severity: "warning",
    expression: "autoLabelingPolicyExists == false",
    label: "No sensitivity labels configured for automatic classification",
  },
];

describe("#470 — sensitivity-label severity rules", () => {
  it("copilot:sensitivity-labels-exist fires warning on the real zero-label run", () => {
    // Real extracted_properties from run 2e21d478-8783-427c-968d-6b48199b0e96.
    const extracted = {
      id_count: 0,
      id_first: null,
      id_values: [],
      _itemCount: 0,
      labelCount: 0,
      name_count: 0,
      name_first: null,
      name_values: [],
      isActive_count: 0,
      isActive_first: null,
      isActive_values: [],
    };
    expect(classifySeverity(SENSITIVITY_LABELS_EXIST_RULES, extracted)).toEqual({
      severity: "warning",
      label:
        "No sensitivity labels are configured in this tenant — Copilot cannot classify or protect content sensitivity without labels in place",
    });
  });

  it("copilot:sensitivity-labels-exist stays clean when labels genuinely exist", () => {
    expect(classifySeverity(SENSITIVITY_LABELS_EXIST_RULES, { labelCount: 3 })).toBe(null);
  });

  it("governance:sensitivity-label-adoption fires warning on the real zero-label run", () => {
    // Real extracted_properties from run 2e21d478-8783-427c-968d-6b48199b0e96.
    const extracted = {
      id_count: 0,
      id_first: null,
      id_values: [],
      _itemCount: 0,
      name_count: 0,
      name_first: null,
      name_values: [],
      sensitivityLabelCount: 0,
    };
    expect(classifySeverity(SENSITIVITY_LABEL_ADOPTION_RULES, extracted)).toEqual({
      severity: "warning",
      label:
        "No sensitivity labels have been adopted in this tenant — content is not being classified for governance or compliance",
    });
  });

  it("governance:sensitivity-label-adoption stays clean when labels genuinely exist", () => {
    expect(classifySeverity(SENSITIVITY_LABEL_ADOPTION_RULES, { sensitivityLabelCount: 4 })).toBe(null);
  });

  it("does not touch governance:auto-labeling-coverage's own reference behavior", () => {
    // Real extracted_properties from run 2e21d478-8783-427c-968d-6b48199b0e96 —
    // this check was already correct and its rule is unchanged by #470.
    const extracted = {
      id_count: 0,
      id_first: null,
      id_values: [],
      _itemCount: 0,
      autoLabelingPolicyExists: false,
    };
    expect(classifySeverity(AUTO_LABELING_COVERAGE_RULES, extracted)).toEqual({
      severity: "warning",
      label: "No sensitivity labels configured for automatic classification",
    });
  });
});
