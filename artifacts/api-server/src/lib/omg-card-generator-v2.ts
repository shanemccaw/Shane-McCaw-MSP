/**
 * omg-card-generator-v2.ts
 *
 * "OMG cards" for the customer-facing Assessment Results Viewer, generated
 * directly from a document's stored `generationInput` — the real, structured,
 * scoped telemetry (scopedProfile + scopedFindings) actually used to generate
 * the document — rather than re-parsing the rendered HTML (the pattern used by
 * the legacy omg-card-extractor.ts).
 *
 * This is a deliberately separate AI call from document generation itself:
 * both this function and the document generator read the same real structured
 * `generationInput`, and neither derives from the other's output.
 *
 * Not yet wired into generateDocument() or any caller — that wiring (invoking
 * this right after a document is generated) is separate follow-up work.
 */

import { eq } from "drizzle-orm";
import { db, insightsGeneratedDocumentsTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";
import { OmgCardSchema, type OmgCard } from "./omg-card-extractor";

const log = logger.child({ channel: "workflow.doc-pipeline" });

// Bounded extraction/classification over already-real structured data —
// Haiku is the cost-appropriate tier, matching m365-health-ai-scorer.ts and
// the legacy omg-card-extractor.ts.
const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 1500;

const PROMPT_TEMPLATE = `You are a Microsoft 365 security and modernization consultant reviewing the real, structured telemetry behind a client assessment document. Your job is to pick out the most COMPELLING, ALARMING, or ATTENTION-GRABBING findings — the "oh my god" moments that make a business owner sit up and want to act.

DOCUMENT TYPE: {{docType}}
DOCUMENT TITLE: {{title}}

SCOPED PROFILE (real structured tenant data used to generate this document):
"""
{{scopedProfile}}
"""

SCOPED FINDINGS (real findings used to generate this document):
"""
{{scopedFindings}}
"""

Identify between 0 and 4 "OMG cards". Each card is one specific finding drawn ONLY from the data above — never generic advice, never invented. For each card provide:
- severity: "red" (urgent risk / money bleeding / active exposure), "amber" (notable gap worth fixing soon), or "green" (a genuine strength worth celebrating — include at most ONE green, and only if the data clearly supports it).
- metric: a SHORT, punchy headline figure that captures the finding at a glance. Prefer a real number pulled from the data — a dollar amount ("$18,000"), a count ("23", "0"), or a percentage ("94%"). Keep it under ~10 characters. If there is no usable number for this finding, use a stark word like "NONE" or "OPEN".
- metricLabel: a short phrase (a few words) that says what the metric measures — e.g. "per year wasted", "MFA-exempt admins", "unmanaged devices", "of licenses unused".
- headline: a punchy one-line human headline, in plain business language, not jargon — e.g. "You're paying for 20 licenses nobody uses".
- detail: one sentence explaining why it matters, grounded in the data above.

RULES:
- Base every card ONLY on the scoped profile and scoped findings given above. Do not invent numbers or findings not present in the data. If a finding has no number in the data, choose a word-based metric rather than fabricating a figure.
- If there is nothing sufficiently compelling in the data, return fewer cards — an empty array is fine.
- Lead with the scariest / most valuable findings first.
- Return ONLY a JSON array, no markdown fences, no preamble, no trailing commentary. Shape:
[
  { "severity": "red", "metric": "$18,000", "metricLabel": "per year wasted", "headline": "You're paying for 20 licenses nobody uses", "detail": "The license review found 20 assigned E3 licenses with no sign-in activity, costing roughly $18,000 annually." }
]`;

// Mirrors extractJson() in omg-card-extractor.ts / admin-marketing.ts — see
// .agents/memory/ai-json-extraction.md. Claude sometimes wraps JSON in
// prose/fences; never use a ^-anchored regex.
function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  if (objStart === -1 && arrStart === -1) return text.trim();
  const start =
    objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
  const openChar = text[start] === "{" ? "{" : "[";
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === openChar) depth++;
    else if (ch === closeChar) { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return text.slice(start).trim();
}

/**
 * Generate OMG cards for a document directly from its stored `generationInput`
 * (real, structured, scoped telemetry) — never by re-parsing rendered HTML.
 *
 * Best-effort: returns [] (without persisting anything) if the document has no
 * `generationInput` (older documents generated before this existed), and on
 * any AI/parse failure persists an empty array and returns [] so the caller
 * never breaks document generation.
 */
export async function generateOmgCardsFromTelemetry(documentId: number): Promise<OmgCard[]> {
  const [doc] = await db
    .select({
      id: insightsGeneratedDocumentsTable.id,
      docType: insightsGeneratedDocumentsTable.docType,
      title: insightsGeneratedDocumentsTable.title,
      generationInput: insightsGeneratedDocumentsTable.generationInput,
    })
    .from(insightsGeneratedDocumentsTable)
    .where(eq(insightsGeneratedDocumentsTable.id, documentId))
    .limit(1);

  if (!doc || !doc.generationInput) {
    return [];
  }

  const { scopedProfile, scopedFindings } = doc.generationInput;

  const prompt = PROMPT_TEMPLATE
    .replace("{{docType}}", doc.docType)
    .replace("{{title}}", doc.title)
    .replace("{{scopedProfile}}", JSON.stringify(scopedProfile ?? {}, null, 2).slice(0, 8000))
    .replace("{{scopedFindings}}", (scopedFindings ?? []).join("\n").slice(0, 4000) || "(none)");

  let cards: OmgCard[] = [];
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

    const parsed: unknown = JSON.parse(extractJson(raw));
    if (Array.isArray(parsed)) {
      cards = parsed
        .map((item) => OmgCardSchema.safeParse(item))
        .filter((result): result is { success: true; data: OmgCard } => result.success)
        .map((result) => result.data);
    } else {
      log.warn({ documentId }, "omg-card-generator-v2: AI response was not a JSON array — storing empty card set");
    }
  } catch (err) {
    log.warn({ err, documentId }, "omg-card-generator-v2: generation failed — storing empty card set");
    cards = [];
  }

  await db
    .update(insightsGeneratedDocumentsTable)
    .set({ omgCards: cards, omgCardsGeneratedAt: new Date() })
    .where(eq(insightsGeneratedDocumentsTable.id, documentId));

  log.info({ documentId, cardCount: cards.length }, "omg-card-generator-v2: cards generated from telemetry");
  return cards;
}
