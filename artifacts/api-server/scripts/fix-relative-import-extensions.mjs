#!/usr/bin/env node
/**
 * Git #3574 — explicit extensions on every relative import in api-server.
 *
 * The repo compiles with `moduleResolution: "bundler"`, so tsc, vitest and
 * esbuild all resolve `from "./logger"` to `./logger.ts` without complaint.
 * Node's own ESM loader does not: it resolves a relative specifier exactly as
 * written. The package's `test` script runs 21 files through
 * `node --experimental-strip-types --test`, and any of them whose import graph
 * reaches an extensionless (or `.js`-suffixed) relative import dies with
 * ERR_MODULE_NOT_FOUND. Nothing else in CI notices, because to every other
 * tool the import is fine. #2458 and #3409 fixed the same class by hand in
 * lib/db; this does it mechanically for the whole package.
 *
 * Every rewrite is resolved against the real filesystem, never guessed:
 *   ./foo       -> ./foo.ts           (file exists, exact case)
 *   ./foo       -> ./foo/index.ts     (directory import)
 *   ./foo.js    -> ./foo.ts           (TS-style .js alias with no .js on disk)
 * Specifiers that already resolve exactly are left alone. Specifiers that do
 * not resolve at all, or resolve only by case-insensitive match (works on
 * Windows, fails on Linux), are reported and never rewritten.
 *
 * Usage (from artifacts/api-server):
 *   node scripts/fix-relative-import-extensions.mjs            # rewrite in place
 *   node scripts/fix-relative-import-extensions.mjs --check    # exit 1 if anything needs a rewrite
 *   node scripts/fix-relative-import-extensions.mjs --json     # machine-readable report
 *
 * `--check` is what src/lib/relative-import-extensions.test.ts runs, so a new
 * extensionless import fails vitest instead of waiting for a node-runner test
 * to trip over it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const selfPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(selfPath), "..");
const DEFAULT_ROOTS = ["src", "scripts"];
const SOURCE_EXT = /\.(ts|tsx|mts|cts|mjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

// Contexts a module specifier can appear in. Deliberately a whitelist: a bare
// "./x" string elsewhere (a file path, a URL fragment) is not a module import.
//   import … from "./x" / export … from "./x" (including a multi-line `} from`)
//   import "./x"                  side-effect import
//   import("./x") / typeof import("./x")
//   vi.mock / vi.doMock / vi.unmock / vi.doUnmock / vi.importActual / vi.importMock
//   mock.module                   node:test module mocks
const SPEC_RE = new RegExp(
  [
    "(",
    "\\bfrom\\s*",
    "|\\bimport\\s*\\(\\s*",
    "|^[ \\t]*import[ \\t]+",
    "|\\b(?:vi\\.(?:mock|doMock|unmock|doUnmock|importActual|importMock)|mock\\.module)\\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\\s*\\(\\s*",
    ")",
    "([\"'])",
    "(\\.{1,2}(?:/[^\"'\\n]*)?)",
    "\\2",
  ].join(""),
  "gm",
);

const JS_TO_TS = [
  [".js", [".ts", ".tsx"]],
  [".jsx", [".tsx"]],
  [".mjs", [".mts"]],
  [".cjs", [".cts"]],
];
const APPEND_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"];
const INDEX_FILES = ["index.ts", "index.tsx"];

const dirCache = new Map();
function listDir(dir) {
  if (!dirCache.has(dir)) {
    let names = null;
    try {
      names = new Set(fs.readdirSync(dir));
    } catch {
      names = null;
    }
    dirCache.set(dir, names);
  }
  return dirCache.get(dir);
}

/** "exact" = the file exists with this exact casing; "case" = only case-insensitively. */
function fileStatus(abs) {
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const names = listDir(path.dirname(abs));
  return names && names.has(path.basename(abs)) ? "exact" : "case";
}

function isDir(abs) {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @returns {{ kind: "ok" } | { kind: "rewrite", to: string } | { kind: "case", target: string } | { kind: "unresolved" }}
 */
function resolveSpecifier(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const trimmed = spec.replace(/\/+$/, "");

  const exact = spec.endsWith("/") ? null : fileStatus(base);
  if (exact === "exact") return { kind: "ok" };

  const candidates = [];
  const ext = path.extname(trimmed);
  for (const [jsExt, tsExts] of JS_TO_TS) {
    if (ext === jsExt) {
      for (const tsExt of tsExts) candidates.push(trimmed.slice(0, -jsExt.length) + tsExt);
    }
  }
  for (const add of APPEND_EXTS) candidates.push(trimmed + add);
  if (isDir(base)) {
    for (const index of INDEX_FILES) candidates.push(`${trimmed}/${index}`);
  }

  let caseOnly = exact === "case" ? spec : null;
  for (const candidate of candidates) {
    const status = fileStatus(path.resolve(path.dirname(fromFile), candidate));
    if (status === "exact") return { kind: "rewrite", to: candidate };
    if (status === "case" && !caseOnly) caseOnly = candidate;
  }
  if (caseOnly) return { kind: "case", target: caseOnly };
  return { kind: "unresolved" };
}

function walk(dir, out) {
  const names = listDir(dir);
  if (!names) return out;
  for (const name of names) {
    const abs = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(abs, out);
    } else if (SOURCE_EXT.test(name) && !name.endsWith(".d.ts") && abs !== selfPath) {
      out.push(abs);
    }
  }
  return out;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function scanRelativeImports({ roots = DEFAULT_ROOTS, write = false } = {}) {
  const files = roots.flatMap((root) => walk(path.resolve(packageRoot, root), []));
  const report = { filesScanned: files.length, filesChanged: 0, rewrites: [], caseMismatches: [], unresolved: [] };

  for (const file of files) {
    const original = fs.readFileSync(file, "utf8");
    const rel = path.relative(packageRoot, file).split(path.sep).join("/");
    let changed = false;
    const next = original.replace(SPEC_RE, (match, prefix, quote, spec, offset) => {
      const result = resolveSpecifier(file, spec);
      if (result.kind === "rewrite") {
        changed = true;
        report.rewrites.push({ file: rel, line: lineOf(original, offset), from: spec, to: result.to });
        return `${prefix}${quote}${result.to}${quote}`;
      }
      if (result.kind === "case") {
        report.caseMismatches.push({ file: rel, line: lineOf(original, offset), spec, target: result.target });
      } else if (result.kind === "unresolved") {
        report.unresolved.push({ file: rel, line: lineOf(original, offset), spec });
      }
      return match;
    });
    if (changed) {
      report.filesChanged++;
      if (write) fs.writeFileSync(file, next, "utf8");
    }
  }
  return report;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const json = args.includes("--json");
  const roots = args.filter((a) => !a.startsWith("--"));
  const report = scanRelativeImports({ roots: roots.length ? roots : DEFAULT_ROOTS, write: !check });

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const verb = check ? "need an explicit extension" : "rewritten";
    console.log(`scanned ${report.filesScanned} files — ${report.rewrites.length} relative imports ${verb} across ${report.filesChanged} files`);
    if (check) for (const r of report.rewrites) console.log(`  ${r.file}:${r.line}  "${r.from}" -> "${r.to}"`);
    for (const c of report.caseMismatches) console.log(`  CASE MISMATCH ${c.file}:${c.line}  "${c.spec}" only matches "${c.target}" case-insensitively`);
    for (const u of report.unresolved) console.log(`  UNRESOLVED ${u.file}:${u.line}  "${u.spec}"`);
  }
  process.exitCode = check && (report.rewrites.length || report.caseMismatches.length) ? 1 : 0;
}
