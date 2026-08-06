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
import { extractAiHtml } from "./sow-pricing";
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
        return { documentId: reusable.documentId, htmlContent: reusable.htmlContent, ...NO_AI_CALL_COST };
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
          max_tokens: 16000,
          messages: [{ role: "user", content: stylePrefix + prompt }],
        }),
    );

    const capturedCostCents = totalCapturedCostCents(costs);
    const cost: DocumentCost = capturedCostCents == null
      ? { costCents: null, costStatus: "unknown" }
      : { costCents: capturedCostCents, costStatus: "recorded" };
    if (cost.costStatus === "unknown") {
      costLog.warn(
        { mspCustomerId, documentId, docTypeKey, callsCaptured: costs.length, statuses: costs.map((c) => c.status) },
        "ai-cost-governance: SOW generated but its usage row could not be read back — cost reported as unknown, not zero",
      );
    } else {
      costLog.info(
        { mspCustomerId, documentId, docTypeKey, costCents: cost.costCents },
        "ai-cost-governance: SOW generation cost resolved from its ai_usage_events row",
      );
    }

    const htmlContent = extractAiHtml(aiResponse);

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

    return { documentId, htmlContent, ...cost };
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
