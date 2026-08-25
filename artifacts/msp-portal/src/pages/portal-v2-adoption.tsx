/**
 * portal-v2-adoption.tsx — the Adoption pillar dashboard.
 *
 * A direct port of the prototype's `isAdoption` block
 * (`Customer Portal Shell.dc.html` lines 3217-3506) and its logic (12602-12940).
 *
 * ── Adoption is not a risk page, and the design enforces that ──────────────
 * The prototype's own source comment calls this pillar "measurement — not a
 * write action", and the page's standfirst says it outright: "Nothing on this
 * page is a risk and nothing here is failing." Three consequences are
 * structural rather than cosmetic, and each is easy to lose in a port:
 *
 *  1. PARKING IS NOT ACCEPTING A RISK. The park drawer overrides every default
 *     ("nothing is exposed and nothing degrades"), and the parked cards are
 *     GREY — `rgba(148,163,184,…)` — not the pillar's orange, because a parked
 *     play is a business decision rather than a suppressed finding.
 *  2. FOUR OF THE SIX PLAYS CANNOT BE AUTOMATED, and `canAutomate` flows
 *     through to the fix panel, so those four offer no Graph route at all. This
 *     is the only pillar where that is true. Forcing it true would put an
 *     "Automate via Microsoft Graph" button on a training session.
 *  3. The action icon is `trending-up`, not `wrench` — for both the play button
 *     and the enabler rows. Nothing here is broken, so nothing gets a spanner.
 *
 * ── Shared frame, different contents ───────────────────────────────────────
 * It shares Licensing's frame — 1320px container at `26px 26px 48px`, three
 * stats at `minmax(140px,1fr)`, the two-column `.pv2-gov-grid`, a provenance
 * block — but carries three sections no other pillar has: a workload-utilisation
 * list, a department HEATMAP, and plays with a now → target pair rather than a
 * severity.
 *
 * ── A third trend domain ───────────────────────────────────────────────────
 * Its floor is padded by FOUR and its ceiling by three (12612). Governance,
 * Security and Compliance use ±3 both ends; Licensing anchors at 0 with a ×1.12
 * ceiling. Four pillars, three domains — which is why `DriftTrend` is shared by
 * exactly the two that genuinely match and by nobody else.
 */

import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown, TrendingUp } from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { FixPanel, useFixPanel } from "@/components/portal-v2/FixPanel";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { useAcceptRisk } from "@/components/portal-v2/AcceptRiskPanel";
import { GOV_SRC_META } from "@/components/portal-v2/govPages";
import { useLivePillarHero, PV2_SOURCE_CLIP } from "@/components/portal-v2/useLivePillarHero";
import { useAdpWorkloadsLive } from "@/components/portal-v2/useAdpWorkloadsLive";
import {
  ADP_DEPT,
  ADP_ENABLERS,
  ADP_HERO,
  ADP_HERO_STATS,
  ADP_KIND_LEGEND,
  ADP_KIND_META,
  ADP_MATRIX,
  ADP_MATRIX_NOTE,
  ADP_ORANGE,
  ADP_ORANGE_EYEBROW,
  ADP_ORANGE_TEXT,
  ADP_PARKED,
  ADP_PARKED_COUNT,
  ADP_PLAYS,
  ADP_PLAY_COUNT,
  ADP_PROV,
  ADP_TONE,
  ADP_WINS,
  adpMatrixCell,
  adpParkedMeta,
  adpPlayFixKey,
  adpTrendGeometry,
  adpWinTier,
  adpWorkloadDetail,
  adpWorkloadsWithLive,
  type AdpPlay,
} from "@/components/portal-v2/adpDashboardData";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/** The department heatmap's column template — header and every row share it. */
const MATRIX_GRID = "minmax(96px,1.1fr) repeat(4,minmax(58px,.75fr))";

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "#64748b",
};

const SECTION_NOTE: React.CSSProperties = { fontSize: "10.5px", color: "#475569" };

const MICRO_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  color: "#64748b",
};

export default function PortalV2AdoptionPage() {
  const trend = adpTrendGeometry();
  // Real pillar score/delta from the live health engine, fixture as the
  // honest-null fallback. Only the ring is wired — the workload list, department
  // heat-map and plays below have no per-item server feed and stay fixture.
  const live = useLivePillarHero("adoption");
  const score = live.score ?? ADP_HERO.score;
  const delta = live.delta?.text ?? ADP_HERO.delta;
  const deltaColor = live.delta?.color ?? "#34d399";

  // #1252: the 4 workload rows with a real per-check server feed (Exchange,
  // Teams chat & meetings, SharePoint, OneDrive) overlaid onto the fixture —
  // see adpWorkloadsWithLive's own header for which rows and why.
  const { live: workloadLive } = useAdpWorkloadsLive();
  const workloads = adpWorkloadsWithLive(workloadLive);
  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC - (score / 100) * ringC;

  const [expanded, setExpanded] = useState<number | null>(null);
  const [openWorkload, setOpenWorkload] = useState<number | null>(null);
  const [parkedOpen, setParkedOpen] = useState(true);
  const [provOpen, setProvOpen] = useState(false);
  const { fixKey, openFixPanel, closeFixPanel } = useFixPanel();
  const { openForm, formElement } = useFormDrawer();

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

  const { openAcceptRisk, acceptRiskElement } = useAcceptRisk({
    onConfirm: () => {},
    onAskShaneBot: askShaneBot,
  });

  /**
   * `p.parkGo` (12801-12808). This is the third pillar to override the drawer's
   * defaults and the most pointed: Governance accepts a RISK, Compliance records
   * a POLICY DECISION, Licensing acknowledges INTENTIONAL SPEND, and Adoption
   * parks a play while stating plainly that no risk is being accepted at all.
   * The same component, four different contracts, because the words are what
   * the customer is actually signing.
   */
  const parkPlay = (p: AdpPlay) =>
    openAcceptRisk({
      title: p.title,
      description: p.why,
      details: `Parking this is a business decision, not a risk acceptance — nothing is exposed and nothing degrades. What it costs is the upside: ${p.upside} Current state stays at ${p.now}. Recorded with an owner and a revisit date so it comes back on the agenda rather than quietly disappearing.`,
      kicker: "Park this play",
      descLabel: "What you are choosing not to push",
      detailsLabel: "What parking it costs you",
      confirmText:
        "This is a deliberate business decision for this quarter, with a named owner and a revisit date. I understand nothing is at risk — we are choosing not to pursue the upside right now.",
      btnLabel: "Park until next review",
    });

  return (
    <PortalV2Shell eyebrow="Pillar" title="Adoption">
      <div
        style={{
          position: "relative",
          maxWidth: 1320,
          margin: "0 auto",
          padding: "26px 26px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "-6%",
            width: "min(1000px,150%)",
            height: "52%",
            transform: "translateX(-50%)",
            filter: "blur(80px)",
            opacity: 0.5,
            pointerEvents: "none",
            background: "radial-gradient(ellipse at top, rgba(249,115,22,.16), rgba(2,6,23,0) 68%)",
          }}
        />

        {/* ── Back link + parked strip — proto 3221-3231 ─────────────────── */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/portal-v2"
            data-testid="pv2-adp-back"
            style={{
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
            ← Overview
          </Link>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 14px",
              border: "1px solid rgba(249,115,22,.28)",
              borderRadius: 9,
              background: "rgba(249,115,22,.06)",
            }}
          >
            <span
              style={{ fontSize: "15px", fontWeight: 800, color: ADP_ORANGE_TEXT, fontFamily: MONO }}
            >
              {ADP_PARKED_COUNT}
            </span>
            {/* "nothing at risk" is doing real work in this sentence. */}
            <span style={{ fontSize: "11.5px", color: "#94a3b8", whiteSpace: "nowrap" }}>
              {ADP_HERO.parkedStripSuffix}
            </span>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              data-testid="pv2-adp-programme-record-link"
              style={{
                fontSize: "11.5px",
                fontWeight: 600,
                color: ADP_ORANGE_TEXT,
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
            >
              Programme record →
            </a>
          </div>
        </div>

        {/* ── Hero card — proto 3233-3299 ────────────────────────────────── */}
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            gap: 20,
            padding: 24,
            border: "1px solid rgba(30,41,59,.9)",
            borderRadius: 14,
            background: "linear-gradient(160deg, rgba(249,115,22,.09), rgba(15,23,42,.5))",
          }}
          data-testid="pv2-adp-hero"
        >
          <div
            style={{
              position: "absolute",
              left: -60,
              top: -90,
              width: 320,
              height: 320,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(249,115,22,.24), rgba(2,6,23,0) 70%)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: -40,
              bottom: -100,
              width: 280,
              height: 280,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(249,115,22,.13), rgba(2,6,23,0) 70%)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 20,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                minWidth: 260,
                maxWidth: 520,
              }}
            >
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: ADP_ORANGE_EYEBROW,
                }}
              >
                {ADP_HERO.eyebrow}
              </span>
              <span
                style={{
                  fontSize: "19px",
                  fontWeight: 800,
                  letterSpacing: "-.015em",
                  color: "#f8fafc",
                  lineHeight: 1.3,
                }}
                data-testid="pv2-adp-headline"
              >
                {ADP_HERO.headline}
              </span>
              <span
                style={{
                  fontSize: "12.5px",
                  color: "#cbd5e1",
                  lineHeight: 1.55,
                  textWrap: "pretty",
                }}
              >
                {ADP_HERO.standfirst}
              </span>
            </div>

            <div
              style={{
                flex: "1 1 260px",
                minWidth: 220,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
              data-testid="pv2-adp-trend"
            >
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                {ADP_HERO.trendLabel}
              </span>
              <div style={{ position: "relative" }}>
                <svg
                  width="100%"
                  height={trend.h}
                  viewBox={`0 0 ${trend.w} ${trend.h}`}
                  preserveAspectRatio="none"
                  style={{ overflow: "visible", display: "block" }}
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="adpTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ADP_ORANGE} stopOpacity={0.36} />
                      <stop offset="100%" stopColor={ADP_ORANGE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <path d={trend.area} fill="url(#adpTrendFill)" />
                  <polyline
                    points={trend.line}
                    fill="none"
                    stroke={ADP_ORANGE}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <svg
                  width="100%"
                  height={trend.h}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    overflow: "visible",
                    display: "block",
                    pointerEvents: "none",
                  }}
                  aria-hidden="true"
                >
                  <circle
                    cx={`${(trend.lastX / trend.w) * 100}%`}
                    cy={trend.lastY}
                    r={3.5}
                    fill={ADP_ORANGE_EYEBROW}
                  />
                </svg>
                <div style={{ height: 1, background: "rgba(148,163,184,.14)" }} />
                <span
                  style={{ display: "block", paddingTop: 5, fontSize: "10.5px", color: "#64748b" }}
                >
                  {ADP_HERO.trendCaption}
                </span>
              </div>
            </div>
          </div>

          <div
            style={{
              position: "relative",
              display: "grid",
              gridTemplateColumns: "auto repeat(3,minmax(140px,1fr))",
              alignItems: "stretch",
              gap: 0,
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "2px 22px 2px 0" }}>
              <div style={{ position: "relative", flex: "0 0 auto", width: 88, height: 88 }}>
                <div
                  style={{
                    position: "absolute",
                    inset: -18,
                    borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(249,115,22,.28), rgba(2,6,23,0) 72%)",
                    pointerEvents: "none",
                  }}
                />
                <svg
                  width={88}
                  height={88}
                  viewBox="0 0 104 104"
                  style={{ transform: "rotate(-90deg)", position: "absolute", inset: 0 }}
                  aria-hidden="true"
                >
                  <circle cx={52} cy={52} r={ringR} fill="none" stroke="rgba(148,163,184,.14)" strokeWidth={9} />
                  <circle
                    cx={52}
                    cy={52}
                    r={ringR}
                    fill="none"
                    stroke={ADP_ORANGE}
                    strokeWidth={9}
                    strokeLinecap="round"
                    strokeDasharray={ringC}
                    strokeDashoffset={ringOffset}
                  />
                </svg>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1,
                  }}
                >
                  <span
                    style={{
                      fontSize: "26px",
                      fontWeight: 800,
                      letterSpacing: "-.02em",
                      color: ADP_ORANGE_TEXT,
                      fontFamily: MONO,
                    }}
                    data-testid="pv2-adp-score"
                  >
                    {score}
                  </span>
                  <span
                    style={{ fontSize: "9.5px", fontWeight: 700, color: deltaColor, fontFamily: MONO }}
                  >
                    {delta}
                  </span>
                  <span data-testid="pv2-adp-source" style={PV2_SOURCE_CLIP}>
                    {live.dataState}
                  </span>
                </div>
              </div>
            </div>

            {ADP_HERO_STATS.map((s) => (
              <div
                key={s.label}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "2px 16px",
                  borderLeft: `2px solid ${ADP_ORANGE}`,
                  justifyContent: "center",
                }}
                data-testid={`pv2-adp-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div
                  style={{
                    position: "absolute",
                    left: -30,
                    top: -30,
                    width: 110,
                    height: 110,
                    borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(249,115,22,.18), rgba(2,6,23,0) 70%)",
                    pointerEvents: "none",
                  }}
                />
                <span
                  style={{
                    position: "relative",
                    fontSize: "10px",
                    fontWeight: 600,
                    letterSpacing: ".1em",
                    textTransform: "uppercase",
                    color: "#64748b",
                    lineHeight: 1.25,
                  }}
                >
                  {s.label}
                </span>
                <span
                  style={{
                    position: "relative",
                    fontSize: "22px",
                    fontWeight: 800,
                    color: "#f8fafc",
                    letterSpacing: "-.02em",
                    fontFamily: MONO,
                  }}
                >
                  {s.value}
                </span>
                <span style={{ position: "relative", fontSize: "10.5px", color: "#64748b" }}>
                  {s.sub}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Workload utilisation + department heatmap — proto 3301-3341 ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <span style={SECTION_LABEL}>Workload utilisation</span>
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
              data-testid="pv2-adp-workloads"
            >
              {workloads.map((w, wi) => {
                const c = ADP_TONE[w.tone];
                const isOpen = openWorkload === wi;
                const detail = adpWorkloadDetail(w);
                return (
                  <div
                    key={w.name}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 0,
                      borderBottom: "1px solid rgba(30,41,59,.8)",
                    }}
                  >
                    <button
                      onClick={() => setOpenWorkload(isOpen ? null : wi)}
                      data-testid={`pv2-adp-workload-${wi}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0,1fr) 52px",
                        gap: 12,
                        padding: "9px 14px",
                        alignItems: "center",
                        border: "none",
                        background: isOpen ? "rgba(148,163,184,.05)" : "transparent",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      <div
                        style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}
                      >
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "#e2e8f0",
                            lineHeight: 1.35,
                          }}
                        >
                          {w.name}
                        </span>
                        <span
                          style={{
                            fontSize: "10.5px",
                            color: "#94a3b8",
                            lineHeight: 1.45,
                            textWrap: "pretty",
                          }}
                        >
                          {w.note}
                        </span>
                        <div
                          style={{
                            position: "relative",
                            height: 5,
                            borderRadius: 3,
                            background: "rgba(148,163,184,.14)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              borderRadius: 3,
                              width: `${w.active}%`,
                              background: c,
                              opacity: 0.9,
                            }}
                          />
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 800,
                          color: c,
                          fontFamily: MONO,
                          textAlign: "right",
                        }}
                      >
                        {w.active}%
                      </span>
                    </button>
                    {isOpen && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 9,
                          padding: "2px 14px 13px",
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))",
                            gap: 9,
                          }}
                        >
                          {detail.facts.map((f) => (
                            <div
                              key={f.k}
                              style={{ display: "flex", flexDirection: "column", gap: 1 }}
                            >
                              <span
                                style={{
                                  fontSize: "9px",
                                  fontWeight: 700,
                                  letterSpacing: ".09em",
                                  textTransform: "uppercase",
                                  color: "#64748b",
                                }}
                              >
                                {f.k}
                              </span>
                              <span
                                style={{
                                  fontSize: "11.5px",
                                  fontWeight: 600,
                                  color: "#e2e8f0",
                                  fontFamily: MONO,
                                }}
                              >
                                {f.v}
                              </span>
                            </div>
                          ))}
                        </div>
                        <span
                          style={{
                            fontSize: "11.5px",
                            color: "#cbd5e1",
                            lineHeight: 1.6,
                            textWrap: "pretty",
                          }}
                        >
                          {detail.reading}
                        </span>
                        <span
                          style={{
                            fontSize: "10px",
                            color: "#475569",
                            lineHeight: 1.5,
                            fontFamily: MONO,
                          }}
                        >
                          {detail.src}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span style={SECTION_LABEL}>Adoption by department</span>
              {/* Deep-links into how the department attribute is mapped — a
                  Settings surface built in a later part, so inert for now. */}
              <button
                type="button"
                data-testid="pv2-adp-dept-settings"
                style={{
                  padding: "4px 9px",
                  borderRadius: 6,
                  border: "1px solid rgba(148,163,184,.24)",
                  background: "transparent",
                  color: "#94a3b8",
                  fontSize: "10px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                How departments are set
              </button>
            </div>
            {/* The mapping caveat — departments are only as good as the Entra
                attribute they are read from (proto 3347-3350). */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "9px 12px",
                borderRadius: 9,
                border: "1px solid rgba(194,166,61,.3)",
                background: "rgba(15,23,42,.4)",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  flex: "0 0 auto",
                  padding: "3px 9px",
                  borderRadius: 5,
                  border: "1px solid rgba(194,166,61,.5)",
                  background: "rgba(194,166,61,.12)",
                  fontSize: "10px",
                  fontWeight: 800,
                  color: "#e8c96a",
                  whiteSpace: "nowrap",
                  fontFamily: MONO,
                }}
              >
                {ADP_DEPT.coverage}
              </span>
              <span
                style={{
                  fontSize: "11px",
                  color: "#94a3b8",
                  lineHeight: 1.5,
                  flex: 1,
                  minWidth: 180,
                  textWrap: "pretty",
                }}
              >
                {ADP_DEPT.note}
              </span>
            </div>
            <div
              style={{
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 12,
                background: "rgba(15,23,42,.4)",
                padding: "12px 14px",
                overflow: "hidden",
              }}
              data-testid="pv2-adp-matrix"
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: MATRIX_GRID,
                  gap: 6,
                  paddingBottom: 8,
                }}
              >
                <span />
                {ADP_MATRIX.cols.map((c) => (
                  <span
                    key={c}
                    style={{
                      fontSize: "9px",
                      fontWeight: 700,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: "#64748b",
                      textAlign: "center",
                      lineHeight: 1.25,
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
              {ADP_MATRIX.rows.map((r) => (
                <div
                  key={r.dept}
                  style={{
                    display: "grid",
                    gridTemplateColumns: MATRIX_GRID,
                    gap: 6,
                    padding: "3px 0",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 0, minWidth: 0 }}
                  >
                    <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0" }}>
                      {r.dept}
                    </span>
                    <span style={{ fontSize: "9.5px", color: "#64748b" }}>{r.people} people</span>
                  </div>
                  {r.vals.map((v, i) => {
                    const { c, alpha } = adpMatrixCell(v);
                    return (
                      <span
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "7px 4px",
                          borderRadius: 6,
                          border: `1px solid ${c}44`,
                          background: `${c}${alpha}`,
                          fontSize: "11.5px",
                          fontWeight: 700,
                          color: c,
                          fontFamily: MONO,
                        }}
                      >
                        {v}%
                      </span>
                    );
                  })}
                </div>
              ))}
              <span
                style={{
                  display: "block",
                  paddingTop: 10,
                  fontSize: "10.5px",
                  color: "#64748b",
                  lineHeight: 1.5,
                  textWrap: "pretty",
                }}
              >
                {ADP_MATRIX_NOTE}
              </span>
            </div>
          </div>
        </div>

        {/* ── Plays (left) + wins/enablers/provenance (right) ────────────── */}
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
              <span style={SECTION_LABEL}>What would move these numbers · {ADP_PLAY_COUNT}</span>
              <span style={SECTION_NOTE}>
                Each one says who does the work and whether it costs you anything.
              </span>
            </div>
            {/* Who does the work and what it costs — the cost model, not the play
                taxonomy (proto 3380-3387). */}
            <div
              style={{ display: "flex", flexWrap: "wrap", gap: 14, padding: "0 2px 4px" }}
            >
              {ADP_KIND_LEGEND.map((kl) => (
                <div key={kl.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{ width: 9, height: 9, borderRadius: 2, background: kl.dot }}
                  />
                  <span style={{ fontSize: "10px", color: "#64748b", whiteSpace: "nowrap" }}>
                    {kl.label}
                  </span>
                </div>
              ))}
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
              data-testid="pv2-adp-plays"
            >
              {ADP_PLAYS.map((p, i) => {
                const isExpanded = expanded === i;
                const kind = ADP_KIND_META[p.kind];
                return (
                  <div
                    key={p.id}
                    style={{
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      gap: 0,
                      borderTop: "1px solid rgba(30,41,59,.85)",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 2,
                        background: `${ADP_ORANGE}88`,
                      }}
                    />
                    <button
                      onClick={() => setExpanded(isExpanded ? null : i)}
                      data-testid={`pv2-adp-play-${p.id}`}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: "13px 16px",
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      <span
                        style={{
                          flex: "0 0 auto",
                          display: "flex",
                          marginTop: 3,
                          transform: `rotate(${isExpanded ? 180 : -90}deg)`,
                          transition: "transform 180ms",
                        }}
                      >
                        <ChevronDown size={14} color="#64748b" aria-hidden="true" />
                      </span>
                      <div
                        style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                          <span
                            style={{
                              flex: "0 0 auto",
                              fontSize: "10.5px",
                              fontWeight: 700,
                              color: "#64748b",
                              letterSpacing: ".06em",
                              fontFamily: MONO,
                            }}
                          >
                            {p.id}
                          </span>
                          <span
                            style={{
                              flex: "0 0 auto",
                              padding: "2px 8px",
                              borderRadius: 4,
                              border: `1px solid ${kind.c}55`,
                              background: `${kind.c}14`,
                              fontSize: "9px",
                              fontWeight: 700,
                              letterSpacing: ".06em",
                              textTransform: "uppercase",
                              color: kind.c,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {kind.label}
                          </span>
                          <span
                            style={{
                              fontSize: "9.5px",
                              fontWeight: 600,
                              letterSpacing: ".04em",
                              color: "#64748b",
                            }}
                          >
                            {p.effort}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "#f1f5f9",
                            lineHeight: 1.45,
                            textWrap: "pretty",
                          }}
                        >
                          {p.title}
                        </span>
                        {/* now → target. No severity anywhere on this pillar. */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: "11px", color: "#94a3b8", fontFamily: MONO }}>
                            {p.now}
                          </span>
                          <span style={{ fontSize: "11px", color: ADP_ORANGE_TEXT }}>→</span>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              color: ADP_ORANGE_EYEBROW,
                              fontFamily: MONO,
                            }}
                          >
                            {p.target}
                          </span>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div
                        style={{
                          padding: "0 16px 16px 40px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: "12.5px",
                            color: "#cbd5e1",
                            lineHeight: 1.65,
                            textWrap: "pretty",
                          }}
                        >
                          {p.why}
                        </span>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))",
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 3,
                              padding: "11px 13px",
                              border: "1px solid rgba(249,115,22,.22)",
                              borderLeft: `2px solid ${ADP_ORANGE}`,
                              borderRadius: 8,
                              background: "rgba(249,115,22,.05)",
                            }}
                          >
                            <span style={{ ...MICRO_LABEL, color: ADP_ORANGE_EYEBROW }}>
                              Where the value is
                            </span>
                            <span
                              style={{
                                fontSize: "11.5px",
                                color: "#e2e8f0",
                                lineHeight: 1.55,
                                textWrap: "pretty",
                              }}
                            >
                              {p.upside}
                            </span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 3,
                              padding: "11px 13px",
                              border: "1px solid rgba(30,41,59,.9)",
                              borderRadius: 8,
                              background: "rgba(15,23,42,.5)",
                            }}
                          >
                            <span style={MICRO_LABEL}>Who it affects · cost position</span>
                            <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.55 }}>
                              {p.affects}
                            </span>
                            <span
                              style={{
                                fontSize: "11px",
                                color: "#94a3b8",
                                lineHeight: 1.5,
                                textWrap: "pretty",
                              }}
                            >
                              {p.value}
                            </span>
                          </div>
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))",
                            gap: "0 20px",
                          }}
                        >
                          {p.plan.map((pl) => (
                            <div
                              key={pl.k}
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
                                {pl.k}
                              </span>
                              <span
                                style={{
                                  fontSize: "12px",
                                  color: "#e2e8f0",
                                  lineHeight: 1.5,
                                  textWrap: "pretty",
                                }}
                              >
                                {pl.v}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
                            gap: 8,
                            paddingTop: 6,
                          }}
                        >
                          <button
                            onClick={() => openFixPanel(adpPlayFixKey(p))}
                            data-testid={`pv2-adp-action-${p.id}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 11,
                              textAlign: "left",
                              padding: "11px 13px",
                              borderRadius: 9,
                              border: "1px solid rgba(249,115,22,.45)",
                              background:
                                "linear-gradient(160deg, rgba(249,115,22,.14), rgba(15,23,42,.3))",
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            <span
                              style={{
                                flex: "0 0 28px",
                                width: 28,
                                height: 28,
                                borderRadius: 7,
                                border: "1px solid rgba(249,115,22,.45)",
                                background: "rgba(249,115,22,.16)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {/* trending-up, not a wrench — nothing is broken. */}
                              <TrendingUp size={13} color={ADP_ORANGE_TEXT} aria-hidden="true" />
                            </span>
                            <span
                              style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}
                            >
                              <span
                                style={{
                                  fontSize: "12.5px",
                                  fontWeight: 700,
                                  color: ADP_ORANGE_TEXT,
                                  lineHeight: 1.4,
                                }}
                              >
                                {p.actionLabel}
                              </span>
                              <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                                {p.actionSub}
                              </span>
                            </span>
                          </button>
                          <button
                            onClick={() => parkPlay(p)}
                            data-testid={`pv2-adp-park-${p.id}`}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              gap: 2,
                              textAlign: "left",
                              padding: "11px 13px",
                              borderRadius: 9,
                              border: "1px solid rgba(148,163,184,.25)",
                              background: "rgba(148,163,184,.05)",
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0" }}>
                              Not a priority this quarter
                            </span>
                            <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.45 }}>
                              Parks it with an owner and a revisit date — no risk is being accepted
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Parked toggle — proto 3449-3456. Defaults OPEN so the parked
                record is visible on arrival, the same way it renders today. */}
            <button
              onClick={() => setParkedOpen(!parkedOpen)}
              data-testid="pv2-adp-parked-toggle"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                width: "100%",
                marginTop: 6,
                padding: "13px 15px",
                borderRadius: 11,
                cursor: "pointer",
                fontFamily: "inherit",
                border: `1px solid rgba(148,163,184,${parkedOpen ? ".4" : ".2"})`,
                background: `linear-gradient(160deg,rgba(148,163,184,${parkedOpen ? ".1" : ".05"}),rgba(15,23,42,.5))`,
              }}
            >
              <span
                style={{
                  fontSize: "22px",
                  fontWeight: 800,
                  color: "#f8fafc",
                  letterSpacing: "-.02em",
                  fontFamily: MONO,
                }}
              >
                {ADP_PARKED_COUNT}
              </span>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  minWidth: 0,
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 800,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "#94a3b8",
                  }}
                >
                  Parked this quarter
                </span>
                <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.45 }}>
                  Deliberately not doing these, with an owner and a revisit date
                </span>
              </div>
              <span
                style={{
                  marginLeft: "auto",
                  flex: "0 0 auto",
                  display: "flex",
                  transform: `rotate(${parkedOpen ? 180 : 0}deg)`,
                  transition: "transform 180ms",
                }}
              >
                <ChevronDown size={13} color="#94a3b8" aria-hidden="true" />
              </span>
            </button>

            {/* Parked cards — GREY, not orange. proto 3458-3484. */}
            {parkedOpen && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
                  gap: 10,
                  marginTop: 6,
                }}
                data-testid="pv2-adp-parked"
              >
                {ADP_PARKED.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 9,
                    padding: "15px 16px",
                    border: "1px solid rgba(148,163,184,.2)",
                    borderRadius: 12,
                    background: "linear-gradient(160deg, rgba(148,163,184,.05), rgba(15,23,42,.5))",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 700,
                        color: "#64748b",
                        letterSpacing: ".06em",
                        fontFamily: MONO,
                      }}
                    >
                      {p.id}
                    </span>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        border: "1px solid rgba(148,163,184,.35)",
                        background: "rgba(148,163,184,.08)",
                        fontSize: "9.5px",
                        fontWeight: 700,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        color: "#cbd5e1",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.decision}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: "12.5px",
                      fontWeight: 700,
                      color: "#f1f5f9",
                      lineHeight: 1.45,
                    }}
                  >
                    {p.title}
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={MICRO_LABEL}>Reasoning</span>
                    <span
                      style={{
                        fontSize: "11.5px",
                        color: "#cbd5e1",
                        lineHeight: 1.55,
                        textWrap: "pretty",
                      }}
                    >
                      {p.rationale}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={MICRO_LABEL}>What parking it costs</span>
                    <span
                      style={{
                        fontSize: "11.5px",
                        color: "#cbd5e1",
                        lineHeight: 1.55,
                        textWrap: "pretty",
                      }}
                    >
                      {p.cost}
                    </span>
                  </div>
                  {/* THREE meta fields here, where Licensing and Compliance have four. */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit,minmax(96px,1fr))",
                      gap: 8,
                      paddingTop: 9,
                      borderTop: "1px solid rgba(148,163,184,.14)",
                    }}
                  >
                    {adpParkedMeta(p).map((m) => (
                      <div key={m.k} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <span
                          style={{
                            fontSize: "9.5px",
                            fontWeight: 700,
                            letterSpacing: ".07em",
                            textTransform: "uppercase",
                            color: "#64748b",
                          }}
                        >
                          {m.k}
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            color: "#e2e8f0",
                            fontFamily: MONO,
                          }}
                        >
                          {m.v}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Right column — proto 3447-3504 ───────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            {/* How far you have come — GREEN, the only positive-framed panel in
                the whole portal. Sized by movement: the bigger the win, the
                bigger the box (proto 3489-3505). */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: 9 }}
              data-testid="pv2-adp-wins"
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".16em",
                    textTransform: "uppercase",
                    color: "#34d399",
                  }}
                >
                  How far you have come
                </span>
                <span style={SECTION_NOTE}>Sized by how far each one moved</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 9, alignItems: "stretch" }}>
                {ADP_WINS.map((w) => {
                  const tier = adpWinTier(w.delta);
                  const flexGrow = [1, 1.4, 1.9][tier];
                  const flexBasis = [150, 190, 230][tier];
                  const pad = ["11px 13px", "13px 15px", "16px 17px"][tier];
                  const borderA = ["2b", "3d", "59"][tier];
                  const bgA = ["0d", "14", "1c"][tier];
                  const glow = [70, 90, 116][tier];
                  const deltaSize = [18, 23, 29][tier];
                  const whatSize = [11, 11.5, 12.5][tier];
                  return (
                    <div
                      key={w.what}
                      style={{
                        position: "relative",
                        overflow: "hidden",
                        flex: `${flexGrow} 1 ${flexBasis}px`,
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                        padding: pad,
                        borderRadius: 11,
                        border: `1px solid #34d399${borderA}`,
                        background: `linear-gradient(160deg,#34d399${bgA},rgba(15,23,42,.5))`,
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          right: -24,
                          top: -28,
                          width: glow,
                          height: glow,
                          borderRadius: "50%",
                          background: "radial-gradient(circle,#34d3992b,rgba(2,6,23,0) 70%)",
                          pointerEvents: "none",
                        }}
                      />
                      <span
                        style={{
                          position: "relative",
                          fontSize: `${deltaSize}px`,
                          fontWeight: 800,
                          letterSpacing: "-.02em",
                          color: "#34d399",
                          fontFamily: MONO,
                        }}
                      >
                        {w.delta}
                      </span>
                      <span
                        style={{
                          position: "relative",
                          fontSize: `${whatSize}px`,
                          fontWeight: 700,
                          color: "#e2e8f0",
                          lineHeight: 1.4,
                          textWrap: "pretty",
                        }}
                      >
                        {w.what}
                      </span>
                      <span
                        style={{
                          position: "relative",
                          fontSize: "10px",
                          color: "#64748b",
                          fontFamily: MONO,
                        }}
                      >
                        {w.from} → {w.to}
                      </span>
                      <span
                        style={{
                          position: "relative",
                          marginTop: "auto",
                          paddingTop: 5,
                          fontSize: "9.5px",
                          color: "#475569",
                        }}
                      >
                        {w.when}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* What makes plays land */}
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
              data-testid="pv2-adp-enablers"
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
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".16em",
                    textTransform: "uppercase",
                    color: "#64748b",
                  }}
                >
                  What makes plays land
                </span>
                <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                  The change-management scaffolding behind every item on the left.
                </span>
              </div>
              {ADP_ENABLERS.map((p) => {
                const c = ADP_TONE[p.tone];
                return (
                  <div
                    key={p.name}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "11px 14px",
                      borderBottom: "1px solid rgba(30,41,59,.8)",
                    }}
                  >
                    <div
                      style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                        <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0" }}>
                          {p.name}
                        </span>
                        <span
                          style={{
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
                          }}
                        >
                          {p.status}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          color: "#94a3b8",
                          lineHeight: 1.5,
                          textWrap: "pretty",
                        }}
                      >
                        {p.detail}
                      </span>
                    </div>
                    <button
                      /* "Work on this", not "Fix this" — proto 3472. */
                      title="Work on this"
                      onClick={() => openFixPanel(p.fixKey)}
                      data-testid={`pv2-adp-enabler-${p.fixKey}`}
                      style={{
                        flex: "0 0 28px",
                        width: 28,
                        height: 28,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 7,
                        border: "1px solid rgba(249,115,22,.4)",
                        background: "rgba(249,115,22,.12)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <TrendingUp size={13} color={ADP_ORANGE_TEXT} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Where the numbers come from */}
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
              data-testid="pv2-adp-provenance"
            >
              <button
                onClick={() => setProvOpen(!provOpen)}
                data-testid="pv2-adp-provenance-toggle"
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
                <span
                  style={{
                    flex: "0 0 auto",
                    display: "flex",
                    transform: `rotate(${provOpen ? 180 : -90}deg)`,
                    transition: "transform 180ms",
                  }}
                >
                  <ChevronDown size={13} color="#64748b" aria-hidden="true" />
                </span>
                <span
                  style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}
                >
                  <span
                    style={{
                      fontSize: "9.5px",
                      fontWeight: 700,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: "#64748b",
                    }}
                  >
                    Where the numbers come from
                  </span>
                  <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                    Usage reports and policy reads — no surveys, no self-assessment.
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
                  {ADP_PROV.map((q) => {
                    const m = GOV_SRC_META[q.src];
                    return (
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
                          style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}
                        >
                          <span
                            style={{
                              flex: "0 0 auto",
                              padding: "2px 7px",
                              borderRadius: 4,
                              border: `1px solid ${m.c}55`,
                              background: `${m.c}14`,
                              fontSize: "9px",
                              fontWeight: 700,
                              letterSpacing: ".08em",
                              textTransform: "uppercase",
                              color: m.c,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {m.label}
                          </span>
                          <span
                            style={{
                              fontSize: "10.5px",
                              fontWeight: 600,
                              color: m.c,
                              fontFamily: MONO,
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
                            fontFamily: MONO,
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
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {fixKey && (
        <FixPanel
          fixKey={fixKey}
          onClose={closeFixPanel}
          onAskShaneBot={(playbook) =>
            askShaneBot(`Explain this finding to me before I approve the change: ${playbook.title}`)
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
    </PortalV2Shell>
  );
}
