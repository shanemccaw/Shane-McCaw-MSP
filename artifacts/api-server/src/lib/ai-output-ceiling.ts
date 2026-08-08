/**
 * ai-output-ceiling.ts — Git #556
 *
 * One definition of "the model stopped because it ran out of room", shared by
 * every real document-generation call.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * Confirmed live (2026-08-08): a `copilot_readiness` document stopped mid-write
 * at 47,235 characters with the last finding cut off mid-sentence, and was
 * saved with `status: "approved"` and served to the reader as a finished
 * document. Not because the ceiling was wrong — because NOTHING READ
 * `stop_reason`. `document-engine.ts` and `document-engine-sow.ts` both took
 * whatever `content[0].text` came back and wrote it to the row, so a response
 * that the API had explicitly labelled `stop_reason: "max_tokens"` was
 * indistinguishable, to this codebase, from one that ended on `end_turn`.
 *
 * That is the same "fail silently instead of loudly" class the surrounding work
 * (#547, #549, #553, #554, #555) exists to eliminate, and it is the worse half
 * of #556: a too-low ceiling produces a short document, but an unchecked
 * `stop_reason` produces a WRONG one — a go-live report whose "Path to
 * clearance" section was never written, presented as though it had been.
 *
 * ── Why this throws instead of continuing ────────────────────────────────────
 * #556 asked whether the Anthropic continuation pattern (capture the partial,
 * send a follow-up that resumes it) is the right fix. It is not, here, for two
 * independent reasons:
 *
 *   1. The classic form of that pattern — append the partial text as a trailing
 *      assistant message and let the model carry on from it — is an
 *      ASSISTANT-TURN PREFILL, and prefills return HTTP 400 on the 4.6-family
 *      models. Both engines call `claude-sonnet-4-6`. The pattern the issue
 *      assumed was available is not available on the model actually in use.
 *
 *      The documented replacement is a USER-turn continuation ("your previous
 *      response was interrupted and ended with X, continue from there"), which
 *      is a different, weaker thing: the model does not have its own prior
 *      output as assistant context, only a quotation of it.
 *
 *   2. Even granting a working continuation, splicing is wrong for THIS
 *      artifact. The cut lands at an arbitrary byte — inside a tag, inside an
 *      attribute, mid-number — so the join is not a text join but an HTML
 *      repair. And these documents are ARITHMETIC: #555 has the model cite a
 *      per-finding point value in section 3 and then sum those same values into
 *      a running total in section 4. A spliced document can renumber findings,
 *      repeat one, or sum a set that does not match the set it listed — and
 *      unlike a truncation, none of that is visible to the reader. It trades a
 *      document that is obviously incomplete for one that is quietly wrong.
 *      That is a strictly worse trade for a document a customer makes a
 *      go/no-go decision on.
 *
 * So: raise the ceiling on a derived basis (see each engine's own constant),
 * and when the model still hits it, FAIL — loudly, with a real error the admin
 * sees. Both engines already have the machinery for exactly that: their catch
 * blocks set `status: "failed"` with an `errorMessage`, so the truncated text
 * is never written to `html_content` and never reaches `status: "approved"`.
 * The AI spend is still metered (the usage row is written by the metering tap
 * on the client, not by anything downstream of this guard), so failing here
 * loses the document, not the billing record.
 *
 * Pure and engine-free on purpose: no DB, no scoring graph, no SDK import — so
 * it can be asserted directly and can be imported by any generation path
 * without dragging a dependency chain behind it (see #555's note on what a
 * DB-reaching import into document-engine costs).
 */

/**
 * The `stop_reason` the Messages API returns when generation was cut off by the
 * request's own `max_tokens` ceiling rather than by the model finishing.
 *
 * Named rather than inlined because the whole defect was that this string
 * appeared NOWHERE in either engine — a constant is greppable in a way a bare
 * literal buried in a conditional is not.
 */
export const MAX_TOKENS_STOP_REASON = "max_tokens";

/** The minimum shape this guard needs off an Anthropic `Message`. */
export interface CeilingCheckableResponse {
  stop_reason?: unknown;
  usage?: { output_tokens?: unknown } | null;
  content?: ReadonlyArray<unknown>;
}

/** The pino-shaped `(bindings, message)` calls this guard makes. */
export interface CeilingLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

/** Everything the log lines and the admin-facing error message need to be specific. */
export interface OutputCeilingContext {
  /** Which document type was being written — the first thing an admin asks. */
  docTypeKey: string;
  /** The ceiling that was actually requested, so the log states the real number. */
  maxTokens: number;
  /** The `insights_generated_documents` row, when one exists (SOW previews have none). */
  documentId?: number | null;
  mspCustomerId?: number | null;
  /**
   * Names the calling engine in the log line, so "which generation path hit the
   * ceiling" is answerable without correlating on document type.
   */
  source: string;
}

/**
 * Thrown when a generation response carries `stop_reason: "max_tokens"`.
 *
 * A named class rather than a bare `Error` so a caller that wants to treat
 * "ran out of room" differently from "the SDK threw" can, without matching on
 * message text. Nothing does today; the engines let it propagate to their own
 * catch blocks, which is the intended behaviour.
 */
export class DocumentOutputTruncatedError extends Error {
  override readonly name = "DocumentOutputTruncatedError";
  readonly docTypeKey: string;
  readonly maxTokens: number;
  readonly outputTokens: number | null;
  readonly charsProduced: number;

  constructor(args: {
    message: string;
    docTypeKey: string;
    maxTokens: number;
    outputTokens: number | null;
    charsProduced: number;
  }) {
    super(args.message);
    this.docTypeKey = args.docTypeKey;
    this.maxTokens = args.maxTokens;
    this.outputTokens = args.outputTokens;
    this.charsProduced = args.charsProduced;
  }
}

/** `usage.output_tokens` when the response actually carries a number, else null. */
function readOutputTokens(response: CeilingCheckableResponse): number | null {
  const raw = response.usage?.output_tokens;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * How much text the model produced, for the log line and the error.
 *
 * Deliberately measured off the raw first TEXT content block rather than off
 * `extractAiHtml()`: the point of the figure is "how close to the ceiling did
 * this document come", and the fence/summary stripping `extractAiHtml` does
 * would understate that. Never throws on an odd content shape — a guard that
 * can fail on the way to reporting a failure is not a guard.
 *
 * Git #559: selects by block TYPE, not by position. With adaptive thinking on
 * (now the narrative engine's setting) `content[0]` is a `thinking` block with
 * no `.text`, so position-zero reading would have reported `charsProduced: 0`
 * on every healthy generation — quietly turning #556's headroom line, whose
 * whole purpose is to answer "are we near the ceiling again?", into a constant
 * zero. The number would still have been logged; it would just have been wrong.
 * The thinking tokens themselves are NOT counted here: they are invisible to
 * the reader and are already reported by `usage.output_tokens`.
 */
function readCharsProduced(response: CeilingCheckableResponse): number {
  for (const raw of response.content ?? []) {
    const block = raw as { type?: unknown; text?: unknown } | undefined;
    if (!block) continue;
    if (block.type !== undefined && block.type !== "text") continue;
    if (typeof block.text === "string") return block.text.length;
  }
  return 0;
}

/**
 * True only for an explicit `max_tokens` stop reason.
 *
 * Strict equality on purpose. An absent `stop_reason` is NOT treated as
 * truncated: the field is optional in test fixtures and on any future response
 * shape that omits it, and defaulting an unknown to "truncated" would fail
 * healthy generations — trading a silent wrong document for a loud wrong
 * failure, which is not an improvement.
 */
export function isTruncatedByMaxTokens(response: CeilingCheckableResponse): boolean {
  return response.stop_reason === MAX_TOKENS_STOP_REASON;
}

/**
 * The one call every real generation path makes on its model response, before
 * anything reads the content.
 *
 * On a healthy response it emits the headroom line — the observability half of
 * #556. The new ceilings were derived from ONE observed truncation, and the
 * only way that derivation stays honest is if every real generation reports
 * what it actually used, so "are we near the ceiling again?" is answerable from
 * the logs rather than from the next customer-visible truncation.
 *
 * On a truncated response it logs at error and throws — see the file header for
 * why this is a throw and not a continuation.
 */
export function assertOutputNotTruncated(
  response: CeilingCheckableResponse,
  ctx: OutputCeilingContext,
  log: CeilingLogger,
): void {
  const outputTokens = readOutputTokens(response);
  const charsProduced = readCharsProduced(response);

  if (!isTruncatedByMaxTokens(response)) {
    log.info(
      {
        mspCustomerId: ctx.mspCustomerId ?? null,
        documentId: ctx.documentId ?? null,
        docTypeKey: ctx.docTypeKey,
        source: ctx.source,
        stopReason: typeof response.stop_reason === "string" ? response.stop_reason : null,
        maxTokens: ctx.maxTokens,
        outputTokens,
        charsProduced,
        // Null rather than a made-up percentage when the response carried no
        // token count — the same distinction the cost plumbing draws between a
        // real zero and an unknown figure.
        outputTokensUsedPct:
          outputTokens == null ? null : Math.round((outputTokens / ctx.maxTokens) * 1000) / 10,
      },
      "ai-output-ceiling: generation completed within its output ceiling",
    );
    return;
  }

  // Kept under `errorMessage`'s 500-character column budget, and written for the
  // admin who will read it in the Document Generator, not for a stack trace:
  // what happened, what it means for the document, and what to do about it.
  const message =
    `Generation for "${ctx.docTypeKey}" stopped at its max_tokens output ceiling ` +
    `(${ctx.maxTokens} tokens, ${charsProduced} characters produced). The document is ` +
    `truncated and was NOT saved — a cut-off document is not served as a finished one. ` +
    `Raise the ceiling for this document type or reduce what its prompt asks for, then regenerate.`;

  log.error(
    {
      mspCustomerId: ctx.mspCustomerId ?? null,
      documentId: ctx.documentId ?? null,
      docTypeKey: ctx.docTypeKey,
      source: ctx.source,
      stopReason: MAX_TOKENS_STOP_REASON,
      maxTokens: ctx.maxTokens,
      outputTokens,
      charsProduced,
    },
    "ai-output-ceiling: generation hit the max_tokens output ceiling — refusing to serve a truncated document as complete",
  );

  throw new DocumentOutputTruncatedError({
    message,
    docTypeKey: ctx.docTypeKey,
    maxTokens: ctx.maxTokens,
    outputTokens,
    charsProduced,
  });
}
