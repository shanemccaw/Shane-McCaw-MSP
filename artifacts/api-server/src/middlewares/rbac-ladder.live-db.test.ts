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
 *     still clears `requireCapability("ladder.customer-user")` (carried forward — the real code
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
import { LADDER, LEGACY_ROLE_ORDER, ladderCapabilityKey, legacyRoleIndex, type LegacyRole } from "@workspace/db/rbac";
import type { MspRole } from "@workspace/db";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

// The whole point of this file is that it reads the REAL rows. `vitest.config.ts`
// installs a setup-file mock of the row source so the 33 route suites that mock
// @workspace/db still get a working requireRole; this opts back out of it, so nothing
// asserted below can be satisfied by test-supplied rows.
vi.unmock("./rbac-ladder-source.ts");

const JWT_SECRET = "test-rbac-ladder-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

/** Every floor that a real route gate actually requires today. */
const REAL_FLOORS: readonly LegacyRole[] = [LEGACY_ROLE.free, LEGACY_ROLE.customer, LEGACY_ROLE.mspOperator, LEGACY_ROLE.mspAdmin, LEGACY_ROLE.platformAdmin];

describeLive("#2458/#2460 — the capability gate's decision source, against the real seeded rows", () => {
  let roleClearsLadderFloor: typeof import("./rbac-ladder.ts").roleClearsLadderFloor;
  let userClearsLadderCapability: typeof import("./rbac-ladder.ts").userClearsLadderCapability;
  let app: express.Express;

  beforeAll(async () => {
    const ladder = await import("./rbac-ladder.ts");
    roleClearsLadderFloor = ladder.roleClearsLadderFloor;
    userClearsLadderCapability = ladder.userClearsLadderCapability;

    const auth = await import("./requireAuth.ts");

    app = express();
    for (const floor of REAL_FLOORS) {
      app.get(`/t/${floor}`, auth.requireCapability(ladderCapabilityKey(floor)), (_req, res) => {
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
    const outcome = await roleClearsLadderFloor(LEGACY_ROLE.platformAdmin, LEGACY_ROLE.platformAdmin);
    expect(outcome.kind, "the ladder.* rows from #2457's seed must be present in this database").not.toBe("unavailable");
    expect(outcome.kind).toBe("allow");
  });

  it("primes at boot without throwing, against the real database", async () => {
    // index.ts calls this right after listen() so an unseeded or unreachable model is
    // reported once at startup rather than first appearing as a 503 on whichever gated
    // route a user happens to hit. It must never throw — the routes that need no role
    // gate stay serviceable either way.
    const { primeLadderSnapshot } = await import("./rbac-ladder.ts");
    await expect(primeLadderSnapshot()).resolves.toBeUndefined();
  });

  it("agrees with the ladder index comparison for all 49 rung × floor pairs", async () => {
    // The "old answer" side used to be `requireAuth.ts`'s own `roleIndex()`. #2460
    // deleted that function along with `ROLE_ORDER`; `legacyRoleIndex` is the same
    // comparison, transcribed in the shim and pinned by `legacy-ladder.test.ts`
    // (which additionally asserts requireAuth.ts has not grown a second copy). So
    // this still compares the seeded rows against the pre-migration rule, which is
    // the whole point of the matrix.
    const disagreements: string[] = [];

    for (const held of LEGACY_ROLE_ORDER) {
      for (const floor of LEGACY_ROLE_ORDER) {
        const oldAnswer = legacyRoleIndex(held) >= legacyRoleIndex(floor);
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
        // legacyRoleIndex(undefined) is -1, and every real floor has index >= 0.
        expect(legacyRoleIndex(held) >= legacyRoleIndex(floor)).toBe(false);
        const outcome = await roleClearsLadderFloor(held, floor);
        expect(outcome.kind, `held=${String(held)} floor=${floor}`).toBe("deny");
      }
    }
  });

  it("fails closed on a floor that is not a ladder rung, rather than allowing it", async () => {
    const outcome = await roleClearsLadderFloor(LEGACY_ROLE.platformAdmin, "Engineer");
    expect(outcome.kind).toBe("unavailable");
  });

  // ── 2. The two flagged legacy artifacts ───────────────────────────────────

  it("carries ServiceAccount ABOVE Customer forward, as requireAuth.ts documents", async () => {
    // #1696 flagged this as an artifact rather than a decision; #2458 asks whether it
    // is still relied upon. It is (subscription-gate OPERATOR_ROLES,
    // msp-ownership MSP_SCOPED_ROLES, the two remediation-tracker exports'
    // MSP_STAFF_ROLES, event-bus's ServiceAccount actor), so it is transcribed as-is.
    expect((await roleClearsLadderFloor(LEGACY_ROLE.serviceAccount, LEGACY_ROLE.customer)).kind).toBe("allow");
    expect((await roleClearsLadderFloor("ServiceAccount", LEGACY_ROLE.free)).kind).toBe("allow");
    // And it still does NOT reach MSP-staff floors, exactly as the index comparison had it.
    expect((await roleClearsLadderFloor(LEGACY_ROLE.serviceAccount, LEGACY_ROLE.mspOperator)).kind).toBe("deny");
    expect((await roleClearsLadderFloor(LEGACY_ROLE.serviceAccount, LEGACY_ROLE.mspAdmin)).kind).toBe("deny");
  });

  it("carries the role === 'admin' → PlatformAdmin promotion forward", async () => {
    for (const floor of LEGACY_ROLE_ORDER) {
      const outcome = await userClearsLadderCapability({ role: "admin" }, ladderCapabilityKey(floor));
      expect(outcome.kind, `legacy admin must clear ${floor}`).toBe("allow");
    }
    // The promotion is the ONLY thing granting it — the same user as `client` with no
    // mspRole clears nothing.
    for (const floor of LEGACY_ROLE_ORDER) {
      expect((await userClearsLadderCapability({ role: "client" }, ladderCapabilityKey(floor))).kind).toBe("deny");
    }
  });

  it("does not let a stale mspRole claim override the admin promotion", async () => {
    // The gate has always read `role === "admin" ? `PlatformAdmin` : mspRole`, so an
    // admin row carrying a LOWER mspRole is still promoted. Transcribed, not tidied.
    const outcome = await userClearsLadderCapability({ role: "admin", mspRole: "Free" }, LADDER.platformAdmin);
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
      .set("Authorization", `Bearer ${token({ id: 1, email: "op@x.com", role: "client", mspRole: LEGACY_ROLE.mspOperator })}`);
    expect(res.status).toBe(403);
    // Byte-for-byte the message the retired ROLE_ORDER comparison produced. 631 call
    // sites and every client of them depend on this string not moving — #2460 changed
    // what a call site NAMES, deliberately not what a denial says.
    expect(res.body?.error?.message).toBe("Insufficient privileges — MSPAdmin or above required");
    expect(res.body?.error?.code).toBe("FORBIDDEN");
  });

  it("serves the real 200/403 matrix for every real floor", async () => {
    const principals: ReadonlyArray<{ label: string; claims: Record<string, unknown>; held: LegacyRole | undefined }> = [
      { label: LEGACY_ROLE.platformAdmin, claims: { id: 1, role: "client", mspRole: LEGACY_ROLE.platformAdmin }, held: LEGACY_ROLE.platformAdmin },
      { label: "legacy admin", claims: { id: 2, role: "admin" }, held: LEGACY_ROLE.platformAdmin },
      { label: LEGACY_ROLE.mspAdmin, claims: { id: 3, role: "client", mspRole: LEGACY_ROLE.mspAdmin }, held: LEGACY_ROLE.mspAdmin },
      { label: LEGACY_ROLE.mspOperator, claims: { id: 4, role: "client", mspRole: LEGACY_ROLE.mspOperator }, held: LEGACY_ROLE.mspOperator },
      { label: "ServiceAccount", claims: { id: 5, role: "client", mspRole: "ServiceAccount" }, held: "ServiceAccount" },
      { label: LEGACY_ROLE.customer, claims: { id: 6, role: "client", mspRole: LEGACY_ROLE.customer }, held: LEGACY_ROLE.customer },
      { label: "Free", claims: { id: 7, role: "client", mspRole: "Free" }, held: "Free" },
      // #3590 — a token signed before the rename still says "Assessment"; it is read as Free.
      { label: "pre-#3590 Assessment claim", claims: { id: 8, role: "client", mspRole: "Assessment" }, held: LEGACY_ROLE.free },
      { label: "no mspRole claim", claims: { id: 9, role: "client" }, held: undefined },
    ];

    const mismatches: string[] = [];
    for (const principal of principals) {
      for (const floor of REAL_FLOORS) {
        const expected = legacyRoleIndex(principal.held) >= legacyRoleIndex(floor) ? 200 : 403;
        const res = await request(app).get(`/t/${floor}`).set("Authorization", `Bearer ${token(principal.claims)}`);
        if (res.status !== expected) {
          mismatches.push(`${principal.label} → gate ${ladderCapabilityKey(floor)}: expected ${expected}, got ${res.status}`);
        }
      }
    }

    expect(mismatches, "the HTTP fence must be unchanged for every real floor").toEqual([]);
  });
});
