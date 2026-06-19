import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { Server, CheckCircle, ArrowRight } from "lucide-react";
import { ConsultationCTA } from "@/components/ConsultationCTA";

const migrationSteps = [
  { step: "01", title: "Discovery", desc: "Inventory all source systems, data volumes, user counts, and dependencies. Identify risks before they become problems." },
  { step: "02", title: "Planning", desc: "Define the migration approach, sequencing, rollback plan, and communication strategy. Complete project plan with clear milestones." },
  { step: "03", title: "Pilot", desc: "Migrate a representative subset of users and data. Validate the process, identify edge cases, and confirm cutover readiness." },
  { step: "04", title: "Production Migration", desc: "Execute the full migration with Shane overseeing every step. Zero data loss. Minimal disruption to productivity." },
  { step: "05", title: "Post-Migration Support", desc: "30 days of dedicated support post-cutover. Address stragglers, clean up source systems, confirm everything is working." },
];

const riskChecklist = [
  "Shared mailboxes or distribution groups with complex permissions",
  "Legacy public folders or on-premises SharePoint content",
  "Custom email domains or hybrid Active Directory environments",
  "Large mailboxes (50GB+) or extensive SharePoint site collections",
  "Strict regulatory retention requirements on migrated data",
  "Employees in multiple time zones requiring coordinated cutover",
];

export default function CloudMigration() {
  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Cloud Migration Services | Shane McCaw Consulting"
        description="Microsoft 365 cloud migration consulting by Shane McCaw. Structured, low-risk migrations with zero-surprise timelines and a NASA-proven methodology that protects your data."
        ogImage="/og-image-cloud-migration.png"
        ogUrl="https://shanemccawconsulting.com/services/cloud-migration"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Microsoft 365 Cloud Migration Services",
          "description": "Microsoft 365 cloud migration consulting by Shane McCaw. Structured, low-risk migrations with zero-surprise timelines and a NASA-proven methodology that protects your data.",
          "url": "https://shanemccawconsulting.com/services/cloud-migration",
          "serviceType": "Cloud Migration Consulting",
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
          <Server className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Service</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Cloud Migration Services
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl">
            Exchange, SharePoint, M365, and Google Workspace migrations executed with zero-drama precision. Shane has migrated organizations of every size — safely, efficiently, and without data loss.
          </p>
        </div>
      </section>

      {/* Migration Types */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Supported Migrations</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] mb-8">What We Migrate</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
            {[
              { title: "Exchange → Exchange Online", desc: "On-premises Exchange to Microsoft 365, including hybrid coexistence configurations." },
              { title: "SharePoint → SharePoint Online", desc: "On-premises SharePoint to SharePoint Online, preserving permissions, metadata, and content structure." },
              { title: "Google Workspace → M365", desc: "Full migration from Google Workspace — Gmail, Drive, Calendar, Contacts — to the Microsoft 365 ecosystem." },
              { title: "M365 Tenant → Tenant", desc: "Business acquisitions, mergers, or tenant consolidations requiring one M365 tenant to migrate to another." },
            ].map((item, i) => (
              <div key={i} className="bg-white border border-border rounded-lg p-6" data-testid={`migration-type-${i}`}>
                <Server className="w-6 h-6 text-[#0078D4] mb-3" />
                <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Migration Steps */}
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Process</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] mb-8">The Migration Process</h2>
          <div className="space-y-4">
            {migrationSteps.map((item, i) => (
              <div key={i} className="bg-white border border-border rounded-lg p-6 flex items-start gap-6" data-testid={`migration-step-${i}`}>
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[#0078D4]/10 border-2 border-[#0078D4] flex items-center justify-center">
                  <span className="text-[#0078D4] font-extrabold text-sm">{item.step}</span>
                </div>
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-1">{item.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
                {i < migrationSteps.length - 1 && <ArrowRight className="w-5 h-5 text-[#0078D4]/40 flex-shrink-0 mt-3 hidden md:block" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Risk Checklist */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Self-Assessment</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-4">Migration Risk Factors</h2>
              <p className="text-muted-foreground leading-relaxed mb-8">If any of these apply to your environment, your migration requires careful planning. They're not blockers — but they're factors that need to be addressed before you move a single mailbox.</p>
              <div className="space-y-3">
                {riskChecklist.map((item, i) => (
                  <div key={i} className="flex items-start gap-3 bg-[#F7F9FC] border border-border rounded-lg p-4" data-testid={`risk-item-${i}`}>
                    <div className="flex-shrink-0 w-5 h-5 rounded border-2 border-[#0078D4] mt-0.5" />
                    <span className="text-foreground text-sm">{item}</span>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground text-sm mt-6">If you checked 3 or more, book a discovery call before doing anything else.</p>
            </div>
            <div>
              <div className="bg-[#F7F9FC] rounded-xl border border-border p-8 mb-6">
                <h3 className="text-xl font-bold text-[#0A2540] mb-4">Why Migration Fails</h3>
                <ul className="space-y-3">
                  {[
                    "Skipping the discovery phase and underestimating complexity",
                    "No pilot migration to validate the process",
                    "Poor communication planning — users caught by surprise",
                    "No rollback plan when things don't go as expected",
                    "Ignoring post-migration support needs",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                      <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-xl p-6">
                <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-wide mb-2">Commitment</p>
                <h4 className="font-bold text-[#0A2540] mb-2">30-Day Post-Migration Support</h4>
                <p className="text-muted-foreground text-sm">Every migration engagement includes 30 days of dedicated post-migration support. Shane stays with you through the transition, not just the cutover.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ConsultationCTA />
    </Layout>
  );
}
