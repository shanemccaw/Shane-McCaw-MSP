/**
 * Vitest setup — give every suite the RBAC ladder rows `requireRole` now reads (#2458).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Before #2458, `requireRole` compared `ROLE_ORDER` indexes and touched no database.
 * 33 suites in this package rely on that: they mount a REAL router behind the REAL
 * `requireRole` while mocking `@workspace/db` down to the handful of tables their own
 * route happens to query. The moment the gate started reading rows, every one of them
 * failed with `No "mspRolesTable" export is defined on the "@workspace/db" mock` — the
 * read threw, the gate failed closed, and ~283 assertions that have nothing to do with
 * RBAC turned into 503s.
 *
 * There were three ways out and only one of them is honest:
 *
 *   - Weaken the gate so a failed read is not fatal. No: an authorization path that
 *     cannot read its rules must fail closed, and an unseeded environment must be
 *     diagnosable rather than silently permissive.
 *   - Mock `requireRole` away in those 33 files. No: they currently exercise the real
 *     middleware end-to-end, and that coverage is worth more than the convenience.
 *   - Supply the rows. This file.
 *
 * ── What it supplies ────────────────────────────────────────────────────────
 *
 * Exactly the shape #2457's seed migration writes: one platform role per `ROLE_ORDER`
 * rung, and one `ladder.<floor>` mapping whose allow set is every rung at or above that
 * floor — computed here by the same `idx >= idx` self-join the SQL performs, from the
 * same `LEGACY_ROLE_ORDER` constant, so it cannot drift from what the database holds.
 * This is not fixture DATA about the product: no user, tenant, invoice or finding is
 * invented here. It is the transitional ladder shim's own definition, which is code.
 *
 * That the REAL rows in a REAL database agree with the REAL `roleIndex` comparison is
 * proven separately and cannot be faked by this file — see
 * `src/middlewares/rbac-ladder.live-db.test.ts`, which calls `vi.unmock` on this exact
 * module so it reads live Postgres.
 *
 * ── If you are writing a test about the unseeded/unreadable path ────────────
 *
 * Declare your own `vi.mock("../middlewares/rbac-ladder-source.ts", ...)` in the test
 * file; a file-level mock overrides this one. `src/middlewares/rbac-ladder.test.ts`
 * does exactly that.
 */

import { vi } from "vitest";

vi.mock("../middlewares/rbac-ladder-source.ts", async () => {
  // Imported inside the factory because vi.mock is hoisted above the file's imports.
  // Same definition the node-runner suites use — see ./rbac-ladder-fixture.ts.
  const { ladderRowsModule } = await import("./rbac-ladder-fixture.ts");
  return ladderRowsModule();
});
