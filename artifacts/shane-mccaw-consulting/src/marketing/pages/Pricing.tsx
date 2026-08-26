import React from "react";
import { Link } from "wouter";
import { MarketingLayout } from "../components/MarketingLayout";
import { useCatalog, type MonitoringTier } from "../../hooks/useCatalog";
import { useSignalCheckCount } from "../../hooks/useSignalCheckCount";
import {
  useServices,
  resolvePublicServicePriceCents,
  type PublicService,
} from "../../hooks/useServices";
import { PACKS } from "../data/quickStartPacks";

// Route /pricing — recreated from Design/design_handoff_marketing/Marketing Pricing.dc.html.
// Part 9: real content replaces the Part 0 PageStub.
//
// PRICING CONSISTENCY: this page must never introduce a fourth independent source for a number
// already priced on /monitoring, /retainers or /quick-start — every figure below is read live
// from the same catalog those three pages read, or (for the Quick-Start range) derived from the
// same fixture /quick-start reads. Reading the other three pages' committed code surfaced one
// real inconsistency in the design mock itself:
//
// The mock's retainer ladder/ongoing-tiers lists a fourth "Advisory" tier at $900/mo · 5
// hours, and prices the retainer door/ladder range as "$900–$5,500/mo". Per Retainers.tsx's own
// documented pricing correction, there is no "Advisory" tier in the live catalog (service_type =
// 'retainer') — only three fixed-price, hour-based tiers exist: Architect Essentials ($1,500/mo,
// 8h), Architect Growth ($3,000/mo, 16h), Architect Enterprise ($5,500/mo, 30h). Showing a
// fictional fourth tier or a $900 floor here would contradict /retainers and the real catalog, so
// this page reads the same three live tiers /retainers does (same isFixedHourlyRetainer filter,
// same resolvePublicServicePriceCents helper) and the ladder/doors range is computed from them —
// "$1,500–$5,500/mo", not the mock's "$900–$5,500/mo".
//
// Monitoring's "from $180/mo" figure and the Quick-Start "$149–$799" range in the mock both
// verified correct against live data (Monitoring.tsx's cheapestFloorPrice formula and the
// quickStartPacks.ts fixture respectively) — computed live below via the identical formula/data
// rather than retyped as a literal, so this page can never drift from those two pages even if the
// catalog changes later.

function ic(children: React.ReactNode, size = 18, color = "currentColor", strokeWidth = 1.8) {
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

const DOOR_ICONS: Record<string, React.ReactNode> = {
  scan: ic(<><circle cx={11} cy={11} r={7} /><line x1={21} y1={21} x2={16} y2={16} /></>, 17),
  monitor: ic(<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx={12} cy={12} r={3} /></>, 17),
  retainer: ic(<><path d="M17 2.1l4 4-4 4" /><path d="M3 12.5V11a4 4 0 014-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 11.5V13a4 4 0 01-4 4H3" /></>, 17),
  pack: ic(<><path d="M3 8l9-5 9 5-9 5-9-5z" /><path d="M3 8v9l9 5 9-5V8" /></>, 17),
  sow: ic(<><rect x={4} y={3} width={16} height={18} rx={2} /><line x1={8} y1={9} x2={16} y2={9} /><line x1={8} y1={13} x2={14} y2={13} /></>, 17),
};

// ── Live monitoring pricing — byte-identical formula to Monitoring.tsx's own ppuOf/floorOf/
// surchargeOf/computeMonthlyPrice, the only function that ever computes an actual Stripe charge
// for a monitoring tier (resolveTypeAttributesMonthlyPriceCents, api-server/src/lib/catalog-pricing.ts). ──
interface MonitoringTypeAttributes {
  seatCountFloor?: number;
  pricePerUserMonth?: string;
  flatMonthlySurcharge?: string | null;
}
function mTa(row: MonitoringTier): MonitoringTypeAttributes {
  return (row.typeAttributes ?? {}) as MonitoringTypeAttributes;
}
function ppuOf(row: MonitoringTier): number {
  const n = parseFloat(mTa(row).pricePerUserMonth ?? "");
  return isNaN(n) ? 0 : n;
}
function floorOf(row: MonitoringTier): number {
  const n = Number(mTa(row).seatCountFloor ?? row.seatMin ?? 1);
  return isNaN(n) || n < 1 ? 1 : Math.trunc(n);
}
function surchargeOf(row: MonitoringTier): number {
  const n = parseFloat(mTa(row).flatMonthlySurcharge ?? "");
  return isNaN(n) ? 0 : n;
}
function money(n: number): string {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

// The three fixed monthly retainer tiers are hour-based with no fixed-fee range (basePrice/
// maxPrice null) — same filter Retainers.tsx applies to exclude the range-priced advisory
// retainers (vCISO/Governance, Copilot Governance), out of scope for this ladder just as they are
// out of scope for the /retainers tier comparison.
function isFixedHourlyRetainer(s: PublicService): boolean {
  return !s.basePrice && !!s.hoursPerMonth;
}
function fmtPriceCents(cents: number | null): string | null {
  if (cents == null) return null;
  return "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function shortRetainerName(name: string): string {
  return name.replace(/^Architect\s+/, "").replace(/\s+Retainer$/, "");
}

const MONITORING_TIER_TEXT = [
  { name: "Foundation", fg: "#94a3b8", gets: "30 checks, risk register, documented decisions" },
  { name: "Growth", fg: "#60a5fa", gets: "129 checks, one-click runbooks, the SOP library, remediation tracking" },
  { name: "Premier", fg: "#a78bfa", gets: "Everything in Growth, plus change control, RACI, security plan, PII governance" },
];

const SOW_CATEGORY_TEXT = [
  { name: "Identity", fg: "#a78bfa", gets: "Conditional Access, MFA and passwordless, privileged access, Zero Trust" },
  { name: "Data", fg: "#60a5fa", gets: "Sensitivity labels, DLP, retention, oversharing and exposure remediation" },
  { name: "Migration", fg: "#22d3ee", gets: "Tenant-to-tenant moves, domain consolidation, identity alignment, cutover planning" },
  { name: "Governance", fg: "#34d399", gets: "Lifecycle and naming, ownership, sprawl cleanup, admin role hygiene" },
  { name: "Copilot", fg: "#fbbf24", gets: "Readiness remediation, deployment, adoption and governance programmes" },
];

function buildSteps(checkCount: number): { n: string; title: string; body: string; hot?: boolean; arrow?: boolean }[] {
  return [
    { n: "1", title: "Run the free scan", body: `Read-only Graph scan. ${checkCount} checks, all six pillars.`, hot: true, arrow: true },
    { n: "2", title: "Get a priced SOW", body: "Findings become named phases with fixed prices.", arrow: true },
    { n: "3", title: "Select your scopes", body: "Keep, defer or drop each phase before signing.", arrow: true },
    { n: "4", title: "Sign, pay, onboard", body: "Account, portal and remediation window in one pass.", arrow: false },
  ];
}

const QUICK_START_MIN = Math.min(...PACKS.map((p) => p.price));
const QUICK_START_MAX = Math.max(...PACKS.map((p) => p.price));

export default function Pricing() {
  const { monitoringTiers, loading: monLoading } = useCatalog();
  const { services: retainerServices, loading: retLoading } = useServices("retainer");
  const checkCount = useSignalCheckCount();
  const STEPS = buildSteps(checkCount);

  const retainerTiers = retainerServices
    .filter(isFixedHourlyRetainer)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const retainerPrices = retainerTiers
    .map((t) => resolvePublicServicePriceCents(t))
    .filter((c): c is number => c != null);
  const retainerMinLabel = retainerPrices.length ? fmtPriceCents(Math.min(...retainerPrices)) : null;
  const retainerMaxLabel = retainerPrices.length ? fmtPriceCents(Math.max(...retainerPrices)) : null;
  const retainerRangeLabel =
    retainerMinLabel && retainerMaxLabel ? `${retainerMinLabel}–${retainerMaxLabel}/mo` : "…";
  const retainerFromLabel = retainerMinLabel ? `From ${retainerMinLabel}/mo` : "…";

  const cheapestMonitoringPrice = (() => {
    let min: number | null = null;
    monitoringTiers.forEach((row) => {
      const p = ppuOf(row) * floorOf(row) + surchargeOf(row);
      if (min === null || p < min) min = p;
    });
    return min;
  })();
  const monitoringFromLabel = monLoading
    ? "…"
    : cheapestMonitoringPrice != null
      ? `from ${money(cheapestMonitoringPrice)}/mo`
      : "…";
  const monitoringDoorLabel = monLoading
    ? "…"
    : cheapestMonitoringPrice != null
      ? `From ${money(cheapestMonitoringPrice)}/mo`
      : "…";

  const LADDER = [
    { key: "scan", name: "Free tenant scan", price: "$0", note: `Read-only · ${checkCount} checks · findings are yours either way`, hot: true, green: true },
    { key: "pack", name: "Quick-Start Packs", price: `$${QUICK_START_MIN}–$${QUICK_START_MAX}`, note: "One-off · fixed price on the card · dry run before it applies" },
    { key: "monitor", name: "Monitoring", price: monitoringFromLabel, note: "Per seat bracket · Foundation, Growth or Premier" },
    { key: "retainer", name: "Architect retainer", price: retLoading ? "…" : retainerRangeLabel, note: "By hours · 8, 16 or 30 a month · no seat gating" },
    { key: "sow", name: "Project SOWs", price: "Fixed per phase", note: "Priced from your scan findings · keep, defer or drop each phase" },
  ];

  const DOORS = [
    {
      key: "scan",
      name: "Free tenant scan",
      price: "Free",
      priceFg: "#34d399",
      tag: "Most people start here",
      href: "/scan",
      hot: true,
      body: "A read-only Graph scan returns every real finding, then prices the work to close them as one SOW.",
      next: "Findings → priced SOW → you choose",
    },
    {
      key: "monitor",
      name: "Monitoring",
      price: monitoringDoorLabel,
      priceFg: "#cbd5e1",
      tag: "Buy direct",
      href: "/monitoring",
      hot: false,
      body: "Six signal engines against your tenant continuously, with remediation built in at your tier.",
      next: "Watched → remediated → SOW if it needs one",
    },
    {
      key: "retainer",
      name: "Architect retainer",
      price: retLoading ? "…" : retainerFromLabel,
      priceFg: "#cbd5e1",
      tag: "Buy direct",
      href: "/retainers",
      hot: false,
      body: "A named architect on retainer — 8, 16 or 30 hours a month. No seat gating on any tier.",
      next: "Advice first, monitoring and SOWs alongside",
    },
    {
      key: "pack",
      name: "Quick-Start Pack",
      price: `$${QUICK_START_MIN}–$${QUICK_START_MAX}`,
      priceFg: "#cbd5e1",
      tag: "One-off",
      href: "/quick-start",
      hot: false,
      body: "One pre-built set of configuration changes, applied directly through Graph write-back.",
      next: "Done in days, no proposal cycle",
    },
  ];

  const ONGOING = [
    {
      name: "Monitoring",
      icon: DOOR_ICONS.monitor,
      body: "The engines keep scanning, and what gets fixed for you depends on your tier.",
      tiers: MONITORING_TIER_TEXT,
    },
    {
      name: "Project SOWs",
      icon: DOOR_ICONS.sow,
      body: "Work beyond your tier’s runbooks is scoped from your own findings and priced phase by phase before anything starts.",
      tiers: SOW_CATEGORY_TEXT,
    },
    {
      name: "Retainer",
      icon: DOOR_ICONS.retainer,
      body: "Optional either way: reserved architect hours for the decisions and reviews that aren’t a project.",
      tiers: retLoading
        ? []
        : retainerTiers.map((t) => {
            const priceLabel = fmtPriceCents(resolvePublicServicePriceCents(t));
            const fg = t.highlighted ? "#60a5fa" : "#94a3b8";
            return {
              name: shortRetainerName(t.name),
              fg,
              gets: `${priceLabel ?? "Contact for pricing"}/mo${t.hoursPerMonth ? ` · ${t.hoursPerMonth} hours a month` : ""}`,
            };
          }),
    },
  ];

  return (
    <MarketingLayout current="pricing">
      {/* Hero */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "48px 32px 30px",
          background:
            "radial-gradient(circle 1100px at 76% -20%, rgba(0,120,212,.12), rgba(2,6,23,0) 62%), radial-gradient(circle 800px at 6% 12%, rgba(0,180,216,.06), rgba(2,6,23,0) 66%)",
        }}
      >
        <span
          style={{
            position: "absolute",
            right: "-60px",
            top: "50%",
            transform: "translateY(-50%)",
            opacity: 0.11,
            pointerEvents: "none",
            lineHeight: 0,
            filter: "drop-shadow(0 0 26px rgba(0,180,216,.3))",
          }}
        >
          <svg width={470} height={470} viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 2h16v20l-3-2-3 2-2-2-2 2-3-2-3 2V2z" />
            <path d="M8 7h8" />
            <path d="M8 11h8" />
            <path d="M8 15h5" />
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
              {ic(<><line x1={12} y1={2} x2={12} y2={22} /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></>, 14)} Pricing
            </span>
            <h1
              style={{
                fontSize: "clamp(30px,3.4vw,40px)",
                fontWeight: 800,
                letterSpacing: "-.03em",
                lineHeight: 1.12,
                color: "#f8fafc",
                margin: "0 0 16px",
              }}
            >
              No hourly guesswork. Fixed prices, real scope.
            </h1>
            <p style={{ fontSize: "15px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 12px", maxWidth: "54ch" }}>
              Every engagement starts with a free tenant scan &#8212; never a sales call you
              didn&#8217;t ask for. Monitoring and retainers are flat monthly prices, packs are
              one-off fixed fees, and project work is priced phase by phase from your own findings
              before anything starts.
            </p>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.7, margin: "0 0 24px", maxWidth: "54ch" }}>
              The ladder alongside is the whole price architecture &#8212; every number on this
              site, in one place.
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "22px" }}>
              <Link
                href="/scan"
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
                Scan My Tenant &#183; Free
                {ic(<><line x1={4} y1={12} x2={20} y2={12} /><polyline points="14 6 20 12 14 18" /></>, 15)}
              </Link>
              <Link
                href="/monitoring"
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
                See Monitoring Pricing
              </Link>
            </div>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
              {["Every price published", "SOWs fixed phase by phase", "Monthly products cancel monthly"].map((t) => (
                <span key={t} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#64748b" }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "999px", background: "#34d399" }} />
                  {t}
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
              padding: "20px 22px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px" }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>
                The price architecture
              </span>
              <span style={{ fontSize: "9.5px", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#475569" }}>
                All of it
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }} data-testid="pricing-ladder">
              {LADDER.map((l) => (
                <div
                  key={l.key}
                  data-testid={`pricing-ladder-${l.key}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "11px 13px",
                    borderRadius: "11px",
                    border: `1px solid ${l.hot ? "rgba(59,130,246,.4)" : "rgba(30,41,59,.9)"}`,
                    background: l.hot ? "rgba(59,130,246,.06)" : "rgba(2,6,23,.35)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>{l.name}</div>
                    <div style={{ fontSize: "10.5px", color: "#64748b", marginTop: "2px" }}>{l.note}</div>
                  </div>
                  <span
                    data-testid={`pricing-ladder-${l.key}-price`}
                    style={{
                      flex: "none",
                      whiteSpace: "nowrap",
                      fontSize: "13px",
                      fontWeight: 800,
                      fontVariantNumeric: "tabular-nums",
                      letterSpacing: "-.01em",
                      color: l.green ? "#34d399" : "#e2e8f0",
                    }}
                  >
                    {l.price}
                  </span>
                </div>
              ))}
            </div>
            <p style={{ margin: "12px 0 0", paddingTop: "11px", borderTop: "1px solid rgba(30,41,59,.9)", fontSize: "11px", color: "#64748b", lineHeight: 1.6 }}>
              Nothing on this page says &#8220;contact us for pricing&#8221;. The only number that
              waits for your tenant is the SOW &#8212; because it&#8217;s priced from your
              findings.
            </p>
          </div>
        </div>
      </section>

      {/* Funnel */}
      <section
        style={{
          padding: "40px 32px 56px",
          background: "linear-gradient(180deg, rgba(5,13,30,0) 0%, #050d1e 16%, #050d1e 84%, rgba(5,13,30,0) 100%), radial-gradient(circle 900px at 20% 0%, rgba(0,120,212,.05), rgba(2,6,23,0) 60%)",
        }}
      >
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "24px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#60a5fa" }}>The funnel</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>
              Four ways in. One way of working.
            </h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Start wherever makes sense &#8212; a free scan, monitoring, a retainer, or a single
              fixed-price pack. They all land in the same place.
            </p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "12px", marginBottom: "6px" }} data-testid="pricing-doors">
            {DOORS.map((d) => (
              <Link
                key={d.key}
                href={d.href}
                data-testid={`pricing-door-${d.key}`}
                style={{
                  flex: "1 1 210px",
                  maxWidth: "280px",
                  minHeight: "232px",
                  display: "flex",
                  flexDirection: "column",
                  padding: "19px",
                  borderRadius: "15px",
                  background: "#0b1524",
                  border: `1px solid ${d.hot ? "rgba(59,130,246,.35)" : "rgba(30,41,59,.9)"}`,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px" }}>
                  <span
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "9px",
                      background: "rgba(59,130,246,.08)",
                      border: "1px solid rgba(59,130,246,.2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#60a5fa",
                    }}
                  >
                    {DOOR_ICONS[d.key]}
                  </span>
                  <span
                    style={{
                      fontSize: "9px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: ".13em",
                      color: d.hot ? "#60a5fa" : "#64748b",
                      background: d.hot ? "rgba(59,130,246,.1)" : "rgba(71,85,105,.14)",
                      border: `1px solid ${d.hot ? "rgba(59,130,246,.3)" : "rgba(71,85,105,.3)"}`,
                      borderRadius: "999px",
                      padding: "3px 8px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {d.tag}
                  </span>
                </span>
                <span style={{ display: "block", fontSize: "15px", fontWeight: 700, color: "#f8fafc", marginBottom: "3px" }}>{d.name}</span>
                <span
                  data-testid={`pricing-door-${d.key}-price`}
                  style={{ display: "block", fontSize: "12px", fontWeight: 700, color: d.priceFg, marginBottom: "9px", fontVariantNumeric: "tabular-nums" }}
                >
                  {d.price}
                </span>
                <span style={{ display: "block", fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.55, flexGrow: 1 }}>{d.body}</span>
                <span style={{ display: "block", fontSize: "11.5px", fontWeight: 600, color: "#60a5fa", marginTop: "12px" }}>{d.next}</span>
              </Link>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "9px", padding: "14px 0 6px" }}>
            <span style={{ height: "1px", flex: 1, maxWidth: "160px", background: "linear-gradient(90deg,rgba(2,6,23,0),rgba(59,130,246,.5))" }} />
            <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".16em", color: "#60a5fa", whiteSpace: "nowrap" }}>
              All four converge here
            </span>
            <span style={{ height: "1px", flex: 1, maxWidth: "160px", background: "linear-gradient(90deg,rgba(59,130,246,.5),rgba(2,6,23,0))" }} />
          </div>

          <div style={{ borderRadius: "18px", border: "1px solid rgba(59,130,246,.22)", background: "linear-gradient(165deg,rgba(59,130,246,.09),rgba(139,92,246,.04) 45%,#0b1524 100%)", padding: "24px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginBottom: "18px" }}>
              <h3 style={{ margin: 0, fontSize: "19px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.02em" }}>
                You&#8217;re a customer now &#8212; here&#8217;s what that means
              </h3>
              <span style={{ fontSize: "11.5px", color: "#64748b" }}>Nothing below needs a new sales conversation</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(268px,1fr))", gap: "12px", alignItems: "stretch" }}>
              {ONGOING.map((o) => (
                <div key={o.name} style={{ borderRadius: "13px", border: "1px solid rgba(30,41,59,.95)", background: "rgba(2,6,23,.5)", padding: "16px 17px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ color: "#60a5fa", display: "flex" }}>{o.icon}</span>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#f8fafc" }}>{o.name}</span>
                  </span>
                  <span style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.6 }}>{o.body}</span>
                  {o.tiers.length > 0 && (
                    <span style={{ display: "flex", flexDirection: "column", gap: "5px", paddingTop: "9px" }}>
                      {o.tiers.map((t) => (
                        <span key={t.name} style={{ display: "flex", alignItems: "baseline", gap: "7px" }}>
                          <span style={{ fontSize: "10.5px", fontWeight: 700, color: t.fg, minWidth: "76px", flex: "none" }}>{t.name}</span>
                          <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>{t.gets}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p style={{ margin: "16px 0 0", fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.65, maxWidth: "70ch" }}>
              Anything the runbooks and SOPs in your tier can&#8217;t close becomes a scoped
              project: priced as a fixed-fee statement of work, phase by phase, enabled or deferred
              by you. That is the only way project work ever starts &#8212; there is no cart.
            </p>
          </div>
        </div>
      </section>

      {/* From Scan to Scoped Work */}
      <section style={{ padding: "32px 32px 56px", background: "linear-gradient(180deg, rgba(0,120,212,.05), rgba(2,6,23,0) 55%)" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto 26px", textAlign: "center" }}>
          <h2 style={{ fontSize: "19px", fontWeight: 700, color: "#f8fafc", margin: "0 0 10px", letterSpacing: "-.02em" }}>From Scan to Scoped Work</h2>
          <p style={{ color: "#94a3b8", lineHeight: 1.7, margin: 0, fontSize: "13px" }}>
            Not sure which stage fits? Start with the free scan &#8212; it reads your actual
            tenant and prices the work to fix what it finds, so you never have to guess which door
            was right.
          </p>
        </div>
        <div style={{ maxWidth: "980px", margin: "0 auto", display: "flex", alignItems: "stretch", justifyContent: "center", gap: "10px", flexWrap: "wrap" }}>
          {STEPS.map((st) => (
            <div key={st.n} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  width: "210px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  padding: "16px",
                  borderRadius: "14px",
                  background: "#0b1524",
                  border: `1px solid ${st.hot ? "rgba(59,130,246,.45)" : "rgba(30,41,59,.9)"}`,
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
                    background: st.hot ? "rgba(59,130,246,.15)" : "rgba(255,255,255,.05)",
                    border: st.hot ? "1px solid rgba(59,130,246,.4)" : "1px solid rgba(255,255,255,.1)",
                    color: st.hot ? "#60a5fa" : "#94a3b8",
                  }}
                >
                  {st.n}
                </span>
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>{st.title}</span>
                <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>{st.body}</span>
              </div>
              {st.arrow && ic(<><line x1={4} y1={12} x2={20} y2={12} /><polyline points="14 6 20 12 14 18" /></>, 16, "#475569", 2)}
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: "26px" }}>
          <Link
            href="/scan"
            style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "13px 26px", borderRadius: "11px", fontWeight: 700, fontSize: "14px", color: "#fff", background: GRADIENT_BG, whiteSpace: "nowrap" }}
          >
            Scan My Tenant &#183; Free
            {ic(<><line x1={4} y1={12} x2={20} y2={12} /><polyline points="14 6 20 12 14 18" /></>, 15)}
          </Link>
          <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "10px" }}>Read-only. No agent, no charge, and the findings are yours either way.</div>
        </div>
      </section>
    </MarketingLayout>
  );
}
