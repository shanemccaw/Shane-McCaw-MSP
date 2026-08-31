/**
 * repo-source-nul-byte-guard.test.ts — guards against Git #1926 recurring silently.
 *
 * A literal NUL byte (0x00) written into a source file instead of the two-character
 * escape `\x00` decodes fine as UTF-8 and runs fine, but `grep`/`git grep` treat any
 * file containing a NUL as binary and skip it — so a NUL-carrying file becomes
 * invisible to every grep-based codebase audit without erroring. Two files
 * (`routes/portal-risk-register.ts`, `lib/portal-sops.ts`) sat undetected this way
 * from 2026-08-21 to 2026-08-31 (Git #1926). This test reads every tracked-looking
 * source file directly (not via grep) so the check itself cannot be blinded the same
 * way the audits it guards were.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".json",
  ".md",
  ".sql",
  ".css",
  ".html",
]);

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      collectSourceFiles(join(dir, entry.name), out);
      continue;
    }
    if (entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name))) {
      out.push(join(dir, entry.name));
    }
  }
}

function findNulOffset(path: string): number {
  return readFileSync(path).indexOf(0);
}

describe("repo source files carry no literal NUL byte (Git #1926)", () => {
  it(
    "scans every tracked source extension under the repo root",
    () => {
      // Sanity check the guard itself is actually walking real content, not an
      // empty/misresolved root — a guard that silently scans zero files is the
      // exact false-clean failure shape this issue is about.
      expect(statSync(REPO_ROOT).isDirectory()).toBe(true);
      const files: string[] = [];
      collectSourceFiles(REPO_ROOT, files);
      expect(files.length).toBeGreaterThan(1000);
    },
    30_000,
  );

  it(
    "contains no literal NUL byte in any scanned source file",
    () => {
      const files: string[] = [];
      collectSourceFiles(REPO_ROOT, files);

      const offenders: string[] = [];
      for (const file of files) {
        const offset = findNulOffset(file);
        if (offset >= 0) {
          offenders.push(`${file.slice(REPO_ROOT.length)} (offset ${offset})`);
        }
      }

      expect(offenders, "Replace the literal NUL with the \\x00 escape sequence").toEqual([]);
    },
    30_000,
  );
});
