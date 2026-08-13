/**
 * remediationScriptParams.test.ts — Git #782 (Phase 2 of 2, epic #647).
 *
 * What has to hold, because a wrong answer here reaches a paying customer's
 * runbook as a plausible-but-wrong command:
 *   1. Each of the five fillable steps substitutes real values when the item
 *      shape has them, byte-matching the rest of the script exactly.
 *   2. Every non-fillable step (including s5/s14, explicitly OUT of scope)
 *      returns null — never touched, never even considered.
 *   3. Every honest-degrade path returns null, never a half-filled script:
 *      the check key absent from the map, a non-"ok" status, itemsOmitted,
 *      zero items, items whose shape doesn't carry the needed field, and —
 *      for s9/s12 specifically — items that exist but none qualifies (no
 *      disabled/excluded CA policy, no disabled Safe Links policy).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FILLABLE_STEP_CHECK_KEYS, applyLiveScriptParams, type CheckItemDetail, type CheckItemsByKey } from "./remediationScriptParams.ts";
import { LIVE_STEP_SCRIPTS } from "./remediationLiveGuide.ts";
import { REMEDIATION_STEPS, type RemediationCode } from "./previewRemediationGuide.ts";

function ok(checkKey: string, items: readonly unknown[]): CheckItemDetail {
  return {
    checkKey,
    status: "ok",
    itemCount: items.length,
    items,
    itemsOmitted: false,
    itemsOmittedReason: null,
    collectedAt: "2026-08-11T00:00:00.000Z",
  };
}

function s11BaseCode(): RemediationCode {
  const step = REMEDIATION_STEPS.find((s) => s.id === "s11");
  assert.ok(step?.code);
  return step.code;
}

describe("FILLABLE_STEP_CHECK_KEYS", () => {
  it("holds exactly the five steps #782 confirmed, and never s5/s14", () => {
    assert.deepEqual(Object.keys(FILLABLE_STEP_CHECK_KEYS).sort(), ["s1", "s11", "s12", "s22", "s9"]);
    assert.equal(FILLABLE_STEP_CHECK_KEYS["s5"], undefined);
    assert.equal(FILLABLE_STEP_CHECK_KEYS["s14"], undefined);
  });
});

describe("applyLiveScriptParams — steps outside the fillable set", () => {
  it("returns null for a step id not in FILLABLE_STEP_CHECK_KEYS", () => {
    const code: RemediationCode = { language: "x", script: "<placeholder>" };
    assert.equal(applyLiveScriptParams("s5", code, {}), null);
    assert.equal(applyLiveScriptParams("s14", code, {}), null);
    assert.equal(applyLiveScriptParams("s27", code, {}), null);
  });
});

describe("applyLiveScriptParams — s1 sharepoint:orgwide-links", () => {
  const base = LIVE_STEP_SCRIPTS["s1"] as RemediationCode;

  it("substitutes real site URLs (Url field, PowerShell convention) up to 4, preserving the rest of the script", () => {
    const items: CheckItemsByKey = {
      "sharepoint:orgwide-links": ok("sharepoint:orgwide-links", [
        { Url: "https://contoso.sharepoint.com/sites/Finance", SharingCapability: "ExternalUserAndGuestSharing" },
        { Url: "https://contoso.sharepoint.com/sites/HR", SharingCapability: "ExternalUserAndGuestSharing" },
      ]),
    };
    const result = applyLiveScriptParams("s1", base, items);
    assert.ok(result);
    assert.match(result.script, /"https:\/\/contoso\.sharepoint\.com\/sites\/Finance"/);
    assert.match(result.script, /"https:\/\/contoso\.sharepoint\.com\/sites\/HR"/);
    assert.doesNotMatch(result.script, /<site-1>/);
    assert.match(result.script, /foreach \(\$s in \$sites\)/);
    assert.equal(result.language, base.language);
  });

  it("also reads webUrl (Graph site resource field)", () => {
    const items: CheckItemsByKey = {
      "sharepoint:orgwide-links": ok("sharepoint:orgwide-links", [{ webUrl: "https://contoso.sharepoint.com/sites/Legal" }]),
    };
    const result = applyLiveScriptParams("s1", base, items);
    assert.ok(result);
    assert.match(result.script, /Legal/);
  });

  it("caps at 4 URLs even when more are collected", () => {
    const items: CheckItemsByKey = {
      "sharepoint:orgwide-links": ok(
        "sharepoint:orgwide-links",
        Array.from({ length: 7 }, (_, i) => ({ Url: `https://contoso.sharepoint.com/sites/Site${i}` })),
      ),
    };
    const result = applyLiveScriptParams("s1", base, items);
    assert.ok(result);
    const matches = result.script.match(/https:\/\/contoso\.sharepoint\.com\/sites\/Site\d/g) ?? [];
    assert.equal(matches.length, 4);
  });

  it("degrades to the placeholder when the check was never collected", () => {
    assert.equal(applyLiveScriptParams("s1", base, {}), null);
  });

  it("degrades when the row's items were omitted (too large to persist)", () => {
    const items: CheckItemsByKey = {
      "sharepoint:orgwide-links": {
        ...ok("sharepoint:orgwide-links", []),
        itemsOmitted: true,
        itemsOmittedReason: "too large",
      },
    };
    assert.equal(applyLiveScriptParams("s1", base, items), null);
  });

  it("degrades when the check's own status was not ok", () => {
    const items: CheckItemsByKey = {
      "sharepoint:orgwide-links": { ...ok("sharepoint:orgwide-links", [{ Url: "https://contoso.sharepoint.com/sites/X" }]), status: "error" },
    };
    assert.equal(applyLiveScriptParams("s1", base, items), null);
  });

  it("degrades when items carry no recognisable URL field", () => {
    const items: CheckItemsByKey = {
      "sharepoint:orgwide-links": ok("sharepoint:orgwide-links", [{ id: "site-1", title: "Finance" }]),
    };
    assert.equal(applyLiveScriptParams("s1", base, items), null);
  });
});

describe("applyLiveScriptParams — s9 identity:ca-policy-count", () => {
  const base = LIVE_STEP_SCRIPTS["s9"] as RemediationCode;

  it("substitutes the id of a disabled policy", () => {
    const items: CheckItemsByKey = {
      "identity:ca-policy-count": ok("identity:ca-policy-count", [
        { id: "11111111-1111-1111-1111-111111111111", displayName: "Baseline MFA", state: "enabled" },
        { id: "22222222-2222-2222-2222-222222222222", displayName: "Legacy exclusion", state: "disabled" },
      ]),
    };
    const result = applyLiveScriptParams("s9", base, items);
    assert.ok(result);
    assert.match(result.script, /22222222-2222-2222-2222-222222222222/);
    assert.doesNotMatch(result.script, /<ca-policy-id>/);
  });

  it("substitutes the id of an enabled policy that carries an exclusion group", () => {
    const items: CheckItemsByKey = {
      "identity:ca-policy-count": ok("identity:ca-policy-count", [
        {
          id: "33333333-3333-3333-3333-333333333333",
          state: "enabled",
          conditions: { users: { excludeGroups: ["44444444-4444-4444-4444-444444444444"] } },
        },
      ]),
    };
    const result = applyLiveScriptParams("s9", base, items);
    assert.ok(result);
    assert.match(result.script, /33333333-3333-3333-3333-333333333333/);
  });

  it("degrades when every policy is enabled with no exclusions — a real id would misdescribe a healthy policy", () => {
    const items: CheckItemsByKey = {
      "identity:ca-policy-count": ok("identity:ca-policy-count", [{ id: "5", state: "enabled", conditions: { users: {} } }]),
    };
    assert.equal(applyLiveScriptParams("s9", base, items), null);
  });
});

describe("applyLiveScriptParams — s11 identity:global-admin-count", () => {
  it("substitutes a human admin's object id, preferring @odata.type user over service principal", () => {
    const items: CheckItemsByKey = {
      "identity:global-admin-count": ok("identity:global-admin-count", [
        { id: "app-1", displayName: "Break glass automation", "@odata.type": "#microsoft.graph.servicePrincipal" },
        { id: "user-1", displayName: "Jane Admin", userPrincipalName: "jane@contoso.com", "@odata.type": "#microsoft.graph.user" },
      ]),
    };
    const result = applyLiveScriptParams("s11", s11BaseCode(), items);
    assert.ok(result);
    assert.match(result.script, /user-1/);
    assert.doesNotMatch(result.script, /<user-object-id>/);
  });

  it("falls back to the first member's id when no human member is present", () => {
    const items: CheckItemsByKey = {
      "identity:global-admin-count": ok("identity:global-admin-count", [
        { id: "app-only", "@odata.type": "#microsoft.graph.servicePrincipal" },
      ]),
    };
    const result = applyLiveScriptParams("s11", s11BaseCode(), items);
    assert.ok(result);
    assert.match(result.script, /app-only/);
  });

  it("degrades to the placeholder when the check was never collected", () => {
    assert.equal(applyLiveScriptParams("s11", s11BaseCode(), {}), null);
  });
});

describe("applyLiveScriptParams — s12 security:safe-links-coverage", () => {
  const base = LIVE_STEP_SCRIPTS["s12"] as RemediationCode;

  it("substitutes the name of a disabled policy in both places it appears", () => {
    const items: CheckItemsByKey = {
      "security:safe-links-coverage": ok("security:safe-links-coverage", [
        { Name: "Executive Team", IsEnabled: true },
        { Name: "All Users Baseline", IsEnabled: false },
      ]),
    };
    const result = applyLiveScriptParams("s12", base, items);
    assert.ok(result);
    const occurrences = result.script.match(/All Users Baseline/g) ?? [];
    assert.equal(occurrences.length, 2);
    assert.doesNotMatch(result.script, /<your-safe-links-policy>/);
  });

  it("degrades when every policy is already enabled — nothing to reinstate", () => {
    const items: CheckItemsByKey = {
      "security:safe-links-coverage": ok("security:safe-links-coverage", [{ Name: "All Users Baseline", IsEnabled: true }]),
    };
    assert.equal(applyLiveScriptParams("s12", base, items), null);
  });
});

describe("applyLiveScriptParams — s22 cost:group-based-licensing-adoption", () => {
  const base = LIVE_STEP_SCRIPTS["s22"] as RemediationCode;

  it("substitutes a real department read off an existing LIC-<sku>-<department> group, both casings", () => {
    const items: CheckItemsByKey = {
      "cost:group-based-licensing-adoption": ok("cost:group-based-licensing-adoption", [
        { displayName: "LIC-E5-Finance", assignedLicenses: [{ skuId: "sku-1" }] },
      ]),
    };
    const result = applyLiveScriptParams("s22", base, items);
    assert.ok(result);
    assert.match(result.script, /LIC-E5-Finance/);
    assert.match(result.script, /lic-e5-finance/);
    assert.doesNotMatch(result.script, /<Department>/);
    assert.doesNotMatch(result.script, /<department>/);
  });

  it("degrades when no group follows the LIC-<sku>-<department> naming convention", () => {
    const items: CheckItemsByKey = {
      "cost:group-based-licensing-adoption": ok("cost:group-based-licensing-adoption", [
        { displayName: "All Company Staff", assignedLicenses: [] },
      ]),
    };
    assert.equal(applyLiveScriptParams("s22", base, items), null);
  });
});
