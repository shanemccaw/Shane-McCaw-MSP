/**
 * portal-v2-compliance.tsx — the Compliance pillar dashboard.
 *
 * Rebuilt against the prototype's CURRENT `isCompliance` block
 * (`Customer Portal Shell.dc.html` lines 3864-4004). The earlier build of this
 * page was a faithful port of an OLDER revision (proto 3809-4063) that carried
 * three heavy sections inline — Open Gaps, Documented Policy Decisions, and
 * Obligations We Check Against — plus a "Why this pillar reads differently"
 * prose panel. The design has since MOVED those out of the pillar page:
 *
 *  • Open Gaps is now its own drill-down (proto 4659, "Open Gaps · {cmpOpenCount}").
 *  • Documented Policy Decisions is now a drill-down (proto 4732).
 *  • Obligations is now a drill-down (proto 4783).
 *
 * Those three drill-downs are Part 11's to build. Their fixtures stay exported
 * from `cmpDashboardData.ts` (CMP_FINDINGS / CMP_ACCEPTED / CMP_OBLIGATIONS) so
 * the copy is not lost and Part 11 has one source to read — this page simply
 * stops rendering them, because the current design does not.
 *
 * What the current pillar page IS, top to bottom: the decisions-on-record
 * banner, the hero (unchanged), a compact "Tested by" scrutiny row that REPLACES
 * the old prose panel (proto 3949-3963), the scan strip, and the cluster area
 * cards. The "Why this pillar reads differently" prose is gone; the three
 * scrutiny moments it carried now live behind the "Tested by" pills.
 *
 * ── What still differs inside the parts that look shared ───────────────────
 * The page glow is `min(900px,140%)` / 44% / blur(70px) / .55, three-stop.
 * Every panel carries `cmpInset`. The status pill is a DOT plus "Stable · 6 gaps
 * open". The trend is labelled "Gaps closed" with its caption BELOW the baseline
 * rule, so it is written out here rather than reusing `DriftTrend`. The area
 * cards share Governance's anatomy but not its numbers (neutral gradient, an
 * extra border-top, 24/19/16 score sizes, min-width 112, an inset shadow).
 */

import { useState } from "react";
import { Link } from "wouter";
import {
  Activity,
  CheckCircle,
  ClipboardList,
  FileText,
  Layers,
  Lock,
  Scale,
  ShieldCheck,
  ShieldOff,
  Users,
} from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { trendGeometry } from "@/components/portal-v2/DriftTrend";
import { useLivePillarHero, PV2_SOURCE_CLIP } from "@/components/portal-v2/useLivePillarHero";
import {
  NoScanValue,
  hasScanValue,
  NO_DATA_DASH,
  NO_DATA_INK,
  NO_SCAN_DATA_LABEL,
} from "@/components/portal-v2/NoScanDataState";
import { useScanStatus } from "@/lib/scan-status-context";
import { lastScanLabel } from "@/components/portal-v2/overviewModel";
import { usePolicyDecisions } from "@/components/portal-v2/riskRegisterLive";
import {
  cmpTrendCaption,
  pillarSeverity,
  resolveHeroTile,
  type HeroTileBinding,
} from "@/components/portal-v2/pillarDashboardModel";
import {
  CMP_AREA_LINKS,
  CMP_CLUSTERS,
  CMP_HERO,
  CMP_INSET,
  CMP_SCRUTINY,
  CMP_TIER,
  cmpAreaGeometry,
  type CmpAreaLink,
} from "@/components/portal-v2/cmpDashboardData";
import {
  buildCmpFindingSeverityMap,
  resolveCmpArea,
  type CmpAreaResolution,
} from "@/components/portal-v2/cmpAreaWiring";

const MONO = "'SF Mono',Menlo,Consolas,monospace";
/** The trend + ring stroke. Compliance's near-white identity. */
const PAPER = "#E2E8F0";
/** The muted slate an honest no-data area card (#1338) paints itself in — no
 *  status colour, because there is no measurement to have a status about. */
const NODATA_COLOR = "#64748b";

/** slugify a tile label for its data-testid (matches the prior inline expression). */
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-");

/**
 * The three hero tiles, bound to REAL data (STEP 3). "Open Gaps" is the real
 * finding total. "Retention Coverage" (%) and "Audit Retention" (days) have no
 * real producer — the retention-drift check was retired to a not_collected
 * sentinel and nothing counts audit-retention days — so they resolve an honest
 * "not measured" state rather than the fixture 99.0% / 180 days.
 */
const CMP_TILE_BINDINGS: readonly HeroTileBinding[] = [
  {
    label: "Retention Coverage",
    accent: PAPER,
    orbAlpha: "",
    realSub: "From your latest scan",
    source: {
      kind: "unmeasured",
      // NO-BACKEND-TO-WIRE: no retention-coverage percentage check exists —
      // compliance:retention-drift was retired to a not_collected sentinel (#1103).
      note: "No retention-coverage check exists yet — compliance:retention-drift was retired to a not_collected sentinel (#1103).",
    },
  },
  {
    label: "Audit Retention",
    accent: PAPER,
    orbAlpha: "",
    realSub: "From your latest scan",
    // NO-BACKEND-TO-WIRE: no check anywhere counts audit-retention-days for a tenant.
    source: { kind: "unmeasured", note: "No audit-retention-days check exists yet." },
  },
  {
    label: "Open Gaps",
    accent: PAPER,
    orbAlpha: "",
    realSub: "From your latest scan",
    source: { kind: "findingsTotal" },
  },
];

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

export default function PortalV2CompliancePage() {
  // STEP 3: score, delta, 30-day trend, severity and the finding-derived gap
  // count are the real war-room-pillars values now. Same `useLivePillarHero` seam
  // the other pillar heroes use; the extra derivations are pure and tested.
  const live = useLivePillarHero("compliance");
  const heroTiles = CMP_TILE_BINDINGS.map((b) => resolveHeroTile(b, live));

  // Real backing for the cluster area cards (#1338). The war-room payload is
  // finding-level: for each card's backing `monitor_checks.key` it tells us the
  // worst OPEN finding severity right now (across every pillar, since a card's
  // check can belong to another pillar), which drives the card's real status.
  // No per-sub-area numeric producer exists, so the magnitude stays design
  // fixture and the six genuinely-unbacked cards resolve to an honest "—".
  const cmpFindingSeverity = buildCmpFindingSeverityMap(live.pillars);

  // Real "last scan" value, same seam Overview uses (#1257). `everScanned` is
  // the real signal (#1440) that distinguishes "never scanned" from "scanned
  // and genuinely healthy" for the area cards below — an empty finding map
  // means something different in each case, and only this field tells them
  // apart (see cmpAreaWiring.ts's resolveCmpArea).
  const scanStatus = useScanStatus();
  const lastScan = lastScanLabel(scanStatus.data?.lastScanAt ?? null, scanStatus.loaded);
  const everScanned = scanStatus.data?.everScanned === true;
  const sev = pillarSeverity(live.score);
  const openGaps = live.findingCounts.critical + live.findingCounts.warning;

  // The "documented policy decisions on record" strip (Git #1220). Reads the
  // same real register the decisions drill-down (#1221) reads via
  // `usePolicyDecisions()` — `GET /api/portal/policy-decisions`, backed by
  // `msp_risk_decisions` — narrowed to this pillar client-side, exactly like
  // that page. `null` while loading/erroring rather than the stale fixture
  // count, so this strip never asserts a number nobody confirmed.
  const { decisions: policyDecisions, loading: decisionsLoading, error: decisionsError } =
    usePolicyDecisions();
  const cmpDecisionsCount =
    decisionsLoading || decisionsError
      ? null
      : policyDecisions.filter((d) => d.pillar.trim().toLowerCase() === "compliance").length;

  // Honest-null contract (#1387): the REAL engine score when scored, and a muted
  // "—" through the one shared no-scan-data seam otherwise — never the design
  // fixture. The ring draws no arc when there is nothing to score.
  // `pv2-cmp-source` states which is on screen.
  const score = live.score;
  const hasScore = hasScanValue(score);
  const hasHistory = Array.isArray(live.history) && live.history.length >= 2;
  const trend = hasHistory ? trendGeometry(live.history!) : null;
  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = hasScore ? ringC - (score / 100) * ringC : ringC;

  // `cmpScrutiny` selection (proto 13659) — a pill toggles the detail below it
  // open, clicking the same pill closes it.
  const [scrutinySel, setScrutinySel] = useState<number | null>(null);
  const scrutinyOpen = scrutinySel == null ? null : CMP_SCRUTINY[scrutinySel];

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
        {/* Page glow — proto 3866. Smaller, softer and three-stop. */}
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

        {/* ── Back link + decisions-on-record strip — proto 3868-3878 ────── */}
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

          {/* Honest-count contract (#1409): hidden entirely — not "0", not the
              fixture `CMP_ACCEPTED_COUNT` — unless the real register
              (`usePolicyDecisions`) has a nonzero decision count on record for
              this pillar. */}
          {typeof cmpDecisionsCount === "number" && cmpDecisionsCount > 0 && (
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
              <span
                style={{ fontSize: "15px", fontWeight: 800, color: "#e2e8f0", fontFamily: MONO }}
                data-testid="pv2-cmp-decisions-count"
              >
                {cmpDecisionsCount}
              </span>
              {/* Not "finding risk-accepted in X" — this pillar counts DECISIONS. */}
              <span style={{ fontSize: "11.5px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                documented policy decisions on record
              </span>
              {/* Hidden live/fixture marker, same convention as `pv2-cmp-source`.
                  Always "live" now — this strip only renders once real data
                  confirms a nonzero count. */}
              <span data-testid="pv2-cmp-decisions-source" style={PV2_SOURCE_CLIP}>
                live
              </span>
              {/* `goRiskCmp` (proto 3876) — a plain link to the register pre-filtered
                  to Compliance. Unlike Governance/Security this button does not
                  toggle a drop panel; Compliance has no such panel in this design. */}
              <Link
                href="/portal-v2/risk-register?pillar=Compliance"
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
                  textDecoration: "none",
                }}
              >
                View risk register →
              </Link>
            </div>
          )}
        </div>

        {/* ── Hero card — proto 3880-3947 ────────────────────────────────── */}
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
              {/* A DOT, not a warning glyph — proto 3888-3890. */}
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
                  {/* Real severity band + real open-finding count, not the
                      fixture "Stable · 6 gaps open"; honest no-data label when
                      unscored (#1387). */}
                  {sev
                    ? `${sev.label} · ${openGaps} ${openGaps === 1 ? "gap" : "gaps"} open`
                    : NO_SCAN_DATA_LABEL}
                </span>
              </span>
            </div>

            {/*
              NOT DriftTrend. Its caption slot is above the chart (Security's
              verdict); Compliance's sits BELOW the baseline rule, and the label
              reads "Gaps closed" rather than "Drift trend".
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
                  </>
                ) : (
                  // Honest empty state (#1409) — no real history to plot, never
                  // the fixture's fabricated `CMP_HISTORY` decline.
                  <div
                    data-testid="pv2-cmp-trend-empty"
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
                  style={{
                    display: "block",
                    paddingTop: 5,
                    fontSize: "10.5px",
                    color: "#64748b",
                  }}
                >
                  {/* Real caption derived from the SAME series the trend draws
                      (#1440) — never the fixture's fixed "Eight points over
                      ten scans", which stayed on screen regardless of what
                      the real trend actually showed. */}
                  {trend ? (cmpTrendCaption(live.history) ?? NO_SCAN_DATA_LABEL) : NO_SCAN_DATA_LABEL}
                </span>
              </div>
            </div>
          </div>

          {/* Ring + three stats — proto 3914-3946. */}
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
                  <NoScanValue
                    value={score}
                    color="#f8fafc"
                    testId="pv2-cmp-score"
                    style={{
                      fontSize: "26px",
                      fontWeight: 800,
                      letterSpacing: "-.02em",
                      fontFamily: MONO,
                    }}
                  />
                  <span
                    style={{ fontSize: "9.5px", fontWeight: 700, color: live.delta?.color ?? NO_DATA_INK, fontFamily: MONO }}
                    data-testid="pv2-cmp-delta"
                  >
                    {live.delta?.text ?? NO_DATA_DASH}
                  </span>
                  {/* Hidden live/fixture marker so a test can prove the real score. */}
                  <span data-testid="pv2-cmp-source" style={PV2_SOURCE_CLIP}>
                    {live.dataState}
                  </span>
                </div>
              </div>
            </div>

            {heroTiles.map((t) => (
              <div
                key={t.label}
                title={t.note ?? undefined}
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
                data-testid={`pv2-cmp-stat-${slug(t.label)}`}
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
                  {t.label}
                </span>
                <span
                  style={{
                    position: "relative",
                    fontSize: "22px",
                    fontWeight: 800,
                    color: t.unmeasured ? "#475569" : "#f8fafc",
                    letterSpacing: "-.02em",
                    fontFamily: MONO,
                  }}
                >
                  {t.value ?? "—"}
                </span>
                <span style={{ position: "relative", fontSize: "10.5px", color: "#64748b" }}>
                  {t.sub}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── "Tested by" scrutiny row — proto 3949-3963. Replaces the older
            "Why this pillar reads differently" prose panel: the same three
            moments, now compact pills that expand a detail below. ────────── */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 0,
            padding: "0 2px",
          }}
          data-testid="pv2-cmp-scrutiny"
        >
          <span
            style={{
              flex: "0 0 auto",
              fontSize: "9.5px",
              fontWeight: 700,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "#64748b",
              marginRight: 14,
            }}
          >
            Tested by
          </span>
          {CMP_SCRUTINY.map((sm, i) => (
            <button
              key={sm.moment}
              type="button"
              onClick={() => setScrutinySel((cur) => (cur === i ? null : i))}
              title={sm.what}
              data-testid={`pv2-cmp-scrutiny-${i}`}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                marginRight: 8,
                padding: "6px 12px",
                borderRadius: 999,
                cursor: "pointer",
                fontFamily: "inherit",
                border: `1px solid ${scrutinySel === i ? "rgba(226,232,240,.42)" : "rgba(226,232,240,.14)"}`,
                background: scrutinySel === i ? "rgba(226,232,240,.09)" : "transparent",
              }}
            >
              <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0", whiteSpace: "nowrap" }}>
                {sm.moment}
              </span>
              <span style={{ fontSize: "10.5px", color: "#64748b", whiteSpace: "nowrap" }}>
                {sm.when}
              </span>
            </button>
          ))}
        </div>
        {scrutinyOpen && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "13px 16px",
              border: "1px solid rgba(226,232,240,.16)",
              borderLeft: "2px solid #E2E8F0",
              borderRadius: 10,
              background: "rgba(226,232,240,.04)",
            }}
            data-testid="pv2-cmp-scrutiny-detail"
          >
            <span
              style={{
                fontSize: "9.5px",
                fontWeight: 700,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: "#94a3b8",
              }}
            >
              {scrutinyOpen.moment} · {scrutinyOpen.when}
            </span>
            <span
              style={{
                fontSize: "12.5px",
                color: "#cbd5e1",
                lineHeight: 1.65,
                maxWidth: "92ch",
                textWrap: "pretty",
              }}
            >
              {scrutinyOpen.what}
            </span>
          </div>
        )}

        {/* ── Scan strip — proto 3965-3969. NOT PillarScanBar: no pulse, and
            the sentence WAS "gaps closed … , none reopened". "Last scan" is
            the one real value here (`useScanStatus`, #1257); the scan-count
            sentence and the "next scan in" ETA render an honest gap instead
            of `CMP_HERO`'s fixture "Scan 14 · 5 gaps closed … , none
            reopened … next scan in 22 hours" (#1440). ───────────────────── */}
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
          {/* NO-BACKEND-TO-WIRE: no scan-sequence counter and no per-pillar
              gaps-closed/reopened tracking exist anywhere server-side —
              msp_diagnostic_runs carries no per-tenant scan sequence number,
              and msp_diagnostic_findings carries no closed/reopened history
              across runs to derive "N gaps closed since scan 1, none
              reopened" from. */}
          <span style={{ fontSize: "12px", color: NO_DATA_INK }} data-testid="pv2-cmp-scan-count-nodata">
            No live data available
          </span>
          <span style={{ marginLeft: "auto", fontSize: "11.5px", color: "#475569" }}>
            Last scan {lastScan}
          </span>
          {/* NO-BACKEND-TO-WIRE: no scan-cadence/schedule model exists —
              scans are triggered on demand (ScanTriggerButton), not on a
              cadence, so there is no real "next scan in" ETA to state. */}
        </div>

        {/* ── Cluster area cards — proto 3971-4001 ───────────────────────── */}
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
                    <AreaCard
                      key={a.key}
                      link={a}
                      resolution={resolveCmpArea(a.key, cmpFindingSeverity, live.loaded, everScanned)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </PortalV2Shell>
  );
}

/**
 * One cluster area card — proto 3977-3996, geometry at 13685-13718.
 *
 * `navGo` (13708) navigates to the card's drill-down when one exists, otherwise
 * expands the finding it points at. With the inline Open Gaps section removed,
 * both branches resolve to a Compliance drill-down, so every card is a link to
 * `/portal-v2/compliance/<area>` — the same pattern Governance and Security use
 * for their tiles. Those drill-down routes are Layer 3 (Part 11) and 404 until
 * built, exactly as the other two pillars' tiles already do.
 */
function AreaCard({ link, resolution }: { link: CmpAreaLink; resolution: CmpAreaResolution }) {
  // Honest for BOTH "nodata" (no producing check exists) and "fixture" (a real
  // check exists but this tenant has no completed scan to state a status from,
  // #1440) — neither has a real status/magnitude to show, so both paint the
  // same muted no-value card rather than the design's fixture red/yellow/green.
  const notLive = resolution.dataState !== "live";
  // A live card paints its REAL finding-derived status; anything else keeps the
  // design status only for tier/grow layout stability (sizing, never a value).
  const displayStatus =
    resolution.dataState === "live" && resolution.liveStatus ? resolution.liveStatus : link.status;
  const { meta, deltaText, deltaColor, sparkBars } = cmpAreaGeometry({ ...link, status: displayStatus });
  const t = CMP_TIER[meta.tier];
  const Glyph = AREA_ICON[link.icon as keyof typeof AREA_ICON];

  // The colour and status label actually painted: muted slate + "Not measured"
  // for an honest no-value card (no check, or no scan yet), the real severity
  // colour/label otherwise.
  const c = notLive ? NODATA_COLOR : meta.c;
  const statusLabel = notLive ? "Not measured" : meta.label;

  return (
    <Link
      href={`/portal-v2/compliance/${link.key.replace(/^compliance-/, "")}`}
      data-testid={`pv2-cmp-area-${link.key}`}
      className="pv2-area-card"
      title={notLive ? resolution.reason ?? undefined : undefined}
      style={{
        ["--pv2-area-hover" as string]: `${c}66`,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        textAlign: "left",
        background: "linear-gradient(160deg, rgba(226,232,240,.05), rgba(15,23,42,.55))",
        border: `1px solid ${c}30`,
        borderTop: "1px solid rgba(226,232,240,.14)",
        borderRadius: 8,
        padding: t.pad,
        cursor: "pointer",
        fontFamily: "inherit",
        flex: `${meta.grow} 1 0`,
        minWidth: 112,
        boxShadow: CMP_INSET,
        textDecoration: "none",
        opacity: notLive ? 0.72 : 1,
      }}
    >
      {/* Hidden per-card data-source marker — a test reads el.innerText to prove
          "live" vs "fixture" vs "nodata", same clip technique as pv2-cmp-source. */}
      <span data-testid={`pv2-cmp-area-source-${link.key}`} style={PV2_SOURCE_CLIP}>
        {resolution.dataState}
      </span>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 130% 90% at 0% 0%, ${c}16, transparent 58%)`,
          pointerEvents: "none",
        }}
      />
      {/* Sparkbars, top-right — proto 3980-3984. A no-value card has no real trend
          to draw, so it shows none rather than a fabricated one. */}
      {!notLive && (
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
                background: c,
                opacity: b.opacity,
              }}
            />
          ))}
        </div>
      )}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 7 }}>
        {Glyph && <Glyph size={t.icon} color={c} aria-hidden="true" />}
        <span
          style={{
            position: "relative",
            fontSize: t.score,
            fontWeight: 800,
            color: notLive ? NODATA_COLOR : "#f8fafc",
            letterSpacing: "-.02em",
            fontFamily: MONO,
          }}
        >
          {/* No producing check, or no completed scan yet → honest em dash,
              never a fabricated number. */}
          {resolution.showValue ? link.score : "—"}
        </span>
        {!notLive && (
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
        )}
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
            background: c,
          }}
        />
        <span
          style={{
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: ".04em",
            color: c,
          }}
        >
          {statusLabel}
        </span>
      </div>
    </Link>
  );
}
