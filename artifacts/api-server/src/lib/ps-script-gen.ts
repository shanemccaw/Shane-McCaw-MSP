/**
 * Shared PowerShell script parsing/extraction helpers, used by the
 * Admin Panel's PowerShell script editor routes (`admin-ps-scripts.ts`).
 */

// ─── Shared parsing helpers ───────────────────────────────────────────────────

export function normalizeAppPerms(raw: unknown[]): { scope: string; reason: string }[] {
  return raw
    .map((entry): { scope: string; reason: string } | null => {
      if (typeof entry === "string") return { scope: entry, reason: "" };
      if (entry !== null && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        return { scope: String(e["scope"] ?? ""), reason: String(e["reason"] ?? "") };
      }
      return null;
    })
    .filter((e): e is { scope: string; reason: string } => e !== null && e.scope !== "");
}

// LLMs sometimes emit literal (unescaped) newlines / tabs inside JSON string
// values, making the payload invalid JSON. Walk the raw text and escape any
// control characters that appear inside a string token.
function repairJsonStrings(raw: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === "\\") { out += ch; esc = true; continue; }
    if (ch === '"') { out += ch; inStr = !inStr; continue; }
    if (inStr) {
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
    }
    out += ch;
  }
  return out;
}

// Try JSON.parse; if it fails, repair control-char escaping and retry.
export function jsonParse(candidate: string): unknown {
  try { return JSON.parse(candidate); } catch { /* fall through */ }
  try { return JSON.parse(repairJsonStrings(candidate)); } catch { /* fall through */ }
  return null;
}

// Extract the first ```json fence only (envelope has no embedded code).
export function extractEnvelopeJson(text: string): unknown {
  const jsonTagPos = text.indexOf("```json");
  if (jsonTagPos === -1) return null;
  const bodyStart = jsonTagPos + 7;
  const afterNewline = text[bodyStart] === "\n" ? bodyStart + 1 : bodyStart;
  const closingPos = text.indexOf("```", afterNewline);
  if (closingPos <= afterNewline) return null;
  return jsonParse(text.slice(afterNewline, closingPos).trim());
}

// More robust extractor for multi-section responses: tries fenced JSON, then
// any fenced block, then bare {…} — matching the existing route behaviour.
export function extractJson(text: string): unknown {
  const jsonTagPos = text.indexOf("```json");
  if (jsonTagPos !== -1) {
    const bodyStart = jsonTagPos + 7;
    const afterNewline = text[bodyStart] === "\n" ? bodyStart + 1 : bodyStart;
    const closingPos = text.lastIndexOf("```");
    if (closingPos > afterNewline) {
      const v = jsonParse(text.slice(afterNewline, closingPos).trim());
      if (v !== null && typeof v === "object" && !Array.isArray(v)) return v;
    }
  }
  const anyOpen = text.indexOf("```");
  if (anyOpen !== -1) {
    const afterTag = text.indexOf("\n", anyOpen);
    const closingPos = text.lastIndexOf("```");
    if (afterTag !== -1 && closingPos > afterTag) {
      const v = jsonParse(text.slice(afterTag + 1, closingPos).trim());
      if (v !== null && typeof v === "object" && !Array.isArray(v)) return v;
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const v = jsonParse(text.slice(start, end + 1));
    if (v !== null && typeof v === "object" && !Array.isArray(v)) return v;
  }
  return null;
}

export function extractJsonArray(text: string): unknown[] | null {
  const jsonTagPos = text.indexOf("```json");
  if (jsonTagPos !== -1) {
    const bodyStart = jsonTagPos + 7;
    const afterNewline = text[bodyStart] === "\n" ? bodyStart + 1 : bodyStart;
    const closingPos = text.lastIndexOf("```");
    if (closingPos > afterNewline) {
      const v = jsonParse(text.slice(afterNewline, closingPos).trim());
      if (Array.isArray(v)) return v;
    }
  }
  const anyOpen = text.indexOf("```");
  if (anyOpen !== -1) {
    const afterTag = text.indexOf("\n", anyOpen);
    const closingPos = text.lastIndexOf("```");
    if (afterTag !== -1 && closingPos > afterTag) {
      const v = jsonParse(text.slice(afterTag + 1, closingPos).trim());
      if (Array.isArray(v)) return v;
    }
  }
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    const v = jsonParse(text.slice(start, end + 1));
    if (Array.isArray(v)) return v;
  }
  return null;
}

export function extractPowershellFences(text: string): Map<string, string> {
  const scripts = new Map<string, string>();
  const lowerText = text.toLowerCase();
  let searchFrom = 0;
  let fallbackIdx = 0;
  while (true) {
    let openPos = -1;
    for (const marker of ["```powershell", "```ps1", "```ps\n", "```ps\r"]) {
      const pos = lowerText.indexOf(marker, searchFrom);
      if (pos !== -1 && (openPos === -1 || pos < openPos)) openPos = pos;
    }
    if (openPos === -1) break;
    const afterOpen = text.indexOf("\n", openPos);
    if (afterOpen === -1) break;
    const closePos = text.indexOf("```", afterOpen + 1);
    if (closePos === -1) break;
    const content = text.slice(afterOpen + 1, closePos).trimEnd();
    if (content) {
      const headerMatch = content.match(/^#\s*file:\s*(\S+\.ps1)/i);
      scripts.set(headerMatch ? headerMatch[1] : `_script_${fallbackIdx++}`, content);
    }
    searchFrom = closePos + 3;
  }
  return scripts;
}

