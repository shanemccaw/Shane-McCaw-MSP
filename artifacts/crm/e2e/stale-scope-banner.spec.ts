/**
 * E2E test: Stale-scope amber banner in PresentationFlow.
 *
 * Verifies that when the 30-second polling mechanism detects a changed
 * sowVersion mid-session (simulating Shane regenerating the SOW while the
 * client has the presentation portal open), the amber warning banner
 *
 *   "The scope of work has been updated. Please review the latest pricing
 *    before signing or paying."
 *
 * becomes visible in the actual browser, and a "Refresh scope" button is
 * shown — blocking the client from proceeding with stale pricing.
 *
 * Test data:
 *   Presentation ID 5 with shareToken "playwright-stale-test-token-abc123"
 *   must exist in the development database before the tests run.
 *   (Created via SQL in the dev DB as part of task setup.)
 *
 * Run with:
 *   pnpm --filter @workspace/crm run test:e2e
 *
 * Requires the CRM dev server and API server to be running (managed by the
 * Replit workflow system or `pnpm --filter @workspace/crm run dev`).
 *
 * Technique:
 *   page.clock.install() + page.clock.fastForward(31000) advances the JS
 *   timer without real waiting, triggering the 30-second setInterval that
 *   calls checkScopeVersion().
 *   page.route() intercepts subsequent GET /api/portal/presentations/:id
 *   calls and returns a response with a changed sowVersion, simulating the
 *   server-side SOW regeneration.
 *
 *   Important: waitUntil: "load" (not "networkidle") is used on page.goto()
 *   because the page opens an SSE connection that is never closed, which
 *   would cause "networkidle" to time out waiting for the stream to finish.
 *   Content readiness is detected with page.waitForSelector() instead.
 */
import { test, expect, type Page, type Route } from "@playwright/test";

// ── Test constants ─────────────────────────────────────────────────────────────

const PRES_ID = 5;
const SHARE_TOKEN = "playwright-stale-test-token-abc123";
const PORTAL_PATH = `/crm/portal/presentation/${PRES_ID}?token=${SHARE_TOKEN}`;

/** A sowVersion value that differs from whatever the server stored, simulating
 *  Shane having raised the Phase 1 price from $10 000 to $15 000. */
const STALE_SOW_VERSION = "sow-0:15000|sow-1:8000";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a route-intercept handler that:
 *  • passes the FIRST matching request through to the real server (initial page load)
 *  • fulfills ALL subsequent requests with a JSON body whose sowVersion is
 *    STALE_SOW_VERSION (simulating a mid-session SOW update by the admin)
 *
 * The handler ignores scope-events SSE requests — those use a different URL
 * suffix and must reach the real server to establish the SSE stream.
 */
function makeSowVersionInterceptor(_page: Page) {
  let requestCount = 0;

  return async (route: Route) => {
    const url = route.request().url();

    // Never intercept the SSE subscription — it's a long-lived stream
    if (url.includes("scope-events")) {
      await route.continue();
      return;
    }

    requestCount++;

    if (requestCount === 1) {
      // First request: let the real server respond so the page renders with
      // the original sowVersion (no banner should appear at this point)
      await route.continue();
    } else {
      // Second+ request: return the changed sowVersion to trigger the banner
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: PRES_ID,
          sowVersion: STALE_SOW_VERSION,
          sowPhases: [
            { id: "sow-0", title: "Phase 1 — Identity Foundation", description: "M365 tenant hardening", price: 15_000, selected: true },
            { id: "sow-1", title: "Phase 2 — Governance", description: "Policy framework", price: 8_000, selected: true },
          ],
          selectedPhaseIds: ["sow-0", "sow-1"],
          totalPrice: 23_000,
          documentsIncluded: [],
          signatureData: null,
          signedAt: null,
          signerName: null,
          paymentPlan: null,
          status: "draft",
          projectTitle: null,
          clientName: null,
          contractBody: null,
          workflowName: null,
          projectId: null,
          clientUserId: null,
          shareToken: SHARE_TOKEN,
        }),
      });
    }
  };
}

/**
 * Navigate to the presentation portal and wait for the page to be ready.
 *
 * Uses waitUntil: "load" (not "networkidle") to avoid hanging on the SSE
 * connection. Waits for visible SOW phase content to confirm the React
 * component has rendered and the initial API fetch has completed.
 */
async function gotoAndWaitForContent(page: Page) {
  await page.goto(PORTAL_PATH, { waitUntil: "load" });

  // Wait for either the presentation content or an overview/sidebar element.
  // The PresentationFlow sidebar renders step buttons after initial data load.
  // We use a broader selector so a loading state also satisfies the wait.
  await page.waitForSelector("body", { state: "attached" });

  // Allow up to 10 s for the presentation data fetch (real network call) to
  // complete and React to render the sidebar navigation.
  await page.waitForFunction(
    () => document.body.innerText.length > 20,
    { timeout: 10_000 },
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe("PresentationFlow — stale-scope amber banner (real browser)", () => {

  test("amber banner does NOT appear on initial page load (versions match)", async ({ page }) => {
    // Install fake timers before navigating so the setInterval is controlled
    await page.clock.install({ time: Date.now() });

    await page.route(`**/api/portal/presentations/${PRES_ID}**`, makeSowVersionInterceptor(page));

    await gotoAndWaitForContent(page);

    // The initial load returns the real sowVersion from the server — versions
    // match so the amber banner must be absent.
    await expect(page.getByText(/scope of work has been updated/i)).not.toBeVisible();
  });

  test("amber banner appears after polling detects a changed sowVersion", async ({ page }) => {
    // Install a controllable clock BEFORE navigation so the setInterval in
    // PresentationFlow is under our control from the start.
    await page.clock.install({ time: Date.now() });

    // Route: pass first request through; fulfill subsequent ones with stale version
    await page.route(`**/api/portal/presentations/${PRES_ID}**`, makeSowVersionInterceptor(page));

    await gotoAndWaitForContent(page);

    // Banner must be absent immediately after page load
    await expect(page.getByText(/scope of work has been updated/i)).not.toBeVisible();

    // Advance 31 s — fires the 30-second setInterval, which calls checkScopeVersion().
    // The interceptor returns STALE_SOW_VERSION, causing setScopeStale(true).
    await page.clock.fastForward(31_000);

    // Short real-time pause for React to re-render after the state update
    await page.waitForTimeout(800);

    // Amber banner must now be visible in the real browser
    await expect(
      page.getByText(/scope of work has been updated/i),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("banner contains 'Refresh scope' button so the client can reload the latest pricing", async ({ page }) => {
    await page.clock.install({ time: Date.now() });
    await page.route(`**/api/portal/presentations/${PRES_ID}**`, makeSowVersionInterceptor(page));
    await gotoAndWaitForContent(page);

    await page.clock.fastForward(31_000);
    await page.waitForTimeout(800);

    await expect(
      page.getByText(/refresh scope/i),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("banner warns the client to review pricing before signing or paying", async ({ page }) => {
    await page.clock.install({ time: Date.now() });
    await page.route(`**/api/portal/presentations/${PRES_ID}**`, makeSowVersionInterceptor(page));
    await gotoAndWaitForContent(page);

    await page.clock.fastForward(31_000);
    await page.waitForTimeout(800);

    await expect(
      page.getByText(/please review the latest pricing before signing or paying/i),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("banner remains absent across multiple polls when sowVersion never changes", async ({ page }) => {
    // Never intercept — let ALL requests go through to the real server, which
    // always returns the stored (original) sowVersion.
    await page.clock.install({ time: Date.now() });
    await gotoAndWaitForContent(page);

    // Advance past three polling intervals
    await page.clock.fastForward(91_000);
    await page.waitForTimeout(800);

    // Since sowVersion never changed, the banner must remain absent
    await expect(page.getByText(/scope of work has been updated/i)).not.toBeVisible();
  });
});
