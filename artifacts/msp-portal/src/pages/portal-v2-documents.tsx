/**
 * portal-v2-documents.tsx — the Document Library.
 *
 * A direct port of the prototype's `isDocuments` block
 * (`Customer Portal Shell.dc.html` lines 5470-5679), its filter drawer
 * (5681-5744) and its logic (11487-11930).
 *
 * ── This is a SYSTEM, not a page ───────────────────────────────────────────
 * The handoff lists it as the fourth of five systems, and its rules are
 * behavioural rather than visual:
 *
 *  • ROWS EXPAND IN PLACE. Opening a document does not navigate; the row grows
 *    into the full document beneath its own header, and only one is open at a
 *    time (`docOpenKey`). The library's scroll position, filters and sort all
 *    survive reading a document, which navigating away would destroy.
 *  • FILTERS LIVE IN A RIGHT SLIDE-OUT so the list reads full width. The sticky
 *    bar keeps only a `Filters · n` button and removable chips.
 *  • FACET COUNTS EXCLUDE THEIR OWN GROUP, so after ticking "Security" the
 *    Pillar list still shows what each other pillar would return. See
 *    `docPasses(d, skipKey)` — this is the difference between a faceted search
 *    and a list that can only narrow.
 *  • OWNED AND UNOWNED EXPAND DIFFERENTLY. Owned shows the document: headline,
 *    standfirst, fact cards, sections, where it lives in the portal, and an
 *    amber out-of-date band when telemetry has moved. Unowned shows what it
 *    contains, its provenance, and a price block. Same row, two documents.
 *
 * ── Where the data came from ───────────────────────────────────────────────
 * `docLibraryData.ts` was EXTRACTED mechanically from the prototype rather than
 * retyped — 33 documents of dense final copy is past the point where hand
 * transcription is the safer option. See that file's header.
 *
 * ── The sticky header, and why it is sticky HERE ───────────────────────────
 * `PortalV2Shell`'s own page header is deliberately NOT sticky — the prototype
 * makes it `position:relative` and lets `<main>` scroll beneath it, and that
 * file's header explains why copying the README's "Sticky" prose there would
 * have been wrong. This page is the opposite case: the prototype really does
 * make the Document Library's own bar `position:sticky; top:0; z-index:6`
 * (proto 5474), because the sort buttons and the active filter chips have to
 * stay reachable while 33 rows scroll past them. Same scroll container, two
 * different answers, both taken from the markup rather than from the prose.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

import { useAuth } from "@/lib/auth-context";
import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { DOC_PILLAR_COLOUR } from "@/components/portal-v2/docLibraryData";
import { DocumentBody } from "@/components/copilot-journey/DocumentBody";
import { useCopilotJourney } from "@/components/copilot-journey/useCopilotJourney.ts";
import { withLiveDocuments, type JourneyDocumentView, type JourneyView } from "@/components/copilot-journey/journeyModel.ts";
import "@/components/copilot-journey/copilot-journey.css";
import {
  ALL_DOCS,
  DOC_FACET_DEFS,
  DOC_OWNED_COUNT,
  DOC_SORT_OPTIONS,
  docFacetActive,
  docFacetGroups,
  docFilterApplyLabel,
  docMetaLine,
  docResultLabel,
  docShown,
  docStateFor,
  type DocFacetState,
  type DocRow,
  type DocSortKey,
} from "@/components/portal-v2/docLibraryModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

const EYEBROW: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "#64748b",
};

const SECTION_EYEBROW: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".16em",
  textTransform: "uppercase",
  color: "#64748b",
};

export default function PortalV2DocumentsPage() {
  const { openForm, formElement } = useFormDrawer();
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DocSortKey>("num");
  const [facets, setFacets] = useState<DocFacetState>({});
  const [filterOpen, setFilterOpen] = useState(false);
  // `docOpenKey` defaults to 'own-0' (11783): the library opens with the
  // Copilot readiness report already expanded, rather than a wall of rows.
  const [openKey, setOpenKey] = useState<string | null>("own-0");

  /* ---------------------------------------------------------------- *
   * DOC-01..09 body content — ported from `DocumentBody.tsx`'s LIVE_BODY
   * registry (Git #1238). The tenant name comes from the same
   * `GET /api/portal/dashboard` field every other portal-v2 page reads.
   * ---------------------------------------------------------------- */
  const [customerName, setCustomerName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchWithAuth("/api/portal/dashboard", undefined, { silent: true })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { customerName?: string | null } | null) => {
        if (!cancelled && body?.customerName) setCustomerName(body.customerName);
      })
      .catch(() => {
        /* Heading degrades to "Your tenant" — useCopilotJourney reports the
           payload failures that actually matter. */
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  const [reduceMotion] = useState(
    () =>
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const live = useCopilotJourney({ tenantName: customerName });
  const generation = useMemo(() => withLiveDocuments(live.view.generation), [live.view.generation]);

  /** Opens (or re-opens) the Statement of Work row — the same handoff
   *  `RemediationGuideBody`'s "Ready to fix this?" makes on the old page. */
  const openSow = () => setOpenKey("own-8");

  /** Signing hands the agreed scope to the real checkout screen — there is no
   *  Document Library equivalent, so this reuses the journey's own route. */
  const onSowSigned = (queryString: string) => navigate(`/copilot-readiness/checkout?${queryString}`);

  const shown = docShown(query, facets, sort);
  const active = docFacetActive(query, facets);
  const groups = docFacetGroups(query, facets);

  const toggleFacet = (groupKey: string, value: string) =>
    setFacets((f) => {
      const list = (f[groupKey] ?? []).slice();
      const i = list.indexOf(value);
      if (i >= 0) list.splice(i, 1);
      else list.push(value);
      return { ...f, [groupKey]: list };
    });

  const clearAll = () => {
    setFacets({});
    setQuery("");
  };

  const askShaneBot = (topic: string) =>
    openForm({
      kicker: "Ask ShaneBot",
      title: "Ask about this document",
      intro: topic,
      submitLabel: "Send to ShaneBot",
      fields: [
        {
          id: "question",
          label: "Your question",
          kind: "textarea",
          wide: true,
          placeholder: "What would you like to know about this?",
        },
      ],
      doneTitle: "Sent",
      doneNote:
        "ShaneBot has the document and your tenant context. The reply appears in your chat panel.",
    });

  /** `docExportAll` (17810-17820). */
  const exportAll = () =>
    openForm({
      kicker: "Document library",
      title: "Export your library as PDF",
      intro: `Your ${DOC_OWNED_COUNT} documents, in order, with a cover page stating the scan date and the tenant they describe.`,
      submitLabel: "Build the PDF",
      fields: [
        {
          id: "scope",
          label: "What to include",
          kind: "select",
          options: [
            { value: "all", label: "Everything in my library" },
            { value: "reports", label: "Assessment reports only" },
            { value: "plans", label: "Plans, runbooks and contracts only" },
          ],
          value: "all",
        },
        {
          id: "evidence",
          label: "Attach evidence packs",
          kind: "select",
          options: [
            { value: "no", label: "No — document bodies only" },
            { value: "yes", label: "Yes — append evidence per finding" },
          ],
          value: "no",
        },
      ],
      doneNote: "Building. The pack lands in your library and is emailed to you when it is ready.",
    });

  /** `row.regenGo` (11875-11888). */
  const regenerate = (d: DocRow) =>
    openForm({
      kicker: `${d.num} · ${d.title}`,
      title: "Regenerate this document",
      intro:
        "The document is rebuilt from the telemetry in your tenant right now. The previous issue stays in your library so the two can be compared.",
      submitLabel: "Regenerate",
      fields: [
        {
          id: "scan",
          label: "Telemetry to use",
          kind: "select",
          options: [
            { value: "latest", label: "Latest hourly scan" },
            { value: "fresh", label: "Run a fresh scan first — adds about 20 minutes" },
          ],
          value: "latest",
        },
        {
          id: "diff",
          label: "Include a change summary",
          kind: "select",
          options: [
            { value: "yes", label: "Yes — list what moved since 3 Aug" },
            { value: "no", label: "No — issue the document only" },
          ],
          value: "yes",
        },
      ],
      doneNote:
        "Queued. The new issue appears in your library and the previous one is kept alongside it.",
    });

  /** `row.shareGo` (11889-11901). */
  const shareExport = (d: DocRow) =>
    openForm({
      kicker: `${d.num} · ${d.title}`,
      title: "Share & export this document",
      intro:
        "Exports carry the issue date and the scan they were built from, so a shared copy can always be traced back to the telemetry behind it.",
      submitLabel: "Send",
      fields: [
        {
          id: "format",
          label: "Format",
          kind: "select",
          options: [
            { value: "full", label: "PDF — full document" },
            { value: "exec", label: "PDF — executive summary only" },
            { value: "link", label: "Link to the live document" },
          ],
          value: "full",
        },
        { id: "to", label: "Send to", placeholder: "name@tenant.com, one per line", wide: true },
        {
          id: "note",
          label: "Note to include",
          kind: "textarea",
          wide: true,
          required: false,
          placeholder: "Optional — appears above the document for the recipient.",
        },
      ],
      doneNote:
        "Sent. The export is recorded against this document so you can see who has a copy.",
    });

  return (
    <PortalV2Shell eyebrow="Library" title="Documents">
      <div style={{ display: "flex", alignItems: "stretch", minHeight: "100%", boxSizing: "border-box" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* ── Sticky bar — proto 5474-5496 ───────────────────────────── */}
          <div
            style={{
              flex: "0 0 auto",
              position: "sticky",
              top: 0,
              zIndex: 6,
              display: "flex",
              flexDirection: "column",
              gap: 9,
              padding: "14px 26px 12px",
              borderBottom: "1px solid rgba(30,41,59,.9)",
              background: "rgba(8,17,32,.94)",
              backdropFilter: "blur(8px)",
            }}
            data-testid="pv2-doc-bar"
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={EYEBROW}>Document library</span>
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0" }}>
                  {docResultLabel(shown.length)}
                  {active && (
                    <span style={{ fontWeight: 500, color: "#64748b" }}> · filtered</span>
                  )}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  marginLeft: "auto",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 700,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "#475569",
                  }}
                >
                  Sort
                </span>
                {DOC_SORT_OPTIONS.map((o) => {
                  const on = sort === o.key;
                  return (
                    <button
                      key={o.key}
                      onClick={() => setSort(o.key)}
                      data-testid={`pv2-doc-sort-${o.key}`}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 5,
                        fontSize: "10.5px",
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        border: `1px solid ${on ? "rgba(59,130,246,.45)" : "rgba(30,41,59,.9)"}`,
                        background: on ? "rgba(59,130,246,.12)" : "transparent",
                        color: on ? "#93c5fd" : "#94a3b8",
                      }}
                    >
                      {o.label}
                    </button>
                  );
                })}
                <button
                  onClick={() => setFilterOpen(true)}
                  data-testid="pv2-doc-filter-open"
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    border: `1px solid ${chipCount(query, facets) ? "rgba(0,120,212,.55)" : "rgba(148,163,184,.22)"}`,
                    background: chipCount(query, facets) ? "rgba(0,120,212,.18)" : "transparent",
                    color: chipCount(query, facets) ? "#dbeafe" : "#94a3b8",
                  }}
                >
                  {chipCount(query, facets) ? `Filters · ${chipCount(query, facets)}` : "Filters"}
                </button>
              </div>
            </div>

            {chipCount(query, facets) > 0 && (
              <div
                style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
                data-testid="pv2-doc-chips"
              >
                {query.trim() && (
                  <button onClick={() => setQuery("")} data-testid="pv2-doc-chip-query" style={CHIP}>
                    &quot;{query.trim()}&quot; ×
                  </button>
                )}
                {DOC_FACET_DEFS.flatMap((g) =>
                  (facets[g.key] ?? []).map((v) => (
                    <button
                      key={`${g.key}:${v}`}
                      onClick={() => toggleFacet(g.key, v)}
                      data-testid={`pv2-doc-chip-${g.key}-${slug(v)}`}
                      style={CHIP}
                    >
                      {v} ×
                    </button>
                  )),
                )}
                <button
                  onClick={clearAll}
                  style={{
                    background: "none",
                    border: "none",
                    padding: "0 4px",
                    fontSize: "10.5px",
                    color: "#64748b",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textDecoration: "underline",
                  }}
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          {/* ── Rows — proto 5507-5634 ─────────────────────────────────── */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }} data-testid="pv2-doc-rows">
            {shown.map((d) => (
              <DocumentRow
                key={d.key}
                d={d}
                open={openKey === d.key}
                onToggle={() => setOpenKey(openKey === d.key ? null : d.key)}
                onRegenerate={() => regenerate(d)}
                onShare={() => shareExport(d)}
                onAsk={askShaneBot}
                view={live.view}
                generation={generation}
                loaded={live.statusLoaded}
                error={live.error}
                reduceMotion={reduceMotion}
                onRetry={live.refresh}
                onOpenSow={openSow}
                onSowSigned={onSowSigned}
              />
            ))}

            <div
              style={{
                padding: "22px 26px 60px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <button
                onClick={exportAll}
                data-testid="pv2-doc-export-all"
                style={{
                  padding: "8px 13px",
                  borderRadius: 7,
                  border: "1px solid rgba(148,163,184,.22)",
                  background: "transparent",
                  color: "#94a3b8",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Export your library as PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Filter drawer — proto 5681-5744 ──────────────────────────────── */}
      {filterOpen && (
        <>
          <div
            onClick={() => setFilterOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 124,
              background: "rgba(2,6,23,.55)",
              backdropFilter: "blur(2px)",
            }}
          />
          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              zIndex: 125,
              width: "min(340px,92vw)",
              display: "flex",
              flexDirection: "column",
              borderLeft: "1px solid rgba(0,120,212,.35)",
              background: "#0b1524",
              boxShadow: "-24px 0 60px rgba(2,6,23,.6)",
            }}
            data-testid="pv2-doc-filter-drawer"
          >
            <div
              style={{
                flex: "0 0 auto",
                padding: "16px 20px",
                borderBottom: "1px solid rgba(30,41,59,.9)",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".16em",
                    textTransform: "uppercase",
                    color: "#60a5fa",
                  }}
                >
                  Filter the library
                </span>
                <span
                  style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.5, textWrap: "pretty" }}
                >
                  {DOC_OWNED_COUNT} {DOC_OWNED_COUNT === 1 ? "document" : "documents"} in your
                  library.
                </span>
              </div>
              <button
                onClick={() => setFilterOpen(false)}
                aria-label="Close"
                style={{
                  flex: "0 0 auto",
                  width: 26,
                  height: 26,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 6,
                  border: "1px solid rgba(148,163,184,.22)",
                  background: "transparent",
                  color: "#94a3b8",
                  fontSize: "14px",
                  lineHeight: 1,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{ flex: "0 0 auto", padding: "13px 20px", borderBottom: "1px solid rgba(30,41,59,.9)" }}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${ALL_DOCS.length} documents…`}
                aria-label="Search documents"
                data-testid="pv2-doc-search"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "#0b1a2e",
                  border: "1px solid rgba(30,41,59,.95)",
                  borderRadius: 6,
                  padding: "8px 11px",
                  color: "#e2e8f0",
                  fontSize: "12px",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {groups.map((g) => (
                <div
                  key={g.key}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    padding: "13px 0 12px",
                    borderBottom: "1px solid rgba(30,41,59,.7)",
                  }}
                >
                  <span
                    style={{
                      padding: "0 20px 7px",
                      fontSize: "9px",
                      fontWeight: 700,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: "#475569",
                    }}
                  >
                    {g.label}
                  </span>
                  {g.items.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => toggleFacet(g.key, f.value)}
                      data-testid={`pv2-doc-facet-${g.key}-${slug(f.value)}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 20px",
                        border: "none",
                        background: f.on ? "rgba(0,120,212,.12)" : "transparent",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        // A zero-count option dims rather than disappearing, so
                        // the group's shape stays stable as filters change.
                        opacity: f.count === 0 && !f.on ? 0.45 : 1,
                      }}
                    >
                      <span
                        style={{
                          flex: "0 0 12px",
                          width: 12,
                          height: 12,
                          borderRadius: 3,
                          border: `1px solid ${f.on ? "#60a5fa" : "rgba(148,163,184,.32)"}`,
                          background: f.on ? "#60a5fa" : "transparent",
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: "11.5px",
                          fontWeight: f.on ? 700 : 500,
                          color: f.on ? "#e2e8f0" : "#94a3b8",
                          lineHeight: 1.4,
                        }}
                      >
                        {f.value}
                      </span>
                      {/* Its own test id: asserting the count through the whole
                          option row would be a substring match, and "4" is a
                          substring of "24". */}
                      <span
                        data-testid={`pv2-doc-count-${g.key}-${slug(f.value)}`}
                        style={{ fontSize: "10px", color: "#475569", fontFamily: MONO }}
                      >
                        {f.count}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>

            <div
              style={{
                flex: "0 0 auto",
                padding: "14px 20px 18px",
                borderTop: "1px solid rgba(30,41,59,.9)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <button
                onClick={() => setFilterOpen(false)}
                data-testid="pv2-doc-filter-apply"
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: "1px solid rgba(0,120,212,.5)",
                  background: "rgba(0,120,212,.18)",
                  color: "#dbeafe",
                  fontSize: "11.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {docFilterApplyLabel(shown.length)}
              </button>
              <button
                onClick={clearAll}
                style={{
                  padding: "8px 12px",
                  borderRadius: 7,
                  border: `1px solid ${active ? "rgba(96,165,250,.35)" : "rgba(148,163,184,.16)"}`,
                  background: "transparent",
                  color: active ? "#93c5fd" : "#475569",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </>
      )}

      {formElement}
    </PortalV2Shell>
  );
}

const CHIP: React.CSSProperties = {
  padding: "4px 9px",
  borderRadius: 5,
  border: "1px solid rgba(96,165,250,.35)",
  background: "rgba(96,165,250,.1)",
  color: "#bfdbfe",
  fontSize: "10.5px",
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

/**
 * Facet values are prose ("SOP & runbook", "Copilot Readiness Assessment"), so
 * a test id is derived rather than interpolated raw — a `&` or a space in an
 * attribute selector is what makes a manifest step silently match nothing.
 */
const slug = (v: string) => v.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");

/** `docFilterCount` (11918) — the search term counts as a chip. */
function chipCount(query: string, facets: DocFacetState): number {
  return (
    (query.trim() ? 1 : 0) +
    DOC_FACET_DEFS.reduce((n, g) => n + (facets[g.key] ?? []).length, 0)
  );
}

/** The generated cover spine and the 200×272 cover both key off the pillar. */
function coverColour(d: DocRow): string {
  return DOC_PILLAR_COLOUR[d.pillar] ?? "#60a5fa";
}

function DocumentRow({
  d,
  open,
  onToggle,
  onRegenerate,
  onShare,
  onAsk,
  view,
  generation,
  loaded,
  error,
  reduceMotion,
  onRetry,
  onOpenSow,
  onSowSigned,
}: {
  d: DocRow;
  open: boolean;
  onToggle: () => void;
  onRegenerate: () => void;
  onShare: () => void;
  onAsk: (topic: string) => void;
  view: JourneyView;
  generation: ReturnType<typeof withLiveDocuments>;
  loaded: boolean;
  error: string | null;
  reduceMotion: boolean;
  onRetry: () => void;
  onOpenSow: () => void;
  onSowSigned: (queryString: string) => void;
}) {
  const c = coverColour(d);
  const state = docStateFor(d);
  const stale = d.fresh === "stale";
  // DOC-01..09 only — the nine real deliverables this library owns (Git #1238).
  // Matched by title against the same document set the Copilot Readiness
  // journey resolves, since `docLibraryData.ts`'s DOC-01..09 titles are
  // transcribed verbatim from the journey's own document spine.
  const liveDoc: JourneyDocumentView | null =
    (d.owned && generation.documents.find((doc) => doc.title === d.title)) || null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderBottom: "1px solid rgba(30,41,59,.8)",
        background: open ? "rgba(15,23,42,.6)" : "transparent",
      }}
    >
      <div
        onClick={onToggle}
        data-testid={`pv2-doc-row-${d.num}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 13,
          padding: "11px 26px 11px 20px",
          cursor: "pointer",
          minWidth: 0,
        }}
      >
        <span
          style={{
            flex: "0 0 12px",
            width: 12,
            textAlign: "center",
            fontSize: open ? "15px" : "13px",
            color: open ? "#94a3b8" : "#475569",
            lineHeight: 1,
          }}
        >
          {open ? "⌄" : "›"}
        </span>
        {/* The generated cover spine — 26×36, accent gradient, doc number. */}
        <span
          style={{
            flex: "0 0 26px",
            width: 26,
            height: 36,
            borderRadius: 3,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            paddingBottom: 3,
            boxSizing: "border-box",
            border: `1px solid ${c}${d.owned ? "55" : "2e"}`,
            background: `linear-gradient(165deg,${c}${d.owned ? "30" : "16"},rgba(8,17,32,.92) 72%)`,
            boxShadow: `inset 2px 0 0 ${c}${d.owned ? "cc" : "55"}`,
          }}
        >
          <span
            style={{
              fontSize: "8px",
              fontWeight: 700,
              color: d.owned ? "#cbd5e1" : "#64748b",
              fontFamily: MONO,
            }}
          >
            {d.num.split("-")[1]}
          </span>
        </span>
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            minWidth: 180,
            flex: "1 1 auto",
          }}
        >
          <span
            style={{
              fontSize: "12.5px",
              fontWeight: open ? 700 : 600,
              color: d.owned ? (open ? "#f8fafc" : "#e2e8f0") : "#94a3b8",
              lineHeight: 1.4,
              textWrap: "pretty",
            }}
          >
            {d.title}
          </span>
          <span
            style={{
              fontSize: "10.5px",
              color: "#64748b",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {docMetaLine(d)}
          </span>
        </span>
        {/* The state column shrinks with an ellipsis — the title floors at 180. */}
        <span
          style={{
            flex: "0 1 auto",
            minWidth: 0,
            maxWidth: 150,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: "10.5px",
            fontWeight: 700,
            color: state.tone,
            textAlign: "right",
            lineHeight: 1.4,
          }}
        >
          {state.label}
        </span>
      </div>

      {open && (
        <div
          style={{
            display: "flex",
            gap: 24,
            alignItems: "flex-start",
            padding: "4px 26px 32px 46px",
            flexWrap: "wrap",
          }}
          data-testid={`pv2-doc-open-${d.num}`}
        >
          <Cover d={d} c={c} subtitle={d.issued ?? ""} titleColour="#f8fafc" />
          <div
            style={{
              flex: 1,
              minWidth: 280,
              display: "flex",
              flexDirection: "column",
              gap: 17,
              maxWidth: 800,
            }}
          >
            {/* The report body itself — DOC-01..09's real content, ported
                from `DocumentBody.tsx`'s LIVE_BODY registry (Git #1238)
                rather than the fixture's headline/standfirst/facts/sections
                above. `liveDoc` is always resolved for an owned row: every
                DOC_LIB title matches one of `JOURNEY_LIVE_DOCUMENTS`, the
                Remediation Guide or the SOW. */}
            <div className="cj-dark" data-testid={`pv2-doc-body-${d.num}`}>
              <DocumentBody
                doc={liveDoc}
                generation={generation}
                tenant={view.tenant}
                view={view}
                loaded={loaded}
                isPreview={false}
                reduceMotion={reduceMotion}
                error={error}
                onRetry={onRetry}
                onOpenSow={onOpenSow}
                onSigned={onSowSigned}
              />
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 9,
                padding: "15px 17px",
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 12,
                background: "rgba(15,23,42,.45)",
              }}
            >
              <span style={SECTION_EYEBROW}>Where this document lives in the portal</span>
              <span
                style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.6, maxWidth: "74ch" }}
              >
                The document is the record of what we found. The pages below are where it gets
                fixed, and they are the same telemetry this document regenerates from.
              </span>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", paddingTop: 2 }}>
                {(d.links ?? []).map((l) => (
                  <Link
                    key={l.to}
                    href={portalHrefFor(l.to)}
                    data-testid={`pv2-doc-link-${l.to}`}
                    style={{
                      padding: "7px 12px",
                      borderRadius: 7,
                      border: "1px solid rgba(96,165,250,.35)",
                      background: "rgba(96,165,250,.08)",
                      color: "#bfdbfe",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textDecoration: "none",
                    }}
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>

            {stale && (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 9,
                  padding: "10px 13px",
                  border: "1px solid rgba(251,191,36,.35)",
                  borderRadius: 9,
                  background: "rgba(251,191,36,.07)",
                }}
                data-testid={`pv2-doc-stale-${d.num}`}
              >
                <span
                  style={{
                    flex: "0 0 auto",
                    fontSize: "9px",
                    fontWeight: 700,
                    letterSpacing: ".13em",
                    textTransform: "uppercase",
                    color: "#fbbf24",
                    paddingTop: 2,
                  }}
                >
                  Out of date
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: "12px",
                    color: "#fde68a",
                    lineHeight: 1.55,
                    textWrap: "pretty",
                  }}
                >
                  {d.freshNote} — this issue no longer matches what the tenant looks like now.
                </span>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={onRegenerate}
                data-testid={`pv2-doc-regen-${d.num}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "8px 14px",
                  borderRadius: 7,
                  border: `1px solid ${stale ? "rgba(251,191,36,.5)" : "rgba(0,120,212,.5)"}`,
                  background: stale ? "rgba(251,191,36,.14)" : "rgba(0,120,212,.16)",
                  color: stale ? "#fde68a" : "#bfdbfe",
                  fontSize: "11.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Regenerate from current telemetry
              </button>
              <button
                onClick={onShare}
                style={{
                  padding: "8px 13px",
                  borderRadius: 7,
                  border: "1px solid rgba(148,163,184,.22)",
                  background: "transparent",
                  color: "#94a3b8",
                  fontSize: "11.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Share &amp; export
              </button>
              <button
                onClick={() =>
                  onAsk(
                    `Explain this document in plain terms and tell me what it wants me to do: "${d.title}"`,
                  )
                }
                style={ASK_BTN}
              >
                Ask ShaneBot about this document
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

const ASK_BTN: React.CSSProperties = {
  padding: "8px 13px",
  borderRadius: 7,
  border: "1px solid rgba(0,180,216,.4)",
  background: "rgba(0,180,216,.08)",
  color: "#22d3ee",
  fontSize: "11.5px",
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

/** The 200×272 generated cover — accent field, number, title, pillar, date. */
function Cover({
  d,
  c,
  subtitle,
  titleColour,
}: {
  d: DocRow;
  c: string;
  subtitle: string;
  titleColour: string;
}) {
  return (
    <div
      style={{
        flex: "0 0 200px",
        width: 200,
        height: 272,
        borderRadius: 10,
        border: `1px solid ${c}40`,
        background: "#0a1524",
        padding: "18px 16px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 120,
          background: `linear-gradient(150deg,${c}38,${c}0a 60%,transparent)`,
          borderBottom: `1px solid ${c}22`,
        }}
      />
      <span style={{ position: "relative", display: "flex", flexDirection: "column", gap: 7 }}>
        <span
          style={{
            fontSize: "9.5px",
            fontWeight: 700,
            letterSpacing: ".18em",
            color: c,
            fontFamily: MONO,
          }}
        >
          {d.num}
        </span>
        <span
          style={{
            fontSize: "13.5px",
            fontWeight: 800,
            color: titleColour,
            lineHeight: 1.32,
            letterSpacing: "-.01em",
            textWrap: "pretty",
          }}
        >
          {d.title}
        </span>
      </span>
      <span
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 5,
          marginTop: "auto",
        }}
      >
        <span
          style={{
            alignSelf: "flex-start",
            padding: "3px 8px",
            borderRadius: 5,
            border: `1px solid ${c}45`,
            background: `${c}12`,
            color: c,
            fontSize: "8.5px",
            fontWeight: 700,
            letterSpacing: ".1em",
            textTransform: "uppercase",
          }}
        >
          {d.pillar}
        </span>
        <span style={{ fontSize: "9px", color: "#64748b", fontFamily: MONO }}>{subtitle}</span>
      </span>
    </div>
  );
}

/**
 * The prototype's "where this lives in the portal" links carry a bare shell key
 * (`to: 'governance'`), because the shell is one page switching on `active`.
 * This build has real routes, so each key maps to a path.
 *
 * The nine owned documents between them reference twenty distinct keys — every
 * pillar, several Layer 3 drill-downs, and four Layer 2 operational pages. Ten
 * of those have a real page today; the rest are listed BELOW, resolved to the
 * nearest built page rather than left to a generic fallback, so that as Layers 2
 * and 3 land the pending list shrinks visibly instead of silently continuing to
 * work while pointing at the wrong page. Grep `LINK_ROUTES_PENDING` to find the
 * ones still owed a destination.
 */
const LINK_ROUTES: Record<string, string> = {
  home: "/portal-v2",
  overview: "/portal-v2",
  governance: "/portal-v2/governance",
  security: "/portal-v2/security",
  compliance: "/portal-v2/compliance",
  licensing: "/portal-v2/licensing",
  adoption: "/portal-v2/adoption",
  health: "/portal-v2/health",
  "governance-oversharing-full": "/portal-v2/governance/oversharing/all",
  "governance-oversharing": "/portal-v2/governance/oversharing",
  "governance-drift": "/portal-v2/governance/sharing-drift",
  "change-control": "/portal-v2/change-control",
  "operate-runbooks": "/portal-v2/runbooks",
  "risk-register": "/portal-v2/risk-register",
};

/** Key -> the page it should land on once that page exists. */
const LINK_ROUTES_PENDING: Record<string, string> = {
  // Layer 3 — pillar drill-downs. Each resolves to its own pillar meanwhile,
  // which is the page that page will hang off.
  "security-mfa": "/portal-v2/security",
  "security-ca": "/portal-v2/security",
  "compliance-sensitivity-labels": "/portal-v2/compliance",
  "compliance-autolabel": "/portal-v2/compliance",
  billing: "/portal-v2/licensing",
  projects: "/portal-v2/adoption",
  // Layer 2 — operational pages not yet built by any session.
  "ms-changes": "/portal-v2",
  "sop-hub": "/portal-v2",
};

function portalHrefFor(to: string): string {
  return LINK_ROUTES[to] ?? LINK_ROUTES_PENDING[to] ?? "/portal-v2";
}
