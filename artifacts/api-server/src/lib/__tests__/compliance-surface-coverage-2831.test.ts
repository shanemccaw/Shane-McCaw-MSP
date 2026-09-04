/**
 * Git #2831 — real follow-up to #2762: 10 more PowerShell-backed
 * monitor_checks closing real config_resources gaps left open by #2762 on
 * DESIGN grounds (all had real, repeated `status='ok'` survey evidence
 * already — no fresh probe needed; #2830, the local dev-server outage, is
 * still open and was not re-attempted).
 *
 * This replays the REAL shipped config
 * (lib/db/migrations/manual/2026-09-04-compliance-surface-coverage-2831.sql)
 * — mapping/severity_rules read straight out of the migration file, not
 * restated — through the real applyMapping / classifySeverity, mirroring
 * #2762's own test precedent (compliance-surface-coverage-2762.test.ts),
 * which itself mirrors #1301's zero-dlp-policies-check precedent.
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
    "../../../../../lib/db/migrations/manual/2026-09-04-compliance-surface-coverage-2831.sql",
    import.meta.url,
  ),
);

/** Same row-isolation approach as #2762's own test file — see that file's
 *  comment for the CRLF-normalize and doubled-quote-unescape rationale. */
function readShippedConfig(checkKey: string): { mapping: MappingRule[]; severityRules: SeverityRule[] } {
  const sql = readFileSync(MIGRATION_PATH, "utf8").replace(/\r\n/g, "\n");
  const keyIdx = sql.indexOf(`'${checkKey}',`);
  expect(keyIdx, `check key ${checkKey} not found in migration`).toBeGreaterThan(-1);
  const rowEnd = sql.indexOf("\n),\n(", keyIdx);
  const rowEndAlt = sql.indexOf("\n);", keyIdx);
  const end = rowEnd === -1 ? rowEndAlt : (rowEndAlt === -1 ? rowEnd : Math.min(rowEnd, rowEndAlt));
  const rowText = sql.slice(keyIdx, end === -1 ? undefined : end);
  const jsonbBlocks = [...rowText.matchAll(/'(\[[\s\S]*?\])'::jsonb/g)].map(m => m[1]);
  expect(jsonbBlocks.length, `expected 4 jsonb blocks (properties, mapping, severity_rules, engines) for ${checkKey}`).toBe(4);
  const unescape = (s: string) => s.replace(/''/g, "'");
  const mapping = JSON.parse(unescape(jsonbBlocks[1]));
  const severityRules = JSON.parse(unescape(jsonbBlocks[2]));
  return { mapping, severityRules };
}

describe("#2831 compliance:policy-config-dlp-simulation-mode", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:policy-config-dlp-simulation-mode");

  it("fires critical when the tenant is opted into DLP simulation mode", () => {
    const extracted = applyMapping(
      [{ IsSingleInstance: "Yes", IsDlpSimulationOptedIn: true, serverDlpEnabled: true }],
      mapping, [],
    );
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("critical");
  });

  it("fires warning (not critical) when server-side DLP is disabled but simulation mode is off", () => {
    const extracted = applyMapping(
      [{ IsSingleInstance: "Yes", IsDlpSimulationOptedIn: false, serverDlpEnabled: false }],
      mapping, [],
    );
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("does not fire when simulation mode is off and server DLP is enabled", () => {
    const extracted = applyMapping(
      [{ IsSingleInstance: "Yes", IsDlpSimulationOptedIn: false, serverDlpEnabled: true }],
      mapping, [],
    );
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2831 compliance:dlp-rule-package-invalid", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:dlp-rule-package-invalid");

  it("fires warning when a rule package is invalid", () => {
    const extracted = applyMapping([{ Name: "Microsoft Rule Package", IsValid: false }], mapping, []);
    expect(extracted.invalidRulePackages).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("does not fire when every rule package is valid", () => {
    const extracted = applyMapping([{ Name: "Microsoft Rule Package", IsValid: true }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2831 compliance:file-plan-property-authority-disabled", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:file-plan-property-authority-disabled");

  it("fires info when an authority entry is disabled", () => {
    const extracted = applyMapping([{ Name: "Legal", Disabled: true }], mapping, []);
    expect(extracted.disabledFilePlanPropertyAuthorities).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });

  it("does not fire when no authority entry is disabled", () => {
    const extracted = applyMapping([{ Name: "Legal", Disabled: false }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2831 compliance:file-plan-property-category-disabled", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:file-plan-property-category-disabled");

  it("fires info when a category entry is disabled", () => {
    const extracted = applyMapping([{ Name: "Finance", Disabled: true }], mapping, []);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });

  it("does not fire when nothing is disabled", () => {
    const extracted = applyMapping([{ Name: "Finance", Disabled: false }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2831 compliance:file-plan-property-citation-disabled", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:file-plan-property-citation-disabled");

  it("fires info for a disabled citation", () => {
    const extracted = applyMapping([{ Name: "GDPR", Disabled: true, CitationUrl: "https://example.com" }], mapping, []);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });

  it("fires info for an enabled citation with no CitationUrl", () => {
    const extracted = applyMapping([{ Name: "GDPR", Disabled: false, CitationUrl: "" }], mapping, []);
    expect(extracted.citationsMissingUrl).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });

  it("does not fire for an enabled citation with a URL", () => {
    const extracted = applyMapping([{ Name: "GDPR", Disabled: false, CitationUrl: "https://example.com" }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2831 compliance:file-plan-property-department-disabled", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:file-plan-property-department-disabled");

  it("fires info when a department entry is disabled", () => {
    const extracted = applyMapping([{ Name: "HR", Disabled: true }], mapping, []);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("info");
  });

  it("does not fire when nothing is disabled", () => {
    const extracted = applyMapping([{ Name: "HR", Disabled: false }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2831 compliance:supervisory-review-policy-no-reviewers", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:supervisory-review-policy-no-reviewers");

  it("fires warning when a policy has no reviewers", () => {
    const extracted = applyMapping([{ Name: "Sales Review", Reviewers: [] }], mapping, []);
    expect(extracted.reviewPoliciesWithNoReviewers).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("does not fire when a policy has reviewers", () => {
    const extracted = applyMapping([{ Name: "Sales Review", Reviewers: ["reviewer@tenant.com"] }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2831 compliance:supervisory-review-rule-zero-sampling", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:supervisory-review-rule-zero-sampling");

  it("fires warning when SamplingRate is zero", () => {
    const extracted = applyMapping([{ Name: "Rule A", SamplingRate: 0 }], mapping, []);
    expect(extracted.reviewRulesWithZeroSampling).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("does not fire when SamplingRate is above zero", () => {
    const extracted = applyMapping([{ Name: "Rule A", SamplingRate: 25 }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2831 compliance:device-conditional-access-rule-weak-password", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:device-conditional-access-rule-weak-password");

  it("fires warning when a rule overrides the password requirement", () => {
    const extracted = applyMapping([{ Name: "Contractors", PasswordRequired: false }], mapping, []);
    expect(extracted.rulesNotRequiringPassword).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("does not fire when the rule requires a password", () => {
    const extracted = applyMapping([{ Name: "Contractors", PasswordRequired: true }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});

describe("#2831 compliance:device-config-rule-weak-password", () => {
  const { mapping, severityRules } = readShippedConfig("compliance:device-config-rule-weak-password");

  it("fires warning when a rule overrides the password requirement", () => {
    const extracted = applyMapping([{ Name: "Contractors", PasswordRequired: false }], mapping, []);
    expect(extracted.configRulesNotRequiringPassword).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("does not fire when the rule requires a password", () => {
    const extracted = applyMapping([{ Name: "Contractors", PasswordRequired: true }], mapping, []);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});
