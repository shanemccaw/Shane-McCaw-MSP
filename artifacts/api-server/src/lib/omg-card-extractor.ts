/**
 * omg-card-extractor.ts
 *
 * "OMG cards" for the customer-facing Assessment Results Viewer.
 *
 * For a generated assessment document, extracts the handful of most
 * alarming/notable findings as attention-grabbing cards — each with a
 * traffic-light severity and a big headline number (a dollar estimate, a risk
 * count, whatever is most compelling for that finding). These are the emotional
 * hook that turns a dry report into a reason to buy, so they live prominently at
 * the top of each document's step in the wizard.
 *
 * TIMING — lazy / on-demand, NOT speculative:
 *   Extraction runs the first time a customer actually opens a given document
 *   (see GET /portal/assessment/documents/:id), then the result is persisted to
 *   insights_generated_documents.omg_cards. Rationale: assessments always run a
 *   fresh deep scan, and AI credits are a real cost — so we never spend a model
 *   call on a document the customer never scrolls to. Once extracted, every later
 *   view (and every re-render) reads the stored cards; the AI call happens at most
 *   once per document version.
 *
 * Follows the platform's established AI-call conventions: the shared `anthropic`
 * client, a DB-editable prompt via getPrompt() with a hard-coded fallback, robust
 * JSON extraction (extractJson — Claude sometimes wraps JSON in prose/fences), zod
 * validation, and fire-and-forget usage/cost telemetry via recordAiUsage.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  db,
  insightsGeneratedDocumentsTable,
  mspUsersTable,
} from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";
import { getPrompt } from "./prompt-loader";
import { recordAiUsage } from "./ai-billing";

const log = logger.child({ channel: "workflow.doc-pipeline" });

// ── Model ───────────────────────────────────────────────────────────────────
// Extraction/summarisation over already-generated content — Haiku is the
// cost-appropriate tier here and matches the insights report prompts.
const OMG_MODEL = "claude-haiku-4-5";
const OMG_MAX_TOKENS = 1500;

// ⚠️ TEMPORARY TESTING KILL-SWITCH — REMOVE BEFORE PRODUCTION ⚠️
// Disables real AI spend during active testing. Must be removed/re-enabled
// before any real customer reaches this flow. See backlog: [Shane to add ticket].
const AI_KILL_SWITCH_ENABLED = false;

// ── Card shape ──────────────────────────────────────────────────────────────

export const OmgCardSchema = z.object({
  severity: z.enum(["red", "amber", "green"]),
  /** Big, pre-formatted headline figure — e.g. "$18,000", "0", "23", "94%". */
  metric: z.string().min(1).max(24),
  /** Short qualifier under the metric — e.g. "per year wasted", "MFA-exempt admins". */
  metricLabel: z.string().min(1).max(60),
  /** Punchy human headline — e.g. "Your admins can sign in without MFA". */
  headline: z.string().min(1).max(120),
  /** One-sentence plain-language explanation of why it matters. */
  detail: z.string().min(1).max(400),
});

export type OmgCard = z.infer<typeof OmgCardSchema>;

const OmgCardsSchema = z.array(OmgCardSchema).max(6);

// ── Prompt ──────────────────────────────────────────────────────────────────

const OMG_PROMPT_KEY = "assessment-omg-cards";

const OMG_PROMPT_FALLBACK = `You are a Microsoft 365 security and modernization consultant reviewing a finished client assessment document. Your job is to pull out the most COMPELLING, ALARMING, or ATTENTION-GRABBING findings from it — the "oh my god" moments that make a business owner sit up and want to act.

DOCUMENT TYPE: {{docType}}
DOCUMENT TITLE: {{title}}

DOCUMENT CONTENT (plain text extracted from the report):
"""
{{content}}
"""

Produce between 2 and 4 "OMG cards". Each card is one specific finding drawn from THIS document — never generic advice. For each card provide:
- severity: "red" (urgent risk / money bleeding / active exposure), "amber" (notable gap worth fixing soon), or "green" (a genuine strength worth celebrating — include at most ONE green, and only if the document clearly supports it).
- metric: a SHORT, punchy headline figure that captures the finding at a glance. Prefer a real number pulled from the document — a dollar amount ("$18,000"), a count ("23", "0"), or a percentage ("94%"). Keep it under ~10 characters. If the document gives no usable number for this finding, use a stark word like "NONE" or "OPEN".
- metricLabel: a short phrase (a few words) that says what the metric measures — e.g. "per year wasted", "MFA-exempt admins", "unmanaged devices", "of licenses unused".
- headline: a punchy one-line human headline, in plain business language, not jargon — e.g. "You're paying for 20 licenses nobody uses".
- detail: one sentence explaining why it matters, grounded in the document's actual findings.

RULES:
- Base every card ONLY on what the document actually says. Do not invent numbers. If a finding has no number in the document, choose a word-based metric rather than fabricating a figure.
- Lead with the scariest / most valuable findings first.
- Dollar figures should reflect amounts stated or clearly implied by the document (e.g. wasted license spend). Never guess wildly.
- Return ONLY a JSON array, no markdown fences, no preamble, no trailing commentary. Shape:
[
  { "severity": "red", "metric": "$18,000", "metricLabel": "per year wasted", "headline": "You're paying for 20 licenses nobody uses", "detail": "The license review found 20 assigned E3 licenses with no sign-in activity, costing roughly $18,000 annually." }
]`;

// ── HTML → plain text (bounded) ───────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#[0-9]+;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── Robust JSON extraction (Claude may wrap JSON in prose/fences) ─────────────
// Mirrors extractJson() in admin-marketing.ts — see .agents/memory/ai-json-extraction.md.

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

// ── Usage telemetry (fire-and-forget) ─────────────────────────────────────────

function trackUsage(opts: {
  inputTokens: number;
  outputTokens: number;
  model: string;
  customerUserId: number;
  documentId: number;
}): void {
  void (async () => {
    try {
      let mspId: number | null = null;
      const [mspUser] = await db
        .select({ mspId: mspUsersTable.mspId })
        .from(mspUsersTable)
        .where(eq(mspUsersTable.userId, opts.customerUserId))
        .limit(1);
      if (mspUser) mspId = mspUser.mspId ?? null;

      await recordAiUsage({
        mspId,
        nodeType: "omg_card_extractor",
        feature: `assessment_omg_cards:document:${opts.documentId}`,
        promptTokens: opts.inputTokens,
        completionTokens: opts.outputTokens,
        costOwner: "msp",
        model: opts.model,
      });
    } catch (err) {
      log.warn({ err, documentId: opts.documentId }, "omg-card-extractor: usage telemetry failed (non-fatal)");
    }
  })();
}

// ── Main entry ────────────────────────────────────────────────────────────────

export interface OmgExtractionDoc {
  id: number;
  docType: string;
  title: string;
  htmlContent: string;
  /** users.id-space owner of the document — used only for cost attribution. */
  customerUserId: number | null;
}

/**
 * Extract OMG cards from a document, persist them, and return them.
 *
 * Best-effort: on any AI/parse failure this persists an empty array (so the
 * viewer stops trying to extract and simply shows no cards) and returns [].
 * The document's own content is always still viewable regardless.
 */
export async function extractAndStoreOmgCards(doc: OmgExtractionDoc): Promise<OmgCard[]> {
  const content = htmlToText(doc.htmlContent).slice(0, 12000);

  // Nothing to extract from — record an empty result so we don't retry forever.
  if (content.length < 40) {
    await persist(doc.id, []);
    return [];
  }

  const template = await getPrompt(OMG_PROMPT_KEY, OMG_PROMPT_FALLBACK);
  const prompt = template
    .replace(/\{\{docType\}\}/g, doc.docType)
    .replace(/\{\{title\}\}/g, doc.title)
    .replace(/\{\{content\}\}/g, content);

  let cards: OmgCard[] = [];
  try {
    if (AI_KILL_SWITCH_ENABLED) {
      throw new Error("AI generation disabled by testing kill-switch (omg-card-extractor.ts)");
    }
    const message = await anthropic.messages.create({
      model: OMG_MODEL,
      max_tokens: OMG_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

    if (doc.customerUserId != null) {
      trackUsage({
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
        model: message.model || OMG_MODEL,
        customerUserId: doc.customerUserId,
        documentId: doc.id,
      });
    }

    const parsed: unknown = JSON.parse(extractJson(raw));
    const result = OmgCardsSchema.safeParse(parsed);
    if (result.success) {
      cards = result.data;
    } else {
      log.warn(
        { documentId: doc.id, issues: result.error.issues.map((i) => i.message) },
        "omg-card-extractor: AI response failed schema validation — storing empty card set",
      );
    }
  } catch (err) {
    log.error({ err, documentId: doc.id }, "omg-card-extractor: extraction failed — storing empty card set");
    cards = [];
  }

  await persist(doc.id, cards);
  log.info({ documentId: doc.id, cardCount: cards.length }, "omg-card-extractor: cards extracted and stored");
  return cards;
}

async function persist(documentId: number, cards: OmgCard[]): Promise<void> {
  await db
    .update(insightsGeneratedDocumentsTable)
    .set({ omgCards: cards, omgCardsGeneratedAt: new Date() })
    .where(eq(insightsGeneratedDocumentsTable.id, documentId));
}
