import { Link } from "wouter";
import { MarketingLayout } from "../../components/MarketingLayout";
import { ArrowRight, PillarPeerStrip, ScanToScopedWork } from "../../components/pillar/PillarShared";
import { useCatalog, type MonitoringTier } from "../../../hooks/useCatalog";

// Route /pillars/health — recreated from Design/design_handoff_marketing/
// Marketing Pillar - Health.dc.html. Colour #22c55e, watermark pulse line. Copy verbatim; data
// is the design's own renderVals() illustrative fixture.

type Impact = "Hits you" | "Might hit you" | "No impact";

function impactChipStyle(impact: Impact): React.CSSProperties {
  const m: Record<Impact, [string, string, string]> = {
    "Hits you": ["rgba(248,113,113,.12)", "rgba(248,113,113,.35)", "#f87171"],
    "Might hit you": ["rgba(251,191,36,.1)", "rgba(251,191,36,.3)", "#fbbf24"],
    "No impact": ["rgba(148,163,184,.07)", "rgba(148,163,184,.2)", "#64748b"],
  };
  const t = m[impact];
  return {
    flex: "none",
    whiteSpace: "nowrap",
    padding: "4px 10px",
    borderRadius: "999px",
    fontSize: "10px",
    fontWeight: 700,
    background: t[0],
    border: `1px solid ${t[1]}`,
    color: t[2],
  };
}

function scoreStyle(n: number): React.CSSProperties {
  const t: [string, string, string] =
    n >= 80
      ? ["rgba(248,113,113,.12)", "rgba(248,113,113,.35)", "#f87171"]
      : n >= 50
      ? ["rgba(251,191,36,.1)", "rgba(251,191,36,.3)", "#fbbf24"]
      : ["rgba(148,163,184,.07)", "rgba(148,163,184,.2)", "#64748b"];
  return {
    flex: "none",
    width: "34px",
    height: "34px",
    borderRadius: "9px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    background: t[0],
    border: `1px solid ${t[1]}`,
    color: t[2],
  };
}

const MC_ROWS: { id: string; title: string; kind: string; when: string; score: number; impact: Impact }[] = [
  { id: "MC1042318", title: "Basic authentication permanently disabled in Exchange Online", kind: "Retirement", when: "1 Oct 2026", score: 92, impact: "Hits you" },
  { id: "MC1054920", title: "MFA required for all Microsoft admin portals", kind: "Enforcement", when: "15 Nov 2026", score: 88, impact: "Hits you" },
  { id: "MC1049877", title: "Default sharing link changes to “people with existing access”", kind: "Rollout", when: "22 Sep 2026", score: 74, impact: "Hits you" },
  { id: "MC1057733", title: "Retention label management moves to the new Purview portal", kind: "Feature", when: "Oct 2026", score: 12, impact: "No impact" },
];

const TRIAGE: { label: string; value: number; pct: number; color: string }[] = [
  { label: "Filtered out automatically", value: 288, pct: 100, color: "#475569" },
  { label: "Watching, no action yet", value: 122, pct: 42, color: "#60a5fa" },
  { label: "Need a recorded decision", value: 37, pct: 13, color: "#fbbf24" },
  { label: "Hit named systems now", value: 5, pct: 4, color: "#f87171" },
];

const WAVE_ROWS: { title: string; meta: string; state: string; due: boolean }[] = [
  { title: "Default sharing link type changes", meta: "22 Sep · opt-out closes 18 Sep", state: "Decision recorded", due: false },
  { title: "Anonymous meeting join flips to allowed", meta: "26 Sep · pin the value or a control moves", state: "Runbook queued", due: false },
  { title: "Meeting toolbar moves, recap tab renamed", meta: "21 Sep · ~400 people see it", state: "Announcement drafted", due: true },
];

const TIER_STYLE: Record<string, React.CSSProperties> = {
  "All customers": { background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.3)", color: "#4ade80" },
  Growth: { background: "rgba(20,184,166,.1)", border: "1px solid rgba(20,184,166,.3)", color: "#2dd4bf" },
};

const PORTAL_MODULES: { name: string; tier: string; body: string }[] = [
  { name: "Microsoft Changes", tier: "All customers", body: "Every message-centre post scored against your configuration — with edits, moved dates and withdrawals tracked nightly." },
  { name: "Active Runbooks", tier: "Growth", body: "Procedures in progress, including hold windows — what’s mid-flight, what’s waiting, and what’s due." },
  { name: "Remediation Tracker", tier: "Growth", body: "Every finding being closed, what closed it, and the score change it produced." },
  { name: "SOPs & Runbooks", tier: "Growth", body: "The procedure library — incident response, security drift, mail flow, device management — ours and yours." },
];

function tierChipStyle(tier: string): React.CSSProperties {
  return {
    flex: "none",
    whiteSpace: "nowrap",
    padding: "3px 9px",
    borderRadius: "999px",
    fontSize: "9.5px",
    fontWeight: 700,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    ...TIER_STYLE[tier],
  };
}

// Byte-identical to Monitoring.tsx/Pricing.tsx's own ppuOf/floorOf/surchargeOf — the cheapest
// real monthly floor price across every live monitoring tier, so this pillar's "$X/mo" can never
// drift from what /monitoring actually charges.
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

export default function PillarHealth() {
  const { monitoringTiers, loading: monLoading } = useCatalog();
  const cheapestMonitoringPrice = (() => {
    let min: number | null = null;
    monitoringTiers.forEach((row) => {
      const p = ppuOf(row) * floorOf(row) + surchargeOf(row);
      if (min === null || p < min) min = p;
    });
    return min;
  })();
  const monitoringPriceLabel = monLoading || cheapestMonitoringPrice == null ? "…" : money(cheapestMonitoringPrice);

  return (
    <MarketingLayout current="watch">
      {/* Hero */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "48px 32px 30px",
          background:
            "radial-gradient(circle 1100px at 76% -20%, rgba(34,197,94,.11), rgba(2,6,23,0) 62%), radial-gradient(circle 780px at 6% 10%, rgba(34,197,94,.05), rgba(2,6,23,0) 66%)",
        }}
      >
        <span style={{ position: "absolute", right: "-90px", top: "-70px", opacity: 0.035, pointerEvents: "none", lineHeight: 0 }}>
          <svg width="520" height="520" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </span>
        <div style={{ position: "relative", zIndex: 1, maxWidth: "1120px", margin: "0 auto", display: "flex", gap: "44px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1.1 1 380px", minWidth: 0 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "6px 12px",
                borderRadius: "999px",
                background: "rgba(34,197,94,.1)",
                border: "1px solid rgba(34,197,94,.28)",
                color: "#4ade80",
                fontSize: "10.5px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".1em",
                marginBottom: "18px",
              }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 12 7 12 10 5 14 19 17 12 21 12" />
              </svg>{" "}
              Pillar 06 · Health
            </span>
            <h1 style={{ fontSize: "clamp(30px,3.4vw,40px)", fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.12, color: "#f8fafc", margin: "0 0 16px", textWrap: "pretty" } as React.CSSProperties}>
              Microsoft changes your tenant all year. You approved none of it.
            </h1>
            <p style={{ fontSize: "15px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 12px", maxWidth: "54ch" }}>
              Retirements, enforcements, flipped defaults, dates that move twice and posts that get edited after you planned against them — all arriving through a message centre nobody has time to read. The Health pillar reads every post against your actual configuration and answers one question: does this hit us?
            </p>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.7, margin: "0 0 24px", maxWidth: "54ch" }}>
              The feed alongside is real message-centre material from the Portal’s illustrative tenant.
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "22px" }}>
              <Link href="/scan" style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "12px 22px", borderRadius: "10px", fontWeight: 700, fontSize: "13.5px", color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)", whiteSpace: "nowrap" }}>
                Scan My Tenant · Free <ArrowRight />
              </Link>
              <Link href="/monitoring" style={{ padding: "12px 22px", borderRadius: "10px", fontWeight: 600, fontSize: "13.5px", color: "#cbd5e1", border: "1px solid rgba(148,163,184,.2)", whiteSpace: "nowrap" }}>
                See Monitoring Pricing
              </Link>
            </div>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
              {["Scored against your config", "Checked against your freeze calendar", "Edits and reversals tracked"].map((t) => (
                <span key={t} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#64748b" }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "999px", background: "#34d399" }} />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Microsoft changes feed card */}
          <div style={{ flex: "1 1 380px", maxWidth: "500px", border: "1px solid rgba(30,41,59,.95)", borderRadius: "18px", background: "#0b1524", padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>Microsoft changes · scored for this tenant</span>
              <span style={{ fontSize: "9.5px", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#475569" }}>Illustrative</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {MC_ROWS.map((mc) => (
                <div key={mc.id} style={{ display: "flex", alignItems: "center", gap: "11px", padding: "11px 12px", border: "1px solid rgba(30,41,59,.9)", borderRadius: "10px", background: "rgba(2,6,23,.35)" }}>
                  <span style={scoreStyle(mc.score)}>{mc.score}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.4 }}>{mc.title}</div>
                    <div style={{ fontSize: "10.5px", color: "#64748b", marginTop: "2px" }}>{mc.id} · {mc.kind} · {mc.when}</div>
                  </div>
                  <span style={impactChipStyle(mc.impact)}>{mc.impact}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "12px", paddingTop: "11px", borderTop: "1px solid rgba(30,41,59,.9)" }}>
              <b style={{ fontSize: "22px", fontWeight: 800, color: "#f8fafc", fontVariantNumeric: "tabular-nums" }}>452</b>
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                notices this year in the illustrative tenant — <b style={{ color: "#f87171" }}>38 unread</b> beyond the five-day review window before monitoring took over.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Triage */}
      <section
        style={{
          padding: "40px 32px 46px",
          background:
            "linear-gradient(180deg, rgba(5,13,30,0) 0%, #050d1e 16%, #050d1e 84%, rgba(5,13,30,0) 100%), radial-gradient(circle 900px at 20% 0%, rgba(34,197,94,.05), rgba(2,6,23,0) 60%)",
        }}
      >
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#4ade80" }}>Triage</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>452 notices. Five that can actually hurt you.</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Most message-centre posts don’t apply to you — products you don’t licence, features you don’t use, settings already configured the way they’ll change to. The engine filters those against your real tenant so a human only reads what’s left:
            </p>
          </div>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div
              style={{
                flex: "1.6 1 420px",
                minWidth: 0,
                border: "1px solid rgba(34,197,94,.22)",
                borderRadius: "18px",
                background: "linear-gradient(160deg,rgba(34,197,94,.10),rgba(11,21,36,.52) 55%,rgba(11,21,36,.34))",
                backdropFilter: "blur(3px)",
                boxShadow: "0 0 60px rgba(34,197,94,.13), inset 0 1px 0 rgba(148,163,184,.08)",
                padding: "22px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {TRIAGE.map((tr) => (
                  <div key={tr.label} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ width: "150px", flex: "none", fontSize: "12px", fontWeight: 600, color: "#cbd5e1", textAlign: "right" }}>{tr.label}</span>
                    <div style={{ flex: 1, height: "26px", borderRadius: "8px", background: "rgba(2,6,23,.6)", overflow: "hidden", display: "flex" }}>
                      <div style={{ width: `${tr.pct}%`, height: "100%", borderRadius: "8px", background: `linear-gradient(90deg,${tr.color}22,${tr.color})` }} />
                    </div>
                    <span style={{ width: "44px", flex: "none", fontSize: "12.5px", fontWeight: 800, color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>{tr.value}</span>
                  </div>
                ))}
              </div>
              <p style={{ margin: "16px 0 0", paddingTop: "14px", borderTop: "1px solid rgba(30,41,59,.9)", fontSize: "11.5px", color: "#64748b", lineHeight: 1.65 }}>
                Filtered out: 121 products you don’t licence, 94 features not in use, 73 already configured the way the change lands. Every filter decision is recorded, so “doesn’t apply” is auditable too.
              </p>
            </div>
            <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ border: "1px solid rgba(251,191,36,.3)", borderRadius: "14px", background: "rgba(251,191,36,.05)", padding: "16px 18px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#fbbf24" }}>When Microsoft changes its mind</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "9px", marginTop: "10px" }}>
                  <div style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6 }}>
                    <b style={{ color: "#f87171" }}>Edited after publication</b> — a sharing-label post quietly rewritten six weeks after teams had planned against it. The engine diffs every post nightly and flags the edit.
                  </div>
                  <div style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6 }}>
                    <b style={{ color: "#fbbf24" }}>Date moved twice</b> — EWS throttling slipped from March to June to January. Three remediation windows were held open for nothing.
                  </div>
                  <div style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6 }}>
                    <b style={{ color: "#34d399" }}>Withdrawn</b> — the Loop retirement that never happened. The plan built on it was closed the day the post changed.
                  </div>
                </div>
              </div>
              <div style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>Users see it before you do</span>
                <p style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6, margin: "8px 0 0" }}>
                  39 of this year’s changes are visible in Teams, Outlook or Office. Each one ships with a helpdesk line and a draft announcement — because “where has mute gone” is a ticket you can prevent.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Inside the portal */}
      <section style={{ padding: "44px 32px 44px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#a78bfa" }}>Inside the portal</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>
              From notice to decision to runbook, without leaving the page.
            </h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Changes that hit you become decisions with owners. Decisions become runbooks. Runbooks close findings in the Remediation Tracker — and the whole chain is checked against your freeze calendar before anything moves.
            </p>
          </div>
          <div style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "18px", background: "#0b1524", overflow: "hidden", marginBottom: "18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 16px", borderBottom: "1px solid rgba(30,41,59,.9)", background: "rgba(2,6,23,.5)" }}>
              <span style={{ width: "9px", height: "9px", borderRadius: "999px", background: "rgba(148,163,184,.25)" }} />
              <span style={{ width: "9px", height: "9px", borderRadius: "999px", background: "rgba(148,163,184,.25)" }} />
              <span style={{ width: "9px", height: "9px", borderRadius: "999px", background: "rgba(148,163,184,.25)" }} />
              <span style={{ marginLeft: "8px", fontSize: "10.5px", color: "#475569", fontWeight: 600 }}>portal.shanemccaw.com — your tenant, after onboarding</span>
            </div>
            <div style={{ display: "flex", alignItems: "stretch", minHeight: "270px" }}>
              <div style={{ width: "190px", flex: "none", borderRight: "1px solid rgba(30,41,59,.9)", background: "rgba(2,6,23,.35)", padding: "14px 10px", flexDirection: "column", gap: "2px", display: "flex" }}>
                <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#475569", padding: "0 8px 6px" }}>Operate</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Change Control</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>
                  Active Runbooks{" "}
                  <span style={{ display: "inline-flex", marginLeft: "4px", padding: "1px 6px", borderRadius: "999px", fontSize: "9px", fontWeight: 800, background: "rgba(251,191,36,.15)", border: "1px solid rgba(251,191,36,.4)", color: "#fbbf24" }}>1 due</span>
                </span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Remediation Tracker</span>
                <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#475569", padding: "10px 8px 6px" }}>Reference</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>SOPs &amp; Runbooks</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 700, color: "#f8fafc", background: "rgba(34,197,94,.12)", border: "1px solid rgba(34,197,94,.3)" }}>
                  Microsoft Changes{" "}
                  <span style={{ display: "inline-flex", marginLeft: "4px", padding: "1px 6px", borderRadius: "999px", fontSize: "9px", fontWeight: 800, background: "rgba(248,113,113,.15)", border: "1px solid rgba(248,113,113,.4)", color: "#f87171" }}>3</span>
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ border: "1px solid rgba(248,113,113,.3)", borderRadius: "11px", background: "rgba(248,113,113,.06)", padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "999px", background: "#f87171", flex: "none" }} />
                  <div style={{ flex: 1, minWidth: "200px" }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Basic authentication permanently disabled — 1 October</div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>Named systems that stop working: Bay 3 scanners, the Finance invoice export, two phones. CR-0142 raised.</div>
                  </div>
                  <span style={{ flex: "none", padding: "7px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 700, color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }}>Open the runbook</span>
                </div>
                <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>This wave · landing 24 Aug – 6 Sep</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                  {WAVE_ROWS.map((wr) => (
                    <div key={wr.title} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px", border: "1px solid rgba(30,41,59,.9)", borderRadius: "10px", background: "rgba(2,6,23,.35)", flexWrap: "wrap" }}>
                      <span style={{ flex: 1, minWidth: "220px", fontSize: "12px", fontWeight: 600, color: "#e2e8f0" }}>{wr.title}</span>
                      <span style={{ flex: "none", fontSize: "11px", color: "#94a3b8" }}>{wr.meta}</span>
                      <span
                        style={{
                          flex: "none",
                          whiteSpace: "nowrap",
                          padding: "4px 10px",
                          borderRadius: "999px",
                          fontSize: "10px",
                          fontWeight: 700,
                          ...(wr.due
                            ? { background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.32)", color: "#fbbf24" }
                            : { background: "rgba(52,211,153,.08)", border: "1px solid rgba(52,211,153,.25)", color: "#34d399" }),
                        }}
                      >
                        {wr.state}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "10.5px", color: "#475569" }}>
                  The September wave overlaps your quarter-close freeze on 29–30 September — the calendar flags the collision before Microsoft does.
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: "12px", marginBottom: "16px" }}>
            {PORTAL_MODULES.map((pm) => (
              <div key={pm.name} style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#f8fafc" }}>{pm.name}</span>
                  <span style={tierChipStyle(pm.tier)}>{pm.tier}</span>
                </div>
                <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6 }}>{pm.body}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "14px", flexWrap: "wrap" }}>
            <a href="/portal" style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "11px 20px", borderRadius: "10px", fontSize: "12.5px", fontWeight: 700, color: "#cbd5e1", border: "1px solid rgba(148,163,184,.2)", whiteSpace: "nowrap", textDecoration: "none" }}>
              Tour the Portal <ArrowRight size={14} />
            </a>
            <span style={{ fontSize: "11.5px", color: "#64748b" }}>The demo is the real interface with an illustrative tenant loaded.</span>
          </div>
        </div>
      </section>

      {/* Why this is a subscription band */}
      <section style={{ padding: "0 32px 48px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto", border: "1px solid rgba(34,197,94,.3)", borderRadius: "18px", background: "#0b1524", padding: "28px", display: "flex", gap: "28px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1.4 1 340px", minWidth: 0 }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#4ade80" }}>Why this is a subscription</span>
            <h2 style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>A one-off assessment can’t read next month’s message centre.</h2>
            <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Health is the pillar that never stops moving, which is why it’s watched by <b style={{ color: "#e2e8f0" }}>Monitoring</b> on every tier — and why the runbooks that respond to it come with Growth. When a wave needs real engineering, it becomes a scoped SOW from the catalogue.
            </p>
          </div>
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "11px 14px", border: "1px solid rgba(30,41,59,.9)", borderRadius: "10px", background: "rgba(2,6,23,.4)" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Monitoring</span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>from <b style={{ color: "#e2e8f0" }}>{monitoringPriceLabel}</b>/mo · priced per seat</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "11px 14px", border: "1px solid rgba(30,41,59,.9)", borderRadius: "10px", background: "rgba(2,6,23,.4)" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Project SOWs</span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>fixed price · from the 33-project catalogue</span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <Link href="/monitoring" style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "11px", borderRadius: "10px", fontSize: "12.5px", fontWeight: 700, color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)", whiteSpace: "nowrap" }}>
                See Monitoring Pricing
              </Link>
              <Link href="/solutions" style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "11px", borderRadius: "10px", fontSize: "12.5px", fontWeight: 700, color: "#cbd5e1", border: "1px solid rgba(148,163,184,.2)", whiteSpace: "nowrap" }}>
                Browse Projects
              </Link>
            </div>
          </div>
        </div>
      </section>

      <PillarPeerStrip
        active="health"
        deeper={[
          { label: "M365 Health", href: "/solutions/m365-health" },
          { label: "Migration", href: "/solutions/migration" },
          { label: "Teams", href: "/solutions/teams" },
        ]}
      />

      <ScanToScopedWork
        accent="rgba(34,197,94,.05)"
        intro="The free scan reads your actual tenant, including the changes already queued against it. Findings become a scoped, priced statement of work — and this feed becomes yours, scored against your real configuration."
      />
    </MarketingLayout>
  );
}
