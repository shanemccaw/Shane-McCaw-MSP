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
import { ChevronDown } from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { GOV_SRC_META } from "@/components/portal-v2/govPages";
import { useLivePillarHero, PV2_SOURCE_CLIP } from "@/components/portal-v2/useLivePillarHero";
import { trendGeometry } from "@/components/portal-v2/DriftTrend";
import {
  NoScanValue,
  NoScanDataState,
  hasScanValue,
  NO_DATA_DASH,
  NO_DATA_INK,
  NO_SCAN_DATA_LABEL,
} from "@/components/portal-v2/NoScanDataState";
import { useAdpWorkloadsLive } from "@/components/portal-v2/useAdpWorkloadsLive";
import {
  ADP_HERO,
  ADP_HERO_STATS,
  ADP_ORANGE,
  ADP_ORANGE_EYEBROW,
  ADP_ORANGE_TEXT,
  ADP_PROV,
  ADP_TONE,
  adpWorkloadDetail,
  adpWorkloadsWithLive,
} from "@/components/portal-v2/adpDashboardData";

/**
 * #1441 — full strict pass beyond #1412's hero-copy-only fix. Every ADP_*
 * usage below is now one of three states, per Shane's standing rule: real
 * live data, the honest "no scan data" null (a real wiring path exists but
 * this tenant hasn't produced it), or a genuine backend gap — greppable
 * `NO-BACKEND-TO-WIRE:` tag + an honest "No live data available" render,
 * never the fixture standing in for a real number.
 */

const MONO = "'SF Mono',Menlo,Consolas,monospace";

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "#64748b",
};

const SECTION_NOTE: React.CSSProperties = { fontSize: "10.5px", color: "#475569" };

export default function PortalV2AdoptionPage() {
  // Real pillar score/delta from the live health engine, fixture as the
  // honest-null fallback. Only the ring is wired — the workload list, department
  // heat-map and plays below have no per-item server feed and stay fixture.
  const live = useLivePillarHero("adoption");
  // Honest-null contract (#1387): real score/delta when scored, muted "—"
  // otherwise — never the design fixture.
  const score = live.score;
  const hasScore = hasScanValue(score);
  // #1412 investigation — every ADP_HERO.* usage on this page, classified:
  //   eyebrow, standfirst, trendLabel, parkedStripSuffix: legitimate static
  //     labels (no tenant-specific numbers), unconditional is correct.
  //   headline, trendCaption: DATA VALUES presented as real ("climbed 27
  //     points in ten scans", "61 → 88 since scan 1") — now gated on
  //     hasScore below. hasScore is the only live signal this page has
  //     (useLivePillarHero doesn't expose the pillar's real history, so
  //     the specific numbers in these sentences can't be live-wired the way
  //     score/delta were — the honest-null gate is the available fix).
  const delta = live.delta?.text ?? NO_DATA_DASH;
  const deltaColor = live.delta?.color ?? NO_DATA_INK;

  // #1441: the trend chart. `live.history` is the same real replayed
  // war-room-pillars series Governance/Security/Compliance already draw their
  // hero sparklines from (`war-room-pillar-stats.ts` computes `trend` per
  // pillar, adoption included — this page's own prior #1409 comment claiming
  // "Adoption has no live.history" no longer matches the code). Honest empty
  // state when the tenant lacks enough real checkpoints, never the fixture's
  // fabricated rising curve.
  const hasHistory = Array.isArray(live.history) && live.history.length >= 2;
  const trend = hasHistory ? trendGeometry(live.history!) : null;

  // #1252: the 4 workload rows with a real per-check server feed (Exchange,
  // Teams chat & meetings, SharePoint, OneDrive) overlaid onto the fixture —
  // see adpWorkloadsWithLive's own header for which rows and why.
  const { live: workloadLive } = useAdpWorkloadsLive();
  const workloads = adpWorkloadsWithLive(workloadLive);

  // #1441: hero stat tile 2 ("Copilot weekly active") is the SAME real
  // Copilot active/licensed counts useAdpWorkloadsLive already resolves for
  // the workload row overlay (#1284) — reading them again here rather than
  // fetching twice.
  const hasCopilotStat = workloadLive.copilotActive != null && workloadLive.copilotLicensed != null;

  /**
   * #1441: the three hero stat tiles, each resolved independently.
   *   - "Workloads in real use" is a genuine backend gap: only 6 of the 10
   *     tracked workloads have any real per-item feed at all (see
   *     `adpWorkloadsWithLive`'s own header), so an honest "X of 10 in real
   *     use" figure would silently blend 6 real percentages with 4 fixture
   *     ones under one confident number — exactly the mixed-honesty trap the
   *     hard rule exists to prevent. No aggregation exists that can produce
   *     this figure honestly today.
   *   - "Copilot weekly active" IS wireable — the exact real counts
   *     `useAdpWorkloadsLive` already resolves for the workload row overlay.
   *   - "Open plays" is `ADP_PLAYS.length` — a fixture recommendation list
   *     (see the plays section below), so its count is fixture-derived too.
   */
  const heroStatViews: { label: string; value: string; sub: string; live: boolean }[] = [
    {
      label: ADP_HERO_STATS[0].label,
      value: NO_DATA_DASH,
      // NO-BACKEND-TO-WIRE: no aggregation exists across all 10 tracked
      // workloads (only 6 have any live per-item feed at all — Teams
      // channels, Power BI, Teams Phone and Planner/Tasks have none), so
      // this tile cannot honestly report a single "X of 10" figure.
      sub: "No live data available",
      live: false,
    },
    {
      label: ADP_HERO_STATS[1].label,
      value: hasCopilotStat
        ? `${workloadLive.copilotActive!.toLocaleString()} / ${workloadLive.copilotLicensed!.toLocaleString()}`
        : NO_DATA_DASH,
      sub: hasCopilotStat ? "Assigned seats used it in the last 7 days" : NO_SCAN_DATA_LABEL,
      live: hasCopilotStat,
    },
    {
      label: ADP_HERO_STATS[2].label,
      value: NO_DATA_DASH,
      // NO-BACKEND-TO-WIRE: no recommendation engine exists for Adoption —
      // ADP_PLAYS is a fixed design fixture (6 hand-written plays), not a
      // per-tenant computed list, so a real "open plays" count cannot be
      // produced from this tenant's own data.
      sub: "No live data available",
      live: false,
    },
  ];

  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = hasScore ? ringC - (score / 100) * ringC : ringC;

  const [openWorkload, setOpenWorkload] = useState<number | null>(null);
  const [parkedOpen, setParkedOpen] = useState(true);
  const [provOpen, setProvOpen] = useState(false);
  // #1441: the plays list, the "park this play" action and the enabler "Work
  // on this" buttons are gone (see the NO-BACKEND-TO-WIRE comments below) —
  // nothing on this page can trigger FixPanel, AcceptRiskPanel or the
  // ShaneBot form drawer anymore, so their hooks/wiring are removed rather
  // than left as dead plumbing pointed at fixture content.

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
            data-testid="pv2-adp-parked-strip"
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
            {/* NO-BACKEND-TO-WIRE: no persistence exists for a parked-play
                decision on this pillar — `parkPlay`'s AcceptRiskPanel confirm
                is a no-op (`onConfirm: () => {}` below), unlike the Risk
                Register's real `riskId` write path. ADP_PARKED/ADP_PARKED_COUNT
                are design fixture, not real recorded decisions, so the strip
                is honest-empty rather than a specific fake count (#1441; #1412
                had flagged this as a known-not-new gap, now actually fixed). */}
            <span
              style={{ fontSize: "15px", fontWeight: 800, color: NO_DATA_INK, fontFamily: MONO }}
            >
              {NO_DATA_DASH}
            </span>
            <span style={{ fontSize: "11.5px", color: "#94a3b8", whiteSpace: "nowrap" }}>
              No live data available
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
                {/* Git #1412: this sentence states a specific score-history
                    claim ("climbed 27 points in ten scans") that has nothing
                    to do with the real tenant's history once scored — the
                    honest-null gate can only key off the one live signal
                    this page actually has (hasScore), same as Compliance's
                    `trend ? CMP_HERO.trendCaption : NO_SCAN_DATA_LABEL`. */}
                {hasScore ? ADP_HERO.headline : NO_SCAN_DATA_LABEL}
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
                {trend ? (
                  <>
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
                  </>
                ) : (
                  // Honest empty state (#1441, same contract #1409 established
                  // for Governance/Security/Compliance) — no real history to
                  // plot yet, never the fixture's fabricated rising curve.
                  <div
                    data-testid="pv2-adp-trend-empty"
                    style={{
                      height: 84,
                      display: "flex",
                      alignItems: "center",
                      fontSize: "11px",
                      color: NO_DATA_INK,
                    }}
                  >
                    {NO_SCAN_DATA_LABEL}
                  </div>
                )}
                <div style={{ height: 1, background: "rgba(148,163,184,.14)" }} />
                <span
                  style={{ display: "block", paddingTop: 5, fontSize: "10.5px", color: "#64748b" }}
                >
                  {/* #1441: gated on `trend` (real history), not `hasScore` —
                      "61 → 88 since scan 1" is a fixture history claim, and a
                      scored-but-thin-history tenant can have one without the
                      other. Matches Compliance's `trend ? CMP_HERO.trendCaption
                      : NO_SCAN_DATA_LABEL` convention exactly. */}
                  {trend ? ADP_HERO.trendCaption : NO_SCAN_DATA_LABEL}
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
                  <NoScanValue
                    value={score}
                    color={ADP_ORANGE_TEXT}
                    testId="pv2-adp-score"
                    style={{
                      fontSize: "26px",
                      fontWeight: 800,
                      letterSpacing: "-.02em",
                      fontFamily: MONO,
                    }}
                  />
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

            {heroStatViews.map((s) => (
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
                    color: s.live ? "#f8fafc" : NO_DATA_INK,
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
                // #1441: three states per row, not two. `w.hasLiveFeed` is
                // fixed per workload category (true for the 6 rows
                // adpWorkloadsWithLive's own header documents as wireable —
                // Exchange, Teams, SharePoint, OneDrive, Copilot, Viva
                // Engage). `w.isLive` is whether THIS tenant's scan has
                // actually resolved that check yet. A wireable-but-unresolved
                // row is case 2 ("No scan data available" — a real path
                // exists) while a never-wireable row is case 3
                // (NO-BACKEND-TO-WIRE — no per-item feed exists at all).
                // Conflating the two would tell a genuinely scannable tenant
                // there is no backend when there simply hasn't been a scan
                // yet. The workload NAME stays visible in every case (it's a
                // real, fixed M365 category, not tenant data).
                const isLive = !!w.isLive;
                const c = ADP_TONE[w.tone];
                const isOpen = openWorkload === wi;
                const detail = isLive ? adpWorkloadDetail(w) : null;
                const emptyLabel = w.hasLiveFeed ? NO_SCAN_DATA_LABEL : "No live data available";
                const emptyDetail = w.hasLiveFeed
                  ? "This workload hasn't been scanned for this tenant yet."
                  : // NO-BACKEND-TO-WIRE: no per-item usage feed exists for
                    // this workload (Teams channels / Power BI / Teams Phone /
                    // Planner-Tasks have no collector today — see
                    // adpWorkloadsWithLive's own header).
                    "No per-item usage feed exists for this workload yet.";
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
                          {isLive ? w.note : emptyLabel}
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
                              width: `${isLive ? w.active : 0}%`,
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
                          color: isLive ? c : NO_DATA_INK,
                          fontFamily: MONO,
                          textAlign: "right",
                        }}
                      >
                        {isLive ? `${w.active}%` : NO_DATA_DASH}
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
                        {detail ? (
                          <>
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
                          </>
                        ) : (
                          <NoScanDataState
                            compact
                            testId={`pv2-adp-workload-${wi}-no-data`}
                            label={emptyLabel}
                            detail={emptyDetail}
                          />
                        )}
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
            {/* NO-BACKEND-TO-WIRE: no per-tenant department-mapping coverage
                figure exists yet. `identity:department-directory` (#1266)
                landed and DOES compute usersMissingDepartmentCount/
                totalUserCount server-side, but the dashboard-registry
                resolver can't yet disambiguate those two fields safely for
                this check (`pickMappedValueField`'s token-overlap heuristic
                is biased toward whichever field's name contains a token from
                the check's own key — "department" always wins here regardless
                of which of the two this page asks for), so wiring it now
                risks silently showing the WRONG number rather than none at
                all. ADP_DEPT.coverage/.note are design fixture, not this
                tenant's real mapping state. */}
            <div
              style={{
                border: "1px solid rgba(194,166,61,.3)",
                borderRadius: 9,
                background: "rgba(15,23,42,.4)",
              }}
              data-testid="pv2-adp-dept-coverage-no-data"
            >
              <NoScanDataState
                compact
                label="No live data available"
                detail="Department-mapping coverage isn't wired to a live scan yet."
              />
            </div>
            {/* NO-BACKEND-TO-WIRE: the department × workload heat-map itself
                (ADP_MATRIX) is a confirmed, well-documented genuine gap — #1254
                investigated the join and found it not buildable even after
                #1266 landed the department-directory check, because the four
                usage-report endpoints return HASHED user principal names on a
                default-configured tenant while the department check returns
                real ones. The only real fix is a tenant-wide
                `displayConcealedNames: true` privacy-posture change, which
                #1254's own comment flags as Shane's call to make explicitly —
                not something to wire silently from here. See #1254 and #1266
                for the full trail. */}
            <div
              style={{
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 12,
                background: "rgba(15,23,42,.4)",
              }}
              data-testid="pv2-adp-matrix"
            >
              <NoScanDataState
                label="No live data available"
                detail="The department adoption heat-map isn't wired to a live scan yet (tracked in #1254)."
              />
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
              {/* #1441: no count next to the header — ADP_PLAY_COUNT is the
                  fixture list's own length, and the body below no longer
                  renders that fixture (see the NO-BACKEND-TO-WIRE comment on
                  the plays panel). The cost-model legend (ADP_KIND_LEGEND) is
                  dropped for the same reason: it categorises play cards that
                  aren't on screen. */}
              <span style={SECTION_LABEL}>What would move these numbers</span>
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
              {/* NO-BACKEND-TO-WIRE: no recommendation engine exists for
                  Adoption. ADP_PLAYS is a fixed design fixture — 6
                  hand-written plays with tenant-shaped numbers ("68 people",
                  "$810/mo") baked into the copy — not a per-tenant computed
                  list, so there is nothing real to expand, act on ("Run this
                  play with us") or park here. Rendering the fixture cards
                  (with their now-real-looking FixPanel/park buttons) would be
                  exactly the fake-data-presented-as-actionable problem this
                  pass exists to remove. */}
              <NoScanDataState
                label="No live data available"
                detail="Adoption doesn't have a live recommendation engine yet — nothing here is generated from this tenant's own data."
              />
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
              {/* NO-BACKEND-TO-WIRE: see the strip comment above — no
                  persistence exists for a parked-play decision on this
                  pillar, so ADP_PARKED_COUNT (a fixture length) is dropped
                  from the toggle rather than shown as a real count. */}
              <span
                style={{
                  fontSize: "22px",
                  fontWeight: 800,
                  color: NO_DATA_INK,
                  letterSpacing: "-.02em",
                  fontFamily: MONO,
                }}
              >
                {NO_DATA_DASH}
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

            {/* NO-BACKEND-TO-WIRE: ADP_PARKED is design fixture — two
                hand-written "already parked" records (owner, register id)
                with no real persistence behind them (see the strip comment
                above). Rendering them as real recorded decisions would be the
                exact fake-data problem this pass exists to remove. */}
            {parkedOpen && (
              <div data-testid="pv2-adp-parked" style={{ marginTop: 6 }}>
                <NoScanDataState
                  label="No live data available"
                  detail="No parked-play decisions have been recorded for this tenant — parking isn't wired to persist yet."
                />
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
              {/* NO-BACKEND-TO-WIRE: no before/after tracking exists for these
                  specific metrics — ADP_WINS is a fixture list of six
                  hand-written "since scan 1" deltas, not values computed from
                  this tenant's own scan history. */}
              <NoScanDataState
                label="No live data available"
                detail="Recent-wins tracking isn't wired to a live scan history yet."
              />
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
              {/* NO-BACKEND-TO-WIRE: no change-management/programme-status
                  backend exists for Adoption — ADP_ENABLERS ("Champions
                  network: 3 of 6 depts", "Training delivered: None in 6 mo")
                  is a fixed design fixture describing a specific fictional
                  programme's state, not anything read from this tenant. */}
              <NoScanDataState
                label="No live data available"
                detail="Change-management programme status isn't wired to a live scan yet."
              />
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
    </PortalV2Shell>
  );
}
