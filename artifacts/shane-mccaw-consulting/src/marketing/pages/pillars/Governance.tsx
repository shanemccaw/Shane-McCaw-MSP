import { Link } from "wouter";
import { MarketingLayout } from "../../components/MarketingLayout";
import { ArrowRight, PillarPeerStrip, ScanToScopedWork } from "../../components/pillar/PillarShared";

// Route /pillars/governance — recreated from Design/design_handoff_marketing/
// Marketing Pillar - Governance.dc.html. Colour #3b82f6, watermark shield-check. Copy is
// final and verbatim; the data below is the design's own renderVals() illustrative fixture.

// The RACI matrix from the hero: fourteen-services-worth cut down to six, four seats each
// (Responsible / Accountable / Consulted / Informed). An empty seat reads "—" in red.
const RACI_ROWS: { name: string; seats: (string | null)[] }[] = [
  { name: "Exchange", seats: ["IT Ops", null, "Security", "Helpdesk"] },
  { name: "SharePoint", seats: ["IT Ops", "IT Director", null, null] },
  { name: "Teams", seats: ["IT Ops", null, null, "Helpdesk"] },
  { name: "Entra ID", seats: ["MSP", "IT Director", "Security", "CFO"] },
  { name: "Purview", seats: [null, null, null, null] },
  { name: "Copilot", seats: [null, null, "Legal", null] },
];

const FUNNEL: { label: string; value: number; pct: number; color: string }[] = [
  { label: "Requested", value: 28, pct: 100, color: "#60a5fa" },
  { label: "Approved", value: 23, pct: 82, color: "#3b82f6" },
  { label: "Applied", value: 21, pct: 75, color: "#8b5cf6" },
  { label: "Verified", value: 19, pct: 68, color: "#34d399" },
];

const OWN_ROWS: { obj: string; r: string; a: string; c: string; i: string; aColor: string }[] = [
  { obj: "Exchange Online", r: "IT Ops", a: "IT Director", c: "Security", i: "Helpdesk", aColor: "#cbd5e1" },
  { obj: "Freeze window · Year end", r: "MSP", a: "CFO", c: "IT Ops", i: "All staff", aColor: "#cbd5e1" },
  { obj: "Copilot for Microsoft 365", r: "— unassigned", a: "— unassigned", c: "Legal", i: "—", aColor: "#f87171" },
];

const TIER_STYLE: Record<string, React.CSSProperties> = {
  Premier: { background: "rgba(139,92,246,.12)", border: "1px solid rgba(139,92,246,.35)", color: "#a78bfa" },
  Retainer: { background: "rgba(59,130,246,.1)", border: "1px solid rgba(59,130,246,.3)", color: "#60a5fa" },
};

const PORTAL_MODULES: { name: string; tier: string; body: string }[] = [
  {
    name: "Ownership (RACI)",
    tier: "Premier",
    body: "The four names against every service, change, control, freeze, incident and announcement — with empty seats surfaced, not hidden.",
  },
  {
    name: "Change Control",
    tier: "Premier",
    body: "Briefing, register, pre-approved catalogue, freeze calendar and change review — every change with a request, an approval and a rollback point.",
  },
  {
    name: "Policy Decisions",
    tier: "Premier",
    body: "The gaps you’ve decided to live with, recorded with an owner and a review date — so “accepted” never quietly becomes “forgotten”.",
  },
  {
    name: "My Architect",
    tier: "Retainer",
    body: "A named architect who chairs the change review and owns the governance calendar with you — hours logged against real work.",
  },
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

const calIcon = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="3" x2="8" y2="7" />
    <line x1="16" y1="3" x2="16" y2="7" />
  </svg>
);

export default function PillarGovernance() {
  return (
    <MarketingLayout current="watch">
      {/* Hero */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "48px 32px 30px",
          background:
            "radial-gradient(circle 1100px at 76% -20%, rgba(59,130,246,.11), rgba(2,6,23,0) 62%), radial-gradient(circle 780px at 6% 10%, rgba(59,130,246,.05), rgba(2,6,23,0) 66%)",
        }}
      >
        <span style={{ position: "absolute", right: "-90px", top: "-70px", opacity: 0.035, pointerEvents: "none", lineHeight: 0 }}>
          <svg width="520" height="520" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
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
                <polyline points="9 12 11 14 15 10" />
              </svg>{" "}
              Pillar 01 · Governance
            </span>
            <h1 style={{ fontSize: "clamp(30px,3.4vw,40px)", fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.12, color: "#f8fafc", margin: "0 0 16px", textWrap: "pretty" } as React.CSSProperties}>
              Ask who owns Exchange. Watch the room go quiet.
            </h1>
            <p style={{ fontSize: "15px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 12px", maxWidth: "54ch" }}>
              Governance is four names against every service, change, control and freeze window: who does the work, who answers for it, who gets consulted, who gets told. In most tenants those seats are empty — and every unowned setting drifts until it becomes an incident.
            </p>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.7, margin: "0 0 24px", maxWidth: "54ch" }}>
              The matrix alongside is a typical first scan: fourteen services, and the accountable seat filled for five of them.
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
              {["RACI on every object", "Change control with rollback points", "Freeze calendar"].map((t) => (
                <span key={t} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#64748b" }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "999px", background: "#34d399" }} />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Ownership matrix artefact card */}
          <div
            style={{
              flex: "1 1 380px",
              maxWidth: "500px",
              border: "1px solid rgba(59,130,246,.22)",
              borderRadius: "18px",
              background: "linear-gradient(160deg,rgba(59,130,246,.10),rgba(11,21,36,.52) 55%,rgba(11,21,36,.34))",
              backdropFilter: "blur(3px)",
              boxShadow: "0 0 60px rgba(59,130,246,.13), inset 0 1px 0 rgba(148,163,184,.08)",
              padding: "22px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>Ownership matrix · first scan</span>
              <span style={{ fontSize: "9.5px", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#475569" }}>Illustrative</span>
            </div>
            <div style={{ display: "flex", gap: "6px", marginBottom: "7px" }}>
              <span style={{ width: "104px", flex: "none" }} />
              {["R", "A", "C", "I"].map((h) => (
                <span key={h} style={{ flex: 1, textAlign: "center", fontSize: "9.5px", fontWeight: 700, letterSpacing: ".12em", color: "#64748b" }}>
                  {h}
                </span>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {RACI_ROWS.map((row) => (
                <div key={row.name} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <span style={{ width: "104px", flex: "none", fontSize: "11.5px", fontWeight: 600, color: "#cbd5e1" }}>{row.name}</span>
                  {row.seats.map((seat, i) => {
                    const empty = !seat;
                    return (
                      <span
                        key={i}
                        style={{
                          flex: 1,
                          height: "34px",
                          borderRadius: "8px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "10.5px",
                          fontWeight: 700,
                          ...(empty
                            ? { background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.3)", color: "#f87171" }
                            : { background: "rgba(52,211,153,.06)", border: "1px solid rgba(52,211,153,.2)", color: "#a7f3d0" }),
                        }}
                      >
                        {empty ? "—" : seat}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginTop: "12px", paddingTop: "11px", borderTop: "1px solid rgba(30,41,59,.9)" }}>
              {[
                ["R", "Responsible — does the work"],
                ["A", "Accountable — answers for it when it breaks"],
                ["C", "Consulted — asked before it changes"],
                ["I", "Informed — told after it changes"],
              ].map(([k, v]) => (
                <span key={k} style={{ display: "flex", gap: "8px", fontSize: "10.5px", color: "#94a3b8", lineHeight: 1.5 }}>
                  <b style={{ flex: "none", width: "11px", fontWeight: 800, color: "#cbd5e1" }}>{k}</b>
                  {v}
                </span>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "14px", paddingTop: "12px", borderTop: "1px solid rgba(30,41,59,.9)" }}>
              <b style={{ fontSize: "17px", fontWeight: 800, color: "#f87171", whiteSpace: "nowrap", flex: "none", fontVariantNumeric: "tabular-nums" }}>12 of 24</b>
              <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5 }}>seats empty across six services. Nobody is accountable for Copilot at all.</span>
            </div>
          </div>
        </div>
      </section>

      {/* Change control band */}
      <section
        style={{
          padding: "40px 32px 46px",
          background:
            "linear-gradient(180deg, rgba(5,13,30,0) 0%, #050d1e 16%, #050d1e 84%, rgba(5,13,30,0) 100%), radial-gradient(circle 900px at 20% 0%, rgba(59,130,246,.05), rgba(2,6,23,0) 60%)",
        }}
      >
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#60a5fa" }}>Change control</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>
              Every change gets a request, an approval and a rollback point. Or it doesn’t happen.
            </h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Not bureaucracy — a paper trail. When something breaks at 2am, the register tells you what changed, who approved it and exactly how to put it back. This quarter, in the Portal’s illustrative tenant:
            </p>
          </div>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ flex: "1.6 1 420px", minWidth: 0, border: "1px solid rgba(30,41,59,.95)", borderRadius: "18px", background: "#0b1524", padding: "22px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {FUNNEL.map((f) => (
                  <div key={f.label} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ width: "120px", flex: "none", fontSize: "12px", fontWeight: 600, color: "#cbd5e1", textAlign: "right" }}>{f.label}</span>
                    <div style={{ flex: 1, height: "30px", borderRadius: "8px", background: "rgba(2,6,23,.6)", overflow: "hidden", display: "flex" }}>
                      <div style={{ width: `${f.pct}%`, height: "100%", borderRadius: "8px", background: `linear-gradient(90deg,${f.color}22,${f.color})` }} />
                    </div>
                    <span style={{ width: "80px", flex: "none", fontSize: "12.5px", fontWeight: 800, color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>{f.value}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginTop: "16px", paddingTop: "14px", borderTop: "1px solid rgba(30,41,59,.9)" }}>
                <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>
                  <b style={{ color: "#f87171" }}>2 rolled back</b> — in nine minutes, from the recorded rollback point
                </span>
                <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>
                  <b style={{ color: "#fbbf24" }}>3 rejected</b> — one of them would have broken external sharing for a live tender
                </span>
              </div>
            </div>
            <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>Freeze calendar</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
                  {[
                    ["Quarter close", "29–30 Sep"],
                    ["Year end freeze", "22 Dec – 2 Jan"],
                  ].map(([label, when]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 12px", borderRadius: "9px", background: "rgba(59,130,246,.07)", border: "1px solid rgba(59,130,246,.25)" }}>
                      {calIcon}
                      <span style={{ flex: 1, fontSize: "12px", fontWeight: 600, color: "#e2e8f0" }}>{label}</span>
                      <span style={{ fontSize: "11px", color: "#94a3b8" }}>{when}</span>
                    </div>
                  ))}
                  <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.6 }}>
                    Nothing changes during a freeze — including Microsoft’s waves, which the Health pillar checks against this calendar.
                  </span>
                </div>
              </div>
              <div style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>Pre-approved catalogue</span>
                <p style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6, margin: "8px 0 0" }}>
                  Standard changes — a new starter, a group rename, a guest expiry — run from the catalogue without a review cycle. Governance that moves fast where it’s safe to.
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
              Governance you can point at, not a binder nobody opens.
            </h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              The Portal holds the ownership matrix, the change register and every policy decision — live objects with owners and review dates, not documents. When a seat is empty or a review lapses, it badges the nav until someone deals with it.
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
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Active Runbooks</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>
                  Policy Decisions{" "}
                  <span style={{ display: "inline-flex", marginLeft: "4px", padding: "1px 6px", borderRadius: "999px", fontSize: "9px", fontWeight: 800, background: "rgba(248,113,113,.15)", border: "1px solid rgba(248,113,113,.4)", color: "#f87171" }}>2 due</span>
                </span>
                <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#475569", padding: "10px 8px 6px" }}>Governance</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 700, color: "#f8fafc", background: "rgba(59,130,246,.14)", border: "1px solid rgba(59,130,246,.3)" }}>Ownership</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Risk Register</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Security Plan</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ border: "1px solid rgba(248,113,113,.3)", borderRadius: "11px", background: "rgba(248,113,113,.06)", padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "999px", background: "#f87171", flex: "none" }} />
                  <div style={{ flex: 1, minWidth: "200px" }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>An OAuth app was granted full mailbox access without review</div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>Detected yesterday — no change request exists for this grant.</div>
                  </div>
                  <span style={{ flex: "none", padding: "7px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 700, color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }}>Raise change request</span>
                </div>
                <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>Ownership · the four names against every object</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                  {OWN_ROWS.map((ow) => (
                    <div key={ow.obj} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px", border: "1px solid rgba(30,41,59,.9)", borderRadius: "10px", background: "rgba(2,6,23,.35)", flexWrap: "wrap" }}>
                      <span style={{ flex: 1, minWidth: "150px", fontSize: "12px", fontWeight: 600, color: "#e2e8f0" }}>{ow.obj}</span>
                      <span style={{ flex: "none", fontSize: "11px", color: "#94a3b8" }}>R · <b style={{ color: "#cbd5e1" }}>{ow.r}</b></span>
                      <span style={{ flex: "none", fontSize: "11px", color: "#94a3b8" }}>A · <b style={{ color: ow.aColor }}>{ow.a}</b></span>
                      <span style={{ flex: "none", fontSize: "11px", color: "#94a3b8" }}>C · <b style={{ color: "#cbd5e1" }}>{ow.c}</b></span>
                      <span style={{ flex: "none", fontSize: "11px", color: "#94a3b8" }}>I · <b style={{ color: "#cbd5e1" }}>{ow.i}</b></span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "10.5px", color: "#475569" }}>
                  Ownership extends past services: individual Microsoft changes, change requests, compliance controls, freeze windows, incidents and announcements each carry their own four names.
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

      {/* Retainer / Premier band */}
      <section style={{ padding: "0 32px 48px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto", border: "1px solid rgba(139,92,246,.3)", borderRadius: "18px", background: "#0b1524", padding: "28px", display: "flex", gap: "28px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1.4 1 340px", minWidth: 0 }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#a78bfa" }}>Who runs this with you</span>
            <h2 style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>Governance is a Premier feature and a person, not a PDF.</h2>
            <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Change control, RACI ownership and policy decisions come with <b style={{ color: "#e2e8f0" }}>Monitoring Premier</b>. Add a retainer and a named architect chairs the change review, owns the empty seats until you fill them, and signs anything that touches Conditional Access.
            </p>
          </div>
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "11px 14px", border: "1px solid rgba(30,41,59,.9)", borderRadius: "10px", background: "rgba(2,6,23,.4)" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Monitoring Premier</span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>change control · RACI · security plan · PII</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "11px 14px", border: "1px solid rgba(139,92,246,.4)", borderRadius: "10px", background: "rgba(139,92,246,.07)" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Architect retainer</span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8", whiteSpace: "nowrap" }}>from <b style={{ color: "#e2e8f0" }}>$1,500</b>/mo · 8, 16 or 30 hrs</span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <Link href="/monitoring" style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "11px", borderRadius: "10px", fontSize: "12.5px", fontWeight: 700, color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)", whiteSpace: "nowrap" }}>
                See Monitoring Pricing
              </Link>
              <Link href="/retainers" style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "11px", borderRadius: "10px", fontSize: "12.5px", fontWeight: 700, color: "#cbd5e1", border: "1px solid rgba(148,163,184,.2)", whiteSpace: "nowrap" }}>
                See Retainer Tiers
              </Link>
            </div>
          </div>
        </div>
      </section>

      <PillarPeerStrip
        active="governance"
        deeper={[
          { label: "Governance projects", href: "/solutions/governance" },
          { label: "SharePoint", href: "/solutions/sharepoint" },
          { label: "Teams", href: "/solutions/teams" },
        ]}
      />

      <ScanToScopedWork
        accent="rgba(59,130,246,.05)"
        intro="The free scan reads your actual tenant — including who owns what. Findings become a scoped, priced statement of work, and the ownership matrix on this page becomes yours, with real names in it."
      />
    </MarketingLayout>
  );
}
