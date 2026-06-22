import { useState } from "react";
import { ServiceOverviewModal } from "@/components/ServiceOverviewModal";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { RetainerCard } from "@/components/RetainerCard";
import { useServices, useServiceHasPdf } from "@/hooks/useServices";
import { Link } from "wouter";
import {
  CheckCircle, ArrowRight, Clock, DollarSign,
  Mail, MessageSquare, FolderOpen, Bot, Zap, Server
} from "lucide-react";
import FixedPriceOfferCard from "@/components/FixedPriceOfferCard";

const MODULES = [
  {
    icon: <Mail className="w-5 h-5" />,
    title: "Outlook",
    desc: "Email organization, calendar management, delegation, rules, shared mailboxes, and mobile configuration for everyday productivity.",
  },
  {
    icon: <MessageSquare className="w-5 h-5" />,
    title: "Microsoft Teams",
    desc: "Channels, meetings, chat best practices, app integrations, and governance etiquette for effective team collaboration.",
  },
  {
    icon: <FolderOpen className="w-5 h-5" />,
    title: "SharePoint & OneDrive",
    desc: "Document storage, co-authoring, version control, sharing permissions, and intranet navigation built for your site structure.",
  },
  {
    icon: <Server className="w-5 h-5" />,
    title: "Exchange",
    desc: "Exchange Online administration, mailbox management, distribution lists, mail flow rules, and hybrid configuration fundamentals.",
  },
  {
    icon: <Bot className="w-5 h-5" />,
    title: "Copilot for Microsoft 365",
    desc: "Practical Copilot use across Teams, Outlook, Word, Excel, and PowerPoint — what it can do, how to prompt it effectively, and what to watch for.",
  },
  {
    icon: <Zap className="w-5 h-5" />,
    title: "Power Platform Basics",
    desc: "Introduction to Power Automate and Power Apps — how to automate routine tasks and build simple business tools without writing code.",
  },
];

const INCLUSIONS = [
  "Live, instructor-led training sessions (remote or on-site)",
  "Custom agenda tailored to your organization's M365 configuration",
  "Session recordings for team members who can't attend live",
  "Resource packs: quick-reference cards, tip sheets, and links",
  "Q&A time built into every session",
  "Post-training support window (email questions welcome)",
];

const WHO_FOR = [
  "Organizations onboarding employees to Microsoft 365 for the first time",
  "Teams migrating from Google Workspace, Slack, or legacy on-premises tools",
  "Companies rolling out Copilot and needing structured change management",
  "IT departments that want role-specific training rather than generic vendor content",
  "Organizations whose licenses are underused because staff never got proper onboarding",
  "Regulated industries where correct tool use is part of compliance",
];

const WHY_WORKS = [
  {
    title: "Taught by a Practitioner, Not a Trainer",
    desc: "Shane is a Lead Microsoft 365 Architect who has used every tool in real enterprise and federal environments. Training comes with architectural context — not just click-through demos.",
  },
  {
    title: "NASA-Proven Curriculum",
    desc: "Shane developed and delivered M365 training at NASA, where adoption was mission-critical and incorrect tool use had real consequences. That rigor carries into every session.",
  },
  {
    title: "Tailored to Your Configuration",
    desc: "Training is built around your tenant, your SharePoint sites, your Teams structure, and your governance policies — not a generic sample environment.",
  },
  {
    title: "Recordings + Resources Included",
    desc: "Every session is recorded and accompanied by reference materials. Employees who miss live sessions don't miss the training.",
  },
  {
    title: "Flexible Format",
    desc: "Half-day, full-day, or multi-day formats. Role-specific tracks for end users, IT staff, or executives. Remote or on-site delivery.",
  },
];

const ADD_ONS = [
  {
    name: "M365 Tenant Health Audit",
    desc: "Before training, know what your tenant actually looks like. A Tenant Health Audit surfaces configuration gaps and oversharing risks that training alone cannot fix.",
    href: "/services/microsoft-365",
    price: "$4,500–$7,500",
    duration: "2 weeks",
  },
  {
    name: "Governance Foundations Package",
    desc: "For organizations whose governance isn't in place yet — naming conventions, lifecycle policies, DLP, and Teams/SharePoint governance built before training begins.",
    href: "/services/governance",
    price: "$12,000–$18,000",
    duration: "6 weeks",
  },
];


export default function M365Training() {
  const { services: retainerServices, loading: retainerLoading } = useServices("retainer");
  const [modalOpen, setModalOpen] = useState(false);
  const hasPdf = useServiceHasPdf("M365 Training & Enablement");

  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Training & Enablement | Shane McCaw Consulting"
        description="Live, instructor-led Microsoft 365 training for organizations. Covers Outlook, Teams, SharePoint, OneDrive, Copilot, and Power Platform — built on NASA methodology by Lead M365 Architect Shane McCaw."
        ogUrl="https://shanemccawconsulting.com/services/m365-training"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Microsoft 365 Training & Enablement",
          "description": "Live, instructor-led Microsoft 365 training tailored to your organization's configuration — from Outlook and Teams to Copilot and Power Platform.",
          "url": "https://shanemccawconsulting.com/services/m365-training",
          "serviceType": "Microsoft 365 Training",
          "areaServed": { "@type": "Country", "name": "United States" },
          "audience": {
            "@type": "Audience",
            "audienceType": "Organizations onboarding or retraining employees on Microsoft 365",
          },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com",
          },
          "offers": [
            {
              "@type": "Offer",
              "name": "Microsoft 365 Training & Enablement",
              "priceRange": "$3,000–$7,500",
              "priceCurrency": "USD",
              "url": "https://shanemccawconsulting.com/services/m365-training",
            },
          ],
        }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Training & Enablement</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft 365 Training & Enablement — Empower Your Entire Organization
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            Live, instructor-led training built on NASA methodology — tailored to your tools, your configuration, and your team.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 items-center">
            <CTAButton href="/book">Book a Free Discovery Call</CTAButton>
            <a
              href="/crm/portal/onboarding/select?service=microsoft-365-training--enablement"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </a>
            {hasPdf && (
              <button
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors text-sm"
              >
                Download Overview <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── INTRO ────────────────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">The Problem</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
                Most Organizations Are Paying for Tools Their Teams Don't Know How to Use
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Microsoft 365 is one of the most powerful productivity platforms ever built — and one of the most underused. Most organizations get through deployment, hand employees a login, and assume adoption follows. It doesn't.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Teams fall back to email chains instead of using Teams channels. Files are saved to desktops instead of SharePoint. Copilot licenses sit unused because nobody knows where to start.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Shane McCaw developed and delivered Microsoft 365 training at NASA — where correct tool use wasn't optional, it was a compliance and mission requirement. That curriculum translates directly to your organization, tailored to your configuration and your team's actual workflows.
              </p>
            </div>
            <div className="bg-[#F7F9FC] border border-border rounded-2xl p-8 space-y-5">
              <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest">Common Adoption Gaps</p>
              <div className="space-y-4">
                {[
                  { issue: "Teams underused", detail: "Employees still scheduling meetings via email and sharing files as attachments." },
                  { issue: "SharePoint ignored", detail: "Files live on local drives or in email — version control and collaboration are broken." },
                  { issue: "Copilot licenses wasted", detail: "Licenses purchased, nobody trained, ROI is zero and renewals are being questioned." },
                ].map((item) => (
                  <div key={item.issue} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-[#0078D4] flex-shrink-0 mt-2" />
                    <div>
                      <p className="font-bold text-[#0A2540] text-sm">{item.issue}</p>
                      <p className="text-muted-foreground text-sm leading-relaxed">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── OFFER ────────────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Fixed-Price Engagement</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Microsoft 365 Training &amp; Enablement</h2>
          </div>
          <FixedPriceOfferCard slug="microsoft-365-training--enablement" ctaLabel="Get Started" />
        </div>
      </section>

      {/* ── TRAINING MODULES ─────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Curriculum</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Training Modules</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
              Modules are mixed and matched to your organization's needs. Not every engagement covers all six — scope is agreed upfront.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {MODULES.map((mod) => (
              <div
                key={mod.title}
                className="flex gap-4 p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center text-[#0078D4] flex-shrink-0">
                  {mod.icon}
                </div>
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-1.5 text-sm">{mod.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{mod.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHO THIS IS FOR ──────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Ideal Clients</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Who This Is For</h2>
          </div>
          <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
            {WHO_FOR.map((item) => (
              <div key={item} className="flex items-start gap-3 bg-white border border-border rounded-xl p-4">
                <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className="text-[#0A2540] text-sm leading-snug">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY THIS TRAINING WORKS ──────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Differentiators</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Why This Training Works</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_WORKS.map((item) => (
              <div key={item.title} className="flex gap-4 p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all">
                <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── OPTIONAL ADD-ONS ─────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Optional Add-Ons</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Before or After Training</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
              Training is more effective when the environment is ready and the governance is in place. These engagements pair well.
            </p>
          </div>

          <div className="max-w-4xl mx-auto space-y-4 mb-12">
            {ADD_ONS.map((item) => (
              <div key={item.name} className="bg-white border border-border rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center gap-5">
                <div className="flex-1">
                  <p className="font-bold text-[#0A2540] mb-1">{item.name}</p>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                </div>
                <div className="flex-shrink-0 flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-[#0A2540] font-bold text-sm">{item.price}</p>
                    <p className="text-muted-foreground text-xs flex items-center gap-1 justify-end mt-0.5">
                      <Clock className="w-3 h-3" /> {item.duration}
                    </p>
                  </div>
                  <Link href={item.href} className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold hover:underline text-sm whitespace-nowrap">
                    Details <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-6">Fractional M365 Architect Retainers</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {retainerLoading
              ? [0, 1, 2].map((i) => (
                  <div key={i} className="rounded-2xl p-8 border bg-white border-border animate-pulse">
                    <div className="h-5 w-32 bg-gray-200 rounded mb-4" />
                    <div className="h-10 w-24 bg-gray-200 rounded mb-2" />
                    <div className="h-4 w-20 bg-gray-200 rounded mb-4" />
                    <div className="h-16 bg-gray-100 rounded" />
                  </div>
                ))
              : retainerServices.map((tier, i) => (
                  <RetainerCard key={tier.slug ?? tier.name} plan={tier} index={i} />
                ))}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-5">
            All retainers are month-to-month.{" "}
            <Link href="/pricing" className="text-[#0078D4] hover:underline font-medium">See full pricing →</Link>
          </p>
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 700px 400px at 50% 100%, rgba(0,120,212,0.15) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Ready to Start?</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
            Give Your Team the Training They Actually Need
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10">
            A 30-minute consultation to scope the right training format, modules, and schedule for your organization.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <CTAButton href="/book" className="px-8 py-3.5 text-base">
              Book a Training Consultation
            </CTAButton>
            {hasPdf ? (
              <button
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center gap-2 text-white/80 hover:text-white font-semibold border border-white/20 hover:border-white/40 px-8 py-3.5 rounded-xl transition-colors text-base"
              >
                Download the Training Overview <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <a
                href="/contact?intent=training-overview"
                className="inline-flex items-center gap-2 text-white/80 hover:text-white font-semibold border border-white/20 hover:border-white/40 px-8 py-3.5 rounded-xl transition-colors text-base"
              >
                Download the Training Overview <ArrowRight className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      </section>
      <ServiceOverviewModal
        serviceName="M365 Training & Enablement"
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </Layout>
  );
}
