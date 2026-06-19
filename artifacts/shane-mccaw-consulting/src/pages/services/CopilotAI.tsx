import { useEffect } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { Bot, CheckCircle, AlertCircle } from "lucide-react";

export default function CopilotAI() {
  useEffect(() => {
    document.title = "Microsoft Copilot AI Readiness & Deployment | Shane McCaw Consulting";
  }, []);

  return (
    <Layout>
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <Bot className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Service</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft Copilot AI Readiness & Deployment
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl">
            Copilot is powerful when deployed correctly. It's a liability when it isn't. Shane ensures your deployment is safe, effective, and adopted.
          </p>
        </div>
      </section>

      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Pain Points</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] mb-8">Does This Sound Like Your Organization?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { title: "Bought licenses nobody uses", desc: "You invested in Copilot licenses expecting transformation, but adoption is near zero. Users don't know how to use it or don't see the value." },
              { title: "Worried about data exposure", desc: "You've heard the horror stories — Copilot surfacing sensitive files to the wrong people. You need someone who can verify your environment is safe before you flip the switch." },
              { title: "Stalled by governance uncertainty", desc: "Legal, compliance, and IT can't agree on what's safe. The project has been 'on hold pending review' for months." },
              { title: "No adoption strategy", desc: "Even when Copilot is deployed, nobody is using it consistently. You need a change management and coaching plan, not just a technical rollout." },
            ].map((item, i) => (
              <div key={i} className="bg-white border border-border rounded-lg p-6" data-testid={`copilot-pain-${i}`}>
                <AlertCircle className="w-6 h-6 text-[#0078D4] mb-3" />
                <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Scope</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-8">What's Included</h2>
              <ul className="space-y-4">
                {[
                  "Copilot readiness assessment across all M365 workloads",
                  "Data governance audit — sensitivity labels, DLP, retention policies",
                  "SharePoint oversharing and permissions review",
                  "Licensing review and optimization",
                  "Remediation roadmap for identified gaps",
                  "Copilot configuration and deployment",
                  "Adoption coaching and user enablement plan",
                  "Custom Copilot prompt library for key roles",
                  "Governance policy documentation",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Outcomes</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-8">What You'll Achieve</h2>
              <div className="space-y-4">
                {[
                  { title: "Productivity gains from day one", desc: "Users who know how to use Copilot correctly see immediate productivity improvements in writing, research, meeting summarization, and analysis." },
                  { title: "Safe, secure deployment", desc: "No data exposure risk. Your sensitive information stays secure even as AI accesses it." },
                  { title: "High adoption rates", desc: "A structured adoption program means employees use Copilot consistently — not just the first week." },
                ].map((item, i) => (
                  <div key={i} className="bg-[#F7F9FC] rounded-lg p-5 border border-border" data-testid={`copilot-outcome-${i}`}>
                    <h4 className="font-bold text-[#0A2540] mb-1">{item.title}</h4>
                    <p className="text-muted-foreground text-sm">{item.desc}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-xl p-6">
                <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-wide mb-2">Quick Win Package</p>
                <h4 className="font-bold text-[#0A2540] mb-2">Copilot Readiness Assessment — $797</h4>
                <p className="text-muted-foreground text-sm">Full readiness review + deployment plan delivered in 5 business days.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">Get Your Copilot Readiness Assessment — $797</h2>
          <p className="text-white/70 max-w-xl mx-auto mb-10">Know exactly where your organization stands before deploying. Full review and deployment plan in 5 business days.</p>
          <CTAButton href="/book" className="px-10 py-4 text-base" data-testid="copilot-cta">
            Get Your Copilot Readiness Assessment
          </CTAButton>
        </div>
      </section>
    </Layout>
  );
}
