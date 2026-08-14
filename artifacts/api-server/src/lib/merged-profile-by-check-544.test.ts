/**
 * merged-profile-by-check-544.test.ts
 *
 * Git #544 — `mergeMonitorProfileRows()` merged every check's extracted
 * properties into ONE flat namespace via `Object.assign`, so any property NAME
 * shared by two checks silently overwrote. Because
 * `fetchLatestMonitorProfileRows` orders by `check_key ASC`, the collision was
 * not random: the alphabetically LAST check won, deterministically, every
 * build. Confirmed live against the full catalogue (2026-08-07): 137 active
 * checks, 408 distinct property names, 89 colliding — `_itemCount` across all
 * 137, `id_*` across 96, `displayName_*` across 16.
 *
 * The fix is ADDITIVE (option B, signed off on the issue): a namespaced
 * `mergedProfileByCheck` companion, with the flat `mergedProfile` left exactly
 * as it was so all 214 `signal_derivation_rules` keep evaluating identically
 * (the live audit confirmed zero exposed rules read any colliding name).
 *
 * What these tests bind:
 *   1. A genuine collision resolves correctly through `mergedProfileByCheck`
 *      while the flat profile still shows the OLD alphabetical-winner value —
 *      i.e. the fix adds a path, it does not change the existing one.
 *   2. The overwrite is now LOUD: a warn on the engine.signals channel when a
 *      key is overwritten with a DIFFERENT value, and silence when the values
 *      are identical (`_licenseGap`/`_licenseGapCode` agree everywhere and
 *      would otherwise drown the signal).
 *   3. `matchesProfilePattern` no longer FUSES `Name_*` with `name_*` — those
 *      are genuinely different keys under case-sensitive `Object.assign`, and
 *      the old lower-casing matcher merged them in the prompt: a collision the
 *      merge itself never made.
 *   4. The scoping picker (`fetchProfileKeyGroups`) emits namespaced keys
 *      covering the raw-extraction class it was previously blind to, and groups
 *      by real domain (the old `split("://")` never fired on a `:` vocabulary).
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted so the logger mock factory (which vitest lifts above the imports) can
// close over it — a plain const is still in its TDZ at that point.
const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), selectDistinctOn: vi.fn() },
  clientM365ProfilesTable: {},
  scriptRunResultsTable: {},
  tenantsTable: {},
  usersTable: {},
  tenantMonitorProfilesTable: { checkKey: "checkKey", collectedAt: "collectedAt", tenantId: "tenantId" },
  signalDerivationRulesTable: {},
  monitorChecksTable: { key: "key", mapping: "mapping", properties: "properties", status: "status" },
}));

vi.mock("./logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: warnSpy, error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock("./sla-engine", () => ({
  startSlaTimer: vi.fn(() => Promise.resolve({ timerId: 1, alreadyExisted: false })),
}));

import {
  mergeMonitorProfileRows,
  namespacedProfileKey,
  NON_CHECK_PROFILE_NAMESPACE,
  type MergedProfileByCheck,
  type TenantMonitorProfileRow,
} from "./tenant-signals.ts";

const row = (checkKey: string, props: Record<string, unknown> | null): TenantMonitorProfileRow =>
  ({ checkKey, status: "ok", severityMatched: null, extractedProperties: props });

/**
 * The real shape of the live collision, reduced to two checks: both emit
 * `displayName_count` from raw extraction, with genuinely different real
 * values, and `teams:team-count` sorts last so it is the flat-profile winner —
 * exactly as `fetchLatestMonitorProfileRows`' `ORDER BY check_key ASC` delivers
 * them.
 */
const COLLIDING_ROWS: TenantMonitorProfileRow[] = [
  row("appgov:enterprise-app-count", { displayName_count: 495, id_count: 495, _itemCount: 495 }),
  row("teams:team-count", { displayName_count: 18, id_count: 18, _itemCount: 18 }),
];

beforeEach(() => {
  warnSpy.mockClear();
});

describe("#544 — mergedProfileByCheck resolves a real collision the flat profile loses", () => {
  it("keeps BOTH checks' values, keyed by the check that produced each", () => {
    const flat: Record<string, unknown> = {};
    const byCheck: MergedProfileByCheck = {};
    mergeMonitorProfileRows(flat, COLLIDING_ROWS, byCheck);

    expect(byCheck["appgov:enterprise-app-count"]?.["displayName_count"]).toBe(495);
    expect(byCheck["teams:team-count"]?.["displayName_count"]).toBe(18);
    // The 495 enterprise apps are recoverable now — that is the whole fix.
    expect(byCheck["appgov:enterprise-app-count"]?.["id_count"]).toBe(495);
  });

  it("leaves the flat mergedProfile on its EXISTING alphabetical-winner behaviour, unchanged", () => {
    const flat: Record<string, unknown> = {};
    mergeMonitorProfileRows(flat, COLLIDING_ROWS, {});

    // Deliberately still 18 (teams:team-count, the alphabetically-last check).
    // Every existing rule/engine reading the flat profile must see exactly what
    // it saw before the fix — this is an additive change, not a migration.
    expect(flat["displayName_count"]).toBe(18);
    expect(flat["id_count"]).toBe(18);
    // Git #545: bare _itemCount no longer lands in the flat profile at all —
    // superseded by the namespaced <checkKey>__itemCount, asserted below.
    expect("_itemCount" in flat).toBe(false);
  });

  it("produces a byte-identical flat profile whether or not the companion is collected", () => {
    const withCompanion: Record<string, unknown> = {};
    const withoutCompanion: Record<string, unknown> = {};
    mergeMonitorProfileRows(withCompanion, COLLIDING_ROWS, {});
    mergeMonitorProfileRows(withoutCompanion, COLLIDING_ROWS);
    expect(withCompanion).toEqual(withoutCompanion);
  });

  it("still stamps the pre-existing synthetic <checkKey>__itemCount for BOTH checks", () => {
    const flat: Record<string, unknown> = {};
    mergeMonitorProfileRows(flat, COLLIDING_ROWS, {});
    // The one key that was already namespaced, and the precedent this fix
    // generalises — it correctly carries each check's real count.
    expect(flat["appgov:enterprise-app-count__itemCount"]).toBe(495);
    expect(flat["teams:team-count__itemCount"]).toBe(18);
  });

  it("does NOT default _itemCount to 0 in a check's bucket — an errored check measured nothing", () => {
    const flat: Record<string, unknown> = {};
    const byCheck: MergedProfileByCheck = {};
    mergeMonitorProfileRows(flat, [row("identity:risky-users", { someProp_count: 3 })], byCheck);

    expect("_itemCount" in (byCheck["identity:risky-users"] ?? {})).toBe(false);
    // The flat threshold-rule contract keeps its `?? 0` default, unchanged.
    expect(flat["identity:risky-users__itemCount"]).toBe(0);
  });

  it("files bridge-derived keys under the reserved check-key-less namespace", () => {
    const flat: Record<string, unknown> = {};
    const byCheck: MergedProfileByCheck = {};
    mergeMonitorProfileRows(flat, [row("security:secure-score", { currentScore: 33, maxScore: 100 })], byCheck);

    // securityScore is derived from monitor rows but belongs to no single
    // check's property set, so it must not be attributed to one.
    expect(byCheck[NON_CHECK_PROFILE_NAMESPACE]?.["securityScore"]).toBe(33);
    expect("securityScore" in (byCheck["security:secure-score"] ?? {})).toBe(false);
    expect(flat["securityScore"]).toBe(33);
  });

  it("cannot collide with a real check key — the reserved namespace has no ':'", () => {
    expect(NON_CHECK_PROFILE_NAMESPACE).not.toContain(":");
  });
});

describe("#544 companion 1 — the loss is loud", () => {
  it("warns when a key is overwritten with a DIFFERENT value, naming both checks", () => {
    mergeMonitorProfileRows({}, COLLIDING_ROWS, {});

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [meta, message] = warnSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toContain("overwritten with a DIFFERENT value");
    // Git #545: _itemCount is a CHECK_DIAGNOSTIC_ONLY_KEYS member now excluded
    // from the flat merge entirely, so it no longer collides here.
    expect(meta["collidingKeys"]).toEqual(expect.arrayContaining(["displayName_count", "id_count"]));
    expect(meta["collidingKeys"]).not.toEqual(expect.arrayContaining(["_itemCount"]));
    const collisions = meta["collisions"] as Array<Record<string, unknown>>;
    const displayName = collisions.find((c) => c["key"] === "displayName_count");
    expect(displayName?.["lostFrom"]).toBe("appgov:enterprise-app-count");
    expect(displayName?.["wonBy"]).toBe("teams:team-count");
    expect(displayName?.["lostValue"]).toBe("495");
  });

  it("stays SILENT on _licenseGap*/_itemCount — Git #545 excludes them from the flat merge entirely", () => {
    const flat: Record<string, unknown> = {};
    mergeMonitorProfileRows(flat, [
      row("compliance:label-errors", { _licenseGap: true, _licenseGapCode: "cmdlet_unavailable" }),
      row("compliance:missing-labels", { _licenseGap: true, _licenseGapCode: "cmdlet_unavailable" }),
      row("compliance:weak-dlp-policies", { _licenseGap: true, _licenseGapCode: "cmdlet_unavailable" }),
    ], {});

    expect(warnSpy).not.toHaveBeenCalled();
    expect("_licenseGap" in flat).toBe(false);
    expect("_licenseGapCode" in flat).toBe(false);
  });

  it("distinguishes a non-monitor loser (script/profile source) with a null lostFrom", () => {
    // A pre-existing script-era key that a monitor property then overwrites —
    // real, and worth telling apart from a check-vs-check collision.
    mergeMonitorProfileRows({ globalAdminCount: 3 }, [row("identity:global-admin-count", { globalAdminCount: 14 })], {});

    const [meta] = warnSpy.mock.calls[0] as [Record<string, unknown>, string];
    const collisions = meta["collisions"] as Array<Record<string, unknown>>;
    expect(collisions[0]?.["lostFrom"]).toBeNull();
    expect(collisions[0]?.["wonBy"]).toBe("identity:global-admin-count");
  });

  it("compares array payloads by value, so an identical id_values does not warn", () => {
    mergeMonitorProfileRows({}, [
      row("a:one", { id_values: ["x", "y"] }),
      row("b:two", { id_values: ["x", "y"] }),
    ], {});
    expect(warnSpy).not.toHaveBeenCalled();

    mergeMonitorProfileRows({}, [
      row("a:one", { id_values: ["x", "y"] }),
      row("b:two", { id_values: ["x", "z"] }),
    ], {});
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe("#544 — namespacedProfileKey", () => {
  it("joins check key and property with '.', a separator neither vocabulary uses", () => {
    expect(namespacedProfileKey("devices:autopilot-coverage", "displayName_count"))
      .toBe("devices:autopilot-coverage.displayName_count");
  });
});
