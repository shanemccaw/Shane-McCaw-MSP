// #1907 — real test infrastructure for lib/db (a schema-only package, no server
// process to boot). Pattern adapted from artifacts/api-server/vitest.config.ts's
// explicit include list, scoped down for a package with no `src/lib` /
// `src/routes` split. #2461 added the first live-DB case (admin.test.ts) — it
// needs DATABASE_URL pointed at a database the RBAC migration has been applied
// to (local dev), same requirement as `pnpm run check-rbac-integrity`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      // #1869 — the config-resource coverage classifier's pure functions:
      // transportHasExecutor, coverageStateFor and the no_executor-wins-first
      // precedence rule.
      "src/schema/config-state.test.ts",
      // #2455 — the RBAC mechanism's pure half: the capability catalog's
      // enumerability, and the evaluation function's deny-wins / default-deny /
      // fail-closed rules (#1696 requirements 1 and 3).
      "src/rbac/capabilities.test.ts",
      "src/rbac/evaluate.test.ts",
      // #2457 — the transcription of today's model: the ROLE_ORDER ladder (checked
      // against the live requireAuth.ts, so drift fails loudly), the legacy admin
      // promotion, and the asymmetric way the three capability columns are actually
      // read. The seeded DATA is proven separately and against the real database by
      // `pnpm --filter @workspace/db run check-rbac-parity`.
      "src/rbac/legacy-ladder.test.ts",
      // #2461 — the admin CRUD's real-database half: role/membership/mapping
      // create-list-rename-delete, cross-org refusal, uncatalogued-capability
      // refusal. Runs against DATABASE_URL, everything rolled back.
      "src/rbac/admin.test.ts",
      // #3408 — the `users` → *_user_roles triggers: a created or re-roled user's
      // rung and capability-role memberships follow the row. Runs against
      // DATABASE_URL, everything rolled back.
      "src/rbac/user-role-sync.test.ts",
      // #3629 — the Customer Admin / Billing roles, the narrowed billing rows, and the
      // invoices / client_services triggers that grant the billed party Billing. Runs
      // against DATABASE_URL, everything rolled back.
      "src/rbac/customer-admin-billing-roles.test.ts",
    ],
  },
});
