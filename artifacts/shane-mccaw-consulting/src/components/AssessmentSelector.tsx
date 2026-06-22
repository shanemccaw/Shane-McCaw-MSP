import { ArrowRight } from "lucide-react";

const ASSESSMENTS = [
  {
    title: "Copilot Readiness",
    description: "Find out if your tenant is ready to safely enable Copilot for Microsoft 365 — governance, data hygiene, identity, and licensing.",
    href: "/copilot-quiz",
    badge: "~5 min",
  },
  {
    title: "M365 Tenant Health",
    description: "Diagnose configuration drift, permission sprawl, and governance gaps across your entire Microsoft 365 tenant.",
    href: "/m365-health-quiz",
    badge: "~5 min",
  },
  {
    title: "SharePoint Readiness",
    description: "Assess your SharePoint architecture, governance maturity, and adoption — and get a prioritised improvement roadmap.",
    href: "/sharepoint-readiness-quiz",
    badge: "~5 min",
  },
  {
    title: "Governance Maturity",
    description: "Measure naming conventions, lifecycle policies, DLP, admin roles, and access controls against a structured maturity model.",
    href: "/governance-maturity-quiz",
    badge: "~5 min",
  },
  {
    title: "Migration Readiness",
    description: "Evaluate identity, data inventory, permissions, and compliance readiness before committing to a cloud migration.",
    href: "/migration-readiness-quiz",
    badge: "~5 min",
  },
  {
    title: "Power Platform Readiness",
    description: "Gauge your governance framework, CoE maturity, and risk exposure before scaling Power Automate and Power Apps.",
    href: "/power-platform-quiz",
    badge: "~5 min",
  },
  {
    title: "Security & Compliance",
    description: "Audit your M365 security posture — Conditional Access, MFA coverage, sensitivity labels, and compliance gaps.",
    href: "/security-compliance-quiz",
    badge: "~5 min",
  },
  {
    title: "Teams Maturity",
    description: "Evaluate Teams governance, channel sprawl, guest access policies, and adoption maturity across your organisation.",
    href: "/teams-maturity-quiz",
    badge: "~5 min",
  },
];

export function AssessmentSelector() {
  return (
    <section className="bg-[#0A2540] py-20">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="text-center mb-12">
          <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.12em] mb-4">
            Free Assessments
          </p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white leading-tight mb-4">
            Not Sure Where You Stand? Pick Your Assessment.
          </h2>
          <p className="text-white/60 text-lg max-w-2xl mx-auto leading-relaxed">
            Each assessment takes around 5 minutes and delivers a personalised score with a prioritised action plan — no account required, no sales follow-up.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ASSESSMENTS.map((a) => (
            <a
              key={a.href}
              href={a.href}
              className="group flex flex-col bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/10 hover:border-[#00B4D8]/40 transition-all duration-200"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#00B4D8] bg-[#00B4D8]/10 border border-[#00B4D8]/20 rounded-full px-2.5 py-1">
                  {a.badge}
                </span>
                <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-[#00B4D8] group-hover:translate-x-0.5 transition-all flex-shrink-0" />
              </div>
              <h3 className="text-white font-bold text-base leading-snug mb-2">{a.title}</h3>
              <p className="text-white/55 text-sm leading-relaxed flex-1">{a.description}</p>
              <p className="mt-4 text-[#00B4D8] text-sm font-semibold group-hover:underline">
                Take the assessment →
              </p>
            </a>
          ))}
        </div>

        <p className="text-center text-white/30 text-sm mt-8">
          All assessments are free · PDF report delivered instantly · No account required
        </p>
      </div>
    </section>
  );
}
