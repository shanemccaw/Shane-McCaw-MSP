import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { ChatCTA } from "@/components/ChatCTA";
import { Link } from "wouter";
import { Layout as LayoutIcon, CheckCircle, ArrowRight, ChevronRight, Building2, Shield, Users } from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const WHAT_SHANE_DELIVERS = [
  { title: "Information Architecture", desc: "Hub sites, site collections, and Teams-connected sites structured to match how your organization actually works — not a template." },
  { title: "Governance Framework", desc: "Naming conventions, lifecycle policies, ownership models, and DLP rules that prevent sprawl before it starts." },
  { title: "Permissions & Sharing Controls", desc: "External sharing locked down, inheritance chains cleaned up, and sensitivity labels applied to control who sees what." },
  { title: "Migration Planning", desc: "Full discovery, risk analysis, and sequenced migration plan from file servers, legacy SharePoint, or Google Workspace." },
  { title: "Modern Intranet Design", desc: "A navigation model and homepage architecture that employees actually use — built around your content and workflows." },
  { title: "Training & Enablement", desc: "Administrator and end-user training tailored to your site structure, governance policies, and team workflows." },
];

const WHO_FOR = [
  { icon: Building2, label: "Organizations migrating from legacy SharePoint, file servers, or Google Workspace" },
  { icon: Shield, label: "Regulated industries that need defensible permissions and DLP controls" },
  { icon: Users, label: "Companies whose intranet has become a maze nobody navigates" },
  { icon: LayoutIcon, label: "IT leaders who know their SharePoint environment is out of control but don't know where to start" },
];

const WHY_SHANE = [
  {
    title: "Architecture Before Execution",
    desc: "Most SharePoint failures are governance failures, not technical ones. Shane designs the right governance model before any content moves — so you don't spend months cleaning up a migration that was planned wrong.",
  },
  {
    title: "NASA-Grade Permissions Management",
    desc: "Shane managed SharePoint permissions models for NASA — environments where oversharing wasn't just an operational nuisance, it was a compliance and security incident.",
  },
  {
    title: "30 Years in the Microsoft Ecosystem",
    desc: "From early SharePoint deployments to SharePoint Online with Copilot integration — Shane has seen every era of Microsoft's content management evolution and knows what works at enterprise scale.",
  },
  {
    title: "Practitioner, Not a Generalist",
    desc: "Shane doesn't subcontract. Every architecture decision, governance framework, and migration plan is built by him — with 30 years of hands-on Microsoft ecosystem experience behind it.",
  },
];

export default function SharePoint() {
  return (
    <Layout>
      <SEOMeta
        title="SharePoint Architecture & Modern Intranets | Shane McCaw Consulting"
        description="SharePoint Online architecture, governance, and modern intranet consulting by Shane McCaw. Migration planning, permissions management, and governance frameworks for regulated organizations."
        ogImage="/og-image-sharepoint.png"
        ogUrl="https://shanemccawconsulting.com/services/sharepoint"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "SharePoint Architecture & Modern Intranets",
          "description": "SharePoint Online architecture, governance frameworks, and intranet consulting — designed for organizations that need a governed, compliant, and usable SharePoint environment.",
          "url": "https://shanemccawconsulting.com/services/sharepoint",
          "serviceType": "SharePoint Consulting",
          "areaServed": { "@type": "Country", "name": "United States" },
          "audience": {
            "@type": "Audience",
            "audienceType": "Organizations with complex SharePoint environments or planning a SharePoint migration",
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
          <span className="text-text-primary font-medium">SharePoint</span>
        </div>
      </div>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="pt-12 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 glass-panel text-text-primary text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6">
            <LayoutIcon className="w-3.5 h-3.5 text-accent-blue" />
            SharePoint
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-text-primary mb-6 leading-tight">
            SharePoint Architecture & Modern Intranets — Built Right, the First Time
          </h1>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Most SharePoint environments weren't architected — they grew. Sites, teams, and permissions accumulated without governance, and now nobody can find anything. Shane fixes that.
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

      {/* ── WHY INTRANETS FAIL ───────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Problem</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">Why Most SharePoint Environments Fail</h2>
            <p className="text-text-secondary leading-relaxed mb-5">
              SharePoint wasn't deployed with governance — it was deployed under deadline pressure. Sites were created on request, permissions were set by whoever asked, and migrations were executed without a plan. Years later, the environment is a maze of ungoverned sites, inherited permissions nobody understands, and content nobody can find.
            </p>
            <p className="text-text-secondary leading-relaxed mb-5">
              Adding content or migrating into a broken foundation doesn't fix the problem — it amplifies it. The right approach is to establish governance first, then build or migrate.
            </p>
            <ul className="space-y-3">
              {[
                "Permissions inherited from parent sites nobody manages anymore",
                "Hundreds of orphaned sites with no owner and no lifecycle policy",
                "External sharing enabled broadly with no audit trail",
                "Migration projects that copied the mess instead of cleaning it up",
                "Employees who use email attachments because SharePoint is too confusing",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-text-primary text-sm">
                  <span className="w-4 h-4 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold">!</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">Shane's Approach</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">Architecture Before Execution</h2>
            <p className="text-text-secondary leading-relaxed mb-6">
              Before anyone moves a file or creates a site, Shane maps your information architecture, ownership model, and governance policies. The result is a SharePoint environment your employees actually use — and your IT team can maintain.
            </p>
            <ul className="space-y-3">
              {[
                "Information architecture mapped to your actual org structure",
                "Governance policies documented and enforced — not just written down",
                "Permissions model that makes sense and stays clean over time",
                "Migration plan with zero-data-loss sequencing and a rollback at every phase",
                "Modern intranet that employees navigate without a training manual",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-text-primary">
                  <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── WHAT SHANE DELIVERS ──────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-3">Scope of Work</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">What Shane Delivers</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {WHAT_SHANE_DELIVERS.map((item) => (
              <div key={item.title} className="bg-charcoal-1 border border-white/[0.06] rounded-2xl p-6 hover:border-accent-blue/30 transition-all">
                <h3 className="font-display font-bold text-text-primary mb-2">{item.title}</h3>
                <p className="text-text-secondary text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHO IT'S FOR ─────────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-3">Ideal Clients</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">Who This Is For</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {WHO_FOR.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-start gap-3 bg-charcoal-1 border border-white/[0.06] rounded-xl p-5">
                  <Icon className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                  <span className="text-text-primary text-sm leading-snug">{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── WHY SHANE ────────────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-3">Credentials</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">Why Work With Shane</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_SHANE.map((item) => (
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
            Find Out Where Your SharePoint Environment Stands
          </h2>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            A short assessment covering permissions, governance, architecture, and migration readiness. Get a personalised score and recommended starting point — no sales call required.
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
