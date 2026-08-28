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
  LIC_BUCKET_GAPS,
  LIC_BUCKET_LINES,
  LIC_FINDINGS,
  LIC_FINDING_COUNT,
  LIC_HERO,
  LIC_HERO_STATS,
  LIC_LEDGER,
  LIC_LEDGER_LEGEND,
  LIC_POLICY,
  LIC_PROV,
  LIC_SAVED_HISTORY,
  LIC_SKU_ACTIONS,
  LIC_SKU_TOTALS,
  LIC_SKUS,
  LIC_TOTALS,
  licAckMeta,
  licBucketPanel,
  licFmt,
  licLedgerCards,
  licLedgerCardsFromLive,
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

  it("renders the renewal stat's value as prose sizing, not as a figure — Git #1446: no live value, but the prose SIZING still applies to the honest dash", () => {
    const renewal = LIC_HERO_STATS.find((s) => s.label === "Next renewal")!;
    assert.equal(renewal.small, true);
    assert.ok(renewal.reason.length > 0, "Next renewal must state why there is no live source");
    // The other two are figures and must NOT get the prose treatment.
    LIC_HERO_STATS.filter((s) => s.label !== "Next renewal").forEach((s) =>
      assert.notEqual(s.small, true),
    );
  });

  it("Git #1446: every hero stat states a NO-BACKEND-TO-WIRE reason, since none has a live source", () => {
    LIC_HERO_STATS.forEach((s) => {
      assert.ok(s.reason.length > 10, `${s.label} has no real reason text`);
    });
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

describe("LIC_BUCKET_GAPS — Git #1446's honest replacement, actually rendered", () => {
  it("keeps the same 3 categories in the same order as the retained fixture", () => {
    assert.deepEqual(
      LIC_BUCKET_GAPS.map((b) => b.key),
      LIC_BUCKETS.map((b) => b.key),
    );
    assert.deepEqual(
      LIC_BUCKET_GAPS.map((b) => b.label),
      LIC_BUCKETS.map((b) => b.label),
    );
  });

  it("states a real NO-BACKEND-TO-WIRE reason for every bucket, never a dollar figure", () => {
    LIC_BUCKET_GAPS.forEach((b) => {
      assert.ok(b.reason.length > 10, `${b.key} has no real reason text`);
      assert.doesNotMatch(b.reason, /\$\d/, `${b.key}'s reason must not carry a fabricated dollar figure`);
    });
  });
});

describe("The bucket breakdown panel — 'What that leaves'", () => {
  it("has a breakdown for every bucket key, and no orphans", () => {
    const bucketKeys = LIC_BUCKETS.map((b) => b.key).sort();
    const lineKeys = Object.keys(LIC_BUCKET_LINES).sort();
    assert.deepEqual(lineKeys, bucketKeys);
  });

  it("DERIVES the total from the lines rather than stating it — annual too", () => {
    (["today", "renewal", "reassign"] as const).forEach((key) => {
      const raw = LIC_BUCKET_LINES[key];
      const summed = raw.lines.reduce((a, l) => a + l.amt, 0);
      assert.equal(raw.total, summed, `${key} total drifted from its lines`);
      const panel = licBucketPanel(key)!;
      assert.equal(panel.totalLabel, `${licFmt(raw.total)}/mo`);
      assert.equal(panel.totalAnnual, `${licFmt(raw.total * 12)} a year`);
    });
  });

  it("nets the renewal bucket BELOW its headline, which is the point of the panel", () => {
    // The bucket card shows $2,280 gross; the panel nets the 12 held-for-hiring
    // seats off to $1,560. A held-back line is negative, muted, and rendered
    // with a real minus sign, not a hyphen.
    const panel = licBucketPanel("renewal")!;
    assert.equal(panel.totalLabel, "$1,560/mo");
    assert.equal(panel.totalAnnual, "$18,720 a year");
    const held = panel.lines.find((l) => l.negative)!;
    assert.equal(held.amt, "−$720/mo");
    assert.ok(held.amt.startsWith("−"), "the held-back line must use a minus sign, not a hyphen");
    // The two buckets that genuinely leave the bill carry no negative line.
    assert.equal(licBucketPanel("today")!.lines.some((l) => l.negative), false);
    assert.equal(licBucketPanel("reassign")!.lines.some((l) => l.negative), false);
  });

  it("titles the panel with the bucket's own figure", () => {
    assert.equal(licBucketPanel("today")!.title, "How $399/mo is arrived at");
    assert.equal(licBucketPanel("reassign")!.title, "How $1,470/mo is arrived at");
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

describe("The ledger cards — the consolidated ledger + recovery view", () => {
  it("orders one card per SKU by monthly waste, money at the top", () => {
    const cards = licLedgerCards();
    assert.equal(cards.length, LIC_SKUS.length);
    const wastes = LIC_SKUS.map((s) => s.waste).sort((a, b) => b - a);
    // The E5 gap is the biggest, so it leads; the two right-sized SKUs trail.
    assert.equal(cards[0].part, "SPE_E5");
    assert.equal(cards[cards.length - 1].clean, true);
    // Cards are in descending waste order.
    const orderedByWaste = cards.every((c, i) => {
      if (i === 0) return true;
      const prev = LIC_SKUS.find((s) => s.part === cards[i - 1].part)!.waste;
      const cur = LIC_SKUS.find((s) => s.part === c.part)!.waste;
      return prev >= cur;
    });
    assert.ok(orderedByWaste, "cards are not sorted by descending waste");
    assert.equal(wastes[0], 2280);
  });

  it("builds the counts line, unit and waste strings the design specifies", () => {
    const e5 = licLedgerCards().find((c) => c.part === "SPE_E5")!;
    assert.equal(e5.unit, "$60 / seat");
    assert.equal(e5.counts, "240 bought · 202 assigned · 183 actually using it");
    assert.equal(e5.waste, "$2,280/mo");
    assert.equal(e5.annual, "$27,360 a year");
    // A right-sized SKU says so in words and has nothing to recover.
    const clean = licLedgerCards().find((c) => c.clean)!;
    assert.equal(clean.waste, "Right-sized");
    assert.equal(clean.annual, "nothing to recover");
    assert.equal(clean.hasActions, false);
    assert.equal(clean.actions.length, 0);
  });

  it("splits the utilisation bar into active / idle / unassigned against PURCHASED", () => {
    const e5 = licLedgerCards().find((c) => c.part === "SPE_E5")!;
    // 183 active, 19 idle, 38 unassigned of 240.
    assert.equal(e5.seg.active.pct, (183 / 240) * 100);
    assert.equal(e5.seg.idle.pct, (19 / 240) * 100);
    assert.equal(e5.seg.free.pct, (38 / 240) * 100);
    assert.equal(e5.seg.idle.show, true);
    assert.equal(e5.seg.free.show, true);
    // A label appears only when the segment clears 12% of the bar: 183 and 38 do,
    // 19 does not.
    assert.equal(e5.seg.active.label, "183");
    assert.equal(e5.seg.idle.label, "");
    assert.equal(e5.seg.free.label, "38");
  });

  it("attaches the recovery action to the SKU it belongs to, with a real playbook", () => {
    const e5 = licLedgerCards().find((c) => c.part === "SPE_E5")!;
    // The E5 gap carries TWO actions: unassigned seats and disabled-account seats.
    assert.deepEqual(
      e5.actions.map((a) => a.id),
      ["LIC-01", "LIC-03"],
    );
    assert.equal(e5.actions[0].money, "$1,560/mo");
    // The Copilot card routes to the real reassign playbook, not the design's
    // non-existent `lic-copilot-idle` key.
    const copilot = licLedgerCards().find((c) => c.part === "Microsoft_365_Copilot")!;
    assert.equal(copilot.actions[0].fixKey, "lic-copilot-reassign");
    assert.equal(copilot.actions[0].money, "$810/mo");
    // Every card action points at a playbook that resolves.
    licLedgerCards()
      .flatMap((c) => c.actions)
      .forEach((a) =>
        assert.notEqual(
          playbookFor(a.fixKey).title,
          "Apply the recommended change",
          `${a.fixKey} fell through to the fallback`,
        ),
      );
  });

  it("renders the header totals string from the summed rows", () => {
    assert.equal(LIC_SKU_TOTALS.purchased, "430");
    assert.equal(LIC_SKU_TOTALS.active, "323");
    assert.equal(LIC_SKU_TOTALS.waste, "$3,699/mo");
    assert.equal(LIC_SKU_TOTALS.purchased, String(LIC_TOTALS.purchased));
    assert.equal(LIC_SKU_TOTALS.waste, `${licFmt(LIC_TOTALS.waste)}/mo`);
  });

  it("names the three bar segments in its legend", () => {
    assert.deepEqual(
      LIC_LEDGER_LEGEND.map((l) => l.label),
      ["using it", "assigned but idle", "assigned to nobody"],
    );
  });

  it("attaches actions to exactly the six SKUs with a recoverable gap", () => {
    // The two right-sized SKUs carry none; every keyed action fixKey is real.
    assert.equal(Object.keys(LIC_SKU_ACTIONS).length, 6);
    Object.values(LIC_SKU_ACTIONS)
      .flat()
      .forEach((a) => assert.ok(a.fixKey.startsWith("lic-"), `${a.id} has a bad fixKey`));
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

describe("licLedgerCardsFromLive — Git #1230 real per-SKU ledger overlay", () => {
  it("renders real rows sorted by monthly waste, with no fabricated action or idle claim", () => {
    const cards = licLedgerCardsFromLive([
      {
        skuPartNumber: "SPB",
        displayName: "Microsoft 365 Business Premium",
        purchased: 25,
        assigned: 18,
        unassigned: 7,
        unitMonthlyPriceCents: 2200,
        monthlyWasteCents: 15400,
        annualWasteCents: 184800,
      },
      {
        skuPartNumber: "SPE_E5",
        displayName: "Microsoft 365 E5",
        purchased: 240,
        assigned: 202,
        unassigned: 38,
        unitMonthlyPriceCents: 5700,
        monthlyWasteCents: 216600,
        annualWasteCents: 2599200,
      },
    ]);

    assert.equal(cards.length, 2);
    // Highest waste first.
    assert.equal(cards[0].part, "SPE_E5");
    assert.equal(cards[0].waste, "$2,166/mo");
    assert.equal(cards[0].counts, "240 bought · 202 assigned");
    // No idle segment — no usage data exists to split assigned from active.
    assert.equal(cards[0].seg.idle.show, false);
    assert.equal(cards[0].seg.free.show, true);
    // No fabricated recovery action.
    assert.equal(cards[0].hasActions, false);
    assert.deepEqual(cards[0].actions, []);
  });

  it("a fully-assigned SKU renders Right-sized with no waste dollar figure", () => {
    const [card] = licLedgerCardsFromLive([
      {
        skuPartNumber: "AAD_PREMIUM",
        displayName: "Entra ID P1",
        purchased: 41,
        assigned: 41,
        unassigned: 0,
        unitMonthlyPriceCents: 600,
        monthlyWasteCents: 0,
        annualWasteCents: 0,
      },
    ]);
    assert.equal(card.waste, "Right-sized");
    assert.equal(card.annual, "nothing to recover");
    assert.equal(card.clean, true);
    assert.equal(card.seg.free.show, false);
  });
});
