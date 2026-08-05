/**
 * copilotReadinessReport.test.ts — the real Copilot Readiness report's pure
 * builder (#409).
 *
 * The tests that matter here are the honesty ones. Anyone can assert that a
 * populated tenant produces a populated report; what this file exists to pin is
 * that a THIN tenant produces a SHORTER report rather than a fabricated one —
 * no invented numbers, no zeroes standing in for absent data, no template prose
 * filling an empty section, and the difference between "the check never ran"
 * and "it ran and found nothing" surviving all the way to the page.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  blastRadiusRows,
  buildCopilotReadinessReport,
  buildProvenance,
  buildRadarNote,
  formatStat,
  isRealStat,
  isWiringFault,
  narrativeUnavailableDetail,
  unavailableReasonText,
  __testables,
  type ReadinessBlock,
  type WireNarrativePayload,
} from "./copilotReadinessReport.ts";
import { COPILOT_GATE_TARGET, PILLARS, PILLAR_KEYS, type PillarKey } from "./journeyTokens.ts";
import type { JourneyPillarView, JourneyView, WirePillarStat } from "./journeyModel.ts";

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

function stat(overrides: Partial<WirePillarStat> & { id: string }): WirePillarStat {
  return {
    label: "things",
    unit: "count",
    value: null,
    checkKey: `check:${overrides.id}`,
    ...overrides,
  };
}

function pillar(key: PillarKey, overrides: Partial<JourneyPillarView> = {}): JourneyPillarView {
  return {
    key,
    label: PILLARS[key].label,
    primary: PILLARS[key].primary,
    accent: PILLARS[key].accent,
    score: null,
    headline: null,
    chips: [],
    stats: [],
    satelliteFinding: null,
    trend: null,
    criticalCount: 0,
    warningCount: 0,
    ...overrides,
  };
}

function view(overrides: Partial<JourneyView> = {}): JourneyView {
  return {
    tenant: { name: "Contoso", seatCount: null, scannedOn: "5 August 2026" },
    readinessScore: 41,
    remediatedScore: null,
    pillars: PILLAR_KEYS.map((k) => pillar(k)),
    generation: { ready: 0, total: 0, allReady: false, documents: [] },
    isPreview: false,
    ...overrides,
  };
}

function build(v: JourneyView, narrative: WireNarrativePayload | null = null, settled = true) {
  return buildCopilotReadinessReport({
    view: v,
    narrative,
    narrativeSettled: settled,
    scannedCheckCount: 29,
  });
}

function sectionNamed(report: ReturnType<typeof build>, heading: string) {
  const found = report.sections.find((s) => s.heading === heading);
  assert.ok(found, `expected a section headed "${heading}"`);
  return found;
}

function blockKinds(blocks: readonly ReadinessBlock[]): string[] {
  return blocks.map((b) => b.kind);
}

/* ------------------------------------------------------------------ *
 * Structure — the two changes Shane approved
 * ------------------------------------------------------------------ */

describe("the approved structure", () => {
  it("renders the design's sections in order, without Copilot Drift & Violations", () => {
    const report = build(view());
    assert.deepEqual(
      report.sections.map((s) => s.heading),
      [
        "Copilot Readiness Summary",
        "Copilot Safety & Exposure",
        "Workflow Enablement & Value",
        "Technical Prerequisites & Platform Alignment",
        "Gate Blockers & Remediation Path",
      ],
    );
  });

  it("never emits a drift section, whatever the tenant carries", () => {
    const rich = view({
      pillars: PILLAR_KEYS.map((k) =>
        pillar(k, { score: 40, stats: [stat({ id: `${k}.anything`, value: 7 })] }),
      ),
    });
    const headings = build(rich).sections.map((s) => s.heading).join(" ");
    assert.ok(!/drift/i.test(headings));
  });

  it("carries no Personas row in the readiness summary", () => {
    const withExposure = view({
      pillars: PILLAR_KEYS.map((k) =>
        k === "security"
          ? pillar(k, { score: 30, stats: [stat({ id: "security.blastRadius", value: 212 })] })
          : pillar(k),
      ),
    });
    const summary = sectionNamed(build(withExposure), "Copilot Readiness Summary");
    const labels = summary.blocks.flatMap((b) => (b.kind === "keyValues" ? b.rows.map((r) => r.label) : []));
    assert.ok(labels.length > 0, "expected at least one real row");
    assert.ok(!labels.some((l) => /persona/i.test(l)));
  });
});

/* ------------------------------------------------------------------ *
 * NEVER FABRICATE — the point of the whole file
 * ------------------------------------------------------------------ */

describe("never fabricate: a stat with no value never becomes a number", () => {
  it("omits the row entirely rather than rendering a zero", () => {
    const v = view({
      pillars: PILLAR_KEYS.map((k) =>
        k === "security"
          ? pillar(k, {
              score: 30,
              stats: [stat({ id: "security.blastRadius", value: null, unavailableReason: "no_data" })],
            })
          : pillar(k),
      ),
    });
    const summary = sectionNamed(build(v), "Copilot Readiness Summary");
    const rows = summary.blocks.flatMap((b) => (b.kind === "keyValues" ? b.rows : []));
    assert.equal(rows.length, 0, "an unavailable stat must not produce a row");
    // ...and it is named as missing rather than silently dropped.
    const unavailable = summary.blocks.filter((b) => b.kind === "unavailable");
    assert.equal(unavailable.length, 1);
    assert.deepEqual(
      unavailable[0].kind === "unavailable" ? unavailable[0].checks.map((c) => c.checkKey) : [],
      ["check:security.blastRadius"],
    );
  });

  it("keeps a REAL zero, which is a real answer", () => {
    const v = view({
      pillars: PILLAR_KEYS.map((k) =>
        k === "security" ? pillar(k, { score: 90, stats: [stat({ id: "security.blastRadius", value: 0 })] }) : pillar(k),
      ),
    });
    const summary = sectionNamed(build(v), "Copilot Readiness Summary");
    const rows = summary.blocks.flatMap((b) => (b.kind === "keyValues" ? b.rows : []));
    assert.equal(rows.length, 1);
    assert.match(rows[0].value, /^0 /);
  });

  it("distinguishes which kind of nothing an absent check is", () => {
    assert.match(unavailableReasonText("not_in_scan_package"), /not included in the scan package/);
    assert.match(unavailableReasonText("no_data"), /reported no value/);
    assert.notEqual(unavailableReasonText("not_in_scan_package"), unavailableReasonText("no_data"));
    assert.match(unavailableReasonText("license_gap"), /licence tier/);
  });

  it("never fills the Conditional Access gap from a near-miss metric", () => {
    const prereq = sectionNamed(build(view()), "Technical Prerequisites & Platform Alignment");
    const rows = prereq.blocks.flatMap((b) => (b.kind === "keyValues" ? b.rows : []));
    assert.ok(!rows.some((r) => /conditional access/i.test(r.label)));
  });

  it("keeps the Conditional Access gap on the record in code but off the customer's page", () => {
    // It used to be listed to the reader as `identity:ca-policy-count — not
    // wired to a check in the catalogue`. That is wrong twice over: the check IS
    // real (sort_order 2 in core:security-baseline), and what is missing is a
    // registry metric to consume it — our wiring, not a gap in their scan (#441).
    assert.ok(
      __testables.UNPRODUCIBLE_PREREQUISITES.some((c) => c.checkKey === "identity:ca-policy-count"),
      "the decision must stay recorded in code",
    );
    const prereq = sectionNamed(build(view()), "Technical Prerequisites & Platform Alignment");
    const shown = prereq.blocks.flatMap((b) => (b.kind === "unavailable" ? b.checks : []));
    assert.ok(!shown.some((c) => c.checkKey === "identity:ca-policy-count"));
  });
});

/* ------------------------------------------------------------------ *
 * #441 — our wiring bugs are not findings about the customer's tenant
 * ------------------------------------------------------------------ */

describe("#441 — a broken registry reference never reaches the reader as their gap", () => {
  it("classifies only OUR faults as wiring faults", () => {
    for (const reason of ["unknown_check_key", "unknown_metric_key", "resolver_error"]) {
      assert.equal(isWiringFault(reason), true, reason);
    }
    // Everything else is a real statement about this tenant's scan and stays.
    for (const reason of [
      "no_data",
      "not_in_scan_package",
      "license_gap",
      "no_seat_data",
      "no_sku_prices",
      "not_collected",
      "no_evaluable_rules",
      undefined,
    ]) {
      assert.equal(isWiringFault(reason), false, String(reason));
    }
  });

  it("drops a wiring-fault stat from the blast-radius block but keeps a real coverage gap", () => {
    const v = view({
      pillars: PILLAR_KEYS.map((k) =>
        k === "security"
          ? pillar(k, {
              stats: [
                stat({
                  id: "security.blastRadius",
                  checkKey: "copilot:overshare-exposure",
                  unavailableReason: "unknown_check_key",
                }),
              ],
            })
          : k === "governance"
            ? pillar(k, {
                stats: [
                  stat({
                    id: "governance.sites",
                    checkKey: "compliance:sharepoint-sites",
                    unavailableReason: "not_in_scan_package",
                  }),
                ],
              })
            : pillar(k),
      ),
    });
    const { missing } = blastRadiusRows(v.pillars);
    assert.deepEqual(missing, [
      { checkKey: "compliance:sharepoint-sites", reason: "not_in_scan_package" },
    ]);
  });

  it("no pick anywhere is grounded in the phantom `usage:` domain", () => {
    // The four `usage:*` keys #441 found printed to a customer were reached
    // through these stat ids. None may come back without a real producer.
    const banned = new Set([
      "adoption.teamsActive",
      "adoption.sharePointActive",
      "adoption.oneDriveActive",
      "adoption.emailActive",
    ]);
    for (const pick of [...__testables.WORKLOAD_PICKS, ...__testables.PREREQUISITE_PICKS]) {
      assert.ok(!banned.has(pick.statId), `pick ${pick.statId} has no real producer`);
    }
  });

  it("filters the narrative route's own missingChecks the same way", () => {
    const narrative: WireNarrativePayload = {
      sections: [
        {
          key: "enablement",
          heading: "Workflow Enablement & Value",
          html: null,
          omittedReason: "no_real_data",
          factCount: 0,
          missingChecks: [
            { checkKey: "usage:teams-activity", reason: "unknown_check_key" },
            { checkKey: "licensing:inactive-user-licenses", reason: "not_in_scan_package" },
          ],
        },
      ],
    };
    const report = buildCopilotReadinessReport({
      view: view(),
      narrative,
      narrativeSettled: true,
      scannedCheckCount: 7,
    });
    const shown = sectionNamed(report, "Workflow Enablement & Value").blocks.flatMap((b) =>
      b.kind === "unavailable" ? b.checks : [],
    );
    assert.ok(!shown.some((c) => c.checkKey.startsWith("usage:")));
    assert.ok(shown.some((c) => c.checkKey === "licensing:inactive-user-licenses"));
  });

  it("says `not_collected` in plain words rather than falling through to the raw reason", () => {
    assert.match(unavailableReasonText("not_collected"), /not collected by any check/);
    assert.ok(!/not_collected/.test(unavailableReasonText("not_collected")));
  });
});

describe("never fabricate: an empty tenant produces a shorter report, not an invented one", () => {
  const empty = view({ readinessScore: null });

  it("asserts no verdict when nothing scored the Copilot pillar", () => {
    const report = build(empty);
    assert.equal(report.verdict.headline, "No readiness score yet");
    assert.ok(!/not flight-ready|cleared/i.test(report.verdict.headline));
    assert.match(report.verdict.sub, new RegExp(String(COPILOT_GATE_TARGET)));
  });

  it("drops the closing score paragraph rather than writing one with a blank in it", () => {
    assert.equal(build(empty).closing.length, 1);
    assert.equal(build(view()).closing.length, 2);
  });

  it("renders no keyValues block at all where no stat is real", () => {
    const report = build(empty);
    for (const section of report.sections) {
      assert.ok(!blockKinds(section.blocks).includes("keyValues"), `${section.heading} should carry no table`);
    }
  });

  it("describes the radar shape only when at least two pillars were actually scored", () => {
    assert.ok(!/closest to ready/.test(buildRadarNote(empty)));
    const oneScored = view({
      pillars: PILLAR_KEYS.map((k) => (k === "security" ? pillar(k, { score: 30 }) : pillar(k))),
    });
    assert.ok(!/closest to ready/.test(buildRadarNote(oneScored)));

    const twoScored = view({
      pillars: PILLAR_KEYS.map((k) =>
        k === "security" ? pillar(k, { score: 30 }) : k === "licensing" ? pillar(k, { score: 80 }) : pillar(k),
      ),
    });
    const note = buildRadarNote(twoScored);
    assert.match(note, /Licensing is closest to ready at 80/);
    assert.match(note, /Security furthest from it at 30/);
  });

  it("never inherits the design tenant's radar sentence", () => {
    // The fixture note names Licensing and Compliance for Halden Materials.
    const v = view({
      pillars: PILLAR_KEYS.map((k) =>
        k === "adoption" ? pillar(k, { score: 20 }) : k === "health" ? pillar(k, { score: 70 }) : pillar(k),
      ),
    });
    const note = buildRadarNote(v);
    assert.match(note, /Health is closest to ready at 70/);
    assert.match(note, /Adoption furthest from it at 20/);
  });

  it("omits provenance clauses the platform cannot vouch for", () => {
    const full = buildProvenance("5 August 2026", 29);
    assert.match(full, /Read on 5 August 2026/);
    assert.match(full, /29 signal derivation checks/);

    const noDate = buildProvenance(null, 29);
    assert.ok(!/Read on/.test(noDate));
    assert.match(noDate, /29 signal derivation checks/);

    const noChecks = buildProvenance("5 August 2026", 0);
    assert.ok(!/signal derivation checks/.test(noChecks), "a zero check count must not be printed");
    assert.match(noChecks, /No configuration was altered/);
  });
});

describe("never fabricate: a prose section with nothing behind it stays empty", () => {
  const omitted: WireNarrativePayload = {
    sections: [
      { key: "safety", heading: "Copilot Safety & Exposure", html: null, omittedReason: "no_real_data", factCount: 0 },
      {
        key: "enablement",
        heading: "Workflow Enablement & Value",
        html: null,
        omittedReason: "generation_failed",
        factCount: 4,
      },
      {
        key: "blockers",
        heading: "Gate Blockers & Remediation Path",
        html: "<p>Two criticals sit ahead of the rest.</p>",
        omittedReason: null,
        factCount: 9,
      },
    ],
  };

  it("renders an honest unavailable block, never substitute prose", () => {
    const report = build(view(), omitted);
    const safety = sectionNamed(report, "Copilot Safety & Exposure");
    assert.deepEqual(blockKinds(safety.blocks), ["unavailable"]);
    const block = safety.blocks[0];
    assert.ok(block.kind === "unavailable");
    assert.match(block.detail, /nothing real to reason from/);
    assert.match(block.detail, /Nothing has been written in its place/);
  });

  it("says different things for an empty tenant and a failed call", () => {
    const noData = narrativeUnavailableDetail("no_real_data");
    const failed = narrativeUnavailableDetail("generation_failed");
    assert.notEqual(noData, failed);
    // A failure on our side must not read as a finding about their tenant.
    assert.match(failed, /problem on our side, not a finding about your tenant/);
  });

  it("still renders the sections that DID resolve", () => {
    const report = build(view(), omitted);
    const blockers = sectionNamed(report, "Gate Blockers & Remediation Path");
    assert.deepEqual(blockKinds(blockers.blocks), ["narrative"]);
    const block = blockers.blocks[0];
    assert.ok(block.kind === "narrative");
    assert.match(block.html, /Two criticals/);
  });

  it("shows nothing (a pending state) until the fetch settles, never an empty verdict", () => {
    const pending = build(view(), null, false);
    assert.equal(sectionNamed(pending, "Copilot Safety & Exposure").blocks.length, 0);
    const settled = build(view(), null, true);
    assert.deepEqual(blockKinds(sectionNamed(settled, "Copilot Safety & Exposure").blocks), ["unavailable"]);
  });
});

/* ------------------------------------------------------------------ *
 * Real data — the numbers must be the ones on the wire
 * ------------------------------------------------------------------ */

describe("real numbers, rendered as the platform reports them", () => {
  it("reuses the platform's own blast-radius stat rather than recomputing one", () => {
    const v = view({
      pillars: PILLAR_KEYS.map((k) => {
        if (k === "security") {
          return pillar(k, {
            score: 34,
            stats: [stat({ id: "security.blastRadius", value: 214806, checkKey: "copilot:overshare-exposure" })],
          });
        }
        if (k === "governance") {
          return pillar(k, {
            score: 19,
            stats: [
              stat({ id: "governance.overshared", value: 212 }),
              stat({ id: "governance.sites", value: 1847 }),
            ],
          });
        }
        return pillar(k);
      }),
    });
    const { rows, missing } = blastRadiusRows(v.pillars);
    assert.equal(missing.length, 0);
    assert.deepEqual(
      rows.map((r) => r.label),
      ["Copilot blast radius", "Overshared sites", "Sites in scope"],
    );
    assert.match(rows[0].value, /^214,806 /);
    assert.match(rows[1].value, /^212 /);
    assert.match(rows[2].value, /^1,847 /);
  });

  it("formats each unit the way the wire means it", () => {
    assert.equal(formatStat(stat({ id: "a", unit: "count", value: 1234 }) as never), "1,234");
    assert.equal(formatStat(stat({ id: "b", unit: "percent", value: 31 }) as never), "31%");
    // Currency arrives in whole dollars from centsToDollars, not in cents.
    assert.equal(formatStat(stat({ id: "c", unit: "currency", value: 18400 }) as never), "$18,400");
  });

  it("tones a row by its pillar's real severity band, not an invented threshold", () => {
    const v = view({
      pillars: PILLAR_KEYS.map((k) =>
        k === "security"
          ? pillar(k, { score: 90, stats: [stat({ id: "security.blastRadius", value: 5 })] })
          : pillar(k),
      ),
    });
    assert.equal(blastRadiusRows(v.pillars).rows[0].tone, "healthy");

    const bad = view({
      pillars: PILLAR_KEYS.map((k) =>
        k === "security"
          ? pillar(k, { score: 20, stats: [stat({ id: "security.blastRadius", value: 5 })] })
          : pillar(k),
      ),
    });
    assert.equal(blastRadiusRows(bad.pillars).rows[0].tone, "critical");
  });

  it("quotes the real gap to the real Gate, and claims no projection", () => {
    const report = build(view({ readinessScore: 41 }));
    assert.match(report.verdict.headline, /^41 — not flight-ready/);
    assert.match(report.verdict.sub, new RegExp(`gap is ${COPILOT_GATE_TARGET - 41} points`));
    // "After remediation" has no real source on this path and must not appear.
    const everything = JSON.stringify(report);
    assert.ok(!/after remediation/i.test(everything));
    assert.ok(!/projected/i.test(everything));
  });

  it("switches the verdict at the Gate boundary, inclusive", () => {
    assert.match(build(view({ readinessScore: COPILOT_GATE_TARGET })).verdict.headline, /cleared for Copilot/);
    assert.match(build(view({ readinessScore: COPILOT_GATE_TARGET - 1 })).verdict.headline, /not flight-ready/);
  });

  it("recognises a real, finite value and nothing else", () => {
    assert.equal(isRealStat(undefined), false);
    assert.equal(isRealStat(stat({ id: "a", value: null })), false);
    assert.equal(isRealStat(stat({ id: "a", value: Number.NaN })), false);
    assert.equal(isRealStat(stat({ id: "a", value: Number.POSITIVE_INFINITY })), false);
    assert.equal(isRealStat(stat({ id: "a", value: 0 })), true);
  });
});
