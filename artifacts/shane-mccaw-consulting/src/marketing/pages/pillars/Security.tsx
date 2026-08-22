import { Link } from "wouter";
import { MarketingLayout } from "../../components/MarketingLayout";
import { ArrowRight, PillarPeerStrip, ScanToScopedWork } from "../../components/pillar/PillarShared";

// Route /pillars/security — recreated from Design/design_handoff_marketing/
// Marketing Pillar - Security.dc.html. Colour #8b5cf6, watermark padlock. Copy verbatim; the
// data is the design's own renderVals() illustrative fixture. (The design defined a `frameworks`
// array in renderVals that its markup never renders — it is dead data and deliberately omitted.)

// Exposure-map heatmap: findings per workload across five control families. tone() picks the
// cell colour band from the count; a pulsing dot marks cells that contain gate blockers.
function tone(n: number): [string, string, string] {
  if (n === 0) return ["rgba(52,211,153,.06)", "rgba(52,211,153,.2)", "#34d399"];
  if (n <= 2) return ["rgba(251,191,36,.1)", "rgba(251,191,36,.25)", "#fbbf24"];
  if (n <= 4) return ["rgba(248,113,113,.13)", "rgba(248,113,113,.3)", "#f87171"];
  return ["rgba(248,113,113,.28)", "rgba(248,113,113,.55)", "#fecaca"];
}

const HEAT_INPUT: { name: string; cells: number[]; blockers: number[] }[] = [
  { name: "Entra ID", cells: [4, 3, 1, 2, 0], blockers: [2, 0, 0, 0, 0] },
  { name: "Exchange", cells: [1, 0, 2, 1, 0], blockers: [0, 0, 0, 0, 0] },
  { name: "SharePoint", cells: [3, 1, 6, 2, 1], blockers: [0, 0, 3, 0, 0] },
  { name: "Teams", cells: [0, 0, 3, 1, 0], blockers: [0, 0, 0, 0, 0] },
  { name: "Devices", cells: [1, 1, 0, 3, 1], blockers: [0, 0, 0, 1, 0] },
  { name: "Power Platform", cells: [0, 1, 1, 1, 1], blockers: [0, 0, 0, 0, 0] },
];

const HEAT_TOTALS = [0, 0, 0, 0, 0];
const HEAT_ROWS = HEAT_INPUT.map((r) => {
  const total = r.cells.reduce((a, b) => a + b, 0);
  return {
    name: r.name,
    total,
    cells: r.cells.map((n, i) => {
      HEAT_TOTALS[i] += n;
      return { value: n, hasBlockers: r.blockers[i] > 0, t: tone(n) };
    }),
  };
});

const RISK_ROWS: { risk: string; owner: string; review: string; state: string; due: boolean }[] = [
  { risk: "Legacy authentication left enabled for 3 service accounts", owner: "IT Director", review: "14 Oct 2026", state: "Accepted · compensating control", due: false },
  { risk: "Guest access to the Finance site retained for external auditor", owner: "CFO", review: "30 Sep 2026", state: "Accepted · time-boxed", due: false },
  { risk: "Tenant-wide app consent for a legacy integration", owner: "Ops Lead", review: "2 Aug 2026", state: "Review overdue", due: true },
];

const TIER_STYLE: Record<string, React.CSSProperties> = {
  Foundation: { background: "rgba(59,130,246,.1)", border: "1px solid rgba(59,130,246,.3)", color: "#60a5fa" },
  Growth: { background: "rgba(20,184,166,.1)", border: "1px solid rgba(20,184,166,.3)", color: "#2dd4bf" },
  Premier: { background: "rgba(139,92,246,.12)", border: "1px solid rgba(139,92,246,.35)", color: "#a78bfa" },
};

const PORTAL_MODULES: { name: string; tier: string; body: string }[] = [
  { name: "Risk Register", tier: "Foundation", body: "Accepted risks with the owner and the review date — the list your auditor asks for first, kept current by the platform." },
  { name: "Active Runbooks & SOP Library", tier: "Growth", body: "One-click procedures for the findings the engines raise — incident response, security drift, mail flow, device management — plus your own." },
  { name: "Remediation Tracker", tier: "Growth", body: "Every finding being closed, what closed it, and the score change it produced." },
  { name: "Policy Decisions", tier: "Premier", body: "The gaps you’ve decided to live with, recorded with an owner and a review date — so “accepted” never quietly becomes “forgotten”." },
  { name: "Change Control", tier: "Premier", body: "Every tenant change with a request, an approval and a rollback point — plus a freeze calendar for periods when nothing may move." },
  { name: "Security Plan & PII Governance", tier: "Premier", body: "The authoritative record of how the tenant must be run, and where personal data lives, who can reach it, and what moved." },
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

const HEAT_FAMILIES = ["Access", "Privilege", "Exposure", "Baseline", "Telemetry"];

export default function PillarSecurity() {
  return (
    <MarketingLayout current="watch">
      <style>{`@keyframes secPulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

      {/* Hero */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "48px 32px 30px",
          background:
            "radial-gradient(circle 1100px at 76% -20%, rgba(139,92,246,.11), rgba(2,6,23,0) 62%), radial-gradient(circle 780px at 6% 10%, rgba(139,92,246,.05), rgba(2,6,23,0) 66%)",
        }}
      >
        <span style={{ position: "absolute", right: "-90px", top: "-70px", opacity: 0.035, pointerEvents: "none", lineHeight: 0 }}>
          <svg width="520" height="520" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
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
                <path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z" />
              </svg>{" "}
              Pillar 02 · Security
            </span>
            <h1 style={{ fontSize: "clamp(30px,3.4vw,40px)", fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.12, color: "#f8fafc", margin: "0 0 16px", textWrap: "pretty" } as React.CSSProperties}>
              Your tenant has a security score. You’ve never seen it.
            </h1>
            <p style={{ fontSize: "15px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 12px", maxWidth: "54ch" }}>
              Six pillars — identity, data protection, email &amp; collaboration, devices, apps, audit — scored 0–100 from a read-only Graph scan of your real configuration. Below the 82 gate, Copilot and your auditors have the same problem for the same reasons.
            </p>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.7, margin: "0 0 24px", maxWidth: "54ch" }}>
              The radar alongside is what a typical mid-market tenant looks like on first scan. Yours will be different. That is the point.
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
              {["Read-only Graph scan", "158 checks", "No agent installed"].map((t) => (
                <span key={t} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#64748b" }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "999px", background: "#34d399" }} />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Radar artefact card */}
          <div
            style={{
              flex: "1 1 360px",
              maxWidth: "470px",
              border: "1px solid rgba(139,92,246,.22)",
              borderRadius: "18px",
              background: "linear-gradient(160deg,rgba(139,92,246,.10),rgba(11,21,36,.52) 55%,rgba(11,21,36,.34))",
              backdropFilter: "blur(3px)",
              boxShadow: "0 0 60px rgba(139,92,246,.13), inset 0 1px 0 rgba(148,163,184,.08)",
              padding: "22px 22px 16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "6px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>Six pillars · one score</span>
              <span style={{ fontSize: "9.5px", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#475569" }}>Illustrative first scan</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "18px", marginBottom: "2px" }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
                <b style={{ fontSize: "34px", fontWeight: 800, letterSpacing: "-.03em", color: "#f87171", fontVariantNumeric: "tabular-nums" }}>45</b>
                <span style={{ fontSize: "12px", color: "#64748b" }}>scored</span>
              </span>
              <span style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
                <b style={{ fontSize: "20px", fontWeight: 800, color: "#34d399", fontVariantNumeric: "tabular-nums" }}>82</b>
                <span style={{ fontSize: "12px", color: "#64748b" }}>gate</span>
              </span>
              <span style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
                <b style={{ fontSize: "20px", fontWeight: 800, color: "#fbbf24", fontVariantNumeric: "tabular-nums" }}>37</b>
                <span style={{ fontSize: "12px", color: "#64748b" }}>gap</span>
              </span>
            </div>
            <svg viewBox="-48 0 396 210" style={{ width: "100%", height: "auto", display: "block" }}>
              <polygon points="150,27 217.5,66 217.5,144 150,183 82.5,144 82.5,66" fill="none" stroke="rgba(148,163,184,.14)" strokeWidth="1" />
              <polygon points="150,46.5 200.7,75.8 200.7,134.2 150,163.5 99.3,134.2 99.3,75.8" fill="none" stroke="rgba(148,163,184,.11)" strokeWidth="1" />
              <polygon points="150,66 183.8,85.5 183.8,124.5 150,144 116.2,124.5 116.2,85.5" fill="none" stroke="rgba(148,163,184,.09)" strokeWidth="1" />
              <polygon points="150,85.5 166.9,95.2 166.9,114.8 150,124.5 133.1,114.8 133.1,95.2" fill="none" stroke="rgba(148,163,184,.07)" strokeWidth="1" />
              <line x1="150" y1="105" x2="150" y2="27" stroke="rgba(148,163,184,.09)" />
              <line x1="150" y1="105" x2="217.5" y2="66" stroke="rgba(148,163,184,.09)" />
              <line x1="150" y1="105" x2="217.5" y2="144" stroke="rgba(148,163,184,.09)" />
              <line x1="150" y1="105" x2="150" y2="183" stroke="rgba(148,163,184,.09)" />
              <line x1="150" y1="105" x2="82.5" y2="144" stroke="rgba(148,163,184,.09)" />
              <line x1="150" y1="105" x2="82.5" y2="66" stroke="rgba(148,163,184,.09)" />
              <polygon points="150,41 205.4,73 205.4,137 150,169 94.6,137 94.6,73" fill="none" stroke="#34d399" strokeWidth="1.3" strokeDasharray="4 4" opacity=".75" />
              <polygon points="150,78.5 177.7,89 189.2,127.6 150,141.7 130.4,116.3 107.5,80.4" fill="rgba(248,113,113,.16)" stroke="#f87171" strokeWidth="1.6" />
              <circle cx="150" cy="78.5" r="2.4" fill="#f87171" />
              <circle cx="177.7" cy="89" r="2.4" fill="#f87171" />
              <circle cx="189.2" cy="127.6" r="2.4" fill="#f87171" />
              <circle cx="150" cy="141.7" r="2.4" fill="#f87171" />
              <circle cx="130.4" cy="116.3" r="2.4" fill="#f87171" />
              <circle cx="107.5" cy="80.4" r="2.4" fill="#f87171" />
              <text x="150" y="16" textAnchor="middle" fill="#94a3b8" fontSize="9.5" fontWeight="600" fontFamily="Inter,system-ui,sans-serif">
                Identity · <tspan fill="#f87171" fontWeight="700">34</tspan>
              </text>
              <text x="224" y="62" textAnchor="start" fill="#94a3b8" fontSize="9.5" fontWeight="600" fontFamily="Inter,system-ui,sans-serif">
                Data protection · <tspan fill="#f87171" fontWeight="700">41</tspan>
              </text>
              <text x="224" y="152" textAnchor="start" fill="#94a3b8" fontSize="9.5" fontWeight="600" fontFamily="Inter,system-ui,sans-serif">
                Email &amp; files · <tspan fill="#fbbf24" fontWeight="700">58</tspan>
              </text>
              <text x="150" y="199" textAnchor="middle" fill="#94a3b8" fontSize="9.5" fontWeight="600" fontFamily="Inter,system-ui,sans-serif">
                Devices · <tspan fill="#fbbf24" fontWeight="700">47</tspan>
              </text>
              <text x="76" y="152" textAnchor="end" fill="#94a3b8" fontSize="9.5" fontWeight="600" fontFamily="Inter,system-ui,sans-serif">
                Apps &amp; OAuth · <tspan fill="#f87171" fontWeight="700">29</tspan>
              </text>
              <text x="76" y="62" textAnchor="end" fill="#94a3b8" fontSize="9.5" fontWeight="600" fontFamily="Inter,system-ui,sans-serif">
                Audit &amp; logging · <tspan fill="#fbbf24" fontWeight="700">63</tspan>
              </text>
            </svg>
            <div style={{ display: "flex", gap: "16px", justifyContent: "center", paddingTop: "8px", borderTop: "1px solid rgba(30,41,59,.9)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
                <span style={{ width: "16px", height: "2px", background: "#f87171", borderRadius: "2px" }} />Where first scans land
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
                <span style={{ width: "16px", height: 0, borderTop: "2px dashed #34d399" }} />The 82 gate
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Exposure map */}
      <section style={{ padding: "34px 32px 40px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#f87171" }}>Exposure map</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>Where 41 findings actually live</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Findings cluster. The same five control families, the same three workloads, in nearly every tenant we scan — identity holding the standing privilege, SharePoint holding the exposure, and a telemetry blind spot nobody owns. This is the illustrative tenant from the radar above, cut by workload.
            </p>
          </div>
          <div style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "18px", background: "#0b1524", padding: "22px", overflowX: "auto" }}>
            <div style={{ minWidth: "640px" }}>
              <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ width: "118px", flex: "none" }} />
                {HEAT_FAMILIES.map((f) => (
                  <span key={f} style={{ flex: 1, textAlign: "center", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#64748b" }}>
                    {f}
                  </span>
                ))}
                <span style={{ width: "44px", flex: "none", textAlign: "right", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#475569" }}>Total</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {HEAT_ROWS.map((r) => (
                  <div key={r.name} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <span style={{ width: "118px", flex: "none", fontSize: "12px", fontWeight: 600, color: "#cbd5e1" }}>{r.name}</span>
                    {r.cells.map((c, i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          height: "46px",
                          borderRadius: "9px",
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "13px",
                          fontWeight: 800,
                          fontVariantNumeric: "tabular-nums",
                          background: c.t[0],
                          border: `1px solid ${c.t[1]}`,
                          color: c.t[2],
                        }}
                      >
                        {c.value}
                        {c.hasBlockers ? (
                          <span style={{ position: "absolute", top: "6px", right: "7px", width: "5px", height: "5px", borderRadius: "999px", background: "#f87171", animation: "secPulse 2.2s ease-in-out infinite" }} />
                        ) : null}
                      </div>
                    ))}
                    <span style={{ width: "44px", flex: "none", textAlign: "right", fontSize: "12.5px", fontWeight: 800, color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>{r.total}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "8px" }}>
                <span style={{ width: "118px", flex: "none" }} />
                {HEAT_TOTALS.map((ct, i) => (
                  <span key={i} style={{ flex: 1, textAlign: "center", fontSize: "11px", fontWeight: 700, color: "#64748b", fontVariantNumeric: "tabular-nums" }}>{ct}</span>
                ))}
                <span style={{ width: "44px", flex: "none", textAlign: "right", fontSize: "11px", fontWeight: 800, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>41</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", flexWrap: "wrap", marginTop: "16px", paddingTop: "14px", borderTop: "1px solid rgba(30,41,59,.9)" }}>
              <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
                {[
                  ["rgba(52,211,153,.08)", "rgba(52,211,153,.25)", "Clear"],
                  ["rgba(251,191,36,.12)", "rgba(251,191,36,.3)", "1–2 findings"],
                  ["rgba(248,113,113,.14)", "rgba(248,113,113,.32)", "3–4"],
                  ["rgba(248,113,113,.3)", "rgba(248,113,113,.55)", "5+"],
                ].map(([bg, bd, label]) => (
                  <span key={label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
                    <span style={{ width: "11px", height: "11px", borderRadius: "4px", background: bg, border: `1px solid ${bd}` }} />
                    {label}
                  </span>
                ))}
                <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "999px", background: "#f87171" }} />Contains gate blockers
                </span>
              </div>
              <Link href="/scan" style={{ fontSize: "12px", fontWeight: 700, color: "#60a5fa", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                Map your own tenant free <ArrowRight size={13} sw={2} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Configuration drift */}
      <section
        style={{
          padding: "40px 32px 46px",
          background:
            "linear-gradient(180deg, rgba(5,13,30,0) 0%, #050d1e 16%, #050d1e 84%, rgba(5,13,30,0) 100%), radial-gradient(circle 900px at 20% 0%, rgba(139,92,246,.05), rgba(2,6,23,0) 60%)",
        }}
      >
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#60a5fa" }}>Configuration drift</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>The audit was February. It’s August.</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              A tenant is not a building; it doesn’t stay inspected. Admins make exceptions, licences change what features do, and Microsoft ships new defaults into your configuration all year. Two identical tenants, one watched hourly, one reviewed annually:
            </p>
          </div>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ flex: "2.2 1 460px", minWidth: 0, border: "1px solid rgba(30,41,59,.95)", borderRadius: "18px", background: "#0b1524", padding: "20px 22px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>Posture score over 12 months · illustrative</span>
                <div style={{ display: "flex", gap: "14px" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
                    <span style={{ width: "16px", height: "2px", background: "#60a5fa", borderRadius: "2px" }} />Monitored hourly
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
                    <span style={{ width: "16px", height: "2px", background: "#f87171", borderRadius: "2px" }} />Reviewed annually
                  </span>
                </div>
              </div>
              <svg viewBox="0 0 640 200" style={{ width: "100%", height: "auto", display: "block" }}>
                <line x1="40" y1="15" x2="620" y2="15" stroke="rgba(148,163,184,.08)" />
                <line x1="40" y1="47" x2="620" y2="47" stroke="rgba(148,163,184,.08)" />
                <line x1="40" y1="79" x2="620" y2="79" stroke="rgba(148,163,184,.08)" />
                <line x1="40" y1="111" x2="620" y2="111" stroke="rgba(148,163,184,.08)" />
                <line x1="40" y1="143" x2="620" y2="143" stroke="rgba(148,163,184,.08)" />
                <line x1="40" y1="175" x2="620" y2="175" stroke="rgba(148,163,184,.15)" />
                <text x="32" y="18" textAnchor="end" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">100</text>
                <text x="32" y="50" textAnchor="end" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">80</text>
                <text x="32" y="82" textAnchor="end" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">60</text>
                <text x="32" y="114" textAnchor="end" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">40</text>
                <text x="32" y="146" textAnchor="end" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">20</text>
                <line x1="40" y1="43.8" x2="620" y2="43.8" stroke="#34d399" strokeWidth="1.2" strokeDasharray="5 4" opacity=".7" />
                <text x="616" y="40" textAnchor="end" fill="#34d399" fontSize="9.5" fontWeight="700" fontFamily="Inter,system-ui,sans-serif">the 82 gate</text>
                <line x1="303.6" y1="15" x2="303.6" y2="175" stroke="rgba(251,191,36,.35)" strokeWidth="1" strokeDasharray="3 4" />
                <text x="308" y="168" textAnchor="start" fill="#fbbf24" fontSize="9" fontFamily="Inter,system-ui,sans-serif">a vendor default changes upstream</text>
                <path d="M40,40.6 L92.7,48.6 L145.5,47 L198.2,59.8 L250.9,63 L303.6,77.4 L356.4,75.8 L409.1,88.6 L461.8,95 L514.5,101.4 L567.3,104.6 L620,109.4 L620,175 L40,175 Z" fill="rgba(248,113,113,.1)" />
                <polyline points="40,40.6 92.7,48.6 145.5,47 198.2,59.8 250.9,63 303.6,77.4 356.4,75.8 409.1,88.6 461.8,95 514.5,101.4 567.3,104.6 620,109.4" fill="none" stroke="#f87171" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                <polyline points="40,40.6 92.7,37.4 145.5,42.2 198.2,35.4 250.9,38.6 303.6,33.8 356.4,37 409.1,32.6 461.8,35.8 514.5,31 567.3,34.2 620,29.4" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                <circle cx="620" cy="29.4" r="3" fill="#60a5fa" />
                <circle cx="620" cy="109.4" r="3" fill="#f87171" />
                <text x="611" y="26" textAnchor="end" fill="#60a5fa" fontSize="10.5" fontWeight="800" fontFamily="Inter,system-ui,sans-serif">91</text>
                <text x="611" y="122" textAnchor="end" fill="#f87171" fontSize="10.5" fontWeight="800" fontFamily="Inter,system-ui,sans-serif">41</text>
                <text x="40" y="190" textAnchor="start" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">Q1</text>
                <text x="198.2" y="190" textAnchor="middle" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">Q2</text>
                <text x="356.4" y="190" textAnchor="middle" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">Q3</text>
                <text x="514.5" y="190" textAnchor="middle" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">Q4</text>
              </svg>
              <p style={{ margin: "10px 0 4px", fontSize: "11.5px", color: "#64748b", lineHeight: 1.6 }}>
                Both tenants start at 84. The difference isn’t discipline — it’s that one of them finds out the same hour something moves, and the other finds out at the next audit.
              </p>
            </div>
            <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 }}>
              {[
                ["158 checks", "in the free scan — a point-in-time read of all six pillars."],
                ["129 checks", "re-run continuously on Monitoring Growth, with one-click runbooks when one fails."],
                ["6 engines", "drift, security, health, SLA, scope creep and sales offer — each watching a different way tenants go wrong."],
              ].map(([n, body]) => (
                <div key={n} style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px" }}>
                  <div style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-.02em", color: "#f8fafc", fontVariantNumeric: "tabular-nums" }}>{n}</div>
                  <div style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, marginTop: "3px" }}>{body}</div>
                </div>
              ))}
              <div style={{ border: "1px solid rgba(59,130,246,.3)", borderRadius: "14px", background: "rgba(59,130,246,.06)", padding: "16px 18px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0", marginBottom: "8px" }}>How long can a finding live in your tenant?</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                  {[
                    ["Annual audit", "100%", "#f87171", "365 days"],
                    ["Quarterly review", "25%", "#fbbf24", "90 days"],
                    ["Hourly checks", "3%", "#34d399", "< 1 day"],
                  ].map(([label, w, color, val]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ width: "86px", flex: "none", fontSize: "10.5px", color: "#94a3b8" }}>{label}</span>
                      <div style={{ flex: 1, height: "8px", borderRadius: "999px", background: "rgba(2,6,23,.6)", overflow: "hidden" }}>
                        <div style={{ width: w, height: "100%", borderRadius: "999px", background: color }} />
                      </div>
                      <span style={{ width: "52px", flex: "none", textAlign: "right", fontSize: "10.5px", fontWeight: 700, color }}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginTop: "20px", border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 20px" }}>
            <div style={{ display: "flex", gap: "22px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "12.5px", color: "#cbd5e1" }}><b style={{ color: "#f8fafc" }}>Foundation</b> · 30 checks &amp; risk register</span>
              <span style={{ fontSize: "12.5px", color: "#cbd5e1" }}><b style={{ color: "#f8fafc" }}>Growth</b> · 129 checks, runbooks, SOP library</span>
              <span style={{ fontSize: "12.5px", color: "#cbd5e1" }}><b style={{ color: "#f8fafc" }}>Premier</b> · everything, plus change control &amp; security plan</span>
              <span style={{ fontSize: "11.5px", color: "#64748b" }}>From $180/mo, priced per seat</span>
            </div>
            <Link href="/monitoring" style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "10px 18px", borderRadius: "10px", fontSize: "12.5px", fontWeight: 700, color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }}>
              See Monitoring Pricing <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* Inside the portal */}
      <section style={{ padding: "44px 32px 44px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#a78bfa" }}>Inside the portal</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>
              After purchase, security stops being a report. It becomes a system of record.
            </h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Every customer gets the Portal — where the security pillar is scored continuously and the paperwork an auditor asks for maintains itself: a risk register with owners and review dates, a security plan, policy decisions, and a log of what changed and who approved it.
            </p>
          </div>
          <div style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "18px", background: "#0b1524", overflow: "hidden", marginBottom: "18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 16px", borderBottom: "1px solid rgba(30,41,59,.9)", background: "rgba(2,6,23,.5)" }}>
              <span style={{ width: "9px", height: "9px", borderRadius: "999px", background: "rgba(148,163,184,.25)" }} />
              <span style={{ width: "9px", height: "9px", borderRadius: "999px", background: "rgba(148,163,184,.25)" }} />
              <span style={{ width: "9px", height: "9px", borderRadius: "999px", background: "rgba(148,163,184,.25)" }} />
              <span style={{ marginLeft: "8px", fontSize: "10.5px", color: "#475569", fontWeight: 600 }}>portal.shanemccaw.com — your tenant, after onboarding</span>
            </div>
            <div style={{ display: "flex", alignItems: "stretch", minHeight: "280px" }}>
              <div style={{ width: "190px", flex: "none", borderRight: "1px solid rgba(30,41,59,.9)", background: "rgba(2,6,23,.35)", padding: "14px 10px", flexDirection: "column", gap: "2px", display: "flex" }}>
                <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#475569", padding: "0 8px 6px" }}>Operate</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Change Control</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Active Runbooks</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Remediation Tracker</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Policy Decisions</span>
                <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#475569", padding: "10px 8px 6px" }}>Governance</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 700, color: "#f8fafc", background: "rgba(139,92,246,.14)", border: "1px solid rgba(139,92,246,.3)" }}>Risk Register</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Security Plan</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>PII Governance</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ border: "1px solid rgba(248,113,113,.3)", borderRadius: "11px", background: "rgba(248,113,113,.06)", padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "999px", background: "#f87171", flex: "none", animation: "secPulse 2.2s ease-in-out infinite" }} />
                  <div style={{ flex: 1, minWidth: "200px" }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>A new Global Admin was added outside your approval workflow</div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>Detected 3 hours ago — unapproved additions are the leading cause of account takeover.</div>
                  </div>
                  <span style={{ flex: "none", padding: "7px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 700, color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }}>Fix with runbook</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>Risk register · accepted risks, each with an owner and a review date</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                  {RISK_ROWS.map((rr) => (
                    <div key={rr.risk} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px", border: "1px solid rgba(30,41,59,.9)", borderRadius: "10px", background: "rgba(2,6,23,.35)", flexWrap: "wrap" }}>
                      <span style={{ flex: 1, minWidth: "220px", fontSize: "12px", fontWeight: 600, color: "#e2e8f0" }}>{rr.risk}</span>
                      <span style={{ flex: "none", fontSize: "11px", color: "#94a3b8" }}>Owner · <b style={{ color: "#cbd5e1" }}>{rr.owner}</b></span>
                      <span style={{ flex: "none", fontSize: "11px", color: "#94a3b8" }}>Review {rr.review}</span>
                      <span
                        style={{
                          flex: "none",
                          whiteSpace: "nowrap",
                          padding: "4px 10px",
                          borderRadius: "999px",
                          fontSize: "10px",
                          fontWeight: 700,
                          ...(rr.due
                            ? { background: "rgba(248,113,113,.12)", border: "1px solid rgba(248,113,113,.35)", color: "#f87171" }
                            : { background: "rgba(52,211,153,.08)", border: "1px solid rgba(52,211,153,.25)", color: "#34d399" }),
                        }}
                      >
                        {rr.state}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "10.5px", color: "#475569" }}>Nothing on this list is forgotten: when a review date passes, the item badges the nav until someone deals with it.</div>
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

      <PillarPeerStrip
        active="security"
        deeper={[
          { label: "SharePoint", href: "/solutions/sharepoint" },
          { label: "Copilot & AI", href: "/solutions/copilot" },
          { label: "Governance projects", href: "/solutions/governance" },
        ]}
      />

      {/* Architect retainers band */}
      <section style={{ padding: "36px 32px 48px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto", border: "1px solid rgba(139,92,246,.3)", borderRadius: "18px", background: "#0b1524", padding: "28px", display: "flex", gap: "28px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1.4 1 340px", minWidth: 0 }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#a78bfa" }}>Architect retainers</span>
            <h2 style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>Charts don’t fix tenants. A named architect does.</h2>
            <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Monitoring tells you the moment your posture moves. A retainer is the senior person who reads it with you — chairs the monthly security review, decides which findings become projects, and signs the changes that touch Conditional Access before they ship.
            </p>
          </div>
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "8px" }}>
            {[
              ["Architect Essentials", "$1,500", "8 hrs", false],
              ["Architect Growth", "$3,000", "16 hrs", true],
              ["Architect Enterprise", "$5,500", "30 hrs", false],
            ].map(([name, price, hrs, hot]) => (
              <div
                key={name as string}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "11px 14px",
                  borderRadius: "10px",
                  border: hot ? "1px solid rgba(139,92,246,.4)" : "1px solid rgba(30,41,59,.9)",
                  background: hot ? "rgba(139,92,246,.07)" : "rgba(2,6,23,.4)",
                }}
              >
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>{name}</span>
                <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                  <b style={{ color: "#e2e8f0" }}>{price}</b>/mo · {hrs}
                </span>
              </div>
            ))}
            <Link href="/retainers" style={{ marginTop: "6px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "7px", padding: "11px", borderRadius: "10px", fontSize: "13px", fontWeight: 700, color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }}>
              See Retainer Tiers <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      <ScanToScopedWork
        accent="rgba(139,92,246,.05)"
        intro="Four steps, one continuous path. The free scan reads your actual tenant. The pricing engine turns those findings into a scoped, priced statement of work — and every chart on this page becomes yours, with real numbers in it."
      />
    </MarketingLayout>
  );
}
