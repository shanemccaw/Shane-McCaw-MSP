/**
 * govOversharingData.test.ts — the Overshared SharePoint fixture, pinned to the
 * prototype's own derived values.
 *
 * These are not style assertions. Everything here is a number or a string the
 * page renders on screen, produced by arithmetic transcribed from
 * `Customer Portal Shell.dc.html` — and arithmetic transcribed by hand is
 * exactly the kind of thing that drifts silently on the next edit. A row count
 * that quietly becomes 123 changes the pager, the filter counts and the
 * "N admins" figure on a page whose whole claim is that every number on screen
 * came from the tenant.
 *
 * The pager window is here for the same reason: its rule is the only piece of
 * genuine logic in the shared control, and getting it subtly wrong renders
 * `1 … 2 3 4 … 5`, which no reviewer would catch from a screenshot.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pagerWindow } from "./Pager";
import {
  ACCEPTED_SITES_COUNT,
  ANON_LINKS_PAGE_SIZE,
  GOV_OVER_PAGE_SIZE,
  GOV_OVER_TOTAL,
  OVERSHARING_ANON_LINKS,
  OVERSHARING_SITES,
  OVERSHARING_STATS,
  OVERSHARING_TOP_RISKS,
  SITES_PAGE_SIZE,
  govOverRowsForPage,
} from "./govOversharingData";

describe("Overshared SharePoint — evidence sets", () => {
  it("holds 124 sites: the prototype's 5 written-out plus 119 generated", () => {
    assert.equal(OVERSHARING_SITES.length, 124);
    assert.equal(OVERSHARING_SITES[0].name, "Client Deliverables (SharePoint)");
    assert.equal(OVERSHARING_SITES[4].name, "Q3 Sales Enablement");
  });

  it("ids are the array index, because every accept-risk record keys on them", () => {
    OVERSHARING_SITES.forEach((s, i) => assert.equal(s.id, i));
    OVERSHARING_ANON_LINKS.forEach((l, i) => assert.equal(l.id, i));
  });

  it("site 0 carries 52 admins and 2 guests — the row prints both counts", () => {
    assert.equal(OVERSHARING_SITES[0].admins.length, 52);
    assert.equal(OVERSHARING_SITES[0].guests.length, 2);
    assert.equal(OVERSHARING_SITES[0].admins[0].upn, "alex.rivera@tenant.com");
    assert.equal(OVERSHARING_SITES[0].admins[51].upn, "user48.staff@tenant.com");
  });

  it("the generated block reproduces the prototype's name and file-count arithmetic", () => {
    // i = 0 → GENERATED_SITE_NAMES[0], `#${0+6}`, `((0*7+12)%300)+4` = 16 files.
    const first = OVERSHARING_SITES[5];
    assert.equal(first.name, "Regional Ops #6");
    assert.equal(first.context, "16 files · external link active");
    // i = 3 → index 3 of the 8 names, and Public because 3 % 3 === 0.
    const fourth = OVERSHARING_SITES[8];
    assert.equal(fourth.name, "HR Onboarding #9");
    assert.equal(fourth.visibility, "Public");
  });

  it("exactly one site arrives already risk-accepted", () => {
    assert.equal(ACCEPTED_SITES_COUNT, 1);
    const accepted = OVERSHARING_SITES.filter((s) => s.status === "accepted");
    assert.equal(accepted[0].name, "All-Company Town Hall (Teams)");
    assert.equal(accepted[0].acceptedTerm, "90-day term");
    assert.equal(accepted[0].acceptedOn, "Jun 18, 2026");
  });

  it("holds 95 anonymous links, the first four written out", () => {
    assert.equal(OVERSHARING_ANON_LINKS.length, 95);
    assert.equal(OVERSHARING_ANON_LINKS[0].file, "Q3_Contract_Draft.docx");
    assert.equal(OVERSHARING_ANON_LINKS[0].type, "Edit");
    assert.equal(OVERSHARING_ANON_LINKS[3].status, "expired");
    // i = 0 → 'Regional Ops #6' / 'Report_6.docx', Edit (0%3), expired (0%5).
    assert.equal(OVERSHARING_ANON_LINKS[4].file, "Report_6.docx");
    assert.equal(OVERSHARING_ANON_LINKS[4].type, "Edit");
    assert.equal(OVERSHARING_ANON_LINKS[4].status, "expired");
  });

  it("pages the two lists at the prototype's own sizes", () => {
    assert.equal(SITES_PAGE_SIZE, 8);
    assert.equal(ANON_LINKS_PAGE_SIZE, 6);
    assert.equal(Math.ceil(OVERSHARING_SITES.length / SITES_PAGE_SIZE), 16);
    assert.equal(Math.ceil(OVERSHARING_ANON_LINKS.length / ANON_LINKS_PAGE_SIZE), 16);
  });

  it("the Public filter really narrows the set — 43 of 124", () => {
    const publics = OVERSHARING_SITES.filter((s) => s.visibility === "Public");
    assert.equal(publics.length, 43);
    // Which is why 'HR Onboarding #9' (id 8, page 2 unfiltered) reaches page 1.
    assert.equal(publics.slice(0, 8).some((s) => s.name === "HR Onboarding #9"), true);
  });
});

describe("Overshared SharePoint — stat cards and risks", () => {
  it("names the tenant setting the whole finding hangs on", () => {
    const capability = OVERSHARING_STATS[0];
    assert.equal(capability.label, "Sharing Capability");
    assert.equal(capability.value, "Enabled");
    assert.equal(capability.sub, "ExternalUserAndGuestSharing");
    assert.equal(capability.fixKey, "sharing-capability");
  });

  it("offers a wrench on exactly the two stats the prototype gives one to", () => {
    const withFix = OVERSHARING_STATS.filter((s) => s.showFix).map((s) => s.fixKey);
    assert.deepEqual(withFix, ["sharing-capability", "sharing-drift"]);
  });

  it("carries the five Top Risks verbatim", () => {
    assert.equal(OVERSHARING_TOP_RISKS.length, 5);
    assert.equal(
      OVERSHARING_TOP_RISKS[1],
      "Anonymous links found with edit access, not just view",
    );
  });
});

describe("governance-oversharing-full — the enterprise bulk list", () => {
  it("is 23,412 sites over 1,951 pages of 12", () => {
    assert.equal(GOV_OVER_TOTAL, 23412);
    assert.equal(GOV_OVER_PAGE_SIZE, 12);
    assert.equal(Math.ceil(GOV_OVER_TOTAL / GOV_OVER_PAGE_SIZE), 1951);
  });

  it("synthesises its rows from the page number, not from a held array", () => {
    const p1 = govOverRowsForPage(1);
    assert.equal(p1.length, 12);
    assert.equal(p1[0].name, "Client Deliverables #1");
    assert.equal(p1[0].context, "41 files · external link active · last accessed 2d ago");
    const p2 = govOverRowsForPage(2);
    assert.equal(p2[0].name, "Client Deliverables #13");
    assert.notEqual(p1[0].context, p2[0].context);
  });
});

describe("Pager — the window rule", () => {
  it("shows every page up to seven", () => {
    assert.deepEqual(pagerWindow(1, 7), [1, 2, 3, 4, 5, 6, 7]);
  });

  it("elides only on the side that needs it", () => {
    // Near the start: no leading ellipsis, because page is not > 3.
    assert.deepEqual(pagerWindow(2, 16), [1, 2, 3, "…", 16]);
    // In the middle: both.
    assert.deepEqual(pagerWindow(8, 16), [1, "…", 7, 8, 9, "…", 16]);
    // Near the end: no trailing ellipsis, because page is not < totalPages - 2.
    assert.deepEqual(pagerWindow(15, 16), [1, "…", 14, 15, 16]);
  });

  /**
   * The prototype's thresholds are `page > 3` and `page < totalPages - 2`, but
   * its window only ever spans page ± 1. So at page 4 the leading ellipsis fires
   * while the gap it covers is a single page: `1 · … · 3 4 5 · … · 8` renders
   * '···' exactly where '2' would have fitted. It is cosmetic, it is the
   * prototype's behaviour, and it is identical in every pager in the portal
   * because they all come from the one `buildPager` — so it is transcribed as-is
   * and pinned here rather than quietly corrected on this page alone, which
   * would make this pager the odd one out. Worth raising as a design question;
   * not worth a unilateral divergence.
   */
  it("elides a single page at the threshold — the prototype's own off-by-one", () => {
    assert.deepEqual(pagerWindow(4, 8), [1, "…", 3, 4, 5, "…", 8]);
    assert.deepEqual(pagerWindow(5, 8), [1, "…", 4, 5, 6, "…", 8]);
  });

  it("elides only where more than one page is genuinely hidden, everywhere else", () => {
    const offenders: string[] = [];
    for (let total = 8; total <= 30; total++) {
      for (let page = 1; page <= total; page++) {
        const w = pagerWindow(page, total);
        for (let i = 1; i < w.length - 1; i++) {
          if (w[i] !== "…") continue;
          const before = w[i - 1] as number;
          const after = w[i + 1] as number;
          if (after - before <= 2) offenders.push(`${page}/${total}`);
        }
      }
    }
    // Only the two threshold positions misbehave: page 4 (leading) and
    // page totalPages-3 (trailing). Anything beyond that is a transcription bug.
    const unexpected = offenders.filter((o) => {
      const [p, t] = o.split("/").map(Number);
      return p !== 4 && p !== t - 3;
    });
    assert.deepEqual(unexpected, []);
  });
});
