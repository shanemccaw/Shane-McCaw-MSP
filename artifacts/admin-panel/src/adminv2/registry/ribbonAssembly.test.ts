import { describe, expect, it, beforeEach } from "vitest";
import { Boxes } from "lucide-react";
import {
  assembleContextualGroups,
  backGroupFrom,
  BACK_GROUP_POSITION,
  pushTrail,
  TRAIL_MAX,
  type TrailEntry,
} from "./ribbonAssembly";
import {
  auditFixedTabIntents,
  groupsForFixedTab,
  registerScreen,
  resetRegistry,
  ShellContractError,
  docLabel,
  resolvePeek,
} from "./registry";
import type { ContextualTabSpec, RibbonContribution, ScreenModule } from "./types";

const entry = (id: string, label = id): TrailEntry => ({
  kind: "endpoint",
  id,
  label,
  open: () => {},
});

describe("trail", () => {
  it("is most-recent-first", () => {
    const trail = pushTrail(pushTrail([], entry("a")), entry("b"));
    expect(trail.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("dedupes rather than growing a run of the same record", () => {
    let trail: TrailEntry[] = [];
    trail = pushTrail(trail, entry("a"));
    trail = pushTrail(trail, entry("b"));
    trail = pushTrail(trail, entry("a"));
    expect(trail.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("caps at 6", () => {
    let trail: TrailEntry[] = [];
    for (let i = 0; i < 12; i++) trail = pushTrail(trail, entry(`e${i}`));
    expect(trail).toHaveLength(TRAIL_MAX);
    expect(trail[0]!.id).toBe("e11");
  });

  it("does not mutate its input", () => {
    const original = [entry("a")];
    pushTrail(original, entry("b"));
    expect(original).toHaveLength(1);
  });
});

describe("Back group", () => {
  it("puts where you just came from on the large button", () => {
    // trail[0] is where you ARE; the large button is trail[1].
    const trail = [entry("here"), entry("previous", "Previous thing")];
    const group = backGroupFrom(trail, () => {});
    expect(group.large?.[0]?.label).toBe("Previous thing");
  });

  it("puts the two before that underneath, then Search everything", () => {
    const trail = [entry("here"), entry("p1"), entry("p2"), entry("p3"), entry("p4")];
    const group = backGroupFrom(trail, () => {});
    expect(group.small?.map((c) => c.label)).toEqual(["p2", "p3", "Search everything"]);
  });

  it("still renders with only Search everything when there is nowhere to go back to", () => {
    // Hiding it would shift every other group one position left, which is
    // exactly the instability the design exists to prevent.
    const group = backGroupFrom([entry("here")], () => {});
    expect(group.large).toEqual([]);
    expect(group.small?.map((c) => c.label)).toEqual(["Search everything"]);
  });

  it("wires Search everything to the callback", () => {
    let opened = false;
    const group = backGroupFrom([], () => {
      opened = true;
    });
    group.small?.at(-1)?.onSelect();
    expect(opened).toBe(true);
  });
});

describe("contextual tab assembly", () => {
  const spec: ContextualTabSpec = {
    id: "endpoint-tools",
    label: "Endpoint Tools",
    groups: [
      { label: "Request", large: [] },
      { label: "Rules", large: [] },
      { label: "Share", large: [] },
    ],
  };

  it("splices Back in at position 2, never position 1", () => {
    const groups = assembleContextualGroups(spec, [entry("here"), entry("prev")], () => {});
    expect(groups.map((g) => g.label)).toEqual(["Request", "Back", "Rules", "Share"]);
    expect(groups[BACK_GROUP_POSITION]!.label).toBe("Back");
  });

  it("puts Back at the same index for every contextual tab", () => {
    const other: ContextualTabSpec = {
      id: "script-tools",
      label: "Script Tools",
      groups: [{ label: "Script" }, { label: "Run" }],
    };
    const a = assembleContextualGroups(spec, [], () => {});
    const b = assembleContextualGroups(other, [], () => {});
    expect(a.findIndex((g) => g.label === "Back")).toBe(b.findIndex((g) => g.label === "Back"));
  });

  it("still includes Back when the screen supplies no groups", () => {
    const empty: ContextualTabSpec = { id: "x", label: "X", groups: [] };
    const groups = assembleContextualGroups(empty, [], () => {});
    expect(groups.map((g) => g.label)).toEqual(["Back"]);
  });

  it("does not mutate the screen's own group array", () => {
    assembleContextualGroups(spec, [], () => {});
    expect(spec.groups).toHaveLength(3);
  });
});

describe("fixed-tab intent audit", () => {
  const contribution = (intent: "open" | "create" | "global" | "record"): RibbonContribution => ({
    tab: "home",
    group: {
      label: "Things",
      large: [{ label: "Do it", icon: Boxes, intent, onSelect: () => {} }],
    },
  });

  it("passes open, create and global", () => {
    expect(auditFixedTabIntents(contribution("open"))).toEqual([]);
    expect(auditFixedTabIntents(contribution("create"))).toEqual([]);
    expect(auditFixedTabIntents(contribution("global"))).toEqual([]);
  });

  it("flags record-scoped commands", () => {
    expect(auditFixedTabIntents(contribution("record"))).toEqual(["Do it"]);
  });

  it("checks small and row commands too, not just large", () => {
    const mixed: RibbonContribution = {
      tab: "money",
      group: {
        label: "Mixed",
        small: [{ label: "Small one", icon: Boxes, intent: "record", onSelect: () => {} }],
        row: [{ label: "Row one", icon: Boxes, intent: "record", onSelect: () => {} }],
      },
    };
    expect(auditFixedTabIntents(mixed)).toEqual(["Small one", "Row one"]);
  });
});

describe("registry", () => {
  const screen = (over: Partial<ScreenModule> = {}): ScreenModule => ({
    id: "endpoints",
    title: "M365 Endpoints",
    area: "endpoints",
    icon: Boxes,
    route: "/endpoints",
    render: () => null,
    ...over,
  });

  beforeEach(() => resetRegistry());

  it("rejects a record command on a fixed tab at registration time", () => {
    expect(() =>
      registerScreen(
        screen({
          ribbon: [
            {
              tab: "home",
              group: {
                label: "Bad",
                large: [{ label: "Delete this one", icon: Boxes, intent: "record", onSelect: () => {} }],
              },
            },
          ],
        }),
      ),
    ).toThrow(ShellContractError);
  });

  it("rejects a duplicate screen id", () => {
    registerScreen(screen());
    expect(() => registerScreen(screen())).toThrow(ShellContractError);
  });

  it("orders fixed-tab groups by order then registration", () => {
    registerScreen(
      screen({
        id: "a",
        route: "/a",
        ribbon: [{ tab: "home", group: { label: "Late" }, order: 200 }],
      }),
    );
    registerScreen(
      screen({
        id: "b",
        route: "/b",
        ribbon: [{ tab: "home", group: { label: "Early" }, order: 10 }],
      }),
    );
    registerScreen(
      screen({ id: "c", route: "/c", ribbon: [{ tab: "home", group: { label: "Default" } }] }),
    );
    expect(groupsForFixedTab("home").map((g) => g.label)).toEqual(["Early", "Default", "Late"]);
  });

  it("resolves a peek through whichever screen owns the kind", () => {
    registerScreen(
      screen({
        peeks: {
          endpoint: (id) =>
            id === "ep-1"
              ? { kind: "endpoint", title: "Sign-in logs", icon: Boxes }
              : null,
        },
      }),
    );
    expect(resolvePeek("endpoint", "ep-1")?.title).toBe("Sign-in logs");
    expect(resolvePeek("endpoint", "nope")).toBeNull();
  });

  it("docLabel reuses the peek resolver so a record cannot disagree with itself", () => {
    registerScreen(
      screen({
        peeks: {
          endpoint: () => ({ kind: "endpoint", title: "Sign-in logs", icon: Boxes }),
        },
      }),
    );
    expect(docLabel("endpoint", "ep-1")).toBe("Sign-in logs");
    expect(docLabel("screen", "endpoints")).toBe("M365 Endpoints");
  });

  it("docLabel falls back to the raw id rather than guessing", () => {
    expect(docLabel("endpoint", "ep-unknown")).toBe("ep-unknown");
  });
});
