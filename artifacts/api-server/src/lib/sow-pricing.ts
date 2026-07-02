export interface SowPricingLine {
  title: string;
  scope: string;
  priceUsd: number;
  notes: string;
}

/**
 * Strip markdown code fences that Claude sometimes wraps around HTML output.
 * Handles ```html ... ```, ``` ... ```, and any leading/trailing whitespace.
 */
export function stripMarkdownFence(text: string): string {
  return text
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
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
