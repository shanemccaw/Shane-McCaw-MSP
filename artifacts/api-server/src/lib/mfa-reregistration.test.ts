/**
 * mfa-reregistration.test.ts — #2981.
 *
 * The regression this file exists for: `action.require-security-info-reregistration`
 * used to GET a user's authentication methods ONCE, delete whatever that read returned,
 * and report success. Entra reads are eventually consistent, so a stale short read made
 * "deleted nothing" indistinguishable from "this user has no MFA methods" — proven live
 * on #2840 (a phone method 201'd seconds earlier was invisible to the very next
 * enumeration, and two consecutive GETs in one process disagreed).
 *
 * Every test below drives the real convergence loop with real fakes: no network, no
 * database, and an injected `sleep` so the bounded backoff is asserted rather than waited
 * out.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

import {
  runMfaReregistrationConvergence,
  DEFAULT_MFA_REREGISTRATION_VERIFICATION,
  type AuthenticationMethodRef,
  type AuthMethodDeleteResult,
  type MfaReregistrationVerificationPolicy,
} from "./mfa-reregistration";

const PASSWORD: AuthenticationMethodRef = {
  id: "28c10230-6103-485e-b985-444c60001490",
  "@odata.type": "#microsoft.graph.passwordAuthenticationMethod",
};
/** The real, fixed id Graph uses for the `mobile` phoneType — the one from #2981's evidence. */
const PHONE: AuthenticationMethodRef = {
  id: "3179e48a-750b-4051-897c-87b9720928f7",
  "@odata.type": "#microsoft.graph.phoneAuthenticationMethod",
};
const AUTHENTICATOR: AuthenticationMethodRef = {
  id: "a1b2c3d4-0000-0000-0000-00000000abcd",
  "@odata.type": "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod",
};
const FIDO2: AuthenticationMethodRef = {
  id: "f1d02222-0000-0000-0000-0000000ff1d0",
  "@odata.type": "#microsoft.graph.fido2AuthenticationMethod",
};

const OK: AuthMethodDeleteResult = { success: true, status: 204 };

/** A policy identical in shape to the real default, with zero-cost delays for tests. */
const testPolicy = (over: Partial<MfaReregistrationVerificationPolicy> = {}): MfaReregistrationVerificationPolicy => ({
  ...DEFAULT_MFA_REREGISTRATION_VERIFICATION,
  initialDelayMs: 10,
  maxDelayMs: 40,
  totalBudgetMs: 10_000,
  ...over,
});

/**
 * Builds deps whose enumeration returns a scripted sequence of reads (the last entry
 * repeats once exhausted), with deletes applied to the *remaining* reads so the fake
 * behaves like a converged replica after a successful DELETE.
 */
function makeDeps(reads: AuthenticationMethodRef[][], opts: {
  deleteResult?: (collection: string, methodId: string, call: number) => AuthMethodDeleteResult;
  applyDeletesToLaterReads?: boolean;
} = {}) {
  const script = reads.map((r) => [...r]);
  const sleeps: number[] = [];
  const deletes: Array<{ collection: string; methodId: string }> = [];
  const deleted = new Set<string>();
  let readCall = 0;

  const deps = {
    listMethods: async () => {
      const idx = Math.min(readCall, script.length - 1);
      readCall++;
      const raw = script[idx] ?? [];
      return opts.applyDeletesToLaterReads === false ? raw : raw.filter((m) => !deleted.has(m.id));
    },
    deleteMethod: async (collection: string, methodId: string) => {
      deletes.push({ collection, methodId });
      const result = opts.deleteResult?.(collection, methodId, deletes.length) ?? OK;
      if (result.success) deleted.add(methodId);
      return result;
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
  return { deps, sleeps, deletes, readCount: () => readCall };
}

describe("runMfaReregistrationConvergence — #2981 stale-read regression", () => {
  it("catches the exact #2840 signature: a first read that shows 0 deletable, then a re-read that reveals the phone method", async () => {
    // Read 1 is the stale replica (#2981's "enumerated 1 method(s); 0 deletable"),
    // read 2 is the converged one that actually lists the freshly-registered phone method.
    const { deps, deletes } = makeDeps([[PASSWORD], [PASSWORD, PHONE]]);

    const outcome = await runMfaReregistrationConvergence(deps, testPolicy());

    expect(deletes).toEqual([{ collection: "phoneMethods", methodId: PHONE.id }]);
    expect(outcome.verified).toBe(true);
    expect(outcome.deletedIds).toEqual([PHONE.id]);
    expect(outcome.reads).toBeGreaterThanOrEqual(3);
  });

  it("documents the real residual window: a replica lagging past the corroboration window still reads as verified", async () => {
    // Honest limit, asserted rather than hidden. There is no strongly-consistent read for
    // authentication methods, so "verified" means N delayed samples agreed — not a proof.
    // If EVERY sample inside the budget is stale, the loop still concludes empty; it just
    // takes two delayed samples to get there instead of #2981's single one.
    const { deps, readCount } = makeDeps([[PASSWORD], [PASSWORD], [PASSWORD, PHONE]], {
      applyDeletesToLaterReads: false,
    });

    const outcome = await runMfaReregistrationConvergence(deps, testPolicy());

    expect(outcome.verified).toBe(true);
    expect(readCount()).toBe(2);
    expect(outcome.cleanReads).toBe(DEFAULT_MFA_REREGISTRATION_VERIFICATION.requiredCleanReads);
    expect(outcome.deletedIds).toEqual([]);
  });

  it("requires TWO corroborating clean reads before calling an empty user verified", async () => {
    const { deps, deletes, readCount } = makeDeps([[PASSWORD, FIDO2]]);

    const outcome = await runMfaReregistrationConvergence(deps, testPolicy());

    expect(outcome.verified).toBe(true);
    expect(deletes).toEqual([]); // password + FIDO2 are deliberately never deleted
    expect(outcome.deletedIds).toEqual([]);
    expect(readCount()).toBe(2); // one read is never sufficient — that WAS the bug
    expect(outcome.cleanReads).toBe(2);
  });

  it("deletes every removable type and leaves password/FIDO2 alone", async () => {
    const { deps, deletes } = makeDeps([[PASSWORD, PHONE, AUTHENTICATOR, FIDO2]]);

    const outcome = await runMfaReregistrationConvergence(deps, testPolicy());

    expect(deletes).toEqual([
      { collection: "phoneMethods", methodId: PHONE.id },
      { collection: "microsoftAuthenticatorMethods", methodId: AUTHENTICATOR.id },
    ]);
    expect(outcome.verified).toBe(true);
    expect(outcome.deletedTypes).toEqual([
      "#microsoft.graph.phoneAuthenticationMethod",
      "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod",
    ]);
    expect(outcome.methodsFound).toBe(4);
  });
});

describe("runMfaReregistrationConvergence — trusting confirmed writes over lagging reads", () => {
  it("treats a read that still lists an already-DELETEd method as clean (the write is authoritative)", async () => {
    // Every read keeps returning the phone method even after its 204 — replica lag in the
    // other direction. The loop must not spin or fail on that.
    const { deps, deletes } = makeDeps([[PASSWORD, PHONE]], { applyDeletesToLaterReads: false });

    const outcome = await runMfaReregistrationConvergence(deps, testPolicy());

    expect(outcome.verified).toBe(true);
    expect(deletes).toHaveLength(1); // deleted exactly once, never re-attempted
    expect(outcome.deletedIds).toEqual([PHONE.id]);
  });

  it("treats a 404 on DELETE as already-absent, and does not count it as one of its own deletes", async () => {
    const { deps } = makeDeps([[PASSWORD, PHONE]], {
      deleteResult: () => ({ success: false, status: 404, errorType: "unexpected", data: "not found" }),
    });

    const outcome = await runMfaReregistrationConvergence(deps, testPolicy());

    expect(outcome.verified).toBe(true);
    expect(outcome.deletedIds).toEqual([]);
    expect(outcome.alreadyAbsentIds).toEqual([PHONE.id]);
  });
});

describe("runMfaReregistrationConvergence — real failures are reported, never papered over", () => {
  it("reports delete_failed verbatim on a 403 and stops", async () => {
    const { deps, deletes } = makeDeps([[PASSWORD, PHONE, AUTHENTICATOR]], {
      deleteResult: () => ({ success: false, status: 403, errorType: "insufficient_privilege", data: "denied" }),
    });

    const outcome = await runMfaReregistrationConvergence(deps, testPolicy());

    expect(outcome.verified).toBe(false);
    if (outcome.verified) throw new Error("unreachable");
    expect(outcome.failure).toBe("delete_failed");
    if (outcome.failure !== "delete_failed") throw new Error("unreachable");
    expect(outcome.deleteResult.status).toBe(403);
    expect(outcome.methodId).toBe(PHONE.id);
    expect(deletes).toHaveLength(1); // stops at the first genuine failure
  });

  it("reports read_failed when the enumeration never succeeds, and attempts nothing", async () => {
    const deps = {
      listMethods: async () => {
        throw new Error("graphReadForTenantWithWriteToken: GET failed (403): denied");
      },
      deleteMethod: async () => OK,
      sleep: async () => {},
    };

    const outcome = await runMfaReregistrationConvergence(deps, testPolicy());

    expect(outcome.verified).toBe(false);
    if (outcome.verified) throw new Error("unreachable");
    expect(outcome.failure).toBe("read_failed");
    expect(outcome.reads).toBe(2); // bounded by maxConsecutiveReadFailures, not the read cap
  });

  it("survives a single transient read failure and still verifies", async () => {
    let call = 0;
    const deleted = new Set<string>();
    const deps = {
      listMethods: async () => {
        call++;
        if (call === 2) throw new Error("transient 503");
        return [PASSWORD, PHONE].filter((m) => !deleted.has(m.id));
      },
      deleteMethod: async (_c: string, id: string) => {
        deleted.add(id);
        return OK;
      },
      sleep: async () => {},
    };

    const outcome = await runMfaReregistrationConvergence(deps, testPolicy());

    expect(outcome.verified).toBe(true);
    expect(outcome.readFailures).toBe(1);
    expect(outcome.deletedIds).toEqual([PHONE.id]);
  });

  it("reports unverified — not success — when new removable methods keep appearing", async () => {
    // A pathological tenant where every re-read reveals another method: the loop must run
    // out of budget and say so rather than claim a verified wipe.
    let n = 0;
    const deps = {
      listMethods: async () => [PASSWORD, { id: `phone-${n++}`, "@odata.type": PHONE["@odata.type"] }],
      deleteMethod: async () => OK,
      sleep: async () => {},
    };

    const outcome = await runMfaReregistrationConvergence(deps, testPolicy({ maxReads: 4 }));

    expect(outcome.verified).toBe(false);
    if (outcome.verified) throw new Error("unreachable");
    expect(outcome.failure).toBe("unverified");
    if (outcome.failure !== "unverified") throw new Error("unreachable");
    expect(outcome.unverifiedReason).toBe("read_cap_reached");
    expect(outcome.reads).toBe(4);
  });
});

describe("runMfaReregistrationConvergence — the bound is real", () => {
  it("backs off exponentially, caps each delay, and never exceeds the wall-clock budget", async () => {
    const { deps, sleeps } = makeDeps([[PASSWORD, { id: "x", "@odata.type": PHONE["@odata.type"] }]], {
      applyDeletesToLaterReads: false,
      deleteResult: () => OK,
    });
    // Force the loop to run to its read cap by never letting a read come back clean.
    const spinning = {
      ...deps,
      listMethods: async () => [PASSWORD, { id: `m-${sleeps.length}`, "@odata.type": PHONE["@odata.type"] }],
    };

    const outcome = await runMfaReregistrationConvergence(
      spinning,
      testPolicy({ maxReads: 6, initialDelayMs: 100, maxDelayMs: 300, totalBudgetMs: 10_000 }),
    );

    expect(sleeps).toEqual([100, 200, 300, 300, 300]);
    expect(outcome.waitedMs).toBe(1200);
    expect(outcome.reads).toBe(6);
    expect(outcome.verified).toBe(false);
  });

  it("stops on the wall-clock budget even when the read cap is not reached", async () => {
    let now = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const deps = {
        listMethods: async () => [PASSWORD, { id: `m-${now}`, "@odata.type": PHONE["@odata.type"] }],
        deleteMethod: async () => OK,
        sleep: async (ms: number) => {
          now += ms;
        },
      };

      const outcome = await runMfaReregistrationConvergence(
        deps,
        testPolicy({ maxReads: 50, initialDelayMs: 1_000, maxDelayMs: 5_000, totalBudgetMs: 8_000 }),
      );

      expect(outcome.verified).toBe(false);
      if (outcome.verified) throw new Error("unreachable");
      expect(outcome.failure).toBe("unverified");
      if (outcome.failure !== "unverified") throw new Error("unreachable");
      expect(outcome.unverifiedReason).toBe("budget_exhausted");
      expect(outcome.waitedMs).toBeLessThanOrEqual(8_000);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("ships a default policy that cannot degrade to the single-pass bug", () => {
    expect(DEFAULT_MFA_REREGISTRATION_VERIFICATION.requiredCleanReads).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_MFA_REREGISTRATION_VERIFICATION.maxReads).toBeGreaterThan(
      DEFAULT_MFA_REREGISTRATION_VERIFICATION.requiredCleanReads,
    );
    expect(DEFAULT_MFA_REREGISTRATION_VERIFICATION.totalBudgetMs).toBeGreaterThan(0);
  });
});
