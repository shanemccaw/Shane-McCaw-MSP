/**
 * licenseGapPurchaseLinks.test.ts — #489, client half.
 *
 * The tiering rule itself is the server's (api-server's
 * `license-gap-purchase-links.test.ts` covers it). What is tested here is the
 * thing that could go wrong on THIS side: a report or a card re-deciding, from
 * whatever subset of checks it happened to see, something the server already
 * decided tenant-wide.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  upgradeOpportunities,
  upgradeOpportunityCallToAction,
  type UnavailableCheck,
} from "./liveReportBlocks.ts";
import type { WireLicenseGapPurchase } from "./journeyModel.ts";
import {
  warRoomUpgradeNote,
  warRoomPillarView,
  WAR_ROOM_PILLAR_VIEW_EMPTY,
} from "../war-room/warRoomPillarStats.ts";

const ADMIN_PATH = "your own Microsoft 365 admin center (admin.microsoft.com → Billing → Purchase products)";

const TIER_2: WireLicenseGapPurchase = {
  tier: 2,
  gappedCategories: ["identity", "compliance"],
  consolidated: false,
  adminCenterPath: ADMIN_PATH,
  recommendations: [
    {
      categoryKeys: ["identity"],
      categoryLabels: ["Identity & privileged access"],
      sku: {
        key: "entra-id-p2",
        name: "Microsoft Entra ID P2",
        url: "https://www.microsoft.com/en-us/security/business/microsoft-entra-pricing",
      },
      checkKeys: ["identity:pim-eligible-roles"],
    },
    {
      categoryKeys: ["compliance"],
      categoryLabels: ["Compliance & data governance"],
      sku: {
        key: "purview-suite",
        name: "Microsoft Purview Suite",
        url: "https://www.microsoft.com/en-us/security/business/purview-suite-pricing",
      },
      checkKeys: ["compliance:missing-labels"],
    },
  ],
};

const TIER_3: WireLicenseGapPurchase = {
  tier: 3,
  gappedCategories: ["identity", "mailSecurity", "compliance"],
  consolidated: true,
  adminCenterPath: ADMIN_PATH,
  recommendations: [
    {
      categoryKeys: ["identity", "mailSecurity", "compliance"],
      categoryLabels: [
        "Identity & privileged access",
        "Mail security",
        "Compliance & data governance",
      ],
      sku: {
        key: "microsoft-365-e7",
        name: "Microsoft 365 E7",
        url: "https://www.microsoft.com/en-us/microsoft-365/enterprise/microsoft365-plans-and-pricing",
      },
      checkKeys: [
        "identity:pim-eligible-roles",
        "security:safe-links-coverage",
        "compliance:missing-labels",
      ],
    },
  ],
};

const gap = (checkKey: string): UnavailableCheck => ({ checkKey, reason: "license_gap" });

describe("upgradeOpportunities — the per-row link", () => {
  it("gives each row its own add-on at tier 2", () => {
    const rows = upgradeOpportunities(
      [gap("identity:pim-eligible-roles"), gap("compliance:missing-labels")],
      TIER_2,
    );
    assert.equal(rows[0]!.link?.skuName, "Microsoft Entra ID P2");
    assert.equal(rows[1]!.link?.skuName, "Microsoft Purview Suite");
  });

  it("gives NO row its own link at tier 3 — the block carries the one E7 ask", () => {
    const rows = upgradeOpportunities(
      [gap("identity:pim-eligible-roles"), gap("compliance:missing-labels")],
      TIER_3,
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.link === undefined), "no per-row link at tier 3");
  });

  it("still declares a gap that maps to no purchase category, just without a link", () => {
    const rows = upgradeOpportunities([gap("intune:outdated-devices")], TIER_2);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.link, undefined);
    assert.ok(rows[0]!.disclosure.length > 0);
  });

  it("is unchanged when no purchase payload is supplied at all", () => {
    const rows = upgradeOpportunities([gap("identity:pim-eligible-roles")]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.link, undefined);
  });

  it("still drops a non-licence-gap check", () => {
    assert.deepEqual(upgradeOpportunities([{ checkKey: "x:y", reason: "no_data" }], TIER_2), []);
  });
});

describe("upgradeOpportunityCallToAction", () => {
  it("names both add-ons at tier 2 and never mentions E7", () => {
    const cta = upgradeOpportunityCallToAction(TIER_2)!;
    assert.ok(cta.text.includes("Microsoft Entra ID P2"));
    assert.ok(cta.text.includes("Microsoft Purview Suite"));
    assert.ok(!cta.text.includes("E7"), "two gapped categories must not be upsold to the suite");
    assert.equal(cta.links.length, 2);
  });

  it("names E7 once at tier 3 and says why it replaces three links", () => {
    const cta = upgradeOpportunityCallToAction(TIER_3)!;
    assert.equal(cta.links.length, 1);
    assert.equal(cta.links[0]!.skuName, "Microsoft 365 E7");
    assert.ok(cta.text.includes("instead of three separate add-ons"));
  });

  it("always says the purchase happens in the customer's own admin center", () => {
    for (const p of [TIER_2, TIER_3]) {
      assert.ok(upgradeOpportunityCallToAction(p)!.text.includes("admin.microsoft.com"));
    }
  });

  it("is null when there is nothing to recommend", () => {
    assert.equal(upgradeOpportunityCallToAction(null), null);
    assert.equal(upgradeOpportunityCallToAction(undefined), null);
    assert.equal(
      upgradeOpportunityCallToAction({ ...TIER_2, recommendations: [] }),
      null,
    );
  });
});

describe("warRoomUpgradeNote — the pillar card line", () => {
  const cardWith = (licenseGapUpgrades: unknown) =>
    warRoomPillarView("security", {
      pillars: [
        {
          pillar: "security",
          enginePillar: "security",
          score: 61,
          rawRiskScore: 0,
          stats: [],
          findings: [],
          findingCounts: { critical: 0, warning: 0 },
          licenseGapUpgrades,
        } as never,
      ],
      findingsRunId: null,
      findingsRunStatus: null,
      activeRunId: null,
      generatedAt: "",
    });

  it("says nothing for a pillar with no gap", () => {
    assert.equal(warRoomUpgradeNote(WAR_ROOM_PILLAR_VIEW_EMPTY), null);
    assert.equal(warRoomUpgradeNote(cardWith([])), null);
  });

  it("counts this pillar's own gapped checks and names the SKU", () => {
    const view = cardWith([
      {
        skuKey: "entra-id-p2",
        skuName: "Microsoft Entra ID P2",
        url: "https://www.microsoft.com/en-us/security/business/microsoft-entra-pricing",
        checkKeys: ["identity:pim-eligible-roles", "identity:pim-groups"],
      },
    ]);
    assert.equal(warRoomUpgradeNote(view), "2 checks not licensed — Microsoft Entra ID P2");
  });

  it("singularises a lone gapped check", () => {
    const view = cardWith([
      { skuKey: "purview-suite", skuName: "Microsoft Purview Suite", url: "https://x", checkKeys: ["compliance:missing-labels"] },
    ]);
    assert.equal(warRoomUpgradeNote(view), "1 check not licensed — Microsoft Purview Suite");
  });

  it("drops a malformed link rather than rendering a dead one", () => {
    const view = cardWith([{ skuKey: "x", skuName: "", url: "", checkKeys: ["a:b"] }]);
    assert.deepEqual(view.upgrades, []);
    assert.equal(warRoomUpgradeNote(view), null);
  });
});
