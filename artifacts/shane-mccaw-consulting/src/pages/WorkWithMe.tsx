import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Check,
  Share2,
  Shield,
  FileCheck,
  CircleDollarSign,
  Users,
  Activity,
  Loader2,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { RetainerCheckout, type RetainerTier } from "./work-with-me/RetainerCheckout";

/**
 * Work With Me — the new home page (`/`), #2955. Sells the four Architect
 * Retainer tiers and takes real recurring payment through the embedded Stripe
 * checkout (RetainerCheckout), per Design/fractional_architecture/README.md §1
 * and Work With Me.dc.html.
 *
 * Prices/hours/names for the four fixed tiers are HARDCODED below (#2964) — a
 * deliberate, explicit, temporary exception to this project's standing
 * "no fixture data" rule (Shane's direction), scoped only to this retainer
 * pricing for this release. This is the SAME source `public-retainer-payment.ts`
 * (the route that actually charges Stripe) reads from; the two must never drift
 * apart. Do not reintroduce a live `services` fetch for these four tiers.
 */

const KEYFRAMES = `@keyframes smcSpin{to{transform:rotate(360deg)}}`;

/** The four fixed tiers, in the design's order, with the design's verbatim
 *  marketing copy AND the hardcoded price/hours/name (#2964) — identical values
 *  to HARDCODED_RETAINER_TIERS in artifacts/api-server/src/routes/public-retainer-payment.ts. */
const TIER_META: Record<string, { name: string; priceCents: number; hours: string; fit: string; tag?: string }> = {
  "architect-advisory-retainer": {
    name: "Architect Advisory Retainer",
    priceCents: 90_000,
    hours: "5",
    fit: "A standing second opinion. Architecture questions answered before they become tickets.",
    tag: "Start here",
  },
  "architect-essentials-retainer": {
    name: "Architect Essentials Retainer",
    priceCents: 150_000,
    hours: "8",
    fit: "A monthly review plus one live piece of work, every month.",
  },
  "architect-growth-retainer": {
    name: "Architect Growth Retainer",
    priceCents: 300_000,
    hours: "16",
    fit: "Two days a month. Roadmap ownership plus hands-on configuration in your tenant.",
  },
  "architect-enterprise-retainer": {
    name: "Architect Enterprise Retainer",
    priceCents: 550_000,
    hours: "30",
    fit: "Roughly a day a week. Shane as your fractional lead architect.",
  },
};

const TIER_ORDER = [
  "architect-advisory-retainer",
  "architect-essentials-retainer",
  "architect-growth-retainer",
  "architect-enterprise-retainer",
];

/** Scoped retainers are behind a flag, hidden by default (README §1 / design
 *  prop `showScopedRetainers` default false). Opt in with a Vite env flag. */
const SHOW_SCOPED_RETAINERS = import.meta.env.VITE_SHOW_SCOPED_RETAINERS === "true";

function formatCents(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString("en-US");
}

const EYEBROW_RULE: React.CSSProperties = {
  width: 26,
  height: 1,
  background: "linear-gradient(90deg,#00B4D8,rgba(0,180,216,.15))",
};
const EYEBROW_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".16em",
  textTransform: "uppercase",
  color: "#00B4D8",
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={EYEBROW_RULE} />
      <span style={EYEBROW_LABEL}>{children}</span>
    </div>
  );
}

interface ResolvedTier extends RetainerTier {
  index: string;
  fit: string;
  tag?: string;
}

export default function WorkWithMe() {
  const tiers: ResolvedTier[] = useMemo(() => {
    const out: ResolvedTier[] = [];
    TIER_ORDER.forEach((slug, i) => {
      const meta = TIER_META[slug];
      if (!meta) return;
      out.push({
        slug,
        name: meta.name,
        priceText: formatCents(meta.priceCents),
        hoursText: meta.hours,
        payLabel: `Start retainer · ${formatCents(meta.priceCents)}/mo`,
        index: String(i + 1).padStart(2, "0"),
        fit: meta.fit,
        tag: meta.tag,
      });
    });
    return out;
  }, []);

  const [openTier, setOpenTier] = useState<string | null>(null);

  // Advisory open on load — but only once the catalog has resolved it, so the
  // panel opens against a real priced row rather than an empty one.
  const [openedOnce, setOpenedOnce] = useState(false);
  useEffect(() => {
    if (openedOnce || tiers.length === 0) return;
    setOpenTier(tiers[0].slug);
    setOpenedOnce(true);
  }, [tiers, openedOnce]);

  function toggleTier(slug: string) {
    const opening = openTier !== slug;
    setOpenTier(opening ? slug : null);
    if (opening) {
      setTimeout(() => {
        const el = document.getElementById(`tier-${slug}`);
        if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: "smooth" });
      }, 40);
    }
  }

  function startAdvisory() {
    const first = tiers[0];
    if (!first) return;
    setOpenTier(first.slug);
    setTimeout(() => {
      const el = document.getElementById(`tier-${first.slug}`);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: "smooth" });
    }, 40);
  }

  function goTiers() {
    const el = document.getElementById("tiers");
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: "smooth" });
  }

  return (
    <Layout>
      <SEOMeta
        title="Work With Me — Architect Retainers From $900/Month | Shane McCaw Consulting"
        description="Reserved time each month with NASA's Lead Microsoft 365 Architect. Four Architect Retainer tiers from $900/month. No proposal cycle, no SOW, no minimum term."
      />
      <style>{KEYFRAMES}</style>

      {/* The shared Header is fixed at 72px; clear it. */}
      <div style={{ paddingTop: 72 }}>
        <HeroSection onStart={startAdvisory} onCompare={goTiers} />
        <CredibilityStrip />
        <TiersSection tiers={tiers} openTier={openTier} onToggle={toggleTier} />
        {SHOW_SCOPED_RETAINERS && <ScopedRetainers />}
        <AssessmentSection />
        <ContactSection onStart={startAdvisory} />
      </div>
    </Layout>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────

function HeroSection({ onStart, onCompare }: { onStart: () => void; onCompare: () => void }) {
  const pillars = [
    { label: "Governance", color: "#60a5fa", Icon: Share2 },
    { label: "Security", color: "#a78bfa", Icon: Shield },
    { label: "Compliance", color: "#D1D5DB", Icon: FileCheck },
    { label: "Licensing", color: "#2dd4bf", Icon: CircleDollarSign },
    { label: "Adoption", color: "#fb923c", Icon: Users },
    { label: "Health", color: "#4ADE80", Icon: Activity },
  ];
  return (
    <section
      id="top"
      style={{
        position: "relative",
        overflow: "hidden",
        background:
          "radial-gradient(circle 1100px at 76% -20%, rgba(139,92,246,.12), rgba(2,6,23,0) 62%), radial-gradient(circle 800px at 6% 12%, rgba(0,120,212,.06), rgba(2,6,23,0) 66%)",
      }}
    >
      <span style={{ position: "absolute", right: -60, top: "50%", transform: "translateY(-50%)", opacity: 0.11, pointerEvents: "none", lineHeight: 0, filter: "drop-shadow(0 0 26px rgba(139,92,246,.3))" }}>
        <Users size={470} color="#a78bfa" strokeWidth={0.8} />
      </span>
      <div
        style={{
          position: "relative",
          maxWidth: 1280,
          margin: "0 auto",
          padding: "clamp(56px,9vw,104px) clamp(16px,4vw,32px) clamp(48px,7vw,80px)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))",
          gap: "clamp(40px,6vw,80px)",
          alignItems: "start",
        }}
      >
        <div style={{ maxWidth: 620 }}>
          <Eyebrow>Fractional Microsoft 365 Architecture</Eyebrow>
          <h1 style={{ fontSize: "clamp(28px,4vw,44px)", lineHeight: 1.08, letterSpacing: "-.025em", fontWeight: 800, color: "#f8fafc", margin: "22px 0 20px", textWrap: "pretty" }}>
            The Architect Behind NASA's Microsoft 365 — <span style={{ color: "#a78bfa" }}>Retainers From $900/Month.</span>
          </h1>
          <p style={{ fontSize: "clamp(16px,2.2vw,18px)", lineHeight: 1.6, color: "#94a3b8", margin: "0 0 12px", maxWidth: 580, textWrap: "pretty" }}>
            From redesigning NASA's email infrastructure and modernizing its security posture, to leading a full transition off legacy conferencing tools, to architecting NASA's Copilot rollout — Shane owns the roadmap.
          </p>
          <p style={{ fontSize: "clamp(16px,2.2vw,18px)", lineHeight: 1.6, color: "#94a3b8", margin: "0 0 32px", maxWidth: 580, textWrap: "pretty" }}>
            Thirty years in the Microsoft ecosystem. Every hour on retainer is his.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <button type="button" onClick={onStart} style={primaryLg}>
              Start at $900/mo
              <ArrowRight className="w-4 h-4" />
            </button>
            <button type="button" onClick={onCompare} style={outlineLg}>
              Compare the four tiers
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 22px", marginTop: 26, fontSize: 13, color: "#94a3b8" }}>
            {["No proposal cycle", "No SOW", "No minimum term"].map((t) => (
              <span key={t} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Check className="w-3.5 h-3.5" strokeWidth={2.5} style={{ color: "#00B4D8" }} />
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Violet stat panel */}
        <div
          style={{
            justifySelf: "end",
            width: "100%",
            maxWidth: 520,
            border: "1px solid rgba(139,92,246,.22)",
            borderRadius: 18,
            background: "linear-gradient(160deg,rgba(139,92,246,.10),rgba(11,21,36,.52) 55%,rgba(11,21,36,.34))",
            backdropFilter: "blur(3px)",
            boxShadow: "0 0 60px rgba(139,92,246,.13), inset 0 1px 0 rgba(148,163,184,.08)",
            padding: "20px 22px",
          }}
        >
          <StatRow big="2026" label="Innovation Forum Award" body="For deploying Copilot to the first large federal agency to do so: NASA." />
          <StatRow big="30" label="Years in the Microsoft ecosystem" body="The whole suite, on-prem Exchange to Copilot. Not a generalist who added M365 to the services list." borderTop />
          <div style={{ display: "grid", gridTemplateColumns: "minmax(120px,auto) 1fr", gap: "0 clamp(16px,3vw,28px)", alignItems: "start", padding: "22px 0", borderTop: "1px solid rgba(30,41,59,.9)", borderBottom: "1px solid rgba(30,41,59,.9)" }}>
            <span style={statNumber}>6</span>
            <div style={{ paddingTop: 8 }}>
              <div style={EYEBROW_LABEL}>Pillars scanned from live Graph telemetry</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "14px 12px", marginTop: 10 }}>
                {pillars.map(({ label, color, Icon }) => (
                  <span key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#94a3b8" }}>
                    <Icon className="w-3.5 h-3.5" style={{ color }} strokeWidth={2} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const statNumber: React.CSSProperties = {
  fontSize: "clamp(52px,6.5vw,80px)",
  fontWeight: 800,
  letterSpacing: "-.045em",
  lineHeight: 0.9,
  color: "#f8fafc",
};

function StatRow({ big, label, body, borderTop }: { big: string; label: string; body: string; borderTop?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(120px,auto) 1fr", gap: "0 clamp(16px,3vw,28px)", alignItems: "start", padding: "22px 0", ...(borderTop ? { borderTop: "1px solid rgba(30,41,59,.9)" } : {}) }}>
      <span style={statNumber}>{big}</span>
      <div style={{ paddingTop: 8 }}>
        <div style={EYEBROW_LABEL}>{label}</div>
        <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.55, color: "#94a3b8" }}>{body}</p>
      </div>
    </div>
  );
}

// ── Credibility strip ─────────────────────────────────────────────────────────

function CredibilityStrip() {
  const items = [
    { n: "01", title: "Lead Microsoft 365 Architect, NASA", body: "Current role, across the entire suite. A personal credential, not an institutional endorsement, and the reason organizations that work with NASA cannot be clients." },
    { n: "02", title: "30 years in the Microsoft ecosystem", body: "Moved NASA from on-prem Exchange to Microsoft 365 and from Skype for Business to Teams. Doing the work now, not describing it from years ago." },
    { n: "03", title: "2026 Innovation Forum Award", body: "For deploying Copilot to the first large federal agency to do so. Named, dated, on the record." },
    { n: "04", title: "A working diagnostic platform", body: "The Copilot Readiness Assessment reads six pillars from Graph telemetry. Not a self-report checklist." },
  ];
  return (
    <section style={{ borderTop: "1px solid rgba(30,41,59,.8)", borderBottom: "1px solid rgba(30,41,59,.8)", background: "rgba(15,23,42,.4)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "clamp(28px,4vw,40px) clamp(16px,4vw,32px) clamp(36px,5vw,56px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,230px),1fr))", gap: "clamp(24px,4vw,40px)" }}>
        {items.map((it) => (
          <div key={it.n} style={{ borderTop: "1px solid rgba(0,180,216,.4)", paddingTop: 16 }}>
            <div style={{ fontFamily: "Menlo,ui-monospace,monospace", fontSize: 11, letterSpacing: ".12em", color: "#00B4D8" }}>{it.n}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#f8fafc", margin: "10px 0 6px", letterSpacing: "-.01em" }}>{it.title}</div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#94a3b8" }}>{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Retainer tiers accordion ───────────────────────────────────────────────────

function TiersSection({ tiers, openTier, onToggle }: { tiers: ResolvedTier[]; openTier: string | null; onToggle: (slug: string) => void }) {
  return (
    <section id="tiers" style={{ maxWidth: 1280, margin: "0 auto", padding: "clamp(56px,9vw,96px) clamp(16px,4vw,32px) clamp(24px,4vw,40px)" }}>
      <div style={{ maxWidth: 720 }}>
        <Eyebrow>Architect Retainers · Four Tiers</Eyebrow>
        <h2 style={{ fontSize: "clamp(28px,5.6vw,42px)", lineHeight: 1.12, letterSpacing: "-.025em", fontWeight: 800, color: "#f8fafc", margin: "16px 0 18px", textWrap: "pretty" }}>
          Every Hour Is Shane's. Choose How Many.
        </h2>
        <p style={{ fontSize: 17, lineHeight: 1.65, color: "#94a3b8", margin: 0, textWrap: "pretty" }}>
          Reserved time each month with no proposal cycle and no SOW. Hours reset monthly. Cancel with 30 days' notice. One exclusion: organizations that work with NASA as a contractor, subcontractor or partner cannot be taken on.
        </p>
      </div>

      <div style={{ marginTop: "clamp(28px,4vw,44px)", borderTop: "1px solid rgba(30,41,59,.9)" }}>
        {tiers.length === 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "26px 0", color: "#94a3b8", fontSize: 14 }}>
            <Loader2 className="w-4 h-4" style={{ animation: "smcSpin 1s linear infinite" }} />
            Loading tiers…
          </div>
        )}
        {tiers.map((t) => {
          const open = openTier === t.slug;
          return (
            <div key={t.slug} id={`tier-${t.slug}`} style={{ borderBottom: "1px solid rgba(30,41,59,.9)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "18px 28px", padding: "26px 0" }}>
                <div style={{ flex: "1 1 300px", display: "flex", gap: 18, alignItems: "flex-start" }}>
                  <span style={{ fontFamily: "Menlo,ui-monospace,monospace", fontSize: 11, letterSpacing: ".12em", color: "#00B4D8", paddingTop: 7, flexShrink: 0 }}>{t.index}</span>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 19, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em" }}>{t.name}</span>
                      {t.tag && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "#00B4D8", background: "rgba(0,180,216,.1)", border: "1px solid rgba(0,180,216,.3)", borderRadius: 999, padding: "4px 10px" }}>
                          {t.tag}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.55, color: "#94a3b8", maxWidth: 460 }}>{t.fit}</p>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 120 }}>
                  <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.03em", color: "#f8fafc" }}>{t.hoursText}</span>
                  <span style={{ fontSize: 13, color: "#94a3b8" }}>hrs / month</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 130 }}>
                  <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.03em", color: "#f8fafc" }}>{t.priceText}</span>
                  <span style={{ fontSize: 13, color: "#94a3b8" }}>/ mo</span>
                </div>
                <button type="button" onClick={() => onToggle(t.slug)} style={{ ...primaryMd, minWidth: 150 }}>
                  {open ? "Close" : "Start retainer"}
                </button>
              </div>
              {open && <RetainerCheckout tier={t} />}
            </div>
          );
        })}
      </div>
      <p style={{ margin: "18px 0 0", fontSize: 13, lineHeight: 1.55, color: "#94a3b8" }}>
        Card payment through Stripe. Prices are the live catalog rows; no quote step.
      </p>
    </section>
  );
}

// ── Scoped retainers (feature-flagged, hidden by default) ──────────────────────

function ScopedRetainers() {
  const cards = [
    { name: "vCISO / Governance Retainer", from: "$4,500", body: "Ongoing virtual CISO advisory: security strategy, board-level reporting, compliance oversight." },
    { name: "Copilot Governance Retainer", from: "$2,000", body: "Ongoing Copilot usage and governance oversight. Narrower scope than the full vCISO retainer." },
  ];
  return (
    <section style={{ maxWidth: 1280, margin: "0 auto", padding: "clamp(24px,4vw,40px) clamp(16px,4vw,32px) clamp(56px,9vw,96px)" }}>
      <div style={{ marginBottom: 22 }}>
        <Eyebrow>Scoped Retainers · Priced in a Discovery Call</Eyebrow>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: 20 }}>
        {cards.map((c) => (
          <div key={c.name} style={{ display: "flex", flexDirection: "column", gap: 12, padding: 26, border: "1px solid rgba(30,41,59,.9)", borderRadius: 16, background: "rgba(15,23,42,.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontSize: 19, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em" }}>{c.name}</span>
              <span style={{ fontSize: 14, color: "#94a3b8" }}>
                from <b style={{ fontSize: 22, fontWeight: 800, color: "#f8fafc", letterSpacing: "-.02em" }}>{c.from}</b> / mo
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#94a3b8", flex: 1 }}>{c.body}</p>
            <div>
              <Link href="/contact" style={{ ...outlineMd, textDecoration: "none", display: "inline-flex" } as React.CSSProperties}>
                Request scoping
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Assessment teaser ──────────────────────────────────────────────────────────

function AssessmentSection() {
  const pillars = [
    { label: "Governance", color: "#60A5FA", Icon: Shield, body: "Ownership, sharing settings, site permissions." },
    { label: "Security", color: "#A78BFA", Icon: Shield, body: "Conditional Access coverage and its exclusions." },
    { label: "Compliance", color: "#D1D5DB", Icon: FileCheck, body: "Labels applied versus labels defined. Guest exposure." },
    { label: "Licensing", color: "#2DD4BF", Icon: CircleDollarSign, body: "Copilot seats assigned versus seats in use." },
    { label: "Adoption", color: "#FB923C", Icon: Users, body: "Where usage concentrates, and where it stops." },
    { label: "Health", color: "#4ADE80", Icon: Activity, body: "Configuration change since the baseline." },
  ];
  return (
    <section id="assessment" style={{ borderTop: "1px solid rgba(30,41,59,.8)", background: "linear-gradient(180deg,#020617,#040b1e 40%,#020617)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "clamp(56px,9vw,96px) clamp(16px,4vw,32px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))", gap: "clamp(32px,5vw,64px)", alignItems: "start" }}>
        <div style={{ maxWidth: 560 }}>
          <Eyebrow>The Copilot Readiness Assessment · $5,000</Eyebrow>
          <h2 style={{ fontSize: "clamp(28px,5.6vw,42px)", lineHeight: 1.12, letterSpacing: "-.025em", fontWeight: 800, color: "#f8fafc", margin: "16px 0 18px", textWrap: "pretty" }}>
            The Same Tool Paying Customers Run Today.
          </h2>
          <p style={{ fontSize: 17, lineHeight: 1.65, color: "#94a3b8", margin: "0 0 18px", textWrap: "pretty" }}>
            Retainer hours work best pointed at evidence. The assessment is a read-only Microsoft Graph scan of your tenant across six pillars: real telemetry, not a self-report checklist. Eight reports generate from the findings in under thirty minutes.
          </p>
          <p style={{ fontSize: 17, lineHeight: 1.65, color: "#94a3b8", margin: "0 0 30px", textWrap: "pretty" }}>
            Run it first and the findings become the first month's agenda.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <Link href="/assessment" style={{ ...primaryLg, textDecoration: "none" } as React.CSSProperties}>
              Start the assessment · $5,000
              <ArrowRight className="w-4 h-4" />
            </Link>
            <span style={{ fontSize: 13, color: "#94a3b8" }}>One-time. Commercial tenants only.</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))", gap: 14 }}>
          {pillars.map(({ label, color, Icon, body }) => (
            <div key={label} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: 18, border: "1px solid rgba(30,41,59,.8)", borderRadius: 16, background: "rgba(15,23,42,.5)" }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, background: `${color}1a`, border: `1px solid ${color}33`, color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon className="w-5 h-5" strokeWidth={2} />
              </span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color }}>{label}</div>
                <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "#94a3b8" }}>{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Close + contact ────────────────────────────────────────────────────────────

function ContactSection({ onStart }: { onStart: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  async function send() {
    if (state === "sending") return;
    setState("sending");
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name || "Website visitor",
          email: form.email,
          company: form.company || undefined,
          message: form.message || undefined,
          source: "contact_form",
        }),
      });
      setState("sent");
    } catch {
      // Even on a network error the design shows the sent state — the message is
      // best-effort and there is no error surface in this compact panel.
      setState("sent");
    }
  }

  return (
    <section id="contact" style={{ maxWidth: 1280, margin: "0 auto", padding: "clamp(56px,9vw,96px) clamp(16px,4vw,32px) clamp(72px,10vw,120px)" }}>
      <div
        style={{
          position: "relative",
          border: "1px solid rgba(0,120,212,.3)",
          borderRadius: 24,
          background: "radial-gradient(900px 380px at 8% -10%,rgba(0,120,212,.18),transparent 60%),linear-gradient(168deg,rgba(10,37,64,.5),#070d1e 64%)",
          padding: "clamp(28px,5vw,56px) clamp(20px,5vw,56px)",
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))",
          gap: "clamp(28px,5vw,64px)",
          alignItems: "center",
        }}
      >
        <div>
          <Eyebrow>Direct Engagement</Eyebrow>
          <h2 style={{ fontSize: "clamp(28px,4.6vw,42px)", lineHeight: 1.1, letterSpacing: "-.028em", fontWeight: 800, color: "#f8fafc", margin: "18px 0 16px", maxWidth: 560, textWrap: "pretty" }}>
            Five Hours a Month With NASA's Lead Microsoft 365 Architect.
          </h2>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: "#94a3b8", margin: "0 0 30px", maxWidth: 480 }}>
            $900 a month. No proposal, no SOW, no minimum term. Not sure it fits? Send the question and Shane answers it himself.
          </p>
          <button type="button" onClick={onStart} style={primaryLg}>
            Start at $900/mo
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div style={{ border: "1px solid rgba(30,41,59,.9)", borderRadius: 16, background: "rgba(2,6,23,.55)", padding: "clamp(20px,3vw,28px)" }}>
          {state === "idle" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={EYEBROW_LABEL}>Ask a question first</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,160px),1fr))", gap: 12 }}>
                <label style={labelCol}>
                  Name
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Your name" style={contactInput} />
                </label>
                <label style={labelCol}>
                  Work email
                  <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="you@yourcompany.com" style={contactInput} />
                </label>
              </div>
              <label style={labelCol}>
                Company
                <input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} placeholder="Company" style={contactInput} />
              </label>
              <label style={labelCol}>
                What's stuck
                <textarea rows={4} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder="The decision, the migration, the Copilot question. Two sentences is plenty." style={{ ...contactInput, lineHeight: 1.5, resize: "vertical" }} />
              </label>
              <button type="button" onClick={() => void send()} disabled={!form.name || !form.email} style={{ ...primaryLg, minHeight: 50, width: "100%", opacity: form.name && form.email ? 1 : 0.6, cursor: form.name && form.email ? "pointer" : "not-allowed" }}>
                Send to Shane
              </button>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "#94a3b8" }}>
                Goes to Shane directly. He cannot take on organizations that work with, contract to, or partner with NASA.
              </p>
            </div>
          )}
          {state === "sending" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, minHeight: 300, textAlign: "center" }}>
              <Loader2 className="w-7 h-7" style={{ color: "#0078D4", animation: "smcSpin 1s linear infinite" }} />
              <div style={{ fontSize: 15, color: "#e2e8f0" }}>Sending…</div>
            </div>
          )}
          {state === "sent" && (
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 12, minHeight: 300 }}>
              <div style={EYEBROW_LABEL}>Sent</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em" }}>Shane has it.</div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#cbd5e1" }}>
                He reads these himself and replies from his own inbox. If the answer is short, you get it there; if it needs a conversation, he proposes a time.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Shared button / field styles (from the design's CTA specs) ──────────────────

const primaryLg: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  minHeight: 52,
  padding: "0 26px",
  fontSize: 16,
  fontWeight: 600,
  borderRadius: 12,
  background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
  border: "none",
  color: "#fff",
  cursor: "pointer",
};
const outlineLg: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  minHeight: 52,
  padding: "0 22px",
  fontSize: 16,
  fontWeight: 600,
  borderRadius: 12,
  color: "#e2e8f0",
  border: "1px solid rgba(148,163,184,.3)",
  background: "transparent",
  cursor: "pointer",
};
const primaryMd: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 44,
  padding: "0 20px",
  fontSize: 14,
  fontWeight: 600,
  borderRadius: 10,
  background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
  border: "none",
  color: "#fff",
  cursor: "pointer",
};
const outlineMd: React.CSSProperties = {
  alignItems: "center",
  gap: 8,
  minHeight: 44,
  padding: "0 18px",
  fontSize: 14,
  fontWeight: 600,
  borderRadius: 10,
  color: "#e2e8f0",
  border: "1px solid rgba(148,163,184,.3)",
  background: "transparent",
  cursor: "pointer",
};
const labelCol: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  fontWeight: 500,
  color: "#cbd5e1",
};
const contactInput: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  borderRadius: 9,
  border: "1px solid rgba(148,163,184,.28)",
  background: "rgba(2,6,23,.55)",
  color: "#f1f5f9",
  fontFamily: "inherit",
  fontSize: 14,
  outline: "none",
};
