/**
 * sowLiveContract.test.ts — the real Statement of Work's live-derived content
 * (#292, document 9 of 9).
 *
 * Same discipline as `pillarSecurityPosture.test.ts`: what matters is that a
 * thin tenant (no findings, no score, no scan date) degrades to honest
 * absences rather than a fabricated Halden Materials number, and that every
 * `derived` row's preview branch still reproduces the design's own verbatim
 * text so `?preview=design` is provably unchanged by this port.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLiveBlockers,
  buildLiveCarry,
  elapsedDaysSince,
  resolveBasisOfScope,
  resolveChangeWindows,
  resolveElapsedDays,
  resolveFindingsCarried,
  resolveFindingsInScope,
  resolveNetYear,
  resolveNewBudget,
  resolveObjective,
  resolvePaymentTerms,
  resolvePhaseDuration,
  resolveProjected,
  resolveTelemetrySource,
  resolveTimeline,
  resolveValidity,
  resolveWasteRecovered,
  resolveWeeksRow,
  resolveWhyMatters,
  projectedFromPhases,
  quotedWeeksOf,
} from "./sowLiveContract.ts";
import { COPILOT_GATE_TARGET, PILLARS, PILLAR_KEYS, type PillarKey } from "./journeyTokens.ts";
import type { JourneyPillarView, WirePillarFinding } from "./journeyModel.ts";

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

function finding(overrides: Partial<WirePillarFinding> & { title: string }): WirePillarFinding {
  return { severity: "critical", checkKey: "check:x", ...overrides };
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

/* ------------------------------------------------------------------ *
 * Section 5 blockers + Section 7 carry
 * ------------------------------------------------------------------ */

describe("buildLiveBlockers", () => {
  it("takes one real critical finding per pillar that has one, in pillar order", () => {
    const pillars = PILLAR_KEYS.map((k) => pillar(k));
    const withGovernance = pillars.map((p) =>
      p.key === "governance"
        ? { ...p, findings: [finding({ title: "212 sites shared org-wide" })] }
        : p,
    );
    const rows = buildLiveBlockers(withGovernance);
    assert.deepEqual(rows, [{ pillar: "governance", text: "212 sites shared org-wide" }]);
  });

  it("never elaborates beyond the finding's own title", () => {
    const pillars = PILLAR_KEYS.map((k) =>
      k === "security"
        ? pillar(k, { findings: [finding({ title: "4 Global Administrators without MFA" })] })
        : pillar(k),
    );
    const rows = buildLiveBlockers(pillars);
    assert.equal(rows[0]?.text, "4 Global Administrators without MFA");
  });

  it("skips a pillar whose lead finding is only a warning", () => {
    const pillars = PILLAR_KEYS.map((k) =>
      k === "compliance"
        ? pillar(k, { findings: [finding({ title: "Retention drift", severity: "warning" })] })
        : pillar(k),
    );
    assert.deepEqual(buildLiveBlockers(pillars), []);
  });

  it("caps at six", () => {
    const pillars = PILLAR_KEYS.map((k) => pillar(k, { findings: [finding({ title: `${k} blocker` })] }));
    assert.equal(buildLiveBlockers(pillars).length, 6);
  });
});

describe("buildLiveCarry", () => {
  it("lists a real finding count and joins the real titles", () => {
    const pillars = PILLAR_KEYS.map((k) =>
      k === "governance"
        ? pillar(k, {
            score: 34,
            findings: [
              finding({ title: "212 sites shared org-wide" }),
              finding({ title: "No lifecycle policy", severity: "warning" }),
            ],
          })
        : pillar(k),
    );
    const row = buildLiveCarry(pillars).find((r) => r.pillar === "governance");
    assert.equal(row?.count, 2);
    assert.equal(row?.detail, "212 sites shared org-wide, No lifecycle policy");
  });

  it("lists a genuinely clean pillar (real score, zero findings) rather than dropping it", () => {
    const pillars = PILLAR_KEYS.map((k) => (k === "health" ? pillar(k, { score: 88 }) : pillar(k)));
    const row = buildLiveCarry(pillars).find((r) => r.pillar === "health");
    assert.equal(row?.count, 0);
    assert.match(row?.detail ?? "", /No critical or warning findings/);
  });

  it("drops a pillar the scan never evaluated (no score) entirely", () => {
    const pillars = PILLAR_KEYS.map((k) => pillar(k));
    assert.deepEqual(buildLiveCarry(pillars), []);
  });

  it("orders worst-first by count", () => {
    const pillars = PILLAR_KEYS.map((k) => {
      if (k === "governance") return pillar(k, { score: 30, findings: [finding({ title: "a" }), finding({ title: "b" })] });
      if (k === "security") return pillar(k, { score: 40, findings: [finding({ title: "c" })] });
      return pillar(k);
    });
    const rows = buildLiveCarry(pillars);
    assert.deepEqual(rows.map((r) => r.pillar), ["governance", "security"]);
  });
});

/* ------------------------------------------------------------------ *
 * Derived rows — preview branch reproduces the design verbatim,
 * live branch degrades honestly.
 * ------------------------------------------------------------------ */

describe("resolveObjective", () => {
  it("preview: Halden's own verbatim line", () => {
    assert.equal(resolveObjective(true, 999), "Copilot Gate clearance · readiness 41 → 82 minimum");
  });
  it("live: real score", () => {
    assert.equal(resolveObjective(false, 41), `Copilot Gate clearance · readiness 41 → ${COPILOT_GATE_TARGET} minimum`);
  });
  it("live: no score yet", () => {
    assert.equal(resolveObjective(false, null), `Copilot Gate clearance · readiness at or above ${COPILOT_GATE_TARGET}`);
  });
});

describe("resolveFindingsInScope", () => {
  it("preview: verbatim, hardcoded total 41", () => {
    assert.equal(resolveFindingsInScope(true, 12, 999), "12 of 41 findings addressed by the selected phases");
  });
  it("live: real total", () => {
    assert.equal(resolveFindingsInScope(false, 12, 30), "12 of 30 findings addressed by the selected phases");
  });
  it("live: total unknown — states the in-scope count alone rather than 'of null'", () => {
    assert.equal(resolveFindingsInScope(false, 12, null), "12 findings addressed by the selected phases");
  });
  it("not itemised on this scope", () => {
    assert.equal(resolveFindingsInScope(false, null, 30), "Not itemised per phase on this statement of work");
  });
});

describe("resolveProjected", () => {
  it("preview: verbatim, hardcoded 41 of 100 today", () => {
    assert.equal(resolveProjected(true, 999, 68, 82), "41 of 100 today · 68 on this scope · 82 is safe to deploy");
  });
  it("live: real current score", () => {
    assert.equal(resolveProjected(false, 41, 68, 82), "41 of 100 today · 68 on this scope · 82 is safe to deploy");
  });
  it("live: current score unmeasured", () => {
    assert.equal(resolveProjected(false, null, 68, 82), "unmeasured today · 68 on this scope · 82 is safe to deploy");
  });
  it("no projection at all", () => {
    assert.equal(
      resolveProjected(false, 41, null, 82),
      "No projection — this scope's phases quote prices, not projected pillar scores",
    );
  });
});

describe("resolveFindingsCarried", () => {
  it("live: real total and real blocker count", () => {
    assert.equal(resolveFindingsCarried(false, 30, 4), "30 findings across six pillars · 4 of them gate blockers");
  });
  it("live: no findings measured", () => {
    assert.equal(resolveFindingsCarried(false, null, 0), "No findings are yet recorded for this tenant's scan");
  });
  it("live: findings but no blockers", () => {
    assert.equal(resolveFindingsCarried(false, 5, 0), "5 findings across six pillars");
  });
});

describe("resolveWhyMatters", () => {
  it("preview: verbatim, hardcoded 1,847 sites", () => {
    assert.match(resolveWhyMatters(true, null), /across 1,847 sites\.$/);
  });
  it("live: real site count", () => {
    assert.match(resolveWhyMatters(false, 340), /across 340 sites\.$/);
  });
  it("live: no site count — drops the clause rather than guessing", () => {
    const text = resolveWhyMatters(false, null);
    assert.ok(!text.includes("sites"));
  });
});

describe("resolveBasisOfScope", () => {
  it("live: no signal count available — omits the clause", () => {
    assert.equal(resolveBasisOfScope(false, null), "Read-only Microsoft Graph assessment · no configuration altered");
  });
});

describe("resolveChangeWindows", () => {
  it("live: drops the Halden-specific device count", () => {
    assert.ok(!resolveChangeWindows(false).includes("88 devices"));
  });
});

describe("elapsedDaysSince / resolveElapsedDays", () => {
  it("computes whole days", () => {
    assert.equal(elapsedDaysSince("2026-08-01T00:00:00.000Z", "2026-08-06T00:00:00.000Z"), 5);
  });
  it("null when no scan date", () => {
    assert.equal(elapsedDaysSince(null, "2026-08-06T00:00:00.000Z"), null);
  });
  it("live: not established with no scan date", () => {
    assert.equal(resolveElapsedDays(false, null), "Not established — no scan date on record");
  });
  it("preview: verbatim 12 days regardless of input", () => {
    assert.equal(resolveElapsedDays(true, 999), "12 days");
  });
});

describe("resolveNewBudget / resolveNetYear — #451's undeniable gap", () => {
  it("live never asserts a required tier or a user count", () => {
    const text = resolveNewBudget(false);
    assert.ok(!/\$\d/.test(text), "must not print a dollar figure this platform cannot derive");
    assert.ok(!text.includes("96 users"));
  });
  it("live net year is likewise a declared gap, not an arithmetic result", () => {
    assert.ok(!/\$\d/.test(resolveNetYear(false)));
  });
});

describe("resolveWasteRecovered", () => {
  it("live: real annual waste stat", () => {
    assert.equal(resolveWasteRecovered(false, 18400), "$18,400 a year, from paid seats provisioned but unassigned");
  });
  it("live: not measured", () => {
    assert.equal(resolveWasteRecovered(false, null), "Not measured on this tenant's last scan");
  });
});

describe("resolvePaymentTerms", () => {
  it("live: real milestone billing, not a 40% deposit", () => {
    const text = resolvePaymentTerms(false, false, false);
    assert.ok(!text.includes("40%"));
    assert.ok(!text.includes("14 days net"));
    assert.match(text, /milestone-based/);
  });
  it("live: self-serve phased billing reads differently from provider-arranged", () => {
    assert.match(resolvePaymentTerms(false, true, false), /invoices per phase/);
  });
  it("live: pay-in-full discount surfaces when active", () => {
    assert.match(resolvePaymentTerms(false, false, true), /active discount/);
  });
  it("live: unknown before payment-options settles", () => {
    assert.equal(resolvePaymentTerms(false, null, false), "Confirmed at checkout for your agreed scope");
  });
});

describe("resolveValidity", () => {
  it("live: real hold date", () => {
    assert.equal(
      resolveValidity(false, "2 September 2026"),
      "Quoted pricing holds until 2 September 2026, after which a fresh scan is required",
    );
  });
  it("live: no hold date quoted", () => {
    assert.equal(resolveValidity(false, null), "No fixed hold date is quoted for this scope");
  });
});

describe("resolveTelemetrySource", () => {
  it("live: real scanned-on date", () => {
    assert.equal(
      resolveTelemetrySource(false, "5 August 2026"),
      "Microsoft Graph API · read-only delegated permissions · 5 August 2026",
    );
  });
  it("live: no scan date on record", () => {
    assert.equal(resolveTelemetrySource(false, null), "Microsoft Graph API · read-only delegated permissions");
  });
});

/* ------------------------------------------------------------------ *
 * The engine-sourced live scope: durations and projections that are not
 * quoted must read as not quoted, never as zero.
 * ------------------------------------------------------------------ */

describe("quotedWeeksOf", () => {
  it("sums only the phases that actually quoted a duration", () => {
    assert.equal(quotedWeeksOf([{ weeksQuoted: 3 }, { weeksQuoted: null }, { weeksQuoted: 2 }]), 5);
  });
  it("null when not one phase quoted a duration — the engine-sourced case", () => {
    assert.equal(quotedWeeksOf([{ weeksQuoted: null }, { weeksQuoted: null }]), null);
  });
  it("null on an empty scope rather than 0", () => {
    assert.equal(quotedWeeksOf([]), null);
  });
  it("a genuine zero-week phase is still a quote, not an absence", () => {
    assert.equal(quotedWeeksOf([{ weeksQuoted: 0 }]), 0);
  });
});

describe("resolveTimeline", () => {
  it("preview: the design's own summary, unchanged", () => {
    assert.equal(resolveTimeline(true, 19), "approx. 19 weeks");
  });
  it("live: a real quoted total", () => {
    assert.equal(resolveTimeline(false, 12), "approx. 12 weeks");
  });
  it("live: never 'approx. 0 weeks' when nothing quoted one", () => {
    assert.equal(resolveTimeline(false, null), "timeline set at kickoff");
  });
});

describe("resolveWeeksRow", () => {
  it("preview: verbatim", () => {
    assert.equal(resolveWeeksRow(true, 19), "approx. 19 weeks to certification");
  });
  it("live: real total", () => {
    assert.equal(resolveWeeksRow(false, 12), "approx. 12 weeks to certification");
  });
  it("live: honest absence", () => {
    assert.equal(resolveWeeksRow(false, null), "Set at kickoff — no phase on this scope quotes a duration");
  });
});

describe("resolvePhaseDuration", () => {
  it("out of scope wins over everything, in both modes", () => {
    assert.equal(resolvePhaseDuration(true, false, 3), "Out of scope");
    assert.equal(resolvePhaseDuration(false, false, null), "Out of scope");
  });
  it("preview: the design's own per-phase weeks", () => {
    assert.equal(resolvePhaseDuration(true, true, 3), "3 weeks");
    assert.equal(resolvePhaseDuration(true, true, 1), "1 week");
  });
  it("live: a real quoted duration, singular and plural", () => {
    assert.equal(resolvePhaseDuration(false, true, 2), "2 weeks");
    assert.equal(resolvePhaseDuration(false, true, 1), "1 week");
  });
  it("live: an unquoted duration is stated as unquoted, not as 0 weeks", () => {
    assert.equal(resolvePhaseDuration(false, true, null), "Not quoted");
  });
});

describe("projectedFromPhases", () => {
  it("keeps the computed projection when any phase asserts real movement", () => {
    assert.equal(projectedFromPhases([{ scoreFrom: 44, scoreTo: 71 }, { scoreFrom: 60, scoreTo: 60 }], 68), 68);
  });
  it("declines to project when every phase is flat — the engine-sourced case", () => {
    assert.equal(projectedFromPhases([{ scoreFrom: 0, scoreTo: 0 }, { scoreFrom: 0, scoreTo: 0 }], 0), null);
  });
  it("a flat scope never yields the 0 that used to read as '82 points short of the gate'", () => {
    assert.equal(
      resolveProjected(false, 41, projectedFromPhases([{ scoreFrom: 0, scoreTo: 0 }], 0), 82),
      "No projection — this scope's phases quote prices, not projected pillar scores",
    );
  });
  it("an empty phase list defers to the caller's own value rather than inventing a verdict", () => {
    assert.equal(projectedFromPhases([], null), null);
    assert.equal(projectedFromPhases([], 55), 55);
  });
});
