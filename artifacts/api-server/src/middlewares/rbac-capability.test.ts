/**
 * `customer:team.manage` fails CLOSED on a caller whose claim names no recognised role
 * (#3360, part of #1696).
 *
 * The gate this capability replaced — `denyIfCannotManageTeam` before #2460 — tested
 * `isCustomerTier`, an allow-list of three customer tier NAMES, and took the permitted
 * branch for everything else. A principal with no `mspRole` claim at all
 * (`buildUserPayload` really can sign `mspRole: undefined`) passed it. The capability
 * read has no such branch: a claim naming no rung contributes no role, so the caller is
 * decided on explicit `cap.*` grants alone and denied by default.
 *
 * These run against the fixture rows `src/test-setup/rbac-capability-rows.ts` installs
 * for every suite — the allow set #2457 seeded, derived from the transcription rather
 * than typed out. ./rbac-capability.live-db.test.ts asks the same questions of the real
 * rows.
 */

import { describe, it, expect } from "vitest";
import { CAPABILITY_COLUMN_ROLE_KEYS, LEGACY_ROLE_ORDER, type LegacyRole } from "@workspace/db/rbac/legacy-ladder";
import { setGrantRole, userHasCapability } from "./rbac-capability.ts";
import { readPlatformRoleId, writeMembership } from "./rbac-capability-source.ts";
import type { AuthUser } from "./requireAuth.ts";

type Principal = Pick<AuthUser, "id" | "role" | "mspRole" | "mspId" | "customerId">;

/** A principal exactly as a verified JWT can present it — the claim is untyped at runtime. */
function principal(id: number, mspRole: unknown, role: AuthUser["role"] = "client"): Principal {
  return { id, role, mspRole: mspRole as LegacyRole | undefined, mspId: 1, customerId: 1 };
}

/** Claim values that name no rung. `buildUserPayload` really signs the first (#3360). */
const UNRECOGNISED_CLAIMS: ReadonlyArray<readonly [string, unknown]> = [
  ["absent", undefined],
  ["null", null],
  ["an empty string", ""],
  ["an unknown name", "NotARole"],
  ["a case-variant of a real rung", "mspadmin"],
  ["a tier that does not exist", "CustomerAdmin"],
];

const decide = async (p: Principal): Promise<string> =>
  (await userHasCapability(p, "customer", "team.manage")).kind;

// The fixture's grants persist for the whole file, so every test takes fresh user ids.
let nextUserId = 9_000;
const freshId = (): number => nextUserId++;

describe("#3360 — customer:team.manage fails closed on an unrecognised role", () => {
  it.each(UNRECOGNISED_CLAIMS)("denies a client whose mspRole claim is %s", async (_label, claim) => {
    expect(await decide(principal(freshId(), claim))).toBe("deny");
  });

  it.each(UNRECOGNISED_CLAIMS)("still honours an explicit cap.team.manage grant when the claim is %s", async (_label, claim) => {
    // The flag half of the rule: an unrecognised role is not a privileged one, so it
    // falls to the per-user grant exactly as a customer tier does.
    const id = freshId();
    expect(await setGrantRole("customer", id, CAPABILITY_COLUMN_ROLE_KEYS.manageTeam, true, null)).toEqual({ ok: true });
    expect(await decide(principal(id, claim))).toBe("allow");
  });

  it("ignores a live-held RUNG row, so a stale membership cannot stand in for the claim", async () => {
    // Nothing maintains *_user_roles when a user's role changes (#3498), so a user can
    // hold a rung row their claim no longer names. Honouring it would reopen #3360 from
    // the data side: an unrecognised claim plus a leftover MSPAdmin row would pass.
    const id = freshId();
    const mspAdminRow = await readPlatformRoleId("customer", "MSPAdmin");
    expect(mspAdminRow).not.toBeNull();
    await writeMembership("customer", id, mspAdminRow!, true, null);
    expect(await decide(principal(id, "NotARole"))).toBe("deny");
  });

  it("passes flagless exactly the four rungs the allow set names — an allow-list, not a deny-list", async () => {
    // ServiceAccount is the ladder artifact #1696 records; it never reaches this gate
    // on a real route because assertCustomerAccess refuses it first.
    const passesFlagless = new Set<string>(["ServiceAccount", "MSPOperator", "MSPAdmin", "PlatformAdmin"]);
    for (const rung of LEGACY_ROLE_ORDER) {
      expect(await decide(principal(freshId(), rung)), rung).toBe(passesFlagless.has(rung) ? "allow" : "deny");
    }
  });

  it("promotes role:'admin' to PlatformAdmin even with no mspRole claim", async () => {
    expect(await decide(principal(freshId(), undefined, "admin"))).toBe("allow");
  });
});
