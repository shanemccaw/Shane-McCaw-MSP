import {
  db,
  aiPromptsTable,
  documentTypesTable,
  insightsGeneratedDocumentsTable,
  mspCustomersTable,
  mspUsersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getDocumentStylePrefix, getPrompt, getSowPricingFormulaBlock } from "./prompt-loader";
import { extractAiHtml } from "./sow-pricing";
import { logger } from "./logger";
import { runSalesOfferEngineForTenant } from "./sales-offer-engine";

const log = logger.child({ channel: "workflow.doc-pipeline" });

// ⚠️ TEMPORARY TESTING KILL-SWITCH — REMOVE BEFORE PRODUCTION ⚠️
// Intentionally duplicated from document-engine.ts's own local, non-exported
// flag of the same name rather than importing it — same ground-up-replacement
// reasoning as that file: this is the pipeline_output (SOW) counterpart to its
// standalone-document path and must not modify it.
const AI_KILL_SWITCH_ENABLED = false;

const MAX_PRIOR_FINDINGS = 30;

export interface GenerateSowParams {
  clientUserId: number;
  projectId: number;
  // Expected to be "sow" in practice, but resolved generically via document_types
  // below rather than hardcoded, so any pipeline_output type can reuse this path.
  docTypeKey: string;
  testMode?: boolean;
}

export interface GenerateSowResult {
  documentId: number;
  htmlContent: string;
}

// Intentionally duplicated from document-engine.ts's private, non-exported
// resolveEngineCustomerId rather than importing it — same reasoning as the kill
// switch above. Bridges a portal users.id to the engine's msp_customers.id.
async function resolveEngineCustomerId(clientUserId: number): Promise<number | null> {
  const [row] = await db
    .select({ customerId: mspCustomersTable.id })
    .from(mspUsersTable)
    .innerJoin(mspCustomersTable, eq(mspUsersTable.customerId, mspCustomersTable.id))
    .where(eq(mspUsersTable.userId, clientUserId))
    .limit(1);
  return row?.customerId ?? null;
}

export async function generateSowDocument(params: GenerateSowParams): Promise<GenerateSowResult> {
  const { clientUserId, projectId, docTypeKey, testMode = false } = params;

  try {
    const [docTypeRow] = await db.select().from(documentTypesTable).where(eq(documentTypesTable.key, docTypeKey)).limit(1);
    if (!docTypeRow) throw new Error(`document-engine-sow: unknown document type "${docTypeKey}"`);
    if (docTypeRow.pipelineCategory !== "pipeline_output") {
      throw new Error(`document-engine-sow: "${docTypeKey}" is not a pipeline_output document type — generateSowDocument() only handles pipeline_output types (e.g. SOW), not standalone types`);
    }
    // docTypeRow.requiresSowHtml is out of scope here: this function only produces
    // the SOW itself. A downstream type like task_execution_guide that needs to read
    // the resulting SOW's pricing table back (requiresSowHtml === true) is separate
    // follow-up work, not handled by this function.

    // Resolve the real msp_customers.id, then the customer's real mspId — the Sales
    // Offer Engine is the sole authority on which projects to scope, and both are
    // required inputs to run it.
    const mspCustomerId = await resolveEngineCustomerId(clientUserId);
    if (mspCustomerId == null) {
      throw new Error(`document-engine-sow: no msp_customers row found for clientUserId ${clientUserId}`);
    }
    const [customerRow] = await db
      .select({ mspId: mspCustomersTable.mspId })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.id, mspCustomerId))
      .limit(1);
    const resolvedMspId = customerRow?.mspId ?? null;

    // Real grounding data: structured findings already stored on prior STANDALONE
    // documents for this client/project — never re-parsed from rendered HTML.
    const priorDocs = await db
      .select({
        generationInput: insightsGeneratedDocumentsTable.generationInput,
      })
      .from(insightsGeneratedDocumentsTable)
      .innerJoin(documentTypesTable, eq(documentTypesTable.key, insightsGeneratedDocumentsTable.docType))
      .where(
        and(
          eq(insightsGeneratedDocumentsTable.customerId, clientUserId),
          eq(insightsGeneratedDocumentsTable.projectId, projectId),
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

    const candidatesBlock = candidates.length > 0
      ? candidates
        .map((c, i) => `${i + 1}. ${c.title} — $${(c.adjustedPriceCents / 100).toFixed(2)}\n   Rationale: ${c.rationale}`)
        .join("\n\n")
      : "The Sales Offer Engine returned no candidate projects for this client. Do NOT invent projects or pricing.";

    const pricingFormulaBlock = await getSowPricingFormulaBlock(
      "Price each workstream at exactly the adjusted price provided by the Sales Offer Engine. Do not apply additional markup or discounting beyond what is shown. Present a pricing table listing each workstream and its price, summing to a total engagement price.",
    );

    // Resolve the real, admin-editable prompt via the FK
    let promptKey = `insights-${docTypeRow.category}-${docTypeKey}`;
    if (docTypeRow.aiPromptId != null) {
      const [promptRow] = await db.select({ key: aiPromptsTable.key }).from(aiPromptsTable).where(eq(aiPromptsTable.id, docTypeRow.aiPromptId)).limit(1);
      if (promptRow?.key) promptKey = promptRow.key;
    }
    const rawTemplate = await getPrompt(
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

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      messages: [{ role: "user", content: stylePrefix + prompt }],
    });

    const htmlContent = extractAiHtml(aiResponse);

    const [inserted] = await db.insert(insightsGeneratedDocumentsTable).values({
      customerId: clientUserId,
      projectId,
      category: docTypeRow.category,
      docType: docTypeKey,
      title: docTypeRow.label,
      htmlContent,
      status: testMode ? "draft" : "approved",
      generationInput: {
        scopedProfile: {},
        scopedFindings: priorFindings,
        salesOfferCandidates: candidates.map((c) => ({
          serviceId: c.serviceId,
          serviceName: c.serviceName,
          rationale: c.rationale,
          adjustedPriceCents: c.adjustedPriceCents,
          firedSignalKeys: c.firedSignalKeys,
        })),
      },
    }).returning({ id: insightsGeneratedDocumentsTable.id });

    log.info(
      { clientUserId, projectId, documentId: inserted.id, docTypeKey, testMode },
      "document-engine-sow: SOW document generated",
    );

    return { documentId: inserted.id, htmlContent };
  } catch (err) {
    log.error(
      { clientUserId, projectId, docTypeKey, testMode, err },
      "document-engine-sow: SOW generation failed",
    );
    throw err;
  }
}
