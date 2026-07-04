// @vitest-environment jsdom
/**
 * Component-level test: PresentationFlow amber stale-scope banner.
 *
 * Renders the REAL PresentationFlow component in a jsdom environment and
 * verifies that when the 30-second polling mechanism detects a changed
 * sowVersion (simulating Shane regenerating the SOW mid-session), the amber
 * warning banner "The scope of work has been updated" becomes visible,
 * blocking the client from proceeding to sign or pay with stale pricing.
 *
 * Isolation strategy:
 *   - All child panel components are replaced by lightweight stubs so the
 *     test does not pull in canvas, Three.js, signature-canvas, etc.
 *   - AuthContext returns a minimal no-user context (share-token path).
 *   - EventSource is mocked globally so SSE connections don't error in jsdom.
 *   - global.fetch is controlled via a `returnStaleVersion` flag that starts
 *     false (original version → no banner) and is flipped to true before the
 *     second polling interval (regenerated version → banner appears).
 *   - vi.useFakeTimers() + vi.advanceTimersByTimeAsync() advance time without
 *     real waits and correctly drain any async continuations (e.g. fetch
 *     promises) that the interval callbacks spawn.
 *   - @testing-library/react cleanup() runs in afterEach so DOM from one test
 *     never leaks into the next.
 *
 * Run with:
 *   pnpm --filter @workspace/crm run test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import React from "react";

// ── Mock all sub-components BEFORE importing the component under test ──────────
// This prevents the test from pulling in heavy deps (Three.js, canvas, etc.).

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,           // no auth user — use the share-token (unauthenticated) path
    fetchWithAuth: vi.fn(),
  }),
}));

vi.mock("./DocumentPanel", () => ({
  default: (props: { onReady?: () => void }) => {
    if (props.onReady) setTimeout(() => props.onReady!(), 0);
    return React.createElement("div", { "data-testid": "document-panel" }, "Document Panel");
  },
}));

vi.mock("./SowSelectorPanel", () => ({
  default: (props: { onReady?: () => void }) => {
    if (props.onReady) setTimeout(() => props.onReady!(), 0);
    return React.createElement("div", { "data-testid": "sow-panel" }, "SOW Panel");
  },
}));

vi.mock("./ContractSignPanel", () => ({
  default: (props: { onReady?: () => void }) => {
    if (props.onReady) setTimeout(() => props.onReady!(), 0);
    return React.createElement("div", { "data-testid": "contract-panel" }, "Contract Panel");
  },
}));

vi.mock("./PaymentOptionsPanel", () => ({
  default: () => React.createElement("div", { "data-testid": "payment-panel" }, "Payment Panel"),
}));

vi.mock("../quickwin/AnimatedBackground", () => ({
  default: () => React.createElement("div", { "data-testid": "animated-bg" }),
}));

vi.mock("@/lib/doc-stat-extractors", () => ({
  computeOverviewStats: () => ({
    worstScore: 75,
    totalFindings: 0,
    families: [],
    governance: { score: null, findings: 0 },
    security: { score: null, findings: 0 },
    copilot: { score: null, findings: 0 },
    licensing: { score: null, findings: 0 },
    deployment: { score: null, findings: 0 },
    remediation: { items: 0 },
  }),
}));

// ── Import the real component AFTER all vi.mock() calls ───────────────────────
import PresentationFlow from "./PresentationFlow";

// ── Constants ─────────────────────────────────────────────────────────────────

const SOW_VERSION_ORIGINAL    = "sow-0:10000|sow-1:8000";
const SOW_VERSION_REGENERATED = "sow-0:15000|sow-1:8000"; // Phase 1 price raised

// ── Minimal EventSource mock ───────────────────────────────────────────────────
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  close() { /* no-op */ }
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
}

// ── Minimal PresentationData factory ──────────────────────────────────────────
function makeInitialData(sowVersion: string) {
  return {
    id: 1,
    projectId: null as number | null,
    clientUserId: null as number | null,
    shareToken: "test-share-token",
    documents: [],
    sowPhases: [
      { id: "sow-0", title: "Phase 1 — Foundation", description: "Identity setup", price: 10_000, selected: true },
      { id: "sow-1", title: "Phase 2 — Governance", description: "Policy", price: 8_000, selected: true },
    ],
    selectedPhaseIds: ["sow-0", "sow-1"],
    totalPrice: 18_000,
    sowVersion,
    signatureData: null as string | null,
    signedAt: null as string | null,
    signerName: null as string | null,
    paymentPlan: null as "full" | "phased" | null,
    status: "draft" as "draft" | "signed" | "paid",
    projectTitle: "M365 Foundation Engagement",
    clientName: "Acme Corp",
    contractBody: null as string | null,
    workflowName: null as string | null,
  };
}

/** Build a fetch mock controlled by a flag.
 *  While returnStaleVersion is false → original sowVersion (versions match, no banner).
 *  While returnStaleVersion is true  → regenerated sowVersion (mismatch → banner). */
function makeFetchMock(flagRef: { value: boolean }) {
  return vi.fn((_url: string) => {
    const sowVersion = flagRef.value ? SOW_VERSION_REGENERATED : SOW_VERSION_ORIGINAL;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        id: 1,
        sowVersion,
        sowPhases: [],
        selectedPhaseIds: [],
        totalPrice: 18_000,
        documents: [],
        signatureData: null,
        signedAt: null,
        signerName: null,
        paymentPlan: null,
        status: "draft",
        projectTitle: "M365 Foundation",
        clientName: "Acme Corp",
        contractBody: null,
        workflowName: null,
        projectId: null,
        clientUserId: null,
        shareToken: "test-share-token",
      }),
    });
  });
}

// =============================================================================
// Tests
// =============================================================================

describe("PresentationFlow — stale-scope amber banner", () => {
  let staleFlag: { value: boolean };

  beforeEach(() => {
    staleFlag = { value: false };
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", makeFetchMock(staleFlag));
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup(); // unmount and remove all rendered React trees from the document
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ── Helper ────────────────────────────────────────────────────────────────

  /** Advance fake timers by `ms` milliseconds and flush all resulting Promises. */
  async function advanceAndFlush(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  // ── Tests ─────────────────────────────────────────────────────────────────

  it("does NOT show the stale-scope banner on initial render (sowVersion matches)", () => {
    render(
      React.createElement(PresentationFlow, {
        presentationId: 1,
        initialData: makeInitialData(SOW_VERSION_ORIGINAL),
        shareToken: "test-share-token",
        onClose: () => {},
      }),
    );

    // No timer advance — banner must be absent right after mount
    const matches = screen.queryAllByText(/scope of work has been updated/i);
    expect(matches.length).toBe(0);
  });

  it("shows the amber stale-scope banner after polling detects a changed sowVersion", async () => {
    render(
      React.createElement(PresentationFlow, {
        presentationId: 1,
        initialData: makeInitialData(SOW_VERSION_ORIGINAL),
        shareToken: "test-share-token",
        onClose: () => {},
      }),
    );

    // First poll at 30 s — version unchanged; no banner
    await advanceAndFlush(30_000);
    expect(screen.queryAllByText(/scope of work has been updated/i).length).toBe(0);

    // Shane regenerates the SOW between the first and second poll
    staleFlag.value = true;

    // Second poll at 60 s — version now differs; banner must appear
    await advanceAndFlush(30_000);
    expect(screen.queryAllByText(/scope of work has been updated/i).length).toBeGreaterThan(0);
  });

  it("banner contains a 'Refresh scope' button so the client can accept the new pricing", async () => {
    render(
      React.createElement(PresentationFlow, {
        presentationId: 1,
        initialData: makeInitialData(SOW_VERSION_ORIGINAL),
        shareToken: "test-share-token",
        onClose: () => {},
      }),
    );

    staleFlag.value = true;

    // One poll fires and detects the stale version
    await advanceAndFlush(30_000);

    const refreshBtn = screen.queryAllByText(/refresh scope/i);
    expect(refreshBtn.length).toBeGreaterThan(0);
  });

  it("banner instructs the client to review pricing before signing or paying", async () => {
    render(
      React.createElement(PresentationFlow, {
        presentationId: 1,
        initialData: makeInitialData(SOW_VERSION_ORIGINAL),
        shareToken: "test-share-token",
        onClose: () => {},
      }),
    );

    staleFlag.value = true;
    await advanceAndFlush(30_000);

    const text = screen.queryAllByText(/please review the latest pricing before signing or paying/i);
    expect(text.length).toBeGreaterThan(0);
  });

  it("banner remains absent across multiple polls when sowVersion never changes", async () => {
    // staleFlag stays false throughout — server always returns original version
    render(
      React.createElement(PresentationFlow, {
        presentationId: 1,
        initialData: makeInitialData(SOW_VERSION_ORIGINAL),
        shareToken: "test-share-token",
        onClose: () => {},
      }),
    );

    // Advance through 3 polling intervals — version always matches
    await advanceAndFlush(90_000);

    expect(screen.queryAllByText(/scope of work has been updated/i).length).toBe(0);
  });

  it("SSE subscription is established with the share token in the URL", async () => {
    render(
      React.createElement(PresentationFlow, {
        presentationId: 42,
        initialData: makeInitialData(SOW_VERSION_ORIGINAL),
        shareToken: "my-unique-token",
        onClose: () => {},
      }),
    );

    // Let effects run
    await act(async () => { await Promise.resolve(); });

    const sseInstance = MockEventSource.instances.find(es =>
      es.url.includes("/scope-events") && es.url.includes("my-unique-token"),
    );
    expect(sseInstance).toBeDefined();
  });
});
