/**
 * Tests for stripMarkdownFence() and extractAiHtml() in sow-pricing.ts.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 *
 * Uses the Node.js built-in test runner (node:test) and
 * --experimental-strip-types so no transpile step is needed.
 *
 * WHY extractAiHtml is the key regression guard
 * ---------------------------------------------
 * All document-generation routes (POST /generate, automation run, SOW
 * generation, document regeneration) call extractAiHtml() before the DB
 * insert.  Testing extractAiHtml() directly means any removal of the
 * stripMarkdownFence() call inside it will cause these tests to fail —
 * matching the intent of the integration path tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripMarkdownFence, extractAiHtml } from "./sow-pricing.ts";

// ---------------------------------------------------------------------------
// Unit tests — stripMarkdownFence()
// ---------------------------------------------------------------------------

describe("stripMarkdownFence() — no fence", () => {
  it("returns plain HTML unchanged", () => {
    const html = "<h1>Hello</h1><p>World</p>";
    assert.equal(stripMarkdownFence(html), html);
  });

  it("returns an empty string unchanged", () => {
    assert.equal(stripMarkdownFence(""), "");
  });

  it("trims leading/trailing whitespace on plain content", () => {
    assert.equal(stripMarkdownFence("  <p>hi</p>  "), "<p>hi</p>");
  });
});

describe("stripMarkdownFence() — ```html fence", () => {
  it("strips ```html ... ``` wrapper", () => {
    const fenced = "```html\n<h1>Hello</h1>\n```";
    assert.equal(stripMarkdownFence(fenced), "<h1>Hello</h1>");
  });

  it("strips ```html fence with no newline before closing fence", () => {
    const fenced = "```html\n<p>body</p>```";
    assert.equal(stripMarkdownFence(fenced), "<p>body</p>");
  });

  it("strips ```html fence and removes surrounding whitespace", () => {
    const fenced = "```html\n  <p>indented</p>\n```";
    assert.equal(stripMarkdownFence(fenced), "<p>indented</p>");
  });

  it("does not strip ``` that appears mid-string (only leading/trailing fences)", () => {
    const inner = "<p>some ``` text</p>";
    const fenced = "```html\n" + inner + "\n```";
    const result = stripMarkdownFence(fenced);
    assert.ok(!result.startsWith("```"), "leading fence not removed");
    assert.ok(!result.endsWith("```"), "trailing fence not removed");
    assert.ok(result.includes("some ``` text"), "inner ``` preserved");
  });
});

describe("stripMarkdownFence() — bare ``` fence", () => {
  it("strips bare ``` ... ``` wrapper", () => {
    const fenced = "```\n<div>content</div>\n```";
    assert.equal(stripMarkdownFence(fenced), "<div>content</div>");
  });

  it("strips bare fence with no language tag", () => {
    const fenced = "```\n<p>hi</p>\n```";
    assert.equal(stripMarkdownFence(fenced), "<p>hi</p>");
  });
});

describe("stripMarkdownFence() — fence with trailing whitespace", () => {
  it("strips closing ``` followed by spaces", () => {
    const fenced = "```html\n<p>x</p>\n```   ";
    assert.equal(stripMarkdownFence(fenced), "<p>x</p>");
  });

  it("strips closing ``` followed by a newline and spaces", () => {
    const fenced = "```html\n<p>x</p>\n```\n  ";
    assert.equal(stripMarkdownFence(fenced), "<p>x</p>");
  });

  it("strips closing ``` with mixed trailing whitespace", () => {
    const fenced = "```\n<span>ok</span>\n```  \t  ";
    assert.equal(stripMarkdownFence(fenced), "<span>ok</span>");
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

    assert.ok(!htmlContent.startsWith("```"), "leading ``` must be stripped");
    assert.ok(!htmlContent.endsWith("```"), "trailing ``` must be stripped");
    assert.ok(htmlContent.includes("<h1>Report</h1>"), "HTML content is preserved");
  });

  it("strips bare ``` fence from Claude SOW response", () => {
    const mockAiResponse = {
      content: [{ text: "```\n<section>SOW content</section>\n```" }],
    };

    const htmlContent = extractAiHtml(mockAiResponse);

    assert.ok(!htmlContent.startsWith("```"), "leading ``` must be stripped");
    assert.ok(!htmlContent.endsWith("```"), "trailing ``` must be stripped");
    assert.ok(htmlContent.includes("<section>SOW content</section>"), "HTML content is preserved");
  });

  it("passes through plain HTML from Claude response unchanged", () => {
    const rawHtml = "<html><body><p>Clean output</p></body></html>";
    const mockAiResponse = { content: [{ text: rawHtml }] };

    assert.equal(extractAiHtml(mockAiResponse), rawHtml);
  });

  it("handles undefined .text via ?? fallback — returns empty string, not an error", () => {
    const mockAiResponse = {
      content: [{ text: undefined as unknown as string }],
    };

    assert.equal(extractAiHtml(mockAiResponse), "");
  });

  it("strips ```html fence with trailing whitespace on the closing fence", () => {
    const mockAiResponse = {
      content: [{ text: "```html\n<table><tr><td>$5,000</td></tr></table>\n```   " }],
    };

    const htmlContent = extractAiHtml(mockAiResponse);

    assert.ok(!htmlContent.includes("```"), "no fence characters remain");
    assert.ok(htmlContent.includes("<table>"), "table HTML is preserved");
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

    assert.ok(!htmlContent.startsWith("```"), "leading fence stripped");
    assert.ok(!htmlContent.endsWith("```"), "trailing fence stripped");
    assert.ok(htmlContent.includes("<h2>Automation Report</h2>"), "content preserved");
  });

  it("leaves clean HTML from automated generation untouched", () => {
    const rawHtml = "<article><h2>Monthly Summary</h2></article>";
    const mockAiResponse = { content: [{ text: rawHtml }] };

    assert.equal(extractAiHtml(mockAiResponse), rawHtml);
  });
});

describe("extractAiHtml() — document-generator path (generateDocument helper)", () => {
  it("strips ```html fence the same way as the route paths", () => {
    const mockAiResponse = {
      content: [{ text: "```html\n<html><body>SOW</body></html>\n```" }],
    };

    const htmlContent = extractAiHtml(mockAiResponse);

    assert.ok(!htmlContent.includes("```"), "no fence characters in result");
    assert.ok(htmlContent.includes("<body>SOW</body>"), "body HTML preserved");
  });
});
