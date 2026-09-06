import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // #2877 — a growing, run-to-run-unstable set of files (10+ across this
    // build's 2 clean full-suite reproductions, up from #2865's original 4)
    // hit the default 5000ms test / 10000ms hook timeout only under the full
    // ~305-file parallel run (never in isolation): transform-time/CPU
    // contention across vitest's default thread pool, not a logic defect.
    // #2865 scoped a per-file vi.setConfig() fix to its 4 named files: with
    // the set continuing to grow and not reproducing the same files run to
    // run, a small global bump is the more maintainable fix going forward.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // #3047 — this used to be an explicit ~326-entry allowlist array, not a
    // glob: a real test file simply not named here never ran, silently (no
    // warning from the aggregate `pnpm test` run — "No test files found" only
    // ever printed when someone targeted the orphaned file directly). Live
    // count taken before this fix: 354 real *.test.ts files existed under
    // src/, only 326 were named in the array — 28 files had never produced a
    // single real pass/fail signal, on top of the 2 (#2148, #2524) the #3047
    // report already caught by hand. A real glob closes the whole class
    // instead of relying on someone remembering to add every new file by
    // name.
    include: ["src/**/*.test.ts"],
    // The one place a file is deliberately kept out of vitest's own run, with
    // a reason on it. These 20 files import `describe`/`it` from `node:test`,
    // not `vitest` — they are a genuinely different test runner, dispatched
    // separately by this package's own `test` script via
    // `node --experimental-strip-types --test <files…>`. Pulling them into
    // vitest's run doesn't add coverage, it breaks them (node:test's
    // globals aren't vitest's) — confirmed live: all 20 fail under the glob
    // with no real assertion signal lost, since `pnpm run test` already runs
    // them via their real runner in the same `pnpm test` invocation.
    exclude: [
      "src/lib/ps-guard.test.ts",
      "src/lib/stripe.test.ts",
      "src/lib/webhook-delivery.test.ts",
      "src/routes/admin-ps-scripts-modularize.test.ts",
      "src/routes/admin-ps-scripts.test.ts",
      "src/routes/admin-script-runner.test.ts",
      "src/routes/auth-account-activation-entitlement.test.ts",
      "src/routes/auth-impersonation.test.ts",
      "src/routes/copilot-assessment-personas.test.ts",
      "src/routes/fulfillment-queue.test.ts",
      "src/routes/leads-stats.test.ts",
      "src/routes/msp-api-foundation.test.ts",
      "src/routes/msp-rbac.test.ts",
      "src/routes/msp-staff.test.ts",
      "src/routes/msp-team-invite.test.ts",
      "src/routes/opportunities.test.ts",
      "src/routes/portal-checkout-direct.test.ts",
      "src/routes/portal-checkout-webhook.test.ts",
      "src/routes/portal-presentations.test.ts",
      "src/routes/portal-privacy.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/workflow-executor.ts"],
      thresholds: {
        branches: 90,
      },
    },
  },
});
