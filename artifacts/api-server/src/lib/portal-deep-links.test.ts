import { describe, expect, it } from "vitest";
import { PORTAL_DEEP_LINK_DESTINATIONS, resolvePortalDeepLink } from "./portal-deep-links";

describe("resolvePortalDeepLink", () => {
  it("resolves every seeded /portal-v2/* destination to the honest coming-soon page while livePath is null", () => {
    for (const dest of PORTAL_DEEP_LINK_DESTINATIONS) {
      const resolved = resolvePortalDeepLink(dest.rawPath);
      expect(resolved.available).toBe(false);
      expect(resolved.href).toBe(`/coming-soon?feature=${encodeURIComponent(dest.label)}`);
      expect(resolved.label).toBe(dest.label);
    }
  });

  it("returns the portal home for a null/undefined path", () => {
    expect(resolvePortalDeepLink(null)).toEqual({ href: "/", available: true, label: "Portal" });
    expect(resolvePortalDeepLink(undefined)).toEqual({ href: "/", available: true, label: "Portal" });
  });

  it("falls back to the coming-soon page (never a dead link) for an unmapped path", () => {
    const resolved = resolvePortalDeepLink("/portal-v2/something-new");
    expect(resolved.available).toBe(false);
    expect(resolved.href).toBe("/coming-soon?feature=%2Fportal-v2%2Fsomething-new");
  });

  it("never returns a raw /portal-v2/* href", () => {
    for (const dest of PORTAL_DEEP_LINK_DESTINATIONS) {
      const resolved = resolvePortalDeepLink(dest.rawPath);
      expect(resolved.href.startsWith("/portal-v2")).toBe(false);
    }
  });
});
