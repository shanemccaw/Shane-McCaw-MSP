import React from "react";
import { Link } from "wouter";
import { MarketingLayout } from "../components/MarketingLayout";
import { useCatalog, type MonitoringTier } from "../../hooks/useCatalog";
import {
  useServices,
  resolvePublicServicePriceCents,
  type PublicService,
} from "../../hooks/useServices";
import { PACKS } from "../data/quickStartPacks";

// Route / — recreated from Design/design_handoff_marketing/Marketing Home.dc.html.
// Colours, spacing and copy are the design's own, verbatim (copy is final — README:
// "Do not rewrite the copy"). The prototype linked pages with relative <a href> to
// .dc.html filenames; production routes internal links through wouter <Link> and treats
// the customer portal as an external link (README: "treat it as an external link").
//
// Pillar identity is an icon, never a dot — every pillar carries its own Lucide-style
// stroke glyph in a tinted rounded tile (`<colour>1A` fill, `<colour>33` border). Copilot
// is an add-on, not a seventh pillar: it sits below the six in its own full-width band with
// the AI-spark icon and the 41 readiness score. 41 is below the real Copilot Gate threshold
// of 82 (COPILOT_GATE_THRESHOLD in api-server/src/lib/copilot-gate.ts), so the design's
// "Not safe to deploy yet" verdict matches the platform's own gate.

// The six pillars, each with its own colour, accent, route, illustrative score, hook and body —
// values lifted verbatim from the design's PILLARS array.
type Pillar = {
  n: number;
  name: string;
  color: string;
  accent: string;
  href: string;
  score: number;
  hook: string;
  body: string;
};

const PILLAR_ICON: Record<string, React.ReactNode> = {
  Governance: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  Security: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v12" />
      <path d="M15 9.5a2.5 2.5 0 0 0-2.5-2h-1a2.5 2.5 0 0 0 0 5h1a2.5 2.5 0 0 1 0 5h-1a2.5 2.5 0 0 1-2.5-2" />
    </>
  ),
  Adoption: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  Health: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
};

const PILLARS: Pillar[] = [
  {
    n: 1,
    name: "Governance",
    color: "#3b82f6",
    accent: "#60a5fa",
    href: "/pillars/governance",
    score: 41,
    hook: "Ask who owns Exchange. Watch the room go quiet.",
    body:
      "RACI ownership on every service and change, change control with rollback points, and a freeze calendar that actually freezes things.",
  },
  {
    n: 2,
    name: "Security",
    color: "#8b5cf6",
    accent: "#a78bfa",
    href: "/pillars/security",
    score: 58,
    hook: "Your tenant has a security score. You’ve never seen it.",
    body:
      "Identity, data, email, devices, apps and audit scored continuously — with the drift caught the hour it happens, not at the next assessment.",
  },
  {
    n: 3,
    name: "Compliance",
    color: "#e2e8f0",
    accent: "#e2e8f0",
    href: "/pillars/compliance",
    score: 52,
    hook: "Your auditor doesn’t want a promise. They want a timestamp.",
    body:
      "Every control stored as time-stamped evidence, mapped to CIS, NIST and ISO — audit season becomes a download.",
  },
  {
    n: 4,
    name: "Licensing",
    color: "#14b8a6",
    accent: "#2dd4bf",
    href: "/pillars/licensing",
    score: 71,
    hook: "You’re paying for software nobody has opened since March.",
    body:
      "Assigned vs active per SKU, duplicate coverage named, and leaver licences reclaimed — the pillar that pays for the other five.",
  },
  {
    n: 5,
    name: "Adoption",
    color: "#f97316",
    accent: "#fb923c",
    href: "/pillars/adoption",
    score: 63,
    hook: "Week one, everyone tried it. Week four, eleven people still use it.",
    body:
      "Weekly active use per workload against what you pay for — the decay caught in week three, not at renewal.",
  },
  {
    n: 6,
    name: "Health",
    color: "#22c55e",
    accent: "#4ade80",
    href: "/pillars/health",
    score: 77,
    hook: "Microsoft changes your tenant all year. You approved none of it.",
    body:
      "Every message-centre post scored against your configuration — retirements, enforcements and moved dates, triaged to the five that hurt.",
  },
];

// A pillar's stroke glyph at a given colour/size, matching the design's PILLAR_SVG helper.
function pillarSvg(name: string, color: string, size: number, sw = 2) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PILLAR_ICON[name]}
    </svg>
  );
}

// A tinted rounded icon tile (`<colour>1A` fill, `<colour>33` border) wrapping a pillar glyph.
function pillarTile(name: string, color: string, sz: number, r: number, iconSize: number) {
  return (
    <span
      style={{
        flex: "none",
        width: `${sz}px`,
        height: `${sz}px`,
        borderRadius: `${r}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `${color}1A`,
        border: `1px solid ${color}33`,
      }}
    >
      {pillarSvg(name, color, iconSize)}
    </span>
  );
}

// Live-sourced pricing, byte-identical to Pricing.tsx's own formulas — see that file's
// "PRICING CONSISTENCY" header for why these are read from the same catalog/fixture rather than
// retyped as literals here.
const QUICK_START_MIN = Math.min(...PACKS.map((p) => p.price));
const QUICK_START_MAX = Math.max(...PACKS.map((p) => p.price));

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

// Same filter Retainers.tsx/Pricing.tsx apply to exclude the range-priced advisory retainers —
// only the three fixed-price, hour-based tiers count toward the door's "from" figure.
function isFixedHourlyRetainer(s: PublicService): boolean {
  return !s.basePrice && !!s.hoursPerMonth;
}
function fmtPriceCents(cents: number | null): string | null {
  if (cents == null) return null;
  return "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

const STATS: { v: string; l: string }[] = [
  { v: "NASA", l: "current Lead M365 Architect" },
  { v: "30 yrs", l: "in the Microsoft ecosystem" },
  { v: "158", l: "checks across six pillars" },
  { v: "33", l: "fixed-price remediation projects" },
  { v: "15", l: `Quick-Start Packs from $${QUICK_START_MIN}` },
];

const DIVES: { label: string; href: string }[] = [
  { label: "Copilot & AI", href: "/solutions/copilot" },
  { label: "SharePoint", href: "/solutions/sharepoint" },
  { label: "Teams", href: "/solutions/teams" },
  { label: "Power Platform", href: "/solutions/power-platform" },
  { label: "Migration", href: "/solutions/migration" },
  { label: "M365 Health", href: "/solutions/m365-health" },
  { label: "Governance projects", href: "/solutions/governance" },
  { label: "All 33 projects", href: "/solutions" },
];

const WEEK_ROWS: { mod: string; fg: string; what: string; meta: string }[] = [
  { mod: "REMEDIATION", fg: "#34d399", what: "3 findings closing this week", meta: "projected score +4" },
  {
    mod: "MS CHANGES",
    fg: "#f87171",
    what: "Basic auth retirement hits Bay 3 scanners · 1 Oct",
    meta: "runbook queued · CR-0142",
  },
  {
    mod: "MY ARCHITECT",
    fg: "#a78bfa",
    what: "11.5 of 16 retainer hours logged",
    meta: "status report drafts Friday",
  },
];

// The four entry doors. The scan door is the highlighted "most people start here" one.
type DoorKey = "scan" | "monitor" | "retainer" | "pack";
function buildDoors(monitoringFromLabel: string, retainerFromLabel: string): {
  key: DoorKey;
  name: string;
  price: string;
  tag: string;
  href: string;
  body: string;
  next: string;
}[] {
  return [
    {
      key: "scan",
      name: "Free tenant scan",
      price: "Free",
      tag: "Most people start here",
      href: "/scan",
      body:
        "A read-only Graph scan returns every real finding, then prices the work to close them as one SOW.",
      next: "Findings → priced SOW → you choose",
    },
    {
      key: "monitor",
      name: "Monitoring",
      price: monitoringFromLabel,
      tag: "Buy direct",
      href: "/monitoring",
      body: "Six signal engines against your tenant continuously, with remediation built in at your tier.",
      next: "Watched → remediated → SOW if it needs one",
    },
    {
      key: "retainer",
      name: "Architect retainer",
      price: retainerFromLabel,
      tag: "Buy direct",
      href: "/retainers",
      body: "A named architect on retainer — 5, 8, 16 or 30 hours a month. No seat gating on any tier.",
      next: "Advice first, monitoring and SOWs alongside",
    },
    {
      key: "pack",
      name: "Quick-Start Pack",
      price: `$${QUICK_START_MIN}–$${QUICK_START_MAX}`,
      tag: "One-off",
      href: "/quick-start",
      body:
        "One pre-built set of configuration changes, applied through Graph write-back after a dry run you approve.",
      next: "Done in days, no proposal cycle",
    },
  ];
}

function doorIcon(key: DoorKey) {
  const common = {
    viewBox: "0 0 24 24",
    width: 17,
    height: 17,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (key) {
    case "scan":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16" y2="16" />
        </svg>
      );
    case "monitor":
      return (
        <svg {...common}>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "retainer":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
        </svg>
      );
    case "pack":
      return (
        <svg {...common}>
          <path d="M3 8l9-5 9 5-9 5-9-5z" />
          <path d="M3 8v9l9 5 9-5V8" />
        </svg>
      );
  }
}

const STEPS: { n: string; title: string; body: string; hot?: boolean; arrow: boolean }[] = [
  { n: "1", title: "Run the free scan", body: "Read-only Graph scan. 158 checks, all six pillars.", hot: true, arrow: true },
  { n: "2", title: "Get a priced SOW", body: "Findings become named phases with fixed prices.", arrow: true },
  { n: "3", title: "Select your scopes", body: "Keep, defer or drop each phase before signing.", arrow: true },
  { n: "4", title: "Sign, pay, onboard", body: "Account, portal and remediation window in one pass.", arrow: false },
];

// The right-arrow used by CTAs and the process steps.
function arrowIcon(size = 15) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" y1="12" x2="20" y2="12" />
      <polyline points="14 6 20 12 14 18" />
    </svg>
  );
}

const GRADIENT_CTA = "linear-gradient(90deg,#3b82f6,#8b5cf6)";

export default function Home() {
  const { monitoringTiers, loading: monLoading } = useCatalog();
  const { services: retainerServices, loading: retLoading } = useServices("retainer");

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
      ? `From ${money(cheapestMonitoringPrice)}/mo`
      : "…";

  const retainerPrices = retainerServices
    .filter(isFixedHourlyRetainer)
    .map((t) => resolvePublicServicePriceCents(t))
    .filter((c): c is number => c != null);
  const retainerMinLabel = retainerPrices.length ? fmtPriceCents(Math.min(...retainerPrices)) : null;
  const retainerFromLabel = retLoading ? "…" : retainerMinLabel ? `From ${retainerMinLabel}/mo` : "…";

  const DOORS = buildDoors(monitoringFromLabel, retainerFromLabel);

  return (
    <MarketingLayout current="home">
      {/* Scoped hover rules — the design used `style-hover`, which isn't a real DOM attribute;
          we drive the same "hover intensifies the border to the accent" motion via classes and a
          per-card `--hb` custom property so each pillar card can hover to its own colour. */}
      <style>{`
        .sm-home a{text-decoration:none}
        .sm-home-card{transition:border-color 200ms}
        .sm-home-card:hover{border-color:var(--hb)}
        .sm-home-chip{transition:border-color 200ms,color 200ms}
        .sm-home-chip:hover{border-color:rgba(59,130,246,.4);color:#e2e8f0}
      `}</style>

      <div className="sm-home" data-testid="marketing-home">
        {/* ── Hero ─────────────────────────────────────────────────────────────── */}
        <section
          style={{
            padding: "52px 32px 34px",
            background:
              "radial-gradient(ellipse 900px 420px at 70% -10%,rgba(59,130,246,.09),transparent), radial-gradient(ellipse 700px 380px at 20% 0%,rgba(0,180,216,.05),transparent)",
          }}
        >
          <div
            style={{
              maxWidth: "1120px",
              margin: "0 auto",
              display: "flex",
              gap: "44px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {/* Hero copy */}
            <div style={{ flex: "1.1 1 400px", minWidth: 0 }}>
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
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>{" "}
                Built by NASA’s Current Lead M365 Architect
              </span>
              <h1
                style={{
                  fontSize: "clamp(32px,4vw,46px)",
                  fontWeight: 800,
                  letterSpacing: "-.03em",
                  lineHeight: 1.08,
                  color: "#f8fafc",
                  margin: "0 0 16px",
                  textWrap: "pretty",
                }}
              >
                Your Microsoft 365 Tenant, Watched Every Hour of Every Day
              </h1>
              <p
                style={{
                  fontSize: "15.5px",
                  color: "#94a3b8",
                  lineHeight: 1.7,
                  margin: "0 0 12px",
                  maxWidth: "56ch",
                }}
              >
                Six pillars — Governance, Security, Compliance, Licensing, Adoption, Health — scored by a
                free read-only scan, watched continuously by six signal engines, and fixed through priced
                work you approve line by line. All of it runs through a portal you can walk into today.
              </p>
              <p
                style={{
                  fontSize: "13px",
                  color: "#64748b",
                  lineHeight: 1.7,
                  margin: "0 0 24px",
                  maxWidth: "56ch",
                }}
              >
                The readout alongside is what the scan hands you — a composite score, six pillar scores, and
                every finding under them. Free, and yours either way.
              </p>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "22px" }}>
                <Link
                  href="/scan"
                  data-testid="home-hero-scan-cta"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "7px",
                    padding: "13px 24px",
                    borderRadius: "10px",
                    fontWeight: 700,
                    fontSize: "14px",
                    color: "#fff",
                    background: GRADIENT_CTA,
                    boxShadow: "0 10px 30px rgba(37,99,235,.3)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Scan My Tenant · Free {arrowIcon()}
                </Link>
                {/* The customer portal is a separate SPA — an external link, not a wouter route. */}
                <a
                  href="/portal"
                  style={{
                    padding: "13px 24px",
                    borderRadius: "10px",
                    fontWeight: 600,
                    fontSize: "14px",
                    color: "#cbd5e1",
                    border: "1px solid rgba(148,163,184,.2)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Tour the Portal
                </a>
              </div>
              <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
                {["Read-only Graph scan", "No agent, no charge", "Every price on the site published"].map(
                  (t) => (
                    <span
                      key={t}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "11.5px",
                        color: "#64748b",
                      }}
                    >
                      <span
                        style={{ width: "5px", height: "5px", borderRadius: "999px", background: "#34d399" }}
                      />
                      {t}
                    </span>
                  ),
                )}
              </div>
            </div>

            {/* Hero readout artefact — the first-scan mock */}
            <div
              style={{
                flex: "1 1 400px",
                maxWidth: "520px",
                border: "1px solid rgba(30,41,59,.95)",
                borderRadius: "18px",
                background: "#0b1524",
                padding: "20px 22px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  marginBottom: "14px",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".18em",
                    textTransform: "uppercase",
                    color: "#64748b",
                  }}
                >
                  First scan readout · all six pillars
                </span>
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 600,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "#475569",
                  }}
                >
                  Illustrative
                </span>
              </div>
              <div style={{ display: "flex", gap: "20px", alignItems: "center", flexWrap: "wrap" }}>
                {/* Composite score ring — geometry fixed to the design (61 of 100). */}
                <div style={{ flex: "none", position: "relative", width: "118px", height: "118px" }}>
                  <svg viewBox="0 0 100 100" style={{ width: "118px", height: "118px", transform: "rotate(-90deg)" }}>
                    <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(30,41,59,.9)" strokeWidth="8" />
                    <circle
                      cx="50"
                      cy="50"
                      r="44"
                      fill="none"
                      stroke="url(#smHomeGrad)"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray="276.5"
                      strokeDashoffset="107.8"
                    />
                    <defs>
                      <linearGradient id="smHomeGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#8b5cf6" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <b
                      style={{
                        fontSize: "30px",
                        fontWeight: 800,
                        color: "#f8fafc",
                        letterSpacing: "-.03em",
                        lineHeight: 1,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      61
                    </b>
                    <span
                      style={{
                        fontSize: "9px",
                        fontWeight: 700,
                        letterSpacing: ".14em",
                        textTransform: "uppercase",
                        color: "#fbbf24",
                        marginTop: "3px",
                      }}
                    >
                      Needs work
                    </span>
                  </div>
                </div>
                {/* Six pillar score rows */}
                <div style={{ flex: 1, minWidth: "220px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {PILLARS.map((p) => (
                    <Link
                      key={p.name}
                      href={p.href}
                      style={{ display: "flex", alignItems: "center", gap: "9px" }}
                    >
                      {pillarTile(p.name, p.color, 20, 6, 12)}
                      <span
                        style={{
                          width: "86px",
                          flex: "none",
                          fontSize: "11.5px",
                          fontWeight: 600,
                          color: "#cbd5e1",
                        }}
                      >
                        {p.name}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          height: "7px",
                          borderRadius: "999px",
                          background: "rgba(2,6,23,.6)",
                          overflow: "hidden",
                          display: "flex",
                        }}
                      >
                        <span
                          style={{
                            width: `${p.score}%`,
                            height: "100%",
                            borderRadius: "999px",
                            background: `linear-gradient(90deg,${p.color}33,${p.color})`,
                          }}
                        />
                      </span>
                      <span
                        style={{
                          width: "24px",
                          flex: "none",
                          textAlign: "right",
                          fontSize: "11.5px",
                          fontWeight: 800,
                          color: "#e2e8f0",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {p.score}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginTop: "14px",
                  paddingTop: "12px",
                  borderTop: "1px solid rgba(30,41,59,.9)",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    flex: "none",
                    padding: "4px 10px",
                    borderRadius: "999px",
                    fontSize: "10px",
                    fontWeight: 700,
                    background: "rgba(248,113,113,.12)",
                    border: "1px solid rgba(248,113,113,.35)",
                    color: "#f87171",
                    whiteSpace: "nowrap",
                  }}
                >
                  2 high-severity findings
                </span>
                <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>
                  MFA gap on 3 admin roles · an OAuth app with full mailbox access.
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Credibility strip ────────────────────────────────────────────────── */}
        <section
          style={{
            padding: "18px 32px 26px",
            borderTop: "1px solid rgba(255,255,255,.05)",
            borderBottom: "1px solid rgba(255,255,255,.05)",
            background: "#040b1a",
          }}
        >
          <div
            style={{
              maxWidth: "1120px",
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px 36px",
              flexWrap: "wrap",
            }}
          >
            {STATS.map((st) => (
              <div key={st.l} style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                <b
                  style={{
                    fontSize: "17px",
                    fontWeight: 800,
                    color: "#f8fafc",
                    letterSpacing: "-.02em",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {st.v}
                </b>
                <span style={{ fontSize: "11.5px", color: "#64748b" }}>{st.l}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── The six pillars + Copilot add-on band ────────────────────────────── */}
        <section style={{ padding: "46px 32px 48px" }}>
          <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
            <div style={{ maxWidth: "680px", marginBottom: "24px" }}>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: "#60a5fa",
                }}
              >
                What we watch
              </span>
              <h2
                style={{
                  fontSize: "24px",
                  fontWeight: 800,
                  letterSpacing: "-.025em",
                  color: "#f8fafc",
                  margin: "8px 0 10px",
                }}
              >
                Six pillars. One of them is why you’re here.
              </h2>
              <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
                Every check, finding, runbook and project on this site hangs off one of six pillars — the
                same six the scan scores and the portal tracks.
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
                gap: "12px",
              }}
            >
              {PILLARS.map((p) => (
                <Link
                  key={p.name}
                  href={p.href}
                  className="sm-home-card"
                  style={{
                    // per-card hover target colour
                    ["--hb" as string]: `${p.color}66`,
                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    padding: "20px",
                    borderRadius: "16px",
                    background: `radial-gradient(ellipse 420px 260px at 88% 8%, ${p.color}1f, rgba(2,6,23,0) 70%), #0b1524`,
                    border: `1px solid ${p.color}2e`,
                  } as React.CSSProperties}
                >
                  {/* Watermark glyph */}
                  <span
                    style={{
                      position: "absolute",
                      right: "-14px",
                      top: "-10px",
                      opacity: 0.09,
                      pointerEvents: "none",
                      lineHeight: 0,
                    }}
                  >
                    {pillarSvg(p.name, p.color, 132, 1.1)}
                  </span>
                  <span style={{ position: "relative", display: "flex", alignItems: "center", gap: "9px" }}>
                    {pillarTile(p.name, p.color, 22, 7, 13)}
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        letterSpacing: ".16em",
                        textTransform: "uppercase",
                        color: "#64748b",
                      }}
                    >
                      Pillar 0{p.n}
                    </span>
                    <span
                      style={{ marginLeft: "auto", fontSize: "13px", fontWeight: 700, color: p.accent }}
                    >
                      {p.name}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: "15.5px",
                      fontWeight: 700,
                      color: "#f8fafc",
                      lineHeight: 1.35,
                      letterSpacing: "-.015em",
                      textWrap: "pretty",
                    }}
                  >
                    {p.hook}
                  </span>
                  <span style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.6, flexGrow: 1 }}>
                    {p.body}
                  </span>
                  <span style={{ fontSize: "11.5px", fontWeight: 600, color: "#60a5fa" }}>
                    See the {p.name} pillar →
                  </span>
                </Link>
              ))}

              {/* Copilot · add-on divider */}
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginTop: "6px",
                }}
              >
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: ".2em",
                    textTransform: "uppercase",
                    color: "#00B4D8",
                  }}
                >
                  Copilot · add-on
                </span>
                <span
                  style={{
                    flex: 1,
                    height: "1px",
                    background: "linear-gradient(90deg,rgba(0,180,216,.35),rgba(2,6,23,0))",
                  }}
                />
              </div>

              {/* The Copilot add-on band — a full-width section, NOT a seventh pillar */}
              <a
                href="/solutions/copilot"
                className="sm-home-card"
                style={{
                  ["--hb" as string]: "rgba(0,180,216,.6)",
                  gridColumn: "1 / -1",
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  gap: "26px",
                  flexWrap: "wrap",
                  padding: "24px 26px",
                  borderRadius: "18px",
                  background:
                    "radial-gradient(ellipse 620px 320px at 92% 6%, rgba(0,180,216,.28), rgba(2,6,23,0) 68%), radial-gradient(ellipse 560px 300px at 8% 100%, rgba(139,92,246,.22), rgba(2,6,23,0) 70%), linear-gradient(115deg,rgba(0,120,212,.20) 0%, rgba(59,130,246,.10) 38%, rgba(139,92,246,.13) 72%, rgba(0,180,216,.17) 100%), #0b1524",
                  border: "1px solid rgba(0,180,216,.36)",
                  boxShadow: "0 0 0 1px rgba(139,92,246,.10) inset, 0 18px 60px rgba(0,180,216,.10)",
                } as React.CSSProperties}
              >
                {/* Watermark AI-spark glyph */}
                <span
                  style={{
                    position: "absolute",
                    right: "-18px",
                    top: "-26px",
                    opacity: 0.1,
                    pointerEvents: "none",
                    lineHeight: 0,
                  }}
                >
                  <svg
                    width="180"
                    height="180"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#00B4D8"
                    strokeWidth="1.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9.94 14.66a1 1 0 0 0-.7-.7l-4.6-1.3a.5.5 0 0 1 0-.94l4.6-1.3a1 1 0 0 0 .7-.7l1.3-4.6a.5.5 0 0 1 .94 0l1.3 4.6a1 1 0 0 0 .7.7l4.6 1.3a.5.5 0 0 1 0 .94l-4.6 1.3a1 1 0 0 0-.7.7l-1.3 4.6a.5.5 0 0 1-.94 0zM20 2v4M22 4h-4M4 17v2M5 18H3" />
                  </svg>
                </span>

                <span
                  style={{
                    position: "relative",
                    flex: "1 1 460px",
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "11px" }}>
                    <span
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "10px",
                        background: "linear-gradient(135deg,rgba(0,120,212,.16),rgba(139,92,246,.16))",
                        border: "1px solid rgba(0,180,216,.32)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "none",
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#00B4D8"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M9.94 14.66a1 1 0 0 0-.7-.7l-4.6-1.3a.5.5 0 0 1 0-.94l4.6-1.3a1 1 0 0 0 .7-.7l1.3-4.6a.5.5 0 0 1 .94 0l1.3 4.6a1 1 0 0 0 .7.7l4.6 1.3a.5.5 0 0 1 0 .94l-4.6 1.3a1 1 0 0 0-.7.7l-1.3 4.6a.5.5 0 0 1-.94 0zM20 2v4M22 4h-4M4 17v2M5 18H3" />
                      </svg>
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        letterSpacing: ".2em",
                        textTransform: "uppercase",
                        color: "#00B4D8",
                      }}
                    >
                      The add-on
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: "19px",
                      fontWeight: 800,
                      letterSpacing: "-.02em",
                      color: "#f8fafc",
                      lineHeight: 1.3,
                      textWrap: "pretty",
                    }}
                  >
                    Remediation fixes your tenant. This is how your people actually use it.
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignSelf: "flex-start",
                      alignItems: "center",
                      gap: "9px",
                      padding: "6px 13px",
                      border: "1px solid rgba(0,180,216,.34)",
                      borderRadius: "999px",
                      background: "linear-gradient(120deg,rgba(0,120,212,.14),rgba(139,92,246,.12))",
                    }}
                  >
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: "linear-gradient(135deg,#3B82F6,#00B4D8)",
                        flex: "none",
                      }}
                    />
                    <span
                      style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc", whiteSpace: "nowrap" }}
                    >
                      White-Glove Copilot Adoption
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: "12.5px",
                      color: "#94a3b8",
                      lineHeight: 1.7,
                      maxWidth: "70ch",
                      textWrap: "pretty",
                    }}
                  >
                    A pilot cohort, plain-language change comms written from your own findings, a daily prompt
                    drip in Teams, and live enablement sessions — measured on the same usage data that found
                    the gap.
                  </span>
                  <span style={{ fontSize: "11.5px", fontWeight: 600, color: "#22d3ee" }}>
                    See Copilot & AI →
                  </span>
                </span>

                <span
                  style={{
                    position: "relative",
                    flex: "0 1 240px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    justifyContent: "center",
                  }}
                >
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span
                      style={{
                        fontSize: "9.5px",
                        fontWeight: 700,
                        letterSpacing: ".2em",
                        textTransform: "uppercase",
                        color: "#64748b",
                      }}
                    >
                      Copilot readiness score
                    </span>
                    <span
                      style={{
                        fontSize: "56px",
                        fontWeight: 800,
                        letterSpacing: "-.05em",
                        lineHeight: 1,
                        color: "#f87171",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      41
                    </span>
                    <span
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 700,
                        letterSpacing: ".14em",
                        textTransform: "uppercase",
                        color: "#f87171",
                      }}
                    >
                      Not safe to deploy yet
                    </span>
                  </span>
                  <span style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.6, textWrap: "pretty" }}>
                    Copilot reads everything a user can reach. The six pillars decide what that is — the score
                    is what they add up to.
                  </span>
                </span>
              </a>
            </div>

            {/* Deep-dive chips */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "16px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "11px", color: "#64748b" }}>Go deeper by workload:</span>
              {DIVES.map((dv) => (
                <Link
                  key={dv.label}
                  href={dv.href}
                  className="sm-home-chip"
                  style={{
                    padding: "5px 11px",
                    borderRadius: "999px",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "#94a3b8",
                    border: "1px solid rgba(30,41,59,.9)",
                  }}
                >
                  {dv.label}
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ── The customer portal mock ─────────────────────────────────────────── */}
        <section
          style={{
            padding: "40px 32px 46px",
            background: "#050d1e",
            borderTop: "1px solid rgba(255,255,255,.05)",
            borderBottom: "1px solid rgba(255,255,255,.05)",
          }}
        >
          <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
            <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: "#a78bfa",
                }}
              >
                The customer portal
              </span>
              <h2
                style={{
                  fontSize: "24px",
                  fontWeight: 800,
                  letterSpacing: "-.025em",
                  color: "#f8fafc",
                  margin: "8px 0 10px",
                }}
              >
                Findings don’t go to a PDF. They go to work.
              </h2>
              <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
                Every customer — scan, monitoring, pack or retainer — lands in the same portal: remediation
                tracked to the finding it closes, changes with owners and rollback points, Microsoft’s own
                changes scored against your tenant, and an architect’s hours logged against real work.
              </p>
            </div>

            <div
              style={{
                border: "1px solid rgba(30,41,59,.95)",
                borderRadius: "18px",
                background: "#0b1524",
                overflow: "hidden",
                marginBottom: "18px",
              }}
            >
              {/* Browser chrome */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 16px",
                  borderBottom: "1px solid rgba(30,41,59,.9)",
                  background: "rgba(2,6,23,.5)",
                }}
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{ width: "9px", height: "9px", borderRadius: "999px", background: "rgba(148,163,184,.25)" }}
                  />
                ))}
                <span style={{ marginLeft: "8px", fontSize: "10.5px", color: "#475569", fontWeight: 600 }}>
                  portal.shanemccaw.com — your tenant, after onboarding
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "stretch", minHeight: "280px" }}>
                {/* Portal sidebar */}
                <div
                  style={{
                    width: "196px",
                    flex: "none",
                    borderRight: "1px solid rgba(30,41,59,.9)",
                    background: "rgba(2,6,23,.35)",
                    padding: "14px 10px",
                    flexDirection: "column",
                    gap: "2px",
                    display: "flex",
                  }}
                >
                  <PortalNavGroup label="Overview" />
                  <PortalNavItem label="Dashboard" active />
                  <PortalNavItem label="My Architect" />
                  <PortalNavGroup label="Operate" />
                  <PortalNavItem label="Projects" />
                  <PortalNavItem label="Change Control" />
                  <PortalNavItem label="Active Runbooks" />
                  <PortalNavItem label="Remediation Tracker" badge="3" badgeTone="good" />
                  <PortalNavItem label="Policy Decisions" />
                  <PortalNavGroup label="Governance" />
                  <PortalNavItem label="Ownership" />
                  <PortalNavItem label="Risk Register" />
                  <PortalNavItem label="PII Governance" />
                  <PortalNavGroup label="Reference" />
                  <PortalNavItem label="SOPs & Runbooks" />
                  <PortalNavItem label="Microsoft Changes" badge="2" badgeTone="urgent" />
                </div>

                {/* Portal main pane */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "18px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {PILLARS.map((p) => (
                      <span
                        key={p.name}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "7px",
                          padding: "6px 11px",
                          borderRadius: "999px",
                          border: "1px solid rgba(30,41,59,.9)",
                          background: "rgba(2,6,23,.35)",
                        }}
                      >
                        {pillarTile(p.name, p.color, 18, 5, 11)}
                        <span style={{ fontSize: "10.5px", fontWeight: 600, color: "#94a3b8" }}>{p.name}</span>
                        <b
                          style={{
                            fontSize: "11px",
                            fontWeight: 800,
                            color: "#e2e8f0",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {p.score}
                        </b>
                      </span>
                    ))}
                  </div>

                  {/* Live alert card */}
                  <div
                    style={{
                      border: "1px solid rgba(248,113,113,.3)",
                      borderRadius: "11px",
                      background: "rgba(248,113,113,.06)",
                      padding: "12px 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{ width: "7px", height: "7px", borderRadius: "999px", background: "#f87171", flex: "none" }}
                    />
                    <div style={{ flex: 1, minWidth: "200px" }}>
                      <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>
                        An OAuth app was granted full mailbox access without review
                      </div>
                      <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
                        Detected 22 minutes ago by the Security engine — no change request exists for this grant.
                      </div>
                    </div>
                    <span
                      style={{
                        flex: "none",
                        padding: "7px 12px",
                        borderRadius: "8px",
                        fontSize: "11px",
                        fontWeight: 700,
                        color: "#fff",
                        background: GRADIENT_CTA,
                      }}
                    >
                      Open the runbook
                    </span>
                  </div>

                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      letterSpacing: ".14em",
                      textTransform: "uppercase",
                      color: "#64748b",
                    }}
                  >
                    This week in your tenant
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                    {WEEK_ROWS.map((wk) => (
                      <div
                        key={wk.mod}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          padding: "10px 12px",
                          border: "1px solid rgba(30,41,59,.9)",
                          borderRadius: "10px",
                          background: "rgba(2,6,23,.35)",
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ flex: "none", fontSize: "10.5px", fontWeight: 700, color: wk.fg }}>
                          {wk.mod}
                        </span>
                        <span
                          style={{
                            flex: 1,
                            minWidth: "200px",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "#e2e8f0",
                          }}
                        >
                          {wk.what}
                        </span>
                        <span style={{ flex: "none", fontSize: "11px", color: "#94a3b8" }}>{wk.meta}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "14px",
                flexWrap: "wrap",
              }}
            >
              <a
                href="/portal"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "11px 20px",
                  borderRadius: "10px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  color: "#fff",
                  background: GRADIENT_CTA,
                  whiteSpace: "nowrap",
                }}
              >
                Tour the Portal {arrowIcon(14)}
              </a>
              <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                The demo is the real interface with an illustrative tenant loaded — click anything.
              </span>
            </div>
          </div>
        </section>

        {/* ── Four ways in ─────────────────────────────────────────────────────── */}
        <section style={{ padding: "44px 32px 50px" }}>
          <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
            <div style={{ maxWidth: "680px", marginBottom: "24px" }}>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: "#60a5fa",
                }}
              >
                Four ways in
              </span>
              <h2
                style={{
                  fontSize: "24px",
                  fontWeight: 800,
                  letterSpacing: "-.025em",
                  color: "#f8fafc",
                  margin: "8px 0 10px",
                }}
              >
                Start anywhere. It all converges on the same way of working.
              </h2>
              <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
                A free scan, continuous monitoring, a named architect, or a one-off fixed-price pack — every
                door leads to the same portal, the same pillars, and project work priced before it starts.
              </p>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
              {DOORS.map((d) => {
                const isScan = d.key === "scan";
                return (
                  <Link
                    key={d.key}
                    href={d.href}
                    className="sm-home-card"
                    style={{
                      ["--hb" as string]: "rgba(59,130,246,.4)",
                      flex: "1 1 230px",
                      minHeight: "220px",
                      display: "flex",
                      flexDirection: "column",
                      padding: "19px",
                      borderRadius: "15px",
                      background: "#0b1524",
                      border: `1px solid ${isScan ? "rgba(59,130,246,.35)" : "rgba(30,41,59,.9)"}`,
                    } as React.CSSProperties}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "10px",
                        marginBottom: "12px",
                      }}
                    >
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
                        {doorIcon(d.key)}
                      </span>
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: ".13em",
                          color: isScan ? "#60a5fa" : "#64748b",
                          background: isScan ? "rgba(59,130,246,.1)" : "rgba(71,85,105,.14)",
                          border: `1px solid ${isScan ? "rgba(59,130,246,.3)" : "rgba(71,85,105,.3)"}`,
                          borderRadius: "999px",
                          padding: "3px 8px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {d.tag}
                      </span>
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: "15px",
                        fontWeight: 700,
                        color: "#f8fafc",
                        marginBottom: "3px",
                      }}
                    >
                      {d.name}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: d.price === "Free" ? "#34d399" : "#cbd5e1",
                        marginBottom: "9px",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {d.price}
                    </span>
                    <span
                      style={{ display: "block", fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.55, flexGrow: 1 }}
                    >
                      {d.body}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: "11.5px",
                        fontWeight: 600,
                        color: "#60a5fa",
                        marginTop: "12px",
                      }}
                    >
                      {d.next}
                    </span>
                  </Link>
                );
              })}
            </div>

            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "9px", padding: "16px 0 0" }}
            >
              <span
                style={{
                  height: "1px",
                  flex: 1,
                  maxWidth: "160px",
                  background: "linear-gradient(90deg,rgba(2,6,23,0),rgba(59,130,246,.5))",
                }}
              />
              <Link
                href="/pricing"
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: ".14em",
                  color: "#60a5fa",
                  whiteSpace: "nowrap",
                }}
              >
                See the full pricing model →
              </Link>
              <span
                style={{
                  height: "1px",
                  flex: 1,
                  maxWidth: "160px",
                  background: "linear-gradient(90deg,rgba(59,130,246,.5),rgba(2,6,23,0))",
                }}
              />
            </div>
          </div>
        </section>

        {/* ── From Scan to Scoped Work ─────────────────────────────────────────── */}
        <section style={{ padding: "32px 32px 56px", borderTop: "1px solid rgba(255,255,255,.06)" }}>
          <div style={{ maxWidth: "760px", margin: "0 auto 26px", textAlign: "center" }}>
            <h2
              style={{
                fontSize: "19px",
                fontWeight: 700,
                color: "#f8fafc",
                margin: "0 0 10px",
                letterSpacing: "-.02em",
              }}
            >
              From Scan to Scoped Work
            </h2>
            <p style={{ color: "#94a3b8", lineHeight: 1.7, margin: 0, fontSize: "13px" }}>
              The scan reads your actual tenant. Findings become a scoped, priced statement of work — phases
              you keep, defer or drop — and everything you buy runs through the portal above.
            </p>
          </div>

          <div
            style={{
              maxWidth: "980px",
              margin: "0 auto",
              display: "flex",
              alignItems: "stretch",
              justifyContent: "center",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            {STEPS.map((s) => (
              <div key={s.n} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "210px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    padding: "16px",
                    borderRadius: "14px",
                    background: "#0b1524",
                    border: `1px solid ${s.hot ? "rgba(59,130,246,.45)" : "rgba(30,41,59,.9)"}`,
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
                      ...(s.hot
                        ? {
                            background: "rgba(59,130,246,.15)",
                            border: "1px solid rgba(59,130,246,.4)",
                            color: "#60a5fa",
                          }
                        : {
                            background: "rgba(255,255,255,.05)",
                            border: "1px solid rgba(255,255,255,.1)",
                            color: "#94a3b8",
                          }),
                    }}
                  >
                    {s.n}
                  </span>
                  <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>{s.title}</span>
                  <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>{s.body}</span>
                </div>
                {s.arrow ? (
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="#475569"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="4" y1="12" x2="20" y2="12" />
                    <polyline points="14 6 20 12 14 18" />
                  </svg>
                ) : null}
              </div>
            ))}
          </div>

          <div style={{ textAlign: "center", marginTop: "26px" }}>
            <Link
              href="/scan"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "13px 26px",
                borderRadius: "11px",
                fontWeight: 700,
                fontSize: "14px",
                color: "#fff",
                background: GRADIENT_CTA,
                whiteSpace: "nowrap",
              }}
            >
              Scan My Tenant · Free {arrowIcon()}
            </Link>
            <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "10px" }}>
              Read-only. No agent, no charge, and the findings are yours either way.
            </div>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}

// A muted section label in the portal-mock sidebar (Overview / Operate / Governance / Reference).
function PortalNavGroup({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: "9px",
        fontWeight: 700,
        letterSpacing: ".16em",
        textTransform: "uppercase",
        color: "#475569",
        padding: "9px 8px 6px",
      }}
    >
      {label}
    </span>
  );
}

// A single portal-mock sidebar link. `active` paints the Dashboard row; `badge` renders the
// small count pill (good/urgent tone) some items carry.
function PortalNavItem({
  label,
  active,
  badge,
  badgeTone,
}: {
  label: string;
  active?: boolean;
  badge?: string;
  badgeTone?: "good" | "urgent";
}) {
  return (
    <span
      style={{
        padding: "6px 8px",
        borderRadius: "7px",
        fontSize: "11.5px",
        fontWeight: active ? 700 : 600,
        color: active ? "#f8fafc" : "#94a3b8",
        ...(active
          ? { background: "rgba(59,130,246,.14)", border: "1px solid rgba(59,130,246,.3)" }
          : null),
      }}
    >
      {label}
      {badge ? (
        <span
          style={{
            display: "inline-flex",
            marginLeft: "4px",
            padding: "1px 6px",
            borderRadius: "999px",
            fontSize: "9px",
            fontWeight: 800,
            ...(badgeTone === "urgent"
              ? {
                  background: "rgba(248,113,113,.15)",
                  border: "1px solid rgba(248,113,113,.4)",
                  color: "#f87171",
                }
              : {
                  background: "rgba(52,211,153,.12)",
                  border: "1px solid rgba(52,211,153,.35)",
                  color: "#34d399",
                }),
          }}
        >
          {badge}
        </span>
      ) : null}
    </span>
  );
}
