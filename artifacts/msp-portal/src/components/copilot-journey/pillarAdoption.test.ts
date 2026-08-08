/**
 * pillarAdoption.test.ts — the real Copilot Adoption & Usage Report's pure
 * builder.
 *
 * Same discipline as its six siblings: what this file pins is that a THIN
 * tenant produces a SHORTER report rather than a fabricated one.
 *
 * The thing this suite exists for above all else is that this is the report
 * with NO MEASURED FIGURES. `WAR_ROOM_PILLAR_STAT_SPECS.adoption` is an empty
 * array by decision, so the temptation is not a single tempting number the way
 * it is elsewhere — it is the entire shape of the document the design drew, in
 * which four of six sections are nothing but figures. Every one of those figures
 * is asserted absent below: usage counts, activation percentages, persona and
 * department names, a direction of travel, and a projected future score.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PERSONA_AND_ENABLEMENT_GAP,
  TREND_DIRECTION_GAP,
  USAGE_FIGURE_GAP,
  buildAdoptionReport,
  buildVerdict,
  __testables,
  type AdoptionBlock,
  type WireAdoptionPayload,
} from "./pillarAdoption.ts";
import { UPGRADE_OPPORTUNITY_HEADING } from "./liveReportBlocks.ts";
import { COPILOT_GATE_TARGET } from "./journeyTokens.ts";
import { FIXTURE_LEAKS, pillar, view, withPillar } from "./liveReportFixtures.ts";

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

function build(v = view(), narrative: WireAdoptionPayload | null = null, settled = true) {
  return buildAdoptionReport({
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

function rowsOf(blocks: readonly AdoptionBlock[]): { label: string; value: string }[] {
  return blocks.flatMap((b) =>
    b.kind === "keyValues" ? b.rows.map((r) => ({ label: r.label, value: r.value })) : [],
  );
}

function detailsOf(blocks: readonly AdoptionBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === "unavailable" ? [b.detail] : []));
}

const SUMMARY = "Adoption Posture Summary";
const ACTIVITY = "Workload Activity & Usage Signals";
const IMPACT = "Copilot Readiness Impact";

/**
 * A real tenant, on the only three real things this report has: a score, a
 * headline and findings. Deliberately NO `stats` — the adoption card genuinely
 * carries none, and a fixture that handed this report one would be testing a
 * payload the wire cannot send.
 */
const REAL_TENANT = () =>
  withPillar(view(), "adoption", {
    score: 46,
    headline: "Viva Engage communities are inactive",
    findings: [
      { severity: "critical", checkKey: "adoption:overall-active-rate", title: "Overall active-user rate is below the configured floor" },
      { severity: "warning", checkKey: "adoption:teams-activity-trend", title: "Teams activity is below the configured floor for this window" },
      { severity: "warning", checkKey: "teams:inactive-teams", title: "Viva Engage communities are inactive" },
    ],
    // Real wire data always keeps these in step with `findings` (#575's
    // `pillarVerdictSeverity`/`isCleanScoredPillar` both read the counts, not
    // the array) — set explicitly here so this fixture cannot silently drift
    // from that invariant the way a bare `withPillar` override otherwise would.
    criticalCount: 1,
    warningCount: 2,
  });

/* ------------------------------------------------------------------ *
 * The defining property: no measured figure exists, and none is invented
 * ------------------------------------------------------------------ */

describe("the report with no stats states no figure of its own", () => {
  it("renders no keyValues row anywhere except the real Gate row", () => {
    const report = build(REAL_TENANT());
    for (const section of report.sections) {
      const rows = rowsOf(section.blocks);
      if (section.heading === IMPACT) {
        assert.deepEqual(rows.map((r) => r.label), ["Copilot Gate"]);
      } else {
        assert.equal(rows.length, 0, `${section.heading} invented a row`);
      }
    }
  });

  it("states no percentage anywhere, for any tenant", () => {
    for (const v of [view(), view({ readinessScore: null }), REAL_TENANT()]) {
      assert.ok(!JSON.stringify(build(v)).includes("%"), "quoted a share of a roster nothing counts");
    }
  });

  it("carries none of the design's usage figures", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    for (const claim of [
      "412",
      "31%",
      "84%",
      "71%",
      "22%",
      "44%",
      "516",
      "638",
      "email-only",
      "shadow collaboration",
      // The design's phrasing, not the word "activation" itself: this report
      // says outright that it states no activation rate, and it has to be
      // allowed to say so.
      "activated for",
    ]) {
      assert.ok(!serialised.includes(claim), `leaked the design's usage claim "${claim}"`);
    }
  });

  it("names nothing from the design's worked example", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    for (const leak of FIXTURE_LEAKS) {
      assert.ok(!serialised.includes(leak), `leaked the design fixture's "${leak}"`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The three declared gaps
 * ------------------------------------------------------------------ */

describe("the three gaps are declared in words, for every tenant", () => {
  it("puts each gap in the section whose subject it is", () => {
    const report = build(REAL_TENANT());
    assert.ok(detailsOf(sectionNamed(report, SUMMARY).blocks).includes(USAGE_FIGURE_GAP));
    assert.ok(detailsOf(sectionNamed(report, ACTIVITY).blocks).includes(TREND_DIRECTION_GAP));
    assert.ok(detailsOf(sectionNamed(report, IMPACT).blocks).includes(PERSONA_AND_ENABLEMENT_GAP));
  });

  it("declares all three for EVERY tenant, rich or empty — they are about our coverage", () => {
    for (const v of [view(), view({ readinessScore: null }), REAL_TENANT()]) {
      const serialised = JSON.stringify(build(v));
      for (const gap of __testables.DECLARED_GAPS) {
        assert.ok(serialised.includes(JSON.stringify(gap).slice(1, -1)), "a gap varied by tenant");
      }
    }
  });

  it("is a quiet note, not a finding — each names no check and carries no number", () => {
    const report = build(REAL_TENANT());
    for (const gap of __testables.DECLARED_GAPS) {
      const block = report.sections
        .flatMap((s) => s.blocks)
        .find((b) => b.kind === "unavailable" && b.detail === gap);
      assert.ok(block, "must be an unavailable block");
      assert.equal(block.kind === "unavailable" && block.checks.length, 0);
      // "Microsoft 365" is the product's name and the only digits allowed.
      assert.ok(!/\d/.test(gap.replace(/Microsoft 365/g, "")), `a gap quoted a figure: ${gap}`);
    }
  });

  it("names no check key — #441's rule that OUR wiring never reaches the reader", () => {
    for (const key of [
      "adoption:overall-active-rate",
      "adoption:teams-activity-trend",
      "adoption:email-activity-trend",
      "adoption:sharepoint-onedrive-trend",
      "adoption:viva-engage-health",
      "adoption:planner-usage",
      "teams:inactive-teams",
      "usage:",
    ]) {
      for (const gap of __testables.DECLARED_GAPS) {
        assert.ok(!gap.includes(key), `a gap leaked the check key ${key}`);
      }
    }
  });

  it("refuses the direction of travel in BOTH directions", () => {
    assert.ok(/rising, falling or holding steady/i.test(TREND_DIRECTION_GAP));
    assert.ok(/no baseline/i.test(TREND_DIRECTION_GAP));
  });

  it("refuses the usage count without implying the tenant is at fault", () => {
    assert.ok(/limit of what this assessment measures rather than a gap in your scan/i.test(USAGE_FIGURE_GAP));
    assert.ok(/nothing has been estimated in its place/i.test(USAGE_FIGURE_GAP));
  });
});

/* ------------------------------------------------------------------ *
 * Structure
 * ------------------------------------------------------------------ */

describe("the approved structure", () => {
  it("renders the design's surviving sections in order", () => {
    assert.deepEqual(build().sections.map((s) => s.heading), [SUMMARY, ACTIVITY, IMPACT]);
  });

  it("carries no Persona Readiness section and names no persona", () => {
    const report = build(REAL_TENANT());
    assert.ok(!/persona/i.test(report.sections.map((s) => s.heading).join(" ")), "no persona SECTION");
    // The gap declaration is the one place the WORD may appear, because its job
    // is to say there is no persona model. Nothing else may use it.
    const withoutGap = JSON.stringify(report).replace(
      JSON.stringify(PERSONA_AND_ENABLEMENT_GAP).slice(1, -1),
      "",
    );
    assert.ok(!/persona/i.test(withoutGap), "used the persona vocabulary outside the gap declaration");
  });

  it("carries no Workflow Alignment section and measures no workflow", () => {
    const report = build(REAL_TENANT());
    assert.ok(!/workflow alignment/i.test(JSON.stringify(report)));
    for (const claim of ["procurement", "bid assembly", "site reporting", "approval pattern"]) {
      assert.ok(!new RegExp(claim, "i").test(JSON.stringify(report)), `leaked the workflow claim "${claim}"`);
    }
  });

  it("carries no Training & Enablement section and claims no training", () => {
    const report = build(REAL_TENANT());
    assert.ok(!/training/i.test(report.sections.map((s) => s.heading).join(" ")));
    const withoutGap = JSON.stringify(report).replace(
      JSON.stringify(PERSONA_AND_ENABLEMENT_GAP).slice(1, -1),
      "",
    );
    for (const claim of ["training", "fundamentals", "no enablement", "recommended sequence"]) {
      assert.ok(!new RegExp(claim, "i").test(withoutGap), `leaked the enablement claim "${claim}"`);
    }
  });

  it("carries no Self-Resolution Actions section — remediation is the guide's job", () => {
    assert.ok(!/self-resolution/i.test(build(REAL_TENANT()).sections.map((s) => s.heading).join(" ")));
  });

  it("draws none of the design's three figures, even though a real series exists", () => {
    // `pillar-trend.ts` (#356) produces a real series and it reaches the view —
    // but it is the ADOPTION PILLAR SCORE over time, not usage over time, so
    // plotting it under a usage caption would be a fabricated shape.
    const withTrend = withPillar(REAL_TENANT(), "adoption", {
      trend: { series: [41, 42, 44, 45, 46, 46], window: "90d" },
    });
    assert.ok(!/"figure"/.test(JSON.stringify(build(withTrend))));
  });
});

/* ------------------------------------------------------------------ *
 * Findings — the real content this report actually has
 * ------------------------------------------------------------------ */

describe("findings", () => {
  it("renders every real adoption finding under Workload Activity, worst-first", () => {
    const rows = sectionNamed(build(REAL_TENANT()), ACTIVITY).blocks.flatMap((b) =>
      b.kind === "findings" ? b.rows : [],
    );
    assert.deepEqual(rows.map((r) => r.severity), ["critical", "attention", "attention"]);
    assert.equal(rows.length, 3);
  });

  it("keeps a finding whose check key is NOT in the adoption domain", () => {
    // `teams:inactive-teams` scores the adoption pillar through its signal's own
    // pillar (#469), so scoping this section to a written-down list of
    // `adoption:*` keys would have silently dropped it. It is scoped to the
    // PILLAR precisely so it cannot.
    const rows = sectionNamed(build(REAL_TENANT()), ACTIVITY).blocks.flatMap((b) =>
      b.kind === "findings" ? b.rows : [],
    );
    assert.ok(rows.some((r) => r.lead === "Viva Engage communities are inactive"));
  });

  it("names the check's DOMAIN and never the raw check key", () => {
    const rows = sectionNamed(build(REAL_TENANT()), ACTIVITY).blocks.flatMap((b) =>
      b.kind === "findings" ? b.rows : [],
    );
    assert.equal(rows[0].rest, "Recorded by the Adoption check on this tenant's last scan.");
    assert.equal(rows[2].rest, "Recorded by the Teams check on this tenant's last scan.");
    // Not a `:` sweep — the whole report is checked for every real key instead,
    // which is the claim that actually matters.
    const serialised = JSON.stringify(build(REAL_TENANT()));
    for (const key of [
      "adoption:overall-active-rate",
      "adoption:teams-activity-trend",
      "teams:inactive-teams",
    ]) {
      assert.ok(!serialised.includes(key), `the raw check key ${key} reached the reader`);
    }
  });

  it("tells 'evaluated clean' apart from 'never evaluated' (#399)", () => {
    const clean = sectionNamed(build(withPillar(view(), "adoption", { score: 88 })), ACTIVITY).blocks;
    assert.ok(clean.some((b) => b.kind === "prose" && /is a real result, not an empty section/.test(b.text)));

    const unevaluated = sectionNamed(build(), ACTIVITY).blocks;
    assert.ok(detailsOf(unevaluated).some((d) => /can be reported either way/.test(d)));
  });
});

/* ------------------------------------------------------------------ *
 * The clean-result writeups (#575) — a genuinely clean, fully-scored
 * pillar must never render "This section is not available" just because
 * the AI section itself produced nothing.
 * ------------------------------------------------------------------ */

describe("clean-result writeups replace the generic disclaimer for a genuinely clean pillar (#575)", () => {
  const OMITTED = (reason: string): WireAdoptionPayload => ({
    sections: [
      { key: "summary", heading: SUMMARY, html: null, omittedReason: reason, factCount: 1 },
      { key: "activity", heading: ACTIVITY, html: null, omittedReason: reason, factCount: 1 },
      { key: "copilotImpact", heading: IMPACT, html: null, omittedReason: reason, factCount: 1 },
    ],
  });

  it("writes a real clean-result paragraph instead of the generic disclaimer", () => {
    const clean = withPillar(view(), "adoption", { score: 89 });
    const report = buildAdoptionReport({
      view: clean,
      narrative: OMITTED("empty_response"),
      narrativeSettled: true,
      scannedCheckCount: 29,
    });
    for (const heading of [SUMMARY, ACTIVITY, IMPACT]) {
      const blocks = sectionNamed(report, heading).blocks;
      assert.ok(
        !detailsOf(blocks).some((d) => /not available|could not be written|came back empty/i.test(d)),
        `${heading} still rendered the generic disclaimer over a clean result`,
      );
      assert.ok(
        blocks.some(
          (b) => b.kind === "prose" && /89 of 100/.test(b.text) && /critical or warning finding/i.test(b.text),
        ),
        `${heading} did not carry the real clean-result writeup`,
      );
    }
  });

  it("still writes the honest disclaimer when the pillar genuinely was never evaluated", () => {
    const report = buildAdoptionReport({
      view: view(),
      narrative: OMITTED("no_real_data"),
      narrativeSettled: true,
      scannedCheckCount: 29,
    });
    assert.ok(
      detailsOf(sectionNamed(report, SUMMARY).blocks).some((d) => /nothing real to reason from/i.test(d)),
    );
  });

  it("still writes the honest disclaimer for a pillar with real findings whose prose failed", () => {
    const report = buildAdoptionReport({
      view: REAL_TENANT(),
      narrative: OMITTED("generation_failed"),
      narrativeSettled: true,
      scannedCheckCount: 29,
    });
    assert.ok(
      detailsOf(sectionNamed(report, SUMMARY).blocks).some((d) => /could not be written/i.test(d)),
      "a pillar with real findings must not get the clean writeup just because its prose failed",
    );
  });
});

/* ------------------------------------------------------------------ *
 * The scanned workload list (#575) — the standfirst names only the
 * workloads THIS tenant's scan package actually curates a check for.
 * ------------------------------------------------------------------ */

describe("the standfirst names only workloads this tenant's scan actually curates (#575)", () => {
  it("names only the workloads behind a scanned check", () => {
    const report = buildAdoptionReport({
      view: view(),
      narrative: {
        sections: [],
        scannedCheckKeys: ["adoption:teams-activity-trend", "adoption:email-activity-trend"],
      },
      narrativeSettled: true,
      scannedCheckCount: 2,
    });
    assert.ok(report.standfirst.includes("mail and Teams"), report.standfirst);
    assert.ok(!report.standfirst.includes("Viva Engage"));
    assert.ok(!report.standfirst.includes("Planner"));
    assert.ok(!report.standfirst.includes("SharePoint"));
  });

  it("names no workload before the scan set is known, without an empty clause", () => {
    const report = buildAdoptionReport({
      view: view(),
      narrative: null,
      narrativeSettled: false,
      scannedCheckCount: 0,
    });
    assert.ok(
      report.standfirst.startsWith("This report evaluates how your people are actually using Microsoft 365 and"),
      report.standfirst,
    );
  });
});

/* ------------------------------------------------------------------ *
 * The never-fabricate guarantee on a thin tenant
 * ------------------------------------------------------------------ */

describe("never fabricate: an empty tenant produces a shorter report, not an invented one", () => {
  it("asserts no verdict for a pillar nothing scored", () => {
    const verdict = buildVerdict(undefined);
    assert.equal(verdict.headline, "No adoption score yet");
    assert.ok(!/\d/.test(verdict.headline));
  });

  it("leads with the pillar's own real finding, never with the design's dormancy claim", () => {
    const adoption = REAL_TENANT().pillars.find((p) => p.key === "adoption");
    const verdict = buildVerdict(adoption);
    assert.equal(verdict.eyebrow, "Worst finding");
    assert.equal(verdict.headline, "Viva Engage communities are inactive");
    assert.ok(verdict.sub.includes("46 of 100"));
    assert.ok(/usage count/i.test(verdict.sub), "the verdict card must disclaim it too");
  });

  it("falls back to the score, never to an invented finding, for a clean pillar", () => {
    assert.equal(buildVerdict(pillar("adoption", { score: 88 })).headline, "Adoption scores 88 of 100");
  });

  it("omits the closing score sentence entirely when there is no score", () => {
    assert.equal(build().closing.length, 1);
    assert.equal(build(REAL_TENANT()).closing.length, 2);
  });

  it("states no projected score and no point attribution — the design does both", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    for (const claim of [
      "estimated 61",
      "points of available gain",
      "would move",
      "would rise",
      "after enablement",
      "once trained",
    ]) {
      assert.ok(!new RegExp(claim, "i").test(serialised), `leaked the projection "${claim}"`);
    }
  });

  it("shows the Gate row only when the platform actually has a readiness score", () => {
    assert.equal(rowsOf(sectionNamed(build(view({ readinessScore: null })), IMPACT).blocks).length, 0);
    const [row] = rowsOf(sectionNamed(build(REAL_TENANT()), IMPACT).blocks);
    assert.equal(
      row.value,
      `41 against a Gate of ${COPILOT_GATE_TARGET} — ${COPILOT_GATE_TARGET - 41} points short`,
    );
  });

  it("claims nothing about a prose section that is still in flight", () => {
    const report = build(REAL_TENANT(), null, false);
    for (const heading of [SUMMARY, ACTIVITY, IMPACT]) {
      const blocks = sectionNamed(report, heading).blocks;
      assert.equal(blocks.filter((b) => b.kind === "narrative").length, 0);
      assert.ok(
        !detailsOf(blocks).some((d) =>
          /not available for|could not be written|came back empty|nothing real to reason/i.test(d),
        ),
        `${heading} passed judgement on prose that had not resolved`,
      );
    }
    // The gaps still render — they are not prose and do not wait on a fetch.
    assert.ok(detailsOf(sectionNamed(report, SUMMARY).blocks).includes(USAGE_FIGURE_GAP));
  });

  it("says which kind of nothing a resolved-but-empty prose section is", () => {
    const report = build(REAL_TENANT(), {
      sections: [
        { key: "activity", heading: ACTIVITY, html: null, omittedReason: "no_real_data", factCount: 0 },
      ],
    });
    assert.ok(
      detailsOf(sectionNamed(report, ACTIVITY).blocks).some((d) => /nothing real to reason from/.test(d)),
    );
  });

  it("renders the prose the route did write", () => {
    const report = build(REAL_TENANT(), {
      sections: [
        { key: "summary", heading: SUMMARY, html: "<p>Real prose.</p>", omittedReason: null, factCount: 4 },
      ],
    });
    assert.ok(
      sectionNamed(report, SUMMARY).blocks.some(
        (b) => b.kind === "narrative" && b.html === "<p>Real prose.</p>",
      ),
    );
  });
});

/* ------------------------------------------------------------------ *
 * Upgrade Opportunities (#451)
 * ------------------------------------------------------------------ */

describe("a licence gap is its own category, never a coverage apology", () => {
  /**
   * This report picks NO stats, so unlike its six siblings the only licence gap
   * it can learn about is one the narrative route reported from the same
   * payload. That is the whole of the path under test here.
   */
  const GATED = (): WireAdoptionPayload => ({
    sections: [
      {
        key: "activity",
        heading: ACTIVITY,
        html: null,
        omittedReason: "no_real_data",
        factCount: 0,
        missingChecks: [
          { checkKey: "adoption:viva-engage-health", reason: "license_gap", licenseFeature: "Viva Suite" },
        ],
      },
    ],
  });

  it("files it under Upgrade Opportunities and not under the gap list", () => {
    const report = build(REAL_TENANT(), GATED());
    const items = sectionNamed(report, UPGRADE_OPPORTUNITY_HEADING).blocks.flatMap((b) =>
      b.kind === "upgradeOpportunity" ? b.items : [],
    );
    assert.deepEqual(items.map((i) => i.checkKey), ["adoption:viva-engage-health"]);
    // No per-check disclosure is written for this key, so the shared fallback
    // runs: it names only the tier the tenant's OWN scan reported, and refuses
    // to read the absence as a pass.
    assert.ok(/^Requires Viva Suite\./.test(items[0].disclosure), items[0].disclosure);
    assert.ok(/an unknown result, not a pass/.test(items[0].disclosure));
  });

  it("carries no price, no CTA and no promotional framing (#451)", () => {
    const items = sectionNamed(build(REAL_TENANT(), GATED()), UPGRADE_OPPORTUNITY_HEADING).blocks.flatMap(
      (b) => (b.kind === "upgradeOpportunity" ? b.items : []),
    );
    for (const item of items) {
      assert.ok(!/\$|per month|per seat|contact|talk to|book a/i.test(item.disclosure), item.disclosure);
    }
  });

  it("has no section at all when nothing is gated", () => {
    assert.ok(!build(REAL_TENANT()).sections.some((s) => s.heading === UPGRADE_OPPORTUNITY_HEADING));
  });
});
