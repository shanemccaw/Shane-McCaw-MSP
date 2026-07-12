import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { Layout as LayoutIcon, CheckCircle, ArrowRight, Building2, Shield, Users } from "lucide-react";
import { CTAButton } from "@/components/CTAButton";

const WHAT_SHANE_DELIVERS = [
  { title: "Information Architecture", desc: "Hub sites, site collections, and Teams-connected sites structured to match how your organization actually works — not a template." },
  { title: "Governance Framework", desc: "Naming conventions, lifecycle policies, ownership models, and DLP rules that prevent sprawl before it starts." },
  { title: "Permissions & Sharing Controls", desc: "External sharing locked down, inheritance chains cleaned up, and sensitivity labels applied to control who sees what." },
  { title: "Migration Planning", desc: "Full discovery, risk analysis, and sequenced migration plan from file servers, legacy SharePoint, or Google Workspace." },
  { title: "Modern Intranet Design", desc: "A navigation model and homepage architecture that employees actually use — built around your content and workflows." },
  { title: "Training & Enablement", desc: "Administrator and end-user training tailored to your site structure, governance policies, and team workflows." },
];

const WHO_FOR = [
  { icon: <Building2 className="w-5 h-5 text-[#0078D4]" />, label: "Organizations migrating from legacy SharePoint, file servers, or Google Workspace" },
  { icon: <Shield className="w-5 h-5 text-[#0078D4]" />, label: "Regulated industries that need defensible permissions and DLP controls" },
  { icon: <Users className="w-5 h-5 text-[#0078D4]" />, label: "Companies whose intranet has become a maze nobody navigates" },
  { icon: <LayoutIcon className="w-5 h-5 text-[#0078D4]" />, label: "IT leaders who know their SharePoint environment is out of control but don't know where to start" },
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

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-[172px] pb-20 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <LayoutIcon className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">SharePoint</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            SharePoint Architecture & Modern Intranets — Built Right, the First Time
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl leading-relaxed">
            Most SharePoint environments weren't architected — they grew. Sites, teams, and permissions accumulated without governance, and now nobody can find anything. Shane fixes that.
          </p>
          <div className="mt-10">
            <CTAButton href="/assessment">Start Your Free Assessment</CTAButton>
          </div>
        </div>
      </section>

      {/* ── WHY INTRANETS FAIL ───────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Problem</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-6">Why Most SharePoint Environments Fail</h2>
              <p className="text-muted-foreground leading-relaxed mb-5">
                SharePoint wasn't deployed with governance — it was deployed under deadline pressure. Sites were created on request, permissions were set by whoever asked, and migrations were executed without a plan. Years later, the environment is a maze of ungoverned sites, inherited permissions nobody understands, and content nobody can find.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-5">
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
                  <li key={i} className="flex items-start gap-3 text-foreground text-sm">
                    <span className="w-4 h-4 rounded-full bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold">!</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Shane's Approach</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-6">Architecture Before Execution</h2>
              <p className="text-muted-foreground leading-relaxed mb-6">
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
                  <li key={i} className="flex items-start gap-3 text-foreground">
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHAT SHANE DELIVERS ──────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Scope of Work</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">What Shane Delivers</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {WHAT_SHANE_DELIVERS.map((item) => (
              <div key={item.title} className="bg-white border border-border rounded-2xl p-6 hover:border-[#0078D4]/30 transition-all">
                <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHO IT'S FOR ─────────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Ideal Clients</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">Who This Is For</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {WHO_FOR.map((item) => (
              <div key={item.label} className="flex items-start gap-3 bg-[#F7F9FC] border border-border rounded-xl p-5">
                {item.icon}
                <span className="text-[#0A2540] text-sm leading-snug">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY SHANE ────────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Credentials</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">Why Work With Shane</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_SHANE.map((item) => (
              <div key={item.title} className="flex gap-4 p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-white transition-all">
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

      {/* ── ASSESSMENT CTA ───────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 700px 400px at 50% 100%, rgba(0,120,212,0.15) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free Assessment</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4 max-w-2xl mx-auto">
            Find Out Where Your SharePoint Environment Stands
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            A short assessment covering permissions, governance, architecture, and migration readiness. Get a personalised score and recommended starting point — no sales call required.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <CTAButton href="/assessment" className="px-8 py-3.5 text-base">
              Start Your Free Assessment
            </CTAButton>
          </div>
        </div>
      </section>
    </Layout>
  );
}
