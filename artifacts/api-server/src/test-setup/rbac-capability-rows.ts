/**
 * Vitest setup — give every suite the RBAC rows a non-ladder capability check reads (#2460).
 *
 * The exact counterpart of ./rbac-ladder-rows.ts, which #2458 added when `requireRole`
 * started reading the database. #2460 does the same thing to two per-user columns:
 * `portal-team.ts`'s team-admin gate and `msp-v1.ts`'s purchase-approval gate used to
 * read `users.can_manage_team` / `users.can_approve_purchases` — mocked tables that
 * every affected suite already had — and now ask `customer:team.manage` /
 * `msp:purchases.approve` instead, which means reading role and mapping rows those
 * mocks do not carry.
 *
 * Without this file, a suite mocking `@workspace/db` down to its own route's tables
 * gets a throw inside the capability read, the gate fails closed, and assertions about
 * link building or email templates turn into 503s. The three ways out are the same
 * three #2458 weighed, and the answer is the same one: supply the rows, rather than
 * weaken the gate or mock the middleware away and lose the coverage.
 *
 * ── If you are writing a test about the unseeded/unreadable path ────────────
 *
 * Declare your own `vi.mock("../middlewares/rbac-capability-source.ts", ...)` in the
 * test file; a file-level mock overrides this one. Same for a test that needs a
 * principal to actually HOLD a `cap.*` grant — the default here is that nobody has
 * been granted anything, which is what a fresh database looks like.
 */

import { vi } from "vitest";

vi.mock("../middlewares/rbac-capability-source.ts", async () => {
  // Imported inside the factory because vi.mock is hoisted above the file's imports.
  const { capabilityRowsModule } = await import("./rbac-capability-fixture.ts");
  return capabilityRowsModule();
});
