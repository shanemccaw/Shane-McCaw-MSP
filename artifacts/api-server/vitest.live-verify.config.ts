/**
 * vitest.live-verify.config.ts — Git #1911
 *
 * Opt-in config for LIVE verifications that talk to the real local Postgres and
 * the real Azure Key Vault. Kept out of `vitest.config.ts` deliberately: a
 * regression sweep must not mint vault secrets or write run rows.
 *
 *   npx vitest run --config vitest.live-verify.config.ts
 *
 * Requires .env.local to be loaded (DATABASE_URL, AZURE_*, JWT_SECRET).
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.live-verify.ts"],
    // These drive the real engine end to end — a run has to actually execute.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
