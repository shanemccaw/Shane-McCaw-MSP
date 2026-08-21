/**
 * RiskAcceptedPanel.tsx — the Governance / Security risk drop panel.
 *
 * The `sc-if="{{ govRisk.open }}"` / `sc-if="{{ secRisk.open }}"` block from the
 * prototype (`Customer Portal Shell.dc.html` 567-647 and 785-865), which are
 * byte-identical apart from the pillar name and count. Both pillar pages render
 * this one component; the derivation is in `riskPanelModel.ts`.
 *
 * The panel is GOLD on both pillars — it is the risk-accepted theme, not the
 * pillar colour — so nothing here is parameterised by the pillar's own palette.
 * The only per-pillar inputs are the pillar string (used for the "<Pillar> risks"
 * label and the register link's `?pillar=` filter) and the testid prefix.
 *
 * Open/closed is owned by the page (the banner button toggles it); this
 * component only renders when open. Which row is expanded is `expandedId`, also
 * page-owned, so the toggle and the register link stay outside the panel exactly
 * as the markup places them.
 */

import { Link } from "wouter";

import { buildRiskPanel, buildRiskDetail } from "./riskPanelModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";
const GOLD = "#c2a63d";

const MICRO_LABEL: React.CSSProperties = {
  fontSize: "9px",
  fontWeight: 800,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "#64748b",
};

const REGISTER_LINK: React.CSSProperties = {
  marginLeft: "auto",
  padding: 0,
  border: "none",
  background: "none",
  fontFamily: "inherit",
  cursor: "pointer",
  fontSize: "10.5px",
  fontWeight: 700,
  color: "#94a3b8",
  whiteSpace: "nowrap",
  textDecoration: "none",
};

export function RiskAcceptedPanel({
  pillar,
  expandedId,
  onToggleRow,
  testPrefix,
}: {
  pillar: string;
  expandedId: string | null;
  onToggleRow: (id: string) => void;
  testPrefix: string;
}) {
  const { count, rows, cells } = buildRiskPanel(pillar);
  const detail = buildRiskDetail(pillar, expandedId);
  const registerHref = `/portal-v2/risk-register?pillar=${pillar}`;

  return (
    <div
      data-testid={`${testPrefix}-risk-panel`}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) 232px",
        gap: 18,
        padding: "16px 18px",
        border: "1px solid rgba(194,166,61,.28)",
        borderRadius: 12,
        background: "rgba(194,166,61,.04)",
      }}
    >
      {/* ── The risks list — proto 569-587 ─────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <span style={{ ...MICRO_LABEL, color: GOLD }}>
            {pillar} risks · {count}
          </span>
          <Link href={registerHref} data-testid={`${testPrefix}-risk-open-all`} style={REGISTER_LINK}>
            Open in the register →
          </Link>
        </div>

        {rows.map((r) => {
          const isOpen = expandedId === r.id;
          return (
            <button
              key={r.id}
              onClick={() => onToggleRow(r.id)}
              data-testid={`${testPrefix}-risk-row-${r.id}`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 5,
                padding: "10px 12px",
                border: `1px solid ${isOpen ? "rgba(194,166,61,.5)" : "rgba(30,41,59,.9)"}`,
                borderRadius: 9,
                background: isOpen ? "rgba(194,166,61,.07)" : "rgba(2,6,23,.4)",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                width: "100%",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: "11.5px",
                  fontWeight: 600,
                  color: "#e2e8f0",
                  lineHeight: 1.45,
                  textWrap: "pretty",
                }}
              >
                {r.title}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    flex: "0 0 auto",
                    fontSize: "9.5px",
                    fontWeight: 700,
                    color: "#64748b",
                    fontFamily: MONO,
                  }}
                >
                  {r.id}
                </span>
                <span
                  style={{
                    flex: "0 0 auto",
                    fontSize: "10px",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    color: r.inherentColor,
                  }}
                >
                  {r.inherent}
                </span>
                <span style={{ flex: "0 0 auto", fontSize: "9.5px", color: "#475569" }}>→</span>
                <span
                  style={{
                    flex: "0 0 auto",
                    fontSize: "10px",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    color: r.residualColor,
                  }}
                >
                  {r.residual}
                </span>
                <span
                  style={{
                    flex: "0 0 auto",
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontSize: "9.5px",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    color: r.statusColor,
                    background: `${r.statusColor}18`,
                  }}
                >
                  {r.status}
                </span>
                <span
                  style={{
                    flex: "0 0 auto",
                    fontSize: "10px",
                    color: "#64748b",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.owner}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Likelihood × impact heat-map — proto 588-600 ───────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
        <span style={MICRO_LABEL}>Likelihood against impact</span>
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4 }}
          data-testid={`${testPrefix}-risk-heatmap`}
        >
          {cells.map((c, i) => (
            <div
              key={i}
              title={c.title}
              style={{
                aspectRatio: "1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 5,
                fontSize: "11px",
                fontWeight: 800,
                fontFamily: "inherit",
                color: c.filled ? "#0b1524" : `${c.band}55`,
                background: c.filled ? c.band : `${c.band}14`,
                border: `1px solid ${c.filled ? c.band : `${c.band}26`}`,
              }}
            >
              {c.n}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "9.5px", color: "#475569" }}>Low impact</span>
          <span style={{ fontSize: "9.5px", color: "#475569" }}>High impact</span>
        </div>
        <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.5, textWrap: "pretty" }}>
          Rows run from most likely at the top. A filled cell is a risk sitting at that pair — hover
          it for the name.
        </span>
      </div>

      {/* ── Expanded detail — proto 602-645 ────────────────────────────── */}
      {detail && (
        <div
          data-testid={`${testPrefix}-risk-detail`}
          style={{
            gridColumn: "1/-1",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "15px 16px",
            border: "1px solid rgba(194,166,61,.3)",
            borderRadius: 11,
            background: "rgba(2,6,23,.5)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, color: "#64748b", fontFamily: MONO }}>
                {detail.id} · {detail.score}
              </span>
              <span
                style={{
                  fontSize: "13.5px",
                  fontWeight: 700,
                  color: "#f8fafc",
                  lineHeight: 1.35,
                  textWrap: "pretty",
                }}
              >
                {detail.title}
              </span>
            </div>
            <button
              onClick={() => onToggleRow(detail.id)}
              aria-label="Close"
              style={{
                marginLeft: "auto",
                flex: "0 0 auto",
                width: 24,
                height: 24,
                borderRadius: 6,
                border: "1px solid rgba(148,163,184,.2)",
                background: "transparent",
                color: "#94a3b8",
                fontSize: "12px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ×
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span style={MICRO_LABEL}>What it is</span>
              <span
                style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}
              >
                {detail.what}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span style={MICRO_LABEL}>What happens if it lands</span>
              <span
                style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}
              >
                {detail.outcome}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={MICRO_LABEL}>What is holding it down</span>
            {detail.controls.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span
                  style={{
                    flex: "0 0 auto",
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    marginTop: 6.5,
                    background: "#34d399",
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: "11.5px",
                    color: "#cbd5e1",
                    lineHeight: 1.6,
                    textWrap: "pretty",
                  }}
                >
                  {c}
                </span>
              </div>
            ))}
          </div>

          {detail.isAccepted && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 7,
                padding: "12px 13px",
                border: "1px solid rgba(167,139,250,.28)",
                borderRadius: 9,
                background: "rgba(167,139,250,.05)",
              }}
            >
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 800,
                  letterSpacing: ".13em",
                  textTransform: "uppercase",
                  color: "#a78bfa",
                }}
              >
                Accepted · {detail.accRef}
              </span>
              <span
                style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}
              >
                {detail.accWhy}
              </span>
              <span
                style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}
              >
                {detail.accComp}
              </span>
              <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.5 }}>
                By {detail.accBy} on {detail.accOn} · expires {detail.accUntil}
              </span>
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              paddingTop: 2,
              borderTop: "1px solid rgba(30,41,59,.9)",
            }}
          >
            <span style={{ fontSize: "10.5px", color: "#64748b", paddingTop: 9 }}>
              Owner · {detail.owner}
            </span>
            <span style={{ fontSize: "10.5px", color: "#64748b", paddingTop: 9 }}>
              Next review · {detail.review}
            </span>
            <span style={{ fontSize: "10.5px", color: "#64748b", paddingTop: 9 }}>
              Evidence · {detail.evidence}
            </span>
            <Link
              href={registerHref}
              data-testid={`${testPrefix}-risk-detail-open`}
              style={{ ...REGISTER_LINK, marginTop: 9 }}
            >
              Open in the register →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
