/**
 * paletteIndex.test.ts — the command palette's ranking and 14-cap.
 *
 * README §"The command palette (⌘K)": "Ranking: exact label match → label prefix
 * → label contains → sub/kind contains. Results are capped at 14." This pins
 * that algorithm against the prototype's exact implementation (shell
 * 19126-19132) so a later refactor of the index cannot quietly change the order
 * a customer sees, or lift the cap.
 *
 * Run with the repo's `npm test` (Node's runner via `tsx --test`).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PALETTE_CAP,
  PALETTE_INDEX,
  paletteAskLabel,
  paletteDefault,
  paletteHint,
  paletteScopeNote,
  rankPalette,
  type PaletteEntry,
} from "./paletteIndex";

const to = (href: string): PaletteEntry["target"] => ({ type: "route", href });

/** A controlled index that has one row in each of the four score tiers. */
const TIERS: readonly PaletteEntry[] = [
  { kind: "Page", label: "Security", sub: "", tone: "#000", target: to("/exact") },
  { kind: "Page", label: "Security Plan", sub: "", tone: "#000", target: to("/prefix") },
  { kind: "Page", label: "Cloud Security", sub: "", tone: "#000", target: to("/contains") },
  { kind: "Doc", label: "Backup guide", sub: "security posture review", tone: "#000", target: to("/sub-only") },
  { kind: "Security review", label: "Quarterly audit", sub: "", tone: "#000", target: to("/kind-only") },
];

describe("rankPalette — the four-tier ranking", () => {
  it("orders exact → label prefix → label contains → sub/kind contains", () => {
    const order = rankPalette(TIERS, "security").map((r) => r.label);
    assert.deepEqual(order, ["Security", "Security Plan", "Cloud Security", "Backup guide", "Quarterly audit"]);
  });

  it("exact label match always wins over a mere prefix", () => {
    const first = rankPalette(TIERS, "Security")[0];
    assert.equal(first.label, "Security");
  });

  it("breaks a score tie by first match position in the haystack", () => {
    // Both are sub/kind-only matches (score 3); 'security' appears earlier in
    // the sub-only row's haystack (position 13) than in the kind-only row's
    // (position 17), so it ranks first.
    const tail = rankPalette(TIERS, "security")
      .map((r) => r.label)
      .slice(-2);
    assert.deepEqual(tail, ["Backup guide", "Quarterly audit"]);
  });

  it("matches text in the sub and the kind, not only the label", () => {
    const bySub = rankPalette(TIERS, "posture").map((r) => r.label);
    assert.deepEqual(bySub, ["Backup guide"]);
  });

  it("is case-insensitive", () => {
    assert.equal(rankPalette(TIERS, "SECURITY")[0].label, "Security");
  });

  it("returns nothing for an empty or whitespace query", () => {
    assert.deepEqual(rankPalette(TIERS, ""), []);
    assert.deepEqual(rankPalette(TIERS, "   "), []);
  });

  it("returns nothing when the query matches no row", () => {
    assert.deepEqual(rankPalette(TIERS, "zzzznope"), []);
  });
});

describe("rankPalette — the 14 cap", () => {
  it("never returns more than PALETTE_CAP rows", () => {
    // Build an index far larger than the cap, all matching one query.
    const many: PaletteEntry[] = Array.from({ length: 40 }, (_, i) => ({
      kind: "Page",
      label: `Match ${i}`,
      sub: "",
      tone: "#000",
      target: to(`/m${i}`),
    }));
    assert.equal(rankPalette(many, "match").length, PALETTE_CAP);
    assert.equal(PALETTE_CAP, 14);
  });

  it("caps the real index for a broad query that overflows it", () => {
    // The real index is larger than the cap, and a common letter matches most
    // of it — so this exercises the slice against real content.
    assert.ok(PALETTE_INDEX.length > PALETTE_CAP, "index must exceed the cap to test it");
    assert.equal(rankPalette(PALETTE_INDEX, "e").length, PALETTE_CAP);
  });
});

describe("the real index and its chrome", () => {
  it("resolves the six-row default view, every row present", () => {
    const rows = paletteDefault(PALETTE_INDEX);
    assert.equal(rows.length, 6);
    assert.equal(rows[0].kind, "Hold window");
    assert.ok(rows[0].sub.startsWith("T-0"), "first default row is the T-0 hold window");
    assert.deepEqual(
      rows.map((r) => r.label),
      [rows[0].label, "Change Control", "Documents", "Active Runbooks", "Security", "Risk Register"],
    );
  });

  it("states the indexed count in the footer note", () => {
    assert.equal(
      paletteScopeNote(PALETTE_INDEX),
      `${PALETTE_INDEX.length} pages, documents, findings, fixes and change requests indexed`,
    );
  });

  it("turns a query into the Ask ShaneBot label, and has a no-query form", () => {
    assert.equal(paletteAskLabel("legacy auth"), "Ask ShaneBot: legacy auth");
    assert.equal(paletteAskLabel("   "), "Ask ShaneBot anything about your tenant");
  });

  it("writes the hint for the no-query, match and no-match states", () => {
    assert.equal(paletteHint("", 0), "Needs a decision, and where you were");
    assert.equal(paletteHint("x", 1), "1 match");
    assert.equal(paletteHint("x", 3), "3 matches");
    assert.equal(paletteHint("x", 0), "No match in the portal");
  });
});
