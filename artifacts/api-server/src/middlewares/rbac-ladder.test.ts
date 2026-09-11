/**
 * #2458 — the failure modes `requireRole` gained when its decision moved into the
 * database, and the one invariant that stops the two role-promotion copies drifting.
 *
 * The agreement matrix (does the evaluator answer the same as `roleIndex`?) is proven
 * against the real seeded rows in ./rbac-ladder.live-db.test.ts, and the HTTP fence in
 * ../routes/msp-rbac.test.ts. What neither of those can reach is what happens when the
 * rows are ABSENT or the read FAILS — which is the whole new risk surface of this
 * migration step, and the one an unmigrated Staging box will hit first. Each case here
 * re-imports the module so it starts from a cold cache, since the snapshot cache is
 * module-level state by design (one load serving many requests is the point).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LADDER, LADDER_CAPABILITY_KEYS, LEGACY_ROLE, LEGACY_ROLE_ORDER } from "@workspace/db/rbac/legacy-ladder";

/** Swappable per test: what the read returns, or the error it throws. */
let roleRows: Array<{ id: string; key: string }> = [];
let mappingRows: Array<{ capabilityKey: string; allow: string[]; deny: string[] }> = [];
let readError: Error | null = null;
/** Counts real reads, so cache behaviour is asserted rather than assumed. */
let reads = 0;

// requireAuth.ts (imported below to compare its role promotion against the
// transcription's) pulls in the real @workspace/db, which throws at import time
// without DATABASE_URL. Only the three symbols it names are needed here.
vi.mock("@workspace/db", () => ({
  db: {},
  tenantsTable: {},
  mspStaffCustomerScopesTable: {},
}));

// A file-level mock overrides the one `vitest.config.ts`'s setup file installs — which
// is the documented way to write a test about the row source itself rather than about
// a route sitting behind it.
vi.mock("./rbac-ladder-source.ts", async () => {
  const { LADDER_CAPABILITY_KEYS, LEGACY_ROLE_ORDER } = await import("@workspace/db/rbac/legacy-ladder");
  return {
    LADDER_CAPABILITY_KEY_LIST: LEGACY_ROLE_ORDER.map((role) => LADDER_CAPABILITY_KEYS[role]),
    readLadderRows: () => {
      reads += 1;
      if (readError) return Promise.reject(readError);
      return Promise.resolve({ rungs: roleRows, mappings: mappingRows });
    },
  };
});

const rungRoleId = (rung: string): string => `role-${rung}`;

/** The seed's shape: `ladder.<floor>` allows every rung at or above `floor`. */
function seededRows(): void {
  roleRows = LEGACY_ROLE_ORDER.map((rung) => ({ id: rungRoleId(rung), key: rung }));
  mappingRows = LEGACY_ROLE_ORDER.map((floor, floorIdx) => ({
    capabilityKey: LADDER_CAPABILITY_KEYS[floor],
    allow: LEGACY_ROLE_ORDER.filter((_, i) => i >= floorIdx).map(rungRoleId),
    deny: [] as string[],
  }));
}

async function freshModule(): Promise<typeof import("./rbac-ladder.ts")> {
  vi.resetModules();
  return import("./rbac-ladder.ts");
}

beforeEach(() => {
  roleRows = [];
  mappingRows = [];
  readError = null;
  reads = 0;
});

describe("an unseeded model is reported unavailable, never denied", () => {
  it("returns 'unavailable' — not 'deny' — when no rows exist at all", async () => {
    const { roleClearsLadderFloor } = await freshModule();
    const outcome = await roleClearsLadderFloor(LEGACY_ROLE.platformAdmin, LEGACY_ROLE.platformAdmin);
    // The distinction is the point: a 403 here would report a missing migration as a
    // permission decision, and the real cause would be invisible.
    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind === "unavailable") expect(outcome.reason).toBe("rbac_model_unseeded");
  });

  it("is unavailable when the rungs are seeded but the mapping rows are not", async () => {
    seededRows();
    mappingRows = [];
    const { roleClearsLadderFloor } = await freshModule();
    expect((await roleClearsLadderFloor(LEGACY_ROLE.platformAdmin, LEGACY_ROLE.mspAdmin)).kind).toBe("unavailable");
  });

  it("is unavailable when ONE rung is missing, not silently partially enforced", async () => {
    seededRows();
    roleRows = roleRows.filter((r) => r.key !== LEGACY_ROLE.mspOperator);
    const { roleClearsLadderFloor } = await freshModule();
    // A partial seed must not answer at all: MSPOperator would otherwise resolve to
    // "holds no role" and be denied every floor it legitimately clears.
    expect((await roleClearsLadderFloor(LEGACY_ROLE.platformAdmin, LEGACY_ROLE.platformAdmin)).kind).toBe("unavailable");
  });
});

describe("a failed read fails closed", () => {
  it("returns 'unavailable' when the read throws and nothing is cached", async () => {
    readError = new Error("connection terminated unexpectedly");
    const { roleClearsLadderFloor } = await freshModule();
    const outcome = await roleClearsLadderFloor(LEGACY_ROLE.platformAdmin, LEGACY_ROLE.platformAdmin);
    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind === "unavailable") expect(outcome.reason).toBe("rbac_model_unreadable");
  });

  it("serves the last good snapshot when a later read fails inside the stale grace", async () => {
    seededRows();
    const { roleClearsLadderFloor } = await freshModule();
    expect((await roleClearsLadderFloor(LEGACY_ROLE.mspAdmin, LEGACY_ROLE.mspAdmin)).kind).toBe("allow");

    // Expire the TTL, then break the database.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 60_000);
      readError = new Error("connection terminated unexpectedly");
      // A transient blip must not 503 every gated route at once.
      expect((await roleClearsLadderFloor(LEGACY_ROLE.mspAdmin, LEGACY_ROLE.mspAdmin)).kind).toBe("allow");

      // Past the grace window it stops being served — stale forever is how a revoked
      // grant keeps working.
      vi.setSystemTime(Date.now() + 10 * 60_000);
      expect((await roleClearsLadderFloor(LEGACY_ROLE.mspAdmin, LEGACY_ROLE.mspAdmin)).kind).toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed on a floor that is not a ladder rung", async () => {
    seededRows();
    const { roleClearsLadderFloor } = await freshModule();
    for (const floor of ["", "Engineer", "platformadmin", "admin"]) {
      const outcome = await roleClearsLadderFloor(LEGACY_ROLE.platformAdmin, floor);
      expect(outcome.kind, `floor=${floor}`).toBe("unavailable");
    }
  });
});

describe("the snapshot is loaded once, not per request", () => {
  it("issues one pair of reads for a burst of concurrent checks", async () => {
    seededRows();
    const { roleClearsLadderFloor } = await freshModule();
    await Promise.all(LEGACY_ROLE_ORDER.map((rung) => roleClearsLadderFloor(rung, LEGACY_ROLE.customer)));
    // ONE read for all seven checks — the in-flight dedupe. A per-request query on
    // 616 route gates is the regression this guards against.
    expect(reads).toBe(1);
  });

  it("re-reads after invalidateLadderSnapshot(), so a revoke is not held for a TTL", async () => {
    seededRows();
    const { roleClearsLadderFloor, invalidateLadderSnapshot } = await freshModule();
    await roleClearsLadderFloor(LEGACY_ROLE.mspAdmin, LEGACY_ROLE.mspAdmin);
    expect(reads).toBe(1);

    invalidateLadderSnapshot();
    // Revoke MSPAdmin's own rung from the floor it used to clear.
    const row = mappingRows.find((m) => m.capabilityKey === LADDER_CAPABILITY_KEYS.MSPAdmin)!;
    row.allow = row.allow.filter((id) => id !== rungRoleId(LEGACY_ROLE.mspAdmin));

    expect((await roleClearsLadderFloor(LEGACY_ROLE.mspAdmin, LEGACY_ROLE.mspAdmin)).kind).toBe("deny");
    expect(reads).toBe(2);
  });
});

describe("deny wins, through the shared evaluator", () => {
  it("denies a rung that is on both the allow and the deny list", async () => {
    seededRows();
    const row = mappingRows.find((m) => m.capabilityKey === LADDER_CAPABILITY_KEYS.Customer)!;
    row.deny = [rungRoleId(LEGACY_ROLE.platformAdmin)];
    const { roleClearsLadderFloor } = await freshModule();
    // Not this module's rule — it is #2455's evaluator, reached unchanged. Asserted
    // here because `requireRole` is the caller that has to inherit it.
    const outcome = await roleClearsLadderFloor(LEGACY_ROLE.platformAdmin, LEGACY_ROLE.customer);
    expect(outcome.kind).toBe("deny");
    if (outcome.kind === "deny") expect(outcome.decision.effect).toBe("deny");
  });
});

describe("the legacy-admin promotion has exactly one meaning", () => {
  it("agrees with requireAuth.ts's own effectiveMspRole for every principal shape", async () => {
    const { effectiveMspRole } = await import("./requireAuth.ts");
    const { effectiveLegacyRole } = await import("@workspace/db/rbac/legacy-ladder");

    // Two copies of the `role === "admin"` → PlatformAdmin promotion exist:
    // requireAuth's (still used by requireMspScope / assertCustomerAccess /
    // resolveStaffScopedCustomerIds) and the cited transcription rbac-ladder now
    // decides from. #1696 requires this promotion be carried across DELIBERATELY, so
    // the two agreeing is asserted rather than assumed — a silent divergence here
    // would mean requireCapability and the tenant fences disagreed about who the caller is.
    const roles = ["admin", "client", "", "Admin"] as const;
    const mspRoles = [...LEGACY_ROLE_ORDER, undefined, null, "Engineer"] as const;

    for (const role of roles) {
      for (const mspRole of mspRoles) {
        const fromRequireAuth = effectiveMspRole({ role: role as "admin" | "client", mspRole: mspRole as never });
        const fromTranscription = effectiveLegacyRole({ role, mspRole: (mspRole ?? null) as string | null });
        // requireAuth returns the raw claim (including an unrecognised string, which
        // roleIndex then scores -1); the transcription normalises that to undefined.
        // Same decision, and that equivalence is what is asserted.
        const normalized = LEGACY_ROLE_ORDER.includes(fromRequireAuth as never) ? fromRequireAuth : undefined;
        expect(fromTranscription, `role=${role} mspRole=${String(mspRole)}`).toBe(normalized);
      }
    }
  });

  it("promotes role='admin' to the top rung even with a lower mspRole claim", async () => {
    seededRows();
    const { userClearsLadderCapability } = await freshModule();
    const top = LADDER.platformAdmin;
    expect((await userClearsLadderCapability({ role: "admin", mspRole: LEGACY_ROLE.free }, top)).kind).toBe("allow");
    expect((await userClearsLadderCapability({ role: "client", mspRole: LEGACY_ROLE.free }, top)).kind).toBe("deny");
  });
});
