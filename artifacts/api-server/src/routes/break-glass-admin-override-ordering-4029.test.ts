/**
 * break-glass-admin-override-ordering-4029.test.ts — Git #4029, #4040
 *
 * performBreakGlassAdminOverride() used to reset the tenant password FIRST and only
 * then ask the generated-secret store to hold the replacement. An unconfigured store
 * (live-confirmed on #4015's harness) or a store that threw left the break-glass
 * Global Administrator on a password nobody held, while the old pending secret went
 * on offering the dead credential.
 *
 * #4040 — nothing serialized two overrides on the same secret, so both reset the
 * tenant. Every override now claims the row (pending_delivery → reset_in_progress)
 * before anything else and hands it back on every refusal.
 *
 * These pin the order and every failure branch around the one irreversible step.
 * The live counterpart (real Graph reset, real Postgres, a real concurrent pair) is
 * src/routes/break-glass-admin-override.live-verify.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  configured: true,
  storeThrows: false,
  writeResult: { success: true, status: 204, data: null } as { success: boolean; status: number; data: unknown; errorType?: string },
  writeThrows: null as Error | null,
  txFailures: 0,
  claimAvailable: true,
  claimLost: false,
  selectQueue: [] as unknown[][],
}));

vi.mock("@workspace/db", () => {
  const table = new Proxy({}, { get: (_t, col) => ({ name: String(col) }) });
  const chain = (result: () => unknown, onSet?: (v: Record<string, unknown>) => void) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit", "innerJoin", "values", "returning"]) c[m] = () => c;
    c.set = (v: Record<string, unknown>) => { onSet?.(v); return c; };
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(result).then(res, rej);
    return c;
  };
  const db = {
    select: () => chain(() => state.selectQueue.shift() ?? []),
    // The claim (→ reset_in_progress) and the release (→ pending_delivery) are the
    // only non-transactional updates the override makes.
    update: () => {
      let op = "";
      return chain(
        () => (op === "claim" ? (state.claimAvailable ? [{ id: 4 }] : []) : []),
        (v) => { op = v.status === "reset_in_progress" ? "claim" : "release"; state.calls.push(op); },
      );
    },
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      state.calls.push("tx");
      if (state.txFailures > 0) {
        state.txFailures -= 1;
        throw new Error("connection terminated");
      }
      await fn({
        update: () => chain(() => (state.claimLost ? [] : [{ id: 4 }])),
        insert: () => chain(() => [{ id: 77 }]),
      });
      state.calls.push("tx:commit");
    },
  };
  return {
    db,
    breakGlassPendingSecretsTable: table,
    breakGlassVerificationAttemptsTable: table,
    breakGlassOverrideAuditTable: table,
    tenantsTable: table,
    mspsTable: table,
    wfRunsTable: table,
    wfDefinitionsTable: table,
    configPacksTable: table,
  };
});
vi.mock("@workspace/db/rbac/legacy-ladder", () => ({ LEGACY_ROLE: { platformAdmin: "PlatformAdmin", mspAdmin: "MSPAdmin", mspOperator: "MSPOperator" } }));
vi.mock("../middlewares/requireAuth.ts", () => ({ requireAuth: () => {}, assertCustomerAccess: async () => true }));
vi.mock("../lib/portal-customer-scope.ts", () => ({ resolveCustomerId: () => null }));
vi.mock("../lib/secret-crypto.ts", () => ({ encryptSecret: () => "enc", decryptSecret: () => "" }));
vi.mock("../lib/mailer.ts", () => ({ sendEmailForMspOrThrow: async () => {} }));
vi.mock("../lib/logger.ts", () => {
  const n = () => {};
  const log = { info: n, warn: n, error: n, debug: n, fatal: n, trace: n, child: () => log };
  return { logger: log };
});
vi.mock("../lib/graph.ts", () => {
  class WriteBackNotEnabledError extends Error { reason = "write_back_disabled"; }
  class WriteBackCustomerNotFoundError extends Error { reason = "customer_not_found"; }
  class WriteConsentRequiredError extends Error { reason = "no_row"; }
  return {
    WriteBackNotEnabledError,
    WriteBackCustomerNotFoundError,
    WriteConsentRequiredError,
    sendMailViaGraph: async () => {},
    graphCredentialsPresent: () => false,
    graphWriteForTenant: async () => {
      state.calls.push("graph");
      if (state.writeThrows) throw state.writeThrows;
      return state.writeResult;
    },
  };
});
vi.mock("../lib/generated-secret-store.ts", () => ({
  generatedSecretStoreConfigured: () => state.configured,
  storeGeneratedSecret: async () => {
    state.calls.push("store");
    if (state.storeThrows) throw new Error("vault unreachable");
    return { kind: "azure-key-vault", vaultUrl: "https://v", secretName: "genc-dev-breakglass-c1-abc", version: "1", expiresOn: "", purpose: "break-glass", customerId: 1 };
  },
  purgeGeneratedSecret: async () => {
    state.calls.push("purge");
    return true;
  },
}));

const { performBreakGlassAdminOverride } = await import("./break-glass-verification.ts");
const { WriteConsentRequiredError } = await import("../lib/graph.ts");

const ctx = () => ({
  secret: {
    id: 4, runId: 10, customerId: 1, encryptedValue: "enc", secretRef: null, gateNodeId: "gate",
    breakGlassAccountId: "0f8fad5b-d9cb-469f-a165-70867728950e", status: "pending_delivery",
    createdAt: new Date(), deliveredAt: null, deliveredToEmail: null,
  },
  mspId: 1, tenantId: "c4c814d4-3afe-441e-9145-62461d0a4fd3", domain: null,
  branding: { name: null, logoUrl: null, primaryColor: null },
}) as never;

const override = () => performBreakGlassAdminOverride(ctx(), 4, 9, "dead-ended", undefined);

beforeEach(() => {
  state.calls = [];
  state.configured = true;
  state.storeThrows = false;
  state.writeResult = { success: true, status: 204, data: null };
  state.writeThrows = null;
  state.txFailures = 0;
  state.claimAvailable = true;
  state.claimLost = false;
  state.selectQueue = [];
});

describe("#4029 — admin-override never resets a credential it cannot keep", () => {
  it("refuses with an unconfigured store before any tenant write", async () => {
    state.configured = false;
    const result = await override();
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(state.calls).toEqual(["claim", "release"]);
  });

  it("refuses when the store throws, before any tenant write", async () => {
    state.storeThrows = true;
    const result = await override();
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(state.calls).toEqual(["claim", "store", "release"]);
  });

  it("stores the replacement before the reset, and records it after", async () => {
    const result = await override();
    expect(result).toEqual({ ok: true, newPendingSecretId: 77, reissued: 0, sent: 0 });
    expect(state.calls).toEqual(["claim", "store", "graph", "tx", "tx:commit"]);
  });

  it("purges the provisional copy when Graph definitely refused the reset", async () => {
    for (const status of [400, 403, 404, 429]) {
      state.calls = [];
      state.writeResult = { success: false, status, data: "", errorType: "unexpected" };
      const result = await override();
      expect(result).toMatchObject({ ok: false, status: 502 });
      expect(state.calls).toEqual(["claim", "store", "graph", "purge", "release"]);
    }
  });

  it("purges the provisional copy and rethrows when a write-back gate refused", async () => {
    state.writeThrows = new WriteConsentRequiredError("consent");
    await expect(override()).rejects.toBeInstanceOf(WriteConsentRequiredError);
    expect(state.calls).toEqual(["claim", "store", "graph", "purge", "release"]);
  });

  it("keeps the stored copy when the reset outcome is unknown (5xx)", async () => {
    state.writeResult = { success: false, status: 503, data: "", errorType: "unexpected" };
    const result = await override();
    expect(result).toMatchObject({ ok: false, status: 502, detail: "outcome_unknown" });
    expect(state.calls).toEqual(["claim", "store", "graph", "release"]);
  });

  it("keeps the stored copy when the reset transport failed mid-request", async () => {
    state.writeThrows = new TypeError("fetch failed");
    const result = await override();
    expect(result).toMatchObject({ ok: false, status: 502, detail: "outcome_unknown" });
    expect(state.calls).toEqual(["claim", "store", "graph", "release"]);
  });

  it("retries recording once after the reset landed", async () => {
    state.txFailures = 1;
    const result = await override();
    expect(result).toMatchObject({ ok: true, newPendingSecretId: 77 });
    expect(state.calls).toEqual(["claim", "store", "graph", "tx", "tx", "tx:commit"]);
  });

  it("does not insert twice when the failed attempt had in fact committed", async () => {
    state.txFailures = 1;
    // attempts read, then the post-failure lookup by secret name finds the row.
    state.selectQueue = [[], [{ id: 55 }]];
    const result = await override();
    expect(result).toMatchObject({ ok: true, newPendingSecretId: 55 });
    expect(state.calls).toEqual(["claim", "store", "graph", "tx"]);
  });

  it("reports an unrecorded replacement without purging its only copy, and hands the row back", async () => {
    state.txFailures = 2;
    const result = await override();
    expect(result).toMatchObject({ ok: false, status: 500, detail: "replacement_unrecorded" });
    expect(state.calls).toEqual(["claim", "store", "graph", "tx", "tx", "release"]);
  });
});

describe("#4040 — admin-override claims the secret before it touches the store or the tenant", () => {
  it("refuses with 409 when another override holds the claim — no store, no tenant write", async () => {
    state.claimAvailable = false;
    state.selectQueue = [[{ status: "reset_in_progress" }]];
    const result = await override();
    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String), detail: "override_in_progress" });
    expect(state.calls).toEqual(["claim"]);
  });

  it("refuses with 409 when the secret is no longer awaiting delivery", async () => {
    state.claimAvailable = false;
    state.selectQueue = [[{ status: "delivered_purged" }]];
    const result = await override();
    expect(result).toEqual({ ok: false, status: 409, error: "This secret is not awaiting delivery" });
    expect(state.calls).toEqual(["claim"]);
  });

  it("refuses without claiming when the tenant is not configured", async () => {
    const c = ctx() as unknown as { tenantId: string | null };
    c.tenantId = null;
    const result = await performBreakGlassAdminOverride(c as never, 4, 9, "dead-ended", undefined);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(state.calls).toEqual([]);
  });

  it("hands the claim back when live links remain", async () => {
    state.selectQueue = [[{ linkStatus: "pending", invitedEmail: "a@example.com" }]];
    const result = await override();
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(state.calls).toEqual(["claim", "release"]);
  });

  it("hands the claim back when the row records no account identity", async () => {
    const c = ctx() as unknown as { secret: { breakGlassAccountId: string | null } };
    c.secret.breakGlassAccountId = null;
    const result = await performBreakGlassAdminOverride(c as never, 4, 9, "dead-ended", undefined);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(state.calls).toEqual(["claim", "release"]);
  });

  it("does not record a second replacement when the claim was taken over, and keeps the stored copy", async () => {
    state.claimLost = true;
    const result = await override();
    expect(result).toMatchObject({ ok: false, status: 500, detail: "claim_lost" });
    expect(state.calls).toEqual(["claim", "store", "graph", "tx"]);
  });
});
