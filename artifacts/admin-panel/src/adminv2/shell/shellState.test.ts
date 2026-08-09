import { describe, expect, it } from "vitest";
import {
  fromPersisted,
  initialShellState,
  neighbourDocId,
  RECENT_COMMANDS_MAX,
  shellReducer,
  toPersisted,
  type OpenDoc,
  type ShellState,
} from "./shellState";
import { METRICS } from "../theme";
import { isNumericFact } from "./Peek";

const doc = (id: string): OpenDoc => ({
  id: `endpoint:${id}`,
  kind: "endpoint",
  recordId: id,
  screenId: "endpoints",
  label: id,
});

function withDocs(ids: string[], activeIndex = 0): ShellState {
  const docs = ids.map(doc);
  return initialShellState({ docs, activeDocId: docs[activeIndex]!.id });
}

describe("ribbon tab selection", () => {
  it("clicking the active tab collapses the ribbon", () => {
    const state = initialShellState({ activeTab: "home", ribbonOpen: true });
    const next = shellReducer(state, { type: "selectTab", tab: "home" });
    expect(next.ribbonOpen).toBe(false);
  });

  it("clicking the active tab again re-opens it", () => {
    let state = initialShellState({ activeTab: "home", ribbonOpen: true });
    state = shellReducer(state, { type: "selectTab", tab: "home" });
    state = shellReducer(state, { type: "selectTab", tab: "home" });
    expect(state.ribbonOpen).toBe(true);
  });

  it("clicking a different tab always opens the ribbon", () => {
    const state = initialShellState({ activeTab: "home", ribbonOpen: false });
    const next = shellReducer(state, { type: "selectTab", tab: "money" });
    expect(next.activeTab).toBe("money");
    expect(next.ribbonOpen).toBe(true);
  });

  it("selecting a fixed tab leaves the contextual tab", () => {
    const state = initialShellState({ contextActive: true });
    expect(shellReducer(state, { type: "selectTab", tab: "view" }).contextActive).toBe(false);
  });

  it("selecting the contextual tab when it is already up collapses the ribbon", () => {
    const state = initialShellState({ contextActive: true, ribbonOpen: true });
    expect(shellReducer(state, { type: "selectContextTab" }).ribbonOpen).toBe(false);
  });

  it("changing tab closes any dropped gallery", () => {
    const state = initialShellState({
      gallery: { spec: { id: "g", title: "G", rows: [] }, anchor: { left: 0, top: 0 } },
    });
    expect(shellReducer(state, { type: "selectTab", tab: "money" }).gallery).toBeNull();
  });
});

describe("documents", () => {
  it("opening a record makes its contextual tab the useful one", () => {
    const next = shellReducer(initialShellState(), { type: "openDoc", doc: doc("a") });
    expect(next.contextActive).toBe(true);
    expect(next.activeDocId).toBe("endpoint:a");
  });

  it("opening a plain screen does not switch to the contextual tab", () => {
    const screenDoc: OpenDoc = {
      id: "screen:endpoints",
      kind: "screen",
      recordId: "endpoints",
      screenId: "endpoints",
      label: "M365 Endpoints",
    };
    const next = shellReducer(initialShellState(), { type: "openDoc", doc: screenDoc });
    expect(next.contextActive).toBe(false);
  });

  it("re-opening an already open doc focuses it rather than duplicating the tab", () => {
    let state = shellReducer(initialShellState(), { type: "openDoc", doc: doc("a") });
    state = shellReducer(state, { type: "openDoc", doc: doc("b") });
    state = shellReducer(state, { type: "openDoc", doc: doc("a") });
    expect(state.docs).toHaveLength(2);
    expect(state.activeDocId).toBe("endpoint:a");
  });

  it("closing the active doc focuses the one to its right", () => {
    const state = withDocs(["a", "b", "c"], 1);
    const next = shellReducer(state, { type: "closeDoc", id: "endpoint:b" });
    expect(next.activeDocId).toBe("endpoint:c");
  });

  it("closing the last doc falls back to the one on its left", () => {
    const state = withDocs(["a", "b"], 1);
    const next = shellReducer(state, { type: "closeDoc", id: "endpoint:b" });
    expect(next.activeDocId).toBe("endpoint:a");
  });

  it("closing a background doc leaves focus alone", () => {
    const state = withDocs(["a", "b", "c"], 0);
    const next = shellReducer(state, { type: "closeDoc", id: "endpoint:c" });
    expect(next.activeDocId).toBe("endpoint:a");
  });

  it("closing the only doc clears focus and leaves the contextual tab", () => {
    const state = initialShellState({
      docs: [doc("a")],
      activeDocId: "endpoint:a",
      contextActive: true,
    });
    const next = shellReducer(state, { type: "closeDoc", id: "endpoint:a" });
    expect(next.activeDocId).toBeNull();
    expect(next.contextActive).toBe(false);
  });

  it("neighbourDocId returns null for an unknown id", () => {
    expect(neighbourDocId([doc("a")], "endpoint:zzz")).toBeNull();
  });
});

describe("panels", () => {
  it("clamps a panel resized past its bounds", () => {
    const wide = shellReducer(initialShellState(), {
      type: "setPanelSize",
      panel: "left",
      size: 9999,
    });
    expect(wide.leftWidth).toBe(METRICS.panelMax);

    const narrow = shellReducer(initialShellState(), {
      type: "setPanelSize",
      panel: "left",
      size: -50,
    });
    expect(narrow.leftWidth).toBe(METRICS.panelMin);
  });

  it("selecting a bottom tab opens the dock", () => {
    const next = shellReducer(initialShellState({ bottom: false }), {
      type: "setBottomTab",
      id: "logs",
    });
    expect(next.bottom).toBe(true);
    expect(next.bottomTabId).toBe("logs");
  });
});

describe("palette recents", () => {
  it("moves a re-run command back to the front", () => {
    let state = initialShellState();
    state = shellReducer(state, { type: "commandRun", id: "a", commandType: "action" });
    state = shellReducer(state, { type: "commandRun", id: "b", commandType: "action" });
    state = shellReducer(state, { type: "commandRun", id: "a", commandType: "action" });
    expect(state.recentCommandIds).toEqual(["a", "b"]);
  });

  it("caps the recents list", () => {
    let state = initialShellState();
    for (let i = 0; i < 30; i++) {
      state = shellReducer(state, { type: "commandRun", id: `c${i}`, commandType: "action" });
    }
    expect(state.recentCommandIds).toHaveLength(RECENT_COMMANDS_MAX);
  });

  it("running a command closes the palette and clears the query", () => {
    const state = initialShellState({ paletteOpen: true, paletteQuery: "prof" });
    const next = shellReducer(state, { type: "commandRun", id: "x", commandType: "answer" });
    expect(next.paletteOpen).toBe(false);
    expect(next.paletteQuery).toBe("");
  });
});

describe("peek delete arming", () => {
  it("arms, then stays armed until closed", () => {
    let state = shellReducer(initialShellState(), {
      type: "openPeek",
      target: { kind: "endpoint", id: "a" },
    });
    expect(state.peekArmedAction).toBeNull();
    state = shellReducer(state, { type: "armPeekAction", label: "Delete" });
    expect(state.peekArmedAction).toBe("Delete");
  });

  it("disarms when a different record is opened", () => {
    // Otherwise a live destructive button sits one click away on a record the
    // user has not even looked at yet.
    let state = shellReducer(initialShellState(), {
      type: "openPeek",
      target: { kind: "endpoint", id: "a" },
    });
    state = shellReducer(state, { type: "armPeekAction", label: "Delete" });
    state = shellReducer(state, { type: "openPeek", target: { kind: "endpoint", id: "b" } });
    expect(state.peekArmedAction).toBeNull();
  });

  it("disarms on close", () => {
    let state = shellReducer(initialShellState(), {
      type: "openPeek",
      target: { kind: "endpoint", id: "a" },
    });
    state = shellReducer(state, { type: "armPeekAction", label: "Delete" });
    state = shellReducer(state, { type: "closePeek" });
    expect(state.peekArmedAction).toBeNull();
    expect(state.peek).toBeNull();
  });
});

describe("persistence", () => {
  it("round-trips layout", () => {
    const state = initialShellState({ left: false, leftWidth: 300, activeTab: "money" });
    const restored = fromPersisted(JSON.stringify(toPersisted(state)));
    expect(restored.left).toBe(false);
    expect(restored.leftWidth).toBe(300);
    expect(restored.activeTab).toBe("money");
  });

  it("does not persist open docs, palette or peek", () => {
    const state = initialShellState({
      docs: [doc("a")],
      paletteOpen: true,
      peek: { kind: "endpoint", id: "a" },
    });
    const persisted = toPersisted(state) as Record<string, unknown>;
    expect(persisted.docs).toBeUndefined();
    expect(persisted.paletteOpen).toBeUndefined();
    expect(persisted.peek).toBeUndefined();
  });

  it("discards malformed storage rather than half-restoring it", () => {
    expect(fromPersisted("not json")).toEqual({});
    expect(fromPersisted(null)).toEqual({});
  });

  it("clamps a persisted width that is out of bounds", () => {
    const restored = fromPersisted(JSON.stringify({ leftWidth: 99999 }));
    expect(restored.leftWidth).toBe(METRICS.panelMax);
  });

  it("ignores fields of the wrong type", () => {
    const restored = fromPersisted(JSON.stringify({ left: "yes", leftWidth: "wide" }));
    expect(restored.left).toBeUndefined();
    expect(restored.leftWidth).toBeUndefined();
  });
});

describe("peek fact sizing", () => {
  // The predicate is the design's own: a bare number (optionally with a currency
  // prefix and/or a % suffix) is a number, and so is anything four characters or
  // shorter. Everything else is prose and wraps.
  it("treats bare numbers as numbers", () => {
    expect(isNumericFact({ label: "Weight", value: "18" })).toBe(true);
    expect(isNumericFact({ label: "Profit", value: "$12,480" })).toBe(true);
    expect(isNumericFact({ label: "Coverage", value: "94%" })).toBe(true);
  });

  it("treats anything four characters or shorter as a number", () => {
    // A short code reads as a figure with a caption, not as a sentence.
    expect(isNumericFact({ label: "Tier", value: "E3" })).toBe(true);
    expect(isNumericFact({ label: "Verb", value: "GET" })).toBe(true);
  });

  it("treats prose as prose so it wraps instead of clipping", () => {
    expect(isNumericFact({ label: "Last run", value: "Runs against nobody" })).toBe(false);
    expect(isNumericFact({ label: "State", value: "Never generated" })).toBe(false);
    // Long, even with digits in it.
    expect(isNumericFact({ label: "Last run", value: "3 findings, 2 days ago" })).toBe(false);
  });

  it("honours an explicit prose override on a short value", () => {
    expect(isNumericFact({ label: "Tier", value: "E3", prose: true })).toBe(false);
  });
});
