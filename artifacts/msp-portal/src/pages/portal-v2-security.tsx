/**
 * portal-v2-security.tsx — the Security pillar dashboard.
 *
 * A direct port of the prototype's `isSecurity` block
 * (`Customer Portal Shell.dc.html` lines 528-676), read against its OWN markup
 * rather than adapted from the Governance page.
 *
 * ── Security is not Governance repainted ───────────────────────────────────
 * The instruction was to verify rather than assume structural similarity, and
 * the two pillars differ in seven substantive ways, not just in palette:
 *
 *  1. A red CRITICAL HEADLINE sits between the top bar and the hero card
 *     (proto 543-545) — "3 critical exposures need attention right now." at
 *     20px/800. Governance has nothing in that slot.
 *  2. The drift trend carries a VERDICT SENTENCE (566) above the chart.
 *  3. The trend is drawn in RED, not the pillar's violet — the line reports how
 *     the pillar is trending, not which pillar it is.
 *  4. FOUR hero stats at `minmax(110px,1fr)`, against Governance's three at
 *     `minmax(130px,1fr)`.
 *  5. The score ring, its glow and the score numeral are red; Governance's are
 *     its own blue. Only Critical Exposures prints its VALUE in the accent
 *     colour — every other stat value in either pillar is #f8fafc.
 *  6. The area cards are a different component: one "Security Categories" panel
 *     with two anonymous rows of icon-ring + score + progress-bar cards, against
 *     Governance's four named clusters of sparkline + delta + status-dot cards.
 *  7. The all-resolved panel is at the BOTTOM here (663-672); on Governance it
 *     is above the hero.
 *
 * Shared where genuinely shared, and only after checking: `PillarScanBar` (the
 * two pillars' scan strips are byte-identical apart from the dot colour and the
 * pillar name) and `DriftTrend` (same block, three real differences, all props).
 *
 * ── Carried over from the Governance pass ──────────────────────────────────
 * The prototype's ⚠ glyph is a lucide icon here, per the README's "No emoji
 * anywhere" rule winning over the markup — the same single deliberate deviation
 * already agreed on Governance, applied consistently rather than re-litigated.
 * The hero ring is bespoke for the same reason it is there: `ui/score-ring.tsx`
 * renders a percentage with token-derived colours, and every axis of that
 * conflicts with the design's 104-unit viewBox at 88px.
 */

import { useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ClipboardList,
  Key,
  Lock,
  Mail,
  PartyPopper,
  ShieldCheck,
} from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { PortalV2LoadingState } from "@/components/portal-v2/PortalV2LoadingState";
import { PillarScanBar } from "@/components/portal-v2/PillarScanBar";
import { DriftTrend, trendGeometry } from "@/components/portal-v2/DriftTrend";
import { RiskAcceptedPanel } from "@/components/portal-v2/RiskAcceptedPanel";
import { useLivePillarHero, PV2_SOURCE_CLIP } from "@/components/portal-v2/useLivePillarHero";
import {
  NoScanValue,
  hasScanValue,
  NO_DATA_DASH,
  NO_DATA_INK,
  NO_SCAN_DATA_LABEL,
} from "@/components/portal-v2/NoScanDataState";
import { useSecAreaLinksLive } from "@/components/portal-v2/useSecAreaLinksLive";
import { useCaBaselineLive } from "@/components/portal-v2/useCaBaselineLive";
import { caBandsWithRowsLive } from "@/components/portal-v2/secCaModel";
import { CA_STATUS_META } from "@/components/portal-v2/secCaData";
import { useScanStatus } from "@/lib/scan-status-context";
import { lastScanLabel } from "@/components/portal-v2/overviewModel";
import { useRiskRegister } from "@/components/portal-v2/riskRegisterLive";
import {
  pillarSeverity,
  pillarTrendVerdict,
  resolveHeroTile,
  type HeroTileBinding,
} from "@/components/portal-v2/pillarDashboardModel";
import {
  SEC_AREA_LINKS,
  SEC_HERO,
  SEC_STATUS,
  secAreaGeometry,
  type SecAreaLink,
} from "@/components/portal-v2/secDashboardData";

const MONO = "'SF Mono',Menlo,Consolas,monospace";
const RED = "#f87171";

/** slugify a tile label for its data-testid (matches the prior inline expression). */
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-");

/**
 * The four hero tiles, bound to REAL data (STEP 3). "Critical Exposures" is the
 * real critical finding count; "Security Findings" the real total. "MFA Coverage"
 * (a %, with no denominator check) and "Secure Score" (real, but served by the
 * separate security-posture route, not this payload) have no real backing here —
 * they resolve an honest "not measured" state rather than the fixture 94% / 68.
 */
const SEC_TILE_BINDINGS: readonly HeroTileBinding[] = [
  {
    label: "Critical Exposures",
    accent: "#f87171",
    orbAlpha: "33",
    realSub: "Need action now",
    valueInAccent: true,
    source: { kind: "criticalCount" },
  },
  {
    label: "MFA Coverage",
    accent: "#8B5CF6",
    orbAlpha: "33",
    realSub: "From your latest scan",
    source: {
      kind: "unmeasured",
      note: "MFA coverage % has no denominator check — only a registered-user count exists, and it is licence-gapped on this tenant.",
    },
  },
  {
    label: "Security Findings",
    accent: "#8B5CF6",
    orbAlpha: "33",
    realSub: "From your latest scan",
    source: { kind: "findingsTotal" },
  },
  {
    label: "Secure Score",
    accent: "#8B5CF6",
    orbAlpha: "33",
    realSub: "From your latest scan",
    source: {
      kind: "unmeasured",
      note: "Microsoft Secure Score is real but served by the security-posture route, not the war-room-pillars payload these pages read.",
    },
  },
];

/** `iconSvg` name → lucide glyph. Names map 1:1 per the handoff's asset note. */
const AREA_ICON = {
  lock: Lock,
  key: Key,
  "shield-check": ShieldCheck,
  "clipboard-list": ClipboardList,
  mail: Mail,
} as const;

export default function PortalV2SecurityPage() {
  // STEP 3: score, delta, 30-day trend, severity, critical/finding counts and the
  // hero tiles are the real war-room-pillars values now. Same `useLivePillarHero`
  // seam Licensing/Adoption/Health use; the extra derivations are pure and tested.
  const live = useLivePillarHero("security");
  const heroTiles = SEC_TILE_BINDINGS.map((b) => resolveHeroTile(b, live));
  const sev = pillarSeverity(live.score);

  // Real "last scan" value, same seam Overview uses (#1257) — the only one of
  // the scan strip's four values with a real, wired source.
  const scanStatus = useScanStatus();
  const lastScan = lastScanLabel(scanStatus.data?.lastScanAt ?? null, scanStatus.loaded);
  const criticalCount = live.findingCounts.critical;

  // Git #1258/#1337: OAuth Apps, Email Security, MFA Gaps and Legacy Auth
  // category scores overlaid onto the fixture when real (see
  // useSecAreaLinksLive.ts for which checks were confirmed to match).
  const areaLinksLive = useSecAreaLinksLive();

  // Conditional Access (#1337): reuses `useCaBaselineLive` (#1232) directly —
  // no new resolve metric needed. The card's "N baseline policies missing"
  // score is the real count of baseline rows whose live-overlaid status is
  // "Missing", the same count the CA drill-down's "Missing" stat card shows.
  const caLive = useCaBaselineLive();
  const caRowsAreLive = caLive.loaded && caLive.policies !== null;
  const caMissingCount = caRowsAreLive
    ? caBandsWithRowsLive(caLive.policies!, caLive.hasEntraP2)
        .flatMap((b) => b.rows)
        .filter((r) => r.statusLabel === CA_STATUS_META.missing.label).length
    : null;

  const secAreaLinks: readonly SecAreaLink[] = SEC_AREA_LINKS.map((a) => {
    if (a.key === "security-oauth" && areaLinksLive.live.oauthFlaggedGrantCount != null) {
      return { ...a, score: areaLinksLive.live.oauthFlaggedGrantCount };
    }
    if (a.key === "security-email" && areaLinksLive.live.emailAuthFindingCount != null) {
      return { ...a, score: areaLinksLive.live.emailAuthFindingCount };
    }
    if (a.key === "security-mfa" && areaLinksLive.live.mfaGapCount != null) {
      return { ...a, score: areaLinksLive.live.mfaGapCount };
    }
    if (a.key === "security-legacy-auth" && areaLinksLive.live.legacyAuthCount != null) {
      return { ...a, score: areaLinksLive.live.legacyAuthCount };
    }
    if (a.key === "security-ca" && caMissingCount != null) {
      return { ...a, score: caMissingCount };
    }
    return a;
  });
  const secAreaRow1 = secAreaLinks
    .filter((a) => a.key === "security-mfa" || a.key === "security-ca")
    .sort((a) => (a.key === "security-mfa" ? -1 : 1));
  const secAreaRow2 = secAreaLinks.filter((a) => a.key !== "security-mfa" && a.key !== "security-ca");

  // Honest-null contract (#1387): the REAL engine score when scored, and a muted
  // "—" through the one shared no-scan-data seam otherwise — never the fixture's
  // fabricated number. The ring draws no red arc when there is nothing to score.
  // `pv2-sec-source` states which is on screen.
  const score = live.score;
  const hasScore = hasScanValue(score);
  const hasHistory = Array.isArray(live.history) && live.history.length >= 2;
  const trend = hasHistory ? trendGeometry(live.history!) : null;
  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = hasScore ? ringC - (score / 100) * ringC : ringC;

  // The risk drop panel (proto `secRisk`, 8188) — identical to Governance's, so
  // the same component. The banner button toggles it; a row toggles its detail.
  const [riskOpen, setRiskOpen] = useState(false);
  const [riskRowId, setRiskRowId] = useState<string | null>(null);

  // Honest accepted-risk count (Git #1409): the real register
  // (`/api/portal/risk-register`, via `useRiskRegister`), not the fixture
  // `SEC_HERO.riskAccepted`. The banner is hidden entirely — not "0" — while
  // loading, on a read error, or when the tenant genuinely has none.
  const { risks: liveRisks, loading: risksLoading, error: risksError } = useRiskRegister();
  const secAcceptedCount =
    risksLoading || risksError
      ? null
      : liveRisks.filter((r) => r.pillar === "Security" && r.status === "Accepted").length;
  const showRiskBanner = typeof secAcceptedCount === "number" && secAcceptedCount > 0;

  return (
    <PortalV2Shell eyebrow="Pillar" title="Security">
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
        {/* Page glow — proto 530. Violet at .16, against Governance's blue .18. */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "-6%",
            width: "min(1000px,150%)",
            height: "56%",
            transform: "translateX(-50%)",
            filter: "blur(80px)",
            opacity: 0.5,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse at top, rgba(139,92,246,.16), rgba(2,6,23,0) 68%)",
          }}
        />

        {/* ── Back link + risk-accepted strip — proto 532-542 ────────────── */}
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
            data-testid="pv2-sec-back"
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

          {/* Honest-accepted-count contract (#1409): hidden entirely — not "0" —
              unless the real register has a nonzero accepted count for this
              pillar. Never the fixture `SEC_HERO.riskAccepted`. */}
          {showRiskBanner && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 14px",
                border: "1px solid rgba(194,166,61,.25)",
                borderRadius: 9,
                background: "rgba(194,166,61,.05)",
              }}
            >
              <span
                style={{ fontSize: "15px", fontWeight: 800, color: "#a89354", fontFamily: MONO }}
                data-testid="pv2-sec-risk-accepted-count"
              >
                {secAcceptedCount}
              </span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                finding{secAcceptedCount === 1 ? "" : "s"} risk-accepted in Security
              </span>
              {/* Prototype line 781, `secRisk.go` / `secRisk.label` — TOGGLES the
                  risk drop panel below rather than navigating. The register link
                  lives inside the panel, exactly as on Governance. */}
              <button
                type="button"
                onClick={() => setRiskOpen((o) => !o)}
                data-testid="pv2-sec-risk-toggle"
                aria-expanded={riskOpen}
                style={{
                  padding: 0,
                  border: "none",
                  background: "none",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  color: "#c2a63d",
                  whiteSpace: "nowrap",
                }}
              >
                {riskOpen ? "Hide the register" : "View full risk register →"}
              </button>
            </div>
          )}
        </div>

        {/* ── Risk drop panel — proto 785-865, shared with Governance. ────── */}
        {showRiskBanner && riskOpen && (
          <RiskAcceptedPanel
            pillar="Security"
            expandedId={riskRowId}
            onToggleRow={(id) => setRiskRowId((cur) => (cur === id ? null : id))}
            testPrefix="pv2-sec"
          />
        )}

        {/* ── The critical headline — proto 544-546. Governance has no such row.
            The count is the REAL critical finding count now, and the whole row is
            hidden when there are genuinely no criticals rather than printing
            "0 critical exposures need attention right now." */}
        {criticalCount > 0 && (
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "20px",
                fontWeight: 800,
                letterSpacing: "-.01em",
                color: RED,
                lineHeight: 1.3,
              }}
              data-testid="pv2-sec-critical-headline"
            >
              {criticalCount} critical{" "}
              {criticalCount === 1 ? "exposure needs" : "exposures need"} attention right now.
            </span>
          </div>
        )}

        {/* ── Hero card — proto 548-622 ──────────────────────────────────── */}
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
            background: "linear-gradient(160deg, rgba(139,92,246,.1), rgba(15,23,42,.5))",
          }}
          data-testid="pv2-sec-hero"
        >
          <div
            style={{
              position: "absolute",
              left: -60,
              top: -90,
              width: 320,
              height: 320,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(139,92,246,.26), rgba(2,6,23,0) 70%)",
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
              background: "radial-gradient(circle, rgba(139,92,246,.13), rgba(2,6,23,0) 70%)",
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
                {SEC_HERO.title}
              </span>
              <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.5 }}>
                {SEC_HERO.subtitle}
              </span>
              {/* Status pill — red at .1 background, against Governance's amber
                  at .08. Both numbers are the prototype's own. */}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  width: "fit-content",
                  whiteSpace: "nowrap",
                  padding: "4px 10px",
                  border: "1px solid rgba(248,113,113,.4)",
                  borderRadius: 5,
                  background: "rgba(248,113,113,.1)",
                }}
                data-testid="pv2-sec-status-pill"
              >
                <AlertTriangle size={10} color={RED} aria-hidden="true" />
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: RED,
                    whiteSpace: "nowrap",
                  }}
                >
                  {/* Real severity band for the live score, not the fixture
                      "Critical"; honest no-data label when unscored (#1387). */}
                  {sev?.label ?? NO_SCAN_DATA_LABEL}
                </span>
              </span>
            </div>

            <DriftTrend
              trend={trend}
              gradientId="secTrendFill"
              lineColor={RED}
              dotColor={RED}
              fillOpacity={0.3}
              // An honest verdict derived from the REAL trend direction, not the
              // fixture's fabricated "2 new exposures since scan 12"; honest
              // no-data label when there is no real series to describe (#1387).
              verdict={pillarTrendVerdict(live.history) ?? NO_SCAN_DATA_LABEL}
              verdictColor={RED}
              data-testid="pv2-sec-trend"
            />
          </div>

          {/* Ring + FOUR stat cards — proto 596-620. */}
          <div
            style={{
              position: "relative",
              display: "grid",
              gridTemplateColumns: "auto repeat(4,minmax(110px,1fr))",
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
                    background: "radial-gradient(circle, rgba(248,113,113,.32), rgba(2,6,23,0) 72%)",
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
                    stroke="rgba(148,163,184,.14)"
                    strokeWidth={9}
                  />
                  <circle
                    cx={52}
                    cy={52}
                    r={ringR}
                    fill="none"
                    stroke={RED}
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
                    color={RED}
                    testId="pv2-sec-score"
                    style={{
                      fontSize: "26px",
                      fontWeight: 800,
                      letterSpacing: "-.02em",
                      fontFamily: MONO,
                    }}
                  />
                  <span
                    style={{
                      fontSize: "9.5px",
                      fontWeight: 700,
                      color: live.delta?.color ?? NO_DATA_INK,
                      fontFamily: MONO,
                    }}
                    data-testid="pv2-sec-delta"
                  >
                    {live.delta?.text ?? NO_DATA_DASH}
                  </span>
                  {/* Hidden live/fixture marker so a test can prove the real score. */}
                  <span data-testid="pv2-sec-source" style={PV2_SOURCE_CLIP}>
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
                  borderLeft: `2px solid ${t.accent}`,
                  justifyContent: "center",
                }}
                data-testid={`pv2-sec-stat-${slug(t.label)}`}
              >
                <div
                  style={{
                    position: "absolute",
                    left: -30,
                    top: -30,
                    width: 110,
                    height: 110,
                    borderRadius: "50%",
                    background: `radial-gradient(circle, ${t.accent}${t.orbAlpha}, rgba(2,6,23,0) 70%)`,
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
                    color: t.unmeasured ? "#475569" : t.valueInAccent ? t.accent : "#f8fafc",
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

        {/* ── Scan strip — proto 624-628. Red dot, not Governance's green. ── */}
        <PillarScanBar
          dotColor={RED}
          pillarLabel="Security"
          scanNumber={SEC_HERO.scanNumber}
          fixedSinceScan1={SEC_HERO.fixedSinceScan1}
          lastScan={lastScan}
          nextScan={SEC_HERO.nextScan}
        />

        {/* ── Security Categories — proto 630-661 ───────────────────────── */}
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            border: "1px solid rgba(30,41,59,.9)",
            borderRadius: 14,
            background: "linear-gradient(160deg, rgba(139,92,246,.05), rgba(15,23,42,.4))",
            padding: 16,
          }}
          data-testid="pv2-sec-categories"
        >
          <div
            style={{
              position: "absolute",
              left: -40,
              top: -50,
              width: 200,
              height: 200,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(139,92,246,.14), rgba(2,6,23,0) 70%)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "relative",
              fontSize: "9.5px",
              fontWeight: 700,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              color: "#64748b",
              marginBottom: 12,
            }}
          >
            Security Categories
          </div>
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 10 }}>
            {!areaLinksLive.loaded ? (
              // Real per-category read in flight: honest skeleton, never the
              // fixture category scores swapping in after the fact (Git #1365).
              <PortalV2LoadingState rows={2} label="Loading your security categories…" testId="pv2-sec-areas-loading" />
            ) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 10 }}>
                  {secAreaRow1.map((a) => (
                    <AreaCard key={a.key} link={a} allLinks={secAreaLinks} />
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 10 }}>
                  {secAreaRow2.map((a) => (
                    <AreaCard key={a.key} link={a} allLinks={secAreaLinks} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── All-resolved — proto 663-672. At the BOTTOM on this pillar. ─── */}
        {SEC_HERO.allResolved && (
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              textAlign: "center",
              padding: "40px 24px",
              border: "1px solid rgba(52,211,153,.3)",
              borderRadius: 14,
              background: "linear-gradient(160deg, rgba(52,211,153,.08), rgba(15,23,42,.5))",
            }}
          >
            <PartyPopper size={34} color="#34d399" aria-hidden="true" />
            <span style={{ fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
              Secure, within accepted risk
            </span>
            <span style={{ fontSize: "13px", color: "#94a3b8", maxWidth: 440, lineHeight: 1.5 }}>
              Every open security finding is resolved. MFA, conditional access, OAuth apps, legacy
              auth, and email security are all within your tenant baseline.
            </span>
          </div>
        )}
      </div>
    </PortalV2Shell>
  );
}

/**
 * One Security Categories card — proto 641-654.
 *
 * The progress bar is INVERSE severity (`1 - score/max`), so Conditional Access
 * at 17 renders empty and OAuth Apps at 1 renders nearly full. It reads as "how
 * much of this area is already fine". `flex-grow` is severity-driven too, so the
 * worst area is also the widest card.
 */
function AreaCard({ link, allLinks }: { link: SecAreaLink; allLinks: readonly SecAreaLink[] }) {
  const { progressPct, grow } = secAreaGeometry(link, allLinks);
  const Glyph = AREA_ICON[link.icon];

  return (
    <Link
      href={`/portal-v2/security/${link.key.replace(/^security-/, "")}`}
      data-testid={`pv2-sec-area-${link.key}`}
      className="pv2-area-card"
      style={{
        // Security hovers to the PILLAR violet on every card (proto 641), where
        // Governance hovers to each tile's own status colour. See portal-v2.css.
        ["--pv2-area-hover" as string]: "rgba(139,92,246,.4)",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        textAlign: "left",
        background: SEC_STATUS.wash,
        border: `1px solid ${SEC_STATUS.c}38`,
        borderRadius: 8,
        padding: SEC_STATUS.pad,
        cursor: "pointer",
        fontFamily: "inherit",
        flex: `${grow} 1 0`,
        minWidth: 130,
        textDecoration: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          right: -20,
          top: -24,
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${SEC_STATUS.c}20, rgba(2,6,23,0) 70%)`,
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            position: "relative",
            flex: "0 0 22px",
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: `1px solid ${SEC_STATUS.c}40`,
            background: `${SEC_STATUS.c}12`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Glyph size={SEC_STATUS.icon} color={SEC_STATUS.c} aria-hidden="true" />
        </span>
        <span
          style={{
            position: "relative",
            fontSize: `${SEC_STATUS.score}px`,
            fontWeight: 800,
            color: "#f8fafc",
            letterSpacing: "-.02em",
            fontFamily: MONO,
          }}
        >
          {link.score}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          fontSize: "10.5px",
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
          height: 4,
          borderRadius: 2,
          background: "rgba(148,163,184,.14)",
          overflow: "hidden",
          marginTop: 2,
        }}
      >
        <div
          style={{
            height: "100%",
            borderRadius: 2,
            width: `${progressPct}%`,
            background: SEC_STATUS.c,
            opacity: 0.8,
          }}
        />
      </div>
    </Link>
  );
}
