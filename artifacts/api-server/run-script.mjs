/**
 * run-script.mjs — bundle one `src/scripts/*.ts` entry with esbuild and run it.
 *
 * WHY THIS EXISTS (Git #1797, and the same wall #1796 hit).
 *
 * A build session works in an isolated git worktree whose `node_modules` is a JUNCTION to
 * the main checkout's (`scripts/dev-server/link-deps.mjs`, by design — one shared install
 * rather than one download per worktree). But the main checkout's
 * `node_modules/@workspace/db` is a symlink relative to ITSELF, so resolving
 * `@workspace/db` from inside a worktree lands on the MAIN CHECKOUT's `lib/db/src`, not
 * the worktree's.
 *
 * The consequence is not subtle: a script run from a worktree imports a DIFFERENT copy of
 * the schema than the one the session is editing. Under #1797 that surfaced as
 * `ERR_UNSUPPORTED_DIR_IMPORT` resolving `C:\Source\...\lib\db\src\schema` while the
 * session was working in `C:\wt\...`, and would otherwise have surfaced as new tables
 * silently missing from the import.
 *
 * `--alias:` pins `@workspace/*` to THIS worktree's own sources, so a script tests the
 * code the session actually wrote. `tsx` is not installed in this workspace, and Node's
 * native type stripping cannot resolve the directory imports `lib/db` uses, so bundling
 * is also what makes a `.ts` entry point runnable at all here.
 *
 * This is a workaround for the worktree-isolation bug, not a fix for it. Per the
 * repository's standing rule, `pnpm install` is NOT the remedy and is not attempted:
 * on an unchanged lockfile pnpm exits without walking a single symlink, so it cannot
 * repair a link that points at the wrong checkout.
 *
 *   node run-script.mjs src/scripts/verify-1797-differ.ts [args...]
 */

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, rm, readFile } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const entry = process.argv[2];
if (!entry) {
  console.error("usage: node run-script.mjs <src/scripts/entry.ts> [args...]");
  process.exit(1);
}

// Load .env.local from the repo root the same way the dev server does, so a script gets
// the real DATABASE_URL and tenant credentials without a separate bootstrap step.
try {
  const env = await readFile(path.join(repoRoot, ".env.local"), "utf8");
  for (const raw of env.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {
  // No .env.local is a real possibility on a fresh machine; the script itself will say
  // what it needed.
}

// The bundle must sit INSIDE this package, not in a temp directory: everything in
// `external` below is resolved by Node at runtime from the nearest `node_modules`, and a
// bundle in `%TEMP%` has none above it.
const outDir = await mkdtemp(path.join(here, ".run-script-"));
const outFile = path.join(outDir, "entry.mjs");

try {
  await build({
    entryPoints: [path.resolve(here, entry)],
    outfile: outFile,
    platform: "node",
    target: "node22",
    format: "esm",
    bundle: true,
    logLevel: "warning",
    // THE POINT OF THIS FILE — see the header.
    alias: {
      "@workspace/db": path.join(repoRoot, "lib/db/src/index.ts"),
      "@workspace/api-zod": path.join(repoRoot, "lib/api-zod/src/index.ts"),
    },
    external: [
      "*.node", "zod", "sharp", "better-sqlite3", "sqlite3", "canvas", "bcrypt", "argon2",
      "fsevents", "re2", "farmhash", "xxhash-addon", "bufferutil", "utf-8-validate",
      "ssh2", "cpu-features", "dtrace-provider", "isolated-vm", "lightningcss",
      "pg-native", "oracledb", "mongodb-client-encryption", "nodemailer", "pino",
      "pino-pretty", "thread-stream",
    ],
    banner: {
      js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
    },
  });

  process.argv = [process.argv[0], outFile, ...process.argv.slice(3)];
  await import(pathToFileURL(outFile).href);
} finally {
  process.on("exit", () => { void rm(outDir, { recursive: true, force: true }); });
}
