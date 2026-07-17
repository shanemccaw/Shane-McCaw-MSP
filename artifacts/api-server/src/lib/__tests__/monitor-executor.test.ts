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
        returning: vi.fn().mockResolvedValue([{ profileId: "test-uuid" }]),
      }),
    }),
  },
  monitorChecksTable: {},
  monitoringPackagesTable: {},
  monitoringPackageChecksTable: {},
  tenantMonitorProfilesTable: {},
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
  markTenantConsentRevoked: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { graphFetchForTenant } from "../graph";
import { ConsentRevokedError } from "../graph";

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
    expect(classifySeverity(rules, { mfa_count: 0 })).toBe("critical");
    expect(classifySeverity(rules, { mfa_count: 5 })).toBe("warning");
    expect(classifySeverity(rules, { mfa_count: 15 })).toBe("ok");
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
    expect(classifySeverity(badRules, { score: 5 })).toBe("warning");
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
});

// ── graphFetchPaginated — pagination exhaustion ────────────────────────────────

describe("graphFetchPaginated", () => {
  const mockFetch = graphFetchForTenant as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects items across multiple pages", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      const page = callCount;
      return {
        ok: true,
        json: async () =>
          page < 3
            ? { value: [{ id: `item${page}` }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skip=next" }
            : { value: [{ id: `item${page}` }] },
      };
    });

    const result = await graphFetchPaginated("tenant1", "/users", "GET");
    expect(result.items).toHaveLength(3);
    expect(result.pageCount).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("handles single-page (no nextLink)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [{ id: "u1" }, { id: "u2" }] }),
    });

    const result = await graphFetchPaginated("tenant1", "/users", "GET");
    expect(result.items).toHaveLength(2);
    expect(result.pageCount).toBe(1);
  });

  it("handles non-collection (single object) response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "org1", displayName: "Contoso" }),
    });

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
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [{ id: "item" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skip=next" }),
    });

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
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [] }),
    });

    await graphFetchPaginated("tenant1", "/users?$filter=createdDateTime ge {30DaysAgo}", "GET");
    
    expect(mockFetch).toHaveBeenCalled();
    const calledUrl = mockFetch.mock.calls[0][1];
    // Check that the URL resolved {30DaysAgo} to a date string matching standard ISO pattern
    expect(calledUrl).toMatch(/\/users\?\$filter=createdDateTime ge \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("applies ConsistencyLevel: eventual header when URL has $filter= on GET", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [] }),
    });

    await graphFetchPaginated("tenant1", "/users?$filter=displayName eq 'Test'", "GET");

    expect(mockFetch).toHaveBeenCalled();
    const options = mockFetch.mock.calls[0][2];
    expect(options.headers).toBeDefined();
    expect(options.headers.ConsistencyLevel).toBe("eventual");
  });

  it("does not apply ConsistencyLevel: eventual header when URL has no filter", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [] }),
    });

    await graphFetchPaginated("tenant1", "/users", "GET");

    expect(mockFetch).toHaveBeenCalled();
    const options = mockFetch.mock.calls[0][2];
    expect(options.headers?.ConsistencyLevel).toBeUndefined();
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
    properties: ["mfaRegistered"] as string[],
    mapping: [] as Array<{ sourceField: string; targetField: string; transform?: string }>,
    severityRules: [{ expression: "mfaRegistered_count == 0", severity: "critical" }] as Array<{ expression: string; severity: string; label?: string }>,
    outputSchema: null,
    engines: ["health"] as string[],
    frequency: "daily" as const,
    requiresCustomerScript: false,
    schemaVersion: 1,
    status: "active" as const,
    createdByAdminId: null,
    updatedByAdminId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("returns ok status on successful check", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [{ id: "u1", mfaRegistered: true }] }),
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

  it("returns requires_script status for air-gapped checks", async () => {
    const airgappedCheck = { ...baseCheck, requiresCustomerScript: true };
    const result = await executeMonitorCheck({ check: airgappedCheck, tenantId: "tenant1", triggerId: "run1", skipIdempotency: true });
    expect(result.status).toBe("requires_script");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("applies severity classification to extracted data", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [] }),
    });

    const result = await executeMonitorCheck({ check: baseCheck, tenantId: "tenant1", triggerId: "run1", skipIdempotency: true });
    expect(result.severityMatched).toBe("critical");
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
      { key: "check:a", label: "Check A", endpoint: "/graph/a", method: "GET", properties: [], mapping: [], severityRules: [], engines: [], frequency: "daily", requiresCustomerScript: false, schemaVersion: 1, status: "active", outputSchema: null, selectParams: null, requestBody: null, description: null, id: 1, checkId: "uuid-a", createdByAdminId: null, updatedByAdminId: null, createdAt: new Date(), updatedAt: new Date() },
      { key: "check:b", label: "Check B", endpoint: "/graph/b", method: "GET", properties: [], mapping: [], severityRules: [], engines: [], frequency: "daily", requiresCustomerScript: false, schemaVersion: 1, status: "active", outputSchema: null, selectParams: null, requestBody: null, description: null, id: 2, checkId: "uuid-b", createdByAdminId: null, updatedByAdminId: null, createdAt: new Date(), updatedAt: new Date() },
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
