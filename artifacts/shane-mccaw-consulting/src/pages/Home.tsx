import { useEffect } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { ServiceCard } from "@/components/ServiceCard";
import {
  Cloud, Bot, Shield, Zap, Server, Users,
  CheckCircle, ArrowRight, Star, Quote
} from "lucide-react";

const services = [
  {
    icon: Cloud,
    title: "M365 Tenant Health Audit",
    tagline: "Know exactly where you stand.",
    description: "A systematic, NASA-methodology review of your Microsoft 365 tenant — security posture, licensing efficiency, workload adoption, and governance gaps. You receive a prioritized remediation report with clear next steps, not a generic checklist.",
    href: "/services/microsoft-365",
    badge: "Most popular starting point",
  },
  {
    icon: Bot,
    title: "Copilot for M365 Readiness Assessment",
    tagline: "Deploy AI safely. Realize the ROI.",
    description: "Before enabling Copilot, your data governance, permissions, and sensitivity labels must be right. Shane audits your environment against the same readiness criteria used at NASA, then hands you a deployment roadmap that eliminates oversharing risk and maximizes adoption.",
    href: "/services/copilot-ai",
    badge: "High demand",
  },
  {
    icon: Shield,
    title: "Governance Foundations Package",
    tagline: "Mission-critical compliance discipline.",
    description: "DLP policies, sensitivity labels, retention schedules, conditional access, and Purview configuration — built to the same standard Shane applies at NASA. Designed for regulated industries and government contractors who cannot afford a compliance gap.",
    href: "/services/governance",
    badge: null,
  },
  {
    icon: Zap,
    title: "Power Platform Quick-Start",
    tagline: "Automate one process. Prove the model.",
    description: "A fully built, tested Power Automate flow or Power App delivered in under two weeks. Shane scopes the right process, builds it correctly from the start — with error handling, monitoring, and documentation — so it scales as your needs grow.",
    href: "/services/power-platform",
    badge: null,
  },
  {
    icon: Server,
    title: "Migration Readiness Assessment",
    tagline: "Migrate with confidence, not guesswork.",
    description: "Exchange, SharePoint, or cross-tenant M365 migrations carry real risk when rushed. Shane's pre-migration assessment surfaces every complexity — hybrid dependencies, permission structures, retention obligations — before a single mailbox moves.",
    href: "/services/cloud-migration",
    badge: null,
  },
  {
    icon: Users,
    title: "Fractional M365 Architect Retainer",
    tagline: "Senior architecture. On your schedule.",
    description: "Ongoing access to Shane as your organization's dedicated Microsoft 365 architect — without the cost of a full-time hire. Strategic roadmap, hands-on implementation, governance oversight, and direct escalation support. The same expertise NASA relies on, available to your team monthly.",
    href: "/pricing",
    badge: "Enterprise favorite",
  },
];

const whyPoints = [
  "NASA-grade thinking from 6+ years as Lead M365 Architect — mission-critical standards applied to your business.",
  "30 years of Microsoft ecosystem expertise — from code to cloud, across every major platform evolution.",
  "Direct access to Shane always — no junior consultants, no offshore teams, no handoffs.",
  "Forum of Innovation Award winner, 20+ former Microsoft certifications, ex-Microsoft engineer, founder of McCawSoft.",
];

const microOffers = [
  { title: "M365 Health Check", price: "$497", desc: "90-min audit + comprehensive written report with prioritized recommendations.", href: "/book" },
  { title: "Copilot Readiness Assessment", price: "$797", desc: "Full readiness review + tailored deployment plan with governance framework.", href: "/book" },
  { title: "SharePoint Intranet Blueprint", price: "$997", desc: "Architecture plan, sitemap, taxonomy design, and wireframe deliverable.", href: "/book" },
];

const testimonials = [
  {
    quote: "Shane's expertise transformed our M365 environment completely. We went from a chaotic, misconfigured tenant to a secure, well-governed platform in weeks. His NASA-grade approach gave us confidence we hadn't felt before.",
    name: "Jennifer M.",
    title: "Director of IT",
    company: "Regional Healthcare Network",
    placeholder: true,
  },
  {
    quote: "Our Copilot rollout was stalled for months. Shane came in, assessed our data governance gaps, fixed them, and had us productively using AI within three weeks. ROI was immediate.",
    name: "David K.",
    title: "CTO",
    company: "Financial Services Firm",
    placeholder: true,
  },
  {
    quote: "The SharePoint intranet Shane built for us is the first one our employees actually use. Clean architecture, fast performance, and a governance model that keeps it organized as we grow.",
    name: "Sandra R.",
    title: "VP of Operations",
    company: "National Nonprofit Organization",
    placeholder: true,
  },
];

export default function Home() {
  useEffect(() => {
    document.title = "Enterprise Microsoft 365 & Copilot AI Consulting | Shane McCaw Consulting";
  }, []);

  return (
    <Layout>
      {/* HERO */}
      <section className="relative min-h-screen flex items-center justify-center bg-[#0A2540] overflow-hidden">
        {/* Grid overlay */}
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
        {/* Radial glow */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            background: "radial-gradient(ellipse 70% 60% at 50% 40%, #0078D4, transparent)",
          }}
        />
        <div className="relative z-10 max-w-[1200px] mx-auto px-6 py-32 pt-44 text-center">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/15 border border-[#0078D4]/40 rounded-full px-5 py-2 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#00B4D8] animate-pulse" />
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em]">
              Current Microsoft 365 Architect & Copilot SME — NASA
            </p>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-[3.75rem] font-extrabold text-white leading-[1.1] mb-7 max-w-5xl mx-auto">
            Fractional Microsoft 365 Architecture — Built to NASA Standards. Delivered to Your Organization.
          </h1>
          <p className="text-lg md:text-xl text-white/75 max-w-3xl mx-auto mb-12 leading-relaxed">
            Shane McCaw is the serving Microsoft 365 Architect and Copilot AI Subject Matter Expert at NASA — and he brings that same mission-critical discipline to your cloud modernization, governance, and Copilot readiness engagement. No generalists. No offshore handoffs. Senior Microsoft expertise, available to your organization on a fractional basis.
          </p>
          <CTAButton href="/book" className="text-base px-10 py-4 shadow-lg shadow-[#0078D4]/30" data-testid="hero-cta-primary">
            Book a Consultation
          </CTAButton>
          <div className="mt-14 pt-10 border-t border-white/10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-white/50 text-sm font-medium">
            {[
              "Fractional M365 Architecture",
              "Copilot AI Readiness",
              "Cloud Modernization",
              "Governance & Compliance",
              "30+ Years Microsoft Experience",
            ].map((badge, i) => (
              <span key={i} className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0" />
                {badge}
              </span>
            ))}
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#F7F9FC] to-transparent" />
      </section>

      {/* CREDIBILITY BAR */}
      <section className="bg-[#F7F9FC] border-y border-border py-8" data-testid="credibility-bar">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="flex flex-wrap items-center justify-center gap-4 text-center">
            {[
              { name: "Microsoft", detail: "30+ Years | Former Employee" },
              { name: "NASA", detail: "Current Lead M365 Architect | 6 Years" },
              { name: "Planet Technologies", detail: "Former Director of Technologies" },
              { name: "McCawSoft", detail: "Founder & Principal Architect" },
              { name: "Forum of Innovation", detail: "Award Winner" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="text-center">
                  <div className="font-bold text-[#0A2540] text-sm md:text-base">{item.name}</div>
                  <div className="text-muted-foreground text-xs md:text-sm">{item.detail}</div>
                </div>
                {i < 4 && <div className="hidden sm:block h-10 w-px bg-border" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SERVICES GRID */}
      <section className="bg-white py-20" data-testid="services-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Services & Engagements</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Six Ways to Engage — All Backed by NASA-Level Expertise</h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Every engagement is scoped and delivered personally by Shane. No project managers between you and the architect. No junior consultants doing the work.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {services.map((s, i) => {
              const Icon = s.icon;
              return (
                <div
                  key={i}
                  className="group relative bg-white border border-border rounded-xl p-7 flex flex-col hover:-translate-y-1 hover:shadow-xl hover:border-[#0078D4]/30 transition-all duration-300"
                  data-testid={`service-card-${i}`}
                >
                  {s.badge && (
                    <span className="absolute top-4 right-4 bg-[#0078D4]/10 text-[#0078D4] text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full">
                      {s.badge}
                    </span>
                  )}
                  <div className="w-11 h-11 rounded-lg bg-[#0078D4]/10 flex items-center justify-center mb-5 flex-shrink-0">
                    <Icon className="w-5 h-5 text-[#0078D4]" />
                  </div>
                  <p className="text-[#0078D4] text-xs font-semibold uppercase tracking-[0.08em] mb-1.5">{s.tagline}</p>
                  <h3 className="text-[1.1rem] font-bold text-[#0A2540] leading-snug mb-3">{s.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed flex-grow mb-6">{s.description}</p>
                  <Link
                    href={s.href}
                    className="inline-flex items-center gap-1.5 text-[#0078D4] text-sm font-semibold hover:gap-2.5 transition-all"
                    data-testid={`service-link-${i}`}
                  >
                    Learn More <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              );
            })}
          </div>
          <div className="text-center mt-10">
            <Link href="/micro-offers" className="inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-[#0078D4] transition-colors" data-testid="view-all-services">
              View all fixed-price packages and retainer options <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* WHY SHANE */}
      <section className="bg-[#F7F9FC] py-20" data-testid="why-shane-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">The Difference</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Why Work With Shane McCaw?</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {whyPoints.map((point, i) => (
              <div key={i} className="flex items-start gap-4 bg-white p-6 rounded-lg border border-border" data-testid={`why-point-${i}`}>
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#0078D4]/10 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-[#0078D4]" />
                </div>
                <p className="text-foreground leading-relaxed">{point}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-white py-20" data-testid="how-it-works-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Process</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">How It Works</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {[
              { step: "01", title: "Free Discovery Call", desc: "30-minute assessment of your Microsoft 365 environment, pain points, and goals. No pitch — just clarity." },
              { step: "02", title: "Custom Roadmap", desc: "Tailored plan with transparent scope, timeline, and pricing. You know exactly what you're getting before a single dollar changes hands." },
              { step: "03", title: "Hands-On Execution", desc: "Shane personally builds, configures, and delivers. No handoffs to junior staff. No surprises." },
            ].map((item, i) => (
              <div key={i} className="relative text-center px-4" data-testid={`step-${i}`}>
                <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 border-2 border-[#0078D4] flex items-center justify-center mx-auto mb-6">
                  <span className="text-[#0078D4] font-extrabold text-lg">{item.step}</span>
                </div>
                <h3 className="text-xl font-bold text-[#0A2540] mb-3">{item.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{item.desc}</p>
                {i < 2 && (
                  <div className="hidden md:block absolute top-8 left-[calc(100%-1rem)] w-8 h-px bg-[#0078D4]/30" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURED MICRO-OFFERS */}
      <section className="bg-[#F7F9FC] py-20" data-testid="micro-offers-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Quick Wins</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Start Small. Win Big.</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Fixed-price packages with clear deliverables. Get results fast without a long commitment.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {microOffers.map((offer, i) => (
              <div key={i} className="bg-white p-8 rounded-lg border border-border hover:shadow-lg hover:-translate-y-1 transition-all duration-300" data-testid={`micro-offer-${i}`}>
                <p className="text-[#0078D4] text-3xl font-extrabold mb-2">{offer.price}</p>
                <h3 className="text-lg font-bold text-[#0A2540] mb-3">{offer.title}</h3>
                <p className="text-muted-foreground text-sm mb-6 leading-relaxed">{offer.desc}</p>
                <CTAButton href={offer.href} className="w-full justify-center text-sm" data-testid={`micro-offer-cta-${i}`}>
                  Get Started
                </CTAButton>
              </div>
            ))}
          </div>
          <div className="text-center">
            <Link href="/micro-offers" className="text-[#0078D4] font-semibold hover:underline flex items-center justify-center gap-1" data-testid="view-all-offers">
              View All 6 Quick Win Packages <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="bg-white py-20" data-testid="testimonials-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Client Feedback</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">What Clients Say</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <div key={i} className="bg-[#F7F9FC] p-8 rounded-lg border-l-4 border-[#0078D4]" data-testid={`testimonial-${i}`}>
                <Quote className="w-8 h-8 text-[#0078D4]/30 mb-4" />
                <p className="text-foreground italic leading-relaxed mb-6">"{t.quote}"</p>
                <div>
                  <p className="font-semibold text-[#0A2540]">{t.name}</p>
                  <p className="text-muted-foreground text-sm">{t.title}, {t.company}</p>
                  <span className="inline-block mt-2 text-xs bg-[#0078D4]/10 text-[#0078D4] px-2 py-0.5 rounded font-medium">PLACEHOLDER</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONSULTATION CTA SECTION */}
      <section className="relative bg-[#0A2540] py-28 overflow-hidden" data-testid="final-cta-section">
        {/* Radial glow overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,120,212,0.18) 0%, transparent 75%)",
          }}
        />
        {/* Subtle grid overlay */}
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
            Free 30-Minute Discovery Call
          </p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-6">
            Your Microsoft 365 Environment Deserves Senior Expertise
          </h2>
          <p className="text-white/70 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Work directly with Shane — a 30-year Microsoft veteran and Lead M365 Architect at NASA. No account managers, no junior staff. Just clear, actionable guidance from day one.
          </p>
          <CTAButton href="/book" className="text-lg px-12 py-5" data-testid="final-cta-button">
            Book a Consultation
          </CTAButton>
          <p className="mt-5 text-white/40 text-sm tracking-wide">
            No pitch. No obligation. Just clarity.
          </p>
        </div>
      </section>
    </Layout>
  );
}
