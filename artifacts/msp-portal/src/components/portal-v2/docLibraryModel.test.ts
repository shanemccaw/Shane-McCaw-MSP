/**
 * docLibraryModel.test.ts — pins the Document Library against the prototype.
 *
 * The fixture itself was extracted mechanically rather than retyped, so these
 * assertions are aimed at the two things extraction cannot protect: the DERIVED
 * behaviour transcribed by hand from the prototype's logic (11771-11930), and
 * the joins between the three arrays — the positional OWNED_META zip, the facet
 * value lists, and the pillar colour map — where a fixture can be perfectly
 * transcribed and still not line up.
 *
 * The facet-count tests are the ones that matter most. A faceted search whose
 * counts include their own group looks completely normal until you tick a box
 * and every sibling reads zero, and no visual pass catches that.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DOC_LIB_TOTAL, DOC_PILLAR_COLOUR } from "./docLibraryData";
import {
  ALL_DOCS,
  DOC_FACET_DEFS,
  DOC_OWNED_COUNT,
  DOC_SORT_OPTIONS,
  docCartLabel,
  docCartTotal,
  docFacetActive,
  docFacetGroups,
  docFilterApplyLabel,
  docFilterNote,
  docMetaLine,
  docPasses,
  docResultLabel,
  docShown,
  docStateFor,
  type DocFacetState,
  type DocRow,
} from "./docLibraryModel";

const NONE: DocFacetState = {};
const byNum = (n: string): DocRow => ALL_DOCS.find((d) => d.num === n)!;
const groupOf = (key: string, facets: DocFacetState = NONE, query = "") =>
  docFacetGroups(query, facets).find((g) => g.key === key)!;
const countOf = (key: string, value: string, facets: DocFacetState = NONE, query = "") =>
  groupOf(key, facets, query).items.find((i) => i.value === value)!.count;

describe("library shape", () => {
  it("shows 33 documents of a stated library of 84", () => {
    // The footer and the search placeholder both quote 84 while the list shows
    // 33. That gap is deliberate — the README calls it out — so it is pinned
    // rather than reconciled.
    assert.equal(ALL_DOCS.length, 33);
    assert.equal(DOC_LIB_TOTAL, 84);
    assert.ok(DOC_LIB_TOTAL > ALL_DOCS.length);
  });

  it("splits 9 owned from 24 catalogue", () => {
    assert.equal(DOC_OWNED_COUNT, 9);
    assert.equal(ALL_DOCS.filter((d) => d.owned).length, 9);
    assert.equal(ALL_DOCS.filter((d) => !d.owned).length, 24);
  });

  it("numbers DOC-01 to DOC-33 with no gaps or duplicates", () => {
    assert.deepEqual(
      docShown("", NONE, "num").map((d) => d.num),
      Array.from({ length: 33 }, (_, i) => `DOC-${String(i + 1).padStart(2, "0")}`),
    );
    assert.equal(new Set(ALL_DOCS.map((d) => d.key)).size, 33);
  });

  it("owns DOC-01 to DOC-09 and offers DOC-10 upward", () => {
    // The split is positional, not flagged per row, so a shifted array would
    // put an owned document in the catalogue with a price on it.
    assert.deepEqual(
      ALL_DOCS.filter((d) => d.owned).map((d) => d.num),
      ["DOC-01", "DOC-02", "DOC-03", "DOC-04", "DOC-05", "DOC-06", "DOC-07", "DOC-08", "DOC-09"],
    );
    assert.ok(ALL_DOCS.filter((d) => !d.owned).every((d) => d.num >= "DOC-10"));
  });

  it("gives every owned document a body and every catalogue document a pitch", () => {
    for (const d of ALL_DOCS) {
      if (d.owned) {
        assert.ok(d.headline, `${d.num} headline`);
        assert.ok(d.standfirst, `${d.num} standfirst`);
        assert.ok((d.facts ?? []).length > 0, `${d.num} facts`);
        assert.ok((d.sections ?? []).length > 0, `${d.num} sections`);
      } else {
        assert.ok(d.blurbHead, `${d.num} blurbHead`);
        assert.ok(d.blurb, `${d.num} blurb`);
        assert.ok((d.contains ?? []).length > 0, `${d.num} contains`);
        assert.ok(d.builtFrom, `${d.num} builtFrom`);
      }
    }
  });
});

describe("the OWNED_META positional zip", () => {
  // DOC_LIB and OWNED_META are two separate arrays joined by index. Nothing in
  // either one references the other, so a single inserted entry would silently
  // relabel all nine documents' pillar, type and audience.
  it("puts the signed contract on DOC-09 and dates everything else 3 Aug", () => {
    assert.equal(byNum("DOC-09").type, "Contract");
    assert.equal(byNum("DOC-09").fresh, "signed");
    assert.equal(byNum("DOC-09").issued, "Signed 6 Aug 2026");
    assert.equal(byNum("DOC-01").issued, "Issued 3 Aug 2026");
    assert.equal(ALL_DOCS.filter((d) => d.owned && d.issued === "Signed 6 Aug 2026").length, 1);
  });

  it("marks exactly DOC-01 and DOC-03 out of date", () => {
    assert.deepEqual(
      ALL_DOCS.filter((d) => d.fresh === "stale").map((d) => d.num),
      ["DOC-01", "DOC-03"],
    );
    // A stale row's amber band prints freshNote, so it cannot be missing.
    for (const d of ALL_DOCS.filter((x) => x.fresh === "stale")) {
      assert.ok(d.freshNote, `${d.num} freshNote`);
    }
  });

  it("assigns the two cross-pillar reports to the Copilot offerings", () => {
    const d1 = byNum("DOC-01");
    assert.equal(d1.pillar, "Cross-pillar");
    assert.equal(d1.audience, "Board");
    assert.equal(d1.offering, "Copilot Readiness Assessment");
    assert.equal(byNum("DOC-09").offering, "Copilot Gate Clearance");
  });
});

describe("facet definitions cover the data", () => {
  it("lists every value present in the library", () => {
    // A document whose pillar is not in the Pillar list is unreachable by that
    // facet, and there is no visual symptom — the row just never appears.
    for (const g of DOC_FACET_DEFS) {
      for (const v of new Set(ALL_DOCS.map((d) => g.get(d)))) {
        assert.ok(g.values.includes(v), `${g.label} is missing "${v}"`);
      }
    }
  });

  it("has no facet value that matches nothing", () => {
    // The reverse check: a value in the drawer that no document carries is a
    // permanently-zero row, which reads as a bug to whoever ticks it.
    for (const g of DOC_FACET_DEFS) {
      for (const v of g.values) {
        assert.ok(countOf(g.key, v) > 0, `${g.label} / ${v} matches nothing`);
      }
    }
  });

  it("colours every pillar in the library", () => {
    for (const d of ALL_DOCS) {
      assert.match(DOC_PILLAR_COLOUR[d.pillar] ?? "", /^#[0-9a-f]{6}$/, `${d.pillar} colour`);
    }
  });
});

describe("facet counts exclude their own group", () => {
  const SECURITY: DocFacetState = { pillar: ["Security"] };

  it("keeps sibling pillar counts alive once one pillar is ticked", () => {
    // Counting with the group INCLUDED would zero every sibling here, turning
    // the drawer into a filter that can only ever narrow.
    assert.ok(countOf("pillar", "Governance", SECURITY) > 0);
    assert.ok(countOf("pillar", "Compliance", SECURITY) > 0);
    assert.equal(countOf("pillar", "Security", SECURITY), countOf("pillar", "Security"));
  });

  it("still narrows OTHER groups by the ticked pillar", () => {
    // The skip is one group deep, not a blanket exemption: Availability counts
    // must reflect the Security filter.
    const all = countOf("avail", "Available to add");
    const sec = countOf("avail", "Available to add", SECURITY);
    assert.ok(sec < all);
    assert.equal(sec, ALL_DOCS.filter((d) => !d.owned && d.pillar === "Security").length);
  });

  it("adds up: ticking two pillars returns the sum of each alone", () => {
    const a = docShown("", { pillar: ["Security"] }, "num").length;
    const b = docShown("", { pillar: ["Adoption"] }, "num").length;
    assert.equal(docShown("", { pillar: ["Security", "Adoption"] }, "num").length, a + b);
  });

  it("intersects across groups", () => {
    const rows = docShown("", { pillar: ["Security"], avail: ["In your library"] }, "num");
    assert.ok(rows.length > 0);
    assert.ok(rows.every((d) => d.owned && d.pillar === "Security"));
  });
});

describe("search", () => {
  it("matches title, number, type, pillar and offering, case-insensitively", () => {
    assert.deepEqual(
      docShown("DOC-05", NONE, "num").map((d) => d.num),
      ["DOC-05"],
    );
    assert.deepEqual(
      docShown("doc-05", NONE, "num").map((d) => d.num),
      ["DOC-05"],
    );
    assert.ok(docShown("licensing", NONE, "num").length > 0);
    assert.ok(docShown("Contract", NONE, "num").some((d) => d.num === "DOC-09"));
  });

  it("ignores surrounding whitespace and an empty term", () => {
    assert.equal(docShown("   ", NONE, "num").length, 33);
    assert.deepEqual(
      docShown("  DOC-05  ", NONE, "num").map((d) => d.num),
      ["DOC-05"],
    );
  });

  it("does not search the document body", () => {
    // Search is over the row's own metadata line, not the copy — a term that
    // only appears inside a section must not match.
    assert.equal(docPasses(byNum("DOC-01"), "standfirst", NONE), false);
  });

  it("narrows the facet counts too", () => {
    assert.equal(countOf("avail", "In your library", NONE, "DOC-05"), 1);
  });
});

describe("sorting", () => {
  it("offers the four sorts in the prototype's order", () => {
    assert.deepEqual(
      DOC_SORT_OPTIONS.map((o) => o.key),
      ["num", "library", "pillar", "type"],
    );
    assert.deepEqual(
      DOC_SORT_OPTIONS.map((o) => o.label),
      ["Number", "Your library first", "Pillar", "Type"],
    );
  });

  it("puts owned documents first under 'library'", () => {
    const rows = docShown("", NONE, "library");
    assert.ok(rows.slice(0, 9).every((d) => d.owned));
    assert.ok(!rows.slice(9).some((d) => d.owned));
    // ...and tie-breaks on number within each half.
    const owned = rows.slice(0, 9).map((d) => d.num);
    assert.deepEqual(owned, owned.slice().sort());
  });

  it("orders pillars Cross-pillar first, Health last, in contiguous runs", () => {
    const seen = docShown("", NONE, "pillar").map((d) => d.pillar);
    assert.equal(seen[0], "Cross-pillar");
    assert.equal(seen[seen.length - 1], "Health");
    assert.equal(new Set(seen).size, seen.filter((p, i) => p !== seen[i - 1]).length);
  });

  it("orders types Report first, Contract last, in contiguous runs", () => {
    const seen = docShown("", NONE, "type").map((d) => d.type);
    assert.equal(seen[0], "Report");
    assert.equal(seen[seen.length - 1], "Contract");
    assert.equal(new Set(seen).size, seen.filter((t, i) => t !== seen[i - 1]).length);
  });

  it("returns the same 33 rows under every sort", () => {
    for (const o of DOC_SORT_OPTIONS) {
      assert.equal(new Set(docShown("", NONE, o.key).map((d) => d.num)).size, 33, o.key);
    }
  });
});

describe("the row's state column", () => {
  it("reads Regenerate / Signed / Current for owned documents", () => {
    assert.deepEqual(docStateFor(byNum("DOC-01")), { label: "Regenerate", tone: "#fbbf24" });
    assert.deepEqual(docStateFor(byNum("DOC-09")), { label: "Signed", tone: "#94a3b8" });
    assert.deepEqual(docStateFor(byNum("DOC-02")), { label: "Current", tone: "#4ade80" });
  });

  it("reads the price, or 'On request' when a catalogue document has none", () => {
    // Exactly one catalogue document is priceless: DOC-31 is included when the
    // offering is scoped, so it must not render as "$0".
    const priceless = ALL_DOCS.filter((d) => !d.owned && !d.price);
    assert.deepEqual(
      priceless.map((d) => d.num),
      ["DOC-31"],
    );
    assert.deepEqual(docStateFor(priceless[0]), { label: "On request", tone: "#64748b" });
    assert.match(docStateFor(byNum("DOC-10")).label, /^\$\d+$/);
  });
});

describe("the cart", () => {
  it("sums catalogue prices", () => {
    const two = ALL_DOCS.filter((d) => !d.owned && d.price).slice(0, 2);
    assert.equal(
      docCartTotal(two.map((d) => d.key)),
      (two[0].price ?? 0) + (two[1].price ?? 0),
    );
  });

  it("contributes nothing for an owned key or the priceless document", () => {
    // Owned rows have no Add button, but the total must not produce NaN if a
    // key ever reaches it, and DOC-31 legitimately adds zero.
    assert.equal(docCartTotal(["own-0"]), 0);
    assert.equal(docCartTotal(["DOC-31"]), 0);
    assert.equal(docCartTotal([]), 0);
  });

  it("labels one document singular and hides a zero total", () => {
    assert.equal(docCartLabel(["DOC-31"]), "1 document selected");
    const priced = ALL_DOCS.find((d) => !d.owned && d.price)!;
    assert.equal(docCartLabel([priced.key]), `1 document selected · $${priced.price}`);
    assert.equal(docCartLabel([priced.key, "DOC-31"]), `2 documents selected · $${priced.price}`);
  });
});

describe("header strings", () => {
  it("says 'All 33' unfiltered and 'n of 33' filtered", () => {
    assert.equal(docResultLabel(33), "All 33 documents");
    assert.equal(docResultLabel(4), "4 of 33 documents");
  });

  it("swaps the owned/available breakdown for the word 'filtered'", () => {
    assert.equal(docFilterNote(false), "9 owned · 24 available to add");
    assert.equal(docFilterNote(true), "filtered");
  });

  it("treats a search term as an active filter", () => {
    assert.equal(docFacetActive("", NONE), false);
    assert.equal(docFacetActive("  ", NONE), false);
    assert.equal(docFacetActive("copilot", NONE), true);
    assert.equal(docFacetActive("", { pillar: ["Security"] }), true);
    // An emptied group is not an active filter.
    assert.equal(docFacetActive("", { pillar: [] }), false);
  });

  it("pluralises the drawer's apply button", () => {
    assert.equal(docFilterApplyLabel(1), "Show 1 document");
    assert.equal(docFilterApplyLabel(33), "Show 33 documents");
    assert.equal(docFilterApplyLabel(0), "Show 0 documents");
  });

  it("keeps the meta line's double-spaced separators", () => {
    // The prototype spaces these ' · ' separators with TWO spaces either side.
    // Single spacing is invisible in a diff and wrong on screen.
    const line = docMetaLine(byNum("DOC-01"));
    assert.equal(line, "Report  ·  Cross-pillar  ·  for Board  ·  Copilot Readiness Assessment");
    assert.equal(line.split("  ·  ").length, 4);
  });
});
