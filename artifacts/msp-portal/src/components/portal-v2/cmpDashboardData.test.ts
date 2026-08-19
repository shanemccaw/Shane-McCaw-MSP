/**
 * cmpDashboardData.test.ts — the Compliance fixture and its playbook wrapper.
 *
 * The load-bearing assertions here are the two things a future edit is most
 * likely to quietly destroy.
 *
 * The first is the playbook WRAPPER. The prototype does not store compliance
 * manual steps flat: it builds every playbook through a mapper that prepends a
 * Purview sign-in step and appends a re-scan-and-export step (12256-12274).
 * Someone editing a playbook's steps in the future will be looking at the
 * per-fix array, where neither wrapper step appears — so the wrapper is asserted
 * on the RESOLVED playbook, which is what the fix panel renders.
 *
 * The second is the cluster/area geometry. Compliance's cards look like
 * Governance's and share not one number with them, so the tier sizes and the
 * delta arithmetic are pinned rather than left to a reviewer's eye.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { playbookFor } from "./fixPanelLibrary";
import { trendGeometry } from "./DriftTrend";
import {
  CMP_ACCEPTED,
  CMP_ACCEPTED_COUNT,
  CMP_AREA_LINKS,
  CMP_CLUSTERS,
  CMP_FINDINGS,
  CMP_HERO,
  CMP_HISTORY,
  CMP_OBLIGATIONS,
  CMP_OPEN_COUNT,
  CMP_SCRUTINY,
  CMP_SEV_META,
  CMP_TIER,
  cmpAcceptedMeta,
  cmpAreaGeometry,
} from "./cmpDashboardData";

describe("Compliance hero", () => {
  it("scores 78 with a hardcoded ±0 delta, not a derived one", () => {
    assert.equal(CMP_HERO.score, 78);
    assert.equal(CMP_HERO.delta, "±0 this month");
    // The history's last two entries are both 78, which is what ±0 reflects.
    assert.equal(CMP_HISTORY[CMP_HISTORY.length - 1], CMP_HERO.score);
    assert.equal(CMP_HISTORY[CMP_HISTORY.length - 2], CMP_HERO.score);
  });

  it("labels its trend 'Gaps closed', not 'Drift trend'", () => {
    assert.equal(CMP_HERO.trendLabel, "Gaps closed · last 10 scans");
    assert.match(CMP_HERO.trendCaption, /^Eight points over ten scans\./);
  });

  it("states its status as a sentence fragment, matching the open-gap count", () => {
    assert.equal(CMP_HERO.statusLabel, "Stable · 6 gaps open");
    assert.equal(CMP_OPEN_COUNT, 6);
  });

  it("plots its own history — a rising line, unlike Security's falling one", () => {
    const t = trendGeometry(CMP_HISTORY);
    // Domain [70-3, 78+3] spans 14, so the first point (70) sits at
    // 84 - (3/14)*84 = 66 and the last (78) at 84 - (11/14)*84 = 18.
    assert.equal(t.line.split(" ")[0], "0,66");
    assert.equal(t.lastX, 280);
    assert.equal(t.lastY, 18);
    // Smaller y is higher on screen, so a rising score is a FALLING y — this is
    // the only pillar whose line climbs, and the caption says so in words.
    assert.ok(t.lastY < 66, `expected a rising line, got lastY=${t.lastY}`);
  });
});

describe("Compliance — the sections no other pillar has", () => {
  it("carries three scrutiny moments, each with its own notice period", () => {
    assert.equal(CMP_SCRUTINY.length, 3);
    assert.deepEqual(
      CMP_SCRUTINY.map((s) => s.moment),
      ["An audit", "A legal hold", "A breach investigation"],
    );
    assert.equal(CMP_SCRUTINY[2].when, "No notice at all");
  });

  it("renders SIX open gaps, each citing an obligation and naming a playbook", () => {
    assert.equal(CMP_FINDINGS.length, 6);
    CMP_FINDINGS.forEach((f) => {
      assert.match(f.id, /^CMP-0\d$/);
      assert.ok(f.obligation.length > 0, `${f.id} cites no obligation`);
      assert.ok(f.obligationText.length > 0, `${f.id} has no obligation text`);
      assert.ok(f.evidence.length >= 4, `${f.id} has thin evidence`);
      assert.ok(f.fixKey.startsWith("cmp-"), `${f.id} has a non-compliance fixKey`);
    });
    // Four material gaps, two ordinary — the chip colour depends on it.
    assert.equal(CMP_FINDINGS.filter((f) => f.sev === "high").length, 4);
    assert.equal(CMP_SEV_META.high.label, "Material gap");
    assert.equal(CMP_SEV_META.medium.label, "Gap");
  });

  it("renders both documented decisions in full, with a four-field audit trail", () => {
    assert.equal(CMP_ACCEPTED_COUNT, 2);
    CMP_ACCEPTED.forEach((a) => {
      const meta = cmpAcceptedMeta(a);
      assert.deepEqual(
        meta.map((m) => m.k),
        ["Approved by", "Approved", "Next review", "Risk register"],
      );
      assert.ok(a.rationale.length > 0);
      assert.ok(a.compensating.length > 0);
    });
    // A2's review is deliberately 6 months rather than 12 — the note says why.
    assert.match(CMP_ACCEPTED[1].note, /6 months rather than 12/);
  });

  it("lists seven obligations, one of them explicitly out of scope", () => {
    assert.equal(CMP_OBLIGATIONS.length, 7);
    const outOfScope = CMP_OBLIGATIONS.filter((o) => o.tone === "slate");
    assert.equal(outOfScope.length, 1);
    assert.equal(outOfScope[0].framework, "PCI DSS v4.0");
    assert.equal(outOfScope[0].scope, "Marked out of scope");
  });
});

describe("Compliance area cards", () => {
  it("covers every card by exactly one cluster", () => {
    const clustered = CMP_CLUSTERS.flatMap((c) => CMP_AREA_LINKS.filter((a) => a.cluster === c));
    assert.equal(clustered.length, CMP_AREA_LINKS.length);
    assert.equal(CMP_AREA_LINKS.length, 14);
  });

  it("only makes a card interactive when it has a gap to open", () => {
    const interactive = CMP_AREA_LINKS.filter((a) => a.finding != null);
    assert.equal(interactive.length, 6);
    // Every `finding` index must address a real gap, or the card opens nothing.
    interactive.forEach((a) => {
      assert.ok(
        a.finding! >= 0 && a.finding! < CMP_FINDINGS.length,
        `${a.key} points at gap ${a.finding}, which does not exist`,
      );
    });
    // And the six indices are distinct — no two cards open the same gap.
    const idx = interactive.map((a) => a.finding!);
    assert.equal(new Set(idx).size, idx.length);
  });

  it("uses ITS OWN tier sizes, which are not Governance's", () => {
    assert.equal(CMP_TIER.large.score, 24);
    assert.equal(CMP_TIER.medium.score, 19);
    assert.equal(CMP_TIER.small.score, 16);
  });

  it("colours the delta by direction, and treats green as neutral", () => {
    const byKey = (k: string) => CMP_AREA_LINKS.find((a) => a.key === k)!;
    // Retention Coverage fell 17 → 12: fewer uncovered mailboxes is GOOD.
    const better = cmpAreaGeometry(byKey("compliance-retention-coverage"));
    assert.equal(better.deltaText, "-5");
    assert.equal(better.deltaColor, "#34d399");
    // Disposition rose 1610 → 1940: more over-retained items is BAD.
    const worse = cmpAreaGeometry(byKey("compliance-disposition"));
    assert.equal(worse.deltaText, "+330");
    assert.equal(worse.deltaColor, "#f87171");
    // Admin Activity Trail improved 1 → 0 but is GREEN, so its delta is muted
    // rather than celebrated — a fully covered area does not need a win colour.
    const green = cmpAreaGeometry(byKey("compliance-admin-trail"));
    assert.equal(green.deltaText, "-1");
    assert.equal(green.deltaColor, "#64748b");
    // Unchanged reads ±0.
    assert.equal(cmpAreaGeometry(byKey("compliance-holds")).deltaText, "±0");
  });

  it("always draws four sparkbars, the last one at full opacity", () => {
    CMP_AREA_LINKS.forEach((a) => {
      const { sparkBars } = cmpAreaGeometry(a);
      assert.equal(sparkBars.length, 4);
      assert.equal(sparkBars[3].opacity, 1);
      sparkBars.forEach((b) => assert.ok(b.height >= 3, `${a.key} has a zero-height bar`));
    });
  });
});

describe("Compliance playbooks — the wrapper the mapper adds", () => {
  it("resolves all six gap fixKeys to real playbooks, not the fallback", () => {
    CMP_FINDINGS.forEach((f) => {
      const p = playbookFor(f.fixKey);
      assert.notEqual(
        p.title,
        "Apply the recommended change",
        `${f.fixKey} fell through to the generic fallback`,
      );
      assert.equal(p.pillarColor, "#E2E8F0");
    });
  });

  it("wraps every playbook with the Purview sign-in and the re-scan step", () => {
    CMP_FINDINGS.forEach((f) => {
      const steps = playbookFor(f.fixKey).manualSteps;
      assert.match(steps[0].text, /^Sign in to the Microsoft Purview portal/);
      assert.equal(steps[0].link, "https://purview.microsoft.com");
      assert.match(steps[steps.length - 1].text, /export the evidence pack for your records\.$/);
      // The wrapper must not be the whole list — the fix's own steps sit between.
      assert.ok(steps.length >= 6, `${f.fixKey} lost its own manual steps`);
    });
  });

  it("keeps the permanence warning on the Preservation Lock playbook", () => {
    // This is the one fix in the pillar that cannot be undone, and the risk text
    // is the only place that says so before the CR is raised.
    assert.match(playbookFor("cmp-preservation-lock").riskText, /This is permanent\./);
  });
});
