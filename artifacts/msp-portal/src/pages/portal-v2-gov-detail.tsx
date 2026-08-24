/**
 * portal-v2-gov-detail.tsx — the Governance drill-down page.
 *
 * A direct port of the prototype's `isGovDetailV2` template
 * (`Customer Portal Shell.dc.html` lines 4453-4625), which is the reference
 * implementation the handoff README points at for the drill-down anatomy:
 * purpose → provenance → stat cards → evidence table → policy block → wrench
 * fixes.
 *
 * ── Every style value is the prototype's, not a house default ───────────────
 * The README states the inline style values ARE the spec. Where a house
 * component would impose different numbers, the design's numbers win and the
 * house component is not used. Concretely that means: no `Card` (its padding
 * and radius differ), no `Table` (its `TableHead h-10 px-2` is not the spec's
 * `9px 16px` grid row), no `Badge` (chips are 9px/.06em with an 8-digit-hex
 * alpha border). The expression-built styles — `s.cardCss`, `r.rowCss`,
 * `q.srcCss`, `pr.statusCss`, `gd.headerCss` — are transcribed from their
 * builders at lines 10984-11077.
 *
 * The layout container is the prototype's own `.gov-grid`
 * (`grid-template-columns:1.7fr 1fr;gap:22px`, collapsing to one column under
 * 900px), declared in portal-v2.css rather than approximated with Tailwind
 * fractions.
 */

import { useState } from "react";
import { Link, useParams } from "wouter";

import NotFound from "@/pages/not-found";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { FixPanel, useFixPanel } from "@/components/portal-v2/FixPanel";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { useAcceptRisk } from "@/components/portal-v2/AcceptRiskPanel";
import {
  GOV_MONO,
  GOV_SRC_META,
  GOV_TONE,
  govPageFor,
  type GovPage,
  type GovTone,
} from "@/components/portal-v2/govPages";
import { useLivePillarHero } from "@/components/portal-v2/useLivePillarHero";
import { PillarLiveSource } from "@/components/portal-v2/PillarLiveSource";

/* ── Expression-built styles, transcribed from the prototype's builders ───── */

/** `chip(label, tone)` — line 10986. */
function chipStyle(tone: GovTone): React.CSSProperties {
  const c = GOV_TONE[tone] ?? GOV_TONE.slate;
  return {
    flex: "0 0 auto",
    padding: "2px 7px",
    borderRadius: 4,
    border: `1px solid ${c}55`,
    background: `${c}14`,
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: c,
    whiteSpace: "nowrap",
  };
}

/** `s.cardCss` + `s.glowCss` + `s.valueCss` — lines 11028-11030. */
function statCardStyle(tone: GovTone): React.CSSProperties {
  const c = GOV_TONE[tone];
  return {
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${c}38`,
    background: `linear-gradient(160deg, ${c}12, rgba(15,23,42,.5))`,
  };
}

function statGlowStyle(tone: GovTone): React.CSSProperties {
  const c = GOV_TONE[tone];
  return {
    position: "absolute",
    right: -22,
    top: -26,
    width: 86,
    height: 86,
    borderRadius: "50%",
    background: `radial-gradient(circle, ${c}22, rgba(2,6,23,0) 70%)`,
    pointerEvents: "none",
  };
}

const STAT_VALUE: React.CSSProperties = {
  position: "relative",
  fontSize: "18px",
  fontWeight: 800,
  letterSpacing: "-.02em",
  color: "#f8fafc",
  fontFamily: GOV_MONO,
};

/** `s.fixBtnCss` — line 11031. */
function fixBtnStyle(tone: GovTone): React.CSSProperties {
  const c = GOV_TONE[tone];
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    borderRadius: 5,
    border: `1px solid ${c}66`,
    background: `${c}14`,
    cursor: "pointer",
  };
}

/** `s.sparkBtnCss` — line 11012. */
const SPARK_BTN: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  borderRadius: 5,
  border: "1px solid rgba(0,180,216,.45)",
  background: "rgba(0,180,216,.1)",
  cursor: "pointer",
};

/** `q.srcCss` / `q.scopeCss` — lines 10999-11000. */
function srcChipStyle(src: keyof typeof GOV_SRC_META): React.CSSProperties {
  const c = GOV_SRC_META[src].c;
  return {
    flex: "0 0 auto",
    padding: "2px 7px",
    borderRadius: 4,
    border: `1px solid ${c}55`,
    background: `${c}14`,
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: c,
    whiteSpace: "nowrap",
  };
}

/** `pr.statusCss` — line 11070. Note 3px 8px and 9.5px, unlike the 2px 7px chips. */
function policyStatusStyle(tone: GovTone): React.CSSProperties {
  const c = GOV_TONE[tone];
  return {
    flex: "0 0 auto",
    padding: "3px 8px",
    borderRadius: 4,
    border: `1px solid ${c}55`,
    background: `${c}14`,
    fontSize: "9.5px",
    fontWeight: 700,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: c,
    whiteSpace: "nowrap",
  };
}

const EYEBROW_16: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".16em",
  textTransform: "uppercase",
  color: "#64748b",
};

function WrenchIcon({ color, size = 13 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

/** The prototype's `sparkSvg` — the Ask-ShaneBot sparkle, always #22d3ee. */
function SparkIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.7 4.4L18 9l-4.3 1.6L12 15l-1.7-4.4L6 9l4.3-1.6zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </svg>
  );
}

function Chevron({ deg }: { deg: number }) {
  return (
    <span
      style={{
        display: "flex",
        marginTop: 1,
        transform: `rotate(${deg}deg)`,
        transition: "transform 180ms",
      }}
    >
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function PortalV2GovDetailPage() {
  const params = useParams<{ area?: string }>();
  const page = govPageFor(params.area ? `governance-${params.area}` : undefined);

  const { fixKey, openFixPanel, closeFixPanel } = useFixPanel();
  const { openForm, formElement } = useFormDrawer();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [provOpen, setProvOpen] = useState(false);

  const askShaneBot = (topic: string) =>
    openForm({
      kicker: "Ask ShaneBot",
      title: "Ask about this finding",
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
        "ShaneBot has the finding and your tenant context. The reply appears in your chat panel.",
    });

  // The fix panel's "Accept it as a risk instead" route was calling an optional
  // callback nobody supplied, which made it the one dead end in the CR gate.
  // The drawer is shared with the Overshared SharePoint page.
  const { openAcceptRisk, acceptRiskElement } = useAcceptRisk({
    onConfirm: () => {},
    onAskShaneBot: askShaneBot,
  });

  // Reads the governance pillar's live war-room-pillars payload through the shared
  // `useLivePillarHero` seam; `pv2-gd-source` proves the page is on real data. The
  // per-sub-area detail table / policy / provenance rows have no per-sub-area
  // server producer (the payload scores the pillar as a whole), so those rows stay
  // fixture — a documented backend gap, not fabricated per-area numbers.
  const live = useLivePillarHero("governance");

  if (!page) return <NotFound />;

  const gridCss = page.table.cols.map((c) => c.w).join(" ");
  // Header and each row MUST share this template or the columns drift apart.
  const rowGrid = `22px ${gridCss} 92px`;

  return (
    <PortalV2Shell eyebrow="Governance" title={page.heading}>
      <GovDetailBody
        page={page}
        rowGrid={rowGrid}
        expanded={expanded}
        setExpanded={setExpanded}
        provOpen={provOpen}
        setProvOpen={setProvOpen}
        onFix={openFixPanel}
        onAskShaneBot={askShaneBot}
      />

      {fixKey && (
        <FixPanel
          fixKey={fixKey}
          onClose={closeFixPanel}
          onAskShaneBot={(playbook) =>
            askShaneBot(
              `Explain this finding to me before I approve the change: ${playbook.title}`,
            )
          }
          onAcceptRisk={(playbook) => {
            closeFixPanel();
            openAcceptRisk({
              title: playbook.title,
              description: playbook.description,
              details:
                "Accepting instead of fixing suppresses this finding’s points in the pillar score and mutes its alerts, and puts it on the risk register with your name, a rationale and a review date. It stays visible as an accepted risk. No change request is raised because nothing changes in the tenant.",
              kicker: "Accept instead of fixing",
            });
          }}
        />
      )}
      {acceptRiskElement}
      {formElement}
      <PillarLiveSource testId="pv2-gd-source" live={live} />
    </PortalV2Shell>
  );
}

function GovDetailBody({
  page,
  rowGrid,
  expanded,
  setExpanded,
  provOpen,
  setProvOpen,
  onFix,
  onAskShaneBot,
}: {
  page: GovPage;
  rowGrid: string;
  expanded: number | null;
  setExpanded: (n: number | null) => void;
  provOpen: boolean;
  setProvOpen: (b: boolean) => void;
  onFix: (key: string) => void;
  onAskShaneBot: (topic: string) => void;
}) {
  return (
    <div
      style={{
        position: "relative",
        maxWidth: 1320,
        margin: "0 auto",
        padding: "26px 26px 48px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        boxSizing: "border-box",
      }}
    >
      <Link
        href="/portal-v2/governance"
        data-testid="pv2-gd-back"
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

      {/* ── Heading + "Reading this page" ──────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <span
            style={{
              fontSize: "19px",
              fontWeight: 800,
              color: "#f8fafc",
              lineHeight: 1.28,
              letterSpacing: "-.02em",
            }}
            data-testid="pv2-gd-heading"
          >
            {page.heading}
          </span>
          <span
            style={{
              fontSize: "12.5px",
              color: "#94a3b8",
              lineHeight: 1.55,
              textWrap: "pretty",
            }}
          >
            {page.purpose}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "11px 14px",
            border: "1px solid rgba(59,130,246,.22)",
            borderLeft: "2px solid #3B82F6",
            borderRadius: 9,
            background: "rgba(59,130,246,.05)",
            minWidth: 0,
          }}
        >
          <span style={EYEBROW_16}>Reading this page</span>
          <span
            style={{
              fontSize: "11.5px",
              color: "#cbd5e1",
              lineHeight: 1.55,
              textWrap: "pretty",
            }}
          >
            {page.note}
          </span>
        </div>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
          gap: 10,
        }}
      >
        {page.stats.map((s) => (
          <div key={s.label} style={statCardStyle(s.tone)} data-testid="pv2-gd-stat">
            <div style={statGlowStyle(s.tone)} />
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".11em",
                  textTransform: "uppercase",
                  color: "#64748b",
                  lineHeight: 1.3,
                }}
              >
                {s.label}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 5, flex: "0 0 auto" }}>
                <button
                  style={SPARK_BTN}
                  title="Ask ShaneBot about this"
                  onClick={() =>
                    onAskShaneBot(
                      `Explain this from my tenant: ${s.label} is ${s.value} (${s.sub})`,
                    )
                  }
                >
                  <SparkIcon />
                </button>
                {s.fixKey && (
                  <button
                    style={fixBtnStyle(s.tone)}
                    title="Fix this"
                    data-testid={`pv2-gd-stat-fix-${s.fixKey}`}
                    onClick={() => onFix(s.fixKey!)}
                  >
                    <WrenchIcon color={GOV_TONE[s.tone]} size={12} />
                  </button>
                )}
              </div>
            </div>
            <span style={STAT_VALUE}>{s.value}</span>
            <span
              style={{
                position: "relative",
                fontSize: "10px",
                color: "#64748b",
                lineHeight: 1.35,
              }}
            >
              {s.sub}
            </span>
          </div>
        ))}
      </div>

      {/* ── Evidence table (left) + risks/policy/provenance (right) ────── */}
      <div className="pv2-gov-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "9.5px",
                fontWeight: 700,
                letterSpacing: ".2em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              {page.table.label}
            </span>
            <span style={{ fontSize: "10.5px", color: "#475569" }}>{page.table.note}</span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 12,
              background: "rgba(15,23,42,.4)",
              overflow: "hidden",
            }}
            data-testid="pv2-gd-table"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: rowGrid,
                gap: 12,
                padding: "9px 16px",
                borderBottom: "1px solid rgba(30,41,59,.9)",
                background: "rgba(59,130,246,.05)",
              }}
            >
              <span />
              {page.table.cols.map((h) => (
                <span
                  key={h.label}
                  style={{
                    fontSize: "9px",
                    fontWeight: 700,
                    letterSpacing: ".1em",
                    textTransform: "uppercase",
                    color: "#64748b",
                    lineHeight: 1.3,
                  }}
                >
                  {h.label}
                </span>
              ))}
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "#64748b",
                  textAlign: "right",
                }}
              >
                Flags
              </span>
            </div>

            {page.table.rows.map((r, i) => {
              const isExpanded = expanded === i;
              return (
                <div
                  key={r.cells.join("|")}
                  style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    borderTop: "1px solid rgba(30,41,59,.8)",
                    ...(isExpanded ? { background: "rgba(59,130,246,.04)" } : null),
                  }}
                >
                  <button
                    onClick={() => setExpanded(isExpanded ? null : i)}
                    data-testid={`pv2-gd-row-${i}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: rowGrid,
                      gap: 12,
                      alignItems: "start",
                      padding: "11px 16px",
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      width: "100%",
                    }}
                  >
                    <Chevron deg={isExpanded ? 180 : -90} />
                    {r.cells.map((v, ci) => (
                      <span
                        key={ci}
                        style={{
                          fontSize: "12px",
                          color: ci === 0 ? "#e2e8f0" : "#94a3b8",
                          fontWeight: ci === 0 ? 700 : 500,
                          lineHeight: 1.45,
                          minWidth: 0,
                          overflowWrap: "break-word",
                          ...(page.table.cols[ci]?.mono ? { fontFamily: GOV_MONO } : null),
                        }}
                      >
                        {v}
                      </span>
                    ))}
                    <span
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 3,
                      }}
                    >
                      {(r.chips ?? []).map((ch) => (
                        <span key={ch.label} style={chipStyle(ch.tone)}>
                          {ch.label}
                        </span>
                      ))}
                    </span>
                  </button>

                  {isExpanded && (
                    <div
                      style={{
                        padding: "2px 16px 16px 40px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
                          gap: "0 20px",
                        }}
                      >
                        {r.detail.facts.map((f) => (
                          <div
                            key={f.k}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                              padding: "7px 0",
                              borderBottom: "1px solid rgba(30,41,59,.75)",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "9.5px",
                                fontWeight: 700,
                                letterSpacing: ".07em",
                                textTransform: "uppercase",
                                color: "#64748b",
                              }}
                            >
                              {f.k}
                            </span>
                            <span
                              style={{
                                fontSize: "12px",
                                color: "#e2e8f0",
                                lineHeight: 1.5,
                                textWrap: "pretty",
                              }}
                            >
                              {f.v}
                            </span>
                          </div>
                        ))}
                      </div>

                      {(r.detail.groups ?? []).length > 0 && (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
                            gap: 12,
                          }}
                        >
                          {(r.detail.groups ?? []).map((g) => (
                            <div
                              key={g.label}
                              style={{ display: "flex", flexDirection: "column", gap: 6 }}
                            >
                              <span
                                style={{
                                  fontSize: "9.5px",
                                  fontWeight: 700,
                                  letterSpacing: ".09em",
                                  textTransform: "uppercase",
                                  color: "#64748b",
                                }}
                              >
                                {g.label}
                              </span>
                              {g.items.map((it) => (
                                <div
                                  key={it.primary}
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 1,
                                    paddingLeft: 10,
                                    borderLeft: "2px solid rgba(59,130,246,.4)",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: "12px",
                                      fontWeight: 600,
                                      color: "#e2e8f0",
                                      lineHeight: 1.45,
                                    }}
                                  >
                                    {it.primary}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: "11.5px",
                                      color: "#94a3b8",
                                      lineHeight: 1.5,
                                      textWrap: "pretty",
                                    }}
                                  >
                                    {it.secondary}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── Wrench fixes → the CR gate ─────────────────── */}
                      {(r.detail.actions ?? []).length > 0 && (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
                            gap: 8,
                            paddingTop: 8,
                            borderTop: "1px solid rgba(30,41,59,.8)",
                          }}
                        >
                          {(r.detail.actions ?? []).map((act) => (
                            <button
                              key={act.fixKey}
                              onClick={() => onFix(act.fixKey)}
                              data-testid={`pv2-gd-action-${act.fixKey}`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                textAlign: "left",
                                padding: "10px 12px",
                                borderRadius: 9,
                                border: "1px solid rgba(0,120,212,.4)",
                                background:
                                  "linear-gradient(160deg, rgba(0,120,212,.1), rgba(15,23,42,.3))",
                                cursor: "pointer",
                                fontFamily: "inherit",
                              }}
                            >
                              <span
                                style={{
                                  flex: "0 0 26px",
                                  width: 26,
                                  height: 26,
                                  borderRadius: 7,
                                  border: "1px solid rgba(0,120,212,.4)",
                                  background: "rgba(0,120,212,.14)",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <WrenchIcon color="#60a5fa" />
                              </span>
                              <span
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 2,
                                  minWidth: 0,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: "12px",
                                    fontWeight: 700,
                                    color: "#60a5fa",
                                    lineHeight: 1.4,
                                  }}
                                >
                                  {act.label}
                                </span>
                                <span
                                  style={{
                                    fontSize: "11px",
                                    color: "#94a3b8",
                                    lineHeight: 1.45,
                                  }}
                                >
                                  {act.sub}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right column ───────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(248,113,113,.25)",
              borderRadius: 12,
              background: "rgba(248,113,113,.04)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "11px 14px",
                borderBottom: "1px solid rgba(248,113,113,.16)",
              }}
            >
              <span style={{ ...EYEBROW_16, color: "#f87171" }}>
                Top risks · {page.risks.length}
              </span>
            </div>
            {page.risks.map((risk) => (
              <div
                key={risk}
                style={{
                  display: "flex",
                  gap: 9,
                  padding: "9px 14px",
                  borderBottom: "1px solid rgba(248,113,113,.1)",
                  fontSize: "11.5px",
                  color: "#e2e8f0",
                  lineHeight: 1.55,
                  textWrap: "pretty",
                }}
              >
                <span style={{ color: "#f87171", flex: "0 0 auto" }}>·</span>
                {risk}
              </div>
            ))}
          </div>

          {/* ── Tenant policy block ─────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 12,
              background: "rgba(15,23,42,.4)",
              overflow: "hidden",
            }}
            data-testid="pv2-gd-policy"
          >
            <div
              style={{
                padding: "11px 14px",
                borderBottom: "1px solid rgba(30,41,59,.9)",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <span style={EYEBROW_16}>{page.policy.label}</span>
              <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                {page.policy.note}
              </span>
            </div>
            {page.policy.rows.map((pr) => (
              <div
                key={pr.name}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "11px 14px",
                  borderBottom: "1px solid rgba(30,41,59,.8)",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11.5px",
                        fontWeight: 700,
                        color: "#e2e8f0",
                        fontFamily: GOV_MONO,
                        overflowWrap: "break-word",
                      }}
                    >
                      {pr.name}
                    </span>
                    <span style={policyStatusStyle(pr.tone)}>{pr.status}</span>
                  </div>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#94a3b8",
                      lineHeight: 1.5,
                      textWrap: "pretty",
                    }}
                  >
                    {pr.detail}
                  </span>
                </div>
                {pr.fixKey && (
                  <button
                    title="Fix this"
                    onClick={() => onFix(pr.fixKey!)}
                    data-testid={`pv2-gd-policy-fix-${pr.fixKey}`}
                    style={{
                      flex: "0 0 28px",
                      width: 28,
                      height: 28,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 7,
                      border: "1px solid rgba(0,120,212,.4)",
                      background: "rgba(0,120,212,.12)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <WrenchIcon color="#60a5fa" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* ── Provenance: how this is gathered ─────────────────────── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 12,
              background: "rgba(15,23,42,.4)",
              overflow: "hidden",
            }}
            data-testid="pv2-gd-provenance"
          >
            <button
              onClick={() => setProvOpen(!provOpen)}
              data-testid="pv2-gd-provenance-toggle"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "11px 14px",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                width: "100%",
              }}
            >
              <Chevron deg={provOpen ? 180 : -90} />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span style={EYEBROW_16}>How this is gathered</span>
                <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                  Exact calls, the scope each needs, and the field it feeds.
                </span>
              </span>
            </button>
            {provOpen && (
              <div
                style={{
                  padding: "0 14px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {page.provenance.map((q) => (
                  <div
                    key={q.call}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      padding: "9px 11px",
                      border: "1px solid rgba(30,41,59,.9)",
                      borderRadius: 8,
                      background: "#0b1524",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={srcChipStyle(q.src)}>{GOV_SRC_META[q.src].label}</span>
                      <span
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 600,
                          color: GOV_SRC_META[q.src].c,
                          fontFamily: GOV_MONO,
                        }}
                      >
                        {q.scope}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: "11px",
                        color: "#e2e8f0",
                        lineHeight: 1.5,
                        wordBreak: "break-word",
                        fontFamily: GOV_MONO,
                      }}
                    >
                      {q.call}
                    </span>
                    <span
                      style={{
                        fontSize: "10.5px",
                        color: "#64748b",
                        lineHeight: 1.45,
                        textWrap: "pretty",
                      }}
                    >
                      {q.note}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
