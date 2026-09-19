/**
 * break-glass-existing-account-decision-4532.test.ts — Git #4532
 *
 * A run that paused because quickstart-v1's create step found an existing
 * break-glass account waits for an operator to record the customer's answer.
 * performExistingAccountDecision() must run EXACTLY the chosen path:
 *
 *   reset_and_redeliver     — delegates to performBreakGlassAdminOverride (one real
 *                             tenant reset), the run stays paused, and the answer is
 *                             recorded only once the replacement is recorded;
 *   resume_without_delivery — no tenant write at all, the never-applied secret is
 *                             discarded and its vault copy purged, the run resumes.
 *
 * and refuse — touching nothing — when the decision is another customer's, already
 * answered, or the run has moved on. The live counterpart (real executor, real
 * Postgres, real Graph reset) is src/routes/break-glass-existing-account-decision-4532.live-verify.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  selectQueue: [] as unknown[][],
  sets: [] as Record<string, unknown>[],
  txSets: [] as Record<string, unknown>[],
  discardAvailable: true,
  configured: true,
  resumes: [] as unknown[][],
  purges: 0,
}));

vi.mock("@workspace/db", () => {
  const table = new Proxy({}, { get: (_t, col) => ({ name: String(col) }) });
  // Which non-transactional / transactional UPDATE this is, from the value it sets.
  const resultFor = (v: Record<string, unknown> | undefined): unknown[] => {
    if (v?.status === "reset_in_progress") return [{ id: 4 }];
    if (v?.status === "discarded_unapplied") return state.discardAvailable ? [{ id: 4 }] : [];
    if (v?.status === "resume_without_delivery" || v?.status === "reset_and_redeliver") return [{ id: 1 }];
    if (v?.status === "superseded_by_reset") return [{ id: 4 }];
    return [];
  };
  const chain = (result: () => unknown, onSet?: (v: Record<string, unknown>) => void) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit", "innerJoin", "values", "returning"]) c[m] = () => c;
    c.set = (v: Record<string, unknown>) => { onSet?.(v); return c; };
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(result).then(res, rej);
    return c;
  };
  const db = {
    select: () => chain(() => state.selectQueue.shift() ?? []),
    update: () => {
      let last: Record<string, unknown> | undefined;
      return chain(() => resultFor(last), (v) => { last = v; state.sets.push(v); });
    },
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      state.calls.push("tx");
      await fn({
        update: () => {
          let last: Record<string, unknown> | undefined;
          return chain(() => resultFor(last), (v) => { last = v; state.txSets.push(v); });
        },
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
    breakGlassExistingAccountDecisionsTable: table,
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
vi.mock("../lib/audit.ts", () => ({ createAuditLog: async () => {}, auditPrivilegedRead: async () => {} }));
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
      return { success: true, status: 204, data: null };
    },
  };
});
vi.mock("../lib/generated-secret-store.ts", () => ({
  generatedSecretStoreConfigured: () => state.configured,
  storeGeneratedSecret: async () => {
    state.calls.push("store");
    return { kind: "azure-key-vault", vaultUrl: "https://v", secretName: "genc-dev-breakglass-c1-new", version: "1", expiresOn: "", purpose: "break-glass", customerId: 1 };
  },
  purgeGeneratedSecret: async () => {
    state.purges += 1;
    state.calls.push("purge");
    return true;
  },
}));
vi.mock("../lib/workflow-executor.ts", () => ({
  resumeWorkflowRun: async (...args: unknown[]) => { state.resumes.push(args); },
}));

const { performExistingAccountDecision } = await import("./break-glass-verification.ts");

const ACCOUNT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SECRET_REF = { kind: "azure-key-vault", vaultUrl: "https://v", secretName: "genc-dev-breakglass-c1-old", version: "1", expiresOn: "", purpose: "break-glass", customerId: 1 };

const decisionRow = (over: Record<string, unknown> = {}) => ({
  id: 1, runId: 10, gateNodeId: "gate-x", customerId: 1, pendingSecretId: 4,
  existingAccountId: ACCOUNT_ID, existingAccountUpn: "breakglass-admin@contoso.onmicrosoft.com",
  skippedNodeId: "tpl-create", status: "pending", customerAnswer: null, reason: null,
  context: { customerId: 1, breakGlassAccountId: ACCOUNT_ID, pendingSecretId: 4 },
  ...over,
});
const ctxRow = () => ({
  secret: {
    id: 4, runId: 10, customerId: 1, encryptedValue: "enc", secretRef: SECRET_REF, gateNodeId: "gate-x",
    breakGlassAccountId: ACCOUNT_ID, status: "pending_delivery",
    createdAt: new Date(), deliveredAt: null, deliveredToEmail: null, credentialUncertainAt: new Date(),
  },
  mspId: 1, tenantId: "c4c814d4-3afe-441e-9145-62461d0a4fd3", domain: null,
  mspName: null, mspLogoUrl: null, mspPrimaryColor: null,
});
const queue = (decision: Record<string, unknown> | null, runStatus = "awaiting_approval", withCtx = true) => {
  state.selectQueue = [decision ? [decision] : [], [{ status: runStatus }], withCtx ? [ctxRow()] : []];
};

const ANSWER = { customerAnswer: "Customer IT lead confirmed by email that they hold the credential", reason: "Re-run of quickstart-v1" };
const flush = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };

beforeEach(() => {
  state.calls = [];
  state.selectQueue = [];
  state.sets = [];
  state.txSets = [];
  state.discardAvailable = true;
  state.configured = true;
  state.resumes = [];
  state.purges = 0;
});

describe("#4532 performExistingAccountDecision — refusals touch nothing", () => {
  it("answers 404 for a decision that is not this customer's", async () => {
    queue(decisionRow({ customerId: 2 }));
    const r = await performExistingAccountDecision(1, 1, 9, { decision: "reset_and_redeliver", ...ANSWER });
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(state.calls).toEqual([]);
    expect(state.sets).toEqual([]);
  });

  it("answers 404 for a decision that does not exist", async () => {
    queue(null);
    const r = await performExistingAccountDecision(1, 1, 9, { decision: "resume_without_delivery", ...ANSWER });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it("answers 409 for a decision that was already answered — no reset, no resume", async () => {
    queue(decisionRow({ status: "resume_without_delivery" }));
    const r = await performExistingAccountDecision(1, 1, 9, { decision: "reset_and_redeliver", ...ANSWER });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(state.calls).toEqual([]);
    expect(state.resumes).toEqual([]);
  });

  it("answers 409 when the run is no longer awaiting the decision — a failed run is never reset or resumed", async () => {
    queue(decisionRow(), "failed");
    for (const decision of ["reset_and_redeliver", "resume_without_delivery"] as const) {
      state.selectQueue = [[decisionRow()], [{ status: "failed" }], [ctxRow()]];
      const r = await performExistingAccountDecision(1, 1, 9, { decision, ...ANSWER });
      expect(r).toMatchObject({ ok: false, status: 409 });
    }
    expect(state.calls).toEqual([]);
    expect(state.sets).toEqual([]);
    expect(state.resumes).toEqual([]);
  });
});

describe("#4532 performExistingAccountDecision — resume without delivering", () => {
  it("makes no tenant write, discards and purges the unapplied secret, records the answer, and resumes the run", async () => {
    queue(decisionRow());
    const r = await performExistingAccountDecision(1, 1, 9, { decision: "resume_without_delivery", ...ANSWER });
    await flush();

    expect(r).toEqual({ ok: true, decision: "resume_without_delivery", runId: 10 });
    expect(state.calls).not.toContain("graph");
    expect(state.calls).not.toContain("store");

    // Discarded with its ciphertext blanked, and the answer recorded — one transaction.
    expect(state.calls).toEqual(["tx", "tx:commit", "purge"]);
    expect(state.txSets[0]).toMatchObject({ status: "discarded_unapplied", encryptedValue: "" });
    expect(state.txSets[1]).toMatchObject({
      status: "resume_without_delivery",
      customerAnswer: ANSWER.customerAnswer,
      reason: ANSWER.reason,
      decidedByUserId: 9,
    });
    expect(state.purges).toBe(1);

    // Resumed at the gate node, with the redacted snapshot and the recorded choice.
    expect(state.resumes).toHaveLength(1);
    const [runId, gateNodeId, payload] = state.resumes[0]!;
    expect(runId).toBe(10);
    expect(gateNodeId).toBe("gate-x");
    expect(payload).toMatchObject({ breakGlassAccountId: ACCOUNT_ID, existingAccountDecision: "resume_without_delivery" });
  });

  it("does not purge or resume when an override took the secret first (lost race → 409)", async () => {
    queue(decisionRow());
    state.discardAvailable = false;
    const r = await performExistingAccountDecision(1, 1, 9, { decision: "resume_without_delivery", ...ANSWER });
    await flush();

    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(state.purges).toBe(0);
    expect(state.resumes).toEqual([]);
  });
});

describe("#4532 performExistingAccountDecision — reset and redeliver", () => {
  it("delegates to the admin-override (one tenant reset), keeps the run paused, and records the answer against the replacement", async () => {
    queue(decisionRow());
    const r = await performExistingAccountDecision(1, 1, 9, { decision: "reset_and_redeliver", ...ANSWER });
    await flush();

    expect(r).toMatchObject({ ok: true, decision: "reset_and_redeliver", newPendingSecretId: 77 });
    // The override's own order: replacement held BEFORE the tenant is asked to change.
    expect(state.calls.indexOf("store")).toBeLessThan(state.calls.indexOf("graph"));
    expect(state.calls.filter((c) => c === "graph")).toHaveLength(1);

    // The answer is recorded once the replacement is, with the row it produced.
    const recorded = state.sets.find((s) => s.status === "reset_and_redeliver");
    expect(recorded).toMatchObject({
      customerAnswer: ANSWER.customerAnswer,
      reason: ANSWER.reason,
      decidedByUserId: 9,
      resultPendingSecretId: 77,
    });

    // The run stays paused: delivery happens through the normal acknowledge flow.
    expect(state.resumes).toEqual([]);
  });

  it("leaves the decision open when the override is refused (store unconfigured → 503, no tenant write)", async () => {
    queue(decisionRow());
    state.configured = false;
    const r = await performExistingAccountDecision(1, 1, 9, { decision: "reset_and_redeliver", ...ANSWER });

    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(state.calls).not.toContain("graph");
    expect(state.sets.find((s) => s.status === "reset_and_redeliver")).toBeUndefined();
    expect(state.resumes).toEqual([]);
  });
});
