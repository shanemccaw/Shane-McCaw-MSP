/**
 * pillar-signals.test.ts — the SIGNALS grid's card logic (Git #4578).
 *
 * The dispatch's load-bearing requirement: an unmeasurable card renders as
 * unmeasurable with its real reason, never as a zero. Those branches are the
 * first thing asserted; the tier and delta rules follow.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), execute: vi.fn() },
  tenantMonitorProfilesTable: {},
}));

import type { CheckObservation } from "./pillar-check-observations.ts";
import {
  buildPillarSignals,
  buildSignalCard,
  resolveSignalValue,
  signalTier,
  type SignalContext,
} from "./pillar-signals.ts";
import { PILLAR_SIGNAL_SPECS, type PillarSignalSpec, type SignalValueSpec } from "./pillar-signal-specs.ts";

const obs = (over: Partial<CheckObservation> & { checkKey: string }): CheckObservation => ({
  status: "ok",
  props: {},
  collectedAt: "2026-09-18T07:40:43.166Z",
  licenseFeature: null,
  serviceName: null,
  severity: null,
  severityLabel: null,
  ...over,
});

function ctx(over: Omit<Partial<SignalContext>, "recent"> & { recent?: CheckObservation[][] } = {}): SignalContext {
  const recent = new Map<string, readonly CheckObservation[]>();
  for (const list of over.recent ?? []) recent.set(list[0]!.checkKey, list);
  return {
    recent,
    checksWithRules: over.checksWithRules ?? new Set(),
    inactiveCheckKeys: over.inactiveCheckKeys ?? new Set(),
    scannedCheckKeys: over.scannedCheckKeys ?? null,
    seats: over.seats ?? null,
  };
}

const countSpec = (checkKey: string, field: string, extra: Partial<PillarSignalSpec> = {}): PillarSignalSpec => ({
  checkKey,
  icon: "users",
  label: "A card",
  span: 4,
  value: { format: "count", field },
  ...extra,
});

describe("an unmeasurable card is unmeasurable with its real reason — never a zero", () => {
  it("licence gap: no value, the tenant's own licence feature, tier na", () => {
    const spec = countSpec("identity:mfa-registration", "mfaRegistrationGapCount");
    const card = buildSignalCard(
      spec,
      ctx({ recent: [[obs({ checkKey: spec.checkKey, status: "license_gap", licenseFeature: "Microsoft Entra ID P1", props: { _licenseGap: true } })]] }),
    );
    expect(card).toMatchObject({ tier: "na", value: null, text: null, delta: null, unavailableReason: "license_gap", licenseFeature: "Microsoft Entra ID P1" });
  });

  it("service not configured: names the Microsoft service, no value", () => {
    const spec = countSpec("devices:enrollment-status", "enrolledDeviceCount");
    const card = buildSignalCard(
      spec,
      ctx({ recent: [[obs({ checkKey: spec.checkKey, status: "service_not_configured", serviceName: "Microsoft Intune" })]] }),
    );
    expect(card).toMatchObject({ tier: "na", value: null, unavailableReason: "service_not_configured", serviceName: "Microsoft Intune" });
  });

  it("errored check: check_error, no value", () => {
    const spec = countSpec("a:b", "n");
    const card = buildSignalCard(spec, ctx({ recent: [[obs({ checkKey: "a:b", status: "error" })]] }));
    expect(card).toMatchObject({ tier: "na", value: null, unavailableReason: "check_error" });
  });

  it("never run vs inactive in the catalog vs not in the scan package are three distinct reasons", () => {
    const spec = countSpec("sharepoint:anonymous-links", "anonymousSharingLinkCount");
    expect(buildSignalCard(spec, ctx()).unavailableReason).toBe("never_run");
    expect(buildSignalCard(spec, ctx({ inactiveCheckKeys: new Set([spec.checkKey]) })).unavailableReason).toBe("inactive_in_catalog");
    expect(buildSignalCard(spec, ctx({ scannedCheckKeys: new Set(["some:other"]) })).unavailableReason).toBe("not_in_scan_package");
    for (const c of [ctx(), ctx({ inactiveCheckKeys: new Set([spec.checkKey]) })]) {
      expect(buildSignalCard(spec, c)).toMatchObject({ value: null, text: null, tier: "na" });
    }
  });

  it("a measured row missing the named field is unmeasurable, not zero", () => {
    const spec = countSpec("a:b", "missingField");
    const card = buildSignalCard(spec, ctx({ recent: [[obs({ checkKey: "a:b", props: { other: 3 } })]] }));
    expect(card).toMatchObject({ tier: "na", value: null, unavailableReason: "no_data" });
  });

  it("a string in a numeric field is reported as non_numeric_value, not coerced", () => {
    const spec: PillarSignalSpec = { ...countSpec("sharepoint:storage-utilization", "pct"), value: { format: "percent", field: "pct" } };
    const card = buildSignalCard(spec, ctx({ recent: [[obs({ checkKey: spec.checkKey, props: { pct: "mccawsoft2.sharepoint.com" } })]] }));
    expect(card).toMatchObject({ tier: "na", value: null, unavailableReason: "non_numeric_value" });
  });

  it("Security Defaults / a skipped gate are named, not shrugged as no_data", () => {
    const spec = countSpec("identity:ca-mfa-coverage", "caMfaEnforcedPolicyCount");
    expect(
      buildSignalCard(spec, ctx({ recent: [[obs({ checkKey: spec.checkKey, props: { _gateSkipped: true, securityDefaultsEnabled: true } })]] })).unavailableReason,
    ).toBe("security_defaults_active");
    expect(
      buildSignalCard(spec, ctx({ recent: [[obs({ checkKey: spec.checkKey, props: { _gateSkipped: true } })]] })).unavailableReason,
    ).toBe("gate_skipped");
  });

  it("a check with no single figure says so rather than showing a guess", () => {
    const spec: PillarSignalSpec = { ...countSpec("copilot:usage-activity", "x"), value: { format: "none" } };
    const card = buildSignalCard(spec, ctx({ recent: [[obs({ checkKey: spec.checkKey })]] }));
    expect(card).toMatchObject({ tier: "na", value: null, text: null, unavailableReason: "no_scalar_defined" });
  });

  it("a REAL zero stays 0 — the check ran and found none", () => {
    const spec = countSpec("teams:ownerless-teams", "ownerlessTeamCount");
    const card = buildSignalCard(
      spec,
      ctx({ checksWithRules: new Set([spec.checkKey]), recent: [[obs({ checkKey: spec.checkKey, props: { ownerlessTeamCount: 0 } })]] }),
    );
    expect(card).toMatchObject({ value: 0, tier: "good", format: "count" });
    expect(card.unavailableReason).toBeUndefined();
  });
});

describe("signalTier", () => {
  const ok = (severity: string | null) => obs({ checkKey: "a:b", severity });
  it("non-measured is na", () => {
    expect(signalTier(undefined, true)).toBe("na");
    expect(signalTier(obs({ checkKey: "a:b", status: "license_gap" }), true)).toBe("na");
  });
  it("critical and high are bad; warning, medium, info and low are meh", () => {
    expect(signalTier(ok("critical"), true)).toBe("bad");
    expect(signalTier(ok("high"), true)).toBe("bad");
    for (const s of ["warning", "medium", "info", "low", "some-future-severity"]) expect(signalTier(ok(s), true)).toBe("meh");
  });
  it("nothing fired: good when rules exist to fire, ungraded when the check has none", () => {
    expect(signalTier(ok(null), true)).toBe("good");
    expect(signalTier(ok(null), false)).toBe("ungraded");
  });
  it("treats an observation that predates the severity field as nothing fired", () => {
    const legacy: CheckObservation = { checkKey: "a:b", status: "ok", props: {}, collectedAt: null, licenseFeature: null, serviceName: null };
    expect(signalTier(legacy, true)).toBe("good");
  });
});

describe("value formats", () => {
  it("ratio reads both numbers from the row", () => {
    expect(resolveSignalValue({ format: "ratio", field: "n", denominatorField: "d" }, { n: 18, d: 18 }, null)).toEqual({ value: 18, text: "18 / 18" });
    expect(resolveSignalValue({ format: "ratio", field: "n", denominatorField: "d" }, { n: 18 }, null).value).toBeNull();
  });
  it("flag uses the design's words for each state and refuses a non-boolean", () => {
    const spec = { format: "flag", field: "f", on: "set", off: "not set" } as const;
    expect(resolveSignalValue(spec, { f: true }, null).text).toBe("set");
    expect(resolveSignalValue(spec, { f: false }, null).text).toBe("not set");
    expect(resolveSignalValue(spec, { f: null }, null).text).toBeNull();
    expect(resolveSignalValue(spec, { f: "true" }, null).text).toBeNull();
  });
  it("days reads Microsoft's sentinel as never", () => {
    expect(resolveSignalValue({ format: "days", field: "d" }, { d: 2147483647 }, null).text).toBe("never");
    expect(resolveSignalValue({ format: "days", field: "d" }, { d: 90 }, null)).toEqual({ value: 90, text: "90 days" });
  });
  it("gaps counts the false booleans and refuses when any field is not a boolean", () => {
    const spec: SignalValueSpec = { format: "gaps", fields: ["a", "b", "c"] };
    expect(resolveSignalValue(spec, { a: true, b: false, c: false }, null)).toEqual({ value: 2, text: "2 gaps" });
    expect(resolveSignalValue(spec, { a: true, b: false, c: null }, null).value).toBeNull();
  });
  it("sum refuses a partial sum that would under-report", () => {
    const spec: SignalValueSpec = { format: "sum", fields: ["a", "b"] };
    expect(resolveSignalValue(spec, { a: 1, b: 2 }, null).value).toBe(3);
    expect(resolveSignalValue(spec, { a: 1 }, null).value).toBeNull();
  });
  it("paidSeats uses the priced-SKU seat figures and is unavailable without them", () => {
    expect(resolveSignalValue({ format: "paidSeats", part: "ratio" }, {}, { provisioned: 5, unassigned: 2 })).toEqual({ value: 3, text: "3 / 5" });
    expect(resolveSignalValue({ format: "paidSeats", part: "unassigned" }, {}, { provisioned: 5, unassigned: 2 }).value).toBe(2);
    expect(resolveSignalValue({ format: "paidSeats", part: "ratio" }, {}, null).reason).toBe("no_seat_data");
  });
});

describe("delta, history, sub-caption and rule label", () => {
  const spec = countSpec("governance:ownerless-groups", "ownerlessGroupCount", {
    subDenominator: { field: "_itemCount", template: "of {value} groups scanned" },
  });

  it("delta is now minus the previous stored observation, read with the same field", () => {
    const card = buildSignalCard(
      spec,
      ctx({
        recent: [[
          obs({ checkKey: spec.checkKey, props: { ownerlessGroupCount: 26, _itemCount: 104 } }),
          obs({ checkKey: spec.checkKey, props: { ownerlessGroupCount: 24, _itemCount: 104 } }),
        ]],
      }),
    );
    expect(card).toMatchObject({ value: 26, delta: 2, history: 2, sub: "of 104 groups scanned" });
  });

  it("delta is 0 when unchanged and null with no usable previous observation", () => {
    const same = buildSignalCard(spec, ctx({ recent: [[obs({ checkKey: spec.checkKey, props: { ownerlessGroupCount: 5 } }), obs({ checkKey: spec.checkKey, props: { ownerlessGroupCount: 5 } })]] }));
    expect(same.delta).toBe(0);
    const single = buildSignalCard(spec, ctx({ recent: [[obs({ checkKey: spec.checkKey, props: { ownerlessGroupCount: 5 } })]] }));
    expect(single).toMatchObject({ delta: null, history: 1 });
    const prevErrored = buildSignalCard(spec, ctx({ recent: [[obs({ checkKey: spec.checkKey, props: { ownerlessGroupCount: 5 } }), obs({ checkKey: spec.checkKey, status: "error" })]] }));
    expect(prevErrored.delta).toBeNull();
  });

  it("caps history at the design's five bars", () => {
    const rows = Array.from({ length: 9 }, () => obs({ checkKey: spec.checkKey, props: { ownerlessGroupCount: 1 } }));
    expect(buildSignalCard(spec, ctx({ recent: [rows] })).history).toBe(5);
  });

  it("drops a denominator caption when the denominator is missing rather than printing 'of — groups'", () => {
    const card = buildSignalCard(spec, ctx({ recent: [[obs({ checkKey: spec.checkKey, props: { ownerlessGroupCount: 26 } })]] }));
    expect(card.sub).toBeUndefined();
  });

  it("carries the real fired-rule label on a non-good tier only", () => {
    const fired = buildSignalCard(
      spec,
      ctx({ checksWithRules: new Set([spec.checkKey]), recent: [[obs({ checkKey: spec.checkKey, severity: "warning", severityLabel: "Groups exist with no owner", props: { ownerlessGroupCount: 26 } })]] }),
    );
    expect(fired).toMatchObject({ tier: "meh", ruleLabel: "Groups exist with no owner" });
    const clean = buildSignalCard(
      spec,
      ctx({ checksWithRules: new Set([spec.checkKey]), recent: [[obs({ checkKey: spec.checkKey, props: { ownerlessGroupCount: 0 } })]] }),
    );
    expect(clean.ruleLabel).toBeUndefined();
  });

  it("explains a real zero CA count under Security Defaults instead of leaving it to read as a gap", () => {
    const ca = countSpec("identity:ca-policy-count", "caPolicyCount");
    const card = buildSignalCard(ca, ctx({ recent: [[obs({ checkKey: ca.checkKey, props: { caPolicyCount: 0, securityDefaultsEnabled: true } })]] }));
    expect(card).toMatchObject({ value: 0, sub: "This tenant uses Security Defaults instead of Conditional Access" });
  });
});

describe("buildPillarSignals", () => {
  it("counts this pillar's catalog checks the grid does not show, and finds the newest observation", () => {
    const groups = [{ title: "G", cards: [countSpec("x:a", "n"), countSpec("x:b", "n")] }];
    const out = buildPillarSignals(
      "governance",
      groups,
      { "x:a": "governance", "x:b": "governance", "x:c": "governance", "x:d": "governance", "y:e": "security" },
      ctx({
        recent: [
          [obs({ checkKey: "x:a", collectedAt: "2026-09-17T00:00:00.000Z", props: { n: 1 } })],
          [obs({ checkKey: "x:b", collectedAt: "2026-09-18T00:00:00.000Z", props: { n: 1 } })],
        ],
      }),
    );
    expect(out).toMatchObject({ cardCount: 2, uncardedCheckCount: 2, latestObservedAt: "2026-09-18T00:00:00.000Z" });
  });

  it("a tenant with nothing observed has no latest observation and every card unmeasured", () => {
    const out = buildPillarSignals("governance", [{ title: "G", cards: [countSpec("x:a", "n")] }], {}, ctx());
    expect(out.latestObservedAt).toBeNull();
    expect(out.groups[0]!.cards[0]).toMatchObject({ tier: "na", value: null, unavailableReason: "never_run" });
  });
});

describe("PILLAR_SIGNAL_SPECS (the design's grid as data)", () => {
  const all = Object.entries(PILLAR_SIGNAL_SPECS).flatMap(([pillar, groups]) =>
    groups.flatMap((g) => g.cards.map((c) => ({ pillar, group: g.title, card: c }))),
  );

  it("carries the design's six pillars and 180 cards over 155 distinct check keys", () => {
    expect(Object.keys(PILLAR_SIGNAL_SPECS).sort()).toEqual(["adoption", "compliance", "governance", "health", "licensing", "security"]);
    expect(all).toHaveLength(180);
    expect(new Set(all.map((a) => a.card.checkKey)).size).toBe(155);
  });

  it("uses the design's group counts for the two pillars the issue quotes", () => {
    expect(PILLAR_SIGNAL_SPECS.governance).toHaveLength(6);
    expect(PILLAR_SIGNAL_SPECS.governance.reduce((n, g) => n + g.cards.length, 0)).toBe(44);
    expect(PILLAR_SIGNAL_SPECS.security).toHaveLength(8);
    expect(PILLAR_SIGNAL_SPECS.security.reduce((n, g) => n + g.cards.length, 0)).toBe(62);
  });

  it("every span fits the design's 12-column grid and no check repeats within one pillar's group", () => {
    for (const { card } of all) {
      expect(card.span).toBeGreaterThanOrEqual(1);
      expect(card.span).toBeLessThanOrEqual(12);
    }
    for (const groups of Object.values(PILLAR_SIGNAL_SPECS)) {
      for (const g of groups) expect(new Set(g.cards.map((c) => c.checkKey)).size).toBe(g.cards.length);
    }
  });

  it("no spec fabricates a value: every card names a real field or an explicit none/paidSeats source", () => {
    for (const { card } of all) {
      const v = card.value;
      if (v.format === "none" || v.format === "paidSeats") continue;
      if (v.format === "sum" || v.format === "gaps") expect(v.fields.length).toBeGreaterThan(0);
      else expect(v.field.length).toBeGreaterThan(0);
    }
  });
});
