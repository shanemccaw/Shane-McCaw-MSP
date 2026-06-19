import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { Cloud, CheckCircle, AlertCircle, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { ConsultationCTA } from "@/components/ConsultationCTA";
export default function Microsoft365() {
  const price = "Contact for pricing";
  const loading = false;
  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Setup & Optimization | Shane McCaw Consulting"
        description="Microsoft 365 setup, optimization, and tenant health audits by Shane McCaw. NASA-methodology reviews delivering clear, prioritized remediation roadmaps — not generic checklists."
        ogImage="/og-image-microsoft-365.png"
        ogUrl="https://shanemccawconsulting.com/services/microsoft-365"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Microsoft 365 Setup & Optimization",
          "description": "Microsoft 365 setup, optimization, and tenant health audits by Shane McCaw. NASA-methodology reviews delivering clear, prioritized remediation roadmaps — not generic checklists.",
          "url": "https://shanemccawconsulting.com/services/microsoft-365",
          "serviceType": "Microsoft 365 Consulting",
          "areaServed": {
            "@type": "Country",
            "name": "United States"
          },
          "audience": {
            "@type": "Audience",
            "audienceType": "Enterprise IT teams and organizations underutilizing their Microsoft 365 investment"
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
              "name": "M365 Health Check",
              "price": "497",
              "priceCurrency": "USD",
              "url": "https://shanemccawconsulting.com/micro-offers"
            }
          ]
        }}
      />
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="flex items-center gap-3 mb-6">
            <Cloud className="w-10 h-10 text-[#0078D4]" />
          </div>
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Service</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft 365 Setup & Optimization — Built Right, From the Start
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl">
            Most organizations use less than 30% of their M365 investment. Shane will assess what you have, fix what's broken, and architect what's missing.
          </p>
        </div>
      </section>

      {/* Pain Points */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Sound Familiar?</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] mb-8">Common Microsoft 365 Problems</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { title: "Misconfigured from day one", desc: "Your M365 tenant was set up by someone who's no longer there, or by a generalist IT person who learned as they went. The result is a fragile environment that works — until it doesn't." },
              { title: "Features you're paying for but not using", desc: "You're paying for Teams, SharePoint, OneDrive, Planner, Viva, and more — and using maybe three of them. The rest are underutilized or misconfigured." },
              { title: "Security that keeps you up at night", desc: "Too many admins with too much access. Guest sharing set too broadly. No DLP policies. No MFA enforced. You know it's a problem but don't know where to start." },
            ].map((item, i) => (
              <div key={i} className="bg-white border border-border rounded-lg p-6" data-testid={`pain-point-${i}`}>
                <AlertCircle className="w-6 h-6 text-[#0078D4] mb-3" />
                <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's Included */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Scope</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-8">What's Included</h2>
              <ul className="space-y-4">
                {[
                  "Comprehensive tenant assessment across all M365 workloads",
                  "Security configuration review (admin roles, MFA, conditional access, guest sharing)",
                  "Teams and SharePoint architecture review",
                  "OneDrive and file collaboration assessment",
                  "Exchange Online configuration review",
                  "License utilization analysis with right-sizing recommendations",
                  "Prioritized optimization roadmap with effort/impact scoring",
                  "Hands-on implementation of prioritized improvements",
                  "Documentation of all changes and rationale",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`included-${i}`}>
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Outcomes</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-8">What You'll Walk Away With</h2>
              <div className="space-y-4">
                {[
                  { title: "A secure, well-governed tenant", desc: "Right permissions, right policies, right configuration — documented and defensible." },
                  { title: "Higher adoption and utilization", desc: "Employees using the tools they're already paying for, the way they were designed to be used." },
                  { title: "A clear roadmap forward", desc: "Prioritized next steps so you know exactly what to do, when, and why." },
                ].map((item, i) => (
                  <div key={i} className="bg-[#F7F9FC] rounded-lg p-5 border border-border" data-testid={`outcome-${i}`}>
                    <h4 className="font-bold text-[#0A2540] mb-1">{item.title}</h4>
                    <p className="text-muted-foreground text-sm">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Win Callout */}
      <section className="bg-[#F7F9FC] py-12">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-white border border-[#0078D4]/30 rounded-xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <p className="text-[#0078D4] font-bold text-sm uppercase tracking-wide mb-1">Quick Win</p>
              <h3 className="text-xl font-bold text-[#0A2540]">Start with the M365 Health Check — $497</h3>
              <p className="text-muted-foreground mt-1">A 90-minute audit + written report delivered in 2 business days. Perfect first step before a larger engagement.</p>
            </div>
            <Link href="/micro-offers" className="flex-shrink-0 inline-flex items-center gap-1 text-[#0078D4] font-semibold hover:underline whitespace-nowrap" data-testid="m365-micro-offers-link">
              View Package Details <ArrowRight className="w-4 h-4" />
            </Link>
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
                Start a monthly Microsoft 365 architecture retainer. Ongoing strategy calls, tenant health monitoring, and priority recommendations. Cancel any time.
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
                href="/crm/portal/onboarding/select?service=m365-consulting"
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
