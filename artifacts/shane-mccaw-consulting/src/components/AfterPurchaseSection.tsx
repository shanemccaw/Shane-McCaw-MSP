import { CheckCircle, ArrowRight } from "lucide-react";
import { Link } from "wouter";

const STEPS = [
  {
    number: "01",
    title: "You connect your Azure tenant",
    body: "After purchase you'll receive access to your private client portal. A short setup wizard walks you through creating a read-only Azure App Registration — the secure service identity that lets Shane's automation reach into your Microsoft 365 environment. You own this registration and can revoke it at any time.",
  },
  {
    number: "02",
    title: "Automation runs and collects findings",
    body: "Shane's PowerShell runbooks execute directly inside your tenant via Azure Automation. They read your licensing state, security configuration, Teams structure, SharePoint sites, governance policies, and compliance posture — and surface everything as structured data. No manual screen-shots, no questionnaire guesswork.",
  },
  {
    number: "03",
    title: "AI analyses the findings",
    body: "Claude (Anthropic's AI) reviews the collected data and scores your environment across security, governance, adoption, and Copilot readiness. It flags risk areas, ranks them by severity, and generates a plain-English summary of what it found and why it matters.",
  },
  {
    number: "04",
    title: "Your project appears in the portal",
    body: "A structured engagement project is automatically created in your client portal — complete with a phased task board, workflow steps, and milestones tied directly to what the assessment uncovered. You can see exactly where things stand at any point.",
  },
  {
    number: "05",
    title: "Shane reviews, refines, and prepares",
    body: "Shane reviews every AI output, adds years of practitioner context, catches anything that needs a human eye, and prepares the findings presentation. The AI accelerates the analysis; Shane validates and owns the recommendations.",
  },
  {
    number: "06",
    title: "Findings call — then a clear path forward",
    body: "You meet with Shane to walk through the results. You'll leave with a prioritised action plan, a plain-English explanation of every risk, and a concrete recommendation for the next step — whether that's a fixed-scope package, a retainer, or internal execution on your own.",
  },
];

export function AfterPurchaseSection({ serviceName }: { serviceName?: string }) {
  return (
    <section className="bg-[#F7F9FC] py-20">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="mb-12">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">What Happens Next</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] mb-4">
            What happens after you purchase{serviceName ? ` ${serviceName}` : ""}
          </h2>
          <p className="text-muted-foreground max-w-2xl leading-relaxed">
            The engagement doesn't start with a kickoff call and a blank questionnaire. It starts with live data from inside your environment — automatically collected, AI-scored, and ready to review within days.
          </p>
        </div>

        <div className="relative">
          {/* Vertical connector line */}
          <div className="hidden md:block absolute left-[28px] top-10 bottom-10 w-px bg-gradient-to-b from-[#0078D4]/40 via-[#00B4D8]/30 to-[#0078D4]/10" />

          <div className="space-y-6">
            {STEPS.map((step, i) => (
              <div key={i} className="flex gap-6 items-start">
                <div className="hidden md:flex flex-col items-center flex-shrink-0">
                  <div className="w-14 h-14 rounded-2xl bg-[#0A2540] flex items-center justify-center shadow-sm">
                    <span className="text-xs font-black text-[#0078D4] tracking-wider">{step.number}</span>
                  </div>
                </div>
                <div className="flex-1 bg-white border border-border rounded-2xl px-6 py-5">
                  <div className="flex items-start gap-3">
                    <div className="md:hidden w-8 h-8 rounded-xl bg-[#0A2540] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[9px] font-black text-[#0078D4]">{step.number}</span>
                    </div>
                    <div>
                      <h3 className="text-base font-extrabold text-[#0A2540] mb-2">{step.title}</h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">{step.body}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 bg-[#0A2540] rounded-2xl px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <p className="text-white font-extrabold text-lg mb-1">Want the full technical picture?</p>
            <p className="text-white/60 text-sm">See exactly how the automation works, what data is collected, and how AI scoring is calculated.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors whitespace-nowrap"
            >
              How It Works <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/how-it-works/technical"
              className="inline-flex items-center gap-2 text-white/70 hover:text-white text-sm font-medium px-5 py-2.5 rounded-xl border border-white/20 hover:border-white/40 transition-colors whitespace-nowrap"
            >
              Technical Overview
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
