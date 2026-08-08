/**
 * document-claim-binding-timeout.test.ts — Git #559/#560 follow-up
 *
 * The property this file exists to pin:
 *
 *   A claim-binding audit that never answers does not stop the document. Both
 *   engines' gates give up at a bounded deadline and fail OPEN — inconclusive,
 *   logged, never a mismatch — and the generation carries on.
 *
 * ── The defect ───────────────────────────────────────────────────────────────
 * Confirmed live: after #559/#560 landed, one real generation sat at
 * `status='generating'` with zero progress for 13.7+ minutes before being
 * cleared by hand.
 *
 * #559 built careful fail-open handling for an audit that ERRORS or returns
 * unreadable output, and #560 inherited it. None of it fires for an audit that
 * simply never comes back: a hang is not a rejected promise, so the `catch` is
 * never entered and the `await` never returns. The unguarded
 * `anthropic.messages.create()` was not literally unbounded — the SDK's flat
 * 10-minute non-streaming default, retried twice, allows roughly half an hour —
 * but from outside, half an hour of a document stuck at `generating` is a hang.
 *
 * ── Why the never-resolving promise is the right test double ─────────────────
 * `new Promise(() => {})` is precisely the failure mode: it does not resolve,
 * does not reject, and cannot be caught. If the deadline were removed from
 * either gate, every test below that uses it would hang the suite rather than
 * fail it — which is the honest shape for this bug, and the reason each of
 * those tests also asserts the promise is STILL pending just before the
 * deadline. That second assertion is what distinguishes "the deadline released
 * it" from "something else resolved it early".
 *
 * Fake timers throughout, so the real 125-second constant is the one under test
 * rather than a shortened stand-in passed in for the test's convenience.
 *
 * Run: pnpm --filter @workspace/api-server run test -- document-claim-binding-timeout
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  assertClaimBindingsConsistent,
  runAuditWithDeadline,
  ClaimBindingAuditTimeoutError,
  DocumentClaimBindingError,
  CLAIM_BINDING_AUDIT_TIMEOUT_MS,
  CLAIM_BINDING_AUDIT_DEADLINE_MS,
  type ClaimBindingLogger,
} from "./document-claim-binding.ts";
import {
  assertSowClaimBindingsConsistent,
  SowClaimBindingError,
  type SowClaimBindingLogger,
  type SowClaimBindingSource,
} from "./sow-claim-binding.ts";

// ── Test doubles ──────────────────────────────────────────────────────────────

function makeLogger() {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return { log: { info, warn, error } as ClaimBindingLogger & SowClaimBindingLogger, info, warn, error };
}

/** The failure under test: a call that never settles, either way. */
const HUNG_AUDIT = () => new Promise<string>(() => {});

const DOC_HTML =
  "<h2>Teams governance</h2><p>The scan recorded an ownerless Teams count of zero, " +
  "and all 18 Teams therefore have a designated owner.</p>";

const DOC_SOURCE = {
  profileSample: "  teams:ownerless-teams.ownerlessTeamCount: 0",
  findings: "- Teams ownership: no ownerless Teams detected",
};

const DOC_CTX = {
  docTypeKey: "governance_maturity_report",
  documentId: 4242,
  mspCustomerId: 42,
  source: "document-engine",
};

/** Non-empty `lines` on purpose: an empty list short-circuits before the audit. */
const SOW_SOURCE: SowClaimBindingSource = {
  lines: [
    { title: "Identity hardening", priceUsd: 12_400 },
    { title: "Teams governance remediation", priceUsd: 4_800 },
  ],
  totalUsd: 17_200,
  pricingFormula: "Per-workstream fixed fee, engine-priced.",
  priorFindings: "- Ownerless Teams: 0\n- Global admins: 7",
};

const SOW_CTX = {
  docTypeKey: "sow",
  documentId: 4821,
  mspCustomerId: 77,
  source: "document-engine-sow",
} as const;

const SOW_HTML =
  "<table><tr><td>Identity hardening</td><td>$12,400.00</td></tr>" +
  "<tr><td>Teams governance remediation</td><td>$4,800.00</td></tr></table>" +
  "<p>Total engagement: $17,200.00</p>";

const CLEAN_VERDICT = JSON.stringify({ mismatches: [] });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── document-engine.ts ────────────────────────────────────────────────────────

describe("document-engine.ts — a hung claim-binding audit does not block the document", () => {
  it("gives up at the deadline and returns inconclusive rather than never returning", async () => {
    const { log, warn, error } = makeLogger();
    const audit = vi.fn(HUNG_AUDIT);

    const settled = vi.fn();
    const gate = assertClaimBindingsConsistent(
      { documentHtml: DOC_HTML, source: DOC_SOURCE, ctx: DOC_CTX },
      log,
      audit,
    );
    gate.then(settled, settled);

    // The audit really was attempted — this is a timeout, not a skip.
    await vi.advanceTimersByTimeAsync(0);
    expect(audit).toHaveBeenCalledTimes(1);

    // One tick short of the deadline it is still hanging. Without this, a
    // gate that resolved early for some unrelated reason would pass the test
    // below and prove nothing about the deadline.
    await vi.advanceTimersByTimeAsync(CLAIM_BINDING_AUDIT_DEADLINE_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const verdict = await gate;

    // Fail OPEN: the document proceeds, unaudited and honestly labelled so.
    expect(verdict.status).toBe("inconclusive");
    expect(verdict.mismatches).toEqual([]);
    expect(verdict.inconclusiveReason).toContain("timed out");

    // A hung auditor is never evidence of a mismatch, so nothing may be
    // logged at error — that is the level reserved for rejecting a document.
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const [bindings, message] = warn.mock.calls[0]!;
    expect(message).toContain("timed out");
    expect(message).toContain("not a pass");
    expect(bindings).toMatchObject({
      docTypeKey: DOC_CTX.docTypeKey,
      documentId: DOC_CTX.documentId,
      mspCustomerId: DOC_CTX.mspCustomerId,
      deadlineMs: CLAIM_BINDING_AUDIT_DEADLINE_MS,
    });
  });

  it("does not throw — the caller's generation is never rejected by a timeout", async () => {
    const { log } = makeLogger();

    const gate = assertClaimBindingsConsistent(
      { documentHtml: DOC_HTML, source: DOC_SOURCE, ctx: DOC_CTX },
      log,
      vi.fn(HUNG_AUDIT),
    );
    const outcome = gate.then(() => "resolved" as const, (e) => e);

    await vi.advanceTimersByTimeAsync(CLAIM_BINDING_AUDIT_DEADLINE_MS);

    // The distinction that matters to the engine: `DocumentClaimBindingError`
    // is what marks the row `failed`. A timeout must never produce one.
    const result = await outcome;
    expect(result).toBe("resolved");
    expect(result).not.toBeInstanceOf(DocumentClaimBindingError);
  });

  it("still rejects a real mismatch from an audit that is slow but inside the deadline", async () => {
    const { log, error } = makeLogger();
    const mismatch = JSON.stringify({
      mismatches: [{
        claim: "all 18 Teams have no owner",
        sourceValue: "teams:ownerless-teams.ownerlessTeamCount: 0",
        explanation: "the document inverts the stored count",
        confidence: "certain",
      }],
    });

    // Deliberately most of the way to the deadline: the timeout must bound the
    // gate without weakening it. A fix that turned every slow audit into a
    // fail-open would silently delete the #559 gate instead of guarding it.
    const audit = vi.fn(
      () => new Promise<string>((resolve) => {
        setTimeout(() => resolve(mismatch), CLAIM_BINDING_AUDIT_DEADLINE_MS - 1_000);
      }),
    );

    const gate = assertClaimBindingsConsistent(
      { documentHtml: DOC_HTML, source: DOC_SOURCE, ctx: DOC_CTX },
      log,
      audit,
    );
    const outcome = gate.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(CLAIM_BINDING_AUDIT_DEADLINE_MS);

    expect(await outcome).toBeInstanceOf(DocumentClaimBindingError);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

// ── document-engine-sow.ts ────────────────────────────────────────────────────

describe("document-engine-sow.ts — a hung pricing audit does not block the SOW", () => {
  it("gives up at the deadline and returns inconclusive rather than never returning", async () => {
    const { log, warn, error } = makeLogger();
    const audit = vi.fn(HUNG_AUDIT);

    const settled = vi.fn();
    const gate = assertSowClaimBindingsConsistent(
      { documentHtml: SOW_HTML, source: SOW_SOURCE, ctx: SOW_CTX },
      log,
      audit,
    );
    gate.then(settled, settled);

    await vi.advanceTimersByTimeAsync(0);
    expect(audit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CLAIM_BINDING_AUDIT_DEADLINE_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const verdict = await gate;

    expect(verdict.status).toBe("inconclusive");
    expect(verdict.mismatches).toEqual([]);
    expect(verdict.inconclusiveReason).toContain("timed out");

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const [bindings, message] = warn.mock.calls[0]!;
    expect(message).toContain("timed out");
    expect(message).toContain("not a pass");
    expect(bindings).toMatchObject({
      docTypeKey: SOW_CTX.docTypeKey,
      documentId: SOW_CTX.documentId,
      deadlineMs: CLAIM_BINDING_AUDIT_DEADLINE_MS,
    });
  });

  it("does not throw — a hung auditor never fails the SOW", async () => {
    const { log } = makeLogger();

    const gate = assertSowClaimBindingsConsistent(
      { documentHtml: SOW_HTML, source: SOW_SOURCE, ctx: SOW_CTX },
      log,
      vi.fn(HUNG_AUDIT),
    );
    const outcome = gate.then(() => "resolved" as const, (e) => e);

    await vi.advanceTimersByTimeAsync(CLAIM_BINDING_AUDIT_DEADLINE_MS);

    const result = await outcome;
    expect(result).toBe("resolved");
    expect(result).not.toBeInstanceOf(SowClaimBindingError);
  });

  it("still rejects a real price/workstream swap from a slow-but-in-time audit", async () => {
    const { log, error } = makeLogger();
    const mismatch = JSON.stringify({
      mismatches: [{
        claim: "Teams governance remediation billed at $12,400.00",
        sourceValue: "Teams governance remediation: $4,800.00",
        explanation: "the two workstreams' engine prices are swapped",
        confidence: "certain",
      }],
    });

    const audit = vi.fn(
      () => new Promise<string>((resolve) => {
        setTimeout(() => resolve(mismatch), CLAIM_BINDING_AUDIT_DEADLINE_MS - 1_000);
      }),
    );

    const gate = assertSowClaimBindingsConsistent(
      { documentHtml: SOW_HTML, source: SOW_SOURCE, ctx: SOW_CTX },
      log,
      audit,
    );
    const outcome = gate.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(CLAIM_BINDING_AUDIT_DEADLINE_MS);

    expect(await outcome).toBeInstanceOf(SowClaimBindingError);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

// ── The shared helper ─────────────────────────────────────────────────────────

describe("runAuditWithDeadline", () => {
  it("returns the audit's own answer untouched when it arrives in time", async () => {
    const promise = runAuditWithDeadline(async () => CLEAN_VERDICT);
    await vi.advanceTimersByTimeAsync(0);
    expect(await promise).toBe(CLEAN_VERDICT);
  });

  it("clears its timer on success, so a finished audit holds nothing open", async () => {
    // An un-cleared deadline timer keeps the event loop alive for two minutes
    // after every successful audit — a stalled suite in test, a retained handle
    // per document in the API server.
    const before = vi.getTimerCount();
    const promise = runAuditWithDeadline(async () => CLEAN_VERDICT);
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    expect(vi.getTimerCount()).toBe(before);
  });

  it("clears its timer when the audit rejects, and lets the rejection through", async () => {
    const before = vi.getTimerCount();
    const boom = new Error("400 invalid_request_error");
    const promise = runAuditWithDeadline(async () => { throw boom; });
    const outcome = promise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);

    // A real API failure keeps its own identity — it must reach #559's
    // fail-open `catch` as itself, not disguised as a timeout.
    expect(await outcome).toBe(boom);
    expect(vi.getTimerCount()).toBe(before);
  });

  it("rejects with ClaimBindingAuditTimeoutError carrying the deadline it used", async () => {
    const promise = runAuditWithDeadline(HUNG_AUDIT, 5_000);
    const outcome = promise.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(5_000);

    const err = await outcome;
    expect(err).toBeInstanceOf(ClaimBindingAuditTimeoutError);
    expect((err as ClaimBindingAuditTimeoutError).deadlineMs).toBe(5_000);
    expect((err as Error).message).toContain("5000");
  });

  it("does not take the process down when the abandoned call rejects later", async () => {
    // The SDK aborts its own request at CLAIM_BINDING_AUDIT_TIMEOUT_MS, which
    // normally lands first. If it lands LATE — after the race is already lost —
    // nobody is awaiting it, and an unhandled rejection would kill the server
    // over an answer that was correctly discarded.
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const promise = runAuditWithDeadline(
        () => new Promise<string>((_resolve, reject) => {
          setTimeout(() => reject(new Error("APIConnectionTimeoutError")), 10_000);
        }),
        5_000,
      );
      const outcome = promise.catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(await outcome).toBeInstanceOf(ClaimBindingAuditTimeoutError);

      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("defaults to the deadline the engines actually use, above the SDK's own bound", async () => {
    // The ordering is the design: the SDK's abort is the expected exit (it
    // produces a real error and releases the socket), and this race is the
    // backstop for the case the SDK's own bound did not fire — which is the
    // case #559's handling could not cover.
    expect(CLAIM_BINDING_AUDIT_DEADLINE_MS).toBeGreaterThan(CLAIM_BINDING_AUDIT_TIMEOUT_MS);

    const promise = runAuditWithDeadline(HUNG_AUDIT);
    const outcome = promise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(CLAIM_BINDING_AUDIT_DEADLINE_MS);
    expect((await outcome as ClaimBindingAuditTimeoutError).deadlineMs)
      .toBe(CLAIM_BINDING_AUDIT_DEADLINE_MS);
  });
});
