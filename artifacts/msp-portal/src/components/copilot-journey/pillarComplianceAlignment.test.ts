/**
 * pillarComplianceAlignment.test.ts — the real Compliance & Regulatory
 * Alignment Report's pure builder (#292).
 *
 * Same discipline as `pillarSecurityPosture.test.ts`: what this file pins is
 * that a THIN tenant produces a SHORTER report rather than a fabricated one.
 *
 * Two things here are specific to this report and are the reason it exists:
 *   • NO REGULATORY VERDICT, ANYWHERE. The design grades this tenant against
 *     GDPR, SOX, HIPAA and FINRA; this platform runs no framework check of any
 *     kind. The report has to say so without implying the verdict would have
 *     been bad — an assessment that did not look must not read as one that
 *     looked and disapproved.
 *   • NO CONTENT CLASSIFICATION. `compliance:missing-labels` counts unlabelled
 *     items; it does not say which of them hold personal, health or financial
 *     data. "84 PHI items" is the exact inference this report must never make.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REGULATORY_FRAMEWORK_GAP,
  buildComplianceAlignmentReport,
  buildVerdict,
  __testables,
  type ComplianceAlignmentBlock,
  type WireComplianceAlignmentPayload,
} from "./pillarComplianceAlignment.ts";
import { UPGRADE_OPPORTUNITY_HEADING } from "./liveReportBlocks.ts";
import { COPILOT_GATE_TARGET, PILLAR_KEYS } from "./journeyTokens.ts";
import {
  FIXTURE_LEAKS,
  REAL_COMPLIANCE_STATS,
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
  narrative: WireComplianceAlignmentPayload | null = null,
  settled = true,
) {
  return buildComplianceAlignmentReport({
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

function rowsOf(blocks: readonly ComplianceAlignmentBlock[]): { label: string; value: string }[] {
  return blocks.flatMap((b) =>
    b.kind === "keyValues" ? b.rows.map((r) => ({ label: r.label, value: r.value })) : [],
  );
}

function detailsOf(blocks: readonly ComplianceAlignmentBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === "unavailable" ? [b.detail] : []));
}

function namedChecks(blocks: readonly ComplianceAlignmentBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === "unavailable" ? b.checks.map((c) => c.checkKey) : []));
}

const REAL_TENANT = () =>
  withPillar(view(), "compliance", {
    score: 29,
    headline: "40,480 items carry no sensitivity label",
    stats: REAL_COMPLIANCE_STATS,
    findings: [
      { severity: "critical", checkKey: "compliance:missing-labels", title: "40,480 items carry no sensitivity label" },
      { severity: "warning", checkKey: "compliance:guest-users", title: "31 guest accounts hold standing access" },
    ],
  });

/* ------------------------------------------------------------------ *
 * Structure
 * ------------------------------------------------------------------ */

describe("the approved structure", () => {
  it("renders the design's surviving sections in order", () => {
    assert.deepEqual(
      build().sections.map((s) => s.heading),
      ["Compliance Posture Summary", "Data Lifecycle & Records Management", "Copilot Readiness Impact"],
    );
  });

  it("never emits a drift section or a drift row, whatever the tenant carries", () => {
    const report = build(REAL_TENANT());
    assert.ok(!/drift/i.test(report.sections.map((s) => s.heading).join(" ")), "no drift SECTION");
    // The row label deliberately reads "Retention coverage", not "drift": the
    // real check is a point-in-time count of coverage gaps, not a movement.
    assert.ok(
      !rowsOf(sectionNamed(report, "Compliance Posture Summary").blocks).some((r) => /drift/i.test(r.label)),
    );
  });

  it("carries no Regulatory Alignment Assessment and no Sensitivity & Labeling section", () => {
    const headings = build(REAL_TENANT()).sections.map((s) => s.heading).join(" ");
    assert.ok(!/regulatory alignment assessment/i.test(headings));
    assert.ok(!/sensitivity & labeling/i.test(headings));
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
 * The rule this report exists to hold: no regulatory verdict
 * ------------------------------------------------------------------ */

describe("no framework is graded, and the report says so", () => {
  it("is declared for EVERY tenant, rich or empty", () => {
    for (const v of [view(), REAL_TENANT()]) {
      const details = detailsOf(sectionNamed(build(v), "Compliance Posture Summary").blocks);
      assert.ok(details.includes(REGULATORY_FRAMEWORK_GAP), "the gap must not vary by tenant");
    }
  });

  it("refuses the verdict in BOTH directions — an unlooked-at obligation is not a failed one", () => {
    assert.ok(
      /neither confirms|are met, or that they are not|only that this scan did not evaluate them/i.test(
        REGULATORY_FRAMEWORK_GAP,
      ),
      "must say explicitly that no verdict is implied either way",
    );
  });

  it("grades no framework anywhere in the rendered report", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    // The gap declaration is allowed to NAME the frameworks in order to say it
    // does not grade them; nothing else in the document may mention one.
    const withoutGap = serialised.replace(JSON.stringify(REGULATORY_FRAMEWORK_GAP).slice(1, -1), "");
    for (const framework of ["GDPR", "SOX", "HIPAA", "FINRA", "PCI", "ISO 27001", "NIST"]) {
      assert.ok(!withoutGap.includes(framework), `graded or named "${framework}" outside the gap declaration`);
    }
  });

  it("classifies no content — never PII, PHI or 'regulated data'", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    for (const term of ["PII", "PHI", "regulated data", "health data", "financial content"]) {
      assert.ok(!serialised.includes(term), `classified content as "${term}"`);
    }
  });

  it("is a quiet note, not a finding — it names no check key", () => {
    const blocks = sectionNamed(build(REAL_TENANT()), "Compliance Posture Summary").blocks;
    const gap = blocks.find((b) => b.kind === "unavailable" && b.detail === REGULATORY_FRAMEWORK_GAP);
    assert.ok(gap, "must be an unavailable block");
    assert.equal(gap.kind === "unavailable" && gap.checks.length, 0, "and must name no check");
    // No measurement of any kind. "Microsoft 365" is the product's name and the
    // only digits allowed; anything else would be a figure with no producer.
    assert.ok(
      !/\d/.test(REGULATORY_FRAMEWORK_GAP.replace(/Microsoft 365/g, "")),
      "a gap with no producer cannot carry a number",
    );
  });
});

/* ------------------------------------------------------------------ *
 * The real figures
 * ------------------------------------------------------------------ */

describe("the three real compliance stats", () => {
  it("states all three once, in the Summary, and nowhere else", () => {
    const report = build(REAL_TENANT());
    assert.deepEqual(
      rowsOf(sectionNamed(report, "Compliance Posture Summary").blocks).map((r) => r.label),
      ["Unlabelled content", "Data Loss Prevention", "External access"],
    );
    assert.equal(rowsOf(sectionNamed(report, "Data Lifecycle & Records Management").blocks).length, 0);
  });

  it("carries each real value verbatim", () => {
    const rows = rowsOf(sectionNamed(build(REAL_TENANT()), "Compliance Posture Summary").blocks);
    assert.ok(rows[0].value.startsWith("40,480 "));
    assert.ok(rows[2].value.startsWith("31 "));
  });

  it("names the missing checks rather than showing a zero", () => {
    const v = withPillar(view(), "compliance", {
      score: 29,
      stats: [
        stat({ id: "compliance.missingLabels", value: null, unavailableReason: "not_in_scan_package", checkKey: "compliance:missing-labels" }),
        stat({ id: "compliance.guests", value: 31, checkKey: "compliance:guest-users" }),
      ],
    });
    const blocks = sectionNamed(build(v), "Compliance Posture Summary").blocks;
    assert.deepEqual(rowsOf(blocks).map((r) => r.label), ["External access"]);
    assert.ok(namedChecks(blocks).includes("compliance:missing-labels"));
  });

  it("never reaches the reader when the failure is OUR wiring (#441)", () => {
    const v = withPillar(view(), "compliance", {
      score: 29,
      stats: [stat({ id: "compliance.weakDlp", value: null, unavailableReason: "unknown_metric_key", checkKey: "compliance:weak-dlp-policies" })],
    });
    assert.ok(!JSON.stringify(build(v)).includes("compliance:weak-dlp-policies"));
  });
});

/* ------------------------------------------------------------------ *
 * Findings
 * ------------------------------------------------------------------ */

describe("findings", () => {
  it("renders the compliance pillar's real findings under Data Lifecycle", () => {
    const rows = sectionNamed(build(REAL_TENANT()), "Data Lifecycle & Records Management").blocks.flatMap(
      (b) => (b.kind === "findings" ? b.rows : []),
    );
    assert.deepEqual(rows.map((r) => r.lead), [
      "40,480 items carry no sensitivity label",
      "31 guest accounts hold standing access",
    ]);
    assert.deepEqual(rows.map((r) => r.severity), ["critical", "attention"]);
  });

  it("tells 'evaluated clean' apart from 'never evaluated' (#399)", () => {
    const clean = sectionNamed(
      build(withPillar(view(), "compliance", { score: 71 })),
      "Data Lifecycle & Records Management",
    ).blocks;
    assert.ok(clean.some((b) => b.kind === "prose" && /is a real result, not an empty section/.test(b.text)));

    const unevaluated = sectionNamed(build(), "Data Lifecycle & Records Management").blocks;
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
    assert.equal(verdict.headline, "No compliance score yet");
    assert.ok(!/\d/.test(verdict.headline));
  });

  it("leads with the pillar's own real finding, and never calls it a regulatory verdict", () => {
    const compliance = REAL_TENANT().pillars.find((p) => p.key === "compliance");
    const verdict = buildVerdict(compliance);
    assert.equal(verdict.eyebrow, "Worst finding");
    assert.equal(verdict.headline, "40,480 items carry no sensitivity label");
    assert.ok(/regulatory verdict/.test(verdict.sub), "the verdict card must disclaim it too");
  });

  it("falls back to the score, never to an invented finding, for a clean pillar", () => {
    assert.equal(buildVerdict(pillar("compliance", { score: 88 })).headline, "Compliance scores 88 of 100");
  });

  it("omits the closing score sentence entirely when there is no score", () => {
    assert.equal(build().closing.length, 1);
    assert.equal(build(REAL_TENANT()).closing.length, 2);
  });

  it("ranks this pillar against no other — the design calls it 'the lowest reading'", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    assert.ok(!/lowest|weakest|largest deficit|strongest pillar/i.test(serialised));
  });

  it("shows the Gate row only when the platform actually has a readiness score", () => {
    assert.equal(rowsOf(sectionNamed(build(view({ readinessScore: null })), "Copilot Readiness Impact").blocks).length, 0);
    const [row] = rowsOf(sectionNamed(build(REAL_TENANT()), "Copilot Readiness Impact").blocks);
    assert.equal(row.value, `41 against a Gate of ${COPILOT_GATE_TARGET} — ${COPILOT_GATE_TARGET - 41} points short`);
  });

  it("claims nothing about a prose section that is still in flight", () => {
    const report = build(REAL_TENANT(), null, false);
    for (const heading of ["Compliance Posture Summary", "Copilot Readiness Impact"]) {
      const blocks = sectionNamed(report, heading).blocks;
      assert.equal(blocks.filter((b) => b.kind === "narrative").length, 0);
      assert.ok(
        !detailsOf(blocks).some((d) => /not available|could not be written|came back empty/i.test(d)),
        `${heading} passed judgement on prose that had not resolved`,
      );
    }
    assert.ok(rowsOf(sectionNamed(report, "Compliance Posture Summary").blocks).length > 0);
  });

  it("says which kind of nothing a resolved-but-empty prose section is", () => {
    const report = build(REAL_TENANT(), {
      sections: [
        { key: "lifecycle", heading: "Data Lifecycle & Records Management", html: null, omittedReason: "generation_failed", factCount: 0 },
      ],
    });
    assert.ok(
      detailsOf(sectionNamed(report, "Data Lifecycle & Records Management").blocks).some((d) =>
        /problem on our side, not a finding about your tenant/.test(d),
      ),
    );
  });
});

/* ------------------------------------------------------------------ *
 * Upgrade Opportunities (#451)
 * ------------------------------------------------------------------ */

describe("a licence gap is its own category, never a coverage apology", () => {
  const GATED = (licenseFeature?: string) =>
    withPillar(view(), "compliance", {
      score: 29,
      stats: [
        stat({
          id: "compliance.weakDlp",
          value: null,
          unavailableReason: "license_gap",
          checkKey: "compliance:weak-dlp-policies",
          ...(licenseFeature ? { licenseFeature } : {}),
        }),
      ],
    });

  it("files it under Upgrade Opportunities and not under the gap list", () => {
    const report = build(GATED());
    assert.ok(!namedChecks(sectionNamed(report, "Compliance Posture Summary").blocks).includes("compliance:weak-dlp-policies"));
    const items = sectionNamed(report, UPGRADE_OPPORTUNITY_HEADING).blocks.flatMap((b) =>
      b.kind === "upgradeOpportunity" ? b.items : [],
    );
    assert.deepEqual(items.map((i) => i.checkKey), ["compliance:weak-dlp-policies"]);
  });

  it("refuses to name a Purview SKU when the cause is genuinely ambiguous", () => {
    const items = sectionNamed(build(GATED("Microsoft Purview DLP")), UPGRADE_OPPORTUNITY_HEADING).blocks.flatMap(
      (b) => (b.kind === "upgradeOpportunity" ? b.items : []),
    );
    // monitor-executor stamps a Purview feature name on the PowerShell path,
    // where a licensing gap and a missing role group are indistinguishable from
    // the error text — so neither is asserted.
    assert.ok(/cannot separate a licensing gap/i.test(items[0].disclosure), items[0].disclosure);
    assert.ok(!/^Requires /.test(items[0].disclosure), "must not assert the tier as a requirement");
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
    for (const pick of __testables.SUMMARY_PICKS) {
      assert.match(pick.statId, /^[a-z]+\.[a-zA-Z]+$/, `${pick.statId} is not a stat id`);
      assert.ok(pick.statId.startsWith(`${pick.pillar}.`));
      assert.ok((PILLAR_KEYS as readonly string[]).includes(pick.pillar));
    }
  });

  it("picks only from the compliance card — this is that pillar's own report", () => {
    for (const pick of __testables.SUMMARY_PICKS) assert.equal(pick.pillar, "compliance");
  });

  it("picks all three of the card's real stats, none twice", () => {
    const ids = __testables.SUMMARY_PICKS.map((p) => p.statId);
    assert.equal(new Set(ids).size, 3);
  });
});
