import { Link } from "wouter";
import { MarketingLayout } from "../../components/MarketingLayout";
import { ArrowRight, PillarPeerStrip, ScanToScopedWork } from "../../components/pillar/PillarShared";

// Route /pillars/licensing — recreated from Design/design_handoff_marketing/
// Marketing Pillar - Licensing.dc.html. Colour #14b8a6, watermark circled dollar. Copy verbatim;
// data is the design's own renderVals() illustrative fixture.

const SKU_INPUT: { name: string; assigned: number; active: number; price: number }[] = [
  { name: "Microsoft 365 E5", assigned: 120, active: 84, price: 57 },
  { name: "Microsoft 365 E3", assigned: 640, active: 588, price: 36 },
  { name: "Copilot for Microsoft 365", assigned: 60, active: 22, price: 30 },
  { name: "Power BI Pro", assigned: 85, active: 41, price: 14 },
];

const SKU_ROWS = SKU_INPUT.map((s) => {
  const idle = s.assigned - s.active;
  const pct = Math.round((s.active / s.assigned) * 100);
  return {
    name: s.name,
    assigned: s.assigned,
    active: s.active,
    waste: "$" + (idle * s.price).toLocaleString("en-US") + "/mo idle",
    wasteColor: idle / s.assigned > 0.3 ? "#f87171" : "#fbbf24",
    pct,
  };
});

const OVERLAPS: { title: string; body: string; chip: string; red: boolean }[] = [
  { title: "E5 + standalone Defender for Office 365 P2", body: "E5 already includes Defender P2. 38 standalone add-ons are pure duplication on the same users.", chip: "Paying twice · 38 seats", red: true },
  { title: "E5 + standalone Power BI Pro", body: "Power BI Pro is in the E5 bundle. 41 of the 85 Pro licences sit on E5 users.", chip: "Paying twice · 41 seats", red: true },
  { title: "Teams Phone with no numbers assigned", body: "25 Phone licences assigned; 6 users have a number provisioned. The rest have never made a call.", chip: "Idle · 19 seats", red: false },
];

const TIER_STYLE: Record<string, React.CSSProperties> = {
  "All customers": { background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.3)", color: "#4ade80" },
  Premier: { background: "rgba(139,92,246,.12)", border: "1px solid rgba(139,92,246,.35)", color: "#a78bfa" },
  Retainer: { background: "rgba(59,130,246,.1)", border: "1px solid rgba(59,130,246,.3)", color: "#60a5fa" },
};

const PORTAL_MODULES: { name: string; tier: string; body: string }[] = [
  { name: "Licensing pillar score", tier: "All customers", body: "Assigned vs active per SKU, duplicates and reclaim candidates — re-read continuously, not once a year at true-up." },
  { name: "Scope Creep engine", tier: "All customers", body: "Watches assignments between reviews — seat growth, SKU upgrades and add-ons that appear without a change request." },
  { name: "Change Control", tier: "Premier", body: "Reclaims and downgrades run as change requests with owners and rollback points — removing a licence is a change too." },
  { name: "My Architect", tier: "Retainer", body: "A named architect runs the quarterly licensing review and brings the reclaim list to the renewal negotiation." },
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

export default function PillarLicensing() {
  return (
    <MarketingLayout current="watch">
      {/* Hero */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "48px 32px 30px",
          background:
            "radial-gradient(circle 1100px at 76% -20%, rgba(20,184,166,.11), rgba(2,6,23,0) 62%), radial-gradient(circle 780px at 6% 10%, rgba(20,184,166,.05), rgba(2,6,23,0) 66%)",
        }}
      >
        <span style={{ position: "absolute", right: "-90px", top: "-70px", opacity: 0.035, pointerEvents: "none", lineHeight: 0 }}>
          <svg width="520" height="520" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v12" />
            <path d="M15 9.5a2.5 2.5 0 0 0-2.5-2h-1a2.5 2.5 0 0 0 0 5h1a2.5 2.5 0 0 1 0 5h-1a2.5 2.5 0 0 1-2.5-2" />
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
                background: "rgba(20,184,166,.1)",
                border: "1px solid rgba(20,184,166,.28)",
                color: "#2dd4bf",
                fontSize: "10.5px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".1em",
                marginBottom: "18px",
              }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l9 5-9 5-9-5z" />
                <path d="M3 12l9 5 9-5" />
                <path d="M3 17l9 5 9-5" />
              </svg>{" "}
              Pillar 04 · Licensing
            </span>
            <h1 style={{ fontSize: "clamp(30px,3.4vw,40px)", fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.12, color: "#f8fafc", margin: "0 0 16px", textWrap: "pretty" } as React.CSSProperties}>
              You’re paying for software nobody has opened since March.
            </h1>
            <p style={{ fontSize: "15px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 12px", maxWidth: "54ch" }}>
              Licensing drifts the same way security does: assigned but never used, upgraded for one feature, duplicated by an add-on the bundle already includes, and carried for leavers whose accounts nobody closed. The pillar compares what you pay for against what your tenant actually does.
            </p>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.7, margin: "0 0 24px", maxWidth: "54ch" }}>
              The panel alongside is a typical first read: assigned seats against 30-day active use, at list prices.
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
              {["Assigned vs active, per SKU", "Duplicate coverage flagged", "Leaver licences reclaimed"].map((t) => (
                <span key={t} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#64748b" }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "999px", background: "#34d399" }} />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Assigned vs active card */}
          <div
            style={{
              flex: "1 1 380px",
              maxWidth: "500px",
              border: "1px solid rgba(20,184,166,.22)",
              borderRadius: "18px",
              background: "linear-gradient(160deg,rgba(20,184,166,.10),rgba(11,21,36,.52) 55%,rgba(11,21,36,.34))",
              backdropFilter: "blur(3px)",
              boxShadow: "0 0 60px rgba(20,184,166,.13), inset 0 1px 0 rgba(148,163,184,.08)",
              padding: "20px 22px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>Assigned vs active · last 30 days</span>
              <span style={{ fontSize: "9.5px", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#475569" }}>Illustrative · list prices</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "13px" }}>
              {SKU_ROWS.map((sk) => (
                <div key={sk.name} style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0" }}>{sk.name}</span>
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                      <b style={{ color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>{sk.active}</b> active of <b style={{ fontVariantNumeric: "tabular-nums" }}>{sk.assigned}</b> · <b style={{ color: sk.wasteColor }}>{sk.waste}</b>
                    </span>
                  </div>
                  <div style={{ height: "14px", borderRadius: "999px", background: "rgba(2,6,23,.6)", overflow: "hidden", display: "flex" }}>
                    <div style={{ width: `${sk.pct}%`, height: "100%", background: "#14b8a6" }} />
                    <div style={{ width: `${100 - sk.pct}%`, height: "100%", background: "rgba(248,113,113,.55)" }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginTop: "14px", paddingTop: "12px", borderTop: "1px solid rgba(30,41,59,.9)", flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
                <span style={{ width: "11px", height: "11px", borderRadius: "4px", background: "#14b8a6" }} />Used in the last 30 days
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
                <span style={{ width: "11px", height: "11px", borderRadius: "4px", background: "rgba(248,113,113,.55)" }} />Paid for, idle
              </span>
              <span style={{ marginLeft: "auto", fontSize: "12px", color: "#94a3b8" }}>
                <b style={{ fontSize: "16px", fontWeight: 800, color: "#f87171", fontVariantNumeric: "tabular-nums" }}>$4,262</b>/mo idle
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Paying twice band */}
      <section
        style={{
          padding: "40px 32px 46px",
          background:
            "linear-gradient(180deg, rgba(5,13,30,0) 0%, #050d1e 16%, #050d1e 84%, rgba(5,13,30,0) 100%), radial-gradient(circle 900px at 20% 0%, rgba(20,184,166,.05), rgba(2,6,23,0) 60%)",
        }}
      >
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#2dd4bf" }}>Paying twice</span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>The add-on you bought is already in the bundle you bought.</h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Microsoft’s licensing overlaps by design — E5 alone bundles a dozen products sold separately. Duplicate coverage hides in plain sight because two different invoices never sit in the same view. The engine puts them there:
            </p>
          </div>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ flex: "1.6 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
              {OVERLAPS.map((ov) => (
                <div key={ov.title} style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#f8fafc" }}>{ov.title}</div>
                    <div style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6, marginTop: "3px" }}>{ov.body}</div>
                  </div>
                  <span
                    style={{
                      flex: "none",
                      whiteSpace: "nowrap",
                      padding: "4px 10px",
                      borderRadius: "999px",
                      fontSize: "10px",
                      fontWeight: 700,
                      ...(ov.red
                        ? { background: "rgba(248,113,113,.12)", border: "1px solid rgba(248,113,113,.35)", color: "#f87171" }
                        : { background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.3)", color: "#fbbf24" }),
                    }}
                  >
                    {ov.chip}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ border: "1px solid rgba(30,41,59,.95)", borderRadius: "14px", background: "#0b1524", padding: "16px 18px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>Where licences go to die</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
                  {[
                    ["Leavers still holding licences", "14", "#f87171"],
                    ["Shared mailboxes with full licences", "11", "#fbbf24"],
                    ["Service accounts on user SKUs", "6", "#fbbf24"],
                  ].map(([label, n, color]) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: "10px", fontSize: "11.5px" }}>
                      <span style={{ color: "#94a3b8" }}>{label}</span>
                      <b style={{ color, fontVariantNumeric: "tabular-nums" }}>{n}</b>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.6, margin: "10px 0 0" }}>
                  The offboarding runbook reclaims the licence the day access is disabled — the Governance pillar’s leaver process and this pillar are the same motion.
                </p>
              </div>
              <div style={{ border: "1px solid rgba(20,184,166,.3)", borderRadius: "14px", background: "rgba(20,184,166,.05)", padding: "16px 18px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#2dd4bf" }}>The renewal, prepared</span>
                <p style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.65, margin: "8px 0 0" }}>
                  True-up season stops being archaeology: assigned vs active per SKU, duplicates named, reclaim candidates listed — the negotiation pack your reseller hopes you don’t have.
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
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>
              Licence changes are tenant changes. They go through the same register.
            </h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Reclaims and downgrades run as change requests with owners and rollback points — because taking E5 off the wrong person is an outage too. The scope-creep engine watches assignments between reviews so growth never surprises the invoice.
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

      {/* Business-case band */}
      <section style={{ padding: "0 32px 48px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto", border: "1px solid rgba(20,184,166,.3)", borderRadius: "18px", background: "#0b1524", padding: "28px", display: "flex", gap: "28px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1.4 1 340px", minWidth: 0 }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#2dd4bf" }}>The quiet business case</span>
            <h2 style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>This is the pillar that pays for the other five.</h2>
            <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Monitoring starts at <b style={{ color: "#e2e8f0" }}>$180/mo</b>. One reclaimed E5 covers most of it; the illustrative tenant above is idling twenty times that. A retainer architect runs the licensing review quarterly and walks the reclaim list through change control.
            </p>
          </div>
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "11px 14px", border: "1px solid rgba(30,41,59,.9)", borderRadius: "10px", background: "rgba(2,6,23,.4)" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Monitoring</span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>from <b style={{ color: "#e2e8f0" }}>$180</b>/mo · priced per seat</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "11px 14px", border: "1px solid rgba(20,184,166,.4)", borderRadius: "10px", background: "rgba(20,184,166,.07)" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>Architect retainer</span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>quarterly licensing review · from <b style={{ color: "#e2e8f0" }}>$1,500</b>/mo</span>
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
        active="licensing"
        deeper={[
          { label: "M365 Health", href: "/solutions/m365-health" },
          { label: "Power Platform", href: "/solutions/power-platform" },
          { label: "Migration", href: "/solutions/migration" },
        ]}
      />

      <ScanToScopedWork
        accent="rgba(20,184,166,.05)"
        intro="The free scan reads your actual tenant — including every assignment and every idle seat. Findings become a scoped, priced statement of work, and this panel becomes yours, at your real prices."
      />
    </MarketingLayout>
  );
}
