import { Link } from "wouter";
import { MarketingLayout } from "../../components/MarketingLayout";
import { ArrowRight, PillarPeerStrip, ScanToScopedWork } from "../../components/pillar/PillarShared";

// Route /pillars/adoption — recreated from Design/design_handoff_marketing/
// Marketing Pillar - Adoption.dc.html. Colour #f97316, watermark users. Copy verbatim; data is
// the design's own renderVals() illustrative fixture.

const USAGE_INPUT: { name: string; pct: number; note: string; tone: "ok" | "mid" | "low" }[] = [
  { name: "Teams meetings", pct: 92, note: "of 1,240 licensed", tone: "ok" },
  { name: "OneDrive", pct: 74, note: "of 1,240 licensed", tone: "ok" },
  { name: "SharePoint", pct: 58, note: "of 1,240 licensed", tone: "mid" },
  { name: "Power BI", pct: 48, note: "of 85 licensed", tone: "mid" },
  { name: "Copilot", pct: 37, note: "of 60 licensed", tone: "low" },
  { name: "Loop", pct: 9, note: "of 1,240 licensed", tone: "low" },
];

const USAGE = USAGE_INPUT.map((u) => {
  const color = u.tone === "ok" ? "#34d399" : u.tone === "mid" ? "#fbbf24" : "#f87171";
  return { ...u, color };
});

const TIER_STYLE: Record<string, React.CSSProperties> = {
  "All customers": { background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.3)", color: "#4ade80" },
  Premier: { background: "rgba(139,92,246,.12)", border: "1px solid rgba(139,92,246,.35)", color: "#a78bfa" },
  Retainer: { background: "rgba(59,130,246,.1)", border: "1px solid rgba(59,130,246,.3)", color: "#60a5fa" },
};

const PORTAL_MODULES: { name: string; tier: string; body: string }[] = [
  { name: "Adoption pillar score", tier: "All customers", body: "Weekly active share per workload, measured against licensed users — the decay caught in week three, not at renewal." },
  { name: "Projects", tier: "All customers", body: "Adoption pushes tracked as real projects — phases, owners, and the curve they’re supposed to bend." },
  { name: "Announcements", tier: "Premier", body: "Users told before anything user-visible changes — drafted, approved and sent from the same feed Health watches." },
  { name: "My Architect", tier: "Retainer", body: "A named architect reads the curve monthly, runs the champions, and answers for the renewal case." },
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

export default function PillarAdoption() {
  return (
    <MarketingLayout current="watch">
      {/* Hero */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "48px 32px 30px",
          background:
            "radial-gradient(circle 1100px at 76% -20%, rgba(249,115,22,.11), rgba(2,6,23,0) 62%), radial-gradient(circle 780px at 6% 10%, rgba(249,115,22,.05), rgba(2,6,23,0) 66%)",
        }}
      >
        <span style={{ position: "absolute", right: "-90px", top: "-70px", opacity: 0.035, pointerEvents: "none", lineHeight: 0 }}>
          <svg width="520" height="520" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9.5" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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
                background: "rgba(249,115,22,.1)",
                border: "1px solid rgba(249,115,22,.28)",
                color: "#fb923c",
                fontSize: "10.5px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".1em",
                marginBottom: "18px",
              }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 17 9 11 13 15 21 7" />
                <polyline points="15 7 21 7 21 13" />
              </svg>{" "}
              Pillar 05 · Adoption
            </span>
            <h1 style={{ fontSize: "clamp(30px,3.4vw,40px)", fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.12, color: "#f8fafc", margin: "0 0 16px", textWrap: "pretty" } as React.CSSProperties}>
              Week one, everyone tried it. Week four, eleven people still use it.
            </h1>
            <p style={{ fontSize: "15px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 12px", maxWidth: "54ch" }}>
              Every rollout has the same curve: a launch-day spike, a polite decay, and a tool nobody opens by the next renewal. Adoption is the pillar that measures the decay while it can still be reversed — and ties what people actually use to what you actually pay.
            </p>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.7, margin: "0 0 24px", maxWidth: "54ch" }}>
              The curve alongside is the illustrative tenant’s Copilot rollout, against the same rollout run as a program.
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "22px" }}>
              <Link href="/scan" style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "12px 22px", borderRadius: "10px", fontWeight: 700, fontSize: "13.5px", color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)", whiteSpace: "nowrap" }}>
                Scan My Tenant · Free <ArrowRight />
              </Link>
              <Link href="/solutions/copilot" style={{ padding: "12px 22px", borderRadius: "10px", fontWeight: 600, fontSize: "13.5px", color: "#cbd5e1", border: "1px solid rgba(148,163,184,.2)", whiteSpace: "nowrap" }}>
                Copilot Deep Dive
              </Link>
            </div>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
              {["Usage per workload, weekly", "Tied to licence spend", "Decay caught early"].map((t) => (
                <span key={t} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#64748b" }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "999px", background: "#34d399" }} />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Adoption curve card */}
          <div style={{ flex: "1 1 380px", maxWidth: "500px", border: "1px solid rgba(30,41,59,.95)", borderRadius: "18px", background: "#0b1524", padding: "20px 22px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>Weekly active users · 12 weeks · illustrative</span>
              <div style={{ display: "flex", gap: "12px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
                  <span style={{ width: "16px", height: "2px", background: "#f87171", borderRadius: "2px" }} />Switched on
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
                  <span style={{ width: "16px", height: "2px", background: "#fb923c", borderRadius: "2px" }} />Run as a program
                </span>
              </div>
            </div>
            <svg viewBox="0 0 440 190" style={{ width: "100%", height: "auto", display: "block" }}>
              <line x1="36" y1="20" x2="424" y2="20" stroke="rgba(148,163,184,.08)" />
              <line x1="36" y1="60" x2="424" y2="60" stroke="rgba(148,163,184,.08)" />
              <line x1="36" y1="100" x2="424" y2="100" stroke="rgba(148,163,184,.08)" />
              <line x1="36" y1="140" x2="424" y2="140" stroke="rgba(148,163,184,.08)" />
              <line x1="36" y1="165" x2="424" y2="165" stroke="rgba(148,163,184,.15)" />
              <text x="30" y="23" textAnchor="end" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">60</text>
              <text x="30" y="63" textAnchor="end" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">45</text>
              <text x="30" y="103" textAnchor="end" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">30</text>
              <text x="30" y="143" textAnchor="end" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">15</text>
              <path d="M36,25 L71.3,49 L106.5,80 L141.8,109 L177.1,127 L212.4,138 L247.6,144 L282.9,148 L318.2,150 L353.5,152 L388.7,153 L424,154 L424,165 L36,165 Z" fill="rgba(248,113,113,.1)" />
              <polyline points="36,25 71.3,49 106.5,80 141.8,109 177.1,127 212.4,138 247.6,144 282.9,148 318.2,150 353.5,152 388.7,153 424,154" fill="none" stroke="#f87171" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              <polyline points="36,133 71.3,117 106.5,104 141.8,94 177.1,82 212.4,73 247.6,62 282.9,55 318.2,47 353.5,42 388.7,38 424,36" fill="none" stroke="#fb923c" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="1 0" />
              <circle cx="424" cy="154" r="3" fill="#f87171" />
              <circle cx="424" cy="36" r="3" fill="#fb923c" />
              <text x="415" y="150" textAnchor="end" fill="#f87171" fontSize="10.5" fontWeight="800" fontFamily="Inter,system-ui,sans-serif">11 of 60</text>
              <text x="415" y="32" textAnchor="end" fill="#fb923c" fontSize="10.5" fontWeight="800" fontFamily="Inter,system-ui,sans-serif">48 of 60</text>
              <text x="36" y="180" textAnchor="start" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">Launch</text>
              <text x="212" y="180" textAnchor="middle" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">Week 6</text>
              <text x="424" y="180" textAnchor="end" fill="#475569" fontSize="9" fontFamily="Inter,system-ui,sans-serif">Week 12</text>
            </svg>
            <p style={{ margin: "8px 0 4px", fontSize: "11.5px", color: "#64748b", lineHeight: 1.6 }}>
              Same licences, same people. The difference is champions, use-cases per team, and someone reading this chart every week — while the seats still have a renewal to justify.
            </p>
          </div>
        </div>
      </section>

      {/* What's actually used */}
      <section
        style={{
          padding: "40px 32px 46px",
          background:
            "linear-gradient(180deg, rgba(5,13,30,0) 0%, #050d1e 16%, #050d1e 84%, rgba(5,13,30,0) 100%), radial-gradient(circle 900px at 20% 0%, rgba(249,115,22,.05), rgba(2,6,23,0) 60%)",
        }}
      >
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#fb923c" }}>What’s actually used</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>You bought a suite. Your staff use a third of it.</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Adoption per workload, measured against the people licensed for it — the difference between “we have Teams” and “we run on Teams”. Where a bar is short, you’re either paying for shelf-ware or missing the training that turns it into work:
            </p>
          </div>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div
              style={{
                flex: "1.6 1 420px",
                minWidth: 0,
                border: "1px solid rgba(249,115,22,.22)",
                borderRadius: "18px",
                background: "linear-gradient(160deg,rgba(249,115,22,.10),rgba(11,21,36,.52) 55%,rgba(11,21,36,.34))",
                backdropFilter: "blur(3px)",
                boxShadow: "0 0 60px rgba(249,115,22,.13), inset 0 1px 0 rgba(148,163,184,.08)",
                padding: "22px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {USAGE.map((us) => (
                  <div key={us.name} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ width: "130px", flex: "none", fontSize: "12px", fontWeight: 600, color: "#cbd5e1", textAlign: "right" }}>{us.name}</span>
                    <div style={{ flex: 1, height: "16px", borderRadius: "999px", background: "rgba(2,6,23,.6)", overflow: "hidden", display: "flex" }}>
                      <div style={{ width: `${us.pct}%`, height: "100%", borderRadius: "999px", background: `linear-gradient(90deg,${us.color}33,${us.color})` }} />
                    </div>
                    <span style={{ width: "110px", flex: "none", fontSize: "11px", color: "#94a3b8" }}>
                      <b style={{ color: us.color, fontVariantNumeric: "tabular-nums" }}>{us.pct}%</b> {us.note}
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ margin: "16px 0 0", paddingTop: "14px", borderTop: "1px solid rgba(30,41,59,.9)", fontSize: "11.5px", color: "#64748b", lineHeight: 1.65 }}>
                Weekly active share of licensed users, last 30 days. The Licensing pillar prices the gap; this pillar closes it.
              </p>
            </div>
            <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ border: "1px solid rgba(249,115,22,.3)", borderRadius: "14px", background: "rgba(249,115,22,.05)", padding: "16px 18px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#fb923c" }}>The renewal question</span>
                <p style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.65, margin: "8px 0 0" }}>
                  Copilot seats face a budget review every year. “22 of 60 active” loses that review; a curve bending upward with named use-cases per team wins it. Adoption is what makes the licence line defensible.
                </p>
              </div>
              <div style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>Adoption is a safety property too</span>
                <p style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.65, margin: "8px 0 0" }}>
                  People who never got the rollout do the work anyway — in personal drives, consumer AI tools and email attachments. Low adoption of the tools you govern means high adoption of the ones you don’t.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Inside the portal — module grid only */}
      <section style={{ padding: "44px 32px 44px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#a78bfa" }}>Inside the portal</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>Rollouts run as projects, not announcements.</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              An adoption push in the Portal is a tracked project: phases, owners, the weekly curve, and the announcements that go out before anything changes on screen — drafted from the same Microsoft Changes feed the Health pillar watches.
            </p>
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
        <div style={{ maxWidth: "1120px", margin: "0 auto", border: "1px solid rgba(249,115,22,.3)", borderRadius: "18px", background: "#0b1524", padding: "28px", display: "flex", gap: "28px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1.4 1 340px", minWidth: 0 }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#fb923c" }}>Who runs this with you</span>
            <h2 style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>Adoption doesn’t fail for lack of dashboards. It fails for lack of an owner.</h2>
            <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Monitoring draws the curve; a retainer architect owns bending it — champions, use-cases per team, and the monthly read of what moved. A stalled Copilot rollout becomes the <b style={{ color: "#e2e8f0" }}>Copilot Adoption &amp; Governance Program</b>, scoped as a fixed-price SOW.
            </p>
          </div>
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "11px 14px", border: "1px solid rgba(30,41,59,.9)", borderRadius: "10px", background: "rgba(2,6,23,.4)" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Architect retainer</span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>from <b style={{ color: "#e2e8f0" }}>$1,500</b>/mo · 8, 16 or 30 hrs</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "11px 14px", border: "1px solid rgba(249,115,22,.4)", borderRadius: "10px", background: "rgba(249,115,22,.07)" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Adoption &amp; governance SOWs</span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>fixed price · from the catalogue</span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <Link href="/retainers" style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "11px", borderRadius: "10px", fontSize: "12.5px", fontWeight: 700, color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)", whiteSpace: "nowrap" }}>
                See Retainer Tiers
              </Link>
              <Link href="/solutions" style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "11px", borderRadius: "10px", fontSize: "12.5px", fontWeight: 700, color: "#cbd5e1", border: "1px solid rgba(148,163,184,.2)", whiteSpace: "nowrap" }}>
                Browse Projects
              </Link>
            </div>
          </div>
        </div>
      </section>

      <PillarPeerStrip
        active="adoption"
        deeper={[
          { label: "Copilot & AI", href: "/solutions/copilot" },
          { label: "Teams", href: "/solutions/teams" },
          { label: "Power Platform", href: "/solutions/power-platform" },
        ]}
      />

      <ScanToScopedWork
        accent="rgba(249,115,22,.05)"
        intro="The free scan reads your actual tenant — including what’s licensed and what’s actually used. Findings become a scoped, priced statement of work, and this curve becomes yours, per workload."
      />
    </MarketingLayout>
  );
}
