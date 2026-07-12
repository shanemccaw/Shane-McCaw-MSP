import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import {
  CheckCircle, ArrowRight, Shield, Search, Activity, Zap,
  Building2, Briefcase, Rocket, Star,
} from "lucide-react";

const trustPoints = [
  "30+ years inside the Microsoft ecosystem — from early infrastructure to modern cloud",
  "Current Lead Microsoft 365 Architect at NASA",
  "Compliance frameworks (FedRAMP, FISMA, ITAR, GCC High) learned under real mission-critical conditions",
  "Every engagement delivered personally — no account managers, no junior staff, no offshore handoffs",
  "Fixed-price scoping so you always know what you're getting and what it costs",
];

const audienceSegments = [
  {
    icon: Building2,
    title: "Mid-Market Enterprises",
    subtitle: "200–2,000 Employees",
    description:
      "You've deployed Microsoft 365, but governance never followed. Now Copilot is on the roadmap and the tenant isn't ready for it.",
    color: "#0078D4",
  },
  {
    icon: Shield,
    title: "Regulated & Government-Adjacent",
    subtitle: "Healthcare · Legal · Financial · Federal Contractors",
    description:
      "Your compliance frameworks demand senior-level architecture. Hiring a full-time M365 architect takes months — and a fractional engagement gets you there faster.",
    color: "#00B4D8",
  },
  {
    icon: Rocket,
    title: "Startups & Scale-Ups",
    subtitle: "Rapid Growth · First-Time Architecture",
    description:
      "Headcount is outpacing your initial Microsoft 365 setup. Build it right before scale makes it exponentially harder to fix.",
    color: "#0A2540",
  },
];

export default function Home() {
  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 & Copilot AI Specialist | Shane McCaw Consulting"
        description="Shane McCaw is NASA's Lead Microsoft 365 Architect — 30 years of Microsoft expertise. Start with a free tenant assessment or continuous monitoring. Senior-level delivery, no handoffs."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "ProfessionalService",
          "name": "Shane McCaw Consulting",
          "url": "https://shanemccawconsulting.com",
          "description":
            "Enterprise Microsoft 365 and Copilot AI consulting by Shane McCaw — NASA's Lead M365 Architect with 30 years of Microsoft expertise.",
          "founder": { "@type": "Person", "name": "Shane McCaw" },
          "areaServed": "US",
          "knowsAbout": [
            "Microsoft 365",
            "Copilot AI",
            "SharePoint",
            "Microsoft Teams",
            "Power Platform",
            "Microsoft Governance",
            "Cloud Migration",
          ],
        }}
      />

      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center bg-[#0A2540] overflow-hidden">
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
          className="absolute inset-0 opacity-20"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 40%, #0078D4, transparent)",
          }}
        />

        <div className="relative z-10 max-w-[1200px] mx-auto px-6 py-32 pt-44 text-center">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/15 border border-[#0078D4]/40 rounded-full px-5 py-2 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#00B4D8] animate-pulse" />
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em]">
              Microsoft 365 &amp; Copilot AI Specialist
            </p>
          </div>

          {/* Credential pills */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
            <span className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded px-4 py-1.5 text-white/90 text-sm font-semibold">
              <Briefcase className="w-3.5 h-3.5 text-[#00B4D8] flex-shrink-0" />
              Lead M365 Architect at NASA
            </span>
            <span className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded px-4 py-1.5 text-white/90 text-sm font-semibold">
              <CheckCircle className="w-3.5 h-3.5 text-[#00B4D8] flex-shrink-0" />
              30 Years Microsoft Ecosystem Experience
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl md:text-5xl lg:text-[3.75rem] font-extrabold text-white leading-[1.1] mb-5 max-w-5xl mx-auto">
            The Architect Who Built at NASA Scale —<br className="hidden md:block" /> Available to You.
          </h1>

          <p className="text-base md:text-lg text-[#00B4D8] font-semibold max-w-2xl mx-auto mb-5">
            Mission-critical Microsoft 365 architecture for mid-market and regulated organizations — without a full-time hire.
          </p>

          <p className="text-lg md:text-xl text-white/70 max-w-3xl mx-auto mb-12 leading-relaxed">
            Shane McCaw brings the same discipline he built at NASA to your organization.
            Start with a free tenant assessment, or connect your environment for continuous monitoring.
            Senior Microsoft expertise delivered personally — no account managers, no offshore handoffs.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton
              href="/assessment"
              className="text-base px-10 py-4 shadow-lg shadow-[#0078D4]/30"
              data-testid="hero-cta-primary"
            >
              Start Your Free Assessment
            </CTAButton>
            <Link
              href="/monitoring"
              className="inline-flex items-center gap-2 text-white/80 font-semibold text-base hover:text-white transition-colors border border-white/20 px-8 py-3.5 rounded-xl hover:border-white/40"
            >
              Explore Monitoring <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <p className="text-sm text-white/50 mt-3 text-center">
            No call required to start — connect your tenant, see your findings, get a scoped plan.
          </p>

          {/* Mini trust badges */}
          <div className="mt-14 pt-10 border-t border-white/10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-white/50 text-sm font-medium">
            {[
              "Fractional M365 Architecture",
              "Copilot AI Readiness",
              "Governance &amp; Compliance",
              "Cloud Migration",
              "30+ Years Microsoft Experience",
            ].map((badge, i) => (
              <span key={i} className="flex items-center gap-2" dangerouslySetInnerHTML={{ __html: `<svg class="w-4 h-4 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> ${badge}` }} />
            ))}
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#F7F9FC] to-transparent" />
      </section>

      {/* ── FUNNEL NARRATIVE STRIP ── Assess → Monitor → Act ────────────── */}
      <section className="bg-[#F7F9FC] py-20" data-testid="funnel-strip">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">
              How It Works
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              Assess. Monitor. Act.
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Every successful Microsoft 365 environment follows the same three disciplines.
              Shane has built and run this loop at scale — and brings the same rigor to your organization.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* Connector line */}
            <div className="hidden md:block absolute top-[3.25rem] left-[calc(16.67%+2rem)] right-[calc(16.67%+2rem)] h-0.5 bg-gradient-to-r from-[#0078D4] via-[#00B4D8] to-[#0A2540] opacity-20" />

            {[
              {
                step: "01",
                icon: Search,
                title: "Assess",
                color: "#0078D4",
                body: "A structured, automated tenant health audit gives you a clear picture of your current Microsoft 365 environment — security posture, governance gaps, Copilot readiness, and compliance exposure — before you commit to anything.",
                cta: { label: "Start Your Free Assessment", href: "/assessment" },
              },
              {
                step: "02",
                icon: Activity,
                title: "Monitor",
                color: "#00B4D8",
                body: "Continuous signal monitoring tracks configuration drift, licensing changes, security policy violations, and governance erosion so that small problems don't become expensive remediation projects.",
                cta: { label: "See How Monitoring Works", href: "/monitoring" },
              },
              {
                step: "03",
                icon: Zap,
                title: "Act",
                color: "#0A2540",
                body: "When findings surface — from an assessment or a live monitoring alert — Shane scopes a fixed-price engagement to address them. No open-ended consulting. No scope creep. Defined outcomes, delivered personally.",
                cta: { label: "View Project Work", href: "/projects" },
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={i}
                  className="flex flex-col items-center text-center"
                  data-testid={`funnel-step-${i}`}
                >
                  <div
                    className="w-24 h-24 rounded-2xl flex flex-col items-center justify-center mb-6 shadow-lg"
                    style={{ backgroundColor: item.color }}
                  >
                    <span className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-1">{item.step}</span>
                    <Icon className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-[#0A2540] mb-3">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-5 max-w-xs">
                    {item.body}
                  </p>
                  <Link
                    href={item.cta.href}
                    className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline underline-offset-2"
                  >
                    {item.cta.label} <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── TRUST STRIP ─────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20" data-testid="trust-strip">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="max-w-[860px] mx-auto text-center mb-12">
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em] mb-3">
              Why Shane
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-6">
              30 Years of Microsoft Depth — Built at Mission-Critical Scale
            </h2>
            <p className="text-white/70 text-lg leading-relaxed mb-4">
              Shane McCaw has spent three decades inside the Microsoft ecosystem — from early infrastructure deployments to leading Microsoft 365 architecture for one of the most compliance-intensive organizations on earth: NASA. As Lead M365 Architect, Shane designed and governed the systems used by scientists, engineers, and administrators whose work cannot fail.
            </p>
            <p className="text-white/70 text-lg leading-relaxed">
              Most consultants learn compliance frameworks from documentation. Shane learned them under real-world conditions where misconfiguration carried legal and mission consequences. FedRAMP, FISMA, ITAR, and GCC High aren't checklists to him — they're the environment he operated in daily. That discipline is now available to your organization on a fractional basis.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-1 gap-4 max-w-[860px] mx-auto mb-12">
            {trustPoints.map((point, i) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-xl px-6 py-4"
              >
                <CheckCircle className="w-5 h-5 text-[#00B4D8] flex-shrink-0 mt-0.5" />
                <p className="text-white/80 text-sm leading-relaxed">{point}</p>
              </div>
            ))}
          </div>

          {/* Compliance badges */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-12">
            {["FedRAMP", "FISMA", "ITAR", "GCC High"].map((badge, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-lg px-5 py-2.5 text-white font-bold text-sm"
              >
                <Shield className="w-4 h-4 text-[#00B4D8] flex-shrink-0" />
                {badge}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-[860px] mx-auto">
            {[
              { stat: "30+", label: "Years in the Microsoft Ecosystem" },
              { stat: "NASA", label: "Lead M365 Architect — Current Role" },
              { stat: "100%", label: "Senior Delivery — No Junior Staff" },
            ].map((item, i) => (
              <div
                key={i}
                className="bg-white/5 border border-white/10 rounded-xl p-6 text-center"
              >
                <div className="text-3xl font-extrabold text-[#00B4D8] mb-2">{item.stat}</div>
                <div className="text-white/60 text-sm font-medium">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AUDIENCE FORK STRIP ─────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20" data-testid="audience-fork">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">
              Who I Work With
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              Organizations With Real Complexity — and the Ambition to Fix It
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Shane works best with organizations that have outgrown generic IT support and need a senior Microsoft architect who has solved problems at mission-critical scale.
            </p>
          </div>

          {/* Direct-client segments — dominant layout */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {audienceSegments.map((segment, i) => {
              const Icon = segment.icon;
              return (
                <div
                  key={i}
                  className="bg-white rounded-xl border border-border p-8 flex flex-col hover:border-[#0078D4]/30 transition-colors"
                  data-testid={`audience-segment-${i}`}
                >
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center mb-5 flex-shrink-0"
                    style={{ backgroundColor: `${segment.color}18` }}
                  >
                    <Icon className="w-6 h-6" style={{ color: segment.color }} />
                  </div>
                  <h3 className="text-xl font-extrabold text-[#0A2540] mb-1">{segment.title}</h3>
                  <p
                    className="text-xs font-semibold uppercase tracking-widest mb-4"
                    style={{ color: segment.color }}
                  >
                    {segment.subtitle}
                  </p>
                  <p className="text-muted-foreground text-sm leading-relaxed flex-1">
                    {segment.description}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Primary direct-client CTA */}
          <div className="flex flex-col items-center gap-4 mt-6">
            <CTAButton href="/assessment" className="text-base px-10 py-4">
              Start Your Free Assessment
            </CTAButton>

            {/* MSP subordinate link */}
            <p className="text-muted-foreground text-sm">
              Are you an MSP or Microsoft partner?{" "}
              <Link
                href="/msp"
                className="text-[#0078D4] font-semibold hover:underline underline-offset-2"
              >
                See our MSP program →
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF / STAR ROW ─────────────────────────────────────── */}
      <section className="bg-white py-16" data-testid="social-proof">
        <div className="max-w-[860px] mx-auto px-6 text-center">
          <div className="flex items-center justify-center gap-1 mb-4">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="w-5 h-5 text-yellow-400 fill-yellow-400" />
            ))}
          </div>
          <blockquote className="text-xl md:text-2xl font-semibold text-[#0A2540] leading-snug mb-4">
            "Working with Shane was the first time our M365 environment was actually documented, governed, and ready for what came next."
          </blockquote>
          <p className="text-muted-foreground text-sm font-medium">
            — Director of IT, Mid-Market Healthcare Organization
          </p>
        </div>
      </section>

      {/* ── CLOSING CTA ─────────────────────────────────────────────────── */}
      <section
        className="relative bg-[#0A2540] py-28 overflow-hidden"
        data-testid="final-cta-section"
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,120,212,0.18) 0%, transparent 75%)",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative max-w-[860px] mx-auto px-6 text-center">
          <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-widest mb-4">
            Free Tenant Assessment
          </p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-6">
            Your Microsoft 365 Environment Deserves Senior Expertise.
          </h2>
          <p className="text-white/70 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Work directly with a 30-year Microsoft veteran and NASA's Lead M365 Architect. No account managers. No junior staff. Clear, actionable guidance — starting with a free assessment.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton
              href="/assessment"
              className="text-lg px-12 py-5"
              data-testid="final-cta-button"
            >
              Start Your Free Assessment
            </CTAButton>
            <Link
              href="/monitoring"
              className="inline-flex items-center gap-2 text-white/70 font-semibold text-base hover:text-white transition-colors border border-white/20 px-8 py-4 rounded-xl hover:border-white/40"
            >
              Explore Monitoring <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <p className="mt-5 text-white/40 text-sm tracking-wide">
            No pitch. No obligation. Just clarity on your Microsoft 365 environment.
          </p>
        </div>
      </section>
    </Layout>
  );
}
