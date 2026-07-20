/**
 * partner-qbr-generator.ts
 *
 * "Partner QBR" (Quarterly Business Review) generator for MSP Executive Mode —
 * an AI-generated, cross-customer leadership document summarising an MSP's whole
 * book for the current quarter.
 *
 * DESIGN DECISIONS (see PLATFORM_BUILD.md for the full justification):
 *
 *   1. Single cross-customer document, NOT a per-customer bundle. This is the
 *      MSP owner's whole-book leadership artifact. The per-customer, client-
 *      facing formal document already exists — it's the consolidated SOW
 *      (consolidated-sow-generator.ts → insights_generated_documents). Building
 *      a per-customer QBR bundle would duplicate that surface; the leadership
 *      view's job is the cross-book roll-up the SOW deliberately isn't.
 *
 *   2. Generation convention = the consolidated-SOW convention, not the light
 *      OMG-card / dashboard-executive-summary one. A QBR is a long, formal,
 *      client-ready document, so it uses the SOW's heavier path: the shared
 *      `anthropic` client STREAMING with claude-opus-4-8, a DB-editable prompt
 *      via getPrompt() with a hard-coded fallback, HTML output extracted with
 *      extractAiHtml(), and a generating → ready/failed status lifecycle. The
 *      Haiku summarizers cap at 800 tokens of JSON — far too small for a QBR.
 *
 *   3. BUT it borrows two disciplines the SOW generator omits, from
 *      dashboard-executive-summary.ts: recordAiUsage() cost telemetry, and a
 *      hard cache so an expensive Opus generation is never run speculatively.
 *      The cache key is (mspId, quarter): a QBR is a quarterly artifact by
 *      nature, so one request per quarter generates it and every subsequent
 *      view within that quarter reads the cached row. `force` (a manual
 *      "Regenerate" click) overwrites it in place.
 *
 * The document is grounded exclusively on gatherExecutiveBook() — the SAME real
 * data (top-risk tenants by health score + top-opportunity tenants by open Sales
 * Offer Engine value + book roll-up) that the Executive Mode lists render. The
 * prompt is instructed to use only those numbers, never to invent figures.
 */

import { db, mspPartnerQbrsTable, mspsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { extractAiHtml } from "./sow-pricing";
import { getPrompt } from "./prompt-loader";
import { recordAiUsage } from "./ai-billing";
import { gatherExecutiveBook, type ExecutiveBook } from "./msp-executive-data.ts";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.dashboard" });

const QBR_MODEL = "claude-opus-4-8";
const QBR_MAX_TOKENS = 8000;
const QBR_PROMPT_KEY = "msp-partner-qbr";

export interface PartnerQbrResult {
  status: "generating" | "ready" | "failed";
  quarterKey: string;
  title: string;
  htmlContent: string;
  model: string | null;
  generatedAt: string | null;
  errorMessage: string | null;
}

/** Current calendar quarter key, e.g. "2026-Q3". Derived server-side from now. */
export function currentQuarterKey(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  return `${year}-Q${quarter}`;
}

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Render the gathered book into a compact, unambiguous block for the prompt. */
function formatBookForPrompt(book: ExecutiveBook): string {
  const lines: string[] = [];
  lines.push(`Customers in book: ${book.customerCount}`);
  lines.push(
    `Book-wide health: average health ${book.rollup.avgGoodnessPercent ?? "n/a"}% (higher is better); ${book.rollup.atRiskCount} customer(s) below the at-risk threshold.`,
  );
  lines.push(
    `Open opportunity pipeline: ${book.rollup.openOfferCount} open offer(s) worth ${usd(book.rollup.totalOpenOpportunityCents)} in total.`,
  );

  lines.push("");
  lines.push("TOP RISK CUSTOMERS (worst health first):");
  if (book.topRisks.length === 0) {
    lines.push("  (none — no health scores recorded)");
  } else {
    for (const r of book.topRisks) {
      lines.push(`  - ${r.name}: health ${r.goodnessPercent}% (${r.goodnessPercent < 60 ? "at risk" : r.goodnessPercent < 85 ? "watch" : "healthy"}).`);
    }
  }

  lines.push("");
  lines.push("TOP OPPORTUNITY CUSTOMERS (largest open pipeline first):");
  if (book.topOpportunities.length === 0) {
    lines.push("  (none — no open sales offers)");
  } else {
    for (const o of book.topOpportunities) {
      lines.push(
        `  - ${o.name}: ${o.openOfferCount} open offer(s) worth ${usd(o.totalValueCents)}${o.topOfferTitle ? `; largest: "${o.topOfferTitle}"` : ""}.`,
      );
    }
  }
  return lines.join("\n");
}

const QBR_PROMPT_FALLBACK = `You are a Microsoft 365 managed-services advisor writing a Partner Quarterly Business Review (QBR) for the OWNER of an MSP. The audience is the MSP's own leadership reviewing the health and commercial state of their entire book of customers for the quarter — NOT an individual end customer.

QUARTER: {{quarter}}
MSP: {{mspName}}

REAL BOOK DATA (the ONLY figures you may use — never invent a customer, number, or dollar amount not listed here):
{{book}}

Write a formal, client-ready QBR document as clean semantic HTML (headings, paragraphs, and simple tables/lists — no <html>, <head>, or <body> wrapper, no markdown fences, no inline CSS). Aim for roughly 800–1500 words. Structure it as:

1. <h1> title including the MSP name and quarter.
2. Executive Summary — 2–3 short paragraphs on overall book health and commercial momentum this quarter, grounded in the roll-up figures.
3. Portfolio Health — discuss the top risk customers by name, what their health scores imply, and the recommended focus. Use the exact health percentages provided.
4. Growth Opportunities — discuss the top opportunity customers by name and their open pipeline value, framed as this quarter's revenue focus. Use the exact dollar figures provided.
5. Recommended Actions — a short prioritized list (3–6 items) the MSP's leadership should act on next quarter, derived only from the data above.

RULES:
- Ground every claim in the REAL BOOK DATA above. Do not fabricate customers, metrics, or dollar amounts.
- If a section has no data (e.g. no open offers), say so plainly rather than inventing content.
- Professional, concise, leadership-appropriate tone. Return ONLY the HTML document.`;

/** Latest current-quarter QBR row for an MSP, or null. */
async function loadCurrentQbrRow(mspId: number, quarterKey: string) {
  const [row] = await db
    .select()
    .from(mspPartnerQbrsTable)
    .where(and(eq(mspPartnerQbrsTable.mspId, mspId), eq(mspPartnerQbrsTable.quarterKey, quarterKey)))
    .limit(1);
  return row ?? null;
}

function toResult(row: {
  status: "generating" | "ready" | "failed";
  quarterKey: string;
  title: string;
  htmlContent: string;
  model: string | null;
  generatedAt: Date | null;
  errorMessage: string | null;
}): PartnerQbrResult {
  return {
    status: row.status,
    quarterKey: row.quarterKey,
    title: row.title,
    htmlContent: row.htmlContent,
    model: row.model,
    generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
    errorMessage: row.errorMessage,
  };
}

/**
 * Return the current quarter's cached QBR without generating one. Used by the
 * GET endpoint so viewing never triggers an expensive AI call.
 */
export async function getCurrentPartnerQbr(mspId: number, now: Date = new Date()): Promise<PartnerQbrResult | null> {
  const quarterKey = currentQuarterKey(now);
  const row = await loadCurrentQbrRow(mspId, quarterKey);
  return row ? toResult(row) : null;
}

/**
 * Get or generate the current quarter's Partner QBR for an MSP.
 *
 * Cache: a `ready` row for the current quarter is returned as-is unless
 * `force` is set. `force` (manual regenerate) always runs a fresh generation
 * and overwrites the row in place.
 *
 * Whole-book: this is a leadership document over the entire MSP, so it is
 * generated with no staff scoping (scopedIds = null). The routes gate it to
 * MSPAdmin+ accordingly.
 *
 * Returns null only when there is genuinely nothing to review (empty book).
 */
export async function getOrGeneratePartnerQbr(
  mspId: number,
  opts: { force?: boolean } = {},
  now: Date = new Date(),
): Promise<PartnerQbrResult | null> {
  const quarterKey = currentQuarterKey(now);

  const existing = await loadCurrentQbrRow(mspId, quarterKey);
  if (existing && existing.status === "ready" && !opts.force) {
    return toResult(existing);
  }

  // Ground on the real book (whole book — leadership document).
  const book = await gatherExecutiveBook(mspId, null);
  if (book.customerCount === 0) {
    log.info({ mspId, quarterKey }, "partner-qbr: no customers in book — nothing to review");
    return null;
  }

  const [msp] = await db.select({ name: mspsTable.name }).from(mspsTable).where(eq(mspsTable.id, mspId)).limit(1);
  const mspName = msp?.name ?? "Your MSP";
  const title = `${mspName} — Partner QBR — ${quarterKey}`;
  const generatedAt = new Date();

  // Claim/refresh the row as `generating` so a concurrent request doesn't
  // double-fire an expensive generation for the same quarter.
  await db
    .insert(mspPartnerQbrsTable)
    .values({ mspId, quarterKey, status: "generating", title, htmlContent: "", dataSnapshot: {} })
    .onConflictDoUpdate({
      target: [mspPartnerQbrsTable.mspId, mspPartnerQbrsTable.quarterKey],
      set: { status: "generating", title, errorMessage: null, updatedAt: generatedAt },
    });

  const promptTemplate = await getPrompt(QBR_PROMPT_KEY, QBR_PROMPT_FALLBACK);
  const prompt = promptTemplate
    .replace(/\{\{quarter\}\}/g, quarterKey)
    .replace(/\{\{mspName\}\}/g, mspName)
    .replace(/\{\{book\}\}/g, formatBookForPrompt(book));

  try {
    const stream = anthropic.messages.stream({
      model: QBR_MODEL,
      max_tokens: QBR_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });
    const aiResponse = await stream.finalMessage();
    if (aiResponse.stop_reason === "max_tokens") {
      log.warn({ mspId, quarterKey }, "partner-qbr: output hit max_tokens — document may be truncated");
    }

    const htmlContent = extractAiHtml(aiResponse);
    if (!htmlContent.trim()) {
      throw new Error("AI returned an empty document");
    }

    void recordAiUsage({
      mspId,
      nodeType: "partner_qbr",
      feature: `partner_qbr:msp:${mspId}:${quarterKey}`,
      promptTokens: aiResponse.usage?.input_tokens ?? 0,
      completionTokens: aiResponse.usage?.output_tokens ?? 0,
      costOwner: "msp",
      model: aiResponse.model || QBR_MODEL,
    });

    const readyAt = new Date();
    await db
      .update(mspPartnerQbrsTable)
      .set({
        status: "ready",
        title,
        htmlContent,
        dataSnapshot: book as unknown as Record<string, unknown>,
        model: aiResponse.model || QBR_MODEL,
        errorMessage: null,
        generatedAt: readyAt,
        updatedAt: readyAt,
      })
      .where(and(eq(mspPartnerQbrsTable.mspId, mspId), eq(mspPartnerQbrsTable.quarterKey, quarterKey)));

    log.info({ mspId, quarterKey, htmlLength: htmlContent.length }, "partner-qbr: generated and cached");

    return {
      status: "ready",
      quarterKey,
      title,
      htmlContent,
      model: aiResponse.model || QBR_MODEL,
      generatedAt: readyAt.toISOString(),
      errorMessage: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "QBR generation failed";
    log.error({ err, mspId, quarterKey }, "partner-qbr: generation failed");
    const failedAt = new Date();
    await db
      .update(mspPartnerQbrsTable)
      .set({ status: "failed", errorMessage: message, updatedAt: failedAt })
      .where(and(eq(mspPartnerQbrsTable.mspId, mspId), eq(mspPartnerQbrsTable.quarterKey, quarterKey)));

    return {
      status: "failed",
      quarterKey,
      title,
      htmlContent: "",
      model: null,
      generatedAt: null,
      errorMessage: message,
    };
  }
}
