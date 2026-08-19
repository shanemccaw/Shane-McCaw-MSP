/**
 * portal-v2-gov-oversharing-all.tsx — `governance-oversharing-full`.
 *
 * A direct port of the prototype's `isGovOversharingFull` template
 * (`Customer Portal Shell.dc.html` lines 4627-4669) with the data from 16821-16836.
 *
 * ── What this page is, and why it is not the drill-down template ────────────
 * This is the enterprise-scale variant of the Overshared SharePoint finding. In
 * the prototype it is reached from ONE place: the governance finding row, and
 * only when the tenant is large — `kind: 'viewDetails'`, label
 * "View all 23,412 sites →", `navTo: 'governance-oversharing-full'` (11380). At
 * small-tenant scale that same row is a "Fix this now — $210" button and this
 * page is unreachable.
 *
 * Its own subtitle says what it is for: "At this scale, this needs search,
 * filtering, and bulk remediation — not a list you scroll through." So it has no
 * provenance block, no stat cards, no expandable evidence, no policy block and
 * no wrench playbooks — it is a search box, a select-and-bulk-fix list, an
 * export and a pager. The drill-down template the handoff README describes lives
 * in `isGovDetailV2` (built as `portal-v2-gov-detail.tsx`); the Overshared
 * SharePoint drill-down proper is `portal-v2-gov-oversharing.tsx`.
 *
 * ── Rows are synthesised per page, deliberately ────────────────────────────
 * `govOverRows` builds twelve rows from a `seed` derived from the current page
 * number rather than slicing a 23,412-item array. That is the prototype stating
 * that this page is a server-side query — the row set for page N comes from the
 * page number, not from anything held in the client.
 *
 * ── One formatting decision ────────────────────────────────────────────────
 * `govOverTotal` is the number `23412`, and the template interpolates it raw, so
 * the prototype renders "23412 sites are shared externally…". The same figure is
 * written "23,412" in the prototype's own finding-row copy for this page (11380)
 * and in its button label, so the separator is the intent and the raw render is
 * a missing `toLocaleString`. The grouped form is used here.
 */

import { useState } from "react";
import { Link } from "wouter";

import { Search } from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import {
  GOV_OVER_PAGE_SIZE,
  GOV_OVER_TOTAL,
  govOverRowsForPage,
} from "@/components/portal-v2/govOversharingData";

const TOTAL_PAGES = Math.ceil(GOV_OVER_TOTAL / GOV_OVER_PAGE_SIZE);
const TOTAL_LABEL = GOV_OVER_TOTAL.toLocaleString("en-GB");

const PAGE_NAV_BTN: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  fontSize: "12px",
  fontWeight: 600,
  border: "1px solid rgba(30,41,59,.9)",
  background: "transparent",
  color: "#94a3b8",
  cursor: "pointer",
  fontFamily: "inherit",
};

export default function PortalV2GovOversharingAllPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const rows = govOverRowsForPage(page);
  const q = search.trim().toLowerCase();
  // The prototype's search input is bound but not yet applied to the row set
  // (the real page is a server query). Filtering the synthesised page keeps the
  // control honest rather than inert — it narrows what is actually on screen.
  const visible = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;

  return (
    <PortalV2Shell eyebrow="Governance" title="Overshared SharePoint">
      <div
        style={{
          position: "relative",
          maxWidth: 1100,
          margin: "0 auto",
          padding: "28px 28px 56px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          boxSizing: "border-box",
        }}
      >
        <Link
          href="/portal-v2/governance"
          data-testid="pv2-ovrall-back"
          style={{
            alignSelf: "flex-start",
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontSize: "11.5px",
            fontWeight: 600,
            color: "#64748b",
            fontFamily: "inherit",
          }}
        >
          ← Governance
        </Link>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{ fontSize: "20px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.3 }}
            data-testid="pv2-ovrall-heading"
          >
            {TOTAL_LABEL} sites are shared externally with an active "Anyone with the link"
          </span>
          <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 }}>
            At this scale, this needs search, filtering, and bulk remediation — not a list you
            scroll through.
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{
              flex: 1,
              minWidth: 220,
              maxWidth: 360,
              display: "flex",
              alignItems: "center",
              gap: 9,
              background: "#0b1a2e",
              border: "1px solid rgba(148,163,184,.16)",
              borderRadius: 6,
              padding: "8px 12px",
            }}
          >
            <span style={{ display: "flex", color: "#64748b" }}>
              <Search size={14} color="#64748b" strokeWidth={2} aria-hidden="true" />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sites…"
              aria-label="Search sites"
              data-testid="pv2-ovrall-search"
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#e2e8f0",
                fontSize: "13px",
                fontFamily: "inherit",
              }}
            />
          </div>
          <button
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              fontSize: "12px",
              fontWeight: 700,
              border: "1px solid var(--brand-blue,#0078D4)",
              background: "var(--brand-blue,#0078D4)",
              color: "#fff",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Bulk fix selected
          </button>
          <button
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              fontSize: "12px",
              fontWeight: 600,
              border: "1px solid rgba(30,41,59,.9)",
              background: "transparent",
              color: "#94a3b8",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Export CSV
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
            border: "1px solid rgba(30,41,59,.9)",
            borderRadius: 12,
            background: "rgba(15,23,42,.35)",
            overflow: "hidden",
          }}
          data-testid="pv2-ovrall-rows"
        >
          {visible.map((row) => (
            <div
              key={row.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "11px 18px",
                borderTop: "1px solid rgba(30,41,59,.7)",
              }}
            >
              <input type="checkbox" aria-label={`Select ${row.name}`} style={{ flex: "0 0 auto" }} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>
                  {row.name}
                </span>
                <span style={{ fontSize: "11px", color: "#64748b" }}>{row.context}</span>
              </div>
              <button
                style={{
                  padding: "5px 11px",
                  borderRadius: 5,
                  fontSize: "11px",
                  fontWeight: 600,
                  border: "1px solid rgba(30,41,59,.9)",
                  background: "transparent",
                  color: "#60a5fa",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Fix
              </button>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span style={{ fontSize: "11.5px", color: "#64748b" }}>
            Page {page} of {TOTAL_PAGES.toLocaleString("en-GB")} · {TOTAL_LABEL} total
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={PAGE_NAV_BTN}
              data-testid="pv2-ovrall-prev"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(TOTAL_PAGES, p + 1))}
              style={PAGE_NAV_BTN}
              data-testid="pv2-ovrall-next"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </PortalV2Shell>
  );
}
