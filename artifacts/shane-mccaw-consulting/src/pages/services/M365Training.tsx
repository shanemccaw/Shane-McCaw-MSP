import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { ChatCTA } from "@/components/ChatCTA";
import { Link } from "wouter";
import {
  CheckCircle, ArrowRight, ChevronRight,
  Mail, MessageSquare, FolderOpen, Bot, Zap, Server,
} from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const MODULES = [
  {
    icon: Mail,
    title: "Outlook",
    desc: "Email organization, calendar management, delegation, rules, shared mailboxes, and mobile configuration for everyday productivity.",
  },
  {
    icon: MessageSquare,
    title: "Microsoft Teams",
    desc: "Channels, meetings, chat best practices, app integrations, and governance etiquette for effective team collaboration.",
  },
  {
    icon: FolderOpen,
    title: "SharePoint & OneDrive",
    desc: "Document storage, co-authoring, version control, sharing permissions, and intranet navigation built for your site structure.",
  },
  {
    icon: Server,
    title: "Exchange",
    desc: "Exchange Online administration, mailbox management, distribution lists, mail flow rules, and hybrid configuration fundamentals.",
  },
  {
    icon: Bot,
    title: "Copilot for Microsoft 365",
    desc: "Practical Copilot use across Teams, Outlook, Word, Excel, and PowerPoint — what it can do, how to prompt it effectively, and what to watch for.",
  },
  {
    icon: Zap,
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

export default function M365Training() {
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
        }}
      />

      {/* Breadcrumb */}
      <div className="border-b border-white/[0.06] pt-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-2 text-sm text-text-secondary">
          <Link href="/services" className="hover:text-accent-blue transition-colors">Services</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-primary font-medium">Training & Enablement</span>
        </div>
      </div>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="pt-12 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 glass-panel text-text-primary text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6">
            <Bot className="w-3.5 h-3.5 text-accent-blue" />
            Training & Enablement
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-text-primary mb-6 leading-tight">
            Microsoft 365 Training & Enablement — Empower Your Entire Organization
          </h1>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Live, instructor-led training built on NASA methodology — tailored to your tools, your configuration, and your team.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/assessment"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-white text-base transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Start Your Free Assessment
            </a>
            <ChatCTA className="inline-flex items-center justify-center gap-2 text-text-secondary hover:text-text-primary font-medium text-base transition-colors">
              Talk to Shane first <ArrowRight className="w-4 h-4" />
            </ChatCTA>
          </div>
        </div>
      </section>

      {/* ── INTRO ────────────────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.12em] mb-4">The Problem</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">
              Most Organizations Are Paying for Tools Their Teams Don't Know How to Use
            </h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              Microsoft 365 is one of the most powerful productivity platforms ever built — and one of the most underused. Most organizations get through deployment, hand employees a login, and assume adoption follows. It doesn't.
            </p>
            <p className="text-text-secondary leading-relaxed mb-4">
              Teams fall back to email chains instead of using Teams channels. Files are saved to desktops instead of SharePoint. Copilot licenses sit unused because nobody knows where to start.
            </p>
            <p className="text-text-secondary leading-relaxed">
              Shane McCaw developed and delivered Microsoft 365 training at NASA — where correct tool use wasn't optional, it was a compliance and mission requirement. That curriculum translates directly to your organization, tailored to your configuration and your team's actual workflows.
            </p>
          </div>
          <div className="bg-charcoal-1 border border-white/[0.06] rounded-2xl p-8 space-y-5">
            <p className="text-accent-blue text-xs font-bold uppercase tracking-widest">Common Adoption Gaps</p>
            <div className="space-y-4">
              {[
                { issue: "Teams underused", detail: "Employees still scheduling meetings via email and sharing files as attachments." },
                { issue: "SharePoint ignored", detail: "Files live on local drives or in email — version control and collaboration are broken." },
                { issue: "Copilot licenses wasted", detail: "Licenses purchased, nobody trained, ROI is zero and renewals are being questioned." },
              ].map((item) => (
                <div key={item.issue} className="flex gap-3">
                  <div className="w-2 h-2 rounded-full bg-accent-blue flex-shrink-0 mt-2" />
                  <div>
                    <p className="font-semibold text-text-primary text-sm">{item.issue}</p>
                    <p className="text-text-secondary text-sm leading-relaxed">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── TRAINING MODULES ─────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.12em] mb-3">Curriculum</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">Training Modules</h2>
            <p className="text-text-secondary mt-4 max-w-xl mx-auto">
              Modules are mixed and matched to your organization's needs. Not every engagement covers all six — scope is agreed upfront.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {MODULES.map((mod) => {
              const Icon = mod.icon;
              return (
                <div
                  key={mod.title}
                  className="flex gap-4 p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06] hover:border-accent-blue/30 transition-all"
                >
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue flex-shrink-0">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-text-primary mb-1.5 text-sm">{mod.title}</h3>
                    <p className="text-text-secondary text-sm leading-relaxed">{mod.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── WHAT'S INCLUDED ──────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.12em] mb-3">Inclusions</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">What's Included in Every Engagement</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {INCLUSIONS.map((item) => (
              <div key={item} className="flex items-start gap-3 bg-charcoal-1 border border-white/[0.06] rounded-xl p-5">
                <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                <span className="text-text-primary text-sm leading-snug">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHO THIS IS FOR ──────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.12em] mb-3">Ideal Clients</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">Who This Is For</h2>
          </div>
          <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
            {WHO_FOR.map((item) => (
              <div key={item} className="flex items-start gap-3 bg-charcoal-1 border border-white/[0.06] rounded-xl p-4">
                <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                <span className="text-text-primary text-sm leading-snug">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY THIS TRAINING WORKS ──────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.12em] mb-3">Differentiators</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">Why This Training Works</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_WORKS.map((item) => (
              <div key={item.title} className="flex gap-4 p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06] hover:border-accent-blue/30 transition-all">
                <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-display font-bold text-text-primary mb-2">{item.title}</h3>
                  <p className="text-text-secondary text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ASSESSMENT CTA ───────────────────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06] text-center">
        <div className="max-w-2xl mx-auto">
          <p className="text-accent-blue text-xs font-bold uppercase tracking-widest mb-4">Free Assessment</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary mb-4">
            Find Out Where Your Team's M365 Adoption Stands
          </h2>
          <p className="text-text-secondary text-lg mb-10">
            A short assessment covering adoption gaps, licensing utilization, and training priorities. Get personalised recommendations — no sales call required.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/assessment"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-white text-base transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Start Your Free Assessment
            </a>
          </div>
        </div>
      </section>
    </Layout>
  );
}
