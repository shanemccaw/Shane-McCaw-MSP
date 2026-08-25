/**
 * adpDashboardData.test.ts — the Adoption fixture, and the two properties that
 * make this pillar behave differently from every other one.
 *
 * The first is `canAutomate`. Four of the six plays cannot be automated, the
 * value flows through the mapper into the fix panel, and forcing it true would
 * put an "Automate via Microsoft Graph" button on a training session. Nothing
 * in the type system stops that, so it is asserted per playbook.
 *
 * The second is the trend domain. Four pillars now use three different domains,
 * and the temptation to consolidate them onto one helper grows with each one —
 * so Adoption's floor-padded-by-four is pinned against both of the others.
 *
 * Also here: a collision check across every per-pillar playbook set. The merged
 * lookup that replaced the `??` chain silently prefers one set over another on a
 * duplicate key, which would be near-impossible to spot on screen.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { trendGeometry } from "./DriftTrend";
import { licTrendGeometry } from "./licDashboardData";
import { PLAYBOOK_SETS, playbookFor } from "./fixPanelLibrary";
import {
  ADP_ENABLERS,
  ADP_HERO,
  ADP_HERO_STATS,
  ADP_HISTORY,
  ADP_KIND_LEGEND,
  ADP_KIND_META,
  ADP_MATRIX,
  ADP_PARKED,
  ADP_PARKED_COUNT,
  ADP_PLAYS,
  ADP_PLAY_COUNT,
  ADP_PROV,
  ADP_WINS,
  ADP_WORKLOADS,
  ADP_WORKLOAD_LIVE_EMPTY,
  adpMatrixCell,
  adpParkedMeta,
  adpPlayFixKey,
  adpTrendGeometry,
  adpWinTier,
  adpWorkloadDetail,
  adpWorkloadsWithLive,
} from "./adpDashboardData";

describe("Adoption play badges — who does the work", () => {
  it("names the delivery model, not the superseded play taxonomy", () => {
    // Round Two: "'Play' meant nothing to anyone reading it. Each item now says
    // who does the work." The badges must not revert to "People play" etc.
    assert.equal(ADP_KIND_META.play.label, "We deliver it · billable");
    assert.equal(ADP_KIND_META.hybrid.label, "We configure it · included");
    assert.notEqual(ADP_KIND_META.play.label, "People play");
  });

  it("agrees with the cost legend it sits under", () => {
    // The badge for a billable play reads the same as the legend's first row.
    assert.equal(ADP_KIND_META.play.label, ADP_KIND_LEGEND[0].label);
    assert.equal(ADP_KIND_META.play.c, ADP_KIND_LEGEND[0].dot);
    assert.equal(ADP_KIND_META.hybrid.c, ADP_KIND_LEGEND[1].dot);
  });
});

describe("Adoption hero", () => {
  it("leads with a sentence, not a score or a figure", () => {
    assert.equal(ADP_HERO.eyebrow, "Where you are");
    assert.match(ADP_HERO.headline, /^You have climbed 27 points in ten scans\./);
    // The standfirst is the pillar's whole disposition, and it is load-bearing.
    assert.match(ADP_HERO.standfirst, /Nothing on this page is a risk and nothing here is failing/);
  });

  it("scores 88 with a green positive delta, and the history agrees", () => {
    assert.equal(ADP_HERO.score, 88);
    assert.equal(ADP_HERO.delta, "+1 this month");
    assert.equal(ADP_HISTORY[ADP_HISTORY.length - 1], ADP_HERO.score);
    assert.equal(ADP_HISTORY[ADP_HISTORY.length - 2], 87);
    // "No month has gone backwards" is a claim the data has to support.
    for (let i = 1; i < ADP_HISTORY.length; i++) {
      assert.ok(ADP_HISTORY[i] >= ADP_HISTORY[i - 1], `scan ${i + 1} went backwards`);
    }
    assert.equal(ADP_HISTORY[ADP_HISTORY.length - 1] - ADP_HISTORY[0], 27);
  });
});

describe("Adoption trend — a third distinct domain", () => {
  it("pads the FLOOR by four and the ceiling by three", () => {
    const t = adpTrendGeometry();
    // Domain [61-4, 88+3] = [57, 91], a span of 34. First point 61 sits at
    // 84 - (4/34)*84 = 74.1; the last at 84 - (31/34)*84 = 7.4.
    assert.equal(t.line.split(" ")[0], "0,74.1");
    assert.equal(t.lastY, 7.4);
  });

  it("is NOT the shared helper, and NOT Licensing's either", () => {
    const shared = trendGeometry(ADP_HISTORY);
    const own = adpTrendGeometry();
    // The shared helper pads both ends by 3, so the first point differs.
    assert.notEqual(shared.line.split(" ")[0], own.line.split(" ")[0]);
    // And Licensing's anchors at zero, which on this series would put the whole
    // line in the top third of the frame.
    assert.notEqual(licTrendGeometry().line.split(" ")[0], own.line.split(" ")[0]);
  });
});

describe("Workloads and the department heatmap", () => {
  /**
   * A REAL INCONSISTENCY IN THE PROTOTYPE'S OWN DATA, pinned rather than papered
   * over. The hero stat reads "6 of 10" with the sub "Above 50% of licensed
   * users" (proto 3283-3284), and the workload table beneath it lists ten rows
   * of which only FIVE are above 50: 98, 94, 81, 60, 55. The next highest is
   * Teams channels at 38, so no threshold between 39 and 50 yields six either.
   *
   * Both numbers are the prototype's own copy, so neither is "fixed" here —
   * bending the table to match the stat would falsify tenant data, and bending
   * the stat would rewrite final copy. The table is asserted as the source of
   * truth and the mismatch is flagged for Shane, exactly as the Licensing pound
   * sign was.
   */
  it("lists ten workloads, five of them above 50% — NOT the hero's '6 of 10'", () => {
    assert.equal(ADP_WORKLOADS.length, 10);
    const aboveHalf = ADP_WORKLOADS.filter((w) => w.active > 50);
    assert.equal(aboveHalf.length, 5);
    assert.deepEqual(
      aboveHalf.map((w) => w.active),
      [98, 94, 81, 60, 55],
    );
    // And no threshold in the gap produces six, so it is not an off-by-one on
    // the comparison operator.
    assert.equal(ADP_WORKLOADS.filter((w) => w.active >= 50).length, 5);
    assert.equal(ADP_WORKLOADS.filter((w) => w.active >= 39).length, 5);
    // The stat the page prints, unchanged, so the mismatch stays visible.
    assert.equal(ADP_HERO_STATS[0].value, "6 of 10");
    assert.equal(ADP_WORKLOADS.filter((w) => w.active === 0).length, 1);
  });

  it("bands the heatmap at 70 and 45, and steps the BACKGROUND alpha too", () => {
    assert.deepEqual(adpMatrixCell(71), { c: "#34d399", alpha: "1f" });
    assert.deepEqual(adpMatrixCell(70), { c: "#34d399", alpha: "1f" });
    assert.deepEqual(adpMatrixCell(69), { c: "#fb923c", alpha: "18" });
    assert.deepEqual(adpMatrixCell(45), { c: "#fb923c", alpha: "18" });
    assert.deepEqual(adpMatrixCell(44), { c: "#f87171", alpha: "14" });
    assert.deepEqual(adpMatrixCell(7), { c: "#f87171", alpha: "14" });
  });

  it("supports the matrix note's claim about the bottom three departments", () => {
    const byDept = Object.fromEntries(ADP_MATRIX.rows.map((r) => [r.dept, r.vals]));
    // Finance, Operations and Legal are bottom on Copilot specifically, which is
    // the column the note leans on hardest.
    const copilot = ADP_MATRIX.rows
      .map((r) => ({ dept: r.dept, v: r.vals[2] }))
      .sort((a, b) => a.v - b.v)
      .slice(0, 3)
      .map((x) => x.dept);
    assert.deepEqual(copilot.sort(), ["Finance", "Legal", "Operations"]);
    assert.equal(byDept.Legal[2], 7);
  });
});

describe("Plays — the canAutomate property", () => {
  it("carries six plays, two of which have a real technical enabler", () => {
    assert.equal(ADP_PLAY_COUNT, 6);
    const automatable = ADP_PLAYS.filter((p) => p.canAutomate);
    assert.equal(automatable.length, 2);
    assert.deepEqual(
      automatable.map((p) => p.id),
      ["ADP-02", "ADP-06"],
    );
    // Which is exactly what the hero stat claims: "2 with a technical enabler,
    // 4 people-led".
    assert.equal(ADP_PLAYS.length - automatable.length, 4);
  });

  it("marks each play as a people play or a policy+play, matching canAutomate", () => {
    ADP_PLAYS.forEach((p) => {
      // Every hybrid is not necessarily automatable, but every automatable one
      // IS a hybrid — a "people play" with a switch to throw is a contradiction.
      if (p.canAutomate) assert.equal(p.kind, "hybrid", `${p.id} automates but is a people play`);
    });
  });

  it("PROPAGATES canAutomate into the playbook, rather than forcing it true", () => {
    ADP_PLAYS.forEach((p) => {
      const book = playbookFor(adpPlayFixKey(p));
      assert.notEqual(book.title, "Apply the recommended change", `${p.id} hit the fallback`);
      assert.equal(
        book.canAutomate,
        p.canAutomate,
        `${p.id}: playbook canAutomate ${book.canAutomate} != play ${p.canAutomate}`,
      );
    });
    // And the four people plays genuinely say so in their first manual step.
    const peoplePlay = playbookFor("adp-adp-01");
    assert.match(peoplePlay.manualSteps[0].text, /^This is a people play, not a write action/);
    assert.equal(peoplePlay.manualSteps[0].link, undefined);
    const enabler = playbookFor("adp-adp-02");
    assert.match(enabler.manualSteps[0].text, /^This one has a real technical enabler/);
  });

  it("closes on a monthly rhythm rather than asking for a re-scan", () => {
    const steps = playbookFor("adp-adp-03").manualSteps;
    assert.match(steps[steps.length - 1].text, /Adoption moves on a monthly rhythm, not on a re-scan/);
  });

  it("reuses the OneDrive play's playbook for the Copilot-prerequisites enabler", () => {
    const prereq = ADP_ENABLERS.find((e) => e.name === "Copilot prerequisites")!;
    assert.equal(prereq.fixKey, "adp-adp-02");
    // Not a slip: the prerequisite IS the OneDrive rollout, so it resolves to
    // the same playbook the play itself opens.
    assert.equal(playbookFor(prereq.fixKey).title, playbookFor(adpPlayFixKey(ADP_PLAYS[1])).title);
  });

  it("backs every enabler with a real playbook", () => {
    assert.equal(ADP_ENABLERS.length, 6);
    ADP_ENABLERS.forEach((e) => {
      assert.notEqual(
        playbookFor(e.fixKey).title,
        "Apply the recommended change",
        `${e.fixKey} hit the fallback`,
      );
    });
  });
});

describe("Parked plays", () => {
  it("records two, each with a THREE-field trail, not four", () => {
    assert.equal(ADP_PARKED_COUNT, 2);
    ADP_PARKED.forEach((p) => {
      assert.deepEqual(
        adpParkedMeta(p).map((m) => m.k),
        ["Owner", "Revisit", "Register"],
      );
      // Every parked play must state what parking it costs, in upside terms.
      assert.ok(p.cost.length > 0);
    });
    // And both make the no-risk claim explicitly rather than implying it.
    assert.match(ADP_PARKED[0].cost, /Nothing degrades and nothing is exposed/);
  });

  it("revisits one at a DATE and the other at a CONTRACT EVENT", () => {
    assert.equal(ADP_PARKED[0].revisit, "Q1 2027 planning");
    assert.equal(ADP_PARKED[1].revisit, "When the LOB contract renews, March 2027");
  });
});

describe("Workload expansion — derived, not typed", () => {
  it("draws the Counted fact from the first three words of the population line", () => {
    const exchange = ADP_WORKLOADS.find((w) => w.name === "Exchange / Outlook")!;
    const d = adpWorkloadDetail(exchange);
    assert.deepEqual(d.facts, [
      { k: "Active", v: "98%" },
      { k: "Counted", v: "1,215 of 1,240" },
      { k: "Window", v: "30 days" },
    ]);
    // The reading joins the population line and the reading with a full stop, so
    // the expansion cannot disagree with the count it is drawn from.
    assert.equal(
      d.reading,
      "1,215 of 1,240 sent or read mail in 30 days. The 25 who did not are shared and resource mailboxes, which is correct.",
    );
    assert.equal(d.src, "getEmailActivityUserDetail(period=D30)");
  });

  it("gives every workload a source and a reading, none blank", () => {
    ADP_WORKLOADS.forEach((w) => {
      const d = adpWorkloadDetail(w);
      assert.ok(d.src.length > 0, `${w.name} has no source`);
      assert.ok(d.reading.startsWith(w.of), `${w.name} reading dropped its population line`);
    });
  });
});

describe("#1252 — live workload overlay", () => {
  it("leaves every row on fixture when nothing has resolved", () => {
    const rows = adpWorkloadsWithLive(ADP_WORKLOAD_LIVE_EMPTY);
    assert.deepEqual(rows, ADP_WORKLOADS);
  });

  it("overlays Exchange, Teams, SharePoint and OneDrive independently", () => {
    const rows = adpWorkloadsWithLive({
      ...ADP_WORKLOAD_LIVE_EMPTY,
      exchangeActive: 900,
      exchangeLicensed: 1000,
      // Teams left null on purpose — proves a partial payload overlays only
      // the rows that genuinely resolved rather than guessing the rest.
    });
    assert.equal(rows[0].active, 90);
    assert.equal(rows[0].tone, "green");
    assert.equal(rows[0].of, "900 of 1,000 sent or read mail in the last 7 days");
    assert.equal(rows[0].src, "getEmailActivityUserDetail(period=D7)");
    assert.equal(rows[0].window, "7 days");
    // Untouched rows stay byte-identical to the fixture.
    assert.deepEqual(rows[1], ADP_WORKLOADS[1]);
    assert.deepEqual(rows[2], ADP_WORKLOADS[2]);
    assert.deepEqual(rows[3], ADP_WORKLOADS[3]);
  });

  it("states SharePoint honestly as per-site, never per-user", () => {
    const rows = adpWorkloadsWithLive({
      ...ADP_WORKLOAD_LIVE_EMPTY,
      sharePointActive: 40,
      sharePointScanned: 50,
    });
    assert.equal(rows[2].active, 80);
    assert.match(rows[2].of, /sites had a recently active owner/);
    assert.match(rows[2].src, /per site, not per user/);
  });

  it("folds the sync-errors proxy into the OneDrive row's note and reading", () => {
    const withStale = adpWorkloadsWithLive({
      ...ADP_WORKLOAD_LIVE_EMPTY,
      oneDriveActive: 150,
      oneDriveScanned: 200,
      oneDriveStaleSync: 12,
    });
    assert.equal(withStale[3].active, 75);
    assert.equal(withStale[3].tone, "green");
    assert.equal(withStale[3].of, "150 of 200 accounts active in the last 7 days");
    assert.match(withStale[3].note, /^12 account\(s\) show no OneDrive sync activity/);
    assert.match(withStale[3].reading, /client-side sync-health proxy, not a literal error read/);

    const zeroStale = adpWorkloadsWithLive({
      ...ADP_WORKLOAD_LIVE_EMPTY,
      oneDriveActive: 150,
      oneDriveScanned: 200,
      oneDriveStaleSync: 0,
    });
    assert.equal(zeroStale[3].note, "No accounts show stale OneDrive sync activity in the last 30 days.");
  });

  it("bands live tone the same way the department heatmap does (70 / 45)", () => {
    const rows = adpWorkloadsWithLive({
      ...ADP_WORKLOAD_LIVE_EMPTY,
      teamsActive: 44,
      teamsLicensed: 100,
    });
    assert.equal(rows[1].active, 44);
    assert.equal(rows[1].tone, "red");
  });

  it("never divides by a zero or missing denominator", () => {
    const rows = adpWorkloadsWithLive({
      ...ADP_WORKLOAD_LIVE_EMPTY,
      exchangeActive: 5,
      exchangeLicensed: 0,
    });
    assert.deepEqual(rows[0], ADP_WORKLOADS[0]);
  });
});

describe("Wins are sized by how far each one moved", () => {
  it("weighs a multiplier at 12× and tiers ≥40 / ≥18", () => {
    // "4.3×" weighs 51.6 → the biggest box; "+34%" weighs 34 → the middle.
    assert.equal(adpWinTier("4.3×"), 2);
    assert.equal(adpWinTier("+34%"), 1);
    assert.equal(adpWinTier("+16 pts"), 0);
    // The regex only catches ×, pt and % — a "people" delta weighs zero and
    // sits at the base tier, which is the prototype's own behaviour, pinned so a
    // future "smarter" parser cannot silently resize the boxes.
    assert.equal(adpWinTier("+19 people"), 0);
    // Exactly one win reaches the top tier on this fixture.
    assert.equal(ADP_WINS.filter((w) => adpWinTier(w.delta) === 2).length, 1);
  });
});

describe("Wins and provenance", () => {
  it("measures six wins, each with a from, a to and a when", () => {
    assert.equal(ADP_WINS.length, 6);
    ADP_WINS.forEach((w) => {
      assert.ok(w.from && w.to && w.when && w.delta, `${w.what} is missing a field`);
    });
  });

  it("says plainly that the score excludes parked plays rather than failing them", () => {
    const derived = ADP_PROV.filter((q) => q.src === "derived");
    assert.equal(derived.length, 1);
    assert.match(derived[0].note, /a parked play is excluded rather than counted as failure/);
  });

  it("reads usage, never surveys", () => {
    assert.equal(ADP_PROV.length, 9);
    assert.equal(ADP_PROV.filter((q) => q.src === "graph").length, 6);
    assert.equal(ADP_PROV.filter((q) => q.src === "ps").length, 2);
  });
});

describe("Playbook registry", () => {
  it("has no key colliding between two pillars", () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const [pillar, set] of Object.entries(PLAYBOOK_SETS)) {
      for (const key of Object.keys(set)) {
        const prior = seen.get(key);
        if (prior) collisions.push(`${key}: ${prior} vs ${pillar}`);
        else seen.set(key, pillar);
      }
    }
    // The merged lookup that replaced the `??` chain silently prefers one set
    // on a duplicate, which would show up as the wrong pillar colour and the
    // wrong wrapper text — and nothing else.
    assert.deepEqual(collisions, []);
  });
});
