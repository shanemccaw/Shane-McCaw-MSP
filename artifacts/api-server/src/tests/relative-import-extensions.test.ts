/**
 * Git #3574 — every relative import in this package names its real file.
 *
 * `moduleResolution: "bundler"` lets tsc, vitest and esbuild resolve an
 * import of `./logger` to `./logger.ts`, so an extensionless relative import is
 * invisible to every check this package runs — except the 21 files the `test`
 * script sends through `node --experimental-strip-types --test`, where Node's
 * own ESM loader throws ERR_MODULE_NOT_FOUND the moment the import graph
 * reaches one. #2458 and #3409 (lib/db) and #3574 (this package, 2,643
 * specifiers) each had to be found that way, after the fact.
 *
 * This runs the same resolver the #3574 codemod used, in --check mode, so a new
 * extensionless or `.js`-aliased relative import fails here instead. Fix with:
 *   node scripts/fix-relative-import-extensions.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(packageRoot, "scripts", "fix-relative-import-extensions.mjs");

interface ImportReport {
  filesScanned: number;
  rewrites: { file: string; line: number; from: string; to: string }[];
  caseMismatches: { file: string; line: number; spec: string; target: string }[];
}

describe("relative imports resolve under Node's own ESM loader (#3574)", () => {
  it("no relative import in src/ or scripts/ relies on bundler-only resolution", () => {
    const run = spawnSync(process.execPath, [script, "--check", "--json"], {
      cwd: packageRoot,
      encoding: "utf8",
    });
    expect(run.error).toBeUndefined();
    const report = JSON.parse(run.stdout) as ImportReport;

    expect(report.filesScanned).toBeGreaterThan(0);
    expect(
      report.rewrites.map((r) => `${r.file}:${r.line} "${r.from}" should be "${r.to}"`),
    ).toEqual([]);
    expect(
      report.caseMismatches.map((c) => `${c.file}:${c.line} "${c.spec}" only matches "${c.target}" case-insensitively`),
    ).toEqual([]);
  });
});
