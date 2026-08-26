import React, { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ShieldCheck,
  Lock,
  Scale,
  CircleDollarSign,
  Users,
  Activity,
  Search,
  SearchX,
  ArrowRight,
} from "lucide-react";
import { MarketingLayout } from "../components/MarketingLayout";
import { buildSiteIndex } from "../../data/siteIndex";
import { useCatalog, type MonitoringTier } from "../../hooks/useCatalog";
import { useSignalCheckCount } from "../../hooks/useSignalCheckCount";
import { PACKS } from "../data/quickStartPacks";

// Route /* catch-all — recreated from Design/404-export/Marketing 404.dc.html (Git #1318).
// Copy for the H1 and good-news/bad-news subhead is fixed per the handoff; do not reword it.
// Nothing on this page depends on auth or an API call to render — search and navigation are
// client-side, and it must render fully even if the backend is down. Only "Report this broken
// link" touches the network, and it's fire-and-forget: the confirmation shows regardless of
// whether that call actually lands.

const READOUT: { label: string; icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>; color: string; ok: boolean }[] = [
  { label: "Governance", icon: ShieldCheck, color: "#3b82f6", ok: true },
  { label: "Security", icon: Lock, color: "#8b5cf6", ok: true },
  { label: "Compliance", icon: Scale, color: "#e2e8f0", ok: true },
  { label: "Licensing", icon: CircleDollarSign, color: "#14b8a6", ok: true },
  { label: "Adoption", icon: Users, color: "#f97316", ok: true },
  { label: "Health", icon: Activity, color: "#22c55e", ok: true },
];

// Live pricing — byte-identical formula to Pricing.tsx's own ppuOf/floorOf/surchargeOf/money
// (the only function that computes an actual monitoring Stripe charge), so this figure can never
// drift from what /pricing and /monitoring show. Quick-Start's floor reads the same fixture
// Pricing.tsx's QUICK_START_MIN derives from, per the Git #1305/#1351 no-hardcoded-price rule.
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

const QUICK_START_MIN = Math.min(...PACKS.map((p) => p.price));

const PILLS: { label: string; href: string }[] = [
  { label: "Copilot readiness", href: "/solutions/copilot" },
  { label: "MFA gaps", href: "/pillars/security" },
  { label: "Licence waste", href: "/pillars/licensing" },
  { label: "Guest access", href: "/pillars/security" },
  { label: "Oversharing", href: "/solutions/sharepoint" },
  { label: "Tenant migration", href: "/solutions/migration" },
  { label: "Retainers", href: "/retainers" },
];

function tile(color: string, size: number): React.CSSProperties {
  return {
    flex: "none",
    width: size,
    height: size,
    borderRadius: 9,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: `${color}1A`,
    border: `1px solid ${color}33`,
  };
}

function destTestId(href: string): string {
  return `link-404-dest-${href.replace(/^\//, "").replace(/\//g, "-")}`;
}

const destCard: React.CSSProperties = {
  display: "flex",
  gap: 12,
  padding: "15px 16px",
  borderRadius: 14,
  background: "#0b1524",
  border: "1px solid rgba(30,41,59,.9)",
  transition: "border-color .2s,background .2s",
  textDecoration: "none",
};

export default function NotFound() {
  const [location] = useLocation();
  const [query, setQuery] = useState("");
  const [reportState, setReportState] = useState<"idle" | "sent">("idle");
  const { monitoringTiers, loading: monLoading } = useCatalog();
  const checkCount = useSignalCheckCount();
  const SITE_INDEX = useMemo(() => buildSiteIndex(checkCount), [checkCount]);

  const cheapestMonitoringPrice = (() => {
    let min: number | null = null;
    monitoringTiers.forEach((row) => {
      const p = ppuOf(row) * floorOf(row) + surchargeOf(row);
      if (min === null || p < min) min = p;
    });
    return min;
  })();
  const monitoringMetaLabel = monLoading
    ? "…"
    : cheapestMonitoringPrice != null
      ? `From ${money(cheapestMonitoringPrice)}/mo`
      : "…";

  const COMMON: { tag: string; label: string; meta: string; href: string }[] = [
    { tag: "Start here", label: "Free tenant scan", meta: "Read-only · 12 minutes", href: "/scan" },
    { tag: "Pricing", label: "Every price on one page", meta: `From $${QUICK_START_MIN}`, href: "/pricing" },
    { tag: "Quick fix", label: "Quick-Start Packs", meta: "Fixed price", href: "/quick-start" },
    { tag: "Ongoing", label: "Tenant monitoring", meta: monitoringMetaLabel, href: "/monitoring" },
  ];

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return SITE_INDEX;
    return SITE_INDEX.filter((d) =>
      `${d.label} ${d.blurb} ${d.keys}`.toLowerCase().includes(q),
    );
  }, [q, SITE_INDEX]);

  const empty = q.length > 0 && results.length === 0;
  const countLabel = q
    ? `${results.length} ${results.length === 1 ? "match" : "matches"}`
    : `${SITE_INDEX.length} pages`;
  const resultsTitle = q ? "Matching pages" : "Where do you actually want to go?";

  function reportBrokenLink() {
    setReportState("sent");
    fetch("/api/public/broken-link-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptedPath: location,
        referrer: document.referrer || null,
      }),
    }).catch(() => {
      // Fire-and-forget — the confirmation above already reflects intent, not delivery.
    });
  }

  return (
    <MarketingLayout current="none">
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "52px 32px 34px",
          background:
            "radial-gradient(circle 1100px at 78% -22%, rgba(139,92,246,.13), rgba(2,6,23,0) 62%), radial-gradient(circle 820px at 4% 10%, rgba(0,120,212,.09), rgba(2,6,23,0) 66%)",
        }}
      >
        <span
          style={{
            position: "absolute",
            right: -70,
            top: "52%",
            transform: "translateY(-50%)",
            opacity: 0.09,
            pointerEvents: "none",
            lineHeight: 0,
            filter: "drop-shadow(0 0 26px rgba(139,92,246,.35))",
          }}
        >
          <SearchX size={460} color="#a78bfa" strokeWidth={0.8} />
        </span>
        <div
          style={{
            maxWidth: 1120,
            margin: "0 auto",
            display: "flex",
            gap: 46,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1.15 1 400px", minWidth: 0 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 12px",
                borderRadius: 999,
                background: "rgba(139,92,246,.1)",
                border: "1px solid rgba(139,92,246,.28)",
                color: "#a78bfa",
                fontSize: "10.5px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".1em",
                marginBottom: 18,
              }}
            >
              <span
                className="animate-pulse"
                style={{ width: 6, height: 6, borderRadius: 999, background: "#a78bfa" }}
              />
              Error 404 &middot; Page not found
            </span>
            <h1
              style={{
                fontSize: "clamp(30px,3.4vw,42px)",
                fontWeight: 800,
                letterSpacing: "-.03em",
                lineHeight: 1.1,
                color: "#f8fafc",
                margin: "0 0 18px",
                textWrap: "pretty",
              }}
            >
              This page ran off to go check a compliance score.
            </h1>
            <p style={{ fontSize: 17, color: "#cbd5e1", lineHeight: 1.6, margin: "0 0 10px", fontWeight: 600 }}>
              Good news: your tenant&rsquo;s fine.
            </p>
            <p style={{ fontSize: 17, color: "#cbd5e1", lineHeight: 1.6, margin: "0 0 20px", fontWeight: 600 }}>
              Bad news: this page isn&rsquo;t.
            </p>
            <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.7, margin: "0 0 24px", maxWidth: "56ch" }}>
              Either the URL moved, the link was old, or something got renamed during a cleanup.
              Search below, or jump straight to the thing you were probably after.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link
                href="/scan"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "12px 22px",
                  borderRadius: 10,
                  fontWeight: 700,
                  fontSize: "13.5px",
                  color: "#fff",
                  background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
                  whiteSpace: "nowrap",
                }}
              >
                Scan My Tenant &middot; Free <ArrowRight size={15} strokeWidth={1.8} />
              </Link>
              <Link
                href="/"
                style={{
                  padding: "12px 22px",
                  borderRadius: 10,
                  fontWeight: 600,
                  fontSize: "13.5px",
                  color: "#cbd5e1",
                  border: "1px solid rgba(148,163,184,.2)",
                  whiteSpace: "nowrap",
                }}
              >
                Back to the homepage
              </Link>
            </div>
          </div>

          <div
            style={{
              flex: "1 1 360px",
              maxWidth: 470,
              border: "1px solid rgba(139,92,246,.22)",
              borderRadius: 18,
              background:
                "linear-gradient(160deg,rgba(139,92,246,.10),rgba(11,21,36,.52) 55%,rgba(11,21,36,.34))",
              backdropFilter: "blur(3px)",
              boxShadow: "0 0 60px rgba(139,92,246,.13), inset 0 1px 0 rgba(148,163,184,.08)",
              padding: "18px 20px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                paddingBottom: 12,
                borderBottom: "1px solid rgba(148,163,184,.12)",
              }}
            >
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#94a3b8" }}>
                Diagnostic readout
              </span>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#f87171" }}>
                1 failure
              </span>
            </div>
            {READOUT.map((r) => (
              <div
                key={r.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "9px 0",
                  borderBottom: "1px solid rgba(148,163,184,.07)",
                }}
              >
                <span style={tile(r.color, 26)}>
                  <r.icon size={15} color={r.color} strokeWidth={2} />
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", fontWeight: 600, color: "#cbd5e1" }}>
                  {r.label}
                </span>
                <span
                  style={{
                    flex: "none",
                    padding: "3px 9px",
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    background: "rgba(52,211,153,.12)",
                    border: "1px solid rgba(52,211,153,.28)",
                    color: "#34d399",
                  }}
                >
                  Pass
                </span>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "9px 0",
                borderBottom: "1px solid rgba(148,163,184,.07)",
              }}
            >
              <span style={tile("#f87171", 26)}>
                <Search size={15} color="#f87171" strokeWidth={2} />
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", fontWeight: 600, color: "#cbd5e1" }}>
                This page
              </span>
              <span
                style={{
                  flex: "none",
                  padding: "3px 9px",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  background: "rgba(248,113,113,.14)",
                  border: "1px solid rgba(248,113,113,.34)",
                  color: "#f87171",
                }}
              >
                404
              </span>
            </div>
            <p style={{ margin: "12px 0 0", fontSize: "11.5px", color: "#64748b", lineHeight: 1.6 }}>
              Six pillars green. One URL red. We fix the first kind for a living; the second kind,
              we just apologise for.
            </p>
          </div>
        </div>
      </section>

      <section style={{ padding: "12px 32px 6px", background: "linear-gradient(180deg,rgba(2,6,23,0),rgba(11,21,36,.5))" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px",
              borderRadius: 14,
              background: "#0b1524",
              border: "1px solid rgba(30,41,59,.9)",
            }}
          >
            <Search size={17} color="#60a5fa" strokeWidth={2} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the site — pillars, packs, pricing, Copilot, migration…"
              data-testid="input-404-search"
              style={{
                flex: 1,
                minWidth: 0,
                background: "transparent",
                border: "none",
                color: "#f8fafc",
                fontFamily: "inherit",
                fontSize: 14,
                fontWeight: 500,
                outline: "none",
              }}
            />
            <span
              data-testid="text-404-match-count"
              style={{ fontSize: 11, fontWeight: 600, color: "#64748b", whiteSpace: "nowrap" }}
            >
              {countLabel}
            </span>
          </div>
        </div>
      </section>

      <section style={{ padding: "22px 32px 40px", background: "rgba(11,21,36,.5)" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 14,
            }}
          >
            <h2 style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.02em", color: "#f8fafc", margin: 0 }}>
              {resultsTitle}
            </h2>
            <span style={{ fontSize: 12, color: "#64748b" }}>Everything on this site, one click away</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(258px,1fr))", gap: 12 }}>
            {results.map((d) => (
              <Link
                key={d.href}
                href={d.href}
                className="sm404-dest"
                style={destCard}
                data-testid={destTestId(d.href)}
              >
                <span style={tile(d.color, 34)}>
                  <d.icon size={20} color={d.color} strokeWidth={2} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#f8fafc" }}>{d.label}</span>
                  <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55 }}>{d.blurb}</span>
                </span>
              </Link>
            ))}
          </div>
          {empty && (
            <div
              data-testid="text-404-empty-state"
              style={{
                padding: 22,
                borderRadius: 14,
                background: "#0b1524",
                border: "1px dashed rgba(148,163,184,.22)",
                textAlign: "center",
              }}
            >
              <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>
                Nothing matched &ldquo;{query}&rdquo;.
              </p>
              <p style={{ margin: 0, fontSize: "12.5px", color: "#94a3b8" }}>
                Two 404s in one visit is impressive. Try &ldquo;Copilot&rdquo;, &ldquo;licensing&rdquo; or
                &ldquo;pricing&rdquo; &mdash; or just{" "}
                <Link href="/scan" style={{ color: "#60a5fa", fontWeight: 700 }}>
                  run the free scan
                </Link>
                .
              </p>
            </div>
          )}
        </div>
      </section>

      <section style={{ padding: "34px 32px 44px", background: "linear-gradient(180deg,rgba(11,21,36,.5),rgba(2,6,23,0))" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", display: "flex", gap: 40, flexWrap: "wrap" }}>
          <div style={{ flex: "1.3 1 420px", minWidth: 0 }}>
            <h2 style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.02em", color: "#f8fafc", margin: "0 0 4px" }}>
              Most people who land here wanted one of these
            </h2>
            <p style={{ fontSize: "12.5px", color: "#64748b", margin: "0 0 16px" }}>
              The four pages that get linked to most often from outside the site.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {COMMON.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  className="sm404-dest"
                  data-testid={`link-404-common-${c.href.replace(/^\//, "").replace(/\//g, "-")}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 16px",
                    borderRadius: 12,
                    background: "#0b1524",
                    border: "1px solid rgba(30,41,59,.9)",
                    transition: "border-color .2s,background .2s",
                    textDecoration: "none",
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "#475569", width: 74, flex: "none" }}>
                    {c.tag}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: "13.5px", fontWeight: 700, color: "#f8fafc" }}>{c.label}</span>
                  <span
                    data-testid={`text-404-common-meta-${c.href.replace(/^\//, "").replace(/\//g, "-")}`}
                    style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}
                  >
                    {c.meta}
                  </span>
                  <ArrowRight size={15} color="#60a5fa" strokeWidth={2} style={{ flex: "none" }} />
                </Link>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              {PILLS.map((p) => (
                <Link
                  key={p.label}
                  href={p.href}
                  className="sm404-pill"
                  style={{
                    padding: "7px 13px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#94a3b8",
                    border: "1px solid rgba(148,163,184,.18)",
                    transition: "border-color .2s,color .2s",
                    whiteSpace: "nowrap",
                    textDecoration: "none",
                  }}
                >
                  {p.label}
                </Link>
              ))}
            </div>
          </div>

          <div style={{ flex: "1 1 300px", maxWidth: 400, display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                padding: "18px 20px",
                borderRadius: 16,
                background: "linear-gradient(160deg,rgba(59,130,246,.12),rgba(11,21,36,.5))",
                border: "1px solid rgba(59,130,246,.24)",
              }}
            >
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#60a5fa" }}>
                Still stuck
              </span>
              <p style={{ margin: "8px 0 14px", fontSize: 13, color: "#cbd5e1", lineHeight: 1.65 }}>
                Tell us what you were looking for and where you clicked from. Broken links get
                fixed the same week, and you get the page you wanted by reply.
              </p>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
                {reportState === "idle" ? (
                  <button
                    type="button"
                    onClick={reportBrokenLink}
                    data-testid="button-report-broken-link"
                    style={{
                      padding: "10px 16px",
                      borderRadius: 9,
                      fontSize: "12.5px",
                      fontWeight: 700,
                      color: "#fff",
                      background: "#2563eb",
                      whiteSpace: "nowrap",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    Report this broken link
                  </button>
                ) : (
                  <span
                    data-testid="text-report-broken-link-confirmation"
                    style={{ fontSize: "12.5px", fontWeight: 700, color: "#34d399" }}
                  >
                    Thanks &mdash; logged. We&rsquo;ll take a look.
                  </span>
                )}
                <Link
                  href="/pricing"
                  style={{
                    padding: "10px 16px",
                    borderRadius: 9,
                    fontSize: "12.5px",
                    fontWeight: 600,
                    color: "#cbd5e1",
                    border: "1px solid rgba(148,163,184,.2)",
                    whiteSpace: "nowrap",
                  }}
                >
                  See all pricing
                </Link>
              </div>
            </div>
            <div style={{ padding: "16px 20px", borderRadius: 16, background: "#0b1524", border: "1px solid rgba(30,41,59,.9)" }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#475569" }}>
                Requested URL
              </span>
              <p
                data-testid="text-requested-url"
                style={{ margin: "8px 0 0", fontFamily: "Menlo,ui-monospace,monospace", fontSize: 12, color: "#94a3b8", wordBreak: "break-all" }}
              >
                {location}
              </p>
              <p style={{ margin: "10px 0 0", fontSize: "11.5px", color: "#64748b", lineHeight: 1.6 }}>
                Logged. No, really &mdash; we monitor our own tenant too. It would be embarrassing
                not to.
              </p>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
