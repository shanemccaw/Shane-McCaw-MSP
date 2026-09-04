/**
 * document-style-identifier-hygiene-558.test.ts
 *
 * Git #558. Raw internal identifiers — colon-separated check keys AND raw
 * camelCase/snake_case extracted-property field names — leaked throughout the
 * NARRATIVE PROSE of a live `governance_maturity_report`, not just in the
 * flight-log finding-entry tag that this session's earlier fixes (#554, #557,
 * and the earlier tag-scoped style-guide edit) addressed.
 *
 * The fix ships as a manual SQL migration, because the style guide is a DB row
 * (`ai_prompts.key = 'insights-document-style'`) whose live body is not in this
 * repo — so the migration APPENDS a block rather than replacing a body it
 * cannot see. This suite is the verification the environment allows: there is
 * no DATABASE_URL and no reachable model here, so it
 *
 *   1. READS the shipped migration file and extracts the exact block it
 *      appends, rather than retyping it — if the file and these expectations
 *      diverge, this suite stops describing anything that ships.
 *   2. Asserts the block's three load-bearing properties: it is scoped to ALL
 *      visible text in ANY section of ANY document type, it states the ban by
 *      SHAPE (so it generalises to identifiers not yet observed leaking), and
 *      it explicitly requires every real number and fact to still be stated —
 *      the failure mode where the model goes vague to dodge the names.
 *   3. Drives `generateDocument()`'s dry-run branch over the REAL
 *      `prompt-loader.ts` with a simulated post-migration `ai_prompts` row, and
 *      asserts the block reaches the assembled style prefix for
 *      `governance_maturity_report` (the document that surfaced the bug) and
 *      for every other document type alike.
 *
 * NOT verified here: a live regeneration. That is Shane's to run, and the fix
 * is inert until this migration is run against the live DB — nothing in a code
 * deploy activates it.
 *
 * Run: pnpm --filter @workspace/api-server run test -- document-style-identifier-hygiene-558
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ── The migration this issue ships, read rather than retyped ──────────────────

const MIGRATION_RELATIVE_PATH =
  "lib/db/migrations/manual/2026-08-08-document-style-identifier-hygiene-558.sql";

/**
 * Walks up from the vitest cwd (the api-server package) to the repo root.
 * Resolved at runtime rather than from `__dirname`, which does not exist in
 * this package's ESM build. Same approach as copilot-data-exposure-risk-553.
 */
function findMigration(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, MIGRATION_RELATIVE_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`#558 migration not found walking up from ${process.cwd()}`);
}

// Migration files in this repo are checked in with CRLF line endings (every
// file under lib/db/migrations/manual/ is CRLF, consistently). Normalized to
// LF here so the `\n`-anchored `toContain(...)` assertions below (written
// against the block's logical line breaks) match regardless of the file's
// real on-disk line ending — otherwise every assertion whose expected string
// spans a line break would silently never match a "\r\n" in the real file.
const MIGRATION_SQL = readFileSync(findMigration(), "utf8").replace(/\r\n/g, "\n");

/**
 * The dollar-quoted block the migration appends to the live style guide.
 *
 * Anchored on the CTE's own `AS marker,` line and on the closing
 * `<tag>::text AS body`, not on the first occurrence of the tag in the file —
 * the file's header comment mentions the block, and a lazy match from the top
 * silently captures the comment instead of the rule.
 */
function styleBlockFromMigration(): string {
  const TAG = "$idhyg$";
  const cteStart = MIGRATION_SQL.indexOf("AS marker,");
  if (cteStart < 0) throw new Error("#558 migration has no `AS marker,` CTE column");
  const open = MIGRATION_SQL.indexOf(TAG, cteStart);
  const close = MIGRATION_SQL.indexOf(`${TAG}::text AS body`, open + TAG.length);
  if (open < 0 || close < 0) throw new Error("#558 migration has no dollar-quoted style block");
  return MIGRATION_SQL.slice(open + TAG.length, close);
}

/** The marker string the migration's idempotency CASE guards on. */
function markerFromMigration(): string {
  const match = MIGRATION_SQL.match(/'([^']+)'::text AS marker/);
  if (!match) throw new Error("#558 migration has no '<marker>'::text AS marker");
  return match[1];
}

const STYLE_BLOCK = styleBlockFromMigration();
const MARKER = markerFromMigration();

/**
 * The migration's append, in TS: `prompt_body || E'\n\n' || block`, guarded on
 * the marker so a second run is a no-op. Mirrors the SQL's CASE exactly so the
 * body handed to the loader below is the body the DB would hold post-run.
 */
function applyMigrationAppend(existingBody: string): string {
  return existingBody.includes(MARKER) ? existingBody : `${existingBody}\n\n${STYLE_BLOCK}`;
}

/** A stand-in for the live style guide, which is not in this repo (see #558's migration header). */
const PRE_MIGRATION_STYLE_BODY = [
  "FLIGHT-READINESS REVIEW — DOCUMENT STYLE",
  "Dark screen theme, light print theme.",
  "",
  "FINDING-ENTRY TAG",
  "The mono tag under each finding card must not be a raw check key.",
].join("\n");

const POST_MIGRATION_STYLE_BODY = applyMigrationAppend(PRE_MIGRATION_STYLE_BODY);

// ── Test state ────────────────────────────────────────────────────────────────

/** The document type the pending `generateDocument()` call is for. */
let currentDocTypeKey = "governance_maturity_report";
/** The body `ai_prompts` returns for the document's own prompt row. */
const DOC_PROMPT_BODY = "Write {{sections}} using {{profileSample}} and {{findings}}.";
/** What the stubbed `ai_prompts` row for the style guide holds. */
let styleRowBody: string | null = POST_MIGRATION_STYLE_BODY;

// ── Module boundaries ─────────────────────────────────────────────────────────
//
// `prompt-loader.ts` is deliberately NOT mocked — it is half of what this suite
// verifies (that an appended body survives getDocumentStylePrefix() and lands in
// the assembled prefix). Only its DB is stubbed.

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ type: "eq", args }),
  and: (...args: unknown[]) => ({ type: "and", args }),
  desc: (...args: unknown[]) => ({ type: "desc", args }),
  inArray: (...args: unknown[]) => ({ type: "inArray", args }),
}));

// Hoisted: the `@workspace/db` factory below is evaluated at import time, before
// module-level `const`s initialize, and it needs these same object identities.
const { AI_PROMPTS_TABLE, DOCUMENT_TYPES_TABLE, TENANTS_TABLE, MSPS_TABLE } = vi.hoisted(() => ({
  AI_PROMPTS_TABLE: { __t: "ai_prompts", id: "id", key: "key", promptBody: "promptBody" },
  DOCUMENT_TYPES_TABLE: { __t: "document_types", key: "key" },
  TENANTS_TABLE: { __t: "tenants", id: "id", mspId: "mspId" },
  MSPS_TABLE: { __t: "msps", id: "id", name: "name", primaryColor: "primaryColor" },
}));

function docTypeRow(key: string): Record<string, unknown> {
  return {
    key,
    label: key,
    category: "consulting",
    pipelineCategory: "standalone",
    aiPromptId: null,
    sections: [],
    sectionHints: "Verdict",
    includedProfileKeyPatterns: [],
    includedSignalCategories: [],
  };
}

/**
 * Rows resolved by TABLE (and, for `ai_prompts`, by the key in the WHERE) rather
 * than by call order — the style-guide read and the document-prompt read both
 * hit the same table, and an order-keyed queue would silently pass if the two
 * were ever swapped.
 */
function rowsFor(table: unknown, whereValue: unknown): unknown[] {
  if (table === DOCUMENT_TYPES_TABLE) return [docTypeRow(currentDocTypeKey)];
  if (table === TENANTS_TABLE) return [{ mspId: 1 }];
  if (table === MSPS_TABLE) return [{ name: "Acme MSP", primaryColor: "#000" }];
  if (table === AI_PROMPTS_TABLE) {
    if (whereValue === "insights-document-style") {
      return styleRowBody === null ? [] : [{ promptBody: styleRowBody }];
    }
    return [{ promptBody: DOC_PROMPT_BODY }];
  }
  return [];
}

function chainStub(): Record<string, unknown> {
  let table: unknown = null;
  let whereValue: unknown = undefined;
  const obj: Record<string, unknown> = {
    from: (t: unknown) => { table = t; return obj; },
    innerJoin: () => obj,
    where: (cond: { args?: unknown[] }) => { whereValue = cond?.args?.[1]; return obj; },
    orderBy: () => obj,
    limit: () => obj,
    then: (resolve2: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rowsFor(table, whereValue)).then(resolve2, reject),
  };
  return obj;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: () => chainStub(),
    insert: () => ({ values: () => ({ returning: async () => [{ id: 4242 }] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => undefined }),
  },
  aiPromptsTable: AI_PROMPTS_TABLE,
  documentTypesTable: DOCUMENT_TYPES_TABLE,
  insightsGeneratedDocumentsTable: { id: "id" },
  tenantsTable: TENANTS_TABLE,
  mspsTable: MSPS_TABLE,
}));

// No model call happens on the dry-run branch; these exist because a mock
// missing a name the module under test imports is an import-time error.
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: vi.fn(), stream: vi.fn() } },
  withAiUsageCapture: vi.fn(),
  totalCapturedCostCents: vi.fn(),
}));

vi.mock("./tenant-signals", () => ({
  buildTenantProfile: async () => ({
    mergedProfile: { ownerlessGroupCount: 26 },
    mergedProfileByCheck: { "governance:ownerless-groups": { ownerlessGroupCount: 26 } },
    findings: ["26 of 104 groups have no owner (governance:ownerless-groups)"],
    categorizedFindings: [{
      text: "26 of 104 groups have no owner (governance:ownerless-groups)",
      categories: ["governance"],
    }],
  }),
  findReusableDocument: async () => null,
  resolveDocumentOwnerUserId: async () => 11,
  namespacedProfileKey: (checkKey: string, propertyName: string) => `${checkKey}.${propertyName}`,
  NON_CHECK_PROFILE_NAMESPACE: "_profile",
}));

vi.mock("./finding-point-impact", () => ({ computeFindingPointImpacts: async () => null }));

vi.mock("./copilot-gate", () => ({
  computeCopilotGate: async () => ({
    score: 74,
    threshold: 82,
    status: "no_go",
    source: "health_engine:copilot",
    evaluation: {
      status: "scored",
      evaluableSignalCount: 9,
      minRequiredSignals: 2,
      reason: "scored from 9 evaluable copilot signals",
    },
  }),
}));

vi.mock("./sow-pricing", () => ({ extractAiHtml: () => "<html>generated</html>" }));
vi.mock("./omg-card-generator-v2", () => ({ generateOmgCardsFromTelemetry: async () => undefined }));
vi.mock("./remediation-knowledge-base", () => ({
  buildRemediationAppendix: vi.fn(),
  REMEDIATION_APPENDIX_MAX_FINDINGS: 15,
  REMEDIATION_APPENDIX_PROMPT_SUFFIX: "",
}));

vi.mock("./logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

import { generateDocument } from "./document-engine.ts";
import { getDocumentStylePrefix } from "./prompt-loader.ts";

/** Every document type `document-engine.ts` generates — the style guide fronts all of them. */
const ALL_DOC_TYPE_KEYS = [
  "governance_maturity_report",
  "security_posture_report",
  "compliance_alignment_report",
  "license_optimization_report",
  "operational_health_report",
  "adoption_report",
  "copilot_readiness",
  "remediation_plan",
];

async function stylePrefixFor(key: string): Promise<string> {
  currentDocTypeKey = key;
  const result = await generateDocument({
    mspCustomerId: 42,
    projectId: 7,
    docTypeKey: key,
    dryRun: true,
  });
  return result.stylePrefix;
}

beforeEach(() => {
  currentDocTypeKey = "governance_maturity_report";
  styleRowBody = POST_MIGRATION_STYLE_BODY;
});

// ── 1. The block's scope ──────────────────────────────────────────────────────

describe("#558 style-guide block — scoped to ALL visible text, not one tag", () => {
  it("states that it governs every document type and every part of a document", () => {
    expect(STYLE_BLOCK).toContain("governs EVERY document type and EVERY part of a document");
    expect(STYLE_BLOCK).toContain(
      "There is no\nsection of any document in which an internal identifier is acceptable.",
    );
  });

  it("explicitly supersedes the narrower finding-entry-tag scoping", () => {
    // The whole point of the issue: the earlier instruction was tag-only, and a
    // model reading both must not treat the narrow one as the exhaustive scope.
    expect(STYLE_BLOCK).toContain("supersedes any narrower statement above");
    expect(STYLE_BLOCK).toContain("flight-log\nfinding-entry tag: that scoping was too narrow");
  });

  it("names the narrative-prose surfaces the live leak actually appeared on", () => {
    // Every one of these is a place docs/something.json leaked an identifier.
    for (const surface of [
      "executive summary",
      '"Current State"',
      "domain and section introductions",
      "finding titles",
      "headings and subheadings",
      "body paragraphs",
      "every cell of every table",
      "required/recommended actions table",
    ]) {
      expect(STYLE_BLOCK).toContain(surface);
    }
    // ...and the tag it used to be limited to is still covered, not dropped.
    expect(STYLE_BLOCK).toContain("the finding-entry tag");
  });
});

// ── 2. Stated by pattern, not by a list of already-observed strings ───────────

describe("#558 style-guide block — the ban is stated by SHAPE", () => {
  it("tells the model to judge by shape and says the examples are not exhaustive", () => {
    expect(STYLE_BLOCK).toContain("RECOGNISE IT BY SHAPE, NOT FROM A LIST");
    expect(STYLE_BLOCK).toContain("covers identifiers you have never seen before");
    expect(STYLE_BLOCK).toContain("NOT an\nexhaustive list of what is banned");
  });

  it("describes the colon-separated check-key shape structurally", () => {
    expect(STYLE_BLOCK).toContain("COLON-SEPARATED CHECK KEYS");
    expect(STYLE_BLOCK).toContain("a lowercase word, a colon, then a hyphenated");
    expect(STYLE_BLOCK).toContain("<domain>:<slug>");
  });

  it("describes the camelCase / snake_case / underscore-prefixed shape structurally", () => {
    expect(STYLE_BLOCK).toContain("camelCase, snake_case AND _underscore-prefixed FIELD NAMES");
    expect(STYLE_BLOCK).toContain("two or more words fused with an internal\n     capital");
    expect(STYLE_BLOCK).toContain("words joined by underscores");
    expect(STYLE_BLOCK).toContain("a name beginning\n     with an underscore");
    // The "fieldName: value" pairing is the exact form the live document used.
    expect(STYLE_BLOCK).toContain('never print the\n     "fieldName: value" pairing');
  });

  it("closes the loopholes the earlier narrower rules left open", () => {
    // #554 banned the check key as a HEADING; #557 banned inventing a "check:"
    // label. The live governance document used neither — it made the key the
    // SUBJECT of a sentence. All four forms are named here.
    expect(STYLE_BLOCK).toContain("not as a heading");
    expect(STYLE_BLOCK).toContain("not as a subject of a sentence");
    expect(STYLE_BLOCK).toContain("not in a table cell");
    expect(STYLE_BLOCK).toContain("not with a label in front of it");
  });
});

// ── 3. Real numbers and real facts must still be stated in full ───────────────

describe("#558 style-guide block — the values survive, only the names go", () => {
  it("states positively that every measured value is still required", () => {
    expect(STYLE_BLOCK).toContain("EVERY REAL NUMBER AND EVERY REAL FACT IS STILL STATED");
    expect(STYLE_BLOCK).toContain("It does not forbid, soften, round, generalise or\nwithhold");
    expect(STYLE_BLOCK).toContain("Translate — never omit, never hedge");
  });

  it("carries worked rewrites that keep the real numbers from the live document", () => {
    // The issue's own examples, and the values that must survive them.
    expect(STYLE_BLOCK).toContain('"26 of the tenant\'s 104 groups have no owner."');
    expect(STYLE_BLOCK).toContain('"Guest invitations are open to everyone');
    expect(STYLE_BLOCK).toContain("all 104 groups are\n        maintained by hand");
    expect(STYLE_BLOCK).toContain('"All 18 Teams have both a meeting policy and a messaging policy');
    expect(STYLE_BLOCK).toContain("440 items, 108 of them flagged as major");
    // Named explicitly so the model sees what the rewrite preserved.
    expect(STYLE_BLOCK).toContain("Every number and every real setting is\nstill on the page.");
  });

  it("names vagueness as its own failure mode, worse than the leak", () => {
    expect(STYLE_BLOCK).toContain("VAGUENESS IS A WORSE FAILURE THAN THE LEAK");
    expect(STYLE_BLOCK).toContain("Never satisfy this rule by writing less");
    expect(STYLE_BLOCK).toContain('"a certain setting"');
    expect(STYLE_BLOCK).toContain("state the exact number anyway");
    expect(STYLE_BLOCK).toContain("vague is\na failure of this rule, not compliance with it");
  });

  it("handles a value that is itself a machine token without dropping the distinction", () => {
    // `preventOrFixIssue` in the live document is a VALUE, not a field name —
    // banning it outright would delete a real fact, which #558 forbids.
    expect(STYLE_BLOCK).toContain("WHEN THE VALUE ITSELF IS A MACHINE TOKEN");
    expect(STYLE_BLOCK).toContain("preventOrFixIssue");
    expect(STYLE_BLOCK).toContain("Do not collapse two different values into one word");
    expect(STYLE_BLOCK).toContain("do\nnot invent a value that was not measured");
  });
});

// ── 4. The migration mechanics the block depends on ───────────────────────────

describe("#558 migration mechanics", () => {
  it("guards idempotency on a marker that really is in the block, exactly once", () => {
    expect(MARKER).toBe("IDENTIFIER HYGIENE");
    const occurrences = STYLE_BLOCK.split(MARKER).length - 1;
    expect(occurrences).toBe(1);
  });

  it("is a no-op on a second run rather than appending the rule twice", () => {
    const once = applyMigrationAppend(PRE_MIGRATION_STYLE_BODY);
    const twice = applyMigrationAppend(once);
    expect(twice).toBe(once);
  });

  it("appends — it never replaces a live body it cannot see", () => {
    // The pre-existing style guide (theme system + the earlier tag rule) is
    // still intact after the append. A `SET prompt_body = <full body>` here
    // would have destroyed it; the migration must never be rewritten that way.
    expect(POST_MIGRATION_STYLE_BODY).toContain("FLIGHT-READINESS REVIEW — DOCUMENT STYLE");
    expect(POST_MIGRATION_STYLE_BODY).toContain("Dark screen theme, light print theme.");
    expect(POST_MIGRATION_STYLE_BODY.startsWith(PRE_MIGRATION_STYLE_BODY)).toBe(true);
    expect(MIGRATION_SQL).not.toMatch(/SET\s+prompt_body\s*=\s*\$idhyg\$/);
  });

  it("touches only the shared style-guide row, no per-document-type prompt", () => {
    expect(MIGRATION_SQL).toContain("WHERE p.key = 'insights-document-style'");
    expect(MIGRATION_SQL).not.toContain("insights-consulting-governance_maturity_report");
    expect(MIGRATION_SQL).toContain(
      "INSERT INTO simulator_migration_runs (filename, ran_at)\nVALUES ('2026-08-08-document-style-identifier-hygiene-558.sql', now())",
    );
  });
});

// ── 5. Dry-run assembly: the block reaches every document type ────────────────

describe("#558 dry-run assembly — the rule reaches the model for every document type", () => {
  it("carries the whole block into the style prefix for governance_maturity_report", async () => {
    // The document that surfaced the bug.
    const prefix = await stylePrefixFor("governance_maturity_report");

    expect(prefix).toContain(STYLE_BLOCK);
    expect(prefix).toContain("IDENTIFIER HYGIENE — INTERNAL NAMES NEVER APPEAR IN VISIBLE TEXT");
    expect(prefix).toContain("VAGUENESS IS A WORSE FAILURE THAN THE LEAK");
    // The pre-existing guide is still in front of it, unharmed.
    expect(prefix).toContain("FLIGHT-READINESS REVIEW — DOCUMENT STYLE");
    // prompt-loader appends the separator the real branch concatenates on.
    expect(prefix.endsWith("\n\n")).toBe(true);
  });

  it.each(ALL_DOC_TYPE_KEYS)("carries the rule for %s too", async (key) => {
    const prefix = await stylePrefixFor(key);
    expect(prefix).toContain(STYLE_BLOCK);
  });

  it("puts the rule in the style prefix, not in any one document's own prompt", async () => {
    // Scope check: a rule that had leaked into the document prompt would apply
    // to one type only — the exact mistake #558 exists to correct.
    currentDocTypeKey = "governance_maturity_report";
    const result = await generateDocument({
      mspCustomerId: 42,
      projectId: 7,
      docTypeKey: "governance_maturity_report",
      dryRun: true,
    });
    expect(result.stylePrefix).toContain(MARKER);
    expect(result.assembledPrompt).not.toContain(MARKER);
  });

  it("is absent — honestly, not silently substituted — when the style row is missing", async () => {
    // getDocumentStylePrefix() returns "" with no row. Worth pinning: it means
    // this fix is inert until the migration is actually run, which is why the
    // migration's receipt calls zero rows a failure rather than a no-op.
    styleRowBody = null;
    expect(await getDocumentStylePrefix()).toBe("");
    expect(await stylePrefixFor("governance_maturity_report")).toBe("");
  });
});
