/**
 * docLibraryModel.test.ts — pins the Document Library against the prototype.
 *
 * The fixture itself was extracted mechanically rather than retyped, so these
 * assertions are aimed at the two things extraction cannot protect: the DERIVED
 * behaviour transcribed by hand from the prototype's logic (11771-11930), and
 * the joins between the DOC_LIB/OWNED_META arrays and the facet value lists and
 * pillar colour map, where a fixture can be perfectly transcribed and still not
 * line up.
 *
 * Git #1346 removed the 24-document catalogue from what the customer sees —
 * showing it as a disclosed "X of Y documents" browsable inventory was the
 * thing to fix, not a shape the tests should keep pinning. `ALL_DOCS` is now
 * the nine owned documents only; the facet-count tests below are still the
 * ones that matter most, since a faceted search whose counts include their own
 * group looks completely normal until you tick a box and every sibling reads
 * zero, and no visual pass catches that.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DOC_PILLAR_COLOUR } from "./docLibraryData";
import {
  ALL_DOCS,
  DOC_FACET_DEFS,
  DOC_OWNED_COUNT,
  DOC_SORT_OPTIONS,
  docFacetActive,
  docFacetGroups,
  docFilterApplyLabel,
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
  it("renders only the nine owned documents — the catalogue is not merged in", () => {
    assert.equal(ALL_DOCS.length, 9);
    assert.equal(DOC_OWNED_COUNT, 9);
    assert.ok(ALL_DOCS.every((d) => d.owned));
  });

  it("numbers DOC-01 to DOC-09 with no gaps or duplicates", () => {
    assert.deepEqual(
      docShown("", NONE, "num").map((d) => d.num),
      Array.from({ length: 9 }, (_, i) => `DOC-${String(i + 1).padStart(2, "0")}`),
    );
    assert.equal(new Set(ALL_DOCS.map((d) => d.key)).size, 9);
  });

  it("gives every owned document a body", () => {
    for (const d of ALL_DOCS) {
      assert.ok(d.headline, `${d.num} headline`);
      assert.ok(d.standfirst, `${d.num} standfirst`);
      assert.ok((d.facts ?? []).length > 0, `${d.num} facts`);
      assert.ok((d.sections ?? []).length > 0, `${d.num} sections`);
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
  it("has no Availability facet — the owned/catalogue split it tracked is gone", () => {
    assert.ok(!DOC_FACET_DEFS.some((g) => g.key === "avail"));
  });

  it("lists every value present in the library", () => {
    // A document whose pillar is not in the Pillar list is unreachable by that
    // facet, and there is no visual symptom — the row just never appears.
    for (const g of DOC_FACET_DEFS) {
      for (const v of new Set(ALL_DOCS.map((d) => g.get(d)))) {
        assert.ok(g.values.includes(v), `${g.label} is missing "${v}"`);
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
    assert.equal(countOf("pillar", "Security", SECURITY), countOf("pillar", "Security"));
  });

  it("adds up: ticking two pillars returns the sum of each alone", () => {
    const a = docShown("", { pillar: ["Security"] }, "num").length;
    const b = docShown("", { pillar: ["Cross-pillar"] }, "num").length;
    assert.equal(docShown("", { pillar: ["Security", "Cross-pillar"] }, "num").length, a + b);
  });

  it("intersects across groups", () => {
    const rows = docShown("", { pillar: ["Security"], type: ["Report"] }, "num");
    assert.ok(rows.every((d) => d.pillar === "Security" && d.type === "Report"));
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
    assert.ok(docShown("Contract", NONE, "num").some((d) => d.num === "DOC-09"));
  });

  it("ignores surrounding whitespace and an empty term", () => {
    assert.equal(docShown("   ", NONE, "num").length, 9);
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

  it("returns the same 9 rows under every sort", () => {
    for (const o of DOC_SORT_OPTIONS) {
      assert.equal(new Set(docShown("", NONE, o.key).map((d) => d.num)).size, 9, o.key);
    }
  });
});

describe("the row's state column", () => {
  it("reads Regenerate / Signed / Current for owned documents", () => {
    assert.deepEqual(docStateFor(byNum("DOC-01")), { label: "Regenerate", tone: "#fbbf24" });
    assert.deepEqual(docStateFor(byNum("DOC-09")), { label: "Signed", tone: "#94a3b8" });
    assert.deepEqual(docStateFor(byNum("DOC-02")), { label: "Current", tone: "#4ade80" });
  });
});

describe("header strings", () => {
  it("says 'All 9' unfiltered and 'n of 9' filtered", () => {
    assert.equal(docResultLabel(9), "All 9 documents");
    assert.equal(docResultLabel(4), "4 of 9 documents");
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
    assert.equal(docFilterApplyLabel(9), "Show 9 documents");
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
