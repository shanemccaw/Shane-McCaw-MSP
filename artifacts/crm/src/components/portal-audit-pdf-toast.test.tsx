// @vitest-environment jsdom
/**
 * Tests: error toast messages during PDF export failures.
 *
 * When the /api/portal/projects/:id/audit-pdf endpoint returns a non-ok
 * response, both PortalProjectCloseOut and PortalRetainerDetail must surface a
 * destructive toast so clients receive clear feedback rather than a silent
 * failure.
 *
 * Coverage:
 *   - PortalProjectCloseOut: destructive "Export failed" toast on HTTP error
 *   - PortalRetainerDetail:  destructive "Export failed" toast on HTTP error
 *   - Both: toast title is exactly "Export failed"
 *   - Both: toast variant is "destructive"
 *   - Both: toast description is a non-empty string
 *   - Both: correct audit-pdf URL is called
 *   - Both: no false-positive toast on a successful export
 *   - Both: Export Report button is disabled while the request is in-flight
 *
 * Run with:
 *   pnpm --filter @workspace/crm run test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

// ── Mock heavy / routing / toast deps BEFORE importing components ─────────────

const mockToast = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href }, children),
}));

vi.mock("@/lib/auditFormatter", () => ({
  formatAuditEntry: (entry: { id?: number }) => `audit-${entry.id ?? "?"}`,
}));

// ── Import real components AFTER all vi.mock() calls ─────────────────────────

import PortalProjectCloseOut from "./PortalProjectCloseOut";
import PortalRetainerDetail from "./PortalRetainerDetail";

// ── Factories ─────────────────────────────────────────────────────────────────

function makeCloseOutData() {
  return {
    project: {
      id: 42,
      title: "M365 Foundation",
      description: "Full M365 setup",
      status: "completed",
      phase: "Phase 1",
      progress: 100,
      startDate: "2025-01-01",
      endDate: "2025-06-30",
      projectType: "fixed_price",
      sharepointFolderUrl: null,
    },
    steps: [],
    tasks: [],
  };
}

function makeClosure() {
  return {
    id: 1,
    projectId: 42,
    requestedAt: "2025-06-30T12:00:00Z",
    feedback: "Great work!",
    permissionGranted: true,
    signatureDataUrl: null,
    signedAt: "2025-06-30T12:00:00Z",
  };
}

function makeRetainerData() {
  return {
    project: {
      id: 7,
      title: "Fractional M365 Oversight",
      description: "Ongoing advisory",
      status: "active",
      phase: "Q3 2025",
      progress: 60,
      startDate: "2025-04-01",
      endDate: null,
      projectType: "retainer",
    },
    steps: [],
    tasks: [],
    documents: [],
    updates: [],
  };
}

function makeFailResponse(status = 500): Response {
  return { ok: false, status } as unknown as Response;
}

function makeSuccessResponse(): Response {
  return {
    ok: true,
    blob: async () => new Blob(["PDF content"], { type: "application/pdf" }),
  } as unknown as Response;
}

/** Build a fake anchor element that avoids touching the real DOM. */
function makeFakeAnchor() {
  return {
    href: "",
    download: "",
    click: vi.fn(),
    remove: vi.fn(),
  };
}

/** Wait for the event loop to drain pending microtasks/promises. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

// =============================================================================
// PortalProjectCloseOut
// =============================================================================

describe("PortalProjectCloseOut — PDF export error toast", () => {
  beforeEach(() => {
    mockToast.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a destructive 'Export failed' toast when the audit-pdf endpoint returns a non-ok response", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(makeFailResponse(500));

    render(
      React.createElement(PortalProjectCloseOut, {
        data: makeCloseOutData(),
        closure: makeClosure(),
        auditLogs: [],
        projectId: "42",
        fetchWithAuth,
      }),
    );

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /export report/i })); });
    await flush();

    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", title: "Export failed" }),
    );
  });

  it("toast variant is 'destructive' (not just a neutral info toast)", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(makeFailResponse(503));

    render(
      React.createElement(PortalProjectCloseOut, {
        data: makeCloseOutData(),
        closure: makeClosure(),
        auditLogs: [],
        projectId: "42",
        fetchWithAuth,
      }),
    );

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /export report/i })); });
    await flush();

    const call = mockToast.mock.calls[0][0] as { variant?: string };
    expect(call.variant).toBe("destructive");
  });

  it("toast includes a non-empty description so the client knows what to do next", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(makeFailResponse(503));

    render(
      React.createElement(PortalProjectCloseOut, {
        data: makeCloseOutData(),
        closure: makeClosure(),
        auditLogs: [],
        projectId: "42",
        fetchWithAuth,
      }),
    );

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /export report/i })); });
    await flush();

    const call = mockToast.mock.calls[0][0] as { description?: string };
    expect(typeof call.description).toBe("string");
    expect((call.description as string).trim().length).toBeGreaterThan(0);
  });

  it("calls the audit-pdf endpoint with the correct project ID", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(makeFailResponse());

    render(
      React.createElement(PortalProjectCloseOut, {
        data: makeCloseOutData(),
        closure: makeClosure(),
        auditLogs: [],
        projectId: "42",
        fetchWithAuth,
      }),
    );

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /export report/i })); });
    await flush();

    expect(fetchWithAuth).toHaveBeenCalledWith("/api/portal/projects/42/audit-pdf");
  });

  it("does NOT show a toast when the export succeeds", async () => {
    // Stub HTMLAnchorElement.prototype.click so no real navigation happens.
    // This avoids touching document.createElement (which would break React's DOM building).
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    // jsdom may not implement URL.createObjectURL; add a stub if missing.
    const origCreate = (URL as unknown as Record<string, unknown>).createObjectURL;
    const origRevoke = (URL as unknown as Record<string, unknown>).revokeObjectURL;
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn().mockReturnValue("blob:fake");
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();

    const fetchWithAuth = vi.fn().mockResolvedValue(makeSuccessResponse());

    render(
      React.createElement(PortalProjectCloseOut, {
        data: makeCloseOutData(),
        closure: makeClosure(),
        auditLogs: [],
        projectId: "42",
        fetchWithAuth,
      }),
    );

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /export report/i })); });
    await flush();

    expect(mockToast).not.toHaveBeenCalled();

    clickSpy.mockRestore();
    (URL as unknown as Record<string, unknown>).createObjectURL = origCreate;
    (URL as unknown as Record<string, unknown>).revokeObjectURL = origRevoke;
  });

  it("disables the Export Report button while the request is in-flight", async () => {
    let resolveResponse!: (r: Response) => void;
    const pending = new Promise<Response>(res => { resolveResponse = res; });
    const fetchWithAuth = vi.fn().mockReturnValue(pending);

    render(
      React.createElement(PortalProjectCloseOut, {
        data: makeCloseOutData(),
        closure: makeClosure(),
        auditLogs: [],
        projectId: "42",
        fetchWithAuth,
      }),
    );

    const btn = screen.getByRole("button", { name: /export report/i }) as HTMLButtonElement;
    await act(async () => { fireEvent.click(btn); });

    expect(btn.disabled).toBe(true);

    // Resolve so the component can cleanly finish
    await act(async () => {
      resolveResponse(makeFailResponse());
      await Promise.resolve();
    });
  });
});

// =============================================================================
// PortalRetainerDetail
// =============================================================================

describe("PortalRetainerDetail — PDF export error toast", () => {
  beforeEach(() => {
    mockToast.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a destructive 'Export failed' toast when the audit-pdf endpoint returns a non-ok response", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(makeFailResponse(500));

    render(
      React.createElement(PortalRetainerDetail, {
        data: makeRetainerData(),
        projectId: "7",
        fetchWithAuth,
      }),
    );

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /export report/i })); });
    await flush();

    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", title: "Export failed" }),
    );
  });

  it("toast variant is 'destructive' (not just a neutral info toast)", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(makeFailResponse(404));

    render(
      React.createElement(PortalRetainerDetail, {
        data: makeRetainerData(),
        projectId: "7",
        fetchWithAuth,
      }),
    );

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /export report/i })); });
    await flush();

    const call = mockToast.mock.calls[0][0] as { variant?: string };
    expect(call.variant).toBe("destructive");
  });

  it("toast includes a non-empty description so the client knows what to do next", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(makeFailResponse(404));

    render(
      React.createElement(PortalRetainerDetail, {
        data: makeRetainerData(),
        projectId: "7",
        fetchWithAuth,
      }),
    );

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /export report/i })); });
    await flush();

    const call = mockToast.mock.calls[0][0] as { description?: string };
    expect(typeof call.description).toBe("string");
    expect((call.description as string).trim().length).toBeGreaterThan(0);
  });

  it("calls the audit-pdf endpoint with the correct project ID", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(makeFailResponse());

    render(
      React.createElement(PortalRetainerDetail, {
        data: makeRetainerData(),
        projectId: "7",
        fetchWithAuth,
      }),
    );

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /export report/i })); });
    await flush();

    expect(fetchWithAuth).toHaveBeenCalledWith("/api/portal/projects/7/audit-pdf");
  });

  it("does NOT show a toast when the export succeeds", async () => {
    // Stub HTMLAnchorElement.prototype.click so no real navigation happens.
    // Avoids touching document.createElement which breaks React's DOM building.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const origCreate = (URL as unknown as Record<string, unknown>).createObjectURL;
    const origRevoke = (URL as unknown as Record<string, unknown>).revokeObjectURL;
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn().mockReturnValue("blob:fake");
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();

    const fetchWithAuth = vi.fn().mockResolvedValue(makeSuccessResponse());

    render(
      React.createElement(PortalRetainerDetail, {
        data: makeRetainerData(),
        projectId: "7",
        fetchWithAuth,
      }),
    );

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /export report/i })); });
    await flush();

    expect(mockToast).not.toHaveBeenCalled();

    clickSpy.mockRestore();
    (URL as unknown as Record<string, unknown>).createObjectURL = origCreate;
    (URL as unknown as Record<string, unknown>).revokeObjectURL = origRevoke;
  });

  it("disables the Export Report button while the request is in-flight", async () => {
    let resolveResponse!: (r: Response) => void;
    const pending = new Promise<Response>(res => { resolveResponse = res; });
    const fetchWithAuth = vi.fn().mockReturnValue(pending);

    render(
      React.createElement(PortalRetainerDetail, {
        data: makeRetainerData(),
        projectId: "7",
        fetchWithAuth,
      }),
    );

    const btn = screen.getByRole("button", { name: /export report/i }) as HTMLButtonElement;
    await act(async () => { fireEvent.click(btn); });

    expect(btn.disabled).toBe(true);

    await act(async () => {
      resolveResponse(makeFailResponse());
      await Promise.resolve();
    });
  });
});
