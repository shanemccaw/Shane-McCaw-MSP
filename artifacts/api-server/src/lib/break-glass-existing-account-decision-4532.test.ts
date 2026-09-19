/**
 * break-glass-existing-account-decision-4532.test.ts — Git #4532
 *
 * The gate-side helpers: what identifies the existing account (identifiers only,
 * never anything credential-shaped), and that a failed notification can never fail
 * the pause — the decision row and the Break-glass page are the source of truth.
 */
import { describe, it, expect, vi } from "vitest";

const state = vi.hoisted(() => ({ throwOnSelect: false, notified: 0 }));

vi.mock("@workspace/db", () => {
  const table = new Proxy({}, { get: (_t, col) => ({ name: String(col) }) });
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "values", "returning", "set"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(result).then(res, rej);
    return c;
  };
  return {
    db: {
      select: () => chain(() => {
        if (state.throwOnSelect) throw new Error("db down");
        return [{ name: "Contoso", mspId: 3 }];
      }),
      insert: () => chain(() => [{ id: 5, status: "pending" }]),
    },
    breakGlassExistingAccountDecisionsTable: table,
    tenantsTable: table,
    usersTable: table,
  };
});
vi.mock("@workspace/db/rbac/legacy-ladder", () => ({ LEGACY_ROLE: { mspAdmin: "MSPAdmin", mspOperator: "MSPOperator" } }));
vi.mock("./notification-center.ts", () => ({
  createNotification: async () => { state.notified += 1; return 1; },
  createNotificationForAllAdmins: async () => { state.notified += 1; return 1; },
}));
vi.mock("./logger.ts", () => {
  const n = () => {};
  const log = { info: n, warn: n, error: n, debug: n, fatal: n, trace: n, child: () => log };
  return { logger: log };
});

const { describeExistingAccount, notifyExistingAccountDecision, recordExistingAccountDecision } =
  await import("./break-glass-existing-account-decision.ts");

describe("#4532 describeExistingAccount", () => {
  it("reads the account's id and UPN off the create step's output", () => {
    expect(describeExistingAccount({ id: "abc", userPrincipalName: "breakglass-admin@contoso.com", passwordProfile: { password: "x" } }))
      .toEqual({ id: "abc", upn: "breakglass-admin@contoso.com" });
  });

  it("returns nulls, not guesses, for a missing or malformed step output", () => {
    expect(describeExistingAccount(null)).toEqual({ id: null, upn: null });
    expect(describeExistingAccount(undefined)).toEqual({ id: null, upn: null });
    expect(describeExistingAccount({ id: 42, userPrincipalName: "" })).toEqual({ id: null, upn: null });
    expect(describeExistingAccount("breakglass-admin")).toEqual({ id: null, upn: null });
  });
});

describe("#4532 notifyExistingAccountDecision", () => {
  const input = { runId: 10, customerId: 1, decisionId: 5, accountLabel: "breakglass-admin@contoso.com" };

  it("notifies platform admins (and the MSP's operators)", async () => {
    state.notified = 0;
    state.throwOnSelect = false;
    await notifyExistingAccountDecision(input);
    expect(state.notified).toBeGreaterThanOrEqual(1);
  });

  it("never throws — a failed notification must not fail the pause", async () => {
    state.throwOnSelect = true;
    await expect(notifyExistingAccountDecision(input)).resolves.toBeUndefined();
    state.throwOnSelect = false;
  });
});

describe("#4532 recordExistingAccountDecision", () => {
  it("returns the inserted pending decision row", async () => {
    const row = await recordExistingAccountDecision({
      runId: 10, gateNodeId: "gate-x", customerId: 1, pendingSecretId: 4,
      existingAccountId: "abc", existingAccountUpn: null, skippedNodeId: "tpl-create", context: {},
    });
    expect(row).toMatchObject({ id: 5, status: "pending" });
  });
});
