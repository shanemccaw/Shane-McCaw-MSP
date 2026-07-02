import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ── Element model ──────────────────────────────────────────────────────────────

export type PdfEl =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "h4"; text: string }
  | { kind: "p";  text: string }
  | { kind: "li"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "table"; headers: string[]; rows: string[][] };

// ── HTML helpers ───────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(
    html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  );
}

/** Replace characters pdf-lib's StandardFonts (Helvetica / Latin-1) cannot encode. */
function sanitize(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── HTML → element parser ──────────────────────────────────────────────────────

export function parseInsightHtml(rawHtml: string): PdfEl[] {
  const html = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const matches: Array<{ pos: number; el: PdfEl }> = [];

  // Headings h1–h4
  for (const m of html.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const level = parseInt(m[1] ?? "1") as 1 | 2 | 3 | 4;
    const text = sanitize(stripTags(m[2] ?? ""));
    if (text)
      matches.push({
        pos: m.index!,
        el: { kind: `h${level}` as "h1" | "h2" | "h3" | "h4", text },
      });
  }

  // Paragraphs
  for (const m of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = sanitize(stripTags(m[1] ?? ""));
    if (text) matches.push({ pos: m.index!, el: { kind: "p", text } });
  }

  // List items
  for (const m of html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = sanitize(stripTags(m[1] ?? ""));
    if (text) matches.push({ pos: m.index!, el: { kind: "li", text } });
  }

  // Blockquotes
  for (const m of html.matchAll(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi)) {
    const text = sanitize(stripTags(m[1] ?? ""));
    if (text) matches.push({ pos: m.index!, el: { kind: "quote", text } });
  }

  // Horizontal rules
  for (const m of html.matchAll(/<hr[^>]*\/?>/gi)) {
    matches.push({ pos: m.index!, el: { kind: "rule" } });
  }

  // Tables — deduplicate by removing cell/row matches that fall inside a table
  const tableRanges: Array<{ start: number; end: number }> = [];
  for (const m of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableHtml = m[1] ?? "";
    const headers: string[] = [];
    const theadM = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
    if (theadM) {
      for (const th of (theadM[1] ?? "").matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)) {
        const text = sanitize(stripTags(th[1] ?? ""));
        if (text) headers.push(text);
      }
    }
    const rows: string[][] = [];
    const tbodyM = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    const rowsHtml = tbodyM ? (tbodyM[1] ?? "") : tableHtml;
    for (const tr of rowsHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells: string[] = [];
      for (const td of (tr[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)) {
        cells.push(sanitize(stripTags(td[1] ?? "")));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (headers.length > 0 || rows.length > 0) {
      const pos = m.index!;
      const end = pos + m[0].length;
      tableRanges.push({ start: pos, end });
      matches.push({ pos, el: { kind: "table", headers, rows } });
    }
  }

  // Sort and de-duplicate: remove li/p matches that are inside a table range
  const finalMatches = matches.filter((item) => {
    if (item.el.kind === "li" || item.el.kind === "p") {
      return !tableRanges.some(
        (r) => item.pos >= r.start && item.pos <= r.end,
      );
    }
    return true;
  });

  finalMatches.sort((a, b) => a.pos - b.pos);
  return finalMatches.map((m) => m.el);
}

// ── PDF constants ──────────────────────────────────────────────────────────────

const NAVY   = rgb(0.039, 0.145, 0.251); // #0A2540
const BLUE   = rgb(0,     0.471, 0.831); // #0078D4
const GREY   = rgb(0.45,  0.45,  0.45);
const SLATE  = rgb(0.20,  0.25,  0.34);  // #334155
const WHITE  = rgb(1, 1, 1);
const LIGHT  = rgb(0.97,  0.98,  0.99);
const RULE_C = rgb(0.88,  0.90,  0.93);

const PAGE_W   = 595;
const PAGE_H   = 842;
const MARGIN   = 55;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Approximate max characters that fit per line at a given font size (Helvetica).
// Helvetica average char width ≈ fontSize * 0.55.
const charsPerLine = (fontSize: number, availableWidth = CONTENT_W): number =>
  Math.floor(availableWidth / (fontSize * 0.55));

// ── Text wrapping ──────────────────────────────────────────────────────────────

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      // Force-break a word that is itself too long
      line = word.length > maxChars ? word.slice(0, maxChars) : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

// ── PDF builder ────────────────────────────────────────────────────────────────

export async function buildInsightPdf(
  title: string,
  docTypeLabel: string,
  createdAt: string | null,
  elements: PdfEl[],
): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y    = PAGE_H;

  // ── Running header ───────────────────────────────────────────────────────────
  const drawRunningHeader = () => {
    page.drawRectangle({ x: 0, y: PAGE_H - 22, width: PAGE_W, height: 22, color: NAVY });
    page.drawText("Shane McCaw Consulting", {
      x: MARGIN, y: PAGE_H - 15, font: bold, size: 8.5, color: WHITE,
    });
    page.drawText("Assessment Document  \u2014  Confidential", {
      x: PAGE_W - MARGIN - 165, y: PAGE_H - 15, font: reg, size: 8.5,
      color: rgb(0.60, 0.75, 0.90),
    });
  };

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    drawRunningHeader();
    y = PAGE_H - 22 - 18; // below header + 18 px padding
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < 58) newPage();
  };

  const dt = (
    text: string,
    x: number,
    yy: number,
    opts: { font?: typeof bold; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
    const safe = sanitize(text);
    if (!safe) return;
    page.drawText(safe, {
      x,
      y: yy,
      font:  opts.font  ?? reg,
      size:  opts.size  ?? 10,
      color: opts.color ?? SLATE,
    });
  };

  // ── Cover / title block ──────────────────────────────────────────────────────
  drawRunningHeader();
  y = PAGE_H - 22 - 20; // 800

  // Blue accent left bar (behind title)
  page.drawRectangle({ x: MARGIN, y: y - 50, width: 4, height: 62, color: BLUE });

  // Title (may wrap)
  const titleLines = wrapText(sanitize(title), charsPerLine(18));
  for (const line of titleLines) {
    dt(line, MARGIN + 12, y, { font: bold, size: 18, color: NAVY });
    y -= 24;
  }

  // Doc type label
  dt(sanitize(docTypeLabel), MARGIN + 12, y, { font: bold, size: 11, color: BLUE });
  y -= 16;

  // Generated date
  if (createdAt) {
    const dateStr = new Date(createdAt).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
    dt(`Generated ${dateStr}`, MARGIN + 12, y, { size: 9, color: GREY });
    y -= 14;
  }

  // Rule below title block
  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.5, color: BLUE });
  y -= 22;

  // ── Render elements ──────────────────────────────────────────────────────────
  for (const el of elements) {
    switch (el.kind) {
      case "h1": {
        const lines = wrapText(el.text, charsPerLine(15));
        ensureSpace(lines.length * 22 + 12);
        y -= 8;
        for (const line of lines) {
          dt(line, MARGIN, y, { font: bold, size: 15, color: NAVY });
          y -= 22;
        }
        y -= 4;
        break;
      }

      case "h2": {
        ensureSpace(32);
        y -= 10;
        dt(el.text.toUpperCase(), MARGIN, y, { font: bold, size: 8, color: BLUE });
        y -= 8;
        page.drawLine({
          start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y },
          thickness: 0.5, color: RULE_C,
        });
        y -= 14;
        break;
      }

      case "h3": {
        const lines = wrapText(el.text, charsPerLine(11));
        ensureSpace(lines.length * 16 + 10);
        y -= 6;
        for (const line of lines) {
          dt(line, MARGIN, y, { font: bold, size: 11, color: NAVY });
          y -= 16;
        }
        y -= 4;
        break;
      }

      case "h4": {
        const lines = wrapText(el.text, charsPerLine(10));
        ensureSpace(lines.length * 14 + 6);
        y -= 4;
        for (const line of lines) {
          dt(line, MARGIN, y, { font: bold, size: 10, color: SLATE });
          y -= 14;
        }
        y -= 2;
        break;
      }

      case "p": {
        if (!el.text) break;
        const lines = wrapText(el.text, charsPerLine(10));
        for (const line of lines) {
          ensureSpace(14);
          dt(line, MARGIN, y, { size: 10, color: SLATE });
          y -= 14;
        }
        y -= 4;
        break;
      }

      case "li": {
        if (!el.text) break;
        const lines = wrapText(el.text, charsPerLine(10, CONTENT_W - 16));
        for (let i = 0; i < lines.length; i++) {
          ensureSpace(14);
          if (i === 0) {
            // Filled square bullet
            page.drawRectangle({ x: MARGIN + 6, y: y + 3, width: 3, height: 3, color: BLUE });
          }
          dt(lines[i], MARGIN + 15, y, { size: 10, color: SLATE });
          y -= 13;
        }
        y -= 2;
        break;
      }

      case "quote": {
        if (!el.text) break;
        const lines = wrapText(el.text, charsPerLine(10, CONTENT_W - 22));
        const blockH = lines.length * 14 + 14;
        ensureSpace(blockH + 6);
        // Light background
        page.drawRectangle({ x: MARGIN + 3, y: y - blockH + 12, width: CONTENT_W - 3, height: blockH, color: LIGHT });
        // Blue left bar
        page.drawRectangle({ x: MARGIN, y: y - blockH + 12, width: 3, height: blockH, color: BLUE });
        y -= 8;
        for (const line of lines) {
          ensureSpace(14);
          dt(line, MARGIN + 15, y, { size: 10, color: GREY });
          y -= 14;
        }
        y -= 8;
        break;
      }

      case "rule": {
        ensureSpace(18);
        y -= 8;
        page.drawLine({
          start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y },
          thickness: 0.5, color: RULE_C,
        });
        y -= 12;
        break;
      }

      case "table": {
        const { headers, rows } = el;
        if (headers.length === 0 && rows.length === 0) break;

        const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
        const colW = Math.floor(CONTENT_W / colCount);
        const maxCellChars = Math.max(8, Math.floor(colW / 5.5));

        // Header row
        if (headers.length > 0) {
          ensureSpace(22);
          page.drawRectangle({ x: MARGIN, y: y - 6, width: CONTENT_W, height: 20, color: rgb(0.93, 0.95, 0.98) });
          page.drawLine({
            start: { x: MARGIN, y: y - 6 }, end: { x: PAGE_W - MARGIN, y: y - 6 },
            thickness: 1.5, color: BLUE,
          });
          headers.forEach((h, i) => {
            const cell = h.length > maxCellChars ? `${h.slice(0, maxCellChars - 1)}\u2026` : h;
            dt(cell.toUpperCase(), MARGIN + i * colW + 5, y, { font: bold, size: 7.5, color: GREY });
          });
          y -= 22;
        }

        // Data rows
        for (let ri = 0; ri < rows.length; ri++) {
          const row = rows[ri];
          ensureSpace(18);
          if (ri % 2 === 0) {
            page.drawRectangle({ x: MARGIN, y: y - 5, width: CONTENT_W, height: 18, color: rgb(0.985, 0.99, 1) });
          }
          row.forEach((cell, ci) => {
            const cellText = cell.length > maxCellChars ? `${cell.slice(0, maxCellChars - 1)}\u2026` : cell;
            dt(cellText, MARGIN + ci * colW + 5, y, { size: 9, color: SLATE });
          });
          page.drawLine({
            start: { x: MARGIN, y: y - 5 }, end: { x: PAGE_W - MARGIN, y: y - 5 },
            thickness: 0.3, color: RULE_C,
          });
          y -= 17;
        }
        y -= 10;
        break;
      }
    }
  }

  // ── Footer on last page ──────────────────────────────────────────────────────
  if (y > 55) {
    page.drawLine({ start: { x: MARGIN, y: 44 }, end: { x: PAGE_W - MARGIN, y: 44 }, thickness: 0.5, color: RULE_C });
    dt(
      "Shane McCaw Consulting  \u00B7  Confidential  \u00B7  shanemccawconsulting.com",
      MARGIN, 32, { size: 8, color: GREY },
    );
  }

  return doc.save();
}
