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
import { buildTenantProfile, findReusableDocument, resolveDocumentOwnerUserId, type CategorizedFinding } from "./tenant-signals";
import { getDocumentStylePrefix, getPrompt } from "./prompt-loader";
import { extractAiHtml } from "./sow-pricing";
import { logger } from "./logger";
import { generateOmgCardsFromTelemetry } from "./omg-card-generator-v2";

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
}

function matchesProfilePattern(key: string, pattern: string): boolean {
  if (pattern.endsWith("*")) return key.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase());
  return key.toLowerCase() === pattern.toLowerCase();
}

/**
 * Resolves the MSP branding (name + primary color) for an engine customer.
 * Shared by the dry-run and real branches so a preview can never be branded
 * differently from the document that gets generated.
 */
async function resolveMspBranding(mspCustomerId: number): Promise<{ mspName: string | null; mspPrimaryColor: string | null }> {
  const [customerRow] = await db
    .select({ mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, mspCustomerId))
    .limit(1);
  if (customerRow?.mspId == null) return { mspName: null, mspPrimaryColor: null };
  const [msp] = await db
    .select({ name: mspsTable.name, primaryColor: mspsTable.primaryColor })
    .from(mspsTable)
    .where(eq(mspsTable.id, customerRow.mspId))
    .limit(1);
  return { mspName: msp?.name ?? null, mspPrimaryColor: msp?.primaryColor ?? null };
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
    const { mspName, mspPrimaryColor } = await resolveMspBranding(mspCustomerId);

    const tenantProfile = await buildTenantProfile(mspCustomerId);
    const mergedProfile: Record<string, unknown> = tenantProfile.mergedProfile;
    const findings: string[] = tenantProfile.findings;
    const categorizedFindings: CategorizedFinding[] = tenantProfile.categorizedFindings;
    const profilePatterns = docTypeRow.includedProfileKeyPatterns ?? [];
    const scopedProfileEntries = profilePatterns.length > 0
      ? Object.entries(mergedProfile).filter(([k]) => profilePatterns.some((p) => matchesProfilePattern(k, p)))
      : Object.entries(mergedProfile);
    const scopedProfile = Object.fromEntries(scopedProfileEntries);
    const signalCategories = docTypeRow.includedSignalCategories ?? [];
    const scopedFindings = scopeFindingsBySignalCategory(categorizedFindings, findings, signalCategories);
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

    const findingsBlock = scopedFindings.slice(0, 15).map((f, i) => `${i + 1}. ${f}`).join("\n") || "No findings were recorded for this client. Do NOT invent findings.";

    const assembledPrompt = rawTemplate
      .replace(/\{\{sections\}\}/g, sectionText)
      .replace(/\{\{profileSample\}\}/g, profileSample)
      .replace(/\{\{findings\}\}/g, findingsBlock)
      .replace(/\{\{docLabel\}\}/g, docTypeRow.label)
      .replace(/\{\{mspName\}\}/g, mspName ?? "Shane McCaw Consulting")
      .replace(/\{\{mspPrimaryColor\}\}/g, mspPrimaryColor ?? "#1a73e8");

    const stylePrefix = await getDocumentStylePrefix();

    log.info({ mspCustomerId, projectId, docTypeKey }, "document-engine: dry-run preview assembled (no AI call, no DB write)");

    // A preview assembles the prompt and stops — no model call, so the honest
    // figure is a real zero, marked `no-ai-call` so it can never be read as
    // "the AI ran and happened to be free".
    return {
      dryRun: true, docTypeKey, assembledPrompt, stylePrefix, scopedProfile, scopedFindings, sectionText, promptKey,
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
      return { ...reusable, ...NO_AI_CALL_COST };
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
    projectId,
    category: docTypeRow.category,
    docType: docTypeKey,
    title: docTypeRow.label,
    htmlContent: "",
    status: "generating",
  }).returning({ id: insightsGeneratedDocumentsTable.id });
  const documentId = placeholderRow.id;

  try {
    // Resolve real MSP branding
    const { mspName, mspPrimaryColor } = await resolveMspBranding(mspCustomerId);

    // Real tenant profile + scoping
    const tenantProfile = await buildTenantProfile(mspCustomerId);
    const mergedProfile: Record<string, unknown> = tenantProfile.mergedProfile;
    const findings: string[] = tenantProfile.findings;
    const categorizedFindings: CategorizedFinding[] = tenantProfile.categorizedFindings;
    const profilePatterns = docTypeRow.includedProfileKeyPatterns ?? [];
    const scopedProfileEntries = profilePatterns.length > 0
      ? Object.entries(mergedProfile).filter(([k]) => profilePatterns.some((p) => matchesProfilePattern(k, p)))
      : Object.entries(mergedProfile);
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
    const scopedFindings = scopeFindingsBySignalCategory(categorizedFindings, findings, signalCategories);
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

    const findingsBlock = scopedFindings.slice(0, 15).map((f, i) => `${i + 1}. ${f}`).join("\n") || "No findings were recorded for this client. Do NOT invent findings.";

    const prompt = rawTemplate
      .replace(/\{\{sections\}\}/g, sectionText)
      .replace(/\{\{profileSample\}\}/g, profileSample)
      .replace(/\{\{findings\}\}/g, findingsBlock)
      .replace(/\{\{docLabel\}\}/g, docTypeRow.label)
      .replace(/\{\{mspName\}\}/g, mspName ?? "Shane McCaw Consulting")
      .replace(/\{\{mspPrimaryColor\}\}/g, mspPrimaryColor ?? "#1a73e8");

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
      // Usage recording is deliberately non-fatal, so this is a real and
      // expected state — but it is "we don't know", not "it was free".
      costLog.warn(
        { mspCustomerId, documentId, docTypeKey, callsCaptured: costs.length, statuses: costs.map((c) => c.status) },
        "ai-cost-governance: document generated but its usage row could not be read back — cost reported as unknown, not zero",
      );
    } else {
      costLog.info(
        { mspCustomerId, documentId, docTypeKey, costCents: cost.costCents },
        "ai-cost-governance: document generation cost resolved from its ai_usage_events row",
      );
    }

    const htmlContent = extractAiHtml(aiResponse);

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

    return { documentId, htmlContent, docTypeKey, ...cost };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.update(insightsGeneratedDocumentsTable)
      .set({ status: "failed", errorMessage: errMsg.slice(0, 500), updatedAt: new Date() })
      .where(eq(insightsGeneratedDocumentsTable.id, documentId));
    throw err;
  }
}
