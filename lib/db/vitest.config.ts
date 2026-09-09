// #1907 — real test infrastructure for lib/db (a schema-only package, no server
// process to boot, no live-DB tests today — see the file's own header for why
// only the pure schema helpers are covered). Pattern adapted from
// artifacts/api-server/vitest.config.ts's explicit include list, scoped down for
// a package with no `src/lib` / `src/routes` split.
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
    ],
  },
});
