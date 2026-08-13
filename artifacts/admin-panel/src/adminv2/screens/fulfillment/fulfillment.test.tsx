// @vitest-environment jsdom
/**
 * Fulfillment screen's right-click coverage — added alongside the other
 * screens in this sweep. Reuses this screen's own store seams
 * (`seedFulfillmentStore`/`resetFulfillmentStore`, already present for
 * testing) rather than mocking the network for every case: a context menu's
 * job is to call an existing store function with the right arguments, so
 * these assert the resulting `adminFetch` call, the same shape
 * `fulfillmentStore.ts`'s own writes take.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FulfillmentExplorerView } from "./FulfillmentExplorer";
import { FulfillmentTypesPanel } from "./FulfillmentTypesPanel";
import { FulfillmentBody } from "./FulfillmentBody";
import {
  configureFulfillmentFetch,
  getSnapshot,
  resetFulfillmentStore,
  seedFulfillmentStore,
} from "./fulfillmentStore";
import type { DeliveryRow, FulfillmentTypeRow } from "./fulfillmentTypes";

const fetchWithAuth = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

const DELIVERY: DeliveryRow = {
  id: 501,
  sourceType: "offer",
  sourceId: "off-1",
  clientUserId: null,
  clientName: "Acme Corp",
  clientEmail: null,
  mspId: null,
  mspName: null,
  customerId: null,
  customerName: null,
  itemTitle: "M365 Security Assessment",
  itemDescription: null,
  purchasedAt: "2026-08-01T00:00:00.000Z",
  purchaseAmountCents: 250000,
  wholesaleChargedCents: null,
  customerQuoteCents: null,
  deliveryStatus: "not_started",
  statusUpdatedAt: null,
  statusNote: null,
  projectId: null,
  presentationId: null,
  invoiceId: null,
  slaDueAt: "2026-08-15T00:00:00.000Z",
  slaThresholdDays: 14,
  isOverdue: false,
  createdAt: "2026-08-01T00:00:00.000Z",
};

const OVERDUE_DELIVERY: DeliveryRow = {
  ...DELIVERY,
  id: 502,
  itemTitle: "Overdue Onboarding",
  deliveryStatus: "in_progress",
  isOverdue: true,
  slaDueAt: "2026-07-20T00:00:00.000Z",
};

const TYPE: FulfillmentTypeRow = {
  key: "assessment",
  label: "Assessment",
  description: "One-time M365 assessment",
  firedWhen: ["purchase"],
  recurring: false,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  resetFulfillmentStore();
  configureFulfillmentFetch(fetchWithAuth);
  fetchWithAuth.mockReset();
  fetchWithAuth.mockResolvedValue(jsonResponse({ ok: true }));
});

afterEach(() => {
  cleanup();
});

describe("FulfillmentExplorer right-click", () => {
  it("offers every status but the current one, and marking one PATCHes it", async () => {
    seedFulfillmentStore({ items: [DELIVERY] });
    render(<FulfillmentExplorerView state={getSnapshot()} />);

    const row = screen.getByText("M365 Security Assessment").closest('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(row);

    const menu = screen.getByRole("menu", { name: "Actions for M365 Security Assessment" });
    expect(menu).toBeTruthy();
    // Not started is the current status — it must not offer to mark itself.
    expect(screen.queryByRole("menuitem", { name: "Mark not started" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Mark in progress" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Mark delivered" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Mark blocked" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Mark blocked" }));

    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/admin/fulfillment-queue/501/status",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ deliveryStatus: "blocked" }),
      }),
    );
  });
});

describe("FulfillmentTypesPanel right-click", () => {
  it("offers Activate/Deactivate and a billing switch, wired to patchType", async () => {
    seedFulfillmentStore({ types: [TYPE] });
    render(<FulfillmentTypesPanel />);

    const row = screen.getByText("Assessment").closest('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(row);

    expect(screen.getByRole("menu", { name: "Actions for fulfillment type Assessment" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Deactivate" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Switch to recurring billing" })).toBeTruthy();
    // Delete is deliberately absent — gated by a press-twice arm elsewhere,
    // which a context menu item cannot faithfully reproduce.
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Deactivate" }));

    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/admin/fulfillment-types/assessment",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ isActive: false }),
      }),
    );
  });
});

describe("FulfillmentBody overview right-click", () => {
  it("offers status choices on an overdue row", async () => {
    seedFulfillmentStore({ summary: { total: 1, overdue: 1, byStatus: { not_started: 0, in_progress: 1, delivered: 0, blocked: 0 }, page: 1, pageSize: 100 }, overdueRows: [OVERDUE_DELIVERY] });
    render(<FulfillmentBody />);

    const row = screen.getByText("Overdue Onboarding").closest('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(row);

    expect(screen.getByRole("menu", { name: "Actions for Overdue Onboarding" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Mark delivered" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Mark in progress" })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Mark delivered" }));

    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/admin/fulfillment-queue/502/status",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ deliveryStatus: "delivered" }),
      }),
    );
  });
});
