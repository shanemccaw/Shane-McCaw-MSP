/**
 * portal-v2-gov-area.tsx — the three "generic area" Governance drill-downs.
 *
 * A direct port of the prototype's `isGovListPage` (shell 5871-5900),
 * `isGovDriftPage` (5902-5925) and `isGovInventoryPage` (5927-5958). One page
 * component serves all three because the prototype renders them from the same
 * `active` key space and only one is ever on screen — the shape is chosen by
 * which `govXxxPageData` map holds the key, exactly as `govAreaFor` resolves it.
 *
 * ── Why it reads the slug from the location, not a route param ───────────────
 * These slugs collide with `/portal-v2/governance/:area` (the rich GOV_PAGES
 * drill-down, Part 2's), so each is registered as its OWN literal route ABOVE
 * that param route in App.tsx. A literal route carries no `:area` param, so the
 * slug is taken from the last path segment rather than `useParams`.
 *
 * Every inline style value is the prototype's — the README states the inline
 * values ARE the spec, so no house Card/Badge is used where the numbers differ.
 */

import { Link, useLocation } from "wouter";

import NotFound from "@/pages/not-found";
import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { govAreaFor } from "@/components/portal-v2/govAreaModel";
import { useLivePillarHero } from "@/components/portal-v2/useLivePillarHero";
import { PillarLiveSource } from "@/components/portal-v2/PillarLiveSource";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

const BACK_LINK: React.CSSProperties = {
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
};

const CONTAINER: React.CSSProperties = {
  position: "relative",
  maxWidth: 900,
  margin: "0 auto",
  padding: "28px 28px 56px",
  display: "flex",
  flexDirection: "column",
  gap: 18,
  boxSizing: "border-box",
};

const PANEL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 0,
  border: "1px solid rgba(30,41,59,.9)",
  borderRadius: 12,
  background: "rgba(15,23,42,.35)",
  overflow: "hidden",
};

const FIX_BTN: React.CSSProperties = {
  padding: "5px 11px",
  borderRadius: 5,
  fontSize: "11px",
  fontWeight: 600,
  border: "1px solid rgba(30,41,59,.9)",
  background: "transparent",
  color: "#60a5fa",
  cursor: "pointer",
  fontFamily: "inherit",
};

export default function PortalV2GovAreaPage() {
  const [location] = useLocation();
  const slug = location.split("/").filter(Boolean).pop();
  const area = govAreaFor(slug);

  // Reads the governance pillar's live war-room-pillars payload through the shared
  // `useLivePillarHero` seam; `pv2-govarea-source` proves the page is on real data.
  // The per-sub-area object lists / drift events / stat rows shown here have no
  // per-sub-area server producer (the payload scores the pillar as a whole, not
  // each governance area), so those rows stay fixture — a documented backend gap.
  const live = useLivePillarHero("governance");

  if (!area) return <NotFound />;

  const { title, why } = area.page;

  return (
    <PortalV2Shell eyebrow="Governance" title={title}>
      <div style={CONTAINER} data-testid="pv2-govarea-page">
        <Link href="/portal-v2/governance" data-testid="pv2-govarea-back" style={BACK_LINK}>
          ← Governance
        </Link>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{ fontSize: "19px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.3 }}
            data-testid="pv2-govarea-heading"
          >
            {title}
          </span>
          <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 }}>{why}</span>
        </div>

        {/* ── Shape A: affected-object list (5881-5898) ──────────────────── */}
        {area.kind === "list" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="pv2-govarea-rows">
            {area.rows.map((row, i) => (
              <div
                key={`${row.name}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 16px",
                  borderRadius: 8,
                  background: row.accepted
                    ? "rgba(52,211,153,.05)"
                    : "linear-gradient(90deg, rgba(59,130,246,.06), rgba(15,23,42,0) 70%)",
                  border: `1px solid ${row.accepted ? "rgba(52,211,153,.2)" : "rgba(30,41,59,.7)"}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>{row.name}</span>
                  <span style={{ fontSize: "11.5px", color: "#64748b" }}>{row.context}</span>
                </div>
                {row.accepted && (
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      color: "#34d399",
                      padding: "2px 7px",
                      border: "1px solid rgba(52,211,153,.35)",
                      borderRadius: 4,
                    }}
                  >
                    {row.acceptedMeta}
                  </span>
                )}
                {row.showActions && (
                  <div style={{ flex: "0 0 auto", display: "flex", gap: 6 }}>
                    <button style={FIX_BTN}>Fix</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Shape C: drift timeline (5912-5923) ────────────────────────── */}
        {area.kind === "drift" && (
          <div style={PANEL} data-testid="pv2-govarea-events">
            {area.page.events.map((ev, i) => (
              <div
                key={`${ev.title}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                  padding: "12px 18px",
                  borderTop: "1px solid rgba(30,41,59,.7)",
                }}
              >
                <span
                  style={{
                    flex: "0 0 2px",
                    alignSelf: "stretch",
                    background: "rgba(59,130,246,.5)",
                    borderRadius: 1,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>{ev.title}</span>
                  <span style={{ fontSize: "12px", color: "#94a3b8" }}>{ev.change}</span>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>
                    {ev.when} · detected {ev.scan}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Shape D: inventory / reporting (5937-5957) ─────────────────── */}
        {area.kind === "inventory" && (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }} data-testid="pv2-govarea-stats">
              {area.page.stats.map((st) => (
                <div
                  key={st.label}
                  style={{
                    flex: 1,
                    minWidth: 120,
                    padding: "12px 16px",
                    border: "1px solid rgba(30,41,59,.9)",
                    borderRadius: 10,
                    background: "rgba(15,23,42,.4)",
                  }}
                >
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#f8fafc", fontFamily: MONO }}>
                    {st.value}
                  </div>
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                      fontWeight: 600,
                    }}
                  >
                    {st.label}
                  </div>
                </div>
              ))}
            </div>
            <div style={PANEL} data-testid="pv2-govarea-rows">
              {area.rows.map((row, i) => (
                <div
                  key={`${row.name}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "11px 18px",
                    borderTop: "1px solid rgba(30,41,59,.7)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>{row.name}</span>
                    <span style={{ fontSize: "11.5px", color: "#64748b" }}>{row.context}</span>
                  </div>
                  {row.flagLabel && (
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        letterSpacing: ".05em",
                        textTransform: "uppercase",
                        color: "#c2a63d",
                        padding: "2px 7px",
                        border: "1px solid rgba(194,166,61,.4)",
                        borderRadius: 4,
                      }}
                    >
                      {row.flagLabel}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <PillarLiveSource testId="pv2-govarea-source" live={live} />
    </PortalV2Shell>
  );
}
