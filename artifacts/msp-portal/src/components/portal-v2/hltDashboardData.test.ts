/**
 * hltDashboardData.test.ts — the Health fixture, plus the two cross-pillar
 * checks that only become possible now all six pillars exist.
 *
 * Health's own risk is arithmetic that agrees with prose: the hero stats quote
 * "78" and "10 of 47", and both are SUMS over the tables below them. If a row is
 * added or a tone flipped, the stat has to move with it or the page contradicts
 * itself in the reader's eye-line.
 *
 * The cross-pillar checks are the point of doing this last:
 *  • Every trend domain across the six pillars is asserted DISTINCT where it is
 *    distinct, so a future "let's share one helper" refactor has to argue with a
 *    test rather than a comment.
 *  • Health's drift table routes wrenches at other pillars' playbooks. Those
 *    that resolve are asserted to resolve; those that fall to the fallback are
 *    listed EXPLICITLY, so the list shrinks visibly as later pillars land rather
 *    than being forgotten.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { trendGeometry } from "./DriftTrend";
import { playbookFor } from "./fixPanelLibrary";
import { licTrendGeometry } from "./licDashboardData";
import { adpTrendGeometry } from "./adpDashboardData";
import {
  HLT_ACCEPTED,
  HLT_DEBT_HISTORY,
  HLT_DEBT_OBJECT_CLASSES,
  HLT_DEBT_OBJECT_TOTAL,
  HLT_DRIFT,
  HLT_DRIFT_ALERTS,
  HLT_DRIFT_APPROVED,
  HLT_DRIFT_COUNT,
  HLT_FINDINGS,
  HLT_FINDING_COUNT,
  HLT_HERO,
  HLT_HERO_STATS,
  HLT_OBJECTS,
  HLT_OBJECT_TOTAL,
  HLT_PROV,
  HLT_SERVICE,
  HLT_SEV_META,
  HLT_SYNC,
  HLT_VERDICT,
  hltAcceptedMeta,
  hltAcceptedStripSuffix,
  hltDriftOwner,
  hltDriftRows,
  hltHeroStatsWithObjectTotal,
  hltObjectTotalFor,
  hltObjectsWithLive,
  hltTrendGeometry,
} from "./hltDashboardData";

// Mirrors useHltObjectsLive.ts's HLT_OBJECTS_LIVE_EMPTY shape without
// importing that hook module — it pulls in @/lib/auth-context, which needs a
// path-alias resolver this plain node:test runner (unlike the other portal-v2
// data-file tests it sits beside) does not have configured.
const NO_LIVE = { staleDeviceRecordCount: null, duplicateDeviceRecordCount: null, expiredCredentialCount: null };

describe("Health hero", () => {
  it("scores 66 with a RED delta — debt is trending the wrong way", () => {
    assert.equal(HLT_HERO.score, 66);
    assert.equal(HLT_HERO.delta, "-2 this month");
  });

  // #1273: the strip must never state the fixture's specific "AD FS retained"
  // claim once real findings exist, and must never fabricate a generic filler
  // in their place either — it is the worst real finding's own title, or the
  // fixture sentence only when there is genuinely no live finding to report.
  it("accepted strip states the worst REAL finding, never the AD FS text, once one exists", () => {
    assert.equal(
      hltAcceptedStripSuffix("Legacy authentication remains enabled tenant-wide"),
      "accepted risk on record · Legacy authentication remains enabled tenant-wide",
    );
  });

  it("accepted strip falls back to the fixture sentence with no live finding", () => {
    assert.equal(hltAcceptedStripSuffix(null), HLT_HERO.acceptedStripSuffix);
    assert.equal(hltAcceptedStripSuffix(undefined), HLT_HERO.acceptedStripSuffix);
    assert.equal(HLT_HERO.acceptedStripSuffix, "accepted risk on record · AD FS retained");
  });

  it("names the OTHER thing called health in its back link — the only pillar that does", () => {
    // The current design disambiguates with the back link and the locator row
    // only; the earlier prose banner (bannerTitle/bannerScoreNote/HLT_BANNER_BODY)
    // is not in the shell and is intentionally not reproduced.
    assert.equal(HLT_HERO.backLabel, "M365 Health overview");
  });

  /**
   * TWO OBJECT COUNTS, both correct. The hero binds the sum of all nine
   * inventory classes (166); HLT-05 and the trend quote 78, the same inventory
   * minus the three classes that have their own debt items. Getting this wrong
   * is easy — the first transcription hardcoded 78 in the hero, which the sum
   * assertion caught. Both are pinned so neither can drift into the other.
   */
  it("binds the hero's object count to the FULL inventory sum, not the debt subset", () => {
    assert.equal(HLT_OBJECT_TOTAL, 166);
    assert.equal(HLT_HERO_STATS[1].value, "166");
    assert.equal(HLT_HERO_STATS[1].sub, "Across 9 object classes, no cleanup rule");
    assert.equal(HLT_DRIFT_COUNT, 10);
    assert.equal(HLT_HERO_STATS[2].value, "10 of 47");
    // The sync stat quotes the same 14 the sync table reports.
    assert.equal(HLT_HERO_STATS[0].value, "14 errors");
    assert.ok(HLT_SYNC.some((s) => s.state === "14 objects"));
  });

  it("computes the DEBT subset as 78, and the headline's arithmetic follows", () => {
    // The five classes with no debt item of their own: 31+9+14+18+6.
    assert.equal(HLT_DEBT_OBJECT_TOTAL, 78);
    assert.equal(HLT_DEBT_OBJECT_CLASSES.length, 5);
    // Which is exactly where the trend series ends.
    assert.equal(HLT_DEBT_HISTORY[9], HLT_DEBT_OBJECT_TOTAL);
    // "cleared 57 objects across scans 1 to 8" — 128 down to 71.
    assert.equal(HLT_DEBT_HISTORY[0] - HLT_DEBT_HISTORY[7], 57);
    // "The last two scans added 7 back" — 71 up to 78.
    assert.equal(HLT_DEBT_HISTORY[9] - HLT_DEBT_HISTORY[7], 7);
    // And HLT-05's title quotes the debt subset, not the inventory total.
    assert.match(HLT_FINDINGS[4].title, /^78 stale technical objects/);
  });
});

describe("Health trend — the inverted series", () => {
  it("pads the floor by EIGHT and the ceiling by six", () => {
    const t = hltTrendGeometry();
    // Domain [71-8, 128+6] = [63, 134], a span of 71. First point 128 sits at
    // 84 - (65/71)*84 = 7.1; the last (78) at 84 - (15/71)*84 = 66.3.
    assert.equal(t.line.split(" ")[0], "0,7.1");
    assert.equal(t.lastY, 66.3);
  });

  it("falls on screen because the NUMBER falls — lower is better here", () => {
    const t = hltTrendGeometry();
    const firstY = Number(t.line.split(" ")[0].split(",")[1]);
    // Debt dropped 128 -> 78, so on a lower-is-better axis the line moves DOWN
    // the screen. Every other pillar's improving line moves up.
    assert.ok(t.lastY > firstY, "expected the debt line to fall on screen");
    assert.equal(HLT_HERO.trendLabel, "Open debt items · lower is better");
    assert.match(HLT_HERO.trendCaption, /red because the direction changed, not because the number is high/);
  });
});

describe("Health tables", () => {
  it("lists eight sync stages, only one of them green", () => {
    assert.equal(HLT_SYNC.length, 8);
    assert.equal(HLT_SYNC.filter((s) => s.tone === "green").length, 1);
    assert.equal(HLT_SYNC.find((s) => s.tone === "green")!.stage, "Password hash sync");
  });

  it("inventories nine object classes, every one with a wrench", () => {
    assert.equal(HLT_OBJECTS.length, 9);
    HLT_OBJECTS.forEach((o) => assert.ok(o.fixKey.length > 0, `${o.type} has no fixKey`));
  });

  it("tracks twelve drift rows, two of them green and therefore not counted", () => {
    assert.equal(HLT_DRIFT.length, 12);
    const green = HLT_DRIFT.filter((d) => d.tone === "green");
    assert.equal(green.length, 2);
    // A green row is at baseline, so it has no wrench and no actor.
    green.forEach((d) => {
      assert.equal(d.fixKey, null);
      assert.equal(d.who, "—");
    });
    // Two rows are honestly unattributable rather than guessed.
    assert.equal(HLT_DRIFT.filter((d) => d.who === "Unknown — pre-baseline").length, 2);
  });

  it("uses its OWN severity vocabulary, and the only three-band scale", () => {
    assert.equal(HLT_SEV_META.high.label, "Degrading");
    assert.equal(HLT_SEV_META.medium.label, "Accruing");
    assert.equal(HLT_SEV_META.low.label, "Housekeeping");
    assert.equal(HLT_FINDING_COUNT, 6);
    // All three bands are actually used, or the third would be decorative.
    const bands = new Set(HLT_FINDINGS.map((f) => f.sev));
    assert.equal(bands.size, 3);
  });

  it("records one accepted risk, reviewed against a roadmap not a date", () => {
    assert.equal(HLT_ACCEPTED.length, 1);
    const a = HLT_ACCEPTED[0];
    assert.equal(a.title, "AD FS retained alongside cloud authentication");
    // "Accepted", not "Approved" — this pillar's own label for the same field.
    assert.deepEqual(
      hltAcceptedMeta(a).map((m) => m.k),
      ["Owner", "Accepted", "Next review", "Risk register"],
    );
    assert.match(a.note, /vendor roadmap rather than a calendar date/);
  });

  it("carries five service items and eight provenance rows", () => {
    assert.equal(HLT_SERVICE.length, 5);
    assert.equal(HLT_PROV.length, 8);
    // Two reads genuinely cannot run from the container.
    assert.equal(HLT_PROV.filter((q) => q.src === "ps").length, 2);
    assert.match(HLT_PROV[0].scope, /Local admin on the sync server/);
  });
});

describe("Health configuration drift — verdict sort and owners", () => {
  it("sorts the unexplained changes to the top, the clean rows to the bottom", () => {
    const rows = hltDriftRows();
    assert.equal(rows.length, 12);
    // Groups are 0 (alerts) → 1 (approved) → 2 (accepted) → 3 (clean), and the
    // sort is stable so declared order survives inside a group.
    const groups = rows.map((r) => HLT_VERDICT[r.verdict].group);
    assert.deepEqual(
      groups,
      [...groups].sort((a, b) => a - b),
      "verdict groups are not in ascending order",
    );
    // The first row is an alert; the last two are the clean baseline rows.
    assert.equal(rows[0].isAlert, true);
    assert.equal(rows[0].setting, "DefaultSharingLinkType");
    assert.equal(rows[10].verdict, "clean");
    assert.equal(rows[11].verdict, "clean");
  });

  it("counts alerts and change-record rows the way the header reports them", () => {
    // "7 changed with no request behind them · 3 tied to a change record".
    assert.equal(HLT_DRIFT_ALERTS, 7);
    assert.equal(HLT_DRIFT_APPROVED, 3);
    const rows = hltDriftRows();
    assert.equal(rows.filter((r) => r.isAlert).length, HLT_DRIFT_ALERTS);
    assert.equal(rows.filter((r) => r.hasCr).length, HLT_DRIFT_APPROVED);
    // Only the three rows with a CR carry a change-record note.
    rows.filter((r) => r.hasCr).forEach((r) => assert.ok(r.crNote && r.crNote.length > 0));
    // An alert row is a group-0 verdict, and the three of those are the finding.
    assert.deepEqual(
      [...new Set(rows.filter((r) => r.isAlert).map((r) => r.verdict))].sort(),
      ["drifted", "unapproved", "unattributed"],
    );
  });

  it("resolves every drift owner to an honest Unassigned — no tenant has a RACI roster (Git #1342)", () => {
    // The fictional Halden roster (Priya Raman, Shane McCaw, Marcus Lee, Aisha
    // Bello) was purged from HLT_DRIFT_PEOPLE; there is no ownership/RACI table
    // for any tenant, so every drift row — and any unknown id — resolves to the
    // honest unassigned chip rather than an invented name.
    const unassigned = { init: "—", name: "Unassigned", tone: "rgba(248,113,113,.14)" };
    assert.deepEqual(hltDriftOwner("pr"), unassigned);
    assert.deepEqual(hltDriftOwner("zz"), unassigned);
    hltDriftRows().forEach((r) =>
      assert.equal(hltDriftOwner(r.owner).name, "Unassigned", `${r.setting} should be Unassigned`),
    );
  });

  it("labels the verdicts in the pillar's own words", () => {
    assert.equal(HLT_VERDICT.unapproved.label, "Changed without approval");
    assert.equal(HLT_VERDICT.unattributed.label, "Nobody owns this change");
    assert.equal(HLT_VERDICT.drifted.label, "Drifted on its own");
    assert.equal(HLT_VERDICT.clean.lead, "");
  });
});

describe("Health playbooks and cross-pillar routing", () => {
  it("backs all six debt items with a real Health playbook", () => {
    HLT_FINDINGS.forEach((f) => {
      const p = playbookFor(f.fixKey);
      assert.notEqual(p.title, "Apply the recommended change", `${f.fixKey} hit the fallback`);
      assert.equal(p.pillarColor, "#22C55E");
    });
  });

  it("wraps every Health playbook with the CLOUD-versus-LOCAL note", () => {
    HLT_FINDINGS.forEach((f) => {
      const steps = playbookFor(f.fixKey).manualSteps;
      assert.match(steps[0].text, /^Cloud-side work runs through Graph from the container/);
      assert.match(steps[steps.length - 1].text, /drop out of the debt count on the next scan/);
    });
    // And no other pillar's wrapper leaked in.
    const first = playbookFor("hlt-exchange-eol").manualSteps[0].text;
    assert.doesNotMatch(first, /Purview/);
    assert.doesNotMatch(first, /commerce actions/);
    assert.doesNotMatch(first, /people play/);
  });

  /**
   * Health detects drift and routes the wrench to whichever pillar OWNS the
   * setting. Two of those pillars are built, so those resolve; the rest fall to
   * the generic fallback until their pillar lands. Listing them explicitly means
   * the list shrinks visibly as later work arrives, instead of being forgotten.
   */
  it("resolves cross-pillar drift keys where the owning pillar exists", () => {
    assert.notEqual(playbookFor("cmp-retention-coverage").title, "Apply the recommended change");
    assert.notEqual(playbookFor("cmp-audit-retention").title, "Apply the recommended change");
  });

  it("names exactly which drift keys still fall to the fallback", () => {
    const unresolved = HLT_DRIFT.filter((d) => d.fixKey)
      .map((d) => d.fixKey!)
      .filter((k) => playbookFor(k).title === "Apply the recommended change")
      .sort();
    assert.deepEqual(unresolved, [
      "ca-CA201-AllUsers-AllApps-RequireMFA",
      "ca-CA301-Guests-AllApps-RequireMFA",
      "gov-drift-default-link",
      "gov-drift-reset-sites",
      "gov-guests-invites",
      "legacy-smtp-off",
    ]);
    // Plus the one on the object inventory, which belongs to Security's OAuth page.
    assert.equal(playbookFor("oauth-dormant").title, "Apply the recommended change");
  });
});

describe("Stale object inventory — live overlay (Git #1340)", () => {
  it("returns the SAME array reference when nothing resolved live", () => {
    assert.equal(hltObjectsWithLive(HLT_OBJECTS, NO_LIVE), HLT_OBJECTS);
  });

  it("overlays only the 3 rows with a real, semantically-verified check", () => {
    const live = hltObjectsWithLive(HLT_OBJECTS, {
      staleDeviceRecordCount: 5,
      duplicateDeviceRecordCount: 2,
      expiredCredentialCount: 7,
    });
    assert.notEqual(live, HLT_OBJECTS);
    const byType = Object.fromEntries(live.map((o) => [o.type, o.count]));
    assert.equal(byType["Stale device records"], 5);
    assert.equal(byType["Duplicate device records"], 2);
    assert.equal(byType["Credentials already expired"], 7);
    // The two rows that failed semantic verification (name-match, not a real
    // signal for what the row claims) stay on their fixture counts.
    assert.equal(byType["App registrations with no owner"], 61);
    assert.equal(byType["Credentials expiring in 30 days"], 3);
    // Every other class is untouched.
    assert.equal(byType["Service principals with no sign-in"], 14);
    assert.equal(byType["Empty security groups"], 18);
    assert.equal(byType["Unassigned Intune profiles"], 6);
    assert.equal(byType["Disabled accounts never removed"], 23);
  });

  it("overlays partially when only some fields resolve", () => {
    const live = hltObjectsWithLive(HLT_OBJECTS, { ...NO_LIVE, staleDeviceRecordCount: 40 });
    assert.notEqual(live, HLT_OBJECTS);
    const byType = Object.fromEntries(live.map((o) => [o.type, o.count]));
    assert.equal(byType["Stale device records"], 40);
    assert.equal(byType["Duplicate device records"], 9); // fixture, unresolved
  });

  it("hltObjectTotalFor sums whatever array it's given — fixture or overlaid", () => {
    assert.equal(hltObjectTotalFor(HLT_OBJECTS), HLT_OBJECT_TOTAL);
    const live = hltObjectsWithLive(HLT_OBJECTS, {
      staleDeviceRecordCount: 0,
      duplicateDeviceRecordCount: 0,
      expiredCredentialCount: 0,
    });
    // 166 minus the fixture values of the 3 overlaid rows (31 + 9 + 1), all zeroed.
    assert.equal(hltObjectTotalFor(live), HLT_OBJECT_TOTAL - 31 - 9 - 1);
  });

  it("hltHeroStatsWithObjectTotal only ever touches the Stale objects stat", () => {
    const stats = hltHeroStatsWithObjectTotal(HLT_HERO_STATS, 200);
    assert.equal(stats[0].value, HLT_HERO_STATS[0].value); // Directory sync untouched
    assert.equal(stats[1].value, "200");
    assert.equal(stats[1].sub, HLT_HERO_STATS[1].sub); // sub-label untouched
    assert.equal(stats[2].value, HLT_HERO_STATS[2].value); // Config drift untouched
  });
});

describe("Six pillars, four trend domains", () => {
  it("keeps each pillar's line where its own maths puts it", () => {
    const health = hltTrendGeometry();
    const licensing = licTrendGeometry();
    const adoption = adpTrendGeometry();
    const shared = trendGeometry(HLT_DEBT_HISTORY);

    // Health does not share the ±3 helper Governance/Security/Compliance use.
    assert.notEqual(shared.line.split(" ")[0], health.line.split(" ")[0]);
    // And the three bespoke ones are mutually distinct on their own series.
    const firsts = new Set([
      health.line.split(" ")[0],
      licensing.line.split(" ")[0],
      adoption.line.split(" ")[0],
    ]);
    assert.equal(firsts.size, 3);
  });
});
