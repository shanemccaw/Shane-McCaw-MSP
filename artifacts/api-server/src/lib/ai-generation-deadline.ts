/**
 * ai-generation-deadline.ts — Git #567
 *
 * One definition of "the model call never came back", shared by every real
 * document-generation call, the way `ai-output-ceiling.ts` (#556) is the one
 * definition of "the model ran out of room".
 *
 * ── The defect, verified rather than inherited ───────────────────────────────
 * #567 reports that `anthropic.messages.stream()` has no wall-clock bound past
 * first byte. That was checked against the installed SDK before any of this was
 * written, because a fix built on a mis-stated mechanism is worse than no fix.
 * Read out of `@anthropic-ai/sdk@0.78.0`:
 *
 *   - `Messages.create()` resolves its timeout as
 *     `let timeout = this._client._options.timeout; if (!body.stream && timeout
 *     == null) { ...calculateNonstreamingTimeout... }` and finally passes
 *     `timeout: timeout ?? 600000`. The platform's client (`lib/integrations-
 *     anthropic-ai/src/client.ts`) constructs `new Anthropic({ apiKey, baseURL
 *     })` and sets no `timeout`, so every call here lands on that flat
 *     10-minute figure. The streaming branch skips the non-streaming
 *     calculation entirely.
 *   - That figure reaches `fetchWithTimeout`, which is:
 *     `const timeout = setTimeout(abort, ms); try { return await this.fetch(...)
 *     } finally { clearTimeout(timeout); }`. For a streaming request `fetch`
 *     settles when RESPONSE HEADERS arrive — the body is consumed afterwards,
 *     off the returned stream — so the abort timer is cleared before a single
 *     content token has been read. THIS is the finding, and it is real: the
 *     SDK's protection covers connection and time-to-first-byte, and nothing
 *     after it.
 *   - Nothing downstream reinstates a bound. `MessageStream` carries no timer
 *     of any kind; its only abort path is a caller-supplied `AbortSignal` or an
 *     explicit `.abort()`. `finalMessage()` is `await this.done()`, `done()`
 *     awaits `#endPromise`, and `#endPromise` resolves only when the SSE
 *     iteration in `_createMessage` runs to completion. A server that accepts
 *     the request, returns headers, and then goes quiet leaves that `await`
 *     pending forever.
 *
 * So the window from stream start to `finalMessage()` resolving is genuinely
 * unbounded, and a stalled generation is a document pinned at
 * `status='generating'` until somebody clears it by hand — which is exactly
 * what happened on 2026-08-08 and what 60e60628 fixed for the OTHER call in
 * this pipeline.
 *
 * ── Why this is not a copy of the audit fix ──────────────────────────────────
 * 60e60628 bounded the claim-binding audit, and the two calls differ in all
 * three ways that matter:
 *
 *   1. SHAPE. The audit is a non-streaming `messages.create`, so an SDK
 *      per-request `timeout` really does bound it end to end and the outer race
 *      is a backstop. For the streaming narrative call there is no inner layer
 *      available at all — an SDK timeout on a stream buys time-to-first-byte
 *      and nothing else — so the race here is not a backstop, it is the ONLY
 *      bound. That is also why this module takes an `abort` hook: with no SDK
 *      timer to release the socket, the deadline has to do it.
 *   2. CEILING. The audit is a 4,000-token JSON verdict; this is a document of
 *      up to 64,000 output tokens with adaptive thinking sharing that budget.
 *      The audit's 120s would kill essentially every healthy generation.
 *   3. FAILURE MODE. The audit fails OPEN — an unaudited document still ships.
 *      There is no fallback narrative. A generation that times out has produced
 *      nothing to serve, so this fails CLOSED, on #556's exact path: log at
 *      error, throw a typed error, and let the engine's existing catch write
 *      `status: "failed"` with a real `errorMessage`.
 *
 * ── What this deliberately does NOT do ───────────────────────────────────────
 * It does not retry. A timed-out generation has already spent real tokens (the
 * metering tap on the client writes its usage row independently of anything
 * downstream), and a silent retry would double that spend on a call whose
 * failure mode is "the upstream is not answering" — the condition least likely
 * to be fixed by immediately asking again. #567 asked for that to be a decision
 * rather than a default, and this is the decision: fail once, loudly, and let a
 * human or an explicit regeneration make the second attempt.
 *
 * It is also a TOTAL deadline, not an inactivity deadline. An idle-timer on
 * `stream.on("text")` would catch a mid-stream stall in seconds instead of
 * minutes, because a healthy generation streams continuously while a stalled
 * one goes silent — a genuinely better instrument, and a larger change than
 * #567 scopes (it has to reason about thinking blocks, which emit no text
 * deltas for long stretches, or it becomes the false-positive machine this
 * ceiling was deliberately widened to avoid). Recorded here as the follow-up it
 * is, not built quietly under this issue.
 *
 * Pure and SDK-free on purpose, exactly like `ai-output-ceiling.ts`: it takes a
 * `run`/`abort` pair rather than importing `MessageStream`, so both engines
 * share one implementation, a non-streaming call can use it as easily as a
 * streaming one, and the deadline behaviour is testable without standing up an
 * engine or a network.
 */

/**
 * The output rate a healthy generation is assumed never to fall below, in
 * tokens per second, used to turn a `max_tokens` ceiling into a wall clock.
 *
 * Deliberately a FLOOR rather than an average. The number this feeds is the
 * point at which a working generation gets killed, and #567 is explicit about
 * which way to err: a false timeout on a legitimately slow-but-working document
 * destroys real work and real spend, while the cost of being generous is only
 * that a genuine stall takes longer to surface. Observed streaming throughput
 * for this model class sits well above this; 40 is the same conservative figure
 * 60e60628 derived the audit's ceiling from, kept identical so the two
 * derivations cannot drift apart on an unstated assumption.
 */
export const MIN_SUSTAINED_OUTPUT_TOKENS_PER_SEC = 40;

/**
 * Fixed allowance on top of pure generation time, covering everything that is
 * not output tokens: connection, request queueing, prompt prefill (these
 * prompts carry a style prefix, a scoped profile sample and a findings block),
 * and time to first token.
 *
 * Two minutes is far more than any of that has ever taken, which is the point —
 * it is the term that stops the ceiling from being a tight fit around the
 * throughput estimate. Being wrong about prefill cost must not be able to fail
 * a document on its own.
 */
export const GENERATION_STARTUP_ALLOWANCE_MS = 120_000;

/**
 * Interval between the inner per-request timeout and the outer hard deadline,
 * for call shapes that have both.
 *
 * Same role and same value as `CLAIM_BINDING_AUDIT_DEADLINE_MS`'s grace: it
 * only has to cover the SDK aborting its own request and that rejection
 * propagating, which is sub-second, and it exists so the SDK's cleaner failure
 * wins the ordinary race and this deadline fires only when the SDK's own bound
 * did not.
 */
export const GENERATION_DEADLINE_GRACE_MS = 5_000;

/**
 * The longest a healthy generation at a given `max_tokens` could legitimately
 * take — the number to hand an SDK per-request `timeout`, on a call shape where
 * an SDK timeout actually bounds anything.
 *
 * Exported as a derivation rather than as two hand-written constants so the
 * relationship between a ceiling and its deadline is stated once and holds for
 * both engines: raise `NARRATIVE_MAX_OUTPUT_TOKENS` and the deadline follows,
 * instead of silently leaving a 64,000-token generation on a ceiling sized for
 * a smaller one.
 */
export function deriveGenerationTimeoutMs(maxOutputTokens: number): number {
  return (
    Math.ceil(maxOutputTokens / MIN_SUSTAINED_OUTPUT_TOKENS_PER_SEC) * 1_000 +
    GENERATION_STARTUP_ALLOWANCE_MS
  );
}

/**
 * The hard wall-clock deadline the call is raced against — the above plus
 * grace.
 *
 * On the streaming path there is no inner timeout for the grace to sit above,
 * and the extra five seconds are simply carried rather than special-cased: a
 * deadline is a backstop, and five seconds of slack on a ~29-minute bound
 * changes nothing except that one formula covers both engines.
 */
export function deriveGenerationDeadlineMs(maxOutputTokens: number): number {
  return deriveGenerationTimeoutMs(maxOutputTokens) + GENERATION_DEADLINE_GRACE_MS;
}

/** Everything the log line and the admin-facing error need to be specific. */
export interface GenerationDeadlineContext {
  /** Which document type was being written — the first thing an admin asks. */
  docTypeKey: string;
  /** The wall clock that was actually applied, so the message states the real number. */
  deadlineMs: number;
  /** The output ceiling the deadline was derived from, for the same reason. */
  maxTokens: number;
  /** The `insights_generated_documents` row, when one exists (SOW previews have none). */
  documentId?: number | null;
  mspCustomerId?: number | null;
  /** Names the calling engine, so "which path stalled" needs no correlation. */
  source: string;
}

/** The pino-shaped `(bindings, message)` calls this guard makes. */
export interface GenerationDeadlineLogger {
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

/** The call being bounded, and how to release it when the deadline fires. */
export interface DeadlineBoundCall<T> {
  /**
   * Starts, or has already started, the model call, and resolves with its
   * result. For a stream this is `() => stream.finalMessage()` — the stream is
   * created immediately before, in the same synchronous block, so the deadline
   * genuinely covers stream start onwards and not merely the tail of it.
   */
  run: () => Promise<T>;
  /**
   * Releases the underlying request when the deadline fires — `stream.abort()`
   * or an `AbortController` the request was given.
   *
   * Optional in the type, supplied by both real call sites. Without it the
   * caller is freed on time but the socket and the upstream generation are
   * left running, which is a leak per stalled document; the guarantee this
   * module makes is about the caller either way.
   */
  abort?: () => void;
}

/**
 * Thrown when a generation does not complete inside its wall-clock deadline.
 *
 * A named class for the same reason `DocumentOutputTruncatedError` is one: so a
 * caller that wants to tell "the model stopped responding" from "the SDK threw"
 * can, without matching on message text. The engines let it propagate into
 * their own catch blocks, which is what turns it into a `failed` row.
 */
export class DocumentGenerationTimeoutError extends Error {
  override readonly name = "DocumentGenerationTimeoutError";
  readonly docTypeKey: string;
  readonly deadlineMs: number;
  readonly maxTokens: number;

  constructor(args: {
    message: string;
    docTypeKey: string;
    deadlineMs: number;
    maxTokens: number;
  }) {
    super(args.message);
    this.docTypeKey = args.docTypeKey;
    this.deadlineMs = args.deadlineMs;
    this.maxTokens = args.maxTokens;
  }
}

/**
 * Run a model call under a hard wall-clock deadline.
 *
 * Resolves with the call's own result, untouched, when it arrives in time.
 * Rejects with the call's own error, untouched, when it fails in time — a
 * deadline must not relabel an ordinary API failure as a timeout. Rejects with
 * `DocumentGenerationTimeoutError` when neither happens.
 *
 * The timer is cleared on every path. An un-cleared `setTimeout` at this
 * module's ceiling would hold a handle open for ~29 minutes after a perfectly
 * successful document, per document.
 *
 * The abandoned call keeps a swallowing `catch`: once the deadline has fired
 * nobody is listening, and a late rejection — very likely, since `abort()` is
 * what produces it — would otherwise surface as an unhandled rejection and take
 * the API server down over a call whose answer was correctly discarded.
 */
export async function runGenerationWithDeadline<T>(
  call: DeadlineBoundCall<T>,
  ctx: GenerationDeadlineContext,
  log: GenerationDeadlineLogger,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new DocumentGenerationTimeoutError({
        message: deadlineMessage(ctx),
        docTypeKey: ctx.docTypeKey,
        deadlineMs: ctx.deadlineMs,
        maxTokens: ctx.maxTokens,
      }));
    }, ctx.deadlineMs);
    // Never hold the process open on this timer alone. Present on Node's
    // Timeout; guarded because the same code runs under test doubles.
    (timer as unknown as { unref?: () => void }).unref?.();
  });

  const inFlight = call.run();
  inFlight.catch(() => {});

  try {
    return await Promise.race([inFlight, deadline]);
  } catch (err) {
    if (timedOut && err instanceof DocumentGenerationTimeoutError) {
      log.error(
        {
          mspCustomerId: ctx.mspCustomerId ?? null,
          documentId: ctx.documentId ?? null,
          docTypeKey: ctx.docTypeKey,
          source: ctx.source,
          deadlineMs: ctx.deadlineMs,
          maxTokens: ctx.maxTokens,
        },
        "ai-generation-deadline: generation did not complete within its wall-clock deadline — aborting the call and refusing to leave the document generating",
      );
      // After the log, so a throwing abort cannot cost us the record of WHY it
      // was being aborted. A failure to release the socket is worth knowing
      // about but must not replace the timeout as the error the caller sees.
      if (call.abort) {
        try {
          call.abort();
        } catch (abortErr) {
          log.warn(
            { err: abortErr, documentId: ctx.documentId ?? null, docTypeKey: ctx.docTypeKey, source: ctx.source },
            "ai-generation-deadline: aborting the timed-out call threw; the caller is released either way",
          );
        }
      }
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The admin-facing sentence, in #556's voice and inside `errorMessage`'s
 * 500-character column budget: what happened, what it means for the document,
 * and what to do about it — written for whoever reads it in the Document
 * Generator, not for a stack trace.
 */
function deadlineMessage(ctx: GenerationDeadlineContext): string {
  const minutes = Math.round(ctx.deadlineMs / 60_000);
  return (
    `Generation for "${ctx.docTypeKey}" stopped responding and was cut off at its ` +
    `${minutes}-minute wall-clock deadline (output ceiling ${ctx.maxTokens} tokens). ` +
    `The model call was aborted and the document was NOT saved — a generation that ` +
    `never finished is not served as a finished one. This is a stalled or unusually ` +
    `slow model call rather than an output-ceiling problem; regenerate, and if it ` +
    `recurs check the Anthropic integration's upstream health before raising the ceiling.`
  );
}
