// @vitest-environment jsdom
/**
 * Services screen's right-click coverage — added alongside the other screens
 * in this sweep (see `FulfillmentTypesPanel`/`fulfillment.test.tsx` for the
 * closest precedent: another catalog/type screen that deliberately leaves
 * Delete off the menu). A context menu's job here is to call an existing
 * store function with the right arguments, so these assert the resulting
 * `fetchWithAuth` call (or store state, for `openEditor`, which has no
 * network call of its own) — the same shape `servicesStore.ts`'s own writes
 * take.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ServiceExplorerView } from "./ServiceExplorer";
import { ServicesBody } from "./ServicesBody";
import { configureServicesFetch, getSnapshot, refreshCatalog, resetServicesStore } from "./servicesStore";
import type { Service } from "./servicesTypes";

const fetchWithAuth = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: 1,
    slug: "widget",
    name: "Widget",
    description: null,
    category: "Assessments",
    categoryPath: "Assessments",
    tagline: null,
    deliverables: null,
    tags: null,
    billingType: "one_time",
    visibility: "public",
    isPublic: true,
    price: null,
    basePrice: null,
    maxPrice: null,
    priceCents: 50000,
    internalCostCents: null,
    annualPriceCents: null,
    serviceClass: null,
    deliveryType: null,
    fulfillmentType: null,
    serviceType: null,
    typeAttributes: null,
    sortOrder: 0,
    highlighted: false,
    isFreeOffering: false,
    overviewPdfKey: null,
    overviewPdfGeneratedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    durationDays: null,
    turnaround: null,
    hoursPerMonth: null,
    allowFreeCheckout: false,
    targetAudience: null,
    inclusions: null,
    features: null,
    iconName: null,
    pageHref: null,
    badge: null,
    tier: null,
    fulfillmentTypeKey: null,
    triggeringSignalKeys: null,
    customerAgreementTemplate: null,
    requiredAppPermissions: null,
    extra: {},
    ...overrides,
  };
}

async function seed(services: Service[]): Promise<void> {
  fetchWithAuth.mockResolvedValueOnce(jsonResponse(services));
  await refreshCatalog();
}

beforeEach(() => {
  resetServicesStore();
  configureServicesFetch(fetchWithAuth);
  fetchWithAuth.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ServiceExplorer right-click", () => {
  it("offers Open / Edit fields / Duplicate / Generate PDF, never Delete", async () => {
    await seed([makeService({ id: 1, name: "M365 Security Assessment" })]);
    render(<ServiceExplorerView state={getSnapshot()} />);

    const row = screen.getByText("M365 Security Assessment").closest('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(row);

    expect(screen.getByRole("menu", { name: "Actions for M365 Security Assessment" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Edit fields" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Generate PDF" })).toBeTruthy();
    // Delete is deliberately absent — gated behind the press-twice arm in
    // ServiceEditorDialog.tsx (and `confirm: true` on the peek's action),
    // which a context menu item cannot faithfully reproduce.
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("labels the PDF item Regenerate once a PDF already exists", async () => {
    await seed([makeService({ id: 2, name: "Has a PDF", overviewPdfKey: "pdfs/2.pdf" })]);
    render(<ServiceExplorerView state={getSnapshot()} />);

    fireEvent.contextMenu(screen.getByText("Has a PDF").closest('[role="button"]') as HTMLElement);
    expect(screen.getByRole("menuitem", { name: "Regenerate PDF" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Generate PDF" })).toBeNull();
  });

  it("Edit fields opens the editor via the existing openEditor store call", async () => {
    await seed([makeService({ id: 3, name: "Edit Me" })]);
    render(<ServiceExplorerView state={getSnapshot()} />);

    fireEvent.contextMenu(screen.getByText("Edit Me").closest('[role="button"]') as HTMLElement);
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit fields" }));

    expect(getSnapshot().editorOpenId).toBe(3);
  });

  it("Duplicate calls the real create+update duplication flow", async () => {
    const source = makeService({ id: 4, name: "Original", slug: "original" });
    await seed([source]);
    render(<ServiceExplorerView state={getSnapshot()} />);

    fetchWithAuth.mockResolvedValueOnce(jsonResponse({ ...source, id: 99, name: "Original (copy)", slug: "original-copy" }));
    fetchWithAuth.mockResolvedValueOnce(jsonResponse({ ...source, id: 99, name: "Original (copy)", slug: "original-copy", visibility: "private", isPublic: false }));

    fireEvent.contextMenu(screen.getByText("Original").closest('[role="button"]') as HTMLElement);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    await vi.waitFor(() =>
      expect(fetchWithAuth).toHaveBeenNthCalledWith(
        2,
        "/api/admin/services",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Original (copy)", slug: "original-copy" }) }),
      ),
    );
    await vi.waitFor(() => expect(fetchWithAuth).toHaveBeenNthCalledWith(3, "/api/admin/services/99", expect.objectContaining({ method: "PUT" })));
  });

  it("Generate PDF calls the real generate-pdf route", async () => {
    const source = makeService({ id: 5, name: "Needs A PDF" });
    await seed([source]);
    render(<ServiceExplorerView state={getSnapshot()} />);

    fetchWithAuth.mockResolvedValueOnce(jsonResponse({ pdfUrl: "https://example.com/5.pdf" }));
    fetchWithAuth.mockResolvedValueOnce(jsonResponse([source]));

    fireEvent.contextMenu(screen.getByText("Needs A PDF").closest('[role="button"]') as HTMLElement);
    fireEvent.click(screen.getByRole("menuitem", { name: "Generate PDF" }));

    await vi.waitFor(() =>
      expect(fetchWithAuth).toHaveBeenNthCalledWith(2, "/api/admin/services/5/generate-pdf", expect.objectContaining({ method: "POST" })),
    );
  });
});

describe("ServicesBody overview (unpriced list) right-click", () => {
  it("offers Open / Edit fields / Duplicate, never Delete, on an unpriced row", async () => {
    await seed([makeService({ id: 6, name: "Free-Riding Public Service", visibility: "public", priceCents: 0 })]);
    render(<ServicesBody />);

    const row = screen.getByText("Free-Riding Public Service").closest('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(row);

    expect(screen.getByRole("menu", { name: "Actions for Free-Riding Public Service" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Edit fields" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("Duplicate on the unpriced row calls the real create+update flow", async () => {
    const source = makeService({ id: 7, name: "Unpriced Thing", slug: "unpriced-thing", visibility: "public", priceCents: 0 });
    await seed([source]);
    render(<ServicesBody />);

    fetchWithAuth.mockResolvedValueOnce(jsonResponse({ ...source, id: 100, name: "Unpriced Thing (copy)", slug: "unpriced-thing-copy" }));
    fetchWithAuth.mockResolvedValueOnce(jsonResponse({ ...source, id: 100, name: "Unpriced Thing (copy)", slug: "unpriced-thing-copy", visibility: "private", isPublic: false }));

    fireEvent.contextMenu(screen.getByText("Unpriced Thing").closest('[role="button"]') as HTMLElement);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    await vi.waitFor(() =>
      expect(fetchWithAuth).toHaveBeenNthCalledWith(
        2,
        "/api/admin/services",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Unpriced Thing (copy)", slug: "unpriced-thing-copy" }) }),
      ),
    );
  });
});
