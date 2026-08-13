/**
 * liveReportBlocks.test.ts — #579, the Upgrade Opportunity grouping rule.
 *
 * `licenceGapDisclosure` and `upgradeOpportunities` are already covered
 * end-to-end via the report tests that consume them (`copilotReadinessReport
 * .test.ts`, `licenseGapPurchaseLinks.test.ts`). This file covers the piece
 * added by #579 on top of them: several Upgrade Opportunity rows sharing or
 * overlapping the same confirmed tier consolidate into one disclosure
 * sentence instead of repeating "Requires X. Upgrading unlocks Y" per
 * finding, without losing any individual finding underneath it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  groupUpgradeOpportunities,
  upgradeOpportunities,
  upgradeOpportunityRowText,
} from "./liveReportBlocks.ts";

const gap = (checkKey: string) => ({ checkKey, reason: "license_gap" });

describe("groupUpgradeOpportunities (#579)", () => {
  it("consolidates the confirmed identity trio into one sentence naming all three tiers", () => {
    const items = upgradeOpportunities([
      gap("identity:mfa-registration"),
      gap("identity:legacy-auth-usage"),
      gap("identity:risky-users"),
    ]);
    const groups = groupUpgradeOpportunities(items);

    assert.equal(groups.length, 1, "all three share the Entra ID family and merge into one group");
    const [group] = groups;
    assert.equal(group!.items.length, 3, "every finding is still present underneath the group");
    assert.equal(group!.requires, "Microsoft Entra ID P1 or P2", "the broader tier covers the P2-only member");
    assert.match(group!.sentence, /^This tenant requires Microsoft Entra ID P1 or P2 to unlock:/);
    assert.match(group!.sentence, /per-user MFA registration status across your org/);
    assert.match(group!.sentence, /visibility into legacy authentication sign-ins/);
    // The P2-only finding is annotated so the sentence does not overclaim what
    // the shared P1-or-P2 tier alone would unlock.
    assert.match(group!.sentence, /\(P2\) the Microsoft Entra ID Protection risky-user list/);
  });

  it("keeps a single gap's own full disclosure — nothing changes for the one-finding case", () => {
    const items = upgradeOpportunities([gap("identity:mfa-registration")]);
    const groups = groupUpgradeOpportunities(items);

    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.requires, null, "a group of one is not a consolidated group");
    assert.equal(groups[0]!.sentence, items[0]!.disclosure);
  });

  it("never merges checks whose tier this file cannot confirm", () => {
    // Neither check has a confirmed `requires` in LICENCE_GAP_DISCLOSURES, so
    // grouping them would mean inventing a shared tier that was never stated.
    const items = upgradeOpportunities([gap("intune:outdated-devices"), gap("intune:config-drift")]);
    const groups = groupUpgradeOpportunities(items);

    assert.equal(groups.length, 2, "unconfirmed tiers are never guessed into a shared group");
    for (const group of groups) {
      assert.equal(group.requires, null);
      assert.equal(group.items.length, 1);
    }
  });

  it("does not drop or reorder findings when grouping runs alongside ungrouped gaps", () => {
    const items = upgradeOpportunities([
      gap("intune:outdated-devices"),
      gap("identity:mfa-registration"),
      gap("identity:legacy-auth-usage"),
    ]);
    const groups = groupUpgradeOpportunities(items);
    const allCheckKeys = groups.flatMap((g) => g.items.map((i) => i.checkKey));

    assert.deepEqual(
      new Set(allCheckKeys),
      new Set(["intune:outdated-devices", "identity:mfa-registration", "identity:legacy-auth-usage"]),
      "every real finding survives grouping",
    );
    assert.equal(allCheckKeys[0], "intune:outdated-devices", "group order follows first-seen order");
  });
});

describe("upgradeOpportunityRowText (#579)", () => {
  it("returns the finding's own full disclosure when it is not part of a group", () => {
    const [item] = upgradeOpportunities([gap("identity:mfa-registration")]);
    assert.equal(upgradeOpportunityRowText(item!, false), item!.disclosure);
  });

  it("returns only the finding-specific consequence when grouped, not the shared tier sentence again", () => {
    const [item] = upgradeOpportunities([gap("identity:mfa-registration")]);
    const text = upgradeOpportunityRowText(item!, true);
    assert.ok(!/^Requires/.test(text), "the tier statement lives in the group sentence, not the row");
    assert.equal(
      text,
      "Right now this is a real blind spot in the Security pillar, not a confirmed pass.",
    );
  });
});
