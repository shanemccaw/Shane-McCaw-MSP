import {
  db,
  aiPromptsTable,
  documentTypesTable,
  insightsGeneratedDocumentsTable,
  tenantsTable,
  mspsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { anthropic, withAiUsageCapture, totalCapturedCostCents } from "@workspace/integrations-anthropic-ai";
import { buildTenantProfile, findReusableDocument, namespacedProfileKey, resolveDocumentOwnerUserId, type CategorizedFinding, type MergedProfileByCheck } from "./tenant-signals";
import { EVIDENCE_PROPERTY_KEY as MONITOR_EVIDENCE_PROPERTY_KEY } from "./monitor-executor";
import { getDocumentStylePrefix, getPrompt } from "./prompt-loader";
import { extractAiHtml, firstTextBlock } from "./sow-pricing";
// Git #547 — the real go-live score. `copilot-gate.ts` is the single definition
// of the score, the 82 threshold and the go/no-go verdict; this engine reads it,
// it does not re-derive any part of it.
import { computeCopilotGate, type CopilotGateResult } from "./copilot-gate";
// Git #555 — the real per-finding point value. Same rule as the gate above: this
// engine READS the number, it does not derive any part of it. See
// finding-point-impact.ts for why the raw `signal_derivation_rules` impact column
// is NOT the point value and what normalization makes it one.
import { computeFindingPointImpacts } from "./finding-point-impact";
// Rendering comes from the engine-free sibling on purpose: `buildFindingsBlock`
// below is pure and must stay testable without standing up the scoring graph.
import {
  buildFindingPointImpactPreamble,
  formatFindingPointImpactLine,
  type FindingPointImpactResult,
} from "./finding-point-impact-format";
import type { PillarEvaluation } from "./health-display";
// Git #556 — the one definition of "the model ran out of room". Pure and
// engine-free; see that file's header for why a truncated document is failed
// rather than continued.
import { assertOutputNotTruncated } from "./ai-output-ceiling";
// Git #567 — the one definition of "the model call never came back". Same
// shape and same reason as the guard above; see that file's header for the
// SDK reading that shows a streaming call is bounded only up to first byte.
import {
  deriveGenerationDeadlineMs,
  runGenerationWithDeadline,
} from "./ai-generation-deadline";
// Git #559 — the one definition of "this document contradicts the data it
// cites". Same shape and same reason as the guard above: pure, engine-free, and
// SDK-free, so the reject/allow decision is assertable against the real
// captured documents. The model call it needs is injected below.
import {
  assertClaimBindingsConsistent,
  CLAIM_BINDING_AUDIT_MAX_TOKENS,
  CLAIM_BINDING_AUDIT_MODEL,
  CLAIM_BINDING_AUDIT_TEMPERATURE,
  CLAIM_BINDING_AUDIT_TIMEOUT_MS,
} from "./document-claim-binding";
import { logger } from "./logger";
import { generateOmgCardsFromTelemetry } from "./omg-card-generator-v2";
import {
  buildRemediationAppendix,
  REMEDIATION_APPENDIX_MAX_FINDINGS,
  REMEDIATION_APPENDIX_PROMPT_SUFFIX,
} from "./remediation-knowledge-base";

const log = logger.child({ channel: "workflow.doc-pipeline" });
// Document Generator scoping decisions (which of the tenant's real findings a
// document type is allowed to see) get their own channel, so a "why is this
// finding missing from the doc?" question is answerable from the logs without
// wading through the whole generation pipeline.
const scopeLog = logger.child({ channel: "engine.document-generator" });
// The cost plumbing gets the initiative's own channel, so "what did this
// document cost, and did we actually learn it?" is answerable from the logs
// without reading the generation pipeline's own noise.
const costLog = logger.child({ channel: "engine.ai-cost-governance" });

/**
 * A generation that made no model call. Zero here is a real, defensible zero —
 * `costStatus` is what makes it distinguishable from an unknown figure.
 */
const NO_AI_CALL_COST: DocumentCost = { costCents: 0, costStatus: "no-ai-call" };

/**
 * Output-token ceiling for the standalone narrative call (Git #556).
 *
 * DERIVED, not rounded up from the old 16,000. The derivation, in the order it
 * was actually done:
 *
 *   Measured ratio. The confirmed live truncation is the one real datapoint
 *   this codebase has: 16,000 output tokens rendered 47,235 characters of THIS
 *   document type's HTML. That is 2.95 characters per output token — HTML is
 *   token-dense, and a generic "4 chars per token" rule of thumb would have
 *   overstated the room a given ceiling buys by a third.
 *
 *   Structural worst case, from the real code and the real prompt bodies, in
 *   characters of model output:
 *     ~1,500   document scaffold the model emits (the style guide itself is
 *              prepended, not generated)
 *     ~1,200   section 1 Verdict — the prompt caps it: "keep this section
 *              tight, a short paragraph"
 *     ~2,500   section 2 Pillar status — six pillars, one line each, as HTML
 *     39,000   section 3 — `REMEDIATION_APPENDIX_MAX_FINDINGS` (15) is the hard
 *              cap on findings reaching the prompt, and #555 raised the per-
 *              finding ask from one sentence to four required elements (what is
 *              wrong, how many users/items, the cited POINT IMPACT value, what
 *              fixing it does to the score) — ~2,600 chars each with markup
 *     ~6,500   section 4 Path to clearance — re-walks the findings with a
 *              running point total, so it scales with the same 15
 *     ~8,000   the document type's own `sections` folded in on top of the four
 *     ─────
 *     ~58,700 chars  ->  ~19,900 output tokens at the measured ratio
 *
 * So 16,000 was short of the worst case by about a quarter, which is exactly
 * the failure that was observed. 32,000 is ~1.6x the derived worst case — one
 * further full findings section of headroom — and NOT the model's 128,000
 * ceiling, because `max_tokens` is the only hard bound on a runaway generation
 * and a document truncated at 96k characters is no more serviceable than one
 * truncated at 47k. The real safety is `assertOutputNotTruncated` below; this
 * number is a budget, not a guarantee.
 *
 * Two things make raising it cheap: output tokens bill on what is produced, not
 * on the ceiling requested, so an unused ceiling costs nothing; and this call
 * already streams (see the call site), so the SDK guidance against non-
 * streaming requests above ~16k does not apply here. It DOES apply to
 * `document-engine-sow.ts`, which is why that engine's ceiling is deliberately
 * different — see its own constant.
 */
const NARRATIVE_MAX_OUTPUT_TOKENS = 64000;

/**
 * Git #567 — the wall clock this generation is allowed, and the ONLY bound on
 * it.
 *
 * ── Why the call needed one at all ───────────────────────────────────────────
 * The paragraph directly above says the streaming transport lifts the SDK's
 * non-streaming ceiling. What it costs, verified against `@anthropic-ai/
 * sdk@0.78.0` rather than assumed, is every scrap of that SDK's timeout
 * protection: `fetchWithTimeout` clears its abort timer in a `finally` around
 * `await this.fetch(...)`, and for a streaming request that resolves when
 * response HEADERS arrive. `MessageStream` then adds no timer of its own, so
 * `finalMessage()` below waits on an SSE stream with no wall-clock bound
 * whatsoever. A stalled upstream leaves this document at `status='generating'`
 * until somebody clears the row by hand — which is what happened on
 * 2026-08-08. Full working in `ai-generation-deadline.ts`.
 *
 * ── The number ──────────────────────────────────────────────────────────────
 * Derived from this engine's own ceiling, not chosen: 64,000 output tokens at
 * an assumed FLOOR of 40 tokens/sec is 1,600s, plus a 120s allowance for
 * connection, prefill and time-to-first-token, plus 5s grace — about 28m45s.
 * `deriveGenerationDeadlineMs` owns that arithmetic so the deadline tracks
 * `NARRATIVE_MAX_OUTPUT_TOKENS` instead of being a second number to remember to
 * raise alongside it.
 *
 * It is deliberately, uncomfortably generous, and the discomfort is the trade
 * #567 asked for explicitly. This is a backstop against infinity, not a service
 * level: with thinking sharing the 64,000-token budget, a document that
 * genuinely runs to its ceiling can legitimately take a long time, and killing
 * one of those destroys real work and real spend for nothing — whereas being
 * slow to notice a stall costs only the delay before a `failed` row appears
 * where a hung one used to sit forever.
 *
 * Worth naming the apparent contradiction: 60e60628 called ~30 minutes an
 * unacceptable bound for the claim-binding audit and this lands in the same
 * neighbourhood. The number is similar and the justification is not. There, 30
 * minutes was three orders of magnitude of slack around a 4,000-token JSON
 * verdict that answers in seconds. Here it is roughly what a 64,000-token
 * document at the assumed throughput floor could actually need.
 */
const NARRATIVE_DEADLINE_MS = deriveGenerationDeadlineMs(NARRATIVE_MAX_OUTPUT_TOKENS);

/**
 * Git #559 — adaptive thinking on the narrative generation call.
 *
 * ── The defect this targets ──────────────────────────────────────────────────
 * Confirmed systematic, not flaky: five real Force-Regenerate runs of
 * `governance_maturity_report` against one tenant and one scan, and FOUR of the
 * five inverted the same finding — reporting "all 18 Teams have no owner" when
 * the stored `ownerlessTeamCount` is 0. Run 5 is the clean statement of the
 * mechanism: it prints the CORRECT raw number and then draws the opposite
 * conclusion from it in the same sentence — "The scan recorded an ownerless
 * Teams count of zero — meaning no Team currently has a designated owner".
 *
 * That is not fabrication. Every number involved is real and present in the
 * source data. What goes wrong is the BINDING: `{{profileSample}}` holds four
 * Teams-wide values equal to 18 and exactly one equal to 0, and since #558
 * (correctly) banned transcribing `ownerlessTeamCount: 0` verbatim, the model
 * has to carry that binding implicitly while re-expressing it in English. It
 * loses it, notices the resulting tension against the 0 still visible in its
 * input, and — with nowhere else to put the reconciliation — resolves it in the
 * visible prose, which is how a reader ends up with a confident wrong sentence.
 *
 * Thinking gives that reconciliation somewhere to happen other than the
 * document. It does not guarantee the model gets the binding right; it removes
 * the structural reason the wrong resolution had to be written down.
 *
 * ── Why `temperature: 0` is NOT set here ─────────────────────────────────────
 * #559 asked for temperature 0 alongside this. It cannot be, and on the
 * evidence it should not be:
 *
 *   1. They are mutually exclusive on this model. Sampling parameters are legal
 *      on `claude-sonnet-4-6` — but not while thinking is on: "On older models
 *      the restriction applies only while thinking is on: `temperature` and
 *      `top_k` are incompatible with thinking." Sending both returns 400, so
 *      this is a choice between the two, not a pair of independent knobs. (On
 *      the newer models `temperature` is rejected outright, thinking or not, so
 *      there is no model on which both could be set.)
 *
 *   2. Temperature 0 buys consistency, not correctness, and here the two point
 *      in opposite directions. At the default temperature the inversion rate is
 *      4-in-5 — the wrong binding is the DOMINANT mode, not a rare excursion.
 *      Greedy decoding selects the dominant mode. The most likely effect of
 *      temperature 0 on this specific defect is to raise the inversion rate
 *      from 80% to 100% and make it perfectly reproducible. It would have
 *      turned an intermittent wrong document into a reliable one.
 *
 * Temperature 0 is still the right setting for a near-deterministic factual
 * task — which is exactly why the #559 validator, whose job is mechanical
 * comparison and which needs no thinking, does set it. See
 * `document-claim-binding.ts`.
 *
 * ── Consequences that had to be handled with it ──────────────────────────────
 * Thinking is not a free parameter; three things move when it goes on:
 *
 *   - Thinking blocks come FIRST in `content`, so anything reading `content[0]`
 *     stops finding the document. `extractAiHtml` and #556's `readCharsProduced`
 *     now select the first TEXT block instead of block zero.
 *   - Thinking tokens count against `max_tokens` alongside the response text,
 *     so the ceiling had to move with it: 32,000 -> 64,000. The derivation
 *     behind 32,000 (above) is unchanged and still describes the DOCUMENT's
 *     worst case; the extra headroom is for the reasoning that now shares the
 *     budget. Unused ceiling costs nothing and the call already streams.
 *   - `stream.on("text")` fires only for text deltas, so the SSE relay shows
 *     the document, not the reasoning. That is the wanted behaviour and needed
 *     no change.
 */
const NARRATIVE_THINKING = { type: "adaptive" } as const;

/**
 * The effort level for the narrative call — the second half of the #559
 * thinking configuration, and the half that was missing.
 *
 * ── Why an explicit level was needed ────────────────────────────────────────
 * `NARRATIVE_THINKING` above turns adaptive thinking on and says nothing about
 * how much. Effort is not unset in that state, it is DEFAULTED: omitting it is
 * equivalent to `high`, the most expensive level available on this model. #559
 * asked for somewhere for the reconciliation to happen; it did not ask for the
 * deepest reasoning the model can produce on every routine document, and
 * leaving the default in place bought exactly that on every generation.
 *
 * ── The parameter shape, checked rather than assumed ────────────────────────
 * This was specified to this session as `{ type: "adaptive", effort: "medium" }`
 * — effort as a field on the thinking object. That shape does not exist. Read
 * against the installed SDK (`@anthropic-ai/sdk@0.78.0`) rather than from
 * memory:
 *
 *   - `ThinkingConfigAdaptive` is `{ type: 'adaptive' }` and has NO other
 *     field. An `effort` key there is a TypeScript error and an API 400.
 *   - Effort lives one level up, in `output_config`:
 *     `OutputConfig.effort?: 'low' | 'medium' | 'high' | 'max' | null`.
 *   - `output_config` is on `MessageCreateParamsBase`, from which
 *     `MessageStreamParams` derives, so it is valid on the streaming call this
 *     engine makes and not only on `messages.create`.
 *   - `'medium'` is in that union for this model. (`xhigh` is not — it arrived
 *     with a later model generation and is absent from this SDK's type.)
 *
 * So the requested setting is applied, in the position the API actually takes
 * it. Effort is GA on this model and needs no beta header, which is why this is
 * a plain `messages.stream` call and not `client.beta.messages.stream`.
 *
 * ── Why `medium` and not something lower ────────────────────────────────────
 * The defect #559 targets is a BINDING that has to be carried while the value
 * is re-expressed in English. That needs the reconciliation to have somewhere
 * to go — which is what thinking-on provides — not maximal deliberation, so the
 * documented balanced default is the right level here and the #559 mechanism is
 * unaffected. Lower would start trading against the thing thinking was turned
 * on to fix.
 *
 * Note this does NOT change `NARRATIVE_MAX_OUTPUT_TOKENS`: 64,000 is a ceiling,
 * output bills on what is produced, and less thinking simply uses less of it.
 */
const NARRATIVE_OUTPUT_CONFIG = { effort: "medium" } as const;

/**
 * Applies a document type's `includedSignalCategories` scoping to the tenant's
 * real findings. Shared by the dry-run and real-run branches so a preview can
 * never show a different finding set than the document that gets generated.
 *
 * Empty `includedSignalCategories` = no filter (all findings pass through) —
 * the SAME fallback convention `includedProfileKeyPatterns` already uses, so an
 * unconfigured document type behaves exactly as it did before this filter
 * existed.
 *
 * When categories ARE configured, an uncategorizable finding (`categories: []`
 * — every script-run finding, plus any monitor finding whose check feeds no
 * category-prefixed signal rule) is EXCLUDED, not passed through: the document
 * type has stated which categories it wants, and we cannot confirm an
 * unattributable finding belongs to one of them. Excluding is the honest
 * direction — a scoped document may be narrower than ideal, but it never
 * contains a finding the type didn't ask for.
 */
export function scopeFindingsBySignalCategory(
  categorizedFindings: CategorizedFinding[],
  allFindings: string[],
  includedSignalCategories: string[],
): string[] {
  if (includedSignalCategories.length === 0) return allFindings;
  return categorizedFindings
    .filter((f) => f.categories.some((c) => includedSignalCategories.includes(c)))
    .map((f) => f.text);
}

/**
 * Document types whose findings block gets the Secure-first/Invest-last
 * ordering (Git #550) — the two documents that read as an action plan
 * ("what should I fix, in what order") rather than a pillar deep-dive. Kept as
 * its own list, not folded into `COPILOT_GATE_DOC_TYPE_KEY`, because the two
 * concerns (which doc gets the real score vs which doc gets ordered findings)
 * are independent and #547 already established the one-key convention for the
 * former.
 */
const SECURE_FIRST_INVEST_LAST_DOC_TYPE_KEYS: ReadonlySet<string> = new Set([
  "copilot_readiness",
  "remediation_plan",
]);

/**
 * Git #550 — Secure-first, Invest-last. A real, deterministic sort, run here
 * in code before `{{findings}}` is assembled, rather than a prompt
 * instruction trusting the model to re-order consistently (the bug the issue
 * was filed about: a live document ranked a paid license-purchase suggestion
 * ahead of a free, critical "0 Conditional Access policies" fix).
 *
 * Two-tier, not a flat re-sort:
 *   Tier 1 — every finding NOT classified `license_gap`. Kept in the order
 *            `findingTexts` already arrives in (today's point-impact-derived
 *            ranking, untouched — see `scopeFindingsBySignalCategory`).
 *   Tier 2 — every finding classified `license_gap` (`CategorizedFinding
 *            .isLicenseGap`, Git #484-#488/#495's classification), in the
 *            SAME relative order among themselves. Always after every Tier 1
 *            item, regardless of its own point value — a license_gap finding
 *            requires a Microsoft purchase this platform does not resell, so
 *            it is never prioritized ahead of a free fix.
 *
 * A stable partition, not a comparator sort: within each tier nothing is
 * reordered relative to its neighbours, so this can never disagree with
 * whatever ranking already produced `findingTexts`' order — it only ever
 * moves Tier 2 items to the end.
 */
export function sortFindingsSecureFirstInvestLast(
  findingTexts: string[],
  categorizedFindings: CategorizedFinding[],
): string[] {
  const isLicenseGapByText = new Map(categorizedFindings.map((f) => [f.text, f.isLicenseGap]));
  const tier1: string[] = [];
  const tier2: string[] = [];
  for (const text of findingTexts) {
    (isLicenseGapByText.get(text) === true ? tier2 : tier1).push(text);
  }
  return tier2.length > 0 ? [...tier1, ...tier2] : findingTexts;
}

// ⚠️ TEMPORARY TESTING KILL-SWITCH — REMOVE BEFORE PRODUCTION ⚠️
// Intentionally duplicated from document-generator.ts's own local, non-exported
// flag of the same name rather than importing it — this file is the ground-up
// replacement for that module's standalone-document path and must not modify it.
// Keep this in sync with document-generator.ts's flag until the cutover happens.
const AI_KILL_SWITCH_ENABLED = false;

export interface GenerateDocumentParams {
  /**
   * The engine customer (`tenantsTable.id`) this document is generated FOR.
   * This is the PRIMARY identity of a generation request: every real input the
   * document is built from — the tenant profile, the findings, the MSP branding
   * — is customer-scoped, never user-scoped.
   *
   * Deliberately NOT a `users.id`. This function no longer translates a portal
   * user id into a customer id internally; a caller holding only a users.id
   * resolves it at its own boundary via `resolveCustomerIdForPortalUser()` and
   * passes the result here, and a caller that already knows the tenant (an admin
   * tenant picker, a tenant-scoped job) passes it straight through with no user
   * id involved at all.
   */
  mspCustomerId: number;
  projectId: number;
  docTypeKey: string;
  testMode?: boolean;
  dryRun?: boolean;
  /**
   * The `users.id` to stamp on the generated row's `customerId` FK (which is a
   * users.id-shaped column, not a customer id — see the schema).
   *
   * Optional. Callers entering from a real logged-in user pass theirs so the
   * document lands under exactly the login it did before this parameter existed;
   * omitted, it defaults to the customer's canonical document owner via
   * `resolveDocumentOwnerUserId()`. Reads of these documents are already
   * customer-scoped, so either way the whole customer can see the result.
   */
  documentOwnerUserId?: number;
  /** When provided, used directly instead of fetching the published prompt
   *  from ai_prompts — lets an admin test an unsaved draft prompt body
   *  against real AI/real data before publishing it. */
  promptOverride?: string;
  /**
   * Skips the drift gate and always generates fresh.
   *
   * Default `false`: a real (non-dry-run) generation first asks
   * `findReusableDocument()` whether this tenant already has a document of this
   * type that none of its data has moved since — and if so returns that document
   * without inserting a placeholder row or making an AI call at all. That guard
   * is the whole point of this parameter's existence: repeated "Generate" clicks
   * against an unchanged tenant were each paying for a fresh AI call to produce
   * the same document.
   *
   * `true` is for callers that know an input the drift gate cannot see has
   * changed — the Simulator's explicit regenerate override, an operator who
   * edited the prompt or the document type's scoping config, a re-run after a
   * bad generation. Request-level overrides (`promptOverride`) suppress reuse on
   * their own without needing this flag; see the gate at the top of the real
   * branch below.
   */
  forceRegenerate?: boolean;
  /**
   * Called with each incremental chunk of narrative text as the model writes
   * it, so a caller can relay generation to a watching operator instead of
   * showing a blank wait for a 16k-token document.
   *
   * Purely an observation tap on HOW the response arrives. It does not change
   * what is sent, how the profile/findings are scoped, or what the finished
   * document contains: the concatenation of every chunk is exactly the text of
   * the `finalMessage()` this function goes on to use, and the document is
   * still assembled from that final message, never from the accumulated chunks.
   * A type that omits this generates identically — just without the commentary.
   *
   * Never called on the dry-run branch (no model call happens there at all) or
   * on a drift-gate reuse (no model call either).
   *
   * A throwing callback must not be able to fail a generation that the model
   * already produced, so calls are made defensively — see the call site.
   */
  onTextDelta?: (text: string) => void;
}

/**
 * How the `costCents` on a generation result came to be — so a caller can tell
 * "this cost nothing because no model was called" apart from "we don't know
 * what this cost". Collapsing those two into a bare `0` is exactly the kind of
 * quietly-wrong billing figure this initiative exists to eliminate.
 */
export type DocumentCostStatus =
  /** A real AI call was made and the ledger reported its cost. `costCents` is that figure. */
  | "recorded"
  /** No AI call was made at all (dry run, or the drift gate reused a document). `costCents` is 0. */
  | "no-ai-call"
  /** An AI call was made but its usage row could not be read back. `costCents` is null. */
  | "unknown";

/** The cost half of a generation result, shared by both engines. */
export interface DocumentCost {
  /**
   * What this generation cost, in cents, taken from the `ai_usage_events` row
   * written for its own AI call — never recomputed here, so it cannot disagree
   * with what the MSP was billed.
   *
   * `0` only ever means "no model was called" (`costStatus: "no-ai-call"`).
   * `null` means the cost is genuinely unknown (`costStatus: "unknown"`).
   */
  costCents: number | null;
  costStatus: DocumentCostStatus;
}

export interface GenerateDocumentResult extends DocumentCost {
  documentId: number;
  htmlContent: string;
  docTypeKey: string;
  /**
   * True when this result is the drift gate handing back a prior document
   * (`findReusableDocument()` hit, no AI call made); false when this call
   * generated a fresh document. Git #548 — without this, an admin clicking
   * "Generate Now" after editing a prompt has no way to tell a served-stale
   * document apart from a freshly-written one without reading logs.
   */
  reused: boolean;
}

export interface DryRunDocumentResult extends DocumentCost {
  dryRun: true;
  docTypeKey: string;
  assembledPrompt: string;
  stylePrefix: string;
  scopedProfile: Record<string, unknown>;
  scopedFindings: string[];
  sectionText: string;
  promptKey: string;
  /**
   * The Remediation Detail appendix (#493) as it would be appended, for a
   * document type that has `remediationDetailAppendix` set. Absent for every
   * other type.
   *
   * Verified knowledge-base findings render exactly as they will in the real
   * document. Findings with NO verified entry render a neutral placeholder
   * instead of their AI fallback — a preview makes no model call, so generating
   * it here would both cost money and make this result's `no-ai-call` cost a
   * lie.
   */
  remediationAppendixHtml?: string;
}

/**
 * Turns the finding STRINGS the narrative prompt was given back into the
 * annotated findings the remediation appendix needs (#493).
 *
 * `scopeFindingsBySignalCategory()` returns plain strings — that is its locked
 * contract and this does not change it. The appendix needs each finding's
 * `checkKey` (to look up its verified knowledge-base row) plus its real
 * severity/item count/pillars, all of which `categorizedFindings` already
 * carries 1:1 with `findings`. Matching on the text is safe precisely because
 * of that 1:1 guarantee: both arrays are built from the same deduped list, in
 * the same order, by `buildTenantProfile()`.
 *
 * A finding string with no matching annotated row (which the 1:1 contract says
 * cannot happen, but is not worth crashing a document over) degrades to
 * "no check key" — i.e. it goes down the labelled AI-fallback path rather than
 * being dropped.
 */
function findingsToAppendixInput(
  categorizedFindings: CategorizedFinding[],
  findingTexts: string[],
): Array<{ text: string; checkKey: string | null; severity: string | null; itemCount: number | null; categories: string[] }> {
  const byText = new Map(categorizedFindings.map((f) => [f.text, f]));
  return findingTexts.map((text) => {
    const annotated = byText.get(text);
    return {
      text,
      checkKey: annotated?.checkKey ?? null,
      severity: annotated?.severity ?? null,
      itemCount: annotated?.itemCount ?? null,
      categories: annotated?.categories ?? [],
    };
  });
}

// ─── Profile scoping keys (Git #544) ─────────────────────────────────────────
//
// `included_profile_key_patterns` is matched against the NAMESPACED profile
// (`<checkKey>.<property>`, e.g. `devices:autopilot-coverage.displayName_count`)
// rather than the flat `mergedProfile`, because in the flat namespace 89 of the
// catalogue's 408 property names are produced by more than one check and the
// alphabetically-last check silently wins. A pattern naming a bare
// `displayName_count` cannot say which of 16 checks it meant; the namespaced
// form can only ever name one.
//
// CASE HANDLING is deliberately split, and this is the whole point of the
// design. `Object.assign` is case-SENSITIVE, so `Name_count` (4 checks) and
// `name_count` (3 checks) — and `State_*` / `state_*` — are genuinely
// DIFFERENT profile keys holding different values. The old matcher lower-cased
// both sides, so a pattern of `name*` fused both groups into one bucket in the
// prompt: a collision the merge itself never made. So:
//
//   • the check-key namespace (everything before the first ".") folds case —
//     `monitor_checks.key` is a lower-case `<domain>:<name>` vocabulary, so
//     folding it costs nothing and keeps a hand-typed pattern forgiving;
//   • the property segment is compared VERBATIM — that is where the real
//     case distinction lives, and fusing it is the bug.
//
// A pattern with no "." at all (e.g. `identity:*`) is entirely namespace and
// folds wholly, which is the same rule stated once.

/** Lower-cases only the check-key namespace segment. See the block comment above. */
function foldProfileKeyNamespace(value: string): string {
  const dot = value.indexOf(".");
  return dot === -1 ? value.toLowerCase() : value.slice(0, dot).toLowerCase() + value.slice(dot);
}

export function matchesProfilePattern(key: string, pattern: string): boolean {
  const foldedKey = foldProfileKeyNamespace(key);
  if (pattern.endsWith("*")) return foldedKey.startsWith(foldProfileKeyNamespace(pattern.slice(0, -1)));
  return foldedKey === foldProfileKeyNamespace(pattern);
}

/**
 * Flattens `buildTenantProfile().mergedProfileByCheck` into the sorted
 * `<checkKey>.<property>` entry list a document's `{{profileSample}}` and
 * `included_profile_key_patterns` both operate on. Sorted so two generations of
 * the same document from the same data produce a byte-identical prompt (the
 * drift gate and the AI response cache both depend on that).
 */
export function namespacedProfileEntries(byCheck: MergedProfileByCheck): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const checkKey of Object.keys(byCheck).sort()) {
    const props = byCheck[checkKey] ?? {};
    for (const propertyName of Object.keys(props).sort()) {
      // Git #2923: `_evidence` is the per-object capture behind a check's counts
      // — up to 50 real objects per count-family mapping rule, per check. It is
      // deliberately excluded here rather than left to the pattern filter,
      // because `scopeProfileEntries` returns EVERYTHING when a document type
      // has no `included_profile_key_patterns` (a real, current state for most
      // types), so including it would silently push hundreds of directory
      // objects per tenant into every such document's prompt. The counts these
      // objects back are still here, under their own targetFields, which is
      // what document prose is written against.
      if (propertyName === MONITOR_EVIDENCE_PROPERTY_KEY) continue;
      entries.push([namespacedProfileKey(checkKey, propertyName), props[propertyName]]);
    }
  }
  return entries;
}

/**
 * Applies a document type's patterns to the namespaced entries, and — because a
 * pattern that silently matches nothing looks exactly like a document with no
 * telemetry — says so out loud when one doesn't land.
 *
 * The two near-miss classes are named specifically, since both are what an
 * admin will actually hit while the 9 document types get their scoping written:
 * a legacy pattern still written against a bare flat key, and a pattern whose
 * case is wrong for the property segment (which no longer silently fuses).
 */
function scopeProfileEntries(
  entries: Array<[string, unknown]>,
  patterns: string[],
  logContext: Record<string, unknown>,
): Array<[string, unknown]> {
  if (patterns.length === 0) return entries;

  const unmatched = patterns.filter((p) => !entries.some(([k]) => matchesProfilePattern(k, p)));
  if (unmatched.length > 0) {
    const looksLegacyFlat = unmatched.filter((p) => !p.includes(".") && !p.includes(":"));
    const caseOnlyMisses = unmatched.filter((p) => {
      const literal = p.endsWith("*") ? p.slice(0, -1) : p;
      return entries.some(([k]) =>
        p.endsWith("*")
          ? k.toLowerCase().startsWith(literal.toLowerCase())
          : k.toLowerCase() === literal.toLowerCase());
    });
    scopeLog.warn(
      { ...logContext, unmatchedPatterns: unmatched, looksLegacyFlat, caseOnlyMisses, namespacedKeyCount: entries.length },
      "document-engine: includedProfileKeyPatterns entries matched nothing in the namespaced profile — patterns are now <checkKey>.<property> (Git #544), and the property segment is case-sensitive",
    );
  }

  return entries.filter(([k]) => patterns.some((p) => matchesProfilePattern(k, p)));
}

/**
 * Anti-fabrication rule for finding IDENTIFIERS, appended to every findings
 * block (Git #549).
 *
 * Observed live on a real `copilot_readiness` document: the model referred to a
 * finding as "COP-006". No such code exists anywhere in this platform — not in
 * `monitor_checks`, not in `severity_rules`, not in `tenant_monitor_profiles`.
 * It was invented, and it is the most dangerous class of fabrication a document
 * can carry: unlike a wrong number, an invented identifier LOOKS like a lookup
 * key, so a customer or engineer will try to trace it and find nothing.
 *
 * The prompt was not defending against this because nothing told it not to, and
 * the findings block hands it a numbered list — `1.`, `2.`, `3.` — which reads
 * as an ID scheme unless the ordinals are explicitly disclaimed. Both halves are
 * stated below.
 *
 * Lives in code beside the block it qualifies, not in the DB prompt bodies, for
 * the reason #547 already established: it then applies to every document type on
 * deploy and cannot be lost when one type's body is next republished. Individual
 * prompt bodies remain free to say more; none of them has to remember this.
 *
 * Git #554: the original wording above ("refer to a finding ... by the real
 * check key shown in parentheses ... nothing else") was itself the trap. It
 * told the model the check key IS the finding's identifier and gave no other
 * sanctioned way to refer to one, so when the model needed heading/title text
 * for a finding it reached for that "real" identifier — rendering raw keys
 * like `appgov:cert-secret-expiration` as headers instead of the authored
 * label #549 puts first in the same string. Confirmed live on tenant
 * c4c814d4-3afe-441e-9145-62461d0a4fd3: `{{findings}}` itself already carries
 * "<label> (<checkKey>)" per #549's WORDING CONTRACT
 * (deriveMonitorFindingsWithKeys, tenant-signals.ts) — this is a prompt-only
 * fix, not a findings-assembly bug. The rule now explicitly separates the two
 * uses: headings/titles must be written in the document author's own words
 * (or quote the finding's leading sentence), and the check key is named only
 * as an inline citation, never as heading text.
 */
const FINDING_IDENTIFIER_HONESTY_RULE =
  "\n\nIDENTIFIERS: Do NOT invent finding IDs, reference codes, ticket numbers, or any " +
  "numbering scheme (e.g. \"COP-006\", \"F-12\", \"SEC-3\"). No such codes exist in this " +
  "platform's data. Do NOT use a finding's check key (the identifier shown in parentheses " +
  "at the end of its line, e.g. \"appgov:cert-secret-expiration\") as a heading, title, or " +
  "subheading anywhere in the document — it is an internal system key, not customer-facing " +
  "text. Every heading or title for a finding must be written in your own words, or quote " +
  "the finding's own leading sentence (the text before the trailing parenthetical). The " +
  "check key may still be cited inline, in prose or a reference list, when you need to name " +
  "the specific finding you mean — nothing else. Do NOT invent a label to introduce it either " +
  "(e.g. \"check: appgov:cert-secret-expiration\", \"Check Key:\", \"Source:\") — those labels " +
  "are not this platform's data, they are internal field names you must never surface; work " +
  "the check key into a normal sentence instead. The list numbers above " +
  "are presentation order only; they are NOT identifiers and must not be cited as such.";

/**
 * Assembles `{{findings}}` — the numbered list, the anti-fabrication rule every
 * document type gets, and (Git #555) the real per-finding point values when the
 * platform has them.
 *
 * The point value goes on its OWN indented sub-line rather than being appended to
 * the finding's text. That placement is deliberate and coordinated with #554: the
 * identifier rule above describes the check key as "the identifier shown in
 * parentheses at the end of its line", and appending anything after it would make
 * that sentence false about the very block it qualifies. A sub-line also reads
 * unambiguously as an annotation rather than as part of the finding's own
 * sentence, so it cannot be quoted back as though the scan had said it.
 *
 * `pointImpacts` is null whenever the platform is not entitled to state values
 * (not this document type, no Copilot score, clamped score, engine unreachable) —
 * and then this produces exactly the block it produced before #555, so the
 * prompts' "where no point value is supplied" wording remains true rather than
 * vestigial.
 *
 * Pure, and the ONE definition both generation branches call — the dry-run
 * preview and the real generation cannot drift on what the model is handed.
 * Exported on the same terms as this file's other pure helpers.
 */
export function buildFindingsBlock(
  findingTexts: readonly string[],
  pointImpacts: FindingPointImpactResult | null,
): string {
  if (findingTexts.length === 0) {
    return "No findings were recorded for this client. Do NOT invent findings." + FINDING_IDENTIFIER_HONESTY_RULE;
  }
  const list = findingTexts
    .map((f, i) => {
      const numbered = `${i + 1}. ${f}`;
      return pointImpacts ? `${numbered}\n${formatFindingPointImpactLine(pointImpacts.perFinding[i])}` : numbered;
    })
    .join("\n");
  const body = pointImpacts ? `${buildFindingPointImpactPreamble(pointImpacts)}\n\n${list}` : list;
  return body + FINDING_IDENTIFIER_HONESTY_RULE;
}

/**
 * Document types that get real per-finding point values (Git #555). Deliberately
 * the SAME two as `SECURE_FIRST_INVEST_LAST_DOC_TYPE_KEYS` and deliberately a
 * separate constant: #550 established that these two are the only documents that
 * rank findings by point impact toward the go-live score (the other seven rank on
 * their own pillar-specific dimensions — exposure closed, seats recovered,
 * disruption caused — and a Copilot point value would be a number they never
 * asked for). The two lists agreeing today is a fact about the product, not a
 * shared definition; folding them into one would make the next divergence a
 * silent behaviour change in whichever feature did not intend it.
 */
const POINT_IMPACT_DOC_TYPE_KEYS: ReadonlySet<string> = new Set([
  "copilot_readiness",
  "remediation_plan",
]);

/**
 * The one document type whose entire premise is stating the tenant's real
 * go-live score. Git #547: this file had ZERO references to `copilot-gate.ts`,
 * so the score the platform had already computed never reached the model, and
 * the prompt's (correct) anti-fabrication rule surfaced as "Score pending from
 * the platform scan" on tenants whose scan was complete and whose score
 * existed. The bug was never the AI's — it was handed an empty hand and
 * answered honestly.
 *
 * Deliberately narrow: only this key gets the gate block. The other eight
 * document types make no go-live claim, so injecting a score into them would be
 * adding a number to a document that never asked for one.
 */
const COPILOT_GATE_DOC_TYPE_KEY = "copilot_readiness";

/**
 * The token a prompt body uses to place the gate block itself. When the live
 * `insights-consulting-copilot_readiness` body carries it the block lands
 * exactly where the prompt author put it; when it does not, the block is
 * APPENDED rather than dropped — see `injectCopilotGateBlock`.
 */
const COPILOT_GATE_TOKEN = /\{\{copilotGate\}\}/g;

/**
 * The Copilot Gate result rendered as literal ground-truth text for the prompt.
 *
 * This is the SOW `pricingFormula` treatment, not the `profileSample`
 * treatment, and that distinction is the whole point of #547: profile data is
 * telemetry the model reads and interprets, while this is a computed platform
 * verdict the model is only allowed to restate. So it is a directly-stated
 * fact, labelled as one, with an explicit instruction not to re-derive it.
 *
 * Both real cases are spelled out rather than collapsed into one hedge:
 *
 *   - `scored`        the real number, the real verdict against the real
 *                     threshold, and the real point gap.
 *   - `not_evaluated` the REAL reason the engine withheld a score (#517's
 *                     insufficient-coverage guard, a pillar nothing feeds, or
 *                     an engine failure), stated as such. Explicitly NOT
 *                     "pending", because "pending" tells a reader the scan has
 *                     not finished when it has — the exact false statement this
 *                     issue was filed about.
 *
 * Pure and exported so both generation branches and the tests share one
 * definition of what the model is told.
 */
export function buildCopilotGateBlock(gate: CopilotGateResult): string {
  const header =
    "COPILOT GO-LIVE SCORE — PLATFORM GROUND TRUTH\n"
    + "The lines below are the platform's own computed result for this tenant, produced by "
    + `the health engine's Copilot pillar (internal source key: ${gate.source}). They are `
    + "established fact, not telemetry for you to interpret. Restate the score, verdict, gap "
    + "and reasoning below in your own words. Do not recompute, re-derive, average, round, "
    + "estimate, soften or hedge any value in this block, and do not contradict it anywhere "
    + "in the document.\n"
    + "This source key, and the word \"source\" as a label, are for your own internal "
    + "calculation only — they identify where the platform got this number, not something the "
    + "reader is meant to see. Never print, quote, or cite them anywhere in the document, in "
    + "any form (e.g. \"Source: health_engine:copilot\", \"(source: ...)\", or similar).";

  if (gate.evaluation.status === "scored" && gate.score !== null && gate.status !== null) {
    const verdict = gate.status === "go"
      ? `GO — this tenant IS cleared to deploy Microsoft 365 Copilot (${gate.score} is at or above the Gate of ${gate.threshold}).`
      : `NO-GO — this tenant is NOT cleared to deploy Microsoft 365 Copilot (${gate.score} is below the Gate of ${gate.threshold}).`;
    // The gap is stated for the model rather than left to it: "82 minus 74" is
    // exactly the arithmetic the prompt forbids it from doing.
    const gap = gate.status === "go"
      ? `Margin above the Gate: ${gate.score - gate.threshold} point(s).`
      : `Points needed to clear the Gate: ${gate.threshold - gate.score}.`;
    return [
      header,
      "",
      `  Readiness score: ${gate.score} out of 100`,
      `  Copilot Gate threshold: ${gate.threshold}`,
      `  Verdict: ${verdict}`,
      `  ${gap}`,
      `  How this score was arrived at: ${gate.evaluation.reason}`,
      "",
      `This tenant HAS a readiness score, and it is ${gate.score}. Write that score and the `
      + "verdict above into the document exactly as given. Never write that the score is "
      + "pending, unavailable, or awaiting the scan — it is none of those things.",
    ].join("\n");
  }

  // Not scored. The honest reason, never a "pending" that implies an unfinished
  // scan. `evaluation.reason` is the engine's own machine-stable sentence, so it
  // is quoted rather than paraphrased and the document says what the platform
  // actually decided.
  return [
    header,
    "",
    "  Readiness score: NOT SCORED — the platform deliberately withheld a number for this tenant",
    `  Copilot Gate threshold: ${gate.threshold}`,
    "  Verdict: NO VERDICT ISSUED — the platform ruled this tenant neither GO nor NO-GO",
    `  Reason no score was issued: ${gate.evaluation.reason}`,
    `  Evaluable Copilot-impacting signals found for this tenant: ${gate.evaluation.evaluableSignalCount}`
    + ` (minimum required to score: ${gate.evaluation.minRequiredSignals})`,
    "",
    "State that reason, in those terms, as the explanation for the absent score. Do NOT write "
    + "that the score is \"pending\", \"still being calculated\", \"awaiting the scan\" or \"will "
    + "follow once the scan completes\" — the scan is not the blocker and saying so would be "
    + "false. The platform ran, and decided it does not have enough evaluable signal to issue a "
    + "defensible number. Do not supply a number of your own in its place, and do not call the "
    + "tenant a NO-GO — no verdict was issued. Name the blockers from the findings as normal.",
  ].join("\n");
}

/**
 * Places the gate block into an assembled prompt.
 *
 * Substitutes `{{copilotGate}}` where the prompt body carries it, and APPENDS
 * the block where it does not. The append path is not a nicety: the prompt body
 * lives in `ai_prompts`, is admin-editable, and is republished by a hand-run
 * manual migration, so there is a real window — and a real `promptOverride`
 * case — where the engine has the score but the live body has no slot for it.
 * Dropping it there would silently reproduce the exact bug #547 is about, on
 * the one document that cannot afford it.
 */
export function injectCopilotGateBlock(prompt: string, gate: CopilotGateResult): string {
  const block = buildCopilotGateBlock(gate);
  // `COPILOT_GATE_TOKEN` is /g, so `test()` advances `lastIndex` — reset around
  // it or every second call on the same module instance answers false.
  COPILOT_GATE_TOKEN.lastIndex = 0;
  const hasToken = COPILOT_GATE_TOKEN.test(prompt);
  COPILOT_GATE_TOKEN.lastIndex = 0;
  return hasToken ? prompt.replace(COPILOT_GATE_TOKEN, block) : `${prompt}\n\n${block}`;
}

/**
 * The gate for a `copilot_readiness` generation, or `null` for every other
 * document type.
 *
 * `computeCopilotGate` never throws — an unreachable engine degrades to a
 * `not_evaluated` result carrying that as its reason — so this needs no
 * try/catch of its own, and a document type that is not the score report never
 * pays for the engine call at all.
 *
 * Git #555: `evaluation` is the Copilot pillar evaluation the point-impact
 * resolver already computed for this same generation, handed straight through to
 * `computeCopilotGate` so the whole engine chain runs ONCE per document instead
 * of twice. It is a performance path only — and, more importantly, it is the
 * reason a document's cited point values and its stated score can never come
 * from two different engine runs, which is exactly the class of contradiction
 * #358 and #547 were both filed about. Absent (the resolver returned null, i.e.
 * there was no score to price findings against anyway) it falls back to the
 * engine call, so the gate block's own behaviour is unchanged either way.
 */
async function resolveCopilotGateForDocType(
  docTypeKey: string,
  mspCustomerId: number,
  evaluation?: PillarEvaluation | null,
): Promise<CopilotGateResult | null> {
  if (docTypeKey !== COPILOT_GATE_DOC_TYPE_KEY) return null;
  const gate = await computeCopilotGate(mspCustomerId, { evaluation: evaluation ?? undefined });
  log.info(
    {
      mspCustomerId,
      docTypeKey,
      score: gate.score,
      status: gate.status,
      threshold: gate.threshold,
      evaluationStatus: gate.evaluation.status,
    },
    "document-engine: injecting the real Copilot Gate result into the score report prompt (Git #547)",
  );
  return gate;
}

/**
 * Resolves the MSP branding (name + primary color) for an engine customer.
 * Shared by the dry-run and real branches so a preview can never be branded
 * differently from the document that gets generated.
 */
async function resolveMspBranding(mspCustomerId: number): Promise<{ mspId: number | null; mspName: string | null; mspPrimaryColor: string | null }> {
  const [customerRow] = await db
    .select({ mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, mspCustomerId))
    .limit(1);
  if (customerRow?.mspId == null) return { mspId: null, mspName: null, mspPrimaryColor: null };
  const [msp] = await db
    .select({ name: mspsTable.name, primaryColor: mspsTable.primaryColor })
    .from(mspsTable)
    .where(eq(mspsTable.id, customerRow.mspId))
    .limit(1);
  // `mspId` is returned alongside the branding because the remediation
  // appendix's AI fallback bills against it, and this is the one lookup the
  // engine already makes that knows it.
  return { mspId: customerRow.mspId, mspName: msp?.name ?? null, mspPrimaryColor: msp?.primaryColor ?? null };
}

export async function generateDocument(params: GenerateDocumentParams & { dryRun: true }): Promise<DryRunDocumentResult>;
export async function generateDocument(params: GenerateDocumentParams & { dryRun?: false }): Promise<GenerateDocumentResult>;
export async function generateDocument(params: GenerateDocumentParams): Promise<GenerateDocumentResult | DryRunDocumentResult> {
  const { mspCustomerId, projectId, docTypeKey, testMode = false } = params;

  const [docTypeRow] = await db.select().from(documentTypesTable).where(eq(documentTypesTable.key, docTypeKey)).limit(1);
  if (!docTypeRow) throw new Error(`document-engine: unknown document type "${docTypeKey}"`);
  if (docTypeRow.pipelineCategory === "pipeline_output") {
    throw new Error(`document-engine: "${docTypeKey}" is a pipeline_output type (e.g. SOW) — use the dedicated pipeline generation function once it exists, not generateDocument()`);
  }

  if (params.dryRun) {
    const { mspId, mspName, mspPrimaryColor } = await resolveMspBranding(mspCustomerId);

    const tenantProfile = await buildTenantProfile(mspCustomerId);
    // Namespaced, not flat (Git #544) — see the block comment on
    // matchesProfilePattern for why {{profileSample}} no longer reads the flat
    // mergedProfile, whose generic property names collide across 89 keys.
    const mergedProfileByCheck: MergedProfileByCheck = tenantProfile.mergedProfileByCheck;
    const findings: string[] = tenantProfile.findings;
    const categorizedFindings: CategorizedFinding[] = tenantProfile.categorizedFindings;
    const profilePatterns = docTypeRow.includedProfileKeyPatterns ?? [];
    const scopedProfileEntries = scopeProfileEntries(
      namespacedProfileEntries(mergedProfileByCheck),
      profilePatterns,
      { mspCustomerId, projectId, docTypeKey, dryRun: true },
    );
    const scopedProfile = Object.fromEntries(scopedProfileEntries);
    const signalCategories = docTypeRow.includedSignalCategories ?? [];
    let scopedFindings = scopeFindingsBySignalCategory(categorizedFindings, findings, signalCategories);
    if (signalCategories.length > 0) {
      scopeLog.info(
        {
          mspCustomerId, projectId, docTypeKey, dryRun: true,
          includedSignalCategories: signalCategories,
          findingsTotal: findings.length,
          findingsKept: scopedFindings.length,
          findingsUncategorizable: categorizedFindings.filter((f) => f.categories.length === 0).length,
        },
        "document-engine: findings scoped by includedSignalCategories (uncategorizable findings excluded)",
      );
    }
    // Git #550 — Secure-first, Invest-last, real-code ordering, so the preview
    // shows the exact order the real generation below will send.
    if (SECURE_FIRST_INVEST_LAST_DOC_TYPE_KEYS.has(docTypeKey)) {
      scopedFindings = sortFindingsSecureFirstInvestLast(scopedFindings, categorizedFindings);
    }

    const profileSample = scopedProfileEntries.length > 0
      ? scopedProfileEntries.map(([k, v]) => `  ${k}: ${String(v)}`).join("\n")
      : "  No configuration telemetry was captured for this client. Do NOT invent configuration values, counts, or settings.";

    const sectionText = docTypeRow.sections && docTypeRow.sections.length > 0
      ? docTypeRow.sections.map((s) => (s.guidance.trim() ? `${s.heading} (${s.guidance.trim()})` : s.heading)).join(", ")
      : (docTypeRow.sectionHints ?? "Include relevant sections for this type of deliverable");

    let promptKey = `insights-${docTypeRow.category}-${docTypeKey}`;
    if (docTypeRow.aiPromptId != null) {
      const [promptRow] = await db.select({ key: aiPromptsTable.key }).from(aiPromptsTable).where(eq(aiPromptsTable.id, docTypeRow.aiPromptId)).limit(1);
      if (promptRow?.key) promptKey = promptRow.key;
    }
    const rawTemplate = params.promptOverride ?? await getPrompt(promptKey, "Generate a professional HTML document covering: {{sections}}\n\nTenant data:\n{{profileSample}}\n\nFindings:\n{{findings}}");

    const findingsForPrompt = scopedFindings.slice(0, REMEDIATION_APPENDIX_MAX_FINDINGS);
    // Built once and shared with the remediation appendix below — it is the same
    // 1:1 text→checkKey join both need, and resolving it twice invites the two
    // disagreeing about which check a finding came from.
    const findingsWithMeta = findingsToAppendixInput(categorizedFindings, findingsForPrompt);
    // Git #555 — real per-finding point values, for the two point-ranked document
    // types only. Never throws and returns null when the platform has no score to
    // price against, in which case the block below is byte-identical to pre-#555.
    const pointImpacts = POINT_IMPACT_DOC_TYPE_KEYS.has(docTypeKey)
      ? await computeFindingPointImpacts(mspCustomerId, findingsWithMeta.map((f) => f.checkKey))
      : null;
    const findingsBlock = buildFindingsBlock(findingsForPrompt, pointImpacts);

    const wantsRemediationAppendix = docTypeRow.remediationDetailAppendix === true;

    // Git #547 — the real go-live score, for `copilot_readiness` only. Resolved
    // here, on the same terms as the real branch below, so the preview shows the
    // prompt that will actually be sent rather than one missing its ground truth.
    const copilotGate = await resolveCopilotGateForDocType(docTypeKey, mspCustomerId, pointImpacts?.evaluation);

    const substitutedTemplate = rawTemplate
      .replace(/\{\{sections\}\}/g, sectionText)
      .replace(/\{\{profileSample\}\}/g, profileSample)
      .replace(/\{\{findings\}\}/g, findingsBlock)
      .replace(/\{\{docLabel\}\}/g, docTypeRow.label)
      .replace(/\{\{mspName\}\}/g, mspName ?? "Shane McCaw Consulting")
      .replace(/\{\{mspPrimaryColor\}\}/g, mspPrimaryColor ?? "#1a73e8");

    const assembledPrompt =
      (copilotGate ? injectCopilotGateBlock(substitutedTemplate, copilotGate) : substitutedTemplate)
      // Same suffix, same condition as the real branch below — the preview must
      // show the prompt that will actually be sent, not a shorter one.
      + (wantsRemediationAppendix ? REMEDIATION_APPENDIX_PROMPT_SUFFIX : "");

    const stylePrefix = await getDocumentStylePrefix();

    // Preview of the appendix, built with the AI fallback DISABLED: verified
    // knowledge-base entries render exactly as they will, uncovered findings get
    // a placeholder. Still no model call, so NO_AI_CALL_COST below stays true.
    const remediationAppendixHtml = wantsRemediationAppendix
      ? (await buildRemediationAppendix({
          findings: findingsWithMeta,
          mspCustomerId,
          mspId,
          docTypeKey,
          allowAiFallback: false,
          triggerSource: "document-engine:dry-run",
        })).html
      : undefined;

    log.info({ mspCustomerId, projectId, docTypeKey }, "document-engine: dry-run preview assembled (no AI call, no DB write)");

    // A preview assembles the prompt and stops — no model call, so the honest
    // figure is a real zero, marked `no-ai-call` so it can never be read as
    // "the AI ran and happened to be free".
    return {
      dryRun: true, docTypeKey, assembledPrompt, stylePrefix, scopedProfile, scopedFindings, sectionText, promptKey,
      ...(remediationAppendixHtml !== undefined ? { remediationAppendixHtml } : {}),
      ...NO_AI_CALL_COST,
    };
  }

  // ── Drift gate (cost overrun guard) ───────────────────────────────────────
  // Real generation only — the dry-run branch above returns before reaching
  // here, so preview behavior is untouched by this and never consults the gate.
  //
  // `promptOverride` suppresses reuse regardless of `forceRegenerate`: the
  // override is a property of THIS request (an admin testing an unsaved draft
  // prompt body), and the drift gate can only see whether the tenant's DATA
  // moved. Reusing here would hand the admin a document generated from the
  // PUBLISHED prompt and let them believe their draft produced it — a silently
  // wrong answer, and the exact case the gate cannot detect for itself.
  const reuseSuppressedByOverride = params.promptOverride != null;
  if (!params.forceRegenerate && !reuseSuppressedByOverride) {
    const reusable = await findReusableDocument(mspCustomerId, docTypeKey);
    if (reusable) {
      log.info(
        { mspCustomerId, projectId, docTypeKey, documentId: reusable.documentId },
        "document-engine: reusing existing document, no drift detected, no AI call made",
      );
      // Reuse is the drift gate doing its job: this request made no AI call, so
      // it cost nothing. The ORIGINAL document's cost is not this call's cost
      // and is deliberately not reported here — it lives in the ledger against
      // the generation that actually incurred it.
      return { ...reusable, ...NO_AI_CALL_COST, reused: true };
    }
  } else {
    log.info(
      { mspCustomerId, projectId, docTypeKey, forceRegenerate: params.forceRegenerate === true, reuseSuppressedByOverride },
      "document-engine: drift gate skipped — generating fresh",
    );
  }

  // `insights_generated_documents.customerId` is a users.id-shaped FK, so the
  // customer-first request still has to name a document owner. An explicit
  // documentOwnerUserId from the caller wins (ownership stays exactly what it
  // was for user-entry-point callers); otherwise the customer's canonical owner
  // is resolved. Null is a legal value here (the FK is nullable) and only
  // happens for a customer with no linked portal user at all.
  const documentOwnerUserId = params.documentOwnerUserId ?? await resolveDocumentOwnerUserId(mspCustomerId);

  // Insert a "generating" placeholder immediately so the UI has something real
  // to poll/display before the (potentially multi-minute) AI call even starts.
  const [placeholderRow] = await db.insert(insightsGeneratedDocumentsTable).values({
    // The real scoping key. This engine is tenant-first (Phase 8), so the
    // customer is the function's own required param — nothing to resolve here.
    mspCustomerId,
    customerId: documentOwnerUserId,
    // "No project selected" reaches this engine as the caller's `0` sentinel
    // (the admin route defaults an absent/NaN projectId to 0). `project_id` is
    // a real FK to `projects.id`, whose serial starts at 1, so there is no id=0
    // row to point at and writing the sentinel through is a foreign-key
    // violation — this insert was the one actually returning 500 on every
    // generate-without-a-project. NULL is the legal representation.
    projectId: projectId || null,
    category: docTypeRow.category,
    docType: docTypeKey,
    title: docTypeRow.label,
    htmlContent: "",
    status: "generating",
  }).returning({ id: insightsGeneratedDocumentsTable.id });
  const documentId = placeholderRow.id;

  try {
    // Resolve real MSP branding
    const { mspId, mspName, mspPrimaryColor } = await resolveMspBranding(mspCustomerId);

    // Real tenant profile + scoping
    const tenantProfile = await buildTenantProfile(mspCustomerId);
    // Namespaced, not flat (Git #544) — same reasoning as the dry-run branch.
    const mergedProfileByCheck: MergedProfileByCheck = tenantProfile.mergedProfileByCheck;
    const findings: string[] = tenantProfile.findings;
    const categorizedFindings: CategorizedFinding[] = tenantProfile.categorizedFindings;
    const profilePatterns = docTypeRow.includedProfileKeyPatterns ?? [];
    const scopedProfileEntries = scopeProfileEntries(
      namespacedProfileEntries(mergedProfileByCheck),
      profilePatterns,
      { mspCustomerId, projectId, docTypeKey, documentId, dryRun: false },
    );
    const scopedProfile = Object.fromEntries(scopedProfileEntries);
    // `includedSignalCategories` is now honored (was stored-but-unused): a
    // finding is kept when the check that produced it feeds a signal rule in one
    // of the requested categories. Empty list = no filter, same convention as
    // includedProfileKeyPatterns above.
    //
    // Standing limitation, not a TODO: script-run findings
    // (script_run_results.parsedFindings) carry no checkKey, so they can never
    // be categorized and are excluded whenever a category filter is set. See
    // buildTenantProfile()'s categorizedFindings doc comment for why that data
    // does not exist to be recovered.
    const signalCategories = docTypeRow.includedSignalCategories ?? [];
    let scopedFindings = scopeFindingsBySignalCategory(categorizedFindings, findings, signalCategories);
    if (signalCategories.length > 0) {
      scopeLog.info(
        {
          mspCustomerId, projectId, docTypeKey, documentId, dryRun: false,
          includedSignalCategories: signalCategories,
          findingsTotal: findings.length,
          findingsKept: scopedFindings.length,
          findingsUncategorizable: categorizedFindings.filter((f) => f.categories.length === 0).length,
        },
        "document-engine: findings scoped by includedSignalCategories (uncategorizable findings excluded)",
      );
    }
    // Git #550 — Secure-first, Invest-last, same real-code ordering as the
    // dry-run branch, so a preview can never disagree with the generated
    // document on finding order.
    if (SECURE_FIRST_INVEST_LAST_DOC_TYPE_KEYS.has(docTypeKey)) {
      scopedFindings = sortFindingsSecureFirstInvestLast(scopedFindings, categorizedFindings);
    }

    const profileSample = scopedProfileEntries.length > 0
      ? scopedProfileEntries.map(([k, v]) => `  ${k}: ${String(v)}`).join("\n")
      : "  No configuration telemetry was captured for this client. Do NOT invent configuration values, counts, or settings.";

    // Resolve section structure — structured sections take priority over legacy sectionHints
    const sectionText = docTypeRow.sections && docTypeRow.sections.length > 0
      ? docTypeRow.sections.map((s) => (s.guidance.trim() ? `${s.heading} (${s.guidance.trim()})` : s.heading)).join(", ")
      : (docTypeRow.sectionHints ?? "Include relevant sections for this type of deliverable");

    // Resolve the real, admin-editable prompt via the FK
    let promptKey = `insights-${docTypeRow.category}-${docTypeKey}`;
    if (docTypeRow.aiPromptId != null) {
      const [promptRow] = await db.select({ key: aiPromptsTable.key }).from(aiPromptsTable).where(eq(aiPromptsTable.id, docTypeRow.aiPromptId)).limit(1);
      if (promptRow?.key) promptKey = promptRow.key;
    }
    const rawTemplate = params.promptOverride ?? await getPrompt(promptKey, "Generate a professional HTML document covering: {{sections}}\n\nTenant data:\n{{profileSample}}\n\nFindings:\n{{findings}}");

    const findingsForPrompt = scopedFindings.slice(0, REMEDIATION_APPENDIX_MAX_FINDINGS);
    // Same single join, same reason, as the dry-run branch above.
    const findingsWithMeta = findingsToAppendixInput(categorizedFindings, findingsForPrompt);
    // Git #555 — real per-finding point values. Same call, same placement and same
    // null-means-unpriced contract as the dry-run branch, so a preview can never
    // disagree with the document that gets generated.
    const pointImpacts = POINT_IMPACT_DOC_TYPE_KEYS.has(docTypeKey)
      ? await computeFindingPointImpacts(mspCustomerId, findingsWithMeta.map((f) => f.checkKey))
      : null;
    const findingsBlock = buildFindingsBlock(findingsForPrompt, pointImpacts);

    const wantsRemediationAppendix = docTypeRow.remediationDetailAppendix === true;

    // Git #547 — the real go-live score, for `copilot_readiness` only. Same call
    // and same placement as the dry-run branch, so a preview can never disagree
    // with the document that gets generated.
    const copilotGate = await resolveCopilotGateForDocType(docTypeKey, mspCustomerId, pointImpacts?.evaluation);

    const substitutedTemplate = rawTemplate
      .replace(/\{\{sections\}\}/g, sectionText)
      .replace(/\{\{profileSample\}\}/g, profileSample)
      .replace(/\{\{findings\}\}/g, findingsBlock)
      .replace(/\{\{docLabel\}\}/g, docTypeRow.label)
      .replace(/\{\{mspName\}\}/g, mspName ?? "Shane McCaw Consulting")
      .replace(/\{\{mspPrimaryColor\}\}/g, mspPrimaryColor ?? "#1a73e8");

    const prompt =
      (copilotGate ? injectCopilotGateBlock(substitutedTemplate, copilotGate) : substitutedTemplate)
      // Told to the model, not just to the appendix (#493): labelling the
      // appendix's AI content is worth nothing if the narrative above it is
      // free to invent its own unlabelled PowerShell in the same document.
      + (wantsRemediationAppendix ? REMEDIATION_APPENDIX_PROMPT_SUFFIX : "");

    const stylePrefix = await getDocumentStylePrefix();

    if (AI_KILL_SWITCH_ENABLED) {
      throw new Error("AI generation disabled by testing kill-switch (document-engine.ts)");
    }

    // Refines whatever attribution the caller already established (e.g.
    // workflow-executor.ts's aiAttributionFor()) with the fields only this
    // engine knows — the customer this document is FOR and the artifact it
    // produces. Nested withAiAttribution shallow-merges, so a caller's
    // mspId/nodeType/runId survive alongside these.
    // `withAiUsageCapture` is `withAiAttribution` plus a read-back of what the
    // sink persisted for the call — the same `ai_usage_events` row this call
    // created. The cost is taken from that row, never recomputed here: a second
    // calculation could drift from what the MSP was actually charged.
    const { result: aiResponse, costs } = await withAiUsageCapture(
      {
        customerId: mspCustomerId,
        generatedArtifactType: docTypeKey,
        generatedArtifactName: docTypeRow.label,
        generatedArtifactId: String(documentId),
        triggerSource: "document-engine",
      },
      // Streamed rather than awaited whole, so a watching operator sees the
      // document being written instead of staring at a spinner for a 16k-token
      // response. This is a TRANSPORT change only: identical params go out, and
      // `finalMessage()` resolves to the same complete `Message` shape
      // `messages.create()` returned, so `extractAiHtml()` below is unchanged
      // and the finished document is byte-identical either way.
      //
      // Cost capture is unaffected and needed no rework: `meterAnthropicClient`
      // taps the CLIENT, not this function's return value, and already meters
      // `messages.stream` explicitly — it registers the capture slot
      // synchronously at call time and reads real token counts off a
      // non-consuming `finalMessage` listener. The one requirement it imposes is
      // honoured here: the stream is awaited to completion INSIDE the capture
      // scope, so the slot settles before `withAiUsageCapture` stops waiting on
      // it. Returning the un-awaited stream would report the cost as
      // `unrecorded` at the settle timeout.
      async () => {
        const stream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: NARRATIVE_MAX_OUTPUT_TOKENS,
          // Git #559 — see NARRATIVE_THINKING for why this is on, and why
          // `temperature` is deliberately NOT set alongside it.
          thinking: NARRATIVE_THINKING,
          // The depth that thinking runs at. Explicit because omitting it means
          // `high`, not "unset" — see NARRATIVE_OUTPUT_CONFIG, which also
          // records why the effort level lives HERE and not on `thinking`.
          output_config: NARRATIVE_OUTPUT_CONFIG,
          messages: [{ role: "user", content: stylePrefix + prompt }],
        });
        const { onTextDelta } = params;
        if (onTextDelta) {
          stream.on("text", (text: string) => {
            // A relay fault (a closed SSE socket, a client that hung up) must
            // never destroy a document the model has already been paid to
            // write. Observation only — swallow and keep streaming.
            try {
              onTextDelta(text);
            } catch (err) {
              scopeLog.warn(
                { err, mspCustomerId, documentId, docTypeKey },
                "document-engine: onTextDelta relay threw; generation continues (the document is built from finalMessage, not from the relayed chunks)",
              );
            }
          });
        }
        // Git #567 — the wall clock, and the only one this call has. The
        // stream was created a few statements above, synchronously, so the
        // deadline started with the request rather than after it: everything
        // between those two points is listener wiring, no awaits.
        //
        // Raced INSIDE the capture scope on purpose. The metering contract
        // noted above is that the stream is awaited to completion here, and a
        // deadline that released the caller from outside `withAiUsageCapture`
        // would satisfy the timeout and break that. On the timeout path
        // `withAiUsageCapture` rejects at the `await` on its callback, before
        // it waits on any slot, so a metering slot that can no longer settle
        // cannot reintroduce the hang this is fixing.
        //
        // Consequence worth stating rather than discovering later: the
        // metering tap settles on the stream's `finalMessage`/`error` events,
        // and `abort()` emits neither (the SDK routes an abort to its own
        // `abort` event), so a timed-out generation writes no `ai_usage_events`
        // row for whatever it burned before stalling. That is not a regression
        // — today's hang writes no row either, forever — but it is a real gap,
        // and it belongs to the shared metering tap, not to this engine.
        return await runGenerationWithDeadline(
          {
            run: () => stream.finalMessage(),
            // With no SDK timer left to release the socket on a stream, the
            // deadline has to do it, or a stalled generation keeps its
            // connection and its upstream billing running after we walk away.
            abort: () => stream.abort(),
          },
          {
            docTypeKey,
            deadlineMs: NARRATIVE_DEADLINE_MS,
            maxTokens: NARRATIVE_MAX_OUTPUT_TOKENS,
            documentId,
            mspCustomerId,
            source: "document-engine",
          },
          // The generation channel, same as the truncation guard below: "did
          // this document come back at all?" is the same kind of fact as "did
          // it come back whole?", and an operator chasing one wants the other
          // in the same stream.
          log,
        );
      },
    );

    // Git #556 — before ANYTHING reads the content. `finalMessage()` resolves to
    // the same complete `Message` a `create()` would have, `stop_reason` and all;
    // streaming is a transport, not a truncation check, so this path needed the
    // guard exactly as much as a non-streaming one would.
    //
    // Placed ahead of the cost plumbing and the remediation appendix on purpose:
    // there is no reason to pay for an appendix to a document that will not be
    // saved. The narrative's own spend is NOT lost by throwing here — the
    // `ai_usage_events` row is written by the metering tap on the client, which
    // has already run, so the ledger keeps the charge even though the document
    // does not survive.
    assertOutputNotTruncated(
      aiResponse,
      {
        docTypeKey,
        maxTokens: NARRATIVE_MAX_OUTPUT_TOKENS,
        documentId,
        mspCustomerId,
        source: "document-engine",
      },
      // The generation pipeline's own channel, not the cost one: "did this
      // document come back whole?" is a generation fact. `engine.ai-cost-
      // governance` answers what it cost, which is a separate question and is
      // still answered by the lines below on the surviving path.
      log,
    );

    const capturedCostCents = totalCapturedCostCents(costs);
    let cost: DocumentCost = capturedCostCents == null
      ? { costCents: null, costStatus: "unknown" }
      : { costCents: capturedCostCents, costStatus: "recorded" };

    // ── Claim/source binding validation (#559) ────────────────────────────────
    // Confirmed systematic: 4 of 5 real regenerations of the same document
    // against the same scan inverted the same finding — stating that all 18
    // Teams are ownerless when `ownerlessTeamCount` is 0. See
    // document-claim-binding.ts for why this is a model call and why a numeric
    // spot-check would have passed every one of those four documents.
    //
    // Placed HERE, deliberately, on both sides:
    //   - AFTER `assertOutputNotTruncated`, because there is no sense auditing
    //     the claims in a document that is already going to be rejected for
    //     being cut off (and a truncated document would generate spurious
    //     mismatches from half-written sentences).
    //   - BEFORE the remediation appendix, for the reason #556 gave: a document
    //     that will not be saved must not go on to buy more AI calls.
    //
    // Its own spend is captured exactly as the appendix's is — its own
    // `withAiUsageCapture` scope, its cost ADDED to this document's. The audit
    // is real Anthropic spend for this customer, and a document whose reported
    // cost counted the narrative but not the audit that gated it would be the
    // same quietly-wrong figure the cost plumbing exists to eliminate.
    const narrativeHtml = extractAiHtml(aiResponse);
    const { costs: bindingCosts } = await withAiUsageCapture(
      {
        customerId: mspCustomerId,
        generatedArtifactType: docTypeKey,
        generatedArtifactName: docTypeRow.label,
        generatedArtifactId: String(documentId),
        triggerSource: "document-engine:claim-binding-audit",
      },
      () =>
        assertClaimBindingsConsistent(
          {
            documentHtml: narrativeHtml,
            // The SAME strings the generator was given, not a re-derivation.
            // An audit run against a second assembly of the source data would
            // be checking the document against something the model never saw.
            source: { profileSample, findings: findingsBlock },
            ctx: { docTypeKey, documentId, mspCustomerId, source: "document-engine" },
          },
          // The generation pipeline's own channel, matching #556: "does this
          // document agree with its data?" is a generation fact.
          log,
          async (auditPrompt) => {
            // Not streamed: nothing watches this, and it returns a short JSON
            // verdict rather than a document. `temperature: 0` is legal here
            // precisely because this call sets no `thinking` — see that
            // constant's own note for why the narrative call cannot have both.
            //
            // The second argument is the fix for the observed hang, and it is
            // the INNER half of it: the SDK's own 10-minute default (x3 with
            // default retries) is what let one of these sit for 13.7+ minutes
            // with the document pinned at `generating`. `maxRetries: 0` because
            // `assertClaimBindingsConsistent` races this against a hard
            // deadline — a retry could not finish inside that window, so
            // leaving retries on would only buy answers nobody can use, on the
            // customer's token spend. Full derivation of both numbers is on
            // `CLAIM_BINDING_AUDIT_TIMEOUT_MS`.
            const audit = await anthropic.messages.create(
              {
                model: CLAIM_BINDING_AUDIT_MODEL,
                max_tokens: CLAIM_BINDING_AUDIT_MAX_TOKENS,
                temperature: CLAIM_BINDING_AUDIT_TEMPERATURE,
                messages: [{ role: "user", content: auditPrompt }],
              },
              { timeout: CLAIM_BINDING_AUDIT_TIMEOUT_MS, maxRetries: 0 },
            );
            return firstTextBlock(audit) ?? "";
          },
        ),
    );
    const bindingCostStatuses = bindingCosts.map((c) => c.status);
    if (bindingCosts.length > 0) {
      const bindingCostCents = totalCapturedCostCents(bindingCosts);
      cost = bindingCostCents == null || cost.costCents == null
        ? { costCents: null, costStatus: "unknown" }
        : { costCents: cost.costCents + bindingCostCents, costStatus: "recorded" };
    }

    // ── Remediation Detail appendix (#493) ────────────────────────────────────
    // Verified `remediation_knowledge_base` content per finding where it exists
    // (no model call at all for those); the existing AI generator, under an
    // explicit "verify before running" banner, only where it doesn't.
    //
    // Built in its OWN usage-capture scope, and its cost ADDED to this
    // document's: the fallback calls are real Anthropic spend attributed to this
    // customer, and reporting only the narrative's cost would understate the
    // document. `withAiUsageCapture` scopes by AsyncLocalStorage, so a second
    // sequential (never nested) scope collects exactly its own calls.
    let appendixHtml = "";
    // Hoisted so the cost log below reports every call the document made, not
    // just the narrative's — an "unknown cost" warning that names one call when
    // sixteen were made is the same class of quietly-wrong figure this cost
    // plumbing exists to eliminate.
    let appendixCostStatuses: string[] = [];
    if (wantsRemediationAppendix) {
      const { result: appendix, costs: appendixCosts } = await withAiUsageCapture(
        {
          customerId: mspCustomerId,
          generatedArtifactType: docTypeKey,
          generatedArtifactName: docTypeRow.label,
          generatedArtifactId: String(documentId),
          triggerSource: "document-engine:remediation-appendix",
        },
        () =>
          buildRemediationAppendix({
            findings: findingsWithMeta,
            mspCustomerId,
            mspId,
            docTypeKey,
            allowAiFallback: true,
            triggerSource: "document-engine:remediation-appendix",
          }),
      );
      appendixHtml = appendix.html;
      appendixCostStatuses = appendixCosts.map((c) => c.status);

      if (appendixCosts.length > 0) {
        const appendixCostCents = totalCapturedCostCents(appendixCosts);
        cost = appendixCostCents == null || cost.costCents == null
          ? { costCents: null, costStatus: "unknown" }
          : { costCents: cost.costCents + appendixCostCents, costStatus: "recorded" };
      }

      // Provenance is a per-document audit fact, not a debug detail: "how much of
      // what this customer was told to run had actually been verified" has to be
      // answerable after the fact, from the logs, for any document already sent.
      scopeLog.info(
        {
          mspCustomerId, documentId, docTypeKey,
          verifiedCount: appendix.verifiedCount,
          aiGeneratedCount: appendix.aiGeneratedCount,
          failedCount: appendix.failedCount,
          truncatedCount: appendix.truncatedCount,
          uncoveredCheckKeys: appendix.uncoveredCheckKeys,
        },
        "document-engine: remediation detail appendix appended (verified knowledge-base content vs labelled AI fallback)",
      );
    }

    if (cost.costStatus === "unknown") {
      // Usage recording is deliberately non-fatal, so this is a real and
      // expected state — but it is "we don't know", not "it was free".
      costLog.warn(
        {
          mspCustomerId, documentId, docTypeKey,
          callsCaptured: costs.length + bindingCostStatuses.length + appendixCostStatuses.length,
          statuses: [...costs.map((c) => c.status), ...bindingCostStatuses, ...appendixCostStatuses],
        },
        "ai-cost-governance: document generated but its usage row could not be read back — cost reported as unknown, not zero",
      );
    } else {
      costLog.info(
        { mspCustomerId, documentId, docTypeKey, costCents: cost.costCents },
        "ai-cost-governance: document generation cost resolved from its ai_usage_events row",
      );
    }

    // The appendix is appended, never interleaved: the narrative is one AI
    // artifact with one provenance, and each appendix block states its own.
    // `narrativeHtml` rather than a second `extractAiHtml(aiResponse)` call: the
    // bytes that get saved must be the exact bytes the #559 audit above passed.
    const htmlContent = narrativeHtml + appendixHtml;

    await db.update(insightsGeneratedDocumentsTable)
      .set({
        title: docTypeRow.label,
        htmlContent,
        status: testMode ? "draft" : "approved",
        generationInput: { scopedProfile, scopedFindings },
        updatedAt: new Date(),
      })
      .where(eq(insightsGeneratedDocumentsTable.id, documentId));

    log.info(
      { mspCustomerId, documentOwnerUserId, projectId, documentId, docTypeKey, testMode },
      "document-engine: standalone document generated",
    );

    void generateOmgCardsFromTelemetry(documentId).catch((err) => {
      log.warn({ err, documentId }, "document-engine: OMG card generation failed (non-fatal)");
    });

    return { documentId, htmlContent, docTypeKey, ...cost, reused: false };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.update(insightsGeneratedDocumentsTable)
      .set({ status: "failed", errorMessage: errMsg.slice(0, 500), updatedAt: new Date() })
      .where(eq(insightsGeneratedDocumentsTable.id, documentId));
    throw err;
  }
}
