import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { MarketingLayout } from "../components/MarketingLayout";
import { COVERS, PACKS, PACKS_BY_KEY, PACK_GROUPS, type PackIcon } from "../data/quickStartPacks";
import { useQuickStartPackAvailability } from "../../hooks/useQuickStartPackAvailability";

// Route /quick-start — recreated from Marketing Quick-Start Packs.dc.html.
// Part 7: real content replaces the Part 0 PageStub. Pricing verified live against the
// `services` table (see quickStartPacks.ts header) rather than trusted from the prototype as-is.

function fmtPrice(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

// Byte-identical to Pricing.tsx's own QUICK_START_MIN/MAX — same fixture, so this page can never
// drift from /pricing's Quick-Start range even if a pack price changes.
const QUICK_START_MIN = Math.min(...PACKS.map((p) => p.price));
const QUICK_START_MAX = Math.max(...PACKS.map((p) => p.price));

// Icon glyphs ported from the design's own ICONS map (Marketing Quick-Start Packs.dc.html) —
// same 24x24 stroke paths, translated from React.createElement to JSX. Page-scoped, same
// granularity as Nav.tsx's own inline pillar icons.
function Glyph({ name, size = 17 }: { name: PackIcon; size?: number }) {
  const common = {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z" />
        </svg>
      );
    case "shieldCheck":
      return (
        <svg {...common}>
          <path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      );
    case "key":
      return (
        <svg {...common}>
          <circle cx="8" cy="15" r="4" />
          <path d="M11 12l9-9" />
          <path d="M17 6l3 3" />
        </svg>
      );
    case "badge":
      return (
        <svg {...common}>
          <circle cx="12" cy="9" r="5" />
          <path d="M8 14l-2 7 6-3 6 3-2-7" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common}>
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 018 0v3" />
        </svg>
      );
    case "broom":
      return (
        <svg {...common}>
          <path d="M15 4l5 5" />
          <path d="M13 7l-9 9-1 5 5-1 9-9" />
          <path d="M9 12l3 3" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
        </svg>
      );
    case "userMinus":
      return (
        <svg {...common}>
          <circle cx="10" cy="8" r="4" />
          <path d="M2 21c0-4 4-6 8-6" />
          <line x1="16" y1="14" x2="22" y2="14" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 4l9 16H3z" />
          <line x1="12" y1="10" x2="12" y2="14" />
        </svg>
      );
    case "laptop":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="12" rx="2" />
          <line x1="2" y1="20" x2="22" y2="20" />
        </svg>
      );
    case "mail":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 6 9-6" />
        </svg>
      );
    case "share":
      return (
        <svg {...common}>
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="18" r="2.5" />
          <path d="M8.2 10.8l7.6-3.6" />
          <path d="M8.2 13.2l7.6 3.6" />
        </svg>
      );
    case "card":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <line x1="3" y1="11" x2="21" y2="11" />
        </svg>
      );
    case "brain":
      return (
        <svg {...common}>
          <path d="M9 4a3 3 0 00-3 3 3 3 0 000 6 3 3 0 003 3" />
          <path d="M15 4a3 3 0 013 3 3 3 0 010 6 3 3 0 01-3 3" />
          <line x1="12" y1="4" x2="12" y2="20" />
        </svg>
      );
  }
}

const HOW_IT_WORKS = [
  {
    n: "1",
    label: "Grant Consent",
    desc: "You approve a scoped Microsoft 365 admin consent request through the standard OAuth flow — no shared credentials.",
  },
  {
    n: "2",
    label: "We Read Your Tenant",
    desc: "The moment consent lands, we connect through Graph and read your tenant's current configuration.",
  },
  {
    n: "3",
    label: "See the Exact Scope",
    desc: "The Portal shows every change the pack intends to make as a dry run. You can deselect any of it.",
  },
  {
    n: "4",
    label: "Execute the Pack",
    desc: "The pack runs as a real Workflow Engine execution, applying each approved action in order.",
  },
];

const PORTAL_MODULES: { name: string; tier: string; body: string }[] = [
  {
    name: "Dry run & approval",
    tier: "Every pack",
    body: "Every intended change listed before anything moves — approve, deselect, or walk away with the read intact.",
  },
  {
    name: "Execution log",
    tier: "Every pack",
    body: "Each action applied in order by the Workflow Engine, timestamped, with the result recorded against the plan.",
  },
  {
    name: "Change register entry",
    tier: "Every pack",
    body: "The run lands in the register with a rollback point — a pack is a change, and it's treated like one.",
  },
  {
    name: "Signal-triggered packs",
    tier: "After a scan",
    body: "Generated from your real scan findings and checked out from inside the Portal — the pack your tenant actually asked for.",
  },
];

// Illustrative dry-run mock for the hero card — the design's own worked example (Entra ID
// Quick-Start Pack), not live data. README: the real dry run is a Portal screen, post-payment.
const HERO_DRY_RUN: { name: string; state: string; tone: "run" | "skip" | "off" }[] = [
  { name: "Break-glass emergency access account", state: "Will create", tone: "run" },
  { name: "Conditional Access baseline", state: "Will create 6 policies", tone: "run" },
  { name: "PIM eligibility rules", state: "Will convert 4 standing admins", tone: "run" },
  { name: "Security defaults", state: "Already configured · no change", tone: "skip" },
  { name: "Tenant branding", state: "Deselected by you", tone: "off" },
  { name: "Guest access restriction", state: "Will restrict", tone: "run" },
  { name: "Group naming policy", state: "Will enforce", tone: "run" },
];

function HeroDryRunRow({ row }: { row: (typeof HERO_DRY_RUN)[number] }) {
  const dim = row.tone === "off";
  const markStyle: React.CSSProperties =
    row.tone === "run"
      ? { background: "rgba(52,211,153,.1)", border: "1px solid rgba(52,211,153,.35)", color: "#34d399" }
      : row.tone === "skip"
        ? { background: "rgba(148,163,184,.07)", border: "1px solid rgba(148,163,184,.25)", color: "#64748b" }
        : { background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.3)", color: "#fbbf24" };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "9px 11px",
        borderRadius: "10px",
        border: dim ? "1px solid rgba(30,41,59,.6)" : "1px solid rgba(30,41,59,.9)",
        background: dim ? "rgba(2,6,23,.2)" : "rgba(2,6,23,.35)",
        opacity: dim ? 0.75 : 1,
      }}
    >
      <span
        style={{
          flex: "none",
          width: "18px",
          height: "18px",
          borderRadius: "6px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "11px",
          ...markStyle,
        }}
      >
        {row.tone === "run" ? "✓" : row.tone === "skip" ? "–" : "×"}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: "12px", fontWeight: 600, color: dim ? "#64748b" : "#e2e8f0" }}>
        {row.name}
      </span>
      <span
        style={{
          flex: "none",
          whiteSpace: "nowrap",
          fontSize: "10px",
          fontWeight: 700,
          color: row.tone === "run" ? "#34d399" : row.tone === "skip" ? "#64748b" : "#fbbf24",
        }}
      >
        {row.state}
      </span>
    </div>
  );
}

const sectionEyebrow: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "#60a5fa",
};

const sectionH2: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 800,
  letterSpacing: "-.025em",
  color: "#f8fafc",
  margin: "8px 0 10px",
};

export default function QuickStart() {
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const { availableKeys, loading: catalogLoading } = useQuickStartPackAvailability();

  const toggle = (key: string) => {
    if (!catalogLoading && !availableKeys.has(key)) return;
    setSel((s) => {
      const next = { ...s };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  const selKeys = Object.keys(sel);
  const selPacks = useMemo(() => selKeys.map((k) => PACKS_BY_KEY[k]).filter(Boolean), [selKeys.join(",")]);
  const rawTotal = selPacks.reduce((a, p) => a + p.price, 0);

  const overlaps = useMemo(() => {
    const covered: { text: string; key: string }[] = [];
    selKeys.forEach((k) => {
      const inc = (COVERS[k] || []).filter((x) => sel[x]);
      inc.forEach((x) =>
        covered.push({
          text: `${PACKS_BY_KEY[x].name} is already delivered inside ${PACKS_BY_KEY[k].name} — remove it and keep the same outcome.`,
          key: x,
        }),
      );
      if (k !== "breakglass" && sel.breakglass) {
        covered.push({
          text: `Break-Glass Access is included with ${PACKS_BY_KEY[k].name} — you only need it on its own.`,
          key: "breakglass",
        });
      }
    });
    const seen: Record<string, boolean> = {};
    return covered.filter((c) => {
      if (seen[c.key]) return false;
      seen[c.key] = true;
      return true;
    });
  }, [selKeys.join(","), sel.breakglass]);

  const hasSel = selKeys.length > 0;
  const selCountLabel = selKeys.length === 1 ? "1 pack selected" : `${selKeys.length} packs selected`;
  const buyLabel = selKeys.length > 1 ? `Buy ${selKeys.length} packs` : "Buy this pack";
  const buyHref =
    selKeys.length === 1
      ? `/buy?product=pack&tier=${selKeys[0]}`
      : `/buy?product=pack&packs=${selKeys.join(",")}`;

  return (
    <MarketingLayout current="quickstart">
      {/* HERO */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "48px 32px 30px",
          background:
            "radial-gradient(circle 1100px at 78% -20%, rgba(0,120,212,.13), rgba(2,6,23,0) 62%), radial-gradient(circle 820px at 6% 14%, rgba(139,92,246,.08), rgba(2,6,23,0) 66%)",
        }}
      >
        <span
          style={{
            position: "absolute",
            right: "-70px",
            top: "50%",
            transform: "translateY(-50%)",
            opacity: 0.11,
            pointerEvents: "none",
            lineHeight: 0,
            filter: "drop-shadow(0 0 26px rgba(0,120,212,.30))",
          }}
        >
          <svg width="520" height="520" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v3M12 19v3M4.2 4.2l2.2 2.2M17.6 17.6l2.2 2.2M2 12h3M19 12h3M4.2 19.8l2.2-2.2M17.6 6.4l2.2-2.2" />
            <circle cx="12" cy="12" r="6.2" />
            <path d="M12.9 8.6l-2.1 3.1h2.6l-2.3 3.7" />
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
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8l9-5 9 5-9 5-9-5z" />
                <path d="M3 8v9l9 5 9-5V8" />
              </svg>{" "}
              Quick-Start Packs · Fixed Price
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
              Fixed scope, fixed price — and you approve every change before it runs.
            </h1>
            <p style={{ fontSize: "15px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 12px", maxWidth: "54ch" }}>
              Most configuration work starts as an open-ended engagement: a discovery call, a
              scoping document, a rate that can move once work begins. A Quick-Start Pack is the
              opposite — a pre-built bundle of baseline actions, priced on the card, applied
              through the same Graph write-back engine behind our Monitoring platform's
              remediation.
            </p>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.7, margin: "0 0 24px", maxWidth: "54ch" }}>
              The panel alongside is what a pack looks like after payment: a dry run in the
              Portal, every change deselectable, nothing applied until you press Execute.
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "22px" }}>
              <a
                href="#packs"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "12px 22px",
                  borderRadius: "10px",
                  fontWeight: 700,
                  fontSize: "13.5px",
                  color: "#fff",
                  background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
                  whiteSpace: "nowrap",
                }}
              >
                Browse the Fifteen Packs
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <polyline points="14 6 20 12 14 18" />
                </svg>
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
              {[`Priced $${QUICK_START_MIN}–$${QUICK_START_MAX}, published`, "Dry run before anything applies", "Write consent only after purchase"].map(
                (t) => (
                  <span key={t} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#64748b" }}>
                    <span style={{ width: "5px", height: "5px", borderRadius: "999px", background: "#34d399" }} />
                    {t}
                  </span>
                ),
              )}
            </div>
          </div>

          <div
            style={{
              flex: "1 1 380px",
              maxWidth: "500px",
              border: "1px solid rgba(0,120,212,.24)",
              borderRadius: "18px",
              background: "linear-gradient(160deg,rgba(0,120,212,.11),rgba(11,21,36,.52) 55%,rgba(11,21,36,.34))",
              backdropFilter: "blur(3px)",
              boxShadow: "0 0 60px rgba(0,120,212,.14), inset 0 1px 0 rgba(148,163,184,.08)",
              padding: "20px 22px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>
                Dry run · Entra ID Quick-Start Pack
              </span>
              <span style={{ fontSize: "9.5px", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#475569" }}>
                In the Portal · after payment
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              {HERO_DRY_RUN.map((row) => (
                <HeroDryRunRow key={row.name} row={row} />
              ))}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "8px",
                marginTop: "12px",
                paddingTop: "11px",
                borderTop: "1px solid rgba(30,41,59,.9)",
              }}
            >
              <b style={{ fontSize: "20px", fontWeight: 800, color: "#f8fafc" }}>6 of 7</b>
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                will run · 1 deselected by you · nothing applies until you press{" "}
                <b style={{ color: "#e2e8f0" }}>Execute</b>.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* HOW A PACK RUNS */}
      <section
        style={{
          padding: "40px 32px 46px",
          background:
            "linear-gradient(180deg, rgba(5,13,30,0) 0%, #050d1e 16%, #050d1e 84%, rgba(5,13,30,0) 100%), radial-gradient(circle 900px at 20% 0%, rgba(0,120,212,.05), rgba(2,6,23,0) 60%)",
        }}
      >
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={sectionEyebrow}>How a pack runs</span>
            <h2 style={sectionH2}>We read first. Then we act — with your finger on the switch.</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Consent, connect, confirm scope, execute — the same four steps for all fifteen
              packs.
            </p>
          </div>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div
              style={{
                flex: "1.6 1 420px",
                minWidth: 0,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
                gap: "12px",
              }}
            >
              {HOW_IT_WORKS.map((s) => (
                <div
                  key={s.n}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    padding: "16px",
                    borderRadius: "14px",
                    background: "#0b1524",
                    border: "1px solid rgba(30,41,59,.9)",
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
                      background: "rgba(59,130,246,.15)",
                      border: "1px solid rgba(59,130,246,.4)",
                      color: "#60a5fa",
                    }}
                  >
                    {s.n}
                  </span>
                  <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>{s.label}</span>
                  <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.55 }}>{s.desc}</span>
                </div>
              ))}
            </div>
            <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ border: "1px solid rgba(59,130,246,.28)", borderRadius: "14px", background: "rgba(59,130,246,.05)", padding: "16px 18px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#60a5fa" }}>
                  Two app registrations, not one
                </span>
                <p style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.65, margin: "8px 0 0" }}>
                  Everything before payment — the scan, the dry-run read — happens through a{" "}
                  <b style={{ color: "#e2e8f0" }}>read-only</b> app registration. Write consent is
                  a separate grant, asked for only after purchase, used only for the changes you
                  approved.
                </p>
              </div>
              <div style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>
                  We don't just tell you — we build it
                </span>
                <p style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.65, margin: "8px 0 0" }}>
                  Every pack runs as a real Workflow Engine execution applying the pack's exact
                  deliverables to your tenant. Delivery is guided and scheduled, not an instant
                  self-service toggle.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* THE CATALOGUE */}
      <section id="packs" style={{ padding: "44px 32px 56px" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "26px" }}>
            <span style={sectionEyebrow}>The catalogue</span>
            <h2 style={sectionH2}>Fifteen packs, each with a fixed price.</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Fixed price at checkout, then a dry run of every change in the Portal — you approve
              or deselect each one before it touches your tenant.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "34px" }}>
            {PACK_GROUPS.map((g) => (
              <div key={g.label}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "12px",
                    marginBottom: "14px",
                    paddingBottom: "11px",
                    borderBottom: "1px solid rgba(30,41,59,.9)",
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".16em", color: "#60a5fa" }}>
                    {g.label}
                  </h3>
                  <span style={{ fontSize: "12.5px", color: "#64748b" }}>{g.note}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {g.keys.map((k) => {
                    const p = PACKS_BY_KEY[k];
                    const on = !!sel[k];
                    const unavailable = !catalogLoading && !availableKeys.has(k);
                    return (
                      <div
                        key={k}
                        onClick={() => toggle(k)}
                        data-testid={`quick-start-pack-${k}`}
                        data-available={!unavailable}
                        style={{
                          cursor: unavailable ? "not-allowed" : "pointer",
                          display: "grid",
                          gridTemplateColumns: "22px 34px minmax(0,1.1fr) minmax(0,1.3fr) 78px",
                          alignItems: "center",
                          gap: "14px",
                          padding: "13px 16px",
                          borderRadius: "12px",
                          transition: "border-color 180ms, background 180ms",
                          opacity: unavailable ? 0.55 : 1,
                          border: on ? "1px solid rgba(59,130,246,.5)" : "1px solid rgba(30,41,59,.9)",
                          background: on ? "rgba(59,130,246,.09)" : "rgba(11,21,36,.5)",
                        }}
                      >
                        <span
                          style={{
                            flex: "none",
                            width: "18px",
                            height: "18px",
                            borderRadius: "5px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "11px",
                            fontWeight: 800,
                            color: "#fff",
                            border: on ? "1px solid #3b82f6" : "1px solid rgba(100,116,139,.7)",
                            background: on ? "#3b82f6" : "transparent",
                          }}
                        >
                          {on ? "✓" : ""}
                        </span>
                        <span
                          style={{
                            width: "34px",
                            height: "34px",
                            borderRadius: "10px",
                            background: "rgba(59,130,246,.08)",
                            border: "1px solid rgba(59,130,246,.2)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#60a5fa",
                            flex: "none",
                          }}
                        >
                          <Glyph name={p.icon} />
                        </span>
                        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 700, color: "#f8fafc", lineHeight: 1.3, letterSpacing: "-.01em" }}>
                            {p.name}
                            {unavailable && (
                              <span
                                data-testid={`quick-start-pack-coming-soon-${k}`}
                                style={{
                                  flex: "none",
                                  fontSize: "9.5px",
                                  fontWeight: 700,
                                  letterSpacing: ".08em",
                                  textTransform: "uppercase",
                                  color: "#fbbf24",
                                  background: "rgba(251,191,36,.12)",
                                  border: "1px solid rgba(251,191,36,.35)",
                                  borderRadius: "999px",
                                  padding: "2px 8px",
                                }}
                              >
                                Coming soon
                              </span>
                            )}
                          </span>
                          {p.note && <span style={{ fontSize: "11px", color: "#60a5fa", lineHeight: 1.4 }}>{p.note}</span>}
                        </span>
                        <span style={{ minWidth: 0, fontSize: "12px", color: "#94a3b8", lineHeight: 1.55 }}>{p.desc}</span>
                        <span style={{ textAlign: "right", fontSize: "17px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.02em" }}>
                          {fmtPrice(p.price)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {overlaps.length > 0 && (
            <div
              data-testid="quick-start-overlap"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "7px",
                marginTop: "20px",
                padding: "14px 16px",
                borderRadius: "13px",
                border: "1px solid rgba(251,191,36,.32)",
                background: "rgba(251,191,36,.06)",
              }}
            >
              <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: ".16em", textTransform: "uppercase", color: "#fbbf24" }}>
                Overlap in your selection
              </span>
              {overlaps.map((ov) => (
                <div key={ov.key} style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                  <span style={{ flex: "1 1 320px", minWidth: 0, fontSize: "12px", color: "#e2e8f0", lineHeight: 1.6 }}>{ov.text}</span>
                  <button
                    onClick={() => toggle(ov.key)}
                    style={{
                      flex: "none",
                      padding: "5px 11px",
                      borderRadius: "8px",
                      border: "1px solid rgba(251,191,36,.45)",
                      background: "transparent",
                      color: "#fbbf24",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Remove it
                  </button>
                </div>
              ))}
            </div>
          )}

          {hasSel && (
            <div
              data-testid="quick-start-sticky-bar"
              style={{
                position: "sticky",
                bottom: "16px",
                zIndex: 20,
                display: "flex",
                alignItems: "center",
                gap: "16px",
                flexWrap: "wrap",
                marginTop: "18px",
                padding: "14px 18px",
                borderRadius: "14px",
                border: "1px solid rgba(59,130,246,.4)",
                background: "rgba(8,16,32,.92)",
                backdropFilter: "blur(8px)",
                boxShadow: "0 18px 50px rgba(2,6,23,.6)",
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>
                  {selCountLabel}
                </span>
                <span data-testid="quick-start-total" style={{ fontSize: "22px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.03em" }}>
                  {fmtPrice(rawTotal)}
                </span>
              </span>
              <span style={{ flex: 1, minWidth: "120px", fontSize: "11.5px", color: "#64748b", lineHeight: 1.5 }}>
                One checkout, one dry run. Every change is listed for approval before it touches
                your tenant.
              </span>
              <button
                data-testid="quick-start-clear"
                onClick={() => setSel({})}
                style={{
                  flex: "none",
                  padding: "9px 14px",
                  borderRadius: "9px",
                  border: "1px solid rgba(148,163,184,.22)",
                  background: "transparent",
                  color: "#94a3b8",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Clear
              </button>
              <Link
                href={buyHref}
                data-testid="quick-start-buy"
                style={{
                  flex: "none",
                  padding: "11px 20px",
                  borderRadius: "10px",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#fff",
                  background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
                  whiteSpace: "nowrap",
                }}
              >
                {buyLabel}
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* INSIDE THE PORTAL */}
      <section style={{ padding: "0 32px 48px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ ...sectionEyebrow, color: "#a78bfa" }}>Inside the portal</span>
            <h2 style={sectionH2}>A pack isn't an invoice line. It's a run you can watch.</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Every execution lives in the same Portal your monitoring would — the dry run, the
              approvals, the execution log, and the register entry it leaves behind.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: "12px", marginBottom: "16px" }}>
            {PORTAL_MODULES.map((pm) => {
              const afterScan = pm.tier === "After a scan";
              const [bg, brd, fg] = afterScan
                ? ["rgba(59,130,246,.1)", "rgba(59,130,246,.3)", "#60a5fa"]
                : ["rgba(34,197,94,.1)", "rgba(34,197,94,.3)", "#4ade80"];
              return (
                <div
                  key={pm.name}
                  style={{
                    border: "1px solid rgba(30,41,59,.95)",
                    borderRadius: "14px",
                    background: "#0b1524",
                    padding: "16px 18px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#f8fafc" }}>{pm.name}</span>
                    <span
                      style={{
                        flex: "none",
                        whiteSpace: "nowrap",
                        padding: "3px 9px",
                        borderRadius: "999px",
                        fontSize: "9.5px",
                        fontWeight: 700,
                        letterSpacing: ".08em",
                        textTransform: "uppercase",
                        background: bg,
                        border: `1px solid ${brd}`,
                        color: fg,
                      }}
                    >
                      {pm.tier}
                    </span>
                  </div>
                  <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6 }}>{pm.body}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "14px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "11.5px", color: "#64748b" }}>The demo is the real interface with an illustrative tenant loaded.</span>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: "32px 32px 64px", background: "linear-gradient(180deg, rgba(0,120,212,.05), rgba(2,6,23,0) 55%)", textAlign: "center" }}>
        <div style={{ maxWidth: "640px", margin: "0 auto" }}>
          <h2 style={{ fontSize: "19px", fontWeight: 700, color: "#f8fafc", margin: "0 0 10px", letterSpacing: "-.02em" }}>
            Not sure which pack?
          </h2>
          <p style={{ color: "#94a3b8", margin: "0 0 22px", fontSize: "13px", lineHeight: 1.7 }}>
            Run the free scan first — signal-triggered packs are generated from your real
            findings and checked out from inside the Portal, so you only buy what your tenant
            actually needs.
          </p>
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
              background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
            }}
          >
            Scan My Tenant · Free
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="12" x2="20" y2="12" />
              <polyline points="14 6 20 12 14 18" />
            </svg>
          </Link>
          <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "10px" }}>
            Read-only. No agent, no charge, and the findings are yours either way.
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
