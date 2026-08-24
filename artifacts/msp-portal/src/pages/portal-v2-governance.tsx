/**
 * portal-v2-governance.tsx — the Governance pillar dashboard.
 *
 * A direct port of the prototype's `isGovernance` block
 * (`Customer Portal Shell.dc.html` lines 392-526). Every style value is the
 * prototype's own; where a house component's defaults conflict, the design's
 * numbers win and the house component is not used.
 *
 * ── Two corrections to the README, both verified against the prototype ──────
 *
 * 1. The README says every pillar dashboard has "score ring, trend sparkline,
 *    finding rows, area link cards". Governance has NO finding rows. Grepping
 *    the prototype for `governanceRows` finds it built and exported but never
 *    rendered — no `sc-for` consumes it. Governance (and Security) replaced
 *    on-page finding rows with the cluster/area-card grid; per-finding content
 *    lives on the `governance-*` drill-downs. Compliance and Health still have
 *    them, so the README is accurate there and stale here. Rendering rows that
 *    the design deleted would be inventing a section.
 *
 * 2. The prototype ships a literal 🎉 in the all-resolved panel and a ⚠ glyph in
 *    the status pill, but the README states "No emoji anywhere" and the repo's
 *    own voice guide agrees. The README wins: both are lucide icons here. This
 *    is the one place the prototype's markup is deliberately NOT copied
 *    character-for-character.
 *
 * ── Why the ring is bespoke rather than ui/score-ring.tsx ───────────────────
 * The shared `ScoreRing` renders a 0-100 value with a `%` suffix, a
 * `hsl(var(--muted))` track and a token-derived stroke. The design's hero ring
 * is a 104-unit viewBox drawn at 88px with r=46/strokeWidth=9, a
 * `rgba(148,163,184,.14)` track, a hardcoded `#3B82F6` stroke, a bare numeral in
 * 26px/800 mono, and a delta line beneath. Those conflict on every axis, and the
 * instruction is that the design's numbers win. `ScoreRing` is still the right
 * component everywhere its own shape fits — it stays in use on the overview.
 */

import { useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ClipboardList,
  GitCommitHorizontal,
  Key,
  Mail,
  PartyPopper,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { PillarScanBar } from "@/components/portal-v2/PillarScanBar";
import { DriftTrend } from "@/components/portal-v2/DriftTrend";
import { RiskAcceptedPanel } from "@/components/portal-v2/RiskAcceptedPanel";
import {
  GOV_AREA_LINKS,
  GOV_CLUSTERS,
  GOV_HERO,
  govAreaGeometry,
  govTrendGeometry,
  type GovAreaLink,
} from "@/components/portal-v2/govDashboardData";

const MONO = "'SF Mono',Menlo,Consolas,monospace";
const BLUE = "#3B82F6";

/** `iconSvg` name → lucide glyph, matching the gov-oversharing sibling's map. */
const AREA_ICON = {
  mail: Mail,
  users: Users,
  "git-commit": GitCommitHorizontal,
  "shield-check": ShieldCheck,
  key: Key,
  "clipboard-list": ClipboardList,
  smartphone: Smartphone,
} as const;

/** `ar.cardCss` tier metrics — severity drives SIZE as well as colour. */
const TIER = {
  large: { padding: 15, icon: 16, score: 26, label: 12, grow: 3 },
  medium: { padding: 11, icon: 13, score: 20, label: 11, grow: 2 },
  small: { padding: 9, icon: 11, score: 17, label: 10, grow: 1 },
} as const;

export default function PortalV2GovernancePage() {
  const trend = govTrendGeometry();
  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC - (GOV_HERO.score / 100) * ringC;

  // The risk drop panel (proto `govRisk`, 8188): the banner button toggles it
  // open, a row toggles its own detail. Both live here rather than in the panel
  // so the toggle button and the panel stay siblings, as the markup places them.
  const [riskOpen, setRiskOpen] = useState(false);
  const [riskRowId, setRiskRowId] = useState<string | null>(null);

  const clusters = GOV_CLUSTERS.map((name) => ({
    name,
    tiles: GOV_AREA_LINKS.filter((a) => a.cluster === name),
  })).filter((c) => c.tiles.length > 0);

  const allResolved = clusters.length === 0;

  return (
    <PortalV2Shell eyebrow="Pillar" title="Governance">
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
        {/* Ambient bloom — line 394 */}
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
              "radial-gradient(ellipse at top, rgba(59,130,246,.18), rgba(2,6,23,0) 68%)",
          }}
        />

        {/* Back link + risk-accepted strip — lines 396-406 */}
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
            data-testid="pv2-gov-back"
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
              border: "1px solid rgba(194,166,61,.25)",
              borderRadius: 9,
              background: "rgba(194,166,61,.05)",
            }}
          >
            <span
              style={{
                fontSize: "15px",
                fontWeight: 800,
                color: "#a89354",
                fontFamily: MONO,
              }}
            >
              {GOV_HERO.riskAccepted}
            </span>
            <span style={{ fontSize: "11.5px", color: "#94a3b8", whiteSpace: "nowrap" }}>
              finding risk-accepted in Governance
            </span>
            {/* Prototype line 563, `govRisk.go` / `govRisk.label` — this button
                TOGGLES the risk drop panel below rather than navigating. The
                label follows the state (8205); the "Open in the register →" link
                that actually leaves for the register lives INSIDE the panel. */}
            <button
              type="button"
              onClick={() => setRiskOpen((o) => !o)}
              data-testid="pv2-gov-risk-toggle"
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
        </div>

        {/* ── Risk drop panel — proto 567-647. Independent of the all-resolved
            state below: the accepted risk stays visible and tracked. ─────── */}
        {riskOpen && (
          <RiskAcceptedPanel
            pillar="Governance"
            expandedId={riskRowId}
            onToggleRow={(id) => setRiskRowId((cur) => (cur === id ? null : id))}
            testPrefix="pv2-gov"
          />
        )}

        {/* All-resolved panel — proto 649-658. In the current design this is an
            ADDITIVE sibling shown above the hero when resolved, not an either/or:
            the hero, scan strip and area grid render unconditionally below it.
            Emoji replaced with a lucide icon per the README. */}
        {allResolved && (
          <div
            style={{
              position: "relative",
              padding: "40px 24px",
              border: "1px solid rgba(52,211,153,.3)",
              borderRadius: 14,
              background: "linear-gradient(160deg, rgba(52,211,153,.08), rgba(15,23,42,.5))",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <PartyPopper size={34} color="#34d399" aria-hidden="true" />
            {/* Copy verbatim from prototype lines 414-415 — an earlier build
                paraphrased both strings, which the "copy is final" rule forbids. */}
            <span style={{ fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
              Secure, within accepted risk
            </span>
            <span
              style={{
                fontSize: "13px",
                color: "#94a3b8",
                maxWidth: 440,
                lineHeight: 1.5,
                textAlign: "center",
              }}
            >
              Every open governance finding is resolved. Sharing, identity, apps &amp; roles,
              and devices are all within your tenant baseline — the risk-accepted item above
              stays visible and tracked, not swept away.
            </span>
          </div>
        )}

        <>
            {/* ── Hero card — proto 660-726 ─────────────────────────── */}
            <div
              style={{
                position: "relative",
                padding: 24,
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 14,
                background: "linear-gradient(160deg, rgba(59,130,246,.09), rgba(15,23,42,.5))",
                display: "flex",
                flexDirection: "column",
                gap: 20,
                overflow: "hidden",
              }}
              data-testid="pv2-gov-hero"
            >
              <div
                style={{
                  position: "absolute",
                  left: -60,
                  top: -90,
                  width: 320,
                  height: 320,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle, rgba(59,130,246,.28), rgba(2,6,23,0) 70%)",
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
                  background:
                    "radial-gradient(circle, rgba(59,130,246,.14), rgba(2,6,23,0) 70%)",
                  pointerEvents: "none",
                }}
              />

              {/* ── Hero header: TWO COLUMNS ─────────────────────────────
                  Prototype lines 423-450. This row has exactly two flex
                  children: the title column (which CONTAINS the status pill)
                  and the trend block. An earlier build had the pill as a third
                  sibling pushed right by space-between, which forced the trend
                  out of the row and stacked it underneath with a dead gap. The
                  pill belongs inside the title column; the trend is the second
                  child, and its `flex:1 1 260px` is what makes it fill the
                  right-hand side. */}
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
                    data-testid="pv2-gov-heading"
                  >
                    {GOV_HERO.title}
                  </span>
                  <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.5 }}>
                    {GOV_HERO.subtitle}
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      width: "fit-content",
                      whiteSpace: "nowrap",
                      padding: "4px 10px",
                      border: "1px solid rgba(194,166,61,.4)",
                      borderRadius: 5,
                      background: "rgba(194,166,61,.08)",
                    }}
                    data-testid="pv2-gov-status-pill"
                  >
                    <AlertTriangle size={10} color="#c2a63d" aria-hidden="true" />
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        letterSpacing: ".08em",
                        textTransform: "uppercase",
                        color: "#c2a63d",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {GOV_HERO.statusLabel}
                    </span>
                  </span>
                </div>

                {/* Trend sparkline — prototype lines 433-449, the SECOND child
                    of the header row so it sits to the right of the title.
                    Shared with Security via DriftTrend, which was extracted only
                    after checking Security's own markup: same block, and the
                    three things that differ — the verdict line, the colours and
                    the gradient id — are props. Governance passes NO verdict:
                    Security's trend sentence has no Governance counterpart, and
                    rendering an empty one would change the block's height. */}
                <DriftTrend
                  trend={trend}
                  gradientId="govTrendFill"
                  lineColor={BLUE}
                  dotColor="#60a5fa"
                  fillOpacity={0.35}
                  data-testid="pv2-gov-trend"
                />
              </div>

              {/* Ring + 3 stat cards — lines 452-484 */}
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "2px 22px 2px 0",
                  }}
                >
                  <div style={{ width: 88, height: 88, flex: "0 0 auto", position: "relative" }}>
                    <div
                      style={{
                        position: "absolute",
                        inset: -18,
                        borderRadius: "50%",
                        background:
                          "radial-gradient(circle, rgba(59,130,246,.3), rgba(2,6,23,0) 72%)",
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
                        stroke={BLUE}
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
                          color: "#60a5fa",
                          fontFamily: MONO,
                        }}
                        data-testid="pv2-gov-score"
                      >
                        {GOV_HERO.score}
                      </span>
                      <span
                        style={{
                          fontSize: "9.5px",
                          fontWeight: 700,
                          color: "#f87171",
                          fontFamily: MONO,
                        }}
                      >
                        {GOV_HERO.delta}
                      </span>
                    </div>
                  </div>
                </div>

                {GOV_HERO.stats.map((s) => (
                  <div
                    key={s.label}
                    style={{
                      position: "relative",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      padding: "2px 16px",
                      justifyContent: "center",
                      borderLeft: `2px solid ${s.accent}`,
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: -30,
                        top: -30,
                        width: 110,
                        height: 110,
                        borderRadius: "50%",
                        background: `radial-gradient(circle, ${s.accent}${s.orbAlpha}, rgba(2,6,23,0) 70%)`,
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
                    <span
                      style={{ position: "relative", fontSize: "10.5px", color: "#64748b" }}
                    >
                      {s.sub}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Scan status bar — prototype lines 487-491 ─────────────
                Shared with Security (623-627), which is byte-identical apart
                from the dot colour and pillar name — see PillarScanBar. */}
            <PillarScanBar
              dotColor="#22C55E"
              pillarLabel="Governance"
              scanNumber={GOV_HERO.scanNumber}
              fixedSinceScan1={GOV_HERO.fixedSinceScan1}
              lastScan={GOV_HERO.lastScan}
              nextScan={GOV_HERO.nextScan}
            />

            {/* ── Area link cards — lines 493-523 ───────────────────── */}
            <div
              style={{
                position: "relative",
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 14,
                background: "linear-gradient(160deg, rgba(59,130,246,.05), rgba(15,23,42,.4))",
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 16,
                overflow: "hidden",
              }}
              data-testid="pv2-gov-areas"
            >
              <div
                style={{
                  position: "absolute",
                  left: -40,
                  top: -50,
                  width: 200,
                  height: 200,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle, rgba(59,130,246,.14), rgba(2,6,23,0) 70%)",
                  pointerEvents: "none",
                }}
              />

              {clusters.map((cluster) => (
                <div
                  key={cluster.name}
                  style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    gap: 9,
                  }}
                >
                  <span
                    style={{
                      fontSize: "9.5px",
                      fontWeight: 700,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: "#475569",
                    }}
                  >
                    {cluster.name}
                  </span>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "stretch",
                      gap: 10,
                    }}
                  >
                    {cluster.tiles.map((a) => (
                      <AreaTile key={a.key} tile={a} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
        </>
      </div>

    </PortalV2Shell>
  );
}

/**
 * One Governance area tile — proto 741-759, geometry at builder 13847-13878.
 *
 * The earlier revision this page was built from rendered a plain score/label
 * card. The current design gives the tile the same anatomy as Compliance's area
 * card: a status-coloured icon and a four-bar sparkline in the top-right, a
 * tier-scaled delta chip that always prints (`±0` when flat), a 6px status dot,
 * and a status label that is NOT uppercased. Severity still drives size and
 * flex-grow through `TIER`.
 */
function AreaTile({ tile }: { tile: GovAreaLink }) {
  const { meta, deltaText, deltaColor, sparkBars } = govAreaGeometry(tile);
  const t = TIER[meta.tier];
  const Glyph = AREA_ICON[tile.icon as keyof typeof AREA_ICON];

  return (
    <Link
      href={`/portal-v2/governance/${tile.key.replace(/^governance-/, "")}`}
      data-testid={`pv2-gov-area-${tile.key}`}
      className="pv2-area-card"
      style={{
        // `ar.hoverCss` (builder 13871) — each tile hovers to its OWN status
        // colour at `70`, unlike Security where every card hovers to the pillar
        // violet. The rule itself lives in portal-v2.css; only the value is here.
        ["--pv2-area-hover" as string]: `${meta.c}70`,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        textAlign: "left",
        border: `1px solid ${meta.c}38`,
        borderRadius: 8,
        cursor: "pointer",
        fontFamily: "inherit",
        flex: `${t.grow} 1 0`,
        minWidth: 110,
        padding: t.padding,
        background: meta.wash,
        textDecoration: "none",
      }}
    >
      {/* glow — proto 742 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 140% 100% at 0% 0%, ${meta.c}1c, transparent 60%)`,
          pointerEvents: "none",
        }}
      />
      {/* Sparkbars, top-right — proto 743-747 */}
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
      {/* Icon + score + delta — proto 748-752 */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 7 }}>
        {Glyph && (
          <Glyph size={t.icon} color={meta.c} aria-hidden="true" style={{ display: "flex" }} />
        )}
        <span
          style={{
            fontSize: t.score,
            fontWeight: 800,
            color: "#f8fafc",
            letterSpacing: "-.02em",
            fontFamily: MONO,
          }}
        >
          {tile.score}
        </span>
        <span
          style={{
            fontSize: Math.max(t.label - 1, 9),
            fontWeight: 700,
            color: deltaColor,
            fontFamily: MONO,
          }}
        >
          {deltaText}
        </span>
      </div>
      <span
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
        {tile.label}
      </span>
      <span
        style={{
          position: "relative",
          fontSize: "9.5px",
          color: "#64748b",
          textAlign: "left",
          width: "100%",
          lineHeight: 1.25,
        }}
      >
        {tile.sub}
      </span>
      <span
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
      </span>
    </Link>
  );
}
