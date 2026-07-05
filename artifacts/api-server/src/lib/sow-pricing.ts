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
 * Returns the first Monday that falls at least one full calendar week (7 days)
 * after the given reference date.  This gives the client adequate preparation
 * time before the engagement begins.
 *
 * Algorithm:
 *   1. Advance 7 days from the reference date to enforce the one-week minimum.
 *   2. If that landing day is already a Monday, use it.
 *   3. Otherwise, advance forward to the next Monday.
 *
 * Examples (reference → result):
 *   Saturday  Jul  4 → Saturday  Jul 11 → Monday Jul 13
 *   Monday    Jul  6 → Monday    Jul 13 → Monday Jul 13  (already Monday)
 *   Tuesday   Jul  7 → Tuesday   Jul 14 → Monday Jul 20
 *   Sunday    Jul  5 → Sunday    Jul 12 → Monday Jul 13
 */
export function nextBusinessMonday(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  // Step 1 — skip at least one full week
  d.setDate(d.getDate() + 7);
  // Step 2 — advance to the nearest Monday on or after the landed date
  const dow = d.getDay(); // 0=Sun, 1=Mon … 6=Sat
  if (dow !== 1) {
    // (8 - dow) % 7 gives days until next Monday; handles Sun (0) → 1 day, Sat (6) → 2 days, etc.
    d.setDate(d.getDate() + ((8 - dow) % 7));
  }
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

    // Third classification: combined table containing both workstream and adjustment rows
    // in a single table. The AI sometimes collapses both pricing sections into one table.
    // Identified by a "workstream" / "project" header column with a price column but
    // without the explicit workstream-table or adjustment-table keyword combinations.
    const isCombinedTable =
      !isWorkstreamTable && !isAdjustmentTable &&
      (headerText.includes("workstream") || headerText.includes("project")) &&
      (headerText.includes("price") || headerText.includes("amount") || headerText.includes("cost") || headerText.includes("usd"));

    if (!isWorkstreamTable && !isAdjustmentTable && !isCombinedTable) continue;

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
      } else if (isAdjustmentTable) {
        adjustmentLines.push(line);
      } else {
        // Combined table: classify each row by testing against known canonical
        // adjustment-name patterns. Matched rows go to adjustmentLines; all
        // others go to workstreamLines so purgeSowAdjustments can act on them.
        if (ALL_KNOWN_ADJ_TITLE_PATTERNS.some(p => p.test(titleCell))) {
          adjustmentLines.push(line);
        } else {
          workstreamLines.push(line);
        }
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

// ---------------------------------------------------------------------------
// Pricing validation
// ---------------------------------------------------------------------------

/**
 * Workstream → permitted adjustment patterns.
 *
 * Authoritative adjustment rules per Shane McCaw Consulting engagement model:
 *   Governance Remediation  → Governance Complexity (only)
 *   Security Remediation    → Tenant Size, Security/Compliance
 *   Data Protection / DLP   → Security/Compliance (only)
 *   Copilot Readiness       → Copilot Readiness (only)
 *   Licensing Optimization  → Tenant Size (only)
 *
 * Generic Complexity, Data Sprawl, and Timeline are NOT permitted for any workstream.
 * This mirrors the WORKSTREAM_ADJ_MAP used in portal.ts `deriveEffectiveSowData`.
 * Any change to the permitted set MUST be applied in both places.
 *
 * Keys:
 *   ws      — regex that matches the workstream phase title
 *   allowed — regexes that match permitted adjustment titles for that workstream
 */
const WORKSTREAM_ADJ_MAP: Array<{ ws: RegExp; allowed: RegExp[] }> = [
  { ws: /governance/i,           allowed: [/governance[\s-]?complexity/i] },
  { ws: /security/i,             allowed: [/tenant[\s-]?size/i, /security|compliance/i] },
  { ws: /dlp|data[\s-]?prot/i,   allowed: [/security|compliance/i] },
  { ws: /copilot/i,              allowed: [/copilot[\s-]?readiness/i] },
  { ws: /licens/i,               allowed: [/tenant[\s-]?size/i] },
];

/**
 * All canonical adjustment-title patterns the AI may ever produce in a SOW.
 * Used to:
 *  1. Classify rows in a combined single-table SOW (parseSowAllPricing)
 *  2. Detect adjustment rows for the title-driven HTML purge (purgeAdjustmentsByTitle)
 */
const ALL_KNOWN_ADJ_TITLE_PATTERNS: RegExp[] = [
  /governance[\s-]?complexity/i,  // Governance Complexity — permitted for Governance only
  /tenant[\s-]?size/i,            // Tenant Size — permitted for Security, Licensing
  /security[^\w]+compliance/i,    // Security/Compliance, Security & Compliance
  /copilot[\s-]?readiness/i,      // Copilot Readiness — permitted for Copilot only
  /data[\s-]?sprawl/i,            // Data Sprawl — deprecated, not permitted for any workstream
  /^complexity\b/i,               // Complexity — deprecated, not permitted
  /^timeline\b/i,                 // Timeline — deprecated, not permitted
];

export interface SowValidationResult {
  ok: boolean;
  /** Human-readable description of each violation found. Empty when ok === true. */
  issues: string[];
}

/**
 * Validate parsed SOW pricing data for three categories of issue:
 *
 *   1. **Duplicate adjustments** — the same adjustment title appearing more than
 *      once causes double-counting of that factor's dollar amount.
 *
 *   2. **Grand-total arithmetic** — the Grand Total displayed in the raw HTML
 *      must equal workstreamSum + adjustmentSum within $1 rounding tolerance.
 *      Pass `rawHtml` BEFORE `patchSowGrandTotal()` is applied so the AI's
 *      original value is compared rather than the already-corrected value.
 *
 *   3. **Unpermitted adjustments** — each adjustment must be in the allowed set
 *      for at least one of the workstreams present in the SOW.  When no
 *      workstream title matches any canonical pattern the check is skipped so
 *      that an unrecognised engagement type never blocks generation.
 *
 * This function is intentionally non-blocking — callers should log the issues
 * but continue with persistence so that a rule change doesn't break in-flight
 * engagements.
 */
export function validateSowPricing(
  workstreamLines: SowPricingLine[],
  adjustmentLines: SowPricingLine[],
  rawHtml: string,
): SowValidationResult {
  const issues: string[] = [];

  // ── 1. Duplicate adjustment titles ──────────────────────────────────────────
  const titleCount = new Map<string, number>();
  for (const line of adjustmentLines) {
    const key = line.title.toLowerCase().trim();
    titleCount.set(key, (titleCount.get(key) ?? 0) + 1);
  }
  for (const [key, count] of titleCount) {
    if (count > 1) {
      const priceEach = adjustmentLines.find(l => l.title.toLowerCase().trim() === key)?.priceUsd ?? 0;
      issues.push(
        `Duplicate adjustment "${key}" appears ${count} times — over-counts by $${((count - 1) * priceEach).toLocaleString("en-US")}`,
      );
    }
  }

  // ── 2. Grand-total arithmetic ────────────────────────────────────────────────
  const workstreamSum = workstreamLines.reduce((s, l) => s + l.priceUsd, 0);
  const adjustmentSum = adjustmentLines.reduce((s, l) => s + l.priceUsd, 0);
  const computedTotal = workstreamSum + adjustmentSum;

  if (computedTotal > 0) {
    // Extract the first "Grand Total" dollar figure from the raw HTML text.
    const plainText = rawHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const gtMatch = plainText.match(/grand\s+total[\s\S]{0,80}?\$([0-9,]+(?:\.\d{2})?)/i);
    if (gtMatch) {
      const displayedTotal = parseFloat(gtMatch[1].replace(/,/g, ""));
      if (!isNaN(displayedTotal) && Math.abs(displayedTotal - computedTotal) > 1) {
        issues.push(
          `Grand Total arithmetic mismatch: HTML shows $${displayedTotal.toLocaleString("en-US")} but ` +
          `workstreams ($${workstreamSum.toLocaleString("en-US")}) + adjustments ($${adjustmentSum.toLocaleString("en-US")}) = ` +
          `$${computedTotal.toLocaleString("en-US")}`,
        );
      }
    }
  }

  // ── 3. Unpermitted adjustments ───────────────────────────────────────────────
  if (workstreamLines.length > 0 && adjustmentLines.length > 0) {
    const workstreamTitles = workstreamLines.map(l => l.title);
    const allowedPatterns: RegExp[] = [];
    for (const { ws, allowed } of WORKSTREAM_ADJ_MAP) {
      if (workstreamTitles.some(t => ws.test(t))) {
        allowedPatterns.push(...allowed);
      }
    }

    // Only enforce when at least one workstream matched a canonical pattern.
    if (allowedPatterns.length > 0) {
      // Check each unique adjustment title (duplicates already reported above).
      const seen = new Set<string>();
      for (const line of adjustmentLines) {
        const key = line.title.toLowerCase().trim();
        if (seen.has(key)) continue;
        seen.add(key);
        if (!allowedPatterns.some(p => p.test(line.title))) {
          issues.push(
            `Unpermitted adjustment "${line.title}" ($${line.priceUsd.toLocaleString("en-US")}) ` +
            `is not in the allowed set for workstreams: [${workstreamTitles.join(", ")}]`,
          );
        }
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Strip non-permitted adjustment rows from SOW HTML and correct the
 * "Adjustments Subtotal" row to match the remaining permitted rows.
 *
 * Called server-side immediately after `parseSowAllPricing()` so that
 * AI hallucinations (e.g. "Copilot Readiness" in a Governance-only SOW)
 * are removed from the stored document before it is ever shown to a client.
 *
 * After calling this function, re-run `parseSowAllPricing()` on the returned
 * HTML to get accurate `computedTotal` for `patchSowGrandTotal()`.
 *
 * @param html              Raw AI-generated SOW HTML (before grand-total patch)
 * @param adjustmentLines   Adjustment lines already parsed by parseSowAllPricing
 * @param workstreamTitles  Workstream titles parsed from the same SOW
 * @returns `{ html, removedTitles }` — html with bad rows excised;
 *          removedTitles is empty when everything was already clean
 */
export function purgeSowAdjustments(
  html: string,
  adjustmentLines: SowPricingLine[],
  workstreamTitles: string[],
  /**
   * Server-forced exclusions (canonical workstream key strings, e.g.
   * "Copilot Readiness").  Any adjustment whose title matches an allowed
   * pattern for an excluded key is ALWAYS removed — even if the AI wrote a
   * matching workstream row in its own generated workstream table.  This
   * prevents the AI from self-justifying an adjustment by adding the
   * corresponding workstream row when business rules prohibit it.
   */
  serverForcedExclude: string[] = [],
): { html: string; removedTitles: string[] } {
  // Build the union of permitted patterns from every matched workstream
  const allowedPatterns: RegExp[] = [];
  for (const { ws, allowed } of WORKSTREAM_ADJ_MAP) {
    if (workstreamTitles.some(t => ws.test(t))) {
      allowedPatterns.push(...allowed);
    }
  }

  // Build forced-exclusion patterns — adjustments from these workstream keys
  // are always removed, overriding the AI's own workstream table.
  const forcedExcludePatterns: RegExp[] = [];
  for (const excludeKey of serverForcedExclude) {
    for (const { ws, allowed } of WORKSTREAM_ADJ_MAP) {
      if (ws.test(excludeKey)) forcedExcludePatterns.push(...allowed);
    }
  }

  // If no workstream matched AND no forced exclusions, skip purging.
  if (allowedPatterns.length === 0 && forcedExcludePatterns.length === 0) {
    return { html, removedTitles: [] };
  }

  const unpermitted = adjustmentLines.filter(l => {
    // Forced exclusion always wins — server overrides AI's workstream table
    if (forcedExcludePatterns.some(p => p.test(l.title))) return true;
    // Allowlist check (only when we have workstream context)
    if (allowedPatterns.length > 0 && !allowedPatterns.some(p => p.test(l.title))) return true;
    return false;
  });
  if (unpermitted.length === 0) return { html, removedTitles: [] };

  const removedTitles: string[] = unpermitted.map(l => l.title);
  const unpermittedKeys = new Set(removedTitles.map(t => t.toLowerCase().trim()));

  const stripTags = (s: string) =>
    s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s{2,}/g, " ").trim();

  // Remove <tr> elements whose first cell matches an unpermitted title
  let result = html.replace(
    /(<tr[^>]*>)([\s\S]*?)(<\/tr>)/gi,
    (match, _open, inner) => {
      const cells = [...inner.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)]
        .map(m => stripTags(m[1]));
      const rowTitle = (cells[0] ?? "").toLowerCase().trim();
      return unpermittedKeys.has(rowTitle) ? "" : match;
    },
  );

  // Recompute the permitted adjustment sum and patch the "Adjustments Subtotal" row
  const permittedSum = adjustmentLines
    .filter(l => allowedPatterns.some(p => p.test(l.title)))
    .reduce((s, l) => s + l.priceUsd, 0);

  if (permittedSum >= 0) {
    const formatted = `$${permittedSum.toLocaleString("en-US")}`;
    result = result.replace(
      /(<tr[^>]*>)([\s\S]*?)(<\/tr>)/gi,
      (match, openTag: string, inner: string, closeTag: string) => {
        if (!/adjustments?\s+subtotal/i.test(inner)) return match;
        const lastDollarIdx = inner.lastIndexOf("$");
        if (lastDollarIdx < 0) return match;
        const patched =
          inner.slice(0, lastDollarIdx) +
          inner.slice(lastDollarIdx).replace(/\$[\d,]+(?:\.\d{2})?/, formatted);
        return openTag + patched + closeTag;
      },
    );
  }

  return { html: result, removedTitles };
}

/**
 * Title-driven HTML-level purge fallback.
 *
 * Scans every <tr> in the HTML directly and removes any row whose first cell
 * matches a known canonical adjustment name but is NOT in the permitted set
 * for the detected workstreams. This is a second safety net that runs after
 * purgeSowAdjustments — it catches the single-combined-table case where
 * parseSowAllPricing had no separate adjustmentLines so purgeSowAdjustments
 * was a no-op.
 *
 * Call this AFTER purgeSowAdjustments. If it removes rows, re-run
 * parseSowAllPricing on the result before calling patchSowGrandTotal.
 *
 * @param html              Raw (or already-purged) SOW HTML
 * @param workstreamTitles  Workstream titles from the AI-generated workstream
 *                          table or server-resolved canonical keys — drives the
 *                          permitted adjustment set.
 */
export function purgeAdjustmentsByTitle(
  html: string,
  workstreamTitles: string[],
): { html: string; removedTitles: string[] } {
  // Build the union of permitted adjustment patterns for the detected workstreams
  const allowedPatterns: RegExp[] = [];
  for (const { ws, allowed } of WORKSTREAM_ADJ_MAP) {
    if (workstreamTitles.some(t => ws.test(t))) {
      allowedPatterns.push(...allowed);
    }
  }

  // No workstream matched any canonical pattern — cannot determine the permitted
  // set so skip purge to avoid incorrectly removing rows in unknown engagements.
  if (allowedPatterns.length === 0) return { html, removedTitles: [] };

  const stripTags = (s: string) =>
    s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s{2,}/g, " ").trim();

  const removedTitles: string[] = [];

  const result = html.replace(
    /(<tr[^>]*>)([\s\S]*?)(<\/tr>)/gi,
    (match, _open, inner) => {
      const cells = [...inner.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)]
        .map(m => stripTags(m[1]));
      const rowTitle = cells[0] ?? "";

      // Only act on rows whose title matches a known canonical adjustment type
      if (!ALL_KNOWN_ADJ_TITLE_PATTERNS.some(p => p.test(rowTitle))) return match;

      // Adjustment IS permitted for one of the active workstreams — keep it
      if (allowedPatterns.some(p => p.test(rowTitle))) return match;

      // Unpermitted adjustment row — excise it
      removedTitles.push(rowTitle);
      return "";
    },
  );

  return { html: result, removedTitles };
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
