/**
 * portal-v2-compliance.tsx — the Compliance pillar dashboard.
 *
 * A direct port of the prototype's `isCompliance` block
 * (`Customer Portal Shell.dc.html` lines 3809-4063), read against its own markup
 * rather than adapted from Governance or Security.
 *
 * ── The README is RIGHT here, and it was wrong on the other two ─────────────
 * The Governance pass established that Governance and Security build a findings
 * array no template consumes, so neither renders finding rows. Compliance is the
 * opposite case and the README's "finding rows" line is accurate: `cmpFindingRows`
 * IS rendered, and it is the largest section on the page. Carrying the earlier
 * finding across as a rule would have deleted the richest part of this pillar.
 *
 * ── What only Compliance has ───────────────────────────────────────────────
 *  1. "Why this pillar reads differently" (3891-3906) — a prose panel plus three
 *     scrutiny-moment cards. No other pillar explains itself.
 *  2. Open Gaps (3950-4011) — expandable finding rows citing the obligation each
 *     one touches, with an evidence grid, a wrench into the CR gate, and a
 *     "Record a policy decision instead" route.
 *  3. Documented Policy Decisions (4013-4046) — accepted risks rendered IN FULL,
 *     with rationale, compensating control, owner, approval and review dates.
 *  4. Obligations We Check Against (4048-4062) — the frameworks in scope and
 *     where the tenant stands against each.
 *
 * ── And what differs inside the parts that look shared ─────────────────────
 *  • The page glow is `min(900px,140%)` / 44% / blur(70px) / opacity .55 with a
 *    THREE-stop gradient. Governance and Security are `min(1000px,150%)` / 56% /
 *    blur(80px) / .5 with two stops.
 *  • Every panel carries `cmpInset`, a 1px top highlight no other pillar has.
 *  • The status pill is a 5px DOT plus "Stable · 6 gaps open" — not a ⚠ glyph
 *    plus a single word, so the emoji substitution the other two pillars needed
 *    does not arise here at all.
 *  • The trend is labelled "Gaps closed · last 10 scans", not "Drift trend", and
 *    its caption sits BELOW the baseline rule where Security's verdict sits
 *    ABOVE the chart. Different slot, so `DriftTrend` is not reused — see below.
 *  • The ring track is `rgba(148,163,184,.16)` against the others' `.14`, its
 *    glow inset is -14 against -18, and its delta is a hardcoded "±0 this month"
 *    rather than a derived value.
 *  • The scan strip's dot does NOT pulse and its sentence is "N gaps closed in
 *    Compliance since scan 1, none reopened".
 *  • The area cards share Governance's anatomy but not one of its numbers: a
 *    neutral background gradient rather than the status wash, an extra
 *    `border-top`, a `130% 90%` glow at `16` rather than `140% 100%` at `1c`,
 *    24/19/16 score sizes rather than 26/20/17, `min-width:112px`, an inset
 *    shadow, and a cursor that depends on whether the card has a gap to open.
 *    Two clear implementations beat one component with a dozen props.
 */

import { useState } from "react";
import { Link } from "wouter";
import {
  Activity,
  CheckCircle,
  ChevronDown,
  ClipboardList,
  FileText,
  Layers,
  Lock,
  Scale,
  ShieldCheck,
  ShieldOff,
  Users,
  Wrench,
} from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { FixPanel, useFixPanel } from "@/components/portal-v2/FixPanel";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { useAcceptRisk } from "@/components/portal-v2/AcceptRiskPanel";
import { trendGeometry } from "@/components/portal-v2/DriftTrend";
import {
  CMP_ACCEPTED,
  CMP_ACCEPTED_COUNT,
  CMP_AREA_LINKS,
  CMP_CLUSTERS,
  CMP_FINDINGS,
  CMP_HERO,
  CMP_HERO_STATS,
  CMP_HISTORY,
  CMP_INSET,
  CMP_INTRO_BODY,
  CMP_INTRO_LABEL,
  CMP_OBLIGATIONS,
  CMP_OBLIGATION_TONE,
  CMP_OPEN_COUNT,
  CMP_SCRUTINY,
  CMP_SEV_META,
  CMP_TIER,
  cmpAcceptedMeta,
  cmpAreaGeometry,
  type CmpAreaLink,
  type CmpFinding,
} from "@/components/portal-v2/cmpDashboardData";

const MONO = "'SF Mono',Menlo,Consolas,monospace";
/** The trend + ring stroke. Compliance's near-white identity. */
const PAPER = "#E2E8F0";

const AREA_ICON = {
  "clipboard-list": ClipboardList,
  "file-text": FileText,
  scale: Scale,
  lock: Lock,
  "shield-check": ShieldCheck,
  layers: Layers,
  "shield-off": ShieldOff,
  activity: Activity,
  "check-circle": CheckCircle,
  users: Users,
} as const;

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "#64748b",
};

const SECTION_NOTE: React.CSSProperties = { fontSize: "11px", color: "#475569" };

const MICRO_LABEL: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  color: "#64748b",
};

export default function PortalV2CompliancePage() {
  const trend = trendGeometry(CMP_HISTORY);
  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC - (CMP_HERO.score / 100) * ringC;

  const [expanded, setExpanded] = useState<number | null>(null);
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
   * `f.acceptGo` (12186-12195). Compliance overrides FIVE of the accept-risk
   * drawer's defaults — kicker, both labels, the confirmation sentence and the
   * button — because on this pillar accepting is not "I accept this risk", it is
   * "I am recording a deliberate policy position". Those overrides are the whole
   * reason `AcceptRiskSpec` carries them.
   */
  const recordDecision = (f: CmpFinding) =>
    openAcceptRisk({
      title: f.title,
      description: f.why,
      details: `Obligation this touches: ${f.obligation}. ${f.obligationText} Recording a decision here does not remove the obligation — it documents that you considered it, chose a position, and named someone accountable for reviewing that position.`,
      kicker: "Record a policy decision",
      descLabel: "What you are deciding about",
      detailsLabel: "Obligation on record",
      confirmText:
        "I am recording this as a deliberate policy position on behalf of the organisation, with a named owner and a review date, and I understand it will appear in the audit trail as a documented decision.",
      btnLabel: "Record this decision",
    });

  return (
    <PortalV2Shell eyebrow="Pillar" title="Compliance">
      <div
        style={{
          position: "relative",
          maxWidth: 1180,
          margin: "0 auto",
          padding: "28px 28px 56px",
          display: "flex",
          flexDirection: "column",
          gap: 22,
          boxSizing: "border-box",
        }}
      >
        {/* Page glow — proto 3811. Smaller, softer and three-stop. */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "-6%",
            width: "min(900px,140%)",
            height: "44%",
            transform: "translateX(-50%)",
            filter: "blur(70px)",
            opacity: 0.55,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse at top, rgba(226,232,240,.12), rgba(148,163,184,.07) 45%, rgba(2,6,23,0) 70%)",
          }}
        />

        {/* ── Back link + decisions-on-record strip — proto 3813-3823 ────── */}
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
            data-testid="pv2-cmp-back"
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
              border: "1px solid rgba(226,232,240,.2)",
              borderRadius: 9,
              background: "rgba(226,232,240,.05)",
            }}
          >
            <span style={{ fontSize: "15px", fontWeight: 800, color: "#e2e8f0", fontFamily: MONO }}>
              {CMP_ACCEPTED_COUNT}
            </span>
            {/* Not "finding risk-accepted in X" — this pillar counts DECISIONS. */}
            <span style={{ fontSize: "11.5px", color: "#94a3b8", whiteSpace: "nowrap" }}>
              documented policy decisions on record
            </span>
            <button
              type="button"
              data-testid="pv2-cmp-risk-register-link"
              style={{
                padding: 0,
                border: "none",
                background: "none",
                fontFamily: "inherit",
                cursor: "pointer",
                fontSize: "11.5px",
                fontWeight: 600,
                color: "#cbd5e1",
                whiteSpace: "nowrap",
              }}
            >
              View risk register →
            </button>
          </div>
        </div>

        {/* ── Hero card — proto 3825-3889 ────────────────────────────────── */}
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            gap: 20,
            padding: 24,
            border: "1px solid rgba(226,232,240,.18)",
            borderRadius: 14,
            background: "linear-gradient(160deg, rgba(226,232,240,.06), rgba(15,23,42,.55))",
            boxShadow: CMP_INSET,
          }}
          data-testid="pv2-cmp-hero"
        >
          <div
            style={{
              position: "absolute",
              left: -30,
              top: -70,
              width: 220,
              height: 220,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(226,232,240,.16), rgba(148,163,184,.07) 42%, rgba(2,6,23,0) 72%)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: -30,
              bottom: -80,
              width: 190,
              height: 190,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(226,232,240,.09), rgba(2,6,23,0) 70%)",
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
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontSize: "19px",
                  fontWeight: 800,
                  letterSpacing: "-.01em",
                  color: "#f8fafc",
                  lineHeight: 1.25,
                }}
              >
                {CMP_HERO.title}
              </span>
              <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.5 }}>
                {CMP_HERO.subtitle}
              </span>
              {/* A DOT, not a warning glyph — proto 3833. */}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  width: "fit-content",
                  whiteSpace: "nowrap",
                  padding: "4px 10px",
                  border: "1px solid rgba(226,232,240,.28)",
                  borderRadius: 5,
                  background: "rgba(226,232,240,.07)",
                }}
                data-testid="pv2-cmp-status-pill"
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "#e2e8f0",
                    flex: "0 0 5px",
                  }}
                />
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "#e2e8f0",
                    whiteSpace: "nowrap",
                  }}
                >
                  {CMP_HERO.statusLabel}
                </span>
              </span>
            </div>

            {/*
              NOT DriftTrend. Its caption slot is above the chart (Security's
              verdict); Compliance's sits BELOW the baseline rule, and the label
              reads "Gaps closed" rather than "Drift trend". Two differences in
              structure, not styling, so this is written out here rather than
              adding two more props to a component shared by two other pillars.
            */}
            <div
              style={{
                flex: "1 1 260px",
                minWidth: 220,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
              data-testid="pv2-cmp-trend"
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
                {CMP_HERO.trendLabel}
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
                    <linearGradient id="cmpTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PAPER} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={PAPER} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <path d={trend.area} fill="url(#cmpTrendFill)" />
                  <polyline
                    points={trend.line}
                    fill="none"
                    stroke={PAPER}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                {/* Same reason as DriftTrend's: the chart svg is anisotropically
                    scaled, so a circle inside it renders as an oval. */}
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
                    fill="#f8fafc"
                  />
                </svg>
                <div style={{ height: 1, background: "rgba(148,163,184,.14)" }} />
                <span
                  style={{
                    display: "block",
                    paddingTop: 5,
                    fontSize: "10.5px",
                    color: "#64748b",
                  }}
                >
                  {CMP_HERO.trendCaption}
                </span>
              </div>
            </div>
          </div>

          {/* Ring + three stats — proto 3858-3888. */}
          <div
            style={{
              position: "relative",
              display: "grid",
              gridTemplateColumns: "auto repeat(3,minmax(130px,1fr))",
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
                    inset: -14,
                    borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(226,232,240,.16), rgba(2,6,23,0) 68%)",
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
                  <circle
                    cx={52}
                    cy={52}
                    r={ringR}
                    fill="none"
                    stroke="rgba(148,163,184,.16)"
                    strokeWidth={9}
                  />
                  <circle
                    cx={52}
                    cy={52}
                    r={ringR}
                    fill="none"
                    stroke="#F3F4F6"
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
                      color: "#f8fafc",
                      fontFamily: MONO,
                    }}
                    data-testid="pv2-cmp-score"
                  >
                    {CMP_HERO.score}
                  </span>
                  <span
                    style={{ fontSize: "9.5px", fontWeight: 700, color: "#94a3b8", fontFamily: MONO }}
                  >
                    {CMP_HERO.delta}
                  </span>
                </div>
              </div>
            </div>

            {CMP_HERO_STATS.map((s) => (
              <div
                key={s.label}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "2px 16px",
                  borderLeft: `2px solid ${PAPER}`,
                  justifyContent: "center",
                }}
                data-testid={`pv2-cmp-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div
                  style={{
                    position: "absolute",
                    left: -30,
                    top: -30,
                    width: 110,
                    height: 110,
                    borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(226,232,240,.13), rgba(2,6,23,0) 68%)",
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

        {/* ── "Why this pillar reads differently" — proto 3891-3906 ──────── */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "18px 20px",
            border: "1px solid rgba(226,232,240,.14)",
            borderRadius: 14,
            background: "rgba(15,23,42,.45)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)",
          }}
          data-testid="pv2-cmp-why"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={SECTION_LABEL}>{CMP_INTRO_LABEL}</span>
            <span
              style={{
                fontSize: "13px",
                color: "#cbd5e1",
                lineHeight: 1.6,
                maxWidth: "88ch",
                textWrap: "pretty",
              }}
            >
              {CMP_INTRO_BODY}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))",
              gap: 10,
            }}
          >
            {CMP_SCRUTINY.map((sm) => (
              <div
                key={sm.moment}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                  padding: "12px 14px",
                  border: "1px solid rgba(226,232,240,.12)",
                  borderLeft: "2px solid rgba(226,232,240,.45)",
                  borderRadius: 8,
                  background: "rgba(226,232,240,.035)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f1f5f9" }}>
                    {sm.moment}
                  </span>
                  <span
                    style={{
                      fontSize: "9.5px",
                      fontWeight: 600,
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      color: "#64748b",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {sm.when}
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
                  {sm.what}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Scan strip — proto 3908-3912. NOT PillarScanBar: no pulse, and
            the sentence is "gaps closed … , none reopened". ─────────────── */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 0,
            flexWrap: "wrap",
            padding: "12px 20px",
            border: "1px solid rgba(30,41,59,.9)",
            borderRadius: 12,
            background: "rgba(15,23,42,.4)",
          }}
          data-testid="pv2-cmp-scan-bar"
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#94a3b8",
              marginRight: 11,
              flex: "0 0 6px",
            }}
          />
          <span style={{ fontSize: "12px", color: "#94a3b8" }}>
            Scan <span style={{ color: "#e2e8f0", fontWeight: 700, fontFamily: MONO }}>{CMP_HERO.scanNumber}</span>{" "}
            ·{" "}
            <span style={{ color: "#34d399", fontWeight: 700, fontFamily: MONO }}>
              {CMP_HERO.gapsClosedSinceScan1}
            </span>{" "}
            gaps closed in Compliance since scan 1, none reopened
          </span>
          <span style={{ marginLeft: "auto", fontSize: "11.5px", color: "#475569" }}>
            Last scan {CMP_HERO.lastScan} · next scan in {CMP_HERO.nextScan}
          </span>
        </div>

        {/* ── Cluster area cards — proto 3914-3948 ───────────────────────── */}
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            border: "1px solid rgba(226,232,240,.14)",
            borderRadius: 14,
            background: "linear-gradient(160deg, rgba(226,232,240,.04), rgba(15,23,42,.45))",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)",
          }}
          data-testid="pv2-cmp-areas"
        >
          <div
            style={{
              position: "absolute",
              left: -40,
              top: -50,
              width: 180,
              height: 180,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(226,232,240,.1), rgba(2,6,23,0) 70%)",
              pointerEvents: "none",
            }}
          />
          {CMP_CLUSTERS.map((name) => {
            const items = CMP_AREA_LINKS.filter((a) => a.cluster === name);
            if (items.length === 0) return null;
            return (
              <div
                key={name}
                style={{ position: "relative", display: "flex", flexDirection: "column", gap: 9 }}
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
                  {name}
                </span>
                <div
                  style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 10 }}
                >
                  {items.map((a) => (
                    <AreaCard key={a.key} link={a} onOpenGap={setExpanded} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Open Gaps — proto 3950-4011 ────────────────────────────────── */}
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
            <span style={SECTION_LABEL}>Open Gaps · {CMP_OPEN_COUNT}</span>
            <span style={SECTION_NOTE}>
              Each one cites the obligation it touches. Expand for the evidence behind it.
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(226,232,240,.13)",
              borderRadius: 12,
              background: "rgba(15,23,42,.4)",
              overflow: "hidden",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)",
            }}
            data-testid="pv2-cmp-gaps"
          >
            {CMP_FINDINGS.map((f, i) => {
              const sev = CMP_SEV_META[f.sev];
              const isExpanded = expanded === i;
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
                      background: `${sev.c}66`,
                    }}
                  />
                  <button
                    onClick={() => setExpanded(isExpanded ? null : i)}
                    data-testid={`pv2-cmp-gap-${f.id}`}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: "14px 18px",
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
                        marginTop: 2,
                        transform: `rotate(${isExpanded ? 180 : -90}deg)`,
                        transition: "transform 180ms",
                      }}
                    >
                      <ChevronDown size={14} color="#64748b" aria-hidden="true" />
                    </span>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                      }}
                    >
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}
                      >
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
                            flex: "0 0 auto",
                            padding: "2px 8px",
                            borderRadius: 4,
                            border: `1px solid ${sev.c}55`,
                            background: `${sev.c}14`,
                            fontSize: "9.5px",
                            fontWeight: 700,
                            letterSpacing: ".06em",
                            textTransform: "uppercase",
                            color: sev.c,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {sev.label}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: "13.5px",
                          fontWeight: 700,
                          color: "#f1f5f9",
                          lineHeight: 1.4,
                          textWrap: "pretty",
                        }}
                      >
                        {f.title}
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          color: "#cbd5e1",
                          letterSpacing: ".01em",
                          fontFamily: MONO,
                        }}
                      >
                        {f.obligation}
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div
                      style={{
                        padding: "0 18px 18px 44px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 14,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          padding: "12px 14px",
                          border: "1px solid rgba(226,232,240,.14)",
                          borderRadius: 8,
                          background: "rgba(226,232,240,.04)",
                        }}
                      >
                        <span style={MICRO_LABEL}>The obligation</span>
                        <span
                          style={{
                            fontSize: "12px",
                            color: "#e2e8f0",
                            lineHeight: 1.6,
                            textWrap: "pretty",
                          }}
                        >
                          {f.obligationText}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={MICRO_LABEL}>Why it matters here</span>
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
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 0,
                          borderTop: "1px solid rgba(30,41,59,.9)",
                        }}
                      >
                        {f.evidence.map((e) => (
                          <div
                            key={e.k}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(130px,.85fr) minmax(0,2.15fr)",
                              gap: 14,
                              padding: "8px 0",
                              borderBottom: "1px solid rgba(30,41,59,.75)",
                              alignItems: "baseline",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "10.5px",
                                fontWeight: 700,
                                letterSpacing: ".05em",
                                textTransform: "uppercase",
                                color: "#64748b",
                                lineHeight: 1.4,
                              }}
                            >
                              {e.k}
                            </span>
                            <span
                              style={{
                                fontSize: "12px",
                                color: "#e2e8f0",
                                lineHeight: 1.55,
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
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          paddingTop: 4,
                        }}
                      >
                        <button
                          onClick={() => openFixPanel(f.fixKey)}
                          data-testid={`pv2-cmp-fix-${f.fixKey}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 11,
                            textAlign: "left",
                            padding: "11px 13px",
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
                              flex: "0 0 28px",
                              width: 28,
                              height: 28,
                              borderRadius: 7,
                              border: "1px solid rgba(0,120,212,.4)",
                              background: "rgba(0,120,212,.14)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Wrench size={13} color="#60a5fa" aria-hidden="true" />
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
                                fontSize: "12.5px",
                                fontWeight: 700,
                                color: "#60a5fa",
                                lineHeight: 1.4,
                              }}
                            >
                              {f.fixLabel}
                            </span>
                            <span
                              style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.45 }}
                            >
                              {f.fixSub}
                            </span>
                          </span>
                        </button>
                        <button
                          onClick={() => recordDecision(f)}
                          data-testid={`pv2-cmp-record-${f.id}`}
                          style={{
                            alignSelf: "flex-start",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid rgba(226,232,240,.22)",
                            background: "rgba(226,232,240,.05)",
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0" }}>
                            Record a policy decision instead
                          </span>
                          <span style={{ fontSize: "11px", color: "#64748b" }}>
                            Owner, rationale, review date
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Documented Policy Decisions — proto 4013-4046 ──────────────── */}
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
            <span style={SECTION_LABEL}>Documented Policy Decisions · {CMP_ACCEPTED_COUNT}</span>
            <span style={SECTION_NOTE}>
              Deliberate positions, not gaps. Shown in full so an auditor sees the reasoning, not
              just the outcome.
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
              gap: 10,
            }}
            data-testid="pv2-cmp-decisions"
          >
            {CMP_ACCEPTED.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 11,
                  padding: "16px 18px",
                  border: "1px solid rgba(226,232,240,.16)",
                  borderRadius: 12,
                  background: "linear-gradient(160deg, rgba(226,232,240,.05), rgba(15,23,42,.5))",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,.06)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
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
                      border: "1px solid rgba(226,232,240,.3)",
                      background: "rgba(226,232,240,.08)",
                      fontSize: "9.5px",
                      fontWeight: 700,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: "#e2e8f0",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.decision}
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
                  {a.title}
                </span>
                <span
                  style={{ fontSize: "11px", fontWeight: 600, color: "#cbd5e1", fontFamily: MONO }}
                >
                  {a.obligation}
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={MICRO_LABEL}>Rationale</span>
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#cbd5e1",
                      lineHeight: 1.6,
                      textWrap: "pretty",
                    }}
                  >
                    {a.rationale}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={MICRO_LABEL}>Compensating control</span>
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#cbd5e1",
                      lineHeight: 1.6,
                      textWrap: "pretty",
                    }}
                  >
                    {a.compensating}
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(226,232,240,.12)",
                  }}
                >
                  {cmpAcceptedMeta(a).map((m) => (
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
                <span
                  style={{
                    fontSize: "11px",
                    color: "#64748b",
                    lineHeight: 1.55,
                    textWrap: "pretty",
                  }}
                >
                  {a.note}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Obligations We Check Against — proto 4048-4062 ─────────────── */}
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
            <span style={SECTION_LABEL}>Obligations We Check Against</span>
            <span style={SECTION_NOTE}>
              Scope set by you at onboarding. Change it and every check re-evaluates.
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(226,232,240,.13)",
              borderRadius: 12,
              background: "rgba(15,23,42,.4)",
              overflow: "hidden",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)",
            }}
            data-testid="pv2-cmp-obligations"
          >
            {CMP_OBLIGATIONS.map((o) => (
              <div
                key={o.framework}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(190px,1fr) minmax(0,1.5fr) minmax(0,1.3fr)",
                  gap: 16,
                  padding: "12px 18px",
                  borderTop: "1px solid rgba(30,41,59,.85)",
                  alignItems: "start",
                }}
              >
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}
                >
                  <span
                    style={{
                      fontSize: "11.5px",
                      fontWeight: 700,
                      color: "#f1f5f9",
                      lineHeight: 1.4,
                      fontFamily: MONO,
                    }}
                  >
                    {o.framework}
                  </span>
                  <span
                    style={{
                      flex: "0 0 auto",
                      alignSelf: "flex-start",
                      padding: "2px 7px",
                      borderRadius: 4,
                      border: `1px solid ${o.tone === "slate" ? "rgba(148,163,184,.25)" : "rgba(226,232,240,.2)"}`,
                      background: "rgba(226,232,240,.05)",
                      fontSize: "9px",
                      fontWeight: 700,
                      letterSpacing: ".07em",
                      textTransform: "uppercase",
                      color: o.tone === "slate" ? "#64748b" : "#cbd5e1",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {o.scope}
                  </span>
                </div>
                <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>
                  {o.requires}
                </span>
                <span
                  style={{
                    fontSize: "11.5px",
                    fontWeight: 600,
                    color: CMP_OBLIGATION_TONE[o.tone],
                    lineHeight: 1.5,
                  }}
                >
                  {o.state}
                </span>
              </div>
            ))}
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

/**
 * One cluster area card — proto 3928-3944, geometry at 12045-12079.
 *
 * `cursor` depends on whether the card has a `finding` index: a card with one
 * opens that gap below, a card without one is inert. That is the prototype's own
 * `cursor:${a.finding != null ? 'pointer' : 'default'}`, and it is why these are
 * buttons rather than links — none of them navigates anywhere. The drill-down
 * routes exist for the four that also appear in GOV_PAGES, but that is Layer 3.
 */
function AreaCard({
  link,
  onOpenGap,
}: {
  link: CmpAreaLink;
  onOpenGap: (i: number) => void;
}) {
  const { meta, deltaText, deltaColor, sparkBars } = cmpAreaGeometry(link);
  const t = CMP_TIER[meta.tier];
  const Glyph = AREA_ICON[link.icon as keyof typeof AREA_ICON];
  const interactive = link.finding != null;

  return (
    <button
      type="button"
      onClick={() => {
        if (link.finding != null) onOpenGap(link.finding);
      }}
      disabled={!interactive}
      data-testid={`pv2-cmp-area-${link.key}`}
      className="pv2-area-card"
      style={{
        ["--pv2-area-hover" as string]: `${meta.c}66`,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        textAlign: "left",
        background: "linear-gradient(160deg, rgba(226,232,240,.05), rgba(15,23,42,.55))",
        border: `1px solid ${meta.c}30`,
        borderTop: "1px solid rgba(226,232,240,.14)",
        borderRadius: 8,
        padding: t.pad,
        cursor: interactive ? "pointer" : "default",
        fontFamily: "inherit",
        flex: `${meta.grow} 1 0`,
        minWidth: 112,
        boxShadow: CMP_INSET,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 130% 90% at 0% 0%, ${meta.c}16, transparent 58%)`,
          pointerEvents: "none",
        }}
      />
      {/* Sparkbars, top-right — proto 3932-3936. */}
      <div
        style={{
          position: "absolute",
          right: 8,
          top: 8,
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
        }}
      >
        {sparkBars.map((b, i) => (
          <span
            key={i}
            style={{
              flex: "0 0 5px",
              width: 5,
              height: b.height,
              borderRadius: 1,
              background: meta.c,
              opacity: b.opacity,
            }}
          />
        ))}
      </div>
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 7 }}>
        {Glyph && <Glyph size={t.icon} color={meta.c} aria-hidden="true" />}
        <span
          style={{
            position: "relative",
            fontSize: t.score,
            fontWeight: 800,
            color: "#f8fafc",
            letterSpacing: "-.02em",
            fontFamily: MONO,
          }}
        >
          {link.score}
        </span>
        <span
          style={{
            position: "relative",
            fontSize: Math.max(t.label - 1, 9),
            fontWeight: 700,
            color: deltaColor,
            fontFamily: MONO,
          }}
        >
          {deltaText}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          fontSize: t.label,
          fontWeight: 700,
          color: "#e2e8f0",
          textAlign: "left",
          width: "100%",
          lineHeight: 1.25,
        }}
      >
        {link.label}
      </div>
      <div
        style={{
          position: "relative",
          fontSize: "9.5px",
          color: "#64748b",
          textAlign: "left",
          width: "100%",
          lineHeight: 1.25,
        }}
      >
        {link.sub}
      </div>
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginTop: "auto",
          paddingTop: 6,
        }}
      >
        <span
          style={{
            flex: "0 0 6px",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: meta.c,
          }}
        />
        <span
          style={{
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: ".04em",
            color: meta.c,
          }}
        >
          {meta.label}
        </span>
      </div>
    </button>
  );
}
