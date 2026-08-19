/**
 * portal-v2-licensing.tsx — the Licensing pillar dashboard.
 *
 * A direct port of the prototype's `isLicensing` block
 * (`Customer Portal Shell.dc.html` lines 3508-3806) and its logic (12275-12600).
 *
 * ── This pillar shares almost nothing with the other three ─────────────────
 * The prototype's own source comment says why: "This pillar is a money page, not
 * a risk page." Checked element by element rather than assumed:
 *
 *  • The CONTAINER is `max-width:1320px; padding:26px 26px 48px; gap:18` — the
 *    drill-down template's frame, not the `1180 / 28px 28px 56px / gap:22` the
 *    other three pillar heroes use. It needs the width for a 7-column table.
 *  • There is NO scan strip, NO status pill and NO cluster area-card grid.
 *  • The hero's left column is an EYEBROW ("Money on the table"), a 38px mono
 *    figure and a sentence — not a title / subtitle / status triple. There is no
 *    "Licensing Health" heading anywhere on the page.
 *  • The ring delta is GREEN (#34d399) and positive. Every other pillar's is red
 *    or muted.
 *  • The trend has its OWN maths — see `licTrendGeometry`. Reusing DriftTrend
 *    would draw a different line, so it is deliberately not used here.
 *  • It is the only pillar HERO with a provenance block, which the README
 *    places on drill-downs only.
 *  • Its stat grid is `minmax(140px,1fr)` — Governance and Compliance are 130,
 *    Security 110 — and the third stat renders at 15px because it is a date.
 *
 * ── What it does share, and only after checking ────────────────────────────
 * The `.pv2-gov-grid` two-column split (1.7fr / 1fr) and the drill-down's
 * provenance-block markup. Both are the same values, so they are the same class
 * and the same shapes rather than near-copies.
 *
 * ── The one sanctioned deviation from the prototype's copy ─────────────────
 * The third recovery bucket reads "£1,470-worth" in the prototype (3611) — a
 * pound sign on a page denominated in dollars everywhere else, including that
 * same sentence's own "$1,470/mo" value. It was flagged rather than silently
 * corrected, and Shane confirmed on 2026-08-19 that it should be "$". The
 * "copy is final" rule was not bypassed here; it was overruled by the copy's
 * owner, which is the only way it should ever move. Manifest step L5b asserts
 * the corrected string so a future re-transcription cannot quietly undo it.
 */

import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown, Wrench } from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { FixPanel, useFixPanel } from "@/components/portal-v2/FixPanel";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { useAcceptRisk } from "@/components/portal-v2/AcceptRiskPanel";
import { GOV_SRC_META } from "@/components/portal-v2/govPages";
import {
  LIC_ACK,
  LIC_ACK_COUNT,
  LIC_BUCKETS,
  LIC_FINDINGS,
  LIC_FINDING_COUNT,
  LIC_HERO,
  LIC_HERO_STATS,
  LIC_LEDGER,
  LIC_POLICY,
  LIC_PROV,
  LIC_SKUS,
  LIC_TEAL,
  LIC_TONE,
  LIC_TOTALS,
  licAckMeta,
  licFmt,
  licSkuGeometry,
  licTrendGeometry,
  type LicFinding,
} from "@/components/portal-v2/licDashboardData";

const MONO = "'SF Mono',Menlo,Consolas,monospace";
/** The lighter teal used for figures and eyebrows. */
const TEAL_TEXT = "#2dd4bf";
const TEAL_EYEBROW = "#5eead4";

/** The ledger's column template. Header, every row and the totals row MUST share it. */
const LEDGER_GRID =
  "minmax(180px,1.7fr) repeat(3,minmax(58px,.4fr)) minmax(64px,.45fr) minmax(96px,.7fr) minmax(96px,.7fr)";

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "#64748b",
};

const SECTION_NOTE: React.CSSProperties = { fontSize: "10.5px", color: "#475569" };

const LEDGER_HEAD: React.CSSProperties = {
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "#64748b",
  textAlign: "right",
};

const MICRO_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  color: "#64748b",
};

export default function PortalV2LicensingPage() {
  const trend = licTrendGeometry();
  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC - (LIC_HERO.score / 100) * ringC;

  const [expanded, setExpanded] = useState<number | null>(null);
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
   * `f.ackGo` (12435-12444). Licensing overrides every default on the drawer,
   * as Compliance does — but to different words again. Here accepting is not
   * "I accept this risk" or "I am recording a policy position"; it is "this
   * spend is intentional", and the confirmation says planned cost rather than
   * recoverable waste.
   */
  const acknowledgeSpend = (f: LicFinding) => {
    const annual = f.monthly * 12;
    openAcceptRisk({
      title: f.title,
      description: f.why,
      details: `${licFmt(f.monthly)} per month, ${licFmt(annual)} per year. ${f.timing}. Marking this as intentional keeps the spend and records why, so it stops appearing as waste on every future scan and shows up in the finance review as a decision rather than an oversight.`,
      kicker: "Acknowledge intentional spend",
      descLabel: "What you are keeping",
      detailsLabel: "Cost of keeping it",
      confirmText:
        "I confirm this spend is intentional, with a named owner and a review date, and I want it recorded as planned cost rather than recoverable waste.",
      btnLabel: "Record as intentional spend",
    });
  };

  return (
    <PortalV2Shell eyebrow="Pillar" title="Licensing">
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
        {/* Page glow — proto 3510. Teal, and 52% tall against Gov/Sec's 56%. */}
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
            background: "radial-gradient(ellipse at top, rgba(20,184,166,.18), rgba(2,6,23,0) 68%)",
          }}
        />

        {/* ── Back link + finance strip — proto 3512-3522 ────────────────── */}
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
            data-testid="pv2-lic-back"
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
              border: "1px solid rgba(20,184,166,.3)",
              borderRadius: 9,
              background: "rgba(20,184,166,.06)",
            }}
          >
            <span style={{ fontSize: "15px", fontWeight: 800, color: TEAL_TEXT, fontFamily: MONO }}>
              {LIC_HERO.ackMonthly}/mo
            </span>
            <span style={{ fontSize: "11.5px", color: "#94a3b8", whiteSpace: "nowrap" }}>
              recorded as intentional spend · {LIC_ACK_COUNT} decisions
            </span>
            {/* The prototype makes this an <a href="#">, not a button (3521) —
                every other pillar's equivalent is a button. Rendered as a real
                link with no destination yet, since the finance register is a
                later phase. */}
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              data-testid="pv2-lic-finance-register-link"
              style={{
                fontSize: "11.5px",
                fontWeight: 600,
                color: TEAL_TEXT,
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
            >
              Finance register →
            </a>
          </div>
        </div>

        {/* ── Hero card — proto 3524-3591 ────────────────────────────────── */}
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
            background: "linear-gradient(160deg, rgba(20,184,166,.1), rgba(15,23,42,.5))",
          }}
          data-testid="pv2-lic-hero"
        >
          <div
            style={{
              position: "absolute",
              left: -60,
              top: -90,
              width: 320,
              height: 320,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(20,184,166,.26), rgba(2,6,23,0) 70%)",
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
              background: "radial-gradient(circle, rgba(20,184,166,.14), rgba(2,6,23,0) 70%)",
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
            {/* No title, no subtitle, no status pill — an eyebrow and a figure. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 260 }}>
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: TEAL_EYEBROW,
                }}
              >
                {LIC_HERO.eyebrow}
              </span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: "38px",
                    fontWeight: 800,
                    letterSpacing: "-.03em",
                    color: "#f8fafc",
                    lineHeight: 1,
                    fontFamily: MONO,
                  }}
                  data-testid="pv2-lic-on-table"
                >
                  {LIC_HERO.onTable}
                </span>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#94a3b8" }}>/month</span>
              </div>
              <span style={{ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.5 }}>
                {LIC_HERO.onTableSentence}
              </span>
            </div>

            {/* Trend — its own geometry, and a caption below the rule. */}
            <div
              style={{
                flex: "1 1 260px",
                minWidth: 220,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
              data-testid="pv2-lic-trend"
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
                {LIC_HERO.trendLabel}
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
                    <linearGradient id="licTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={LIC_TEAL} stopOpacity={0.38} />
                      <stop offset="100%" stopColor={LIC_TEAL} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <path d={trend.area} fill="url(#licTrendFill)" />
                  <polyline
                    points={trend.line}
                    fill="none"
                    stroke={LIC_TEAL}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                {/* Dot in its own unscaled overlay, same reason as DriftTrend's. */}
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
                    fill={TEAL_EYEBROW}
                  />
                </svg>
                <div style={{ height: 1, background: "rgba(148,163,184,.14)" }} />
                <span
                  style={{ display: "block", paddingTop: 5, fontSize: "10.5px", color: "#64748b" }}
                >
                  {LIC_HERO.trendCaption}
                </span>
              </div>
            </div>
          </div>

          {/* Ring + three stats at minmax(140px,1fr) — proto 3557-3589. */}
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
                    background: "radial-gradient(circle, rgba(20,184,166,.3), rgba(2,6,23,0) 72%)",
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
                    stroke={LIC_TEAL}
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
                      color: TEAL_TEXT,
                      fontFamily: MONO,
                    }}
                    data-testid="pv2-lic-score"
                  >
                    {LIC_HERO.score}
                  </span>
                  {/* GREEN and positive — the only pillar where it is. */}
                  <span
                    style={{ fontSize: "9.5px", fontWeight: 700, color: "#34d399", fontFamily: MONO }}
                  >
                    {LIC_HERO.delta}
                  </span>
                </div>
              </div>
            </div>

            {LIC_HERO_STATS.map((s) => (
              <div
                key={s.label}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "2px 16px",
                  borderLeft: `2px solid ${LIC_TEAL}`,
                  justifyContent: "center",
                }}
                data-testid={`pv2-lic-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div
                  style={{
                    position: "absolute",
                    left: -30,
                    top: -30,
                    width: 110,
                    height: 110,
                    borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(20,184,166,.2), rgba(2,6,23,0) 70%)",
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
                  style={
                    s.small
                      ? {
                          // The renewal DATE renders at 15px with -.01em and no
                          // mono stack — it is prose, not a figure (proto 3587).
                          position: "relative",
                          fontSize: "15px",
                          fontWeight: 800,
                          color: "#f8fafc",
                          letterSpacing: "-.01em",
                          lineHeight: 1.3,
                        }
                      : {
                          position: "relative",
                          fontSize: "22px",
                          fontWeight: 800,
                          color: "#f8fafc",
                          letterSpacing: "-.02em",
                          fontFamily: MONO,
                        }
                  }
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

        {/* ── The three recovery buckets — proto 3593-3612 ───────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))",
            gap: 10,
          }}
          data-testid="pv2-lic-buckets"
        >
          {LIC_BUCKETS.map((b) => (
            <div
              key={b.label}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 7,
                padding: "14px 16px",
                border: "1px solid rgba(20,184,166,.24)",
                borderLeft: `2px solid ${LIC_TEAL}`,
                borderRadius: 10,
                background: "linear-gradient(160deg, rgba(20,184,166,.07), rgba(15,23,42,.45))",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: TEAL_EYEBROW,
                  }}
                >
                  {b.label}
                </span>
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".05em",
                    textTransform: "uppercase",
                    color: "#64748b",
                    whiteSpace: "nowrap",
                  }}
                >
                  {b.when}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: "22px",
                    fontWeight: 800,
                    color: "#f8fafc",
                    letterSpacing: "-.02em",
                    fontFamily: MONO,
                  }}
                >
                  {b.value}
                </span>
                <span
                  style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", fontFamily: MONO }}
                >
                  {b.annual}
                </span>
              </div>
              <span
                style={{
                  fontSize: "11.5px",
                  color: "#94a3b8",
                  lineHeight: 1.55,
                  textWrap: "pretty",
                }}
              >
                {b.what}
              </span>
            </div>
          ))}
        </div>

        {/* ── The licence ledger — proto 3614-3650 ───────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span style={SECTION_LABEL}>Licence ledger · what you buy against what runs</span>
            <span style={SECTION_NOTE}>
              Purchased and consumed from subscribedSkus. Active is 30-day service or app activity,
              not sign-in.
            </span>
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
            data-testid="pv2-lic-ledger"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: LEDGER_GRID,
                gap: 12,
                padding: "9px 16px",
                borderBottom: "1px solid rgba(30,41,59,.9)",
                background: "rgba(20,184,166,.06)",
              }}
            >
              <span style={{ ...LEDGER_HEAD, textAlign: "left" }}>SKU</span>
              <span style={LEDGER_HEAD}>Bought</span>
              <span style={LEDGER_HEAD}>Assigned</span>
              <span style={LEDGER_HEAD}>Active</span>
              <span style={LEDGER_HEAD}>Unit</span>
              <span style={LEDGER_HEAD}>Waste</span>
              <span style={LEDGER_HEAD}>Timing</span>
            </div>

            {LIC_SKUS.map((s) => {
              const g = licSkuGeometry(s);
              return (
                <div
                  key={s.part}
                  style={{
                    display: "grid",
                    gridTemplateColumns: LEDGER_GRID,
                    gap: 12,
                    padding: "10px 16px",
                    borderBottom: "1px solid rgba(30,41,59,.8)",
                    alignItems: "start",
                  }}
                  data-testid={`pv2-lic-sku-${s.part}`}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span
                      style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.35 }}
                    >
                      {s.sku}
                    </span>
                    <span style={{ fontSize: "10px", color: "#64748b", fontFamily: MONO }}>
                      {s.part}
                    </span>
                    <span
                      style={{
                        fontSize: "10.5px",
                        color: "#94a3b8",
                        lineHeight: 1.45,
                        textWrap: "pretty",
                      }}
                    >
                      {s.note}
                    </span>
                    {/* Utilisation is active / PURCHASED — the ratio that maps
                        to the invoice, not active / assigned. */}
                    <div
                      style={{
                        position: "relative",
                        height: 4,
                        borderRadius: 2,
                        background: "rgba(148,163,184,.14)",
                        overflow: "hidden",
                        marginTop: 5,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          borderRadius: 2,
                          width: `${g.util}%`,
                          background: g.c,
                          opacity: 0.85,
                        }}
                      />
                    </div>
                  </div>
                  <span style={{ fontSize: "12px", color: "#94a3b8", textAlign: "right", fontFamily: MONO }}>
                    {s.purchased}
                  </span>
                  <span style={{ fontSize: "12px", color: "#94a3b8", textAlign: "right", fontFamily: MONO }}>
                    {s.assigned}
                  </span>
                  <span style={{ fontSize: "12px", color: "#e2e8f0", textAlign: "right", fontFamily: MONO }}>
                    {s.active}
                  </span>
                  <span style={{ fontSize: "12px", color: "#94a3b8", textAlign: "right", fontFamily: MONO }}>
                    {g.unitLabel}
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: s.waste ? g.c : "#475569",
                      fontFamily: MONO,
                      textAlign: "right",
                    }}
                  >
                    {g.wasteLabel}
                  </span>
                  <span style={{ display: "flex", justifyContent: "flex-end" }}>
                    <span
                      style={{
                        flex: "0 0 auto",
                        padding: "2px 7px",
                        borderRadius: 4,
                        border: `1px solid ${g.c}55`,
                        background: `${g.c}14`,
                        fontSize: "9px",
                        fontWeight: 700,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        color: g.c,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.timing}
                    </span>
                  </span>
                </div>
              );
            })}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: LEDGER_GRID,
                gap: 12,
                padding: "11px 16px",
                background: "rgba(20,184,166,.07)",
                alignItems: "center",
              }}
              data-testid="pv2-lic-ledger-total"
            >
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: TEAL_EYEBROW,
                }}
              >
                Total
              </span>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0", textAlign: "right", fontFamily: MONO }}>
                {LIC_TOTALS.purchased}
              </span>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0", textAlign: "right", fontFamily: MONO }}>
                {LIC_TOTALS.assigned}
              </span>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0", textAlign: "right", fontFamily: MONO }}>
                {LIC_TOTALS.active}
              </span>
              <span />
              <span style={{ fontSize: "12.5px", fontWeight: 800, color: TEAL_TEXT, textAlign: "right", fontFamily: MONO }}>
                {licFmt(LIC_TOTALS.waste)}/mo
              </span>
              <span />
            </div>
          </div>
        </div>

        {/* ── Recovery items (left) + ledger/policy/provenance (right) ───── */}
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
              <span style={SECTION_LABEL}>Recovery items · {LIC_FINDING_COUNT}</span>
              <span style={SECTION_NOTE}>
                Every item carries its monthly figure, its annualised figure, and when it reaches
                the bill.
              </span>
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
              data-testid="pv2-lic-recovery"
            >
              {LIC_FINDINGS.map((f, i) => {
                const isExpanded = expanded === i;
                const annual = f.monthly * 12;
                return (
                  <div
                    key={f.id}
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
                        background: `${LIC_TEAL}88`,
                      }}
                    />
                    <button
                      onClick={() => setExpanded(isExpanded ? null : i)}
                      data-testid={`pv2-lic-item-${f.id}`}
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
                        style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}
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
                            {f.id}
                          </span>
                          <span
                            style={{
                              fontSize: "9.5px",
                              fontWeight: 700,
                              letterSpacing: ".05em",
                              textTransform: "uppercase",
                              color: TEAL_EYEBROW,
                            }}
                          >
                            {f.timing}
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
                          {f.title}
                        </span>
                      </div>
                      <div
                        style={{
                          flex: "0 0 auto",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 1,
                        }}
                      >
                        <span
                          style={{
                            fontSize: "16px",
                            fontWeight: 800,
                            color: TEAL_TEXT,
                            letterSpacing: "-.02em",
                            fontFamily: MONO,
                          }}
                        >
                          {licFmt(f.monthly)}/mo
                        </span>
                        <span
                          style={{
                            fontSize: "10.5px",
                            fontWeight: 600,
                            color: "#64748b",
                            fontFamily: MONO,
                          }}
                        >
                          {licFmt(annual)}/yr
                        </span>
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
                          {f.why}
                        </span>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))",
                            gap: "0 20px",
                          }}
                        >
                          {f.evidence.map((e) => (
                            <div
                              key={e.k}
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
                                {e.k}
                              </span>
                              <span
                                style={{
                                  fontSize: "12px",
                                  color: "#e2e8f0",
                                  lineHeight: 1.5,
                                  textWrap: "pretty",
                                }}
                              >
                                {e.v}
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
                            onClick={() => openFixPanel(f.fixKey)}
                            data-testid={`pv2-lic-fix-${f.fixKey}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 11,
                              textAlign: "left",
                              padding: "11px 13px",
                              borderRadius: 9,
                              border: "1px solid rgba(20,184,166,.45)",
                              background:
                                "linear-gradient(160deg, rgba(20,184,166,.14), rgba(15,23,42,.3))",
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
                                border: "1px solid rgba(20,184,166,.45)",
                                background: "rgba(20,184,166,.16)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Wrench size={13} color={TEAL_TEXT} aria-hidden="true" />
                            </span>
                            <span
                              style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}
                            >
                              {/* "Recover $X/mo — <action>" is one string in the
                                  prototype's own template (3690). */}
                              <span
                                style={{
                                  fontSize: "12.5px",
                                  fontWeight: 700,
                                  color: TEAL_TEXT,
                                  lineHeight: 1.4,
                                }}
                              >
                                Recover {licFmt(f.monthly)}/mo — {f.action}
                              </span>
                              <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                                {f.actionSub}
                              </span>
                            </span>
                          </button>
                          <button
                            onClick={() => acknowledgeSpend(f)}
                            data-testid={`pv2-lic-ack-${f.id}`}
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
                              This spend is intentional
                            </span>
                            <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.45 }}>
                              Records owner, rationale and review date, and takes it off the waste
                              list
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Intentional-spend cards — proto 3705-3740. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
                gap: 10,
                marginTop: 6,
              }}
              data-testid="pv2-lic-ack-cards"
            >
              {LIC_ACK.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 9,
                    padding: "15px 16px",
                    border: "1px solid rgba(20,184,166,.22)",
                    borderRadius: 12,
                    background: "linear-gradient(160deg, rgba(20,184,166,.06), rgba(15,23,42,.5))",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          color: "#64748b",
                          letterSpacing: ".06em",
                          fontFamily: MONO,
                        }}
                      >
                        {a.id}
                      </span>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          border: "1px solid rgba(20,184,166,.4)",
                          background: "rgba(20,184,166,.1)",
                          fontSize: "9.5px",
                          fontWeight: 700,
                          letterSpacing: ".06em",
                          textTransform: "uppercase",
                          color: TEAL_TEXT,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Intentional spend
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 0,
                      }}
                    >
                      <span
                        style={{ fontSize: "14px", fontWeight: 800, color: "#e2e8f0", fontFamily: MONO }}
                      >
                        {licFmt(a.monthly)}/mo
                      </span>
                      <span style={{ fontSize: "10px", color: "#64748b", fontFamily: MONO }}>
                        {licFmt(a.monthly * 12)}/yr
                      </span>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: "12.5px",
                      fontWeight: 700,
                      color: "#f1f5f9",
                      lineHeight: 1.45,
                      textWrap: "pretty",
                    }}
                  >
                    {a.title}
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={MICRO_LABEL}>Rationale</span>
                    <span
                      style={{
                        fontSize: "11.5px",
                        color: "#cbd5e1",
                        lineHeight: 1.55,
                        textWrap: "pretty",
                      }}
                    >
                      {a.rationale}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={MICRO_LABEL}>Cost of keeping it versus releasing it</span>
                    <span
                      style={{
                        fontSize: "11.5px",
                        color: "#cbd5e1",
                        lineHeight: 1.55,
                        textWrap: "pretty",
                      }}
                    >
                      {a.offset}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                      paddingTop: 9,
                      borderTop: "1px solid rgba(20,184,166,.16)",
                    }}
                  >
                    {licAckMeta(a).map((m) => (
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
                            fontSize: "11.5px",
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
          </div>

          {/* ── Right column — proto 3743-3804 ───────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            {/* Savings ledger */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                border: "1px solid rgba(20,184,166,.25)",
                borderRadius: 12,
                background: "rgba(20,184,166,.04)",
                overflow: "hidden",
              }}
              data-testid="pv2-lic-savings"
            >
              <div
                style={{
                  padding: "11px 14px",
                  borderBottom: "1px solid rgba(20,184,166,.16)",
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".16em",
                    textTransform: "uppercase",
                    color: TEAL_EYEBROW,
                  }}
                >
                  Savings ledger
                </span>
                <span
                  style={{ fontSize: "11px", fontWeight: 700, color: TEAL_TEXT, fontFamily: MONO }}
                >
                  {LIC_HERO.recoveredTotal}/mo
                </span>
              </div>
              {LIC_LEDGER.map((l) => (
                <div
                  key={l.what}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 14px",
                    borderBottom: "1px solid rgba(20,184,166,.1)",
                  }}
                >
                  <div
                    style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}
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
                      {l.what}
                    </span>
                    <span style={{ fontSize: "10.5px", color: "#64748b" }}>
                      {l.when} · {l.by}
                    </span>
                  </div>
                  <span
                    style={{
                      flex: "0 0 auto",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#34d399",
                      fontFamily: MONO,
                    }}
                  >
                    {licFmt(l.amount)}/mo
                  </span>
                </div>
              ))}
            </div>

            {/* Why the waste recurs */}
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
              data-testid="pv2-lic-policy"
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
                  Why the waste recurs
                </span>
                <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                  Settings and process gaps that refill this page every quarter.
                </span>
              </div>
              {LIC_POLICY.map((p) => {
                const c = LIC_TONE[p.tone];
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
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}
                      >
                        <span
                          style={{
                            fontSize: "11.5px",
                            fontWeight: 700,
                            color: "#e2e8f0",
                            overflowWrap: "break-word",
                          }}
                        >
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
                      title="Fix this"
                      onClick={() => openFixPanel(p.fixKey)}
                      data-testid={`pv2-lic-policy-fix-${p.fixKey}`}
                      style={{
                        flex: "0 0 28px",
                        width: 28,
                        height: 28,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 7,
                        border: "1px solid rgba(20,184,166,.4)",
                        background: "rgba(20,184,166,.12)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <Wrench size={13} color={TEAL_TEXT} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* How the figures are derived — the only provenance block on a hero. */}
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
              data-testid="pv2-lic-provenance"
            >
              <button
                onClick={() => setProvOpen(!provOpen)}
                data-testid="pv2-lic-provenance-toggle"
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
                    How the figures are derived
                  </span>
                  <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>
                    Every dollar traces to a call, a unit cost, and a billing term.
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
                  {LIC_PROV.map((q) => {
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
