/**
 * ai-generation-deadline.test.ts — Git #567
 *
 * The property this file exists to pin:
 *
 *   A narrative generation whose stream stalls mid-flight FAILS, at a bounded
 *   wall clock, with a specific error an admin can act on — it does not hang,
 *   and it does not quietly succeed with nothing.
 *
 * ── The defect ───────────────────────────────────────────────────────────────
 * Verified against the installed `@anthropic-ai/sdk@0.78.0` rather than taken
 * from #567's write-up: `fetchWithTimeout` clears its abort timer in a
 * `finally` around `await this.fetch(...)`, which for a streaming request
 * settles when response HEADERS arrive. `MessageStream` adds no timer of its
 * own and `finalMessage()` waits on an SSE stream that may never end. Between
 * first byte and `finalMessage()` resolving there was no wall-clock bound at
 * all, and a stalled generation is a document pinned at `status='generating'`
 * until somebody clears the row by hand.
 *
 * ── Why the never-resolving promise is the right test double ─────────────────
 * Same reasoning, and deliberately the same shape, as
 * `document-claim-binding-timeout.test.ts` (60e60628): `new Promise(() => {})`
 * IS the failure mode — it does not resolve, does not reject, and cannot be
 * caught. Remove the race and every test below that uses it hangs this suite
 * instead of failing it, which is the honest shape for this bug. That is also
 * why each of those tests asserts the promise is STILL pending one tick short
 * of the deadline: it distinguishes "the deadline released it" from "something
 * else resolved it early".
 *
 * Fake timers throughout, so the real shipped 1,725,000ms constant is what is
 * under test rather than a shortened stand-in passed in for convenience.
 *
 * ── What is NOT tested here, and why ─────────────────────────────────────────
 * Neither engine is imported. `document-engine.ts` and `document-engine-sow.ts`
 * pull in `@workspace/db`, the scoring graph and the sales-offer engine, so
 * asserting `status: "failed"` end to end would mean standing up a database to
 * observe a timer. This module is pure and SDK-free for exactly that reason
 * (the same reason `ai-output-ceiling.ts` is), and the seam is the throw: the
 * engines' existing catch blocks turn any throw out of the generation call into
 * `status: "failed"` with `errorMessage`, which is the machinery #556 already
 * shipped and #559/#560 already rely on. So what is pinned here is that the
 * throw happens, that it is typed, and that its message is one an admin can
 * read out of that column intact.
 *
 * Run: pnpm --filter @workspace/api-server run test -- ai-generation-deadline
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  runGenerationWithDeadline,
  deriveGenerationTimeoutMs,
  deriveGenerationDeadlineMs,
  DocumentGenerationTimeoutError,
  MIN_SUSTAINED_OUTPUT_TOKENS_PER_SEC,
  GENERATION_STARTUP_ALLOWANCE_MS,
  GENERATION_DEADLINE_GRACE_MS,
  type GenerationDeadlineContext,
  type GenerationDeadlineLogger,
} from "./ai-generation-deadline.ts";

// ── The two shipped ceilings, restated ────────────────────────────────────────
// Copied rather than imported: both live in engine modules that reach the
// database at import time. Pinned against the derivation below so a change to
// either engine's ceiling without a matching change here is a failing test
// rather than a silently stale deadline.
const NARRATIVE_MAX_OUTPUT_TOKENS = 64_000;
const SOW_MAX_OUTPUT_TOKENS = 21_000;

const NARRATIVE_DEADLINE_MS = deriveGenerationDeadlineMs(NARRATIVE_MAX_OUTPUT_TOKENS);

// ── Test doubles ──────────────────────────────────────────────────────────────

function makeLogger() {
  const warn = vi.fn();
  const error = vi.fn();
  return { log: { warn, error } as GenerationDeadlineLogger, warn, error };
}

/** The failure under test: a call that never settles, either way. */
const HUNG_CALL = () => new Promise<FakeMessage>(() => {});

interface FakeMessage {
  stop_reason: string;
  content: Array<{ type: string; text: string }>;
}

const HEALTHY_MESSAGE: FakeMessage = {
  stop_reason: "end_turn",
  content: [{ type: "text", text: "<h2>Teams governance</h2><p>All 18 Teams have an owner.</p>" }],
};

const DOC_CTX: GenerationDeadlineContext = {
  docTypeKey: "governance_maturity_report",
  deadlineMs: NARRATIVE_DEADLINE_MS,
  maxTokens: NARRATIVE_MAX_OUTPUT_TOKENS,
  documentId: 4242,
  mspCustomerId: 42,
  source: "document-engine",
};

/**
 * A stand-in for the SDK's `MessageStream` with only the two members the engine
 * hands to the deadline: a `finalMessage()` that never answers, and the
 * `abort()` that has to release the socket when it doesn't.
 */
function makeStalledStream() {
  const abort = vi.fn();
  return {
    abort,
    finalMessage: vi.fn(() => new Promise<FakeMessage>(() => {})),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── The derivation ────────────────────────────────────────────────────────────

describe("the ceiling is derived from max_tokens, not chosen", () => {
  it("turns an output ceiling into a wall clock at the assumed throughput floor", () => {
    // 40 tok/s and a 120s startup allowance are the two assumptions the whole
    // number rests on. Stated as a test so changing either is a deliberate act
    // with a visible consequence, not an edit to a comment.
    expect(MIN_SUSTAINED_OUTPUT_TOKENS_PER_SEC).toBe(40);
    expect(GENERATION_STARTUP_ALLOWANCE_MS).toBe(120_000);
    expect(GENERATION_DEADLINE_GRACE_MS).toBe(5_000);

    expect(deriveGenerationTimeoutMs(4_000)).toBe(100_000 + 120_000);
    expect(deriveGenerationDeadlineMs(4_000)).toBe(100_000 + 120_000 + 5_000);
  });

  it("gives document-engine.ts's 64,000-token narrative about 29 minutes", () => {
    // 64,000 / 40 = 1,600s of generation, + 120s startup, + 5s grace.
    expect(deriveGenerationTimeoutMs(NARRATIVE_MAX_OUTPUT_TOKENS)).toBe(1_720_000);
    expect(NARRATIVE_DEADLINE_MS).toBe(1_725_000);
  });

  it("gives document-engine-sow.ts's 21,000-token SOW about 11 minutes", () => {
    // 21,000 / 40 = 525s, + 120s, + 5s. The inner figure sits deliberately just
    // ABOVE the SDK's flat 600,000ms non-streaming default: at the default, a
    // worst-case but HEALTHY SOW running to its ceiling would be aborted with
    // ~45s of legitimate work left.
    expect(deriveGenerationTimeoutMs(SOW_MAX_OUTPUT_TOKENS)).toBe(645_000);
    expect(deriveGenerationTimeoutMs(SOW_MAX_OUTPUT_TOKENS)).toBeGreaterThan(600_000);
    expect(deriveGenerationDeadlineMs(SOW_MAX_OUTPUT_TOKENS)).toBe(650_000);
  });

  it("keeps the hard deadline strictly above the per-request timeout", () => {
    // The ordering is the design: on a call shape that HAS an inner timeout,
    // the SDK's abort is the expected exit because it produces a real error and
    // releases the socket, and this race is the backstop for the case the SDK's
    // own bound did not fire.
    for (const maxTokens of [4_000, SOW_MAX_OUTPUT_TOKENS, NARRATIVE_MAX_OUTPUT_TOKENS]) {
      expect(deriveGenerationDeadlineMs(maxTokens))
        .toBeGreaterThan(deriveGenerationTimeoutMs(maxTokens));
    }
  });

  it("scales with the ceiling, so raising max_tokens cannot leave the deadline behind", () => {
    // The reason this is a function and not two hand-written constants: #556
    // raised one of these ceilings already, and a deadline that did not follow
    // would start failing healthy documents at the new ceiling.
    expect(deriveGenerationDeadlineMs(128_000))
      .toBeGreaterThan(deriveGenerationDeadlineMs(NARRATIVE_MAX_OUTPUT_TOKENS));
  });
});

// ── The stalled stream ────────────────────────────────────────────────────────

describe("document-engine.ts — a stalled narrative stream fails instead of hanging", () => {
  it("gives up at the deadline rather than never returning", async () => {
    const { log } = makeLogger();
    const stream = makeStalledStream();

    const settled = vi.fn();
    const generation = runGenerationWithDeadline(
      { run: () => stream.finalMessage(), abort: () => stream.abort() },
      DOC_CTX,
      log,
    );
    const outcome = generation.then(() => "resolved" as const, (e: unknown) => e);
    void generation.then(settled, settled);

    // The call really was made — this is a timeout, not a skip.
    await vi.advanceTimersByTimeAsync(0);
    expect(stream.finalMessage).toHaveBeenCalledTimes(1);

    // One tick short of the deadline it is still hanging. Without this, a
    // generation that settled early for some unrelated reason would pass the
    // assertion below and prove nothing about the deadline.
    await vi.advanceTimersByTimeAsync(NARRATIVE_DEADLINE_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBeInstanceOf(DocumentGenerationTimeoutError);
  });

  it("fails CLOSED — there is no fallback narrative, so nothing may resolve", async () => {
    // The load-bearing difference from 60e60628's audit deadline, which fails
    // OPEN. A generation that timed out produced no document; resolving with
    // anything at all here would be inventing one.
    const { log } = makeLogger();
    const stream = makeStalledStream();

    const outcome = runGenerationWithDeadline(
      { run: () => stream.finalMessage(), abort: () => stream.abort() },
      DOC_CTX,
      log,
    ).then(() => "resolved" as const, (e: unknown) => e);

    await vi.advanceTimersByTimeAsync(NARRATIVE_DEADLINE_MS);

    const result = await outcome;
    expect(result).not.toBe("resolved");
    expect(result).toBeInstanceOf(DocumentGenerationTimeoutError);
    expect((result as DocumentGenerationTimeoutError).name).toBe("DocumentGenerationTimeoutError");
    expect((result as DocumentGenerationTimeoutError).deadlineMs).toBe(NARRATIVE_DEADLINE_MS);
    expect((result as DocumentGenerationTimeoutError).maxTokens).toBe(NARRATIVE_MAX_OUTPUT_TOKENS);
    expect((result as DocumentGenerationTimeoutError).docTypeKey).toBe(DOC_CTX.docTypeKey);
  });

  it("aborts the stalled stream, so the socket is not left running behind us", async () => {
    // With no SDK timer left to release it on a streaming call, this abort is
    // the only thing that stops a stalled generation from continuing upstream
    // after the caller has walked away.
    const { log } = makeLogger();
    const stream = makeStalledStream();

    const outcome = runGenerationWithDeadline(
      { run: () => stream.finalMessage(), abort: () => stream.abort() },
      DOC_CTX,
      log,
    ).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(NARRATIVE_DEADLINE_MS - 1);
    expect(stream.abort).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(stream.abort).toHaveBeenCalledTimes(1);
  });

  it("carries a real, specific error message that fits the errorMessage column", async () => {
    // #556's pattern, applied to a timeout: the engines write
    // `errorMessage: errMsg.slice(0, 500)`, so a message longer than that
    // reaches the admin cut off mid-sentence — a truncated explanation of a
    // truncation-adjacent failure. It also has to NAME what happened rather
    // than say "generation failed".
    const { log } = makeLogger();
    const stream = makeStalledStream();

    const outcome = runGenerationWithDeadline(
      { run: () => stream.finalMessage(), abort: () => stream.abort() },
      DOC_CTX,
      log,
    ).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(NARRATIVE_DEADLINE_MS);
    const message = (await outcome as Error).message;

    expect(message.length).toBeLessThanOrEqual(500);
    expect(message).toContain(DOC_CTX.docTypeKey);
    expect(message).toContain("stopped responding");
    expect(message).toContain("29-minute");
    expect(message).toContain("NOT saved");
    // Specifically distinguished from the OTHER way a generation fails to
    // produce a whole document, because the two need opposite responses:
    // #556's truncation says raise the ceiling, this one says do not.
    expect(message).toContain("rather than an output-ceiling problem");
  });

  it("logs the timeout at error, with the bindings an operator needs", async () => {
    const { log, warn, error } = makeLogger();
    const stream = makeStalledStream();

    const outcome = runGenerationWithDeadline(
      { run: () => stream.finalMessage(), abort: () => stream.abort() },
      DOC_CTX,
      log,
    ).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(NARRATIVE_DEADLINE_MS);
    await outcome;

    // At error, not warn: unlike the claim-binding audit, this one loses the
    // document.
    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    const [bindings, message] = error.mock.calls[0]!;
    expect(message).toContain("wall-clock deadline");
    expect(bindings).toMatchObject({
      docTypeKey: DOC_CTX.docTypeKey,
      documentId: DOC_CTX.documentId,
      mspCustomerId: DOC_CTX.mspCustomerId,
      source: "document-engine",
      deadlineMs: NARRATIVE_DEADLINE_MS,
      maxTokens: NARRATIVE_MAX_OUTPUT_TOKENS,
    });
  });
});

// ── The healthy paths the deadline must not break ─────────────────────────────

describe("a working generation is untouched", () => {
  it("returns the model's own message when it arrives in time", async () => {
    const { log, error } = makeLogger();
    const stream = {
      abort: vi.fn(),
      finalMessage: vi.fn(
        () => new Promise<FakeMessage>((resolve) => {
          // Deliberately most of the way to the deadline: the timeout must
          // bound the call without weakening it. A fix that failed every slow
          // generation would trade a rare hang for a routine lost document.
          setTimeout(() => resolve(HEALTHY_MESSAGE), NARRATIVE_DEADLINE_MS - 1_000);
        }),
      ),
    };

    const generation = runGenerationWithDeadline(
      { run: () => stream.finalMessage(), abort: () => stream.abort() },
      DOC_CTX,
      log,
    );

    await vi.advanceTimersByTimeAsync(NARRATIVE_DEADLINE_MS);

    // Identity, not equality: `assertOutputNotTruncated` and `extractAiHtml`
    // read this object downstream, so the deadline must hand back the exact
    // message the SDK produced and not a copy of it.
    expect(await generation).toBe(HEALTHY_MESSAGE);
    expect(stream.abort).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("lets a real API failure through as itself, not relabelled as a timeout", async () => {
    // A deadline that rewrote every failure into "the model stopped responding"
    // would send an admin chasing upstream health over a 400 in the request.
    const { log, error } = makeLogger();
    const boom = new Error("400 invalid_request_error");

    const outcome = runGenerationWithDeadline(
      { run: async () => { throw boom; }, abort: vi.fn() },
      DOC_CTX,
      log,
    ).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(0);

    expect(await outcome).toBe(boom);
    expect(error).not.toHaveBeenCalled();
  });

  it("does not abort a call that failed on its own", async () => {
    const { log } = makeLogger();
    const abort = vi.fn();

    const outcome = runGenerationWithDeadline(
      { run: async () => { throw new Error("overloaded_error"); }, abort },
      DOC_CTX,
      log,
    ).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(0);
    await outcome;
    expect(abort).not.toHaveBeenCalled();
  });

  it("clears its timer on success, so a finished document holds nothing open", async () => {
    // An un-cleared deadline timer at this module's ceiling keeps a handle
    // alive for ~29 minutes after every successful document.
    const { log } = makeLogger();
    const before = vi.getTimerCount();

    const generation = runGenerationWithDeadline(
      { run: async () => HEALTHY_MESSAGE },
      DOC_CTX,
      log,
    );
    await vi.advanceTimersByTimeAsync(0);
    await generation;

    expect(vi.getTimerCount()).toBe(before);
  });

  it("clears its timer when the call rejects", async () => {
    const { log } = makeLogger();
    const before = vi.getTimerCount();

    const outcome = runGenerationWithDeadline(
      { run: async () => { throw new Error("boom"); } },
      DOC_CTX,
      log,
    ).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    await outcome;

    expect(vi.getTimerCount()).toBe(before);
  });
});

// ── The failure modes of the failure path itself ──────────────────────────────

describe("the deadline cannot make things worse than the hang it replaces", () => {
  it("does not take the process down when the abandoned call rejects later", async () => {
    // Very likely rather than hypothetical here: `abort()` is what PRODUCES
    // that late rejection (the SDK turns an abort into an `APIUserAbortError`
    // on the stream), and by then nobody is awaiting it. An unhandled rejection
    // would kill the API server over a call that was correctly discarded.
    const { log } = makeLogger();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      let rejectLate: (err: Error) => void = () => {};
      const abort = vi.fn(() => rejectLate(new Error("APIUserAbortError")));

      const outcome = runGenerationWithDeadline(
        {
          run: () => new Promise<FakeMessage>((_resolve, reject) => { rejectLate = reject; }),
          abort,
        },
        DOC_CTX,
        log,
      ).catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(NARRATIVE_DEADLINE_MS);
      expect(await outcome).toBeInstanceOf(DocumentGenerationTimeoutError);

      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("still fails with the timeout when aborting itself throws", async () => {
    // A socket that will not release is worth a log line, but it is not the
    // error the admin should see: what happened is that generation stalled.
    const { log, warn, error } = makeLogger();
    const abort = vi.fn(() => { throw new Error("controller already closed"); });

    const outcome = runGenerationWithDeadline(
      { run: HUNG_CALL, abort },
      DOC_CTX,
      log,
    ).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(NARRATIVE_DEADLINE_MS);

    expect(await outcome).toBeInstanceOf(DocumentGenerationTimeoutError);
    // The reason for the abort is recorded before the abort is attempted, so a
    // throwing abort cannot cost us the record of why it was happening.
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toContain("released either way");
  });

  it("still releases the caller when no abort hook was supplied", async () => {
    // The guarantee is about the caller. A call site with nothing to abort
    // leaks a socket, which is a smaller problem than a document that never
    // reaches a terminal status.
    const { log } = makeLogger();

    const outcome = runGenerationWithDeadline({ run: HUNG_CALL }, DOC_CTX, log)
      .catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(NARRATIVE_DEADLINE_MS);
    expect(await outcome).toBeInstanceOf(DocumentGenerationTimeoutError);
  });
});

// ── document-engine-sow.ts's call shape ───────────────────────────────────────

describe("document-engine-sow.ts — the same protection over a non-streaming call", () => {
  const SOW_CTX: GenerationDeadlineContext = {
    docTypeKey: "sow",
    deadlineMs: deriveGenerationDeadlineMs(SOW_MAX_OUTPUT_TOKENS),
    maxTokens: SOW_MAX_OUTPUT_TOKENS,
    documentId: 4821,
    mspCustomerId: 77,
    source: "document-engine-sow",
  };

  it("pulls the request's AbortSignal when the deadline fires", async () => {
    // This engine's narrative call is `messages.create`, NOT the
    // `messages.stream` #567 describes — checked rather than assumed. A
    // non-streaming call has no `.abort()` of its own, so the deadline releases
    // it through the signal the request was given.
    const { log } = makeLogger();
    const controller = new AbortController();

    const outcome = runGenerationWithDeadline(
      {
        run: () => new Promise<FakeMessage>(() => {}),
        abort: () => controller.abort(),
      },
      SOW_CTX,
      log,
    ).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(SOW_CTX.deadlineMs - 1);
    expect(controller.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(controller.signal.aborted).toBe(true);
  });

  it("names the SOW engine and its own ceiling in the failure", async () => {
    const { log, error } = makeLogger();

    const outcome = runGenerationWithDeadline(
      { run: () => new Promise<FakeMessage>(() => {}) },
      SOW_CTX,
      log,
    ).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(SOW_CTX.deadlineMs);

    const err = await outcome as DocumentGenerationTimeoutError;
    expect(err).toBeInstanceOf(DocumentGenerationTimeoutError);
    expect(err.deadlineMs).toBe(650_000);
    expect(err.maxTokens).toBe(SOW_MAX_OUTPUT_TOKENS);
    expect(err.message).toContain("11-minute");
    expect(error.mock.calls[0]![0]).toMatchObject({ source: "document-engine-sow" });
  });
});
