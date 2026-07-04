import { z } from "zod";

/**
 * Zod schema for a single SOW pricing line as stored in the `sow_pricing_lines`
 * JSONB column. Adding new optional fields here is the single migration point —
 * old rows that pre-date a field will deserialise with the field `undefined`,
 * which is safe for all optional properties.
 */
export const SowPricingLineSchema = z.object({
  title: z.string(),
  scope: z.string(),
  priceUsd: z.number(),
  notes: z.string(),
  /** Distinguishes customer-toggleable workstream phases from mandatory price adjustments. */
  line_type: z.enum(["workstream", "adjustment"]).optional(),
  /** Estimated duration in weeks for this workstream phase. */
  weeks: z.number().int().positive().optional(),
  /**
   * ISO-8601 date (YYYY-MM-DD) for when this phase is expected to be
   * delivered, computed at generation time as nextBusinessMonday + cumulative
   * weeks. Stored so regenerated SOWs produce the same dates rather than
   * shifting with the clock.
   */
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional(),
});

export type SowPricingLine = z.infer<typeof SowPricingLineSchema>;

/**
 * Returns the next Business Monday strictly after the given date.
 * If the given date is itself a Monday, the FOLLOWING Monday (7 days later) is returned.
 * This is used to compute the engagement start date for SOW delivery schedules.
 */
export function nextBusinessMonday(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // If today is Monday add 7; otherwise advance to the next calendar Monday
  const daysUntilMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7;
  d.setDate(d.getDate() + daysUntilMonday);
  return d;
}

/**
 * Compute and attach a `deliveryDate` (ISO-8601 YYYY-MM-DD string) to each
 * workstream line based on cumulative duration starting from `engagementStart`.
 *
 * Lines without a `weeks` value do not receive a `deliveryDate`.
 * Adjustment lines should not be passed here — pass only workstream lines.
 *
 * The date is calculated as: engagementStart + Σ(weeks[0..i]) × 7 days.
 * Storing the date at generation time means a later SOW regeneration that
 * happens to land on a different day of the week cannot shift the schedule.
 */
export function assignDeliveryDates(
  workstreamLines: SowPricingLine[],
  engagementStart: Date = nextBusinessMonday(),
): SowPricingLine[] {
  let cumulativeWeeks = 0;
  return workstreamLines.map(line => {
    if (line.weeks === undefined || line.weeks <= 0) return line;
    cumulativeWeeks += line.weeks;
    const deliveryDate = new Date(engagementStart);
    deliveryDate.setDate(deliveryDate.getDate() + cumulativeWeeks * 7);
    return { ...line, deliveryDate: deliveryDate.toISOString().slice(0, 10) };
  });
}

/**
 * Strip markdown code fences that Claude sometimes wraps around HTML output.
 * Handles ```html ... ```, ``` ... ```, and any leading/trailing whitespace.
 */
export function stripMarkdownFence(text: string): string {
  let result = text
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();

  // Claude sometimes appends markdown commentary or "Document Summary" blocks
  // after the closing </html> tag. Truncate everything after </html> so only
  // the HTML document is stored — this is a universal safety net for all
  // document-generation paths.
  const htmlCloseMatch = result.match(/<\/html\s*>/i);
  if (htmlCloseMatch?.index !== undefined) {
    result = result.slice(0, htmlCloseMatch.index + htmlCloseMatch[0].length);
  }

  return result;
}

/**
 * Strip the admin-only "Staged for Review" banner divs that older AI-generated
 * documents may still contain in their stored HTML.  Safe to run on any HTML —
 * if the divs aren't present nothing changes.
 */
export function stripStagedForReviewBanner(html: string): string {
  return html
    .replace(/<div[^>]*>\s*⚠️[\s\S]*?Staged for Review[\s\S]*?<\/div>/gi, "")
    .replace(/<div[^>]*>\s*📋[\s\S]*?Staged for Review[\s\S]*?<\/div>/gi, "");
}

/**
 * Removes internal pricing-formula working notes that Claude sometimes renders
 * as visible text — specifically the "Detected Tenant Tier: …" sentence and the
 * follow-on "All base ceilings … drawn from the TierXX column." sentence.
 * These are calculation aids that must never appear in client-facing documents.
 */
export function stripTierDetectionText(html: string): string {
  return html
    // Remove whole <p> or <div> that starts with the tier detection note
    .replace(/<p[^>]*>[^<]*Detected Tenant Tier:[^<]*<\/p>/gi, "")
    .replace(/<div[^>]*>[^<]*Detected Tenant Tier:[^<]*<\/div>/gi, "")
    // Remove inline sentence: "Detected Tenant Tier: … Tier0X (range)."
    .replace(/Detected Tenant Tier:[^<]*?\([^)]*\)\./gi, "")
    // Remove follow-on sentence: "All base ceilings and adjustment amounts … column."
    .replace(/All base ceilings and adjustment amounts[^<]*?column\./gi, "")
    // Clean up any double-spaces or leading whitespace left behind
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Canonical extraction point used by all document-generation routes.
 *
 * Pulls the text body from the first content block of an Anthropic message
 * response and strips any markdown code fence Claude may have wrapped around
 * its HTML output (e.g. ```html … ```).  Centralising the call here means a
 * missing or bypassed stripMarkdownFence() at a call site is immediately
 * visible in tests that import this helper.
 *
 * The parameter is typed as `{ content: ReadonlyArray<unknown> }` so that the
 * real Anthropic `Message` type (whose content is `ContentBlock[]`, a
 * discriminated union that is NOT `Array<{ text: string }>`) is assignable
 * without an explicit cast at every call site.
 */
export function extractAiHtml(
  response: { content: ReadonlyArray<unknown> },
): string {
  const block = response.content[0] as { text?: string } | undefined;
  return stripMarkdownFence(block?.text ?? "");
}

/**
 * Parse a pricing table out of SOW HTML.
 * Returns individual line items and their summed total.
 */
export function parseSowPricing(html: string): { lines: SowPricingLine[]; totalPrice: number } {
  const stripTags = (s: string) =>
    s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#[0-9]+;/g, " ").replace(/\s{2,}/g, " ").trim();

  const tableMatches = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);

  for (const tableHtml of tableMatches) {
    const theadMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
    const firstTrMatch = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
    const headerHtml = theadMatch?.[0] ?? firstTrMatch?.[0] ?? "";
    const headerText = headerHtml.toLowerCase();

    if (!headerText.includes("price") && !headerText.includes("fixed") && !headerText.includes("cost")) continue;

    const headerCells = [...headerHtml.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map(m => stripTags(m[1]).toLowerCase());

    const priceIdx = headerCells.findIndex(h => h.includes("price") || h.includes("fixed") || h.includes("cost"));
    if (priceIdx < 0) continue;

    const titleIdx = 0;
    const scopeIdx = headerCells.findIndex(h => h.includes("scope") || h.includes("description") || h.includes("workstream"));
    const notesIdx = headerCells.findIndex(h => h.includes("note") || h.includes("comment") || h.includes("justif"));

    const bodyHtml = tableHtml
      .replace(/<thead[\s\S]*?<\/thead>/i, "")
      .replace(/<colgroup[\s\S]*?<\/colgroup>/i, "");

    const rows = [...bodyHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
    const lines: SowPricingLine[] = [];

    for (const row of rows) {
      const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(m => stripTags(m[1]));
      if (cells.length < 2) continue;

      const titleCell = cells[titleIdx] ?? "";
      const priceCell = cells[priceIdx] ?? "";

      const titleLower = titleCell.toLowerCase();
      if (
        titleLower === "" ||
        titleLower.includes("project/workstream") ||
        titleLower.includes("workstream") ||
        titleLower.includes("total") ||
        titleLower.includes("grand total") ||
        titleLower.includes("subtotal")
      ) continue;

      const priceStr = priceCell.replace(/[^0-9.]/g, "");
      const priceUsd = parseFloat(priceStr);
      if (isNaN(priceUsd) || priceUsd <= 0) continue;

      lines.push({
        title: titleCell,
        scope: scopeIdx >= 0 ? (cells[scopeIdx] ?? "") : "",
        priceUsd,
        notes: notesIdx >= 0 ? (cells[notesIdx] ?? "") : "",
      });
    }

    if (lines.length > 0) {
      const totalPrice = lines.reduce((sum, l) => sum + l.priceUsd, 0);
      return { lines, totalPrice };
    }
  }

  return { lines: [], totalPrice: 0 };
}

/**
 * Parse ALL pricing-relevant tables (workstream rows + adjustment rows) from a
 * Consolidated SOW HTML document.
 *
 * The AI produces two tables:
 *   1. A workstream table (has "scope" / "base ceiling" / "workstream" headers).
 *   2. An adjustments table (has "amount" / "value" / "adjustment" headers).
 *
 * Returns:
 *   - workstreamLines  — per-workstream Final Price rows
 *   - adjustmentLines  — per-factor adjustment rows (positive values only)
 *   - computedTotal    — server-authoritative sum: workstreams + adjustments
 */
export function parseSowAllPricing(html: string): {
  workstreamLines: SowPricingLine[];
  adjustmentLines: SowPricingLine[];
  computedTotal: number;
} {
  const stripTags = (s: string) =>
    s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#[0-9]+;/g, " ").replace(/\s{2,}/g, " ").trim();

  const tableMatches = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);

  const workstreamLines: SowPricingLine[] = [];
  const adjustmentLines: SowPricingLine[] = [];

  for (const tableHtml of tableMatches) {
    const theadMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
    const firstTrMatch = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
    const headerHtml = theadMatch?.[0] ?? firstTrMatch?.[0] ?? "";
    const headerText = headerHtml.toLowerCase();

    // Classify the table by specific pricing keywords to avoid false-positive
    // matches against non-pricing tables (e.g. Deliverables with "Business Value").
    // Workstream table: must contain "final price" or "base ceiling" — unique to
    //   the per-workstream pricing table the prompt generates.
    // Adjustment table: must contain "adjustment" in headers plus a money column
    //   keyword — unique to the Pricing Adjustments summary table.
    const isWorkstreamTable =
      headerText.includes("final price") ||
      headerText.includes("base ceiling") ||
      headerText.includes("fixed price");

    const isAdjustmentTable =
      !isWorkstreamTable &&
      headerText.includes("adjustment") &&
      (headerText.includes("amount") || headerText.includes("value") || headerText.includes("usd") || headerText.includes("price") || headerText.includes("cost"));

    if (!isWorkstreamTable && !isAdjustmentTable) continue;

    const headerCells = [...headerHtml.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map(m => stripTags(m[1]).toLowerCase());

    // Include "value" and "usd" so adjustment tables with a "Value" or "Amount (USD)"
    // column are correctly indexed.  The "$" guard below ensures only real dollar
    // cells are counted, so this cannot introduce non-currency false positives.
    const priceIdx = headerCells.findIndex(
      h => h.includes("final price") || h.includes("amount") || h.includes("value") || h.includes("usd") || h.includes("price") || h.includes("cost"),
    );
    if (priceIdx < 0) continue;

    // Detect an optional "Duration" or "Weeks" column (workstream tables only)
    const durationIdx = isWorkstreamTable
      ? headerCells.findIndex(h => h.includes("duration") || h === "weeks" || h.includes("week"))
      : -1;

    const bodyHtml = tableHtml
      .replace(/<thead[\s\S]*?<\/thead>/i, "")
      .replace(/<colgroup[\s\S]*?<\/colgroup>/i, "");

    const rows = [...bodyHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);

    for (const row of rows) {
      const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(m => stripTags(m[1]));
      if (cells.length < 2) continue;

      const titleCell = cells[0] ?? "";
      const priceCell = cells[priceIdx] ?? "";
      const titleLower = titleCell.toLowerCase();

      // Skip header rows, summary rows, and any aggregation rows.
      // Use exact/anchored matching for column names (e.g. "factor") so that
      // legitimate rows like "Tenant Size Adjustment Factor" aren't excluded.
      // Use substring matching for aggregation titles (subtotal, total) so that
      // "Adjustments Subtotal" and similar rows are excluded — those are display
      // artefacts and must not be stored as real pricing lines (they cause
      // double-counting when the individual items are already stored).
      if (
        titleLower === "" ||
        titleLower === "factor" ||
        titleLower === "adjustment factor" ||
        titleLower === "workstream" ||
        titleLower === "project/workstream" ||
        titleLower === "total" ||
        titleLower === "subtotal" ||
        titleLower === "grand total" ||
        /^grand\s+total/.test(titleLower) ||
        /^sub\s*total/.test(titleLower) ||
        titleLower.includes("subtotal") ||
        titleLower.includes("grand total")
      ) continue;

      // Require an explicit "$" in the price cell to guard against non-currency
      // numerics (health scores, quantities, durations) being parsed as dollars.
      if (!priceCell.includes("$")) continue;

      const priceStr = priceCell.replace(/[^0-9.]/g, "");
      const priceUsd = parseFloat(priceStr);
      if (isNaN(priceUsd) || priceUsd <= 0) continue;

      // Parse weeks from the Duration cell if present (handles "4 weeks", "4w", "~4", "4")
      let weeks: number | undefined;
      if (durationIdx >= 0) {
        const durationCell = cells[durationIdx] ?? "";
        const weeksMatch = durationCell.match(/~?(\d+)/);
        if (weeksMatch) {
          const parsed = parseInt(weeksMatch[1]!, 10);
          if (!isNaN(parsed) && parsed > 0) weeks = parsed;
        }
      }

      const line: SowPricingLine = { title: titleCell, scope: "", priceUsd, notes: "", ...(weeks !== undefined ? { weeks } : {}) };

      if (isWorkstreamTable) {
        workstreamLines.push(line);
      } else {
        adjustmentLines.push(line);
      }
    }
  }

  // Fallback: if the AI rendered adjustments as a div/text block instead of a
  // <table>, the table scanner above finds nothing in adjustmentLines.  Try to
  // extract the Grand Total from text patterns the AI commonly emits:
  //   "Grand Total = $32,000 (workstreams) + $20,000 (adjustments) = $52,000"
  //   "Grand Total: $52,000"
  //   "Total Engagement Price: $52,000"
  // When a text-based grand total is larger than the workstream sum, the gap is
  // treated as an implied adjustments total and pushed as a synthetic line.
  if (adjustmentLines.length === 0 && workstreamLines.length > 0) {
    const workstreamSum = workstreamLines.reduce((s, l) => s + l.priceUsd, 0);
    const plainText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    // Pattern 1: multi-step calc "Grand Total = ... = $X,XXX"
    const calcMatch = plainText.match(/grand\s+total\s*=[\s\S]{0,200}?=\s*\$([0-9,]+)/i);
    const calcValue = calcMatch ? parseFloat(calcMatch[1].replace(/,/g, "")) : 0;

    // Pattern 2: simple label "Grand Total: $X,XXX" or "Total Engagement Price: $X,XXX"
    const labelMatch = plainText.match(
      /(?:grand\s+total|total\s+engagement\s+(?:price|investment|fee))\s*[:\-–]?\s*\$([0-9,]+)/i,
    );
    const labelValue = labelMatch ? parseFloat(labelMatch[1].replace(/,/g, "")) : 0;

    const impliedGrandTotal = Math.max(calcValue, labelValue);
    if (impliedGrandTotal > workstreamSum) {
      adjustmentLines.push({
        title: "Price Adjustments",
        scope: "",
        priceUsd: impliedGrandTotal - workstreamSum,
        notes: "Derived from SOW grand total",
      });
    }
  }

  const computedTotal =
    workstreamLines.reduce((s, l) => s + l.priceUsd, 0) +
    adjustmentLines.reduce((s, l) => s + l.priceUsd, 0);

  return { workstreamLines, adjustmentLines, computedTotal };
}

/**
 * Find every "Grand Total" row in a SOW HTML document and overwrite its
 * rightmost dollar amount with `correctTotal`.
 *
 * This is called server-side after the AI response so that arithmetic errors
 * introduced by the LLM are corrected before the document is persisted.
 * If no Grand Total row is found the HTML is returned unchanged.
 */
export function patchSowGrandTotal(html: string, correctTotal: number): string {
  if (correctTotal <= 0) return html;

  const formatted = `$${correctTotal.toLocaleString("en-US")}`;

  return html.replace(
    /(<tr[^>]*>)([\s\S]*?)(<\/tr>)/gi,
    (match, openTag: string, inner: string, closeTag: string) => {
      if (!/grand\s+total/i.test(inner)) return match;

      const lastDollarIdx = inner.lastIndexOf("$");
      if (lastDollarIdx < 0) return match;

      const patched =
        inner.slice(0, lastDollarIdx) +
        inner.slice(lastDollarIdx).replace(/\$[\d,]+(?:\.\d{2})?/, formatted);

      return openTag + patched + closeTag;
    },
  );
}
