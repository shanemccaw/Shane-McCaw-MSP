/**
 * pillarGovernancePosture.test.ts — the real Governance Posture Report's pure
 * builder (#292).
 *
 * Same discipline as `pillarSecurityPosture.test.ts`, for the same reason:
 * anyone can assert that a populated tenant produces a populated report; what
 * this file exists to pin is that a THIN tenant produces a SHORTER report rather
 * than a fabricated one — no invented numbers, no zeroes standing in for absent
 * data, no template prose filling an empty section, and the difference between
 * "the check never ran" and "it ran and found nothing" surviving to the page.
 *
 * Three things here are specific to this report and are the reason it exists:
 *   • The framework framing survives and the framework SCORE does not. Shane
 *     lifted the framing restriction on 2026-08-06; "4 of 11 controls met" still
 *     has no producer, and the section has to say the first without implying the
 *     second.
 *   • "Drift & Violations" and "Governance Automation Readiness" must never
 *     appear — no baseline exists for the first and no producer for any row of
 *     the second.
 *   • The design's heat map needs a per-category content classification this
 *     platform does not make, so no category name may reach the page.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GOVERNANCE_FRAMEWORK_GAP,
  POLICY_COVERAGE_GAP,
  buildGovernancePostureReport,
  buildVerdict,
  __testables,
  type GovernancePostureBlock,
  type WireGovernancePosturePayload,
} from "./pillarGovernancePosture.ts";
import { UPGRADE_OPPORTUNITY_HEADING } from "./liveReportBlocks.ts";
import { COPILOT_GATE_TARGET, PILLAR_KEYS } from "./journeyTokens.ts";
import {
  FIXTURE_LEAKS,
  REAL_COMPLIANCE_STATS,
  REAL_GOVERNANCE_STATS,
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
  narrative: WireGovernancePosturePayload | null = null,
  settled = true,
) {
  return buildGovernancePostureReport({
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

function rowsOf(blocks: readonly GovernancePostureBlock[]): { label: string; value: string }[] {
  return blocks.flatMap((b) =>
    b.kind === "keyValues" ? b.rows.map((r) => ({ label: r.label, value: r.value })) : [],
  );
}

function detailsOf(blocks: readonly GovernancePostureBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === "unavailable" ? [b.detail] : []));
}

function namedChecks(blocks: readonly GovernancePostureBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === "unavailable" ? b.checks.map((c) => c.checkKey) : []));
}

const REAL_TENANT = () => {
  let v = view();
  v = withPillar(v, "governance", {
    score: 34,
    headline: "212 SharePoint sites are shared with everyone in the tenant",
    stats: REAL_GOVERNANCE_STATS,
    findings: [
      { severity: "critical", checkKey: "compliance:overshared-sites", title: "212 SharePoint sites are shared with everyone in the tenant" },
      { severity: "warning", checkKey: "compliance:public-channels", title: "61 Teams channels are open to every licensed user" },
    ],
  });
  v = withPillar(v, "compliance", { score: 29, stats: REAL_COMPLIANCE_STATS });
  return v;
};

/* ------------------------------------------------------------------ *
 * Structure — what the design asked for, minus what has no producer
 * ------------------------------------------------------------------ */

describe("the approved structure", () => {
  it("renders the design's surviving sections in order", () => {
    assert.deepEqual(
      build().sections.map((s) => s.heading),
      [
        "Governance Posture Summary",
        "Exposure & Oversharing Risks",
        "Governance Framework Alignment",
        "Copilot Readiness Impact",
      ],
    );
  });

  it("never emits a drift section or a drift row, whatever the tenant carries", () => {
    const report = build(REAL_TENANT());
    assert.ok(!/drift/i.test(report.sections.map((s) => s.heading).join(" ")), "no drift SECTION");
    // The Summary's "Governance drift" row is dropped too — there is no baseline
    // to diff against on a first scan, so any figure would be invented.
    assert.ok(
      !rowsOf(sectionNamed(report, "Governance Posture Summary").blocks).some((r) => /drift/i.test(r.label)),
    );
  });

  it("carries no Governance Automation Readiness section — no row of it has a producer", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    assert.ok(!/automation readiness/i.test(serialised));
    for (const claim of ["SIA", "Risk-Based Decision", "governance owner", "change control"]) {
      assert.ok(!new RegExp(claim, "i").test(serialised), `leaked the unbacked claim "${claim}"`);
    }
  });

  it("carries no Self-Resolution Actions section — remediation is the guide's job", () => {
    assert.ok(!/self-resolution/i.test(build(REAL_TENANT()).sections.map((s) => s.heading).join(" ")));
  });

  it("names no site, department, policy or date from the design's worked example", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    for (const leak of FIXTURE_LEAKS) {
      assert.ok(!serialised.includes(leak), `leaked the design fixture's "${leak}"`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The framework — framing kept, score dropped
 * ------------------------------------------------------------------ */

describe("Governance Framework Alignment keeps the framing and drops the score", () => {
  it("keeps the framework's provenance — the framing restriction was lifted", () => {
    assert.ok(/NASA/.test(GOVERNANCE_FRAMEWORK_GAP), "the framing is Shane's to state and is kept");
  });

  it("claims no number of controls met or missed", () => {
    assert.ok(!/\d+\s*(of|\/)\s*\d+/.test(GOVERNANCE_FRAMEWORK_GAP), "a score with no producer cannot be claimed");
    assert.ok(
      /no number of controls is claimed met and none is claimed missed/i.test(GOVERNANCE_FRAMEWORK_GAP),
      "must refuse the verdict in both directions",
    );
  });

  it("reproduces none of the design's five control rows", () => {
    const section = sectionNamed(build(REAL_TENANT()), __testables.FRAMEWORK_HEADING);
    assert.equal(rowsOf(section.blocks).length, 0, "no control verdict may become a row");
    for (const control of ["Naming & taxonomy", "Sensitivity label strategy", "Lifecycle policies", "RBAC"]) {
      assert.ok(!JSON.stringify(section).includes(control), `leaked the control row "${control}"`);
    }
  });

  it("renders for EVERY tenant, rich or empty — it is about our coverage, not their scan", () => {
    for (const v of [view(), REAL_TENANT()]) {
      const details = detailsOf(sectionNamed(build(v), __testables.FRAMEWORK_HEADING).blocks);
      assert.ok(details.includes(GOVERNANCE_FRAMEWORK_GAP), "the gap must not vary by tenant");
    }
  });

  it("is a quiet note, not a finding — it names no check key", () => {
    const blocks = sectionNamed(build(REAL_TENANT()), __testables.FRAMEWORK_HEADING).blocks;
    const gap = blocks.find((b) => b.kind === "unavailable" && b.detail === GOVERNANCE_FRAMEWORK_GAP);
    assert.ok(gap, "must be an unavailable block");
    assert.equal(gap.kind === "unavailable" && gap.checks.length, 0, "and must name no check");
  });
});

/* ------------------------------------------------------------------ *
 * The policy-coverage gap — #441's rule on rows with no check at all
 * ------------------------------------------------------------------ */

describe("policy coverage and admin discipline are honest gaps", () => {
  it("is declared for EVERY tenant, rich or empty", () => {
    for (const v of [view(), REAL_TENANT()]) {
      const details = detailsOf(sectionNamed(build(v), "Governance Posture Summary").blocks);
      assert.ok(details.includes(POLICY_COVERAGE_GAP), "the gap must not vary by tenant");
    }
  });

  it("states no count, no policy scope and no PIM verdict", () => {
    assert.ok(!/\d/.test(POLICY_COVERAGE_GAP), "a gap with no producer cannot carry a number");
    assert.ok(
      /gap in what this platform measures today, not a finding about your tenant/i.test(POLICY_COVERAGE_GAP),
      "must attribute the gap to our coverage, not to the tenant",
    );
  });

  it("names no check key — #441's rule that OUR wiring never reaches the reader", () => {
    for (const key of ["identity:global-admin-count", "identity:mfa-registration", "compliance:weak-dlp-policies"]) {
      assert.ok(!POLICY_COVERAGE_GAP.includes(key), `leaked the check key ${key}`);
    }
  });

  it("points the admin figures at the report that genuinely carries them", () => {
    assert.ok(
      /Security Posture & Blast Radius Report/.test(POLICY_COVERAGE_GAP),
      "the admin and MFA counts are real and belong to another report — say where, do not restate",
    );
  });
});

/* ------------------------------------------------------------------ *
 * The real figures
 * ------------------------------------------------------------------ */

describe("the four real governance stats", () => {
  it("puts the estate figures in the Summary and the exposure figure in its own section", () => {
    const report = build(REAL_TENANT());
    assert.deepEqual(
      rowsOf(sectionNamed(report, "Governance Posture Summary").blocks).map((r) => r.label),
      ["Sites in scope", "Overshared sites", "Open collaboration surface"],
    );
    assert.deepEqual(
      rowsOf(sectionNamed(report, "Exposure & Oversharing Risks").blocks).map((r) => r.label),
      ["Items over-exposed"],
    );
  });

  it("never states the same figure under two headings", () => {
    const all = [...__testables.SUMMARY_PICKS, ...__testables.EXPOSURE_PICKS].map((p) => p.statId);
    assert.equal(new Set(all).size, all.length);
  });

  it("carries the real over-exposure count verbatim, not a re-derived one", () => {
    const rows = rowsOf(sectionNamed(build(REAL_TENANT()), "Exposure & Oversharing Risks").blocks);
    assert.ok(rows[0].value.startsWith("214,806 "));
  });

  it("draws no heat map and names no content category", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    assert.ok(!/"figure"/.test(serialised), "no figure block — the heat map has no producer");
    for (const category of ["PII", "PHI", "Commercial", "Anonymous links", "Org-wide links"]) {
      assert.ok(!serialised.includes(category), `leaked the content category "${category}"`);
    }
  });

  it("names the missing checks rather than showing a zero", () => {
    const v = withPillar(view(), "governance", {
      score: 34,
      stats: [
        stat({ id: "governance.sites", value: null, unavailableReason: "not_in_scan_package", checkKey: "compliance:sharepoint-sites" }),
        stat({ id: "governance.overshared", value: 212, checkKey: "compliance:overshared-sites" }),
      ],
    });
    const blocks = sectionNamed(build(v), "Governance Posture Summary").blocks;
    assert.deepEqual(rowsOf(blocks).map((r) => r.label), ["Overshared sites"]);
    assert.ok(namedChecks(blocks).includes("compliance:sharepoint-sites"));
    assert.ok(!JSON.stringify(blocks).includes('"0 '), "an absent stat is never a zero");
  });

  it("never reaches the reader when the failure is OUR wiring (#441)", () => {
    const v = withPillar(view(), "governance", {
      score: 34,
      stats: [stat({ id: "governance.sites", value: null, unavailableReason: "unknown_metric_key", checkKey: "compliance:sharepoint-sites" })],
    });
    assert.ok(!JSON.stringify(build(v)).includes("compliance:sharepoint-sites"));
  });
});

/* ------------------------------------------------------------------ *
 * Findings and the #399 clean/unevaluated distinction
 * ------------------------------------------------------------------ */

describe("findings", () => {
  it("renders the governance pillar's real findings under Exposure & Oversharing Risks", () => {
    const section = sectionNamed(build(REAL_TENANT()), "Exposure & Oversharing Risks");
    const rows = section.blocks.flatMap((b) => (b.kind === "findings" ? b.rows : []));
    assert.deepEqual(rows.map((r) => r.lead), [
      "212 SharePoint sites are shared with everyone in the tenant",
      "61 Teams channels are open to every licensed user",
    ]);
    // `rest` is provenance only — never an elaboration the platform does not hold.
    assert.deepEqual(rows.map((r) => r.rest), [
      "Recorded by the Compliance check on this tenant's last scan.",
      "Recorded by the Compliance check on this tenant's last scan.",
    ]);
    assert.deepEqual(rows.map((r) => r.severity), ["critical", "attention"]);
  });

  it("tells 'evaluated clean' apart from 'never evaluated' (#399)", () => {
    const clean = sectionNamed(
      build(withPillar(view(), "governance", { score: 71 })),
      "Exposure & Oversharing Risks",
    ).blocks;
    assert.ok(clean.some((b) => b.kind === "prose" && /is a real result, not an empty section/.test(b.text)));

    const unevaluated = sectionNamed(build(), "Exposure & Oversharing Risks").blocks;
    assert.ok(
      detailsOf(unevaluated).some((d) => /no oversharing or exposure finding can be reported either way/.test(d)),
    );
  });
});

/* ------------------------------------------------------------------ *
 * The never-fabricate guarantee on a thin tenant
 * ------------------------------------------------------------------ */

describe("never fabricate: an empty tenant produces a shorter report, not an invented one", () => {
  it("renders no keyValues row anywhere when no stat and no score is real", () => {
    const report = build(view({ readinessScore: null }));
    for (const section of report.sections) {
      assert.equal(rowsOf(section.blocks).length, 0, `${section.heading} invented a row`);
    }
  });

  it("asserts no verdict for a pillar nothing scored", () => {
    const verdict = buildVerdict(undefined);
    assert.equal(verdict.headline, "No governance score yet");
    assert.ok(!/\d/.test(verdict.headline));
    assert.ok(/has not yet evaluated/.test(verdict.sub));
  });

  it("leads with the pillar's own real finding when there is one", () => {
    const governance = REAL_TENANT().pillars.find((p) => p.key === "governance");
    const verdict = buildVerdict(governance);
    assert.equal(verdict.eyebrow, "Worst finding");
    assert.equal(verdict.headline, "212 SharePoint sites are shared with everyone in the tenant");
    assert.ok(verdict.sub.includes("34 of 100"));
  });

  it("falls back to the score, never to an invented finding, for a clean pillar", () => {
    const verdict = buildVerdict(pillar("governance", { score: 88 }));
    assert.equal(verdict.eyebrow, "Governance posture");
    assert.equal(verdict.headline, "Governance scores 88 of 100");
  });

  it("omits the closing score sentence entirely when there is no score", () => {
    assert.equal(build().closing.length, 1);
    assert.equal(build(REAL_TENANT()).closing.length, 2);
  });

  it("shows the Gate row only when the platform actually has a readiness score", () => {
    const noScore = sectionNamed(build(view({ readinessScore: null })), "Copilot Readiness Impact");
    assert.equal(rowsOf(noScore.blocks).length, 0);
    const [row] = rowsOf(sectionNamed(build(REAL_TENANT()), "Copilot Readiness Impact").blocks);
    assert.equal(row.value, `41 against a Gate of ${COPILOT_GATE_TARGET} — ${COPILOT_GATE_TARGET - 41} points short`);
  });

  it("claims nothing about a prose section that is still in flight", () => {
    const report = build(REAL_TENANT(), null, false);
    for (const heading of ["Governance Posture Summary", "Exposure & Oversharing Risks", "Copilot Readiness Impact"]) {
      const blocks = sectionNamed(report, heading).blocks;
      assert.equal(blocks.filter((b) => b.kind === "narrative").length, 0);
      assert.ok(
        !detailsOf(blocks).some((d) => /not available|could not be written|came back empty/i.test(d)),
        `${heading} passed judgement on prose that had not resolved`,
      );
    }
    // The pure-data rows around it still render — they never wait on an AI route.
    assert.ok(rowsOf(sectionNamed(report, "Governance Posture Summary").blocks).length > 0);
  });

  it("says which kind of nothing a resolved-but-empty prose section is", () => {
    const report = build(REAL_TENANT(), {
      sections: [
        { key: "summary", heading: "Governance Posture Summary", html: null, omittedReason: "no_real_data", factCount: 0 },
      ],
    });
    assert.ok(
      detailsOf(sectionNamed(report, "Governance Posture Summary").blocks).some((d) =>
        /nothing real to reason from/.test(d),
      ),
    );
  });
});

/* ------------------------------------------------------------------ *
 * Upgrade Opportunities (#451)
 * ------------------------------------------------------------------ */

describe("a licence gap is its own category, never a coverage apology", () => {
  const GATED = () =>
    withPillar(view(), "governance", {
      score: 34,
      stats: [
        stat({
          id: "governance.exposure",
          value: null,
          unavailableReason: "license_gap",
          checkKey: "copilot:overshare-exposure",
        }),
      ],
    });

  it("files it under Upgrade Opportunities and not under the gap list", () => {
    const report = build(GATED());
    assert.ok(!namedChecks(sectionNamed(report, "Exposure & Oversharing Risks").blocks).includes("copilot:overshare-exposure"));
    const items = sectionNamed(report, UPGRADE_OPPORTUNITY_HEADING).blocks.flatMap((b) =>
      b.kind === "upgradeOpportunity" ? b.items : [],
    );
    assert.deepEqual(items.map((i) => i.checkKey), ["copilot:overshare-exposure"]);
  });

  it("carries no price, no CTA and no promotional framing (#451)", () => {
    const items = sectionNamed(build(GATED()), UPGRADE_OPPORTUNITY_HEADING).blocks.flatMap((b) =>
      b.kind === "upgradeOpportunity" ? b.items : [],
    );
    for (const item of items) {
      assert.ok(!/\$|per month|per seat|contact|talk to|book a/i.test(item.disclosure), item.disclosure);
    }
  });

  it("has no section at all when nothing is gated", () => {
    assert.ok(!build(REAL_TENANT()).sections.some((s) => s.heading === UPGRADE_OPPORTUNITY_HEADING));
  });
});

/* ------------------------------------------------------------------ *
 * The picks are a contract with war-room-pillar-stats.ts
 * ------------------------------------------------------------------ */

describe("every pick names a real stat id on a real pillar", () => {
  it("uses stat ids in the `<pillar>.<name>` shape the payload actually emits", () => {
    for (const pick of [...__testables.SUMMARY_PICKS, ...__testables.EXPOSURE_PICKS]) {
      assert.match(pick.statId, /^[a-z]+\.[a-zA-Z]+$/, `${pick.statId} is not a stat id`);
      assert.ok(pick.statId.startsWith(`${pick.pillar}.`), `${pick.statId} is not on the ${pick.pillar} card`);
      assert.ok((PILLAR_KEYS as readonly string[]).includes(pick.pillar));
    }
  });

  it("picks only from the governance card — this is that pillar's own report", () => {
    for (const pick of [...__testables.SUMMARY_PICKS, ...__testables.EXPOSURE_PICKS]) {
      assert.equal(pick.pillar, "governance");
    }
  });
});
