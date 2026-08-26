/**
 * docLibraryModel.ts — the Document Library's derived state.
 *
 * Transcribed from the prototype's own derivation
 * (`Customer Portal Shell.dc.html` 11771-11930): how owned and catalogue
 * documents are merged, how a document passes the filter, how facet counts are
 * computed, and how the four sorts order the result.
 *
 * ── The facet-count rule is the load-bearing bit ───────────────────────────
 * `docPasses(d, skipKey)` takes the group to SKIP. A facet option's count is
 * computed with its OWN group excluded from the filter, which is what makes a
 * faceted search behave the way people expect: after ticking "Security", the
 * Pillar group still shows how many documents each OTHER pillar would return,
 * rather than showing zero for all of them. Counting with the group included
 * produces a list that can only ever narrow, and the README calls this out
 * explicitly — "counts are computed excluding the facet's own group so the
 * numbers behave like a real faceted search."
 *
 * ── WHAT IS REAL TODAY, and what is scoped out ─────────────────────────────
 * Shane, 2026-08-19, correcting the scope of this page after it was built:
 * "for documents it's only the 9 in Copilot Readiness right now. The others
 * were for future design."
 *
 * Git #1346 finished that correction: the 24 catalogue entries (DOC-10..33)
 * described documents the platform intends to sell, not offerings a customer
 * can browse today, and showing them as a disclosed "X of Y documents"
 * catalogue read as browsable inventory rather than what it was — Shane's own
 * words, "hide, don't disclose" (the same precedent as #1341's Directory Sync
 * panel). The Document Library now renders only the NINE OWNED documents
 * (DOC-01..09): the Copilot Readiness Assessment's own output, plus the Gate
 * Clearance plan and its Statement of Work — the only deliverables that exist
 * as a product today. `DOC_CATALOG` and `DOC_LIB_TOTAL` stay in
 * `docLibraryData.ts` as the design-forward fixture they always were; this
 * model just no longer merges them into what the customer sees.
 */

import {
  DOC_LIB,
  DOC_OWNED_META,
  type DocFact,
  type DocLibEntry,
  type DocSection,
} from "./docLibraryData";

export type DocSortKey = "num" | "library" | "pillar" | "type";

/** One row — every row is owned, per #1346's removal of the catalogue. */
export interface DocRow {
  key: string;
  num: string;
  title: string;
  type: string;
  pillar: string;
  audience: string;
  offering: string;
  owned: boolean;
  fresh?: string;
  freshNote?: string;
  issued?: string;
  kicker?: string;
  headline?: string;
  standfirst?: string;
  facts?: DocFact[];
  sections?: DocSection[];
  links?: { label: string; to: string }[];
}

/**
 * `ownedDocs` (11771-11776). OWNED_META is zipped onto DOC_LIB positionally,
 * and the issue date is a per-id special case: id 8 is the signed contract, so
 * it reads "Signed" rather than "Issued".
 */
const OWNED: DocRow[] = DOC_LIB.map((d: DocLibEntry, i) => {
  const meta = DOC_OWNED_META[i] ?? DOC_OWNED_META[0];
  return {
    ...meta,
    key: `own-${d.id}`,
    num: d.num,
    title: d.title,
    kicker: d.kicker,
    headline: d.headline,
    standfirst: d.standfirst,
    facts: d.facts,
    sections: d.sections,
    links: d.links,
    owned: true,
    issued: d.id === 8 ? "Signed 6 Aug 2026" : "Issued 3 Aug 2026",
  };
});

/** Git #1346 — the library renders only what the customer owns; the
 *  catalogue is no longer merged in for browsing. */
export const ALL_DOCS: readonly DocRow[] = OWNED;
export const DOC_OWNED_COUNT = OWNED.length;

/** `facetDefs` (11784-11790), minus the Availability group — Git #1346
 *  removed it along with the catalogue rows it distinguished from. */
export const DOC_FACET_DEFS: readonly {
  key: string;
  label: string;
  values: string[];
  get: (d: DocRow) => string;
}[] = [
  {
    key: "pillar",
    label: "Pillar",
    values: ["Cross-pillar", "Governance", "Security", "Compliance", "Licensing", "Adoption", "Health"],
    get: (d) => d.pillar,
  },
  {
    key: "type",
    label: "Document type",
    values: ["Report", "Remediation plan", "Configuration guide", "Policy", "SOP & runbook", "Contract"],
    get: (d) => d.type,
  },
  { key: "audience", label: "Written for", values: ["Board", "IT", "Auditor"], get: (d) => d.audience },
  {
    key: "offering",
    label: "Offering",
    values: [
      "Copilot Readiness Assessment",
      "Copilot Gate Clearance",
      "Security Hardening",
      "Governance Baseline",
      "Compliance Foundations",
      "Adoption & Enablement",
      "Operate & Monitor",
    ],
    get: (d) => d.offering,
  },
];

export type DocFacetState = Record<string, string[]>;

/**
 * `docPasses` (11792-11803). `skipKey` omits one group from the test — see the
 * header note; it is what makes the counts behave.
 */
export function docPasses(
  d: DocRow,
  query: string,
  facets: DocFacetState,
  skipKey?: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q) {
    const haystack = `${d.title} ${d.type} ${d.pillar} ${d.offering} ${d.num}`.toLowerCase();
    if (haystack.indexOf(q) < 0) return false;
  }
  for (const g of DOC_FACET_DEFS) {
    if (g.key === skipKey) continue;
    const sel = facets[g.key] ?? [];
    if (sel.length && sel.indexOf(g.get(d)) < 0) return false;
  }
  return true;
}

/** `docFacetActive` (11791). */
export function docFacetActive(query: string, facets: DocFacetState): boolean {
  return DOC_FACET_DEFS.some((g) => (facets[g.key] ?? []).length > 0) || query.trim().length > 0;
}

/** Per-option counts, each computed with its own group skipped (11811-11831). */
export function docFacetGroups(query: string, facets: DocFacetState) {
  return DOC_FACET_DEFS.map((g) => ({
    key: g.key,
    label: g.label,
    items: g.values.map((v) => ({
      value: v,
      count: ALL_DOCS.filter((d) => g.get(d) === v && docPasses(d, query, facets, g.key)).length,
      on: (facets[g.key] ?? []).indexOf(v) >= 0,
    })),
  }));
}

/** `typeOrder` / `pillarOrder` (11832-11833) — the sorts' tie-break order. */
const TYPE_ORDER = ["Report", "Remediation plan", "Configuration guide", "Policy", "SOP & runbook", "Contract"];
const PILLAR_ORDER = ["Cross-pillar", "Governance", "Security", "Compliance", "Licensing", "Adoption", "Health"];

/** `docShown` (11834-11839). Every sort tie-breaks on the document number. */
export function docShown(query: string, facets: DocFacetState, sort: DocSortKey): DocRow[] {
  return ALL_DOCS.filter((d) => docPasses(d, query, facets))
    .slice()
    .sort((a, b) => {
      if (sort === "pillar") {
        return (
          PILLAR_ORDER.indexOf(a.pillar) - PILLAR_ORDER.indexOf(b.pillar) || a.num.localeCompare(b.num)
        );
      }
      if (sort === "type") {
        return TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.num.localeCompare(b.num);
      }
      if (sort === "library") {
        return (a.owned === b.owned ? 0 : a.owned ? -1 : 1) || a.num.localeCompare(b.num);
      }
      return a.num.localeCompare(b.num);
    });
}

/** `docSortOptions` (11919-11922). */
export const DOC_SORT_OPTIONS: readonly { key: DocSortKey; label: string }[] = [
  { key: "num", label: "Number" },
  { key: "library", label: "Your library first" },
  { key: "pillar", label: "Pillar" },
  { key: "type", label: "Type" },
];

/** The row's state column (11838-11840) — owned documents only, per #1346. */
export function docStateFor(d: DocRow): { label: string; tone: string } {
  if (d.fresh === "stale") return { label: "Regenerate", tone: "#fbbf24" };
  if (d.fresh === "signed") return { label: "Signed", tone: "#94a3b8" };
  return { label: "Current", tone: "#4ade80" };
}

/** `metaLine` (11846) — note the DOUBLE spaces around each separator. */
export function docMetaLine(d: DocRow): string {
  return `${d.type}  ·  ${d.pillar}  ·  for ${d.audience}  ·  ${d.offering}`;
}

/* ── The header's derived strings (17781-17796) ───────────────────────────── */

export function docResultLabel(shownCount: number): string {
  return shownCount === ALL_DOCS.length
    ? `All ${ALL_DOCS.length} documents`
    : `${shownCount} of ${ALL_DOCS.length} documents`;
}

export function docFilterApplyLabel(shownCount: number): string {
  return `Show ${shownCount} ${shownCount === 1 ? "document" : "documents"}`;
}
