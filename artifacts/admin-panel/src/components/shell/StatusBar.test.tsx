// @vitest-environment jsdom
/**
 * Tests: AI Cost Governance Phase 3 (#51) — the StatusBar's "Today"/"Month" AI
 * spend segments.
 *
 * StatusBar is presentational: the totals, the delta chip state and the recent
 * list all arrive as props from GlobalIDEShell (via useAiCostSegments), so this
 * file drives those props directly and asserts what gets rendered and what the
 * segment does when hovered or clicked.
 *
 * The Radix HoverCard is mocked to render its content inline. Radix's own
 * open/close timing is its concern, not this component's — what matters here is
 * that the popover renders REAL last-10 data, and that hovering is what
 * triggers the fetch. Both are asserted; the animation is not.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AiCostSegments, AiCostTransaction } from "@/hooks/useAiCostSegments";

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/system/inbox", navigate],
  Link: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("@/hooks/useVersionInfo", () => ({
  useVersionInfo: () => ({ display: "1.0.0", hash: "abc1234", startedAt: null }),
  formatRunningSince: () => "",
}));

vi.mock("@/components/ui/hover-card", () => ({
  HoverCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardContent: ({ children }: { children: ReactNode }) => <div data-testid="popover">{children}</div>,
}));

import StatusBar from "./StatusBar";

const loadRecent = vi.fn();

function aiCost(overrides: Partial<AiCostSegments> = {}): AiCostSegments {
  return {
    todayCents: 1234,
    monthCents: 56789,
    deltaCents: 0,
    deltaVisible: false,
    deltaExiting: false,
    recent: [],
    recentLoading: false,
    loadRecent,
    ...overrides,
  };
}

function transaction(overrides: Partial<AiCostTransaction> = {}): AiCostTransaction {
  return {
    eventId: "e1",
    occurredAt: "2026-07-28T12:00:00.000Z",
    costCents: 134,
    mspName: "Acme MSP",
    customerName: "Contoso",
    generatedArtifactName: "SOW - Contoso",
    generatedArtifactType: "sow",
    feature: "workflow:generate_document",
    nodeType: "generate_document",
    ...overrides,
  };
}

function renderBar(cost?: AiCostSegments) {
  return render(
    <StatusBar
      workspaceLabel="System"
      sectionLabel="Inbox"
      liveVisitors={null}
      campaignBadges={[]}
      unreadEmailCount={0}
      unreadNotifCount={0}
      onBellClick={vi.fn()}
      soundMuted={false}
      onToggleMute={vi.fn()}
      consoleOpen={false}
      onToggleConsole={vi.fn()}
      aiCost={cost}
    />,
  );
}

/** The clickable button for one spend segment. */
function segment(label: "Today" | "Month"): HTMLElement {
  return screen.getByText(label).closest("button")!;
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

// ── Rendering ─────────────────────────────────────────────────────────────────

describe("StatusBar AI spend segments — rendering", () => {
  it("renders both segments with cents formatted as dollars", () => {
    renderBar(aiCost());
    expect(screen.getByText("Today")).toBeDefined();
    expect(screen.getByText("$12.34")).toBeDefined();
    expect(screen.getByText("Month")).toBeDefined();
    expect(screen.getByText("$567.89")).toBeDefined();
  });

  it("renders $0.00 for a real zero total — a known zero is not the same as no data", () => {
    renderBar(aiCost({ todayCents: 0, monthCents: 0 }));
    expect(screen.getAllByText("$0.00")).toHaveLength(2);
  });

  it("hides a segment whose total never seeded, without hiding the other", () => {
    renderBar(aiCost({ todayCents: null }));
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.getByText("Month")).toBeDefined();
    expect(screen.getByText("$567.89")).toBeDefined();
  });

  it("renders neither segment when the aiCost prop is omitted entirely", () => {
    renderBar(undefined);
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.queryByText("Month")).toBeNull();
    // The rest of the bar is unaffected — this prop is purely additive.
    expect(screen.getByText("System")).toBeDefined();
  });
});

// ── Delta chip ────────────────────────────────────────────────────────────────

describe("StatusBar AI spend segments — delta chip", () => {
  it("shows one delta chip per segment when a delta is live", () => {
    renderBar(aiCost({ deltaVisible: true, deltaCents: 34 }));
    const chips = screen.getAllByText("▲ $0.34");
    expect(chips).toHaveLength(2);
  });

  it("renders no chip when no delta is live", () => {
    renderBar(aiCost({ deltaVisible: false, deltaCents: 0 }));
    expect(screen.queryByText(/▲/)).toBeNull();
  });

  it("takes the existing count-pop animation on entry and the fade class on exit", () => {
    const { rerender } = renderBar(aiCost({ deltaVisible: true, deltaCents: 34 }));
    expect(screen.getAllByText("▲ $0.34")[0]!.className).toContain("count-pop");

    rerender(
      <StatusBar
        workspaceLabel="System"
        sectionLabel="Inbox"
        liveVisitors={null}
        campaignBadges={[]}
        unreadEmailCount={0}
        unreadNotifCount={0}
        onBellClick={vi.fn()}
        soundMuted={false}
        onToggleMute={vi.fn()}
        consoleOpen={false}
        onToggleConsole={vi.fn()}
        aiCost={aiCost({ deltaVisible: true, deltaExiting: true, deltaCents: 34 })}
      />,
    );
    // Reuses .sale-flash-exit rather than introducing a second fade animation.
    expect(screen.getAllByText("▲ $0.34")[0]!.className).toContain("sale-flash-exit");
  });
});

// ── Hover popover ─────────────────────────────────────────────────────────────

describe("StatusBar AI spend segments — hover popover", () => {
  it("fetches the last-10 list on hover, not on mount", () => {
    renderBar(aiCost());
    expect(loadRecent).not.toHaveBeenCalled();

    fireEvent.mouseEnter(segment("Today"));
    expect(loadRecent).toHaveBeenCalledTimes(1);
  });

  it("also fetches on keyboard focus so the popover is not mouse-only", () => {
    renderBar(aiCost());
    fireEvent.focus(segment("Month"));
    expect(loadRecent).toHaveBeenCalledTimes(1);
  });

  it("renders each transaction's time, MSP, customer, artifact and cost", () => {
    renderBar(aiCost({ recent: [transaction()] }));
    const popover = screen.getAllByTestId("popover")[0]!;

    expect(within(popover).getByText("SOW - Contoso")).toBeDefined();
    expect(within(popover).getByText("Acme MSP › Contoso")).toBeDefined();
    expect(within(popover).getByText("$1.34")).toBeDefined();
    // Time is locale-formatted, so assert the row is timestamped rather than
    // pinning a locale-specific string.
    expect(within(popover).queryByText("—")).toBeNull();
  });

  it("labels an MSP-less (platform-owned) transaction as Platform", () => {
    renderBar(aiCost({ recent: [transaction({ mspName: null, customerName: null })] }));
    const popover = screen.getAllByTestId("popover")[0]!;
    expect(within(popover).getByText("Platform")).toBeDefined();
  });

  it("falls back through artifact type → feature → node type for the label", () => {
    renderBar(aiCost({
      recent: [transaction({ generatedArtifactName: null, generatedArtifactType: null })],
    }));
    const popover = screen.getAllByTestId("popover")[0]!;
    expect(within(popover).getByText("workflow:generate_document")).toBeDefined();
  });

  it("shows an explicit empty state rather than a blank popover", () => {
    renderBar(aiCost({ recent: [] }));
    expect(screen.getAllByText("No AI usage recorded yet.").length).toBeGreaterThan(0);
  });

  it("shows a loading state only while the first fetch is in flight", () => {
    renderBar(aiCost({ recent: [], recentLoading: true }));
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);

    cleanup();
    // Once data exists, a refetch keeps showing the real rows instead of
    // flashing back to a spinner.
    renderBar(aiCost({ recent: [transaction()], recentLoading: true }));
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.getAllByText("SOW - Contoso").length).toBeGreaterThan(0);
  });
});

// ── Click-through ─────────────────────────────────────────────────────────────

describe("StatusBar AI spend segments — click-through", () => {
  it("navigates to the AI Billing page pre-filtered to the day view", () => {
    renderBar(aiCost());
    fireEvent.click(segment("Today"));
    expect(navigate).toHaveBeenCalledWith("/system/ai-billing?range=today");
  });

  it("navigates to the AI Billing page pre-filtered to the month view", () => {
    renderBar(aiCost());
    fireEvent.click(segment("Month"));
    expect(navigate).toHaveBeenCalledWith("/system/ai-billing?range=month");
  });
});
