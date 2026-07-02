/**
 * Chromium-based PDF generation for AI insights documents.
 *
 * Uses the system Chromium binary (installed via Nix) with --print-to-pdf,
 * rendering the same HTML + CSS + Inter font as the client-side iframe.
 * This ensures complete visual parity — tables, headings, blockquotes, and
 * colours all match the in-app preview without any lossy reconstruction.
 */

import { spawn } from "child_process";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { execSync } from "child_process";

// ── Chromium path discovery ────────────────────────────────────────────────────

let _chromiumPath: string | null = null;

function getChromiumPath(): string {
  if (_chromiumPath) return _chromiumPath;

  // 1. Try PATH (works when the Nix module added it to PATH)
  try {
    const which = execSync("which chromium 2>/dev/null", { encoding: "utf8" }).trim();
    if (which) { _chromiumPath = which; return which; }
  } catch { /* not in PATH */ }

  // 2. Scan /nix/store for any installed chromium build
  try {
    const nixEntry = execSync(
      "ls /nix/store 2>/dev/null | grep '^chromium-' | head -1",
      { encoding: "utf8" },
    ).trim();
    if (nixEntry) {
      _chromiumPath = `/nix/store/${nixEntry}/bin/chromium`;
      return _chromiumPath;
    }
  } catch { /* /nix/store not available */ }

  throw new Error(
    "Chromium not found. Install with: installSystemDependencies({ packages: ['chromium'] })",
  );
}

// ── Document CSS ───────────────────────────────────────────────────────────────
// Exact copy of DOC_CSS from DocumentPanel.tsx with added @page / print rules.
// Keep in sync if the iframe CSS is updated.

const DOC_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.8;
    color: #1e293b;
    background: #fff;
  }
  h1 {
    font-size: 1.75rem; font-weight: 800; color: #0A2540;
    margin: 0 0 0.25rem; letter-spacing: -0.02em; line-height: 1.2;
  }
  h1 + p, h1 + div { margin-top: 0.75rem; }
  h2 {
    font-weight: 700; color: #0078D4; margin: 2.25rem 0 0.6rem;
    text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.08em;
    padding-bottom: 0.35rem; border-bottom: 1px solid #e2e8f0;
  }
  h3 { font-size: 1rem; font-weight: 700; color: #0A2540; margin: 1.5rem 0 0.4rem; }
  h4 { font-size: 0.875rem; font-weight: 600; color: #334155; margin: 1.25rem 0 0.35rem; }
  p { margin: 0 0 0.875rem; color: #334155; line-height: 1.8; }
  ul, ol { margin: 0.25rem 0 1rem 1.5rem; padding: 0; color: #334155; }
  li { margin-bottom: 0.3rem; line-height: 1.7; }
  table {
    width: 100%; border-collapse: collapse;
    margin: 1rem 0 1.5rem; font-size: 0.85rem;
  }
  thead tr { background: #f1f5f9; border-bottom: 2px solid #cbd5e1; }
  th {
    text-align: left; padding: 0.55rem 0.75rem; font-weight: 600;
    color: #475569; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em;
  }
  td {
    padding: 0.55rem 0.75rem; color: #334155;
    border-bottom: 1px solid #f1f5f9; vertical-align: top;
  }
  tr:last-child td { border-bottom: none; }
  blockquote {
    border-left: 3px solid #0078D4; background: #f8fafc;
    padding: 0.875rem 1.125rem; margin: 0.75rem 0 1.25rem;
    border-radius: 0 6px 6px 0; color: #475569;
  }
  blockquote p { margin: 0; color: #475569; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.75rem 0; }
  strong, b { font-weight: 600; color: #0A2540; }
  code {
    font-family: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.8em; background: #f1f5f9; color: #0078D4;
    padding: 0.15em 0.4em; border-radius: 4px;
  }
  pre {
    background: #0f172a; color: #e2e8f0; padding: 1rem 1.25rem;
    border-radius: 8px; overflow-x: auto; margin: 1rem 0; font-size: 0.82rem;
  }
  pre code { background: transparent; color: inherit; padding: 0; }
  a { color: #0078D4; text-decoration: none; }
  section { margin-bottom: 1.5rem; }

  /* Print / PDF settings */
  @page {
    size: A4;
    margin: 18mm 22mm;
  }
  @media print {
    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    table { page-break-inside: avoid; }
    h2, h3, h4 { page-break-after: avoid; }
  }
`;

// ── HTML helpers ───────────────────────────────────────────────────────────────

/** Strip markdown code fences that AI sometimes adds around HTML output. */
function stripFence(html: string): string {
  return html.replace(/^```[a-zA-Z]*\r?\n?/, "").replace(/\r?\n?```\s*$/, "").trim();
}

/** Remove inline style attributes (mirrors cleanInlineStyles in DocumentPanel). */
function cleanInlineStyles(html: string): string {
  return html
    .replace(/\s+style="[^"]*"/gi, "")
    .replace(/\s+style='[^']*'/gi, "");
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Build a complete print-ready HTML document from raw AI-generated HTML.
 * Applies the same CSS and Google Fonts link as the CRM iframe.
 */
export function buildHtmlDoc(rawHtml: string): string {
  const body = cleanInlineStyles(stripFence(rawHtml));
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <link rel="preconnect" href="https://fonts.googleapis.com">',
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">',
    `  <style>${DOC_CSS}</style>`,
    "</head>",
    `<body>${body}</body>`,
    "</html>",
  ].join("\n");
}

/**
 * Render an HTML string to PDF using the system Chromium binary.
 *
 * Writes the HTML to a temp file, launches Chromium in headless mode with
 * --print-to-pdf, reads the output, cleans up, and returns the PDF bytes.
 */
export async function htmlToPdf(htmlContent: string): Promise<Buffer> {
  const chromiumPath = getChromiumPath();

  const dir = await mkdtemp(path.join(tmpdir(), "insight-pdf-"));
  const htmlFile = path.join(dir, "doc.html");
  const pdfFile  = path.join(dir, "doc.pdf");

  try {
    await writeFile(htmlFile, htmlContent, "utf8");

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(chromiumPath, [
        "--headless=new",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        `--print-to-pdf=${pdfFile}`,
        "--print-to-pdf-no-header",
        `file://${htmlFile}`,
      ]);

      let stderr = "";
      proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      const kill = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("Chromium PDF generation timed out after 30 s"));
      }, 30_000);

      proc.on("close", (code) => {
        clearTimeout(kill);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Chromium exited ${code}. stderr: ${stderr.slice(-800)}`));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(kill);
        reject(new Error(`Failed to spawn Chromium at ${chromiumPath}: ${(err as Error).message}`));
      });
    });

    return await readFile(pdfFile);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
