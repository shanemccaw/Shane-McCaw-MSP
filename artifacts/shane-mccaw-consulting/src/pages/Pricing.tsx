import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { CheckCircle, ChevronDown } from "lucide-react";

const quickWins = [
  { name: "M365 Health Check", price: "$497", turnaround: "2 business days" },
  { name: "Copilot Readiness Assessment", price: "$797", turnaround: "5 business days" },
  { name: "SharePoint Intranet Blueprint", price: "$997", turnaround: "7 business days" },
  { name: "Power Automate Quick Win", price: "$597", turnaround: "5–7 business days" },
  { name: "M365 Security & Governance Audit", price: "$897", turnaround: "5 business days" },
  { name: "Copilot Prompt Library Build", price: "$397", turnaround: "5 business days" },
];

const retainers = [
  {
    name: "Starter",
    price: "$1,500",
    period: "/month",
    hours: "10 hours",
    features: [
      "10 hours of consulting per month",
      "Email and chat support",
      "1 monthly strategy call (60 min)",
      "Standard response time (within 1 business day)",
      "Access to all service areas",
    ],
    highlight: false,
  },
  {
    name: "Growth",
    price: "$3,000",
    period: "/month",
    hours: "25 hours",
    features: [
      "25 hours of consulting per month",
      "Priority email and chat support",
      "2 monthly strategy calls (60 min each)",
      "Priority response time (within 4 hours)",
      "Access to all service areas",
      "Monthly written progress report",
    ],
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "$5,500",
    period: "/month",
    hours: "50 hours",
    features: [
      "50 hours of consulting per month",
      "Dedicated support channel",
      "Weekly strategy calls (60 min)",
      "Same-day emergency response",
      "Access to all service areas",
      "Monthly written progress report",
      "Custom technology roadmap",
      "Quarterly strategic review",
    ],
    highlight: false,
  },
];

const faqs = [
  {
    q: "How quickly can you start?",
    a: "For Quick Win packages, work typically begins within 3–5 business days of payment. For retainers and project work, we can usually start within 1–2 weeks of signing. If you have a urgent need, let me know on the discovery call.",
  },
  {
    q: "Do you work with small businesses or only enterprises?",
    a: "Both. While my NASA background gives me enterprise-grade expertise, many small and mid-market businesses have the same Microsoft 365 challenges at a smaller scale. I tailor my approach to your organization's size and complexity.",
  },
  {
    q: "Is everything done remotely?",
    a: "Yes, 100% remote. I'm based in Vero Beach, FL, and serve clients nationwide. Modern Microsoft 365 consulting is entirely remote-capable — screen sharing, Teams calls, and remote admin access are all we need.",
  },
  {
    q: "How are project-based engagements priced?",
    a: "Project pricing ranges from $2,500 to $25,000+ depending on scope and complexity. Pricing is always presented as a fixed-fee quote after our free discovery call — no hourly billing surprises, no scope creep without change orders.",
  },
  {
    q: "Can I upgrade or downgrade my retainer plan?",
    a: "Yes. Retainers can be adjusted with 30 days' notice. If your needs change month to month, we can also structure flexible arrangements — just discuss it on the discovery call.",
  },
  {
    q: "What Microsoft 365 licenses do my employees need for Copilot?",
    a: "Microsoft 365 Copilot requires an M365 E3 or E5 base license plus the Copilot add-on. However, license eligibility is only one part of readiness — data governance and permissions must be right first. That's exactly what the Copilot Readiness Assessment covers.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className="w-full text-left px-6 py-5 flex items-center justify-between font-semibold text-[#0A2540] hover:bg-[#F7F9FC] transition-colors"
        onClick={() => setOpen(!open)}
        data-testid="faq-toggle"
      >
        {q}
        <ChevronDown className={`w-5 h-5 text-[#0078D4] flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-6 pb-6 text-muted-foreground leading-relaxed border-t border-border pt-4">
          {a}
        </div>
      )}
    </div>
  );
}

export default function Pricing() {
  useEffect(() => {
    document.title = "Transparent Pricing — Microsoft 365 Consulting | Shane McCaw Consulting";
  }, []);

  return (
    <Layout>
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Pricing</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight">
            Transparent Pricing
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl leading-relaxed">
            No hidden fees, no hourly billing surprises. Every engagement is scoped upfront so you know exactly what you're investing before any work begins.
          </p>
        </div>
      </section>

      {/* Quick Wins */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="mb-10">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Fixed-Price Packages</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Quick Win Packages</h2>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-[#F7F9FC]">
                  <th className="px-6 py-4 font-semibold text-[#0A2540]">Package</th>
                  <th className="px-6 py-4 font-semibold text-[#0A2540]">Price</th>
                  <th className="px-6 py-4 font-semibold text-[#0A2540]">Turnaround</th>
                  <th className="px-6 py-4 font-semibold text-[#0A2540]"></th>
                </tr>
              </thead>
              <tbody>
                {quickWins.map((item, i) => (
                  <tr key={i} className="border-t border-border hover:bg-[#F7F9FC]/50 transition-colors" data-testid={`pricing-row-${i}`}>
                    <td className="px-6 py-4 font-medium text-foreground">{item.name}</td>
                    <td className="px-6 py-4 text-[#0078D4] font-bold">{item.price}</td>
                    <td className="px-6 py-4 text-muted-foreground">{item.turnaround}</td>
                    <td className="px-6 py-4">
                      <a href="/book" className="text-[#0078D4] text-sm font-semibold hover:underline">Get Started →</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Retainers */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Monthly Plans</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Ongoing Retainer Plans</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Consistent, predictable access to Shane's expertise every month. Cancel with 30 days' notice.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {retainers.map((plan, i) => (
              <div
                key={i}
                className={`rounded-xl p-8 border flex flex-col ${plan.highlight ? "bg-[#0A2540] border-[#0078D4] relative" : "bg-white border-border"}`}
                data-testid={`retainer-${i}`}
              >
                {plan.highlight && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#0078D4] text-white text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wide">Most Popular</div>
                )}
                <div className="mb-6">
                  <h3 className={`text-xl font-bold mb-1 ${plan.highlight ? "text-white" : "text-[#0A2540]"}`}>{plan.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold text-[#0078D4]">{plan.price}</span>
                    <span className={`text-sm ${plan.highlight ? "text-white/60" : "text-muted-foreground"}`}>{plan.period}</span>
                  </div>
                  <p className={`text-sm mt-2 ${plan.highlight ? "text-white/70" : "text-muted-foreground"}`}>{plan.hours} per month</p>
                </div>
                <ul className="space-y-3 flex-grow mb-8">
                  {plan.features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                      <span className={`text-sm ${plan.highlight ? "text-white/80" : "text-foreground"}`}>{f}</span>
                    </li>
                  ))}
                </ul>
                <CTAButton href="/book" className={`w-full justify-center text-sm ${plan.highlight ? "" : ""}`} data-testid={`retainer-cta-${i}`}>
                  Get Started
                </CTAButton>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Project Based */}
      <section className="bg-white py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-xl p-8">
            <h3 className="text-xl font-bold text-[#0A2540] mb-3">Project-Based Engagements</h3>
            <p className="text-foreground mb-2">
              For larger, scoped projects — tenant migrations, full intranet builds, governance overhauls — Shane works on a fixed-project basis.
            </p>
            <p className="text-muted-foreground">
              <strong className="text-[#0078D4]">Typical range: $2,500–$25,000+</strong>, scoped after a free discovery call. You'll receive a detailed proposal with fixed deliverables, timeline, and pricing before any commitment.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-extrabold text-[#0A2540]">Frequently Asked Questions</h2>
          </div>
          <div className="max-w-3xl mx-auto space-y-3">
            {faqs.map((item, i) => (
              <FAQItem key={i} {...item} />
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">Not sure which option is right for you?</h2>
          <p className="text-white/70 max-w-xl mx-auto mb-10">Book a free 30-minute call and Shane will recommend the right fit for your situation — no pressure, no pitch.</p>
          <CTAButton href="/book" className="px-10 py-4 text-base" data-testid="pricing-final-cta">
            Book a Free Discovery Call
          </CTAButton>
        </div>
      </section>
    </Layout>
  );
}
