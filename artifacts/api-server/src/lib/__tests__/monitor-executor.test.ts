/**
 * monitor-executor.test.ts
 *
 * Tests: pagination exhaustion, partial failure, idempotency,
 * consent-revoked branch, air-gapped ingestion, severity classification,
 * output shape validation, mapping/property extraction.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import {
  evalConditionGrammar,
  validateOutputShape,
  classifySeverity,
  applyMapping,
  graphFetchPaginated,
  executeMonitorCheck,
  executeMonitoringPackage,
  parseCsvReport,
  isCsvReportResponse,
  appendQueryParams,
  sharePointPrefixFromDomain,
} from "../monitor-executor";
import type { SeverityRule, MappingRule } from "../monitor-executor";
import { logger } from "../logger";

// ── Mock external dependencies ─────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        orderBy: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ profileId: "test-uuid" }]),
        }),
        // #1871's tenant_azure_reach upsert. Resolves to a plain array like the
        // real driver so `await`ing the builder does not hang.
        onConflictDoUpdate: vi.fn().mockResolvedValue([]),
        returning: vi.fn().mockResolvedValue([{ profileId: "test-uuid" }]),
      }),
    }),
  },
  monitorChecksTable: {},
  monitoringPackagesTable: {},
  monitoringPackageChecksTable: {},
  tenantMonitorProfilesTable: {},
  tenantAzureReachTable: { tenantId: "tenant_id" },
  tenantsTable: {},
  // #1847 — service-availability.ts reads the tenant's /subscribedSkus collection
  // and writes the tenant-level service row. The db mock above returns no rows, so
  // the entitlement resolves "unknown" and the verdict falls back to the wire
  // signature alone — which is exactly the branch these tests want to pin.
  tenantCheckItemDetailsTable: {},
  tenantServiceAvailabilityTable: {},
  TENANT_SERVICE_KEYS: ["intune"],
  TENANT_SERVICE_STATES: [
    "available",
    "not_licensed",
    "not_configured",
    "permission_denied",
    "service_outage",
    "unknown",
  ],
  TENANT_SERVICE_EVIDENCE_BASIS: ["wire-signature", "service-plan", "combined"],
}));

vi.mock("../graph", () => ({
  graphFetchForTenant: vi.fn(),
  ConsentRevokedError: class ConsentRevokedError extends Error {
    tenantId: string;
    constructor(tenantId: string) {
      super(`Consent revoked for ${tenantId}`);
      this.name = "ConsentRevokedError";
      this.tenantId = tenantId;
    }
  },
  LicenseGapError: class LicenseGapError extends Error {
    tenantId: string;
    feature: string;
    graphErrorCode: string | null;
    rawBody: string;
    constructor(tenantId: string, feature: string, graphErrorCode: string | null, rawBody: string) {
      super(`License gap for ${tenantId}: ${feature}`);
      this.name = "LicenseGapError";
      this.tenantId = tenantId;
      this.feature = feature;
      this.graphErrorCode = graphErrorCode;
      this.rawBody = rawBody;
    }
  },
  markTenantConsentRevoked: vi.fn().mockResolvedValue(undefined),
  // Best-effort initial-domain lookup the sharepoint-admin executor falls back to
  // when tenants.domain is absent (the db mock returns no rows). Defaults to null
  // — "no initial domain on file" — so tests must opt in to a resolvable prefix.
  getInitialDomainForTenant: vi.fn().mockResolvedValue(null),
}));

// The real sharepoint-admin.ts makes live certificate-authenticated CSOM calls;
// only its shape matters here. SharingCapability is re-declared with the real
// enum's values (0..3, per Microsoft's SharingCapability enum) because
// monitor-executor derives externalSharing/anonymousSharing booleans from it.
vi.mock("../sharepoint-admin", () => ({
  getTenantSharingCapability: vi.fn(),
  sharePointAdminCredentialsPresent: vi.fn().mockReturnValue(true),
  SharingCapability: {
    Disabled: 0,
    ExternalUserSharingOnly: 1,
    ExternalUserAndGuestSharing: 2,
    ExistingExternalUserSharingOnly: 3,
  },
}));

// Power Platform admin (#1869) — mocked at the module boundary exactly like
// sharepoint-admin above, so these tests exercise monitor-executor's dispatch,
// registry and mapping contract without making a real BAP call.
vi.mock("../power-platform-admin", () => ({
  listDlpPolicies: vi.fn(),
  listEnvironments: vi.fn(),
  getTenantSettings: vi.fn(),
  powerPlatformCredentialsPresent: vi.fn().mockReturnValue(true),
  // Real class (not a vi.fn()) so `instanceof PowerPlatformNotRegisteredError`
  // checks in monitor-executor.ts's catch handling still work against this mock.
  PowerPlatformNotRegisteredError: class PowerPlatformNotRegisteredError extends Error {
    aadTenantId: string;
    clientId: string;
    detail: string;
    constructor(aadTenantId: string, clientId: string, detail: string) {
      super(`The Power Platform admin API rejected application ${clientId} in tenant ${aadTenantId}: ${detail}`);
      this.name = "PowerPlatformNotRegisteredError";
      this.aadTenantId = aadTenantId;
      this.clientId = clientId;
      this.detail = detail;
    }
  },
}));
// #1871 — only the two network-facing functions are replaced. The operation
// registry, its per-scope outcome recording and resolveAzureRmOperation stay
// REAL, because they are the parts under test here; mocking them would leave the
// dispatch assertions testing the mock.
vi.mock("../azure-rm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../azure-rm")>();
  return {
    ...actual,
    probeAzureRmReach: vi.fn(),
    getArmAccessTokenForTenant: vi.fn().mockResolvedValue({ token: "arm-token", objectId: "oid", clientId: "arm-client" }),
    armCredentialsPresent: vi.fn().mockReturnValue(true),
  };
});

vi.mock("../ps-execution-client", () => ({
  callPsExecution: vi.fn(),
  PsExecutionError: class PsExecutionError extends Error {
    kind: "unreachable" | "auth_failed" | "script_error";
    cmdletKey: string;
    constructor(kind: "unreachable" | "auth_failed" | "script_error", cmdletKey: string, message: string) {
      super(message);
      this.name = "PsExecutionError";
      this.kind = kind;
      this.cmdletKey = cmdletKey;
    }
  },
}));

// The DNS-backed executor (#496) resolves real public DNS via node:dns —
// mocked here so tests control exactly which TXT records "exist" without a
// real network lookup.
vi.mock("node:dns", () => ({
  promises: {
    resolveTxt: vi.fn(),
  },
}));

vi.mock("../logger", () => {
  const child = vi.fn();
  const base = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child };
  child.mockReturnValue(base);
  return { logger: base };
});

import { graphFetchForTenant, getInitialDomainForTenant } from "../graph";
import { ConsentRevokedError, LicenseGapError } from "../graph";
import { callPsExecution, PsExecutionError } from "../ps-execution-client";
import { getTenantSharingCapability, sharePointAdminCredentialsPresent } from "../sharepoint-admin";
import {
  listDlpPolicies,
  listEnvironments,
  getTenantSettings,
  powerPlatformCredentialsPresent,
} from "../power-platform-admin";
import { promises as dnsPromises } from "node:dns";

// ── evalConditionGrammar ──────────────────────────────────────────────────────

describe("evalConditionGrammar", () => {
  it("evaluates simple equality", () => {
    expect(evalConditionGrammar("mfa_enabled == true", { mfa_enabled: true })).toBe(true);
    expect(evalConditionGrammar("mfa_enabled == true", { mfa_enabled: false })).toBe(false);
  });

  it("evaluates string comparison", () => {
    expect(evalConditionGrammar('status == "active"', { status: "active" })).toBe(true);
    expect(evalConditionGrammar('status == "inactive"', { status: "active" })).toBe(false);
  });

  it("evaluates numeric comparison", () => {
    expect(evalConditionGrammar("score > 50", { score: 75 })).toBe(true);
    expect(evalConditionGrammar("score > 50", { score: 25 })).toBe(false);
    expect(evalConditionGrammar("score >= 75", { score: 75 })).toBe(true);
    expect(evalConditionGrammar("score <= 50", { score: 50 })).toBe(true);
  });

  it("evaluates length comparisons", () => {
    expect(evalConditionGrammar("items length> 0", { items: [1, 2, 3] })).toBe(true);
    expect(evalConditionGrammar("items length== 3", { items: [1, 2, 3] })).toBe(true);
    expect(evalConditionGrammar("items length< 2", { items: [1, 2, 3] })).toBe(false);
    expect(evalConditionGrammar("items length>= 5", { items: [1, 2] })).toBe(false);
  });

  it("evaluates contains operator", () => {
    expect(evalConditionGrammar("tags contains admin", { tags: ["admin", "user"] })).toBe(true);
    expect(evalConditionGrammar("tags contains guest", { tags: ["admin", "user"] })).toBe(false);
  });

  it("evaluates && operator", () => {
    expect(evalConditionGrammar("a == 1 && b == 2", { a: 1, b: 2 })).toBe(true);
    expect(evalConditionGrammar("a == 1 && b == 3", { a: 1, b: 2 })).toBe(false);
  });

  it("evaluates || operator", () => {
    expect(evalConditionGrammar("a == 1 || b == 99", { a: 1, b: 2 })).toBe(true);
    expect(evalConditionGrammar("a == 99 || b == 99", { a: 1, b: 2 })).toBe(false);
  });

  it("evaluates boolean-truthy path", () => {
    expect(evalConditionGrammar("enabled", { enabled: true })).toBe(true);
    expect(evalConditionGrammar("enabled", { enabled: false })).toBe(false);
    expect(evalConditionGrammar("missing_key", {})).toBe(false);
  });

  it("returns false for empty expression", () => {
    expect(evalConditionGrammar("", {})).toBe(false);
  });
});

// ── evalConditionGrammar — relative date operators (#401) ─────────────────────

describe("evalConditionGrammar — olderThanDays / newerThanDays", () => {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const daysAgo = (n: number) => new Date(Date.now() - n * oneDayMs).toISOString();
  const daysAhead = (n: number) => new Date(Date.now() + n * oneDayMs).toISOString();

  it("compares a real ISO timestamp against a fixed day window", () => {
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: daysAgo(40) })).toBe(true);
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: daysAgo(10) })).toBe(false);
    expect(evalConditionGrammar("lastSync newerThanDays 30", { lastSync: daysAgo(10) })).toBe(true);
    expect(evalConditionGrammar("lastSync newerThanDays 30", { lastSync: daysAgo(40) })).toBe(false);
  });

  it("treats olderThanDays 0 as 'has already passed' (the overdue-access-review shape)", () => {
    expect(evalConditionGrammar("endDateTime olderThanDays 0", { endDateTime: daysAgo(1) })).toBe(true);
    expect(evalConditionGrammar("endDateTime olderThanDays 0", { endDateTime: daysAhead(1) })).toBe(false);
  });

  it("resolves {{...}} paths and nested dot-paths on the left-hand side", () => {
    expect(evalConditionGrammar("{{lastSync}} olderThanDays 30", { lastSync: daysAgo(40) })).toBe(true);
    expect(
      evalConditionGrammar("onPrem.lastSyncDateTime olderThanDays 7", { onPrem: { lastSyncDateTime: daysAgo(9) } }),
    ).toBe(true);
  });

  it("composes with && and || like every other clause", () => {
    const data = { status: "InProgress", endDateTime: daysAgo(3) };
    expect(evalConditionGrammar('status == "InProgress" && endDateTime olderThanDays 0', data)).toBe(true);
    expect(evalConditionGrammar('status == "Completed" && endDateTime olderThanDays 0', data)).toBe(false);
    // The documented way to say "never happened is ALSO the alarm" without any
    // new grammar — a null date fails closed on its own, so the rule states it.
    expect(evalConditionGrammar("lastSync == null || lastSync olderThanDays 30", { lastSync: null })).toBe(true);
    expect(evalConditionGrammar("lastSync == null || lastSync olderThanDays 30", { lastSync: daysAgo(2) })).toBe(false);
  });

  it("fails closed on null, missing, and malformed dates rather than firing", () => {
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: null })).toBe(false);
    expect(evalConditionGrammar("lastSync olderThanDays 30", {})).toBe(false);
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: "" })).toBe(false);
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: "not-a-date" })).toBe(false);
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: "2026-13-45T00:00:00Z" })).toBe(false);
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: { nested: daysAgo(90) } })).toBe(false);
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: [daysAgo(90)] })).toBe(false);
    // "5" IS a valid Date to V8 (2001-05-01) — the ISO guard is what stops a
    // wrong-typed field from manufacturing a decades-old timestamp.
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: "5" })).toBe(false);
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: 5 })).toBe(false);
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: Date.now() - 90 * oneDayMs })).toBe(false);
  });

  it("accepts a date-only ISO value and a real Date object", () => {
    const isoDay = new Date(Date.now() - 40 * oneDayMs).toISOString().slice(0, 10);
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: isoDay })).toBe(true);
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: new Date(Date.now() - 40 * oneDayMs) })).toBe(true);
    expect(evalConditionGrammar("lastSync olderThanDays 30", { lastSync: new Date("nonsense") })).toBe(false);
  });

  it("rejects a data-driven or non-integer window — the day count must be a literal in the rule", () => {
    const data = { lastSync: daysAgo(400), window: 30 };
    expect(evalConditionGrammar("lastSync olderThanDays {{window}}", data)).toBe(false);
    expect(evalConditionGrammar("lastSync olderThanDays window", data)).toBe(false);
    expect(evalConditionGrammar("lastSync olderThanDays 30.5", data)).toBe(false);
    expect(evalConditionGrammar("lastSync olderThanDays -30", data)).toBe(false);
    expect(evalConditionGrammar("lastSync olderThanDays", data)).toBe(false);
    expect(evalConditionGrammar("lastSync olderThanDays 999999999", data)).toBe(false);
  });

  it("does not disturb the existing operators it sits beside in OPS", () => {
    expect(evalConditionGrammar("items length> 0", { items: [1] })).toBe(true);
    expect(evalConditionGrammar("tags contains admin", { tags: ["admin"] })).toBe(true);
    expect(evalConditionGrammar("score >= 75", { score: 75 })).toBe(true);
    // A field whose NAME contains the operator word is still read as a path.
    expect(evalConditionGrammar("olderThanDaysCount > 2", { olderThanDaysCount: 5 })).toBe(true);
  });
});

// ── validateOutputShape ──────────────────────────────────────────────────────

describe("validateOutputShape", () => {
  it("passes when no schema provided", () => {
    const { valid, errors } = validateOutputShape({ any: "value" }, null);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it("validates type mismatch", () => {
    const schema = { type: "object" };
    const { valid, errors } = validateOutputShape("not an object", schema);
    expect(valid).toBe(false);
    expect(errors[0]).toContain("expected object");
  });

  it("validates required properties", () => {
    const schema = { type: "object", required: ["id", "name"] };
    const { valid, errors } = validateOutputShape({ id: 1 }, schema);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('"name"'))).toBe(true);
  });

  it("passes when all required properties present", () => {
    const schema = { type: "object", required: ["id", "name"] };
    const { valid } = validateOutputShape({ id: 1, name: "foo" }, schema);
    expect(valid).toBe(true);
  });

  it("validates array items", () => {
    const schema = { type: "array", items: { type: "number" } };
    const { valid, errors } = validateOutputShape([1, 2, "three"], schema);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes("[2]"))).toBe(true);
  });
});

// ── classifySeverity ─────────────────────────────────────────────────────────

describe("classifySeverity", () => {
  const rules: SeverityRule[] = [
    { expression: "mfa_count == 0", severity: "critical" },
    { expression: "mfa_count > 0 && mfa_count < 10", severity: "warning" },
    { expression: "mfa_count >= 10", severity: "ok" },
  ];

  it("matches first rule that evaluates true", () => {
    expect(classifySeverity(rules, { mfa_count: 0 })?.severity).toBe("critical");
    expect(classifySeverity(rules, { mfa_count: 5 })?.severity).toBe("warning");
    expect(classifySeverity(rules, { mfa_count: 15 })?.severity).toBe("ok");
  });

  it("returns null when no rule matches", () => {
    expect(classifySeverity(rules, { mfa_count: -1 })).toBe(null);
  });

  it("returns null for empty rules array", () => {
    expect(classifySeverity([], { mfa_count: 5 })).toBe(null);
  });

  it("skips malformed rules without throwing", () => {
    const badRules: SeverityRule[] = [
      { expression: "INVALID !!@@ syntax", severity: "critical" },
      { expression: "score > 0", severity: "warning" },
    ];
    expect(classifySeverity(badRules, { score: 5 })?.severity).toBe("warning");
  });

  // ── #408: the matched rule's own label comes back with its band ─────────────
  // Returning only the band is what forced every finding built from a matched
  // rule to be titled "{severity} finding detected" — dozens of specific,
  // researched sentences authored into severity_rules never reached a customer.

  it("returns the matched rule's label alongside its severity", () => {
    const labelled: SeverityRule[] = [
      {
        expression: "labelCount == 0",
        severity: "warning",
        label: "No sensitivity labels configured — Copilot can surface unclassified content",
      },
      { expression: "labelCount > 0", severity: "ok", label: "Sensitivity labels are in place" },
    ];
    expect(classifySeverity(labelled, { labelCount: 0 })).toEqual({
      severity: "warning",
      label: "No sensitivity labels configured — Copilot can surface unclassified content",
    });
    expect(classifySeverity(labelled, { labelCount: 3 })).toEqual({
      severity: "ok",
      label: "Sensitivity labels are in place",
    });
  });

  it("reports label null — not undefined, not empty — when the matched rule has none", () => {
    // `label` is optional in the stored jsonb, so this is a real state, and the
    // caller's fallback to generic text depends on it being unambiguous.
    expect(classifySeverity(rules, { mfa_count: 0 })).toEqual({ severity: "critical", label: null });
  });

  it("treats a whitespace-only label as no label at all", () => {
    const blank: SeverityRule[] = [{ expression: "n > 0", severity: "warning", label: "   " }];
    expect(classifySeverity(blank, { n: 1 })).toEqual({ severity: "warning", label: null });
  });

  it("carries the label of the rule that actually matched, not the first labelled one", () => {
    const ordered: SeverityRule[] = [
      { expression: "n == 0", severity: "critical", label: "Nobody is covered" },
      { expression: "n < 10", severity: "warning", label: "Coverage is partial" },
    ];
    expect(classifySeverity(ordered, { n: 4 })).toEqual({
      severity: "warning",
      label: "Coverage is partial",
    });
  });

  // ── #418: {{path}} interpolation in the matched rule's label ────────────────
  // Reuses the exact {{path}} token severity_rules[].expression already uses
  // (evalConditionGrammar / resolvePathInData), so a real extracted count can
  // appear in the label text a customer actually sees, not just the expression.

  it("interpolates a {{path}} placeholder in the label against the finding's own data", () => {
    const templated: SeverityRule[] = [
      {
        expression: "{{eeeuSiteCount}} > 0",
        severity: "warning",
        label: "{{eeeuSiteCount}} sites shared with Everyone except external users",
      },
    ];
    expect(classifySeverity(templated, { eeeuSiteCount: 1 })).toEqual({
      severity: "warning",
      label: "1 sites shared with Everyone except external users",
    });
    expect(classifySeverity(templated, { eeeuSiteCount: 7 })).toEqual({
      severity: "warning",
      label: "7 sites shared with Everyone except external users",
    });
  });

  it("interpolates a nested {{a.b}} path in the label, same as expression already supports", () => {
    const nested: SeverityRule[] = [
      {
        expression: "{{_fanOut.sourceItemsWithResults}} > 0",
        severity: "warning",
        label: "{{_fanOut.sourceItemsWithResults}} groups have standing eligible PIM assignments",
      },
    ];
    expect(
      classifySeverity(nested, { _fanOut: { sourceItemsWithResults: 3 } }),
    ).toEqual({
      severity: "warning",
      label: "3 groups have standing eligible PIM assignments",
    });
  });

  it("falls back to null (not a broken literal placeholder) when the referenced field is missing", () => {
    // The fallback decision for #418: a customer must never see a literal
    // "{{eeeuSiteCount}}" — the whole label is discarded so buildFindingTitle
    // falls back to its pre-existing generic "${severity} finding detected"
    // text, the same honest fallback #408 already uses for a rule with no
    // label at all.
    const templated: SeverityRule[] = [
      {
        expression: "hasFinding == true",
        severity: "warning",
        label: "{{eeeuSiteCount}} sites shared with Everyone except external users",
      },
    ];
    expect(classifySeverity(templated, { hasFinding: true })).toEqual({ severity: "warning", label: null });
  });

  it("falls back to null when the referenced field is explicitly null", () => {
    const templated: SeverityRule[] = [
      { expression: "hasFinding == true", severity: "warning", label: "{{count}} items found" },
    ];
    expect(classifySeverity(templated, { hasFinding: true, count: null })).toEqual({
      severity: "warning",
      label: null,
    });
  });

  it("does not require every label to use the {{path}} syntax — plain labels are unaffected", () => {
    const plain: SeverityRule[] = [
      { expression: "hasFinding == true", severity: "info", label: "No Conditional Access policies exist" },
    ];
    expect(classifySeverity(plain, { hasFinding: true })).toEqual({
      severity: "info",
      label: "No Conditional Access policies exist",
    });
  });

  it("renders a {{path}} value of 0 (falsy but present) rather than treating it as missing", () => {
    const templated: SeverityRule[] = [
      { expression: "hasFinding == true", severity: "ok", label: "{{count}} findings" },
    ];
    expect(classifySeverity(templated, { hasFinding: true, count: 0 })).toEqual({
      severity: "ok",
      label: "0 findings",
    });
  });
});

// ── applyMapping ─────────────────────────────────────────────────────────────

describe("applyMapping", () => {
  const items = [
    { id: "u1", displayName: "Alice", mfaRegistered: true },
    { id: "u2", displayName: "Bob", mfaRegistered: false },
    { id: "u3", displayName: "Carol", mfaRegistered: true },
  ];

  it("extracts property counts and first values", () => {
    const result = applyMapping(items, [], ["displayName"]);
    expect(result.displayName_count).toBe(3);
    expect(result.displayName_first).toBe("Alice");
    expect(result._itemCount).toBe(3);
  });

  it("applies count transform", () => {
    const mapping: MappingRule[] = [{ sourceField: "mfaRegistered", targetField: "mfaEnabledCount", transform: "count" }];
    const result = applyMapping(items, mapping, []);
    expect(result.mfaEnabledCount).toBe(3);
  });

  it("applies exists transform", () => {
    const mapping: MappingRule[] = [{ sourceField: "mfaRegistered", targetField: "anyMfaEnabled", transform: "exists" }];
    const result = applyMapping(items, mapping, []);
    expect(result.anyMfaEnabled).toBe(true);
  });

  it("applies first transform", () => {
    const mapping: MappingRule[] = [{ sourceField: "displayName", targetField: "firstUser", transform: "first" }];
    const result = applyMapping(items, mapping, []);
    expect(result.firstUser).toBe("Alice");
  });

  it("applies join transform", () => {
    const mapping: MappingRule[] = [{ sourceField: "id", targetField: "allIds", transform: "join" }];
    const result = applyMapping(items, mapping, []);
    expect(result.allIds).toBe("u1, u2, u3");
  });

  it("applies countTruthy transform", () => {
    const itemsWithEmpty = [
      { id: "u1", active: true },
      { id: "u2", active: false },
      { id: "u3", active: "" },
      { id: "u4", active: "yes" }
    ];
    const mapping: MappingRule[] = [{ sourceField: "active", targetField: "truthyCount", transform: "countTruthy" }];
    const result = applyMapping(itemsWithEmpty, mapping, []);
    expect(result.truthyCount).toBe(2); // true and "yes" are truthy; false and "" are falsy
  });

  it("applies countFalse transform", () => {
    const itemsWithBools = [
      { id: "u1", val: true },
      { id: "u2", val: false },
      { id: "u3", val: null },
      { id: "u4", val: false }
    ];
    const mapping: MappingRule[] = [{ sourceField: "val", targetField: "falseCount", transform: "countFalse" }];
    const result = applyMapping(itemsWithBools, mapping, []);
    expect(result.falseCount).toBe(2);
  });

  it("applies countEquals transform", () => {
    const itemsWithLevels = [
      { id: "u1", level: "high" },
      { id: "u2", level: "medium" },
      { id: "u3", level: "high" },
      { id: "u4", level: "low" }
    ];
    const mapping: MappingRule[] = [{ sourceField: "level", targetField: "highCount", transform: "countEquals('high')" }];
    const result = applyMapping(itemsWithLevels, mapping, []);
    expect(result.highCount).toBe(2);
  });

  it("resolves nested dot-path source fields", () => {
    const itemsWithNest = [
      { id: "u1", status: { errorCode: 50012 } },
      { id: "u2", status: { errorCode: 50012 } },
      { id: "u3", status: { errorCode: 0 } },
      { id: "u4", status: null }
    ];
    const mapping: MappingRule[] = [{ sourceField: "status.errorCode", targetField: "errorCodesCount", transform: "countEquals('50012')" }];
    const result = applyMapping(itemsWithNest, mapping, []);
    expect(result.errorCodesCount).toBe(2);
  });

  it("applies countIfLastSignInOlderThan transform", () => {
    const staleDays = 30;
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    const itemsForSignIn = [
      { id: "u1", assignedLicenses: ["E3"], signInActivity: { lastSignInDateTime: new Date(now - 10 * oneDayMs).toISOString() } },
      { id: "u2", assignedLicenses: ["E5"], signInActivity: { lastSignInDateTime: new Date(now - 40 * oneDayMs).toISOString() } },
      { id: "u3", assignedLicenses: ["Business Premium"], signInActivity: { lastSignInDateTime: null } },
      { id: "u4", assignedLicenses: ["Business Premium"] },
      { id: "u5", assignedLicenses: [], signInActivity: { lastSignInDateTime: new Date(now - 40 * oneDayMs).toISOString() } },
      { id: "u6", assignedLicenses: null, signInActivity: { lastSignInDateTime: new Date(now - 40 * oneDayMs).toISOString() } },
    ];

    const mapping: MappingRule[] = [
      { sourceField: "assignedLicenses", targetField: "staleUserCount", transform: `countIfLastSignInOlderThan(${staleDays})` }
    ];

    vi.mocked(logger.warn).mockClear();
    const result = applyMapping(itemsForSignIn, mapping, []);
    expect(result.staleUserCount).toBe(3);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("warns if countIfLastSignInOlderThan runs but no signInActivity exists on any item", () => {
    const itemsWithoutActivity = [
      { id: "u1", assignedLicenses: ["E3"] },
      { id: "u2", assignedLicenses: ["E5"] },
    ];

    const mapping: MappingRule[] = [
      { sourceField: "assignedLicenses", targetField: "staleUserCount", transform: "countIfLastSignInOlderThan(30)" }
    ];

    vi.mocked(logger.warn).mockClear();
    const result = applyMapping(itemsWithoutActivity, mapping, []);
    expect(result.staleUserCount).toBe(2);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      { targetField: "staleUserCount", sourceField: "assignedLicenses" },
      expect.stringContaining("countIfLastSignInOlderThan found no signInActivity data on any item")
    );
  });

  it("handles empty items array", () => {
    const result = applyMapping([], [], ["displayName"]);
    expect(result.displayName_count).toBe(0);
    expect(result._itemCount).toBe(0);
  });

  it("applies groupByCount transform with array-valued and scalar-valued sourceField", () => {
    const mixedItems = [
      { id: "u1", skuPartNumber: "SPE_E3" },
      { id: "u2", skuPartNumber: ["SPE_E3", "SPE_E5"] },
      { id: "u3", skuPartNumber: "SPE_E5" },
      { id: "u4", skuPartNumber: null },
      { id: "u5", skuPartNumber: ["SPE_E5", "SPE_E5", null] },
    ];
    const mapping: MappingRule[] = [
      { sourceField: "skuPartNumber", targetField: "skusGrouped", transform: "groupByCount" }
    ];
    const result = applyMapping(mixedItems, mapping, []);
    expect(result.skusGrouped).toEqual({
      SPE_E3: 2,
      SPE_E5: 4,
    });
  });

  it("applies countDuplicates transform with a mix of duplicate and unique values", () => {
    const itemsWithDupes = [
      { id: "u1", assignedLicenses: ["E3", "E5"] },
      { id: "u2", assignedLicenses: ["E3"] },
      { id: "u3", assignedLicenses: ["Business Premium"] },
      { id: "u4", assignedLicenses: null },
      { id: "u5", assignedLicenses: ["E5", "E5"] },
    ];
    const mapping: MappingRule[] = [
      { sourceField: "assignedLicenses", targetField: "duplicateCount", transform: "countDuplicates" }
    ];
    const result = applyMapping(itemsWithDupes, mapping, []);
    expect(result.duplicateCount).toBe(5);
  });

  it("applies countEmptyArray transform (the ownerless-groups shape)", () => {
    // Exactly what GET /groups?$expand=owners($select=id) returns.
    const groups = [
      { id: "g1", displayName: "Finance", owners: [{ id: "u1" }] },
      { id: "g2", displayName: "Orphan A", owners: [] },
      { id: "g3", displayName: "Orphan B", owners: [] },
      { id: "g4", displayName: "Marketing", owners: [{ id: "u2" }, { id: "u3" }] },
    ];
    const mapping: MappingRule[] = [
      { sourceField: "owners", targetField: "ownerlessGroupCount", transform: "countEmptyArray" },
    ];
    vi.mocked(logger.warn).mockClear();
    const result = applyMapping(groups, mapping, []);
    expect(result.ownerlessGroupCount).toBe(2);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("countEmptyArray does not count missing, null, or non-array values as empty", () => {
    const messyGroups = [
      { id: "g1", owners: [] },
      { id: "g2", owners: null },
      { id: "g3" },
      { id: "g4", owners: "not-an-array" },
      { id: "g5", owners: {} },
      { id: "g6", owners: [{ id: "u1" }] },
      "not-an-object",
      null,
    ];
    const mapping: MappingRule[] = [
      { sourceField: "owners", targetField: "ownerlessGroupCount", transform: "countEmptyArray" },
    ];
    vi.mocked(logger.warn).mockClear();
    const result = applyMapping(messyGroups, mapping, []);
    // Only g1 is a genuinely empty array. g2/g3 are absence, not emptiness.
    expect(result.ownerlessGroupCount).toBe(1);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("countEmptyArray warns (and stays 0) when no item has an array at the path at all", () => {
    // The real footgun: the check's endpoint forgot $expand=owners, so every
    // group looks ownerless. 0 + a warning beats reporting the whole estate.
    const unexpandedGroups = [{ id: "g1", displayName: "Finance" }, { id: "g2", displayName: "Ops" }];
    const mapping: MappingRule[] = [
      { sourceField: "owners", targetField: "ownerlessGroupCount", transform: "countEmptyArray" },
    ];
    vi.mocked(logger.warn).mockClear();
    const result = applyMapping(unexpandedGroups, mapping, []);
    expect(result.ownerlessGroupCount).toBe(0);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      { targetField: "ownerlessGroupCount", sourceField: "owners" },
      expect.stringContaining("countEmptyArray found no array at \"owners\" on any item"),
    );
  });

  it("countEmptyArray resolves a nested dot-path and is silent on an empty items array", () => {
    const nested = [
      { id: "g1", membershipRule: { values: [] } },
      { id: "g2", membershipRule: { values: ["a"] } },
      { id: "g3", membershipRule: null },
    ];
    const mapping: MappingRule[] = [
      { sourceField: "membershipRule.values", targetField: "emptyValueCount", transform: "countEmptyArray" },
    ];
    vi.mocked(logger.warn).mockClear();
    expect(applyMapping(nested, mapping, []).emptyValueCount).toBe(1);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();

    // No items at all is not evidence of a missing $expand — no warning.
    expect(applyMapping([], mapping, []).emptyValueCount).toBe(0);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("warns when a mapping rule names a transform that is not implemented", () => {
    const mapping: MappingRule[] = [
      { sourceField: "owners", targetField: "ownerlessGroupCount", transform: "countEmpty" },
    ];
    vi.mocked(logger.warn).mockClear();
    const result = applyMapping([{ id: "g1", owners: [] }], mapping, []);
    // Unchanged behaviour — still the raw array the default branch always emitted.
    expect(result.ownerlessGroupCount).toEqual([[]]);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      { targetField: "ownerlessGroupCount", sourceField: "owners", transform: "countEmpty" },
      expect.stringContaining('names transform "countEmpty", which is not implemented'),
    );
  });

  it("does not warn for the implemented transforms, including the parameterised and default ones", () => {
    const mapping: MappingRule[] = [
      { sourceField: "a", targetField: "t1", transform: "none" },
      { sourceField: "a", targetField: "t2" },
      { sourceField: "a", targetField: "t3", transform: "countEquals('x')" },
      { sourceField: "b", targetField: "t4", transform: "countIfLastSignInOlderThan(90)" },
    ];
    vi.mocked(logger.warn).mockClear();
    applyMapping([{ a: "x", b: ["E3"], signInActivity: { lastSignInDateTime: new Date().toISOString() } }], mapping, []);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("exposes a nested scope query for the existing contains operator (guest-access-reviews)", () => {
    // Case 3 of #401: no new grammar needed. `join` over a nested dot-path
    // exposes the review scope's REAL OData query text, and the existing
    // `contains` operator reads it — the difference between "a scope object
    // exists" and "a scope that actually targets guests exists".
    const reviewDefinitions = [
      { id: "r1", displayName: "All members", scope: { query: "/groups/abc/transitiveMembers", queryType: "MicrosoftGraph" } },
      { id: "r2", displayName: "Guests", scope: { query: "/groups/abc/transitiveMembers/microsoft.graph.user/?$count=true&$filter=(userType eq 'Guest')", queryType: "MicrosoftGraph" } },
    ];
    const mapping: MappingRule[] = [
      { sourceField: "scope.query", targetField: "reviewScopeQueries", transform: "join" },
      { sourceField: "scope", targetField: "anyScopeExists", transform: "exists" },
    ];
    const extracted = applyMapping(reviewDefinitions, mapping, []);
    expect(evalConditionGrammar("reviewScopeQueries contains Guest", extracted)).toBe(true);
    expect(evalConditionGrammar("reviewScopeQueries contains userType", extracted)).toBe(true);

    // Same mapping, a tenant with only non-guest reviews: `exists` still says
    // true (a scope object is there), `contains` correctly says no.
    const membersOnly = applyMapping([reviewDefinitions[0]], mapping, []);
    expect(membersOnly.anyScopeExists).toBe(true);
    expect(evalConditionGrammar("reviewScopeQueries contains Guest", membersOnly)).toBe(false);
  });

  it("handles groupByCount and countDuplicates with an empty items array", () => {
    const mapping: MappingRule[] = [
      { sourceField: "skuPartNumber", targetField: "skusGrouped", transform: "groupByCount" },
      { sourceField: "assignedLicenses", targetField: "duplicateCount", transform: "countDuplicates" }
    ];
    const result = applyMapping([], mapping, []);
    expect(result.skusGrouped).toEqual({});
    expect(result.duplicateCount).toBe(0);
  });
});

// ── #403: valueWhere — named-key lookup in a {name, value} array ───────────────
//
// Every fixture below is the REAL v1.0 payload from Microsoft's own reference
// for GET /groupSettings: a groupSetting carries `values`, a settingValue
// collection of literal {"name": String, "value": String} pairs. Every value is
// a STRING — booleans arrive as "true"/"false" and an unconfigured setting
// arrives as "" rather than being absent.

const GROUP_UNIFIED_SETTINGS = [
  {
    id: "f0b2d6f5-097d-4177-91af-a24e530b53cc",
    displayName: "Group.Unified",
    templateId: "62375ab9-6b52-47ed-826b-58e47e0e304b",
    values: [
      { name: "EnableMIPLabels", value: "true" },
      { name: "CustomBlockedWordsList", value: "" },
      { name: "PrefixSuffixNamingRequirement", value: "[Contoso-][GroupName]" },
      { name: "AllowGuestsToBeGroupOwner", value: "false" },
      { name: "AllowToAddGuests", value: "true" },
      { name: "EnableGroupCreation", value: "true" },
    ],
  },
];

describe("applyMapping — valueWhere (#403)", () => {
  beforeEach(() => vi.mocked(logger.warn).mockClear());

  it("reads a named setting's real value out of the settingValue array", () => {
    const mapping: MappingRule[] = [
      { sourceField: "values", targetField: "guestsAllowed", transform: "valueWhere('name', 'AllowToAddGuests')" },
      { sourceField: "values", targetField: "naming", transform: "valueWhere('name', 'PrefixSuffixNamingRequirement')" },
    ];
    const result = applyMapping(GROUP_UNIFIED_SETTINGS, mapping, []);
    expect(result.guestsAllowed).toBe("true");
    expect(result.naming).toBe("[Contoso-][GroupName]");
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("distinguishes ABSENT (null) from PRESENT-BUT-UNSET (empty string), and both are expressible", () => {
    // The whole reason this transform exists. Graph returns the full template
    // for any settings object the tenant has created, so `exists` on the array
    // is true either way. Only the value tells you whether it is configured.
    const mapping: MappingRule[] = [
      { sourceField: "values", targetField: "blockedWords", transform: "valueWhere('name', 'CustomBlockedWordsList')" },
      { sourceField: "values", targetField: "usageUrl", transform: "valueWhere('name', 'UsageGuidelinesUrl')" },
    ];
    const result = applyMapping(GROUP_UNIFIED_SETTINGS, mapping, []);
    expect(result.blockedWords).toBe("");   // present, never configured
    expect(result.usageUrl).toBeNull();     // not in this tenant's payload at all

    // A stored severity rule can name either state, or both.
    expect(evalConditionGrammar("blockedWords == ''", result)).toBe(true);
    expect(evalConditionGrammar("blockedWords == null", result)).toBe(false);
    expect(evalConditionGrammar("usageUrl == null", result)).toBe(true);
    expect(evalConditionGrammar("usageUrl == null || usageUrl == ''", result)).toBe(true);
    expect(evalConditionGrammar("blockedWords == null || blockedWords == ''", result)).toBe(true);
    expect(evalConditionGrammar("guestsAllowed == null || guestsAllowed == ''",
      applyMapping(GROUP_UNIFIED_SETTINGS, [{ sourceField: "values", targetField: "guestsAllowed", transform: "valueWhere('name', 'AllowToAddGuests')" }], []),
    )).toBe(false);
  });

  it("supports an explicit third argument for the extracted field", () => {
    const templateRows = [
      { values: [{ settingName: "EnableGroupCreation", currentValue: "false", defaultValue: "true" }] },
    ];
    const mapping: MappingRule[] = [
      { sourceField: "values", targetField: "current", transform: "valueWhere('settingName', 'EnableGroupCreation', 'currentValue')" },
      { sourceField: "values", targetField: "fallback", transform: "valueWhere('settingName', 'EnableGroupCreation', 'defaultValue')" },
    ];
    const result = applyMapping(templateRows, mapping, []);
    expect(result.current).toBe("false");
    expect(result.fallback).toBe("true");
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("warns loudly on a case-only spelling drift instead of silently reading 'absent'", () => {
    // The exact trap #403 was written into: `groupLifetimeInDays` is the real
    // spelling on groupLifecyclePolicy, not on a groupSettings name/value pair.
    // A near-miss must not be indistinguishable from a genuinely absent setting.
    const mapping: MappingRule[] = [
      { sourceField: "values", targetField: "guestsAllowed", transform: "valueWhere('name', 'allowtoaddguests')" },
    ];
    const result = applyMapping(GROUP_UNIFIED_SETTINGS, mapping, []);
    expect(result.guestsAllowed).toBeNull();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ targetField: "guestsAllowed", nearMisses: ["AllowToAddGuests"] }),
      expect.stringContaining("differing only in case"),
    );
  });

  it("returns null and warns when sourceField is not an array on any item", () => {
    const mapping: MappingRule[] = [
      // Points at the settings OBJECT rather than at its `values` array.
      { sourceField: "displayName", targetField: "guestsAllowed", transform: "valueWhere('name', 'AllowToAddGuests')" },
    ];
    const result = applyMapping(GROUP_UNIFIED_SETTINGS, mapping, []);
    expect(result.guestsAllowed).toBeNull();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ targetField: "guestsAllowed", sourceField: "displayName" }),
      expect.stringContaining("must point at the ARRAY of name/value pairs"),
    );
  });

  it("survives malformed nested data without throwing or inventing a match", () => {
    const malformed = [
      { values: null },
      { values: "not-an-array" },
      { values: [null, "scalar", 42, ["nested"], { name: null, value: "x" }, {}] },
      { values: [{ name: "AllowToAddGuests", value: "true" }] },
    ];
    const mapping: MappingRule[] = [
      { sourceField: "values", targetField: "guestsAllowed", transform: "valueWhere('name', 'AllowToAddGuests')" },
    ];
    const result = applyMapping(malformed, mapping, []);
    expect(result.guestsAllowed).toBe("true");
  });

  it("takes the first match in document order but warns when tenants disagree across objects", () => {
    // AllowToAddGuests really does live in BOTH Group.Unified and
    // Group.Unified.Guest, and the two can hold different values.
    const both = [
      { displayName: "Group.Unified", values: [{ name: "AllowToAddGuests", value: "true" }] },
      { displayName: "Group.Unified.Guest", values: [{ name: "AllowToAddGuests", value: "false" }] },
    ];
    const mapping: MappingRule[] = [
      { sourceField: "values", targetField: "guestsAllowed", transform: "valueWhere('name', 'AllowToAddGuests')" },
    ];
    const result = applyMapping(both, mapping, []);
    expect(result.guestsAllowed).toBe("true");
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ targetField: "guestsAllowed", matchCount: 2 }),
      expect.stringContaining("one of several real answers"),
    );

    // Same setting, same value in both places: no ambiguity, no warning.
    vi.mocked(logger.warn).mockClear();
    const agreeing = applyMapping(
      [{ values: [{ name: "AllowToAddGuests", value: "true" }] }, { values: [{ name: "AllowToAddGuests", value: "true" }] }],
      mapping, [],
    );
    expect(agreeing.guestsAllowed).toBe("true");
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("warns when the named entry exists but carries no extractable value", () => {
    const mapping: MappingRule[] = [
      { sourceField: "values", targetField: "guestsAllowed", transform: "valueWhere('name', 'AllowToAddGuests')" },
    ];
    const result = applyMapping([{ values: [{ name: "AllowToAddGuests" }] }], mapping, []);
    expect(result.guestsAllowed).toBeNull();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ targetField: "guestsAllowed" }),
      expect.stringContaining("carries no usable"),
    );
  });

  it("returns null on an empty items array without warning about a missing $select", () => {
    // A tenant that has never created a settings object returns value: [].
    // That is a real answer ("no policy"), not a misconfigured check.
    const mapping: MappingRule[] = [
      { sourceField: "values", targetField: "guestsAllowed", transform: "valueWhere('name', 'AllowToAddGuests')" },
    ];
    const result = applyMapping([], mapping, []);
    expect(result.guestsAllowed).toBeNull();
    expect(result._itemCount).toBe(0);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });
});

// ── #2187: valueWhere over top-level flat items (no nested array) ──────────────
//
// Real v1.0 shape of GET /subscribedSkus: each item IS a {skuPartNumber,
// consumedUnits, prepaidUnits} object directly — there is no nested settings
// array to descend into the way GET /groupSettings has. sourceField as a
// WHOLE_ITEM_SOURCE_FIELDS sentinel ("value") tells valueWhere to match/extract
// against the items themselves.

const SUBSCRIBED_SKUS = [
  { skuId: "sku-e3", skuPartNumber: "SPE_E3", consumedUnits: 120, prepaidUnits: { enabled: 150 } },
  { skuId: "sku-copilot", skuPartNumber: "Microsoft_365_Copilot", consumedUnits: 25, prepaidUnits: { enabled: 40 } },
  { skuId: "sku-visio", skuPartNumber: "VISIOCLIENT", consumedUnits: 5, prepaidUnits: { enabled: 5 } },
];

describe("applyMapping — valueWhere over flat top-level items (#2187)", () => {
  beforeEach(() => vi.mocked(logger.warn).mockClear());

  it("extracts the matching item's field, not an arbitrary item's", () => {
    const mapping: MappingRule[] = [
      { sourceField: "value", targetField: "copilotLicenseCount", transform: "valueWhere('skuPartNumber', 'Microsoft_365_Copilot', 'consumedUnits')" },
    ];
    const result = applyMapping(SUBSCRIBED_SKUS, mapping, []);
    expect(result.copilotLicenseCount).toBe(25);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("returns null (not the first item's value) when no item matches", () => {
    const mapping: MappingRule[] = [
      { sourceField: "value", targetField: "copilotLicenseCount", transform: "valueWhere('skuPartNumber', 'Microsoft_365_Copilot', 'consumedUnits')" },
    ];
    const result = applyMapping(
      SUBSCRIBED_SKUS.filter(s => s.skuPartNumber !== "Microsoft_365_Copilot"),
      mapping, [],
    );
    expect(result.copilotLicenseCount).toBeNull();
  });

  it("leaves the existing nested-array reading (sourceField='values') unaffected", () => {
    const mapping: MappingRule[] = [
      { sourceField: "values", targetField: "guestsAllowed", transform: "valueWhere('name', 'AllowToAddGuests')" },
    ];
    const result = applyMapping(GROUP_UNIFIED_SETTINGS, mapping, []);
    expect(result.guestsAllowed).toBe("true");
  });
});

// ── #403: flattenValues / countDuplicatesBy — nested-array field extraction ────
//
// Real v1.0 shape: user.assignedLicenses is an assignedLicense collection of
// {skuId: Guid, disabledPlans: [Guid]} — the skuId is one level down inside an
// array, which a named-property dot-path cannot reach.

const SKU_E3 = "05e9a617-0261-4cee-bb44-138d3ef5d965";
const SKU_E5 = "06ebc4ee-1bb5-47dd-8120-11324bc54e06";
const SKU_VISIO = "c5928f49-12ba-48f7-ada3-0d743a3601d5";

const USERS_WITH_LICENSES = [
  { id: "u1", assignedLicenses: [{ disabledPlans: [], skuId: SKU_E3 }, { disabledPlans: [], skuId: SKU_E5 }] },
  { id: "u2", assignedLicenses: [{ disabledPlans: [], skuId: SKU_E3 }] },
  { id: "u3", assignedLicenses: [{ disabledPlans: [], skuId: SKU_VISIO }] },
  { id: "u4", assignedLicenses: [] },
];

describe("applyMapping — flattenValues / countDuplicatesBy (#403)", () => {
  beforeEach(() => vi.mocked(logger.warn).mockClear());

  it("documents why the transform is needed: a dot-path cannot step through an array", () => {
    // Not an assertion about the new code — an assertion about the gap. This is
    // what every stored check pointing at "assignedLicenses.skuId" gets today.
    const dotPath = applyMapping(USERS_WITH_LICENSES, [
      { sourceField: "assignedLicenses.skuId", targetField: "skus", transform: "join" },
    ], []);
    expect(dotPath.skus).toBe("");
  });

  it("flattens a nested field across every item, in document order", () => {
    const mapping: MappingRule[] = [
      { sourceField: "assignedLicenses", targetField: "skuIds", transform: "flattenValues('skuId')" },
    ];
    const result = applyMapping(USERS_WITH_LICENSES, mapping, []);
    expect(result.skuIds).toEqual([SKU_E3, SKU_E5, SKU_E3, SKU_VISIO]);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("produces a list the existing grammar can read", () => {
    const result = applyMapping(USERS_WITH_LICENSES, [
      { sourceField: "assignedLicenses", targetField: "skuIds", transform: "flattenValues('skuId')" },
    ], []);
    expect(evalConditionGrammar(`skuIds contains '${SKU_E5}'`, result)).toBe(true);
    expect(evalConditionGrammar("skuIds contains 'not-a-sku'", result)).toBe(false);
    expect(evalConditionGrammar("skuIds length> 3", result)).toBe(true);
    expect(evalConditionGrammar("skuIds length> 4", result)).toBe(false);
  });

  it("counts duplicated OCCURRENCES with the same logic countDuplicates uses", () => {
    const result = applyMapping(USERS_WITH_LICENSES, [
      { sourceField: "assignedLicenses", targetField: "dupes", transform: "countDuplicatesBy('skuId')" },
    ], []);
    // E3 appears twice -> both occurrences count; E5 and Visio are unique.
    expect(result.dupes).toBe(2);

    // The two transforms must agree: feeding countDuplicates the ALREADY-flat
    // list gives the identical number, which is the point of sharing the helper.
    const flat = applyMapping(USERS_WITH_LICENSES, [
      { sourceField: "assignedLicenses", targetField: "skuIds", transform: "flattenValues('skuId')" },
    ], []).skuIds as string[];
    const viaCountDuplicates = applyMapping([{ skus: flat }], [
      { sourceField: "skus", targetField: "dupes", transform: "countDuplicates" },
    ], []);
    expect(viaCountDuplicates.dupes).toBe(result.dupes);

    // Three copies contribute three, not two and not one.
    const triple = applyMapping([
      { assignedLicenses: [{ skuId: SKU_E3 }, { skuId: SKU_E3 }] },
      { assignedLicenses: [{ skuId: SKU_E3 }] },
    ], [{ sourceField: "assignedLicenses", targetField: "dupes", transform: "countDuplicatesBy('skuId')" }], []);
    expect(triple.dupes).toBe(3);
  });

  it("regression: countDuplicates over the licence OBJECTS reports the whole estate as duplicated", () => {
    // String({skuId}) is "[object Object]" for EVERY licence, so an
    // un-flattened duplicate count over assignedLicenses cannot distinguish
    // two users holding different SKUs from two users holding the same one.
    // countDuplicatesBy is the fix; this pins the failure it fixes.
    const bogus = applyMapping(USERS_WITH_LICENSES, [
      { sourceField: "assignedLicenses", targetField: "dupes", transform: "countDuplicates" },
    ], []);
    expect(bogus.dupes).toBe(4);   // every licence in the tenant "duplicated"

    const real = applyMapping(USERS_WITH_LICENSES, [
      { sourceField: "assignedLicenses", targetField: "dupes", transform: "countDuplicatesBy('skuId')" },
    ], []);
    expect(real.dupes).toBe(2);
  });

  it("returns an empty list / zero and warns when sourceField holds no array", () => {
    const items = [{ id: "u1" }, { id: "u2" }];
    const result = applyMapping(items, [
      { sourceField: "assignedLicenses", targetField: "skuIds", transform: "flattenValues('skuId')" },
      { sourceField: "assignedLicenses", targetField: "dupes", transform: "countDuplicatesBy('skuId')" },
    ], []);
    expect(result.skuIds).toEqual([]);
    expect(result.dupes).toBe(0);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ targetField: "skuIds" }),
      expect.stringContaining("flattenValues found no array"),
    );
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ targetField: "dupes" }),
      expect.stringContaining("countDuplicatesBy found no array"),
    );
  });

  it("warns when the arrays are there but the named field is wrong", () => {
    const result = applyMapping(USERS_WITH_LICENSES, [
      { sourceField: "assignedLicenses", targetField: "skuIds", transform: "flattenValues('skuID')" },
    ], []);
    expect(result.skuIds).toEqual([]);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ targetField: "skuIds" }),
      expect.stringContaining('no entry inside them carries "skuID"'),
    );
  });

  it("does not warn when every item legitimately has an EMPTY licence array", () => {
    // An unlicensed tenant is a real answer, not a broken $select. sawArray is
    // true, so neither warning fires — the same distinction countEmptyArray makes.
    const result = applyMapping([{ assignedLicenses: [] }, { assignedLicenses: [] }], [
      { sourceField: "assignedLicenses", targetField: "dupes", transform: "countDuplicatesBy('skuId')" },
    ], []);
    expect(result.dupes).toBe(0);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("survives malformed nested data", () => {
    const malformed = [
      { assignedLicenses: null },
      { assignedLicenses: "E3" },
      { assignedLicenses: [null, "scalar", 7, ["nested"], { skuId: null }, { disabledPlans: [] }] },
      { assignedLicenses: [{ skuId: SKU_E3 }] },
      { assignedLicenses: [{ skuId: SKU_E3 }] },
    ];
    const result = applyMapping(malformed, [
      { sourceField: "assignedLicenses", targetField: "skuIds", transform: "flattenValues('skuId')" },
      { sourceField: "assignedLicenses", targetField: "dupes", transform: "countDuplicatesBy('skuId')" },
    ], []);
    // The explicit `skuId: null` is dropped; only the two real GUIDs survive.
    expect(result.skuIds).toEqual([SKU_E3, SKU_E3]);
    expect(result.dupes).toBe(2);
  });

  it("counts values named like Object.prototype members correctly", () => {
    // A plain-object tally reads Object.prototype for these keys, so
    // (seen[v] ?? 0) + 1 yields NaN and the count silently rots. The shared
    // helper uses a Map, so they behave like any other value.
    const result = applyMapping([
      { tags: [{ v: "__proto__" }, { v: "__proto__" }] },
      { tags: [{ v: "constructor" }, { v: "toString" }] },
    ], [
      { sourceField: "tags", targetField: "dupes", transform: "countDuplicatesBy('v')" },
    ], []);
    expect(result.dupes).toBe(2);
  });

  it("treats the new transform names as implemented, and malformed arg forms as not", () => {
    const ok: MappingRule[] = [
      { sourceField: "values", targetField: "a", transform: "valueWhere('name', 'AllowToAddGuests')" },
      { sourceField: "values", targetField: "b", transform: "valueWhere('name', 'AllowToAddGuests', 'value')" },
      { sourceField: "assignedLicenses", targetField: "c", transform: "flattenValues('skuId')" },
      { sourceField: "assignedLicenses", targetField: "d", transform: "countDuplicatesBy('skuId')" },
    ];
    applyMapping([{ values: [{ name: "AllowToAddGuests", value: "true" }], assignedLicenses: [{ skuId: SKU_E3 }] }], ok, []);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();

    // A missing quote or a missing argument must degrade LOUDLY — not throw
    // (which would fail the whole check for the tenant) and not bind to a field
    // name that was never written.
    for (const bad of ["valueWhere('name')", "flattenValues(skuId)", "countDuplicatesBy()", "valueWhere", "flattenValues"]) {
      vi.mocked(logger.warn).mockClear();
      const out = applyMapping([{ values: [{ name: "AllowToAddGuests", value: "true" }] }],
        [{ sourceField: "values", targetField: "x", transform: bad }], []);
      expect(out.x, `expected "${bad}" to degrade to the default raw array`).toEqual([[{ name: "AllowToAddGuests", value: "true" }]]);
      expect(vi.mocked(logger.warn), `expected "${bad}" to warn`).toHaveBeenCalledWith(
        expect.objectContaining({ transform: bad }),
        expect.stringContaining("unparsable arguments"),
      );
    }
  });
});

// ── #403: guest-access-reviews needs NO new code ──────────────────────────────

describe("guest-access-reviews scope query (#403 finding)", () => {
  // Verbatim from Microsoft's own v1.0 reference responses for
  // GET /identityGovernance/accessReviews/definitions. The guest-scoped forms
  // carry the OData filter text inline in scope.query; the non-guest one does
  // not. Both `./members/...` (all-M365-groups guest reviews) and
  // `/v1.0/groups/{id}/transitiveMembers/...` (single-group) are real.
  const REAL_DEFINITIONS = [
    {
      id: "98dcebed-c7f6-46f4-bcf3-4a3fccdb3e2a",
      displayName: "Access Review",
      scope: { "@odata.type": "#microsoft.graph.accessReviewQueryScope", query: "/groups/119cc181-22f0-4e18-8537-264e7524ee0b/transitiveMembers", queryType: "MicrosoftGraph" },
    },
    {
      id: "cc701697-762c-439a-81f5-f58d680fde76",
      displayName: "Review guest access across Microsoft 365 groups",
      status: "InProgress",
      scope: { "@odata.type": "#microsoft.graph.accessReviewQueryScope", query: "./members/microsoft.graph.user/?$count=true&$filter=(userType eq 'Guest')", queryType: "MicrosoftGraph" },
    },
    {
      id: "d6bf2f6c-2f6c-d6bf-6c2f-bfd66c2fbfd6",
      displayName: "Review example",
      status: "Applying",
      scope: { "@odata.type": "#microsoft.graph.accessReviewQueryScope", query: "/v1.0/groups/4444d821-ca3b-45cc-98ee-54c00a04deef/transitiveMembers/microsoft.graph.user/?$count=true&$filter=(userType eq 'Guest')", queryType: "MicrosoftGraph", queryRoot: null },
    },
  ];

  const MAPPING: MappingRule[] = [
    { sourceField: "scope.query", targetField: "reviewScopeQueries", transform: "join" },
  ];

  it("matches the full OData filter phrase with the EXISTING contains operator, quoted or bare", () => {
    const extracted = applyMapping(REAL_DEFINITIONS, MAPPING, []);
    // The precise expression #403 asked to be tested before any code was written.
    expect(evalConditionGrammar(`reviewScopeQueries contains "userType eq 'Guest'"`, extracted)).toBe(true);
    // Unquoted is equivalent: the rhs resolves to no data value, so the raw
    // clause text is used as the literal needle.
    expect(evalConditionGrammar("reviewScopeQueries contains userType eq 'Guest'", extracted)).toBe(true);
  });

  it("says NO for a tenant whose reviews exist but do not target guests", () => {
    // The distinction that matters: `exists` on scope is true either way.
    const nonGuestOnly = applyMapping([REAL_DEFINITIONS[0]], [
      ...MAPPING,
      { sourceField: "scope", targetField: "anyScopeExists", transform: "exists" },
    ], []);
    expect(nonGuestOnly.anyScopeExists).toBe(true);
    expect(evalConditionGrammar(`reviewScopeQueries contains "userType eq 'Guest'"`, nonGuestOnly)).toBe(false);
  });

  it("says NO for a tenant with no access reviews at all", () => {
    const none = applyMapping([], MAPPING, []);
    expect(evalConditionGrammar(`reviewScopeQueries contains "userType eq 'Guest'"`, none)).toBe(false);
  });

  it("degrades honestly when scope is a shape that has no query at all", () => {
    // accessReviewInactiveUsersQueryScope / principalResourceMembershipScope
    // are real alternatives to accessReviewQueryScope and carry no `query`.
    // The dot-path yields undefined, join drops it — no fabricated match.
    const inactiveUsersScope = [{ id: "x", scope: { "@odata.type": "#microsoft.graph.accessReviewInactiveUsersQueryScope", inactiveDuration: "P30D" } }];
    const extracted = applyMapping(inactiveUsersScope, MAPPING, []);
    expect(extracted.reviewScopeQueries).toBe("");
    expect(evalConditionGrammar(`reviewScopeQueries contains "userType eq 'Guest'"`, extracted)).toBe(false);
  });
});

// ── #403: access review INSTANCES are a fan-out, not a flatten ─────────────────

describe("access review instance dates (#403 finding)", () => {
  it("has no due date on the definition, and a FLAT endDateTime on the instance", () => {
    // Verified against the v1.0 reference: accessReviewScheduleDefinition
    // carries createdDateTime / lastModifiedDateTime / status and no end date
    // at all, and neither list-definitions nor get-definition supports
    // $expand=instances ("to retrieve the instances ... use the list
    // accessReviewInstance API"). So overdue-ness is NOT reachable by flattening
    // a nested array off the definitions payload — the check's endpoint has to
    // enumerate instances. Once it does, endDateTime is already top-level and
    // the olderThanDays operator added in #401 reads it with no new transform.
    const definition = {
      id: "cc701697-762c-439a-81f5-f58d680fde76",
      displayName: "Review guest access across Microsoft 365 groups",
      status: "InProgress",
      scope: { query: "./members/microsoft.graph.user/?$count=true&$filter=(userType eq 'Guest')", queryType: "MicrosoftGraph" },
    };
    expect(Object.keys(definition)).not.toContain("endDateTime");

    const instances = [
      { id: "i1", startDateTime: "2021-03-09T23:10:28.83Z", endDateTime: "2021-04-09T23:10:28.83Z", status: "Applied" },
      { id: "i2", startDateTime: new Date().toISOString(), endDateTime: new Date(Date.now() + 7 * 86400000).toISOString(), status: "InProgress" },
    ];
    const extracted = applyMapping(instances, [
      { sourceField: "endDateTime", targetField: "firstEnd", transform: "first" },
      { sourceField: "endDateTime", targetField: "ends", transform: "join" },
    ], []);
    expect(evalConditionGrammar("firstEnd olderThanDays 0", extracted)).toBe(true);
    expect(extracted.ends).toContain("2021-04-09");
  });
});

// ── graphFetchPaginated — pagination exhaustion ────────────────────────────────

describe("graphFetchPaginated", () => {
  const mockFetch = graphFetchForTenant as Mock;

  /**
   * graphFetchPaginated reads the body via res.text() (so a CSV usage-report
   * body is never handed to JSON.parse) and consults res.headers.get(). This
   * helper builds a Response-shaped mock for a JSON payload; `contentType` and
   * raw `body` overrides support the CSV/non-JSON cases below.
   */
  function mockRes(payload: unknown, opts: { contentType?: string; body?: string } = {}) {
    const body = opts.body ?? JSON.stringify(payload);
    return {
      ok: true,
      status: 200,
      text: async () => body,
      json: async () => JSON.parse(body),
      headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? opts.contentType ?? "application/json" : null) },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects items across multiple pages", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      const page = callCount;
      return mockRes(
        page < 3
          ? { value: [{ id: `item${page}` }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skip=next" }
          : { value: [{ id: `item${page}` }] },
      );
    });

    const result = await graphFetchPaginated("tenant1", "/users", "GET");
    expect(result.items).toHaveLength(3);
    expect(result.pageCount).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("handles single-page (no nextLink)", async () => {
    mockFetch.mockResolvedValue(mockRes({ value: [{ id: "u1" }, { id: "u2" }] }));

    const result = await graphFetchPaginated("tenant1", "/users", "GET");
    expect(result.items).toHaveLength(2);
    expect(result.pageCount).toBe(1);
  });

  it("handles non-collection (single object) response", async () => {
    mockFetch.mockResolvedValue(mockRes({ id: "org1", displayName: "Contoso" }));

    const result = await graphFetchPaginated("tenant1", "/organization", "GET");
    expect(result.items).toHaveLength(1);
    expect((result.items[0] as Record<string, unknown>).id).toBe("org1");
  });

  it("throws on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });

    await expect(graphFetchPaginated("tenant1", "/users", "GET")).rejects.toThrow("Graph API error 403");
  });

  it("respects NEXT_LINK_MAX_PAGES safety cap (50 pages)", async () => {
    mockFetch.mockResolvedValue(
      mockRes({ value: [{ id: "item" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skip=next" }),
    );

    const result = await graphFetchPaginated("tenant1", "/users", "GET");
    expect(result.pageCount).toBe(50);
    expect(result.items).toHaveLength(50);
  });

  it("propagates ConsentRevokedError from graphFetchForTenant", async () => {
    const err = new ConsentRevokedError("tenant1");
    mockFetch.mockRejectedValue(err);

    await expect(graphFetchPaginated("tenant1", "/users", "GET")).rejects.toThrow("Consent revoked");
  });

  it("resolves date placeholders in endpoints", async () => {
    mockFetch.mockResolvedValue(mockRes({ value: [] }));

    await graphFetchPaginated("tenant1", "/users?$filter=createdDateTime ge {30DaysAgo}", "GET");

    expect(mockFetch).toHaveBeenCalled();
    const calledUrl = mockFetch.mock.calls[0][1];
    // Check that the URL resolved {30DaysAgo} to a date string matching standard ISO pattern
    expect(calledUrl).toMatch(/\/users\?\$filter=createdDateTime ge \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // ── {id} identity-placeholder substitution ──────────────────────────────────
  // Regression: endpoints are DATA in monitor_checks.endpoint, so
  // /organization/{id}/branding reached Graph with literal braces and failed
  // with "Invalid object identifier '{id}'" (platform:branding-config).

  it("substitutes the {id} identity placeholder with the real tenant GUID", async () => {
    mockFetch.mockResolvedValue(mockRes({ id: "b1", signInPageText: "hi" }));

    await graphFetchPaginated("aad-tenant-guid", "/organization/{id}/branding", "GET");

    const calledUrl = mockFetch.mock.calls[0][1];
    expect(calledUrl).toBe("/organization/aad-tenant-guid/branding");
    expect(calledUrl).not.toContain("{id}");
  });

  it("substitutes {tenantId} and {organizationId} aliases too", async () => {
    mockFetch.mockResolvedValue(mockRes({ value: [] }));

    await graphFetchPaginated("guid-2", "/organization/{organizationId}/branding?t={tenantId}", "GET");

    expect(mockFetch.mock.calls[0][1]).toBe("/organization/guid-2/branding?t=guid-2");
  });

  it("applies ConsistencyLevel: eventual header when URL has $filter= on GET", async () => {
    mockFetch.mockResolvedValue(mockRes({ value: [] }));

    await graphFetchPaginated("tenant1", "/users?$filter=displayName eq 'Test'", "GET");

    expect(mockFetch).toHaveBeenCalled();
    const options = mockFetch.mock.calls[0][2];
    expect(options.headers).toBeDefined();
    expect(options.headers.ConsistencyLevel).toBe("eventual");
  });

  it("does not apply ConsistencyLevel: eventual header when URL has no filter", async () => {
    mockFetch.mockResolvedValue(mockRes({ value: [] }));

    await graphFetchPaginated("tenant1", "/users", "GET");

    expect(mockFetch).toHaveBeenCalled();
    const options = mockFetch.mock.calls[0][2];
    expect(options.headers?.ConsistencyLevel).toBeUndefined();
  });

  // ── Usage-report CSV bodies ─────────────────────────────────────────────────
  // Regression for the real production failure across 5 adoption/OneDrive
  // checks (126 error rows): /reports/getXxx(period='D7') answers 302 → a
  // pre-authenticated CSV download. Node's fetch follows the redirect, so the
  // executor saw a 200 whose body is CSV and called res.json() on it, producing
  // `Unexpected token 'R', "Report Ref"... is not valid JSON`.

  const REPORT_CSV = [
    '"Report Refresh Date","User Principal Name","Send Count","Is Deleted"',
    '"2026-07-23","alice@contoso.com","42","False"',
    '"2026-07-23","bob@contoso.com","0","False"',
  ].join("\r\n");

  it("parses a usage-report CSV body into items instead of throwing on JSON.parse", async () => {
    mockFetch.mockResolvedValue(mockRes(null, { body: REPORT_CSV, contentType: "application/octet-stream" }));

    const result = await graphFetchPaginated("tenant1", "/reports/getEmailActivityUserDetail(period='D7')", "GET");

    expect(result.items).toHaveLength(2);
    expect(result.pageCount).toBe(1);
    const first = result.items[0] as Record<string, string>;
    expect(first["User Principal Name"]).toBe("alice@contoso.com");
    expect(first["Send Count"]).toBe("42");
  });

  it("detects a report CSV by its signature even when content-type claims JSON", async () => {
    // The followed redirect to reports.office.com does not always carry a CSV
    // content-type, so detection must not depend on the header alone.
    mockFetch.mockResolvedValue(mockRes(null, { body: REPORT_CSV, contentType: "application/json" }));

    const result = await graphFetchPaginated("tenant1", "/reports/getOffice365ActiveUserDetail(period='D7')", "GET");
    expect(result.items).toHaveLength(2);
  });

  it("does not misread ordinary Graph JSON as CSV", async () => {
    mockFetch.mockResolvedValue(mockRes({ value: [{ id: "u1" }] }));

    const result = await graphFetchPaginated("tenant1", "/users", "GET");
    expect(result.items).toEqual([{ id: "u1" }]);
  });

  it("surfaces a readable error for a non-JSON, non-CSV 200 body (raw IIS HTML)", async () => {
    mockFetch.mockResolvedValue(
      mockRes(null, { body: "<html><head><title>Service Unavailable</title></head></html>", contentType: "text/html" }),
    );

    await expect(graphFetchPaginated("tenant1", "/deviceManagement/deviceConfigurations", "GET"))
      .rejects.toThrow(/non-JSON body/);
  });

  // ── #487 signatures, #1847 semantics ────────────────────────────────────────
  //
  // These three signatures used to resolve to `{ items: [], rawResponse: { value:
  // [], _intuneNotConfigured: true } }` — i.e. the check landed as `status: 'ok',
  // item_count: 0`, a measured zero reported for something never measured. #1847
  // makes the state first-class instead: the fetch layer throws
  // ServiceNotConfiguredError, the executor classifies it as its own status, and the
  // tenant-level fact is recorded once.
  //
  // The db mock returns no rows, so `readIntuneEntitlement` finds no /subscribedSkus
  // collection and honestly reports `unknown` — which pins the wire-signature-only
  // branch of `resolveIntuneServiceState`.

  function errRes(status: number, body: string) {
    return { ok: false, status, text: async () => body };
  }

  const DEVICE_FE_FORBIDDEN_BODY =
    'Graph API error 401: {"error":{"code":"UnknownError","message":"{\\"ErrorCode\\":\\"Forbidden\\",\\"Message\\":\\"{\\\\r\\\\n  \\\\\\"_version\\\\\\": 3,\\\\r\\\\n  \\\\\\"Message\\\\\\": \\\\\\"An error has occurred - Operation ID (for customer support): 00000000-0000-0000-0000-000000000000 - Activity ID: 01399de2-e6e8-4ddb-98cf-65acb6f3b91c - Url: https://proxy.msua01.manage.microsoft.com/DeviceFE/StatelessDeviceFEService/deviceManagement/manage';

  const AUTOPILOT_SEGMENT_BODY =
    '{"error":{"code":"BadRequest","message":"Resource not found for the segment \'windowsAutopilotDeploymentProfiles\'.","innerError":{"date":"2026-07-23T06:11:09","request-id":"x","client-request-id":"x"}}}';

  const IIS_503_BODY =
    '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">\r\n<HTML><HEAD><TITLE>Service Unavailable</TITLE></HEAD>\r\n<BODY><h2>Service Unavailable</h2>\r\n<hr><p>HTTP Error 503. The service is unavailable.</p>\r\n</BODY></HTML>\r\n';

  it("raises a tenant-level service state for the DeviceFE/StatelessDeviceFEService 401, never an empty result", async () => {
    mockFetch.mockResolvedValue(errRes(401, DEVICE_FE_FORBIDDEN_BODY));

    await expect(graphFetchPaginated("tenant1", "/deviceManagement/managedDevices", "GET"))
      .rejects.toMatchObject({
        name: "ServiceNotConfiguredError",
        serviceKey: "intune",
        state: "not_configured",
        detectionSignature: "intune-legacy-devicefe-401",
        httpStatus: 401,
      });
  });

  it("raises a tenant-level service state for the windowsAutopilotDeploymentProfiles 'segment not found' 400", async () => {
    mockFetch.mockResolvedValue(errRes(400, AUTOPILOT_SEGMENT_BODY));

    await expect(graphFetchPaginated("tenant1", "/deviceManagement/windowsAutopilotDeploymentProfiles", "GET"))
      .rejects.toMatchObject({
        name: "ServiceNotConfiguredError",
        serviceKey: "intune",
        detectionSignature: "intune-segment-unresolved-400",
      });
  });

  it("raises a tenant-level service state for a raw IIS 'Service Unavailable' 503 on an Intune endpoint", async () => {
    mockFetch.mockResolvedValue(errRes(503, IIS_503_BODY));

    await expect(graphFetchPaginated("tenant1", "/deviceAppManagement/managedAppPolicies", "GET"))
      .rejects.toMatchObject({
        name: "ServiceNotConfiguredError",
        serviceKey: "intune",
        detectionSignature: "intune-backend-iis-503",
      });
  });

  // #1847's own evidence includes a 503 from the BARE /deviceManagement root, which
  // the pre-#1847 `"/deviceManagement/"` prefix (trailing slash) did not match — so
  // the root's refusal fell through to a generic error.
  it("matches the bare /deviceManagement root, not just paths beneath it", async () => {
    mockFetch.mockResolvedValue(errRes(503, IIS_503_BODY));

    await expect(graphFetchPaginated("tenant1", "/deviceManagement", "GET"))
      .rejects.toMatchObject({ name: "ServiceNotConfiguredError", serviceKey: "intune" });
  });

  it("does NOT swallow the same 401/400/503 signatures on a non-Intune endpoint", async () => {
    mockFetch.mockResolvedValue(errRes(401, DEVICE_FE_FORBIDDEN_BODY));
    await expect(graphFetchPaginated("tenant1", "/users", "GET")).rejects.toThrow("Graph API error 401");

    mockFetch.mockResolvedValue(errRes(400, AUTOPILOT_SEGMENT_BODY));
    await expect(graphFetchPaginated("tenant1", "/groups", "GET")).rejects.toThrow("Graph API error 400");

    mockFetch.mockResolvedValue(errRes(503, IIS_503_BODY));
    await expect(graphFetchPaginated("tenant1", "/security/alerts_v2", "GET")).rejects.toThrow("Graph API error 503");
  });

  it("does NOT swallow a genuine permission-denied 403 on an Intune endpoint (contrast with the not-configured signatures)", async () => {
    mockFetch.mockResolvedValue(
      errRes(
        403,
        '{"error":{"code":"authorization_error","message":"Failed to authorize, token doesn\'t have the required permissions."}}',
      ),
    );

    await expect(graphFetchPaginated("tenant1", "/deviceManagement/managedDevices", "GET"))
      .rejects.toThrow("Graph API error 403");
  });
});

// ── parseCsvReport / isCsvReportResponse ──────────────────────────────────────

describe("parseCsvReport", () => {
  it("handles quoted fields containing commas and doubled-quote escapes", () => {
    const csv = [
      '"Report Refresh Date","Display Name","Note"',
      '"2026-07-23","Contoso, Inc.","He said ""hi"""',
    ].join("\n");
    const rows = parseCsvReport(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["Display Name"]).toBe("Contoso, Inc.");
    expect(rows[0]!["Note"]).toBe('He said "hi"');
  });

  it("strips a UTF-8 BOM and ignores trailing blank lines", () => {
    const rows = parseCsvReport('﻿"A","B"\r\n"1","2"\r\n\r\n');
    expect(rows).toEqual([{ A: "1", B: "2" }]);
  });

  it("returns an empty array for an empty body", () => {
    expect(parseCsvReport("")).toEqual([]);
  });
});

describe("isCsvReportResponse", () => {
  it("recognises the Report Refresh Date signature", () => {
    expect(isCsvReportResponse(null, '"Report Refresh Date","X"\n"a","b"')).toBe(true);
  });

  it("recognises text/csv content-type", () => {
    expect(isCsvReportResponse("text/csv; charset=utf-8", "anything")).toBe(true);
  });

  it("does not classify Graph JSON as CSV", () => {
    expect(isCsvReportResponse("application/json", '{"value":[]}')).toBe(false);
  });
});

// ── executeMonitorCheck — partial failure & consent revoked ────────────────────

describe("executeMonitorCheck", () => {
  const mockFetch = graphFetchForTenant as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseCheck = {
    id: 1,
    checkId: "uuid-1",
    key: "entra:mfa",
    label: "MFA Enforcement Check",
    description: null,
    endpoint: "/users",
    method: "GET",
    requestBody: null,
    selectParams: null,
    filterParams: null,
    properties: ["mfaRegistered"] as string[],
    mapping: [] as Array<{ sourceField: string; targetField: string; transform?: string }>,
    severityRules: [{ expression: "mfaRegistered_count == 0", severity: "critical" }] as Array<{ expression: string; severity: string; label?: string }>,
    outputSchema: null,
    engines: ["health"] as string[],
    frequency: "daily" as const,
    requiresCustomerScript: false,
    scriptPackageId: null,
    fanOutSource: null,
    fanOutItemIdField: null,
    fanOutMaxItems: null,
    fanOutItemFilter: null,
    fanOutItemNormalizer: null,
    executorType: "graph" as const,
    psCmdletKey: null,
    psParams: null,
    spOperation: null,
    ppOperation: null,
    armOperation: null,
    schemaVersion: 1,
    status: "active" as const,
    createdByAdminId: null,
    updatedByAdminId: null,
    isCustomerFacing: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("returns ok status on successful check", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ value: [{ id: "u1", mfaRegistered: true }] }),
      json: async () => ({ value: [{ id: "u1", mfaRegistered: true }] }),
      headers: { get: () => "application/json" },
    });

    const result = await executeMonitorCheck({ check: baseCheck, tenantId: "tenant1", triggerId: "run1", skipIdempotency: true });
    expect(result.status).toBe("ok");
    expect(result.checkKey).toBe("entra:mfa");
    expect(result.itemCount).toBe(1);
  });

  it("returns error status on Graph API failure (partial failure — does not throw)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const result = await executeMonitorCheck({ check: baseCheck, tenantId: "tenant1", triggerId: "run1", skipIdempotency: true });
    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("Graph API error 500");
    expect(result.itemCount).toBe(0);
  });

  it("returns consent_revoked status when ConsentRevokedError is thrown", async () => {
    const err = new ConsentRevokedError("tenant1");
    mockFetch.mockRejectedValue(err);

    const result = await executeMonitorCheck({ check: baseCheck, tenantId: "tenant1", triggerId: "run1", skipIdempotency: true });
    expect(result.status).toBe("consent_revoked");
    expect(result.checkKey).toBe("entra:mfa");
  });

  it("returns license_gap status (not consent_revoked) when LicenseGapError is thrown", async () => {
    const err = new LicenseGapError("tenant1", "Microsoft Entra ID Premium (P1/P2)", "Authentication_RequestFromNonPremiumTenantOrB2CTenant", "{...}");
    mockFetch.mockRejectedValue(err);

    const { markTenantConsentRevoked } = await import("../graph");
    (markTenantConsentRevoked as Mock).mockClear?.();

    const result = await executeMonitorCheck({ check: baseCheck, tenantId: "tenant1", triggerId: "run1", skipIdempotency: true });
    expect(result.status).toBe("license_gap");
    expect(result.licenseFeature).toBe("Microsoft Entra ID Premium (P1/P2)");
    // A license gap is NOT a consent problem — it must never flip tenant consent.
    expect(markTenantConsentRevoked as Mock).not.toHaveBeenCalled();
    // Definitive falsy license flag is stamped for the signal engine.
    expect(result.extractedProperties.hasAADP1orP2).toBe(false);
    expect(result.extractedProperties._licenseGap).toBe(true);
  });

  it("returns requires_script status for air-gapped checks", async () => {
    const airgappedCheck = { ...baseCheck, requiresCustomerScript: true };
    const result = await executeMonitorCheck({ check: airgappedCheck, tenantId: "tenant1", triggerId: "run1", skipIdempotency: true });
    expect(result.status).toBe("requires_script");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("applies severity classification to extracted data", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ value: [] }),
      json: async () => ({ value: [] }),
      headers: { get: () => "application/json" },
    });

    const result = await executeMonitorCheck({ check: baseCheck, tenantId: "tenant1", triggerId: "run1", skipIdempotency: true });
    expect(result.severityMatched).toBe("critical");
  });

  // ── #408 ───────────────────────────────────────────────────────────────────
  it("carries the matched rule's label onto the CheckResult, not just its band", async () => {
    const labelledCheck = {
      ...baseCheck,
      severityRules: [
        {
          expression: "mfaRegistered_count == 0",
          severity: "critical",
          label: "No users have MFA registered — every account is a single password away",
        },
      ] as Array<{ expression: string; severity: string; label?: string }>,
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ value: [] }),
      json: async () => ({ value: [] }),
      headers: { get: () => "application/json" },
    });

    const result = await executeMonitorCheck({ check: labelledCheck, tenantId: "tenant1", triggerId: "run1", skipIdempotency: true });
    expect(result.severityMatched).toBe("critical");
    expect(result.severityLabel).toBe("No users have MFA registered — every account is a single password away");
  });

  it("reports no label when the matched rule genuinely has none", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ value: [] }),
      json: async () => ({ value: [] }),
      headers: { get: () => "application/json" },
    });

    const result = await executeMonitorCheck({ check: baseCheck, tenantId: "tenant1", triggerId: "run1", skipIdempotency: true });
    expect(result.severityMatched).toBe("critical");
    expect(result.severityLabel).toBeNull();
  });
});

// ── #408: the idempotency cache must not lose the label ───────────────────────
//
// tenant_monitor_profiles stores the band but not the label, so a check served
// from the cache (a re-run under the same triggerId — a real occurrence, see
// #339) would drop straight back to the generic title unless the label is
// re-derived from the check's own rules over the row's own stored properties.

describe("executeMonitorCheck — cached result label recovery", () => {
  const LABEL = "No users have MFA registered — every account is a single password away";
  const labelledCheck = {
    id: 1,
    checkId: "uuid-1",
    key: "entra:mfa",
    label: "MFA Enforcement Check",
    description: null,
    endpoint: "/users",
    method: "GET",
    requestBody: null,
    selectParams: null,
    filterParams: null,
    properties: ["mfaRegistered"] as string[],
    mapping: [] as MappingRule[],
    severityRules: [
      { expression: "mfaRegistered_count == 0", severity: "critical", label: LABEL },
    ] as SeverityRule[],
    outputSchema: null,
    engines: ["health"] as string[],
    frequency: "daily" as const,
    requiresCustomerScript: false,
    scriptPackageId: null,
    fanOutSource: null,
    fanOutItemIdField: null,
    fanOutMaxItems: null,
    fanOutItemFilter: null,
    fanOutItemNormalizer: null,
    executorType: "graph" as const,
    psCmdletKey: null,
    psParams: null,
    spOperation: null,
    ppOperation: null,
    armOperation: null,
    schemaVersion: 1,
    status: "active" as const,
    createdByAdminId: null,
    updatedByAdminId: null,
    isCustomerFacing: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  /** Point the db mock's single-row lookup at a persisted profile row. */
  async function withCachedRow<T>(row: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    const { db } = await import("@workspace/db");
    const original = (db as unknown as { select: Mock }).select;
    (db as unknown as { select: Mock }).select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([row]) }),
      }),
    }) as unknown as Mock;
    try {
      return await fn();
    } finally {
      (db as unknown as { select: Mock }).select = original;
    }
  }

  it("re-derives the label for a cached row whose stored band still matches", async () => {
    const result = await withCachedRow(
      {
        profileId: "p-1",
        status: "ok",
        extractedProperties: { mfaRegistered_count: 0 },
        severityMatched: "critical",
        errorMessage: null,
        itemCount: 0,
        pageCount: 1,
      },
      () => executeMonitorCheck({ check: labelledCheck, tenantId: "tenant1", triggerId: "run1" }),
    );

    expect(result.profileId).toBe("p-1");
    expect(result.severityMatched).toBe("critical");
    expect(result.severityLabel).toBe(LABEL);
  });

  it("says nothing when the rules have been edited since the row was written", async () => {
    // Stored band "warning", but today's rules say "critical" on this same
    // data — the label in front of us is not the one that actually matched, so
    // re-titling a historical result with it would be a fabrication.
    const result = await withCachedRow(
      {
        profileId: "p-2",
        status: "ok",
        extractedProperties: { mfaRegistered_count: 0 },
        severityMatched: "warning",
        errorMessage: null,
        itemCount: 0,
        pageCount: 1,
      },
      () => executeMonitorCheck({ check: labelledCheck, tenantId: "tenant1", triggerId: "run1" }),
    );

    expect(result.severityMatched).toBe("warning");
    expect(result.severityLabel).toBeNull();
  });

  it("says nothing for a cached row that matched no rule at all", async () => {
    const result = await withCachedRow(
      {
        profileId: "p-3",
        status: "ok",
        extractedProperties: { mfaRegistered_count: 12 },
        severityMatched: null,
        errorMessage: null,
        itemCount: 12,
        pageCount: 1,
      },
      () => executeMonitorCheck({ check: labelledCheck, tenantId: "tenant1", triggerId: "run1" }),
    );

    expect(result.severityMatched).toBeNull();
    expect(result.severityLabel).toBeNull();
  });

  // ── Git #549: the row now carries the label, so stop re-deriving it ─────────
  //
  // #408 above could only re-run today's rules over the row's stored data,
  // which is right only while the rules haven't moved. `severity_label` records
  // what ACTUALLY fired at collection time, so the cache branch prefers it and
  // keeps the re-derivation strictly as the pre-#549 fallback.

  it("prefers the row's STORED label over re-deriving it from today's rules", async () => {
    const STORED = "Only 2 of 40 users have MFA registered";
    const result = await withCachedRow(
      {
        profileId: "p-4",
        status: "ok",
        extractedProperties: { mfaRegistered_count: 0 },
        severityMatched: "critical",
        severityLabel: STORED,
        errorMessage: null,
        itemCount: 0,
        pageCount: 1,
      },
      () => executeMonitorCheck({ check: labelledCheck, tenantId: "tenant1", triggerId: "run1" }),
    );

    // Deliberately different from LABEL, which is what re-derivation would give
    // on this same data — so this can only pass by reading the stored column.
    expect(result.severityLabel).toBe(STORED);
    expect(result.severityLabel).not.toBe(LABEL);
  });

  it("still re-derives for a pre-#549 row that has no stored label", async () => {
    const result = await withCachedRow(
      {
        profileId: "p-5",
        status: "ok",
        extractedProperties: { mfaRegistered_count: 0 },
        severityMatched: "critical",
        severityLabel: null,
        errorMessage: null,
        itemCount: 0,
        pageCount: 1,
      },
      () => executeMonitorCheck({ check: labelledCheck, tenantId: "tenant1", triggerId: "run1" }),
    );

    expect(result.severityLabel).toBe(LABEL);
  });

  it("persists the matched label onto the profile row on a fresh (uncached) run", async () => {
    // The whole point of #549: without this write, read time has nothing to say.
    const { db } = await import("@workspace/db");
    const { graphFetchForTenant } = await import("../graph");
    // No users registered for MFA — the exact state labelledCheck's one rule fires on.
    const body = { value: [] as unknown[] };
    (graphFetchForTenant as unknown as Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
      headers: { get: () => "application/json" },
    });

    const insertedValues: Record<string, unknown>[] = [];
    const originalInsert = (db as unknown as { insert: Mock }).insert;
    (db as unknown as { insert: Mock }).insert = vi.fn().mockReturnValue({
      values: vi.fn((v: Record<string, unknown>) => {
        insertedValues.push(v);
        return {
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ profileId: "fresh-uuid" }]),
          }),
        };
      }),
    }) as unknown as Mock;

    try {
      await executeMonitorCheck({
        check: labelledCheck,
        tenantId: "tenant1",
        triggerId: "run-fresh",
        skipIdempotency: true,
      });
    } finally {
      (db as unknown as { insert: Mock }).insert = originalInsert;
    }

    const profileWrite = insertedValues.find(v => v.checkKey === "entra:mfa");
    expect(profileWrite).toBeDefined();
    expect(profileWrite!.severityMatched).toBe("critical");
    expect(profileWrite!.severityLabel).toBe(LABEL);
  });
});

// ── executeMonitoringPackage — idempotency key format ─────────────────────────

describe("idempotency key format", () => {
  it("generates the expected idempotency key", () => {
    const tenantId = "contoso.onmicrosoft.com";
    const checkKey = "entra:mfa";
    const triggerId = "run-42";
    const key = `${tenantId}:${checkKey}:${triggerId}`;
    expect(key).toBe("contoso.onmicrosoft.com:entra:mfa:run-42");
  });
});

// ── executeMonitoringPackage — consent-revoked short-circuit ──────────────────

describe("executeMonitoringPackage — consent-revoked short-circuit", () => {
  it("skips remaining checks after consent is revoked", async () => {
    const progressEvents: string[] = [];

    const mockFetch = graphFetchForTenant as Mock;
    mockFetch.mockRejectedValue(new ConsentRevokedError("tenant-x"));

    const { db } = await import("@workspace/db");
    const mockDb = db as unknown as {
      select: Mock;
      insert: Mock;
    };

    const fakeChecks = [
      { key: "check:a", label: "Check A", endpoint: "/graph/a", method: "GET", properties: [], mapping: [], severityRules: [], engines: [], frequency: "daily", requiresCustomerScript: false, scriptPackageId: null, fanOutSource: null, fanOutItemIdField: null, fanOutMaxItems: null, fanOutItemFilter: null, fanOutItemNormalizer: null, schemaVersion: 1, status: "active", outputSchema: null, selectParams: null, filterParams: null, requestBody: null, description: null, id: 1, checkId: "uuid-a", createdByAdminId: null, updatedByAdminId: null, createdAt: new Date(), updatedAt: new Date() },
      { key: "check:b", label: "Check B", endpoint: "/graph/b", method: "GET", properties: [], mapping: [], severityRules: [], engines: [], frequency: "daily", requiresCustomerScript: false, scriptPackageId: null, fanOutSource: null, fanOutItemIdField: null, fanOutMaxItems: null, fanOutItemFilter: null, fanOutItemNormalizer: null, schemaVersion: 1, status: "active", outputSchema: null, selectParams: null, filterParams: null, requestBody: null, description: null, id: 2, checkId: "uuid-b", createdByAdminId: null, updatedByAdminId: null, createdAt: new Date(), updatedAt: new Date() },
    ];

    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            and: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ key: "pkg1", label: "Package 1", engines: [], status: "active" }]) }),
            limit: vi.fn().mockResolvedValue([{ key: "pkg1", label: "Package 1", engines: [], status: "active" }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { checkKey: "check:a", sortOrder: 0 },
              { checkKey: "check:b", sortOrder: 1 },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(fakeChecks),
        }),
      });

    const result = await executeMonitoringPackage({
      packageKey: "pkg1",
      tenantId: "tenant-x",
      triggerId: "run-1",
      onProgress: (e) => progressEvents.push(`${e.checkKey}:${e.status}`),
    });

    expect(result.runStatus).toBe("consent_revoked");
    const consentRevokedEvents = progressEvents.filter(e => e.includes("consent_revoked"));
    expect(consentRevokedEvents.length).toBeGreaterThan(0);
  });
});

// ── executeMonitoringPackage — license gap completes, no short-circuit ─────────

describe("executeMonitoringPackage — license gap does not block completion", () => {
  it("runs every check and completes when the only non-ok results are license gaps", async () => {
    const progressEvents: string[] = [];

    const mockFetch = graphFetchForTenant as Mock;
    // Every check hits a premium-license wall. With independent classification
    // this must NOT short-circuit (each check may need a different SKU) and the
    // run must still complete (a license gap is a known limit, not a failure).
    mockFetch.mockRejectedValue(
      new LicenseGapError("tenant-lg", "Microsoft Entra ID Premium (P1/P2)", "Authentication_RequestFromNonPremiumTenantOrB2CTenant", "{...}"),
    );

    const { db } = await import("@workspace/db");
    const mockDb = db as unknown as { select: Mock; insert: Mock };

    const fakeChecks = [
      { key: "check:a", label: "Check A", endpoint: "/graph/a", method: "GET", properties: [], mapping: [], severityRules: [], engines: [], frequency: "daily", requiresCustomerScript: false, scriptPackageId: null, fanOutSource: null, fanOutItemIdField: null, fanOutMaxItems: null, fanOutItemFilter: null, fanOutItemNormalizer: null, schemaVersion: 1, status: "active", outputSchema: null, selectParams: null, filterParams: null, requestBody: null, description: null, id: 1, checkId: "uuid-a", createdByAdminId: null, updatedByAdminId: null, createdAt: new Date(), updatedAt: new Date() },
      { key: "check:b", label: "Check B", endpoint: "/graph/b", method: "GET", properties: [], mapping: [], severityRules: [], engines: [], frequency: "daily", requiresCustomerScript: false, scriptPackageId: null, fanOutSource: null, fanOutItemIdField: null, fanOutMaxItems: null, fanOutItemFilter: null, fanOutItemNormalizer: null, schemaVersion: 1, status: "active", outputSchema: null, selectParams: null, filterParams: null, requestBody: null, description: null, id: 2, checkId: "uuid-b", createdByAdminId: null, updatedByAdminId: null, createdAt: new Date(), updatedAt: new Date() },
    ];

    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            and: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ key: "pkg1", label: "Package 1", engines: [], status: "active" }]) }),
            limit: vi.fn().mockResolvedValue([{ key: "pkg1", label: "Package 1", engines: [], status: "active" }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { checkKey: "check:a", sortOrder: 0 },
              { checkKey: "check:b", sortOrder: 1 },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(fakeChecks),
        }),
      });

    const result = await executeMonitoringPackage({
      packageKey: "pkg1",
      tenantId: "tenant-lg",
      triggerId: "run-1",
      onProgress: (e) => progressEvents.push(`${e.checkKey}:${e.status}`),
    });

    // Completed — license gaps never make a run partial_failure or consent_revoked.
    expect(result.runStatus).toBe("completed");
    // No short-circuit: BOTH checks actually ran and reported license_gap.
    expect(progressEvents).toContain("check:a:license_gap");
    expect(progressEvents).toContain("check:b:license_gap");
    expect(result.licenseGapCount).toBe(2);
    expect(result.licenseGapFeatures).toContain("Microsoft Entra ID Premium (P1/P2)");
  });
});

// ── executeMonitorCheck — fan-out (group-scoped) execution ─────────────────────
//
// Covers the additive fan-out capability: successful cross-item aggregation,
// honest partial-failure handling, pagination of the ENUMERATION list itself
// (a large tenant's groups do not fit one page), item-cap truncation honesty,
// tenant-wide short-circuit (consent), 429 throttle backoff, and the concrete
// identity:pim-groups extractedProperties shape.

describe("executeMonitorCheck — fan-out (group-scoped)", () => {
  const mockFetch = graphFetchForTenant as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const SINGLE_QUOTE = String.fromCharCode(39);
  // Real per-group PIM eligibilitySchedules template with the {itemId} placeholder.
  const PIM_ENDPOINT =
    "/identityGovernance/privilegedAccess/group/eligibilitySchedules?$filter=groupId eq " +
    SINGLE_QUOTE + "{itemId}" + SINGLE_QUOTE;

  const fanOutCheck = {
    id: 10,
    checkId: "uuid-fo",
    key: "identity:pim-groups",
    label: "PIM for Groups — Eligible Assignments",
    description: null,
    endpoint: PIM_ENDPOINT,
    method: "GET",
    requestBody: null,
    selectParams: null,
    filterParams: null,
    properties: [] as string[],
    mapping: [{ sourceField: "principalId", targetField: "eligibleAssignmentsTotal", transform: "count" }] as Array<{ sourceField: string; targetField: string; transform?: string }>,
    severityRules: [{ expression: "{{_fanOut.sourceItemsWithResults}} > 0", severity: "warning" }] as Array<{ expression: string; severity: string; label?: string }>,
    outputSchema: null,
    engines: ["security"] as string[],
    frequency: "daily" as const,
    requiresCustomerScript: false,
    scriptPackageId: null,
    fanOutSource: "/groups?$select=id",
    fanOutItemIdField: null, // defaults to "id"
    fanOutMaxItems: null,
    fanOutItemFilter: null,
    fanOutItemNormalizer: null,
    executorType: "graph" as const,
    psCmdletKey: null,
    psParams: null,
    spOperation: null,
    ppOperation: null,
    armOperation: null,
    schemaVersion: 1,
    status: "active" as const,
    createdByAdminId: null,
    updatedByAdminId: null,
    isCustomerFacing: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Response factories mirroring what graphFetchForTenant hands graphFetchPaginated.
  const jsonRes = (value: unknown[], nextLink?: string) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(nextLink ? { value, "@odata.nextLink": nextLink } : { value }),
    headers: { get: (h: string) => (h === "content-type" ? "application/json" : null) },
  });
  const errRes = (status: number) => ({
    ok: false,
    status,
    text: async () => "error body " + status,
    headers: { get: () => null },
  });
  const throttleRes = () => ({
    ok: false,
    status: 429,
    text: async () => "throttled",
    headers: { get: (h: string) => (h === "retry-after" ? "0" : null) },
  });

  const schedule = (groupId: string, principalId: string) => ({ groupId, principalId, accessId: "member", status: "Provisioned" });
  const scopedTo = (path: string, gid: string) => path.includes(SINGLE_QUOTE + gid + SINGLE_QUOTE);

  it("aggregates per-item results across every enumerated group (success)", async () => {
    // 3 groups; g1 -> 2 schedules, g2 -> 0, g3 -> 1.
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("/groups")) return jsonRes([{ id: "g1" }, { id: "g2" }, { id: "g3" }]);
      if (scopedTo(path, "g1")) return jsonRes([schedule("g1", "p1"), schedule("g1", "p2")]);
      if (scopedTo(path, "g2")) return jsonRes([]);
      if (scopedTo(path, "g3")) return jsonRes([schedule("g3", "p3")]);
      throw new Error("unexpected path " + path);
    });

    const result = await executeMonitorCheck({ check: fanOutCheck, tenantId: "t1", triggerId: "r1", skipIdempotency: true, includeItems: true });

    expect(result.status).toBe("ok");
    expect(result.itemCount).toBe(3); // 2 + 0 + 1 flattened schedules
    const fo = result.extractedProperties._fanOut as Record<string, unknown>;
    expect(fo.sourceItemsTotal).toBe(3);
    expect(fo.sourceItemsSucceeded).toBe(3);
    expect(fo.sourceItemsFailed).toBe(0);
    // PIM primary metric: number of GROUPS with >=1 eligible assignment.
    expect(fo.sourceItemsWithResults).toBe(2);
    // Planner-style rollup metric: total assignments across all groups (via mapping).
    expect(result.extractedProperties.eligibleAssignmentsTotal).toBe(3);
    // Severity fired off the fan-out coverage metric.
    expect(result.severityMatched).toBe("warning");
    expect((result.items ?? []).length).toBe(3);
  });

  it("reports status=partial when some groups fail and some succeed", async () => {
    // 4 groups: g1 ok(1), g2 error, g3 ok(1), g4 error.
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("/groups")) return jsonRes([{ id: "g1" }, { id: "g2" }, { id: "g3" }, { id: "g4" }]);
      if (scopedTo(path, "g1")) return jsonRes([schedule("g1", "p1")]);
      if (scopedTo(path, "g2")) return errRes(500);
      if (scopedTo(path, "g3")) return jsonRes([schedule("g3", "p3")]);
      if (scopedTo(path, "g4")) return errRes(503);
      throw new Error("unexpected path " + path);
    });

    const result = await executeMonitorCheck({ check: fanOutCheck, tenantId: "t1", triggerId: "r1", skipIdempotency: true });

    expect(result.status).toBe("partial");
    const fo = result.extractedProperties._fanOut as Record<string, unknown>;
    expect(fo.sourceItemsSucceeded).toBe(2);
    expect(fo.sourceItemsFailed).toBe(2);
    expect(fo.combinedItemCount).toBe(2);
    expect((fo.sampleErrors as unknown[]).length).toBe(2);
    // Real aggregate data survives the partial coverage.
    expect(result.extractedProperties.eligibleAssignmentsTotal).toBe(2);
  });

  it("paginates the enumeration list itself (groups do not fit one page)", async () => {
    // /groups returns page 1 (g1,g2 + nextLink) then page 2 (g3).
    let groupsCall = 0;
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("/groups")) {
        groupsCall++;
        if (groupsCall === 1) return jsonRes([{ id: "g1" }, { id: "g2" }], "https://graph.microsoft.com/v1.0/groups?$skiptoken=PAGE2");
        return jsonRes([{ id: "g3" }]);
      }
      const gid = ["g1", "g2", "g3"].find((g) => scopedTo(path, g)) ?? "g?";
      return jsonRes([schedule(gid, "p-" + gid)]);
    });

    const result = await executeMonitorCheck({ check: fanOutCheck, tenantId: "t1", triggerId: "r1", skipIdempotency: true });

    expect(result.status).toBe("ok");
    const fo = result.extractedProperties._fanOut as Record<string, unknown>;
    // All 3 groups across 2 enumeration pages were discovered and scanned.
    expect(fo.sourceItemsTotal).toBe(3);
    expect(fo.sourceItemsScanned).toBe(3);
    expect(fo.sourcePageCount).toBe(2);
    expect(result.itemCount).toBe(3);
    expect(groupsCall).toBe(2);
  });

  it("reports status=error when every scanned group fails", async () => {
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("/groups")) return jsonRes([{ id: "g1" }, { id: "g2" }]);
      return errRes(500);
    });

    const result = await executeMonitorCheck({ check: fanOutCheck, tenantId: "t1", triggerId: "r1", skipIdempotency: true });
    expect(result.status).toBe("error");
    const fo = result.extractedProperties._fanOut as Record<string, unknown>;
    expect(fo.sourceItemsSucceeded).toBe(0);
    expect(fo.sourceItemsFailed).toBe(2);
  });

  it("returns honest empty (status=ok, 0 items) when the tenant has no groups", async () => {
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("/groups")) return jsonRes([]);
      throw new Error("should not fan out with zero groups");
    });

    const result = await executeMonitorCheck({ check: fanOutCheck, tenantId: "t1", triggerId: "r1", skipIdempotency: true });
    expect(result.status).toBe("ok");
    expect(result.itemCount).toBe(0);
    const fo = result.extractedProperties._fanOut as Record<string, unknown>;
    expect(fo.sourceItemsTotal).toBe(0);
    expect(fo.sourceItemsWithResults).toBe(0);
  });

  it("propagates a per-item consent revocation as a tenant-wide consent_revoked", async () => {
    const { markTenantConsentRevoked } = await import("../graph");
    (markTenantConsentRevoked as Mock).mockClear?.();
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("/groups")) return jsonRes([{ id: "g1" }, { id: "g2" }]);
      throw new ConsentRevokedError("t1");
    });

    const result = await executeMonitorCheck({ check: fanOutCheck, tenantId: "t1", triggerId: "r1", skipIdempotency: true });
    expect(result.status).toBe("consent_revoked");
    expect(markTenantConsentRevoked as Mock).toHaveBeenCalled();
  });

  it("backs off and retries on a 429, then succeeds (rate-limiting)", async () => {
    let g1Calls = 0;
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("/groups")) return jsonRes([{ id: "g1" }]);
      g1Calls++;
      if (g1Calls === 1) return throttleRes(); // first per-item hit is throttled
      return jsonRes([schedule("g1", "p1")]);
    });

    const result = await executeMonitorCheck({ check: fanOutCheck, tenantId: "t1", triggerId: "r1", skipIdempotency: true });
    expect(result.status).toBe("ok");
    expect(result.itemCount).toBe(1);
    expect(g1Calls).toBe(2); // proves the throttled call was retried
  });

  it("honestly truncates at the item cap and flags it", async () => {
    const cappedCheck = { ...fanOutCheck, fanOutMaxItems: 2 };
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("/groups")) return jsonRes([{ id: "g1" }, { id: "g2" }, { id: "g3" }]);
      const gid = ["g1", "g2", "g3"].find((g) => scopedTo(path, g)) ?? "g?";
      return jsonRes([schedule(gid, "p-" + gid)]);
    });

    const result = await executeMonitorCheck({ check: cappedCheck, tenantId: "t1", triggerId: "r1", skipIdempotency: true });
    const fo = result.extractedProperties._fanOut as Record<string, unknown>;
    expect(fo.sourceItemsTotal).toBe(3);
    expect(fo.sourceItemsScanned).toBe(2); // capped
    expect(fo.truncated).toBe(true);
  });

  it("produces the concrete identity:pim-groups extractedProperties shape", async () => {
    // Two groups both with a standing eligible assignment — the real signal the
    // check exists to surface. Confirms the shape downstream signal rules read.
    mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("/groups")) return jsonRes([{ id: "g1" }, { id: "g2" }]);
      if (path.includes("eligibilitySchedules")) {
        const gid = ["g1", "g2"].find((g) => scopedTo(path, g)) ?? "g?";
        return jsonRes([schedule(gid, "p-" + gid)]);
      }
      throw new Error("unexpected path " + path);
    });

    const result = await executeMonitorCheck({ check: fanOutCheck, tenantId: "t1", triggerId: "r1", skipIdempotency: true });
    const props = result.extractedProperties;
    const fo = props._fanOut as Record<string, unknown>;

    expect(result.status).toBe("ok");
    expect(fo.source).toBe("/groups?$select=id");
    expect(fo.itemIdField).toBe("id");
    expect(fo.sourceItemsWithResults).toBe(2); // both groups have eligible assignments
    expect(props.eligibleAssignmentsTotal).toBe(2);
    expect(props._itemCount).toBe(2); // applyMapping stamps this for pillar coverage
    expect(result.severityMatched).toBe("warning");
  });
});

describe("executeMonitorCheck — PowerShell-backed (executorType='powershell')", () => {
  const mockCallPsExecution = callPsExecution as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const psCheck = {
    id: 20,
    checkId: "uuid-ps",
    key: "diagnostics:ps-execution-test",
    label: "PowerShell Execution Path (diagnostic)",
    description: null,
    endpoint: "(unused — executorType=powershell drives dispatch, not endpoint)",
    method: "GET",
    requestBody: null,
    selectParams: null,
    filterParams: null,
    properties: [] as string[],
    mapping: [{ sourceField: "State", targetField: "connectionState", transform: "first" }] as Array<{ sourceField: string; targetField: string; transform?: string }>,
    severityRules: [] as Array<{ expression: string; severity: string; label?: string }>,
    outputSchema: null,
    engines: [] as string[],
    frequency: "daily" as const,
    requiresCustomerScript: false,
    scriptPackageId: null,
    fanOutSource: null,
    fanOutItemIdField: null,
    fanOutMaxItems: null,
    fanOutItemFilter: null,
    fanOutItemNormalizer: null,
    executorType: "powershell" as const,
    psCmdletKey: "get-connection-info",
    psParams: { Organization: "{organization}" } as Record<string, unknown>,
    spOperation: null,
    ppOperation: null,
    armOperation: null,
    schemaVersion: 1,
    status: "active" as const,
    createdByAdminId: null,
    updatedByAdminId: null,
    isCustomerFacing: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("dispatches to the ps-execution container (not Graph) and persists a real check-dispatch result", async () => {
    mockCallPsExecution.mockResolvedValueOnce({
      items: [{ State: "Connected", CertificateAuthentication: true }],
      rawResponse: { State: "Connected", CertificateAuthentication: true },
    });

    const result = await executeMonitorCheck({
      check: psCheck,
      tenantId: "tenant-guid-1",
      triggerId: "trigger-1",
      skipIdempotency: true,
    });

    expect(mockCallPsExecution).toHaveBeenCalledWith(
      "get-connection-info",
      expect.objectContaining({ Organization: "tenant-guid-1" }), // no tenants.domain row in the mock -> falls back to tenantId
    );
    expect(graphFetchForTenant).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
    expect(result.itemCount).toBe(1);
    expect(result.pageCount).toBe(1);
    expect(result.extractedProperties.connectionState).toBe("Connected");
  });

  it("resolves {organization}/{tenantId} placeholders in psParams before dispatch", async () => {
    mockCallPsExecution.mockResolvedValueOnce({ items: [{ State: "Connected" }], rawResponse: { State: "Connected" } });

    await executeMonitorCheck({
      check: { ...psCheck, psParams: { Organization: "{organization}", RequestedBy: "check-{tenantId}" } },
      tenantId: "tenant-guid-2",
      triggerId: "trigger-1",
      skipIdempotency: true,
    });

    expect(mockCallPsExecution).toHaveBeenCalledWith("get-connection-info", {
      Organization: "tenant-guid-2",
      RequestedBy: "check-tenant-guid-2",
    });
  });

  it("resolves {NDaysAgo} placeholders in psParams to literal ISO dates before dispatch (#212)", async () => {
    mockCallPsExecution.mockResolvedValueOnce({ items: [], rawResponse: [] });

    await executeMonitorCheck({
      check: {
        ...psCheck,
        psParams: { Organization: "{organization}", StartTime: "{30DaysAgo}", EndTime: "{0DaysAgo}", OutputFormat: "Json" },
      },
      tenantId: "tenant-guid-4",
      triggerId: "trigger-1",
      skipIdempotency: true,
    });

    const [, calledParams] = mockCallPsExecution.mock.calls[0];
    expect(calledParams.Organization).toBe("tenant-guid-4");
    expect(calledParams.OutputFormat).toBe("Json");
    const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(calledParams.StartTime).toMatch(isoDate);
    expect(calledParams.EndTime).toMatch(isoDate);
    expect(new Date(calledParams.StartTime).getTime()).toBeLessThan(new Date(calledParams.EndTime).getTime());
  });

  it("a PsExecutionError falls through to the generic error path — never markTenantConsentRevoked", async () => {
    const { markTenantConsentRevoked } = await import("../graph");
    mockCallPsExecution.mockRejectedValueOnce(
      new PsExecutionError("auth_failed", "get-connection-info", "Could not establish a Security & Compliance session for the target tenant."),
    );

    const result = await executeMonitorCheck({
      check: psCheck,
      tenantId: "tenant-guid-3",
      triggerId: "trigger-1",
      skipIdempotency: true,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("Security & Compliance session");
    expect(markTenantConsentRevoked).not.toHaveBeenCalled();
  });

  it("#250: a PsExecutionError with kind 'cmdlet_unavailable' persists as license_gap (DLP) — not a generic error", async () => {
    const { markTenantConsentRevoked } = await import("../graph");
    mockCallPsExecution.mockRejectedValueOnce(
      new PsExecutionError(
        "cmdlet_unavailable",
        "get-dlp-policies",
        "The 'Get-DlpCompliancePolicy' cmdlet is not available in this tenant's Security & Compliance session (missing Purview license/add-on, or the connecting app isn't yet assigned the required Purview role).",
      ),
    );

    const result = await executeMonitorCheck({
      check: { ...psCheck, key: "compliance:weak-dlp-policies", psCmdletKey: "get-dlp-policies" },
      tenantId: "tenant-guid-dlp",
      triggerId: "trigger-1",
      skipIdempotency: true,
    });

    expect(result.status).toBe("license_gap");
    expect(result.licenseFeature).toBe("Microsoft Purview Data Loss Prevention (DLP)");
    expect(result.extractedProperties._licenseGap).toBe(true);
    expect(result.extractedProperties._licenseGapFeature).toBe("Microsoft Purview Data Loss Prevention (DLP)");
    expect(markTenantConsentRevoked).not.toHaveBeenCalled();
  });

  it("#250: 'cmdlet_unavailable' names sensitivity labels for get-labels/get-label-policies cmdletKeys", async () => {
    mockCallPsExecution.mockRejectedValueOnce(
      new PsExecutionError("cmdlet_unavailable", "get-labels", "not available in this tenant's session"),
    );

    const result = await executeMonitorCheck({
      check: { ...psCheck, key: "compliance:missing-labels", psCmdletKey: "get-labels" },
      tenantId: "tenant-guid-labels",
      triggerId: "trigger-1",
      skipIdempotency: true,
    });

    expect(result.status).toBe("license_gap");
    expect(result.licenseFeature).toBe("Microsoft Purview sensitivity labels");
  });
});

describe("executeMonitorCheck — SharePoint-admin-backed (executorType='sharepoint-admin', #394)", () => {
  const mockSharingCapability = getTenantSharingCapability as Mock;
  const mockCredsPresent = sharePointAdminCredentialsPresent as Mock;
  const mockInitialDomain = getInitialDomainForTenant as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCredsPresent.mockReturnValue(true);
    // The @workspace/db mock returns no tenants row, so the executor falls back
    // to the Graph /organization initial-domain lookup for the prefix.
    mockInitialDomain.mockResolvedValue("contoso.onmicrosoft.com");
  });

  const spCheck = {
    id: 21,
    checkId: "uuid-sp",
    key: "sharepoint:tenant-sharing-capability",
    label: "SharePoint Tenant Sharing Capability",
    description: null,
    endpoint: "(unused — executorType=sharepoint-admin drives dispatch, not endpoint)",
    method: "GET",
    requestBody: null,
    selectParams: null,
    filterParams: null,
    properties: [] as string[],
    mapping: [
      { sourceField: "sharingCapabilityName", targetField: "sharingCapabilityName", transform: "first" },
      { sourceField: "sharingCapability", targetField: "sharingCapability", transform: "first" },
      { sourceField: "externalSharingEnabled", targetField: "externalSharingEnabled", transform: "first" },
      { sourceField: "anonymousSharingEnabled", targetField: "anonymousSharingEnabled", transform: "first" },
    ] as Array<{ sourceField: string; targetField: string; transform?: string }>,
    severityRules: [
      { expression: "anonymousSharingEnabled == true", severity: "warning", label: "Anyone links are enabled tenant-wide" },
    ] as Array<{ expression: string; severity: string; label?: string }>,
    outputSchema: null,
    engines: [] as string[],
    frequency: "daily" as const,
    requiresCustomerScript: false,
    scriptPackageId: null,
    fanOutSource: null,
    fanOutItemIdField: null,
    fanOutMaxItems: null,
    fanOutItemFilter: null,
    fanOutItemNormalizer: null,
    executorType: "sharepoint-admin" as const,
    psCmdletKey: null,
    psParams: null,
    spOperation: "tenant-sharing-capability",
    ppOperation: null,
    armOperation: null,
    schemaVersion: 1,
    status: "active" as const,
    createdByAdminId: null,
    updatedByAdminId: null,
    isCustomerFacing: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("dispatches to sharepoint-admin.ts (never Graph, never the PS container) with a real tenant ref", async () => {
    mockSharingCapability.mockResolvedValueOnce(2); // ExternalUserAndGuestSharing

    const result = await executeMonitorCheck({
      check: spCheck,
      tenantId: "tenant-guid-sp",
      triggerId: "trigger-1",
      skipIdempotency: true,
    });

    expect(mockSharingCapability).toHaveBeenCalledWith({
      aadTenantId: "tenant-guid-sp",
      sharePointTenantPrefix: "contoso",
    });
    expect(graphFetchForTenant).not.toHaveBeenCalled();
    expect(callPsExecution).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
    expect(result.itemCount).toBe(1);
    expect(result.pageCount).toBe(1);
    expect(result.extractedProperties.sharingCapability).toBe(2);
    expect(result.extractedProperties.sharingCapabilityName).toBe("ExternalUserAndGuestSharing");
    expect(result.extractedProperties.externalSharingEnabled).toBe(true);
    expect(result.extractedProperties.anonymousSharingEnabled).toBe(true);
    expect(result.severityMatched).toBe("warning");
  });

  it("Disabled sharing reads as no external and no anonymous sharing, and matches no severity rule", async () => {
    mockSharingCapability.mockResolvedValueOnce(0); // Disabled

    const result = await executeMonitorCheck({
      check: spCheck,
      tenantId: "tenant-guid-sp",
      triggerId: "trigger-2",
      skipIdempotency: true,
    });

    expect(result.status).toBe("ok");
    expect(result.extractedProperties.sharingCapabilityName).toBe("Disabled");
    expect(result.extractedProperties.externalSharingEnabled).toBe(false);
    expect(result.extractedProperties.anonymousSharingEnabled).toBe(false);
    expect(result.severityMatched).toBeNull();
  });

  it("a check whose executorType is still 'graph' never reaches this path (existing checks unaffected)", async () => {
    (graphFetchForTenant as Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ value: [] }),
      headers: { get: (h: string) => (h === "content-type" ? "application/json" : null) },
    });

    const result = await executeMonitorCheck({
      check: { ...spCheck, executorType: "graph" as const, endpoint: "/sites/root" },
      tenantId: "tenant-guid-sp",
      triggerId: "trigger-3",
      skipIdempotency: true,
    });

    expect(graphFetchForTenant).toHaveBeenCalled();
    expect(mockSharingCapability).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
  });

  it("an sp_operation outside the code-owned registry is a hard error, not a silent no-op", async () => {
    const result = await executeMonitorCheck({
      check: { ...spCheck, spOperation: "delete-everything" },
      tenantId: "tenant-guid-sp",
      triggerId: "trigger-4",
      skipIdempotency: true,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("delete-everything");
    expect(mockSharingCapability).not.toHaveBeenCalled();
  });

  it("missing SharePoint certificate credentials fail before any tenant work, naming the real env vars", async () => {
    mockCredsPresent.mockReturnValue(false);

    const result = await executeMonitorCheck({
      check: spCheck,
      tenantId: "tenant-guid-sp",
      triggerId: "trigger-5",
      skipIdempotency: true,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("MT_APP_CERT_PRIVATE_KEY");
    expect(mockSharingCapability).not.toHaveBeenCalled();
  });

  it("refuses to guess a SharePoint host when no initial .onmicrosoft.com domain is known", async () => {
    mockInitialDomain.mockResolvedValue("contoso.com"); // vanity domain, not the SharePoint prefix

    const result = await executeMonitorCheck({
      check: spCheck,
      tenantId: "tenant-guid-sp",
      triggerId: "trigger-6",
      skipIdempotency: true,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("SharePoint tenant prefix");
    expect(mockSharingCapability).not.toHaveBeenCalled();
  });

  it("a SharePoint auth failure never flips the tenant's Graph consent state", async () => {
    const { markTenantConsentRevoked } = await import("../graph");
    mockSharingCapability.mockRejectedValueOnce(
      new Error("SharePoint app-only auth failed for tenant tenant-guid-sp (status 401): unsupported app only token"),
    );

    const result = await executeMonitorCheck({
      check: spCheck,
      tenantId: "tenant-guid-sp",
      triggerId: "trigger-7",
      skipIdempotency: true,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("401");
    expect(markTenantConsentRevoked).not.toHaveBeenCalled();
  });
});

describe("executeMonitorCheck — Power-Platform-backed (executorType='power-platform', #1869)", () => {
  const mockDlpPolicies = listDlpPolicies as Mock;
  const mockEnvironments = listEnvironments as Mock;
  const mockTenantSettings = getTenantSettings as Mock;
  const mockPpCredsPresent = powerPlatformCredentialsPresent as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPpCredsPresent.mockReturnValue(true);
  });

  const ppCheck = {
    id: 31,
    checkId: "uuid-pp",
    key: "powerplatform:dlp-policies",
    label: "Power Platform DLP policies",
    description: null,
    endpoint: "",
    method: "GET",
    requestBody: null,
    selectParams: null,
    filterParams: null,
    properties: [] as string[],
    mapping: [] as Array<{ sourceField: string; targetField: string; transform?: string }>,
    severityRules: [] as Array<{ expression: string; severity: string; label?: string }>,
    outputSchema: null,
    engines: [] as string[],
    frequency: "daily" as const,
    requiresCustomerScript: false,
    scriptPackageId: null,
    fanOutSource: null,
    fanOutItemIdField: null,
    fanOutMaxItems: null,
    fanOutItemFilter: null,
    fanOutItemNormalizer: null,
    executorType: "power-platform" as const,
    psCmdletKey: null,
    psParams: null,
    spOperation: null,
    ppOperation: "dlp-policies",
    armOperation: null,
    schemaVersion: 1,
    status: "active" as const,
    createdByAdminId: null,
    updatedByAdminId: null,
    isCustomerFacing: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("dispatches to power-platform-admin.ts (never Graph, never the PS container) with the bare AAD tenant id", async () => {
    mockDlpPolicies.mockResolvedValueOnce([
      {
        name: "policy-guid-1",
        properties: {
          displayName: "Block social connectors",
          createdTime: "2026-01-04T10:00:00Z",
          definition: {
            defaultApiGroup: "hbi",
            constraints: {
              environmentFilter1: {
                parameters: {
                  filterType: "include",
                  environments: [{ name: "env-guid-a" }, { name: "env-guid-b" }],
                },
              },
            },
          },
        },
      },
    ]);

    const result = await executeMonitorCheck({
      check: ppCheck,
      tenantId: "tenant-guid-pp",
      triggerId: "trigger-pp-1",
      skipIdempotency: true,
      includeItems: true,
    });

    // The BAP admin API is a single global host — unlike SharePoint there is no
    // per-tenant host to resolve, so the tenant GUID is passed through as-is.
    expect(mockDlpPolicies).toHaveBeenCalledWith("tenant-guid-pp");
    expect(graphFetchForTenant).not.toHaveBeenCalled();
    expect(callPsExecution).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
    expect(result.itemCount).toBe(1);
    expect(result.pageCount).toBe(1);
    expect(result.items?.[0]).toMatchObject({
      policyName: "policy-guid-1",
      displayName: "Block social connectors",
      environmentFilterType: "include",
      environmentCount: 2,
      environmentNames: ["env-guid-a", "env-guid-b"],
      defaultApiGroup: "hbi",
    });
  });

  it("a tenant with NO DLP policy at all is status ok with zero items — a real finding, not an error", async () => {
    mockDlpPolicies.mockResolvedValueOnce([]);

    const result = await executeMonitorCheck({
      check: ppCheck,
      tenantId: "tenant-guid-pp",
      triggerId: "trigger-pp-2",
      skipIdempotency: true,
      includeItems: true,
    });

    expect(result.status).toBe("ok");
    expect(result.itemCount).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.errorMessage).toBeUndefined();
  });

  it("the environments operation maps the BAP shape without inventing fields", async () => {
    mockEnvironments.mockResolvedValueOnce([
      {
        name: "env-guid-a",
        location: "unitedstates",
        properties: { displayName: "Contoso (default)", environmentSku: "Default", isDefault: true },
      },
    ]);

    const result = await executeMonitorCheck({
      check: { ...ppCheck, ppOperation: "environments" },
      tenantId: "tenant-guid-pp",
      triggerId: "trigger-pp-3",
      skipIdempotency: true,
      includeItems: true,
    });

    expect(mockEnvironments).toHaveBeenCalledWith("tenant-guid-pp");
    expect(result.status).toBe("ok");
    expect(result.items?.[0]).toMatchObject({
      environmentName: "env-guid-a",
      displayName: "Contoso (default)",
      environmentSku: "Default",
      isDefault: true,
      location: "unitedstates",
    });
  });

  it("the tenant-settings operation returns exactly one item (a tenant-wide setting IS a single fact)", async () => {
    mockTenantSettings.mockResolvedValueOnce({ disableEnvironmentCreationByNonAdminUsers: true });

    const result = await executeMonitorCheck({
      check: { ...ppCheck, ppOperation: "tenant-settings" },
      tenantId: "tenant-guid-pp",
      triggerId: "trigger-pp-4",
      skipIdempotency: true,
      includeItems: true,
    });

    expect(result.status).toBe("ok");
    expect(result.itemCount).toBe(1);
    expect(result.items?.[0]).toMatchObject({ disableEnvironmentCreationByNonAdminUsers: true });
  });

  it("a pp_operation outside the code-owned registry is a hard error, not a silent no-op", async () => {
    const result = await executeMonitorCheck({
      check: { ...ppCheck, ppOperation: "delete-every-policy" },
      tenantId: "tenant-guid-pp",
      triggerId: "trigger-pp-5",
      skipIdempotency: true,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("delete-every-policy");
    expect(mockDlpPolicies).not.toHaveBeenCalled();
  });

  it("missing Power Platform credentials fail before any tenant work, naming the real env vars", async () => {
    mockPpCredsPresent.mockReturnValue(false);

    const result = await executeMonitorCheck({
      check: ppCheck,
      tenantId: "tenant-guid-pp",
      triggerId: "trigger-pp-6",
      skipIdempotency: true,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("MT_APP_CLIENT_ID");
    expect(result.errorMessage).toContain("MT_APP_CLIENT_SECRET");
    // Deliberately NOT the certificate vars: Power Platform accepts a secret.
    expect(result.errorMessage).not.toContain("MT_APP_CERT_PRIVATE_KEY");
    expect(mockDlpPolicies).not.toHaveBeenCalled();
  });

  it("a check whose executorType is still 'graph' never reaches this path (existing checks unaffected)", async () => {
    (graphFetchForTenant as Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ value: [] }),
      headers: { get: (h: string) => (h === "content-type" ? "application/json" : null) },
    });

    const result = await executeMonitorCheck({
      check: { ...ppCheck, executorType: "graph" as const, endpoint: "/organization" },
      tenantId: "tenant-guid-pp",
      triggerId: "trigger-pp-7",
      skipIdempotency: true,
    });

    expect(graphFetchForTenant).toHaveBeenCalled();
    expect(mockDlpPolicies).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
  });
});

describe("sharePointPrefixFromDomain", () => {
  it("takes the prefix of a real initial domain", () => {
    expect(sharePointPrefixFromDomain("mccawsoft2.onmicrosoft.com")).toBe("mccawsoft2");
    expect(sharePointPrefixFromDomain("  Contoso.OnMicrosoft.com ")).toBe("contoso");
  });

  it("refuses vanity, mail and missing domains rather than guessing a host", () => {
    expect(sharePointPrefixFromDomain("contoso.com")).toBeNull();
    expect(sharePointPrefixFromDomain("contoso.mail.onmicrosoft.com")).toBeNull();
    expect(sharePointPrefixFromDomain(null)).toBeNull();
    expect(sharePointPrefixFromDomain("")).toBeNull();
  });
});

describe("appendQueryParams", () => {
  it("overrides existing $select parameter when a new one is provided", () => {
    const url = "/beta/users?$select=id,mail&$top=10";
    const res = appendQueryParams(url, "$select=id,displayName,userPrincipalName", null);
    expect(res).toBe("/beta/users?$top=10&$select=id,displayName,userPrincipalName");
  });

  it("overrides existing $filter parameter when a new one is provided", () => {
    const url = "/security/alerts_v2?$filter=detectionSource eq 'old'&$select=id";
    const res = appendQueryParams(url, null, "detectionSource eq 'new'");
    expect(res).toBe("/security/alerts_v2?$select=id&$filter=detectionSource%20eq%20'new'");
  });

  it("handles both $select and $filter overrides simultaneously without double encoding", () => {
    const url = "/beta/users?$select=id&$filter=accountEnabled eq false";
    const res = appendQueryParams(url, "id,mail", "accountEnabled eq true");
    expect(res).toBe("/beta/users?$select=id,mail&$filter=accountEnabled%20eq%20true");
  });
});

// ── #402: raw / countWhere — the two transform names stored checks referenced
// before either existed. Both silently produced the default branch's raw array,
// which no numeric signal rule can read.

/**
 * Verbatim shape of GET /v1.0/subscribedSkus (four SKUs), the endpoint behind
 * license:sku-utilization — the check #402 was found on. The point of the
 * fixture is the nesting: consumedUnits sits on the item, prepaidUnits.enabled
 * one level down, and servicePlans is an array. A count/first/exists transform
 * can carry ONE of those numbers; only a pass-through carries the SKU list.
 */
const SUBSCRIBED_SKUS_NESTED = [
  {
    capabilityStatus: "Enabled",
    consumedUnits: 14,
    id: "48a80680-7326-48cd-9935-b556b81d3a4e_c7df2760-2c81-4ef7-b578-5b5392b571df",
    skuId: "c7df2760-2c81-4ef7-b578-5b5392b571df",
    skuPartNumber: "ENTERPRISEPREMIUM",
    appliesTo: "User",
    prepaidUnits: { enabled: 25, suspended: 0, warning: 0 },
    servicePlans: [{ servicePlanId: "41781fb2-bc02-4b7c-bd55-b576c07bb09d", servicePlanName: "AAD_PREMIUM", provisioningStatus: "Success", appliesTo: "User" }],
  },
  {
    capabilityStatus: "Enabled",
    consumedUnits: 9,
    id: "48a80680-7326-48cd-9935-b556b81d3a4e_05e9a617-0261-4cee-bb44-138d3ef5d965",
    skuId: "05e9a617-0261-4cee-bb44-138d3ef5d965",
    skuPartNumber: "SPE_E3",
    appliesTo: "User",
    prepaidUnits: { enabled: 10, suspended: 0, warning: 0 },
    servicePlans: [],
  },
  {
    capabilityStatus: "Enabled",
    consumedUnits: 0,
    id: "48a80680-7326-48cd-9935-b556b81d3a4e_639dec6b-bb19-468b-871c-c5c441c4b0cb",
    skuId: "639dec6b-bb19-468b-871c-c5c441c4b0cb",
    skuPartNumber: "Microsoft_365_Copilot",
    appliesTo: "User",
    prepaidUnits: { enabled: 5, suspended: 0, warning: 0 },
    servicePlans: [],
  },
  {
    capabilityStatus: "Suspended",
    consumedUnits: 2,
    id: "48a80680-7326-48cd-9935-b556b81d3a4e_c5928f49-12ba-48f7-ada3-0d743a3601d5",
    skuId: "c5928f49-12ba-48f7-ada3-0d743a3601d5",
    skuPartNumber: "VISIOCLIENT",
    appliesTo: "User",
    prepaidUnits: { enabled: 2, suspended: 3, warning: 0 },
    servicePlans: [],
  },
];

describe("applyMapping — raw (#402)", () => {
  beforeEach(() => vi.mocked(logger.warn).mockClear());

  it("pins the bug: an unimplemented transform produced an empty result beside four real SKUs", () => {
    // The exact contradiction #402 reports from a live Simulator Studio run —
    // skuPartNumber_values showed all four SKUs while the check's own skuData
    // mapping produced nothing. Not an assertion about the new code: an
    // assertion about what happens to a sourceField naming the OData envelope
    // the items were already unwrapped out of.
    const before = applyMapping(SUBSCRIBED_SKUS_NESTED, [
      { sourceField: "value", targetField: "skuData", transform: "notImplementedYet" },
    ], ["skuPartNumber"]);
    expect(before.skuData).toEqual([]);
    expect(before.skuPartNumber_values).toHaveLength(4);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ targetField: "skuData" }),
      expect.stringContaining("not implemented"),
    );
  });

  it("passes the FULL item array through when sourceField names the item itself", () => {
    for (const sourceField of ["value", "*", ".", "item", "items", ""]) {
      const result = applyMapping(SUBSCRIBED_SKUS_NESTED, [
        { sourceField, targetField: "skuData", transform: "raw" },
      ], []);
      expect(result.skuData, `sourceField "${sourceField}"`).toEqual(SUBSCRIBED_SKUS_NESTED);
      expect((result.skuData as Array<{ skuPartNumber: string }>).map(s => s.skuPartNumber))
        .toEqual(["ENTERPRISEPREMIUM", "SPE_E3", "Microsoft_365_Copilot", "VISIOCLIENT"]);
    }
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("carries the nested numbers no derived transform can: consumed vs prepaid, per SKU", () => {
    const result = applyMapping(SUBSCRIBED_SKUS_NESTED, [
      { sourceField: "value", targetField: "skuData", transform: "raw" },
    ], []);
    const rows = (result.skuData as Array<{ skuPartNumber: string; consumedUnits: number; prepaidUnits: { enabled: number } }>)
      .map(s => ({ sku: s.skuPartNumber, used: s.consumedUnits, owned: s.prepaidUnits.enabled }));
    expect(rows).toEqual([
      { sku: "ENTERPRISEPREMIUM", used: 14, owned: 25 },
      { sku: "SPE_E3", used: 9, owned: 10 },
      { sku: "Microsoft_365_Copilot", used: 0, owned: 5 },
      { sku: "VISIOCLIENT", used: 2, owned: 2 },
    ]);
  });

  it("passes one property off every item through when sourceField names a property", () => {
    const result = applyMapping(SUBSCRIBED_SKUS_NESTED, [
      { sourceField: "skuPartNumber", targetField: "skus", transform: "raw" },
      { sourceField: "prepaidUnits", targetField: "units", transform: "raw" },
      { sourceField: "prepaidUnits.enabled", targetField: "owned", transform: "raw" },
    ], []);
    expect(result.skus).toEqual(["ENTERPRISEPREMIUM", "SPE_E3", "Microsoft_365_Copilot", "VISIOCLIENT"]);
    expect(result.owned).toEqual([25, 10, 5, 2]);
    expect((result.units as unknown[])[0]).toEqual({ enabled: 25, suspended: 0, warning: 0 });
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("keeps duplicates and document order, dropping only null/absent values", () => {
    // "Unmodified" has to mean unmodified: de-duplicating or re-ordering here
    // would make the pass-through a derived transform wearing a raw label.
    const result = applyMapping([
      { dept: "Sales" }, { dept: "Sales" }, { dept: null }, {}, { dept: "Ops" },
    ], [{ sourceField: "dept", targetField: "depts", transform: "raw" }], []);
    expect(result.depts).toEqual(["Sales", "Sales", "Ops"]);
  });

  it("falls back to the whole items — loudly — when sourceField resolves on nothing", () => {
    // The shape every currently-broken stored rule is in. Emitting [] again
    // would reproduce the bug faithfully; guessing silently would be worse.
    const result = applyMapping(SUBSCRIBED_SKUS_NESTED, [
      { sourceField: "skuData", targetField: "skuData", transform: "raw" },
    ], []);
    expect(result.skuData).toEqual(SUBSCRIBED_SKUS_NESTED);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ targetField: "skuData", transform: "raw" }),
      expect.stringContaining("passed through the WHOLE items instead"),
    );
  });

  it("takes the same loud fallback when the property exists but is null on every item", () => {
    // Deliberate: "present and null everywhere" and "wrong path" are the same
    // observation from here — both yield nothing — so both get the same
    // fallback and the same warning naming both readings, rather than one of
    // them silently returning an empty list.
    const result = applyMapping([{ a: null }, { a: null }], [
      { sourceField: "a", targetField: "out", transform: "raw" },
    ], []);
    expect(result.out).toEqual([{ a: null }, { a: null }]);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ targetField: "out" }),
      expect.stringContaining("passed through the WHOLE items instead"),
    );
  });

  it("returns an empty array on an empty item list, without warning", () => {
    // A tenant with no SKUs is a real answer, not a misconfigured check.
    const result = applyMapping([], [
      { sourceField: "value", targetField: "skuData", transform: "raw" },
      { sourceField: "skuPartNumber", targetField: "skus", transform: "raw" },
    ], []);
    expect(result.skuData).toEqual([]);
    expect(result.skus).toEqual([]);
    expect(result._itemCount).toBe(0);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("copies the item array rather than aliasing the caller's", () => {
    const items = [...SUBSCRIBED_SKUS_NESTED];
    const result = applyMapping(items, [
      { sourceField: "value", targetField: "skuData", transform: "raw" },
    ], []);
    items.pop();
    expect(result.skuData).toHaveLength(4);
  });

  it("warns above the whole-item volume threshold without dropping anything", () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ id: `u${i}` }));
    const result = applyMapping(many, [
      { sourceField: "value", targetField: "users", transform: "raw" },
    ], []);
    expect(result.users).toHaveLength(501);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ itemCount: 501 }),
      expect.stringContaining("Nothing was dropped"),
    );
  });

  it("treats bare 'raw' as implemented and an argument-bearing 'raw(...)' as malformed", () => {
    applyMapping(SUBSCRIBED_SKUS_NESTED, [{ sourceField: "value", targetField: "a", transform: "raw" }], []);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();

    vi.mocked(logger.warn).mockClear();
    const out = applyMapping([{ a: 1 }], [{ sourceField: "a", targetField: "x", transform: "raw('value')" }], []);
    expect(out.x).toEqual([1]);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ transform: "raw('value')" }),
      expect.stringContaining("unparsable arguments"),
    );
  });
});

describe("applyMapping — countWhere (#402)", () => {
  beforeEach(() => vi.mocked(logger.warn).mockClear());

  const USERS = [
    { id: "u1", displayName: "Ada", accountEnabled: true, department: "Sales", assignedLicenses: [{ skuId: "e3" }], signInActivity: { lastSignInDateTime: "2020-01-01T00:00:00Z" } },
    { id: "u2", displayName: "Bo", accountEnabled: false, department: "Sales", assignedLicenses: [{ skuId: "e3" }, { skuId: "e5" }], signInActivity: { lastSignInDateTime: "2020-02-01T00:00:00Z" } },
    { id: "u3", displayName: "Cy", accountEnabled: false, department: "Ops", assignedLicenses: [], signInActivity: { lastSignInDateTime: new Date().toISOString() } },
    { id: "u4", displayName: "Di", accountEnabled: true, department: "Ops", assignedLicenses: [{ skuId: "visio" }] },
  ];

  it("counts ITEMS matching the predicate", () => {
    const result = applyMapping(USERS, [
      { sourceField: "value", targetField: "disabledCount", transform: "countWhere('{{accountEnabled}} == false')" },
      { sourceField: "*", targetField: "salesCount", transform: `countWhere('{{department}} == "Sales"')` },
    ], []);
    expect(result.disabledCount).toBe(2);
    expect(result.salesCount).toBe(2);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("is the SAME grammar severity rules use, not a second expression language", () => {
    // Every predicate is evaluated twice — once through the transform, once
    // through evalConditionGrammar directly. A reimplemented grammar would
    // drift from one of these; a shared one cannot.
    const predicates = [
      "{{accountEnabled}} == false",
      `{{accountEnabled}} == false && {{department}} == "Ops"`,
      `{{department}} == "Sales" || {{department}} == "Ops"`,
      "assignedLicenses length> 1",
      "{{signInActivity.lastSignInDateTime}} olderThanDays 365",
      "{{displayName}} contains A",
      "accountEnabled",
    ];
    for (const expr of predicates) {
      const viaTransform = applyMapping(USERS, [
        { sourceField: "value", targetField: "n", transform: `countWhere('${expr}')` },
      ], []).n;
      const direct = USERS.filter(u => evalConditionGrammar(expr, u as unknown as Record<string, unknown>)).length;
      expect(viaTransform, `predicate: ${expr}`).toBe(direct);
    }
  });

  it("counts ENTRIES inside the array when sourceField names an array field", () => {
    const result = applyMapping(USERS, [
      { sourceField: "assignedLicenses", targetField: "e3Count", transform: `countWhere('{{skuId}} == "e3"')` },
      { sourceField: "assignedLicenses", targetField: "allLicences", transform: "countWhere('skuId')" },
    ], []);
    expect(result.e3Count).toBe(2);      // u1 and u2 each hold one E3
    expect(result.allLicences).toBe(4);  // 1 + 2 + 0 + 1 licences across the tenant
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("accepts either outer quote style, so a predicate can carry string literals", () => {
    const single = applyMapping(USERS, [
      { sourceField: "value", targetField: "n", transform: `countWhere('{{department}} == "Sales"')` },
    ], []).n;
    const double = applyMapping(USERS, [
      { sourceField: "value", targetField: "n", transform: `countWhere("{{department}} == 'Sales'")` },
    ], []).n;
    expect(single).toBe(2);
    expect(double).toBe(2);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("expresses the real license:unused-assigned question: licensed but long dormant", () => {
    const result = applyMapping(USERS, [
      {
        sourceField: "value",
        targetField: "unusedAssigned",
        transform: "countWhere('assignedLicenses length> 0 && {{signInActivity.lastSignInDateTime}} olderThanDays 90')",
      },
    ], []);
    // u1 and u2 are licensed and last signed in in 2020; u3 signed in today;
    // u4 carries no signInActivity at all, and a missing timestamp fails CLOSED
    // by design (see parseTimestampMs) rather than counting as dormant.
    expect(result.unusedAssigned).toBe(2);
  });

  it("counts 0 — not everything — when the predicate genuinely matches nothing", () => {
    const result = applyMapping(USERS, [
      { sourceField: "value", targetField: "n", transform: `countWhere('{{department}} == "Legal"')` },
    ], []);
    expect(result.n).toBe(0);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("warns when the predicate's fields exist on nothing it was evaluated against", () => {
    // The 0 that is about the stored rule, not about the tenant. This is the
    // single most believable wrong answer a counting transform can give.
    const result = applyMapping(USERS, [
      { sourceField: "value", targetField: "n", transform: "countWhere('{{accountEnbaled}} == false')" },
    ], []);
    expect(result.n).toBe(0);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ targetField: "n", fields: ["accountEnbaled"] }),
      expect.stringContaining("present on none of the 4 items"),
    );
  });

  it("does not raise that warning over words inside a string literal", () => {
    const result = applyMapping(USERS, [
      { sourceField: "value", targetField: "n", transform: `countWhere('{{department}} == "Legal Department"')` },
    ], []);
    expect(result.n).toBe(0);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("reads a {{...}} field whose own name contains spaces, like a usage-report CSV header (#753)", () => {
    // getOneDriveUsageAccountDetail's real columns ("Last Activity Date", "Is
    // Deleted") are single object keys that happen to contain spaces —
    // resolvePathInData's literal-key-first lookup already reads these
    // correctly, but expressionTopLevelPaths used to tokenize the mustache
    // span with the same word-boundary regex as a dot-path, splitting "Last
    // Activity Date" into "Last"/"Activity"/"Date" and finding none of them on
    // the data — a false "the field name is wrong" warning on a predicate that
    // was actually matching correctly.
    const rows = [
      { "Last Activity Date": "", "Is Deleted": "False" },
      { "Last Activity Date": "2026-08-01", "Is Deleted": "False" },
      { "Last Activity Date": "", "Is Deleted": "True" },
    ];
    const result = applyMapping(rows, [
      { sourceField: "value", targetField: "n", transform: `countWhere('{{Last Activity Date}} == "" && {{Is Deleted}} == "False"')` },
    ], []);
    expect(result.n).toBe(1);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("warns and evaluates over whole items when sourceField resolves on nothing", () => {
    const result = applyMapping(USERS, [
      { sourceField: "licenceDetails", targetField: "n", transform: "countWhere('{{accountEnabled}} == false')" },
    ], []);
    expect(result.n).toBe(2);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ targetField: "n" }),
      expect.stringContaining("evaluated against the WHOLE items"),
    );
  });

  it("warns when there is nothing object-shaped to evaluate", () => {
    const result = applyMapping([{ tags: ["a", "b"] }, { tags: ["c"] }], [
      { sourceField: "tags", targetField: "n", transform: `countWhere('{{name}} == "a"')` },
    ], []);
    expect(result.n).toBe(0);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ skipped: 3 }),
      expect.stringContaining("nothing object-shaped"),
    );
  });

  it("survives malformed items and mixed array contents", () => {
    const result = applyMapping([
      null,
      "a string",
      { assignedLicenses: null },
      { assignedLicenses: [null, "scalar", { skuId: "e3" }, { skuId: "e3" }] },
    ], [
      { sourceField: "assignedLicenses", targetField: "n", transform: `countWhere('{{skuId}} == "e3"')` },
    ], []);
    expect(result.n).toBe(2);
  });

  it("returns 0 on an empty item list, without warning", () => {
    const result = applyMapping([], [
      { sourceField: "value", targetField: "n", transform: "countWhere('{{accountEnabled}} == false')" },
    ], []);
    expect(result.n).toBe(0);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it("treats an empty or unquoted predicate as malformed, never as a confident 0", () => {
    for (const bad of [
      "countWhere()",
      "countWhere('')",
      "countWhere",
      "countWhere({{accountEnabled}} == false)",
      `countWhere('{{a}} == 'b'')`,
    ]) {
      vi.mocked(logger.warn).mockClear();
      const out = applyMapping([{ a: 1 }], [{ sourceField: "a", targetField: "x", transform: bad }], []);
      expect(out.x, `expected "${bad}" to degrade to the default raw array`).toEqual([1]);
      expect(vi.mocked(logger.warn), `expected "${bad}" to warn`).toHaveBeenCalledWith(
        expect.objectContaining({ transform: bad }),
        expect.stringContaining("unparsable arguments"),
      );
    }
  });

  it("produces a number the existing severity grammar can read", () => {
    const extracted = applyMapping(USERS, [
      { sourceField: "value", targetField: "disabledCount", transform: "countWhere('{{accountEnabled}} == false')" },
    ], []);
    expect(evalConditionGrammar("disabledCount > 1", extracted)).toBe(true);
    expect(evalConditionGrammar("disabledCount > 5", extracted)).toBe(false);
  });

  it("treats both new names as implemented, so neither trips the unknown-transform warning", () => {
    applyMapping(SUBSCRIBED_SKUS_NESTED, [
      { sourceField: "value", targetField: "skuData", transform: "raw" },
      { sourceField: "value", targetField: "suspended", transform: `countWhere('{{capabilityStatus}} == "Suspended"')` },
    ], []);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });
});

// ── executeMonitorCheck — DNS-backed (executorType='dns', #496) ────────────────

describe("executeMonitorCheck — DNS-backed (executorType='dns', #496)", () => {
  const mockResolveTxt = dnsPromises.resolveTxt as Mock;
  const mockInitialDomain = getInitialDomainForTenant as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    // The @workspace/db mock returns no tenants row by default, so the
    // executor falls back to the Graph /organization initial-domain lookup —
    // tests opt a real tenants.domain in individually where needed.
    mockInitialDomain.mockResolvedValue("mccawsoft2.onmicrosoft.com");
  });

  const dnsCheck = {
    id: 22,
    checkId: "uuid-dns",
    key: "exchange:dkim-spf-dmarc-status",
    label: "DKIM/SPF/DMARC Status",
    description: null,
    endpoint: "(unused — executorType=dns drives dispatch, not endpoint)",
    method: "GET",
    requestBody: null,
    selectParams: null,
    filterParams: null,
    properties: [] as string[],
    mapping: [
      { sourceField: "domain", targetField: "domain", transform: "first" },
      { sourceField: "spfConfigured", targetField: "spfConfigured", transform: "first" },
      { sourceField: "dmarcConfigured", targetField: "dmarcConfigured", transform: "first" },
      { sourceField: "dkimConfiguredAtDefaultSelectors", targetField: "dkimConfiguredAtDefaultSelectors", transform: "first" },
    ] as Array<{ sourceField: string; targetField: string; transform?: string }>,
    severityRules: [
      { expression: "spfConfigured == false", severity: "warning", label: "No SPF record found on the domain" },
      { expression: "dmarcConfigured == false", severity: "warning", label: "No DMARC record found at _dmarc.<domain>" },
      { expression: "dkimConfiguredAtDefaultSelectors == false", severity: "info", label: "No DKIM record found at Microsoft 365's default selectors" },
    ] as Array<{ expression: string; severity: string; label?: string }>,
    outputSchema: null,
    engines: [] as string[],
    frequency: "daily" as const,
    requiresCustomerScript: false,
    scriptPackageId: null,
    fanOutSource: null,
    fanOutItemIdField: null,
    fanOutMaxItems: null,
    fanOutItemFilter: null,
    fanOutItemNormalizer: null,
    executorType: "dns" as const,
    psCmdletKey: null,
    psParams: null,
    spOperation: null,
    ppOperation: null,
    armOperation: null,
    schemaVersion: 1,
    status: "active" as const,
    createdByAdminId: null,
    updatedByAdminId: null,
    isCustomerFacing: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  /** dns.promises.resolveTxt resolves each TXT record as an array of chunk strings. */
  function txt(...records: string[]) {
    return records.map((r) => [r]);
  }

  it("dispatches straight to DNS, never Graph/PowerShell/SharePoint, using the tenant's real domain", async () => {
    mockResolveTxt.mockImplementation(async (hostname: string) => {
      if (hostname === "mccawsoft2.onmicrosoft.com") return txt("v=spf1 include:spf.protection.outlook.com -all");
      throw Object.assign(new Error(`queryTxt ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    });

    const result = await executeMonitorCheck({
      check: dnsCheck,
      tenantId: "tenant-guid-dns",
      triggerId: "trigger-1",
      skipIdempotency: true,
    });

    expect(mockResolveTxt).toHaveBeenCalledWith("mccawsoft2.onmicrosoft.com");
    expect(mockResolveTxt).toHaveBeenCalledWith("_dmarc.mccawsoft2.onmicrosoft.com");
    expect(mockResolveTxt).toHaveBeenCalledWith("selector1._domainkey.mccawsoft2.onmicrosoft.com");
    expect(mockResolveTxt).toHaveBeenCalledWith("selector2._domainkey.mccawsoft2.onmicrosoft.com");
    expect(graphFetchForTenant).not.toHaveBeenCalled();
    expect(callPsExecution).not.toHaveBeenCalled();
    expect(getTenantSharingCapability).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
    expect(result.itemCount).toBe(1);
    expect(result.pageCount).toBe(1);
    expect(result.extractedProperties.domain).toBe("mccawsoft2.onmicrosoft.com");
  });

  it("real-shaped result: SPF found, DMARC and DKIM honestly not found at the default selectors", async () => {
    mockResolveTxt.mockImplementation(async (hostname: string) => {
      if (hostname === "mccawsoft2.onmicrosoft.com") return txt("v=spf1 include:spf.protection.outlook.com -all");
      throw Object.assign(new Error(`queryTxt ENODATA ${hostname}`), { code: "ENODATA" });
    });

    const result = await executeMonitorCheck({
      check: dnsCheck,
      tenantId: "tenant-guid-dns",
      triggerId: "trigger-2",
      skipIdempotency: true,
    });

    expect(result.status).toBe("ok");
    expect(result.extractedProperties.spfConfigured).toBe(true);
    expect(result.extractedProperties.dmarcConfigured).toBe(false);
    expect(result.extractedProperties.dkimConfiguredAtDefaultSelectors).toBe(false);
    // Two severity rules match (no dmarc, no dkim); classifySeverity is
    // first-match-wins and severityRules lists spf first, so a missing SPF
    // record would win here too — this case exercises the dmarc rule winning
    // when SPF is present.
    expect(result.severityMatched).toBe("warning");
  });

  it("all three found: no severity rule matches", async () => {
    mockResolveTxt.mockImplementation(async (hostname: string) => {
      if (hostname === "mccawsoft2.onmicrosoft.com") return txt("v=spf1 include:spf.protection.outlook.com -all");
      if (hostname === "_dmarc.mccawsoft2.onmicrosoft.com") return txt("v=DMARC1; p=reject;");
      if (hostname.startsWith("selector1._domainkey.")) return txt("v=DKIM1; k=rsa; p=abc123");
      throw Object.assign(new Error(`queryTxt ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    });

    const result = await executeMonitorCheck({
      check: dnsCheck,
      tenantId: "tenant-guid-dns",
      triggerId: "trigger-3",
      skipIdempotency: true,
    });

    expect(result.status).toBe("ok");
    expect(result.extractedProperties.spfConfigured).toBe(true);
    expect(result.extractedProperties.dmarcConfigured).toBe(true);
    expect(result.extractedProperties.dkimConfiguredAtDefaultSelectors).toBe(true);
    expect(result.severityMatched).toBeNull();
  });

  it("a genuine DNS resolver error (not ENOTFOUND/ENODATA) surfaces as an error result, not a false 'not configured'", async () => {
    mockResolveTxt.mockRejectedValue(Object.assign(new Error("queryTxt ETIMEOUT"), { code: "ETIMEOUT" }));

    const result = await executeMonitorCheck({
      check: dnsCheck,
      tenantId: "tenant-guid-dns",
      triggerId: "trigger-4",
      skipIdempotency: true,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("ETIMEOUT");
  });

  it("a check whose executorType is still 'graph' never reaches this path (existing checks unaffected)", async () => {
    (graphFetchForTenant as Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ value: [] }),
      headers: { get: (h: string) => (h === "content-type" ? "application/json" : null) },
    });

    const result = await executeMonitorCheck({
      check: { ...dnsCheck, executorType: "graph" as const, endpoint: "/organization" },
      tenantId: "tenant-guid-dns",
      triggerId: "trigger-5",
      skipIdempotency: true,
    });

    expect(graphFetchForTenant).toHaveBeenCalled();
    expect(mockResolveTxt).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
  });

  it("refuses to guess a domain when neither tenants.domain nor the Graph initial-domain lookup resolves one", async () => {
    mockInitialDomain.mockResolvedValue(null);

    const result = await executeMonitorCheck({
      check: dnsCheck,
      tenantId: "tenant-guid-dns",
      triggerId: "trigger-6",
      skipIdempotency: true,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("cannot resolve a domain");
    expect(mockResolveTxt).not.toHaveBeenCalled();
  });
});

// ── #1871: azure-rm transport dispatch and its honest no-data states ──────────

describe("executeMonitorCheck — azure-rm transport (#1871)", () => {
  const armCheck = {
    id: 91,
    checkId: "arm-check-uuid",
    key: "azure:custom-role-definitions",
    label: "Azure custom role definitions",
    description: null,
    endpoint: "(unused - executorType=azure-rm drives dispatch, not endpoint)",
    method: "GET",
    requestBody: null,
    selectParams: null,
    filterParams: null,
    properties: [] as string[],
    mapping: [
      { sourceField: "roleName", targetField: "customRoleCount", transform: "count" },
    ] as Array<{ sourceField: string; targetField: string; transform?: string }>,
    severityRules: [] as Array<{ expression: string; severity: string; label?: string }>,
    outputSchema: null,
    engines: [] as string[],
    frequency: "daily" as const,
    requiresCustomerScript: false,
    scriptPackageId: null,
    fanOutSource: null,
    fanOutItemIdField: null,
    fanOutMaxItems: null,
    fanOutItemFilter: null,
    fanOutItemNormalizer: null,
    executorType: "azure-rm" as const,
    psCmdletKey: null,
    psParams: null,
    spOperation: null,
    ppOperation: null,
    armOperation: "list-custom-role-definitions",
    schemaVersion: 1,
    status: "active" as const,
    createdByAdminId: null,
    updatedByAdminId: null,
    isCustomerFacing: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const reach = (over: Record<string, unknown> = {}) => ({
    state: "ok",
    tokenAcquired: true,
    subscriptionsHttpStatus: 200,
    managementGroupsHttpStatus: null,
    subscriptions: [{ subscriptionId: "sub-a", displayName: "Pay-As-You-Go", state: "Enabled", tenantId: "t", managedByTenantIds: [] }],
    principalClientId: "arm-client",
    principalObjectId: "oid",
    errorMessage: null,
    ...over,
  });

  let mockProbe: Mock;

  beforeEach(async () => {
    vi.clearAllMocks();
    const azureRm = await import("../azure-rm");
    mockProbe = azureRm.probeAzureRmReach as unknown as Mock;
  });

  it("dispatches to ARM and never to Graph, PowerShell or SharePoint", async () => {
    mockProbe.mockResolvedValueOnce(reach());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ value: [{ roleName: "Contoso Reader" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));

    const result = await executeMonitorCheck({
      check: armCheck, tenantId: "tenant-guid-arm", triggerId: "arm-1", skipIdempotency: true,
    });

    expect(graphFetchForTenant).not.toHaveBeenCalled();
    expect(callPsExecution).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
    expect(result.itemCount).toBe(1);
    expect(result.extractedProperties.customRoleCount).toBe(1);
    vi.unstubAllGlobals();
  });

  it("reports azure_no_rbac — NOT an error and NOT no_subscriptions — when the platform holds no Azure role", async () => {
    mockProbe.mockResolvedValueOnce(reach({
      state: "no_rbac", subscriptions: [], managementGroupsHttpStatus: 403,
    }));

    const result = await executeMonitorCheck({
      check: armCheck, tenantId: "tenant-guid-arm", triggerId: "arm-2", skipIdempotency: true,
    });

    expect(result.status).toBe("azure_no_rbac");
    expect(result.itemCount).toBe(0);
    expect(result.severityMatched).toBeNull();
    // The next action is named on the row, not left to be rediscovered.
    const azure = result.extractedProperties._azure as Record<string, unknown>;
    expect(azure.reachState).toBe("no_rbac");
    expect(String(azure.requiredGrant)).toContain("Reader");
    expect(String(azure.requiredGrant)).toContain("arm-client");
  });

  it("reports azure_no_subscriptions with NO required-grant ask — nothing needs granting", async () => {
    mockProbe.mockResolvedValueOnce(reach({
      state: "no_subscriptions", subscriptions: [], managementGroupsHttpStatus: 200,
    }));

    const result = await executeMonitorCheck({
      check: armCheck, tenantId: "tenant-guid-arm", triggerId: "arm-3", skipIdempotency: true,
    });

    expect(result.status).toBe("azure_no_subscriptions");
    expect((result.extractedProperties._azure as Record<string, unknown>).requiredGrant).toBeNull();
  });

  it("reports a token failure as plain error, keeping unreachable distinct from both Azure states", async () => {
    mockProbe.mockResolvedValueOnce(reach({
      state: "unreachable", tokenAcquired: false, subscriptions: [],
      subscriptionsHttpStatus: null, errorMessage: "ARM token request failed: 401 AADSTS7000215",
    }));

    const result = await executeMonitorCheck({
      check: armCheck, tenantId: "tenant-guid-arm", triggerId: "arm-4", skipIdempotency: true,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("AADSTS7000215");
  });

  it("reports partial when a scope answers 403, keeping the data that DID come back", async () => {
    mockProbe.mockResolvedValueOnce(reach({
      subscriptions: [
        { subscriptionId: "sub-a", displayName: "A", state: "Enabled", tenantId: "t", managedByTenantIds: [] },
        { subscriptionId: "sub-b", displayName: "B", state: "Enabled", tenantId: "t", managedByTenantIds: [] },
      ],
    }));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      return url.includes("sub-a")
        ? new Response(JSON.stringify({ value: [{ roleName: "Contoso Reader" }] }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify({ error: { code: "AuthorizationFailed", message: "denied" } }), { status: 403, headers: { "Content-Type": "application/json" } });
    }));

    const result = await executeMonitorCheck({
      check: armCheck, tenantId: "tenant-guid-arm", triggerId: "arm-5", skipIdempotency: true,
    });

    expect(result.status).toBe("partial");
    expect(result.itemCount).toBe(1);
    const azure = result.extractedProperties._azure as Record<string, unknown>;
    expect(azure.scopesAttempted).toBe(2);
    expect(azure.scopesReadable).toBe(1);
    vi.unstubAllGlobals();
  });

  it("fails loudly on an arm_operation that is not in the code-owned registry, before any network call", async () => {
    const result = await executeMonitorCheck({
      check: { ...armCheck, armOperation: "drop-all-resource-groups" },
      tenantId: "tenant-guid-arm", triggerId: "arm-6", skipIdempotency: true,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("not in the code-owned registry");
    expect(mockProbe).not.toHaveBeenCalled();
  });
});
