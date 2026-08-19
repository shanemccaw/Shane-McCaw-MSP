/**
 * licDashboardData.test.ts — the Licensing fixture, its arithmetic, and the
 * separation the whole pillar rests on.
 *
 * Three things here are worth more than the rest.
 *
 * The TREND MATHS. Licensing does not use the shared `trendGeometry`: its series
 * is cumulative and starts at zero, so it anchors the floor at 0 and sets the
 * ceiling to `max * 1.12` instead of padding both ends by ±3. Someone
 * consolidating "the four trend charts" onto one helper would move this line
 * without any type error, so both behaviours are asserted side by side.
 *
 * The LEDGER TOTALS. The totals row is summed, not typed — a SKU added to the
 * fixture must move it. If the totals were ever hardcoded to match, the row
 * would quietly stop agreeing with the rows above it, which on a money page is
 * the worst possible failure.
 *
 * The THREE BUCKETS. The pillar's argument is that money leaving the bill next
 * invoice, money that can only leave at renewal, and value that never leaves the
 * bill at all are three different things. The third bucket deliberately carries
 * no annualised figure — annualising it would imply a saving that does not
 * exist.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { trendGeometry } from "./DriftTrend";
import { playbookFor } from "./fixPanelLibrary";
import {
  LIC_ACK,
  LIC_ACK_COUNT,
  LIC_BUCKETS,
  LIC_FINDINGS,
  LIC_FINDING_COUNT,
  LIC_HERO,
  LIC_HERO_STATS,
  LIC_LEDGER,
  LIC_POLICY,
  LIC_PROV,
  LIC_SAVED_HISTORY,
  LIC_SKUS,
  LIC_TOTALS,
  licAckMeta,
  licFmt,
  licSkuGeometry,
  licTrendGeometry,
} from "./licDashboardData";

describe("Licensing hero", () => {
  it("scores 71 with a POSITIVE delta — the only pillar where it is", () => {
    assert.equal(LIC_HERO.score, 71);
    assert.equal(LIC_HERO.delta, "+3 this month");
  });

  it("leads with a figure and an eyebrow, not a title and a status", () => {
    assert.equal(LIC_HERO.eyebrow, "Money on the table");
    assert.equal(LIC_HERO.onTable, "$2,679");
    // There is deliberately no "Licensing Health" title anywhere in the fixture.
    assert.equal("title" in LIC_HERO, false);
    assert.equal("statusLabel" in LIC_HERO, false);
  });

  it("renders the renewal date as prose, not as a figure", () => {
    const renewal = LIC_HERO_STATS.find((s) => s.label === "Next renewal")!;
    assert.equal(renewal.value, "14 March 2027");
    assert.equal(renewal.small, true);
    // The other two are figures and must NOT get the prose treatment.
    LIC_HERO_STATS.filter((s) => s.label !== "Next renewal").forEach((s) =>
      assert.notEqual(s.small, true),
    );
  });
});

describe("Licensing trend — its own maths, deliberately", () => {
  it("anchors the floor at zero rather than padding the domain", () => {
    const t = licTrendGeometry();
    // The series starts at 0, so the first point sits exactly on the baseline.
    assert.equal(t.line.split(" ")[0], "0,84");
    assert.equal(t.h, 84);
    assert.equal(t.lastX, 280);
    // The ceiling is max * 1.12, so the last point sits 12% below the top:
    // 84 - (4100 / 4592) * 84 = 9.
    assert.equal(t.lastY, 9);
  });

  it("differs from the shared geometry on the SAME data — this is the point", () => {
    const shared = trendGeometry(LIC_SAVED_HISTORY);
    const own = licTrendGeometry();
    assert.notEqual(shared.line.split(" ")[0], own.line.split(" ")[0]);
    // The shared helper pads the floor to min-3 = -3, lifting the zero point off
    // the baseline. On a cumulative series that reads as "we started below zero".
    assert.notEqual(shared.lastY, own.lastY);
  });

  it("only ever rises, because the series is cumulative", () => {
    for (let i = 1; i < LIC_SAVED_HISTORY.length; i++) {
      assert.ok(
        LIC_SAVED_HISTORY[i] >= LIC_SAVED_HISTORY[i - 1],
        `cumulative recovered fell between scan ${i} and ${i + 1}`,
      );
    }
    assert.equal(LIC_SAVED_HISTORY[LIC_SAVED_HISTORY.length - 1], 4100);
  });
});

describe("The three recovery buckets", () => {
  it("keeps reassignable value separate, with NO annualised figure", () => {
    assert.equal(LIC_BUCKETS.length, 3);
    const reassignable = LIC_BUCKETS.find((b) => b.label === "Reassignable now")!;
    // Annualising this would imply a saving. It is value already paid for.
    assert.equal(reassignable.annual, "value already paid");
    assert.equal(reassignable.when, "34 people waiting");
    // The other two DO annualise, because they genuinely leave the bill.
    LIC_BUCKETS.filter((b) => b.label !== "Reassignable now").forEach((b) =>
      assert.match(b.annual, /\/yr$/),
    );
  });

  it("labels each bucket with when it reaches the bill, not just how much", () => {
    assert.equal(LIC_BUCKETS[0].when, "Next invoice");
    assert.equal(LIC_BUCKETS[1].when, LIC_HERO.renewal);
  });
});

describe("The licence ledger", () => {
  it("sums its totals from the rows rather than stating them", () => {
    // 430 bought, 382 assigned, 323 active — the two gaps ARE the page: 48
    // seats bought and never handed out, and another 59 handed out and unused.
    assert.equal(LIC_TOTALS.purchased, 430);
    assert.equal(LIC_TOTALS.assigned, 382);
    assert.equal(LIC_TOTALS.active, 323);
    assert.equal(LIC_TOTALS.waste, 3699);
    assert.equal(LIC_TOTALS.purchased - LIC_TOTALS.assigned, 48);
    assert.equal(LIC_TOTALS.assigned - LIC_TOTALS.active, 59);
    // And the sums genuinely come from the rows.
    assert.equal(
      LIC_TOTALS.waste,
      LIC_SKUS.reduce((a, s) => a + s.waste, 0),
    );
  });

  it("measures utilisation against PURCHASED, not assigned", () => {
    const e5 = LIC_SKUS.find((s) => s.part === "SPE_E5")!;
    // 183 active of 240 purchased = 76%. Against assigned (202) it would be 91%,
    // which would make an invoice problem look like a healthy one.
    assert.equal(licSkuGeometry(e5).util, 76);
    const copilot = LIC_SKUS.find((s) => s.part === "Microsoft_365_Copilot")!;
    assert.equal(licSkuGeometry(copilot).util, 55);
  });

  it("renders an em dash rather than $0 where there is no waste", () => {
    const rightSized = LIC_SKUS.filter((s) => s.waste === 0);
    assert.equal(rightSized.length, 2);
    rightSized.forEach((s) => assert.equal(licSkuGeometry(s).wasteLabel, "—"));
    assert.equal(licSkuGeometry(LIC_SKUS[0]).wasteLabel, "$2,280/mo");
  });

  it("formats money with en-US grouping", () => {
    assert.equal(licFmt(2280), "$2,280");
    assert.equal(licFmt(24), "$24");
    assert.equal(licFmt(18720), "$18,720");
  });
});

describe("Recovery items and intentional spend", () => {
  it("carries six recovery items, each annualising to twelve months", () => {
    assert.equal(LIC_FINDING_COUNT, 6);
    LIC_FINDINGS.forEach((f) => {
      assert.match(f.id, /^LIC-0\d$/);
      assert.ok(f.monthly > 0, `${f.id} has no monthly figure`);
      assert.ok(f.timing.length > 0, `${f.id} does not say when it reaches the bill`);
      assert.ok(f.fixKey.startsWith("lic-"));
      assert.ok(f.evidence.length >= 5, `${f.id} has thin evidence`);
    });
  });

  it("keeps two intentional-spend decisions with a four-field finance trail", () => {
    assert.equal(LIC_ACK_COUNT, 2);
    LIC_ACK.forEach((a) => {
      assert.deepEqual(
        licAckMeta(a).map((m) => m.k),
        ["Owner", "Approved", "Next review", "Finance register"],
      );
    });
    // The acknowledged total is what the header strip prints.
    const ackTotal = LIC_ACK.reduce((t, a) => t + a.monthly, 0);
    assert.equal(licFmt(ackTotal), LIC_HERO.ackMonthly);
  });

  it("reviews one decision at a DATE and the other at an EVENT", () => {
    // A2 is reviewed "At gate clearance", not on a calendar date — a review
    // trigger a date-typed field could not express.
    assert.equal(LIC_ACK[1].review, "At gate clearance");
  });

  it("records five savings-ledger entries totalling the recovered figure", () => {
    assert.equal(LIC_LEDGER.length, 5);
    const total = LIC_LEDGER.reduce((t, l) => t + l.amount, 0);
    assert.equal(licFmt(total), LIC_HERO.recoveredTotal);
  });
});

describe("Licensing playbooks", () => {
  it("backs all six recovery items AND all seven policy rows — thirteen in all", () => {
    const keys = new Set([
      ...LIC_FINDINGS.map((f) => f.fixKey),
      ...LIC_POLICY.map((p) => p.fixKey),
    ]);
    assert.equal(keys.size, 13);
    keys.forEach((k) => {
      const p = playbookFor(k);
      assert.notEqual(p.title, "Apply the recommended change", `${k} fell through to the fallback`);
      assert.equal(p.pillarColor, "#14B8A6");
    });
  });

  it("wraps every playbook with the COMMERCE-versus-Graph note, not Compliance's Purview one", () => {
    LIC_FINDINGS.forEach((f) => {
      const steps = playbookFor(f.fixKey).manualSteps;
      assert.match(steps[0].text, /^Licence assignment changes run through Graph/);
      assert.equal(steps[0].link, "https://admin.microsoft.com/#/subscriptions");
      assert.match(steps[steps.length - 1].text, /added to the savings ledger/);
      assert.ok(steps.length >= 6, `${f.fixKey} lost its own manual steps`);
    });
    // And Compliance's wrapper must NOT have leaked onto a licensing playbook.
    assert.doesNotMatch(playbookFor("lic-e5-unassigned").manualSteps[0].text, /Purview/);
  });

  it("keeps the irreversibility warning on the mailbox-deleting playbook", () => {
    assert.match(
      playbookFor("lic-disabled-accounts").riskText,
      /deletes that mailbox 30 days later/,
    );
  });
});

describe("Licensing provenance — the only one on a pillar hero", () => {
  it("traces every figure to a call, and names the one that Graph cannot answer", () => {
    assert.equal(LIC_PROV.length, 8);
    const ps = LIC_PROV.filter((q) => q.src === "ps");
    assert.equal(ps.length, 2);
    assert.match(ps[0].note, /Not exposed in Graph — MSCommerce module only\./);
    // And one derived row, which is where the three-bucket split comes from.
    const derived = LIC_PROV.filter((q) => q.src === "derived");
    assert.equal(derived.length, 1);
    assert.match(derived[0].note, /Billing term is what makes the three different\./);
  });
});
