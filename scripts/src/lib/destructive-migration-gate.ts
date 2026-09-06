/**
 * destructive-migration-gate.ts
 *
 * The "destructive migration" gate for the automatic post-merge pipeline
 * (Git #2930).
 *
 * WHY THIS EXISTS
 * ---------------
 * `scripts/post-merge.sh` runs `migrate-dev` on every merge, and `migrate-prod`
 * too when a prod DB env var is set — both with no human review step. That is
 * correct for the additive DDL that makes up the overwhelming majority of
 * `lib/db/drizzle/*.sql`, and directly wrong for anything irreversible.
 * CLAUDE.md's Database section draws the line explicitly:
 *
 *   "Destructive or irreversible changes (dropping columns/tables, bulk
 *    rewrites, anything production-affecting) still go to Shane to run himself."
 *
 * Before this gate existed there was no way to honour that rule and still let a
 * destructive migration live in the journal: registering the file was the same
 * action as scheduling it to run unattended. #2930's own orphan
 * (`0201_drop_service_page_trigger_keys.sql`) sat unregistered for exactly that
 * reason, permanently reddening `check-migration-drift`.
 *
 * THE CONVENTION
 * --------------
 * A structured comment header in the leading comment block of the .sql file:
 *
 *   -- @migration-gate: manual
 *   -- @gate-reason: DROP TABLE foo — dead feature removed in <sha> (#1234)
 *
 * `@migration-gate` takes exactly one of two dispositions:
 *
 *   manual         The runners never execute this file. They report it as HELD
 *                  and move on. A human runs the SQL against each real target by
 *                  hand, then records it with `migrate-mark-applied`.
 *
 *   auto-approved  An explicit, reasoned sign-off that this file is safe to run
 *                  unattended despite tripping the detector. Use sparingly.
 *
 * `@gate-reason` is REQUIRED with either disposition. A header with no reason,
 * or an unrecognised disposition, is itself a hold — the gate fails closed.
 *
 * THE DETECTOR (the safety net)
 * -----------------------------
 * A file with no header at all that nonetheless contains a destructive statement
 * is ALSO held, with a message telling the author to pick a disposition. This is
 * what makes the gate real rather than advisory: forgetting the marker cannot
 * silently execute a DROP.
 *
 * What counts as destructive is deliberately scoped to CLAUDE.md's own wording —
 * "dropping columns/tables, bulk rewrites" — not a wider invented boundary:
 *
 *   DROP TABLE / DROP COLUMN / DROP SCHEMA / DROP DATABASE
 *   DROP TYPE / DROP SEQUENCE / DROP MATERIALIZED VIEW
 *   TRUNCATE
 *   DELETE without a WHERE clause   (bulk rewrite)
 *   UPDATE without a WHERE clause   (bulk rewrite)
 *
 * Explicitly NOT destructive, because each is reversible by re-running DDL and
 * loses no data: DROP CONSTRAINT, DROP INDEX, DROP DEFAULT, DROP NOT NULL,
 * DROP TRIGGER, DROP FUNCTION, DROP POLICY, plain (non-materialized) DROP VIEW,
 * and any RENAME. All of these appear in the existing corpus and must keep
 * flowing through the pipeline untouched.
 *
 * `IF EXISTS` does NOT soften anything: a DROP TABLE IF EXISTS still destroys
 * the table when the table is there, which is the whole risk.
 */

/** Exit code the runners use for "ran fine, but N migration(s) were held." */
export const GATE_HELD_EXIT_CODE = 3;

/** The two dispositions the `@migration-gate` header accepts. */
export type GateDisposition = "manual" | "auto-approved";

export const GATE_DISPOSITIONS: readonly GateDisposition[] = ["manual", "auto-approved"];

export interface DestructiveFinding {
  /** Short slug for the statement class, e.g. "drop-table". */
  kind: string;
  /** 1-based line number in the ORIGINAL file. */
  line: number;
  /** The offending statement, whitespace-collapsed and truncated for display. */
  statement: string;
}

export interface GateHeader {
  disposition: GateDisposition | null;
  reason: string | null;
  /** Non-null when the header itself is malformed — always a hold. */
  error: string | null;
}

export interface MigrationGateVerdict {
  tag: string;
  /** True when the detector found at least one irreversible statement. */
  destructive: boolean;
  findings: DestructiveFinding[];
  disposition: GateDisposition | null;
  reason: string | null;
  headerError: string | null;
  action: "apply" | "hold";
  holdCause: "marked-manual" | "unmarked-destructive" | "malformed-header" | null;
}

// ---------------------------------------------------------------------------
// Masking — blank out comments and string literals WITHOUT changing any offset,
// so every reported line number still points at the real line in the real file.
// ---------------------------------------------------------------------------

/**
 * Replaces the contents of line comments, block comments and single-quoted
 * string literals with spaces, preserving length and every newline.
 *
 * This is what stops the gate reading its own `@gate-reason:` prose as a
 * destructive statement, and stops an INSERT of a literal string containing the
 * word TRUNCATE from tripping the detector.
 *
 * Dollar-quoted bodies (`DO $$ ... $$`) are deliberately NOT masked — they hold
 * real executable statements (0030_services_deliverables_jsonb.sql wraps a real
 * `ALTER TABLE ... DROP COLUMN` in one) and must be scanned.
 */
export function maskSqlNoise(sql: string): string {
  const out = sql.split("");
  const n = sql.length;
  const quote = "'";
  let i = 0;

  const blankRange = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };

  while (i < n) {
    const two = sql.slice(i, i + 2);

    if (two === "--") {
      let end = sql.indexOf("\n", i);
      if (end === -1) end = n;
      blankRange(i, end);
      i = end;
      continue;
    }

    if (two === "/*") {
      const close = sql.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      blankRange(i, end);
      i = end;
      continue;
    }

    if (sql[i] === quote) {
      let k = i + 1;
      while (k < n) {
        if (sql[k] === quote) {
          if (sql[k + 1] === quote) {
            k += 2; // an escaped quote inside the literal
            continue;
          }
          break;
        }
        k++;
      }
      blankRange(i + 1, Math.min(k, n));
      i = Math.min(k + 1, n);
      continue;
    }

    i++;
  }

  return out.join("");
}

function lineAt(sql: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < sql.length; i++) {
    if (sql[i] === "\n") line++;
  }
  return line;
}

function displayStatement(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > 140 ? `${collapsed.slice(0, 137)}…` : collapsed;
}

interface Statement {
  /** Offset of the statement's first character in the original SQL. */
  start: number;
  /** Masked statement text (safe to pattern-match). */
  masked: string;
  /** Original statement text (safe to display). */
  original: string;
}

/**
 * Splits masked SQL into statements on the statement separator. Drizzle's
 * `--> statement-breakpoint` markers are line comments and have already been
 * masked away by `maskSqlNoise`.
 */
function splitStatements(sql: string, masked: string): Statement[] {
  const statements: Statement[] = [];
  let start = 0;
  for (let i = 0; i <= masked.length; i++) {
    if (i === masked.length || masked[i] === ";") {
      const chunk = masked.slice(start, i);
      if (chunk.trim().length > 0) {
        statements.push({ start, masked: chunk, original: sql.slice(start, i) });
      }
      start = i + 1;
    }
  }
  return statements;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Statement classes that destroy data or a data-bearing object outright.
 * DROP is matched only when the very next keyword is one of these — which is
 * precisely why DROP CONSTRAINT, DROP INDEX, DROP DEFAULT, DROP NOT NULL and
 * DROP TRIGGER do not match.
 */
const DESTRUCTIVE_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "drop-table", re: /\bDROP\s+TABLE\b/i },
  { kind: "drop-column", re: /\bDROP\s+COLUMN\b/i },
  { kind: "drop-schema", re: /\bDROP\s+SCHEMA\b/i },
  { kind: "drop-database", re: /\bDROP\s+DATABASE\b/i },
  { kind: "drop-type", re: /\bDROP\s+TYPE\b/i },
  { kind: "drop-sequence", re: /\bDROP\s+SEQUENCE\b/i },
  { kind: "drop-materialized-view", re: /\bDROP\s+MATERIALIZED\s+VIEW\b/i },
  { kind: "truncate", re: /\bTRUNCATE\b/i },
];

/** Finds every irreversible statement in `sql`, with real line numbers. */
export function detectDestructive(sql: string): DestructiveFinding[] {
  const masked = maskSqlNoise(sql);
  const findings: DestructiveFinding[] = [];

  for (const statement of splitStatements(sql, masked)) {
    // `leadingWs` skips whatever the mask blanked out ahead of the statement —
    // typically a comment block. Both the reported line number AND the displayed
    // text start after it, so a hold notice shows the offending SQL rather than
    // the file's own header prose.
    const leadingWs = statement.masked.length - statement.masked.trimStart().length;
    const line = lineAt(sql, statement.start + leadingWs);
    const text = displayStatement(statement.original.slice(leadingWs));

    let matched = false;
    for (const { kind, re } of DESTRUCTIVE_PATTERNS) {
      if (re.test(statement.masked)) {
        findings.push({ kind, line, statement: text });
        matched = true;
      }
    }
    if (matched) continue;

    // Bulk rewrites: a DELETE or UPDATE with no WHERE clause touches every row.
    if (/\bDELETE\s+FROM\b/i.test(statement.masked) && !/\bWHERE\b/i.test(statement.masked)) {
      findings.push({ kind: "delete-without-where", line, statement: text });
    } else if (
      /\bUPDATE\b[\s\S]*\bSET\b/i.test(statement.masked) &&
      !/\bWHERE\b/i.test(statement.masked)
    ) {
      findings.push({ kind: "update-without-where", line, statement: text });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

const GATE_LINE_RE = /^\s*--\s*@migration-gate\s*:\s*(.*)$/i;
const REASON_LINE_RE = /^\s*--\s*@gate-reason\s*:\s*(.*)$/i;

const MIN_REASON_LENGTH = 10;

/**
 * Reads the `@migration-gate` / `@gate-reason` header out of a migration file.
 *
 * The header must live in the file's LEADING comment block — the run of comment
 * and blank lines before the first line of real SQL. That keeps it in the one
 * place a reader (or a `head -5`) will actually look.
 */
export function parseGateHeader(sql: string): GateHeader {
  let rawDisposition: string | null = null;
  let reason: string | null = null;

  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (!trimmed.startsWith("--")) break; // first real SQL line ends the header

    const gate = GATE_LINE_RE.exec(line);
    if (gate?.[1] !== undefined) {
      rawDisposition = gate[1].trim();
      continue;
    }
    const because = REASON_LINE_RE.exec(line);
    if (because?.[1] !== undefined) {
      reason = because[1].trim();
    }
  }

  if (rawDisposition === null) {
    if (reason !== null) {
      return {
        disposition: null,
        reason,
        error: "found a @gate-reason line with no @migration-gate line above it",
      };
    }
    return { disposition: null, reason: null, error: null };
  }

  const normalised = rawDisposition.toLowerCase();
  if (!GATE_DISPOSITIONS.includes(normalised as GateDisposition)) {
    return {
      disposition: null,
      reason,
      error:
        `unrecognised disposition "${rawDisposition}" — expected one of: ` +
        GATE_DISPOSITIONS.join(", "),
    };
  }

  if (reason === null || reason.length < MIN_REASON_LENGTH) {
    return {
      disposition: normalised as GateDisposition,
      reason,
      error:
        `@migration-gate: ${normalised} requires a @gate-reason line of at least ` +
        `${MIN_REASON_LENGTH} characters explaining the decision`,
    };
  }

  return { disposition: normalised as GateDisposition, reason, error: null };
}

// ---------------------------------------------------------------------------
// The gate itself
// ---------------------------------------------------------------------------

/** Decides whether a runner may execute this migration. Fails closed. */
export function evaluateMigrationGate(tag: string, sql: string): MigrationGateVerdict {
  const header = parseGateHeader(sql);
  const findings = detectDestructive(sql);
  const destructive = findings.length > 0;

  const base = {
    tag,
    destructive,
    findings,
    disposition: header.disposition,
    reason: header.reason,
    headerError: header.error,
  };

  if (header.error !== null) {
    return { ...base, action: "hold" as const, holdCause: "malformed-header" as const };
  }
  if (header.disposition === "manual") {
    return { ...base, action: "hold" as const, holdCause: "marked-manual" as const };
  }
  if (header.disposition === "auto-approved") {
    return { ...base, action: "apply" as const, holdCause: null };
  }
  if (destructive) {
    return { ...base, action: "hold" as const, holdCause: "unmarked-destructive" as const };
  }
  return { ...base, action: "apply" as const, holdCause: null };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function findingLines(verdict: MigrationGateVerdict, indent: string): string[] {
  return verdict.findings.map((f) => `${indent}line ${f.line}  [${f.kind}]  ${f.statement}`);
}

/** The per-migration notice a runner prints when it holds a file. */
export function formatHoldNotice(verdict: MigrationGateVerdict): string {
  const lines: string[] = [];

  switch (verdict.holdCause) {
    case "marked-manual":
      lines.push(
        `[gate] HELD ${verdict.tag} — marked @migration-gate: manual, never auto-applied.`
      );
      if (verdict.reason) lines.push(`[gate]   reason: ${verdict.reason}`);
      break;
    case "unmarked-destructive":
      lines.push(
        `[gate] HELD ${verdict.tag} — destructive statement(s) with no @migration-gate header.`
      );
      break;
    case "malformed-header":
      lines.push(`[gate] HELD ${verdict.tag} — malformed gate header: ${verdict.headerError}`);
      break;
    default:
      lines.push(`[gate] HELD ${verdict.tag}.`);
  }

  lines.push(...findingLines(verdict, "[gate]   "));
  return lines.join("\n");
}

/**
 * The end-of-run banner. `target` is a human label for the database the runner
 * was pointed at ("dev", "production").
 */
export function formatHeldSummary(verdicts: MigrationGateVerdict[], target: string): string {
  if (verdicts.length === 0) return "";

  const rule = "=".repeat(78);
  const lines: string[] = [];
  lines.push("");
  lines.push(rule);
  lines.push(
    `  DESTRUCTIVE MIGRATION GATE — ${verdicts.length} migration(s) NOT applied to ${target}`
  );
  lines.push(rule);
  for (const v of verdicts) {
    lines.push("");
    lines.push(`  ${v.tag}.sql`);
    if (v.holdCause === "marked-manual") {
      lines.push(`    held by: -- @migration-gate: manual`);
      if (v.reason) lines.push(`    reason : ${v.reason}`);
    } else if (v.holdCause === "malformed-header") {
      lines.push(`    held by: malformed gate header — ${v.headerError}`);
    } else {
      lines.push(`    held by: destructive statement(s), no -- @migration-gate: header`);
    }
    for (const line of findingLines(v, "      ")) lines.push(line);
  }
  lines.push("");
  lines.push("-".repeat(78));
  lines.push("  These files were left PENDING on purpose. Nothing was executed and nothing");
  lines.push("  was recorded in __drizzle_migrations, so the merge is not broken — but the");
  lines.push("  schema change has NOT happened yet.");
  lines.push("");
  lines.push("  To clear a HELD migration:");
  lines.push("    1. Review the SQL yourself.");
  lines.push("    2. Run it by hand against each real target (dev, and prod if it lives there).");
  lines.push("    3. Record it so the gate stops re-reporting it:");
  lines.push("         pnpm --filter @workspace/scripts run migrate-mark-applied <tag>");
  lines.push("         pnpm --filter @workspace/scripts run migrate-mark-applied <tag> --prod");
  lines.push("");
  lines.push("  If a file was held only because it has no header, add one:");
  lines.push("    -- @migration-gate: manual        (hold it — the default for anything irreversible)");
  lines.push("    -- @gate-reason: <why this change is needed, with evidence>");
  lines.push("  ...or, for a reviewed change that is genuinely safe to run unattended:");
  lines.push("    -- @migration-gate: auto-approved");
  lines.push("    -- @gate-reason: <why unattended execution is safe here>");
  lines.push(rule);
  lines.push("");
  return lines.join("\n");
}
