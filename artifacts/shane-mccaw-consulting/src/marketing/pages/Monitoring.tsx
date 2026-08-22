import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { MarketingLayout } from "../components/MarketingLayout";
import { useCatalog, type MonitoringTier } from "../../hooks/useCatalog";

// Route /monitoring — recreated from Design/design_handoff_marketing/Marketing Monitoring.dc.html.
//
// PRICING VERIFICATION (per-seat rates + billing floor confirmed live against the `services`
// table, service_type = 'monitoring_tier'): the design's own per-seat rates matched the live
// catalog exactly on every one of the 12 rows —
//   Foundation $12/$9/$7/$5, Growth $18/$14/$11/$8, Premier $22.50/$17.50/$13.75/$10 + $160 flat —
// and every row's real `seatCountFloor` (Micro=15, SMB=26, Mid-Market=101, Enterprise=500) matches
// the design's flat 15-seat floor concept (the higher bands' own seatMin already exceeds 15, so
// `max(seats, seatCountFloor)` is numerically identical to `max(seats, 15)` in every band).
//
// ONE real correction: the design computed its displayed "monthly minimum" as a SEPARATE constant
// per bracket. The live catalog also carries a `type_attributes.monthlyFloor` field, but it is
// DEAD DATA — grepped, and it is not read by resolveTypeAttributesMonthlyPriceCents (the real
// checkout price resolver, artifacts/api-server/src/lib/catalog-pricing.ts) or anywhere else in
// the codebase. The real, only-ever-charged minimum for a bracket is
// `pricePerUserMonth * seatCountFloor + flatMonthlySurcharge` — computed live below, never read
// from the stale field — which happens to match the design's numbers for 10 of 12 rows but
// diverges from the unused `monthlyFloor` column on 2 (Growth Micro, Premier Micro). Computing it
// from the real formula guarantees this page can never show a number that contradicts an actual
// Stripe charge.
//
// All prices, rates, seat bands, and tenant-tier labels below are read live from the catalog
// (no-hardcoding rule) — only marketing copy (taglines, feature lists, check counts, engine
// descriptions) is static, matching the design file verbatim.

function ic(children: React.ReactNode, size = 16, color = "currentColor", strokeWidth = 1.8) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const GRADIENT_BG = "linear-gradient(90deg,#3b82f6,#8b5cf6)";
const iconCheck = ic(<polyline points="20 6 9 17 4 12" />, 13, "currentColor");

// ── Pillars (identical colours/paths to Nav.tsx's PILLARS — pillar identity is an icon, never a dot) ──
const PILLAR_COLORS: Record<string, string> = {
  Governance: "#3b82f6",
  Security: "#8b5cf6",
  Compliance: "#e2e8f0",
  Licensing: "#14b8a6",
  Adoption: "#f97316",
  Health: "#22c55e",
};
const PILLAR_PATHS: Record<string, React.ReactNode> = {
  Governance: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  Security: (
    <>
      <rect x={3} y={11} width={18} height={11} rx={2} />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  Compliance: (
    <>
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="M5 7l-2 6h4z" />
      <path d="M19 7l2 6h-4z" />
      <path d="M8 21h8" />
    </>
  ),
  Licensing: (
    <>
      <circle cx={12} cy={12} r={10} />
      <path d="M12 6v12" />
      <path d="M15 9.5a2.5 2.5 0 0 0-2.5-2h-1a2.5 2.5 0 0 0 0 5h1a2.5 2.5 0 0 1 0 5h-1a2.5 2.5 0 0 1-2.5-2" />
    </>
  ),
  Adoption: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx={9.5} cy={7} r={4} />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  Health: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
};

const PILLAR_WALL = [
  {
    name: "Governance",
    engine: "Drift Engine",
    href: "/pillars/governance",
    body: "RACI seats, change requests without approvals, unowned services, freeze-window violations.",
  },
  {
    name: "Security",
    engine: "Security Engine",
    href: "/pillars/security",
    body: "Anonymous links, stale guests, over-privileged OAuth apps, MFA gaps on privileged accounts, exposure by workload.",
  },
  {
    name: "Compliance",
    engine: "Monitoring Engine",
    href: "/pillars/compliance",
    body: "Audit log retention, litigation hold, DLP state — stored as time-stamped evidence per control.",
  },
  {
    name: "Licensing",
    engine: "Health Engine",
    href: "/pillars/licensing",
    body: "Idle seats, duplicate SKUs, leavers still licensed, spend against what usage justifies.",
  },
  {
    name: "Adoption",
    engine: "Health Engine",
    href: "/pillars/adoption",
    body: "Usage per workload and per team — the spike, the collapse, and whether renewal is defensible.",
  },
  {
    name: "Health",
    engine: "Drift Engine",
    href: "/pillars/health",
    body: "Microsoft’s Message Center and roadmap changes, scored against your configuration: hits you, or doesn’t.",
  },
];

// ── Five-step finding workflow ──
const FLOW = [
  { n: "1", title: "A check fails", body: "One of 30–133 checks, on its hourly–daily cycle.", hot: true },
  { n: "2", title: "Alert with evidence", body: "What failed, where, since when — the raw items attached." },
  { n: "3", title: "Runbook offered", body: "One click on Growth+, with the SOP behind it written down." },
  { n: "4", title: "Tracked to closed", body: "Remediation Tracker follows it from raised to verified." },
  { n: "5", title: "Too big? SOW", body: "Scoped, fixed-price, proposed against the finding.", noArrow: true },
];

const AUTO_FIXED = [
  "Access hygiene — stale guest accounts and over-permissioned OAuth grants (Security Engine)",
  "Configuration drift — settings corrected back to baseline (Drift Engine)",
  "Qualifying Health Engine anomalies with a defined, low-risk runbook",
];
const ROUTED_HUMAN = [
  "SLA and delivery risk — surfaced by the SLA Engine, resolved by an engineer",
  "Scope Creep findings — reviewed as a billing/contract decision",
  "MFA registration gaps — flagged immediately, enrollment happens on the user’s end",
];

// ── Six engines ──
const ENGINES = [
  {
    badge: "Configuration Baseline",
    name: "Drift Engine",
    color: "#60a5fa",
    desc: "Compares your live configuration against your approved baseline every scheduled check, flagging admin changes the next cycle.",
    icon: (
      <>
        <path d="M12 3l9 5-9 5-9-5 9-5z" />
        <path d="M3 13l9 5 9-5" />
      </>
    ),
  },
  {
    badge: "Threat Minimization",
    name: "Security Engine",
    color: "#f87171",
    desc: "Hunts anonymous links, stale guest accounts, over-privileged OAuth apps, and missing MFA on privileged identities.",
    icon: (
      <>
        <rect x={5} y={11} width={14} height={9} rx={2} />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </>
    ),
  },
  {
    badge: "SLA Remediation",
    name: "Health Engine",
    color: "#34d399",
    desc: "Calculates a composite tenant health score on every check, across licensing, service health, and operational KPIs.",
    icon: <polyline points="3 12 8 12 11 19 14 5 17 12 21 12" />,
  },
  {
    badge: "Delivery Performance",
    name: "SLA Engine",
    color: "#818cf8",
    desc: "Tracks response timelines, milestone execution, and uptime guarantees, surfacing an impending breach before it becomes contractual.",
    icon: (
      <>
        <circle cx={12} cy={12} r={8} />
        <line x1={12} y1={8} x2={12} y2={12} />
        <line x1={12} y1={12} x2={15} y2={14} />
      </>
    ),
  },
  {
    badge: "Check Execution",
    name: "Monitoring Engine",
    color: "#a78bfa",
    desc: "Executes the platform's Monitor Checks against your tenant via Graph on schedule. Every other engine's score starts here.",
    icon: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
        <circle cx={12} cy={12} r={3} />
      </>
    ),
  },
  {
    badge: "SOW Auditing",
    name: "Scope Creep Engine",
    color: "#fbbf24",
    desc: "Monitors ongoing engineer workstreams against the legal SOW, flagging out-of-scope work before it becomes a billing dispute.",
    icon: (
      <>
        <path d="M12 4l9 15H3z" />
        <line x1={12} y1={10} x2={12} y2={15} />
      </>
    ),
  },
];

// ── Per-tier marketing copy, keyed by the live catalog's own `tier` slug — every number
// (checks count / tagline) is static copy since the catalog carries no such field; only price
// data below is read live. ──
const TIER_COPY: Record<
  string,
  {
    checksLabel: string;
    tagline: string;
    scanDepth: string;
    inheritsLabel?: string;
    tools: { name: string; desc: string }[];
    accent: string;
    hot: boolean;
  }
> = {
  foundation: {
    checksLabel: "30 checks",
    tagline: "The get-in-the-door scan, across all six pillars.",
    scanDepth:
      "The opinionated, cross-pillar scan: highest-severity, most-explainable, most-universal findings across Governance, Security, Compliance, Licensing, Adoption and Health. Fast, safe, unattended.",
    tools: [
      { name: "Risk Register", desc: "a permanent record of every risk you have knowingly accepted rather than fixed" },
      { name: "Policy Decisions", desc: "each documented decision, its rationale, and its review date" },
    ],
    accent: "#60a5fa",
    hot: false,
  },
  growth: {
    checksLabel: "129 checks",
    tagline: "The full daily operational surface.",
    scanDepth:
      "Everything Foundation catches plus complete device posture, mail hygiene, governance sprawl detail, adoption trends, and full identity and conditional-access detail.",
    inheritsLabel: "Everything in Foundation, plus:",
    tools: [
      { name: "Runbooks", desc: "real one-click fixes against your tenant" },
      { name: "Remediation Tracking", desc: "every finding followed from raised to closed" },
      { name: "SOPs & Runbooks library", desc: "the written procedure behind each fix" },
      { name: "Microsoft Change Monitoring", desc: "Microsoft's own roadmap and Message Center changes, filtered to your tenant" },
    ],
    accent: "#2dd4bf",
    hot: true,
  },
  premier: {
    checksLabel: "133 + evidence",
    tagline: "Compliance-grade, with the evidence attached.",
    scanDepth:
      "Everything Growth catches plus compliance-grade checks — audit log retention, litigation hold, DLP, insider risk — and the raw per-item evidence behind every finding. Built for regulated and audit-driven tenants.",
    inheritsLabel: "Everything in Growth, plus:",
    tools: [
      { name: "Change Control", desc: "formal Dev → Test → Prod approval workflow" },
      { name: "RACI / Ownership", desc: "who is responsible, accountable, consulted and informed per service" },
      { name: "Security Plan", desc: "the living document behind your controls" },
      { name: "PII Governance", desc: "where personal data lives and who can reach it" },
    ],
    accent: "#a78bfa",
    hot: false,
  },
};
const TIER_ORDER = ["foundation", "growth", "premier"];

interface MonitoringTypeAttributes {
  seatMin?: number;
  seatMax?: number | null;
  seatCountFloor?: number;
  pricePerUserMonth?: string;
  flatMonthlySurcharge?: string | null;
  tenantTierLabel?: string;
}

function ta(row: MonitoringTier): MonitoringTypeAttributes {
  return (row.typeAttributes ?? {}) as MonitoringTypeAttributes;
}

function ppuOf(row: MonitoringTier): number {
  const n = parseFloat(ta(row).pricePerUserMonth ?? "");
  return isNaN(n) ? 0 : n;
}
function floorOf(row: MonitoringTier): number {
  const n = Number(ta(row).seatCountFloor ?? row.seatMin ?? 1);
  return isNaN(n) || n < 1 ? 1 : Math.trunc(n);
}
function surchargeOf(row: MonitoringTier): number {
  const n = parseFloat(ta(row).flatMonthlySurcharge ?? "");
  return isNaN(n) ? 0 : n;
}

// Real, live formula — byte-identical to resolveTypeAttributesMonthlyPriceCents
// (artifacts/api-server/src/lib/catalog-pricing.ts), the only function that ever computes an
// actual Stripe charge for a monitoring tier. Never reads the unused `monthlyFloor` attribute.
function computeMonthlyPrice(row: MonitoringTier, seats: number): number {
  const billableSeats = Math.max(1, Math.trunc(seats) || 1, floorOf(row));
  return ppuOf(row) * billableSeats + surchargeOf(row);
}

function money(n: number): string {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

interface Bracket {
  key: string;
  name: string;
  range: string;
  min: number;
  max: number;
  floor: number;
}

function packageDisplayName(row: MonitoringTier): string {
  return row.name.split("—")[0].replace(/Monitoring/i, "").trim();
}

export default function Monitoring() {
  const { monitoringTiers, loading, error } = useCatalog();
  const [seats, setSeats] = useState<number>(12);

  const dec = () => setSeats((s) => Math.max(1, s - 1));
  const inc = () => setSeats((s) => s + 1);
  const onSeatsInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10);
    setSeats(Math.max(1, isNaN(v) ? 1 : v));
  };

  const tierGroups = useMemo(() => {
    const groups = new Map<string, MonitoringTier[]>();
    monitoringTiers.forEach((row) => {
      const key = row.tier ?? "";
      if (!TIER_COPY[key]) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    });
    groups.forEach((rows) => rows.sort((a, b) => (a.seatMin ?? 0) - (b.seatMin ?? 0)));
    return groups;
  }, [monitoringTiers]);

  // Bracket definitions read live from whichever tier group has rows — every tier shares the same
  // four seat bands in the real catalog, so the first populated group is authoritative.
  const brackets: Bracket[] = useMemo(() => {
    const source = TIER_ORDER.map((k) => tierGroups.get(k)).find((rows) => rows && rows.length > 0);
    if (!source) return [];
    return source.map((row) => {
      const attrs = ta(row);
      const min = attrs.seatMin ?? 1;
      const max = attrs.seatMax ?? Infinity;
      return {
        key: row.slug ?? String(row.id),
        name: attrs.tenantTierLabel ?? "Band",
        range: max === Infinity ? `${min}+ seats` : `${min}–${max} seats`,
        min,
        max,
        floor: floorOf(row),
      };
    });
  }, [tierGroups]);

  const bracket = useMemo(() => {
    return brackets.find((b) => seats >= b.min && seats <= b.max) ?? brackets[brackets.length - 1];
  }, [brackets, seats]);

  const matchRow = (rows: MonitoringTier[] | undefined, s: number): MonitoringTier | null => {
    if (!rows) return null;
    return (
      rows.find((r) => {
        const attrs = ta(r);
        const min = attrs.seatMin ?? 1;
        const max = attrs.seatMax ?? Infinity;
        return s >= min && s <= max;
      }) ?? null
    );
  };

  const rowForBracket = (rows: MonitoringTier[] | undefined, b: Bracket): MonitoringTier | null => {
    if (!rows) return null;
    return rows.find((r) => (ta(r).seatMin ?? 1) === b.min) ?? null;
  };

  // The real minimum a customer could ever be billed across every tier/bracket combination —
  // computed from the live formula, used for the hero stat "from $X/mo".
  const cheapestFloorPrice = useMemo(() => {
    let min: number | null = null;
    monitoringTiers.forEach((row) => {
      if (!TIER_COPY[row.tier ?? ""]) return;
      const p = ppuOf(row) * floorOf(row) + surchargeOf(row);
      if (min === null || p < min) min = p;
    });
    return min;
  }, [monitoringTiers]);

  const atSeatFloor = bracket ? seats < bracket.floor : false;

  return (
    <MarketingLayout current="monitoring">
      {/* HERO */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "48px 32px 30px",
          background:
            "radial-gradient(circle 1100px at 78% -20%, rgba(0,180,216,.13), rgba(2,6,23,0) 62%), radial-gradient(circle 820px at 8% 12%, rgba(0,120,212,.07), rgba(2,6,23,0) 66%)",
        }}
      >
        <span
          style={{
            position: "absolute",
            right: "-60px",
            top: "50%",
            transform: "translateY(-50%)",
            opacity: 0.13,
            pointerEvents: "none",
            lineHeight: 0,
            filter: "drop-shadow(0 0 22px rgba(0,180,216,.35))",
          }}
        >
          <svg width={880} height={300} viewBox="0 0 120 40" fill="none" stroke="#00B4D8" strokeWidth={0.9} strokeLinecap="round" strokeLinejoin="round">
            <path d="M0 20h18l5-11 6 22 5-11h20l5-14 7 28 5-14h18l5-9 5 18 4-9h12" />
          </svg>
        </span>
        <div style={{ maxWidth: "1120px", margin: "0 auto", display: "flex", gap: "44px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1.1 1 380px", minWidth: 0 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "6px 12px",
                borderRadius: "999px",
                background: "rgba(59,130,246,.1)",
                border: "1px solid rgba(59,130,246,.25)",
                color: "#60a5fa",
                fontSize: "10.5px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".1em",
                marginBottom: "18px",
              }}
            >
              {ic(<polyline points="3 12 8 12 11 19 14 5 17 12 21 12" />, 14)} Tenant Monitoring
            </span>
            <h1 style={{ fontSize: "clamp(30px,3.4vw,40px)", fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.12, color: "#f8fafc", margin: "0 0 16px" }}>
              Your tenant, watched every hour of every day.
            </h1>
            <p style={{ fontSize: "15px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 12px", maxWidth: "54ch" }}>
              Monitoring is the service underneath everything else on this site. The six pillars are what it watches. The six engines are how. The Portal is where it lands — as alerts with evidence, one-click runbooks, and a paper trail your auditor can read.
            </p>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.7, margin: "0 0 24px", maxWidth: "54ch" }}>
              An assessment tells you what’s wrong today. Monitoring tells you the second it happens again.
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "22px" }}>
              <a
                href="#pricing"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "12px 22px",
                  borderRadius: "10px",
                  fontWeight: 700,
                  fontSize: "13.5px",
                  color: "#fff",
                  background: GRADIENT_BG,
                  whiteSpace: "nowrap",
                }}
              >
                See Pricing by Seat Count
                {ic(
                  <>
                    <line x1={12} y1={4} x2={12} y2={20} />
                    <polyline points="6 14 12 20 18 14" />
                  </>,
                  15,
                )}
              </a>
              <Link
                href="/scan"
                style={{
                  padding: "12px 22px",
                  borderRadius: "10px",
                  fontWeight: 600,
                  fontSize: "13.5px",
                  color: "#cbd5e1",
                  border: "1px solid rgba(148,163,184,.2)",
                  whiteSpace: "nowrap",
                }}
              >
                Scan My Tenant · Free
              </Link>
            </div>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
              {[
                { v: "6", l: "signal engines" },
                { v: "30–133", l: "checks by tier" },
                { v: "hourly–daily", l: "check cadence" },
                { v: cheapestFloorPrice != null ? `from ${money(cheapestFloorPrice)}/mo` : "…", l: "priced per seat" },
              ].map((hs) => (
                <span key={hs.l} style={{ display: "flex", alignItems: "baseline", gap: "6px", fontSize: "11.5px", color: "#64748b" }}>
                  <b style={{ fontSize: "15px", fontWeight: 800, color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>{hs.v}</b>
                  {hs.l}
                </span>
              ))}
            </div>
          </div>

          <div
            style={{
              flex: "1 1 380px",
              maxWidth: "500px",
              border: "1px solid rgba(0,180,216,.22)",
              borderRadius: "18px",
              background: "linear-gradient(160deg,rgba(0,180,216,.10),rgba(11,21,36,.52) 55%,rgba(11,21,36,.34))",
              backdropFilter: "blur(3px)",
              boxShadow: "0 0 60px rgba(0,180,216,.13), inset 0 1px 0 rgba(148,163,184,.08)",
              padding: "20px 20px 14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "999px", background: "#34d399" }} />
                This hour, in a monitored tenant
              </span>
              <span style={{ fontSize: "9.5px", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#475569" }}>Illustrative · Growth tier</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              {[
                { time: "09:14", pillar: "Security", text: "Anonymous sharing link created on /sites/finance-q3", action: "Runbook queued — close link, notify owner", tone: "red" },
                { time: "09:14", pillar: "Governance", text: "External sharing default changed outside change control", action: "Drift flagged against approved baseline", tone: "red" },
                { time: "08:50", pillar: "Licensing", text: "6 E5 seats idle for 90+ days", action: "Reclaim suggested — recovery logged if applied", tone: "amber" },
                { time: "08:22", pillar: "Health", text: "MC912083 scored against your config", action: "Hits you — owner assigned, freeze checked", tone: "amber" },
                { time: "07:58", pillar: "Compliance", text: "Audit log retention check", action: "Passed — evidence stored", tone: "ok" },
                { time: "07:31", pillar: "Adoption", text: "Teams usage down 12% in Sales", action: "Trend watched — no action yet", tone: "ok" },
              ].map((fe, i) => {
                const color = PILLAR_COLORS[fe.pillar] ?? "#94a3b8";
                const actionFg = fe.tone === "red" ? "#f87171" : fe.tone === "amber" ? "#fbbf24" : "#34d399";
                return (
                  <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "9px 11px", borderRadius: "10px", border: "1px solid rgba(30,41,59,.85)", background: "rgba(2,6,23,.4)" }}>
                    <span
                      style={{
                        flex: "none",
                        width: "20px",
                        height: "20px",
                        borderRadius: "6px",
                        marginTop: "1px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: `${color}1A`,
                        border: `1px solid ${color}33`,
                        color,
                      }}
                    >
                      {ic(PILLAR_PATHS[fe.pillar], 12, color)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color }}>{fe.pillar}</span>
                        <span style={{ fontSize: "9.5px", color: "#475569", fontVariantNumeric: "tabular-nums" }}>{fe.time}</span>
                      </div>
                      <div style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.5, marginTop: "1px" }}>{fe.text}</div>
                      <div style={{ fontSize: "10px", color: actionFg, fontWeight: 700, marginTop: "2px" }}>{fe.action}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginTop: "10px", paddingTop: "10px", borderTop: "1px solid rgba(30,41,59,.9)" }}>
              <span style={{ fontSize: "10.5px", color: "#64748b" }}>129 checks · next cycle in 41 min</span>
              <span style={{ fontSize: "10.5px", color: "#64748b" }}>4 findings open · 2 runbooks queued</span>
            </div>
          </div>
        </div>
      </section>

      {/* WHAT IT WATCHES */}
      <section style={{ padding: "38px 32px 44px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#60a5fa" }}>What it watches</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>Six pillars. One service watching all of them.</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Every pillar page on this site — the empty RACI seats, the drift curves, the idle licences, the Microsoft changes — is a view over this one service. Monitoring is what keeps those charts current after the scan is a memory.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))", gap: "12px" }}>
            {PILLAR_WALL.map((pw) => {
              const color = PILLAR_COLORS[pw.name];
              return (
                <Link
                  key={pw.name}
                  href={pw.href}
                  style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px", display: "flex", flexDirection: "column" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "8px" }}>
                    <span style={{ flex: "none", width: "22px", height: "22px", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", background: `${color}1A`, border: `1px solid ${color}33` }}>
                      {ic(PILLAR_PATHS[pw.name], 13, color)}
                    </span>
                    <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#f8fafc" }}>{pw.name}</span>
                    <span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 700, color }}>{pw.engine}</span>
                  </div>
                  <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6, flexGrow: 1 }}>{pw.body}</span>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#60a5fa", marginTop: "9px" }}>Read the {pw.name} pillar →</span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* WHEN A CHECK FAILS */}
      <section
        style={{
          padding: "40px 32px 46px",
          background: "linear-gradient(180deg, rgba(5,13,30,0) 0%, #050d1e 16%, #050d1e 84%, rgba(5,13,30,0) 100%), radial-gradient(circle 900px at 20% 0%, rgba(0,180,216,.05), rgba(2,6,23,0) 60%)",
        }}
      >
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "24px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#34d399" }}>When a check fails</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>A finding is not an email. It’s the start of a workflow.</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Alerts arrive with the evidence attached. What happens next depends on what failed — and none of it depends on you noticing.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", alignItems: "stretch", gap: "8px", marginBottom: "20px" }}>
            {FLOW.map((fl) => (
              <div key={fl.n} style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                <div
                  style={{
                    flex: "1 1 auto",
                    minWidth: 0,
                    height: "100%",
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    padding: "14px",
                    borderRadius: "14px",
                    background: "#0b1524",
                    border: `1px solid ${fl.hot ? "rgba(59,130,246,.45)" : "rgba(30,41,59,.9)"}`,
                  }}
                >
                  <span
                    style={{
                      width: "22px",
                      height: "22px",
                      borderRadius: "7px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "11px",
                      fontWeight: 800,
                      background: fl.hot ? "rgba(59,130,246,.15)" : "rgba(255,255,255,.05)",
                      border: fl.hot ? "1px solid rgba(59,130,246,.4)" : "1px solid rgba(255,255,255,.1)",
                      color: fl.hot ? "#60a5fa" : "#94a3b8",
                    }}
                  >
                    {fl.n}
                  </span>
                  <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>{fl.title}</span>
                  <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>{fl.body}</span>
                </div>
                {!fl.noArrow && ic(<><line x1={4} y1={12} x2={20} y2={12} /><polyline points="14 6 20 12 14 18" /></>, 16, "#475569", 2)}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", minWidth: 0, border: "1px solid rgba(52,211,153,.25)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#34d399" }}>Fixed by runbook, one click</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginTop: "10px" }}>
                {AUTO_FIXED.map((af) => (
                  <span key={af} style={{ display: "flex", gap: "8px", fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55 }}>
                    <span style={{ color: "#34d399", flex: "none" }}>{iconCheck}</span>
                    <span>{af}</span>
                  </span>
                ))}
              </div>
            </div>
            <div style={{ flex: "1 1 320px", minWidth: 0, border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#94a3b8" }}>Routed to a human, with context</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginTop: "10px" }}>
                {ROUTED_HUMAN.map((rh) => (
                  <span key={rh} style={{ display: "flex", gap: "8px", fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55 }}>
                    <span style={{ color: "#64748b", flex: "none" }}>
                      {ic(<><circle cx={9} cy={7} r={4} /><path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6" /></>, 13, "currentColor")}
                    </span>
                    <span>{rh}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginTop: "18px", border: "1px solid rgba(59,130,246,.3)", borderRadius: "14px", background: "rgba(59,130,246,.06)", padding: "15px 20px", display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: "260px", fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.65 }}>
              Anything a runbook can’t safely close — a permission rebuild, a migration, an architecture change — becomes a{" "}
              <b style={{ color: "#f8fafc" }}>scoped, fixed-price statement of work</b> proposed against the specific finding. Never a cart, never an hourly surprise.
            </span>
            <Link href="/solutions" style={{ flex: "none", fontSize: "12px", fontWeight: 700, color: "#60a5fa" }}>
              See the 33 named projects →
            </Link>
          </div>
        </div>
      </section>

      {/* FEATURE SET BY TIER */}
      <section style={{ padding: "44px 32px 40px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#a78bfa" }}>The feature set</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>The Portal grows with the tier.</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Every tier gets the alerts, the score and the evidence trail. What changes is how much of the operating system comes with it — from a risk register at Foundation to full change control, RACI and PII governance at Premier.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "12px" }}>
            {TIER_ORDER.map((key) => {
              const copy = TIER_COPY[key];
              const rows = tierGroups.get(key);
              const name = rows?.[0] ? packageDisplayName(rows[0]) : key.charAt(0).toUpperCase() + key.slice(1);
              return (
                <div
                  key={key}
                  style={{ display: "flex", flexDirection: "column", padding: "20px", background: "#0b1524", borderRadius: "16px", border: `1px solid ${copy.hot ? "rgba(59,130,246,.5)" : "rgba(30,41,59,.9)"}` }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", marginBottom: "2px" }}>
                    <span style={{ fontSize: "15px", fontWeight: 800, color: "#f8fafc" }}>{name}</span>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: copy.accent, fontVariantNumeric: "tabular-nums" }}>{copy.checksLabel}</span>
                  </div>
                  <span style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.55, marginBottom: "12px" }}>{copy.tagline}</span>
                  {copy.inheritsLabel && (
                    <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#475569", marginBottom: "8px" }}>{copy.inheritsLabel}</span>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {copy.tools.map((tl) => (
                      <span key={tl.name} style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55 }}>
                        <b style={{ color: "#e2e8f0" }}>{tl.name}</b> — {tl.desc}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section
        id="pricing"
        style={{
          padding: "40px 32px 46px",
          background: "linear-gradient(180deg, rgba(5,13,30,0) 0%, #050d1e 16%, #050d1e 84%, rgba(5,13,30,0) 100%), radial-gradient(circle 900px at 20% 0%, rgba(0,180,216,.05), rgba(2,6,23,0) 60%)",
        }}
      >
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#60a5fa" }}>Pricing</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>Priced per seat. Published in full. No call required.</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Move the seat count to your headcount — the three tiers reprice live. When you buy, the connected tenant’s real seat count replaces your estimate before anything is charged.
            </p>
          </div>

          {loading && <p style={{ color: "#64748b", fontSize: "13px", textAlign: "center", padding: "40px 0" }}>Loading pricing…</p>}
          {error && !loading && (
            <p style={{ color: "#f87171", fontSize: "13px", textAlign: "center", padding: "40px 0" }}>Could not load monitoring pricing. Please refresh and try again.</p>
          )}

          {!loading && !error && brackets.length > 0 && bracket && (
            <>
              <div style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "16px", background: "#0b1524", padding: "18px 20px", marginBottom: "18px", display: "flex", alignItems: "center", gap: "18px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <button
                    onClick={dec}
                    style={{ width: "34px", height: "34px", borderRadius: "9px", border: "1px solid rgba(148,163,184,.2)", background: "rgba(255,255,255,.04)", color: "#e2e8f0", fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    {ic(<line x1={5} y1={12} x2={19} y2={12} />, 15)}
                  </button>
                  <input
                    value={seats}
                    onChange={onSeatsInput}
                    inputMode="numeric"
                    style={{ width: "86px", textAlign: "center", background: "rgba(2,6,23,.7)", border: "1px solid rgba(51,65,85,.9)", borderRadius: "9px", padding: "8px 6px", fontSize: "16px", fontWeight: 800, color: "#f1f5f9", outline: "none", fontFamily: "inherit", fontVariantNumeric: "tabular-nums" }}
                  />
                  <button
                    onClick={inc}
                    style={{ width: "34px", height: "34px", borderRadius: "9px", border: "1px solid rgba(148,163,184,.2)", background: "rgba(255,255,255,.04)", color: "#e2e8f0", fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    {ic(<><line x1={12} y1={5} x2={12} y2={19} /><line x1={5} y1={12} x2={19} y2={12} /></>, 15)}
                  </button>
                  <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                    seats · <b style={{ color: "#e2e8f0" }}>{bracket.name}</b> bracket
                  </span>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {brackets.map((bk) => {
                    const on = bk.key === bracket.key;
                    return (
                      <button
                        key={bk.key}
                        onClick={() => setSeats(bk.min)}
                        style={{
                          padding: "9px 15px",
                          borderRadius: "11px",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          textAlign: "left",
                          border: `1px solid ${on ? "#3b82f6" : "rgba(30,41,59,.9)"}`,
                          background: on ? "rgba(59,130,246,.12)" : "#0f172a",
                          color: on ? "#f8fafc" : "#94a3b8",
                        }}
                      >
                        <span style={{ display: "block", fontSize: "11.5px", fontWeight: 700 }}>{bk.name}</span>
                        <span style={{ display: "block", fontSize: "10px", opacity: 0.75 }}>{bk.range}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "14px", marginBottom: "16px" }}>
                {TIER_ORDER.map((key) => {
                  const copy = TIER_COPY[key];
                  const rows = tierGroups.get(key);
                  const row = matchRow(rows, seats);
                  if (!row) return null;
                  const price = computeMonthlyPrice(row, seats);
                  const ppu = ppuOf(row);
                  const surcharge = surchargeOf(row);
                  const name = packageDisplayName(row);
                  const priceExceedsRaw = seats < floorOf(row);
                  return (
                    <div
                      key={key}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        padding: "20px",
                        background: "#0b1524",
                        borderRadius: "16px",
                        position: "relative",
                        border: copy.hot ? "1px solid rgba(59,130,246,.5)" : "1px solid rgba(30,41,59,.9)",
                        boxShadow: copy.hot ? "0 0 0 1px rgba(59,130,246,.18)" : undefined,
                      }}
                    >
                      {copy.hot && (
                        <span style={{ position: "absolute", top: "-10px", left: "20px", padding: "3px 10px", borderRadius: "999px", fontSize: "9.5px", fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "#fff", background: GRADIENT_BG }}>
                          Most tenants land here
                        </span>
                      )}
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
                        <span style={{ fontSize: "15px", fontWeight: 800, color: "#f8fafc" }}>{name}</span>
                        <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#64748b" }}>{copy.checksLabel}</span>
                      </div>
                      <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.5, marginTop: "2px" }}>{copy.tagline}</span>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "7px", marginTop: "12px" }}>
                        <b style={{ fontSize: "27px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.02em", fontVariantNumeric: "tabular-nums" }}>{money(Math.round(price * 100) / 100)}</b>
                        <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                          /mo · {money(ppu)}/seat{surcharge ? ` + ${money(surcharge)} flat` : ""}
                        </span>
                      </div>
                      <span style={{ fontSize: "10.5px", marginTop: "3px", lineHeight: 1.5, color: priceExceedsRaw ? "#fbbf24" : "#475569" }}>
                        {priceExceedsRaw ? `Billed on the ${floorOf(row)}-seat floor, not ${seats} seats` : `Billed on ${seats.toLocaleString()} seats`}
                      </span>
                      <Link
                        href={`/buy?product=monitoring&tier=${key}&seats=${seats}`}
                        style={{
                          display: "block",
                          textAlign: "center",
                          marginTop: "16px",
                          padding: "11px",
                          borderRadius: "10px",
                          fontSize: "13px",
                          fontWeight: 700,
                          color: copy.hot ? "#fff" : "#e2e8f0",
                          background: copy.hot ? GRADIENT_BG : "rgba(255,255,255,.06)",
                          border: copy.hot ? undefined : "1px solid rgba(255,255,255,.08)",
                        }}
                      >
                        Start monitoring
                      </Link>
                    </div>
                  );
                })}
              </div>

              <div style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", overflowX: "auto", marginBottom: "10px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "640px" }}>
                  <thead>
                    <tr>
                      {["Bracket", "Foundation", "Growth", "Premier"].map((h) => (
                        <th key={h} style={{ padding: "11px 13px", fontSize: "10.5px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".07em", background: "rgba(255,255,255,.02)", textAlign: "left" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {brackets.map((bk) => {
                      const on = bk.key === bracket.key;
                      const cellCss: React.CSSProperties = { padding: "13px", borderTop: "1px solid rgba(30,41,59,.9)", fontSize: "12.5px", color: "#cbd5e1", background: on ? "rgba(59,130,246,.07)" : "transparent" };
                      return (
                        <tr key={bk.key}>
                          <td style={{ padding: "13px", borderTop: "1px solid rgba(30,41,59,.9)", background: on ? "rgba(59,130,246,.07)" : "transparent" }}>
                            <b style={{ fontSize: "12.5px", color: "#f8fafc" }}>{bk.name}</b>
                            <span style={{ display: "block", fontSize: "10.5px", color: "#64748b" }}>{bk.range}</span>
                          </td>
                          {TIER_ORDER.map((key) => {
                            const rows = tierGroups.get(key);
                            const row = rowForBracket(rows, bk);
                            if (!row) return <td key={key} style={cellCss} />;
                            const ppu = ppuOf(row);
                            const surcharge = surchargeOf(row);
                            const realFloor = ppu * bk.floor + surcharge;
                            return (
                              <td key={key} style={cellCss}>
                                {money(ppu)}/seat{surcharge ? ` + ${money(surcharge)}` : ""}
                                <span style={{ display: "block", fontSize: "10.5px", color: "#64748b" }}>min {money(realFloor)}</span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <span style={{ display: "block", fontSize: "11px", color: "#64748b", lineHeight: 1.6 }}>
                {atSeatFloor
                  ? `Under ${bracket.floor} seats every bracket bills at the ${bracket.floor}-seat floor, so ${seats} seats and ${bracket.floor} seats cost the same.`
                  : `Priced on seats × max(your seats, ${bracket.floor}), plus any flat add-on.`}
              </span>
            </>
          )}
        </div>
      </section>

      {/* SIX ENGINES */}
      <section style={{ padding: "44px 32px 40px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "20px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#818cf8" }}>The instrumentation</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>Six engines under the hood.</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))", gap: "12px" }}>
            {ENGINES.map((en) => (
              <div key={en.name} style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "7px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ width: "30px", height: "30px", borderRadius: "9px", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", color: en.color }}>
                    {ic(en.icon, 16, en.color)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: "9px", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#475569" }}>{en.badge}</span>
                    <span style={{ display: "block", fontSize: "13px", fontWeight: 700, color: "#f8fafc" }}>{en.name}</span>
                  </div>
                </div>
                <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6 }}>{en.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ADD A PERSON TO THE PLATFORM */}
      <section style={{ padding: "0 32px 40px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto", border: "1px solid rgba(139,92,246,.3)", borderRadius: "18px", background: "#0b1524", padding: "26px 28px", display: "flex", gap: "28px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1.4 1 340px", minWidth: 0 }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#a78bfa" }}>Add a person to the platform</span>
            <h2 style={{ fontSize: "21px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 8px" }}>Monitoring finds it. A named architect decides what it means.</h2>
            <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Pair monitoring with an architect retainer and the monthly review reads your real posture — which findings become projects, which risks get accepted, what next quarter should cost.
            </p>
          </div>
          <div style={{ flex: "none", display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Link href="/retainers" style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "11px 20px", borderRadius: "10px", fontSize: "12.5px", fontWeight: 700, color: "#cbd5e1", border: "1px solid rgba(148,163,184,.2)", whiteSpace: "nowrap" }}>
              See Retainer Tiers
            </Link>
            <Link href="/login" style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "11px 20px", borderRadius: "10px", fontSize: "12.5px", fontWeight: 700, color: "#cbd5e1", border: "1px solid rgba(148,163,184,.2)", whiteSpace: "nowrap" }}>
              Tour the Portal
            </Link>
          </div>
        </div>
      </section>

      {/* WHAT WE WATCH PILL ROW */}
      <section style={{ padding: "0 32px 40px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "14px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#475569", marginRight: "4px" }}>What we watch</span>
            {Object.keys(PILLAR_PATHS).map((name) => {
              const color = PILLAR_COLORS[name];
              const href = PILLAR_WALL.find((p) => p.name === name)?.href ?? "/pillars";
              return (
                <Link key={name} href={href} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 11px", borderRadius: "999px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8", border: "1px solid rgba(30,41,59,.9)" }}>
                  {ic(PILLAR_PATHS[name], 13, color)}
                  {name}
                </Link>
              );
            })}
          </div>
          <span style={{ fontSize: "11px", color: "#64748b" }}>
            Go deeper: <Link href="/solutions/copilot" style={{ color: "#60a5fa", fontWeight: 600 }}>Copilot &amp; AI</Link> ·{" "}
            <Link href="/solutions/sharepoint" style={{ color: "#60a5fa", fontWeight: 600 }}>SharePoint</Link> ·{" "}
            <Link href="/solutions" style={{ color: "#60a5fa", fontWeight: 600 }}>All 33 projects</Link>
          </span>
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section style={{ padding: "32px 32px 56px", background: "linear-gradient(180deg, rgba(0,180,216,.05), rgba(2,6,23,0) 55%)" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto 26px", textAlign: "center" }}>
          <h2 style={{ fontSize: "19px", fontWeight: 700, color: "#f8fafc", margin: "0 0 10px", letterSpacing: "-.02em" }}>Not sure which tier fits?</h2>
          <p style={{ color: "#94a3b8", lineHeight: 1.7, margin: 0, fontSize: "13px" }}>
            Run the free scan first. It reads your real tenant, shows you the findings, and points at the tier that would have caught them — then this page’s prices already know your seat count.
          </p>
        </div>
        <div style={{ textAlign: "center" }}>
          <Link
            href="/scan"
            style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "13px 26px", borderRadius: "11px", fontWeight: 700, fontSize: "14px", color: "#fff", background: GRADIENT_BG, whiteSpace: "nowrap" }}
          >
            Scan My Tenant · Free
            {ic(<><line x1={4} y1={12} x2={20} y2={12} /><polyline points="14 6 20 12 14 18" /></>, 15)}
          </Link>
          <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "10px" }}>Read-only. No agent, no charge, and the findings are yours either way.</div>
        </div>
      </section>
    </MarketingLayout>
  );
}
