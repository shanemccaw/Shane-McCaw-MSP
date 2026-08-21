/**
 * policyDecisionsModel.test.ts — pins the Policy Decisions page's counts and
 * filtering. A wrong count renders as a plausible number the rest of the page
 * never contradicts, so the four states, the flagged count, the filter and the
 * per-row action rules are asserted here rather than trusted to the JSX.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { POLICY_DECISIONS } from "./policyDecisionsData";
import {
  pdActions,
  pdFilterNote,
  pdFlaggedCount,
  pdMetaFields,
  pdRowBadge,
  pdStateCards,
  pdStateCounts,
  pdVisible,
} from "./policyDecisionsModel";

describe("fixture", () => {
  it("carries the four prototype decisions, one in each state", () => {
    assert.equal(POLICY_DECISIONS.length, 4);
    const counts = pdStateCounts();
    assert.deepEqual(counts, { proposed: 1, live: 1, due: 1, expired: 1 });
  });

  it("every decision has the full field set the page reads", () => {
    for (const d of POLICY_DECISIONS) {
      for (const key of [
        "id",
        "state",
        "pillar",
        "title",
        "obligation",
        "owner",
        "approved",
        "review",
        "register",
        "rationale",
        "compensating",
        "check",
      ] as const) {
        assert.ok(d[key], `${d.id} missing ${key}`);
      }
    }
  });
});

describe("flagged count", () => {
  it("counts only due + expired — the ones that need someone to look", () => {
    // CMP-A2 due, GOV-A4 expired. Live and proposed are not flagged.
    assert.equal(pdFlaggedCount(), 2);
  });
});

describe("state cards", () => {
  it("renders four cards in prototype order with the fixture counts", () => {
    const cards = pdStateCards(null);
    assert.deepEqual(
      cards.map((c) => c.key),
      ["proposed", "live", "due", "expired"],
    );
    assert.deepEqual(
      cards.map((c) => c.value),
      ["1", "1", "1", "1"],
    );
    assert.deepEqual(
      cards.map((c) => c.label),
      ["Awaiting sign-off", "Live", "Due for review", "Expired"],
    );
    assert.ok(cards.every((c) => !c.active));
  });

  it("marks exactly the filtered card active", () => {
    const cards = pdStateCards("due");
    assert.deepEqual(
      cards.filter((c) => c.active).map((c) => c.key),
      ["due"],
    );
  });
});

describe("filtering", () => {
  it("shows all four unfiltered, in fixture order", () => {
    assert.deepEqual(
      pdVisible(null).map((d) => d.id),
      ["CMP-A1", "CMP-A2", "SEC-A3", "GOV-A4"],
    );
  });

  it("narrows to a single state", () => {
    assert.deepEqual(
      pdVisible("expired").map((d) => d.id),
      ["GOV-A4"],
    );
    assert.deepEqual(
      pdVisible("proposed").map((d) => d.id),
      ["SEC-A3"],
    );
  });

  it("shows the filter note only while filtered, verbatim", () => {
    assert.equal(pdFilterNote(null), "");
    assert.equal(pdFilterNote("live"), "Filtered. Click the box again to show all four.");
  });
});

describe("row badge", () => {
  it("labels and colours a state", () => {
    assert.deepEqual(pdRowBadge("expired"), { label: "Expired", tone: "#f87171" });
    assert.deepEqual(pdRowBadge("proposed"), { label: "Awaiting sign-off", tone: "#fbbf24" });
    assert.deepEqual(pdRowBadge("live"), { label: "Live", tone: "#34d399" });
    assert.deepEqual(pdRowBadge("due"), { label: "Due for review", tone: "#f97316" });
  });
});

describe("actions", () => {
  it("offers sign-off only to a proposed decision", () => {
    assert.deepEqual(pdActions("proposed"), { canSign: true, canRenew: false });
  });

  it("offers renew only to a due or expired decision", () => {
    assert.deepEqual(pdActions("due"), { canSign: false, canRenew: true });
    assert.deepEqual(pdActions("expired"), { canSign: false, canRenew: true });
  });

  it("offers neither to a live decision — only Withdraw, which every row has", () => {
    assert.deepEqual(pdActions("live"), { canSign: false, canRenew: false });
  });
});

describe("meta fields", () => {
  it("lays out the four expandable fields in order", () => {
    const d = POLICY_DECISIONS.find((x) => x.id === "GOV-A4")!;
    assert.deepEqual(pdMetaFields(d), [
      { k: "Owner", v: "Shane McCaw" },
      { k: "Signed", v: "9 November 2025" },
      { k: "Next review", v: "9 May 2026" },
      { k: "Risk register", v: "RR-2025-038" },
    ]);
  });
});
