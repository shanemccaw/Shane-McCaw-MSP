/**
 * The RBAC ladder rows, as `middlewares/rbac-ladder-source.ts` returns them (#2458).
 *
 * Shared by the two ways this package runs tests, so there is exactly one definition:
 *   - `./rbac-ladder-rows.ts`, the vitest setup file (`vitest.config.ts` → setupFiles),
 *     which covers the 33 suites that mock `@workspace/db` and sit behind a real
 *     `requireRole`;
 *   - the node-runner suites (`node --experimental-strip-types --test`, listed in
 *     package.json's `test` script), which have no shared setup and call
 *     `mock.module("../middlewares/rbac-ladder-source.ts", { namedExports: ladderRowsModule() })`
 *     for themselves.
 *
 * The rows are the seed's own shape, computed from `LEGACY_ROLE_ORDER` by the same
 * `idx >= idx` self-join #2457's SQL performs — so a rung added to or removed from the
 * ladder changes this automatically and it cannot drift from the real rows. It invents
 * no product data: no user, tenant, invoice or finding appears here, only the
 * transitional ladder shim's own definition, which is code.
 *
 * What this CANNOT do is make the real database agree with the real `roleIndex`
 * comparison — that is proven against live Postgres in
 * `middlewares/rbac-ladder.live-db.test.ts`, which unmocks this entirely.
 */

import { LADDER_CAPABILITY_KEYS, LEGACY_ROLE_ORDER } from "@workspace/db/rbac/legacy-ladder";
import type { LadderRows } from "../middlewares/rbac-ladder-source.ts";

const rungRoleId = (rung: string): string => `rbac-test-rung-${rung}`;

export function ladderRows(): LadderRows {
  return {
    rungs: LEGACY_ROLE_ORDER.map((rung) => ({ id: rungRoleId(rung), key: rung })),
    mappings: LEGACY_ROLE_ORDER.map((floor, floorIdx) => ({
      capabilityKey: LADDER_CAPABILITY_KEYS[floor],
      allow: LEGACY_ROLE_ORDER.filter((_, heldIdx) => heldIdx >= floorIdx).map(rungRoleId),
      deny: [],
    })),
  };
}

/** The full replacement module for `middlewares/rbac-ladder-source.ts`. */
export function ladderRowsModule(): {
  LADDER_CAPABILITY_KEY_LIST: readonly string[];
  readLadderRows: () => Promise<LadderRows>;
} {
  const rows = ladderRows();
  return {
    LADDER_CAPABILITY_KEY_LIST: LEGACY_ROLE_ORDER.map((role) => LADDER_CAPABILITY_KEYS[role]),
    readLadderRows: () => Promise.resolve(rows),
  };
}
