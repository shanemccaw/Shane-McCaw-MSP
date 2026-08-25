/**
 * portal-v2-overview.tsx — the Tenant health overview.
 *
 * REBUILT to the current design ('Customer Portal Shell.dc.html' 381-550).
 *
 * ── Why it was rebuilt rather than adjusted ────────────────────────────────
 * The round-one page was a Copilot gate band, six rich pillar cards and a "Most
 * Urgent" list. The design moved: it is now a scan band carrying drift chips
 * and an evidence pack, a COMPACT six-across pillar strip, and an "Everything
 * in motion" section that puts every pipeline in the tenant on one screen. A
 * copy-coverage audit (scripts/audit-portal-fidelity.mts) put the old page at
 * 44% of this design — it had never been rebuilt after the design changed.
 *
 * ── What is real ──────────────────────────────────────────────────────────
 * The pillar strip is LIVE: scores, finding counts and the replayed trend all
 * come from GET /api/portal/assessment/war-room-pillars via usePortalV2Pillars,
 * exactly as before. The design hardcodes each pillar's delta and sub-line; both
 * are derived here from the real payload instead — see overviewModel's
 * pillarDelta / pillarStripSub, and the one place that is deliberately NOT
 * reproduced (Licensing's "$2,280/mo reclaimable", which we cannot derive and
 * will not invent).
 *
 * Everything else on the page is design content with no endpoint behind it,
 * held in overviewData.ts so it can be swapped in one place.
 *
 * ── The Copilot gate is NOT on this page any more ─────────────────────────
 * The design's overview has no gate band; the gate lives on its own `copilot`
 * page, which is not built. The band is removed rather than left orphaned at
 * the top of a page the design gives a different shape — but that means the
 * gate has no surface at all until /portal-v2/copilot exists. Recorded so it is
 * a known consequence rather than a silent loss.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronDown, Loader2 } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { PortalV2ScanLanding } from "@/components/portal-v2/PortalV2ScanLanding";
import { usePortalV2Pillars } from "@/components/portal-v2/usePortalV2Pillars";
import { useScanStatus } from "@/lib/scan-status-context";
import { useRiskRegister } from "@/components/portal-v2/riskRegisterLive";
import { useRunbooks } from "@/components/portal-v2/holds/useRunbooks";
import { useChangeControl } from "@/components/portal-v2/useChangeControl";
import { hexAlpha } from "@/components/copilot-journey/journeyTokens";
import {
  OV_EVIDENCE_ROWS,
  OV_HEADLINE_SUB,
  OV_MC_INCOMING,
  OV_POLICY_DECISIONS,
  PJ_CONTRACT_END,
  PJ_CURRENT_WEEKS,
  PJ_TODAY,
  PJ_WEEKS,
} from "@/components/portal-v2/overviewData";
import {
  acceptedRiskLanes,
  crLanes,
  crLanesFromLive,
  driftChips,
  flaggedPolicyCount,
  headlineMain,
  holdLanes,
  holdLanesFromLive,
  laneTrackBackground,
  lastScanLabel,
  mcLanes,
  pdLanes,
  pillarDelta,
  pillarDeltaLabel,
  pillarDeltaTone,
  pillarsOpenFindingsTotal,
  pillarStripSub,
  pjPct,
  pjRows,
  sectionCount,
  type Lane,
} from "@/components/portal-v2/overviewModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/** The 9.5px/700/.2em uppercase kicker the page's bands open with. */
function Kicker({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "9.5px",
        fontWeight: 700,
        letterSpacing: ".2em",
        textTransform: "uppercase",
        color: colour,
      }}
    >
      {children}
    </span>
  );
}

/* ── A lane's mini gantt bar — prototype 481-491 ─────────────────────────── */

function LaneBar({ lane }: { lane: Lane }) {
  if (lane.bar.unscheduled) {
    return (
      <span
        style={{
          justifySelf: "end",
          alignSelf: "flex-end",
          fontSize: "9.5px",
          fontWeight: 700,
          color: "#f87171",
          letterSpacing: ".05em",
          textTransform: "uppercase",
        }}
      >
        Unscheduled
      </span>
    );
  }
  return (
    <>
      <div
        style={{
          position: "relative",
          height: 22,
          borderRadius: 5,
          background: laneTrackBackground(lane.bar.weekStepPct),
        }}
      >
        <div
          style={{
            position: "absolute",
            left: `${lane.bar.todayLeft}%`,
            top: -2,
            bottom: -2,
            width: 1,
            background: "rgba(34,211,238,.5)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 3,
            bottom: 3,
            left: `${lane.bar.left}%`,
            width: `${lane.bar.width}%`,
            borderRadius: 4,
            background: lane.fill ?? lane.tone,
            opacity: 0.85,
          }}
        />
      </div>
      <span
        style={{
          alignSelf: "flex-end",
          fontSize: "9.5px",
          color: "#64748b",
          fontFamily: MONO,
        }}
      >
        {lane.dateLabel}
      </span>
    </>
  );
}

function LaneRow({ lane, href }: { lane: Lane; href: string }) {
  return (
    <Link
      href={href}
      data-testid={`pv2-ov-lane-${lane.key}`}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) 108px",
        gap: 10,
        alignItems: "center",
        padding: "7px 6px",
        borderTop: "1px solid rgba(30,41,59,.7)",
        background: "none",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        width: "100%",
        textDecoration: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "#e2e8f0",
            lineHeight: 1.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {lane.title}
        </span>
        {lane.note && (
          <span
            style={{
              fontSize: "10.5px",
              color: "#64748b",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {lane.note}
          </span>
        )}
      </div>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <LaneBar lane={lane} />
      </div>
    </Link>
  );
}

/* ── One "Everything in motion" card — prototype 465-543 ─────────────────── */

function MotionSection({
  id,
  label,
  countLabel,
  linkLabel,
  href,
  fullWidth,
  children,
}: {
  id: string;
  label: string;
  countLabel: string;
  linkLabel: string;
  href: string;
  fullWidth?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-testid={`pv2-ov-section-${id}`}
      style={{
        border: "1px solid rgba(30,41,59,.9)",
        borderRadius: 12,
        background: "rgba(15,23,42,.35)",
        overflow: "hidden",
        gridColumn: fullWidth ? "1 / -1" : undefined,
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid={`pv2-ov-toggle-${id}`}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "13px 16px",
          border: "none",
          background: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <span
          style={{
            display: "flex",
            flex: "0 0 auto",
            color: "#64748b",
            transform: `rotate(${open ? 180 : 0}deg)`,
            transition: "transform 180ms",
          }}
        >
          <ChevronDown size={12} />
        </span>
        <span style={{ flex: 1, fontSize: "12.5px", fontWeight: 700, color: "#f1f5f9" }}>
          {label}
        </span>
        <span style={{ fontSize: "10.5px", color: "#64748b", fontFamily: MONO }}>{countLabel}</span>
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 16px 14px" }}>
          {children}
          <Link
            href={href}
            data-testid={`pv2-ov-link-${id}`}
            style={{
              alignSelf: "flex-start",
              marginTop: 8,
              padding: 0,
              border: "none",
              background: "none",
              fontFamily: "inherit",
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 700,
              color: "#60a5fa",
              textDecoration: "none",
            }}
          >
            {linkLabel}
          </Link>
        </div>
      )}
    </div>
  );
}

/* ── The project schedule lane — prototype 509-540 ───────────────────────── */

function ProjectSchedule() {
  const rows = pjRows();
  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "150px minmax(0,1fr)",
          gap: 12,
          alignItems: "end",
          padding: "6px 6px 4px",
        }}
      >
        <span
          style={{
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "#475569",
          }}
        >
          Phase
        </span>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          {PJ_WEEKS.map((w, i) => (
            <span
              key={w}
              style={{
                flex: "1 1 0",
                width: "11.1111%",
                minWidth: 0,
                fontSize: "9.5px",
                color: PJ_CURRENT_WEEKS.includes(i) ? "#94a3b8" : "#475569",
                fontFamily: MONO,
                paddingBottom: 3,
                borderLeft: "1px solid rgba(30,41,59,.85)",
                paddingLeft: 5,
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              {w}
            </span>
          ))}
        </div>
      </div>
      {rows.map((g) => (
        <div
          key={g.n}
          data-testid={`pv2-ov-phase-${g.n}`}
          style={{
            display: "grid",
            gridTemplateColumns: "150px minmax(0,1fr)",
            gap: 12,
            alignItems: "center",
            padding: "6px 6px",
            borderTop: "1px solid rgba(30,41,59,.7)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
            <span
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "#e2e8f0",
                lineHeight: 1.35,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {g.name}
            </span>
            <span style={{ fontSize: "9.5px", color: "#64748b", fontFamily: MONO }}>{g.dates}</span>
          </div>
          <div
            style={{
              position: "relative",
              height: 30,
              borderRadius: 6,
              background:
                "repeating-linear-gradient(90deg, rgba(148,163,184,.07) 0 1px, transparent 1px 11.1111%)",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: `${pjPct(PJ_TODAY)}%`,
                top: -2,
                bottom: -2,
                width: 1,
                background: "rgba(34,211,238,.55)",
              }}
            />
            {/* The contract's end date, drawn as a hard line the bars can cross. */}
            <div
              style={{
                position: "absolute",
                left: `${pjPct(PJ_CONTRACT_END)}%`,
                top: -2,
                bottom: -2,
                width: 1,
                background: "rgba(226,232,240,.22)",
              }}
            />
            {g.slip && (
              <div
                style={{
                  position: "absolute",
                  left: `${g.slip.left}%`,
                  width: `${g.slip.width}%`,
                  top: 7,
                  height: 16,
                  borderRadius: 4,
                  border: "1px dashed rgba(248,113,113,.5)",
                  background:
                    "repeating-linear-gradient(135deg, rgba(248,113,113,.18) 0 5px, transparent 5px 10px)",
                }}
              />
            )}
            <div
              style={{
                position: "absolute",
                left: `${g.left}%`,
                width: `${g.width}%`,
                top: 4,
                height: 22,
                borderRadius: 5,
                border: `1px solid ${g.tone}${g.status === "pending" ? "55" : "99"}`,
                background: g.status === "pending" ? "rgba(100,116,139,.14)" : `${g.tone}26`,
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${g.donePct}%`,
                  background: `${g.tone}${g.status === "complete" ? "66" : "4d"}`,
                }}
              />
              <span
                style={{
                  position: "relative",
                  padding: "0 7px",
                  fontSize: "9.5px",
                  fontWeight: 700,
                  color: g.status === "pending" ? "#94a3b8" : "#f1f5f9",
                  whiteSpace: "nowrap",
                  fontFamily: MONO,
                }}
              >
                {g.barText}
              </span>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function PortalV2OverviewPage() {
  const { view, loaded, scanning, everScanned } = usePortalV2Pillars();
  const scanStatus = useScanStatus();
  const riskRegister = useRiskRegister();
  const runbooks = useRunbooks();
  const changeControl = useChangeControl();
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  // Zero-data landing (Git #1298). A CustomerUser lands straight here with no
  // scan on record — port Scene 0 (RevealScanOverlay) as their entry point and
  // hand off to this Overview once the scan lands. `landingArmed` latches the
  // moment scan-status confirms a genuinely zero-data tenant and STAYS armed
  // through the scan completing (when everScanned flips true), so the landing's
  // own completion dissolve can't be yanked out mid-fade; it unmounts only when
  // the landing itself signals done (onComplete). An established tenant
  // (everScanned already true on first poll) never arms it, so the landing —
  // and its extra journey fetches — never mount for the common case.
  const [landingArmed, setLandingArmed] = useState(false);
  const [landingComplete, setLandingComplete] = useState(false);
  useEffect(() => {
    if (scanStatus.loaded && !everScanned) setLandingArmed(true);
  }, [scanStatus.loaded, everScanned]);
  const showLanding = landingArmed && !landingComplete;

  // The real clock, per the README's "use the real clock in production" note on
  // hold windows. Held in state so one render cannot see two different `now`s;
  // the interval re-derive that makes T-24 fire without a reload belongs with
  // the Active Runbooks page, which owns the hold system. Only the FIXTURE path
  // needs it — the live path's clock is already resolved server-side by
  // useRunbooks, same as Active Runbooks itself.
  const [now] = useState(() => new Date());
  const holds =
    runbooks.loaded && !runbooks.error && runbooks.payload
      ? holdLanesFromLive(runbooks.payload.holds)
      : holdLanes(now);
  const riskRegisterLive = !riskRegister.loading && !riskRegister.error;
  const accepted = riskRegisterLive ? acceptedRiskLanes(riskRegister.risks) : acceptedRiskLanes();
  const crMotionLanes =
    changeControl.dataState === "live" ? crLanesFromLive(changeControl.crs()) : crLanes();

  const totalFindings = loaded ? pillarsOpenFindingsTotal(view.pillars) : null;
  const chips = useMemo(
    () =>
      driftChips({
        fixedThisWeek: null,
        newThisWeek: null,
        acceptedAsRisk: riskRegisterLive ? accepted.length : null,
      }),
    [riskRegisterLive, accepted.length],
  );
  const lastScan = lastScanLabel(scanStatus.data?.lastScanAt ?? null, scanStatus.loaded);

  return (
    <PortalV2Shell eyebrow="Overview" title="Tenant health">
      {/* Scene 0, ported (Git #1298). A full-bleed fixed overlay while a
          zero-data customer's scan runs; dissolves into this Overview on
          completion. Renders nothing once handed off, or for a tenant that
          already has scan data. */}
      {showLanding ? (
        <PortalV2ScanLanding onComplete={() => setLandingComplete(true)} />
      ) : null}
      <div
        style={{
          position: "relative",
          maxWidth: 1180,
          margin: "0 auto",
          padding: "28px 28px 110px",
          display: "flex",
          flexDirection: "column",
          gap: 22,
          minWidth: 0,
          boxSizing: "border-box",
        }}
      >
        {/* The page's own light source — prototype 383. */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "-8%",
            width: "min(1100px,150%)",
            height: "60%",
            transform: "translateX(-50%)",
            filter: "blur(80px)",
            opacity: 0.5,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse at top, rgba(0,120,212,.14), rgba(2,6,23,0) 68%)",
          }}
        />

        {/* ── Headline — prototype 385-389 ──────────────────────────────── */}
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6 }}>
          <Kicker colour="#00B4D8">Tenant health · live</Kicker>
          <h1
            style={{
              margin: 0,
              fontSize: "23px",
              fontWeight: 800,
              letterSpacing: "-.015em",
              color: "#f8fafc",
              lineHeight: 1.3,
            }}
            data-testid="pv2-page-title"
          >
            {headlineMain(totalFindings)}
          </h1>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.5, maxWidth: "74ch" }}>
            {OV_HEADLINE_SUB}
          </div>
        </div>

        {/* ── Since your last scan — prototype 391-435 ──────────────────── */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "18px 20px",
            border: "1px solid rgba(30,41,59,.9)",
            borderRadius: 14,
            background: "rgba(15,23,42,.5)",
          }}
          data-testid="pv2-ov-scan-band"
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <Kicker colour="#64748b">Since your last scan · {lastScan}</Kicker>
            <button
              data-testid="pv2-ov-scan"
              style={{
                padding: "4px 11px",
                borderRadius: 6,
                border: "1px solid rgba(0,180,216,.4)",
                background: "rgba(0,180,216,.1)",
                color: "#22d3ee",
                fontSize: "10.5px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {scanning && <Loader2 className="size-3 animate-spin" />}
              {scanning ? "Scanning…" : "Scan now"}
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
              gap: 10,
            }}
            data-testid="pv2-ov-drift"
          >
            {chips.map((c) => (
              <div
                key={c.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "11px 13px",
                  border: `1px solid ${c.border}`,
                  borderRadius: 9,
                  background: c.background,
                }}
              >
                <span
                  style={{
                    fontSize: "20px",
                    fontWeight: 800,
                    color: c.tone,
                    fontFamily: MONO,
                    flex: "none",
                  }}
                >
                  {c.num}
                </span>
                <span
                  style={{ fontSize: "11.5px", fontWeight: 500, lineHeight: 1.4, color: "#94a3b8" }}
                >
                  {c.label}
                </span>
              </div>
            ))}
          </div>

          {/* The evidence pack divider — prototype 404-415 */}
          <button
            onClick={() => setEvidenceOpen((v) => !v)}
            data-testid="pv2-ov-evidence-toggle"
            aria-expanded={evidenceOpen}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "none",
              border: "none",
              padding: "2px 0",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <span style={{ flex: 1, height: 1, background: "rgba(30,41,59,.9)" }} />
            <span
              style={{
                flex: "0 0 auto",
                display: "flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "#34d399",
                }}
              >
                Evidence pack
              </span>
              <span
                style={{ fontSize: "11px", fontWeight: 700, color: "#34d399", fontFamily: MONO }}
              >
                {OV_EVIDENCE_ROWS.length}
              </span>
              <span
                style={{
                  display: "flex",
                  color: "#64748b",
                  transform: `rotate(${evidenceOpen ? 180 : 0}deg)`,
                  transition: "transform 180ms",
                }}
              >
                <ChevronDown size={13} />
              </span>
            </span>
            <span style={{ flex: 1, height: 1, background: "rgba(30,41,59,.9)" }} />
          </button>

          {evidenceOpen && (
            <div
              data-testid="pv2-ov-evidence"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: 16,
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 10,
                background: "#0b1524",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>
                  {OV_EVIDENCE_ROWS.length} verified fixes, timestamped
                </span>
                <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5 }}>
                  What changed, when the re-scan confirmed it, and which finding it closes — written
                  for auditors, cyber insurers, and your own board.
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  borderTop: "1px solid rgba(30,41,59,.9)",
                }}
              >
                {OV_EVIDENCE_ROWS.map((ev) => (
                  <div
                    key={ev.title}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      padding: "10px 0",
                      borderBottom: "1px solid rgba(30,41,59,.9)",
                    }}
                  >
                    <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#f1f5f9" }}>
                      {ev.title}
                    </span>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>
                      {ev.finding} · verified {ev.when} · {ev.by}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, paddingTop: 2 }}>
                <button
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "8px 13px",
                    borderRadius: 6,
                    border: "1px solid var(--brand-blue, #0078D4)",
                    background: "var(--brand-blue, #0078D4)",
                    color: "#fff",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Download as PDF
                </button>
                <button
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "8px 13px",
                    borderRadius: 6,
                    border: "1px solid rgba(30,41,59,.9)",
                    background: "transparent",
                    color: "#cbd5e1",
                    fontSize: "11.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Export as CSV
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Tenant health by pillar — prototype 437-455 ───────────────── */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: "18px 20px",
            border: "1px solid rgba(30,41,59,.9)",
            borderRadius: 14,
            background: "rgba(15,23,42,.4)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <Kicker colour="#64748b">Tenant health by pillar</Kicker>
            <span style={{ fontSize: "11.5px", color: "#475569" }}>
              We only grade you on what we actually assessed · scored {lastScan}
            </span>
          </div>

          {!loaded ? (
            <div className="pv2-pillar-row">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[86px] rounded-[6px]" />
              ))}
            </div>
          ) : (
            <div className="pv2-pillar-row" data-testid="pv2-ov-pillar-strip">
              {view.pillars.map((p) => {
                const delta = pillarDelta(p.trend?.series);
                return (
                  <Link
                    key={p.key}
                    href={`/portal-v2/${p.key}`}
                    data-testid={`pv2-pillar-card-${p.key}`}
                    className="pv2-transition pv2-strip-card"
                    style={{
                      position: "relative",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: 3,
                      textAlign: "left",
                      background: "#071324",
                      border: "1px solid rgba(148,163,184,.14)",
                      borderLeft: `2px solid ${hexAlpha(p.primary, 0.44)}`,
                      borderRadius: 6,
                      padding: "10px 8px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textDecoration: "none",
                      ["--pv2-strip-accent" as string]: p.primary,
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: -30,
                        top: -40,
                        width: 140,
                        height: 140,
                        borderRadius: "50%",
                        background: `radial-gradient(circle, ${hexAlpha(p.primary, 0.15)}, rgba(2,6,23,0) 70%)`,
                        pointerEvents: "none",
                      }}
                    />
                    <div
                      style={{
                        position: "relative",
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        width: "100%",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "26px",
                          fontWeight: 800,
                          color: "#f8fafc",
                          letterSpacing: "-.02em",
                          fontFamily: MONO,
                        }}
                      >
                        {p.score === null ? "—" : p.score}
                      </div>
                      <span
                        style={{
                          fontSize: "11.5px",
                          fontWeight: 700,
                          color: pillarDeltaTone(delta),
                          fontFamily: MONO,
                          paddingTop: 2,
                        }}
                      >
                        {pillarDeltaLabel(delta)}
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
                        lineHeight: 1.3,
                        whiteSpace: "normal",
                      }}
                    >
                      {p.label}
                    </div>
                    <div
                      style={{
                        position: "relative",
                        fontSize: "10px",
                        color: "#64748b",
                        textAlign: "left",
                        width: "100%",
                        lineHeight: 1.3,
                        whiteSpace: "normal",
                      }}
                    >
                      {pillarStripSub(p.findingCounts)}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Everything in motion — prototype 457-546 ──────────────────── */}
        <div
          style={{ position: "relative", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Kicker colour="#64748b">Everything in motion</Kicker>
            <span style={{ fontSize: "11.5px", color: "#475569" }}>
              Every pipeline across the tenant, one line each. Findings are folded into the item that
              carries them — drill into any row for the full picture.
            </span>
          </div>

          <div className="pv2-motion-grid" data-testid="pv2-ov-motion">
            <MotionSection
              id="cc"
              label="Change control pipeline"
              countLabel={sectionCount(crMotionLanes.length, "CRs")}
              linkLabel="Open the register →"
              href="/portal-v2/change-control"
            >
              {crMotionLanes.map((l) => (
                <LaneRow key={l.key} lane={l} href="/portal-v2/change-control" />
              ))}
            </MotionSection>

            <MotionSection
              id="mc"
              label="Microsoft changes incoming"
              countLabel={sectionCount(OV_MC_INCOMING.length, "posts")}
              linkLabel="Open Microsoft Changes →"
              href="/portal-v2/ms-changes"
            >
              {mcLanes().map((l) => (
                <LaneRow key={l.key} lane={l} href="/portal-v2/ms-changes" />
              ))}
            </MotionSection>

            {/* The project schedule spans both columns — prototype's
                `fullWidth` on section index 2 (ovSecDef's last argument). */}
            <MotionSection
              id="pj"
              label="Project & release schedule"
              countLabel={sectionCount(pjRows().length, "phases")}
              linkLabel="Open the full schedule →"
              href="/portal-v2/projects"
              fullWidth
            >
              <ProjectSchedule />
            </MotionSection>

            {/* Hold windows have their own lane shape — a progress track and a
                T-minus readout rather than a date bar, because what matters is
                how much of the wait is done, not when it sits on a calendar. */}
            <MotionSection
              id="rb"
              label="Runbooks waiting on a clock"
              countLabel={sectionCount(holds.length, "hold windows")}
              linkLabel="Open Active Runbooks →"
              href="/portal-v2/runbooks"
            >
              {holds.map((h) => (
                <Link
                  key={h.key}
                  href="/portal-v2/runbooks"
                  data-testid={`pv2-ov-hold-${h.key}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 90px 74px",
                    gap: 10,
                    alignItems: "center",
                    padding: "7px 6px",
                    borderTop: "1px solid rgba(30,41,59,.7)",
                    background: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                    width: "100%",
                    textDecoration: "none",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#e2e8f0",
                        lineHeight: 1.4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h.title}
                    </span>
                    <span
                      style={{
                        fontSize: "10.5px",
                        color: "#64748b",
                        lineHeight: 1.4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h.note}
                    </span>
                  </div>
                  <div
                    style={{
                      position: "relative",
                      height: 6,
                      borderRadius: 3,
                      background: "rgba(148,163,184,.13)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${h.donePct}%`,
                        borderRadius: 3,
                        background: h.tone,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      textAlign: "right",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: h.tone,
                      fontFamily: MONO,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h.tMinus}
                  </span>
                </Link>
              ))}
            </MotionSection>

            <MotionSection
              id="rr"
              label="Accepted risks"
              countLabel={sectionCount(accepted.length, "accepted")}
              linkLabel="Open the risk register →"
              href="/portal-v2/risk-register"
            >
              {accepted.map((l) => (
                <LaneRow key={l.key} lane={l} href="/portal-v2/risk-register" />
              ))}
            </MotionSection>

            <MotionSection
              id="pd"
              label="Policy decisions due for review"
              countLabel={sectionCount(flaggedPolicyCount(), "flagged")}
              linkLabel="Open Policy Decisions →"
              href="/portal-v2/policy-decisions"
            >
              {pdLanes().map((l) => (
                <LaneRow key={l.key} lane={l} href="/portal-v2/policy-decisions" />
              ))}
            </MotionSection>
          </div>
        </div>
      </div>
    </PortalV2Shell>
  );
}
