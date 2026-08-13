/**
 * document-claim-binding.ts — Git #559
 *
 * One definition of "this document states something its own source data
 * contradicts", checked before the document is saved.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * Confirmed live and confirmed SYSTEMATIC (2026-08-08): five real
 * Force-Regenerate runs of `governance_maturity_report`, one tenant, one scan —
 * and four of the five reported that all 18 Teams are ownerless when the stored
 * `ownerlessTeamCount` is 0. Run 5 states the mechanism outright, printing the
 * right number and the opposite conclusion in one sentence:
 *
 *     "The scan recorded an ownerless Teams count of zero — meaning no Team
 *      currently has a designated owner ..."
 *
 * The one run that got it right (run 4) did not just avoid the error, it named
 * the distinction the other four collapsed: "Teams ownership and group
 * ownership are tracked separately."
 *
 * ── Why this is a model call and NOT a numeric matcher ───────────────────────
 * This is the single most important design fact in this file, and it is the
 * reason the obvious cheap implementation is not here.
 *
 * #559 originally proposed spot-checking the numbers in the output against the
 * numbers in `{{profileSample}}`. That check PASSES the bad document. The bad
 * sentence is "all 18 Teams have no owner", and 18 is a real, correct,
 * present-in-the-source value — `{{profileSample}}` carries four Teams-wide
 * properties equal to 18 (`teamsWithGuestsCount`, `meetingPolicyAssignedCount`,
 * `messagingPolicyAssignedCount`, and the Teams inventory itself) against
 * exactly one equal to 0. Every number in the false claim is verifiable. So is
 * every number in the true one.
 *
 * The defect is not the VALUE, it is the BINDING — which property the value
 * belongs to — and a binding is not recoverable from a set of numbers. Any
 * presence-, set-, or range-based validator is structurally incapable of
 * catching this class of bug, no matter how carefully it is written. Only
 * something that reads the claim as a claim can.
 *
 * A narrow deterministic rule ("a zero-valued `*Count` rendered as a
 * universal-quantifier sentence") would have caught this specific bug and the
 * inactive-sites near-miss beside it, and nothing else. It is not implemented
 * here because it would give a false sense of coverage over a failure mode
 * whose defining feature is that it looks locally correct.
 *
 * ── Fail-closed on a verdict, fail-OPEN on a broken audit ────────────────────
 * A confirmed mismatch rejects the document, following the exact pattern #556
 * established for truncation: throw, let the engine's catch mark the row
 * `failed` with a specific `errorMessage`, never write the text to
 * `html_content`, never reach `status: "approved"`.
 *
 * But an audit that could not be RUN or could not be PARSED is not evidence of
 * anything, and is explicitly not a rejection. A gate that destroys good
 * documents whenever its own second model call hiccups is worse than the defect
 * it guards — the failure it introduces is total, where the failure it prevents
 * is occasional. Those cases log a warning and let the document through, which
 * is also what keeps this gate from silently failing every suite in the repo
 * whose Anthropic mock returns something other than an audit verdict.
 *
 * Only `confidence: "certain"` rejects, for the same reason: the trap in this
 * data is that a wrong binding reads as plausible and a right one reads as
 * surprising ("count of zero" next to "18 Teams" looks like an error until you
 * know the two are different properties). A gate tuned to catch every suspicion
 * would have failed run 4 — the one document that was correct.
 *
 * Pure and engine-free on purpose, exactly as `ai-output-ceiling.ts` is: no DB,
 * no scoring graph, no SDK import. The model call is INJECTED by the caller, so
 * the prompt, the parsing and the reject/allow decision can all be asserted
 * directly against the real captured documents without standing anything up.
 */

/**
 * The model the audit runs on. Same model as the generation it audits — the
 * point of the second call is a second, independent LOOK at the finished text
 * beside the source data, not a more capable judge.
 */
export const CLAIM_BINDING_AUDIT_MODEL = "claude-sonnet-4-6";

/**
 * Small by design: the audit returns a JSON verdict listing mismatches, not
 * prose. A verdict that needs more room than this is not a verdict.
 */
export const CLAIM_BINDING_AUDIT_MAX_TOKENS = 4000;

/**
 * Zero — and this is the one call in the #559 work that gets it.
 *
 * The generation call cannot have it (sampling parameters and thinking are
 * mutually exclusive on `claude-sonnet-4-6`, and at 4-in-5 the wrong binding is
 * the dominant mode there, so greedy decoding would lock the defect in rather
 * than remove it — see `document-engine.ts`'s NARRATIVE_THINKING).
 *
 * Here every one of those objections is inverted. Nothing has to be
 * reconstructed: both the claim and the source value are supplied in the
 * prompt, so the task really is the near-deterministic comparison temperature 0
 * suits. And run-to-run stability is the POINT for a gate — an admin who
 * re-runs a rejected document should get the same verdict, and a document that
 * passes should not fail on a re-check for sampling reasons alone.
 */
export const CLAIM_BINDING_AUDIT_TEMPERATURE = 0;

/**
 * How much of the generated document is put in front of the auditor.
 *
 * Documents observed in the wild run to ~47k characters of HTML; tag-stripping
 * takes a large bite out of that. This bound exists so a runaway generation
 * cannot turn one audit into an unbounded bill, not because the documents are
 * expected to reach it. When it does bite, the prompt says so explicitly rather
 * than letting the auditor believe it saw the whole document — an auditor that
 * silently reviews half a document and reports no mismatches has produced a
 * clean verdict that means nothing.
 */
export const CLAIM_BINDING_AUDIT_MAX_DOCUMENT_CHARS = 80_000;

/** Marker appended to the document excerpt when the cap above bites. */
export const CLAIM_BINDING_TRUNCATION_MARKER =
  "\n\n[... document truncated for audit — the text above is not the complete document ...]";

/**
 * How long one audit attempt is allowed to take, as an SDK per-request
 * `timeout` — see `CLAIM_BINDING_AUDIT_DEADLINE_MS` below for the hard bound
 * that sits outside it, and why one is not enough.
 *
 * ── Why the SDK default was not good enough ──────────────────────────────────
 * Confirmed live: after #559/#560 landed, a real generation sat at
 * `status='generating'` with zero progress for 13.7+ minutes before being
 * cleared by hand. #559 built careful fail-open handling for an audit that
 * ERRORS or returns unparseable output, and none of it fires for an audit that
 * simply never comes back — a hang is not a rejected promise.
 *
 * Read against the installed SDK (`@anthropic-ai/sdk@0.78.0`) rather than
 * assumed, the unguarded call was not literally unbounded, it was bounded far
 * too high to matter:
 *
 *   - `Anthropic.DEFAULT_TIMEOUT` is 10 minutes, and it is a flat 10 minutes
 *     for a non-streaming call (`calculateNonstreamingTimeout` does not scale
 *     the ceiling UP — above ~21,333 `max_tokens` it throws and demands
 *     streaming instead).
 *   - `maxRetries` defaults to 2, and a timeout is a retryable condition, so
 *     the real worst case for one audit is three 10-minute attempts plus
 *     backoff — around half an hour of a document stuck at `generating`.
 *
 * 13.7 minutes with no progress is exactly what that looks like from outside:
 * attempt one having timed out at ten minutes and a retry in flight.
 *
 * ── Why 120 seconds ─────────────────────────────────────────────────────────
 * Derived from what this call actually is, not picked round. It is a single
 * short JSON verdict capped at `CLAIM_BINDING_AUDIT_MAX_TOKENS` (4,000), with
 * no thinking, against at most `CLAIM_BINDING_AUDIT_MAX_DOCUMENT_CHARS` (80k
 * chars, ~20-25k tokens) of input. Input processing is seconds. A MAXIMAL
 * verdict — the full 4,000-token cap, which in practice a handful of mismatches
 * never approaches — at a conservative 40-60 output tokens/sec is ~65-100
 * seconds. 120 sits above that worst case with margin, and two orders of
 * magnitude below the half-hour the defaults allowed.
 *
 * The starting range suggested for this fix was 60-90s. It was raised on that
 * derivation: at 60s a legitimately long verdict is cut off, and because this
 * gate fails OPEN, cutting it off does not surface as an error — it silently
 * turns a working mismatch check into an unaudited document. Being generous
 * here costs nothing in the normal case (a real verdict returns in seconds) and
 * avoids trading a rare hang for a routine silent hole in the gate.
 *
 * Paired with `maxRetries: 0` at the call sites: with a hard deadline in front
 * of the call, an SDK retry can never finish inside the window, so leaving
 * retries on would only spend real customer tokens on attempts whose answers
 * are guaranteed to be thrown away. One bounded attempt, then fail open.
 */
export const CLAIM_BINDING_AUDIT_TIMEOUT_MS = 120_000;

/**
 * The hard deadline the audit is raced against — the actual fix for the hang.
 *
 * `CLAIM_BINDING_AUDIT_TIMEOUT_MS` above is handed to the SDK, which is the
 * right place for it: the SDK aborts the underlying request, so the socket is
 * released and the failure arrives as a normal `APIConnectionTimeoutError`
 * straight into the fail-open `catch` #559 already wrote.
 *
 * That is the expected exit, and it is deliberately NOT the guarantee. The
 * defect being fixed here is a call that does not come back, and a mechanism
 * that depends on the SDK's own abort firing cannot be the guard against the
 * SDK's own abort not firing. This deadline is a `Promise.race` in this module,
 * outside the SDK entirely: whatever happens below it — an ignored abort, a
 * promise that never settles, a stall above or below the HTTP layer — the audit
 * gives up here and the document proceeds.
 *
 * Set a grace interval above the SDK timeout so the SDK's cleaner failure wins
 * the ordinary race and this only fires when the SDK's own bound did not.
 */
export const CLAIM_BINDING_AUDIT_DEADLINE_MS = CLAIM_BINDING_AUDIT_TIMEOUT_MS + 5_000;

/**
 * Thrown by `runAuditWithDeadline` when the injected audit call does not settle
 * inside `CLAIM_BINDING_AUDIT_DEADLINE_MS`.
 *
 * A distinct type so the fail-open handlers can log "hung" separately from
 * "threw". Both allow the document through — the distinction is for whoever
 * reads the logs afterwards, because "the auditor timed out" and "the auditor
 * returned a 400" want completely different follow-up.
 */
export class ClaimBindingAuditTimeoutError extends Error {
  readonly deadlineMs: number;

  constructor(deadlineMs: number) {
    super(`claim-binding audit did not respond within ${deadlineMs}ms`);
    this.name = "ClaimBindingAuditTimeoutError";
    this.deadlineMs = deadlineMs;
  }
}

/**
 * Race an injected audit call against a wall-clock deadline.
 *
 * Shared by both engines' gates (`assertClaimBindingsConsistent` here and
 * `assertSowClaimBindingsConsistent` in `sow-claim-binding.ts`) so the two
 * cannot drift, and exported so the deadline behaviour can be tested without
 * standing up an engine.
 *
 * The timer is cleared on BOTH paths. An un-cleared `setTimeout` keeps the Node
 * event loop alive for the full deadline after a perfectly successful audit,
 * which in a test run is a two-minute hang at the end of the suite and in the
 * API server is a pointless retained handle per document.
 *
 * The losing promise is left deliberately unobserved except for a swallowing
 * `catch`: if the underlying call eventually rejects after the deadline has
 * already fired, nobody is listening, and an unhandled rejection would take the
 * process down over a call whose answer was correctly discarded.
 */
export async function runAuditWithDeadline(
  call: () => Promise<string>,
  deadlineMs: number = CLAIM_BINDING_AUDIT_DEADLINE_MS,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ClaimBindingAuditTimeoutError(deadlineMs)), deadlineMs);
    // Never hold the process open on this timer alone. Present on Node's
    // Timeout; guarded because the same code runs under test doubles.
    (timer as unknown as { unref?: () => void }).unref?.();
  });

  const inFlight = call();
  inFlight.catch(() => {});

  try {
    return await Promise.race([inFlight, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** What the audit concluded. */
export type ClaimBindingAuditStatus =
  /** The audit ran, parsed, and found no `certain` mismatch. */
  | "clean"
  /** The audit ran, parsed, and found at least one `certain` mismatch. */
  | "mismatch"
  /** The audit could not be run or its answer could not be read. Not a verdict. */
  | "inconclusive";

/** One claim the auditor says is bound to the wrong property. */
export interface ClaimBindingMismatch {
  /** The sentence (or close paraphrase) from the document, for the error message. */
  claim: string;
  /** The source property the claim is really about, e.g. `ownerlessTeamCount`. */
  property: string;
  /** What the source data says that property is. */
  sourceValue: string;
  /** What the document asserts it is. */
  statedValue: string;
  /**
   * Only `certain` rejects a document. See the file header for why the bar is
   * here and not lower.
   */
  confidence: "certain" | "likely" | "unsure";
  /** Why the auditor calls it a mismatch — carried into the log, not the error. */
  explanation: string;
}

export interface ClaimBindingVerdict {
  status: ClaimBindingAuditStatus;
  /** Every mismatch the auditor reported, at every confidence. */
  mismatches: ClaimBindingMismatch[];
  /** Present only on `inconclusive`: why no verdict was reached. */
  inconclusiveReason?: string;
}

/** The pino-shaped `(bindings, message)` calls this guard makes. */
export interface ClaimBindingLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

/** Everything the log lines and the admin-facing error message need to be specific. */
export interface ClaimBindingContext {
  docTypeKey: string;
  documentId?: number | null;
  mspCustomerId?: number | null;
  /** Names the calling engine in the log line. */
  source: string;
}

/** The real scoped source data the document was generated from. */
export interface ClaimBindingSource {
  /** The `{{profileSample}}` block, verbatim as the generator received it. */
  profileSample: string;
  /** The `{{findings}}` block, verbatim as the generator received it. */
  findings: string;
}

/**
 * Thrown when the audit confirms a claim bound to the wrong property.
 *
 * A named class rather than a bare `Error`, matching
 * `DocumentOutputTruncatedError`, so a caller that wants to treat "the document
 * contradicts its data" differently from "the SDK threw" can without matching
 * on message text. Nothing does today; the engine lets it propagate to its own
 * catch block, which is the intended behaviour.
 */
export class DocumentClaimBindingError extends Error {
  override readonly name = "DocumentClaimBindingError";
  readonly docTypeKey: string;
  readonly mismatches: ClaimBindingMismatch[];

  constructor(args: { message: string; docTypeKey: string; mismatches: ClaimBindingMismatch[] }) {
    super(args.message);
    this.docTypeKey = args.docTypeKey;
    this.mismatches = args.mismatches;
  }
}

/**
 * Named HTML entities these documents actually use.
 *
 * `&mdash;` earns its place at the top of this list on evidence: the real
 * inverted sentence from run 5 is "...count of zero &mdash; meaning no Team
 * currently has a designated owner", so an extractor that decoded only the five
 * XML built-ins would have put a literal `&mdash;` in the middle of the exact
 * claim the auditor is being asked to judge. Punctuation noise inside the
 * sentence under audit is not cosmetic here.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", bull: "•", middot: "·",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  times: "×", deg: "°", copy: "©", reg: "®", trade: "™",
  larr: "←", rarr: "→", le: "≤", ge: "≥", ne: "≠",
};

/** Block-level boundary marker, held across whitespace collapsing. */
const BLOCK_BREAK = "\u0000";

/**
 * HTML down to the readable sentences an auditor should judge.
 *
 * Comments go first and whole — `<!-- Finding: Ownerless Teams -->` markers are
 * real in these documents and would otherwise survive tag-stripping as bare
 * text and read as prose. Script and style bodies go the same way. What is left
 * is what a customer actually reads, which is the only thing a claim can be
 * wrong in.
 *
 * Whitespace is collapsed WITHIN a block and preserved BETWEEN blocks, via a
 * sentinel that survives the collapse. That ordering is not tidiness: generated
 * HTML is hard-wrapped, so a claim routinely spans several source lines, and
 * leaving those newlines in place hands the auditor sentences chopped in half
 * mid-clause. Paragraph boundaries still have to survive, or separate findings
 * run together into sentences neither of them made.
 */
export function stripHtmlToText(html: string): string {
  const withBreaks = (html ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|td|th)>/gi, BLOCK_BREAK)
    .replace(/<br\s*\/?>/gi, BLOCK_BREAK)
    .replace(/<[^>]+>/g, " ");

  const decoded = withBreaks
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (whole, name: string) =>
      NAMED_ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/&#(\d+);/g, (_m, code: string) => safeCodePoint(Number(code)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)));

  return decoded
    .replace(/[^\S]+/g, " ")
    .split(BLOCK_BREAK)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/** Never throws on a malformed numeric entity — an extractor that can fail is not one. */
function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * The audit prompt.
 *
 * Written around one instruction that the obvious phrasing gets backwards: the
 * auditor is told NOT to look for numbers that are missing from the source,
 * because in the real failure every number is present. It is told to look for a
 * number attached to the wrong property, and it is shown the shape of the real
 * defect so it knows what "wrong property" looks like when the value beside it
 * checks out.
 *
 * The conservatism instruction is load-bearing in both directions. Without it
 * the auditor flags the CORRECT document — "an ownerless count of zero" sitting
 * next to "18 Teams" reads like a contradiction until you notice they are two
 * different properties, which is precisely the confusion that produces the bug
 * in the first place.
 */
export function buildClaimBindingAuditPrompt(args: {
  documentText: string;
  source: ClaimBindingSource;
  docTypeKey: string;
}): string {
  const truncated = args.documentText.length > CLAIM_BINDING_AUDIT_MAX_DOCUMENT_CHARS;
  const documentExcerpt = truncated
    ? args.documentText.slice(0, CLAIM_BINDING_AUDIT_MAX_DOCUMENT_CHARS) + CLAIM_BINDING_TRUNCATION_MARKER
    : args.documentText;

  return [
    `You are auditing a generated "${args.docTypeKey}" report against the real measured data it was written from. Report only what the data supports.`,
    "",
    "## What you are looking for",
    "",
    "You are checking BINDINGS, not values. A binding error is a claim that takes a real, correct number from the source data and attaches it to the WRONG PROPERTY.",
    "",
    "Every number in a binding error is genuinely present in the source data. Do NOT check whether a number appears somewhere in the data — it will. Check whether THIS number belongs to THIS property.",
    "",
    "The shape to watch for:",
    '  - the source records `someZeroCount: 0`, and the document says "all N items are in that state"',
    '  - the source records a count for property A, and the document attaches that count to property B',
    "  - a document sentence states a correct raw value and then draws the opposite conclusion from it in the same breath",
    "",
    "## What is NOT a mismatch",
    "",
    "- Two different properties having different values is normal, not a contradiction. Counts for separate properties are separate facts even when they describe the same objects.",
    "- Rephrasing, rounding stated as such, summarising, or explaining a value.",
    "- A claim you cannot check because the relevant property is not in the source data below. Omit it. Absence of evidence is not a mismatch.",
    "- Anything you are unsure about. Prefer reporting nothing over reporting a suspicion.",
    "",
    "Use `confidence: \"certain\"` ONLY when the source data below contains the exact property the claim is about AND its value directly contradicts what the document asserts about it. Otherwise use `\"likely\"` or `\"unsure\"`.",
    "",
    "## Source data — the ground truth",
    "",
    "### Measured properties",
    args.source.profileSample || "(none supplied)",
    "",
    "### Findings",
    args.source.findings || "(none supplied)",
    "",
    "## The generated document",
    "",
    documentExcerpt,
    "",
    "## Your answer",
    "",
    "Respond with a single JSON object and nothing else — no preamble, no code fence:",
    "",
    '{"mismatches":[{"claim":"<the sentence from the document>","property":"<the source property it is really about>","sourceValue":"<what the source data says>","statedValue":"<what the document asserts>","confidence":"certain|likely|unsure","explanation":"<why>"}]}',
    "",
    'If the document is consistent with the source data, respond exactly: {"mismatches":[]}',
  ].join("\n");
}

/**
 * The auditor's JSON verdict, read tolerantly.
 *
 * Scans for the outermost braces rather than parsing the whole response,
 * because a model asked for bare JSON will still occasionally wrap it in a
 * fence or a sentence, and throwing away a real verdict over that would push a
 * genuinely-caught bad document out through the fail-open path.
 *
 * Anything that cannot be read becomes `inconclusive` — never `clean`. The
 * distinction matters: `clean` is a statement that the document was checked and
 * is fine, and this function must never make that statement on the strength of
 * a response it did not understand.
 */
export function parseClaimBindingVerdict(raw: string): ClaimBindingVerdict {
  const text = (raw ?? "").trim();
  if (!text) {
    return { status: "inconclusive", mismatches: [], inconclusiveReason: "empty audit response" };
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { status: "inconclusive", mismatches: [], inconclusiveReason: "no JSON object in audit response" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { status: "inconclusive", mismatches: [], inconclusiveReason: "audit response was not valid JSON" };
  }

  const rawList = (parsed as { mismatches?: unknown } | null)?.mismatches;
  if (!Array.isArray(rawList)) {
    return { status: "inconclusive", mismatches: [], inconclusiveReason: "audit response had no `mismatches` array" };
  }

  const mismatches: ClaimBindingMismatch[] = [];
  for (const entry of rawList) {
    const item = entry as Record<string, unknown> | null;
    if (!item || typeof item !== "object") continue;
    const confidence = item.confidence;
    mismatches.push({
      claim: asText(item.claim),
      property: asText(item.property),
      sourceValue: asText(item.sourceValue),
      statedValue: asText(item.statedValue),
      // An unrecognised confidence is downgraded, never promoted: a verdict
      // this function did not understand must not be the thing that fails a
      // document.
      confidence: confidence === "certain" || confidence === "likely" ? confidence : "unsure",
      explanation: asText(item.explanation),
    });
  }

  const certain = mismatches.filter((m) => m.confidence === "certain");
  return { status: certain.length > 0 ? "mismatch" : "clean", mismatches };
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * The admin-facing rejection message.
 *
 * Kept inside `errorMessage`'s 500-character column budget and deliberately
 * SPECIFIC — #556's lesson was that "generation failed" tells an admin nothing
 * they can act on. This names the property, both values, and quotes the offending
 * sentence, so the person reading it in the Document Generator can confirm the
 * call in seconds against the same data.
 */
export function buildClaimBindingErrorMessage(
  docTypeKey: string,
  mismatches: ClaimBindingMismatch[],
): string {
  const first = mismatches[0];
  const others = mismatches.length > 1 ? ` (+${mismatches.length - 1} more)` : "";
  const claim = first ? truncateForMessage(first.claim, 140) : "";
  const head =
    `Generation for "${docTypeKey}" was rejected: a factual claim contradicts the real scan data it cites. ` +
    `"${first?.property ?? "unknown property"}" is ${first?.sourceValue ?? "?"} in the source data, but the ` +
    `document states ${first?.statedValue ?? "?"}${others}.`;
  const quote = claim ? ` Offending claim: "${claim}".` : "";
  const tail = " The document was NOT saved — a document that contradicts its own data is not served as correct. Regenerate.";
  return truncateForMessage(head + quote + tail, 500);
}

function truncateForMessage(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1) + "…";
}

/**
 * The one call every real generation path makes on its finished document,
 * before the document is saved.
 *
 * `audit` is the injected model call: it receives the fully-built prompt and
 * returns the model's raw text. Injecting it keeps this module free of the SDK
 * and lets the caller own metering — the audit is real Anthropic spend for a
 * real customer, and the engine runs it inside its own `withAiUsageCapture`
 * scope so it lands on the same `ai_usage_events` ledger and in the same
 * document's reported cost as the narrative call it audits.
 *
 * On a confirmed mismatch this logs at error and throws. On anything else it
 * returns the verdict; see the file header for why a broken audit is not a
 * rejection.
 */
export async function assertClaimBindingsConsistent(
  args: {
    documentHtml: string;
    source: ClaimBindingSource;
    ctx: ClaimBindingContext;
  },
  log: ClaimBindingLogger,
  audit: (prompt: string) => Promise<string>,
): Promise<ClaimBindingVerdict> {
  const { ctx } = args;
  const bindings = {
    mspCustomerId: ctx.mspCustomerId ?? null,
    documentId: ctx.documentId ?? null,
    docTypeKey: ctx.docTypeKey,
    source: ctx.source,
  };

  const documentText = stripHtmlToText(args.documentHtml);
  if (!documentText) {
    // Nothing to audit is not a clean audit. An empty document is #556's
    // problem or the extraction path's, not this guard's, and claiming it
    // passed a factual check would be a lie in the log.
    const verdict: ClaimBindingVerdict = {
      status: "inconclusive",
      mismatches: [],
      inconclusiveReason: "document had no readable text to audit",
    };
    log.warn({ ...bindings, reason: verdict.inconclusiveReason },
      "document-claim-binding: skipped — no readable document text (not a pass)");
    return verdict;
  }

  const prompt = buildClaimBindingAuditPrompt({
    documentText,
    source: args.source,
    docTypeKey: ctx.docTypeKey,
  });

  let raw: string;
  try {
    // Raced against a hard deadline, because #559's fail-open handling below
    // only catches an audit that FAILS, and the live hang this guards against
    // was an audit that never answered at all. See
    // `CLAIM_BINDING_AUDIT_DEADLINE_MS`.
    raw = await runAuditWithDeadline(() => audit(prompt));
  } catch (err) {
    // Fail-open, loudly. The narrative is already written and paid for; losing
    // it because the auditor's own call failed would make this gate a bigger
    // source of lost documents than the defect it exists to catch. A timeout
    // takes exactly this path — it is a broken audit, not a mismatch, and must
    // never be reported as one — but says so distinctly, because "hung" and
    // "errored" want different follow-up from whoever reads the log.
    if (err instanceof ClaimBindingAuditTimeoutError) {
      const verdict: ClaimBindingVerdict = {
        status: "inconclusive",
        mismatches: [],
        inconclusiveReason: `audit call timed out after ${err.deadlineMs}ms`,
      };
      log.warn({ ...bindings, deadlineMs: err.deadlineMs, reason: verdict.inconclusiveReason },
        "document-claim-binding: audit call timed out — document allowed through unaudited (not a pass)");
      return verdict;
    }
    log.warn({ ...bindings, err },
      "document-claim-binding: audit call failed — document allowed through unaudited (not a pass)");
    return { status: "inconclusive", mismatches: [], inconclusiveReason: "audit call threw" };
  }

  const verdict = parseClaimBindingVerdict(raw);

  if (verdict.status === "inconclusive") {
    log.warn({ ...bindings, reason: verdict.inconclusiveReason },
      "document-claim-binding: audit produced no readable verdict — document allowed through unaudited (not a pass)");
    return verdict;
  }

  if (verdict.status === "clean") {
    log.info(
      {
        ...bindings,
        auditedChars: documentText.length,
        // Sub-threshold suspicions are reported but do not gate. They are the
        // signal that would tell us the bar is in the wrong place, and they are
        // invisible unless they are logged.
        subThresholdCount: verdict.mismatches.length,
      },
      "document-claim-binding: every checkable claim is consistent with the scan data it cites",
    );
    return verdict;
  }

  const certain = verdict.mismatches.filter((m) => m.confidence === "certain");
  const message = buildClaimBindingErrorMessage(ctx.docTypeKey, certain);

  log.error(
    { ...bindings, auditedChars: documentText.length, mismatches: certain },
    "document-claim-binding: document contradicts its own source data — refusing to serve it as correct",
  );

  throw new DocumentClaimBindingError({ message, docTypeKey: ctx.docTypeKey, mismatches: certain });
}
