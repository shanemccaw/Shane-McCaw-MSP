/**
 * Live-Postgres acceptance test for #2458 — `requireRole` now decides from the
 * database, and this proves it decides the SAME WAY it always has.
 *
 * Migration step 3 of 5 under #1696 swapped `requireRole`'s decision source from the
 * `ROLE_ORDER` index comparison in `requireAuth.ts` to the `ladder.*` feature→role
 * mapping rows #2457 seeded, evaluated by the shared #2455 evaluator. The contract is
 * that nothing observable changes. That claim is only worth anything if it is checked
 * against the real rows rather than against a fixture of what they are believed to be,
 * so every assertion in this file runs the real evaluator over the real local database.
 *
 * Three things are proven:
 *
 *  1. **The full agreement matrix.** For every one of the 7 rungs × 7 floors, plus the
 *     two "holds no recognised rung" shapes, the new answer equals
 *     `roleIndex(held) >= roleIndex(floor)` — the exact expression that was deleted
 *     from the request path. `roleIndex` is imported and called here on purpose: the
 *     old rule is the oracle, not a comment describing it.
 *
 *  2. **The two legacy artifacts #1696 flagged, at the HTTP layer.** `ServiceAccount`
 *     still clears `requireRole("CustomerUser")` (carried forward — the real code
 *     treats a ServiceAccount as MSP-side infrastructure, see requireAuth.ts's note),
 *     and `role: "admin"` still resolves to `PlatformAdmin`.
 *
 *  3. **Real 401/403/200 through a real Express app**, with the 403 body asserted
 *     byte-for-byte against the message the old middleware produced, since 616 call
 *     sites and every client of them depend on that string not moving.
 *
 * Nothing is inserted or mutated — the seeded platform rows are read as they stand, so
 * this test cannot leave residue. Skips cleanly with no `DATABASE_URL`, matching
 * msp-settings-target-role-ceiling.live-db.test.ts.
 *
 * Run: pnpm --filter @workspace/api-server vitest run rbac-ladder.live-db
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { LEGACY_ROLE_ORDER, type LegacyRole } from "@workspace/db/rbac";
import type { MspRole } from "@workspace/db";

// The whole point of this file is that it reads the REAL rows. `vitest.config.ts`
// installs a setup-file mock of the row source so the 33 route suites that mock
// @workspace/db still get a working requireRole; this opts back out of it, so nothing
// asserted below can be satisfied by test-supplied rows.
vi.unmock("./rbac-ladder-source.ts");

const JWT_SECRET = "test-rbac-ladder-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

/** Every floor that a real `requireRole(...)` call site actually uses today. */
const REAL_FLOORS: readonly MspRole[] = ["Assessment", "CustomerUser", "MSPOperator", "MSPAdmin", "PlatformAdmin"];

describeLive("#2458 — requireRole's new decision source, against the real seeded rows", () => {
  let roleClearsLadderFloor: typeof import("./rbac-ladder.ts").roleClearsLadderFloor;
  let userClearsLadderFloor: typeof import("./rbac-ladder.ts").userClearsLadderFloor;
  let roleIndex: typeof import("./requireAuth.ts").roleIndex;
  let app: express.Express;

  beforeAll(async () => {
    const ladder = await import("./rbac-ladder.ts");
    roleClearsLadderFloor = ladder.roleClearsLadderFloor;
    userClearsLadderFloor = ladder.userClearsLadderFloor;

    const auth = await import("./requireAuth.ts");
    roleIndex = auth.roleIndex;

    app = express();
    for (const floor of REAL_FLOORS) {
      app.get(`/t/${floor}`, auth.requireRole(floor), (_req, res) => {
        res.json({ ok: true });
      });
    }
  });

  function token(payload: Record<string, unknown>): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: "5m" });
  }

  // ── 1. The agreement matrix ────────────────────────────────────────────────

  it("is seeded — the model answers allow/deny, never 'unavailable'", async () => {
    // Guards every assertion below: `unavailable` would make a deny look like a
    // pass-by-accident, so it is asserted absent once, loudly, first.
    const outcome = await roleClearsLadderFloor("PlatformAdmin", "PlatformAdmin");
    expect(outcome.kind, "the ladder.* rows from #2457's seed must be present in this database").not.toBe("unavailable");
    expect(outcome.kind).toBe("allow");
  });

  it("agrees with roleIndex() for all 49 rung × floor pairs", async () => {
    const disagreements: string[] = [];

    for (const held of LEGACY_ROLE_ORDER) {
      for (const floor of LEGACY_ROLE_ORDER) {
        const oldAnswer = roleIndex(held as MspRole) >= roleIndex(floor as MspRole);
        const outcome = await roleClearsLadderFloor(held, floor);
        const newAnswer = outcome.kind === "allow";
        if (oldAnswer !== newAnswer) {
          disagreements.push(`held=${held} floor=${floor}: old=${oldAnswer} new=${newAnswer} (${outcome.kind})`);
        }
      }
    }

    expect(disagreements, "the evaluator must reproduce the ROLE_ORDER comparison exactly").toEqual([]);
  });

  it("denies every floor for a principal holding no recognised rung", async () => {
    for (const held of [null, undefined, "", "Engineer", "admin"]) {
      for (const floor of LEGACY_ROLE_ORDER) {
        // roleIndex(undefined) is -1, and every real floor has index >= 0.
        expect(roleIndex(held as MspRole | undefined) >= roleIndex(floor as MspRole)).toBe(false);
        const outcome = await roleClearsLadderFloor(held, floor);
        expect(outcome.kind, `held=${String(held)} floor=${floor}`).toBe("deny");
      }
    }
  });

  it("fails closed on a floor that is not a ladder rung, rather than allowing it", async () => {
    const outcome = await roleClearsLadderFloor("PlatformAdmin", "Engineer");
    expect(outcome.kind).toBe("unavailable");
  });

  // ── 2. The two flagged legacy artifacts ───────────────────────────────────

  it("carries ServiceAccount ABOVE CustomerUser forward, as requireAuth.ts documents", async () => {
    // #1696 flagged this as an artifact rather than a decision; #2458 asks whether it
    // is still relied upon. It is (subscription-gate OPERATOR_ROLES,
    // msp-ownership MSP_SCOPED_ROLES, the two remediation-tracker exports'
    // MSP_STAFF_ROLES, event-bus's ServiceAccount actor), so it is transcribed as-is.
    expect((await roleClearsLadderFloor("ServiceAccount", "CustomerUser")).kind).toBe("allow");
    expect((await roleClearsLadderFloor("ServiceAccount", "Assessment")).kind).toBe("allow");
    // And it still does NOT reach MSP-staff floors, exactly as the index comparison had it.
    expect((await roleClearsLadderFloor("ServiceAccount", "MSPOperator")).kind).toBe("deny");
    expect((await roleClearsLadderFloor("ServiceAccount", "MSPAdmin")).kind).toBe("deny");
  });

  it("carries the role === 'admin' → PlatformAdmin promotion forward", async () => {
    for (const floor of LEGACY_ROLE_ORDER) {
      const outcome = await userClearsLadderFloor({ role: "admin" }, floor as MspRole);
      expect(outcome.kind, `legacy admin must clear ${floor}`).toBe("allow");
    }
    // The promotion is the ONLY thing granting it — the same user as `client` with no
    // mspRole clears nothing.
    for (const floor of LEGACY_ROLE_ORDER) {
      expect((await userClearsLadderFloor({ role: "client" }, floor as MspRole)).kind).toBe("deny");
    }
  });

  it("does not let a stale mspRole claim override the admin promotion", async () => {
    // requireRole has always read `role === "admin" ? "PlatformAdmin" : mspRole`, so an
    // admin row carrying a LOWER mspRole is still promoted. Transcribed, not tidied.
    const outcome = await userClearsLadderFloor({ role: "admin", mspRole: "Assessment" }, "PlatformAdmin");
    expect(outcome.kind).toBe("allow");
  });

  // ── 3. Real HTTP, real status codes ───────────────────────────────────────

  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).get("/t/MSPAdmin");
    expect(res.status).toBe(401);
  });

  it("returns the unchanged 403 body for a genuine denial", async () => {
    const res = await request(app)
      .get("/t/MSPAdmin")
      .set("Authorization", `Bearer ${token({ id: 1, email: "op@x.com", role: "client", mspRole: "MSPOperator" })}`);
    expect(res.status).toBe(403);
    // Byte-for-byte the message the ROLE_ORDER comparison produced. 616 call sites and
    // every client of them depend on this string not moving.
    expect(res.body?.error?.message).toBe("Insufficient privileges — MSPAdmin or above required");
    expect(res.body?.error?.code).toBe("FORBIDDEN");
  });

  it("serves the real 200/403 matrix for every real floor", async () => {
    const principals: ReadonlyArray<{ label: string; claims: Record<string, unknown>; held: LegacyRole | undefined }> = [
      { label: "PlatformAdmin", claims: { id: 1, role: "client", mspRole: "PlatformAdmin" }, held: "PlatformAdmin" },
      { label: "legacy admin", claims: { id: 2, role: "admin" }, held: "PlatformAdmin" },
      { label: "MSPAdmin", claims: { id: 3, role: "client", mspRole: "MSPAdmin" }, held: "MSPAdmin" },
      { label: "MSPOperator", claims: { id: 4, role: "client", mspRole: "MSPOperator" }, held: "MSPOperator" },
      { label: "ServiceAccount", claims: { id: 5, role: "client", mspRole: "ServiceAccount" }, held: "ServiceAccount" },
      { label: "CustomerUser", claims: { id: 6, role: "client", mspRole: "CustomerUser" }, held: "CustomerUser" },
      { label: "Free", claims: { id: 7, role: "client", mspRole: "Free" }, held: "Free" },
      { label: "Assessment", claims: { id: 8, role: "client", mspRole: "Assessment" }, held: "Assessment" },
      { label: "no mspRole claim", claims: { id: 9, role: "client" }, held: undefined },
    ];

    const mismatches: string[] = [];
    for (const principal of principals) {
      for (const floor of REAL_FLOORS) {
        const expected = roleIndex(principal.held as MspRole | undefined) >= roleIndex(floor) ? 200 : 403;
        const res = await request(app).get(`/t/${floor}`).set("Authorization", `Bearer ${token(principal.claims)}`);
        if (res.status !== expected) {
          mismatches.push(`${principal.label} → requireRole("${floor}"): expected ${expected}, got ${res.status}`);
        }
      }
    }

    expect(mismatches, "the HTTP fence must be unchanged for every real floor").toEqual([]);
  });
});
