/**
 * Colorizes real command/diff output for display — `git status`, `git pull`
 * (fast-forward diffstat), `pnpm install`/`build`, and free-typed commands
 * all pass real text through here. Plain, no syntax-highlighting library:
 * two small rule tables, whole-line rules checked first (a diff `+`/`-`
 * line, a `git status --short` code, a branch header), then word-level
 * rules for everything else (error/warn/success keywords, insertion/
 * deletion counts in a diffstat summary).
 *
 * Never used for anything typed *into* a command — only for output already
 * returned by the real, already-run whitelisted/free-text deploy routes.
 */

import type { ReactNode } from "react";
import { ACCENT, ACCENT_TEXT, TEXT } from "../theme";

interface LineRule {
  test: RegExp;
  color: string;
}

// `git status --short`'s two-letter XY code, always followed by a space
// then the path. Looked up directly rather than pattern-matched — the
// space in "index status" + "worktree status" makes a clean regex for this
// more error-prone than it is worth.
const GIT_STATUS_CODE_COLOR: Record<string, string> = {
  "??": TEXT.dim, // untracked
  "A ": ACCENT_TEXT.green,
  AM: ACCENT_TEXT.green,
  AD: ACCENT_TEXT.green,
  "M ": ACCENT.amber,
  " M": ACCENT.amber,
  MM: ACCENT.amber,
  "D ": ACCENT_TEXT.danger,
  " D": ACCENT_TEXT.danger,
  "R ": ACCENT_TEXT.green,
  RM: ACCENT_TEXT.green,
};

function gitStatusLineColor(line: string): string | undefined {
  if (line.length < 3 || line[2] !== " ") return undefined;
  return GIT_STATUS_CODE_COLOR[line.slice(0, 2)];
}

// Checked top to bottom, first match wins, and colors the WHOLE line —
// matching how a real diff viewer or `git status` colors output.
const LINE_RULES: LineRule[] = [
  // Diff file headers: "diff --git a/x b/x", "index abc..def", "@@ -1,2 +1,3 @@".
  { test: /^(diff --git |index |@@ )/, color: ACCENT.info },
  // "+++ b/x" / "--- a/x" file markers — before the plain +/- rules below,
  // which would otherwise also match their leading character.
  { test: /^(\+\+\+|---) /, color: ACCENT.info },
  // A real diff addition line, e.g. from a `git pull` fast-forward summary.
  { test: /^\+(?!\+)/, color: ACCENT_TEXT.green },
  { test: /^-(?!-)/, color: ACCENT_TEXT.danger },
  // `git status --short --branch`'s own header line.
  { test: /^## /, color: ACCENT.info },
];

interface WordRule {
  test: RegExp;
  color: string;
}

// Combined into one alternation and scanned left to right; only used on
// lines that matched none of LINE_RULES or the git-status lookup.
const WORD_RULES: WordRule[] = [
  { test: /\d+ insertions?\(\+\)/, color: ACCENT_TEXT.green },
  { test: /\d+ deletions?\(-\)/, color: ACCENT_TEXT.danger },
  { test: /\berrors?\b/i, color: ACCENT_TEXT.danger },
  { test: /\bfail(?:ed|ure)?\b/i, color: ACCENT_TEXT.danger },
  { test: /\bwarn(?:ing)?\b/i, color: ACCENT.amber },
  { test: /\b(success(?:fully)?|passed|done|up to date)\b/i, color: ACCENT_TEXT.green },
  { test: /✓/, color: ACCENT_TEXT.green },
  { test: /✗/, color: ACCENT_TEXT.danger },
];

const COMBINED_WORD_RULE = new RegExp(WORD_RULES.map((r) => `(${r.test.source})`).join("|"), "gi");

function highlightWords(line: string): ReactNode {
  if (!line) return line;
  COMBINED_WORD_RULE.lastIndex = 0;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = COMBINED_WORD_RULE.exec(line))) {
    if (match.index > lastIndex) nodes.push(line.slice(lastIndex, match.index));
    const ruleIndex = match.slice(1).findIndex((group) => group !== undefined);
    const color = WORD_RULES[ruleIndex]?.color ?? TEXT.meta;
    nodes.push(
      <span key={key++} style={{ color, fontWeight: 700 }}>
        {match[0]}
      </span>,
    );
    lastIndex = COMBINED_WORD_RULE.lastIndex;
    if (match[0].length === 0) COMBINED_WORD_RULE.lastIndex++;
  }
  if (lastIndex < line.length) nodes.push(line.slice(lastIndex));
  return nodes;
}

/** Renders `text` as monospace lines, colorized per the rules above. */
export function ColorizedOutput({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const wholeLineColor = gitStatusLineColor(line) ?? LINE_RULES.find((r) => r.test.test(line))?.color;
        return (
          <div key={i} style={{ color: wholeLineColor ?? TEXT.meta }}>
            {wholeLineColor ? line || " " : highlightWords(line) || " "}
          </div>
        );
      })}
    </>
  );
}
