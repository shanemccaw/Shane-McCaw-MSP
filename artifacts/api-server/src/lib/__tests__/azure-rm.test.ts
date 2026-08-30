import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * #1871 — the azure-rm transport's reach model.
 *
 * These tests exist for ONE reason, and it is the specific failure the issue was
 * opened to prevent: an ARM listing is RBAC-filtered, so `{"value":[]}` is
 * returned both by a tenant that genuinely has no Azure AND by a tenant whose
 * Azure we simply have not been granted a role on. Reporting either as the other
 * states a fact that was never observed.
 *
 * The distinguishing signal is whether we can read a scope ABOVE the
 * subscription level. Every case below pins one branch of that decision to a
 * real, documented HTTP shape — the shapes were taken from live calls against a
 * real Azure tenant on 2026-08-30, not invented for the test.
 */

const ARM = "https://management.azure.com";
const TENANT = "11111111-2222-3333-4444-555555555555";

/** A real ARM token's payload shape — only `oid` is read, and only for logging/filters. */
function fakeJwt(oid: string): string {
  const payload = Buffer.from(JSON.stringify({ oid, aud: ARM, tid: TENANT })).toString("base64url");
  return `header.${payload}.signature`;
}

type Handler = (url: string) => { status: number; body: unknown } | undefined;

function installFetch(handlers: Handler[]) {
  const calls: string[] = [];
  // `string | URL`, not the DOM's `RequestInfo` — this package's tsconfig does
  // not pull in the DOM lib, so `RequestInfo` is not a name here.
  const spy = vi.fn(async (input: string | URL, init?: RequestInit) => {
    void init;
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    for (const h of handlers) {
      const res = h(url);
      if (res) {
        return new Response(JSON.stringify(res.body), {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    throw new Error(`unstubbed fetch: ${url}`);
  });
  vi.stubGlobal("fetch", spy);
  return { calls, spy };
}

/** The token endpoint always succeeds unless a test overrides it. */
const tokenOk: Handler = (url) =>
  url.includes("login.microsoftonline.com")
    ? { status: 200, body: { access_token: fakeJwt("sp-object-id"), expires_in: 3600 } }
    : undefined;

const subscriptions = (value: unknown[]): Handler => (url) =>
  url.startsWith(`${ARM}/subscriptions?`) ? { status: 200, body: { value, count: { type: "Total", value: value.length } } } : undefined;

const managementGroups = (status: number, body: unknown): Handler => (url) =>
  url.includes("Microsoft.Management/managementGroups") ? { status, body } : undefined;

/** Verbatim shape of the 403 a subscription-scoped principal really gets on managementGroups. */
const MG_403 = {
  error: {
    code: "AuthorizationFailed",
    message: "The client '…' with object id '…' does not have authorization to perform action " +
      "'Microsoft.Management/managementGroups/read' over scope '/providers/Microsoft.Management' or the scope is invalid.",
  },
};

/** Verbatim shape of a real subscription entry. */
const PAYG_SUBSCRIPTION = {
  id: "/subscriptions/eae24589-2931-4571-9269-0fc6da779f06",
  authorizationSource: "RoleBased",
  managedByTenants: [],
  subscriptionId: "eae24589-2931-4571-9269-0fc6da779f06",
  tenantId: TENANT,
  displayName: "Pay-As-You-Go",
  state: "Enabled",
};

let azureRm: typeof import("../azure-rm");

beforeEach(async () => {
  vi.resetModules();
  process.env.AZURE_RM_CLIENT_ID = "arm-client-id";
  process.env.AZURE_RM_CLIENT_SECRET = "arm-client-secret";
  azureRm = await import("../azure-rm");
  azureRm.__clearArmTokenCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AZURE_RM_CLIENT_ID;
  delete process.env.AZURE_RM_CLIENT_SECRET;
});

describe("probeAzureRmReach — the four states are genuinely distinct", () => {
  it("reports 'ok' when the RBAC-filtered listing returns a real subscription", async () => {
    installFetch([tokenOk, subscriptions([PAYG_SUBSCRIPTION])]);

    const reach = await azureRm.probeAzureRmReach(TENANT);

    expect(reach.state).toBe("ok");
    expect(reach.tokenAcquired).toBe(true);
    expect(reach.subscriptionsHttpStatus).toBe(200);
    expect(reach.subscriptions).toEqual([{
      subscriptionId: "eae24589-2931-4571-9269-0fc6da779f06",
      displayName: "Pay-As-You-Go",
      state: "Enabled",
      tenantId: TENANT,
      managedByTenantIds: [],
    }]);
  });

  it("does NOT probe management groups once a subscription is visible — the listing already proves reach", async () => {
    const { calls } = installFetch([tokenOk, subscriptions([PAYG_SUBSCRIPTION])]);

    await azureRm.probeAzureRmReach(TENANT);

    expect(calls.some((u) => u.includes("managementGroups"))).toBe(false);
  });

  it("reports 'no_rbac' — NOT 'no_subscriptions' — for an empty listing with no tenant-root read", async () => {
    // This is the platform multi-tenant app's real situation on the testbed
    // tenant: a valid ARM token, HTTP 200, and nothing visible, because Graph
    // consent confers no Azure RBAC. Saying "this customer has no Azure" here
    // would be inventing a fact.
    installFetch([tokenOk, subscriptions([]), managementGroups(403, MG_403)]);

    const reach = await azureRm.probeAzureRmReach(TENANT);

    expect(reach.state).toBe("no_rbac");
    expect(reach.tokenAcquired).toBe(true);
    expect(reach.subscriptionsHttpStatus).toBe(200);
    expect(reach.managementGroupsHttpStatus).toBe(403);
    expect(reach.subscriptions).toEqual([]);
  });

  it("reports 'no_subscriptions' only when a readable management-group scope corroborates the empty listing", async () => {
    installFetch([tokenOk, subscriptions([]), managementGroups(200, { value: [] })]);

    const reach = await azureRm.probeAzureRmReach(TENANT);

    expect(reach.state).toBe("no_subscriptions");
    expect(reach.managementGroupsHttpStatus).toBe(200);
  });

  it("reports 'unreachable' when no ARM token can be acquired, and records why", async () => {
    installFetch([(url) =>
      url.includes("login.microsoftonline.com")
        ? { status: 401, body: { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." } }
        : undefined,
    ]);

    const reach = await azureRm.probeAzureRmReach(TENANT);

    expect(reach.state).toBe("unreachable");
    expect(reach.tokenAcquired).toBe(false);
    expect(reach.subscriptionsHttpStatus).toBeNull();
    expect(reach.errorMessage).toContain("AADSTS7000215");
  });

  it("never throws — a total failure is still one of the four states", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));

    await expect(azureRm.probeAzureRmReach(TENANT)).resolves.toMatchObject({ state: "unreachable" });
  });

  it("records the principal the answer is about — reach is a property of the principal, not the tenant", async () => {
    installFetch([tokenOk, subscriptions([])
      , managementGroups(403, MG_403)]);

    const reach = await azureRm.probeAzureRmReach(TENANT);

    expect(reach.principalClientId).toBe("arm-client-id");
    expect(reach.principalObjectId).toBe("sp-object-id");
  });

  it("surfaces an Azure Lighthouse delegation on the subscription it is carried on", async () => {
    const managingTenant = "99999999-8888-7777-6666-555555555555";
    installFetch([tokenOk, subscriptions([{ ...PAYG_SUBSCRIPTION, managedByTenants: [{ tenantId: managingTenant }] }])]);

    const reach = await azureRm.probeAzureRmReach(TENANT);

    expect(reach.subscriptions[0]!.managedByTenantIds).toEqual([managingTenant]);
  });
});

describe("armGet — the undici Accept-Language default (#393/#488) reaches ARM too", () => {
  it("sets an explicit Accept-Language on every outgoing ARM request", async () => {
    // Without this, undici sends `accept-language: *` and ARM's PIM surface
    // answers 400 CultureNotFoundException: "'*' is an invalid culture
    // identifier" — reproduced live on ARM, not just on Graph.
    const { spy } = installFetch([() => ({ status: 200, body: { value: [] } })]);

    await azureRm.armGet("token", "/subscriptions?api-version=2022-12-01");

    const init = spy.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["Accept-Language"]).toBe("en-US");
    expect(headers["Accept-Language"]).not.toBe("*");
  });

  it("exposes no verb other than GET, so nothing built on it can write to ARM", () => {
    // The read-only guarantee in #1871 is structural, not a convention: assert
    // the module surface itself, so adding a write helper fails this test.
    const writeVerbs = Object.keys(azureRm).filter((k) => /post|put|patch|delete|create|assign/i.test(k));
    expect(writeVerbs).toEqual([]);
  });
});

describe("armGetAll — a readable-and-empty scope is not the same as an unauthorized one", () => {
  it("returns the real first-page status alongside the items, and follows nextLink", async () => {
    let page = 0;
    installFetch([(url) => {
      if (!url.includes("/subscriptions")) return undefined;
      page += 1;
      return page === 1
        ? { status: 200, body: { value: [{ subscriptionId: "a" }], nextLink: `${ARM}/subscriptions?page=2` } }
        : { status: 200, body: { value: [{ subscriptionId: "b" }] } };
    }]);

    const res = await azureRm.armGetAll("token", "/subscriptions?api-version=2022-12-01");

    expect(res.status).toBe(200);
    expect(res.error).toBeNull();
    expect(res.items).toHaveLength(2);
  });

  it("reports a 403 as an error with its status, rather than as an empty result", async () => {
    installFetch([() => ({ status: 403, body: MG_403 })]);

    const res = await azureRm.armGetAll("token", "/subscriptions/x/resourcegroups?api-version=2021-04-01");

    expect(res.status).toBe(403);
    expect(res.error).not.toBeNull();
    expect(res.items).toEqual([]);
  });
});

describe("transportHasExecutor — 'no executor exists' is distinct from 'no check written yet' (#1849 point 3)", () => {
  it("reports azure-rm as executable now that this transport exists", async () => {
    const { transportHasExecutor } = await import("@workspace/db");
    expect(transportHasExecutor("azure-rm")).toBe(true);
    expect(transportHasExecutor("graph")).toBe(true);
    expect(transportHasExecutor("powershell")).toBe(true);
    expect(transportHasExecutor("sharepoint-admin")).toBe(true);
    expect(transportHasExecutor("dns")).toBe(true);
    // #1869 landed alongside this work against the same enum; both transports
    // are present, neither replaced the other.
    expect(transportHasExecutor("power-platform")).toBe(true);
  });

  it("classifies an azure-rm resource by its check count now, not as an unreachable transport", async () => {
    const { coverageStateFor } = await import("@workspace/db");
    // Before #1871 every azure-rm resource was `no_executor` whatever its check
    // count said. Now the transport exists, so the ordinary rule applies again.
    expect(coverageStateFor("azure-rm", 0)).toBe("uncovered");
    expect(coverageStateFor("azure-rm", 3)).toBe("covered");
  });

  it("still reports no_executor for a transport nothing can read", async () => {
    const { coverageStateFor, transportHasExecutor } = await import("@workspace/db");
    // `unknown` means no source stated how the resource is read. It is the only
    // read_transport left that no executor backs, and it must keep reading as
    // unreachable rather than as a check nobody got round to writing (#1849).
    expect(transportHasExecutor("unknown")).toBe(false);
    expect(coverageStateFor("unknown", 0)).toBe("no_executor");
    expect(coverageStateFor("unknown", 5)).toBe("no_executor");
  });
});

describe("AZURE_RM_OPERATIONS — code-owned registry, never a stored URL", () => {
  it("rejects an operation key that is not in the registry, loudly", () => {
    expect(() => azureRm.resolveAzureRmOperation("delete-everything")).toThrow(/not in the code-owned registry/);
    expect(() => azureRm.resolveAzureRmOperation(null)).toThrow(/not in the code-owned registry/);
  });

  it("issues one GET per visible subscription and records each scope's real outcome", async () => {
    const reach = {
      state: "ok" as const,
      tokenAcquired: true,
      subscriptionsHttpStatus: 200,
      managementGroupsHttpStatus: null,
      subscriptions: [
        { subscriptionId: "sub-a", displayName: "A", state: "Enabled", tenantId: TENANT, managedByTenantIds: [] },
        { subscriptionId: "sub-b", displayName: "B", state: "Enabled", tenantId: TENANT, managedByTenantIds: [] },
      ],
      principalClientId: "arm-client-id",
      principalObjectId: "sp-object-id",
      errorMessage: null,
    };
    // sub-a answers; sub-b is not authorized. The run must keep sub-a's real
    // data AND record that sub-b was refused — collapsing either way loses a fact.
    installFetch([(url) => {
      if (url.includes("/subscriptions/sub-a/")) return { status: 200, body: { value: [{ roleName: "custom-a" }] } };
      if (url.includes("/subscriptions/sub-b/")) return { status: 403, body: MG_403 };
      return undefined;
    }]);

    const ctx = { tenantId: TENANT, accessToken: "token", reach, scopeOutcomes: [] };
    const items = await azureRm.AZURE_RM_OPERATIONS["list-custom-role-definitions"]!(ctx);

    expect(items).toEqual([{ roleName: "custom-a", _subscriptionId: "sub-a", _subscriptionName: "A" }]);
    expect(ctx.scopeOutcomes).toEqual([
      { scope: "/subscriptions/sub-a", httpStatus: 200, ok: true, errorCode: null },
      { scope: "/subscriptions/sub-b", httpStatus: 403, ok: false, errorCode: "AuthorizationFailed" },
    ]);
  });

  it("list-subscriptions reads the reach probe's own result rather than re-listing", async () => {
    installFetch([() => { throw new Error("list-subscriptions must not issue its own HTTP call"); }]);
    const reach = {
      state: "ok" as const,
      tokenAcquired: true,
      subscriptionsHttpStatus: 200,
      managementGroupsHttpStatus: null,
      subscriptions: [{ subscriptionId: "sub-a", displayName: "A", state: "Enabled", tenantId: TENANT, managedByTenantIds: ["managing-tenant"] }],
      principalClientId: null,
      principalObjectId: null,
      errorMessage: null,
    };

    const items = await azureRm.AZURE_RM_OPERATIONS["list-subscriptions"]!({
      tenantId: TENANT, accessToken: "token", reach, scopeOutcomes: [],
    });

    expect(items).toEqual([{
      subscriptionId: "sub-a",
      displayName: "A",
      state: "Enabled",
      tenantId: TENANT,
      managedByTenantIds: ["managing-tenant"],
      isLighthouseDelegated: true,
    }]);
  });
});
