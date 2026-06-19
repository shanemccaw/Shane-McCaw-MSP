import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { Zap, CheckCircle } from "lucide-react";
import { ConsultationCTA } from "@/components/ConsultationCTA";

export default function PowerPlatform() {
  return (
    <Layout>
      <SEOMeta
        title="Power Platform & Automation Consulting | Shane McCaw Consulting"
        description="Power Platform and automation consulting by Shane McCaw. Build governed, scalable Power Apps and Power Automate solutions that deliver ROI without governance nightmares."
        ogImage="/og-image-power-platform.png"
        ogUrl="https://shanemccawconsulting.com/services/power-platform"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Power Platform & Automation Consulting",
          "description": "Power Platform and automation consulting by Shane McCaw. Build governed, scalable Power Apps and Power Automate solutions that deliver ROI without governance nightmares.",
          "url": "https://shanemccawconsulting.com/services/power-platform",
          "serviceType": "Power Platform Consulting",
          "areaServed": {
            "@type": "Country",
            "name": "United States"
          },
          "audience": {
            "@type": "Audience",
            "audienceType": "IT departments and business operations teams seeking workflow automation with Power Platform"
          },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com"
          }
        }}
      />
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <Zap className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Service</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Power Platform & Automation
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl">
            Automate the processes your team spends hours on every week. Shane designs and builds Power Automate workflows and Power Apps that replace manual work at a fraction of custom development cost.
          </p>
        </div>
      </section>

      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            {[
              { title: "Approval Workflows", desc: "Purchase approvals, leave requests, contract reviews, expense submissions — all automated with audit trails and escalation logic built in." },
              { title: "Custom Power Apps", desc: "Purpose-built applications that replace spreadsheets, paper forms, and clunky legacy software. Mobile-friendly, SharePoint-connected, and built to scale." },
              { title: "Cross-System Integration", desc: "Connect M365 with Dynamics 365, Salesforce, ServiceNow, and other enterprise systems. Data flows automatically, without human handoffs." },
            ].map((item, i) => (
              <div key={i} className="bg-white border border-border rounded-lg p-6" data-testid={`power-feature-${i}`}>
                <Zap className="w-6 h-6 text-[#0078D4] mb-3" />
                <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Process</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-8">From Discovery to Delivery</h2>
              <ul className="space-y-4">
                {[
                  "Process discovery workshop to document the current state",
                  "Future-state process design with automation opportunities identified",
                  "Power Automate flow design and build",
                  "Power Apps development (if required)",
                  "Dataverse data model design (where needed)",
                  "Testing, error handling, and monitoring setup",
                  "User training and documentation",
                  "30-day post-delivery support",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white rounded-xl border border-border p-8">
              <h3 className="text-xl font-bold text-[#0A2540] mb-4">Quick Win: Power Automate Quick Win — $597</h3>
              <p className="text-muted-foreground leading-relaxed mb-6">Have one manual process that's ready to automate? Shane will build it in 5–7 business days. One flow, tested and documented, ready to use.</p>
              <div className="space-y-3 mb-6">
                {["Discovery call to document the process", "One complete Power Automate flow", "Error handling and monitoring", "Documentation and knowledge transfer", "30-day post-delivery email support"].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-foreground">
                    <CheckCircle className="w-4 h-4 text-[#0078D4]" />
                    {item}
                  </div>
                ))}
              </div>
              <CTAButton href="/book" className="w-full justify-center text-sm" data-testid="power-platform-quick-win-cta">
                Get Started — $597
              </CTAButton>
            </div>
          </div>
        </div>
      </section>

      <ConsultationCTA />
    </Layout>
  );
}
