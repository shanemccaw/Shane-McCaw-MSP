/**
 * pillarLicensingAlignment.test.ts — the real Copilot Licensing Alignment
 * Report's pure builder (#292).
 *
 * Same discipline as `pillarSecurityPosture.test.ts`: what this file pins is
 * that a THIN tenant produces a SHORTER report rather than a fabricated one.
 *
 * Three things here are specific to this report and are the reason it exists:
 *   • NO SKU RECOMMENDATION. #451 established the required tier is not derivable
 *     per check; "96 users need E5" is a sentence this platform can never say
 *     truthfully, and it is the single most plausible-sounding thing a licensing
 *     document could say.
 *   • NO PROMOTIONAL FRAMING. This is the one report where a recoverable dollar
 *     figure shares a document with an Upgrade Opportunity category, and joining
 *     them turns an assessment into a pitch.
 *   • NO DEPARTMENT, NO PERSONA. `/subscribedSkus` is a per-SKU capacity
 *     endpoint; nothing joins a licence to an org chart, and the platform holds
 *     no persona data at all — `copilotReadinessReport.ts`'s own precedent.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LICENSING_BREAKDOWN_GAP,
  buildLicensingAlignmentReport,
  buildVerdict,
  __testables,
  type LicensingAlignmentBlock,
  type WireLicensingAlignmentPayload,
} from "./pillarLicensingAlignment.ts";
import { UPGRADE_OPPORTUNITY_HEADING } from "./liveReportBlocks.ts";
import { COPILOT_GATE_TARGET, PILLAR_KEYS } from "./journeyTokens.ts";
import {
  FIXTURE_LEAKS,
  REAL_LICENSING_STATS,
  pillar,
  stat,
  view,
  withPillar,
} from "./liveReportFixtures.ts";

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

function build(
  v = view(),
  narrative: WireLicensingAlignmentPayload | null = null,
  settled = true,
) {
  return buildLicensingAlignmentReport({
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

function rowsOf(blocks: readonly LicensingAlignmentBlock[]): { label: string; value: string }[] {
  return blocks.flatMap((b) =>
    b.kind === "keyValues" ? b.rows.map((r) => ({ label: r.label, value: r.value })) : [],
  );
}

function detailsOf(blocks: readonly LicensingAlignmentBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === "unavailable" ? [b.detail] : []));
}

function namedChecks(blocks: readonly LicensingAlignmentBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === "unavailable" ? b.checks.map((c) => c.checkKey) : []));
}

const REAL_TENANT = () =>
  withPillar(view(), "licensing", {
    score: 57,
    headline: "1,308 paid seats are provisioned but assigned to nobody",
    stats: REAL_LICENSING_STATS,
    findings: [
      { severity: "warning", checkKey: "cost:license-count-by-sku", title: "1,308 paid seats are provisioned but assigned to nobody" },
      { severity: "warning", checkKey: "licensing:inactive-user-licenses", title: "25 licences remain assigned to inactive users" },
    ],
  });

/* ------------------------------------------------------------------ *
 * Structure
 * ------------------------------------------------------------------ */

describe("the approved structure", () => {
  it("renders the design's surviving sections in order", () => {
    assert.deepEqual(
      build().sections.map((s) => s.heading),
      [
        "Licensing Posture Summary",
        "Cost Waste Summary",
        "Eligibility & Coverage Gaps",
        "Copilot Readiness Impact",
      ],
    );
  });

  it("carries no Seat Drift Analysis section — every row of it is department-level", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    assert.ok(!/seat drift/i.test(serialised));
    // The gap declaration is allowed to say the platform HAS no role template
    // and offers no seat-drift analysis; nothing else may assert one.
    const withoutGap = serialised.replace(JSON.stringify(LICENSING_BREAKDOWN_GAP).slice(1, -1), "");
    for (const claim of ["role template", "role pattern", "legacy group", "group-based licensing"]) {
      assert.ok(!new RegExp(claim, "i").test(withoutGap), `leaked the unbacked claim "${claim}"`);
    }
  });

  it("carries no Self-Resolution Actions section — remediation is the guide's job", () => {
    assert.ok(!/self-resolution/i.test(build(REAL_TENANT()).sections.map((s) => s.heading).join(" ")));
  });

  it("names nothing from the design's worked example", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    for (const leak of FIXTURE_LEAKS) {
      assert.ok(!serialised.includes(leak), `leaked the design fixture's "${leak}"`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The two rules this report exists to hold
 * ------------------------------------------------------------------ */

describe("no SKU is ever recommended (#451)", () => {
  it("names no tier anywhere in the rendered report", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    for (const sku of ["E5", "E3", "Business Premium", "Entra ID P1", "Entra ID P2", "uplift"]) {
      assert.ok(!serialised.includes(sku), `recommended or named the SKU "${sku}"`);
    }
  });

  it("declares that it cannot work backwards from a user count to a SKU", () => {
    assert.ok(
      /cannot work backwards from a user count to a SKU/i.test(LICENSING_BREAKDOWN_GAP),
      "must state the #451 finding as copy, not merely obey it",
    );
  });

  it("declares the department and persona gaps for EVERY tenant, rich or empty", () => {
    for (const v of [view(), REAL_TENANT()]) {
      const details = detailsOf(sectionNamed(build(v), "Licensing Posture Summary").blocks);
      assert.ok(details.includes(LICENSING_BREAKDOWN_GAP), "the gap must not vary by tenant");
    }
  });

  it("names no department, persona or job title", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    for (const term of ["persona", "Persona", "job title", "department pattern"]) {
      // The gap declaration is allowed to say it holds NO persona data; nothing
      // else may mention one.
      const withoutGap = serialised.replace(JSON.stringify(LICENSING_BREAKDOWN_GAP).slice(1, -1), "");
      assert.ok(!withoutGap.includes(term), `named "${term}" outside the gap declaration`);
    }
  });

  it("is a quiet note, not a finding — it names no check key and no number", () => {
    const blocks = sectionNamed(build(REAL_TENANT()), "Licensing Posture Summary").blocks;
    const gap = blocks.find((b) => b.kind === "unavailable" && b.detail === LICENSING_BREAKDOWN_GAP);
    assert.ok(gap, "must be an unavailable block");
    assert.equal(gap.kind === "unavailable" && gap.checks.length, 0, "and must name no check");
    assert.ok(!/\d/.test(LICENSING_BREAKDOWN_GAP), "a gap with no producer cannot carry a number");
  });
});

describe("no promotional framing anywhere (#451)", () => {
  it("never proposes a use for the recoverable spend", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    for (const pitch of ["funds", "pays for", "offsets", "two thirds", "net year", "payback", "ROI", "saving"]) {
      assert.ok(!new RegExp(pitch, "i").test(serialised), `leaked the promotional framing "${pitch}"`);
    }
  });

  it("puts the cost figure and the upgrade category in separate sections", () => {
    const GATED = withPillar(REAL_TENANT(), "licensing", {
      score: 57,
      stats: [
        ...REAL_LICENSING_STATS.filter((s) => s.id !== "licensing.inactive"),
        stat({ id: "licensing.inactive", value: null, unavailableReason: "license_gap", checkKey: "licensing:inactive-user-licenses" }),
      ],
    });
    const headings = build(GATED).sections.map((s) => s.heading);
    const cost = headings.indexOf("Cost Waste Summary");
    const upgrade = headings.indexOf(UPGRADE_OPPORTUNITY_HEADING);
    assert.ok(cost >= 0 && upgrade >= 0);
    assert.ok(upgrade > cost + 1, "a recoverable figure adjacent to an upgrade tier reads as a funding proposal");
  });

  it("carries no price and no CTA on any disclosure", () => {
    const GATED = withPillar(view(), "licensing", {
      score: 57,
      stats: [stat({ id: "licensing.inactive", value: null, unavailableReason: "license_gap", checkKey: "licensing:inactive-user-licenses" })],
    });
    const items = sectionNamed(build(GATED), UPGRADE_OPPORTUNITY_HEADING).blocks.flatMap((b) =>
      b.kind === "upgradeOpportunity" ? b.items : [],
    );
    assert.deepEqual(items.map((i) => i.checkKey), ["licensing:inactive-user-licenses"]);
    for (const item of items) {
      assert.ok(!/\$|per month|per seat|contact|talk to|book a/i.test(item.disclosure), item.disclosure);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The real figures
 * ------------------------------------------------------------------ */

describe("the four real licensing stats", () => {
  it("puts the seat figures in the Summary and the money in its own section", () => {
    const report = build(REAL_TENANT());
    assert.deepEqual(
      rowsOf(sectionNamed(report, "Licensing Posture Summary").blocks).map((r) => r.label),
      ["Paid seats provisioned", "Paid seats unassigned", "Licences on inactive users"],
    );
    assert.deepEqual(
      rowsOf(sectionNamed(report, "Cost Waste Summary").blocks).map((r) => r.label),
      ["Recoverable licence spend"],
    );
  });

  it("never states the same figure under two headings", () => {
    const all = [...__testables.SUMMARY_PICKS, ...__testables.COST_PICKS].map((p) => p.statId);
    assert.equal(new Set(all).size, all.length);
  });

  it("formats the currency figure in whole dollars a year, without re-dividing it", () => {
    // `war-room-pillar-stats.ts` sends dollars, NOT cents — `centsToDollars` has
    // already run. A second division here would render $184 for $18,400.
    const [row] = rowsOf(sectionNamed(build(REAL_TENANT()), "Cost Waste Summary").blocks);
    assert.equal(row.value, "$18,400 a year in paid, unassigned seats");
  });

  it("keeps 'paid' in every seat caption — #333's guard against free-SKU capacity", () => {
    for (const pick of [...__testables.SUMMARY_PICKS, ...__testables.COST_PICKS]) {
      if (pick.statId === "licensing.inactive") continue;
      assert.ok(/paid/i.test(`${pick.label} ${pick.caption}`), `${pick.statId} dropped "paid" from its caption`);
    }
  });

  it("says an unpriced estate is unpriced, not waste-free", () => {
    const v = withPillar(view(), "licensing", {
      score: 57,
      stats: [stat({ id: "licensing.annualWaste", unit: "currency", value: null, unavailableReason: "no_sku_prices", checkKey: "cost:license-count-by-sku" })],
    });
    const blocks = sectionNamed(build(v), "Cost Waste Summary").blocks;
    assert.equal(rowsOf(blocks).length, 0, "no stat, no row — never a $0");
    assert.ok(namedChecks(blocks).includes("cost:license-count-by-sku"));
    assert.ok(
      detailsOf(blocks).some((d) => /could not be priced, not that there is none/.test(d)),
      "an unpriced estate must not read as one with no waste",
    );
  });

  it("never reaches the reader when the failure is OUR wiring (#441)", () => {
    const v = withPillar(view(), "licensing", {
      score: 57,
      stats: [stat({ id: "licensing.inactive", value: null, unavailableReason: "unknown_metric_key", checkKey: "licensing:inactive-user-licenses" })],
    });
    assert.ok(!JSON.stringify(build(v)).includes("licensing:inactive-user-licenses"));
  });
});

/* ------------------------------------------------------------------ *
 * Findings
 * ------------------------------------------------------------------ */

describe("findings", () => {
  it("renders the licensing pillar's real findings under Eligibility & Coverage Gaps", () => {
    const rows = sectionNamed(build(REAL_TENANT()), "Eligibility & Coverage Gaps").blocks.flatMap((b) =>
      b.kind === "findings" ? b.rows : [],
    );
    assert.deepEqual(rows.map((r) => r.lead), [
      "1,308 paid seats are provisioned but assigned to nobody",
      "25 licences remain assigned to inactive users",
    ]);
    assert.deepEqual(rows.map((r) => r.severity), ["attention", "attention"]);
  });

  it("tells 'evaluated clean' apart from 'never evaluated' (#399)", () => {
    const clean = sectionNamed(
      build(withPillar(view(), "licensing", { score: 88 })),
      "Eligibility & Coverage Gaps",
    ).blocks;
    assert.ok(clean.some((b) => b.kind === "prose" && /is a real result, not an empty section/.test(b.text)));

    const unevaluated = sectionNamed(build(), "Eligibility & Coverage Gaps").blocks;
    assert.ok(detailsOf(unevaluated).some((d) => /can be reported either way/.test(d)));
  });
});

/* ------------------------------------------------------------------ *
 * The never-fabricate guarantee on a thin tenant
 * ------------------------------------------------------------------ */

describe("never fabricate: an empty tenant produces a shorter report, not an invented one", () => {
  it("renders no keyValues row anywhere when no stat and no score is real", () => {
    for (const section of build(view({ readinessScore: null })).sections) {
      assert.equal(rowsOf(section.blocks).length, 0, `${section.heading} invented a row`);
    }
  });

  it("asserts no verdict for a pillar nothing scored", () => {
    const verdict = buildVerdict(undefined);
    assert.equal(verdict.headline, "No licensing score yet");
    assert.ok(!/\d/.test(verdict.headline));
  });

  it("leads with the pillar's own real finding, never with a dollar figure and a pitch", () => {
    const licensing = REAL_TENANT().pillars.find((p) => p.key === "licensing");
    const verdict = buildVerdict(licensing);
    assert.equal(verdict.eyebrow, "Worst finding");
    assert.equal(verdict.headline, "1,308 paid seats are provisioned but assigned to nobody");
    assert.ok(!/funds|uplift|two thirds/i.test(JSON.stringify(verdict)));
  });

  it("falls back to the score, never to an invented finding, for a clean pillar", () => {
    assert.equal(buildVerdict(pillar("licensing", { score: 88 })).headline, "Licensing scores 88 of 100");
  });

  it("omits the closing score sentence entirely when there is no score", () => {
    assert.equal(build().closing.length, 1);
    assert.equal(build(REAL_TENANT()).closing.length, 2);
  });

  it("ranks this pillar against no other — the design calls it 'the strongest pillar'", () => {
    assert.ok(!/strongest|weakest|lowest reading/i.test(JSON.stringify(build(REAL_TENANT()))));
  });

  it("shows the Gate row only when the platform actually has a readiness score", () => {
    assert.equal(rowsOf(sectionNamed(build(view({ readinessScore: null })), "Copilot Readiness Impact").blocks).length, 0);
    const [row] = rowsOf(sectionNamed(build(REAL_TENANT()), "Copilot Readiness Impact").blocks);
    assert.equal(row.value, `41 against a Gate of ${COPILOT_GATE_TARGET} — ${COPILOT_GATE_TARGET - 41} points short`);
  });

  it("claims nothing about a prose section that is still in flight", () => {
    const report = build(REAL_TENANT(), null, false);
    for (const heading of ["Licensing Posture Summary", "Cost Waste Summary", "Copilot Readiness Impact"]) {
      const blocks = sectionNamed(report, heading).blocks;
      assert.equal(blocks.filter((b) => b.kind === "narrative").length, 0);
      assert.ok(
        !detailsOf(blocks).some((d) => /not available|could not be written|came back empty/i.test(d)),
        `${heading} passed judgement on prose that had not resolved`,
      );
    }
    assert.ok(rowsOf(sectionNamed(report, "Cost Waste Summary").blocks).length > 0);
  });

  it("says which kind of nothing a resolved-but-empty prose section is", () => {
    const report = build(REAL_TENANT(), {
      sections: [{ key: "cost", heading: "Cost Waste Summary", html: null, omittedReason: "empty_response", factCount: 0 }],
    });
    assert.ok(
      detailsOf(sectionNamed(report, "Cost Waste Summary").blocks).some((d) =>
        /came back empty and has been left out/.test(d),
      ),
    );
  });
});

/* ------------------------------------------------------------------ *
 * The picks are a contract with war-room-pillar-stats.ts
 * ------------------------------------------------------------------ */

describe("every pick names a real stat id on a real pillar", () => {
  it("uses stat ids in the `<pillar>.<name>` shape the payload actually emits", () => {
    for (const pick of [...__testables.SUMMARY_PICKS, ...__testables.COST_PICKS]) {
      assert.match(pick.statId, /^[a-z]+\.[a-zA-Z]+$/, `${pick.statId} is not a stat id`);
      assert.ok(pick.statId.startsWith(`${pick.pillar}.`));
      assert.ok((PILLAR_KEYS as readonly string[]).includes(pick.pillar));
    }
  });

  it("picks only from the licensing card — this is that pillar's own report", () => {
    for (const pick of [...__testables.SUMMARY_PICKS, ...__testables.COST_PICKS]) {
      assert.equal(pick.pillar, "licensing");
    }
  });

  it("picks all four of the card's real stats, none twice", () => {
    const ids = [...__testables.SUMMARY_PICKS, ...__testables.COST_PICKS].map((p) => p.statId);
    assert.equal(new Set(ids).size, 4);
  });
});
