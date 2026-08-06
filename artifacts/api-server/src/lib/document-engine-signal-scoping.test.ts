/**
 * document-engine-signal-scoping.test.ts
 *
 * Locks the `includedSignalCategories` findings filter in document-engine.ts —
 * the same `scopeFindingsBySignalCategory()` both the dry-run and the real-run
 * branches call, so a preview can never disagree with the document that
 * actually gets generated.
 *
 * The three behaviors that matter:
 *   1. Empty includedSignalCategories = NO filter (all findings pass through),
 *      matching includedProfileKeyPatterns' existing fallback convention. Any
 *      document type configured before this filter existed must be unaffected.
 *   2. A configured list keeps a finding when the check that produced it feeds
 *      a signal rule in ANY of the requested categories.
 *   3. An uncategorizable finding (`categories: []` — every script-run finding)
 *      is EXCLUDED when a filter is set, never included by default.
 *
 * `scopeFindingsBySignalCategory` itself is vocabulary-agnostic — it does plain
 * set-membership on whatever strings `categories` carries, never parses or
 * validates them. So these fixtures are unaffected by Git #481's switch of that
 * vocabulary from a parsed `signal_key` domain segment to `signal_derivation_
 * rules.pillar` directly; "security"/"governance"/"adoption"/"copilot" below are
 * valid values under either scheme.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi } from "vitest";

// document-engine.ts pulls in the real db/Anthropic client at import time; stub
// the module boundaries so this pure helper can be imported in isolation.
vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
  aiPromptsTable: {},
  documentTypesTable: {},
  insightsGeneratedDocumentsTable: {},
  tenantsTable: {},
  mspsTable: {},
}));
// document-engine.ts also imports the cost-capture helpers (Phase 5); a mock
// missing a name the module under test imports is an import-time error in
// vitest, so both are stubbed even though these tests only call a pure helper.
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: vi.fn() } },
  withAiUsageCapture: vi.fn(),
  totalCapturedCostCents: vi.fn(),
}));
vi.mock("./logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
// Git #493's appendix module, which document-engine.ts now imports. Stubbed at
// the boundary (rather than pulled in for real) because it reaches the AI
// generator and two more tables, none of which this pure-helper test exercises.
vi.mock("./remediation-knowledge-base", () => ({
  buildRemediationAppendix: vi.fn(),
  REMEDIATION_APPENDIX_MAX_FINDINGS: 15,
  REMEDIATION_APPENDIX_PROMPT_SUFFIX: "",
}));

import { scopeFindingsBySignalCategory } from "./document-engine.ts";
import type { CategorizedFinding } from "./tenant-signals.ts";

// checkKey/severity/itemCount are Git #493's additive annotation on the same
// type (they let the Remediation Plan's appendix look a finding's verified
// knowledge-base row up). `scopeFindingsBySignalCategory` never reads them —
// they are carried here only so the fixtures remain honest `CategorizedFinding`
// values, matching what `buildTenantProfile()` really produces.
const MONITOR_SECURITY: CategorizedFinding = {
  text: "identity:stale-guests: high severity condition matched on latest monitoring scan (4 items)",
  categories: ["security"],
  checkKey: "identity:stale-guests",
  severity: "high",
  itemCount: 4,
};
const MONITOR_GOVERNANCE_AND_SECURITY: CategorizedFinding = {
  text: "sharepoint:anonymous-links: warning severity condition matched on latest monitoring scan (7 items)",
  categories: ["governance", "security"],
  checkKey: "sharepoint:anonymous-links",
  severity: "warning",
  itemCount: 7,
};
const MONITOR_ADOPTION: CategorizedFinding = {
  text: "adoption:teams-usage: medium severity condition matched on latest monitoring scan (2 items)",
  categories: ["adoption"],
  checkKey: "adoption:teams-usage",
  severity: "medium",
  itemCount: 2,
};
const SCRIPT_UNCATEGORIZABLE: CategorizedFinding = {
  text: "Legacy script finding with no checkKey",
  categories: [],
  checkKey: null,
  severity: null,
  itemCount: null,
};

const ALL: CategorizedFinding[] = [
  SCRIPT_UNCATEGORIZABLE,
  MONITOR_SECURITY,
  MONITOR_GOVERNANCE_AND_SECURITY,
  MONITOR_ADOPTION,
];
const ALL_TEXTS = ALL.map((f) => f.text);

describe("scopeFindingsBySignalCategory", () => {
  it("passes every finding through untouched when includedSignalCategories is empty", () => {
    // Pre-existing behavior for any unconfigured document type — the exact same
    // fallback convention includedProfileKeyPatterns uses.
    expect(scopeFindingsBySignalCategory(ALL, ALL_TEXTS, [])).toEqual(ALL_TEXTS);
    // Returns the caller's own findings array, so an uncategorizable-only tenant
    // still gets its findings when no filter is configured.
    expect(scopeFindingsBySignalCategory([], ["raw finding"], [])).toEqual(["raw finding"]);
  });

  it("keeps only findings whose check feeds a rule in a requested category", () => {
    const kept = scopeFindingsBySignalCategory(ALL, ALL_TEXTS, ["adoption"]);
    expect(kept).toEqual([MONITOR_ADOPTION.text]);
  });

  it("matches on ANY overlapping category, not all of them", () => {
    const kept = scopeFindingsBySignalCategory(ALL, ALL_TEXTS, ["governance"]);
    // Multi-category finding qualifies on its governance half alone.
    expect(kept).toEqual([MONITOR_GOVERNANCE_AND_SECURITY.text]);
  });

  it("unions across multiple requested categories, without duplicating a multi-category finding", () => {
    const kept = scopeFindingsBySignalCategory(ALL, ALL_TEXTS, ["security", "adoption"]);
    expect(kept).toEqual([
      MONITOR_SECURITY.text,
      MONITOR_GOVERNANCE_AND_SECURITY.text,
      MONITOR_ADOPTION.text,
    ]);
  });

  it("EXCLUDES uncategorizable findings when a filter is set — never includes them by default", () => {
    const kept = scopeFindingsBySignalCategory(ALL, ALL_TEXTS, ["security"]);
    expect(kept).not.toContain(SCRIPT_UNCATEGORIZABLE.text);
    // …and a tenant whose findings are ALL uncategorizable yields an empty,
    // honest set rather than silently leaking every finding into a scoped doc.
    expect(scopeFindingsBySignalCategory([SCRIPT_UNCATEGORIZABLE], [SCRIPT_UNCATEGORIZABLE.text], ["security"])).toEqual([]);
  });

  it("returns an empty set when no finding matches the requested category", () => {
    expect(scopeFindingsBySignalCategory(ALL, ALL_TEXTS, ["copilot"])).toEqual([]);
  });

  it("preserves buildTenantProfile's finding order", () => {
    const kept = scopeFindingsBySignalCategory(ALL, ALL_TEXTS, ["security"]);
    expect(kept).toEqual([MONITOR_SECURITY.text, MONITOR_GOVERNANCE_AND_SECURITY.text]);
  });
});
