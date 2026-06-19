import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { Shield, CheckCircle } from "lucide-react";
import { ConsultationCTA } from "@/components/ConsultationCTA";

export default function Governance() {
  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Governance, Compliance & Security | Shane McCaw Consulting"
        description="Microsoft 365 governance, compliance, and security consulting by Shane McCaw. Frameworks that protect your data, pass audits, and hold up over time — built by NASA's M365 Architect."
        ogImage="/og-image-governance.png"
        ogUrl="https://shanemccawconsulting.com/services/governance"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Microsoft 365 Governance, Compliance & Security",
          "description": "Microsoft 365 governance, compliance, and security consulting by Shane McCaw. Frameworks that protect your data, pass audits, and hold up over time — built by NASA's M365 Architect.",
          "url": "https://shanemccawconsulting.com/services/governance",
          "serviceType": "Microsoft 365 Governance Consulting",
          "areaServed": {
            "@type": "Country",
            "name": "United States"
          },
          "audience": {
            "@type": "Audience",
            "audienceType": "Compliance teams and regulated-industry organizations in healthcare, finance, defense contracting, and federal government"
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
              "name": "M365 Security & Governance Audit",
              "price": "897",
              "priceCurrency": "USD",
              "url": "https://shanemccawconsulting.com/micro-offers"
            }
          ]
        }}
      />
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <Shield className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Service</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Governance, Compliance & Security
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl">
            For regulated industries and government contractors who can't afford to get this wrong. Shane brings NASA-grade governance discipline to your Microsoft 365 environment.
          </p>
        </div>
      </section>

      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
            {[
              { title: "Data Loss Prevention", desc: "Configure DLP policies that automatically detect and protect sensitive data — SSNs, financial information, health records, classified content." },
              { title: "Sensitivity Labels", desc: "Deploy Microsoft Purview sensitivity labels with automatic classification, encryption, and visual marking. Build the labeling taxonomy that matches your compliance requirements." },
              { title: "Retention Policies", desc: "Ensure records are retained as long as required and deleted when they shouldn't be kept. Court-defensible retention schedules built into the platform." },
              { title: "Microsoft Purview", desc: "Deploy and configure the full Purview compliance suite — eDiscovery, communication compliance, information barriers, and audit logging." },
              { title: "Conditional Access", desc: "Identity-based access policies that ensure only the right people, on the right devices, from the right locations can access your sensitive systems." },
              { title: "Permissions Audit", desc: "Comprehensive review of who has access to what. Identify and remediate overprivileged accounts, excessive guest access, and admin role sprawl." },
            ].map((item, i) => (
              <div key={i} className="bg-white border border-border rounded-lg p-6" data-testid={`governance-feature-${i}`}>
                <Shield className="w-6 h-6 text-[#0078D4] mb-3" />
                <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-border p-8 md:p-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
              <div>
                <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Who This Is For</p>
                <h2 className="text-2xl font-extrabold text-[#0A2540] mb-4">Regulated Industries & Government Contractors</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">If you operate in healthcare, financial services, legal, defense contracting, or government — or if you handle data that's regulated under HIPAA, CMMC, FedRAMP, SOX, GDPR, or CCPA — your Microsoft 365 governance posture matters more than you know.</p>
                <p className="text-muted-foreground leading-relaxed">Shane has worked in the most compliance-sensitive Microsoft 365 environment in existence: NASA. That experience translates directly to understanding what regulated organizations need — and what they're getting wrong.</p>
              </div>
              <div>
                <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Quick Win</p>
                <div className="bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-xl p-6 mb-4">
                  <h3 className="font-bold text-[#0A2540] mb-2">M365 Security & Governance Audit — $897</h3>
                  <p className="text-muted-foreground text-sm mb-4">Comprehensive review delivered in 5 business days. Full prioritized remediation report.</p>
                  <ul className="space-y-2">
                    {["DLP policy review", "Sensitivity label assessment", "Retention policy audit", "Admin role and permissions review", "Conditional access evaluation", "Purview compliance posture review"].map((item, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-foreground">
                        <CheckCircle className="w-4 h-4 text-[#0078D4]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ConsultationCTA />
    </Layout>
  );
}
