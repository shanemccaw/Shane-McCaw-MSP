import { cpus } from "node:os";
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
    // #3066 — #2877's global timeout bump doesn't fully close this class:
    // index.boot-smoke.test.ts already overrides to 60s (see the `it(...,
    // 60_000)` call below in that file) and still hit that raised ceiling
    // once under the full run, after #3047's glob-include fix grew the
    // discovered file count from 326 to 334 and increased parallelism
    // further. Per #2877/#3066's own diagnosis this is thread-pool
    // transform-time/CPU contention, not a logic defect. A one-core-off cap
    // (cpus - 1) was tried first and index.boot-smoke.test.ts still hit its
    // own 60s ceiling once under a full-suite run with that cap in place —
    // confirming the contention needs real headroom, not just a token
    // reduction. Halving the pool (leaving real headroom for the local
    // Postgres instance and other processes this suite genuinely talks to)
    // is the actual fix, at the cost of a somewhat longer full-suite wall
    // clock.
    //
    // #3101 — Vitest 4 removed `test.poolOptions`; these are now top-level
    // `test` options (see the migration guide:
    // https://vitest.dev/guide/migration#pool-rework). Nested under the
    // removed key this cap was silently inert — every invocation printed
    // vitest's own DEPRECATED warning for `poolOptions`, and the full suite
    // ran at vitest's default parallelism instead of #3066's intended
    // cpus/2 cap. Lifted to top level, same value, same reasoning.
    maxThreads: Math.max(1, Math.floor(cpus().length / 2)),
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
    // #2458 — requireRole now reads the RBAC ladder rows from the database. 33 suites
    // mount a real router behind the real requireRole while mocking @workspace/db down
    // to their own route's tables, and would otherwise all fail closed with a 503. This
    // supplies exactly the rows #2457's seed writes, so those suites keep testing what
    // they were written to test. Read the file's header before changing it; a test
    // about the unseeded path overrides it with its own file-level vi.mock, and the
    // live-Postgres acceptance test vi.unmocks it.
    setupFiles: ["./src/test-setup/rbac-ladder-rows.ts"],
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
