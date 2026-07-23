import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ChatCTA } from "@/components/ChatCTA";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import {
  CheckCircle2,
  ArrowRight,
  Building2,
  Zap,
  Shield,
  AlertCircle,
  AlertTriangle,
  Layers,
  Lock,
  Activity,
  Clock,
  Eye,
  Sparkles,
  FileText,
  FolderKanban,
  Boxes,
  ClipboardList,
  RefreshCw,
  Wrench,
  Database,
  Cpu,
  Send,
  BarChart2,
} from "lucide-react";
import { trackMspSignupStarted, trackPricingInteraction } from "@/lib/analytics";
import { useServices, resolvePublicServicePriceCents } from "@/hooks/useServices";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };
const CONNECTOR_BG = { background: "linear-gradient(180deg, var(--accent-blue), rgba(255,255,255,0.08))" };

// Current live-catalog counts. Assessments are repo-confirmed (21 rows, services.id 13-33,
// lib/db/migrations/manual/2026-07-20-assessment-detail-content.sql; 3 free per the tier flags
// there). Projects/documents/config packs are DB-catalog counts confirmed by Shane against the
// live Product Catalog — the engagement_projects table, document_product rows, and config_packs
// rows are admin-managed data with no in-repo seed for the full set (1 pack seeded in
// 0195_baseline_templates_quickstart_data.sql; the other 4 pack names are committed in
// Products.tsx). The $199–$549 document range matches the committed precedent copy on
// Assessments.tsx. These are catalog-size counts, not prices/tier names/seat counts — all tier
// data on this page stays 100% API-driven from /api/msp/signup/tiers.
const CATALOG_COUNTS = {
  assessments: 21,
  freeAssessments: 3,
  projects: 27,
  documents: 40,
  configPacks: 5,
} as const;

const CATALOG_TOTAL =
  CATALOG_COUNTS.assessments +
  CATALOG_COUNTS.projects +
  CATALOG_COUNTS.documents +
  CATALOG_COUNTS.configPacks;

interface MspTier {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  // Drizzle numeric — the API serializes this as a string of dollars (e.g. "499.00").
  price: number | string | null;
  billingType: string | null;
  tenantAllowance: number | null;
  aiCreditAllowance: number | null;
  overageRateCents: number | null;
  tierCapabilities: string[] | Record<string, boolean> | null;
  features: string[] | null;
  inclusions: string[] | null;
  badge: string | null;
  highlighted: boolean;
  fulfillmentTypeKey: string | null;
}

function formatPrice(raw: number | string | null, billingType: string | null): string {
  if (raw === null || raw === undefined) return "Contact for pricing";
  const dollars = typeof raw === "string" ? parseFloat(raw) : raw;
  if (isNaN(dollars)) return "Contact for pricing";
  const formatted = dollars % 1 === 0
    ? `$${dollars.toLocaleString()}`
    : `$${dollars.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // services.billing_type is the enum ["one_time","recurring_monthly"]; "monthly"/"annual"
  // kept for tolerance of legacy values.
  if (!billingType || billingType === "monthly" || billingType === "recurring_monthly") return `${formatted}/mo`;
  if (billingType === "annual") return `${formatted}/yr`;
  return formatted;
}

// Labels for the per-tier capability flags returned by /api/msp/signup/tiers
// (typeAttributes.tierCapabilities) — keys match msp-entitlement.ts PLAN_FEATURE_DEFS, label
// copy byte-identical to Monitoring.tsx/Home.tsx FEATURE_CHECKLIST_LABELS so the same
// entitlement reads the same everywhere. Unmapped keys are humanized, never silently dropped.
const CAPABILITY_LABELS: Record<string, string> = {
  advanced_signals: "Advanced tenant signal rules and priority scoring",
  custom_workflows: "Custom automation workflows",
  sla_scope_creep_custom_rules: "MSP-authored SLA / Scope-Creep override rules",
  sales_offers: "Sales Offer Engine recommendations",
  custom_bundle_composition: "Custom multi-package monitoring bundles",
};

function humanizeCapabilityKey(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function normalizeTierCapabilities(
  raw: string[] | Record<string, boolean> | null | undefined,
): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.entries(raw)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
}

function formatOverage(cents: number): string {
  if (cents < 100) return `${cents}¢ / extra tenant`;
  const dollars = cents / 100;
  return `$${dollars.toLocaleString()}/extra tenant`;
}

const ONBOARDING_OPTIONS = [
  {
    key: "self_service",
    label: "Self-Service Setup",
    desc: "Guided onboarding documentation and a recorded walkthrough. Ideal for technically confident partners who want to configure the platform independently.",
    icon: <Zap className="w-5 h-5 text-accent-blue" />,
    detail: "Access to the partner portal immediately. Setup guide + video walkthrough included.",
  },
  {
    key: "white_glove",
    label: "White-Glove Onboarding",
    desc: "A live onboarding session with Shane, full environment review, and co-configured first tenant handoff. Recommended for first-time MSP partners.",
    icon: <Shield className="w-5 h-5 text-accent-blue" />,
    detail: "Includes 2×60-min live sessions, tenant co-configuration, and a 30-day check-in call.",
  },
];

// The resale inventory — every card names only real, catalogued items. Assessment names are
// from the 21 committed rows; project domains mirror the signal-trigger keyword map in
// scripts/src/seed-engagement-project-triggers.ts (migration→hasExchangeOnPrem etc.); document
// examples and the $199/$549 range match Assessments.tsx's committed copy; config pack names
// are the seeded quickstart-v1 pack plus the four packs committed in Products.tsx; the
// Sales Bundle Builder and marketplace mechanics are real msp-portal features
// (msp-sales-bundles.ts, msp-marketplace-purchase.ts).
const INVENTORY = [
  {
    icon: ClipboardList,
    color: "blue",
    count: `${CATALOG_COUNTS.assessments} products · ${CATALOG_COUNTS.freeAssessments} free`,
    title: "Assessments: The Door-Opener",
    desc: "Real Graph-based scans across six zones — identity, compliance, data, Copilot, cost, and the big picture. Security Posture Assessment, Copilot Readiness Assessment, License & Cost Optimization Assessment, Migration Readiness Assessment — plus three free snapshots (tenant governance, Copilot readiness, license waste) built to start a client conversation that ends in scoped work.",
  },
  {
    icon: FolderKanban,
    color: "violet",
    count: `${CATALOG_COUNTS.projects} engagements`,
    title: "Projects: The Big-Ticket Layer",
    desc: "Scoped engagements spanning migration, governance remediation, security & compliance, licensing optimization, Copilot enablement, Power Platform, SharePoint information architecture, and data protection. They're signal-triggered: a tenant still running on-prem Exchange pulls the migration project into its generated SOW automatically — the pitch is written by the client's own telemetry.",
  },
  {
    icon: FileText,
    color: "emerald",
    count: `${CATALOG_COUNTS.documents} documents`,
    title: "Documents: Fast-Turn, High-Margin Paper",
    desc: "A 40-document catalog running from $199 tactical single-finding write-ups — a DLP incident list, a risky-users report, an MFA coverage gap — up to a $549 Board/Leadership Briefing Deck. Each one is generated from the client's real scan data rather than written from a blank page, and priced for the kind of margin paper deserves.",
  },
  {
    icon: Boxes,
    color: "indigo",
    count: `${CATALOG_COUNTS.configPacks} packs`,
    title: "Config Packs: Platform Minutes, Sold as a Service",
    desc: "Fixed-scope configuration work applied through the platform's real Graph write-back engine. The Entra ID Quick-Start Pack applies eight ordered baseline actions — security defaults, a break-glass admin account, a conditional access baseline, guest-access restrictions — alongside employee onboarding, offboarding, security incident response, and compromised-account recovery packs. Write-back is configured per tenant; where it's enabled, delivery is minutes, not a project plan.",
  },
  {
    icon: RefreshCw,
    color: "blue",
    count: "Recurring",
    title: "Monitoring & Retainers: The Recurring Floor",
    desc: "Project revenue spikes; monitoring compounds. Resell the platform's monitoring packages under your own branded bundles with the Sales Bundle Builder — wholesale is priced per tenant, the markup is yours — and layer advisory retainers on top: a recurring floor under every account that keeps producing the findings that feed everything else on this page.",
  },
  {
    icon: Wrench,
    color: "amber",
    count: "Billable hours",
    title: "The Manual-Labor Half — Yours to Bill",
    desc: "Not every finding can be auto-fixed, and that's the opportunity: stale-guest cleanups, MFA enrollment pushes, drifted conditional-access repair, oversharing remediation. The engines hand you a punch list with evidence attached; the hours it takes to work through it are billed by you, at your rate.",
  },
];

// From telemetry to billable work. Step 3's plan-gating qualifier is real: sales_offers is a
// per-tier capability flag (msp-entitlement.ts PLAN_FEATURE_DEFS) returned by
// /api/msp/signup/tiers and rendered as the "Included automation" list on the tier cards.
const PIPELINE = [
  {
    icon: Database,
    label: "Connect a client tenant",
    desc: "One scoped Microsoft Graph admin consent, and the signal engines begin scheduled read-only scans — configuration, identity, sharing, licensing.",
  },
  {
    icon: Cpu,
    label: "Findings become scored signals",
    desc: "Engines evaluate what they find against governance baselines and severity-score it. Every signal traces to a real, recorded check result — not an estimate.",
  },
  {
    icon: Sparkles,
    label: "Signals match the catalog",
    desc: "The Sales Offer Engine matches fired signals against the Product Catalog and drafts priced, scored, expiring offers — prices come from the catalog, never invented. Offer automation is plan-gated, not included in every tier.",
  },
  {
    icon: Send,
    label: "You review, brand, send",
    desc: "Offers are drafts under your control, not auto-sends. Your retail sits on top of wholesale, and the client sees the offer in their portal — under your branding.",
  },
  {
    icon: FileText,
    label: "Delivery generates itself where it can",
    desc: "A purchase triggers document and SOW generation automatically. Config-pack findings can be corrected by Graph write-back where it's enabled for that tenant. What's left is labor — the part you bill.",
  },
];

// Same six tenant-facing engines Monitoring.tsx presents (the customer-safe set from the
// Engine Registry) — membership deliberately kept identical so the two pages never disagree.
// The Sales Offer Engine is presented separately below as the partner-facing seventh surface;
// no "the platform has N engines" total is claimed anywhere on this page.
const ENGINES = [
  {
    icon: Activity,
    color: "emerald",
    name: "Health Engine",
    desc: "Composite health scoring plus license-utilization waste — the numbers that open licensing-optimization engagements.",
  },
  {
    icon: Lock,
    color: "red",
    name: "Security Engine",
    desc: "Anonymous links, stale guests, over-permissioned OAuth grants, MFA gaps — every exposure is a hardening project or a cleanup you bill.",
  },
  {
    icon: Layers,
    color: "blue",
    name: "Drift Engine",
    desc: "Configuration checked against baseline on every cycle — unauthorized drift becomes remediation work with evidence attached.",
  },
  {
    icon: Clock,
    color: "indigo",
    name: "SLA Engine",
    desc: "Your delivery commitments tracked against the clock, with breach risk surfaced before it's a hard client conversation.",
  },
  {
    icon: Eye,
    color: "violet",
    name: "Monitoring Engine",
    desc: "The check-execution foundation — and the recurring service itself, resellable under your own bundles.",
  },
  {
    icon: AlertTriangle,
    color: "amber",
    name: "Scope Creep Engine",
    desc: "Engineer hours validated against the signed SOW; out-of-scope work escalates with SOW-amendment and pricing-review recommendations.",
  },
];

const colorMap: Record<string, { icon: string; border: string; badge: string }> = {
  blue: { icon: "text-accent-blue", border: "border-accent-blue/20", badge: "bg-white/[0.06] text-accent-blue border-white/[0.08]" },
  red: { icon: "text-red-400", border: "border-red-500/20", badge: "bg-red-500/10 text-red-400 border-red-500/20" },
  emerald: { icon: "text-emerald-400", border: "border-emerald-500/20", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  indigo: { icon: "text-indigo-400", border: "border-indigo-500/20", badge: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" },
  amber: { icon: "text-amber-400", border: "border-amber-500/20", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  violet: { icon: "text-accent-violet", border: "border-accent-violet/20", badge: "bg-white/[0.06] text-accent-violet border-white/[0.08]" },
};

// Partner-economics cards. White-label wording is deliberately honest: the portal carries the
// MSP's logo/color/domain/agreement (msp-settings.ts, msp-custom-domain.ts), while a
// "Powered by Shane McCaw Consulting" credential line stays visible on every portal page by
// design (app-shell.tsx renders it non-removable) — so this page never claims "100%
// white-label" or MSP-branded PDFs (report PDFs are unbranded today).
const WHY_PARTNER = [
  {
    icon: <Building2 className="w-5 h-5 text-accent-blue" />,
    title: "White-Label Where It Counts — Honestly",
    desc: "Your logo and brand color across the portal, your own custom domain with DNS verification, your own customer agreement, a branded login. One line stays visible by design: \"Powered by Shane McCaw Consulting\" — because a 30-year Microsoft veteran who wrote the M365 Copilot governance framework NASA distributed agency-wide co-signing your portal helps you close, and pretending the platform is homegrown doesn't.",
  },
  {
    icon: <Zap className="w-5 h-5 text-accent-blue" />,
    title: "Wholesale In, Retail Out",
    desc: "Deliverables are purchased through the partner marketplace at wholesale, on your own card. Retail is your call — the platform has no visibility into your customer invoicing, and takes no percentage of it. The spread between wholesale and what your market bears is the business model.",
  },
  {
    icon: <BarChart2 className="w-5 h-5 text-accent-blue" />,
    title: "Run the Whole Book from One Screen",
    desc: "Portfolio dashboards, cross-tenant alerts and an activity timeline, per-engine trend history — and an Executive Mode that ranks your top-risk tenants next to your top-opportunity tenants by open offer value, so retention work and revenue work share one view.",
  },
  {
    icon: <Shield className="w-5 h-5 text-accent-blue" />,
    title: "Protects Revenue You Already Booked",
    desc: "The SLA and Scope Creep engines guard the downside: support commitments tracked against the clock, every engineer hour validated against the signed SOW, and unbilled out-of-scope work escalated with a recommended amendment — instead of quietly eating your margin.",
  },
];

// The 2008 contrast — left column is the generic year-one MSP grind; right column maps 1:1 to
// confirmed platform features (21 assessments, signal-driven SOW generation, the 40-document
// catalog, the plan-gated Sales Offer Engine, the six scheduled engines).
const YEAR_ONE_HARD_WAY = [
  "An assessment methodology you invent one client at a time",
  "Every SOW drafted from scratch, every time",
  "A deliverables library that lives in your head",
  "Upsells that only happen when you personally notice something wrong",
  "Monitoring you promise, but can't staff overnight",
];

const YEAR_ONE_PLATFORM = [
  `${CATALOG_COUNTS.assessments} assessment products ready to run on day one — ${CATALOG_COUNTS.freeAssessments} of them free door-openers`,
  "SOWs generated from each tenant's real signals, with matching project scope pulled in automatically",
  `A ${CATALOG_COUNTS.documents}-document deliverables library, priced from $199 to $549`,
  "An engine that drafts your next offer from live findings (plan-gated)",
  "Six signal engines watching every tenant on a schedule — around the clock",
];

type Step = "tiers" | "onboarding" | "confirm";

export default function Msp() {
  const [tiers, setTiers] = useState<MspTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("tiers");
  const [selectedTier, setSelectedTier] = useState<MspTier | null>(null);
  const [selectedOnboarding, setSelectedOnboarding] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);

  const { services: onboardingServices } = useServices("msp_onboarding");

  function getOnboardingPrice(key: string): string | null {
    const svc = onboardingServices.find(
      (s) => s.serviceType === key || s.slug === `msp-onboarding-${key.replace("_", "-")}`
    );
    if (!svc) return null;
    // Canonical resolution — a modern-created onboarding service carries its
    // price only in priceCents (legacy price NULL), which the old raw
    // parseFloat(svc.price) read silently hid.
    const cents = resolvePublicServicePriceCents(svc);
    if (cents == null) return null;
    return cents === 0 ? "Included" : `+$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }

  useEffect(() => {
    fetch("/api/msp/signup/tiers")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ tiers: MspTier[] } | MspTier[]>;
      })
      .then((data) => {
        const tiersData = Array.isArray(data)
          ? data
          : (data as { tiers?: MspTier[] }).tiers ?? [];
        setTiers(tiersData);
        setLoading(false);
      })
      .catch(() => {
        setError("Unable to load partnership tiers. Please try again or contact us directly.");
        setLoading(false);
      });
  }, []);

  function selectTier(tier: MspTier) {
    setSelectedTier(tier);
    trackPricingInteraction("plan_select", { label: tier.name, metadata: { tierSlug: tier.slug } });
    trackMspSignupStarted({ tier_slug: tier.slug, tier_name: tier.name });
    setStep("onboarding");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goToConfirm() {
    if (!selectedOnboarding) return;
    setStep("confirm");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCheckout() {
    if (!selectedTier || !agreed) return;
    if (!selectedTier.fulfillmentTypeKey) return;
    const params = new URLSearchParams({
      onboarding: selectedOnboarding ?? "self_service",
    });
    window.location.href = `/checkout/${encodeURIComponent(selectedTier.slug)}?${params.toString()}`;
  }

  return (
    <Layout>
      <SEOMeta
        title="MSP & Partner Programme | Shane McCaw Consulting"
        description={`A revenue engine for MSPs: ${CATALOG_COUNTS.assessments} assessments, ${CATALOG_COUNTS.projects} project engagements, ${CATALOG_COUNTS.documents} document products, and ${CATALOG_COUNTS.configPacks} config packs — resold at your margin, under your brand, driven by live tenant signals.`}
        ogUrl="https://shanemccawconsulting.com/msp"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "MSP Partner Programme — Shane McCaw Consulting",
          "description": "Partner platform for managed service providers: signal engines watch client tenants and map findings to a resale catalog of assessments, project engagements, document products, and config packs — sold at the MSP's own margin.",
          "url": "https://shanemccawconsulting.com/msp",
          "serviceType": "MSP Partner Programme",
          "areaServed": { "@type": "Country", "name": "United States" },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com",
          },
        }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="pt-32 sm:pt-40 pb-12 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-5xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <Shield className="w-4 h-4" />
            MSP &amp; Partner Programme
          </div>
          <h1 className="font-display text-4xl sm:text-6xl font-bold text-text-primary tracking-tight leading-tight max-w-4xl mx-auto mb-6">
            Your Clients' Tenants Are Full of Billable Work. <GradientText>This Platform Finds It.</GradientText>
          </h1>
          <p className="text-lg sm:text-xl text-text-secondary max-w-3xl mx-auto leading-relaxed mb-10">
            Signal engines watch every tenant in your book through Microsoft Graph — and every
            finding maps to a real, priced catalog: {CATALOG_COUNTS.assessments} assessments,{" "}
            {CATALOG_COUNTS.projects} scoped project engagements, {CATALOG_COUNTS.documents} document
            products, {CATALOG_COUNTS.configPacks} automated config packs. You buy at wholesale, set
            your own retail, and keep the margin.
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 max-w-md mx-auto mb-14">
            <a
              href="#tiers"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-semibold text-white shadow-lg shadow-accent-blue/20 transition-opacity hover:opacity-90 flex items-center justify-center gap-2 text-base"
              style={GRADIENT_BG}
              data-track="cta"
            >
              <span>View Partnership Tiers</span>
              <ArrowRight className="w-5 h-5" />
            </a>
            <ChatCTA
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors flex items-center justify-center text-base"
              data-track="cta"
            >
              Talk to Shane First
            </ChatCTA>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-3xl mx-auto">
            <StatPanel label="Assessment products" value={CATALOG_COUNTS.assessments} />
            <StatPanel label="Project engagements" value={CATALOG_COUNTS.projects} />
            <StatPanel label="Document products" value={CATALOG_COUNTS.documents} />
            <StatPanel label="Config packs" value={CATALOG_COUNTS.configPacks} />
          </div>
        </div>
      </section>

      {step === "tiers" && (
        <>
          {/* ── THE REFRAME ─────────────────────────────────────────────── */}
          <section className="py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-5xl mx-auto">
              <div className="text-center max-w-3xl mx-auto mb-10">
                <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
                  Not a Tool Subscription. A Revenue Engine.
                </h2>
                <p className="text-text-secondary">
                  The platform fee is the smallest number on this page. What you're actually
                  buying is inventory.
                </p>
              </div>
              <GlassPanel className="p-8 sm:p-10">
                <p className="text-text-secondary leading-relaxed mb-4">
                  Most MSP tooling sells you visibility and stops there: dashboards you pay for,
                  findings you're left to monetize on your own. This platform is built the other
                  way around. Every scan result is evaluated against a priced catalog — so an MFA
                  coverage gap isn't just a red row on a dashboard, it's a $199 write-up, a
                  hardening project in a generated SOW, or both.
                </p>
                <p className="text-text-secondary leading-relaxed">
                  The commercial mechanics are real, not implied: you purchase deliverables
                  through the partner marketplace at wholesale, on your own card, and set
                  whatever retail your market bears. The platform doesn't see your customer
                  invoicing and doesn't take a percentage of it. Your margin is the point — not a
                  leak.
                </p>
              </GlassPanel>
            </div>
          </section>

          {/* ── THE 2008 THROUGHLINE ────────────────────────────────────── */}
          <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
            <div className="max-w-6xl mx-auto">
              <div className="text-center max-w-3xl mx-auto mb-14">
                <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
                  Shane Started Out on His Own in 2008. None of This Existed.
                </h2>
                <p className="text-text-secondary">
                  Year one of a new MSP is spent building the machine while you run it: an
                  assessment you improvise per client, SOWs written at midnight, a deliverables
                  library that exists only in your head, and upsells that happen only when you
                  personally notice something wrong. Shane ran that year in 2008. This platform
                  is the machine he didn't have — finished, and available from day one.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 sm:p-8 rounded-2xl bg-charcoal-1 border border-white/[0.06]">
                  <div className="flex items-center gap-2 mb-4">
                    <Clock className="w-4 h-4 text-amber-400" />
                    <h3 className="font-display text-base font-bold text-text-primary">Year One, the Hard Way</h3>
                  </div>
                  <ul className="space-y-2.5">
                    {YEAR_ONE_HARD_WAY.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm text-text-secondary">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="p-6 sm:p-8 rounded-2xl bg-charcoal-1 border border-accent-blue/20">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap className="w-4 h-4 text-accent-blue" />
                    <h3 className="font-display text-base font-bold text-text-primary">Year One, With the Platform</h3>
                  </div>
                  <ul className="space-y-2.5">
                    {YEAR_ONE_PLATFORM.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm text-text-secondary">
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-accent-blue" />
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* ── THE UPSELL INVENTORY ────────────────────────────────────── */}
          <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
            <div className="max-w-6xl mx-auto">
              <div className="text-center max-w-3xl mx-auto mb-14">
                <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
                  {CATALOG_TOTAL} Catalog Line Items. <GradientText>Times Every Tenant You Manage.</GradientText>
                </h2>
                <p className="text-text-secondary">
                  This is where "hundreds of upsell opportunities" stops being a slogan and
                  becomes arithmetic. The live catalog holds {CATALOG_TOTAL} discrete line
                  items — {CATALOG_COUNTS.assessments} assessments,{" "}
                  {CATALOG_COUNTS.projects} project engagements, {CATALOG_COUNTS.documents}{" "}
                  document products, {CATALOG_COUNTS.configPacks} config packs — all of them
                  priced except the {CATALOG_COUNTS.freeAssessments} free door-opener
                  assessments, and every one deployable per client. A ten-tenant book isn't
                  looking at {CATALOG_TOTAL} opportunities; it's looking at hundreds, plus
                  every finding-driven labor engagement the engines surface in between.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {INVENTORY.map((item) => {
                  const Icon = item.icon;
                  const c = colorMap[item.color];
                  return (
                    <div key={item.title} className="flex flex-col p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06] hover:border-white/[0.12] transition-all">
                      <div className={`w-11 h-11 rounded-xl bg-white/[0.06] border ${c.border} flex items-center justify-center mb-4`}>
                        <Icon className={`w-5 h-5 ${c.icon}`} />
                      </div>
                      <span className={`text-[10px] uppercase font-bold tracking-wider mb-2 px-2 py-0.5 rounded-full border self-start ${c.badge}`}>
                        {item.count}
                      </span>
                      <h3 className="font-display text-lg font-bold text-text-primary mb-2">{item.title}</h3>
                      <p className="text-sm text-text-secondary leading-relaxed">{item.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ── SIGNAL → INVOICE PIPELINE ───────────────────────────────── */}
          <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
            <div className="max-w-6xl mx-auto">
              <div className="text-center max-w-3xl mx-auto mb-14">
                <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
                  How a Finding Becomes <GradientText>a Line on Your Invoice</GradientText>
                </h2>
                <p className="text-text-secondary">
                  The pipeline from telemetry to billable work runs on rules and a catalog — not
                  on you remembering to check dashboards.
                </p>
              </div>
              <ol className="relative max-w-2xl mx-auto">
                {PIPELINE.map((pStep, i) => {
                  const Icon = pStep.icon;
                  return (
                    <li key={pStep.label} className="relative flex gap-5 pb-10 last:pb-0">
                      {i < PIPELINE.length - 1 && (
                        <span
                          className="absolute left-[22px] top-11 bottom-0 w-px"
                          style={CONNECTOR_BG}
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className="relative z-10 shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white"
                        style={GRADIENT_BG}
                      >
                        <Icon className="w-5 h-5" />
                      </span>
                      <div className="pt-1">
                        <div className="text-[10px] font-bold text-accent-blue uppercase tracking-widest mb-1">Step {i + 1}</div>
                        <div className="text-base font-bold text-text-primary mb-1.5">{pStep.label}</div>
                        <p className="text-sm text-text-secondary leading-relaxed">{pStep.desc}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>

          {/* ── ENGINES ─────────────────────────────────────────────────── */}
          <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
            <div className="max-w-6xl mx-auto">
              <div className="text-center max-w-3xl mx-auto mb-14">
                <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
                  Six Engines Watch the Book. A Seventh Drafts the Offers.
                </h2>
                <p className="text-text-secondary">
                  The same six tenant-facing signal engines behind our Monitoring product run
                  across every tenant you manage — and each one generates a different kind of
                  billable work.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                {ENGINES.map((engine) => {
                  const Icon = engine.icon;
                  const c = colorMap[engine.color];
                  return (
                    <div key={engine.name} className="flex items-start gap-4 p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06] hover:border-white/[0.12] transition-all">
                      <div className={`w-11 h-11 rounded-xl bg-white/[0.06] border ${c.border} flex items-center justify-center shrink-0`}>
                        <Icon className={`w-5 h-5 ${c.icon}`} />
                      </div>
                      <div>
                        <h3 className="font-display text-base font-bold text-text-primary mb-1.5">{engine.name}</h3>
                        <p className="text-sm text-text-secondary leading-relaxed">{engine.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="p-6 sm:p-8 rounded-2xl bg-charcoal-1 border border-accent-blue/30">
                <div className="flex flex-col md:flex-row items-start gap-5">
                  <div className="w-12 h-12 rounded-2xl bg-white/[0.06] border border-accent-blue/20 flex items-center justify-center shrink-0">
                    <Sparkles className="w-6 h-6 text-accent-blue" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-bold text-text-primary mb-2">Sales Offer Engine</h3>
                    <p className="text-sm text-text-secondary leading-relaxed">
                      The partner-facing engine that turns what the other six find into revenue:
                      it converts fired signals plus the Product Catalog into priced, scored
                      offer drafts with expiry windows — and Executive Mode ranks your book by
                      open offer value, so you always know which tenant to call next. Offer
                      automation is plan-gated; each partnership plan below lists the
                      automation it includes.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── PARTNER ECONOMICS / WHY PARTNER ─────────────────────────── */}
          <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
            <div className="max-w-6xl mx-auto">
              <div className="text-center mb-16 max-w-3xl mx-auto">
                <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">Partner Economics</p>
                <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary">
                  Your Brand on the Portal. Your Margin on the Invoice.
                </h2>
                <p className="text-text-secondary mt-4 leading-relaxed text-sm sm:text-base">
                  M365 administration is typically delivered as a low-margin commodity. Partners
                  on this platform package it as premium, evidence-backed governance — with the
                  economics structured so the upside lands on your invoice, not ours.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {WHY_PARTNER.map((item, idx) => (
                  <div key={idx} className="flex gap-4 p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06] hover:border-accent-blue/20 transition-all">
                    <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                      {item.icon}
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-text-primary mb-2 text-base">{item.title}</h3>
                      <p className="text-text-secondary text-sm leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {/* ── TIERS / ONBOARDING / CONFIRM ─────────────────────────────────── */}
      <section id="tiers" className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06] scroll-mt-24">
        <div className="max-w-6xl mx-auto">

          {/* ── STEP 1: TIERS ─────────────────────────────────────────────── */}
          {step === "tiers" && (
            <>
              <div className="text-center mb-16">
                <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">Partnership Tiers</p>
                <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary">Choose Your Partnership Plan</h2>
                <p className="text-text-secondary mt-4 max-w-xl mx-auto leading-relaxed">
                  Tiers load live from the platform catalog — tenant allowances, AI credits,
                  each plan's real feature list and included automation, priced exactly as they
                  bill. Automation like Sales Offer drafting is plan-gated, not in every tier.
                </p>
              </div>

              {loading && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="rounded-2xl border bg-charcoal-1 border-white/[0.06] p-8 animate-pulse">
                      <div className="h-4 w-16 bg-white/[0.08] rounded mb-4" />
                      <div className="h-8 w-40 bg-white/[0.08] rounded mb-2" />
                      <div className="h-4 w-24 bg-white/[0.08] rounded mb-6" />
                      <div className="space-y-2">
                        {[0, 1, 2, 3].map((j) => (
                          <div key={j} className="h-3 bg-white/[0.06] rounded" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {error && (
                <div className="max-w-xl mx-auto bg-charcoal-1 border border-white/[0.06] rounded-2xl p-8 text-center">
                  <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
                  <p className="text-text-primary font-semibold mb-2">Couldn't load partnership tiers</p>
                  <p className="text-text-secondary text-sm leading-relaxed mb-6">{error}</p>
                  <ChatCTA
                    className="inline-flex items-center gap-2 text-white font-semibold px-6 py-3.5 rounded-xl transition-opacity hover:opacity-90 text-sm"
                    style={GRADIENT_BG}
                    data-track="cta"
                  >
                    Contact Shane Directly <ArrowRight className="w-4 h-4" />
                  </ChatCTA>
                </div>
              )}

              {!loading && !error && tiers.length === 0 && (
                <div className="max-w-xl mx-auto bg-charcoal-1 border border-white/[0.06] rounded-2xl p-8 text-center">
                  <p className="text-text-primary font-semibold mb-2">No tiers available yet</p>
                  <p className="text-text-secondary text-sm mb-6">
                    Partnership tiers are being configured. Contact Shane directly to discuss your options.
                  </p>
                  <ChatCTA
                    className="inline-flex items-center gap-2 text-white font-semibold px-6 py-3.5 rounded-xl transition-opacity hover:opacity-90 text-sm"
                    style={GRADIENT_BG}
                    data-track="cta"
                  >
                    Get in Touch
                  </ChatCTA>
                </div>
              )}

              {!loading && !error && tiers.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {tiers.map((tier) => {
                    const capabilities = normalizeTierCapabilities(tier.tierCapabilities).map(
                      (key) => CAPABILITY_LABELS[key] ?? humanizeCapabilityKey(key),
                    );
                    return (
                    <div
                      key={tier.id}
                      className={`relative rounded-2xl border p-8 flex flex-col transition-all group ${
                        tier.highlighted
                          ? "bg-charcoal-1 border-accent-blue/50 shadow-xl shadow-accent-blue/10 hover:-translate-y-1"
                          : "bg-charcoal-1 border-white/[0.06] hover:border-white/[0.12] hover:-translate-y-1"
                      }`}
                    >
                      {tier.badge && (
                        <span
                          className="absolute -top-3.5 left-8 text-[10px] uppercase tracking-wider font-extrabold px-3 py-1 rounded-full text-white shadow-md"
                          style={GRADIENT_BG}
                        >
                          {tier.badge}
                        </span>
                      )}

                      <div className="mb-6">
                        <p className="text-xs font-extrabold uppercase tracking-widest mb-2 text-accent-blue">
                          {tier.name}
                        </p>
                        {tier.tagline && (
                          <p className="text-sm text-text-secondary leading-relaxed">
                            {tier.tagline}
                          </p>
                        )}
                      </div>

                      <div className="mb-6">
                        <p className="font-numeric text-4xl font-medium tracking-tight text-text-primary">
                          {formatPrice(tier.price, tier.billingType)}
                        </p>
                        {tier.tenantAllowance !== null && (
                          <p className="text-sm mt-2.5 text-text-secondary">
                            Up to {tier.tenantAllowance} managed tenant{tier.tenantAllowance !== 1 ? "s" : ""}
                          </p>
                        )}
                        {tier.aiCreditAllowance !== null && (
                          <p className="text-xs text-text-secondary mt-1">
                            {tier.aiCreditAllowance.toLocaleString()} AI credits / month
                          </p>
                        )}
                        {tier.overageRateCents !== null && tier.overageRateCents > 0 && (
                          <p className="text-[10px] text-text-secondary uppercase tracking-widest mt-1.5 font-bold">
                             Overage: {formatOverage(tier.overageRateCents)}
                          </p>
                        )}
                      </div>

                      {(tier.features?.length ?? 0) > 0 && (
                        <ul className={`space-y-3 pt-6 border-t border-white/[0.06] flex-1 ${capabilities.length > 0 ? "mb-6" : "mb-8"}`}>
                          {tier.features!.map((f, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-xs text-text-secondary">
                              <CheckCircle2 className="w-4 h-4 text-accent-blue shrink-0 mt-0.5" />
                              <span className="leading-relaxed">{f}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* Included automation — the real per-tier capability flags
                          (typeAttributes.tierCapabilities) from the live catalog; this is the
                          list the page's plan-gating copy points at. */}
                      {capabilities.length > 0 && (
                        <div className="mb-8 pt-5 border-t border-white/[0.06]">
                          <p className="text-[10px] font-bold text-accent-violet uppercase tracking-widest mb-2.5">
                            Included Automation
                          </p>
                          <ul className="space-y-2">
                            {capabilities.map((label) => (
                              <li key={label} className="flex items-start gap-2.5 text-xs text-text-secondary">
                                <Sparkles className="w-4 h-4 text-accent-violet shrink-0 mt-0.5" />
                                <span className="leading-relaxed">{label}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {tier.fulfillmentTypeKey ? (
                        <button
                          onClick={() => selectTier(tier)}
                          className="w-full inline-flex items-center justify-center gap-2 font-bold px-6 py-3.5 rounded-xl text-white transition-opacity hover:opacity-90 text-xs"
                          style={GRADIENT_BG}
                          data-track="cta"
                        >
                          Get Started <ArrowRight className="w-4 h-4" />
                        </button>
                      ) : (
                        <div className="w-full text-center">
                          <p className="text-xs mb-3 text-text-secondary font-semibold">
                            Not yet available for self-service signup
                          </p>
                          <ChatCTA
                            className="inline-flex items-center gap-2 font-semibold px-6 py-3 rounded-xl border border-white/[0.12] text-text-secondary hover:border-white/[0.2] hover:text-text-primary transition-colors text-xs"
                            data-track="cta"
                          >
                            Contact Shane <ArrowRight className="w-3.5 h-3.5" />
                          </ChatCTA>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── STEP 2: ONBOARDING ────────────────────────────────────────── */}
          {step === "onboarding" && selectedTier && (
            <>
              <div className="text-center mb-10">
                <button
                  onClick={() => setStep("tiers")}
                  className="text-accent-blue text-sm font-semibold hover:underline mb-4 inline-flex items-center gap-1"
                >
                  ← Back to tiers
                </button>
                <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">Onboarding Package</p>
                <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary">
                  How Would You Like to Get Started?
                </h2>
                <p className="text-text-secondary mt-4 max-w-lg mx-auto">
                  You've selected <strong className="text-text-primary">{selectedTier.name}</strong>. Choose your onboarding style below.
                </p>
              </div>

              <div className="max-w-2xl mx-auto space-y-4 mb-10">
                {ONBOARDING_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setSelectedOnboarding(opt.key)}
                    className={`w-full text-left p-6 rounded-2xl border-2 transition-all ${
                      selectedOnboarding === opt.key
                        ? "border-accent-blue/60 bg-charcoal-1"
                        : "border-white/[0.06] bg-charcoal-1/60 hover:border-white/[0.12]"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                        {opt.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                          <h3 className="font-bold text-text-primary">{opt.label}</h3>
                          {getOnboardingPrice(opt.key) && (
                            <span className="font-numeric text-xs font-semibold text-accent-blue bg-white/[0.06] px-2 py-0.5 rounded-full border border-white/[0.08]">
                              {getOnboardingPrice(opt.key)}
                            </span>
                          )}
                          {selectedOnboarding === opt.key && (
                            <span className="text-xs font-bold text-white px-2 py-0.5 rounded-full" style={GRADIENT_BG}>Selected</span>
                          )}
                        </div>
                        <p className="text-text-secondary text-sm leading-relaxed mb-2">{opt.desc}</p>
                        <p className="text-accent-blue text-xs font-semibold">{opt.detail}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="max-w-2xl mx-auto text-center">
                <button
                  onClick={goToConfirm}
                  disabled={!selectedOnboarding}
                  className="inline-flex items-center gap-2 text-white font-bold px-10 py-4 rounded-xl transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-base"
                  style={GRADIENT_BG}
                  data-track="cta"
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

          {/* ── STEP 3: CONFIRM + CLICKWRAP ───────────────────────────────── */}
          {step === "confirm" && selectedTier && selectedOnboarding && (
            <>
              <div className="text-center mb-10">
                <button
                  onClick={() => setStep("onboarding")}
                  className="text-accent-blue text-sm font-semibold hover:underline mb-4 inline-flex items-center gap-1"
                >
                  ← Back
                </button>
                <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">Review & Confirm</p>
                <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary">
                  Almost There
                </h2>
              </div>

              <div className="max-w-2xl mx-auto">
                <div className="bg-charcoal-1 border border-white/[0.06] rounded-2xl p-8 mb-6 space-y-5">
                  <div>
                    <p className="text-xs font-bold text-accent-blue uppercase tracking-widest mb-1">Selected Plan</p>
                    <p className="text-text-primary font-bold text-lg">{selectedTier.name}</p>
                    <p className="font-numeric text-text-secondary text-sm">{formatPrice(selectedTier.price, selectedTier.billingType)}</p>
                  </div>
                  <div className="border-t border-white/[0.06] pt-5">
                    <p className="text-xs font-bold text-accent-blue uppercase tracking-widest mb-1">Onboarding</p>
                    <p className="text-text-primary font-semibold">
                      {ONBOARDING_OPTIONS.find((o) => o.key === selectedOnboarding)?.label}
                    </p>
                  </div>
                  {selectedTier.tenantAllowance !== null && (
                    <div className="border-t border-white/[0.06] pt-5">
                      <p className="text-xs font-bold text-accent-blue uppercase tracking-widest mb-1">Tenant Allowance</p>
                      <p className="text-text-primary font-semibold">{selectedTier.tenantAllowance} managed tenant{selectedTier.tenantAllowance !== 1 ? "s" : ""} included</p>
                    </div>
                  )}
                </div>

                <div className="bg-charcoal-1/60 border border-white/[0.06] rounded-2xl p-6 mb-8">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      className="mt-1 w-4 h-4 accent-accent-blue flex-shrink-0"
                    />
                    <span className="text-sm text-text-secondary leading-relaxed">
                      I have read and agree to the{" "}
                      <a href="/msp-terms" target="_blank" rel="noopener noreferrer" className="text-accent-blue underline hover:no-underline font-semibold">
                        MSP Partner Terms of Service
                      </a>{" "}
                      and the{" "}
                      <a href="/dpa" target="_blank" rel="noopener noreferrer" className="text-accent-blue underline hover:no-underline font-semibold">
                        Data Processing Agreement
                      </a>
                      . I understand that client tenant data processed through the Shane McCaw Consulting platform is subject to the DPA obligations described therein.
                    </span>
                  </label>
                </div>

                {!selectedTier.fulfillmentTypeKey && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-amber-300 text-sm leading-relaxed">
                      Self-service checkout is not yet available for this tier. Clicking continue will open a contact form so Shane can set you up directly.
                    </p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-4">
                  {selectedTier.fulfillmentTypeKey ? (
                    <button
                      onClick={handleCheckout}
                      disabled={!agreed}
                      className="flex-1 inline-flex items-center justify-center gap-2 text-white font-bold px-8 py-4 rounded-xl transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-base"
                      style={GRADIENT_BG}
                      data-track="cta"
                    >
                      Proceed to Checkout <ArrowRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <ChatCTA
                      className="flex-1 inline-flex items-center justify-center gap-2 text-white font-bold px-8 py-4 rounded-xl transition-opacity hover:opacity-90 text-base text-center"
                      style={GRADIENT_BG}
                      data-track="cta"
                    >
                      Contact Shane to Get Started <ArrowRight className="w-4 h-4" />
                    </ChatCTA>
                  )}
                  <button
                    onClick={() => { setAgreed(false); setStep("tiers"); setSelectedTier(null); setSelectedOnboarding(null); }}
                    className="flex-shrink-0 inline-flex items-center justify-center gap-2 text-text-secondary font-semibold border border-white/[0.12] px-6 py-4 rounded-xl hover:border-white/[0.2] transition-colors text-sm"
                  >
                    Start Over
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── FINAL CTA ─────────────────────────────────────────────────────── */}
      {step === "tiers" && (
        <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06] text-center">
          <div className="max-w-3xl mx-auto">
            <GlassPanel className="p-8 sm:p-12">
              <p className="text-xs uppercase tracking-widest text-text-secondary mb-4">Ready to Talk?</p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
                Day-One Infrastructure for <GradientText>Your Whole Book.</GradientText>
              </h2>
              <p className="text-text-secondary max-w-xl mx-auto mb-8 leading-relaxed">
                Whether you're in year one — like Shane was in 2008 — or running an established
                book, the entry point is a 30-minute conversation about your client mix and
                where the fastest resale wins are.
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <ChatCTA
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
                  style={GRADIENT_BG}
                  data-track="cta"
                >
                  Book a Partner Discovery Call
                </ChatCTA>
                <a
                  href="#tiers"
                  className="inline-flex items-center gap-2 text-text-secondary font-semibold hover:text-text-primary transition-colors text-sm border border-white/[0.12] px-6 py-3.5 rounded-xl hover:border-white/[0.2]"
                  data-track="cta"
                >
                  View Tiers <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </GlassPanel>
          </div>
        </section>
      )}
    </Layout>
  );
}
