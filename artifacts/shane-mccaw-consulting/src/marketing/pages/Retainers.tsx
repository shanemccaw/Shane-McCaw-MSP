import React from "react";
import { Link } from "wouter";
import { MarketingLayout } from "../components/MarketingLayout";
import { useCatalog, type RetainerTier } from "../../hooks/useCatalog";

// Route /retainers — recreated from Design/design_handoff_marketing/Marketing Retainers.dc.html.
//
// PRICING CORRECTION: the design mock's four illustrative tiers (Advisory $900/5hrs,
// Essentials $1,500/8hrs "most popular", Growth $3,000/16hrs, Enterprise $5,500/30hrs) do not
// match the real catalog. The live services table (seeded in
// artifacts/api-server/src/lib/seed-portal.ts, served via GET /api/services?type=retainer and
// read here through useCatalog()) has only THREE retainer tiers — there is no "Advisory" tier —
// and the highlighted/"Most Popular" badge is on Growth, not Essentials:
//   Architect Essentials  $1,500/mo — 10 hours/month
//   Architect Growth      $3,000/mo — 25 hours/month  (highlighted, badge "Most Popular")
//   Architect Enterprise  $5,500/mo — 50 hours/month
// Names, prices, hours, taglines, features and the highlight flag are all read from the API
// (no-hardcoding rule) rather than transcribed from the mock, so this page always matches the
// real catalog even if it changes later.

function ic(children: React.ReactNode, size = 18, color = "currentColor") {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const iconCheckSm = ic(<polyline points="20 6 9 17 4 12" />, 13, "#60a5fa");

const LEDGER = [
  { work: "Conditional Access change review", when: "Tue", hrs: "2.0h" },
  { work: "Licensing consolidation decision", when: "Thu", hrs: "1.5h" },
  { work: "Q1 roadmap planning session", when: "Fri", hrs: "3.0h" },
  { work: "Intune baseline questions, async", when: "Mon", hrs: "0.5h" },
];

const RETAINER_FACTS = [
  {
    title: "Where the hours go",
    body: "You decide each month. Nothing is reserved for tickets or reporting overhead.",
    points: [
      "Reviewing a change before it ships",
      "Untangling a licensing or architecture decision",
      "Planning the next quarter’s roadmap",
    ],
    icon: ic(
      <>
        <circle cx={12} cy={12} r={9} />
        <line x1={12} y1={7} x2={12} y2={12} />
        <line x1={12} y1={12} x2={15} y2={14} />
      </>,
      16,
      "#a78bfa",
    ),
  },
  {
    title: "What you see in the Portal",
    body: "The retainer runs against the same portal your monitoring does, so the time is visible as it is used.",
    points: [
      "Hours consumed against hours retained",
      "A written status report you can actually read",
      "Deliverables tied to the time that produced them",
    ],
    icon: ic(
      <>
        <rect x={3} y={3} width={7} height={9} rx={1.5} />
        <rect x={14} y={3} width={7} height={5} rx={1.5} />
        <rect x={14} y={12} width={7} height={9} rx={1.5} />
        <rect x={3} y={16} width={7} height={5} rx={1.5} />
      </>,
      16,
      "#a78bfa",
    ),
  },
  {
    title: "Where a retainer stops",
    body: "Retainer time stays advisory. Anything that turns into delivery work is scoped separately, so a big project never quietly eats your hours.",
    points: [
      "Project work becomes a fixed-price statement of work",
      "You approve that scope before it starts",
      "Change tier, or stop, month to month",
    ],
    icon: ic(
      <>
        <rect x={4} y={3} width={16} height={18} rx={2} />
        <line x1={8} y1={9} x2={16} y2={9} />
        <line x1={8} y1={13} x2={14} y2={13} />
      </>,
      16,
      "#a78bfa",
    ),
  },
];

const WHY_REASONS = [
  {
    icon: ic(
      <>
        <circle cx={12} cy={12} r={9} />
        <line x1={12} y1={7} x2={12} y2={12} />
        <line x1={12} y1={12} x2={15} y2={14} />
      </>,
      15,
      "#60a5fa",
    ),
    title: "Predictable access",
    desc: "A reserved block of senior time every month — no waiting for availability, no proposal delays.",
  },
  {
    icon: ic(
      <>
        <line x1={12} y1={20} x2={12} y2={10} />
        <line x1={18} y1={20} x2={18} y2={4} />
        <line x1={6} y1={20} x2={6} y2={16} />
      </>,
      15,
      "#60a5fa",
    ),
    title: "Predictable cost",
    desc: "One flat monthly fee. No hourly invoices, no scope creep, no surprise overages.",
  },
  {
    icon: ic(<path d="M13 2L4 14h7l-1 8 9-12h-7z" />, 15, "#60a5fa"),
    title: "Faster modernization",
    desc: "Continuous progress each month compounds — faster than any project engagement.",
  },
  {
    icon: ic(<path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z" />, 15, "#60a5fa"),
    title: "Reduced risk",
    desc: "Architecture decisions are reviewed before implementation, not audited after a failed rollout.",
  },
  {
    icon: ic(
      <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9" />,
      15,
      "#60a5fa",
    ),
    title: "Senior-only delivery",
    desc: "Every hour is Shane’s. No junior staff, no account managers.",
  },
  {
    icon: ic(<path d="M13 2L4 14h7l-1 8 9-12h-7z" />, 15, "#60a5fa"),
    title: "No scoping delays",
    desc: "Work begins immediately each month. Need something new? Just ask — no SOW required.",
  },
];

function askShane() {
  window.dispatchEvent(new Event("sm-ask-shane"));
}

function fmtPrice(raw: string | null): string | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  if (isNaN(n)) return null;
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function isFixedPriceRetainer(t: RetainerTier): boolean {
  return !!t.price && !t.basePrice;
}

function TierCard({ tier }: { tier: RetainerTier }) {
  const price = fmtPrice(tier.price);
  const hl = tier.highlighted;
  return (
    <div
      style={{
        flex: "0 1 272px",
        display: "flex",
        flexDirection: "column",
        padding: "22px",
        borderRadius: "18px",
        background: "#0b1524",
        border: `1px solid ${hl ? "rgba(139,92,246,.45)" : "rgba(30,41,59,.9)"}`,
        position: "relative",
      }}
    >
      {tier.badge && (
        <span
          style={{
            position: "absolute",
            top: "-11px",
            left: "22px",
            padding: "3px 10px",
            borderRadius: "999px",
            fontSize: "10px",
            fontWeight: 700,
            color: "#fff",
            background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
            whiteSpace: "nowrap",
          }}
        >
          {tier.badge}
        </span>
      )}
      <h3
        style={{
          margin: "0 0 10px",
          fontSize: "18px",
          fontWeight: 700,
          color: "#f8fafc",
          letterSpacing: "-.015em",
        }}
      >
        {tier.name}
      </h3>
      <div style={{ display: "flex", alignItems: "baseline", gap: "7px", marginBottom: "4px" }}>
        <b
          style={{
            fontSize: "27px",
            fontWeight: 800,
            color: "#f8fafc",
            letterSpacing: "-.025em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {price ?? "Contact for pricing"}
        </b>
        {price && <span style={{ fontSize: "13px", color: "#94a3b8" }}>/mo</span>}
      </div>
      {tier.hoursPerMonth && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "8px",
            flexWrap: "wrap",
            marginBottom: "16px",
          }}
        >
          <span
            style={{
              fontSize: "12.5px",
              fontWeight: 700,
              color: hl ? "#a78bfa" : "#60a5fa",
            }}
          >
            {tier.hoursPerMonth}/month
          </span>
        </div>
      )}
      {(tier.tagline ?? tier.description) && (
        <p
          style={{
            margin: "0 0 16px",
            fontSize: "12.5px",
            color: "#94a3b8",
            lineHeight: 1.65,
          }}
        >
          {tier.tagline ?? tier.description}
        </p>
      )}
      {tier.features && tier.features.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "18px", flexGrow: 1 }}>
          {tier.features.map((f, i) => (
            <span
              key={i}
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "flex-start",
                fontSize: "12px",
                color: "#cbd5e1",
                lineHeight: 1.55,
              }}
            >
              <span style={{ flexShrink: 0, display: "flex", marginTop: "1px" }}>{iconCheckSm}</span>
              <span>{f}</span>
            </span>
          ))}
        </div>
      )}
      <Link
        href={`/buy?product=retainer&tier=${tier.slug ?? ""}`}
        style={{
          width: "100%",
          padding: "11px",
          borderRadius: "10px",
          fontSize: "13px",
          fontWeight: 700,
          color: "#fff",
          background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
          textAlign: "center",
          marginTop: "auto",
        }}
      >
        Start this retainer
      </Link>
    </div>
  );
}

export default function Retainers() {
  const { retainerTiers, loading, error } = useCatalog();
  const tiers = retainerTiers.filter(isFixedPriceRetainer).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <MarketingLayout current="retainers">
      {/* Hero */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "48px 32px 30px",
          background:
            "radial-gradient(circle 1100px at 76% -20%, rgba(139,92,246,.12), rgba(2,6,23,0) 62%), radial-gradient(circle 800px at 6% 12%, rgba(0,120,212,.06), rgba(2,6,23,0) 66%)",
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
            filter: "drop-shadow(0 0 26px rgba(139,92,246,.3))",
          }}
        >
          <svg width={470} height={470} viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx={9.5} cy={7} r={4} />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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
                background: "rgba(139,92,246,.1)",
                border: "1px solid rgba(139,92,246,.28)",
                color: "#a78bfa",
                fontSize: "10.5px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".1em",
                marginBottom: "18px",
              }}
            >
              {ic(
                <>
                  <circle cx={12} cy={8} r={4} />
                  <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
                </>,
                14,
              )}{" "}
              Fractional M365 Architecture
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
              Fractional M365 architecture, delivered by NASA&#8217;s current lead architect.
            </h1>
            <p style={{ fontSize: "15px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 12px", maxWidth: "54ch" }}>
              A named architect on retainer for whoever needs one &#8212; three users or five
              hundred. You buy hours of senior involvement, not a headcount bracket, and every
              hour is logged against real work.
            </p>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.7, margin: "0 0 24px", maxWidth: "54ch" }}>
              The panel alongside is the retainer as you see it in the Portal &#8212; hours
              against deliverables, not a support queue.
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "22px" }}>
              <a
                href="#tiers"
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
                Compare the Tiers
                {ic(
                  <>
                    <line x1={4} y1={12} x2={20} y2={12} />
                    <polyline points="14 6 20 12 14 18" />
                  </>,
                  15,
                )}
              </a>
              <button
                onClick={askShane}
                style={{
                  padding: "12px 22px",
                  border: "1px solid rgba(148,163,184,.2)",
                  borderRadius: "10px",
                  fontFamily: "inherit",
                  fontWeight: 600,
                  fontSize: "13.5px",
                  color: "#cbd5e1",
                  background: "none",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Book a Free Discovery Call
              </button>
            </div>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
              {["No minimum term, no seat gating", "Transparent hour tracking", "Every hour is Shane’s"].map(
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
              border: "1px solid rgba(139,92,246,.22)",
              borderRadius: "18px",
              background:
                "linear-gradient(160deg,rgba(139,92,246,.10),rgba(11,21,36,.52) 55%,rgba(11,21,36,.34))",
              backdropFilter: "blur(3px)",
              boxShadow: "0 0 60px rgba(139,92,246,.13), inset 0 1px 0 rgba(148,163,184,.08)",
              padding: "20px 22px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>
                My Architect &#183; Growth retainer
              </span>
              <span style={{ fontSize: "9.5px", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#475569" }}>
                In the Portal &#183; illustrative
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", marginBottom: "6px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#cbd5e1" }}>Hours this month</span>
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                <b style={{ fontSize: "17px", fontWeight: 800, color: "#f8fafc", fontVariantNumeric: "tabular-nums" }}>11.5</b> of 16 used
              </span>
            </div>
            <div style={{ height: "8px", borderRadius: "999px", background: "rgba(2,6,23,.6)", overflow: "hidden", marginBottom: "14px" }}>
              <div style={{ width: "72%", height: "100%", borderRadius: "999px", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              {LEDGER.map((lg) => (
                <div
                  key={lg.work}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "11px",
                    padding: "10px 12px",
                    border: "1px solid rgba(30,41,59,.9)",
                    borderRadius: "10px",
                    background: "rgba(2,6,23,.35)",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: "12px", fontWeight: 600, color: "#e2e8f0" }}>{lg.work}</span>
                  <span style={{ flex: "none", fontSize: "11px", color: "#64748b" }}>{lg.when}</span>
                  <span style={{ flex: "none", fontSize: "11.5px", fontWeight: 800, color: "#a78bfa", fontVariantNumeric: "tabular-nums" }}>{lg.hrs}</span>
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginTop: "12px",
                paddingTop: "11px",
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
                  background: "rgba(52,211,153,.08)",
                  border: "1px solid rgba(52,211,153,.25)",
                  color: "#34d399",
                  whiteSpace: "nowrap",
                }}
              >
                Status report &#183; drafts at month end
              </span>
              <span style={{ fontSize: "11px", color: "#64748b" }}>Deliverables tied to the time that produced them.</span>
            </div>
          </div>
        </div>
      </section>

      {/* Tiers */}
      <section
        id="tiers"
        style={{
          padding: "40px 32px 44px",
          background:
            "linear-gradient(180deg, rgba(5,13,30,0) 0%, #050d1e 16%, #050d1e 84%, rgba(5,13,30,0) 100%), radial-gradient(circle 900px at 20% 0%, rgba(139,92,246,.05), rgba(2,6,23,0) 60%)",
        }}
      >
        <div style={{ maxWidth: "1130px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "24px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#a78bfa" }}>
              The tiers
            </span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>
              Retainers, priced by hours.
            </h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              No seat gating on any tier &#8212; a 1-user tenant and a 500-user tenant can both
              buy any of them. The tier names signal depth of engagement, not company size.
            </p>
          </div>

          {loading && (
            <p style={{ color: "#64748b", fontSize: "13px", textAlign: "center", padding: "40px 0" }}>Loading tiers&#8230;</p>
          )}
          {error && !loading && (
            <p style={{ color: "#f87171", fontSize: "13px", textAlign: "center", padding: "40px 0" }}>
              Could not load retainer pricing. Please refresh and try again.
            </p>
          )}
          {!loading && !error && (
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "14px" }}>
              {tiers.map((t) => (
                <TierCard key={t.id} tier={t} />
              ))}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(268px,1fr))",
              gap: "14px",
              margin: "26px auto 0",
            }}
          >
            {RETAINER_FACTS.map((rf) => (
              <div
                key={rf.title}
                style={{
                  borderRadius: "15px",
                  border: "1px solid rgba(30,41,59,.9)",
                  background: "#0b1524",
                  padding: "19px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "9px",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                  <span
                    style={{
                      flexShrink: 0,
                      width: "30px",
                      height: "30px",
                      borderRadius: "9px",
                      background: "rgba(139,92,246,.08)",
                      border: "1px solid rgba(139,92,246,.2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#a78bfa",
                    }}
                  >
                    {rf.icon}
                  </span>
                  <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#f8fafc" }}>{rf.title}</span>
                </span>
                <p style={{ margin: 0, fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.65 }}>{rf.body}</p>
                {rf.points.map((pt) => (
                  <span key={pt} style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", color: "#cbd5e1", lineHeight: 1.55 }}>
                    <span style={{ color: "#a78bfa", flexShrink: 0, display: "flex", marginTop: "1px" }}>{iconCheckSm}</span>
                    <span>{pt}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why a retainer */}
      <section style={{ padding: "44px 32px 20px" }}>
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#60a5fa" }}>
              Why a retainer
            </span>
            <h2 style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>
              Project engagements start after the drift. A retainer is already there.
            </h2>
            <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              By the time scope is agreed and a project begins, your environment has already
              moved. Reserved senior time means decisions get reviewed when they happen, not
              audited after a failed rollout.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: "12px" }}>
            {WHY_REASONS.map((r) => (
              <div key={r.title} style={{ padding: "18px", background: "#0b1524", border: "1px solid rgba(30,41,59,.9)", borderRadius: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "8px", color: "#60a5fa" }}>
                  {r.icon}
                  <h3 style={{ margin: 0, fontSize: "13.5px", fontWeight: 700, color: "#f8fafc" }}>{r.title}</h3>
                </div>
                <p style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.55, margin: 0 }}>{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Shane */}
      <section style={{ padding: "34px 32px 48px" }}>
        <div
          style={{
            maxWidth: "1120px",
            margin: "0 auto",
            border: "1px solid rgba(139,92,246,.3)",
            borderRadius: "18px",
            background: "#0b1524",
            padding: "28px",
            display: "flex",
            gap: "28px",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1.4 1 340px", minWidth: 0 }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#a78bfa" }}>
              Why Shane
            </span>
            <h2 style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-.025em", color: "#f8fafc", margin: "8px 0 10px" }}>
              There are many M365 consultants. There is one with this combination.
            </h2>
            <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
              Shane is NASA&#8217;s current Lead Microsoft 365 Architect, running one of the most
              compliance-intensive M365 deployments in the federal government &#8212; after
              three decades inside the Microsoft ecosystem. No junior consultants, no account
              managers, no handoffs: every hour of every deliverable is Shane.
            </p>
          </div>
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "8px" }}>
            {[
              { label: "NASA Lead Architect", note: "current, not former", strong: false },
              { label: "30 years in Microsoft", note: "every major platform shift, firsthand", strong: false },
              { label: "Senior-only, always", note: "no juniors, no handoffs", strong: true },
            ].map((row) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "11px 14px",
                  border: row.strong ? "1px solid rgba(139,92,246,.4)" : "1px solid rgba(30,41,59,.9)",
                  borderRadius: "10px",
                  background: row.strong ? "rgba(139,92,246,.07)" : "rgba(2,6,23,.4)",
                }}
              >
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>{row.label}</span>
                <span style={{ fontSize: "11.5px", color: "#94a3b8" }}>{row.note}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        style={{
          padding: "40px 32px 64px",
          textAlign: "center",
          background: "linear-gradient(180deg, rgba(139,92,246,.05), rgba(2,6,23,0) 55%)",
        }}
      >
        <div style={{ maxWidth: "640px", margin: "0 auto" }}>
          <h2 style={{ fontSize: "22px", fontWeight: 800, color: "#f8fafc", margin: "0 0 12px", letterSpacing: "-.02em" }}>
            Book a free discovery call
          </h2>
          <p style={{ color: "#94a3b8", margin: "0 0 22px", lineHeight: 1.6, fontSize: "13.5px" }}>
            Speak directly with Shane &#8212; no salespeople, no pressure. Or start the tier that
            fits and change month to month.
          </p>
          <button
            onClick={askShane}
            style={{
              display: "inline-flex",
              padding: "13px 26px",
              border: 0,
              borderRadius: "11px",
              fontFamily: "inherit",
              fontWeight: 700,
              fontSize: "14px",
              color: "#fff",
              background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
              cursor: "pointer",
            }}
          >
            Book a Free Discovery Call
          </button>
        </div>
      </section>
    </MarketingLayout>
  );
}
