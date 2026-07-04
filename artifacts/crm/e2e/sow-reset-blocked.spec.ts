/**
 * E2E test: sowResetBlocked — stale-scope hard-block on Agreement and Payment steps.
 *
 * Scenario:
 *   A client has a scope reduction active (Phase 2 deselected) and has already
 *   generated a scoped SOW.  While the presentation is open, Shane updates the
 *   phase pricing.  The 30-second polling mechanism detects the changed
 *   sowVersion, which sets scopedSowWasReset=true.  Because hasScopeReduction is
 *   also true, sowResetBlocked becomes true, which must:
 *
 *     1. Show an amber "Blocked" badge on the Agreement teaser card
 *     2. Show an amber "Blocked" badge on the Payment teaser card
 *     3. Disable both teaser cards (disabled attribute)
 *     4. Render sidebar Agreement/Payment items with cursor-not-allowed and the
 *        "Regenerate your scoped SOW before signing or paying" tooltip
 *     5. Replace the "Next → Agreement" footer button with a disabled
 *        "Continue to Agreement" dashed-border button when on the SOW step
 *     6. Clear the block once the presentation is freshly loaded with a new
 *        scoped SOW (as happens after the client regenerates and reloads)
 *
 * Access strategy:
 *   The URL deliberately omits the ?token parameter.  When both token and user
 *   are absent, PortalPresentation sets readOnly=false (isPublic = !!token && !user
 *   = false), making Agreement/Payment steps and cards visible.  Using plain
 *   fetch() (no auth headers) also avoids 401 → refresh cascades that would cause
 *   PortalPresentation to re-fetch and remount PresentationFlow with a stale payload.
 *
 * Technique:
 *   • /api/portal/presentations/:id uses a flag-based interceptor.  All fetches
 *     before the flag is set return the original payload (scope reduction active,
 *     scoped SOW present).  After the flag is set — right before
 *     clock.fastForward() — the poll returns the stale payload (changed sowVersion),
 *     triggering sowResetBlocked=true.
 *   • page.clock.fastForward(31000) fires the 30-second setInterval without
 *     real waiting.
 *
 * Run with:
 *   pnpm --filter @workspace/crm run test:e2e
 */
import { test, expect, type Page, type Route } from "@playwright/test";

// ── Constants ───────────────────────────────────────────────────────────────────

const PRES_ID = 5;

/**
 * Portal URL without ?token so isPublic = false → readOnly = false.
 * The route handler intercepts /api/portal/presentations/5 regardless of headers.
 */
const PORTAL_BASE = `/crm/portal/presentation/${PRES_ID}`;

const ORIGINAL_SOW_VERSION = "sow-0:10000|sow-1:8000";
const UPDATED_SOW_VERSION = "sow-0:15000|sow-1:8000";

// ── Shared mock payloads ────────────────────────────────────────────────────────

const SOW_PHASES = [
  {
    id: "sow-0",
    title: "Phase 1 — Identity Foundation",
    description: "M365 tenant hardening",
    price: 10_000,
    selected: true,
  },
  {
    id: "sow-1",
    title: "Phase 2 — Governance",
    description: "Policy framework",
    price: 8_000,
    selected: false,
  },
];

/**
 * Initial data: scope reduction active (sow-1 deselected) and an existing
 * scoped SOW document.  When checkScopeVersion() later detects a changed
 * sowVersion, the in-memory scopedSowDoc (≠ null) triggers scopedSowWasReset=true.
 */
function makeInitialPresentation() {
  return {
    id: PRES_ID,
    projectId: null,
    clientUserId: null,
    shareToken: null,
    documents: [],
    sowPhases: SOW_PHASES,
    selectedPhaseIds: ["sow-0"],
    totalPrice: 18_000,
    adjustmentsTotal: 0,
    adjustmentLines: [],
    sowVersion: ORIGINAL_SOW_VERSION,
    scopedSowHtml: "<p>Scoped SOW — Phase 1 only</p>",
    scopedTotalPrice: 10_000,
    scopedPhaseIds: ["sow-0"],
    signatureData: null,
    signedAt: null,
    signerName: null,
    paymentPlan: null,
    status: "draft",
    projectTitle: "Playwright Test Project",
    clientName: "Test Client",
    contractBody: "<p>Test contract body.</p>",
    workflowName: null,
  };
}

/**
 * Stale payload: same as the initial data but with a changed sowVersion.
 * Receiving this from checkScopeVersion() sets scopedSowWasReset=true (because
 * the in-memory scopedSowDoc is non-null) and sowResetBlocked=true.
 */
function makeStalePollPresentation() {
  return { ...makeInitialPresentation(), sowVersion: UPDATED_SOW_VERSION };
}

/**
 * Fresh payload: same as the initial data with current sowVersion and a fresh
 * scoped SOW.  Receiving this on reload resets the React state so sowResetBlocked
 * is false on the new PresentationFlow mount (simulating the post-regeneration state).
 */
function makeFreshPresentation() {
  return {
    ...makeInitialPresentation(),
    sowVersion: UPDATED_SOW_VERSION,
    scopedSowHtml: "<p>Fresh Scoped SOW — Phase 1 only (updated pricing)</p>",
    scopedPhaseIds: ["sow-0"],
    scopedTotalPrice: 10_000,
  };
}

// ── Route helpers ────────────────────────────────────────────────────────────────

/**
 * Install a flag-based presentation interceptor.
 *
 * Returns a `staleState` object.  The caller sets `staleState.active = true`
 * just before triggering the poll.  All requests before that — including any
 * caused by re-renders — receive the non-stale payload so that
 * initialSowVersionRef stays set to ORIGINAL_SOW_VERSION.
 */
async function mockPresentation(page: Page): Promise<{ active: boolean }> {
  const staleState = { active: false };

  await page.route(
    `**/api/portal/presentations/${PRES_ID}**`,
    async (route: Route) => {
      const url = route.request().url();

      // Let the SSE stream and regenerate endpoint reach the real server
      if (url.includes("scope-events") || url.includes("regenerate-scoped-sow")) {
        await route.continue();
        return;
      }

      const payload = staleState.active
        ? makeStalePollPresentation()
        : makeInitialPresentation();

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    },
  );

  return staleState;
}

/**
 * Install a "fresh after regeneration" interceptor: every subsequent request
 * returns the fresh payload (UPDATED_SOW_VERSION + new scopedSowHtml).
 * Used to simulate the state after the client has successfully regenerated.
 */
async function mockFreshPresentation(page: Page) {
  await page.unroute(`**/api/portal/presentations/${PRES_ID}**`);
  await page.route(
    `**/api/portal/presentations/${PRES_ID}**`,
    async (route: Route) => {
      const url = route.request().url();
      if (url.includes("scope-events") || url.includes("regenerate-scoped-sow")) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeFreshPresentation()),
      });
    },
  );
}

/**
 * Navigate to the portal path and wait for the React app to be interactive.
 * Uses waitUntil:"load" because the SSE connection never closes.
 */
async function gotoAndWaitForContent(page: Page, extraParams = "") {
  const url = extraParams
    ? `${PORTAL_BASE}?${extraParams}`
    : PORTAL_BASE;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(
    () => document.body.innerText.length > 20,
    { timeout: 15_000 },
  );
}

/**
 * Wait until PresentationFlow is running in non-readonly mode.
 *
 * In readOnly=true mode, the Agreement and Payment step labels are absent from
 * the sidebar.  This selector resolves only after the non-readonly mount, giving
 * us confidence that:
 *   - The correct initialData (with ORIGINAL_SOW_VERSION) is loaded
 *   - The polling setInterval has been registered
 *   - The teaser cards will render the Agreement/Payment sections
 */
async function waitForNonReadOnlyMode(page: Page) {
  // "Agreement" only appears in the sidebar when readOnly=false
  await page.waitForSelector('nav button:has-text("Agreement")', {
    timeout: 20_000,
  });
  // Small real-time pause to let React effects (setInterval) settle after render
  await page.waitForTimeout(300);
}

/**
 * Activate the stale flag and fire the 30-second polling interval via the fake
 * clock, then pause for React state updates to flush.
 */
async function triggerStalePoll(page: Page, staleState: { active: boolean }) {
  staleState.active = true;
  await page.clock.fastForward(31_000);
  await page.waitForTimeout(800);
}

// ── Tests ───────────────────────────────────────────────────────────────────────

test.describe("PresentationFlow — sowResetBlocked hard-block (scope reduction + stale SOW version)", () => {

  test("Agreement teaser card shows amber Blocked badge after polling detects a stale sowVersion", async ({
    page,
  }) => {
    await page.clock.install({ time: Date.now() });
    const staleState = await mockPresentation(page);

    await gotoAndWaitForContent(page);
    await waitForNonReadOnlyMode(page);

    // Verify block is absent before the poll fires
    await expect(
      page.locator('[title="Regenerate your scoped SOW before signing"]'),
    ).not.toBeVisible();

    await triggerStalePoll(page, staleState);

    // After the poll, the Agreement card must be disabled with the amber tooltip
    await expect(
      page.locator('[title="Regenerate your scoped SOW before signing"]'),
    ).toBeVisible({ timeout: 8_000 });

    // The "Blocked" badge text must be present on the card
    await expect(page.getByText("Blocked").first()).toBeVisible({ timeout: 5_000 });
  });

  test("Payment teaser card shows amber Blocked badge after polling detects a stale sowVersion", async ({
    page,
  }) => {
    await page.clock.install({ time: Date.now() });
    const staleState = await mockPresentation(page);

    await gotoAndWaitForContent(page);
    await waitForNonReadOnlyMode(page);
    await triggerStalePoll(page, staleState);

    await expect(
      page.locator('[title="Regenerate your scoped SOW before paying"]'),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("Agreement and Payment teaser cards carry the disabled attribute when sowResetBlocked", async ({
    page,
  }) => {
    await page.clock.install({ time: Date.now() });
    const staleState = await mockPresentation(page);

    await gotoAndWaitForContent(page);
    await waitForNonReadOnlyMode(page);
    await triggerStalePoll(page, staleState);

    const agreementCard = page.locator(
      '[title="Regenerate your scoped SOW before signing"]',
    );
    const paymentCard = page.locator(
      '[title="Regenerate your scoped SOW before paying"]',
    );

    await expect(agreementCard).toBeVisible({ timeout: 8_000 });
    await expect(paymentCard).toBeVisible({ timeout: 5_000 });

    // HTML disabled prevents click events
    await expect(agreementCard).toBeDisabled();
    await expect(paymentCard).toBeDisabled();
  });

  test("sidebar Agreement and Payment items show the regeneration tooltip and cursor-not-allowed when sowResetBlocked", async ({
    page,
  }) => {
    await page.clock.install({ time: Date.now() });
    const staleState = await mockPresentation(page);

    await gotoAndWaitForContent(page);
    await waitForNonReadOnlyMode(page);
    await triggerStalePoll(page, staleState);

    // Both Agreement and Payment sidebar buttons carry this tooltip when isResetBlocked
    const sidebarButtons = page.locator(
      '[title="Regenerate your scoped SOW before signing or paying"]',
    );
    await expect(sidebarButtons.first()).toBeVisible({ timeout: 8_000 });
    await expect(sidebarButtons).toHaveCount(2);

    await expect(sidebarButtons.nth(0)).toHaveClass(/cursor-not-allowed/);
    await expect(sidebarButtons.nth(1)).toHaveClass(/cursor-not-allowed/);
  });

  test("SOW step footer shows disabled 'Continue to Agreement' instead of Next when sowResetBlocked", async ({
    page,
  }) => {
    await page.clock.install({ time: Date.now() });
    const staleState = await mockPresentation(page);

    // Navigate to the SOW step (step 1: welcome=0, sow=1 with 0 documents)
    await gotoAndWaitForContent(page, "step=1");
    await waitForNonReadOnlyMode(page);
    await triggerStalePoll(page, staleState);

    // The footer must show the disabled "Continue to Agreement" placeholder
    await expect(
      page.getByText("Continue to Agreement"),
    ).toBeVisible({ timeout: 8_000 });

    await expect(
      page.locator('button:has-text("Continue to Agreement")'),
    ).toBeDisabled();

    // The normal clickable "Next" button must be absent
    await expect(
      page.locator('button:has-text("Next")'),
    ).not.toBeVisible();
  });

  test("block is absent on fresh load after the client regenerates the scoped SOW", async ({
    page,
  }) => {
    // Phase 1: activate the block
    await page.clock.install({ time: Date.now() });
    const staleState = await mockPresentation(page);

    await gotoAndWaitForContent(page, "step=1");
    await waitForNonReadOnlyMode(page);
    await triggerStalePoll(page, staleState);

    // Confirm the block is active
    await expect(
      page.locator('button:has-text("Continue to Agreement")'),
    ).toBeDisabled({ timeout: 8_000 });

    // Phase 2: simulate a post-regeneration state.
    // After the admin updates prices and the client regenerates the scoped SOW,
    // a fresh page load returns data where sowVersion == initialSowVersionRef
    // (no mismatch) and scopedSowHtml is non-null (fresh document).
    // The new PresentationFlow mount starts with sowResetBlocked=false.
    await mockFreshPresentation(page);
    await page.clock.install({ time: Date.now() });

    // Reload the page — PresentationFlow remounts with fresh initialData
    await gotoAndWaitForContent(page);
    await waitForNonReadOnlyMode(page);

    // Block must be absent: Agreement card is enabled (no amber tooltip)
    await expect(
      page.locator('[title="Regenerate your scoped SOW before signing"]'),
    ).not.toBeVisible({ timeout: 5_000 });

    // The normal Agreement teaser card is visible and clickable
    await expect(
      page.locator('button:has-text("Agreement")').first(),
    ).toBeEnabled();
  });
});
