import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for CRM end-to-end tests.
 *
 * Uses the system Chromium available in the Replit/NixOS environment via
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH (or falls back to Playwright's own
 * Chromium when running outside Replit / in standard CI environments).
 *
 * The tests run against the already-running dev server (managed by the Replit
 * workflow system) at http://localhost:80/crm.  No webServer start is needed
 * here because the workflow keeps the server alive for the whole session.
 *
 * Run with:
 *   pnpm --filter @workspace/crm run test:e2e
 */

const systemChromium =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium-browser";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,

  use: {
    baseURL: "http://localhost:80",
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    launchOptions: {
      executablePath: systemChromium,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
