/**
 * Tests for stripMarkdownFence(), extractAiHtml(), and validateSowPricing()
 * in sow-pricing.ts.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 *
 * Uses Vitest (describe / it / expect).
 *
 * WHY extractAiHtml is the key regression guard
 * ---------------------------------------------
 * All document-generation routes (POST /generate, automation run, SOW
 * generation, document regeneration) call extractAiHtml() before the DB
 * insert.  Testing extractAiHtml() directly means any removal of the
 * stripMarkdownFence() call inside it will cause these tests to fail —
 * matching the intent of the integration path tests.
 */
import { describe, it, expect } from "vitest";
import { stripMarkdownFence, extractAiHtml, validateSowPricing, parseSowAllPricing, purgeAdjustmentsByTitle, purgeHallucinatedWorkstreams, canonicalizeWorkstreamTitles, injectMissingWorkstreams, detectSowPhaseDrift, type SowPricingLine } from "./sow-pricing.ts";

// ---------------------------------------------------------------------------
// Unit tests — stripMarkdownFence()
// ---------------------------------------------------------------------------

describe("stripMarkdownFence() — no fence", () => {
  it("returns plain HTML unchanged", () => {
    const html = "<h1>Hello</h1><p>World</p>";
    expect(stripMarkdownFence(html)).toBe(html);
  });

  it("returns an empty string unchanged", () => {
    expect(stripMarkdownFence("")).toBe("");
  });

  it("trims leading/trailing whitespace on plain content", () => {
    expect(stripMarkdownFence("  <p>hi</p>  ")).toBe("<p>hi</p>");
  });
});

describe("stripMarkdownFence() — ```html fence", () => {
  it("strips ```html ... ``` wrapper", () => {
    const fenced = "```html\n<h1>Hello</h1>\n```";
    expect(stripMarkdownFence(fenced)).toBe("<h1>Hello</h1>");
  });

  it("strips ```html fence with no newline before closing fence", () => {
    const fenced = "```html\n<p>body</p>```";
    expect(stripMarkdownFence(fenced)).toBe("<p>body</p>");
  });

  it("strips ```html fence and removes surrounding whitespace", () => {
    const fenced = "```html\n  <p>indented</p>\n```";
    expect(stripMarkdownFence(fenced)).toBe("<p>indented</p>");
  });

  it("does not strip ``` that appears mid-string (only leading/trailing fences)", () => {
    const inner = "<p>some ``` text</p>";
    const fenced = "```html\n" + inner + "\n```";
    const result = stripMarkdownFence(fenced);
    expect(result.startsWith("```")).toBe(false);
    expect(result.endsWith("```")).toBe(false);
    expect(result).toContain("some ``` text");
  });
});

describe("stripMarkdownFence() — bare ``` fence", () => {
  it("strips bare ``` ... ``` wrapper", () => {
    const fenced = "```\n<div>content</div>\n```";
    expect(stripMarkdownFence(fenced)).toBe("<div>content</div>");
  });

  it("strips bare fence with no language tag", () => {
    const fenced = "```\n<p>hi</p>\n```";
    expect(stripMarkdownFence(fenced)).toBe("<p>hi</p>");
  });
});

describe("stripMarkdownFence() — fence with trailing whitespace", () => {
  it("strips closing ``` followed by spaces", () => {
    const fenced = "```html\n<p>x</p>\n```   ";
    expect(stripMarkdownFence(fenced)).toBe("<p>x</p>");
  });

  it("strips closing ``` followed by a newline and spaces", () => {
    const fenced = "```html\n<p>x</p>\n```\n  ";
    expect(stripMarkdownFence(fenced)).toBe("<p>x</p>");
  });

  it("strips closing ``` with mixed trailing whitespace", () => {
    const fenced = "```\n<span>ok</span>\n```  \t  ";
    expect(stripMarkdownFence(fenced)).toBe("<span>ok</span>");
  });
});

describe("stripMarkdownFence() — CRLF line endings", () => {
  it("strips ```html fence with CRLF after the opening tag", () => {
    const fenced = "```html\r\n<h1>Hello</h1>\r\n```";
    const result = stripMarkdownFence(fenced);
    expect(result).not.toMatch(/^```/);
    expect(result).not.toMatch(/```\s*$/);
    expect(result).toContain("<h1>Hello</h1>");
  });

  it("strips bare ``` fence with CRLF line endings", () => {
    const fenced = "```\r\n<p>CRLF content</p>\r\n```";
    const result = stripMarkdownFence(fenced);
    expect(result).not.toMatch(/^```/);
    expect(result).not.toMatch(/```\s*$/);
    expect(result).toContain("<p>CRLF content</p>");
  });

  it("strips closing ``` with CRLF after the fence", () => {
    const fenced = "```html\r\n<div>body</div>\n```\r\n";
    const result = stripMarkdownFence(fenced);
    expect(result).not.toMatch(/^```/);
    expect(result).not.toContain("```");
    expect(result).toContain("<div>body</div>");
  });
});

// ---------------------------------------------------------------------------
// Integration-path tests — extractAiHtml()
//
// extractAiHtml() is the single function called by every document-generation
// route in admin-insights.ts and document-generator.ts before the DB insert.
// If stripMarkdownFence() is removed from inside extractAiHtml(), these tests
// will fail — exactly what the task requires.
// ---------------------------------------------------------------------------

describe("extractAiHtml() — POST /generate path (report & SOW generation)", () => {
  it("strips ```html fence from Claude response and returns clean HTML", () => {
    const mockAiResponse = {
      content: [
        { text: "```html\n<html><body><h1>Report</h1></body></html>\n```" },
      ],
    };

    const htmlContent = extractAiHtml(mockAiResponse);

    expect(htmlContent.startsWith("```")).toBe(false);
    expect(htmlContent.endsWith("```")).toBe(false);
    expect(htmlContent).toContain("<h1>Report</h1>");
  });

  it("strips bare ``` fence from Claude SOW response", () => {
    const mockAiResponse = {
      content: [{ text: "```\n<section>SOW content</section>\n```" }],
    };

    const htmlContent = extractAiHtml(mockAiResponse);

    expect(htmlContent.startsWith("```")).toBe(false);
    expect(htmlContent.endsWith("```")).toBe(false);
    expect(htmlContent).toContain("<section>SOW content</section>");
  });

  it("passes through plain HTML from Claude response unchanged", () => {
    const rawHtml = "<html><body><p>Clean output</p></body></html>";
    const mockAiResponse = { content: [{ text: rawHtml }] };

    expect(extractAiHtml(mockAiResponse)).toBe(rawHtml);
  });

  it("handles undefined .text via ?? fallback — returns empty string, not an error", () => {
    const mockAiResponse = {
      content: [{ text: undefined as unknown as string }],
    };

    expect(extractAiHtml(mockAiResponse)).toBe("");
  });

  it("strips ```html fence with trailing whitespace on the closing fence", () => {
    const mockAiResponse = {
      content: [{ text: "```html\n<table><tr><td>$5,000</td></tr></table>\n```   " }],
    };

    const htmlContent = extractAiHtml(mockAiResponse);

    expect(htmlContent).not.toContain("```");
    expect(htmlContent).toContain("<table>");
  });
});

describe("extractAiHtml() — automation run path (scheduled report generation)", () => {
  it("strips ```html fence from automated report response", () => {
    const mockAiResponse = {
      content: [
        { text: "```html\n<article>\n  <h2>Automation Report</h2>\n</article>\n```  " },
      ],
    };

    const htmlContent = extractAiHtml(mockAiResponse);

    expect(htmlContent.startsWith("```")).toBe(false);
    expect(htmlContent.endsWith("```")).toBe(false);
    expect(htmlContent).toContain("<h2>Automation Report</h2>");
  });

  it("leaves clean HTML from automated generation untouched", () => {
    const rawHtml = "<article><h2>Monthly Summary</h2></article>";
    const mockAiResponse = { content: [{ text: rawHtml }] };

    expect(extractAiHtml(mockAiResponse)).toBe(rawHtml);
  });
});

describe("extractAiHtml() — document-generator path (generateDocument helper)", () => {
  it("strips ```html fence the same way as the route paths", () => {
    const mockAiResponse = {
      content: [{ text: "```html\n<html><body>SOW</body></html>\n```" }],
    };

    const htmlContent = extractAiHtml(mockAiResponse);

    expect(htmlContent).not.toContain("```");
    expect(htmlContent).toContain("<body>SOW</body>");
  });
});

// ---------------------------------------------------------------------------
// Unit tests — validateSowPricing()
// ---------------------------------------------------------------------------

/** Minimal SowPricingLine factory — only required fields. */
function ws(title: string, priceUsd: number): SowPricingLine {
  return { title, scope: "", priceUsd, notes: "" };
}

/**
 * Build the thinnest HTML snippet that contains a Grand Total row so that
 * the grand-total arithmetic check has something to parse.
 */
function htmlWithGrandTotal(total: number): string {
  return `<table><tr><td>Grand Total</td><td>$${total.toLocaleString("en-US")}</td></tr></table>`;
}

describe("validateSowPricing() — clean SOW (no violations)", () => {
  it("returns ok=true and empty issues for a perfectly valid SOW", () => {
    const workstreams = [
      ws("Governance Foundations", 18000),
      ws("Security Remediation", 22000),
    ];
    // Governance permits Governance Complexity; Security permits Tenant Size and Security/Compliance.
    const adjustments = [
      ws("Governance Complexity", 15000),
      ws("Tenant Size", 5000),
    ];
    const total = 18000 + 22000 + 15000 + 5000; // 60000
    const html = htmlWithGrandTotal(total);

    const result = validateSowPricing(workstreams, adjustments, html);

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("returns ok=true when there are no adjustment lines", () => {
    const workstreams = [ws("Copilot Adoption", 15000)];
    const html = htmlWithGrandTotal(15000);

    const result = validateSowPricing(workstreams, [], html);

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("returns ok=true when there are no workstream lines (grand-total check skipped)", () => {
    const result = validateSowPricing([], [], "<html></html>");

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

describe("validateSowPricing() — check 1: duplicate adjustment labels", () => {
  it("reports a duplicate when Complexity appears twice", () => {
    const workstreams = [
      ws("Security Remediation", 20000),
      ws("DLP Data Protection", 18000),
    ];
    // Both Security and DLP permit Complexity — AI erroneously includes it twice.
    const adjustments = [
      ws("Complexity Adjustment", 3000),
      ws("Complexity Adjustment", 3000),
    ];
    const total = 20000 + 18000 + 3000 + 3000; // 44000 (wrong — over-counted)
    const html = htmlWithGrandTotal(total);

    const result = validateSowPricing(workstreams, adjustments, html);

    expect(result.ok).toBe(false);
    const dupeIssue = result.issues.find(i => i.toLowerCase().includes("duplicate"));
    expect(dupeIssue).toBeTruthy();
    expect(dupeIssue).toContain("complexity adjustment");
    expect(dupeIssue).toContain("over-counts by $3,000");
  });

  it("reports a duplicate even when title casing differs", () => {
    const workstreams = [ws("Security Remediation", 20000)];
    const adjustments = [
      ws("Timeline Adjustment", 2000),
      ws("TIMELINE ADJUSTMENT", 2000), // same title, different case
    ];
    const html = htmlWithGrandTotal(24000);

    const result = validateSowPricing(workstreams, adjustments, html);

    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.includes("timeline adjustment"))).toBe(true);
  });

  it("reports all duplicates when more than one label is repeated", () => {
    const workstreams = [ws("Governance Foundations", 15000)];
    const adjustments = [
      ws("Complexity Adjustment", 1000),
      ws("Complexity Adjustment", 1000),
      ws("Timeline Adjustment", 500),
      ws("Timeline Adjustment", 500),
    ];
    const html = htmlWithGrandTotal(18000);

    const result = validateSowPricing(workstreams, adjustments, html);

    expect(result.ok).toBe(false);
    const dupeIssues = result.issues.filter(i => i.toLowerCase().includes("duplicate"));
    expect(dupeIssues).toHaveLength(2);
  });
});

describe("validateSowPricing() — check 2: grand total arithmetic", () => {
  it("reports a mismatch when the HTML grand total differs by more than $1", () => {
    const workstreams = [ws("Licensing Optimization", 12000)];
    const adjustments = [ws("Tenant Size Adjustment", 2000)];
    // HTML shows $16,000 but arithmetic gives $14,000 — a $2,000 error.
    const html = htmlWithGrandTotal(16000);

    const result = validateSowPricing(workstreams, adjustments, html);

    expect(result.ok).toBe(false);
    const arithmeticIssue = result.issues.find(i => i.toLowerCase().includes("arithmetic") || i.toLowerCase().includes("mismatch"));
    expect(arithmeticIssue).toBeTruthy();
  });

  it("passes when the HTML grand total matches the arithmetic sum exactly", () => {
    const workstreams = [ws("Licensing Optimization", 12000)];
    const adjustments = [ws("Tenant Size Adjustment", 2000)];
    const html = htmlWithGrandTotal(14000);

    const result = validateSowPricing(workstreams, adjustments, html);

    // The only check that could fire is the permitted-adjustment check.
    // Tenant Size is permitted for Licensing — so this should be clean.
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("passes when the HTML grand total is within $1 of the arithmetic sum (rounding tolerance)", () => {
    const workstreams = [ws("Copilot Adoption & Enablement", 10000)];
    const adjustments = [ws("Complexity Adjustment", 999)];
    // Computed = 10999; HTML shows 11000 — within the $1 tolerance.
    const html = htmlWithGrandTotal(11000);

    const result = validateSowPricing(workstreams, adjustments, html);

    const arithmeticIssue = result.issues.find(i => i.toLowerCase().includes("arithmetic") || i.toLowerCase().includes("mismatch"));
    expect(arithmeticIssue).toBeUndefined();
  });

  it("skips the arithmetic check when no Grand Total row is found in the HTML", () => {
    const workstreams = [ws("Governance Foundations", 5000)];
    const adjustments = [ws("Timeline Adjustment", 1000)];
    const html = "<table><tr><td>Scope</td><td>$5,000</td></tr></table>"; // no Grand Total

    const result = validateSowPricing(workstreams, adjustments, html);

    const arithmeticIssue = result.issues.find(i => i.toLowerCase().includes("arithmetic") || i.toLowerCase().includes("mismatch"));
    expect(arithmeticIssue).toBeUndefined();
  });
});

describe("validateSowPricing() — check 3: permitted adjustments for detected workstreams", () => {
  it("flags Copilot Readiness when only a Governance workstream is present", () => {
    const workstreams = [ws("Governance Foundations Package", 18000)];
    // Copilot Readiness is NOT permitted for governance-only engagements.
    const adjustments = [ws("Copilot Readiness Assessment", 4000)];
    const html = htmlWithGrandTotal(22000);

    const result = validateSowPricing(workstreams, adjustments, html);

    expect(result.ok).toBe(false);
    const permIssue = result.issues.find(i => i.toLowerCase().includes("unpermitted") || i.toLowerCase().includes("not in the allowed"));
    expect(permIssue).toBeTruthy();
    expect(permIssue?.toLowerCase()).toContain("copilot readiness");
  });

  it("allows Copilot Readiness when a Copilot workstream is present alongside Governance", () => {
    const workstreams = [
      ws("Governance Foundations Package", 18000),
      ws("Copilot Adoption & Enablement", 12000),
    ];
    // Governance permits Governance Complexity; Copilot permits Copilot Readiness.
    const adjustments = [
      ws("Governance Complexity", 15000),
      ws("Copilot Readiness Assessment", 10000),
    ];
    const total = 18000 + 12000 + 15000 + 10000; // 55000
    const html = htmlWithGrandTotal(total);

    const result = validateSowPricing(workstreams, adjustments, html);

    const permIssues = result.issues.filter(i => i.toLowerCase().includes("unpermitted"));
    expect(permIssues).toHaveLength(0);
  });

  it("flags Data Sprawl Adjustment for a Licensing-only engagement", () => {
    // Licensing only permits Tenant Size — Data Sprawl is never permitted.
    const workstreams = [ws("Licensing Optimization", 10000)];
    const adjustments = [ws("Data Sprawl Adjustment", 2000)];
    const html = htmlWithGrandTotal(12000);

    const result = validateSowPricing(workstreams, adjustments, html);

    expect(result.ok).toBe(false);
    expect(result.issues.some(i => i.toLowerCase().includes("data sprawl"))).toBe(true);
  });

  it("skips the permitted check when no workstream matches a canonical pattern", () => {
    // An unrecognised workstream title means we cannot determine allowed adjustments,
    // so the check is skipped entirely rather than flagging everything.
    const workstreams = [ws("Custom Bespoke Engagement", 20000)];
    const adjustments = [ws("Some Novel Adjustment", 5000)];
    const html = htmlWithGrandTotal(25000);

    const result = validateSowPricing(workstreams, adjustments, html);

    const permIssues = result.issues.filter(i => i.toLowerCase().includes("unpermitted"));
    expect(permIssues).toHaveLength(0);
  });
});

describe("validateSowPricing() — compound scenarios", () => {
  it("reports multiple violation types in a single call", () => {
    // Governance engagement: duplicate Complexity, wrong grand total, and an
    // unpermitted Copilot Readiness adjustment.
    const workstreams = [ws("Governance Foundations", 18000)];
    const adjustments = [
      ws("Complexity Adjustment", 2000),
      ws("Complexity Adjustment", 2000), // duplicate
      ws("Copilot Readiness Assessment", 3000), // unpermitted for governance
    ];
    // HTML grand total is also wrong: 18000+2000+2000+3000=25000 but HTML says 27000
    const html = htmlWithGrandTotal(27000);

    const result = validateSowPricing(workstreams, adjustments, html);

    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
    expect(result.issues.some(i => i.includes("duplicate") || i.includes("Duplicate"))).toBe(true);
    expect(result.issues.some(i => i.toLowerCase().includes("unpermitted") || i.toLowerCase().includes("not in the allowed"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateSowPricing() — corrected adjustment map (tighter rules)
// ---------------------------------------------------------------------------

describe("validateSowPricing() — corrected adjustment map", () => {
  it("flags Complexity Adjustment as unpermitted for a Security-only SOW", () => {
    const workstreams = [ws("Security Remediation", 28000)];
    // Generic Complexity is no longer permitted for any workstream.
    const adjustments = [ws("Complexity Adjustment", 15000)];
    const html = htmlWithGrandTotal(43000);

    const result = validateSowPricing(workstreams, adjustments, html);

    expect(result.ok).toBe(false);
    const issue = result.issues.find(i => i.toLowerCase().includes("unpermitted"));
    expect(issue).toBeTruthy();
    expect(issue?.toLowerCase()).toContain("complexity adjustment");
  });

  it("flags Tenant Size as unpermitted for a DLP-only SOW", () => {
    // DLP only permits Security/Compliance — Tenant Size is not allowed.
    const workstreams = [ws("Data Protection / DLP", 22000)];
    const adjustments = [ws("Tenant Size", 5000)];
    const html = htmlWithGrandTotal(27000);

    const result = validateSowPricing(workstreams, adjustments, html);

    expect(result.ok).toBe(false);
    const issue = result.issues.find(i => i.toLowerCase().includes("unpermitted"));
    expect(issue).toBeTruthy();
    expect(issue?.toLowerCase()).toContain("tenant size");
  });

  it("allows Security/Compliance for both Security and DLP workstreams", () => {
    const workstreams = [
      ws("Security Remediation", 28000),
      ws("DLP Data Protection", 22000),
    ];
    const adjustments = [ws("Security/Compliance", 10000)];
    const total = 28000 + 22000 + 10000; // 60000
    const html = htmlWithGrandTotal(total);

    const result = validateSowPricing(workstreams, adjustments, html);

    const permIssues = result.issues.filter(i => i.toLowerCase().includes("unpermitted"));
    expect(permIssues).toHaveLength(0);
  });

  it("flags Timeline Adjustment as unpermitted for a Governance SOW", () => {
    // Governance only permits Governance Complexity — Timeline is prohibited.
    const workstreams = [ws("Governance Remediation", 25000)];
    const adjustments = [ws("Timeline Adjustment", 8000)];
    const html = htmlWithGrandTotal(33000);

    const result = validateSowPricing(workstreams, adjustments, html);

    expect(result.ok).toBe(false);
    const issue = result.issues.find(i => i.toLowerCase().includes("unpermitted"));
    expect(issue).toBeTruthy();
    expect(issue?.toLowerCase()).toContain("timeline adjustment");
  });

  it("allows Governance Complexity for Governance SOW", () => {
    const workstreams = [ws("Governance Remediation", 25000)];
    const adjustments = [ws("Governance Complexity", 15000)];
    const total = 25000 + 15000; // 40000
    const html = htmlWithGrandTotal(total);

    const result = validateSowPricing(workstreams, adjustments, html);

    const permIssues = result.issues.filter(i => i.toLowerCase().includes("unpermitted"));
    expect(permIssues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseSowAllPricing() — combined single-table format
// ---------------------------------------------------------------------------

describe("parseSowAllPricing() — combined single-table format", () => {
  it("correctly classifies workstream and adjustment rows from a single combined table", () => {
    const html = `
      <table>
        <thead>
          <tr><th>Project/Workstream</th><th>Price (USD)</th></tr>
        </thead>
        <tbody>
          <tr><td>Governance Remediation</td><td>$25,000</td></tr>
          <tr><td>Security Remediation</td><td>$28,000</td></tr>
          <tr><td>Tenant Size</td><td>$5,000</td></tr>
          <tr><td>Security/Compliance</td><td>$10,000</td></tr>
          <tr><td>Grand Total</td><td>$68,000</td></tr>
        </tbody>
      </table>
    `;
    const { workstreamLines, adjustmentLines, computedTotal } = parseSowAllPricing(html);

    // parseSowAllPricing stores titles in original display-casing — use case-insensitive comparison
    const wsLower = workstreamLines.map(l => l.title.toLowerCase());
    const adjLower = adjustmentLines.map(l => l.title.toLowerCase());
    expect(wsLower).toContain("governance remediation");
    expect(wsLower).toContain("security remediation");
    expect(adjLower).toContain("tenant size");
    expect(adjLower.some(t => /security.*compliance/i.test(t))).toBe(true);
    expect(computedTotal).toBe(68000);
  });

  it("keeps deprecated adjustment types in adjustmentLines so they can be purged", () => {
    const html = `
      <table>
        <thead>
          <tr><th>Project/Workstream</th><th>Amount (USD)</th></tr>
        </thead>
        <tbody>
          <tr><td>Licensing Optimization</td><td>$8,000</td></tr>
          <tr><td>Complexity Adjustment</td><td>$15,000</td></tr>
          <tr><td>Timeline Adjustment</td><td>$8,000</td></tr>
        </tbody>
      </table>
    `;
    const { workstreamLines, adjustmentLines } = parseSowAllPricing(html);

    expect(workstreamLines.map(l => l.title.toLowerCase())).toContain("licensing optimization");
    // Deprecated types are classified as adjustment rows so purgeSowAdjustments
    // can identify and excise them.
    const adjTitles = adjustmentLines.map(l => l.title.toLowerCase());
    expect(adjTitles.some(t => t.includes("complexity"))).toBe(true);
    expect(adjTitles.some(t => t.includes("timeline"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// purgeAdjustmentsByTitle()
// ---------------------------------------------------------------------------

describe("purgeAdjustmentsByTitle()", () => {
  it("removes a non-permitted adjustment row from the HTML by title", () => {
    const html = `
      <table>
        <thead><tr><th>Adjustment Factor</th><th>Amount (USD)</th></tr></thead>
        <tbody>
          <tr><td>Governance Complexity</td><td>$15,000</td></tr>
          <tr><td>Tenant Size</td><td>$5,000</td></tr>
        </tbody>
      </table>
    `;
    // Governance SOW — only Governance Complexity is permitted; Tenant Size is not.
    const { html: result, removedTitles } = purgeAdjustmentsByTitle(html, ["Governance Remediation"]);

    expect(removedTitles.some(t => /tenant\s+size/i.test(t))).toBe(true);
    expect(removedTitles.some(t => /governance.*complexity/i.test(t))).toBe(false);
    expect(result).not.toMatch(/tenant size/i);
    expect(result).toMatch(/governance complexity/i);
  });

  it("is a no-op when no workstream title matches a canonical pattern", () => {
    const html = `<table><tr><td>Complexity</td><td>$5,000</td></tr></table>`;

    const { html: result, removedTitles } = purgeAdjustmentsByTitle(html, ["Unknown Bespoke Engagement"]);

    expect(removedTitles).toHaveLength(0);
    expect(result).toBe(html);
  });

  it("leaves permitted adjustments in place and removes unpermitted ones for Security SOW", () => {
    const html = `
      <table>
        <tbody>
          <tr><td>Tenant Size</td><td>$5,000</td></tr>
          <tr><td>Security/Compliance</td><td>$10,000</td></tr>
          <tr><td>Data Sprawl</td><td>$10,000</td></tr>
          <tr><td>Copilot Readiness</td><td>$10,000</td></tr>
        </tbody>
      </table>
    `;
    const { removedTitles } = purgeAdjustmentsByTitle(html, ["Security Remediation"]);

    // Tenant Size and Security/Compliance are permitted for Security — kept
    expect(removedTitles.some(t => /tenant\s+size/i.test(t))).toBe(false);
    expect(removedTitles.some(t => /security.*compliance/i.test(t))).toBe(false);
    // Data Sprawl and Copilot Readiness are not permitted — removed
    expect(removedTitles.some(t => /data\s+sprawl/i.test(t))).toBe(true);
    expect(removedTitles.some(t => /copilot\s+readiness/i.test(t))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Signal-authoritative phase alignment — purgeHallucinatedWorkstreams() / detectSowPhaseDrift()
// ---------------------------------------------------------------------------

describe("purgeHallucinatedWorkstreams()", () => {
  it("removes a workstream row whose title matches no fired-signal catalogue project", () => {
    const html = `
      <table>
        <thead><tr><th>Project/Workstream</th><th>Base Ceiling</th><th>Final Price (USD)</th></tr></thead>
        <tbody>
          <tr><td>Governance Modernization</td><td>$20,000</td><td>$18,000</td></tr>
          <tr><td>Copilot Readiness</td><td>$15,000</td><td>$15,000</td></tr>
        </tbody>
      </table>
    `;
    const workstreamLines: SowPricingLine[] = [
      { title: "Governance Modernization", scope: "", priceUsd: 18000, notes: "" },
      { title: "Copilot Readiness", scope: "", priceUsd: 15000, notes: "" },
    ];
    // Only Governance Modernization was signal-fired — Copilot Readiness is hallucinated.
    const { html: result, removedTitles } = purgeHallucinatedWorkstreams(html, workstreamLines, ["Governance Modernization"]);

    expect(removedTitles).toEqual(["Copilot Readiness"]);
    expect(result).toMatch(/Governance Modernization/);
    expect(result).not.toMatch(/Copilot Readiness/);
  });

  it("is a no-op when every workstream row matches a catalogue title", () => {
    const html = `<table><tr><td>Security Hardening</td><td>$10,000</td></tr></table>`;
    const workstreamLines: SowPricingLine[] = [
      { title: "Security Hardening", scope: "", priceUsd: 10000, notes: "" },
    ];
    const { html: result, removedTitles } = purgeHallucinatedWorkstreams(html, workstreamLines, ["Security Hardening"]);

    expect(removedTitles).toHaveLength(0);
    expect(result).toBe(html);
  });

  it("skips purging entirely when the catalogue is empty (never wipes out a whole SOW)", () => {
    const html = `<table><tr><td>Anything</td><td>$5,000</td></tr></table>`;
    const workstreamLines: SowPricingLine[] = [
      { title: "Anything", scope: "", priceUsd: 5000, notes: "" },
    ];
    const { html: result, removedTitles } = purgeHallucinatedWorkstreams(html, workstreamLines, []);

    expect(removedTitles).toHaveLength(0);
    expect(result).toBe(html);
  });

  it("tolerates minor AI title rewording via substring matching", () => {
    const html = `<table><tr><td>Governance Modernization Phase</td><td>$10,000</td></tr></table>`;
    const workstreamLines: SowPricingLine[] = [
      { title: "Governance Modernization Phase", scope: "", priceUsd: 10000, notes: "" },
    ];
    const { removedTitles } = purgeHallucinatedWorkstreams(html, workstreamLines, ["Governance Modernization"]);

    expect(removedTitles).toHaveLength(0);
  });
});

describe("detectSowPhaseDrift()", () => {
  it("reports no drift when workstream titles exactly match the catalogue", () => {
    const workstreamLines: SowPricingLine[] = [
      { title: "Governance Modernization", scope: "", priceUsd: 18000, notes: "" },
      { title: "Security Hardening", scope: "", priceUsd: 12000, notes: "" },
    ];
    const result = detectSowPhaseDrift(workstreamLines, ["Governance Modernization", "Security Hardening"]);

    expect(result.ok).toBe(true);
    expect(result.missingPhases).toHaveLength(0);
    expect(result.hallucinatedPhases).toHaveLength(0);
  });

  it("flags a catalogue project with no matching workstream row as missing", () => {
    const workstreamLines: SowPricingLine[] = [
      { title: "Governance Modernization", scope: "", priceUsd: 18000, notes: "" },
    ];
    const result = detectSowPhaseDrift(workstreamLines, ["Governance Modernization", "Compliance & Regulatory Alignment"]);

    expect(result.ok).toBe(false);
    expect(result.missingPhases).toEqual(["Compliance & Regulatory Alignment"]);
    expect(result.hallucinatedPhases).toHaveLength(0);
  });

  it("flags a workstream row with no matching catalogue project as hallucinated", () => {
    const workstreamLines: SowPricingLine[] = [
      { title: "Governance Modernization", scope: "", priceUsd: 18000, notes: "" },
      { title: "Bonus Consulting Hours", scope: "", priceUsd: 5000, notes: "" },
    ];
    const result = detectSowPhaseDrift(workstreamLines, ["Governance Modernization"]);

    expect(result.ok).toBe(false);
    expect(result.hallucinatedPhases).toEqual(["Bonus Consulting Hours"]);
    expect(result.missingPhases).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Hard enforcement — canonicalizeWorkstreamTitles() / injectMissingWorkstreams()
// ---------------------------------------------------------------------------

describe("canonicalizeWorkstreamTitles()", () => {
  it("rewrites a reworded AI title to the exact catalogue title in the HTML", () => {
    const html = `<table><tr><td>Governance Modernization Phase</td><td>$18,000</td></tr></table>`;
    const workstreamLines: SowPricingLine[] = [
      { title: "Governance Modernization Phase", scope: "", priceUsd: 18000, notes: "" },
    ];
    const { html: result, renamedTitles } = canonicalizeWorkstreamTitles(html, workstreamLines, ["Governance Modernization"]);

    expect(renamedTitles).toEqual([{ from: "Governance Modernization Phase", to: "Governance Modernization" }]);
    expect(result).toContain("<td>Governance Modernization</td>");
    expect(result).not.toContain("Governance Modernization Phase");
  });

  it("is a no-op when the title already exactly matches the catalogue", () => {
    const html = `<table><tr><td>Security Hardening</td><td>$10,000</td></tr></table>`;
    const workstreamLines: SowPricingLine[] = [
      { title: "Security Hardening", scope: "", priceUsd: 10000, notes: "" },
    ];
    const { html: result, renamedTitles } = canonicalizeWorkstreamTitles(html, workstreamLines, ["Security Hardening"]);

    expect(renamedTitles).toHaveLength(0);
    expect(result).toBe(html);
  });

  it("is a no-op when the catalogue is empty", () => {
    const html = `<table><tr><td>Anything</td><td>$5,000</td></tr></table>`;
    const workstreamLines: SowPricingLine[] = [
      { title: "Anything", scope: "", priceUsd: 5000, notes: "" },
    ];
    const { html: result, renamedTitles } = canonicalizeWorkstreamTitles(html, workstreamLines, []);

    expect(renamedTitles).toHaveLength(0);
    expect(result).toBe(html);
  });
});

describe("injectMissingWorkstreams()", () => {
  it("injects a synthetic row for a fired-signal catalogue project the AI omitted", () => {
    const html = `
      <table>
        <thead><tr><th>Project/Workstream</th><th>Base Ceiling</th><th>Final Price (USD)</th></tr></thead>
        <tbody>
          <tr><td>Governance Modernization</td><td>$8,000–$25,000</td><td>$18,000</td></tr>
        </tbody>
      </table>
    `;
    const workstreamLines: SowPricingLine[] = [
      { title: "Governance Modernization", scope: "", priceUsd: 18000, notes: "" },
    ];
    const catalogProjects = [
      { title: "Governance Modernization", priceRange: "$8,000–$25,000" },
      { title: "Security Hardening", priceRange: "$9,000–$28,000" },
    ];
    const { html: result, injected } = injectMissingWorkstreams(html, workstreamLines, catalogProjects);

    expect(injected).toHaveLength(1);
    expect(injected[0]!.title).toBe("Security Hardening");
    expect(injected[0]!.priceUsd).toBe(18500);
    expect(result).toContain("Security Hardening");

    const reparsed = parseSowAllPricing(result);
    expect(reparsed.workstreamLines.map(l => l.title)).toEqual(
      expect.arrayContaining(["Governance Modernization", "Security Hardening"]),
    );
  });

  it("is a no-op when every catalogue project already has a matching row", () => {
    const html = `<table><thead><tr><th>Workstream</th><th>Final Price (USD)</th></tr></thead><tbody><tr><td>Governance Modernization</td><td>$18,000</td></tr></tbody></table>`;
    const workstreamLines: SowPricingLine[] = [
      { title: "Governance Modernization", scope: "", priceUsd: 18000, notes: "" },
    ];
    const catalogProjects = [{ title: "Governance Modernization", priceRange: "$8,000–$25,000" }];
    const { html: result, injected } = injectMissingWorkstreams(html, workstreamLines, catalogProjects);

    expect(injected).toHaveLength(0);
    expect(result).toBe(html);
  });

  it("returns the injected list even when no workstream table can be located, so callers can fail loudly", () => {
    const html = `<p>No table here at all.</p>`;
    const workstreamLines: SowPricingLine[] = [];
    const catalogProjects = [{ title: "Governance Modernization", priceRange: "$8,000–$25,000" }];
    const { html: result, injected } = injectMissingWorkstreams(html, workstreamLines, catalogProjects);

    expect(injected).toHaveLength(1);
    expect(result).toBe(html);
  });
});

describe("full enforcement pipeline — canonicalize + inject guarantees zero drift", () => {
  it("purge -> canonicalize -> inject -> detectSowPhaseDrift always reports ok:true against a real catalogue shape", () => {
    const catalogProjects = [
      { title: "Copilot for Microsoft 365 Deployment Project", priceRange: "$12,000–$30,000" },
      { title: "Governance Remediation & Architecture Hardening", priceRange: "$8,000–$25,000" },
      { title: "Security & Compliance Hardening for Microsoft 365", priceRange: "$9,000–$28,000" },
    ];
    const catalogTitles = catalogProjects.map(p => p.title);

    // AI output: hallucinates one extra phase, reworks one title, and omits one required phase.
    const html = `
      <table>
        <thead><tr><th>Project/Workstream</th><th>Base Ceiling</th><th>Final Price (USD)</th></tr></thead>
        <tbody>
          <tr><td>Copilot for Microsoft 365 Deployment</td><td>$12,000–$30,000</td><td>$20,000</td></tr>
          <tr><td>Governance Remediation & Architecture Hardening</td><td>$8,000–$25,000</td><td>$18,000</td></tr>
          <tr><td>Bonus Executive Workshop Series</td><td>$5,000–$10,000</td><td>$5,000</td></tr>
        </tbody>
      </table>
    `;

    const { workstreamLines: rawWs } = parseSowAllPricing(html);
    const { html: h1 } = purgeHallucinatedWorkstreams(html, rawWs, catalogTitles);
    const { workstreamLines: wsAfterPurge } = parseSowAllPricing(h1);
    const { html: h2 } = canonicalizeWorkstreamTitles(h1, wsAfterPurge, catalogTitles);
    const { html: h3 } = injectMissingWorkstreams(h2, wsAfterPurge, catalogProjects);

    const final = parseSowAllPricing(h3);
    const drift = detectSowPhaseDrift(final.workstreamLines, catalogTitles);

    expect(drift.ok).toBe(true);
    expect(drift.missingPhases).toHaveLength(0);
    expect(drift.hallucinatedPhases).toHaveLength(0);
    // Canonical title must appear verbatim, not the AI's reworded version.
    expect(h3).toContain("Copilot for Microsoft 365 Deployment Project");
    expect(h3).not.toContain("Bonus Executive Workshop Series");
    expect(h3).toContain("Security & Compliance Hardening for Microsoft 365");
  });
});
