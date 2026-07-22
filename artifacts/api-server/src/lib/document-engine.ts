import {
  db,
  aiPromptsTable,
  documentTypesTable,
  insightsGeneratedDocumentsTable,
  mspCustomersTable,
  mspUsersTable,
  mspsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { buildTenantProfile } from "./tenant-signals";
import { getDocumentStylePrefix, getPrompt } from "./prompt-loader";
import { extractAiHtml } from "./sow-pricing";
import { logger } from "./logger";
import { generateOmgCardsFromTelemetry } from "./omg-card-generator-v2";

const log = logger.child({ channel: "workflow.doc-pipeline" });

// ⚠️ TEMPORARY TESTING KILL-SWITCH — REMOVE BEFORE PRODUCTION ⚠️
// Intentionally duplicated from document-generator.ts's own local, non-exported
// flag of the same name rather than importing it — this file is the ground-up
// replacement for that module's standalone-document path and must not modify it.
// Keep this in sync with document-generator.ts's flag until the cutover happens.
const AI_KILL_SWITCH_ENABLED = false;

export interface GenerateDocumentParams {
  clientUserId: number;
  projectId: number;
  docTypeKey: string;
  testMode?: boolean;
}

export interface GenerateDocumentResult {
  documentId: number;
  htmlContent: string;
  docTypeKey: string;
}

function matchesProfilePattern(key: string, pattern: string): boolean {
  if (pattern.endsWith("*")) return key.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase());
  return key.toLowerCase() === pattern.toLowerCase();
}

// Intentionally duplicated from document-generator.ts's private, non-exported
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

export async function generateDocument(params: GenerateDocumentParams): Promise<GenerateDocumentResult> {
  const { clientUserId, projectId, docTypeKey, testMode = false } = params;

  const [docTypeRow] = await db.select().from(documentTypesTable).where(eq(documentTypesTable.key, docTypeKey)).limit(1);
  if (!docTypeRow) throw new Error(`document-engine: unknown document type "${docTypeKey}"`);
  if (docTypeRow.pipelineCategory === "pipeline_output") {
    throw new Error(`document-engine: "${docTypeKey}" is a pipeline_output type (e.g. SOW) — use the dedicated pipeline generation function once it exists, not generateDocument()`);
  }

  // Insert a "generating" placeholder immediately so the UI has something real
  // to poll/display before the (potentially multi-minute) AI call even starts.
  const [placeholderRow] = await db.insert(insightsGeneratedDocumentsTable).values({
    customerId: clientUserId,
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
    const mspCustomerId = await resolveEngineCustomerId(clientUserId);
    let mspName: string | null = null;
    let mspPrimaryColor: string | null = null;
    if (mspCustomerId != null) {
      const [customerRow] = await db
        .select({ mspId: mspCustomersTable.mspId })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, mspCustomerId))
        .limit(1);
      if (customerRow?.mspId != null) {
        const [msp] = await db
          .select({ name: mspsTable.name, primaryColor: mspsTable.primaryColor })
          .from(mspsTable)
          .where(eq(mspsTable.id, customerRow.mspId))
          .limit(1);
        mspName = msp?.name ?? null;
        mspPrimaryColor = msp?.primaryColor ?? null;
      }
    }

    // Real tenant profile + scoping
    let mergedProfile: Record<string, unknown> = {};
    let findings: string[] = [];
    if (mspCustomerId != null) {
      const tenantProfile = await buildTenantProfile(mspCustomerId);
      mergedProfile = tenantProfile.mergedProfile;
      findings = tenantProfile.findings;
    }
    const profilePatterns = docTypeRow.includedProfileKeyPatterns ?? [];
    const scopedProfileEntries = profilePatterns.length > 0
      ? Object.entries(mergedProfile).filter(([k]) => profilePatterns.some((p) => matchesProfilePattern(k, p)))
      : Object.entries(mergedProfile);
    const scopedProfile = Object.fromEntries(scopedProfileEntries);
    // Known gap: no signal-category-based findings filter exists yet
    // (includedSignalCategories is stored but unused here) — findings pass
    // through unfiltered until that filter is built.
    const scopedFindings = findings;

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
    const rawTemplate = await getPrompt(promptKey, "Generate a professional HTML document covering: {{sections}}\n\nTenant data:\n{{profileSample}}\n\nFindings:\n{{findings}}");

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

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      messages: [{ role: "user", content: stylePrefix + prompt }],
    });

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
      { clientUserId, projectId, documentId, docTypeKey, testMode },
      "document-engine: standalone document generated",
    );

    void generateOmgCardsFromTelemetry(documentId).catch((err) => {
      log.warn({ err, documentId }, "document-engine: OMG card generation failed (non-fatal)");
    });

    return { documentId, htmlContent, docTypeKey };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.update(insightsGeneratedDocumentsTable)
      .set({ status: "failed", errorMessage: errMsg.slice(0, 500), updatedAt: new Date() })
      .where(eq(insightsGeneratedDocumentsTable.id, documentId));
    throw err;
  }
}
