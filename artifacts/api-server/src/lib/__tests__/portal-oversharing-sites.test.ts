/**
 * portal-oversharing-sites.test.ts — grouping `overshared_items` rows into the
 * drill-down's per-site admins/guests shape (#1286).
 */

import { describe, it, expect } from "vitest";
import { buildOversharingSites, siteContextLine, type OversharedSiteGrantRow } from "../portal-oversharing-sites";

function row(overrides: Partial<OversharedSiteGrantRow>): OversharedSiteGrantRow {
  return {
    siteId: "site-1",
    siteName: "Finance",
    siteUrl: "https://contoso.sharepoint.com/sites/finance",
    siteVisibility: null,
    isPersonalSite: false,
    grantKind: "eeeu",
    principalLabel: "Everyone except external users",
    principalUpn: null,
    roles: ["read"],
    remediationState: "open",
    ...overrides,
  };
}

describe("siteContextLine", () => {
  it("names every present broad kind, never a guessed severity", () => {
    expect(siteContextLine([])).toBe("No broad sharing found on this site.");
    expect(siteContextLine(["eeeu"])).toBe("Everyone except external users has access.");
    expect(siteContextLine(["eeeu", "anonymous_link"])).toBe(
      "Everyone except external users and an anonymous link have access.",
    );
  });
});

describe("buildOversharingSites", () => {
  it("groups rows by site and resolves named admins/guests off the user/guest rows", () => {
    const sites = buildOversharingSites([
      row({ grantKind: "eeeu" }),
      row({
        grantKind: "user",
        principalLabel: "Pat Internal",
        principalUpn: "pat@contoso.com",
        roles: ["owner"],
      }),
      row({
        grantKind: "guest",
        principalLabel: "Jamie Guest",
        principalUpn: "jamie@partnerco.com",
        roles: ["read"],
      }),
    ]);

    expect(sites).toHaveLength(1);
    const site = sites[0];
    expect(site.id).toBe("site-1");
    expect(site.sharingLevels).toEqual(["eeeu"]);
    expect(site.admins).toEqual([{ name: "Pat Internal", upn: "pat@contoso.com", role: "Owner" }]);
    expect(site.guests).toEqual([{ name: "Jamie Guest", upn: "jamie@partnerco.com", role: "read" }]);
  });

  it("excludes a named user with write-but-not-owner access from admins", () => {
    const sites = buildOversharingSites([
      row({ grantKind: "user", principalLabel: "Sam Editor", roles: ["write"] }),
    ]);
    expect(sites[0].admins).toEqual([]);
  });

  it("falls back to an honest 'UPN not resolved' rather than fabricating one", () => {
    const sites = buildOversharingSites([
      row({ grantKind: "guest", principalLabel: "Unresolved Guest", principalUpn: null }),
    ]);
    expect(sites[0].guests[0].upn).toBe("UPN not resolved");
  });

  it("reads a site as accepted only when EVERY broad grant on it is accepted", () => {
    const partial = buildOversharingSites([
      row({ grantKind: "eeeu", remediationState: "risk_accepted" }),
      row({ grantKind: "anonymous_link", remediationState: "open" }),
    ]);
    expect(partial[0].status).toBe("open");

    const full = buildOversharingSites([
      row({ grantKind: "eeeu", remediationState: "risk_accepted" }),
      row({ grantKind: "anonymous_link", remediationState: "risk_accepted" }),
    ]);
    expect(full[0].status).toBe("accepted");
  });

  it("passes site_visibility through as-is (null today), never guessing Public/Private", () => {
    const sites = buildOversharingSites([row({ siteVisibility: null })]);
    expect(sites[0].visibility).toBeNull();
  });

  it("groups multiple sites independently", () => {
    const sites = buildOversharingSites([
      row({ siteId: "a", siteName: "Alpha" }),
      row({ siteId: "b", siteName: "Beta" }),
    ]);
    expect(sites.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });
});
