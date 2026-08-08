import {
  db,
  aiPromptsTable,
  documentTypesTable,
  insightsGeneratedDocumentsTable,
  tenantsTable,
  quickWinPresentationsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { anthropic, withAiUsageCapture, totalCapturedCostCents } from "@workspace/integrations-anthropic-ai";
import { getDocumentStylePrefix, getPrompt, getSowPricingFormulaBlock } from "./prompt-loader";
import { extractAiHtml, firstTextBlock } from "./sow-pricing";
// Git #556 — same guard as the standalone engine. See ai-output-ceiling.ts.
import { assertOutputNotTruncated } from "./ai-output-ceiling";
// Git #560 — the SOW half of #559. A separate module from
// `document-claim-binding.ts` because a SOW's claims are PRICING LINES against
// a structured engine-authoritative table, not prose against `{{profileSample}}`;
// see that file's header for why the question had to change with the shape.
// Same properties as the guard above: pure, engine-free, SDK-free, injected
// model call.
import {
  assertSowClaimBindingsConsistent,
  type SowPricedLine,
} from "./sow-claim-binding";
// The audit call's model, ceiling and temperature are #559's constants rather
// than new ones: both gates run the same second look on the same model for the
// same reason, and duplicating the model string across two files is how they
// would silently drift apart.
import {
  CLAIM_BINDING_AUDIT_MAX_TOKENS,
  CLAIM_BINDING_AUDIT_MODEL,
  CLAIM_BINDING_AUDIT_TEMPERATURE,
} from "./document-claim-binding";
import { logger } from "./logger";
import { runSalesOfferEngineForTenant } from "./sales-offer-engine";
import { findReusableDocument, resolveCustomerUserIds, resolveDocumentOwnerUserId } from "./tenant-signals";
import { generateOmgCardsFromTelemetry } from "./omg-card-generator-v2";
import type { DocumentCost } from "./document-engine";
import { broadcastPresentationScopeChange, broadcastPresentationDocsChange } from "./sse-channels";

const log = logger.child({ channel: "workflow.doc-pipeline" });
const costLog = logger.child({ channel: "engine.ai-cost-governance" });

/** A generation that made no model call — see document-engine.ts's copy. */
const NO_AI_CALL_COST: DocumentCost = { costCents: 0, costStatus: "no-ai-call" };

/**
 * Output-token ceiling for the SOW narrative call (Git #556).
 *
 * Deliberately NOT raised alongside `document-engine.ts`'s, and named here so
 * that difference reads as a decision rather than an oversight the next person
 * should "tidy up":
 *
 *   1. This call is a non-streaming `messages.create`. The SDK's own guidance is
 *      that requests above roughly 16k output tokens must stream or they risk an
 *      HTTP timeout on the idle connection. `document-engine.ts` already streams,
 *      so it can go higher; this path cannot without a transport change, and a
 *      transport change is not what #556 asked for.
 *   2. #556 is a consequence of #555, and #555 cannot reach this engine. The SOW
 *      prompt has no `{{findings}}` token at all — it grounds on
 *      `{{priorFindings}}` (structured findings lifted from previously generated
 *      documents) plus `{{candidates}}` and `{{pricingFormula}}`. The verbose
 *      per-finding point-impact format that overflowed the score report is not
 *      part of any SOW prompt, so the ceiling here is not under the same
 *      pressure.
 *
 * What this engine WAS missing is the same thing the other one was: any reading
 * of `stop_reason`. That is fixed below regardless of the ceiling — a SOW cut
 * off before its pricing table is exactly the document that must never be
 * served as finished.
 *
 * ── Git #560 — 16,000 -> 21,000, and why NOT 64,000 ──────────────────────────
 * Thinking (below) shares `max_tokens` with the response text, so turning it on
 * required moving this ceiling exactly as it did in `document-engine.ts`. That
 * engine went 32,000 -> 64,000. This one cannot follow it, and the limit is not
 * a matter of taste — it is enforced client-side, before any request is sent.
 *
 * Reason 1 above (this call is a non-streaming `messages.create`) has a precise
 * numeric consequence in the SDK actually installed here,
 * `@anthropic-ai/sdk@0.78.0`. `Anthropic.calculateNonstreamingTimeout` throws
 * `AnthropicError("Streaming is required for operations that may take longer
 * than 10 minutes")` whenever
 *
 *     (60 min * max_tokens) / 128,000 > 10 min
 *
 * i.e. whenever `max_tokens` exceeds 128,000 / 6 = 21,333. There is no
 * per-model override for `claude-sonnet-4-6` (`MODEL_NONSTREAMING_TOKENS` lists
 * only the Opus 4 / 4.1 ids), so the generic bound is the binding one. A
 * request at #559's 64,000 would not produce a slow SOW, it would produce a
 * thrown error on every generation.
 *
 * 21,000 is therefore the most headroom this transport allows, taken in full
 * with a small margin under the throw. It buys ~5,000 tokens for the reasoning
 * that now shares the budget, on top of the document envelope 16,000 already
 * covered. Unused ceiling costs nothing — only tokens actually produced are
 * billed — so there is no reason to leave any of it on the table.
 *
 * The residual risk is stated rather than hidden: if reasoning plus a long SOW
 * ever exceeds 21,000, the #556 guard below fails the document loudly with a
 * specific message instead of serving a truncated pricing table. That is the
 * designed outcome and the right one, but it is a NEW way for this path to
 * fail, and the fix if it shows up in practice is a transport change — move
 * this call to `anthropic.messages.stream()` as `document-engine.ts` already
 * does, which lifts the ceiling to 128,000 — not a further bump here. That
 * change was deliberately not made under #560, which is a settings-and-
 * validation issue, not a rewrite of how this engine talks to the API.
 */
const SOW_MAX_OUTPUT_TOKENS = 21000;

/**
 * Git #560 — adaptive thinking on the SOW generation call.
 *
 * ── The defect this targets ──────────────────────────────────────────────────
 * #559 confirmed, at a 4-in-5 reproduction rate on one tenant and one scan,
 * that this model generation loses a VALUE-TO-LABEL BINDING when it is made to
 * carry that binding implicitly through an English rewrite: it keeps the right
 * numbers and attaches them to the wrong property, then defends the result in
 * prose. Nothing in that mechanism is specific to governance findings.
 *
 * A SOW is the same task with money in it. `{{candidates}}` arrives as a list
 * of workstream-to-price pairs, and the model has to re-express those pairs as
 * a rendered pricing table with scope narrative around each line — carrying
 * every binding implicitly, across a document, with several similar dollar
 * figures adjacent to each other. That is the #559 shape with a worse blast
 * radius: a crossed binding here is a customer invoiced the wrong amount for
 * the wrong work.
 *
 * Thinking gives the model somewhere other than the visible document to do the
 * reconciliation. It does not guarantee the bindings come out right — which is
 * why the validation pass below exists and does not trust this setting.
 *
 * ── Why `temperature: 0` is NOT set here ─────────────────────────────────────
 * #560 asked for temperature 0 *and* thinking. They cannot both be set, and
 * this was checked against the current API reference rather than inherited from
 * #559: sampling parameters are rejected on `claude-sonnet-4-6` *while thinking
 * is on* — "on older models, the restriction applies only while thinking is on:
 * `temperature` and `top_k` are incompatible with thinking". (On the newer
 * models `temperature` is rejected outright, thinking or not, so there is no
 * model on which both could be set.) Verified that this path really is on
 * `claude-sonnet-4-6` rather than assuming it matches the 8-document engine —
 * it is, so #559's finding applies unchanged.
 *
 * Given a forced choice, thinking wins here for the same reason it won in #559:
 * temperature 0 buys run-to-run consistency, not correctness, and on the only
 * measured evidence anyone has for this defect the wrong binding is the
 * DOMINANT mode. Greedy decoding selects the dominant mode, so temperature 0 is
 * as likely to make the defect reliable as to remove it.
 *
 * Temperature 0 is still right for a near-deterministic comparison task, which
 * is exactly where it went: the validation call below sets it, and can, because
 * that call sets no `thinking`.
 *
 * ── Consequences that had to be handled with it ──────────────────────────────
 * Thinking blocks come FIRST in `content`, so anything reading `content[0]`
 * stops finding the document. Both readers on this path already select the
 * first TEXT block — `extractAiHtml` and #556's `readCharsProduced` were moved
 * off block zero by #559 — so no change was needed here, but the coupling is
 * real and is why this constant and those two functions must not be edited
 * independently of each other.
 */
const SOW_NARRATIVE_THINKING = { type: "adaptive" } as const;

// ⚠️ TEMPORARY TESTING KILL-SWITCH — REMOVE BEFORE PRODUCTION ⚠️
// Intentionally duplicated from document-engine.ts's own local, non-exported
// flag of the same name rather than importing it — same ground-up-replacement
// reasoning as that file: this is the pipeline_output (SOW) counterpart to its
// standalone-document path and must not modify it.
const AI_KILL_SWITCH_ENABLED = false;

const MAX_PRIOR_FINDINGS = 30;

export interface GenerateSowParams {
  /**
   * The engine customer (`tenantsTable.id`) this SOW is generated FOR — the
   * PRIMARY identity of the request. The Sales Offer Engine, the tenant's mspId,
   * and the prior-document grounding set are all customer-scoped, so the customer
   * is what this function actually needs; a users.id was only ever a way to look
   * one up.
   *
   * Deliberately NOT a `users.id`. This function no longer translates a portal
   * user id into a customer id internally — a caller holding only a users.id
   * resolves it at its own boundary via `resolveCustomerIdForPortalUser()`.
   */
  mspCustomerId: number;
  /**
   * The `users.id` to stamp on the generated row's `customerId` FK (a
   * users.id-shaped column). Optional — callers entering from a real logged-in
   * user pass theirs so ownership is unchanged; omitted, the customer's
   * canonical owner is resolved via `resolveDocumentOwnerUserId()`.
   */
  documentOwnerUserId?: number;
  projectId: number;
  // Expected to be "sow" in practice, but resolved generically via document_types
  // below rather than hardcoded, so any pipeline_output type can reuse this path.
  docTypeKey: string;
  testMode?: boolean;
  dryRun?: boolean;
  /** Narrows the Sales Offer Engine's candidate list to only these titles when provided.
   *  Unknown titles are ignored. Null/undefined = full scope (default). */
  selectedWorkstreamTitles?: string[] | null;
  /** How to supersede the prior completed document of this type for this customer+project
   *  on success. "delete" (default) hard-deletes it. "archive" sets its status to "archived"
   *  instead, preserving it so a prior scope selection can be restored without a new AI call. */
  supersedeMode?: "delete" | "archive";
  /** Called synchronously right after the "generating" placeholder row is created, before
   *  any real work begins — lets an HTTP caller respond immediately with the new document's
   *  id while generation continues, matching the live-progress pattern used elsewhere. */
  onRowCreated?: (documentId: number) => void;
  /** When provided, used directly instead of fetching the published SOW
   *  prompt from ai_prompts — lets an admin test an unsaved draft before
   *  publishing it. */
  promptOverride?: string;
  /** When provided, used directly instead of fetching the published
   *  pricing-formula prompt — tested independently from promptOverride,
   *  since the formula is its own separately-editable prompt. */
  pricingFormulaOverride?: string;
  /**
   * Skips the drift gate and always generates fresh.
   *
   * Default `false`: a real (non-dry-run) SOW generation first asks
   * `findReusableDocument()` whether this tenant already has a SOW of this type
   * that none of its data has moved since, and returns it without an AI call if
   * so. `true` is for callers that know an input the gate cannot see has
   * changed — the Simulator's explicit regenerate override being the intended
   * one.
   *
   * Request-level inputs the gate structurally cannot see (`promptOverride`,
   * `pricingFormulaOverride`, `selectedWorkstreamTitles`) suppress reuse on
   * their own without needing this flag — see the gate at the top of the real
   * branch below.
   */
  forceRegenerate?: boolean;
}

/**
 * Cost reporting is shared verbatim with the standalone engine — same field
 * names, same meaning of `0` vs `null` — so a caller that routes between
 * `generateDocument()` and `generateSowDocument()` (admin-document-generator,
 * admin-document-types, the workflow executor's generate_document node all do)
 * reads the cost the same way from either.
 */
export interface GenerateSowResult extends DocumentCost {
  documentId: number;
  htmlContent: string;
  /** Same meaning as `GenerateDocumentResult.reused` (document-engine.ts, Git #548). */
  reused: boolean;
}

export interface DryRunSowResult extends DocumentCost {
  dryRun: true;
  docTypeKey: string;
  assembledPrompt: string;
  stylePrefix: string;
  priorFindings: string[];
  candidates: {
    serviceId: number;
    serviceName: string;
    rationale: string;
    adjustedPriceCents: number;
    firedSignalKeys: string[];
  }[];
  promptKey: string;
}

/**
 * The users.id read key for this customer's prior documents.
 *
 * `insights_generated_documents.customerId` is a users.id-shaped FK, so reading
 * "the customer's prior documents" means reading across every login linked to
 * the customer. `resolveCustomerUserIds()` is the canonical customer-scoped
 * form of the `resolveSiblingUserIds()` call this used to make from a users.id
 * entry point — same set, reached from the customer directly instead of
 * bouncing off one arbitrary login.
 *
 * An explicit `documentOwnerUserId` is unioned in so a caller entering from a
 * login that (for any data reason) has no bridge row still sees its own prior
 * documents, exactly as `resolveSiblingUserIds()` guaranteed by always including
 * its input. Can legitimately return an EMPTY array for a customer with no
 * linked portal user — callers must not feed an empty array to `inArray`.
 */
async function resolveGroundingOwnerUserIds(mspCustomerId: number, documentOwnerUserId?: number): Promise<number[]> {
  const ids = await resolveCustomerUserIds(mspCustomerId);
  if (documentOwnerUserId != null && !ids.includes(documentOwnerUserId)) return [...ids, documentOwnerUserId];
  return ids;
}

export async function generateSowDocument(params: GenerateSowParams & { dryRun: true }): Promise<DryRunSowResult>;
export async function generateSowDocument(params: GenerateSowParams & { dryRun?: false }): Promise<GenerateSowResult>;
export async function generateSowDocument(params: GenerateSowParams): Promise<GenerateSowResult | DryRunSowResult> {
  const { mspCustomerId, projectId, docTypeKey, testMode = false } = params;

  // "No project selected" reaches this engine as the caller's `0` sentinel (the
  // admin route defaults an absent/NaN projectId to 0). `project_id` is a real
  // FK to `projects.id`, whose serial starts at 1, so there is no id=0 row and
  // writing the sentinel through is a foreign-key violation. NULL is the legal
  // representation, so normalize once here and derive the read predicate from
  // the same value — `= 0` can never match a row stored as NULL, which would
  // otherwise make the supersede and grounding lookups below silently miss
  // every no-project document.
  const normalizedProjectId = projectId || null;
  const projectIdMatches = normalizedProjectId === null
    ? isNull(insightsGeneratedDocumentsTable.projectId)
    : eq(insightsGeneratedDocumentsTable.projectId, normalizedProjectId);

  let documentId: number | null = null;

  try {
    const [docTypeRow] = await db.select().from(documentTypesTable).where(eq(documentTypesTable.key, docTypeKey)).limit(1);
    if (!docTypeRow) throw new Error(`document-engine-sow: unknown document type "${docTypeKey}"`);
    if (docTypeRow.pipelineCategory !== "pipeline_output") {
      throw new Error(`document-engine-sow: "${docTypeKey}" is not a pipeline_output document type — generateSowDocument() only handles pipeline_output types (e.g. SOW), not standalone types`);
    }

    if (params.dryRun) {
      const [customerRowDry] = await db.select({ mspId: tenantsTable.mspId }).from(tenantsTable).where(eq(tenantsTable.id, mspCustomerId)).limit(1);
      const resolvedMspIdDry = customerRowDry?.mspId ?? null;

      const groundingOwnerUserIdsDry = await resolveGroundingOwnerUserIds(mspCustomerId, params.documentOwnerUserId);
      // A customer with no linked portal user has no prior documents to ground
      // on — skip the query rather than handing `inArray` an empty set.
      const priorDocsDry = groundingOwnerUserIdsDry.length === 0 ? [] : await db
        .select({ generationInput: insightsGeneratedDocumentsTable.generationInput })
        .from(insightsGeneratedDocumentsTable)
        .innerJoin(documentTypesTable, eq(documentTypesTable.key, insightsGeneratedDocumentsTable.docType))
        .where(and(
          inArray(insightsGeneratedDocumentsTable.customerId, groundingOwnerUserIdsDry),
          projectIdMatches,
          eq(documentTypesTable.pipelineCategory, "standalone"),
        ));

      const seenFindingsDry = new Set<string>();
      const priorFindingsDry: string[] = [];
      outerDry: for (const doc of priorDocsDry) {
        for (const finding of doc.generationInput?.scopedFindings ?? []) {
          if (priorFindingsDry.length >= MAX_PRIOR_FINDINGS) break outerDry;
          if (seenFindingsDry.has(finding)) continue;
          seenFindingsDry.add(finding);
          priorFindingsDry.push(finding);
        }
      }
      const priorFindingsBlockDry = priorFindingsDry.length > 0
        ? priorFindingsDry.map((f, i) => `${i + 1}. ${f}`).join("\n")
        : "No prior documents have been generated for this client/project. Do NOT invent findings.";

      const salesOfferOutputDry = await runSalesOfferEngineForTenant(mspCustomerId, resolvedMspIdDry);
      const candidatesDry = salesOfferOutputDry.candidates;

      const candidatesBlockDry = candidatesDry.length > 0
        ? candidatesDry.map((c, i) => `${i + 1}. ${c.title} — $${(c.adjustedPriceCents / 100).toFixed(2)}\n   Rationale: ${c.rationale}`).join("\n\n")
        : "The Sales Offer Engine returned no candidate projects for this client. Do NOT invent projects or pricing.";

      const pricingFormulaBlockDry = await getSowPricingFormulaBlock(
        "Price each workstream at exactly the adjusted price provided by the Sales Offer Engine. Do not apply additional markup or discounting beyond what is shown. Present a pricing table listing each workstream and its price, summing to a total engagement price.",
      );

      let promptKeyDry = `insights-${docTypeRow.category}-${docTypeKey}`;
      if (docTypeRow.aiPromptId != null) {
        const [promptRowDry] = await db.select({ key: aiPromptsTable.key }).from(aiPromptsTable).where(eq(aiPromptsTable.id, docTypeRow.aiPromptId)).limit(1);
        if (promptRowDry?.key) promptKeyDry = promptRowDry.key;
      }
      const rawTemplateDry = await getPrompt(
        promptKeyDry,
        "Generate a professional HTML Statement of Work titled \"{{docLabel}}\".\n\nGrounding findings from prior generated documents for this client (do NOT invent additional findings):\n{{priorFindings}}\n\nScoped projects and their engine-priced pricing — this is the sole source of truth for what to scope and what to charge; do NOT invent additional projects or adjust these prices:\n{{candidates}}\n\nPricing presentation rules:\n{{pricingFormula}}",
      );

      const assembledPromptDry = rawTemplateDry
        .replace(/\{\{docLabel\}\}/g, docTypeRow.label)
        .replace(/\{\{priorFindings\}\}/g, priorFindingsBlockDry)
        .replace(/\{\{candidates\}\}/g, candidatesBlockDry)
        .replace(/\{\{pricingFormula\}\}/g, pricingFormulaBlockDry);

      const stylePrefixDry = await getDocumentStylePrefix();

      log.info({ mspCustomerId, projectId, docTypeKey }, "document-engine-sow: dry-run preview assembled (no AI call, no DB write)");

      return {
        dryRun: true,
        docTypeKey,
        assembledPrompt: assembledPromptDry,
        stylePrefix: stylePrefixDry,
        priorFindings: priorFindingsDry,
        candidates: candidatesDry.map((c) => ({
          serviceId: c.serviceId,
          serviceName: c.serviceName,
          rationale: c.rationale,
          adjustedPriceCents: c.adjustedPriceCents,
          firedSignalKeys: c.firedSignalKeys,
        })),
        promptKey: promptKeyDry,
        // Prompt assembled, no model called — a real zero, marked as such.
        ...NO_AI_CALL_COST,
      };
    }

    // ── Drift gate (cost overrun guard) ─────────────────────────────────────
    // Real generation only — the dry-run branch above returns before reaching
    // here, so preview behavior is untouched and never consults the gate.
    //
    // THREE request-level inputs suppress reuse regardless of `forceRegenerate`,
    // because each one changes the document while the tenant's DATA — all the
    // drift gate can see — stays identical:
    //   * promptOverride / pricingFormulaOverride — an admin testing an unsaved
    //     draft prompt. Reuse would hand back a document built from the
    //     PUBLISHED prompt and let them believe their draft produced it.
    //   * selectedWorkstreamTitles — the customer narrowing their own SOW scope
    //     (portal-assessment.ts's rescope path). Reuse would return the OLD,
    //     wider SOW — wrong scope and wrong price on a document the customer
    //     signs. That path also passes forceRegenerate explicitly; this is the
    //     structural backstop so a future caller can't reintroduce the bug by
    //     forgetting to.
    // Note this returns BEFORE `onRowCreated` would have fired: a reuse hit
    // creates no new row, so there is no new id to announce. Callers get the
    // reused document id from the resolved promise instead (portal-assessment's
    // rescope path already resolves off both, so neither hangs).
    const reuseSuppressedByOverride =
      params.promptOverride != null
      || params.pricingFormulaOverride != null
      || (params.selectedWorkstreamTitles?.length ?? 0) > 0;
    if (!params.forceRegenerate && !reuseSuppressedByOverride) {
      const reusable = await findReusableDocument(mspCustomerId, docTypeKey);
      if (reusable) {
        log.info(
          { mspCustomerId, projectId, docTypeKey, documentId: reusable.documentId },
          "document-engine-sow: reusing existing document, no drift detected, no AI call made",
        );
        // No AI call was made for THIS request; the reused document's own cost
        // sits in the ledger against the generation that incurred it.
        return { documentId: reusable.documentId, htmlContent: reusable.htmlContent, ...NO_AI_CALL_COST, reused: true };
      }
    } else {
      log.info(
        { mspCustomerId, projectId, docTypeKey, forceRegenerate: params.forceRegenerate === true, reuseSuppressedByOverride },
        "document-engine-sow: drift gate skipped — generating fresh",
      );
    }

    // Resolve the document owner + the customer's full users.id read key once,
    // up front: the placeholder insert, the prior-doc supersede lookup, and the
    // grounding read all need them, and they must agree with each other.
    const groundingOwnerUserIds = await resolveGroundingOwnerUserIds(mspCustomerId, params.documentOwnerUserId);
    const documentOwnerUserId = params.documentOwnerUserId ?? await resolveDocumentOwnerUserId(mspCustomerId);

    const [placeholderRow] = await db.insert(insightsGeneratedDocumentsTable).values({
      // The real scoping key. This engine is tenant-first (Phase 8), so the
      // customer is the function's own required param — nothing to resolve here.
      mspCustomerId,
      customerId: documentOwnerUserId,
      projectId: normalizedProjectId,
      category: docTypeRow.category,
      docType: docTypeKey,
      title: docTypeRow.label,
      htmlContent: "",
      status: "generating",
    }).returning({ id: insightsGeneratedDocumentsTable.id });
    documentId = placeholderRow.id;

    params.onRowCreated?.(documentId);

    // Find any prior completed document of this type for this customer+project, to
    // supersede on success. Never matches the placeholder just created above (it has
    // status "generating", not in this set).
    let priorDocId: number | null = null;
    if (groundingOwnerUserIds.length > 0) {
      const prior = await db.select({ id: insightsGeneratedDocumentsTable.id })
        .from(insightsGeneratedDocumentsTable)
        .where(and(
          inArray(insightsGeneratedDocumentsTable.customerId, groundingOwnerUserIds),
          projectIdMatches,
          eq(insightsGeneratedDocumentsTable.docType, docTypeKey),
          inArray(insightsGeneratedDocumentsTable.status, ["draft", "approved", "delivered", "archived"]),
        ))
        .limit(1);
      priorDocId = prior[0]?.id ?? null;
    }

    // docTypeRow.requiresSowHtml is out of scope here: this function only produces
    // the SOW itself. A downstream type like task_execution_guide that needs to read
    // the resulting SOW's pricing table back (requiresSowHtml === true) is separate
    // follow-up work, not handled by this function.

    // The customer's real mspId — the Sales Offer Engine is the sole authority on
    // which projects to scope, and both it and the customer id are required
    // inputs to run it. The customer id now arrives as a parameter rather than
    // being translated out of a users.id here.
    const [customerRow] = await db
      .select({ mspId: tenantsTable.mspId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, mspCustomerId))
      .limit(1);
    const resolvedMspId = customerRow?.mspId ?? null;

    // Real grounding data: structured findings already stored on prior STANDALONE
    // documents for this client/project — never re-parsed from rendered HTML.
    // CUSTOMER-scoped: prior documents are a property of the customer, so a
    // standalone doc generated under any sibling login of the same customer
    // (insights_generated_documents.customerId is a users.id-shaped FK) still
    // grounds this SOW — never silently empty grounding because an earlier doc
    // landed under a different linked user. `groundingOwnerUserIds` was resolved
    // from the customer up front, above.
    const priorDocs = groundingOwnerUserIds.length === 0 ? [] : await db
      .select({
        generationInput: insightsGeneratedDocumentsTable.generationInput,
      })
      .from(insightsGeneratedDocumentsTable)
      .innerJoin(documentTypesTable, eq(documentTypesTable.key, insightsGeneratedDocumentsTable.docType))
      .where(
        and(
          inArray(insightsGeneratedDocumentsTable.customerId, groundingOwnerUserIds),
          projectIdMatches,
          eq(documentTypesTable.pipelineCategory, "standalone"),
        ),
      );

    const seenFindings = new Set<string>();
    const priorFindings: string[] = [];
    outer: for (const doc of priorDocs) {
      for (const finding of doc.generationInput?.scopedFindings ?? []) {
        if (priorFindings.length >= MAX_PRIOR_FINDINGS) break outer;
        if (seenFindings.has(finding)) continue;
        seenFindings.add(finding);
        priorFindings.push(finding);
      }
    }
    const priorFindingsBlock = priorFindings.length > 0
      ? priorFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")
      : "No prior documents have been generated for this client/project. Do NOT invent findings.";

    // The Sales Offer Engine is the sole authority on which projects to scope and
    // what to charge for them — never engagement_projects/triggeredBy matching, and
    // never pricing re-extracted from rendered HTML afterward.
    const salesOfferOutput = await runSalesOfferEngineForTenant(mspCustomerId, resolvedMspId);
    const candidates = salesOfferOutput.candidates;

    const scopedCandidates = params.selectedWorkstreamTitles && params.selectedWorkstreamTitles.length > 0
      ? candidates.filter((c) => params.selectedWorkstreamTitles!.includes(c.title))
      : candidates;

    const candidatesBlock = scopedCandidates.length > 0
      ? scopedCandidates
        .map((c, i) => `${i + 1}. ${c.title} — $${(c.adjustedPriceCents / 100).toFixed(2)}\n   Rationale: ${c.rationale}`)
        .join("\n\n")
      : "The Sales Offer Engine returned no candidate projects for this client. Do NOT invent projects or pricing.";

    const pricingFormulaBlock = params.pricingFormulaOverride ?? await getSowPricingFormulaBlock(
      "Price each workstream at exactly the adjusted price provided by the Sales Offer Engine. Do not apply additional markup or discounting beyond what is shown. Present a pricing table listing each workstream and its price, summing to a total engagement price.",
    );

    // Resolve the real, admin-editable prompt via the FK
    let promptKey = `insights-${docTypeRow.category}-${docTypeKey}`;
    if (docTypeRow.aiPromptId != null) {
      const [promptRow] = await db.select({ key: aiPromptsTable.key }).from(aiPromptsTable).where(eq(aiPromptsTable.id, docTypeRow.aiPromptId)).limit(1);
      if (promptRow?.key) promptKey = promptRow.key;
    }
    const rawTemplate = params.promptOverride ?? await getPrompt(
      promptKey,
      "Generate a professional HTML Statement of Work titled \"{{docLabel}}\".\n\nGrounding findings from prior generated documents for this client (do NOT invent additional findings):\n{{priorFindings}}\n\nScoped projects and their engine-priced pricing — this is the sole source of truth for what to scope and what to charge; do NOT invent additional projects or adjust these prices:\n{{candidates}}\n\nPricing presentation rules:\n{{pricingFormula}}",
    );

    const prompt = rawTemplate
      .replace(/\{\{docLabel\}\}/g, docTypeRow.label)
      .replace(/\{\{priorFindings\}\}/g, priorFindingsBlock)
      .replace(/\{\{candidates\}\}/g, candidatesBlock)
      .replace(/\{\{pricingFormula\}\}/g, pricingFormulaBlock);

    const stylePrefix = await getDocumentStylePrefix();

    if (AI_KILL_SWITCH_ENABLED) {
      throw new Error("AI generation disabled by testing kill-switch (document-engine-sow.ts)");
    }

    // Refines whatever attribution the caller already established (e.g.
    // workflow-executor.ts's aiAttributionFor()) with the fields only this
    // engine knows — the customer this document is FOR and the artifact it
    // produces. Nested withAiAttribution shallow-merges, so a caller's
    // mspId/nodeType/runId survive alongside these.
    // Same read-back as the standalone engine: the cost comes from the
    // `ai_usage_events` row this call created, never recomputed here.
    const { result: aiResponse, costs } = await withAiUsageCapture(
      {
        customerId: mspCustomerId,
        generatedArtifactType: docTypeKey,
        generatedArtifactName: docTypeRow.label,
        ...(documentId != null ? { generatedArtifactId: String(documentId) } : {}),
        triggerSource: "document-engine",
      },
      () =>
        anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: SOW_MAX_OUTPUT_TOKENS,
          // Git #560 — see SOW_NARRATIVE_THINKING for why this is on, and why
          // `temperature` is deliberately NOT set alongside it.
          thinking: SOW_NARRATIVE_THINKING,
          messages: [{ role: "user", content: stylePrefix + prompt }],
        }),
    );

    // Git #556 — before anything reads the content, and before the pricing
    // parser in particular: `parseSowAllPricing` reads money out of HTML tables,
    // and a table the model was cut off mid-row through would parse into a
    // server-authoritative total that silently understates the engagement.
    assertOutputNotTruncated(
      aiResponse,
      {
        docTypeKey,
        maxTokens: SOW_MAX_OUTPUT_TOKENS,
        documentId,
        mspCustomerId,
        source: "document-engine-sow",
      },
      log,
    );

    // The bytes that get audited below and the bytes that get saved are the
    // same bytes, read once — a second `extractAiHtml(aiResponse)` at save time
    // would mean the gate cleared something other than what the customer reads.
    const htmlContent = extractAiHtml(aiResponse);

    // ── Pricing claim/source binding validation (#560) ────────────────────────
    // The SOW half of #559. Placed HERE, deliberately, on both sides:
    //   - AFTER `assertOutputNotTruncated`, because there is no sense auditing
    //     the pricing in a document already going to be rejected for being cut
    //     off (and a half-written table would generate spurious mismatches).
    //   - BEFORE the row is written, so a confirmed mismatch propagates to this
    //     function's own catch and marks the row `failed` — the same
    //     reject-before-save semantics #556 established here and #559 reused.
    //
    // The ground truth is the Sales Offer Engine's own records, not the
    // rendered `{{candidates}}` text and never anything re-parsed back out of
    // the generated HTML. `c.title` rather than `c.serviceName` on purpose:
    // `candidatesBlock` above showed the model `c.title`, and an auditor given
    // names the generator never saw would report mismatches on every line.
    const auditPricedLines: SowPricedLine[] = scopedCandidates.map((c) => ({
      title: c.title,
      priceUsd: c.adjustedPriceCents / 100,
    }));
    const auditTotalUsd = auditPricedLines.reduce((sum, l) => sum + l.priceUsd, 0);

    // Its own spend is captured exactly as the narrative call's is — its own
    // `withAiUsageCapture` scope, its cost ADDED to this document's. The audit
    // is real Anthropic spend for this customer, and a SOW whose reported cost
    // counted the narrative but not the audit that gated it would be the same
    // quietly-wrong figure the cost plumbing exists to eliminate.
    const { costs: bindingCosts } = await withAiUsageCapture(
      {
        customerId: mspCustomerId,
        generatedArtifactType: docTypeKey,
        generatedArtifactName: docTypeRow.label,
        ...(documentId != null ? { generatedArtifactId: String(documentId) } : {}),
        triggerSource: "document-engine-sow:claim-binding-audit",
      },
      () =>
        assertSowClaimBindingsConsistent(
          {
            documentHtml: htmlContent,
            source: {
              lines: auditPricedLines,
              totalUsd: auditTotalUsd,
              // The SAME strings the generator was given, not a re-derivation.
              pricingFormula: pricingFormulaBlock,
              priorFindings: priorFindingsBlock,
            },
            ctx: { docTypeKey, documentId, mspCustomerId, source: "document-engine-sow" },
          },
          // This engine's own channel, matching #556 and #559: "does this SOW
          // bill what the engine priced?" is a generation fact.
          log,
          async (auditPrompt) => {
            // Not streamed: nothing watches this, and it returns a short JSON
            // verdict rather than a document — so it is nowhere near the
            // non-streaming ceiling that constrains the narrative call above.
            // `temperature: 0` is legal here precisely because this call sets
            // no `thinking` — see SOW_NARRATIVE_THINKING for why the generation
            // call cannot have both.
            const audit = await anthropic.messages.create({
              model: CLAIM_BINDING_AUDIT_MODEL,
              max_tokens: CLAIM_BINDING_AUDIT_MAX_TOKENS,
              temperature: CLAIM_BINDING_AUDIT_TEMPERATURE,
              messages: [{ role: "user", content: auditPrompt }],
            });
            return firstTextBlock(audit) ?? "";
          },
        ),
    );

    const capturedCostCents = totalCapturedCostCents(costs);
    let cost: DocumentCost = capturedCostCents == null
      ? { costCents: null, costStatus: "unknown" }
      : { costCents: capturedCostCents, costStatus: "recorded" };
    const bindingCostStatuses = bindingCosts.map((c) => c.status);
    if (bindingCosts.length > 0) {
      const bindingCostCents = totalCapturedCostCents(bindingCosts);
      cost = bindingCostCents == null || cost.costCents == null
        ? { costCents: null, costStatus: "unknown" }
        : { costCents: cost.costCents + bindingCostCents, costStatus: "recorded" };
    }
    if (cost.costStatus === "unknown") {
      costLog.warn(
        {
          mspCustomerId, documentId, docTypeKey,
          callsCaptured: costs.length + bindingCostStatuses.length,
          statuses: [...costs.map((c) => c.status), ...bindingCostStatuses],
        },
        "ai-cost-governance: SOW generated but its usage row could not be read back — cost reported as unknown, not zero",
      );
    } else {
      costLog.info(
        { mspCustomerId, documentId, docTypeKey, costCents: cost.costCents },
        "ai-cost-governance: SOW generation cost resolved from its ai_usage_events row",
      );
    }

    const sowPricingLines = scopedCandidates.map((c) => ({
      title: c.serviceName,
      scope: c.rationale,
      priceUsd: c.adjustedPriceCents / 100,
      notes: c.rationale,
      line_type: "workstream" as const,
    }));
    const sowTotalPrice = sowPricingLines.reduce((sum, l) => sum + l.priceUsd, 0).toFixed(2);

    await db.update(insightsGeneratedDocumentsTable)
      .set({
        title: docTypeRow.label,
        htmlContent,
        status: testMode ? "draft" : "approved",
        generationInput: {
          scopedProfile: {},
          scopedFindings: priorFindings,
          salesOfferCandidates: scopedCandidates.map((c) => ({
            serviceId: c.serviceId,
            serviceName: c.serviceName,
            rationale: c.rationale,
            adjustedPriceCents: c.adjustedPriceCents,
            firedSignalKeys: c.firedSignalKeys,
          })),
        },
        sowPricingLines,
        sowTotalPrice,
        updatedAt: new Date(),
      })
      .where(eq(insightsGeneratedDocumentsTable.id, documentId));

    if (priorDocId !== null) {
      if ((params.supersedeMode ?? "delete") === "archive") {
        await db.update(insightsGeneratedDocumentsTable)
          .set({ status: "archived", updatedAt: new Date() })
          .where(eq(insightsGeneratedDocumentsTable.id, priorDocId));
      } else {
        await db.delete(insightsGeneratedDocumentsTable).where(eq(insightsGeneratedDocumentsTable.id, priorDocId));
      }
    }

    log.info(
      { mspCustomerId, documentOwnerUserId, projectId, documentId, docTypeKey, testMode },
      "document-engine-sow: SOW document generated",
    );

    void generateOmgCardsFromTelemetry(documentId).catch((err) => {
      log.warn({ err, documentId }, "document-engine-sow: OMG card generation failed (non-fatal)");
    });

    return { documentId, htmlContent, ...cost, reused: false };
  } catch (err) {
    log.error(
      { mspCustomerId, projectId, docTypeKey, testMode, err },
      "document-engine-sow: SOW generation failed",
    );
    if (typeof documentId === "number") {
      const errMsg = err instanceof Error ? err.message : String(err);
      await db.update(insightsGeneratedDocumentsTable)
        .set({ status: "failed", errorMessage: errMsg.slice(0, 500), updatedAt: new Date() })
        .where(eq(insightsGeneratedDocumentsTable.id, documentId))
        .catch(() => { /* best-effort — never let the failure-marking itself throw over the original error */ });
    }
    throw err;
  }
}

export async function broadcastSowChangeForProject(projectId: number): Promise<void> {
  try {
    const presentations = await db
      .select({ id: quickWinPresentationsTable.id })
      .from(quickWinPresentationsTable)
      .where(eq(quickWinPresentationsTable.projectId, projectId));
    const ts = String(Date.now());
    for (const p of presentations) {
      broadcastPresentationScopeChange(p.id, ts);
    }
  } catch (err) {
    log.warn({ err, projectId }, "broadcastSowChangeForProject: failed");
  }
}

export async function broadcastDocsChangeForProject(projectId: number): Promise<void> {
  try {
    const presentations = await db
      .select({ id: quickWinPresentationsTable.id })
      .from(quickWinPresentationsTable)
      .where(eq(quickWinPresentationsTable.projectId, projectId));
    for (const p of presentations) {
      broadcastPresentationDocsChange(p.id);
    }
  } catch (err) {
    log.warn({ err, projectId }, "broadcastDocsChangeForProject: failed");
  }
}
