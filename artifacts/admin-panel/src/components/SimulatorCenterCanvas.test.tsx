// @vitest-environment jsdom
/**
 * Tests: Simulator Studio open-document tab strip context menu (Issue #56)
 * — Close / Close Others / Close All / Close to the Left / Close to the
 * Right / Pin-Unpin on SimulatorCenterCanvas.tsx's tab strip.
 *
 * Coverage:
 *   - Close Others leaves only the target tab and any pinned tabs open.
 *   - Close All leaves only pinned tabs open.
 *   - Close to the Left / Close to the Right use array index in
 *     `openDocuments` (persisted order), not click/visit order.
 *   - Pin/unpin toggles `pinned` and round-trips through the
 *     `simulator-open-documents-v1` localStorage key.
 *   - Pinned tabs sort before unpinned tabs, preserving relative order
 *     within each group.
 *
 * Every other Simulator Studio child canvas is stubbed out — this file
 * only exercises the open-document tab strip, which mounts regardless of
 * `activeTab`.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

const fetchWithAuth = vi.fn();
const openModal = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth, accessToken: "test-token" }),
}));
vi.mock("@/contexts/ModalContext", () => ({
  useModal: () => ({ openModal }),
}));

vi.mock("./SimulatorOverridesPanel", () => ({ SimulatorOverridesPanel: () => <div /> }));
vi.mock("./SimulatorEnginesPanel", () => ({ SimulatorEnginesPanel: () => <div /> }));
vi.mock("./SimulatorDeployConsolePanel", () => ({ SimulatorDeployConsolePanel: () => <div /> }));
vi.mock("./SqlQueryCanvas", () => ({ SqlQueryCanvas: () => <div /> }));
vi.mock("./SimulatorEndpointCanvas", () => ({ SimulatorEndpointCanvas: () => <div /> }));
vi.mock("./SimulatorBatchCanvas", () => ({ SimulatorBatchCanvas: () => <div /> }));
vi.mock("./SimulatorWriteActionCanvas", () => ({ SimulatorWriteActionCanvas: () => <div /> }));
vi.mock("./SimulatorConfigPackCanvas", () => ({ SimulatorConfigPackCanvas: () => <div /> }));
vi.mock("./SimulatorPillarMatrixCanvas", () => ({ SimulatorPillarMatrixCanvas: () => <div /> }));
vi.mock("./SimulatorAssessmentCanvas", () => ({ SimulatorAssessmentCanvas: () => <div /> }));
vi.mock("./SimulatorDocumentCanvas", () => ({ SimulatorDocumentCanvas: () => <div /> }));

import { SimulatorCenterCanvas, type SimDocumentTab } from "./SimulatorCenterCanvas";

const LS_OPEN_DOCS_KEY = "simulator-open-documents-v1";

function doc(id: string, pinned?: boolean): SimDocumentTab {
  return { id, type: "endpoint", label: id, data: { key: id }, pinned };
}

function seedOpenDocs(docs: SimDocumentTab[]) {
  localStorage.setItem(LS_OPEN_DOCS_KEY, JSON.stringify(docs));
}

function renderCanvas() {
  return render(
    <SimulatorCenterCanvas sqlOutput={{ rows: [], columns: [] } as any} onSqlOutputChange={() => {}} />
  );
}

function openTabContextMenu(id: string) {
  fireEvent.contextMenu(screen.getByText(id));
}

function readPersistedDocs(): SimDocumentTab[] {
  return JSON.parse(localStorage.getItem(LS_OPEN_DOCS_KEY) || "[]");
}

beforeEach(() => {
  localStorage.clear();
  fetchWithAuth.mockReset();
  openModal.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("open-document tab strip context menu", () => {
  it("Close Others leaves only the target and any pinned docs open", () => {
    seedOpenDocs([doc("a"), doc("b"), doc("c", true), doc("d")]);
    renderCanvas();

    openTabContextMenu("b");
    fireEvent.click(screen.getByText("Close Others"));

    const remaining = readPersistedDocs().map((d) => d.id);
    expect(remaining.sort()).toEqual(["b", "c"]);
  });

  it("Close All leaves only pinned docs open", () => {
    seedOpenDocs([doc("a"), doc("b", true), doc("c")]);
    renderCanvas();

    openTabContextMenu("a");
    fireEvent.click(screen.getByText("Close All"));

    expect(readPersistedDocs().map((d) => d.id)).toEqual(["b"]);
  });

  it("Close to the Left uses array index, not click order", () => {
    seedOpenDocs([doc("a"), doc("b"), doc("c"), doc("d")]);
    renderCanvas();

    // Click "c" first (establishing it as recently interacted), then
    // right-click "b" and close to its left — only "a" (lower index than
    // "b") should close, regardless of the earlier click on "c".
    fireEvent.click(screen.getByText("c"));
    openTabContextMenu("b");
    fireEvent.click(screen.getByText("Close to the Left"));

    expect(readPersistedDocs().map((d) => d.id)).toEqual(["b", "c", "d"]);
  });

  it("Close to the Right uses array index, not click order", () => {
    seedOpenDocs([doc("a"), doc("b"), doc("c"), doc("d")]);
    renderCanvas();

    fireEvent.click(screen.getByText("a"));
    openTabContextMenu("b");
    fireEvent.click(screen.getByText("Close to the Right"));

    expect(readPersistedDocs().map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("Close to the Left/Right excludes pinned docs on that side", () => {
    seedOpenDocs([doc("a", true), doc("b"), doc("c"), doc("d", true)]);
    renderCanvas();

    openTabContextMenu("b");
    fireEvent.click(screen.getByText("Close to the Right"));

    // "c" (unpinned, right of b) closes; "d" (pinned) survives; "a" (left, pinned) untouched.
    expect(readPersistedDocs().map((d) => d.id)).toEqual(["a", "b", "d"]);
  });

  it("Pin toggles state and round-trips through localStorage", () => {
    seedOpenDocs([doc("a"), doc("b")]);
    renderCanvas();

    openTabContextMenu("b");
    fireEvent.click(screen.getByText("Pin"));

    const persisted = readPersistedDocs();
    const b = persisted.find((d) => d.id === "b");
    expect(b?.pinned).toBe(true);
  });

  it("Unpin flips a pinned doc back to unpinned", () => {
    seedOpenDocs([doc("a", true), doc("b")]);
    renderCanvas();

    openTabContextMenu("a");
    fireEvent.click(screen.getByText("Unpin"));

    const persisted = readPersistedDocs();
    expect(persisted.find((d) => d.id === "a")?.pinned).toBeFalsy();
  });

  it("pinned docs sort before unpinned docs, preserving relative order within each group", () => {
    seedOpenDocs([doc("a"), doc("b"), doc("c")]);
    renderCanvas();

    // Pin "c" (currently last) — it should jump to the front, ahead of "a"
    // and "b", which keep their relative order.
    openTabContextMenu("c");
    fireEvent.click(screen.getByText("Pin"));

    expect(readPersistedDocs().map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  it("disables Close Others/Close All with only one open doc", () => {
    seedOpenDocs([doc("a")]);
    renderCanvas();

    openTabContextMenu("a");
    expect(
      screen.getByText("Close Others").closest('[role="menuitem"]')?.getAttribute("data-disabled")
    ).not.toBeNull();
    expect(
      screen.getByText("Close All").closest('[role="menuitem"]')?.getAttribute("data-disabled")
    ).not.toBeNull();
  });

  it("disables Close to the Left for the first tab and Close to the Right for the last tab", () => {
    seedOpenDocs([doc("a"), doc("b")]);
    renderCanvas();

    openTabContextMenu("a");
    expect(
      screen.getByText("Close to the Left").closest('[role="menuitem"]')?.getAttribute("data-disabled")
    ).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    openTabContextMenu("b");
    expect(
      screen.getByText("Close to the Right").closest('[role="menuitem"]')?.getAttribute("data-disabled")
    ).not.toBeNull();
  });
});
