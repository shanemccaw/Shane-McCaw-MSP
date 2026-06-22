import { CheckCircle, ArrowRight, Clock, Users, Building2, Shield, Zap } from "lucide-react";
import { Link } from "wouter";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { useServices, formatPriceDisplay } from "@/hooks/useServices";
import NotFound from "@/pages/not-found";

interface OfferContent {
  dbSlug: string;
  name: string;
  tagline: string;
  tier: string;
  tierColor: string;
  description: string;
  deliverables: string[];
  whoFor: string[];
  steps: Array<{ title: string; desc: string }>;
  turnaround: string;
  ctaLabel: string;
  metaDescription: string;
}

const OFFER_CONTENT: Record<string, OfferContent> = {
  "tenant-health-audit": {
    dbSlug: "m365-tenant-health-audit",
    name: "M365 Tenant Health Audit",
    tagline: "Know exactly what's wrong — and what it will cost if you don't fix it.",
    tier: "Entry",
    tierColor: "bg-[#0078D4]/15 text-[#0078D4] border-[#0078D4]/30",
    description:
      "A comprehensive NASA‑methodology assessment of your Microsoft 365 tenant — covering configuration, identity, access, licensing, security posture, compliance gaps, Teams/SharePoint architecture, and governance maturity. You get a clear, prioritized picture of where your environment stands and a remediation roadmap you can act on immediately.",
    deliverables: [
      "20–30 page written assessment report",
      "60-minute executive briefing & Q&A session",
      "Full configuration review across all M365 workloads",
      "Identity, access management & licensing analysis",
      "Security posture & compliance gap review",
      "Governance maturity scoring",
      "Prioritized remediation roadmap with effort estimates",
    ],
    whoFor: [
      "Mid-market organizations (200–1,500 employees) with organic M365 growth",
      "IT leaders who inherited a tenant they didn't design",
      "Companies preparing for a compliance audit or certification",
      "Organizations considering a migration or major M365 expansion",
    ],
    steps: [
      {
        title: "Kickoff & Discovery",
        desc: "A 60-minute intake call to understand your environment, compliance requirements, and known pain points.",
      },
      {
        title: "Tenant Analysis",
        desc: "Shane conducts a systematic review of your tenant — identity, licensing, security, compliance, Teams, SharePoint, and governance settings.",
      },
      {
        title: "Findings Report",
        desc: "A 20–30 page written report documenting every gap, risk, and misconfiguration — with severity ratings and effort estimates for remediation.",
      },
      {
        title: "Executive Debrief",
        desc: "A live 60-minute briefing to walk through findings, answer questions, and agree on a prioritized remediation plan.",
      },
    ],
    turnaround: "2 weeks",
    ctaLabel: "Start Your Audit",
    metaDescription:
      "Get a comprehensive NASA-methodology Microsoft 365 tenant health audit from Shane McCaw. 20–30 page report, executive briefing, and prioritized remediation roadmap. Fixed price, 2-week turnaround.",
  },

  "migration-readiness-assessment": {
    dbSlug: "migration-readiness-assessment",
    name: "Migration Readiness Assessment",
    tagline: "Discover every migration risk before your project starts.",
    tier: "Entry",
    tierColor: "bg-[#0078D4]/15 text-[#0078D4] border-[#0078D4]/30",
    description:
      "A rapid, expert-led assessment of your readiness for an M365, Exchange, SharePoint, or cross-tenant migration. Before you commit to a migration timeline or budget, this assessment surfaces every hidden risk, dependency, and remediation item — so you go in with eyes open and a plan that actually works.",
    deliverables: [
      "Migration risk report with severity classifications",
      "Remediation roadmap with sequenced action items",
      "Go/no-go recommendation with clear rationale",
      "Phased migration plan with timeline estimates",
      "Executive summary for IT leadership & stakeholders",
    ],
    whoFor: [
      "Organizations planning an M365, Exchange Online, or SharePoint migration",
      "Companies undergoing a merger, acquisition, or divestiture with cross-tenant requirements",
      "IT teams that have started scoping a migration and need a sanity check",
      "Leadership teams that need a credible go/no-go before board-level commitment",
    ],
    steps: [
      {
        title: "Scoping Call",
        desc: "A focused intake session to define migration scope, source/target environments, and known constraints.",
      },
      {
        title: "Environment Assessment",
        desc: "Shane analyzes your current environment — mailbox count, SharePoint structure, identity configuration, licensing gaps, and third-party dependencies.",
      },
      {
        title: "Risk Report",
        desc: "A written risk report cataloguing every migration blocker and risk item, with severity ratings and remediation effort estimates.",
      },
      {
        title: "Readiness Briefing",
        desc: "A live briefing session presenting the go/no-go recommendation, phased migration plan, and your prioritized pre-migration checklist.",
      },
    ],
    turnaround: "1 week",
    ctaLabel: "Get Your Assessment",
    metaDescription:
      "Expert-led Microsoft 365 migration readiness assessment from Shane McCaw. Risk report, go/no-go recommendation, and phased migration plan. Fixed price, 1-week turnaround.",
  },

  "power-platform-quick-start": {
    dbSlug: "power-platform-quickstart",
    name: "Power Platform Quick‑Start",
    tagline: "Turn your unused Power Platform license into a working business tool in 30 days.",
    tier: "Core",
    tierColor: "bg-[#00B4D8]/15 text-[#00B4D8] border-[#00B4D8]/30",
    description:
      "A focused 30-day sprint to design, build, and deploy one production-ready Power App or Power Automate flow. You define the business problem; Shane designs and builds the solution — including documentation, testing, and a 90-minute knowledge transfer so your team can maintain and extend it.",
    deliverables: [
      "One fully-built, production-ready Power App or Power Automate flow",
      "Technical documentation covering design decisions and data connections",
      "Testing & deployment to your production environment",
      "90-minute knowledge transfer session for your team",
      "30 days of post-deployment support via email",
    ],
    whoFor: [
      "Teams holding Power Platform licenses they've never activated",
      "Business units with manual, repetitive workflows ready for automation",
      "Organizations that want a low-risk first Power Platform project",
      "IT leaders who want to demonstrate ROI on M365 licensing investment",
    ],
    steps: [
      {
        title: "Discovery & Design",
        desc: "A focused session to define the business problem, map the current workflow, and agree on the solution design and success criteria.",
      },
      {
        title: "Build Sprint",
        desc: "Shane builds the Power App or Power Automate flow against the agreed spec — with check-ins to review progress and incorporate feedback.",
      },
      {
        title: "Testing & Refinement",
        desc: "End-to-end testing in a staging environment, bug fixes, and final polish before production deployment.",
      },
      {
        title: "Deploy & Knowledge Transfer",
        desc: "Production deployment followed by a 90-minute walkthrough so your team understands how to use, maintain, and extend the solution.",
      },
    ],
    turnaround: "4 weeks",
    ctaLabel: "Start Your Quick-Start",
    metaDescription:
      "Get a production-ready Power App or Power Automate flow in 30 days from Shane McCaw. Includes build, documentation, deployment, and team training. Fixed price.",
  },

  "copilot-readiness-assessment": {
    dbSlug: "copilot-for-m365-readiness-assessment",
    name: "Copilot for M365 Readiness Assessment",
    tagline: "Don't light up Copilot on a dirty tenant.",
    tier: "Core",
    tierColor: "bg-[#00B4D8]/15 text-[#00B4D8] border-[#00B4D8]/30",
    description:
      "A complete readiness evaluation to ensure your Microsoft 365 environment is secure, governed, and prepared for Copilot deployment. Copilot surfaces data from across your tenant — if your permissions are misconfigured or your governance is weak, it surfaces the wrong data to the wrong people. This assessment eliminates that risk before go-live.",
    deliverables: [
      "Copilot readiness report with pass/fail criteria",
      "Prioritized pre-deployment remediation plan",
      "Quick-win recommendations implementable before go-live",
      "Pilot group design with success metrics and adoption KPIs",
      "Data governance and permissions review summary",
      "Licensing readiness and rollout roadmap",
    ],
    whoFor: [
      "Organizations that have purchased Copilot for M365 licenses and want to deploy responsibly",
      "IT leaders who need to validate their tenant before a Copilot pilot",
      "Companies with oversharing or permissions debt that may surface through Copilot",
      "Security and compliance teams with oversight responsibility over AI tool deployments",
    ],
    steps: [
      {
        title: "Tenant Baseline Review",
        desc: "Shane reviews your current M365 governance posture — sharing settings, permissions, sensitivity labels, DLP policies, and data classification.",
      },
      {
        title: "Copilot Readiness Evaluation",
        desc: "A detailed assessment against Microsoft's Copilot deployment requirements: identity, licensing, data governance, and security baselines.",
      },
      {
        title: "Readiness Report",
        desc: "A written report documenting every gap and risk, with a prioritized remediation checklist and quick-win actions your team can complete before go-live.",
      },
      {
        title: "Pilot Design & Debrief",
        desc: "A live session to review findings, finalize the pilot group design, define success metrics, and agree on the deployment timeline.",
      },
    ],
    turnaround: "2 weeks",
    ctaLabel: "Get Copilot-Ready",
    metaDescription:
      "Copilot for M365 readiness assessment from Shane McCaw. Ensure your tenant is secure and governed before deploying Copilot. Readiness report, remediation plan, and pilot design. Fixed price.",
  },

  "governance-foundations": {
    dbSlug: "governance-foundations-package",
    name: "Governance Foundations Package",
    tagline: "Stop managing M365 by accident.",
    tier: "Strategic",
    tierColor: "bg-amber-100 text-amber-700 border-amber-200",
    description:
      "A complete Microsoft 365 governance framework built to enterprise and regulated-industry standards. This package delivers the policies, templates, and training your organization needs to move from ad-hoc M365 management to a structured, audit-ready governance model — without needing to become a governance expert yourself.",
    deliverables: [
      "Governance maturity assessment and current-state baseline",
      "Full M365 governance framework document",
      "Policy template suite (Teams, SharePoint, OneDrive, external sharing, guest access)",
      "Data classification and sensitivity label design",
      "90-minute governance training session for your IT team",
      "Implementation roadmap with prioritized rollout phases",
    ],
    whoFor: [
      "Organizations preparing for a compliance audit (SOC 2, HIPAA, CMMC, FedRAMP)",
      "IT teams dealing with Teams/SharePoint sprawl, ungoverned guest access, or data exposure risks",
      "Companies scaling rapidly where M365 governance has not kept pace with growth",
      "Legal, HR, or security leaders who need documented policies for M365 workloads",
    ],
    steps: [
      {
        title: "Maturity Assessment",
        desc: "Shane evaluates your current governance posture across Teams, SharePoint, OneDrive, guest access, data classification, and lifecycle management.",
      },
      {
        title: "Framework Design",
        desc: "Shane designs a governance framework sized to your organization — balancing control with usability, and compliance requirements with productivity.",
      },
      {
        title: "Policy & Template Build",
        desc: "Production-ready policy documents and configuration templates your IT team can implement directly, without interpretation.",
      },
      {
        title: "Training & Handoff",
        desc: "A 90-minute live training session to walk your team through the framework, answer questions, and confirm implementation ownership.",
      },
    ],
    turnaround: "6 weeks",
    ctaLabel: "Build Your Governance Framework",
    metaDescription:
      "Enterprise Microsoft 365 governance framework from Shane McCaw. Policy templates, data classification design, IT training, and audit-ready documentation. Fixed price.",
  },

  "m365-training-enablement": {
    dbSlug: "microsoft-365-training--enablement",
    name: "Microsoft 365 Training & Enablement",
    tagline: "Empower your team with real-world Microsoft 365 skills — taught by NASA's Lead Architect.",
    tier: "Entry",
    tierColor: "bg-[#0078D4]/15 text-[#0078D4] border-[#0078D4]/30",
    description:
      "Live, instructor-led Microsoft 365 training tailored to your organization's needs. Delivered virtually or on-site by Shane — the same architect who designed and maintained M365 at NASA. Covers Outlook, Exchange, Teams, SharePoint, OneDrive, Copilot for M365, and Power Platform fundamentals. Designed to increase adoption, reduce support tickets, and immediately improve productivity.",
    deliverables: [
      "Customized training agenda based on your M365 deployment",
      "Live virtual or on-site training sessions (half-day or full-day)",
      "Hands-on demonstrations using your real environment",
      "Q&A and live troubleshooting with your team",
      "Session recording (virtual delivery)",
      "Post-training resource pack with quick-reference guides",
    ],
    whoFor: [
      "Organizations rolling out a new M365 feature or preparing to deploy Copilot",
      "IT teams with high support ticket volume related to M365 productivity tools",
      "HR, operations, or leadership teams transitioning to Microsoft Teams and SharePoint",
      "Companies onboarding large cohorts and needing scalable M365 enablement",
    ],
    steps: [
      {
        title: "Needs Assessment",
        desc: "A scoping call to understand your deployment, the tools your team struggles with most, and the training outcomes you need to achieve.",
      },
      {
        title: "Curriculum Design",
        desc: "Shane customizes the training agenda to your M365 configuration and team — no generic slides, no irrelevant modules.",
      },
      {
        title: "Live Delivery",
        desc: "Instructor-led sessions delivered virtually or on-site — with real examples from your environment, hands-on exercises, and open Q&A.",
      },
      {
        title: "Resource Handoff",
        desc: "Post-training resource pack with quick-reference guides, recordings (if virtual), and a follow-up window for questions.",
      },
    ],
    turnaround: "1–5 days",
    ctaLabel: "Book Your Training",
    metaDescription:
      "Live Microsoft 365 training from Shane McCaw — NASA's Lead M365 Architect. Customized curriculum, hands-on delivery, and post-training resources. Virtual or on-site.",
  },
};

interface MicroOfferDetailProps {
  params: { slug: string };
}

export default function MicroOfferDetail({ params }: MicroOfferDetailProps) {
  const slug = params?.slug ?? "";
  const content = OFFER_CONTENT[slug];
  const { services } = useServices("micro_offer");

  if (!content) {
    return <NotFound />;
  }

  const liveService = services.find((s) => s.slug === content.dbSlug);
  const priceDisplay = liveService
    ? formatPriceDisplay(liveService)
    : null;

  const onboardingHref = `/crm/portal/onboarding/select?service=${content.dbSlug}`;

  return (
    <Layout>
      <SEOMeta
        title={`${content.name} | Shane McCaw Consulting`}
        description={content.metaDescription}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Offer",
          "name": content.name,
          "description": content.description,
          ...(liveService?.basePrice && liveService?.maxPrice
            ? { "priceRange": priceDisplay ?? undefined }
            : liveService?.basePrice
            ? { "price": liveService.basePrice, "priceCurrency": "USD" }
            : {}),
          "url": `https://shanemccawconsulting.com/micro-offers/${slug}`,
          "seller": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
          },
          "itemOffered": {
            "@type": "Service",
            "name": content.name,
            "description": content.description,
          },
        }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)",
          }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <span
              className={`inline-block text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full border ${content.tierColor}`}
            >
              {content.tier}
            </span>
            <span className="text-white/40 text-xs uppercase tracking-widest font-semibold">
              Fixed-Price Micro-Offer
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            {content.name}
          </h1>
          <p className="text-white/70 text-xl mt-5 max-w-2xl leading-relaxed">
            {content.tagline}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-6">
            {priceDisplay && (
              <div>
                <p className="text-white/40 text-xs uppercase tracking-widest font-semibold mb-1">
                  Investment
                </p>
                <p className="text-white text-2xl font-extrabold">{priceDisplay}</p>
              </div>
            )}
            {content.turnaround && (
              <div className="flex items-center gap-2 text-white/60">
                <Clock className="w-4 h-4 text-[#00B4D8]" />
                <span className="text-sm font-medium">{content.turnaround} delivery</span>
              </div>
            )}
          </div>

          <div className="mt-10 flex flex-wrap gap-4">
            <CTAButton href={onboardingHref}>{content.ctaLabel}</CTAButton>
            <a
              href="/book"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40"
            >
              Book a Discovery Call <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── WHAT'S INCLUDED ──────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">
                Deliverables
              </p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
                What's Included
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                {content.description}
              </p>
              <ul className="space-y-3.5">
                {content.deliverables.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span className="text-[#0A2540] text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Who This Is For */}
            <div className="bg-[#F7F9FC] rounded-2xl p-8">
              <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest mb-4">
                Ideal For
              </p>
              <h3 className="text-xl font-extrabold text-[#0A2540] mb-6">
                Who This Is For
              </h3>
              <ul className="space-y-4">
                {content.whoFor.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i === 0 ? (
                        <Building2 className="w-4 h-4 text-[#0078D4]" />
                      ) : i === 1 ? (
                        <Users className="w-4 h-4 text-[#0078D4]" />
                      ) : i === 2 ? (
                        <Shield className="w-4 h-4 text-[#0078D4]" />
                      ) : (
                        <Zap className="w-4 h-4 text-[#0078D4]" />
                      )}
                    </div>
                    <span className="text-[#0A2540] text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">
              Process
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              How It Works
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {content.steps.map((step, i) => (
              <div
                key={i}
                className="bg-white rounded-2xl p-6 border border-border relative"
              >
                <div className="w-10 h-10 rounded-xl bg-[#0A2540] text-white flex items-center justify-center text-sm font-extrabold mb-4">
                  {i + 1}
                </div>
                <h3 className="font-bold text-[#0A2540] mb-2 text-base">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{step.desc}</p>
                {i < content.steps.length - 1 && (
                  <div className="hidden lg:block absolute top-10 -right-3 z-10">
                    <ArrowRight className="w-5 h-5 text-[#0078D4]/40" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING CALLOUT ──────────────────────────────────────────────── */}
      {priceDisplay && (
        <section className="bg-white py-20 border-t border-border">
          <div className="max-w-[760px] mx-auto px-6 text-center">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">
              Investment
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-3">
              {priceDisplay}
            </h2>
            {content.turnaround && (
              <p className="text-muted-foreground text-base mb-2">
                Delivered in {content.turnaround}. Fixed price — no hourly surprises.
              </p>
            )}
            <p className="text-muted-foreground text-sm">
              Final price depends on tenant size and complexity. Exact scope confirmed before any payment.
            </p>
          </div>
        </section>
      )}

      {/* ── CTA STRIP ────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">
            Ready to get started?
          </h2>
          <p className="text-white/70 max-w-xl mx-auto mb-8 leading-relaxed">
            Start the engagement online — or book a free 30-minute call to confirm this is the right fit before committing.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton href={onboardingHref} className="px-10 py-4 text-base">
              {content.ctaLabel}
            </CTAButton>
            <a
              href="/book"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-8 py-4 rounded-xl hover:border-white/40"
            >
              Book a Free Discovery Call <ArrowRight className="w-4 h-4" />
            </a>
          </div>
          <p className="mt-8 text-white/40 text-sm">
            Or{" "}
            <Link href="/micro-offers" className="text-white/60 hover:text-white underline underline-offset-2">
              view all micro-offer packages →
            </Link>
          </p>
        </div>
      </section>
    </Layout>
  );
}
