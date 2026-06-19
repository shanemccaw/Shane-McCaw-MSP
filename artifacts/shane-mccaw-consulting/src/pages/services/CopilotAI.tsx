import { SEOMeta } from "@/components/SEOMeta";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import {
  Bot, Shield, Tag, Rocket, Users, TrendingUp,
  CheckCircle, ArrowRight, AlertTriangle, Star
} from "lucide-react";

const pillars = [
  {
    icon: Bot,
    number: "01",
    title: "Copilot Readiness Assessment",
    tagline: "Know your score before you spend another dollar.",
    description:
      "Shane conducts a structured, NASA-methodology audit across your entire Microsoft 365 environment — evaluating tenant configuration, licensing eligibility, identity posture, SharePoint oversharing exposure, and Teams data sprawl. The output is a readiness scorecard with a prioritized remediation list. Not a vendor checklist. A real architect's assessment of whether your environment is safe to enable Copilot in — and what it will take to get there.",
    deliverables: [
      "Copilot readiness scorecard across 6 dimensions",
      "Oversharing and permissions risk inventory",
      "Licensing eligibility and optimization review",
      "Identity and conditional access posture check",
      "Prioritized remediation roadmap with effort estimates",
    ],
  },
  {
    icon: Shield,
    number: "02",
    title: "Data Governance Alignment",
    tagline: "Copilot surfaces everything your permissions allow. Get your governance right first.",
    description:
      "Microsoft Copilot respects your existing permissions model — which means if your data governance is weak, Copilot will expose it. Shane aligns your governance framework to Copilot's access model: scoping what Copilot can see, enforcing least-privilege access across SharePoint and OneDrive, and ensuring your DLP policies are configured to catch sensitive data before it surfaces in AI-generated outputs.",
    deliverables: [
      "DLP policy review and gap remediation",
      "SharePoint permissions cleanup and scoping",
      "OneDrive oversharing assessment",
      "Copilot-specific governance policy documentation",
      "Admin controls and eDiscovery configuration",
    ],
  },
  {
    icon: Tag,
    number: "03",
    title: "Sensitivity Labeling Maturity",
    tagline: "Labels are the foundation. Without them, Copilot governance is guesswork.",
    description:
      "Sensitivity labels are the cornerstone of a secure Copilot deployment — they tell the platform what data is confidential, who can access it, and how it can be shared. Shane assesses your current labeling maturity against the framework NASA uses internally, designs a labeling taxonomy that fits your organization's data classification needs, and deploys auto-labeling policies that protect content without creating friction for end users.",
    deliverables: [
      "Current labeling maturity assessment",
      "Sensitivity label taxonomy design",
      "Auto-labeling policy configuration",
      "Label inheritance and encryption rules",
      "User training on labeling workflow",
    ],
  },
  {
    icon: Rocket,
    number: "04",
    title: "Secure Rollout Planning",
    tagline: "Phased. Controlled. No surprises.",
    description:
      "Deploying Copilot to your entire organization on day one is the fastest way to create a governance incident and destroy end-user trust. Shane designs a phased deployment architecture that sequences rollout in controllable waves, with monitoring checkpoints between each phase. Every phase has defined entry criteria, rollback procedures, and compliance validation steps — the same rigorous deployment discipline applied to NASA's Copilot implementation.",
    deliverables: [
      "Phased deployment architecture document",
      "Go/no-go criteria for each rollout phase",
      "Rollback and incident response procedures",
      "Copilot admin controls and policy configuration",
      "Monitoring and compliance telemetry setup",
    ],
  },
  {
    icon: Users,
    number: "05",
    title: "Pilot Group Strategy",
    tagline: "The right 50 users will tell you everything. The wrong 5,000 will create chaos.",
    description:
      "A successful enterprise Copilot deployment starts with a well-designed pilot. Shane identifies the right pilot cohort — power users with high data literacy, varied role representation, and willingness to provide structured feedback — and builds the pilot program around measurable outcomes. You get real productivity data, real governance feedback, and real adoption patterns before you scale. No guesswork on whether the broader rollout will work.",
    deliverables: [
      "Pilot group selection criteria and cohort design",
      "Pilot program structure and timeline",
      "Feedback collection and analysis framework",
      "Success metrics and KPI definition",
      "Pilot-to-production transition criteria",
    ],
  },
  {
    icon: TrendingUp,
    number: "06",
    title: "Enterprise Adoption Guidance",
    tagline: "Deployed doesn't mean adopted. Adoption is where the ROI actually lives.",
    description:
      "Most Copilot deployments stall not because the technology fails, but because users don't know how to use it effectively. Shane builds an adoption program tailored to your organization's roles and workflows — including a custom prompt library for key departments, role-specific use case guides, manager enablement content, and a 90-day adoption measurement framework. The goal is organizational behavior change, not license utilization statistics.",
    deliverables: [
      "Custom Copilot prompt library (role-specific, 25+ prompts)",
      "Department use case guides",
      "Manager and champion enablement materials",
      "90-day adoption measurement framework",
      "Ongoing coaching and optimization support",
    ],
  },
];

const riskSignals = [
  "You've purchased Copilot licenses but haven't enabled them — or enabled them and seen near-zero adoption",
  "Your SharePoint environment has broad sharing permissions or anonymous links",
  "You don't have sensitivity labels deployed, or they're inconsistently applied",
  "You're in a regulated industry (healthcare, finance, government contracting) with compliance obligations",
  "Legal or compliance teams have raised concerns about AI data access",
  "Previous Copilot rollout attempts stalled due to governance uncertainty",
];

export default function CopilotAI() {
  const price = "$2,000";
  const loading = false;
  return (
    <Layout>
      <SEOMeta
        title="Microsoft Copilot Consulting — NASA's Copilot SME | Shane McCaw Consulting"
        description="Deploy Microsoft Copilot safely with Shane McCaw — NASA's Copilot SME. Readiness assessments, data governance checks, and AI deployment roadmaps that eliminate oversharing risk."
        ogImage="/og-image-copilot-ai.png"
        ogUrl="https://shanemccawconsulting.com/services/copilot-ai"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Microsoft Copilot AI Consulting",
          "description": "Deploy Microsoft Copilot safely with Shane McCaw — NASA's Copilot SME. Readiness assessments, data governance checks, and AI deployment roadmaps that eliminate oversharing risk.",
          "url": "https://shanemccawconsulting.com/services/copilot-ai",
          "serviceType": "Microsoft Copilot AI Consulting",
          "areaServed": {
            "@type": "Country",
            "name": "United States"
          },
          "audience": {
            "@type": "Audience",
            "audienceType": "Enterprise IT leaders, compliance officers, and federal agencies deploying Microsoft Copilot"
          },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com"
          },
          "offers": [
            {
              "@type": "Offer",
              "name": "Copilot Readiness Assessment",
              "price": "797",
              "priceCurrency": "USD",
              "url": "https://shanemccawconsulting.com/micro-offers"
            }
          ]
        }}
      />
      {/* Hero */}
      <section className="relative bg-[#0A2540] pt-32 pb-24 overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(#0078D4 1px, transparent 1px),
              linear-gradient(90deg, #0078D4 1px, transparent 1px)
            `,
            backgroundSize: "60px 60px",
          }}
        />
        <div
          className="absolute inset-0 opacity-15"
          style={{ background: "radial-gradient(ellipse 80% 60% at 60% 30%, #0078D4, transparent)" }}
        />
        <div className="relative z-10 max-w-[1200px] mx-auto px-6">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/15 border border-[#0078D4]/40 rounded-full px-5 py-2 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#00B4D8] animate-pulse" />
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em]">
              Microsoft Copilot SME — NASA
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-end">
            <div>
              <h1 className="text-4xl md:text-5xl lg:text-[3.5rem] font-extrabold text-white leading-[1.1] mb-6">
                Microsoft Copilot Consulting — Governed, Secure, and Built to Last.
              </h1>
              <p className="text-lg text-white/75 leading-relaxed mb-8">
                Shane McCaw is the serving Copilot for Microsoft 365 Subject Matter Expert at NASA — one of the most security-sensitive and compliance-constrained M365 environments in existence. He brings that same methodology to your organization's Copilot deployment.
              </p>
              <CTAButton href="/book" className="text-base px-8 py-4" data-testid="copilot-hero-cta">
                Book a Copilot Assessment
              </CTAButton>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "NASA Copilot SME", sub: "Serving role, not a credential" },
                { label: "30+ Years", sub: "Microsoft ecosystem expertise" },
                { label: "6 Pillars", sub: "Structured deployment framework" },
                { label: "Zero data loss", sub: "Governance-first methodology" },
              ].map((stat, i) => (
                <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-5" data-testid={`hero-stat-${i}`}>
                  <p className="text-white font-bold text-lg leading-tight mb-1">{stat.label}</p>
                  <p className="text-white/50 text-xs">{stat.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Authority statement */}
      <section className="bg-[#F7F9FC] border-b border-border py-12">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="flex-shrink-0 w-14 h-14 rounded-full bg-[#0078D4] flex items-center justify-center">
              <Star className="w-7 h-7 text-white" />
            </div>
            <div>
              <p className="font-bold text-[#0A2540] text-lg mb-1">
                Shane McCaw is not a Copilot trainer or a reseller. He is NASA's Copilot Subject Matter Expert.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                That means he works daily inside the governance, compliance, and deployment challenges that enterprise Copilot creates at the highest security tier — and translates that institutional knowledge into your organization's rollout. No theory. No vendor slides. Real implementation expertise from the most demanding M365 environment in the federal government.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Risk signals */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Warning Signs</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-4">
                You Need This Engagement If…
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Copilot is not plug-and-play. The organizations that struggle with it share common warning signs — most of which are invisible until something goes wrong.
              </p>
              <ul className="space-y-3">
                {riskSignals.map((signal, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`risk-signal-${i}`}>
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-1" />
                    <span className="text-foreground text-sm leading-relaxed">{signal}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#0A2540] rounded-2xl p-8 text-white">
              <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Stakes</p>
              <h3 className="text-2xl font-extrabold mb-4 leading-tight">
                Why Copilot Governance Failures Are Different From Other IT Problems
              </h3>
              <p className="text-white/70 leading-relaxed mb-6">
                When a SharePoint migration fails, you restore from backup. When Copilot surfaces a confidential HR document to a line manager who technically had read access to the folder it lived in — that's a different class of incident. It damages trust, creates legal exposure, and can permanently undermine AI adoption across your organization.
              </p>
              <p className="text-white/70 leading-relaxed">
                Shane designs Copilot deployments the way NASA designs mission systems: with failure modes analyzed in advance and mitigations built in from the start — not patched in after the incident.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Six pillars */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">The Framework</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              Six-Pillar Copilot Deployment Framework
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Every Shane McCaw Consulting Copilot engagement covers all six pillars. They're not optional modules — they're interdependent. Skipping one undermines the others.
            </p>
          </div>

          <div className="space-y-6">
            {pillars.map((pillar, i) => {
              const Icon = pillar.icon;
              return (
                <div
                  key={i}
                  className="bg-white rounded-2xl border border-border overflow-hidden hover:border-[#0078D4]/30 hover:shadow-lg transition-all duration-300"
                  data-testid={`pillar-${i}`}
                >
                  <div className="p-8 grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-8">
                    {/* Left */}
                    <div>
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-11 h-11 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-5 h-5 text-[#0078D4]" />
                        </div>
                        <span className="text-[#0078D4]/40 font-extrabold text-3xl leading-none">{pillar.number}</span>
                      </div>
                      <h3 className="text-xl font-extrabold text-[#0A2540] mb-2">{pillar.title}</h3>
                      <p className="text-[#0078D4] text-sm font-semibold italic mb-4">{pillar.tagline}</p>
                      <p className="text-muted-foreground text-sm leading-relaxed">{pillar.description}</p>
                    </div>
                    {/* Right — deliverables */}
                    <div className="bg-[#F7F9FC] rounded-xl p-6 border border-border">
                      <p className="text-xs font-bold text-[#0A2540] uppercase tracking-wider mb-4">Deliverables</p>
                      <ul className="space-y-3">
                        {pillar.deliverables.map((d, j) => (
                          <li key={j} className="flex items-start gap-2.5" data-testid={`pillar-${i}-deliverable-${j}`}>
                            <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                            <span className="text-foreground text-sm">{d}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Engagement options */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">How to Engage</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">Start Where Your Organization Is</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                label: "Not deployed yet",
                title: "Copilot Readiness Assessment",
                price: "$797",
                desc: "The right first step for any organization evaluating or planning a Copilot deployment. Full six-dimension readiness audit + deployment roadmap delivered in 5 business days.",
                cta: "Start with the Assessment",
              },
              {
                label: "Deployed but struggling",
                title: "Governance & Adoption Remediation",
                price: "Project-based",
                desc: "For organizations that deployed Copilot but are seeing low adoption, governance concerns, or end-user complaints. Shane diagnoses the root cause and rebuilds the deployment correctly.",
                cta: "Book a Diagnosis Call",
              },
              {
                label: "Planning at scale",
                title: "Full Six-Pillar Engagement",
                price: "Scoped on discovery",
                desc: "The complete Copilot deployment program for organizations that need all six pillars executed from scratch — governance, labeling, rollout architecture, pilot, and adoption.",
                cta: "Book a Discovery Call",
              },
            ].map((option, i) => (
              <div
                key={i}
                className={`rounded-xl border p-7 flex flex-col ${i === 0 ? "bg-[#0A2540] border-[#0078D4]" : "bg-[#F7F9FC] border-border"}`}
                data-testid={`engagement-option-${i}`}
              >
                <span className={`text-xs font-bold uppercase tracking-wider mb-3 ${i === 0 ? "text-[#00B4D8]" : "text-[#0078D4]"}`}>
                  {option.label}
                </span>
                <h3 className={`text-lg font-extrabold mb-2 ${i === 0 ? "text-white" : "text-[#0A2540]"}`}>{option.title}</h3>
                <p className={`text-2xl font-extrabold mb-3 text-[#0078D4]`}>{option.price}</p>
                <p className={`text-sm leading-relaxed flex-grow mb-6 ${i === 0 ? "text-white/70" : "text-muted-foreground"}`}>{option.desc}</p>
                <CTAButton href="/book" className="w-full justify-center text-sm" data-testid={`engagement-cta-${i}`}>
                  {option.cta}
                </CTAButton>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Get Started CTA */}
      <section className="bg-white py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-[#0A2540] rounded-3xl p-10 md:p-14 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="flex-1">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-wide mb-3">Monthly Retainer</p>
              <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-3">Ready to get started?</h2>
              <p className="text-white/70 text-base max-w-md">
                Ongoing Copilot AI governance, deployment, and adoption support — from readiness through rollout and training. Cancel any time.
              </p>
            </div>
            <div className="flex flex-col items-start md:items-end gap-4">
              <div>
                <span className="text-3xl font-extrabold text-white">
                  {loading ? (
                    <span className="inline-block h-9 w-24 rounded bg-white/20 animate-pulse align-middle" aria-hidden="true" />
                  ) : (
                    price
                  )}
                </span>
                <span className="text-lg font-normal text-white/60">/mo</span>
              </div>
              <a
                href="/crm/portal/onboarding/select?service=copilot-ai-consulting"
                className="inline-flex items-center gap-2 bg-[#0078D4] text-white font-semibold px-6 py-3 rounded-xl hover:bg-[#0066B8] transition-colors"
              >
                Get Started <ArrowRight className="w-4 h-4" />
              </a>
              <p className="text-white/50 text-xs">No long-term commitment required.</p>
            </div>
          </div>
        </div>
      </section>

      <ConsultationCTA />
    </Layout>
  );
}
