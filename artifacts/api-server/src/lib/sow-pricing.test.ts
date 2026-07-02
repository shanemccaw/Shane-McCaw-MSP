/**
 * Tests for stripMarkdownFence() and extractAiHtml() in sow-pricing.ts.
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
import { stripMarkdownFence, extractAiHtml } from "./sow-pricing.ts";

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
