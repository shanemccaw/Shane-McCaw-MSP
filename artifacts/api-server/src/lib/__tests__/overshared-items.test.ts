/**
 * overshared-items.test.ts
 *
 * `buildOversharedItemRows` — flattening a collected `SiteSharingSummary[]`
 * into `overshared_items` insert rows, including the named (`user`/`guest`)
 * grants resolved by #1286.
 */

import { describe, it, expect } from "vitest";
import { buildOversharedItemRows, buildOversharedItemNaturalKey } from "../overshared-items";
import type { SiteSharingSummary } from "../sharepoint-sharing";

const BASE_PARAMS = {
  runId: "11111111-1111-1111-1111-111111111111",
  tenantId: "contoso.onmicrosoft.com",
  customerId: 42,
  checkKey: "compliance:eeeu-site-sharing",
  collectedAt: new Date("2026-08-25T00:00:00Z"),
};

function siteSummary(overrides: Partial<SiteSharingSummary> = {}): SiteSharingSummary {
  return {
    siteId: "site-1",
    siteName: "Finance",
    siteUrl: "https://contoso.sharepoint.com/sites/finance",
    isPersonalSite: false,
    permissionCount: 1,
    broadAccess: false,
    hasEeeu: false,
    hasEveryone: false,
    hasAnonymousLink: false,
    hasOrganizationLink: false,
    eeeuGrantCount: 0,
    everyoneGrantCount: 0,
    anonymousLinkCount: 0,
    organizationLinkCount: 0,
    highestSharingLevel: null,
    sharingLevels: [],
    grants: [],
    namedGrants: [],
    ...overrides,
  };
}

describe("buildOversharedItemRows", () => {
  it("emits a row per broad grant, unaffected by named grants", () => {
    const rows = buildOversharedItemRows({
      ...BASE_PARAMS,
      items: [
        siteSummary({
          broadAccess: true,
          highestSharingLevel: "eeeu",
          grants: [
            {
              permissionId: "p1",
              kind: "eeeu",
              principal: "Everyone except external users",
              loginName: "c:0-.f|rolemanager|spo-grid-all-users/tenant-guid",
              principalUpn: null,
              roles: ["read"],
              inherited: false,
            },
          ],
        }),
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].grantKind).toBe("eeeu");
    expect(rows[0].principalUpn).toBeNull();
  });

  it("emits a row per named grant, with a real principalUpn (#1286)", () => {
    const rows = buildOversharedItemRows({
      ...BASE_PARAMS,
      items: [
        siteSummary({
          namedGrants: [
            {
              permissionId: "int-1",
              kind: "user",
              principal: "Pat Internal",
              loginName: "i:0#.f|membership|pat@contoso.com",
              principalUpn: "pat@contoso.com",
              roles: ["write"],
              inherited: false,
            },
            {
              permissionId: "guest-1",
              kind: "guest",
              principal: "Jamie Guest",
              loginName: "i:0#.f|membership|jamie_partnerco.com#ext#@contoso.onmicrosoft.com",
              principalUpn: "jamie@partnerco.com",
              roles: ["read"],
              inherited: false,
            },
          ],
        }),
      ],
    });

    expect(rows).toHaveLength(2);
    const user = rows.find((r) => r.grantKind === "user");
    const guest = rows.find((r) => r.grantKind === "guest");
    expect(user?.principalUpn).toBe("pat@contoso.com");
    expect(user?.severity).toBe("low");
    expect(guest?.principalUpn).toBe("jamie@partnerco.com");
    expect(guest?.severity).toBe("medium");
  });

  it("tolerates a historical payload with no namedGrants field at all", () => {
    const legacy = siteSummary({ broadAccess: false }) as Partial<SiteSharingSummary>;
    delete legacy.namedGrants;
    const rows = buildOversharedItemRows({ ...BASE_PARAMS, items: [legacy] });
    expect(rows).toEqual([]);
  });

  it("skips a site with no id", () => {
    const rows = buildOversharedItemRows({
      ...BASE_PARAMS,
      items: [siteSummary({ siteId: null, namedGrants: [{ permissionId: "x", kind: "user", principal: "P", loginName: null, principalUpn: null, roles: [], inherited: false }] })],
    });
    expect(rows).toEqual([]);
  });

  it("ignores an element that isn't shaped like a SiteSharingSummary", () => {
    const rows = buildOversharedItemRows({ ...BASE_PARAMS, items: [{ notASite: true }, null, "x"] });
    expect(rows).toEqual([]);
  });
});

describe("buildOversharedItemNaturalKey", () => {
  it("is stable for the same identity and differs by grant kind", () => {
    const base = { tenantId: "t", checkKey: "c", siteId: "s", permissionId: null, loginName: null, principal: "Jamie Guest" };
    const guestKey = buildOversharedItemNaturalKey({ ...base, grantKind: "guest" });
    const userKey = buildOversharedItemNaturalKey({ ...base, grantKind: "user" });
    expect(guestKey).not.toBe(userKey);
    expect(buildOversharedItemNaturalKey({ ...base, grantKind: "guest" })).toBe(guestKey);
  });
});
