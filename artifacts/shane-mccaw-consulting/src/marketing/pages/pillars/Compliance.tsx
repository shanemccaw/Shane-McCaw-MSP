import { Link } from "wouter";
import { MarketingLayout } from "../../components/MarketingLayout";
import { ArrowRight, PillarPeerStrip, ScanToScopedWork } from "../../components/pillar/PillarShared";

// Route /pillars/compliance — recreated from Design/design_handoff_marketing/
// Marketing Pillar - Compliance.dc.html. Colour #e2e8f0, watermark scales. Copy verbatim; data
// is the design's own renderVals() illustrative fixture.

function chipStyle(lit: boolean): React.CSSProperties {
  return {
    padding: "5px 10px",
    borderRadius: "999px",
    fontSize: "10.5px",
    fontWeight: 700,
    whiteSpace: "nowrap",
    ...(lit
      ? { background: "rgba(52,211,153,.1)", border: "1px solid rgba(52,211,153,.3)", color: "#34d399" }
      : { background: "rgba(148,163,184,.06)", border: "1px solid rgba(148,163,184,.15)", color: "#475569" }),
  };
}

const FRAMEWORKS: { name: string; note: string; chips: { label: string; lit: boolean }[] }[] = [
  {
    name: "CIS Microsoft 365 Foundations v3.1",
    note: "The benchmark most MSP audits are cut against.",
    chips: [{ label: "Level 1", lit: true }, { label: "Level 2", lit: false }],
  },
  {
    name: "NIST CSF 2.0",
    note: "Functions covered by tenant telemetry and the six engines.",
    chips: [
      { label: "Identify", lit: true },
      { label: "Protect", lit: true },
      { label: "Detect", lit: true },
      { label: "Respond", lit: false },
      { label: "Recover", lit: false },
    ],
  },
  {
    name: "ISO 27001:2022 Annex A",
    note: "Technical controls evidenced from configuration state.",
    chips: [{ label: "Tech controls", lit: true }, { label: "Org controls", lit: false }],
  },
  {
    name: "Cyber Essentials",
    note: "All five themes touch settings the checks already read.",
    chips: [
      { label: "Firewalls", lit: true },
      { label: "Secure config", lit: true },
      { label: "Access control", lit: true },
      { label: "Malware", lit: true },
      { label: "Patching", lit: true },
    ],
  },
];

const PII_ROWS: { where: string; what: string; reach: string; reachColor: string }[] = [
  { where: "HR site · Employee files", what: "2,400 files · national ID numbers", reach: "61 people · 3 external", reachColor: "#f87171" },
  { where: "Finance · Payroll exports", what: "380 files · bank details", reach: "9 people · 0 external", reachColor: "#34d399" },
  { where: "Sales · Signed contracts", what: "1,150 files · names, addresses", reach: "212 people · 14 external", reachColor: "#fbbf24" },
];

const TIER_STYLE: Record<string, React.CSSProperties> = {
  "All customers": { background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.3)", color: "#4ade80" },
  Premier: { background: "rgba(139,92,246,.12)", border: "1px solid rgba(139,92,246,.35)", color: "#a78bfa" },
};

const PORTAL_MODULES: { name: string; tier: string; body: string }[] = [
  { name: "Risk Register", tier: "All customers", body: "Accepted risks with the owner and the review date — the list your auditor asks for first, kept current by the platform." },
  { name: "Policy Decisions", tier: "Premier", body: "The gaps you’ve decided to live with, recorded with an owner and a review date — badging the nav when a review lapses." },
  { name: "PII Governance", tier: "Premier", body: "Where personal data lives, who can reach it, and what moved — with every widening of reach recorded as an event." },
  { name: "Security Plan", tier: "Premier", body: "The authoritative record of how this tenant must be run — the document your controls are measured against." },
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

const evidenceCardBg = "linear-gradient(160deg,rgba(226,232,240,.09),rgba(11,21,36,.52) 55%,rgba(11,21,36,.34))";

export default function PillarCompliance() {
  return (
    <MarketingLayout current="watch">
      {/* Hero */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "48px 32px 30px",
          background:
            "radial-gradient(circle 1100px at 76% -20%, rgba(226,232,240,.11), rgba(2,6,23,0) 62%), radial-gradient(circle 780px at 6% 10%, rgba(226,232,240,.05), rgba(2,6,23,0) 66%)",
        }}
      >
        <span style={{ position: "absolute", right: "-90px", top: "-70px", opacity: 0.035, pointerEvents: "none", lineHeight: 0 }}>
          <svg width="520" height="520" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v18" />
            <path d="M5 7h14" />
            <path d="M5 7l-2 6h4z" />
            <path d="M19 7l2 6h-4z" />
            <path d="M8 21h8" />
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
                background: "rgba(226,232,240,.08)",
                border: "1px solid rgba(226,232,240,.22)",
                color: "#e2e8f0",
                fontSize: "10.5px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".1em",
                marginBottom: "18px",
              }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18" />
                <path d="M5 7l7-4 7 4" />
                <path d="M3 12h4l-2 5a3 3 0 004 0z" />
                <path d="M17 12h4l-2 5a3 3 0 004 0z" transform="translate(-4 0)" />
              </svg>{" "}
              Pillar 03 · Compliance
            </span>
            <h1 style={{ fontSize: "clamp(30px,3.4vw,40px)", fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.12, color: "#f8fafc", margin: "0 0 16px", textWrap: "pretty" } as React.CSSProperties}>
              Your auditor doesn’t want a promise. They want a timestamp.
            </h1>
            <p style={{ fontSize: "15px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 12px", maxWidth: "54ch" }}>
              Every check the platform runs is stored as evidence: the control, the state it was in, and the moment it changed. When the auditor asks how long MFA has been enforced for admins, the answer is a date — not a meeting, not a screenshot hunt, not a promise.
            </p>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.7, margin: "0 0 24px", maxWidth: "54ch" }}>
              The card alongside is what one control looks like as evidence.
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
              {["Time-stamped evidence", "Living risk register", "PII mapped to people"].map((t) => (
                <span key={t} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#64748b" }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "999px", background: "#34d399" }} />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Two stacked evidence cards */}
          <div style={{ flex: "1 1 360px", maxWidth: "470px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ border: "1px solid rgba(226,232,240,.22)", borderRadius: "16px", background: evidenceCardBg, backdropFilter: "blur(3px)", boxShadow: "0 0 50px rgba(226,232,240,.10), inset 0 1px 0 rgba(148,163,184,.08)", padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>One control, as evidence</span>
                <span style={{ flex: "none", padding: "4px 10px", borderRadius: "999px", fontSize: "10px", fontWeight: 700, background: "rgba(52,211,153,.08)", border: "1px solid rgba(52,211,153,.25)", color: "#34d399", whiteSpace: "nowrap" }}>Enforced</span>
              </div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc", marginBottom: "10px" }}>MFA required for all administrative roles</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                {[
                  ["Checked", "Every hour · last 22 minutes ago", "#cbd5e1"],
                  ["In this state since", "14 March 2026, 09:12 UTC", "#cbd5e1"],
                  ["Enforced by", "Conditional Access · CA-004", "#cbd5e1"],
                  ["Maps to", "CIS 1.1.3 · NIST PR.AA · ISO A.8.5", "#cbd5e1"],
                  ["Exceptions", "2 break-glass accounts · on the risk register", "#fbbf24"],
                ].map(([k, v, color]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "11.5px" }}>
                    <span style={{ color: "#64748b" }}>{k}</span>
                    <span style={{ color, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ border: "1px solid rgba(226,232,240,.22)", borderRadius: "16px", background: evidenceCardBg, backdropFilter: "blur(3px)", boxShadow: "0 0 50px rgba(226,232,240,.10), inset 0 1px 0 rgba(148,163,184,.08)", padding: "16px 20px" }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>The difference</span>
              <div style={{ display: "flex", gap: "14px", marginTop: "10px", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: "150px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#f87171", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: "4px" }}>Audit season</div>
                  <div style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6 }}>Three weeks of screenshots, exports and “who changed this?” — evidence assembled after the fact.</div>
                </div>
                <div style={{ flex: 1, minWidth: "150px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#34d399", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: "4px" }}>Continuous evidence</div>
                  <div style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6 }}>The export already exists, current to the last hourly check. Audit season becomes a download.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Framework mapping */}
      <section
        style={{
          padding: "40px 32px 46px",
          background:
            "linear-gradient(180deg, rgba(5,13,30,0) 0%, #050d1e 16%, #050d1e 84%, rgba(5,13,30,0) 100%), radial-gradient(circle 900px at 20% 0%, rgba(226,232,240,.05), rgba(2,6,23,0) 60%)",
        }}
      >
        <div style={{ maxWidth: "1120px", margin: "0 auto", display: "flex", gap: "40px", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 320px", minWidth: 0, maxWidth: "430px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#e2e8f0" }}>Framework mapping</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 12px" }}>Checks that speak your assessor’s language.</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 12px" }}>
              Every check is mapped to the frameworks assessors actually use, so the evidence export reads in their vocabulary, not ours. One tenant state, four framework views of it.
            </p>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.7, margin: 0 }}>
              Lit chips are covered by mapped checks today; dimmed ones are on the platform roadmap or owned by processes outside the tenant.
            </p>
          </div>
          <div style={{ flex: "1.4 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
            {FRAMEWORKS.map((fw) => (
              <div key={fw.name} style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#f8fafc" }}>{fw.name}</div>
                  <div style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, marginTop: "3px" }}>{fw.note}</div>
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {fw.chips.map((ch) => (
                    <span key={ch.label} style={chipStyle(ch.lit)}>{ch.label}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Inside the portal — PII governance */}
      <section style={{ padding: "44px 32px 44px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#a78bfa" }}>Inside the portal</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>
              Where personal data lives, who can reach it, and what moved.
            </h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              PII Governance maps personal data across the tenant and ties it to reachability — not “we have a policy” but “2,400 files with national ID numbers, 61 people can open them, 3 of those are external”. Alongside it: the risk register and the policy decisions that make exceptions auditable.
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
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Remediation Tracker</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>
                  Policy Decisions{" "}
                  <span style={{ display: "inline-flex", marginLeft: "4px", padding: "1px 6px", borderRadius: "999px", fontSize: "9px", fontWeight: 800, background: "rgba(248,113,113,.15)", border: "1px solid rgba(248,113,113,.4)", color: "#f87171" }}>2 due</span>
                </span>
                <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#475569", padding: "10px 8px 6px" }}>Governance</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Ownership</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Risk Register</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8" }}>Security Plan</span>
                <span style={{ padding: "7px 8px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 700, color: "#f8fafc", background: "rgba(226,232,240,.1)", border: "1px solid rgba(226,232,240,.25)" }}>
                  PII Governance{" "}
                  <span style={{ display: "inline-flex", marginLeft: "4px", padding: "1px 6px", borderRadius: "999px", fontSize: "9px", fontWeight: 800, background: "rgba(251,191,36,.15)", border: "1px solid rgba(251,191,36,.4)", color: "#fbbf24" }}>1</span>
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ border: "1px solid rgba(251,191,36,.3)", borderRadius: "11px", background: "rgba(251,191,36,.05)", padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "999px", background: "#fbbf24", flex: "none" }} />
                  <div style={{ flex: 1, minWidth: "200px" }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>A folder with 214 scanned passports became reachable by a new group</div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>Detected this morning — a permission inheritance change on the HR site widened access from 9 people to 61.</div>
                  </div>
                  <span style={{ flex: "none", padding: "7px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 700, color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }}>Review the change</span>
                </div>
                <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>PII governance · where personal data lives</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                  {PII_ROWS.map((pr) => (
                    <div key={pr.where} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px", border: "1px solid rgba(30,41,59,.9)", borderRadius: "10px", background: "rgba(2,6,23,.35)", flexWrap: "wrap" }}>
                      <span style={{ flex: 1, minWidth: "190px", fontSize: "12px", fontWeight: 600, color: "#e2e8f0" }}>{pr.where}</span>
                      <span style={{ flex: "none", fontSize: "11px", color: "#94a3b8" }}>{pr.what}</span>
                      <span style={{ flex: "none", fontSize: "11px", color: "#94a3b8" }}>reach · <b style={{ color: pr.reachColor }}>{pr.reach}</b></span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "10.5px", color: "#475569" }}>
                  Every widening of reach is an event: who, when, through which permission change — feeding the risk register when you accept it, and a runbook when you don’t.
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

      {/* Retainer band */}
      <section style={{ padding: "0 32px 48px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto", border: "1px solid rgba(139,92,246,.3)", borderRadius: "18px", background: "#0b1524", padding: "28px", display: "flex", gap: "28px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1.4 1 340px", minWidth: 0 }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#a78bfa" }}>Who runs this with you</span>
            <h2 style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>The register stays honest because someone is paid to read it.</h2>
            <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Risk register comes with every Monitoring tier; policy decisions, the security plan and PII governance come with <b style={{ color: "#e2e8f0" }}>Premier</b>. A retainer adds the named architect who walks the register with your auditor and answers for the exceptions.
            </p>
          </div>
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "11px 14px", border: "1px solid rgba(30,41,59,.9)", borderRadius: "10px", background: "rgba(2,6,23,.4)" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Monitoring Premier</span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>policy decisions · security plan · PII</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "11px 14px", border: "1px solid rgba(139,92,246,.4)", borderRadius: "10px", background: "rgba(139,92,246,.07)" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Architect retainer</span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>from <b style={{ color: "#e2e8f0" }}>$1,500</b>/mo · 8, 16 or 30 hrs</span>
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
        active="compliance"
        deeper={[
          { label: "Governance projects", href: "/solutions/governance" },
          { label: "SharePoint", href: "/solutions/sharepoint" },
          { label: "Copilot & AI", href: "/solutions/copilot" },
        ]}
      />

      <ScanToScopedWork
        accent="rgba(226,232,240,.05)"
        intro="The free scan reads your actual tenant — including what an auditor would find. Findings become a scoped, priced statement of work, and the evidence trail starts the day monitoring turns on."
      />
    </MarketingLayout>
  );
}
