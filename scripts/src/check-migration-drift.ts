/**
 * check-migration-drift.ts
 *
 * CI-safe static check — requires no database connection.
 *
 * Checks three things:
 *
 *   1. SCHEMA DRIFT: Has lib/db/src/schema/index.ts changed since the last
 *      recorded hash, and if so, is that change actually unaccounted for?
 *      (Git #3083.) The stored SHA-256 hash in lib/db/drizzle/schema-hash.txt
 *      is written either by `drizzle-kit generate` or by a manual re-baseline —
 *      either way it marks the last point the schema was known to be fully
 *      reconciled. CLAUDE.md's mandated workflow for most schema changes is
 *      NOT `generate`, it's hand-written SQL under lib/db/migrations/manual/,
 *      which never touches this hash — so a bare hash mismatch does not mean
 *      "drift," it can also mean "the sanctioned manual-migration workflow ran
 *      and nobody re-stamped the hash." Before failing, this check asks git:
 *      for every commit since the hash was last stamped that touched
 *      schema/index.ts, did that SAME commit also add/modify a real migration
 *      (a file under lib/db/migrations/manual/, or the drizzle/ journal +
 *      generated SQL)? If every one of them did, the delta is reconciled by
 *      the union of the journal and the manual migrations — not an error. If
 *      even one schema-touching commit has no accompanying migration, THAT is
 *      real, unaccounted drift, and is reported by commit so it's actionable.
 *
 *   2. BROKEN JOURNAL: Does every journal entry in _journal.json have a
 *      corresponding .sql file on disk?  Missing files mean generate was
 *      interrupted or the file was accidentally deleted.
 *
 *   3. ORPHANED SQL FILES: Are there .sql files in lib/db/drizzle/ that are
 *      NOT tracked in the journal?  These will NOT be auto-applied by
 *      migrate-prod and may cause confusion.
 *
 *   4. DESTRUCTIVE MIGRATION GATE (Git #2930): does every .sql file containing
 *      an irreversible statement carry an explicit `-- @migration-gate:` header?
 *      This is the merge-time half of the gate — it catches a missing header
 *      while the author is still here, rather than at 3am on a post-merge run.
 *
 * Exit codes:
 *   0 — clean (no errors; warnings are printed but don't fail CI)
 *   1 — schema drift detected, journal broken, or a destructive migration is
 *       missing its gate header
 *
 * How to fix each issue:
 *   Schema drift (truly unaccounted) → pnpm --filter @workspace/db run generate,
 *     or write the missing lib/db/migrations/manual/*.sql for the flagged commit(s)
 *   Broken journal → pnpm --filter @workspace/db run generate (or restore file)
 *   Orphaned SQL  → remove the file or incorporate it into a proper migration
 *   Missing gate header → add `-- @migration-gate:` + `-- @gate-reason:` to the file
 *
 * Run:
 *   pnpm --filter @workspace/scripts run check-drift
 */

import crypto from "crypto";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  evaluateMigrationGate,
  type MigrationGateVerdict,
} from "./lib/destructive-migration-gate";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** DRIZZLE_MIGRATIONS_DIR is the same test seam migrate-dev uses (see #2930). */
const DRIZZLE_DIR = process.env["DRIZZLE_MIGRATIONS_DIR"]
  ? path.resolve(process.env["DRIZZLE_MIGRATIONS_DIR"])
  : path.resolve(__dirname, "../../lib/db/drizzle");
const JOURNAL_PATH = path.join(DRIZZLE_DIR, "meta/_journal.json");
const SCHEMA_HASH_PATH = path.join(DRIZZLE_DIR, "schema-hash.txt");
const REPO_ROOT_GUESS = path.resolve(__dirname, "../..");
const SCHEMA_PATH = path.resolve(__dirname, "../../lib/db/src/schema/index.ts");
const MANUAL_MIGRATIONS_DIR = path.resolve(
  __dirname,
  "../../lib/db/migrations/manual"
);

// ---------------------------------------------------------------------------
// Git reconciliation helpers (Git #3083)
//
// All of these fail SAFE: any git error (not a repo, shallow clone missing the
// anchor commit, git not installed, DRIZZLE_MIGRATIONS_DIR test seam pointed
// somewhere outside the repo) returns null, which the caller treats as
// "cannot reconcile" and falls back to the original strict hash-mismatch
// error. Reconciliation only ever SOFTENS a result from error to informational
// when it can positively prove every schema-touching commit since the last
// stamp carried its own migration — it never invents a pass.
// ---------------------------------------------------------------------------
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function getRepoRoot(): string | null {
  return git(["rev-parse", "--show-toplevel"], REPO_ROOT_GUESS);
}

/** The last commit that touched the hash file — i.e. the last known-reconciled point. */
function getAnchorCommit(repoRoot: string, relHashPath: string): string | null {
  const out = git(["log", "-1", "--format=%H", "--", relHashPath], repoRoot);
  return out || null;
}

function getHeadCommit(repoRoot: string): string | null {
  return git(["rev-parse", "HEAD"], repoRoot);
}

/** Commits (oldest first) between anchor (exclusive) and HEAD (inclusive) touching a path. */
function getCommitsTouchingPath(
  repoRoot: string,
  anchor: string,
  head: string,
  relPath: string
): string[] | null {
  const out = git(
    ["log", "--format=%H", "--reverse", `${anchor}..${head}`, "--", relPath],
    repoRoot
  );
  if (out === null) return null;
  return out.split("\n").filter(Boolean);
}

/** Did this commit's own change-set touch any file under one of relDirPrefixes? */
function commitTouches(
  repoRoot: string,
  sha: string,
  relDirPrefixes: string[]
): boolean | null {
  const out = git(["show", "--name-only", "--format=", sha], repoRoot);
  if (out === null) return null;
  const files = out.split("\n").filter(Boolean);
  return files.some((f) => relDirPrefixes.some((prefix) => f.startsWith(prefix)));
}

/** Is the working tree (staged + unstaged) different from HEAD for this path? */
function isDirtyRelativeToHead(repoRoot: string, relPath: string): boolean | null {
  const out = git(["diff", "HEAD", "--name-only", "--", relPath], repoRoot);
  if (out === null) return null;
  return out.trim().length > 0;
}

function hasUncommittedChangesUnder(repoRoot: string, relDir: string): boolean | null {
  const out = git(["status", "--porcelain", "--", relDir], repoRoot);
  if (out === null) return null;
  return out.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Terminal colours (gracefully degrade when not a TTY)
// ---------------------------------------------------------------------------
const isTTY = process.stdout.isTTY;
const bold = (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const red = (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s);
const green = (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s);
const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

interface Journal {
  entries: JournalEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function computeSchemaHash(): string {
  const content = fs.readFileSync(SCHEMA_PATH);
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// Reconciliation (Git #3083)
// ---------------------------------------------------------------------------
type ReconcileResult =
  | { status: "reconciled"; details: string[] }
  | { status: "unaccounted"; details: string[] }
  | { status: "unavailable"; details: string[] };

function tryReconcileSchemaDrift(): ReconcileResult {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    return { status: "unavailable", details: ["not inside a git working tree"] };
  }

  const relHashPath = toPosix(path.relative(repoRoot, SCHEMA_HASH_PATH));
  const relSchemaPath = toPosix(path.relative(repoRoot, SCHEMA_PATH));
  const relManualDir = toPosix(path.relative(repoRoot, MANUAL_MIGRATIONS_DIR)) + "/";
  const relDrizzleDir = toPosix(path.relative(repoRoot, DRIZZLE_DIR)) + "/";

  // A dirty (uncommitted) schema edit can only be reconciled if there's also
  // an uncommitted change under manual/ in the same working tree — otherwise
  // it's an in-progress edit with no migration yet, which is real drift.
  const schemaDirty = isDirtyRelativeToHead(repoRoot, relSchemaPath);
  if (schemaDirty === null) {
    return { status: "unavailable", details: ["`git diff HEAD` failed"] };
  }
  if (schemaDirty) {
    const manualDirty = hasUncommittedChangesUnder(repoRoot, relManualDir);
    if (manualDirty) {
      return {
        status: "reconciled",
        details: [
          "uncommitted schema/index.ts change, paired with an uncommitted change under lib/db/migrations/manual/ — verify before committing",
        ],
      };
    }
    return {
      status: "unaccounted",
      details: ["(uncommitted) schema/index.ts has local edits with no matching uncommitted file under lib/db/migrations/manual/"],
    };
  }

  const anchor = getAnchorCommit(repoRoot, relHashPath);
  if (!anchor) {
    return {
      status: "unavailable",
      details: [`no commit history found for ${relHashPath}`],
    };
  }

  const head = getHeadCommit(repoRoot);
  if (!head) {
    return { status: "unavailable", details: ["`git rev-parse HEAD` failed"] };
  }

  if (anchor === head) {
    // Hash file was last touched at HEAD itself but still doesn't match —
    // nothing since to reconcile against; this is real, unexplainable drift
    // (e.g. someone hand-edited schema-hash.txt to the wrong value).
    return {
      status: "unaccounted",
      details: [`schema-hash.txt was last stamped at HEAD (${head.slice(0, 9)}) but doesn't match the current file`],
    };
  }

  const schemaCommits = getCommitsTouchingPath(repoRoot, anchor, head, relSchemaPath);
  if (schemaCommits === null) {
    return {
      status: "unavailable",
      details: [`\`git log ${anchor.slice(0, 9)}..${head.slice(0, 9)}\` failed — shallow clone missing the anchor commit?`],
    };
  }

  if (schemaCommits.length === 0) {
    // Schema file hash differs but no committed history touched it since the
    // anchor and the working tree isn't dirty either — shouldn't happen, but
    // don't silently pass; report it as unaccounted rather than guessing.
    return {
      status: "unaccounted",
      details: [`hash mismatch with no schema/index.ts commits found between ${anchor.slice(0, 9)}..${head.slice(0, 9)}`],
    };
  }

  const details: string[] = [];
  const unaccounted: string[] = [];

  for (const sha of schemaCommits) {
    const touchesMigration = commitTouches(repoRoot, sha, [relManualDir, relDrizzleDir]);
    if (touchesMigration === null) {
      return { status: "unavailable", details: [`\`git show ${sha.slice(0, 9)}\` failed`] };
    }
    const subject = git(["log", "-1", "--format=%s", sha], repoRoot) ?? "";
    const label = `${sha.slice(0, 9)} ${subject}`;
    if (touchesMigration) {
      details.push(`${label} — carried its own migration`);
    } else {
      unaccounted.push(label);
    }
  }

  if (unaccounted.length > 0) {
    return { status: "unaccounted", details: unaccounted };
  }

  return { status: "reconciled", details };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  console.log(bold("\n=== Migration Drift Check ===\n"));

  let hasError = false;

  // =========================================================================
  // Check 1: Schema file hash vs stored hash
  // =========================================================================
  console.log(bold("1. Schema drift (schema/index.ts vs last generate)"));

  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(red(`   ERROR: Schema file not found: ${SCHEMA_PATH}`));
    hasError = true;
  } else if (!fs.existsSync(SCHEMA_HASH_PATH)) {
    console.warn(
      yellow(`   WARNING: ${dim("lib/db/drizzle/meta/schema-hash.txt")} does not exist.`)
    );
    console.warn(yellow(`   Run: pnpm --filter @workspace/db run generate`));
    console.warn(yellow(`   Then commit the updated hash file alongside your migration.\n`));
    hasError = true;
  } else {
    const storedHash = fs.readFileSync(SCHEMA_HASH_PATH, "utf-8").trim();
    const currentHash = computeSchemaHash();

    if (currentHash === storedHash) {
      console.log(green(`   ✓ Schema is in sync with the journal (hash matches).`));
    } else {
      const reconciled = tryReconcileSchemaDrift();

      if (reconciled.status === "reconciled") {
        console.log(
          green(
            `   ✓ Schema hash changed, but every change since it was last stamped is\n` +
              `     accounted for by a real migration (Git #3083 reconciliation):`
          )
        );
        for (const line of reconciled.details) {
          console.log(dim(`     - ${line}`));
        }
        console.log(
          dim(
            `     Not treated as drift. Re-stamp when convenient with:\n` +
              `       pnpm --filter @workspace/scripts run update-schema-hash\n`
          )
        );
      } else {
        console.error(red(`   ✗ Schema has changed since the last migration was generated!`));
        console.error(red(`     Stored : ${storedHash}`));
        console.error(red(`     Current: ${currentHash}`));
        if (reconciled.status === "unaccounted") {
          console.error(
            red(
              `     Could not reconcile via manual migrations — the following commit(s)\n` +
                `     touched schema/index.ts with no accompanying migration file:`
            )
          );
          for (const line of reconciled.details) {
            console.error(red(`       ✗ ${line}`));
          }
          console.error(
            red(
              `     Fix: either run pnpm --filter @workspace/db run generate, or write the\n` +
                `     missing lib/db/migrations/manual/*.sql for the commit(s) above.\n`
            )
          );
        } else {
          // reconciled.status === "unavailable" — git history couldn't be walked at all.
          console.error(
            red(`     Fix: pnpm --filter @workspace/db run generate (or write a manual`)
          );
          console.error(
            red(`     migration under lib/db/migrations/manual/), then commit schema-hash.txt.`)
          );
          if (reconciled.details.length > 0) {
            console.error(dim(`     (Reconciliation via git history unavailable:`));
            for (const line of reconciled.details) {
              console.error(dim(`       ${line}`));
            }
            console.error(dim(`     — this repo/CI checkout may need full history, e.g. fetch-depth: 0.)\n`));
          }
        }
        hasError = true;
      }
    }
  }

  // =========================================================================
  // Check 2: Journal entries vs SQL files on disk
  // =========================================================================
  console.log(bold("\n2. Journal entries vs SQL files on disk"));

  if (!fs.existsSync(JOURNAL_PATH)) {
    console.error(red(`   ERROR: Drizzle journal not found at:`));
    console.error(`          ${JOURNAL_PATH}`);
    console.error(red(`   Run: pnpm --filter @workspace/db run generate\n`));
    hasError = true;
  } else {
    const journal: Journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf-8"));
    const journalEntries = journal.entries ?? [];
    const journalTags = new Set(journalEntries.map((e) => e.tag));

    const sqlFiles = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
    const sqlFileSet = new Set(sqlFiles);

    const missingFiles = journalEntries.filter((e) => !sqlFileSet.has(e.tag));
    const orphanedFiles = sqlFiles.filter((tag) => !journalTags.has(tag));

    // Journal entries
    if (journalEntries.length === 0) {
      console.log("   (journal is empty)");
    }
    for (const entry of journalEntries) {
      const hasSql = sqlFileSet.has(entry.tag);
      const mark = hasSql ? green("✓") : red("✗");
      const suffix = hasSql ? "" : red(" ← SQL FILE MISSING");
      console.log(`   ${mark} ${entry.tag}${suffix}`);
    }

    if (missingFiles.length > 0) {
      console.error(
        red(`\n   ERROR: ${missingFiles.length} journal entry/entries missing their SQL file(s):`)
      );
      for (const e of missingFiles) {
        console.error(red(`     - ${e.tag}.sql`));
      }
      console.error(red(`     Run: pnpm --filter @workspace/db run generate\n`));
      hasError = true;
    }

    // =========================================================================
    // Check 3: Orphaned SQL files
    // =========================================================================
    if (orphanedFiles.length > 0) {
      console.log("");
      console.error(
        red(bold(`   ERROR: ${orphanedFiles.length} SQL file(s) not tracked in the journal:`))
      );
      for (const tag of orphanedFiles) {
        console.error(red(`     ✗ ${tag}.sql`));
      }
      console.error(
        red(
          `     These files will NOT be applied by migrate-dev or migrate-prod — they are invisible to both runners.`
        )
      );
      console.error(
        red(`     Fix: run pnpm --filter @workspace/db run generate to register them, or remove them.\n`)
      );
      hasError = true;
    } else {
      console.log(
        dim(
          `\n   ${sqlFiles.length} SQL file(s) present — all tracked in journal, no orphans.`
        )
      );
    }
  }

  // =========================================================================
  // Check 4: Destructive migration gate headers (Git #2930)
  // =========================================================================
  console.log(bold("\n4. Destructive migration gate"));

  if (!fs.existsSync(DRIZZLE_DIR)) {
    console.error(red(`   ERROR: migrations directory not found: ${DRIZZLE_DIR}`));
    hasError = true;
  } else {
    const sqlFileNames = fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith(".sql")).sort();

    const unheadered: MigrationGateVerdict[] = [];
    const held: MigrationGateVerdict[] = [];
    const autoApproved: MigrationGateVerdict[] = [];

    for (const fileName of sqlFileNames) {
      const tag = fileName.replace(/\.sql$/, "");
      const sql = fs.readFileSync(path.join(DRIZZLE_DIR, fileName), "utf-8");
      const verdict = evaluateMigrationGate(tag, sql);

      if (verdict.holdCause === "unmarked-destructive" || verdict.holdCause === "malformed-header") {
        unheadered.push(verdict);
      } else if (verdict.holdCause === "marked-manual") {
        held.push(verdict);
      } else if (verdict.disposition === "auto-approved") {
        autoApproved.push(verdict);
      }
    }

    if (held.length > 0) {
      console.log(
        yellow(`   ${held.length} migration(s) marked @migration-gate: manual — never auto-applied:`)
      );
      for (const v of held) {
        console.log(yellow(`     ⏸ ${v.tag}.sql`));
        if (v.reason) console.log(dim(`        ${v.reason}`));
      }
      console.log(
        dim(
          `     Run these by hand against each real target, then record them with:\n` +
            `       pnpm --filter @workspace/scripts run migrate-mark-applied <tag> [--prod]`
        )
      );
    }

    if (autoApproved.length > 0) {
      console.log(
        dim(
          `   ${autoApproved.length} destructive migration(s) explicitly signed off as ` +
            `@migration-gate: auto-approved.`
        )
      );
    }

    if (unheadered.length > 0) {
      console.log("");
      console.error(
        red(bold(`   ERROR: ${unheadered.length} destructive migration(s) with no valid gate header:`))
      );
      for (const v of unheadered) {
        console.error(red(`     ✗ ${v.tag}.sql`));
        if (v.headerError) console.error(red(`        header: ${v.headerError}`));
        for (const f of v.findings) {
          console.error(red(`        line ${f.line}  [${f.kind}]  ${f.statement}`));
        }
      }
      console.error(
        red(
          `\n     These would be HELD (not applied) by migrate-dev/migrate-prod anyway — the gate\n` +
            `     fails closed. Declare the intent explicitly so the next reader knows why:\n` +
            `       -- @migration-gate: manual          (hold it — the default for anything irreversible)\n` +
            `       -- @gate-reason: <why this change is needed, with evidence>\n` +
            `     ...or, for a reviewed change genuinely safe to run unattended:\n` +
            `       -- @migration-gate: auto-approved\n` +
            `       -- @gate-reason: <why unattended execution is safe here>\n`
        )
      );
      hasError = true;
    } else if (held.length === 0 && autoApproved.length === 0) {
      console.log(
        dim(`   ✓ No destructive statements found in any migration — nothing to gate.`)
      );
    } else {
      console.log(green(`   ✓ Every destructive migration carries an explicit gate header.`));
    }
  }

  // =========================================================================
  // Auto-apply reminder
  // =========================================================================
  console.log(bold("\n5. Auto-apply coverage"));
  console.log(dim(`   Dev  (DATABASE_URL):      pnpm --filter @workspace/scripts run migrate-dev`));
  console.log(dim(`   Prod (PROD_DATABASE_URL): pnpm --filter @workspace/scripts run migrate-prod`));
  console.log(dim(`   Both runners read _journal.json and track applied entries in`));
  console.log(dim(`   __drizzle_migrations — no manual editing needed when the schema`));
  console.log(dim(`   grows. post-merge.sh calls migrate-dev automatically on every merge.`));
  console.log(dim(`   New changes: edit schema → run generate → run migrate-dev (dev) / migrate-prod (prod).`));

  // =========================================================================
  // Summary
  // =========================================================================
  console.log("");
  if (hasError) {
    console.error(
      red(bold("❌  Drift detected — see errors above. Fix before running migrate-prod.\n"))
    );
    process.exit(1);
  } else {
    console.log(green(bold("✅  No drift — schema, journal, and SQL files are all in sync.")));
    console.log(
      green(
        "    New changes: edit schema → run generate → run migrate-prod.\n"
      )
    );
    process.exit(0);
  }
}

main();
