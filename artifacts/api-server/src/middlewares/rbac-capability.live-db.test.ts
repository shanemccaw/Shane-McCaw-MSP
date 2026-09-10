/**
 * Live-Postgres check for #3360 — the REAL `customer:team.manage` rows deny a caller
 * whose claim names no recognised role.
 *
 * ./rbac-capability.test.ts proves the decision logic against fixture rows derived from
 * the transcription. That cannot prove the seeded database agrees, and an authorization
 * gate is only as fail-closed as the rows it reads: an allow set that had picked up a
 * wildcard, or a mapping row that had gone missing (which answers 503, not 403), would
 * both slip past a fixture. So this asks the same questions of the real local rows.
 *
 * Nothing is inserted or mutated. The principal uses an id no real user has, and the
 * first assertion checks that rather than assuming it. Skips cleanly with no
 * `DATABASE_URL`, matching rbac-ladder.live-db.test.ts.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run rbac-capability.live-db
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import type { LegacyRole } from "@workspace/db/rbac/legacy-ladder";
import type { AuthUser } from "./requireAuth.ts";

// `vitest.config.ts` installs a setup-file mock of the row source; this whole file is
// about the real rows, so opt back out of it.
vi.unmock("./rbac-capability-source.ts");

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

/** No real user has this id, so the principal holds no live grant — asserted below. */
const NOBODY = 2_000_000_000;
const TENANT = 1;

describeLive("#3360 — customer:team.manage against the real seeded rows", () => {
  let userHasCapability: typeof import("./rbac-capability.ts").userHasCapability;
  let readHeldRoles: typeof import("./rbac-capability-source.ts").readHeldRoles;

  beforeAll(async () => {
    ({ userHasCapability } = await import("./rbac-capability.ts"));
    ({ readHeldRoles } = await import("./rbac-capability-source.ts"));
  });

  const decide = async (mspRole: unknown, role: AuthUser["role"] = "client"): Promise<string> =>
    (await userHasCapability(
      { id: NOBODY, role, mspRole: mspRole as LegacyRole | undefined, mspId: 1, customerId: TENANT },
      "customer",
      "team.manage",
    )).kind;

  it("the principal genuinely holds no live role row", async () => {
    expect(await readHeldRoles("customer", NOBODY, TENANT)).toEqual([]);
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["an empty string", ""],
    ["an unknown name", "NotARole"],
    ["a case-variant of a real rung", "mspadmin"],
  ] as const)("denies — 403, not 503 — a client whose claim is %s", async (_label, claim) => {
    expect(await decide(claim)).toBe("deny");
  });

  it("allows the privileged rungs, so the denials above are a decision and not an unreadable model", async () => {
    for (const rung of ["MSPOperator", "MSPAdmin", "PlatformAdmin"]) {
      expect(await decide(rung), rung).toBe("allow");
    }
    expect(await decide(undefined, "admin")).toBe("allow");
  });

  it("denies the three customer tiers without a grant", async () => {
    for (const rung of ["CustomerUser", "Free", "Assessment"]) {
      expect(await decide(rung), rung).toBe("deny");
    }
  });
});
