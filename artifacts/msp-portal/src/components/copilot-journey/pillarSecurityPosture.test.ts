/**
 * pillarSecurityPosture.test.ts — the real Security Posture & Blast Radius
 * report's pure builder (#343).
 *
 * Same discipline as `copilotReadinessReport.test.ts`, for the same reason:
 * anyone can assert that a populated tenant produces a populated report; what
 * this file exists to pin is that a THIN tenant produces a SHORTER report rather
 * than a fabricated one — no invented numbers, no zeroes standing in for absent
 * data, no template prose filling an empty section, and the difference between
 * "the check never ran" and "it ran and found nothing" surviving to the page.
 *
 * Two things here are specific to this report and are the reason it exists:
 *   • The Blast Radius section must reuse the Copilot Readiness Report's own
 *     `blastRadiusRows`, not re-pick the same stats. Asserted by comparing the
 *     two reports' rows for one tenant.
 *   • "Conditional Access scoped to privileged roles" has no check behind it and
 *     must read as an honest gap — never as a value, never as a finding, and
 *     never by naming a check key that does not answer the question (#441).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CA_PRIVILEGED_ROLES_GAP,
  buildSecurityPostureReport,
  buildVerdict,
  findingRows,
  findingsBlocks,
  __testables,
  type SecurityPostureBlock,
  type WireSecurityPosturePayload,
} from "./pillarSecurityPosture.ts";
import { blastRadiusRows } from "./copilotReadinessReport.ts";
import { UPGRADE_OPPORTUNITY_HEADING } from "./liveReportBlocks.ts";
import { COPILOT_GATE_TARGET, PILLARS, PILLAR_KEYS, type PillarKey } from "./journeyTokens.ts";
import type {
  JourneyPillarView,
  JourneyView,
  WirePillarFinding,
  WirePillarStat,
} from "./journeyModel.ts";

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
    findings: [],
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

function withPillar(v: JourneyView, key: PillarKey, overrides: Partial<JourneyPillarView>): JourneyView {
  return { ...v, pillars: v.pillars.map((p) => (p.key === key ? { ...p, ...overrides } : p)) };
}

function build(
  v: JourneyView,
  narrative: WireSecurityPosturePayload | null = null,
  settled = true,
) {
  return buildSecurityPostureReport({
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

function rowsOf(blocks: readonly SecurityPostureBlock[]): { label: string; value: string }[] {
  return blocks.flatMap((b) => (b.kind === "keyValues" ? b.rows.map((r) => ({ label: r.label, value: r.value })) : []));
}

function detailsOf(blocks: readonly SecurityPostureBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === "unavailable" ? [b.detail] : []));
}

function namedChecks(blocks: readonly SecurityPostureBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === "unavailable" ? b.checks.map((c) => c.checkKey) : []));
}

const REAL_TENANT = () => {
  let v = view();
  v = withPillar(v, "security", {
    score: 38,
    headline: "4 Global Administrator accounts have no MFA registered",
    stats: [
      stat({ id: "security.globalAdmins", label: "global administrators", value: 11, checkKey: "identity:global-admin-count" }),
      stat({ id: "security.mfaRegistered", label: "MFA-registered users", value: 1226, checkKey: "identity:mfa-registration" }),
      stat({ id: "security.legacyAuth", label: "legacy auth sign-ins", value: 1106, checkKey: "identity:legacy-auth-usage" }),
      stat({ id: "security.blastRadius", label: "items in blast radius", value: 214806, checkKey: "copilot:overshare-exposure" }),
    ],
    findings: [
      { severity: "critical", checkKey: "identity:mfa-registration", title: "14 accounts complete sign-in without a second factor" },
      { severity: "warning", checkKey: "identity:legacy-auth-usage", title: "Legacy authentication remains enabled tenant-wide" },
    ],
  });
  v = withPillar(v, "health", {
    score: 57,
    stats: [
      stat({ id: "health.nonCompliantDevices", label: "non-compliant devices", value: 88, checkKey: "intune:non-compliant-devices" }),
      stat({ id: "health.unencrypted", label: "unencrypted devices", value: 61, checkKey: "intune:unencrypted-devices" }),
      stat({ id: "health.outdated", label: "outdated OS devices", value: 34, checkKey: "intune:outdated-devices" }),
      stat({ id: "health.configDrift", label: "device config drift", value: 12, checkKey: "intune:config-drift" }),
    ],
    findings: [
      { severity: "warning", checkKey: "intune:non-compliant-devices", title: "88 non-compliant devices still reach cloud workloads" },
    ],
  });
  v = withPillar(v, "governance", {
    score: 46,
    stats: [
      stat({ id: "governance.overshared", label: "overshared sites", value: 212, checkKey: "compliance:overshared-sites" }),
      stat({ id: "governance.sites", label: "sites inventoried", value: 1847, checkKey: "compliance:sharepoint-sites" }),
    ],
  });
  return v;
};

/* ------------------------------------------------------------------ *
 * Structure — what the design asked for, minus what has no producer
 * ------------------------------------------------------------------ */

describe("the approved structure", () => {
  it("renders the design's sections in order, without Security Drift & Violations", () => {
    assert.deepEqual(
      build(view()).sections.map((s) => s.heading),
      [
        "Security Posture Summary",
        "Identity & Access Risks",
        "Data Exposure & Blast Radius",
        "Device & Endpoint Compliance",
        "Copilot Readiness Impact",
      ],
    );
  });

  it("never emits a drift section or a drift row, whatever the tenant carries", () => {
    const report = build(REAL_TENANT());
    const headings = report.sections.map((s) => s.heading).join(" ");
    assert.ok(!/drift/i.test(headings), "no drift SECTION");
    // The Summary's "Security drift" row is dropped too — there is no baseline
    // to diff against on a first scan, so any figure would be invented.
    const summaryRows = rowsOf(sectionNamed(report, "Security Posture Summary").blocks);
    assert.ok(!summaryRows.some((r) => /drift/i.test(r.label)));
  });

  it("carries no Self-Resolution Actions section — remediation is the guide's job", () => {
    const headings = build(REAL_TENANT()).sections.map((s) => s.heading).join(" ");
    assert.ok(!/self-resolution/i.test(headings));
  });

  it("names no site, policy, department or date from the design's worked example", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    for (const halden of ["Halden", "CA01", "14 June", "Finance", "Safe Links", "2,940", "1,240"]) {
      assert.ok(!serialised.includes(halden), `leaked the design fixture's "${halden}"`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The honest gap — #441's rule, applied to a row with no check at all
 * ------------------------------------------------------------------ */

describe("Conditional Access scoped to privileged roles is an honest gap", () => {
  it("is declared for EVERY tenant, rich or empty — it is about our coverage, not their scan", () => {
    for (const v of [view(), REAL_TENANT()]) {
      const details = detailsOf(sectionNamed(build(v), "Security Posture Summary").blocks);
      assert.ok(details.includes(CA_PRIVILEGED_ROLES_GAP), "the gap must not vary by tenant");
    }
  });

  it("states no value, no count and no verdict about whether such a policy exists", () => {
    assert.ok(!/\d/.test(CA_PRIVILEGED_ROLES_GAP), "a gap with no producer cannot carry a number");
    assert.ok(
      /does or does not exist|nothing here should be read/i.test(CA_PRIVILEGED_ROLES_GAP),
      "must explicitly refuse the verdict in both directions",
    );
    assert.ok(
      /gap in what this platform measures/i.test(CA_PRIVILEGED_ROLES_GAP),
      "must attribute the gap to our coverage, not to the tenant",
    );
  });

  it("names no check key — #441's rule that OUR wiring never reaches the reader", () => {
    // `identity:ca-policy-count` is a real check with no registry metric, which
    // is exactly the string #441 found printed to a paying customer under a
    // heading about gaps in THEIR assessment.
    for (const key of ["identity:ca-policy-count", "security:conditional-access-failures", "drift:ca-policy"]) {
      assert.ok(!CA_PRIVILEGED_ROLES_GAP.includes(key), `leaked the check key ${key}`);
    }
    const report = build(REAL_TENANT());
    assert.ok(!JSON.stringify(report).includes("identity:ca-policy-count"));
  });

  it("is a quiet note, not a finding — it never enters a findings or keyValues block", () => {
    const blocks = sectionNamed(build(REAL_TENANT()), "Security Posture Summary").blocks;
    const gapBlock = blocks.find((b) => b.kind === "unavailable" && b.detail === CA_PRIVILEGED_ROLES_GAP);
    assert.ok(gapBlock, "must be an unavailable block");
    assert.equal(gapBlock.kind === "unavailable" && gapBlock.checks.length, 0, "and must name no check");
  });
});

/* ------------------------------------------------------------------ *
 * Reuse — the blast radius is the SAME resolution, not a second one
 * ------------------------------------------------------------------ */

describe("the Blast Radius section reuses the existing stat resolution", () => {
  it("produces byte-identical rows to the Copilot Readiness Report's own", () => {
    const v = REAL_TENANT();
    const shared = blastRadiusRows(v.pillars);
    const section = sectionNamed(build(v), "Data Exposure & Blast Radius");
    assert.deepEqual(
      rowsOf(section.blocks),
      shared.rows.map((r) => ({ label: r.label, value: r.value })),
      "two reports must never quote different blast radii for one tenant",
    );
    assert.ok(shared.rows.length > 0, "the fixture must actually exercise the path");
  });

  it("carries the real over-exposure count verbatim, not a re-derived one", () => {
    const rows = rowsOf(sectionNamed(build(REAL_TENANT()), "Data Exposure & Blast Radius").blocks);
    const blast = rows.find((r) => r.label === "Copilot blast radius");
    assert.ok(blast);
    assert.ok(blast.value.startsWith("214,806 "));
  });

  it("names the missing checks rather than showing a zero radius", () => {
    const section = sectionNamed(build(view()), "Data Exposure & Blast Radius");
    assert.equal(rowsOf(section.blocks).length, 0, "no stat, no row — never a 0");
    // An empty tenant's stats carry no checkKey either, so there is nothing to
    // name; the section is simply short. What must never happen is a row.
    assert.ok(!JSON.stringify(section).includes('"0"'));
  });
});

/* ------------------------------------------------------------------ *
 * Secure Score — the one figure that rides the narrative route
 * ------------------------------------------------------------------ */

describe("Microsoft Secure Score", () => {
  const withSecureScore = (value: number | null, extra: Partial<WirePillarStat> = {}) => ({
    sections: [],
    stats: [
      {
        id: "security.secureScore",
        label: "Microsoft Secure Score",
        unit: "percent" as const,
        value,
        checkKey: "security:secure-score",
        ...extra,
      },
    ],
  });

  it("leads the Summary as a real percentage when the tenant carries one", () => {
    const rows = rowsOf(
      sectionNamed(build(REAL_TENANT(), withSecureScore(38)), "Security Posture Summary").blocks,
    );
    assert.equal(rows[0].label, "Security maturity");
    assert.equal(rows[0].value, "38% Microsoft Secure Score");
  });

  it("is simply absent before the narrative route lands — never a placeholder", () => {
    const rows = rowsOf(sectionNamed(build(REAL_TENANT()), "Security Posture Summary").blocks);
    assert.ok(!rows.some((r) => r.label === "Security maturity"));
    // The four rows that come off the pillar payload are unaffected: the
    // pure-data half must not wait on an AI route.
    assert.equal(rows.length, 4);
  });

  it("becomes a named gap, not a zero, when the check reported nothing", () => {
    const blocks = sectionNamed(
      build(REAL_TENANT(), withSecureScore(null, { unavailableReason: "not_in_scan_package" })),
      "Security Posture Summary",
    ).blocks;
    assert.ok(!rowsOf(blocks).some((r) => r.label === "Security maturity"));
    assert.ok(namedChecks(blocks).includes("security:secure-score"));
  });

  it("goes to Upgrade Opportunities, never to the gap list, on a licence gap (#451)", () => {
    const report = build(
      REAL_TENANT(),
      withSecureScore(null, { unavailableReason: "license_gap", licenseFeature: "Microsoft Defender for Office 365 P2" }),
    );
    const summary = sectionNamed(report, "Security Posture Summary");
    assert.ok(!namedChecks(summary.blocks).includes("security:secure-score"), "not filed as a coverage gap");
    const upgrade = sectionNamed(report, UPGRADE_OPPORTUNITY_HEADING);
    const items = upgrade.blocks.flatMap((b) => (b.kind === "upgradeOpportunity" ? b.items : []));
    assert.deepEqual(items.map((i) => i.checkKey), ["security:secure-score"]);
    assert.ok(items[0].disclosure.includes("Microsoft Defender for Office 365 P2"));
    assert.ok(items[0].disclosure.includes("unmeasured in this report, not confirmed sound"));
  });

  it("never reaches the reader when the failure is OUR wiring (#441)", () => {
    const report = build(
      REAL_TENANT(),
      withSecureScore(null, { unavailableReason: "unknown_metric_key" }),
    );
    assert.ok(!JSON.stringify(report).includes("security:secure-score"));
  });
});

/* ------------------------------------------------------------------ *
 * Findings — real rows, and the #399 clean/unevaluated distinction
 * ------------------------------------------------------------------ */

describe("findings sections", () => {
  const FINDINGS: readonly WirePillarFinding[] = [
    { severity: "critical", checkKey: "identity:mfa-registration", title: "14 accounts have no MFA" },
    { severity: "warning", checkKey: "identity:legacy-auth-usage", title: "Legacy auth is enabled" },
  ];

  it("carries each finding's own title verbatim and adds no second claim", () => {
    const rows = findingRows(FINDINGS);
    assert.deepEqual(rows.map((r) => r.lead), FINDINGS.map((f) => f.title));
    // `rest` is provenance only — never an elaboration the platform does not hold.
    assert.deepEqual(rows.map((r) => r.rest), [
      "Recorded by identity:mfa-registration on this tenant's last scan.",
      "Recorded by identity:legacy-auth-usage on this tenant's last scan.",
    ]);
  });

  it("maps the wire's warning onto the attention band without re-grading anything", () => {
    assert.deepEqual(findingRows(FINDINGS).map((r) => r.severity), ["critical", "attention"]);
  });

  it("tells 'evaluated clean' apart from 'never evaluated' (#399)", () => {
    const clean = findingsBlocks(pillar("security", { score: 71 }), "CLEAN", "UNEVALUATED");
    assert.deepEqual(clean, [{ kind: "prose", text: "CLEAN" }]);

    const unevaluated = findingsBlocks(pillar("security"), "CLEAN", "UNEVALUATED");
    assert.equal(unevaluated[0].kind, "unavailable");
    assert.equal(unevaluated[0].kind === "unavailable" && unevaluated[0].detail, "UNEVALUATED");
  });

  it("renders the security pillar's real findings under Identity & Access Risks", () => {
    const section = sectionNamed(build(REAL_TENANT()), "Identity & Access Risks");
    const leads = section.blocks.flatMap((b) => (b.kind === "findings" ? b.rows.map((r) => r.lead) : []));
    assert.deepEqual(leads, [
      "14 accounts complete sign-in without a second factor",
      "Legacy authentication remains enabled tenant-wide",
    ]);
  });

  it("renders the health pillar's real findings under Device & Endpoint Compliance", () => {
    const section = sectionNamed(build(REAL_TENANT()), "Device & Endpoint Compliance");
    const leads = section.blocks.flatMap((b) => (b.kind === "findings" ? b.rows.map((r) => r.lead) : []));
    assert.deepEqual(leads, ["88 non-compliant devices still reach cloud workloads"]);
  });
});

/* ------------------------------------------------------------------ *
 * The never-fabricate guarantee on a thin tenant
 * ------------------------------------------------------------------ */

describe("never fabricate: an empty tenant produces a shorter report, not an invented one", () => {
  it("renders no keyValues row anywhere when no stat and no score is real", () => {
    // `readinessScore: null` too — the Gate row is the one row in this report
    // that does not come from a stat, and it is just as real, so it has to be
    // taken away for "nothing measured" to actually mean nothing measured.
    const report = build(view({ readinessScore: null }));
    for (const section of report.sections) {
      assert.equal(rowsOf(section.blocks).length, 0, `${section.heading} invented a row`);
    }
  });

  it("asserts no verdict for a pillar nothing scored", () => {
    const verdict = buildVerdict(undefined);
    assert.equal(verdict.headline, "No security score yet");
    assert.ok(!/\d/.test(verdict.headline));
    assert.ok(/has not yet evaluated/.test(verdict.sub));
  });

  it("leads with the pillar's own real finding when there is one", () => {
    const security = REAL_TENANT().pillars.find((p) => p.key === "security");
    const verdict = buildVerdict(security);
    assert.equal(verdict.eyebrow, "Worst finding");
    assert.equal(verdict.headline, "4 Global Administrator accounts have no MFA registered");
    assert.ok(verdict.sub.includes("38 of 100"));
  });

  it("never writes the design's consequence sentence", () => {
    const security = REAL_TENANT().pillars.find((p) => p.key === "security");
    assert.ok(!/phished|conversationally|mailbox by mailbox/i.test(JSON.stringify(buildVerdict(security))));
  });

  it("omits the closing score sentence entirely when there is no score", () => {
    assert.equal(build(view()).closing.length, 1);
    assert.equal(build(REAL_TENANT()).closing.length, 2);
  });

  it("shows the Gate row only when the platform actually has a readiness score", () => {
    assert.deepEqual(__testables.gateRow(view({ readinessScore: null })), []);
    const [row] = __testables.gateRow(view({ readinessScore: 41 }));
    assert.equal(row.value, `41 against a Gate of ${COPILOT_GATE_TARGET} — ${COPILOT_GATE_TARGET - 41} points short`);
    const [cleared] = __testables.gateRow(view({ readinessScore: COPILOT_GATE_TARGET }));
    assert.ok(cleared.value.endsWith("cleared"));
  });

  it("claims nothing about a prose section that is still in flight", () => {
    // Unsettled means neither prose nor an "unavailable" verdict on it: saying
    // a section is empty before its fetch has resolved would be a claim the
    // client cannot yet make. The pure-data rows around it still render — they
    // never wait on an AI route.
    const report = build(REAL_TENANT(), null, false);
    for (const heading of ["Security Posture Summary", "Data Exposure & Blast Radius", "Copilot Readiness Impact"]) {
      const blocks = sectionNamed(report, heading).blocks;
      assert.equal(blocks.filter((b) => b.kind === "narrative").length, 0);
      assert.ok(
        !detailsOf(blocks).some((d) => /not available|could not be written|came back empty/i.test(d)),
        `${heading} passed judgement on prose that had not resolved`,
      );
    }
    assert.ok(rowsOf(sectionNamed(report, "Data Exposure & Blast Radius").blocks).length > 0);
  });

  it("shows a pending state for a section that is prose-only until it settles", () => {
    // The Copilot Readiness Impact section on a tenant with no Gate score is
    // exactly that case: nothing but prose, so an unsettled fetch leaves it
    // genuinely empty and the shell draws its spinner.
    const report = build(view({ readinessScore: null }), null, false);
    assert.equal(sectionNamed(report, "Copilot Readiness Impact").blocks.length, 0);
  });

  it("says which kind of nothing a resolved-but-empty prose section is", () => {
    const report = build(REAL_TENANT(), {
      sections: [
        { key: "summary", heading: "Security Posture Summary", html: null, omittedReason: "no_real_data", factCount: 0 },
      ],
    });
    const details = detailsOf(sectionNamed(report, "Security Posture Summary").blocks);
    assert.ok(details.some((d) => /nothing real to reason from/.test(d)));
  });
});

/* ------------------------------------------------------------------ *
 * The picks are a contract with war-room-pillar-stats.ts
 * ------------------------------------------------------------------ */

describe("every pick names a real stat id", () => {
  it("uses stat ids in the `<pillar>.<name>` shape the payload actually emits", () => {
    const picks = [...__testables.SUMMARY_PICKS, ...__testables.DEVICE_PICKS, ...__testables.COPILOT_IMPACT_PICKS];
    for (const pick of picks) {
      assert.match(pick.statId, /^[a-z]+\.[a-zA-Z]+$/, `${pick.statId} is not a stat id`);
      assert.ok(pick.statId.startsWith(`${pick.pillar}.`), `${pick.statId} is not on the ${pick.pillar} card`);
    }
  });

  it("never repeats the headline device figure in two sections", () => {
    const summary = __testables.SUMMARY_PICKS.map((p) => p.statId);
    const devices = __testables.DEVICE_PICKS.map((p) => p.statId);
    assert.equal(summary.filter((s) => devices.includes(s)).length, 0);
  });

  it("picks no copilot-card stat — this journey's view carries none", () => {
    const all = [...__testables.SUMMARY_PICKS, ...__testables.DEVICE_PICKS, ...__testables.COPILOT_IMPACT_PICKS];
    assert.ok(all.every((p) => (PILLAR_KEYS as readonly string[]).includes(p.pillar)));
  });
});
