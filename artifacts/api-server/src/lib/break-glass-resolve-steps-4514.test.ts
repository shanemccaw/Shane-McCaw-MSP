/**
 * break-glass-resolve-steps-4514.test.ts — Git #4514
 *
 * The resolve-then-write extensions that make identity-ca-hardening-v1 find and
 * verify its break-glass exclusion group, and make quickstart-v1's break-glass
 * creates idempotent: `unique`, `collect` + `in:`, `onMatch: "skip-write"`,
 * @odata.nextLink paging, and the helpers the break-glass gate uses to refuse a
 * credential that was never applied.
 *
 * The step definitions below are the same JSON the migration writes
 * (lib/db/migrations/manual/2026-09-17-break-glass-resolve-steps-4514.sql); the
 * Graph responses are injected fakes shaped like the real testbed reads.
 */
import { describe, it, expect, vi } from "vitest";

import {
  runTemplateResolveSteps,
  resolveProvidedVariablesOf,
  templateBodyVariables,
  findUnappliedSecretSource,
  MAX_RESOLVE_PAGES,
  type BaselineTemplateResolveStep,
} from "./resolve-then-write.ts";

const GROUP_LOOKUP =
  "/groups?$filter=mailNickname%20eq%20'breakglass-ca-exclusion'%20or%20displayName%20eq%20'Break-Glass%20Accounts%20-%20CA%20Exclusion'&$select=id,displayName,mailNickname,securityEnabled";
const GA_LOOKUP =
  "/roleManagement/directory/roleAssignments?$filter=roleDefinitionId%20eq%20'62e90394-69f5-4237-9190-012177145e10'&$select=id,principalId,directoryScopeId";

const CA_PACK_STEPS: BaselineTemplateResolveStep[] = [
  { subject: "the break-glass CA exclusion group", endpoint: GROUP_LOOKUP, unique: true, assign: { breakGlassGroupId: "id" } },
  {
    subject: "an enabled user in the break-glass CA exclusion group",
    endpoint: "/groups/{{breakGlassGroupId}}/transitiveMembers/microsoft.graph.user?$select=id,accountEnabled,userPrincipalName",
    selectMatch: { accountEnabled: "true" },
    collect: { breakGlassEnabledMemberIds: "id" },
    assign: {},
  },
  {
    subject: "an active Global Administrator among the enabled members of the break-glass CA exclusion group",
    endpoint: GA_LOOKUP,
    selectMatch: { principalId: "in:{{breakGlassEnabledMemberIds}}", directoryScopeId: "/" },
    assign: { breakGlassVerifiedAdminId: "principalId" },
  },
];

const ACCOUNT_SKIP: BaselineTemplateResolveStep[] = [
  {
    subject: "an existing break-glass account",
    endpoint: "/users?$filter=mailNickname%20eq%20'breakglass-admin'",
    onMatch: "skip-write",
    assign: {},
  },
];

const group = (id: string) => ({ id, displayName: "Break-Glass Accounts - CA Exclusion", mailNickname: "breakglass-ca-exclusion", securityEnabled: true });

/** Route a fake Graph by endpoint prefix. */
function fakeGraph(routes: Record<string, unknown>) {
  return vi.fn(async (endpoint: string) => {
    for (const [prefix, body] of Object.entries(routes)) {
      if (endpoint.startsWith(prefix)) return body;
    }
    throw new Error(`unexpected GET ${endpoint}`);
  });
}

describe("#4514 identity-ca-hardening-v1 break-glass resolve", () => {
  it("resolves the group only when it is unique and holds an enabled active Global Admin", async () => {
    const graphGet = fakeGraph({
      "/groups?": { value: [group("g-1")] },
      "/groups/g-1/transitiveMembers": {
        value: [
          { id: "u-disabled", accountEnabled: false },
          { id: "u-plain", accountEnabled: true },
          { id: "u-bg", accountEnabled: true },
        ],
      },
      "/roleManagement": {
        value: [
          { id: "ra-1", principalId: "someone-else", directoryScopeId: "/" },
          { id: "ra-2", principalId: "u-disabled", directoryScopeId: "/" },
          { id: "ra-3", principalId: "U-BG", directoryScopeId: "/" },
        ],
      },
    });
    const out = await runTemplateResolveSteps(CA_PACK_STEPS, {}, graphGet);
    expect(out.failed).toBe(false);
    expect(out.resolvedVars.breakGlassGroupId).toBe("g-1");
    expect(out.resolvedVars.breakGlassEnabledMemberIds).toBe("u-plain,u-bg");
    // The disabled GA member does not count; the enabled one matches case-insensitively.
    expect(out.resolvedVars.breakGlassVerifiedAdminId).toBe("U-BG");
    expect(out.lookups.map((l) => l.matchedCount)).toEqual([1, 2, 1]);
  });

  it("fails closed on two exclusion groups and names both, without reading further", async () => {
    const graphGet = fakeGraph({ "/groups?": { value: [group("2bf1151a"), group("19219599")] } });
    const out = await runTemplateResolveSteps(CA_PACK_STEPS, { breakGlassGroupId: "operator-typed" }, graphGet);
    expect(out.failed).toBe(true);
    expect(out.reason).toContain("ambiguous");
    expect(out.reason).toContain("2bf1151a, 19219599");
    expect(out.reason).toContain("the break-glass CA exclusion group");
    expect(graphGet).toHaveBeenCalledTimes(1);
    expect(out.resolvedVars).toEqual({});
  });

  it("fails closed when no exclusion group exists", async () => {
    const out = await runTemplateResolveSteps(CA_PACK_STEPS, {}, fakeGraph({ "/groups?": { value: [] } }));
    expect(out.failed).toBe(true);
    expect(out.reason).toContain("matched no item");
  });

  it("fails closed when the group has no enabled user member", async () => {
    const out = await runTemplateResolveSteps(
      CA_PACK_STEPS,
      {},
      fakeGraph({ "/groups?": { value: [group("g-1")] }, "/groups/g-1/transitiveMembers": { value: [] } }),
    );
    expect(out.failed).toBe(true);
    expect(out.reason).toContain("an enabled user in the break-glass CA exclusion group");
  });

  it("fails closed when enabled members exist but none is an active tenant-wide Global Admin", async () => {
    const out = await runTemplateResolveSteps(
      CA_PACK_STEPS,
      {},
      fakeGraph({
        "/groups?": { value: [group("g-1")] },
        "/groups/g-1/transitiveMembers": { value: [{ id: "u-1", accountEnabled: true }] },
        // A GA assignment scoped to an administrative unit is not tenant-wide.
        "/roleManagement": { value: [{ id: "ra", principalId: "u-1", directoryScopeId: "/administrativeUnits/au-1" }] },
      }),
    );
    expect(out.failed).toBe(true);
    expect(out.reason).toContain("Global Administrator");
    expect(out.resolvedVars.breakGlassVerifiedAdminId).toBeUndefined();
  });

  it("does not demand breakGlassGroupId as an operator input", () => {
    const provided = resolveProvidedVariablesOf(CA_PACK_STEPS);
    expect(provided).toContain("breakGlassGroupId");
    expect(provided).toContain("breakGlassEnabledMemberIds");
  });
});

describe("#4514 quickstart-v1 resolve-then-skip", () => {
  it("does not skip when nothing exists — the create fires", async () => {
    const out = await runTemplateResolveSteps(ACCOUNT_SKIP, {}, fakeGraph({ "/users?": { value: [] } }));
    expect(out.failed).toBe(false);
    expect(out.skipWrite).toBeUndefined();
  });

  it("skips onto the single existing account and reports it as the step's item", async () => {
    const existing = { id: "00b799b7", userPrincipalName: "breakglass-admin@shanemccaw.com" };
    const out = await runTemplateResolveSteps(ACCOUNT_SKIP, {}, fakeGraph({ "/users?": { value: [existing] } }));
    expect(out.failed).toBe(false);
    expect(out.skipWrite?.item).toEqual(existing);
  });

  it("fails closed on two existing accounts rather than skipping onto either", async () => {
    const out = await runTemplateResolveSteps(
      ACCOUNT_SKIP,
      {},
      fakeGraph({
        "/users?": {
          value: [
            { id: "00b799b7", userPrincipalName: "breakglass-admin@shanemccaw.com" },
            { id: "be87e536", userPrincipalName: "breakglass-admin@mccawsoft.com" },
          ],
        },
      }),
    );
    expect(out.failed).toBe(true);
    expect(out.skipWrite).toBeUndefined();
    expect(out.reason).toContain("00b799b7, be87e536");
  });

  it("counts a duplicate on a later page", async () => {
    const graphGet = vi.fn(async (endpoint: string) =>
      endpoint.startsWith("/users?")
        ? { value: [{ id: "a" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skiptoken=x" }
        : { value: [{ id: "b" }] },
    );
    const out = await runTemplateResolveSteps(ACCOUNT_SKIP, {}, graphGet);
    expect(out.failed).toBe(true);
    expect(out.reason).toContain("a, b");
    expect(graphGet).toHaveBeenCalledWith("https://graph.microsoft.com/v1.0/users?$skiptoken=x");
  });

  it("refuses to call a never-ending result unique", async () => {
    const graphGet = vi.fn(async () => ({ value: [], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skiptoken=again" }));
    const out = await runTemplateResolveSteps(ACCOUNT_SKIP, {}, graphGet);
    expect(out.failed).toBe(true);
    expect(out.reason).toContain(`more than ${MAX_RESOLVE_PAGES} pages`);
    expect(graphGet).toHaveBeenCalledTimes(MAX_RESOLVE_PAGES);
  });

  it("a plain first-match step still stops paging once it matches", async () => {
    const graphGet = vi.fn(async () => ({ value: [{ id: "x" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next" }));
    const out = await runTemplateResolveSteps([{ endpoint: "/a", assign: { v: "id" } }], {}, graphGet);
    expect(out.resolvedVars).toEqual({ v: "x" });
    expect(graphGet).toHaveBeenCalledTimes(1);
  });
});

describe("#4514 unapplied-credential detection for the break-glass gate", () => {
  const accountBody = {
    displayName: "Emergency Access Admin",
    passwordProfile: { password: "{{generatedPassword}}", forceChangePasswordNextSignIn: false },
    userPrincipalName: "breakglass-admin@{{domain}}",
  };

  it("lists the variables a skipped body carried", () => {
    expect(templateBodyVariables(accountBody).sort()).toEqual(["domain", "generatedPassword"]);
  });

  it("finds the skipped create that carried the secret", () => {
    const nodes = {
      start: { started: true },
      "tpl-quickstart-v1-create-break-glass-account": {
        success: true,
        data: { id: "00b799b7", userPrincipalName: "breakglass-admin@shanemccaw.com" },
        skippedExisting: true,
        unappliedVariables: templateBodyVariables(accountBody),
      },
    };
    const hit = findUnappliedSecretSource(nodes, ["generatedPassword"]);
    expect(hit?.nodeId).toBe("tpl-quickstart-v1-create-break-glass-account");
    expect((hit?.existing as { id: string }).id).toBe("00b799b7");
  });

  it("ignores a skipped step whose body never held the secret, and a real create", () => {
    const nodes = {
      "tpl-quickstart-v1-create-ca-exclusion-group": { success: true, data: { id: "g" }, skippedExisting: true, unappliedVariables: [] },
      "tpl-quickstart-v1-create-break-glass-account": { success: true, status: 201, data: { id: "new" } },
      // A dry-run's { skipped: true } is not a skipped-existing write.
      dry: { dryRun: true, skipped: true },
    };
    expect(findUnappliedSecretSource(nodes, ["generatedPassword"])).toBeNull();
    expect(findUnappliedSecretSource(undefined, ["generatedPassword"])).toBeNull();
  });
});
