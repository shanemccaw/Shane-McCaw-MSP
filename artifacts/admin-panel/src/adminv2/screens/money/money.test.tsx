// @vitest-environment jsdom
/**
 * The Money screen's own contract + interaction coverage — registration
 * legality and the right-click menus on its real rows (sales, cost lines,
 * retainers, clients, ramp targets). `Shell.test.tsx` already covers
 * shell-chrome integration against a demo screen.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getScreen, resetRegistry } from "../../registry/registry";
import type { ScreenModule } from "../../registry/types";
import { MoneyBody } from "./MoneyBody";
import { configureMoneyFetch, loadSummary, resetMoneyStore, setView } from "./moneyStore";

const fetchWithAuth = vi.fn();
const clipboardWrite = vi.fn((_text: string) => Promise.resolve());

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

const SUMMARY = {
  ok: true,
  mspId: 1,
  month: "August 2026",
  monthKey: "2026-08",
  revenue: { cents: 500000 },
  cost: { cents: 12000, byFeature: [{ label: "SOW generation", cents: 12000 }], note: "AI usage this month" },
  profit: { cents: 488000 },
  lifetimeRevenue: { cents: 2000000 },
  sales: {
    count: 2,
    goal: 3,
    items: [{ id: "s1", when: "2026-08-01T00:00:00.000Z", who: "Tailspin Toys", what: "Copilot readiness assessment", amountCents: 250000 }],
  },
  retainers: [{ id: "r1", who: "Contoso", what: "Monthly retainer", monthlyCents: 150000 }],
  mrr: { cents: 150000, goalCents: 600000 },
  streak: 4,
  trend: [{ month: "2026-08", label: "Aug", cents: 500000 }],
};

const BUSINESS = {
  ok: true,
  mspId: 1,
  windowMonths: 6,
  recurringSharePct: 30,
  marginAfterAiCostPct: 90,
  clientConcentrationPct: 40,
  mrrCents: 150000,
  benchmarks: [],
  benchmarkNote: "Benchmarks note.",
  clients: [{ who: "Contoso", mrrCents: 150000, sharePct: 40 }],
};

const RAMP = {
  ok: true,
  mspId: 1,
  goalSales: 3,
  avgSaleCents: 250000,
  projectedYearCents: 1500000,
  rows: [{ month: "2026-08", label: "Aug 2026", target: 3, actual: 2, worthCents: 750000 }],
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth }),
}));

let moneyScreen: ScreenModule;

beforeAll(async () => {
  resetRegistry();
  // No `vi.resetModules()`, and only ONE `import("./index")` for the whole
  // file — see `crm.test.tsx`'s identical note on why a second re-import
  // would leave `getScreen("money")` undefined for every later test.
  await import("./index");
  moneyScreen = getScreen("money")!;
});

beforeEach(() => {
  fetchWithAuth.mockReset();
  clipboardWrite.mockReset().mockImplementation(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWrite },
    configurable: true,
  });
  resetMoneyStore();
  configureMoneyFetch(fetchWithAuth);
  fetchWithAuth.mockImplementation((path: string) => {
    if (path === "/api/admin/money/summary") return Promise.resolve(jsonResponse(SUMMARY));
    if (path === "/api/admin/money/business") return Promise.resolve(jsonResponse(BUSINESS));
    if (path === "/api/admin/money/ramp") return Promise.resolve(jsonResponse(RAMP));
    return Promise.resolve(jsonResponse({ ok: true }));
  });
});

afterEach(cleanup);

describe("registration", () => {
  it("registers against the fixed money tab only, with no per-record actions", () => {
    expect(moneyScreen).toBeTruthy();
    expect(moneyScreen.route).toBe("/money");
    const tabs = new Set(moneyScreen.ribbon?.map((r) => r.tab));
    expect(tabs).toEqual(new Set(["money"]));

    const allCommands = (moneyScreen.ribbon ?? []).flatMap((r) => [
      ...(r.group.large ?? []),
      ...(r.group.small ?? []),
      ...(r.group.row ?? []),
    ]);
    expect(allCommands.every((c) => c.intent === "open" || c.intent === "create" || c.intent === "global")).toBe(true);
  });
});

describe("row context menus", () => {
  it("right-clicking a sale row offers Copy amount / Copy sale details", async () => {
    await loadSummary();
    render(<MoneyBody />);
    expect(await screen.findByText("Tailspin Toys")).toBeTruthy();

    const row = screen.getByText("Tailspin Toys").closest("div")!.parentElement as HTMLElement;
    fireEvent.contextMenu(row);
    expect(screen.getByRole("menuitem", { name: "Copy amount" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy sale details" }));
    const expectedDate = new Date("2026-08-01T00:00:00.000Z").toLocaleDateString();
    expect(clipboardWrite).toHaveBeenCalledWith(`Tailspin Toys — Copilot readiness assessment — $2,500 — ${expectedDate}`);
  });

  it("right-clicking a retainer row offers Copy retainer details", async () => {
    await loadSummary();
    render(<MoneyBody />);
    expect(await screen.findByText("Contoso")).toBeTruthy();

    const row = screen.getByText("Contoso").closest("div") as HTMLElement;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy retainer details" }));
    expect(clipboardWrite).toHaveBeenCalledWith("Contoso — Monthly retainer — $1,500/mo");
  });

  it("right-clicking a cost line offers Copy amount", async () => {
    await loadSummary();
    render(<MoneyBody />);
    expect(await screen.findByText("SOW generation")).toBeTruthy();

    const row = screen.getByText("SOW generation").closest("div") as HTMLElement;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy amount" }));
    expect(clipboardWrite).toHaveBeenCalledWith("SOW generation: $120");
  });

  it("right-clicking a client row (The business view) offers Copy client details", async () => {
    await loadSummary();
    render(<MoneyBody />);
    expect(await screen.findByText("Tailspin Toys")).toBeTruthy();
    setView("business");

    expect(await screen.findByText("Contoso")).toBeTruthy();
    const rows = screen.getAllByText("Contoso");
    const row = rows[rows.length - 1].closest("div") as HTMLElement;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy client details" }));
    expect(clipboardWrite).toHaveBeenCalledWith("Contoso — $1,500/mo — 40% of revenue");
  });

  it("right-clicking a ramp row offers Copy this row", async () => {
    await loadSummary();
    render(<MoneyBody />);
    expect(await screen.findByText("Tailspin Toys")).toBeTruthy();
    setView("ramp");

    expect(await screen.findByText("Aug 2026")).toBeTruthy();
    const row = screen.getByText("Aug 2026").closest("div")!.parentElement as HTMLElement;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy this row" }));
    expect(clipboardWrite).toHaveBeenCalledWith("Aug 2026: target 3, projected $7,500, 2 so far");
  });
});
