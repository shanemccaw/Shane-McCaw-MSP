/**
 * portal-change-collision.test.ts — collision detection on `targetResource`
 * (#1504), "the substance of the issue".
 */

import { describe, it, expect } from "vitest";

import { findCollidingChangeRequest, spansCollide, type ChangeRequestCollisionCandidate } from "./portal-change-collision";

describe("spansCollide", () => {
  it("two overlapping real spans collide", () => {
    expect(
      spansCollide(
        new Date("2026-09-05T02:00:00Z"),
        new Date("2026-09-05T04:00:00Z"),
        new Date("2026-09-05T03:00:00Z"),
        new Date("2026-09-05T05:00:00Z"),
      ),
    ).toBe(true);
  });

  it("two adjacent (touching, not overlapping) spans do not collide — half-open interval", () => {
    expect(
      spansCollide(
        new Date("2026-09-05T02:00:00Z"),
        new Date("2026-09-05T04:00:00Z"),
        new Date("2026-09-05T04:00:00Z"),
        new Date("2026-09-05T06:00:00Z"),
      ),
    ).toBe(false);
  });

  it("two disjoint spans do not collide", () => {
    expect(
      spansCollide(
        new Date("2026-09-05T02:00:00Z"),
        new Date("2026-09-05T03:00:00Z"),
        new Date("2026-09-05T05:00:00Z"),
        new Date("2026-09-05T06:00:00Z"),
      ),
    ).toBe(false);
  });

  it("a point (null end) inside a real span collides with it", () => {
    expect(spansCollide(new Date("2026-09-05T03:00:00Z"), null, new Date("2026-09-05T02:00:00Z"), new Date("2026-09-05T04:00:00Z"))).toBe(true);
  });

  it("a point outside a real span does not collide", () => {
    expect(spansCollide(new Date("2026-09-05T05:00:00Z"), null, new Date("2026-09-05T02:00:00Z"), new Date("2026-09-05T04:00:00Z"))).toBe(false);
  });

  it("two points collide only on the exact same instant", () => {
    const t = new Date("2026-09-05T03:00:00Z");
    expect(spansCollide(t, null, new Date(t), null)).toBe(true);
    expect(spansCollide(t, null, new Date("2026-09-05T03:00:01Z"), null)).toBe(false);
  });
});

function crFixture(overrides: Partial<ChangeRequestCollisionCandidate> = {}): ChangeRequestCollisionCandidate {
  return {
    id: 1,
    code: "CR-2026-101",
    targetResource: "Conditional Access: Require MFA for Admins",
    scheduledStart: new Date("2026-09-05T02:00:00Z"),
    scheduledEnd: new Date("2026-09-05T04:00:00Z"),
    ...overrides,
  };
}

describe("findCollidingChangeRequest", () => {
  it("finds a colliding CR on the same target resource with an overlapping window", () => {
    const found = findCollidingChangeRequest(
      [crFixture()],
      "Conditional Access: Require MFA for Admins",
      new Date("2026-09-05T03:00:00Z"),
      new Date("2026-09-05T05:00:00Z"),
    );
    expect(found?.code).toBe("CR-2026-101");
  });

  it("matches targetResource case-insensitively and trimmed", () => {
    const found = findCollidingChangeRequest(
      [crFixture({ targetResource: "  conditional access: require mfa for admins  " })],
      "Conditional Access: Require MFA for Admins",
      new Date("2026-09-05T03:00:00Z"),
      new Date("2026-09-05T05:00:00Z"),
    );
    expect(found).not.toBeNull();
  });

  it("does not collide against a different target resource, even with an overlapping window", () => {
    const found = findCollidingChangeRequest(
      [crFixture({ targetResource: "Exchange: mailbox-flow-rule-7" })],
      "Conditional Access: Require MFA for Admins",
      new Date("2026-09-05T03:00:00Z"),
      new Date("2026-09-05T05:00:00Z"),
    );
    expect(found).toBeNull();
  });

  it("does not collide when the same target resource's window does not overlap", () => {
    const found = findCollidingChangeRequest(
      [crFixture()],
      "Conditional Access: Require MFA for Admins",
      new Date("2026-09-06T00:00:00Z"),
      new Date("2026-09-06T01:00:00Z"),
    );
    expect(found).toBeNull();
  });

  it("returns null for a blank target resource rather than matching everything", () => {
    expect(findCollidingChangeRequest([crFixture({ targetResource: "" })], "", new Date(), null)).toBeNull();
  });
});
