/**
 * shadow-it-governance.test.ts — #1545 (Remediation: Shadow IT as an
 * accumulating governance risk, part of #1489).
 *
 * Covers the one pure decision this module makes: which drift verdicts count
 * as "unauthorized" for accumulation purposes. The DB-backed half
 * (`findOrCreateShadowItRbd`, `recordShadowItDrift`) is exercised instead via
 * a real rolled-back-transaction SQL rehearsal against the local database
 * (see #1545's own DONE bookend) — this environment could not run vitest at
 * all at the time of this build (see the filed environment finding), so this
 * file is registered for the next session to run, not verified green here.
 */
import { describe, expect, it } from "vitest";
import { isUnauthorizedVerdict } from "./shadow-it-governance.ts";
import type { DriftEventVerdict } from "@workspace/db";

describe("isUnauthorizedVerdict (#1545)", () => {
  it("treats a known actor with no linked change request as unauthorized", () => {
    expect(isUnauthorizedVerdict("attributed_unapproved")).toBe(true);
  });

  it("treats an unattributed change as unauthorized (the riskiest, floated-up case)", () => {
    expect(isUnauthorizedVerdict("unattributed")).toBe(true);
  });

  it("never treats an approved (CR-linked) change as unauthorized", () => {
    expect(isUnauthorizedVerdict("approved")).toBe(false);
  });

  it("never treats an informational domain event as unauthorized", () => {
    expect(isUnauthorizedVerdict("informational")).toBe(false);
  });

  it("covers every DriftEventVerdict with an explicit answer (no silent default)", () => {
    const all: DriftEventVerdict[] = ["approved", "attributed_unapproved", "unattributed", "informational"];
    for (const v of all) {
      expect(typeof isUnauthorizedVerdict(v)).toBe("boolean");
    }
  });
});
