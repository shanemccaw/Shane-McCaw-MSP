/**
 * #2166 — the Purview DLP role group must be provisioned for the SP that
 * actually runs the DLP `powershell` checks (the ps-execution container's app,
 * PS_EXECUTION_APP_CLIENT_ID / 9ea2e409-…), NOT the api-server's own READ app
 * (MT_APP_CLIENT_ID / 4743b130-…). The same env var name holds two different
 * app registrations in the two runtimes, which is exactly how the wrong SP got
 * added — and how it would silently regress. These tests pin the target.
 *
 * Sibling of the #2161 Gap 3 fix in global-reader-role-provisioning.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Real app ids from docs/tenant-permission-model.md §2 (live-verified 2026-09-01).
const PS_EXEC_APP_ID = "9ea2e409-d1b9-422a-8451-02fa0b98d1c3";
const PS_EXEC_SP_ID = "1c640fe8-1c23-4510-8235-9ee6938d8f8b";
const READ_APP_ID = "4743b130-0379-41bf-b863-ec8de96d915a";
const READ_SP_ID = "6bae4b49-d1e5-470d-9cae-fef901b57f9a";

// Graph reads this module makes, recorded so the assertions can prove WHICH
// appId the service-principal lookup filtered on.
const mockGraphCalls: string[] = [];
// SP object id returned for a given appId filter — the real per-tenant mapping.
const SP_BY_APP_ID: Record<string, string> = {
  [PS_EXEC_APP_ID]: PS_EXEC_SP_ID,
  [READ_APP_ID]: READ_SP_ID,
};

vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }) }) },
  auditLogsTable: { createdAt: "created_at", metadata: "metadata", entityType: "entity_type", entityId: "entity_id", actionType: "action_type" },
}));

vi.mock("./graph", () => {
  class WriteBackNotEnabledError extends Error {}
  class WriteBackCustomerNotFoundError extends Error {}
  class WriteConsentRequiredError extends Error {}
  return {
    WriteBackNotEnabledError,
    WriteBackCustomerNotFoundError,
    WriteConsentRequiredError,
    graphFetchForTenant: vi.fn(async (_tenantId: string, path: string) => {
      mockGraphCalls.push(path);
      if (path.startsWith("/servicePrincipals")) {
        const appId = /appId eq '([^']+)'/.exec(path)?.[1] ?? "";
        const id = SP_BY_APP_ID[appId];
        return { ok: true, json: async () => ({ value: id ? [{ id }] : [] }) };
      }
      if (path.startsWith("/groups?")) {
        // No pre-existing provisioning group in this tenant.
        return { ok: true, json: async () => ({ value: [] }) };
      }
      if (/^\/groups\/[^/]+\/members/.test(path)) {
        return { ok: true, json: async () => ({ value: [] }) };
      }
      return { ok: false, json: async () => ({}) };
    }),
  };
});

const mockRunBaselineTemplate = vi.fn();
vi.mock("./workflow-executor", () => ({
  runBaselineTemplateAgainstTenant: (...args: unknown[]) => mockRunBaselineTemplate(...args),
}));

const mockCallPsExecution = vi.fn(async (_cmdlet: string, _params: Record<string, unknown>) => ({ items: [{ status: "added" }] }));
vi.mock("./ps-execution-client", () => {
  class PsExecutionError extends Error {
    kind = "unknown";
  }
  return {
    PsExecutionError,
    callPsExecution: (cmdlet: string, params: Record<string, unknown>) => mockCallPsExecution(cmdlet, params),
  };
});

const mockCreateAuditLog = vi.fn(async (_entry: { metadata: Record<string, unknown> }) => {});
vi.mock("./audit", () => ({ createAuditLog: (entry: { metadata: Record<string, unknown> }) => mockCreateAuditLog(entry) }));

vi.mock("./logger", () => ({
  logger: { child: () => ({ info: () => {}, warn: () => {}, error: () => {} }) },
}));

const { provisionDlpRoleGroupForTenant } = await import("./dlp-role-group-provisioning.ts");

const TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
const CUSTOMER_ID = 1;

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockGraphCalls.length = 0;
  mockRunBaselineTemplate.mockReset();
  mockRunBaselineTemplate.mockImplementation(async (templateId: string) =>
    templateId === "groups.create_security_group"
      ? { success: true, status: 201, data: { id: "group-object-id" } }
      : { success: true, status: 204, data: null },
  );
  mockCallPsExecution.mockClear();
  mockCreateAuditLog.mockClear();
  process.env.PURVIEW_DLP_ROLE_GROUP_NAME = "Compliance Data Administrator";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("#2166 — DLP role-group provisioning targets the ps-execution app's service principal", () => {
  it("resolves the SP from PS_EXECUTION_APP_CLIENT_ID, not the api-server's MT_APP_CLIENT_ID", async () => {
    process.env.PS_EXECUTION_APP_CLIENT_ID = PS_EXEC_APP_ID;
    process.env.MT_APP_CLIENT_ID = READ_APP_ID;

    const result = await provisionDlpRoleGroupForTenant(TENANT_ID, CUSTOMER_ID, "consent.granted");

    const spLookup = mockGraphCalls.find(p => p.startsWith("/servicePrincipals"));
    expect(spLookup).toContain(`appId eq '${PS_EXEC_APP_ID}'`);
    expect(spLookup).not.toContain(READ_APP_ID);

    expect(result.servicePrincipalId).toBe(PS_EXEC_SP_ID);
    expect(result.servicePrincipalId).not.toBe(READ_SP_ID);
    expect(result.targetAppId).toBe(PS_EXEC_APP_ID);
    expect(result.targetAppIdSource).toBe("PS_EXECUTION_APP_CLIENT_ID");
    expect(result.overallStatus).toBe("provisioned");
  });

  it("adds that same ps-execution SP — not the READ app SP — to the security group", async () => {
    process.env.PS_EXECUTION_APP_CLIENT_ID = PS_EXEC_APP_ID;
    process.env.MT_APP_CLIENT_ID = READ_APP_ID;

    await provisionDlpRoleGroupForTenant(TENANT_ID, CUSTOMER_ID, "consent.granted");

    const memberCall = mockRunBaselineTemplate.mock.calls.find(c => c[0] === "groups.add_service_principal_member");
    expect(memberCall).toBeDefined();
    expect(memberCall![3]).toMatchObject({ groupId: "group-object-id", servicePrincipalId: PS_EXEC_SP_ID });
  });

  it("records the resolved appId and its source env var in the step detail and audit metadata", async () => {
    process.env.PS_EXECUTION_APP_CLIENT_ID = PS_EXEC_APP_ID;
    process.env.MT_APP_CLIENT_ID = READ_APP_ID;

    const result = await provisionDlpRoleGroupForTenant(TENANT_ID, CUSTOMER_ID, "consent.granted");

    expect(result.steps.resolveServicePrincipal.status).toBe("succeeded");
    expect(result.steps.resolveServicePrincipal.detail).toContain(`appId=${PS_EXEC_APP_ID}`);
    expect(result.steps.resolveServicePrincipal.detail).toContain("PS_EXECUTION_APP_CLIENT_ID");

    const auditEntry = mockCreateAuditLog.mock.calls[0]?.[0];
    expect(auditEntry?.metadata.targetAppId).toBe(PS_EXEC_APP_ID);
    expect(auditEntry?.metadata.targetAppIdSource).toBe("PS_EXECUTION_APP_CLIENT_ID");
  });

  it("falls back to MT_APP_CLIENT_ID for a unified deployment, and says so in the trail", async () => {
    delete process.env.PS_EXECUTION_APP_CLIENT_ID;
    process.env.MT_APP_CLIENT_ID = PS_EXEC_APP_ID; // unified deployment: same app in both runtimes

    const result = await provisionDlpRoleGroupForTenant(TENANT_ID, CUSTOMER_ID, "consent.granted");

    expect(result.servicePrincipalId).toBe(PS_EXEC_SP_ID);
    expect(result.targetAppId).toBe(PS_EXEC_APP_ID);
    expect(result.targetAppIdSource).toContain("MT_APP_CLIENT_ID");
    expect(result.targetAppIdSource).toContain("fallback");
  });

  it("fails the resolve step explicitly — and writes nothing — when neither env var is set", async () => {
    delete process.env.PS_EXECUTION_APP_CLIENT_ID;
    delete process.env.MT_APP_CLIENT_ID;

    const result = await provisionDlpRoleGroupForTenant(TENANT_ID, CUSTOMER_ID, "consent.granted");

    expect(result.overallStatus).toBe("failed");
    expect(result.steps.resolveServicePrincipal.status).toBe("failed");
    expect(result.steps.resolveServicePrincipal.detail).toContain("PS_EXECUTION_APP_CLIENT_ID");
    expect(result.targetAppId).toBeNull();
    expect(mockRunBaselineTemplate).not.toHaveBeenCalled();
    expect(mockCallPsExecution).not.toHaveBeenCalled();
  });
});
