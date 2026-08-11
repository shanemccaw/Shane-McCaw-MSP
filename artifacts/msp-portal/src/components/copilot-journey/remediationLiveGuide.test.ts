/**
 * remediationLiveGuide.test.ts — the Full Remediation Guide's live content
 * (#472, document 8 of 9).
 *
 * Same discipline as `sowLiveContract.test.ts`. Four things matter here, and
 * they are the four ways this document could lie to a paying customer:
 *
 *   1. Every one of the thirty steps is accounted for — mapped to a real check,
 *      declared a platform-wide gap, or declared process-only. A step that falls
 *      through all three would render with no evidence at all and read as
 *      unremarkable, which is precisely how #441 reached a customer.
 *   2. No fixture value survives into a live render. A thin tenant (no findings,
 *      no stats, no seats, no score) must get honest absences, never Halden
 *      Materials' 208 sites or 11 admins.
 *   3. An empty findings join never reads as a pass. The wire caps findings at
 *      the three worst per pillar, so absence is uninformative and must say so.
 *   4. `?preview=design` is provably unchanged: every resolver's preview branch
 *      reproduces the design's own text verbatim.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LIVE_PRELUDE,
  LIVE_STEP_SCRIPTS,
  PROCESS_ONLY_STEP_IDS,
  STEP_CHECK_GAPS,
  STEP_CHECK_KEYS,
  STEP_FILL_INS,
  UNCONFIRMED_EVIDENCE_DETAIL,
  buildLiveRemediationSteps,
  criticalsByPillar,
  liveBlastRadius,
  liveCaution,
  liveTitle,
  liveVerify,
  resolveBlockers,
  resolveChecklistNote,
  resolveChecklistRows,
  resolveClosing,
  resolveExpectedImprovement,
  resolveHandoffBlurb,
  resolveScopeHeadline,
  resolveStandfirst,
  resolveTotalFindings,
  statValue,
  stepEvidence,
  totalFindings,
} from "./remediationLiveGuide.ts";
import {
  REMEDIATION_GUIDE,
  REMEDIATION_PRELUDE,
  REMEDIATION_SCRIPTED_COUNT,
  REMEDIATION_STEPS,
} from "./previewRemediationGuide.ts";
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

function finding(overrides: Partial<WirePillarFinding> & { title: string }): WirePillarFinding {
  return { severity: "critical", checkKey: "check:x", ...overrides };
}

function stat(id: string, value: number | null, checkKey = "check:x"): WirePillarStat {
  return { id, label: id, unit: "count", value, checkKey };
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
    tenant: { name: "Contoso", seatCount: null, scannedOn: null },
    readinessScore: null,
    remediatedScore: null,
    pillars: PILLAR_KEYS.map((k) => pillar(k)),
    generation: { ready: 0, total: 0, allReady: false, documents: [] },
    isPreview: false,
    ...overrides,
  };
}

/** The thinnest possible real tenant: scanned, nothing measured, nothing found. */
const THIN = view();

/** Every string a live render can put on screen, flattened. */
function liveText(v: JourneyView): string {
  const steps = buildLiveRemediationSteps(v);
  const parts: string[] = [];
  for (const s of steps) {
    parts.push(
      s.title,
      s.where ?? "",
      s.caution ?? "",
      s.verify ?? "",
      s.code?.script ?? "",
      s.fillIn ?? "",
      s.blastRadius.goesRight,
      s.blastRadius.goesWrong,
      s.blastRadius.tradeOff,
    );
    if (s.evidence.kind === "gap") parts.push(s.evidence.detail);
  }
  parts.push(
    resolveStandfirst(false, steps.length, steps.filter((s) => s.code).length),
    resolveScopeHeadline(false, steps.length, v.pillars),
    resolveTotalFindings(false, v.pillars),
    resolveBlockers(false, v.pillars),
    resolveExpectedImprovement(false, v.readinessScore),
    resolveChecklistNote(false, v),
    resolveHandoffBlurb(false, steps.length),
    ...resolveChecklistRows(false, v),
    ...resolveClosing(false, steps.length, steps.filter((s) => s.code).length),
    LIVE_PRELUDE.code.script,
    LIVE_PRELUDE.footnote,
  );
  return parts.join("\n");
}

/* ------------------------------------------------------------------ *
 * 1 · Every step is accounted for
 * ------------------------------------------------------------------ */

describe("step coverage", () => {
  it("classifies all thirty steps exactly once", () => {
    assert.equal(REMEDIATION_STEPS.length, 30);
    for (const step of REMEDIATION_STEPS) {
      const mapped = step.id in STEP_CHECK_KEYS;
      const gap = step.id in STEP_CHECK_GAPS;
      const process = PROCESS_ONLY_STEP_IDS.includes(step.id);
      const classes = [mapped, gap, process].filter(Boolean).length;
      assert.equal(classes, 1, `${step.id} is classified ${classes} times, expected exactly 1`);
    }
  });

  it("maps exactly #472's confirmed steps, 2 gaps and 4 process steps", () => {
    // TWENTY-FOUR, not the 23 #472's closing summary states. Its own final table
    // lists steps 1–17, 19–23, 26 and 29 — that is 24 rows, and 24 + 2 gaps + 4
    // process steps is exactly the 30 the guide holds. The "23" is an arithmetic
    // slip in the issue's prose; the table it summarises is the mapping, and this
    // assertion is what stops the slip being copied into the code.
    assert.equal(Object.keys(STEP_CHECK_KEYS).length, 24);
    assert.equal(
      Object.keys(STEP_CHECK_KEYS).length + Object.keys(STEP_CHECK_GAPS).length + PROCESS_ONLY_STEP_IDS.length,
      REMEDIATION_STEPS.length,
    );
    assert.deepEqual(Object.keys(STEP_CHECK_GAPS).sort(), ["s18", "s28"]);
    assert.deepEqual([...PROCESS_ONLY_STEP_IDS].sort(), ["s24", "s25", "s27", "s30"]);
  });

  it("names only real check keys, in <domain>:<name> shape", () => {
    // The catalog is DB-resident so the repo cannot confirm membership — this
    // pins the shape and the one domain a live audit has confirmed is phantom
    // (#441's `usage:`), which is the same bar `classifySourceKey` sets.
    for (const [stepId, keys] of Object.entries(STEP_CHECK_KEYS)) {
      assert.ok(keys.length > 0, `${stepId} maps to no key`);
      for (const key of keys) {
        assert.match(key, /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/, `${stepId} → "${key}" is not a check-key shape`);
        assert.ok(!key.startsWith("usage:"), `${stepId} → "${key}" is in the phantom usage: domain (#441)`);
        assert.ok(!key.startsWith("not_collected:"), `${stepId} → "${key}" is a sentinel, not a check`);
      }
    }
  });

  it("every fill-in and live script belongs to a mapped step", () => {
    for (const id of Object.keys(STEP_FILL_INS)) {
      assert.ok(id in STEP_CHECK_KEYS, `${id} has a fill-in but no check mapping`);
    }
    for (const id of Object.keys(LIVE_STEP_SCRIPTS)) {
      assert.ok(id in STEP_CHECK_KEYS, `${id} has a live script but no check mapping`);
    }
  });

  it("the seven parameterised steps are exactly #472's list", () => {
    // Six get a rewritten script; Step 11's placeholder was already in the
    // design, so it gets a fill-in and no script change.
    assert.deepEqual(Object.keys(STEP_FILL_INS).sort(), ["s1", "s11", "s12", "s14", "s22", "s5", "s9"].sort());
    assert.deepEqual(Object.keys(LIVE_STEP_SCRIPTS).sort(), ["s1", "s12", "s14", "s22", "s5", "s9"].sort());
  });
});

/* ------------------------------------------------------------------ *
 * 2 · Structure is preserved — no renumbering, no dropping
 * ------------------------------------------------------------------ */

describe("buildLiveRemediationSteps", () => {
  it("preserves id, label, pillar and order one-to-one", () => {
    const live = buildLiveRemediationSteps(THIN);
    assert.equal(live.length, REMEDIATION_STEPS.length);
    live.forEach((s, i) => {
      assert.equal(s.id, REMEDIATION_STEPS[i].id);
      assert.equal(s.label, REMEDIATION_STEPS[i].label);
      assert.equal(s.pillar, REMEDIATION_STEPS[i].pillar);
      assert.equal(s.meta, REMEDIATION_STEPS[i].meta);
    });
  });

  it("keeps Steps 18 and 28 in place, with their scripts intact", () => {
    const live = buildLiveRemediationSteps(THIN);
    const s18 = live.find((s) => s.id === "s18");
    const s28 = live.find((s) => s.id === "s28");
    assert.ok(s18 && s28);
    assert.equal(s18.label, "Step 18");
    assert.equal(s28.label, "Step 28");
    assert.ok(s18.code?.script.includes("New-UnifiedAuditLogRetentionPolicy"));
    assert.ok(s28.code?.script.includes("Get-MgReportOneDriveUsageAccountDetail"));
    assert.equal(s18.evidence.kind, "gap");
    assert.equal(s28.evidence.kind, "gap");
  });

  it("keeps the scripted count derivable and equal to the preview's", () => {
    const live = buildLiveRemediationSteps(THIN);
    assert.equal(live.filter((s) => s.code !== undefined).length, REMEDIATION_SCRIPTED_COUNT);
  });
});

/* ------------------------------------------------------------------ *
 * 3 · No fixture value survives a live render
 * ------------------------------------------------------------------ */

describe("no Halden Materials data reaches a live tenant", () => {
  const FIXTURE_MARKERS = [
    "haldenmaterials",
    "Halden",
    "CompRev2026",
    "RedundancyPlanning",
    "BoardPackQ2",
    "PayrollRecon",
    "AllStaff@",
    "m365-governance@halden",
    "Finance - Safe Links",
    "LIC-E5-Finance",
    "Finance Analyst",
    "Legal Counsel",
    "Executive Assistant",
    "14 June",
  ];

  it("on a thin tenant", () => {
    const text = liveText(THIN);
    for (const marker of FIXTURE_MARKERS) {
      assert.ok(!text.includes(marker), `live render still contains fixture marker "${marker}"`);
    }
  });

  it("and no fixture COUNT survives either", () => {
    const text = liveText(THIN);
    // Halden's own numbers, each of which appeared verbatim in the design's
    // titles, cautions or verify lines.
    for (const n of ["208", "2,940", "2940", "1,106", "1,240", "148", "214", "412", "1,847", "212"]) {
      assert.ok(!text.includes(n), `live render still quotes the fixture figure "${n}"`);
    }
  });

  it("substitutes the tenant's own numbers when the scan measured them", () => {
    const v = view({
      tenant: { name: "Contoso", seatCount: 640, scannedOn: "3 August 2026" },
      pillars: PILLAR_KEYS.map((k) =>
        k === "security"
          ? pillar(k, { score: 44, stats: [stat("security.globalAdmins", 9), stat("security.legacyAuth", 305)] })
          : k === "health"
            ? pillar(k, {
                score: 60,
                stats: [
                  stat("health.nonCompliantDevices", 31),
                  stat("health.unencrypted", 12),
                  stat("health.outdated", 20),
                ],
              })
            : pillar(k),
      ),
    });
    assert.equal(liveTitle("s11", v), "Reduce 9 standing Global Admins to 2 break-glass accounts");
    assert.equal(liveTitle("s7", v), "Audit and fix MFA on your 9 Global Administrator accounts");
    assert.equal(liveVerify("s11", v), "PIM → Global Administrator shows 2 permanent and 7 eligible.");
    assert.ok(liveTitle("s15", v)?.includes("640 people"));
    assert.ok(liveCaution("s10", v)?.startsWith("305 legacy sign-ins were recorded"));
    const s13 = liveCaution("s13", v) ?? "";
    assert.ok(s13.includes("31 of your devices"));
    assert.ok(s13.includes("12 report no disk encryption"));
    assert.ok(s13.includes("20 are behind on their OS build"));
  });

  it("drops the clause rather than printing a zero when a stat is absent", () => {
    assert.equal(liveTitle("s11", THIN), "Reduce standing Global Admins to 2 break-glass accounts");
    assert.equal(liveTitle("s7", THIN), "Audit and fix MFA on your administrator accounts");
    assert.equal(liveTitle("s15", THIN), "Auto-label regulated content instead of asking every user");
    assert.ok(!liveCaution("s10", THIN)?.match(/\d/));
    assert.ok(liveCaution("s13", THIN)?.startsWith("Promote the policy and every device"));
  });

  it("never prints a negative or zero eligible-admin count", () => {
    const two = view({
      pillars: PILLAR_KEYS.map((k) =>
        k === "security" ? pillar(k, { score: 50, stats: [stat("security.globalAdmins", 2)] }) : pillar(k),
      ),
    });
    assert.ok(!liveVerify("s11", two)?.includes("0 eligible"));
    assert.ok(liveVerify("s11", two)?.includes("2 permanent"));
  });
});

describe("liveBlastRadius (#731)", () => {
  it("returns null, and reuses the design's own copy, for a step with no fixture data", () => {
    // s6 ("Put Teams creation behind a request"): every BR sentence in the
    // design is already tenant-neutral wisdom, so there is nothing to rewrite.
    assert.equal(liveBlastRadius("s6", THIN), null);
    const live = buildLiveRemediationSteps(THIN).find((s) => s.id === "s6");
    const preview = REMEDIATION_STEPS.find((s) => s.id === "s6");
    assert.deepEqual(live?.blastRadius, preview?.blastRadius);
  });

  it("substitutes the tenant's own real stat where the design named Halden's", () => {
    const v = view({
      tenant: { name: "Contoso", seatCount: 640, scannedOn: "3 August 2026" },
      pillars: PILLAR_KEYS.map((k) =>
        k === "security"
          ? pillar(k, { score: 44, stats: [stat("security.globalAdmins", 9), stat("security.legacyAuth", 305)] })
          : k === "health"
            ? pillar(k, { score: 60, stats: [stat("health.nonCompliantDevices", 31)] })
            : pillar(k),
      ),
    });
    assert.ok(liveBlastRadius("s7", v)?.goesRight.includes("9 administrators"));
    assert.ok(liveBlastRadius("s10", v)?.goesRight.startsWith("305 legacy sign-ins"));
    assert.ok(liveBlastRadius("s11", v)?.goesRight.includes("9 accounts to two"));
    assert.ok(liveBlastRadius("s13", v)?.goesRight.includes("31 devices"));
    assert.ok(liveBlastRadius("s13", v)?.goesWrong.includes("31 users"));
    assert.ok(liveBlastRadius("s15", v)?.goesRight.includes("640 people"));
    assert.ok(liveBlastRadius("s1", v)?.goesRight.includes("640 people"));
  });

  it("drops the clause rather than printing a zero or a fixture figure when a stat is absent", () => {
    // Only `goesRight` carries a real-stat substitution for these six steps;
    // `goesWrong` is static design copy either way (s11's "at 2am" is a literal
    // time of day, not a stat, so it is not asserted digit-free here).
    for (const stepId of ["s1", "s7", "s10", "s11", "s13", "s15"]) {
      const br = liveBlastRadius(stepId, THIN);
      assert.ok(br, `expected an override for ${stepId}`);
      assert.ok(!br.goesRight.match(/\d/), `${stepId} goesRight still carries a digit on a thin tenant`);
    }
  });

  it("every one of the thirty steps carries a Blast Radius card either way", () => {
    const live = buildLiveRemediationSteps(THIN);
    for (const s of live) {
      assert.ok(s.blastRadius.goesRight.length > 0, `${s.id} has no goesRight`);
      assert.ok(s.blastRadius.goesWrong.length > 0, `${s.id} has no goesWrong`);
      assert.ok(s.blastRadius.tradeOff.length > 0, `${s.id} has no tradeOff`);
    }
  });
});

describe("the design's own Blast Radius copy is transcribed, not invented", () => {
  it("s1's card matches Design/Remediation Tracker.dc.html verbatim", () => {
    const s1 = REMEDIATION_STEPS.find((s) => s.id === "s1");
    assert.equal(
      s1?.blastRadius.goesRight,
      "Four sensitive sites stop being readable by 1,240 people. The single largest exposure in the assessment closes in fifteen minutes.",
    );
    assert.equal(
      s1?.blastRadius.goesWrong,
      'Close the wrong site and a live project loses access mid-week. Set them to "Only people in your organisation" instead of "Specific people" and they stay exposed to everyone internally — which is the actual finding.',
    );
    assert.equal(
      s1?.blastRadius.tradeOff,
      "Four teams need re-granting individually. Accept a day of access requests to close a tenant-wide exposure.",
    );
  });

  it("every step carries a Blast Radius card in the preview", () => {
    for (const s of REMEDIATION_STEPS) {
      assert.ok(s.blastRadius.goesRight.length > 0, `${s.id} has no goesRight`);
      assert.ok(s.blastRadius.goesWrong.length > 0, `${s.id} has no goesWrong`);
      assert.ok(s.blastRadius.tradeOff.length > 0, `${s.id} has no tradeOff`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 4 · The parameterised scripts keep their command logic
 * ------------------------------------------------------------------ */

describe("parameterised scripts", () => {
  it("change only the literal, never the cmdlets", () => {
    const cmdlets: Record<string, readonly string[]> = {
      s1: ["Set-SPOSite", "-SharingCapability Disabled", "foreach ($s in $sites)"],
      s5: ["New-MgGroupLifecyclePolicy", "-GroupLifetimeInDays 365", "-ManagedGroupTypes All"],
      s9: ["Get-MgIdentityConditionalAccessPolicy", "Update-MgIdentityConditionalAccessPolicy", "excludeGroups = @()"],
      s12: ["Get-SafeLinksPolicy", "Set-SafeLinksPolicy", "Enable-SafeLinksRule", "-IsEnabled $true"],
      s14: ["New-Label", "New-LabelPolicy", "-EncryptionEnabled $true", "MandatoryLabel"],
      s22: ["New-MgGroup", "DynamicMembership", "user.accountEnabled -eq true"],
    };
    for (const [id, needles] of Object.entries(cmdlets)) {
      const script = LIVE_STEP_SCRIPTS[id]?.script ?? "";
      for (const needle of needles) {
        assert.ok(script.includes(needle), `${id}'s live script lost "${needle}"`);
      }
    }
  });

  it("keeps each rewritten script's language strip identical to the design's", () => {
    for (const [id, code] of Object.entries(LIVE_STEP_SCRIPTS)) {
      const original = REMEDIATION_STEPS.find((s) => s.id === id);
      assert.equal(code.language, original?.code?.language, `${id}'s language strip changed`);
    }
  });

  it("keeps every rewritten script the same number of lines as the design's", () => {
    // A dropped or added line is the failure mode a diff of two opaque strings
    // hides; the line count is the cheap invariant that catches it.
    for (const [id, code] of Object.entries(LIVE_STEP_SCRIPTS)) {
      const original = REMEDIATION_STEPS.find((s) => s.id === id)?.code?.script ?? "";
      assert.equal(
        code.script.split("\n").length,
        original.split("\n").length,
        `${id}'s live script has a different line count`,
      );
    }
  });

  it("leaves no unnamed placeholder and no bare <id>", () => {
    for (const [id, code] of Object.entries(LIVE_STEP_SCRIPTS)) {
      assert.ok(!code.script.includes("<id>"), `${id} still carries the design's unnamed <id>`);
    }
  });

  it("every placeholder a live script introduces is explained by its fill-in", () => {
    for (const [id, code] of Object.entries(LIVE_STEP_SCRIPTS)) {
      const placeholders = [...code.script.matchAll(/<[a-z0-9@.-]+>/gi)].map((m) => m[0]);
      assert.ok(placeholders.length > 0, `${id} was listed as parameterised but has no placeholder`);
      const fillIn = STEP_FILL_INS[id] ?? "";
      // `<your-tenant>` and the numbered site slots are self-evident from the
      // sentence rather than quoted in it, so only the named values are pinned.
      const named = placeholders.filter((p) => !/^<(your-tenant|site-\d)>$/.test(p));
      for (const p of new Set(named)) {
        assert.ok(fillIn.includes(p), `${id}'s fill-in does not name ${p}`);
      }
    }
  });

  it("the prelude points at the step that really removes standing Global Admin", () => {
    assert.ok(LIVE_PRELUDE.footnote.includes("Step 11"));
    assert.ok(!LIVE_PRELUDE.footnote.includes("Step 12"));
    // The design's own footnote said Step 12, which is Safe Links. Preview keeps
    // it verbatim; only the live copy is corrected.
    assert.ok(REMEDIATION_PRELUDE.footnote.includes("Step 12"));
    assert.ok(!LIVE_PRELUDE.code.script.includes("haldenmaterials"));
  });
});

/* ------------------------------------------------------------------ *
 * 5 · Evidence — and the two kinds of nothing
 * ------------------------------------------------------------------ */

describe("stepEvidence", () => {
  const withFinding = [
    pillar("governance", {
      score: 40,
      criticalCount: 1,
      findings: [finding({ title: "Org-wide sharing is open on 4 sites", checkKey: "sharepoint:orgwide-links" })],
    }),
    ...PILLAR_KEYS.filter((k) => k !== "governance").map((k) => pillar(k)),
  ];

  it("quotes the real finding verbatim when one exists on a mapped check", () => {
    const e = stepEvidence("s1", withFinding);
    assert.equal(e.kind, "finding");
    if (e.kind !== "finding") return;
    assert.equal(e.title, "Org-wide sharing is open on 4 sites");
    assert.equal(e.checkKey, "sharepoint:orgwide-links");
    assert.equal(e.pillar, "governance");
  });

  it("returns unconfirmed — never clean — when no finding matches", () => {
    const e = stepEvidence("s3", withFinding);
    assert.equal(e.kind, "unconfirmed");
    if (e.kind !== "unconfirmed") return;
    assert.deepEqual(e.checkKeys, ["sharepoint:anonymous-links"]);
  });

  it("says nothing that could be read as a pass", () => {
    for (const word of ["clean", "clear", "no issues", "passed", "compliant", "resolved"]) {
      assert.ok(
        !UNCONFIRMED_EVIDENCE_DETAIL.toLowerCase().includes(word),
        `the unconfirmed line implies a pass with "${word}"`,
      );
    }
    assert.ok(UNCONFIRMED_EVIDENCE_DETAIL.includes("neither confirmed nor ruled"));
  });

  it("returns gap for Steps 18 and 28, and the wording is an absence not a verdict", () => {
    for (const id of ["s18", "s28"]) {
      const e = stepEvidence(id, withFinding);
      assert.equal(e.kind, "gap");
      if (e.kind !== "gap") continue;
      assert.ok(/No check this platform runs reads/.test(e.detail));
      assert.ok(!/fail|failing|breach|violation|non-compliant/i.test(e.detail));
    }
    // Step 18's line must not read as disapproval; it says explicitly that
    // nothing has been judged in either direction.
    assert.ok(STEP_CHECK_GAPS.s18.includes("nothing here says your retention"));
    assert.ok(STEP_CHECK_GAPS.s28.includes("unmeasured by this assessment rather than found wanting"));
  });

  it("returns process for the four decision steps, and renders no evidence line", () => {
    for (const id of PROCESS_ONLY_STEP_IDS) {
      assert.equal(stepEvidence(id, withFinding).kind, "process");
    }
  });

  it("prefers the more severe finding when a step maps to two checks", () => {
    const pillars = [
      pillar("security", {
        score: 30,
        findings: [
          // `buildPillarViews` has already ordered these criticals-first; this
          // asserts the join respects that order rather than the key order.
          finding({ title: "CA policies left in report-only", checkKey: "identity:ca-report-only" }),
          finding({ severity: "warning", title: "Only 3 CA policies", checkKey: "identity:ca-policy-count" }),
        ],
      }),
      ...PILLAR_KEYS.filter((k) => k !== "security").map((k) => pillar(k)),
    ];
    const e = stepEvidence("s9", pillars);
    assert.equal(e.kind, "finding");
    if (e.kind !== "finding") return;
    assert.equal(e.checkKey, "identity:ca-report-only");
  });
});

/* ------------------------------------------------------------------ *
 * 6 · The guide's own numbers
 * ------------------------------------------------------------------ */

describe("guide-level figures", () => {
  it("derives the step and scripted counts rather than restating them", () => {
    const live = resolveStandfirst(false, 30, 28);
    assert.ok(live.includes("30 steps, 28 of them scripted"));
    assert.ok(!live.includes("twenty-two"));
    const closing = resolveClosing(false, 30, 28);
    assert.ok(closing[0].includes("30 steps, 28 of them scripted"));
    assert.ok(resolveHandoffBlurb(false, 30).includes("same 30 steps"));
  });

  it("counts real findings off findingCounts, not the findings array's own length", () => {
    const pillars = [
      pillar("governance", {
        score: 40,
        criticalCount: 4,
        warningCount: 9,
        // Three findings carried on this payload, thirteen real — the array's
        // length must not silently become the total.
        findings: [finding({ title: "a" }), finding({ title: "b" }), finding({ title: "c" })],
      }),
      ...PILLAR_KEYS.filter((k) => k !== "governance").map((k) => pillar(k)),
    ];
    assert.equal(totalFindings(pillars), 13);
    assert.ok(resolveTotalFindings(false, pillars).startsWith("13 across 1 scored pillar"));
    assert.deepEqual(criticalsByPillar(pillars), [{ pillar: "governance", count: 4 }]);
    assert.equal(resolveBlockers(false, pillars), "4 — Governance 4");
  });

  it("tells an evaluated-clean tenant apart from an unevaluated one", () => {
    const evaluated = PILLAR_KEYS.map((k) => pillar(k, { score: 90 }));
    assert.equal(resolveBlockers(false, evaluated), "None — your last scan recorded no critical findings");
    assert.equal(
      resolveBlockers(false, PILLAR_KEYS.map((k) => pillar(k))),
      "Not established — no pillar on this tenant has an evaluated score",
    );
  });

  it("asserts no projected score, because none is computed outside a priced scope", () => {
    const withScore = resolveExpectedImprovement(false, 41);
    assert.ok(withScore.includes("41 today"));
    assert.ok(withScore.includes(String(COPILOT_GATE_TARGET)));
    assert.ok(!withScore.includes("68"));
    assert.ok(resolveExpectedImprovement(false, null).includes("No readiness score is recorded"));
  });

  it("states over-exposure in items, not sites", () => {
    const v = view({
      pillars: PILLAR_KEYS.map((k) =>
        k === "governance" ? pillar(k, { score: 40, stats: [stat("governance.exposure", 8421)] }) : pillar(k),
      ),
    });
    const row = resolveChecklistRows(false, v).find((r) => r.includes("blast radius")) ?? "";
    assert.ok(row.includes("8,421 items currently over-exposed"));
    assert.ok(!row.includes("sites"));
  });

  it("gives one checklist row per pillar plus blast radius and readiness", () => {
    const rows = resolveChecklistRows(false, THIN);
    assert.equal(rows.length, PILLAR_KEYS.length + 2);
    for (const key of PILLAR_KEYS) {
      assert.ok(
        rows.some((r) => r.includes(PILLARS[key].label.toLowerCase())),
        `no checklist row for ${key}`,
      );
    }
    // An unevaluated pillar must not read as "none open".
    assert.ok(rows.every((r) => !r.includes("none open")));
  });

  it("does not attach step numbers it cannot derive", () => {
    for (const row of resolveChecklistRows(false, THIN)) {
      assert.ok(!/\(Steps? /.test(row), `checklist row invented a step reference: ${row}`);
    }
  });

  it("scope headline drops the blocker clause when there are none", () => {
    assert.equal(resolveScopeHeadline(false, 30, THIN.pillars), "30 steps. 14 weeks.");
  });
});

/* ------------------------------------------------------------------ *
 * 7 · Preview is provably unchanged
 * ------------------------------------------------------------------ */

describe("preview branches reproduce the design verbatim", () => {
  it("for every guide-level resolver", () => {
    assert.equal(resolveStandfirst(true, 30, 28), REMEDIATION_GUIDE.standfirst);
    assert.equal(resolveScopeHeadline(true, 30, THIN.pillars), REMEDIATION_GUIDE.scope.headline);
    assert.equal(resolveTotalFindings(true, THIN.pillars), "41 across six pillars");
    assert.equal(resolveBlockers(true, THIN.pillars), "6 — Governance 2 · Security 2 · Compliance 2");
    assert.equal(resolveExpectedImprovement(true, null), "41 to 68 (+27) on the scoped programme");
    assert.deepEqual(resolveClosing(true, 30, 28), REMEDIATION_GUIDE.closing);
    assert.equal(resolveHandoffBlurb(true, 30), REMEDIATION_GUIDE.handoff.blurb);
    assert.deepEqual(resolveChecklistRows(true, THIN), REMEDIATION_GUIDE.checklist.rows);
    assert.equal(resolveChecklistNote(true, THIN), REMEDIATION_GUIDE.checklist.note);
  });

  it("and the preview's own overview values still match the design's fixture", () => {
    const rows = REMEDIATION_GUIDE.overview.rows;
    assert.equal(rows.find((r) => r.label === "Total findings requiring remediation")?.value, "41 across six pillars");
    assert.equal(rows.find((r) => r.label === "Not safe yets")?.value, "6 — Governance 2 · Security 2 · Compliance 2");
    assert.equal(
      rows.find((r) => r.label === "Expected improvement")?.value,
      "41 to 68 (+27) on the scoped programme",
    );
    // The one row a live journey deliberately leaves as the design's, because it
    // states the programme's shape rather than a measurement of any tenant.
    assert.equal(
      rows.find((r) => r.label === "Critical path duration")?.value,
      "14 weeks to certification · 12 weeks to enablement",
    );
    // And the derived row, which has no `value` at all.
    assert.ok(rows.some((r) => "derived" in r && r.derived === "stepCount"));
  });
});

/* ------------------------------------------------------------------ *
 * 8 · statValue
 * ------------------------------------------------------------------ */

describe("statValue", () => {
  const pillars = [
    pillar("security", { stats: [stat("security.globalAdmins", 11), stat("security.legacyAuth", null)] }),
    ...PILLAR_KEYS.filter((k) => k !== "security").map((k) => pillar(k)),
  ];

  it("returns a real number", () => {
    assert.equal(statValue(pillars, "security", "security.globalAdmins"), 11);
  });

  it("returns null for an unreported stat, a missing stat and a missing pillar alike", () => {
    assert.equal(statValue(pillars, "security", "security.legacyAuth"), null);
    assert.equal(statValue(pillars, "security", "security.nope"), null);
    assert.equal(statValue([], "security", "security.globalAdmins"), null);
  });
});
