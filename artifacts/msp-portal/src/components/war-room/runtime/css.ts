import type { CSSProperties } from "react";

/**
 * Parses an inline CSS declaration string into a React style object.
 *
 * The War Room screens are a direct port of a Claude Design prototype whose markup
 * carries ~1,800 inline `style="a:b;c:d"` strings, most of them interpolated with
 * live values. Rewriting each one as a hand-authored style object would have been a
 * large, silent source of transcription drift, so the port keeps the design's own
 * declaration strings verbatim and converts them here instead.
 *
 * Values are always passed through as strings, which sidesteps React's unitless-number
 * coercion entirely: `top: "48%"` and `width: "3px"` mean exactly what the design said.
 */

const cache = new Map<string, CSSProperties>();

/** Interpolated styles produce unbounded distinct strings (positions change per frame). */
const MAX_CACHE = 4000;

/** Splits on `;` / `:` only at paren depth 0, so gradients and url() survive intact. */
function parseDeclarations(input: string): CSSProperties {
  const out: Record<string, string> = {};
  let depth = 0;
  let start = 0;

  const flush = (end: number) => {
    const decl = input.slice(start, end);
    start = end + 1;
    if (!decl.trim()) return;

    let d = 0;
    let colon = -1;
    for (let i = 0; i < decl.length; i++) {
      const ch = decl[i];
      if (ch === "(") d++;
      else if (ch === ")") d--;
      else if (ch === ":" && d === 0) {
        colon = i;
        break;
      }
    }
    if (colon === -1) return;

    const prop = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    if (!prop || !value) return;
    // An unresolved binding renders as the literal string "undefined"; drop it rather
    // than handing React a bogus declaration.
    if (value === "undefined" || value === "null") return;

    out[toReactProperty(prop)] = value;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === ";" && depth === 0) flush(i);
  }
  flush(input.length);

  return out as CSSProperties;
}

function toReactProperty(prop: string): string {
  // Custom properties keep their exact name — React writes them through setProperty.
  if (prop.startsWith("--")) return prop;

  if (prop.startsWith("-")) {
    // -webkit-text-stroke -> WebkitTextStroke, -ms-flex -> msFlex
    const [, vendor, rest] = /^-([a-z]+)-(.+)$/.exec(prop) ?? [];
    if (vendor && rest) {
      const camel = kebabToCamel(rest);
      const prefix = vendor === "ms" ? "ms" : vendor[0].toUpperCase() + vendor.slice(1);
      return prefix + camel[0].toUpperCase() + camel.slice(1);
    }
  }

  return kebabToCamel(prop);
}

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function css(input: string): CSSProperties {
  const hit = cache.get(input);
  if (hit) return hit;

  const parsed = parseDeclarations(input);
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(input, parsed);
  return parsed;
}
