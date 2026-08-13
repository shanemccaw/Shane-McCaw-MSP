/**
 * pillarOperationalHealth.test.ts — the real Operational Health & Service
 * Integrity Report's pure builder (#292).
 *
 * Same discipline as `pillarSecurityPosture.test.ts`: what this file pins is
 * that a THIN tenant produces a SHORTER report rather than a fabricated one.
 *
 * The thing this suite exists for above all else is the SERVICE AVAILABILITY
 * question #292 left open. It was checked and the answer is no —
 * `m365:service-health` is read live for Shane's own tenant by the public status
 * page and aggregated for nobody, `m365:message-center` is a change-announcement
 * feed, and `serviceHealth.uptimeStatus`'s sourceKey
 * (`not_collected:service-health-overview`) names nothing. So the report must
 * carry no uptime figure, no per-workload status and no incident, and must say
 * so rather than going quiet. Every one of those is asserted below, because the
 * temptation lives in the report's own title rather than in its data.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SERVICE_AVAILABILITY_GAP,
  buildOperationalHealthReport,
  buildVerdict,
  __testables,
  type OperationalHealthBlock,
  type WireOperationalHealthPayload,
} from "./pillarOperationalHealth.ts";
import { UPGRADE_OPPORTUNITY_HEADING } from "./liveReportBlocks.ts";
import { COPILOT_GATE_TARGET, PILLAR_KEYS } from "./journeyTokens.ts";
import {
  FIXTURE_LEAKS,
  REAL_HEALTH_STATS,
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
  narrative: WireOperationalHealthPayload | null = null,
  settled = true,
) {
  return buildOperationalHealthReport({
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

function rowsOf(blocks: readonly OperationalHealthBlock[]): { label: string; value: string }[] {
  return blocks.flatMap((b) =>
    b.kind === "keyValues" ? b.rows.map((r) => ({ label: r.label, value: r.value })) : [],
  );
}

function detailsOf(blocks: readonly OperationalHealthBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === "unavailable" ? [b.detail] : []));
}

function namedChecks(blocks: readonly OperationalHealthBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === "unavailable" ? b.checks.map((c) => c.checkKey) : []));
}

const REAL_TENANT = () =>
  withPillar(view(), "health", {
    score: 44,
    headline: "312 enrolled devices fail the compliance baseline",
    stats: REAL_HEALTH_STATS,
    findings: [
      { severity: "critical", checkKey: "intune:non-compliant-devices", title: "312 enrolled devices fail the compliance baseline" },
      { severity: "warning", checkKey: "intune:config-drift", title: "12 devices have drifted from their assigned configuration profile" },
    ],
  });

/* ------------------------------------------------------------------ *
 * The question #292 left open, answered
 * ------------------------------------------------------------------ */

describe("service availability is honestly absent, not approximated", () => {
  it("has no Service Availability & Reliability section", () => {
    assert.ok(!/service availability/i.test(build(REAL_TENANT()).sections.map((s) => s.heading).join(" ")));
  });

  it("states no uptime, no per-workload status and no incident, whatever the tenant carries", () => {
    const report = build(REAL_TENANT());
    // The two places allowed to USE these words are the ones whose whole job is
    // to say they are not measured: the gap declaration and the standfirst that
    // points at it. Everywhere else, mentioning one would be asserting one.
    const withoutDisclaimers = JSON.stringify(report)
      .replace(JSON.stringify(SERVICE_AVAILABILITY_GAP).slice(1, -1), "")
      .replace(JSON.stringify(report.standfirst).slice(1, -1), "");
    for (const claim of [
      "uptime",
      "99.9",
      "Exchange Online",
      "SharePoint Online",
      "degradation",
      "incident",
      "outage",
      "Healthy ·",
      "Degraded",
    ]) {
      assert.ok(!withoutDisclaimers.includes(claim), `asserted the availability claim "${claim}"`);
    }
  });

  it("declares the gap for EVERY tenant, rich or empty — it is about our coverage", () => {
    for (const v of [view(), REAL_TENANT()]) {
      const details = detailsOf(sectionNamed(build(v), "Health Posture Summary").blocks);
      assert.ok(details.includes(SERVICE_AVAILABILITY_GAP), "the gap must not vary by tenant");
    }
  });

  it("refuses the verdict in BOTH directions — an unmeasured workload is not a working one", () => {
    assert.ok(
      /available or that they were not/i.test(SERVICE_AVAILABILITY_GAP),
      "must refuse to imply the services were up",
    );
    assert.ok(
      /no figure has been estimated in place of looking/i.test(SERVICE_AVAILABILITY_GAP),
      "must say the absence is deliberate, not a rendering failure",
    );
  });

  it("names no check key — #441's rule that OUR wiring never reaches the reader", () => {
    for (const key of ["m365:service-health", "m365:message-center", "not_collected:service-health-overview"]) {
      assert.ok(!SERVICE_AVAILABILITY_GAP.includes(key), `leaked the check key ${key}`);
      assert.ok(!JSON.stringify(build(REAL_TENANT())).includes(key));
    }
  });

  it("is a quiet note, not a finding — it names no check and carries no number", () => {
    const blocks = sectionNamed(build(REAL_TENANT()), "Health Posture Summary").blocks;
    const gap = blocks.find((b) => b.kind === "unavailable" && b.detail === SERVICE_AVAILABILITY_GAP);
    assert.ok(gap, "must be an unavailable block");
    assert.equal(gap.kind === "unavailable" && gap.checks.length, 0);
    // "Microsoft 365" is the product's name and the only digits allowed.
    assert.ok(!/\d/.test(SERVICE_AVAILABILITY_GAP.replace(/Microsoft 365/g, "")));
  });

  it("draws no sparkline, even though a real per-pillar series exists", () => {
    // `pillar-trend.ts` (#356) does produce a real series and it reaches the view
    // — but it is the HEALTH PILLAR SCORE over time, not availability and not
    // drift, so plotting it under either caption would be a fabricated shape.
    const withTrend = withPillar(REAL_TENANT(), "health", {
      trend: { series: [40, 41, 43, 42, 44, 44], window: "90d" },
    });
    assert.ok(!/"figure"/.test(JSON.stringify(build(withTrend))));
  });
});

/* ------------------------------------------------------------------ *
 * Structure
 * ------------------------------------------------------------------ */

describe("the approved structure", () => {
  it("renders the design's surviving sections in order", () => {
    assert.deepEqual(
      build().sections.map((s) => s.heading),
      ["Health Posture Summary", "Configuration & Service Health", "Copilot Readiness Impact"],
    );
  });

  it("never emits a drift section or a drift row, whatever the tenant carries", () => {
    const report = build(REAL_TENANT());
    assert.ok(!/drift/i.test(report.sections.map((s) => s.heading).join(" ")), "no drift SECTION");
    // The row label deliberately reads "Configuration profile alignment", not
    // "drift": the real check counts devices away from their profile now, not
    // changes over a window.
    assert.ok(!rowsOf(sectionNamed(report, "Configuration & Service Health").blocks).some((r) => /drift/i.test(r.label)));
    // And no change-log claim survives anywhere.
    for (const claim of ["37 ", "90 days", "unreviewed", "none triaged", "baseline on record"]) {
      assert.ok(!JSON.stringify(report).includes(claim), `leaked the drift claim "${claim}"`);
    }
  });

  it("carries no Tenant Hygiene section — none of its five figures has a producer", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    assert.ok(!/tenant hygiene/i.test(serialised));
    for (const claim of ["orphaned", "inactive site", "quota", "sync error"]) {
      assert.ok(!new RegExp(claim, "i").test(serialised), `leaked the unbacked claim "${claim}"`);
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
 * The real figures
 * ------------------------------------------------------------------ */

describe("the four real health stats", () => {
  it("puts the estate figures in the Summary and the profile figure in Configuration", () => {
    const report = build(REAL_TENANT());
    assert.deepEqual(
      rowsOf(sectionNamed(report, "Health Posture Summary").blocks).map((r) => r.label),
      ["Device compliance", "Device encryption", "Operating system currency"],
    );
    assert.deepEqual(
      rowsOf(sectionNamed(report, "Configuration & Service Health").blocks).map((r) => r.label),
      ["Configuration profile alignment"],
    );
  });

  it("never states the same figure under two headings", () => {
    const all = [...__testables.SUMMARY_PICKS, ...__testables.CONFIGURATION_PICKS].map((p) => p.statId);
    assert.equal(new Set(all).size, all.length);
  });

  it("carries each real value verbatim", () => {
    const rows = rowsOf(sectionNamed(build(REAL_TENANT()), "Health Posture Summary").blocks);
    assert.ok(rows[0].value.startsWith("312 "));
    assert.ok(rows[2].value.startsWith("34 "));
  });

  it("states no total device count and no percentage of the estate", () => {
    // There is no total-device-inventory check — `WAR_ROOM_UNPRODUCIBLE_STATS`
    // records both "managed endpoints" and "% device compliance" as having none.
    const serialised = JSON.stringify(build(REAL_TENANT()));
    assert.ok(!/%/.test(serialised), "no share of an estate whose size is unknown");
    // The phrase is fine — "your tenant's managed endpoints" is what this report
    // is about. A COUNT of them is the fake stat, and there is no check for it.
    assert.ok(!/[\d,]+\s+managed endpoints/i.test(serialised), "counted an estate nothing measures");
  });

  it("names the missing checks rather than showing a zero", () => {
    const v = withPillar(view(), "health", {
      score: 44,
      stats: [
        stat({ id: "health.unencrypted", value: null, unavailableReason: "not_in_scan_package", checkKey: "intune:unencrypted-devices" }),
        stat({ id: "health.nonCompliantDevices", value: 312, checkKey: "intune:non-compliant-devices" }),
      ],
    });
    const blocks = sectionNamed(build(v), "Health Posture Summary").blocks;
    assert.deepEqual(rowsOf(blocks).map((r) => r.label), ["Device compliance"]);
    assert.ok(namedChecks(blocks).includes("intune:unencrypted-devices"));
  });

  it("never reaches the reader when the failure is OUR wiring (#441)", () => {
    const v = withPillar(view(), "health", {
      score: 44,
      stats: [stat({ id: "health.configDrift", value: null, unavailableReason: "resolver_error", checkKey: "intune:config-drift" })],
    });
    assert.ok(!JSON.stringify(build(v)).includes("intune:config-drift"));
  });
});

/* ------------------------------------------------------------------ *
 * Findings
 * ------------------------------------------------------------------ */

describe("findings", () => {
  it("renders the health pillar's real findings under Configuration & Service Health", () => {
    const rows = sectionNamed(build(REAL_TENANT()), "Configuration & Service Health").blocks.flatMap((b) =>
      b.kind === "findings" ? b.rows : [],
    );
    assert.deepEqual(rows.map((r) => r.lead), [
      "312 enrolled devices fail the compliance baseline",
      "12 devices have drifted from their assigned configuration profile",
    ]);
    assert.deepEqual(rows.map((r) => r.severity), ["critical", "attention"]);
  });

  it("tells 'evaluated clean' apart from 'never evaluated' (#399)", () => {
    const clean = sectionNamed(
      build(withPillar(view(), "health", { score: 88 })),
      "Configuration & Service Health",
    ).blocks;
    assert.ok(clean.some((b) => b.kind === "prose" && /is a real result, not an empty section/.test(b.text)));

    const unevaluated = sectionNamed(build(), "Configuration & Service Health").blocks;
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
    assert.equal(verdict.headline, "No operational health score yet");
    assert.ok(!/\d/.test(verdict.headline));
  });

  it("leads with the pillar's own real finding, never with the design's drift claim", () => {
    const health = REAL_TENANT().pillars.find((p) => p.key === "health");
    const verdict = buildVerdict(health);
    assert.equal(verdict.eyebrow, "Worst finding");
    assert.equal(verdict.headline, "312 enrolled devices fail the compliance baseline");
    assert.ok(verdict.sub.includes("44 of 100"));
    assert.ok(/availability figure/i.test(verdict.sub), "the verdict card must disclaim it too");
  });

  it("falls back to the score, never to an invented finding, for a clean pillar", () => {
    assert.equal(
      buildVerdict(pillar("health", { score: 88 })).headline,
      "Operational health scores 88 of 100",
    );
  });

  it("omits the closing score sentence entirely when there is no score", () => {
    assert.equal(build().closing.length, 1);
    assert.equal(build(REAL_TENANT()).closing.length, 2);
  });

  it("claims no trajectory — the design says remediation 'undoes itself inside two quarters'", () => {
    const serialised = JSON.stringify(build(REAL_TENANT()));
    for (const claim of ["two quarters", "degrading", "will decay", "points of available gain"]) {
      assert.ok(!new RegExp(claim, "i").test(serialised), `leaked the trajectory claim "${claim}"`);
    }
  });

  it("shows the Gate row only when the platform actually has a readiness score", () => {
    assert.equal(rowsOf(sectionNamed(build(view({ readinessScore: null })), "Copilot Readiness Impact").blocks).length, 0);
    const [row] = rowsOf(sectionNamed(build(REAL_TENANT()), "Copilot Readiness Impact").blocks);
    assert.equal(row.value, `41 against a Gate of ${COPILOT_GATE_TARGET} — ${COPILOT_GATE_TARGET - 41} points short`);
  });

  it("claims nothing about a prose section that is still in flight", () => {
    const report = build(REAL_TENANT(), null, false);
    for (const heading of ["Health Posture Summary", "Configuration & Service Health", "Copilot Readiness Impact"]) {
      const blocks = sectionNamed(report, heading).blocks;
      assert.equal(blocks.filter((b) => b.kind === "narrative").length, 0);
      assert.ok(
        !detailsOf(blocks).some((d) =>
          /not available for|could not be written|came back empty|nothing real to reason/i.test(d),
        ),
        `${heading} passed judgement on prose that had not resolved`,
      );
    }
    assert.ok(rowsOf(sectionNamed(report, "Health Posture Summary").blocks).length > 0);
  });

  it("says which kind of nothing a resolved-but-empty prose section is", () => {
    const report = build(REAL_TENANT(), {
      sections: [
        { key: "configuration", heading: "Configuration & Service Health", html: null, omittedReason: "no_real_data", factCount: 0 },
      ],
    });
    assert.ok(
      detailsOf(sectionNamed(report, "Configuration & Service Health").blocks).some((d) =>
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
    withPillar(view(), "health", {
      score: 44,
      stats: [
        stat({
          id: "health.nonCompliantDevices",
          value: null,
          unavailableReason: "license_gap",
          checkKey: "intune:non-compliant-devices",
        }),
      ],
    });

  it("files it under Upgrade Opportunities and not under the gap list", () => {
    const report = build(GATED());
    assert.ok(!namedChecks(sectionNamed(report, "Health Posture Summary").blocks).includes("intune:non-compliant-devices"));
    const items = sectionNamed(report, UPGRADE_OPPORTUNITY_HEADING).blocks.flatMap((b) =>
      b.kind === "upgradeOpportunity" ? b.items : [],
    );
    assert.deepEqual(items.map((i) => i.checkKey), ["intune:non-compliant-devices"]);
    assert.ok(/unmeasured in this report, not confirmed/.test(items[0].disclosure));
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
    for (const pick of [...__testables.SUMMARY_PICKS, ...__testables.CONFIGURATION_PICKS]) {
      assert.match(pick.statId, /^[a-z]+\.[a-zA-Z]+$/, `${pick.statId} is not a stat id`);
      assert.ok(pick.statId.startsWith(`${pick.pillar}.`));
      assert.ok((PILLAR_KEYS as readonly string[]).includes(pick.pillar));
    }
  });

  it("picks only from the health card — this is that pillar's own report", () => {
    for (const pick of [...__testables.SUMMARY_PICKS, ...__testables.CONFIGURATION_PICKS]) {
      assert.equal(pick.pillar, "health");
    }
  });

  it("picks all four of the card's real stats, none twice", () => {
    const ids = [...__testables.SUMMARY_PICKS, ...__testables.CONFIGURATION_PICKS].map((p) => p.statId);
    assert.equal(new Set(ids).size, 4);
  });
});
