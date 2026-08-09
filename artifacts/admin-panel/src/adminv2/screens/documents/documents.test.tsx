// @vitest-environment jsdom
/**
 * Document Viewer's own contract coverage.
 *
 * What this file covers:
 *
 * - the label derivations (`whenLabel`/`costLabel`/`statusTone`);
 * - the store's contract with the real API: the list response is a bare
 *   array (not `{runs,...}` like Run History's), an out-of-order response
 *   never overwrites a newer one, HTML is fetched per selection and cached,
 *   and archiving patches `status` locally rather than removing the row;
 * - filtering (client-side, over the loaded window — the real route has no
 *   `q`/`category` query);
 * - the states the screen has to tell apart honestly — nothing generated yet,
 *   nothing matches, a failed generation, content not fetched yet vs empty;
 * - registration legality (only `open`/`global` on the fixed `home`/`watch`
 *   tabs — there is deliberately no `create`) and the `document` peek reading
 *   back real store state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getScreen, resetRegistry } from "../../registry/registry";
import { DocumentsBody } from "./DocumentsBody";
import { DocumentsExplorer } from "./DocumentsExplorer";
import { DocumentsProperties } from "./DocumentsProperties";
import {
  archiveSelected,
  configureDocumentsFetch,
  entryById,
  failedCount,
  getSnapshot,
  loadDocuments,
  resetDocumentsStore,
  selectDocument,
  setCategory,
  setSearch,
  visibleDocuments,
  warmDocuments,
} from "./documentsStore";
import { costLabel, statusTone, whenLabel, type DocumentEntry } from "./documentsTypes";

const openDoc = vi.fn();
const writeText = vi.fn();

vi.mock("../../shell/ShellContext", () => ({
  getShellApi: () => ({ openDoc, navigate: vi.fn(), dispatch: vi.fn() }),
}));

const fetchWithAuth = vi.fn();

/** One list row as the real route actually returns it — a bare object in a bare array, no `html`. */
function row(over: Partial<DocumentEntry> = {}): DocumentEntry {
  return {
    id: "1",
    docType: "sec_findings",
    docTypeLabel: "Security Findings Report",
    category: "report",
    title: "Security Findings — Contoso Ltd",
    status: "delivered",
    errorMessage: null,
    createdAt: new Date().toISOString(),
    customerId: 9,
    customerName: "Jordan Doe",
    customerCompany: "Contoso Ltd",
    projectId: null,
    projectTitle: null,
    costCents: 42,
    ...over,
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

/** Answers the list endpoint with a bare array (the real shape) and `GET .../:id/html` with text. */
function serveDocuments(entries: DocumentEntry[], html: Record<string, string> = {}) {
  fetchWithAuth.mockImplementation((url: string) => {
    const htmlMatch = /\/history\/(\d+)\/html$/.exec(String(url));
    if (htmlMatch) {
      const id = htmlMatch[1]!;
      return Promise.resolve({ ok: true, json: async () => ({}), text: async () => html[id] ?? "" });
    }
    const archiveMatch = /\/history\/(\d+)\/archive$/.exec(String(url));
    if (archiveMatch) return Promise.resolve(jsonResponse({ id: Number(archiveMatch[1]), status: "archived" }));
    return Promise.resolve(jsonResponse(entries));
  });
}

beforeEach(() => {
  fetchWithAuth.mockReset();
  openDoc.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  resetDocumentsStore();
  configureDocumentsFetch(fetchWithAuth);
});

afterEach(() => {
  cleanup();
  resetDocumentsStore();
});

describe("label derivations", () => {
  const now = new Date(2026, 7, 9, 14, 0, 0).getTime();

  it("labels when a document was generated relative to now", () => {
    expect(whenLabel(new Date(2026, 7, 9, 9, 12).toISOString(), now)).toBe("today 09:12");
    expect(whenLabel(new Date(2026, 7, 8, 17, 40).toISOString(), now)).toBe("yesterday 17:40");
  });

  it("never fabricates a cost — null reads as unknown, not $0", () => {
    expect(costLabel(row({ costCents: null }))).toBe("unknown");
    expect(costLabel(row({ costCents: 0 }))).toBe("$0.00");
    expect(costLabel(row({ costCents: 42 }))).toBe("$0.42");
  });

  it("tones a failed generation as danger and a delivered one as green", () => {
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("generating")).toBe("amber");
    expect(statusTone("delivered")).toBe("green");
    expect(statusTone("approved")).toBe("green");
    expect(statusTone("draft")).toBe("neutral");
    expect(statusTone("archived")).toBe("neutral");
  });
});

describe("the store's contract with the real API", () => {
  it("never writes a generation — there is no create call on this client", async () => {
    // Generation is the old admin panel's Document Generator IDE's job; a
    // client here that could invent a row would make the history worth less.
    const api = await import("./documentsApi");
    expect(Object.keys(api).some((name) => /^(create|generate)/i.test(name))).toBe(false);
  });

  it("reads the real route's bare-array response, not a wrapper object", async () => {
    serveDocuments([row({ id: "5" }), row({ id: "6" })]);
    await loadDocuments();
    expect(getSnapshot().entries).toHaveLength(2);
    expect(String(fetchWithAuth.mock.calls[0]?.[0])).toContain("/document-generator/history");
  });

  it("does not let a slow earlier response overwrite a newer one", async () => {
    const stale = row({ id: "9", title: "stale" });
    const fresh = row({ id: "10", title: "current" });
    let resolveSlow: (value: unknown) => void = () => {};

    fetchWithAuth
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlow = resolve;
          }),
      )
      .mockImplementationOnce(() => Promise.resolve(jsonResponse([fresh])));

    const first = loadDocuments();
    const second = loadDocuments();
    await second;
    expect(getSnapshot().entries[0]?.title).toBe("current");

    resolveSlow(jsonResponse([stale]));
    await first;
    expect(getSnapshot().entries[0]?.title).toBe("current");
  });

  it("fetches a document's HTML only when it is selected, and caches it", async () => {
    serveDocuments([row({ id: "7" })], { "7": "<html>real body</html>" });
    await loadDocuments();
    expect(getSnapshot().entries[0]?.html).toBeUndefined();

    selectDocument("7");
    await vi.waitFor(() => expect(entryById("7")?.html).toBe("<html>real body</html>"));

    const callsBefore = fetchWithAuth.mock.calls.length;
    selectDocument(null);
    selectDocument("7");
    expect(fetchWithAuth.mock.calls.length).toBe(callsBefore); // cached, no second fetch
  });

  it("archives by patching status locally, never removing the row", async () => {
    serveDocuments([row({ id: "3", status: "delivered" })]);
    await loadDocuments();

    await archiveSelected("3");
    expect(entryById("3")?.status).toBe("archived");
    expect(getSnapshot().entries).toHaveLength(1);
    const call = fetchWithAuth.mock.calls.find((c) => String(c[0]).includes("/archive"));
    expect(call?.[1]).toMatchObject({ method: "POST" });
  });

  it("surfaces an archive failure without changing status", async () => {
    serveDocuments([row({ id: "4", status: "delivered" })]);
    await loadDocuments();

    fetchWithAuth.mockImplementation((url: string) =>
      String(url).includes("/archive")
        ? Promise.resolve({ ok: false, json: async () => ({ error: "already archived" }) })
        : Promise.resolve(jsonResponse([row({ id: "4", status: "delivered" })])),
    );
    await archiveSelected("4");
    expect(entryById("4")?.status).toBe("delivered");
    expect(getSnapshot().error).toContain("not archived");
  });

  it("filters client-side by category and free text over the loaded window", async () => {
    serveDocuments([
      row({ id: "1", category: "report", title: "Security Findings", customerCompany: "Contoso" }),
      row({ id: "2", category: "consulting", title: "Statement of Work", customerCompany: "Fabrikam" }),
    ]);
    await loadDocuments();

    setCategory("consulting");
    expect(visibleDocuments(getSnapshot()).map((e) => e.id)).toEqual(["2"]);

    setCategory("All");
    setSearch("fabrikam");
    expect(visibleDocuments(getSnapshot()).map((e) => e.id)).toEqual(["2"]);
  });

  it("counts failures over the loaded window only", async () => {
    serveDocuments([row({ id: "1", status: "failed" }), row({ id: "2", status: "delivered" })]);
    await loadDocuments();
    expect(failedCount(getSnapshot())).toBe(1);
  });
});

describe("rendering", () => {
  it("distinguishes nothing-generated-yet from nothing-matches", async () => {
    serveDocuments([]);
    render(<DocumentsExplorer />);

    await screen.findByText(/No documents have been generated yet/);

    setSearch("nothing will match this");
    await screen.findByText(/Nothing matches/);
  });

  it("renders a real document row with its tenant and type, not a restated name", async () => {
    serveDocuments([row({ id: "5", title: "Ship the Q3 posture report", customerCompany: "Contoso Ltd", docTypeLabel: "Monthly Posture Report" })]);
    render(<DocumentsExplorer />);

    await screen.findByText("Ship the Q3 posture report");
    expect(screen.getByText(/Contoso Ltd/)).toBeTruthy();
    expect(screen.getByText(/Monthly Posture Report/)).toBeTruthy();
  });

  it("the canvas says nothing is selected until a row is picked, then shows the document", async () => {
    serveDocuments([row({ id: "8", title: "Guest Access Review" })], { "8": "<html><body>real</body></html>" });
    const { container } = render(
      <>
        <DocumentsExplorer />
        <DocumentsBody />
      </>,
    );

    expect(screen.getByText(/Pick a document on the left/)).toBeTruthy();

    await screen.findByText("Guest Access Review");
    fireEvent.click(screen.getByText("Guest Access Review"));

    await vi.waitFor(() => expect(container.querySelector("iframe")).toBeTruthy());
  });

  it("shows the real error message for a failed generation instead of an iframe", async () => {
    serveDocuments([row({ id: "9", status: "failed", errorMessage: "Tenant not connected" })]);
    const { container } = render(
      <>
        <DocumentsExplorer />
        <DocumentsBody />
      </>,
    );

    const rowEl = await screen.findByTitle("Security Findings — Contoso Ltd"); // default row() title
    fireEvent.click(rowEl);

    await screen.findByText(/This generation failed/);
    expect(screen.getByText("Tenant not connected")).toBeTruthy();
    expect(container.querySelector("iframe")).toBeFalsy();
  });

  it("writes the archive action through from Properties, with the client-keeps-a-copy confirm", async () => {
    serveDocuments([row({ id: "2", status: "delivered" })]);
    await loadDocuments();
    selectDocument("2");
    render(<DocumentsProperties />);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByText("removes it from the active history — the client keeps any copy already sent"));

    await vi.waitFor(() => expect(entryById("2")?.status).toBe("archived"));
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("right-click context menu on a document row", () => {
  it("offers Open / Copy title / Archive, real actions only — no generate/regenerate", async () => {
    serveDocuments([row({ id: "20", title: "Guest Access Review", status: "delivered" })]);
    render(<DocumentsExplorer />);

    const rowEl = await screen.findByText("Guest Access Review");
    fireEvent.contextMenu(rowEl);

    expect(screen.getByRole("menu", { name: "Actions for document Guest Access Review" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy title" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /generate/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /new document/i })).toBeNull();
  });

  it("Open wires through to the shell's openDoc, same as double-click", async () => {
    serveDocuments([row({ id: "21", title: "Guest Access Review" })]);
    render(<DocumentsExplorer />);

    const rowEl = await screen.findByText("Guest Access Review");
    fireEvent.contextMenu(rowEl);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));

    expect(openDoc).toHaveBeenCalledWith({ kind: "document", id: "21", screenId: "documents" });
  });

  it("Copy title copies the real title to the clipboard", async () => {
    serveDocuments([row({ id: "22", title: "Statement of Work — Fabrikam" })]);
    render(<DocumentsExplorer />);

    const rowEl = await screen.findByText("Statement of Work — Fabrikam");
    fireEvent.contextMenu(rowEl);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy title" }));

    expect(writeText).toHaveBeenCalledWith("Statement of Work — Fabrikam");
  });

  it("Archive from the context menu is gated by window.confirm, same as Properties and the contextual tab", async () => {
    serveDocuments([row({ id: "23", title: "Security Findings — Contoso Ltd", status: "delivered" })]);
    render(<DocumentsExplorer />);

    const rowEl = await screen.findByText("Security Findings — Contoso Ltd");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    fireEvent.contextMenu(rowEl);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Archive "Security Findings — Contoso Ltd"? The client keeps any copy already sent.',
    );
    // Declined — no archive request went out, status unchanged.
    expect(fetchWithAuth.mock.calls.some((c) => String(c[0]).includes("/archive"))).toBe(false);
    confirmSpy.mockRestore();
  });

  it("confirming Archive from the context menu actually archives, through the same store call", async () => {
    serveDocuments([row({ id: "24", title: "Security Findings — Contoso Ltd", status: "delivered" })]);
    render(<DocumentsExplorer />);

    const rowEl = await screen.findByText("Security Findings — Contoso Ltd");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.contextMenu(rowEl);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    await vi.waitFor(() => expect(entryById("24")?.status).toBe("archived"));
    confirmSpy.mockRestore();
  });

  it("an already-archived document offers a disabled Already archived item instead of Archive", async () => {
    serveDocuments([row({ id: "25", title: "Old Report", status: "archived" })]);
    render(<DocumentsExplorer />);

    const rowEl = await screen.findByText("Old Report");
    fireEvent.contextMenu(rowEl);

    expect(screen.getByRole("menuitem", { name: "Already archived" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
  });
});

describe("registration", () => {
  it("registers on the fixed home and watch tabs without violating the open/create/global rule", async () => {
    resetRegistry();
    await import("./index");

    const screenModule = getScreen("documents");
    expect(screenModule).toBeTruthy();
    expect(screenModule?.route).toBe("/documents");
    expect(new Set(screenModule?.ribbon?.map((r) => r.tab))).toEqual(new Set(["home", "watch"]));

    const allCommands = (screenModule?.ribbon ?? []).flatMap((r) => [
      ...(r.group.large ?? []),
      ...(r.group.small ?? []),
      ...(r.group.row ?? []),
    ]);
    expect(allCommands.length).toBeGreaterThan(0);
    for (const cmd of allCommands) {
      expect(["open", "create", "global"]).toContain(cmd.intent);
    }
    // Deliberately no `create` — generation is not this screen's job.
    expect(allCommands.some((c) => c.intent === "create")).toBe(false);
  });

  it("peeks.document resolves null for an unknown id and real state for a loaded one", async () => {
    const screenModule = getScreen("documents")!;
    expect(screenModule.peeks?.document?.("nope")).toBeNull();

    serveDocuments([row({ id: "6", status: "failed", errorMessage: "boom", title: "A failed one" })]);
    await loadDocuments();

    const model = screenModule.peeks?.document?.("6");
    expect(model?.kind).toBe("document");
    expect(model?.title).toBe("A failed one");
    expect(model?.tag).toBe("failed");
    expect(model?.body?.content).toBe("boom");
  });

  it("arms the archive action, and never on an already-archived document", async () => {
    const screenModule = getScreen("documents")!;
    serveDocuments([row({ id: "11", status: "delivered" }), row({ id: "12", status: "archived" })]);
    await loadDocuments();

    const live = screenModule.peeks?.document?.("11");
    const archivedAlready = screenModule.peeks?.document?.("12");
    expect(live?.actions?.find((a) => a.label === "Archive")?.confirm).toBe(true);
    expect(archivedAlready?.actions?.find((a) => a.label === "Already archived")?.confirm).toBeFalsy();
  });

  it("offers Document Tools only for an open, resolvable document", async () => {
    const screenModule = getScreen("documents")!;
    const resolver = screenModule.contextualTab as (ctx: { kind?: string; recordId?: string }) => { id: string } | null;

    expect(resolver({})).toBeNull();
    expect(resolver({ kind: "document", recordId: "missing" })).toBeNull();

    serveDocuments([row({ id: "13" })]);
    await loadDocuments();
    expect(resolver({ kind: "document", recordId: "13" })?.id).toBe("document-tools");
  });

  it("only offers the failures answer row while something is failing", async () => {
    const screenModule = getScreen("documents")!;
    serveDocuments([row({ id: "14", status: "delivered" })]);
    await loadDocuments();
    expect(screenModule.commands?.().some((c) => c.id === "ans:documents-failed")).toBe(false);

    serveDocuments([row({ id: "15", status: "failed" })]);
    await loadDocuments();
    expect(screenModule.commands?.().find((c) => c.id === "ans:documents-failed")?.live).toBe("1");
  });

  it("keeps the gallery rows live rather than freezing at module load", async () => {
    const screenModule = getScreen("documents")!;
    const gallery = screenModule.ribbon?.find((r) => r.tab === "home")?.group.small?.[0]?.gallery;
    expect(gallery?.rows).toEqual([]);

    serveDocuments([row({ id: "16", title: "Renewal Pack", status: "failed" })]);
    await loadDocuments();

    const rows = gallery?.rows ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.head).toBe("failed");
    expect(rows[0]!.sub).not.toBe(rows[0]!.name);
  });
});
