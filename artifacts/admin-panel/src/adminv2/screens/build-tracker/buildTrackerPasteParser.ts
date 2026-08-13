/**
 * Pure, deterministic parser for "Paste from Claude" triage import.
 *
 * No AI call, no network — Shane's own paste format is consistent enough
 * that it doesn't need one: a bold "**Header:**" line marks a group, and
 * every "- " bullet underneath it leads with the GitHub issue number
 * reference(s) it's about before its description, in one of:
 *   - a single ref:        "#439 — MFA enforcement"
 *   - a slash list:        "#626/#627/#628 — Retainer/Monitoring questions"
 *   - a comma list:        "#611, #634, #636, #638, #646"     (no description)
 *   - a dash range:        "#647-652 (Remediation Tracker, 5 stages)"
 * and any of the above may have the leading ref(s) wrapped in "**bold**".
 */

import type { PasteImportGroup, PasteImportItem } from "./buildTrackerTypes";

const HEADER_RE = /^\s*\*\*(.+?)\*\*\s*$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;

/**
 * The bullet's leading run of issue-number references, in any combination of
 * the four forms above. Matched from the START of the bullet only — this
 * tool's paste format always leads with the reference(s), never buries them
 * mid-sentence.
 */
const LEADING_REFS_RE = /^\s*(?:\*\*)?#\d+(?:\*\*)?(?:\s*(?:[/,]|[–—-])\s*(?:\*\*)?#?\d+(?:\*\*)?)*/;

/** How wide a "#647-652" range is allowed to expand to before it's treated as two unrelated numbers instead. */
const MAX_RANGE_SPAN = 100;

/** Expands "#647-652"/"#647–652" ranges into individual numbers, consuming them out of `text` first. */
function expandRanges(text: string, numbers: Set<number>): string {
  return text.replace(/#(\d+)\s*[–—-]\s*#?(\d+)\b/g, (whole, a: string, b: string) => {
    const start = parseInt(a, 10);
    const end = parseInt(b, 10);
    if (end >= start && end - start < MAX_RANGE_SPAN) {
      for (let n = start; n <= end; n++) numbers.add(n);
    } else {
      numbers.add(start);
      numbers.add(end);
    }
    return " ";
  });
}

/** Every remaining "#123" once ranges are already consumed — covers single refs, slash lists, comma lists. */
function collectSingles(text: string, numbers: Set<number>): void {
  const re = /#(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) numbers.add(parseInt(m[1], 10));
}

function parseBullet(raw: string): PasteImportItem {
  const match = raw.match(LEADING_REFS_RE);
  const numbers = new Set<number>();
  let rest = raw;

  if (match) {
    collectSingles(expandRanges(match[0], numbers), numbers);
    rest = raw.slice(match[0].length);
  }

  rest = rest.replace(/^\s*[—–:-]\s*/, "").trim();
  return { numbers: [...numbers].sort((a, b) => a - b), text: rest };
}

/**
 * Parses a pasted status-summary block into the same groups the source text
 * already used. Lines that are neither a bold header nor a "- "/"* " bullet
 * (blank lines, trailing prose) are skipped. If the text has bullets but no
 * header line at all, everything lands in one default group rather than
 * being silently dropped.
 */
export function parsePasteText(text: string): PasteImportGroup[] {
  const lines = text.split(/\r?\n/);
  const groups: PasteImportGroup[] = [];
  let current: PasteImportGroup | null = null;

  for (const line of lines) {
    const headerMatch = line.match(HEADER_RE);
    if (headerMatch) {
      current = { label: headerMatch[1].replace(/:\s*$/, "").trim(), items: [] };
      groups.push(current);
      continue;
    }
    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch) {
      const item = parseBullet(bulletMatch[1]);
      if (!item.text && item.numbers.length === 0) continue;
      if (!current) {
        current = { label: "Items", items: [] };
        groups.push(current);
      }
      current.items.push(item);
    }
  }

  return groups.filter((g) => g.items.length > 0);
}
