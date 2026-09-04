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
    ],
  },
});
