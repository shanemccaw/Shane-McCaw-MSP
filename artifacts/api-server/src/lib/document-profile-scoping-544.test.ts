/**
 * document-profile-scoping-544.test.ts
 *
 * Git #544 companion 3 — `{{profileSample}}` and
 * `included_profile_key_patterns` now read the NAMESPACED profile
 * (`<checkKey>.<property>`) instead of the flat `mergedProfile`, whose generic
 * raw-extraction names collide across 89 of the catalogue's 408 keys.
 *
 * The trap this file exists to prevent, found during the investigation:
 * `Object.assign` is case-SENSITIVE, so `Name_count` (4 checks) and
 * `name_count` (3 checks) — like `State_*` (2) and `state_*` (2) — are
 * genuinely DIFFERENT profile keys holding different values. The old
 * `matchesProfilePattern` lower-cased both sides, so a scoping pattern of
 * `name*` admitted BOTH groups and fused seven checks' data into one bucket in
 * the prompt: a collision the merge itself never made. Fixing the merge while
 * leaving the matcher lower-casing would have re-introduced the bug one layer
 * up, in the exact surface the 9 document types' scoping work is about to be
 * written against.
 *
 * The resolution: fold case on the check-key namespace only (a lower-case
 * `<domain>:<name>` vocabulary, so folding it is free and keeps a hand-typed
 * pattern forgiving), and compare the property segment VERBATIM.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
  aiPromptsTable: {},
  documentTypesTable: {},
  insightsGeneratedDocumentsTable: {},
  tenantsTable: {},
  mspsTable: {},
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: vi.fn() } },
  withAiUsageCapture: vi.fn(),
  totalCapturedCostCents: vi.fn(),
}));
vi.mock("./logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("./remediation-knowledge-base", () => ({
  buildRemediationAppendix: vi.fn(),
  REMEDIATION_APPENDIX_MAX_FINDINGS: 15,
  REMEDIATION_APPENDIX_PROMPT_SUFFIX: "",
}));
// tenant-signals (imported for real, since the helpers under test are its
// namespacing contract) pulls sla-engine in transitively.
vi.mock("./sla-engine", () => ({
  startSlaTimer: vi.fn(() => Promise.resolve({ timerId: 1, alreadyExisted: false })),
}));

import { matchesProfilePattern, namespacedProfileEntries } from "./document-engine.ts";
import { NON_CHECK_PROFILE_NAMESPACE, type MergedProfileByCheck } from "./tenant-signals.ts";

/**
 * The live case-folding trap, as two real checks. Both emit a display-name
 * property, but one check's `monitor_checks.properties` entry is `Name` and the
 * other's is `name` — so the merge produced `Name_count` and `name_count` as
 * two separate keys with two different values, and neither is "the same key".
 */
const CASE_TRAP: MergedProfileByCheck = {
  "identity:named-locations": { Name_count: 4, Name_first: "HQ" },
  "teams:channel-sprawl": { name_count: 27, name_first: "General" },
};

const COLLISION_CASE: MergedProfileByCheck = {
  "appgov:enterprise-app-count": { displayName_count: 495, _itemCount: 495 },
  "teams:team-count": { displayName_count: 18, _itemCount: 18 },
  [NON_CHECK_PROFILE_NAMESPACE]: { securityScore: 41 },
};

const keysMatching = (byCheck: MergedProfileByCheck, pattern: string): string[] =>
  namespacedProfileEntries(byCheck).filter(([k]) => matchesProfilePattern(k, pattern)).map(([k]) => k);

describe("#544 companion 3 — namespacedProfileEntries", () => {
  it("flattens to <checkKey>.<property>, so a pattern can name ONE check's value", () => {
    expect(namespacedProfileEntries(COLLISION_CASE)).toEqual([
      ["_profile.securityScore", 41],
      ["appgov:enterprise-app-count._itemCount", 495],
      ["appgov:enterprise-app-count.displayName_count", 495],
      ["teams:team-count._itemCount", 18],
      ["teams:team-count.displayName_count", 18],
    ]);
  });

  it("is deterministically ordered — the drift gate and response cache both hash the prompt", () => {
    const shuffled: MergedProfileByCheck = {
      "teams:team-count": { displayName_count: 18, _itemCount: 18 },
      [NON_CHECK_PROFILE_NAMESPACE]: { securityScore: 41 },
      "appgov:enterprise-app-count": { _itemCount: 495, displayName_count: 495 },
    };
    expect(namespacedProfileEntries(shuffled)).toEqual(namespacedProfileEntries(COLLISION_CASE));
  });

  it("lets a pattern select ONE of two checks that share a colliding property name", () => {
    expect(keysMatching(COLLISION_CASE, "appgov:enterprise-app-count.displayName_count"))
      .toEqual(["appgov:enterprise-app-count.displayName_count"]);
    // The flat profile could only ever have offered `displayName_count`, which
    // named 16 checks and silently resolved to whichever sorted last.
    expect(keysMatching(COLLISION_CASE, "displayName_count")).toEqual([]);
  });
});

describe("#544 companion 3 — case-sensitivity fusion", () => {
  it("does NOT fuse Name_* with name_* — they are different keys and stay different", () => {
    expect(keysMatching(CASE_TRAP, "teams:channel-sprawl.name*"))
      .toEqual(["teams:channel-sprawl.name_count", "teams:channel-sprawl.name_first"]);
    // The old matcher lower-cased both sides, so this pattern also admitted
    // identity:named-locations' Name_* values.
    expect(keysMatching(CASE_TRAP, "teams:channel-sprawl.Name*")).toEqual([]);
  });

  it("keeps the same distinction within a SINGLE check that emits both spellings", () => {
    const bothSpellings: MergedProfileByCheck = {
      "identity:risky-signins": { State_count: 2, state_count: 9 },
    };
    expect(keysMatching(bothSpellings, "identity:risky-signins.state*")).toEqual(["identity:risky-signins.state_count"]);
    expect(keysMatching(bothSpellings, "identity:risky-signins.State*")).toEqual(["identity:risky-signins.State_count"]);
  });

  it("still folds case on the check-key namespace, so a hand-typed pattern is forgiving there", () => {
    expect(keysMatching(CASE_TRAP, "Teams:Channel-Sprawl.name_count")).toEqual(["teams:channel-sprawl.name_count"]);
  });

  it("selects a whole check, or a whole domain, with a namespace-only wildcard", () => {
    expect(keysMatching(CASE_TRAP, "identity:named-locations.*"))
      .toEqual(["identity:named-locations.Name_count", "identity:named-locations.Name_first"]);
    expect(keysMatching(COLLISION_CASE, "teams:*"))
      .toEqual(["teams:team-count._itemCount", "teams:team-count.displayName_count"]);
  });

  it("reaches the check-key-less bucket by its reserved namespace", () => {
    expect(keysMatching(COLLISION_CASE, "_profile.securityScore")).toEqual(["_profile.securityScore"]);
  });

  it("matches an exact key exactly, with no accidental prefix behaviour", () => {
    expect(matchesProfilePattern("teams:team-count.displayName_count", "teams:team-count.displayName")).toBe(false);
    expect(matchesProfilePattern("teams:team-count.displayName_count", "teams:team-count.displayName*")).toBe(true);
  });
});
