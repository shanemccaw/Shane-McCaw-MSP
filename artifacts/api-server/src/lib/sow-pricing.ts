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
 * This is the single source of truth — exported and imported by portal.ts so the
 * two callers always use identical rules and can never drift.
 *
 * Keys:
 *   ws      — regex that matches the workstream phase title
 *   allowed — regexes that match permitted adjustment titles for that workstream
 */
/**
 * Maps each adjustment signal key to the regex pattern that matches its title
 * in a generated SOW Pricing Adjustments table.  Used by `validateSowPricing`
 * and `purgeSowAdjustments` when the signal engine has evaluated which
 * adjustments are active — replacing the workstream-scoped WORKSTREAM_ADJ_MAP
 * with a deterministic, telemetry-driven allowlist.
 */
export const ADJ_SIGNAL_PATTERNS: Record<string, { label: string; pattern: RegExp }> = {
  "adj:governance-complexity": { label: "Governance Complexity", pattern: /governance[\s-]?complexity/i },
  "adj:tenant-size":           { label: "Tenant Size",            pattern: /tenant[\s-]?size/i },
  "adj:security-compliance":   { label: "Security/Compliance",    pattern: /security[\s/&]+compliance/i },
  "adj:copilot-readiness":     { label: "Copilot Readiness",      pattern: /copilot[\s-]?readiness/i },
};

export const WORKSTREAM_ADJ_MAP: Array<{ ws: RegExp; allowed: RegExp[] }> = [
  { ws: /governance/i,                allowed: [/governance[\s-]?complexity/i] },
  { ws: /security/i,                  allowed: [/tenant[\s-]?size/i, /security[\s/&]+compliance/i] },
  { ws: /dlp|data[\s-]?prot/i,        allowed: [/security[\s/&]+compliance/i] },
  { ws: /copilot/i,                   allowed: [/copilot[\s-]?readiness/i] },
  { ws: /licens/i,                    allowed: [/tenant[\s-]?size/i] },
  // Information Architecture is a known workstream with NO permitted adjustments.
  // Listing it explicitly prevents the "unrecognised → pass-all" fallback from firing.
  { ws: /info(?:rmation)?[\s-]?arch/i, allowed: [] },
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

// ---------------------------------------------------------------------------
// Signal-authoritative phase alignment
// ---------------------------------------------------------------------------

/** Normalize a phase/project title for tolerant comparison (case, punctuation, whitespace). */
function normalizePhaseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Determine whether an AI-parsed workstream title refers to the same phase as
 * a catalogue (signal-filtered engagement project) title. Uses normalized
 * exact match first, then a tolerant substring match in either direction so
 * that minor AI rewording ("Governance Modernization Phase" vs "Governance
 * Modernization") doesn't cause a false "hallucinated phase" flag.
 */
function phaseTitlesMatch(aiTitle: string, catalogTitle: string): boolean {
  const a = normalizePhaseTitle(aiTitle);
  const c = normalizePhaseTitle(catalogTitle);
  if (a === c) return true;
  if (a.length === 0 || c.length === 0) return false;
  return a.includes(c) || c.includes(a);
}

export interface PhaseDriftResult {
  ok: boolean;
  /** Catalogue (signal-fired) titles with no matching workstream row in the AI output. */
  missingPhases: string[];
  /** Workstream rows the AI produced that do not correspond to any fired-signal catalogue project. */
  hallucinatedPhases: string[];
  issues: string[];
}

/**
 * Runtime guard for signal → phase determinism.
 *
 * `catalogTitles` MUST be the exact `signalFilteredProjects` title list used to
 * build the SOW prompt (the deterministic, signal-gated project list from
 * `tenant-signals.ts`). This function never mutates output — callers should
 * log the returned issues loudly (e.g. `logger.error`) so drift between the
 * signal engine and the AI's actual phase output is always visible, even
 * though generation is allowed to proceed with the purge helpers correcting
 * what they can.
 */
export function detectSowPhaseDrift(
  workstreamLines: SowPricingLine[],
  catalogTitles: string[],
): PhaseDriftResult {
  const issues: string[] = [];

  const missingPhases = catalogTitles.filter(
    catalogTitle => !workstreamLines.some(l => phaseTitlesMatch(l.title, catalogTitle)),
  );
  const hallucinatedPhases = workstreamLines
    .map(l => l.title)
    .filter(aiTitle => !catalogTitles.some(catalogTitle => phaseTitlesMatch(aiTitle, catalogTitle)));

  for (const title of missingPhases) {
    issues.push(`Signal-driven phase "${title}" is required (its triggering signal fired) but is missing from the generated SOW.`);
  }
  for (const title of hallucinatedPhases) {
    issues.push(`Workstream "${title}" appears in the generated SOW but does not correspond to any fired-signal catalogue project — remove it.`);
  }

  return { ok: issues.length === 0, missingPhases, hallucinatedPhases, issues };
}

/**
 * Strip workstream rows that don't correspond to any fired-signal catalogue
 * project (`catalogTitles`). This is the phase-table analogue of
 * `purgeSowAdjustments` — it removes AI-hallucinated phases from the stored
 * HTML so a phase whose triggering signal never fired can never reach the
 * client, even if the AI invented it.
 *
 * When `catalogTitles` is empty, purging is skipped entirely (nothing to
 * validate against) so an empty catalogue never wipes out an entire SOW.
 */
export function purgeHallucinatedWorkstreams(
  html: string,
  workstreamLines: SowPricingLine[],
  catalogTitles: string[],
): { html: string; removedTitles: string[] } {
  if (catalogTitles.length === 0) return { html, removedTitles: [] };

  const hallucinated = workstreamLines.filter(
    l => !catalogTitles.some(catalogTitle => phaseTitlesMatch(l.title, catalogTitle)),
  );
  if (hallucinated.length === 0) return { html, removedTitles: [] };

  const removedTitles = hallucinated.map(l => l.title);
  const removedKeys = new Set(removedTitles.map(t => t.toLowerCase().trim()));

  const stripTags = (s: string) =>
    s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s{2,}/g, " ").trim();

  const result = html.replace(
    /(<tr[^>]*>)([\s\S]*?)(<\/tr>)/gi,
    (match, _open, inner) => {
      const cells = [...inner.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)]
        .map(m => stripTags(m[1]));
      const rowTitle = (cells[0] ?? "").toLowerCase().trim();
      return removedKeys.has(rowTitle) ? "" : match;
    },
  );

  return { html: result, removedTitles };
}

/**
 * Rewrite each matched workstream row's title cell to the EXACT canonical
 * catalogue title, closing the gap where tolerant substring matching in
 * `phaseTitlesMatch` would otherwise let a slightly-reworded AI title
 * ("Governance Modernization Phase") reach the client instead of the
 * catalogue's canonical title ("Governance Modernization"). This guarantees
 * the persisted `sowPricingLines` — and therefore the client-facing
 * checklist — always uses the exact signal-catalogue title, never an AI
 * paraphrase.
 *
 * No-ops when `catalogTitles` is empty.
 */
export function canonicalizeWorkstreamTitles(
  html: string,
  workstreamLines: SowPricingLine[],
  catalogTitles: string[],
): { html: string; renamedTitles: Array<{ from: string; to: string }> } {
  if (catalogTitles.length === 0) return { html, renamedTitles: [] };

  const renames = new Map<string, string>(); // lowercased AI title -> canonical title
  const renamedTitles: Array<{ from: string; to: string }> = [];
  for (const line of workstreamLines) {
    const canonical = catalogTitles.find(catalogTitle => phaseTitlesMatch(line.title, catalogTitle));
    if (canonical && normalizePhaseTitle(canonical) !== normalizePhaseTitle(line.title)) {
      const key = line.title.toLowerCase().trim();
      if (!renames.has(key)) {
        renames.set(key, canonical);
        renamedTitles.push({ from: line.title, to: canonical });
      }
    }
  }
  if (renames.size === 0) return { html, renamedTitles: [] };

  const stripTags = (s: string) =>
    s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s{2,}/g, " ").trim();

  const result = html.replace(
    /<tr[^>]*>([\s\S]*?)<\/tr>/gi,
    (match, inner) => {
      const firstCellMatch = inner.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/i);
      if (!firstCellMatch) return match;
      const rowTitle = stripTags(firstCellMatch[1]).toLowerCase().trim();
      const canonical = renames.get(rowTitle);
      if (!canonical) return match;
      return match.replace(firstCellMatch[0], firstCellMatch[0].replace(firstCellMatch[1], canonical));
    },
  );

  return { html: result, renamedTitles };
}

/**
 * Parse a `priceRange` string like `"$8,000–$25,000+"` or `"$3,000 - $12,000"`
 * into a representative dollar amount for a synthetic injected phase row.
 * Uses the midpoint of the low/high bounds; falls back to the single parsed
 * number when only one is found, and to 0 when nothing parses (caller should
 * then skip injection for that project rather than inject a $0 row).
 */
function midpointFromPriceRange(priceRange: string): number {
  const nums = [...priceRange.matchAll(/\$?([0-9][0-9,]*)/g)].map(m => parseFloat(m[1]!.replace(/,/g, "")));
  if (nums.length === 0) return 0;
  if (nums.length === 1) return nums[0]!;
  return Math.round((nums[0]! + nums[1]!) / 2);
}

export interface CatalogProjectForInjection {
  title: string;
  priceRange: string;
}

/**
 * HARD ENFORCEMENT for signal → phase determinism: for every fired-signal
 * catalogue project with no matching workstream row in the AI's output,
 * inject a synthetic `<tr>` row (priced at the midpoint of that project's
 * base `priceRange`) into the workstream table so the phase reaches the
 * client regardless of what the AI produced.
 *
 * This closes the gap where `detectSowPhaseDrift()` could only detect and
 * log a missing phase — every fired boolean signal now deterministically
 * produces its mapped phase in the persisted document, with no AI discretion
 * over inclusion.
 *
 * If the workstream table cannot be located in the HTML (e.g. a totally
 * malformed AI response with no table at all), the catalogue project list
 * is still returned as `injected` so the caller can fail generation loudly
 * rather than silently persist an incomplete SOW.
 */
export function injectMissingWorkstreams(
  html: string,
  workstreamLines: SowPricingLine[],
  catalogProjects: CatalogProjectForInjection[],
): { html: string; injected: SowPricingLine[] } {
  const missing = catalogProjects.filter(
    p => !workstreamLines.some(l => phaseTitlesMatch(l.title, p.title)),
  );
  if (missing.length === 0) return { html, injected: [] };

  const injected: SowPricingLine[] = missing.map(p => ({
    title: p.title,
    scope: "",
    priceUsd: midpointFromPriceRange(p.priceRange),
    notes: "Auto-included: this phase's triggering signal fired but the generated document omitted it.",
  }));

  // Find the workstream table — identified the same way parseSowAllPricing
  // identifies it (header contains "final price" / "base ceiling" / "fixed price").
  const tableMatches = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
  let workstreamTableMatch: RegExpMatchArray | undefined;
  for (const m of tableMatches) {
    const theadMatch = m[0].match(/<thead[\s\S]*?<\/thead>/i);
    const firstTrMatch = m[0].match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
    const headerText = (theadMatch?.[0] ?? firstTrMatch?.[0] ?? "").toLowerCase();
    if (headerText.includes("final price") || headerText.includes("base ceiling") || headerText.includes("fixed price")) {
      workstreamTableMatch = m;
      break;
    }
  }

  if (!workstreamTableMatch) {
    // No workstream table exists anywhere in the AI output at all (the AI
    // omitted the pricing section, malformed it, or hit some other failure
    // mode where none of "final price" / "base ceiling" / "fixed price"
    // appear in any table header). Rather than give up and force the entire
    // generation to fail — which previously caused an infinite regenerate
    // loop, since a deterministic prompt/response failure repeats identically
    // on every retry — synthesize a complete, compliant workstream table from
    // the signal-authoritative catalog and inject it directly into the
    // document. This guarantees every fired-signal phase reaches the client
    // even when the AI drops the pricing table entirely.
    const allRows = missing
      .map(p => {
        const priceUsd = midpointFromPriceRange(p.priceRange);
        return `<tr><td>${p.title}</td><td>${p.priceRange}</td><td>$${priceUsd.toLocaleString("en-US")}</td><td>$${priceUsd.toLocaleString("en-US")}</td><td>Auto-included: this phase's triggering signal fired but the generated document omitted the pricing table.</td></tr>`;
      })
      .join("");
    const synthesizedTable =
      `<table><thead><tr><th>Project/Workstream</th><th>Scope</th><th>Base Ceiling</th><th>Final Price (USD)</th><th>Reasoning</th></tr></thead><tbody>${allRows}</tbody></table>`;

    // Insert right after the last </h2> heading whose text mentions "pricing"
    // (matching the prompt's expected section structure), or after the last
    // </table> in the document, or — as a last resort — at the very end of
    // the HTML body.
    const headingRegex = /<h2[^>]*>[^<]*pricing[^<]*<\/h2>/gi;
    const headingMatches = [...html.matchAll(headingRegex)];
    let result: string;
    if (headingMatches.length > 0) {
      const lastHeading = headingMatches[headingMatches.length - 1]![0];
      const idx = html.lastIndexOf(lastHeading);
      const insertAt = idx + lastHeading.length;
      result = html.slice(0, insertAt) + synthesizedTable + html.slice(insertAt);
    } else if (tableMatches.length > 0) {
      const lastTable = tableMatches[tableMatches.length - 1]![0];
      const idx = html.lastIndexOf(lastTable);
      const insertAt = idx + lastTable.length;
      result = html.slice(0, insertAt) + synthesizedTable + html.slice(insertAt);
    } else if (/<\/body>/i.test(html)) {
      result = html.replace(/<\/body>/i, `${synthesizedTable}</body>`);
    } else {
      result = html + synthesizedTable;
    }

    return { html: result, injected };
  }

  const tableHtml = workstreamTableMatch[0];

  // Determine the real column layout of the table we're injecting into so the
  // synthesized rows line up with whatever column index parseSowAllPricing
  // will later read the price (and, if present, duration) from. Building a
  // fixed 3-cell row regardless of the AI's actual column count silently
  // breaks re-parsing whenever the table has more columns than that (e.g. the
  // prompt-specified 5-column "Project/Workstream | Scope | Base Ceiling |
  // Final Price (USD) | Reasoning" layout) — the price would land past the
  // end of the short row and never be found.
  const stripTagsLocal = (s: string) =>
    s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#[0-9]+;/g, " ").replace(/\s{2,}/g, " ").trim();
  const theadMatchForCols = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
  const firstTrMatchForCols = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
  const headerHtmlForCols = theadMatchForCols?.[0] ?? firstTrMatchForCols?.[0] ?? "";
  const headerCellsForCols = [...headerHtmlForCols.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)]
    .map(m => stripTagsLocal(m[1]).toLowerCase());
  const colCount = Math.max(headerCellsForCols.length, 2);
  const priceColIdx = (() => {
    const idx = headerCellsForCols.findIndex(
      h => h.includes("final price") || h.includes("amount") || h.includes("value") || h.includes("usd") || h.includes("price") || h.includes("cost"),
    );
    return idx >= 0 ? idx : colCount - 1;
  })();
  const scopeColIdx = headerCellsForCols.findIndex(h => h.includes("scope"));
  const baseCeilingColIdx = headerCellsForCols.findIndex(h => h.includes("base ceiling"));
  const reasoningColIdx = headerCellsForCols.findIndex(h => h.includes("reasoning"));

  const newRows = missing
    .map(p => {
      const priceUsd = midpointFromPriceRange(p.priceRange);
      const cells: string[] = new Array(colCount).fill("");
      cells[0] = p.title;
      if (scopeColIdx >= 0) cells[scopeColIdx] = "";
      if (baseCeilingColIdx >= 0) cells[baseCeilingColIdx] = p.priceRange;
      cells[priceColIdx] = `$${priceUsd.toLocaleString("en-US")}`;
      if (reasoningColIdx >= 0) {
        cells[reasoningColIdx] = "Auto-included: this phase's triggering signal fired but the generated document omitted it.";
      }
      return `<tr>${cells.map(c => `<td>${c}</td>`).join("")}</tr>`;
    })
    .join("");

  let newTableHtml: string;
  if (/<\/tbody>/i.test(tableHtml)) {
    newTableHtml = tableHtml.replace(/<\/tbody>/i, `${newRows}</tbody>`);
  } else {
    newTableHtml = tableHtml.replace(/<\/table>/i, `${newRows}</table>`);
  }

  const result = html.replace(tableHtml, newTableHtml);
  return { html: result, injected };
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
  /**
   * When the signal engine has evaluated which pricing adjustments are active,
   * pass the fired `adj:*` signal keys here.  When provided and non-empty, the
   * check uses `ADJ_SIGNAL_PATTERNS` (signal-gated allowlist) instead of the
   * workstream-scoped `WORKSTREAM_ADJ_MAP` — making validation deterministic
   * and aligned with what the prompt constraint told the AI to produce.
   *
   * Pass an empty set or omit the parameter to fall back to `WORKSTREAM_ADJ_MAP`.
   */
  signalFiredAdjKeys?: Set<string>,
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
  if (adjustmentLines.length > 0) {
    // Signal-gated path: use fired adj:* keys as the allowlist.
    // An empty set is authoritative: no signals fired → no adjustments allowed.
    const useSignalGating = signalFiredAdjKeys !== undefined;
    if (useSignalGating) {
      const signalAllowedPatterns = [...signalFiredAdjKeys]
        .map(k => ADJ_SIGNAL_PATTERNS[k]?.pattern)
        .filter((p): p is RegExp => p !== undefined);
      // Always iterate — an empty allowlist means every adjustment is forbidden.
      {
        const seen = new Set<string>();
        for (const line of adjustmentLines) {
          const key = line.title.toLowerCase().trim();
          if (seen.has(key)) continue;
          seen.add(key);
          if (!signalAllowedPatterns.some(p => p.test(line.title))) {
            issues.push(
              `Signal-gated check: adjustment "${line.title}" ($${line.priceUsd.toLocaleString("en-US")}) ` +
              `was not activated by any fired adjustment signal — remove it or add a rule for it`,
            );
          }
        }
      }
    } else if (workstreamLines.length > 0) {
      // Fallback: workstream-scoped WORKSTREAM_ADJ_MAP check.
      const workstreamTitles = workstreamLines.map(l => l.title);
      const allowedPatterns: RegExp[] = [];
      for (const { ws, allowed } of WORKSTREAM_ADJ_MAP) {
        if (workstreamTitles.some(t => ws.test(t))) {
          allowedPatterns.push(...allowed);
        }
      }
      // Only enforce when at least one workstream matched a canonical pattern.
      if (allowedPatterns.length > 0) {
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
  /**
   * When the signal engine has evaluated which pricing adjustments are active,
   * pass the fired `adj:*` signal keys here.  When provided and non-empty, the
   * purge uses `ADJ_SIGNAL_PATTERNS` as the allowlist instead of the
   * workstream-scoped `WORKSTREAM_ADJ_MAP`.
   */
  signalFiredAdjKeys?: Set<string>,
): { html: string; removedTitles: string[] } {
  // ── Determine allowed adjustment patterns ────────────────────────────────────
  // Signal-gated: signalFiredAdjKeys provided (even if empty) → only fired keys
  // are permitted. Empty set means no adjustments are allowed. When undefined,
  // fall back to workstream-scoped WORKSTREAM_ADJ_MAP (legacy/no-rules path).
  let allowedPatterns: RegExp[] = [];
  const useSignalGating = signalFiredAdjKeys !== undefined;

  if (useSignalGating) {
    // Signal-gated path: only fired adj:* signals are permitted
    allowedPatterns = [...signalFiredAdjKeys]
      .map(k => ADJ_SIGNAL_PATTERNS[k]?.pattern)
      .filter((p): p is RegExp => p !== undefined);
    // allowedPatterns may be empty — that means ALL adjustments get purged.
  } else {
    // Fallback: workstream-scoped WORKSTREAM_ADJ_MAP
    for (const { ws, allowed } of WORKSTREAM_ADJ_MAP) {
      if (workstreamTitles.some(t => ws.test(t))) {
        allowedPatterns.push(...allowed);
      }
    }
  }

  // Build forced-exclusion patterns — adjustments from these workstream keys
  // are always removed, overriding the AI's own workstream table.
  const forcedExcludePatterns: RegExp[] = [];
  for (const excludeKey of serverForcedExclude) {
    if (useSignalGating) {
      // In signal-gated mode, forced exclusions are adj:* keys — look up directly
      const pat = ADJ_SIGNAL_PATTERNS[excludeKey]?.pattern;
      if (pat) forcedExcludePatterns.push(pat);
    } else {
      for (const { ws, allowed } of WORKSTREAM_ADJ_MAP) {
        if (ws.test(excludeKey)) forcedExcludePatterns.push(...allowed);
      }
    }
  }

  // If no workstream matched AND no forced exclusions, skip purging.
  // Signal-gated mode never skips — empty allowedPatterns means deny-all.
  if (!useSignalGating && allowedPatterns.length === 0 && forcedExcludePatterns.length === 0) {
    return { html, removedTitles: [] };
  }

  const unpermitted = adjustmentLines.filter(l => {
    // Forced exclusion always wins — server overrides AI's workstream table
    if (forcedExcludePatterns.some(p => p.test(l.title))) return true;
    // Signal-gated: empty allowedPatterns = deny all; non-empty = allowlist
    if (useSignalGating) return !allowedPatterns.some(p => p.test(l.title));
    // Legacy: allowlist check (only when we have workstream context)
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

/**
 * The subset of pre-computed intelligence-engine outputs that
 * `consolidated-sow-generator.ts` injects into the AI prompt as a hard
 * "reproduce verbatim, do not recalculate" constraint (see `engineOutputsBlock`).
 */
export interface EngineReconciliationValues {
  finalPrice: number;
  priorityScore: number;
  architectureHealthScore: number;
  driftScore: number;
  forecastScore: number;
  crmScore: number;
  mspPortfolioScore: number;
  /**
   * Per-signal pricing contributions from `computePricingEngine().breakdown`.
   * `finalPrice` above must equal the sum of `pricingValueContribution` across
   * this array by construction (see `engine-registry.ts`) — passed here mainly
   * so `reconcileEngineValues` can defensively re-verify that invariant and so
   * callers have a single, authoritative source for both the total and its
   * components when auditing a generated document.
   */
  pricingBreakdown: Array<{ signalKey: string; pricingImpact: number; pricingValueContribution: number }>;
}

interface EngineMetricSpec {
  key: keyof EngineReconciliationValues;
  label: string;
  /** Matches "<label> ... <number>", tolerating HTML tags/markup between label and number. */
  matchPattern: RegExp;
  isMoney: boolean;
}

/**
 * One entry per metric the prompt forbids the AI from recalculating.
 * `finalPrice` is deliberately NOT matched against every "Final Price" table
 * cell — those are the per-workstream chosen prices, a different concept —
 * only against prose that explicitly frames it as the pricing-signal value
 * contribution, per the exact wording used in `engineOutputsBlock`.
 */
const ENGINE_METRIC_SPECS: EngineMetricSpec[] = [
  {
    key: "priorityScore", label: "priorityScore",
    matchPattern: /priority\s*score[\s\S]{0,60}?\$?([\d,]+(?:\.\d+)?)/gi,
    isMoney: false,
  },
  {
    key: "architectureHealthScore", label: "architectureHealthScore",
    matchPattern: /architecture\s*health\s*score[\s\S]{0,60}?\$?([\d,]+(?:\.\d+)?)/gi,
    isMoney: false,
  },
  {
    key: "driftScore", label: "driftScore",
    matchPattern: /drift\s*score[\s\S]{0,60}?\$?([\d,]+(?:\.\d+)?)/gi,
    isMoney: false,
  },
  {
    key: "forecastScore", label: "forecastScore",
    matchPattern: /forecast(?:ing)?\s*score[\s\S]{0,60}?\$?([\d,]+(?:\.\d+)?)/gi,
    isMoney: false,
  },
  {
    key: "crmScore", label: "crmScore",
    matchPattern: /crm\s*score[\s\S]{0,60}?\$?([\d,]+(?:\.\d+)?)/gi,
    isMoney: false,
  },
  {
    key: "mspPortfolioScore", label: "mspPortfolioScore",
    matchPattern: /msp\s*(?:portfolio\s*)?score[\s\S]{0,60}?\$?([\d,]+(?:\.\d+)?)/gi,
    isMoney: false,
  },
  {
    key: "finalPrice", label: "finalPrice (pricing-signal value contribution)",
    matchPattern: /pricing[\s-]signal\s*(?:value\s*contribution)?[\s\S]{0,60}?\$([\d,]+(?:\.\d+)?)/gi,
    isMoney: true,
  },
];

/**
 * Post-generation reconciliation for the pre-computed engine values that
 * `consolidated-sow-generator.ts` tells the AI to "reproduce verbatim, never
 * recalculate" (finalPrice, pricingBreakdown-derived score, priorityScore,
 * architectureHealthScore, driftScore, forecastScore, crmScore,
 * mspPortfolioScore). The prompt instruction alone is not enforcement — this
 * scans the generated HTML for any place the AI actually wrote one of these
 * metrics out and, if the number it wrote doesn't match the deterministic
 * engine value within a small tolerance, overwrites it in place with the
 * correct value before the document is persisted.
 *
 * This is intentionally narrow: it only touches spots where the document
 * explicitly cites one of these metric labels near a number. It never
 * touches the per-workstream pricing table (that's `parseSowAllPricing` /
 * `patchSowGrandTotal`'s job) and never invents a mention that isn't there —
 * if the AI never referenced a metric, there is nothing to reconcile.
 */
export function reconcileEngineValues(
  html: string,
  engineValues: EngineReconciliationValues,
): { html: string; corrections: string[] } {
  let result = html;
  const corrections: string[] = [];

  for (const spec of ENGINE_METRIC_SPECS) {
    const expected = engineValues[spec.key];
    if (typeof expected !== "number" || isNaN(expected)) continue;

    result = result.replace(spec.matchPattern, (match: string, numStr: string) => {
      const found = parseFloat(numStr.replace(/,/g, ""));
      if (isNaN(found)) return match;

      const tolerance = spec.isMoney ? 1 : 0.5;
      if (Math.abs(found - expected) <= tolerance) return match;

      const formattedExpected = expected.toLocaleString("en-US");
      corrections.push(
        `${spec.label}: AI wrote ${spec.isMoney ? "$" : ""}${found.toLocaleString("en-US")} but engine value is ` +
        `${spec.isMoney ? "$" : ""}${formattedExpected} — corrected in place`,
      );

      const numMatch = match.match(/\$?[\d,]+(?:\.\d+)?\s*$/);
      if (!numMatch || numMatch.index === undefined) return match;
      const dollarSign = numMatch[0].startsWith("$") ? "$" : "";
      return match.slice(0, numMatch.index) + dollarSign + formattedExpected;
    });
  }

  // ── pricingBreakdown component-level reconciliation ─────────────────────────
  // finalPrice above is the SUM of pricingBreakdown[].pricingValueContribution.
  // If the document breaks that total down per fired signal anywhere (e.g. a
  // "Pricing Signal Contribution" list/table citing a signal by name next to
  // a dollar figure), correct each cited component the same way as the
  // aggregate metrics above. Signal keys are matched loosely — as the literal
  // key ("hasGovernanceGaps") or as a humanized label ("Has Governance Gaps") —
  // since the AI only ever sees the raw key in the JSON block, not a
  // pre-humanized label.
  for (const entry of engineValues.pricingBreakdown) {
    if (!entry.signalKey || typeof entry.pricingValueContribution !== "number") continue;
    const escapedKey = entry.signalKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const humanized = entry.signalKey.replace(/[:_-]/g, "\\s*[:_-]?\\s*").replace(/([a-z])([A-Z])/g, "$1\\s*$2");
    const labelPattern = new RegExp(`(?:${escapedKey}|${humanized})[\\s\\S]{0,60}?\\$([\\d,]+(?:\\.\\d+)?)`, "gi");

    result = result.replace(labelPattern, (match: string, numStr: string) => {
      const found = parseFloat(numStr.replace(/,/g, ""));
      if (isNaN(found)) return match;

      const tolerance = 1;
      if (Math.abs(found - entry.pricingValueContribution) <= tolerance) return match;

      const formattedExpected = entry.pricingValueContribution.toLocaleString("en-US");
      corrections.push(
        `pricingBreakdown["${entry.signalKey}"]: AI wrote $${found.toLocaleString("en-US")} but engine value is ` +
        `$${formattedExpected} — corrected in place`,
      );

      const numMatch = match.match(/\$[\d,]+(?:\.\d+)?\s*$/);
      if (!numMatch || numMatch.index === undefined) return match;
      return match.slice(0, numMatch.index) + `$${formattedExpected}`;
    });
  }

  return { html: result, corrections };
}
