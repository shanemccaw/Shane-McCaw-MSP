/**
 * E2E test: receiptLinkPolling — receipt URL polling on the ConfirmationStep.
 *
 * Scenario:
 *   After a Stripe payment completes, the client lands on the ConfirmationStep.
 *   There is a race between Stripe issuing the hosted invoice URL and the
 *   client arriving on the page.  ConfirmationStep handles this by:
 *
 *     1. Fetching /api/portal/presentations/:id/payment-summary on mount.
 *     2. If receiptUrl is NOT a real "invoice.stripe.com" URL, starting a
 *        10-second setInterval (up to 6 polls) that keeps re-fetching until
 *        a real URL appears.
 *     3. While waiting, showing a "Retrieving receipt link…" spinner.
 *     4. Once a real URL arrives, swapping in a "View Receipt →" link and
 *        hiding the spinner.
 *
 * Technique:
 *   • The presentation endpoint returns status "paid" so PresentationFlow
 *     renders the ConfirmationStep.
 *   • A flag-based interceptor on the payment-summary endpoint returns a
 *     placeholder URL on the first call, then a real invoice.stripe.com URL
 *     once the flag is set (simulating delayed invoice creation by Stripe).
 *   • page.clock.fastForward(10_000) fires the polling interval without
 *     real waiting.
 *   • A second test verifies the spinner is absent from the start when a real
 *     URL is present in the initial response.
 *
 * Run with:
 *   pnpm --filter @workspace/crm run test:e2e
 */
import { test, expect, type Page, type Route } from "@playwright/test";

// ── Constants ────────────────────────────────────────────────────────────────

const PRES_ID = 7;
/**
 * URL with ?payment=success so PortalPresentation sets startAtPayment=true,
 * which routes directly to the confirmation step when status="paid".
 * Omitting ?token keeps isPublic=false → readOnly=false so confirmation step
 * is included in the step list by buildSteps().
 */
const PORTAL_BASE = `/crm/portal/presentation/${PRES_ID}?payment=success`;

const REAL_RECEIPT_URL = "https://invoice.stripe.com/acct_test123/invst_test456";
const PLACEHOLDER_RECEIPT_URL = "https://pay.stripe.com/some-non-invoice-url";

// ── Mock payloads ────────────────────────────────────────────────────────────

function makePresentation(overrides: Record<string, unknown> = {}) {
  return {
    id: PRES_ID,
    projectId: 42,
    clientUserId: null,
    shareToken: null,
    documents: [],
    sowPhases: [
      {
        id: "sow-0",
        title: "Phase 1 — Identity Foundation",
        description: "M365 tenant hardening",
        price: 10_000,
        selected: true,
      },
    ],
    selectedPhaseIds: ["sow-0"],
    totalPrice: 10_000,
    adjustmentsTotal: 0,
    adjustmentLines: [],
    sowVersion: "sow-0:10000",
    scopedSowHtml: null,
    scopedTotalPrice: null,
    scopedPhaseIds: [],
    signatureData: "data:image/png;base64,abc",
    signedAt: "2025-01-15T10:00:00.000Z",
    signerName: "Test Client",
    paymentPlan: "full",
    status: "paid",
    projectTitle: "Receipt Polling Test Project",
    clientName: "Test Client",
    contractBody: "<p>Test contract body.</p>",
    workflowName: null,
    ...overrides,
  };
}

/**
 * Payment summary with no real receipt URL yet (placeholder or null).
 * ConfirmationStep will start polling when it sees this.
 */
function makePendingSummary() {
  return {
    receiptUrl: PLACEHOLDER_RECEIPT_URL,
    invoiceId: null,
    invoicePdfPath: null,
    contractId: null,
    contractPdfPath: null,
    paidAt: "2025-01-15T10:05:00.000Z",
    signerName: "Test Client",
    signedAt: "2025-01-15T10:00:00.000Z",
    paymentPlan: "full",
    phases: [
      {
        id: "sow-0",
        title: "Phase 1 — Identity Foundation",
        price: 10_000,
        deliveryDate: null,
        invoiceStatus: "paid",
      },
    ],
    sowDocPath: null,
  };
}

/**
 * Payment summary with a real invoice.stripe.com URL.
 * ConfirmationStep will stop polling and show the "View Receipt →" link.
 */
function makeResolvedSummary() {
  return {
    ...makePendingSummary(),
    receiptUrl: REAL_RECEIPT_URL,
  };
}

/**
 * Payment summary with receiptUrl: null.
 * Shows "Receipt will appear here once processed" initially.
 */
function makeNullReceiptSummary() {
  return {
    ...makePendingSummary(),
    receiptUrl: null,
  };
}

// ── Route helpers ────────────────────────────────────────────────────────────

/** Mock the presentation to return paid status so ConfirmationStep renders. */
async function mockPresentation(page: Page) {
  await page.route(
    `**/api/portal/presentations/${PRES_ID}**`,
    async (route: Route) => {
      const url = route.request().url();
      if (
        url.includes("scope-events") ||
        url.includes("payment-summary") ||
        url.includes("simulate-payment")
      ) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makePresentation()),
      });
    },
  );
}

/**
 * Install a flag-based payment-summary interceptor.
 *
 * Returns a `resolvedState` object.  Set `resolvedState.active = true` just
 * before advancing the clock so the poll receives the real invoice URL.
 */
async function mockPaymentSummaryWithDelay(
  page: Page,
  initialSummary: ReturnType<typeof makePendingSummary>,
): Promise<{ active: boolean }> {
  const resolvedState = { active: false };

  await page.route(
    `**/api/portal/presentations/${PRES_ID}/payment-summary**`,
    async (route: Route) => {
      const summary = resolvedState.active
        ? makeResolvedSummary()
        : initialSummary;

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(summary),
      });
    },
  );

  return resolvedState;
}

/** Mock payment-summary to immediately return a real invoice URL. */
async function mockPaymentSummaryResolved(page: Page) {
  await page.route(
    `**/api/portal/presentations/${PRES_ID}/payment-summary**`,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeResolvedSummary()),
      });
    },
  );
}

/**
 * Navigate to the portal confirmation page and wait for the React app to
 * hydrate.  Uses waitUntil:"load" because the SSE connection never closes.
 */
async function gotoAndWaitForContent(page: Page) {
  await page.goto(PORTAL_BASE, { waitUntil: "load" });
  await page.waitForFunction(
    () => document.body.innerText.length > 20,
    { timeout: 20_000 },
  );
}

/**
 * Wait until the ConfirmationStep hero heading is visible.
 * The heading "Payment Confirmed" label appears just above the project title.
 */
async function waitForConfirmationStep(page: Page) {
  await page.waitForSelector('text=Payment Confirmed', { timeout: 20_000 });
  await page.waitForTimeout(300);
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("ConfirmationStep — receipt link polling", () => {

  test("shows polling spinner while receipt URL is pending, then 'View Receipt →' link once real URL resolves", async ({
    page,
  }) => {
    await page.clock.install({ time: Date.now() });
    await mockPresentation(page);
    const resolvedState = await mockPaymentSummaryWithDelay(
      page,
      makePendingSummary(),
    );

    await gotoAndWaitForContent(page);
    await waitForConfirmationStep(page);

    // The component shows a "Retrieving receipt link…" spinner while polling
    await expect(
      page.getByText("Retrieving receipt link…"),
    ).toBeVisible({ timeout: 8_000 });

    // "View Receipt →" must NOT be present yet
    await expect(
      page.getByText("View Receipt →"),
    ).not.toBeVisible();

    // Activate the resolved state and advance the clock by one polling interval (10 s)
    resolvedState.active = true;
    await page.clock.fastForward(10_000);
    await page.waitForTimeout(500);

    // The "View Receipt →" link must now be visible
    await expect(
      page.getByText("View Receipt →"),
    ).toBeVisible({ timeout: 8_000 });

    // The spinner must be gone once the real URL is loaded
    await expect(
      page.getByText("Retrieving receipt link…"),
    ).not.toBeVisible();

    // The link must point to the real invoice.stripe.com URL
    const receiptLink = page.locator('a:has-text("View Receipt →")');
    await expect(receiptLink).toHaveAttribute("href", REAL_RECEIPT_URL);
    await expect(receiptLink).toHaveAttribute("target", "_blank");
  });

  test("shows polling spinner when receiptUrl is null initially, then resolves to 'View Receipt →'", async ({
    page,
  }) => {
    await page.clock.install({ time: Date.now() });
    await mockPresentation(page);
    const resolvedState = await mockPaymentSummaryWithDelay(
      page,
      makeNullReceiptSummary(),
    );

    await gotoAndWaitForContent(page);
    await waitForConfirmationStep(page);

    // Null receiptUrl still triggers polling — spinner must be visible
    await expect(
      page.getByText("Retrieving receipt link…"),
    ).toBeVisible({ timeout: 8_000 });

    // View Receipt link must be absent
    await expect(page.getByText("View Receipt →")).not.toBeVisible();

    // Advance to the next poll
    resolvedState.active = true;
    await page.clock.fastForward(10_000);
    await page.waitForTimeout(500);

    // Now the real URL has arrived
    await expect(
      page.getByText("View Receipt →"),
    ).toBeVisible({ timeout: 8_000 });

    await expect(
      page.getByText("Retrieving receipt link…"),
    ).not.toBeVisible();
  });

  test("shows 'View Receipt →' immediately when payment-summary already has a real invoice URL", async ({
    page,
  }) => {
    await page.clock.install({ time: Date.now() });
    await mockPresentation(page);
    await mockPaymentSummaryResolved(page);

    await gotoAndWaitForContent(page);
    await waitForConfirmationStep(page);

    // Real URL available on first fetch — link must appear without any polling
    await expect(
      page.getByText("View Receipt →"),
    ).toBeVisible({ timeout: 8_000 });

    // Polling spinner must never appear
    await expect(
      page.getByText("Retrieving receipt link…"),
    ).not.toBeVisible();

    const receiptLink = page.locator('a:has-text("View Receipt →")');
    await expect(receiptLink).toHaveAttribute("href", REAL_RECEIPT_URL);
  });

  test("stops polling after 6 attempts and leaves the placeholder when URL never resolves", async ({
    page,
  }) => {
    await page.clock.install({ time: Date.now() });
    await mockPresentation(page);

    // Never resolve — always return null receiptUrl
    await page.route(
      `**/api/portal/presentations/${PRES_ID}/payment-summary**`,
      async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(makeNullReceiptSummary()),
        });
      },
    );

    await gotoAndWaitForContent(page);
    await waitForConfirmationStep(page);

    // Spinner is visible during early polls
    await expect(
      page.getByText("Retrieving receipt link…"),
    ).toBeVisible({ timeout: 8_000 });

    // Advance past all 6 poll attempts in two steps so each async callback
    // resolves before the next tick fires.  Playwright's fake clock queues all
    // ticks from a single fastForward simultaneously, but each tick's async
    // fetchSummary() callback needs a real-time gap to settle.
    for (let i = 0; i < 6; i++) {
      await page.clock.fastForward(10_000);
      await page.waitForTimeout(300);
    }

    // After exhausting all 6 polls, the spinner disappears
    await expect(
      page.getByText("Retrieving receipt link…"),
    ).not.toBeVisible({ timeout: 8_000 });

    // The "View Receipt →" link must still be absent (URL never arrived)
    await expect(page.getByText("View Receipt →")).not.toBeVisible();

    // The fallback text must appear instead
    await expect(
      page.getByText("Receipt will appear here once processed"),
    ).toBeVisible({ timeout: 5_000 });
  });
});
