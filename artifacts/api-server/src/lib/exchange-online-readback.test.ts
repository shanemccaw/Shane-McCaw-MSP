/**
 * #4429 — unit tests for exchange-online:// read-back verification. The live
 * defect: Set-Mailbox -MaxSendSize "0B" returned container 200 (audit 70) while
 * Get-Mailbox kept showing 36,700,160 bytes. These pin that such a write is
 * reported as a FAILURE once its template opts into a readBack.
 */
import { describe, it, expect } from "vitest";
import {
  parseReadBackSpec,
  buildReadBackParams,
  evaluateReadBack,
  runReadBackConvergence,
  type ExchangeOnlineReadBackSpec,
  type ReadBackPolicy,
} from "./exchange-online-readback.ts";

const SPEC: ExchangeOnlineReadBackSpec = {
  cmdletKey: "get-mailbox-send-restrictions",
  params: { Identity: "Identity" },
  expect: { MaxSendSizeBytes: 0 },
};

const FAST: ReadBackPolicy = { delaysMs: [5, 10, 20], budgetMs: 1_000 };

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
  };
}

describe("parseReadBackSpec", () => {
  it("treats absent success_criteria / readBack as not opted in", () => {
    expect(parseReadBackSpec(undefined)).toEqual({ ok: true, spec: null });
    expect(parseReadBackSpec({ expectStatus: 200 })).toEqual({ ok: true, spec: null });
    expect(parseReadBackSpec({ expectStatus: 200, readBack: null })).toEqual({ ok: true, spec: null });
  });

  it("parses the block-outbound-send spec", () => {
    expect(parseReadBackSpec({ expectStatus: 200, readBack: SPEC })).toEqual({ ok: true, spec: SPEC });
  });

  it("rejects malformed specs instead of silently running unverified", () => {
    expect(parseReadBackSpec({ readBack: "yes" }).ok).toBe(false);
    expect(parseReadBackSpec({ readBack: { ...SPEC, cmdletKey: "Get-Mailbox; Remove-Mailbox" } }).ok).toBe(false);
    expect(parseReadBackSpec({ readBack: { ...SPEC, params: [] } }).ok).toBe(false);
    expect(parseReadBackSpec({ readBack: { ...SPEC, params: { Identity: 5 } } }).ok).toBe(false);
    expect(parseReadBackSpec({ readBack: { ...SPEC, expect: {} } }).ok).toBe(false);
    expect(parseReadBackSpec({ readBack: { ...SPEC, expect: { MaxSendSizeBytes: { lt: 1 } } } }).ok).toBe(false);
  });
});

describe("buildReadBackParams", () => {
  it("takes values only from the write's resolved body", () => {
    expect(buildReadBackParams(SPEC, { Identity: "zz-test@x", MaxSendSize: "0B" }))
      .toEqual({ ok: true, params: { Identity: "zz-test@x" } });
  });

  it("fails when the mapped body key has no value", () => {
    expect(buildReadBackParams(SPEC, { MaxSendSize: "0B" }).ok).toBe(false);
    expect(buildReadBackParams(SPEC, { Identity: "  " }).ok).toBe(false);
  });
});

describe("evaluateReadBack", () => {
  it("matches numbers, numeric strings, booleans, strings and null", () => {
    expect(evaluateReadBack([{ MaxSendSizeBytes: 0 }], { MaxSendSizeBytes: 0 }).matched).toBe(true);
    expect(evaluateReadBack([{ MaxSendSizeBytes: "0" }], { MaxSendSizeBytes: 0 }).matched).toBe(true);
    expect(evaluateReadBack([{ Enabled: "True" }], { Enabled: true }).matched).toBe(true);
    expect(evaluateReadBack([{ ArchiveStatus: "active" }], { ArchiveStatus: "Active" }).matched).toBe(true);
    expect(evaluateReadBack([{}], { ForwardingSmtpAddress: null }).matched).toBe(true);
  });

  it("reports the #4429 signature as a mismatch", () => {
    const res = evaluateReadBack([{ MaxSendSizeBytes: 36_700_160 }], { MaxSendSizeBytes: 0 });
    expect(res.matched).toBe(false);
    expect(res.mismatches).toEqual([{ property: "MaxSendSizeBytes", expected: 0, actual: 36_700_160 }]);
  });

  it("never matches an empty or unparseable read", () => {
    expect(evaluateReadBack([], { MaxSendSizeBytes: 0 }).matched).toBe(false);
    // null MaxSendSizeBytes = Unlimited/unparseable — must not satisfy an expected 0.
    expect(evaluateReadBack([{ MaxSendSizeBytes: null }], { MaxSendSizeBytes: 0 }).matched).toBe(false);
    expect(evaluateReadBack([{ MaxSendSizeBytes: "" }], { MaxSendSizeBytes: 0 }).matched).toBe(false);
  });
});

describe("runReadBackConvergence", () => {
  it("FAILS a write whose value never lands (the #4429 live case)", async () => {
    const clock = fakeClock();
    const calls: Array<[string, Record<string, unknown>]> = [];
    const outcome = await runReadBackConvergence(SPEC, { Identity: "zz" }, {
      read: async (key, params) => { calls.push([key, params]); return [{ MaxSendSizeBytes: 36_700_160 }]; },
      ...clock,
    }, FAST);
    expect(outcome.verified).toBe(false);
    expect(outcome.unverifiedReason).toBe("not_applied");
    expect(outcome.reads).toBe(3);
    expect(outcome.waitedMs).toBe(35);
    expect(outcome.lastMismatches[0]).toMatchObject({ property: "MaxSendSizeBytes", actual: 36_700_160 });
    expect(calls[0]).toEqual(["get-mailbox-send-restrictions", { Identity: "zz" }]);
  });

  it("verifies once a lagging read converges", async () => {
    const clock = fakeClock();
    const values = [36_700_160, 0];
    const outcome = await runReadBackConvergence(SPEC, { Identity: "zz" }, {
      read: async () => [{ MaxSendSizeBytes: values.shift() }],
      ...clock,
    }, FAST);
    expect(outcome).toMatchObject({ verified: true, reads: 2, waitedMs: 15, lastMismatches: [] });
  });

  it("retries a failed read and reports read_failed when reads never succeed", async () => {
    const clock = fakeClock();
    const outcome = await runReadBackConvergence(SPEC, { Identity: "zz" }, {
      read: async () => { throw new Error("container 400: unknown cmdletKey"); },
      ...clock,
    }, FAST);
    expect(outcome).toMatchObject({ verified: false, reads: 3, unverifiedReason: "read_failed", lastReadError: "container 400: unknown cmdletKey" });
  });

  it("a read error followed by a match still verifies", async () => {
    const clock = fakeClock();
    let n = 0;
    const outcome = await runReadBackConvergence(SPEC, { Identity: "zz" }, {
      read: async () => { if (n++ === 0) throw new Error("transient"); return [{ MaxSendSizeBytes: 0 }]; },
      ...clock,
    }, FAST);
    expect(outcome).toMatchObject({ verified: true, reads: 2 });
  });

  it("stops at the wall-clock budget", async () => {
    const clock = fakeClock();
    const outcome = await runReadBackConvergence(SPEC, { Identity: "zz" }, {
      read: async () => [{ MaxSendSizeBytes: 1 }],
      ...clock,
    }, { delaysMs: [5, 10, 1_000], budgetMs: 100 });
    expect(outcome).toMatchObject({ verified: false, reads: 2, waitedMs: 15, unverifiedReason: "not_applied" });
  });
});
