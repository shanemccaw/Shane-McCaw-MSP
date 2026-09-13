/**
 * interp.ts
 *
 * Payload interpolation ({{key}} / {{payload.key}} token substitution), extracted
 * from workflow-executor.ts (#3800) so dependency-free modules — e.g.
 * resolve-then-write.ts — can share the EXACT same substitution the executor and
 * baseline-template resolution use, without importing the whole db/Graph executor
 * graph. One implementation, never two that drift.
 */

// Replaces {{key}} and {{payload.key}} tokens with values from payload.
export function interp(template: string | undefined, payload: Record<string, unknown>): string | undefined {
  if (!template) return undefined;
  // [\w.\-\[\]]+ — word chars, dots, hyphens, and bracket chars so bracket-notation
  // like phases[0] or phases[myCounter] resolves correctly alongside node IDs like "node-106"
  return template.replace(/\{\{([\w.\-\[\]]+)\}\}/g, (_match, path: string) => {
    const key = path.startsWith("payload.") ? path.slice(8) : path;
    const parts = key.split(".");
    let cur: unknown = payload;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return "";
      const bracketIdx = part.indexOf("[");
      if (bracketIdx !== -1) {
        // Bracket-notation segment, e.g. "phases[0]" or "phases[myCounter]"
        const propName = part.slice(0, bracketIdx);
        // Strip trailing "]"
        const rawIndex = part.slice(bracketIdx + 1, part.endsWith("]") ? part.length - 1 : part.length);
        // Navigate into the named property first (if any)
        if (propName) {
          cur = (cur as Record<string, unknown>)[propName];
          if (cur == null || !Array.isArray(cur)) return "";
        }
        // Resolve the index: plain integer string → direct; otherwise look up in payload
        let idx: number;
        if (/^\d+$/.test(rawIndex)) {
          idx = parseInt(rawIndex, 10);
        } else {
          const lookedUp = (payload as Record<string, unknown>)[rawIndex];
          const asStr = String(lookedUp ?? "");
          if (!/^\d+$/.test(asStr)) return "";
          idx = parseInt(asStr, 10);
        }
        cur = (cur as unknown[])[idx];
      } else {
        cur = (cur as Record<string, unknown>)[part];
      }
    }
    if (cur == null) return "";
    if (typeof cur === "object") {
      // Arrays and objects: emit compact JSON so downstream templates see
      // valid data instead of the useless "[object Object]" coercion
      try { return JSON.stringify(cur); } catch { return String(cur); }
    }
    return String(cur);
  });
}

export function interpOrNull(template: string | undefined, payload: Record<string, unknown>): string | null {
  const result = interp(template, payload);
  return result?.trim() ? result : null;
}
