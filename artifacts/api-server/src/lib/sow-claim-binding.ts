/**
 * sow-claim-binding.ts — Git #560
 *
 * One definition of "this SOW attaches a dollar figure to the wrong thing",
 * checked before the SOW is saved.
 *
 * ── Why this is a separate file from `document-claim-binding.ts` ─────────────
 * #560 is the SOW half of #559, and the temptation is to point the #559 guard
 * at this engine and be done. That would produce an auditor asking the wrong
 * question, because the two engines do not share a claim shape or a source
 * shape:
 *
 *   - #559 audits `governance_maturity_report` and its siblings, whose source
 *     is TWO PROSE BLOCKS — `{{profileSample}}` and `{{findings}}` — and whose
 *     claims are English sentences about measured properties.
 *   - This engine's prompt has neither token. A SOW is built from
 *     `{{candidates}}`, `{{pricingFormula}}` and `{{priorFindings}}`, and its
 *     load-bearing claims are PRICING LINES: a workstream name bound to a
 *     dollar figure, in a table a customer is invoiced against.
 *
 * The failure mode is the same shape as #559's — a real value bound to the
 * wrong label — but the label is a workstream and the value is money, so both
 * the ground truth handed to the auditor and the question it is asked have to
 * change. What is genuinely shared is reused rather than re-typed:
 * `stripHtmlToText` and the audit call's model/temperature/ceiling constants
 * are imported from #559's module, so the two gates cannot drift apart on the
 * decisions they really do hold in common.
 *
 * ── The source here is STRUCTURED, and that is the important difference ──────
 * #559's auditor gets prose and has to read property names out of it. This one
 * does not have to: the Sales Offer Engine is the sole authority on what is
 * scoped and what it costs, and `document-engine-sow.ts` already holds that
 * answer as a list of `{ title, adjustedPriceCents }` records before it renders
 * them into `{{candidates}}`. Those records are passed here directly.
 *
 * So the auditor is not asked "does this number appear somewhere in the
 * source". It is handed the authoritative workstream-to-price table and asked
 * whether the document's own table agrees with it, line by line. That is a
 * sharper question than #559 could ask, and it is available only because this
 * engine's ground truth happens to be structured.
 *
 * ── Why the total is NOT the check (the SOW-specific trap) ───────────────────
 * This is the single most important design fact in this file, and it is the
 * reason the obvious cheap implementation is not here.
 *
 * The obvious check on a pricing document is arithmetic: sum the line items and
 * compare against the engine's total. `document-engine-sow.ts` already computes
 * that total server-side (`sowTotalPrice`), so it is sitting right there.
 *
 * It cannot catch this bug. The defining failure — two workstreams' prices
 * swapped between them — leaves the sum EXACTLY unchanged. Every individual
 * figure is real, every figure is present in the source, and the total
 * reconciles to the penny. An arithmetic validator passes that document
 * cleanly, and would report the pricing as verified.
 *
 * The same holds for a presence check: "is $12,400 one of the engine's prices?"
 * is answered yes for both the line it belongs to and the line it was
 * misattached to. As in #559, the defect is not the VALUE, it is the BINDING —
 * which workstream the money belongs to — and a binding is not recoverable from
 * a set of numbers or from their sum. Only something that reads the line as a
 * claim about a named workstream can see it.
 *
 * A narrow deterministic rule is not implemented here for the second reason
 * #559 gave and one of this engine's own: money is rendered into HTML in many
 * shapes (`$12,400`, `$12,400.00`, `12400.00`, split across table cells), so a
 * string-matching rejecter would destroy correct SOWs over formatting. Under
 * reject-before-save semantics a false rejection is not a nuisance, it is a
 * lost document — and the arithmetic it would be trusted for is exactly the
 * arithmetic that cannot see the bug.
 *
 * ── Fail-closed on a verdict, fail-OPEN on a broken audit ────────────────────
 * Identical to #559 and #556, deliberately: a confirmed mismatch throws, the
 * engine's catch marks the row `failed` with a specific `errorMessage`, and the
 * text never reaches `html_content` or `status: "approved"`. An audit that
 * could not be RUN or PARSED is not evidence of anything and lets the document
 * through with a warning — a gate that destroys good SOWs whenever its own
 * second model call hiccups is worse than the defect it guards.
 *
 * Only `confidence: "certain"` rejects. The bar is high for the same reason as
 * #559's: a correct SOW legitimately carries several similar dollar figures
 * near each other, and a gate tuned to flag every suspicion would reject
 * correct pricing.
 *
 * Pure and engine-free on purpose, exactly as `ai-output-ceiling.ts` and
 * `document-claim-binding.ts` are: no DB, no Sales Offer Engine, no SDK import.
 * The model call is INJECTED by the caller, so the prompt, the parsing and the
 * reject/allow decision are all assertable directly without standing anything
 * up.
 */

import {
  stripHtmlToText,
  CLAIM_BINDING_AUDIT_MAX_DOCUMENT_CHARS,
  CLAIM_BINDING_TRUNCATION_MARKER,
} from "./document-claim-binding";

/**
 * One workstream as the Sales Offer Engine priced it — the authoritative pair.
 *
 * `priceUsd` rather than the engine's native `adjustedPriceCents` because that
 * is the unit the generator rendered into `{{candidates}}`, and the auditor has
 * to compare against the same figures the model was shown. The conversion
 * happens once, at the caller, from the same expression that builds the prompt
 * block.
 */
export interface SowPricedLine {
  /** The workstream title, exactly as it appeared in `{{candidates}}`. */
  title: string;
  /** The engine-adjusted price in dollars. */
  priceUsd: number;
}

/** The real scoped source data the SOW was generated from. */
export interface SowClaimBindingSource {
  /**
   * The authoritative workstream-to-price table. This is the ground truth the
   * whole gate exists to defend — the Sales Offer Engine's output, not anything
   * re-parsed back out of rendered HTML.
   */
  lines: SowPricedLine[];
  /**
   * The server-authoritative engagement total, in dollars.
   *
   * Supplied to the auditor as CONTEXT, never as the test — see the file header
   * for why a total that reconciles proves nothing about the bindings. It is
   * here so the auditor is not fooled into treating a correct sum as evidence,
   * which is exactly the mistake a human reviewer makes on this document.
   */
  totalUsd: number;
  /** The `{{pricingFormula}}` block, verbatim as the generator received it. */
  pricingFormula: string;
  /** The `{{priorFindings}}` block, verbatim as the generator received it. */
  priorFindings: string;
}

/** What the audit concluded. Same three states as #559. */
export type SowClaimBindingStatus =
  /** The audit ran, parsed, and found no `certain` mismatch. */
  | "clean"
  /** The audit ran, parsed, and found at least one `certain` mismatch. */
  | "mismatch"
  /** The audit could not be run or its answer could not be read. Not a verdict. */
  | "inconclusive";

/**
 * The kinds of binding failure this gate distinguishes.
 *
 * Named rather than free-text because the admin-facing message reads
 * differently for each, and because "the price is wrong for this workstream"
 * and "this workstream was never scoped at all" are different conversations
 * with the customer.
 */
export type SowMismatchKind =
  /** A real engine price attached to a workstream it does not belong to. */
  | "price_bound_to_wrong_workstream"
  /** A workstream priced at a figure the engine never produced for anything. */
  | "price_not_from_engine"
  /** A workstream billed that the Sales Offer Engine did not scope. */
  | "workstream_not_scoped"
  /** Anything the auditor flagged that does not fit the three above. */
  | "other";

/** One pricing claim the auditor says is bound to the wrong workstream. */
export interface SowClaimBindingMismatch {
  /** The workstream the document names on the offending line. */
  workstream: string;
  /** The line (or close paraphrase) from the document, for the error message. */
  claim: string;
  /** What the Sales Offer Engine priced that workstream at, as the auditor read it. */
  sourcePrice: string;
  /** What the document bills for it. */
  statedPrice: string;
  /** Which failure this is. */
  kind: SowMismatchKind;
  /**
   * Only `certain` rejects a document. See the file header for why the bar is
   * here and not lower.
   */
  confidence: "certain" | "likely" | "unsure";
  /** Why the auditor calls it a mismatch — carried into the log, not the error. */
  explanation: string;
}

export interface SowClaimBindingVerdict {
  status: SowClaimBindingStatus;
  /** Every mismatch the auditor reported, at every confidence. */
  mismatches: SowClaimBindingMismatch[];
  /** Present only on `inconclusive`: why no verdict was reached. */
  inconclusiveReason?: string;
}

/** The pino-shaped `(bindings, message)` calls this guard makes. */
export interface SowClaimBindingLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

/** Everything the log lines and the admin-facing error message need to be specific. */
export interface SowClaimBindingContext {
  docTypeKey: string;
  documentId?: number | null;
  mspCustomerId?: number | null;
  /** Names the calling engine in the log line. */
  source: string;
}

/**
 * Thrown when the audit confirms a dollar figure bound to the wrong workstream.
 *
 * A named class rather than a bare `Error`, matching
 * `DocumentOutputTruncatedError` and `DocumentClaimBindingError`, so a caller
 * that wants to treat "the SOW misprices a line" differently from "the SDK
 * threw" can without matching on message text. Nothing does today; the engine
 * lets it propagate to its own catch block, which is the intended behaviour.
 */
export class SowClaimBindingError extends Error {
  override readonly name = "SowClaimBindingError";
  readonly docTypeKey: string;
  readonly mismatches: SowClaimBindingMismatch[];

  constructor(args: { message: string; docTypeKey: string; mismatches: SowClaimBindingMismatch[] }) {
    super(args.message);
    this.docTypeKey = args.docTypeKey;
    this.mismatches = args.mismatches;
  }
}

/** `1234.5` -> `$1,234.50`, the shape `{{candidates}}` and SOW tables use. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$?";
  const [whole, cents] = Math.abs(value).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${value < 0 ? "-" : ""}$${grouped}.${cents}`;
}

/**
 * The audit prompt.
 *
 * Three instructions in here are load-bearing and are the whole adaptation
 * from #559:
 *
 *   1. The authoritative table is given as an explicit workstream-to-price
 *      list, not as prose to be mined. The auditor's job is a line-by-line
 *      comparison against it, which is a far more mechanical task than #559's
 *      and is why this call can afford `temperature: 0` and no thinking.
 *
 *   2. The auditor is told, in as many words, that a correct TOTAL proves
 *      nothing. Without that instruction the obvious reasoning path — "the
 *      numbers add up, so the pricing is fine" — clears the exact document
 *      this gate exists to stop, because swapping two line prices preserves the
 *      sum.
 *
 *   3. It is told not to re-price anything. The Sales Offer Engine is the sole
 *      pricing authority; an auditor that decides a workstream "should" cost
 *      more would reject correct SOWs on its own opinion of market rates.
 */
export function buildSowClaimBindingAuditPrompt(args: {
  documentText: string;
  source: SowClaimBindingSource;
  docTypeKey: string;
}): string {
  const truncated = args.documentText.length > CLAIM_BINDING_AUDIT_MAX_DOCUMENT_CHARS;
  const documentExcerpt = truncated
    ? args.documentText.slice(0, CLAIM_BINDING_AUDIT_MAX_DOCUMENT_CHARS) + CLAIM_BINDING_TRUNCATION_MARKER
    : args.documentText;

  const pricedTable = args.source.lines.length > 0
    ? args.source.lines.map((l) => `  - ${l.title} = ${formatUsd(l.priceUsd)}`).join("\n")
    : "  (the pricing engine scoped no workstreams for this client)";

  return [
    `You are auditing a generated "${args.docTypeKey}" Statement of Work against the authoritative pricing it was written from. This document is used to invoice a real customer, so report only what the data below supports.`,
    "",
    "## What you are looking for",
    "",
    "You are checking BINDINGS, not arithmetic. A binding error takes a real, correct price from the authoritative table and attaches it to the WRONG WORKSTREAM.",
    "",
    "Every dollar figure in a binding error is genuinely one of the prices below. Do NOT check whether a figure appears somewhere in the table — it will. Check whether THIS figure belongs to THIS workstream.",
    "",
    "The shapes to watch for:",
    "  - two workstreams with each other's prices",
    "  - a workstream billed at a price the table assigns to a different workstream",
    "  - a workstream billed at a figure that is in the table for nothing at all",
    "  - a workstream billed that the pricing engine never scoped",
    "",
    "## A correct total is NOT evidence that the pricing is correct",
    "",
    "Read this before you conclude anything. If two workstreams have each other's prices, the line items still sum to exactly the right total. Every figure is real, the arithmetic reconciles to the penny, and the document is still wrong.",
    "",
    "So do NOT reason from the total to the lines. Check each line against the table on its own. The total is given below only so you are not surprised by it.",
    "",
    "## What is NOT a mismatch",
    "",
    "- Do NOT re-price anything. The table below is the sole pricing authority; you are not judging whether a price is reasonable, only whether it is on the right line.",
    "- Rounding stated as such, currency formatting, subtotals, taxes or totals presented as such, and payment-schedule instalments that divide a correct price.",
    "- Narrative that describes a workstream's scope without pricing it.",
    "- A claim you cannot check because the workstream is not in the table below. Omit it. Absence of evidence is not a mismatch.",
    "- Anything you are unsure about. Prefer reporting nothing over reporting a suspicion.",
    "",
    "Use `confidence: \"certain\"` ONLY when the table below contains the exact workstream the line is about AND its price directly contradicts what the document bills for it. Otherwise use `\"likely\"` or `\"unsure\"`.",
    "",
    "## Authoritative pricing — the ground truth",
    "",
    "### Workstreams the pricing engine scoped, and what it priced each at",
    pricedTable,
    "",
    `### Engagement total (context only, not a test): ${formatUsd(args.source.totalUsd)}`,
    "",
    "### Pricing presentation rules the document was told to follow",
    args.source.pricingFormula || "(none supplied)",
    "",
    "### Grounding findings the scope was written from",
    args.source.priorFindings || "(none supplied)",
    "",
    "## The generated Statement of Work",
    "",
    documentExcerpt,
    "",
    "## Your answer",
    "",
    "Respond with a single JSON object and nothing else — no preamble, no code fence:",
    "",
    '{"mismatches":[{"workstream":"<the workstream the document names>","claim":"<the line from the document>","sourcePrice":"<what the table prices it at>","statedPrice":"<what the document bills>","kind":"price_bound_to_wrong_workstream|price_not_from_engine|workstream_not_scoped|other","confidence":"certain|likely|unsure","explanation":"<why>"}]}',
    "",
    'If every priced line agrees with the table, respond exactly: {"mismatches":[]}',
  ].join("\n");
}

const MISMATCH_KINDS: ReadonlySet<string> = new Set<SowMismatchKind>([
  "price_bound_to_wrong_workstream",
  "price_not_from_engine",
  "workstream_not_scoped",
  "other",
]);

/**
 * The auditor's JSON verdict, read tolerantly.
 *
 * Same tolerance and the same hard rule as #559's parser: scan for the
 * outermost braces rather than demanding bare JSON, and never report `clean`
 * for a response this function did not understand — `clean` is a statement that
 * the pricing was checked and is right, and it must not be made on the strength
 * of an unparseable answer.
 */
export function parseSowClaimBindingVerdict(raw: string): SowClaimBindingVerdict {
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

  const mismatches: SowClaimBindingMismatch[] = [];
  for (const entry of rawList) {
    const item = entry as Record<string, unknown> | null;
    if (!item || typeof item !== "object") continue;
    const confidence = item.confidence;
    const kind = item.kind;
    mismatches.push({
      workstream: asText(item.workstream),
      claim: asText(item.claim),
      sourcePrice: asText(item.sourcePrice),
      statedPrice: asText(item.statedPrice),
      // An unrecognised kind becomes `other` rather than being dropped: the
      // kind shapes the message, it does not decide the rejection, so an
      // unfamiliar label must never be the reason a real mismatch is discarded.
      kind: typeof kind === "string" && MISMATCH_KINDS.has(kind) ? (kind as SowMismatchKind) : "other",
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
 * SPECIFIC, for the reason #556 established and #559 repeated: "generation
 * failed" tells an admin nothing they can act on. This names the workstream,
 * both figures, and quotes the offending line, so the person reading it in the
 * Document Generator can check it against the Sales Offer Engine in seconds.
 *
 * The money framing is deliberate and is not decoration — an admin who sees
 * "validation failed" re-runs it, and an admin who sees "billed $12,400.00 for
 * a workstream the engine priced at $4,800.00" goes and looks.
 */
export function buildSowClaimBindingErrorMessage(
  docTypeKey: string,
  mismatches: SowClaimBindingMismatch[],
): string {
  const first = mismatches[0];
  const others = mismatches.length > 1 ? ` (+${mismatches.length - 1} more)` : "";
  const claim = first ? truncateForMessage(first.claim, 120) : "";
  const workstream = first?.workstream || "an unnamed workstream";

  const head = first?.kind === "workstream_not_scoped"
    ? `Generation for "${docTypeKey}" was rejected: the SOW bills for "${workstream}", which the Sales Offer Engine did not scope for this client${others}.`
    : `Generation for "${docTypeKey}" was rejected: a pricing line contradicts the engine-authoritative price it cites. ` +
      `The Sales Offer Engine priced "${workstream}" at ${first?.sourcePrice || "?"}, but the document bills ` +
      `${first?.statedPrice || "?"}${others}.`;

  const quote = claim ? ` Offending line: "${claim}".` : "";
  const tail = " The document was NOT saved — a SOW with a wrong dollar figure is not served as correct. Regenerate.";
  return truncateForMessage(head + quote + tail, 500);
}

function truncateForMessage(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1) + "…";
}

/**
 * The one call the SOW generation path makes on its finished document, before
 * the document is saved.
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
export async function assertSowClaimBindingsConsistent(
  args: {
    documentHtml: string;
    source: SowClaimBindingSource;
    ctx: SowClaimBindingContext;
  },
  log: SowClaimBindingLogger,
  audit: (prompt: string) => Promise<string>,
): Promise<SowClaimBindingVerdict> {
  const { ctx } = args;
  const bindings = {
    mspCustomerId: ctx.mspCustomerId ?? null,
    documentId: ctx.documentId ?? null,
    docTypeKey: ctx.docTypeKey,
    source: ctx.source,
    pricedLineCount: args.source.lines.length,
  };

  // Nothing priced means there is no binding to get wrong. This is a real,
  // expected state — the Sales Offer Engine returns no candidates for a client
  // with nothing to sell, and the prompt tells the model to invent nothing —
  // so it is not an audit failure and must not spend a model call.
  if (args.source.lines.length === 0) {
    const verdict: SowClaimBindingVerdict = {
      status: "inconclusive",
      mismatches: [],
      inconclusiveReason: "no engine-priced workstreams to check the document against",
    };
    log.info({ ...bindings, reason: verdict.inconclusiveReason },
      "sow-claim-binding: skipped — the pricing engine scoped nothing, so there is no binding to verify");
    return verdict;
  }

  const documentText = stripHtmlToText(args.documentHtml);
  if (!documentText) {
    // Nothing to audit is not a clean audit. An empty document is #556's
    // problem or the extraction path's, not this guard's, and claiming it
    // passed a pricing check would be a lie in the log.
    const verdict: SowClaimBindingVerdict = {
      status: "inconclusive",
      mismatches: [],
      inconclusiveReason: "document had no readable text to audit",
    };
    log.warn({ ...bindings, reason: verdict.inconclusiveReason },
      "sow-claim-binding: skipped — no readable document text (not a pass)");
    return verdict;
  }

  const prompt = buildSowClaimBindingAuditPrompt({
    documentText,
    source: args.source,
    docTypeKey: ctx.docTypeKey,
  });

  let raw: string;
  try {
    raw = await audit(prompt);
  } catch (err) {
    // Fail-open, loudly. The SOW is already written and paid for; losing it
    // because the auditor's own call failed would make this gate a bigger
    // source of lost documents than the defect it exists to catch.
    log.warn({ ...bindings, err },
      "sow-claim-binding: audit call failed — document allowed through unaudited (not a pass)");
    return { status: "inconclusive", mismatches: [], inconclusiveReason: "audit call threw" };
  }

  const verdict = parseSowClaimBindingVerdict(raw);

  if (verdict.status === "inconclusive") {
    log.warn({ ...bindings, reason: verdict.inconclusiveReason },
      "sow-claim-binding: audit produced no readable verdict — document allowed through unaudited (not a pass)");
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
      "sow-claim-binding: every priced line agrees with the workstream the Sales Offer Engine priced",
    );
    return verdict;
  }

  const certain = verdict.mismatches.filter((m) => m.confidence === "certain");
  const message = buildSowClaimBindingErrorMessage(ctx.docTypeKey, certain);

  log.error(
    { ...bindings, auditedChars: documentText.length, mismatches: certain },
    "sow-claim-binding: SOW bills a figure the pricing engine did not assign to that workstream — refusing to serve it as correct",
  );

  throw new SowClaimBindingError({ message, docTypeKey: ctx.docTypeKey, mismatches: certain });
}
