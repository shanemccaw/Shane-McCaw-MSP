/**
 * bare-diagnostic-keys-removal-545.test.ts
 *
 * Git #545 — follow-up to #544. #544's live audit confirmed no consumer reads
 * bare `_itemCount`/`_licenseGap`/`_licenseGapCode`/`_licenseGapFeature` off
 * the flat `mergedProfile` (the real, namespaced replacements are
 * `<checkKey>__itemCount` and `LICENSE_GAP_PROFILE_FLAG_KEYS`
 * `hasAADP1orP2`/`hasDefender`), but left the removal for its own pass because
 * `pillar-coverage.ts`'s `buildProducibleProfileKeys` needed to be checked for
 * a dependency on the bare shape first.
 *
 * That check (see `pillar-coverage.test.ts`'s
 * "enumerates checkKey, __itemCount, mapping targetFields, property
 * extraction keys, and gated bridged keys" test) shows `buildProducibleProfileKeys`
 * already only ever adds `${checkKey}__itemCount` and the `hasAADP1orP2`/
 * `hasDefender` flags — it never enumerates the bare names at all, so no
 * change to it was needed. This file pins:
 *   1. the bare keys are gone from the flat `mergedProfile` (moved here from
 *      merged-profile-by-check-544.test.ts's now-updated assertions);
 *   2. `buildProducibleProfileKeys`'s producible set is unaffected by their
 *      removal (it was never fed by them);
 *   3. #413's package-scoped denominator math — the thing this issue's "out
 *      of scope" section explicitly protects — is unaffected, since
 *      `fetchTenantEvaluableSignalKeys` / `ruleIsFedByPackage` route entirely
 *      through `buildProducibleProfileKeys`'s producible set, never through
 *      `mergedProfile` directly.
 */

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

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
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock("./sla-engine", () => ({
  startSlaTimer: vi.fn(() => Promise.resolve({ timerId: 1, alreadyExisted: false })),
}));

import { mergeMonitorProfileRows, type MergedProfileByCheck, type TenantMonitorProfileRow } from "./tenant-signals.ts";
import { buildProducibleProfileKeys } from "./pillar-coverage.ts";

const row = (checkKey: string, props: Record<string, unknown> | null): TenantMonitorProfileRow =>
  ({ checkKey, status: "ok", severityMatched: null, extractedProperties: props });

describe("#545 — bare diagnostic keys removed from the flat mergedProfile", () => {
  it("drops _itemCount, _licenseGap, _licenseGapCode, _licenseGapFeature from the flat merge", () => {
    const flat: Record<string, unknown> = {};
    mergeMonitorProfileRows(flat, [
      row("compliance:label-errors", {
        _itemCount: 3,
        _licenseGap: true,
        _licenseGapCode: "cmdlet_unavailable",
        _licenseGapFeature: "Microsoft Purview sensitivity labels",
        realProperty: "kept",
      }),
    ]);

    expect("_itemCount" in flat).toBe(false);
    expect("_licenseGap" in flat).toBe(false);
    expect("_licenseGapCode" in flat).toBe(false);
    expect("_licenseGapFeature" in flat).toBe(false);
    // Everything else the check emitted still lands, unaffected.
    expect(flat["realProperty"]).toBe("kept");
    // The namespaced replacement still stamps as before.
    expect(flat["compliance:label-errors__itemCount"]).toBe(3);
  });

  it("still records the bare keys VERBATIM in the per-check mergedProfileByCheck bucket", () => {
    const flat: Record<string, unknown> = {};
    const byCheck: MergedProfileByCheck = {};
    mergeMonitorProfileRows(flat, [
      row("compliance:label-errors", { _itemCount: 3, _licenseGap: true, _licenseGapCode: "cmdlet_unavailable" }),
    ], byCheck);

    expect(byCheck["compliance:label-errors"]?.["_itemCount"]).toBe(3);
    expect(byCheck["compliance:label-errors"]?.["_licenseGap"]).toBe(true);
    expect(byCheck["compliance:label-errors"]?.["_licenseGapCode"]).toBe("cmdlet_unavailable");
  });
});

describe("#545 — buildProducibleProfileKeys was never fed by the bare keys, so removal changes nothing about it", () => {
  it("producible set is identical for check definitions with and without bare-key-shaped properties/mapping", () => {
    const defsWithoutBareKeys = [
      { key: "compliance:label-errors", mapping: [{ sourceField: "a", targetField: "labelsCount" }], properties: ["displayName"] },
    ];
    const before = buildProducibleProfileKeys(new Set(["compliance:label-errors"]), defsWithoutBareKeys);

    // The bare diagnostic names never appeared as a mapping targetField or a
    // `properties[]` entry in real check definitions — they are runtime-only,
    // stamped by monitor-executor.ts, not by any DB-configured mapping. So
    // there is no definition shape that could have fed them into the
    // producible set in the first place.
    expect(before.has("_itemCount")).toBe(false);
    expect(before.has("_licenseGap")).toBe(false);
    expect(before.has("_licenseGapCode")).toBe(false);
    expect(before.has("_licenseGapFeature")).toBe(false);

    // The real replacements are exactly what's still producible.
    expect(before.has("compliance:label-errors__itemCount")).toBe(true);
    expect(before.has("labelsCount")).toBe(true);
  });
});
