import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { ArrowRight, Clock, ClipboardCheck, FileText } from "lucide-react";

const ASSESSMENTS = [
  {
    name: "Copilot Readiness",
    description:
      "Find out if your Microsoft 365 tenant is prepared for Copilot deployment — identity hygiene, data labeling, and licensing gaps included.",
    href: "/copilot-quiz",
    icon: "🤖",
  },
  {
    name: "M365 Tenant Health",
    description:
      "Score your tenant's security posture, admin role hygiene, DLP coverage, and conditional access policies against Microsoft best practices.",
    href: "/m365-health-quiz",
    icon: "🏥",
  },
  {
    name: "SharePoint Readiness",
    description:
      "Evaluate your SharePoint architecture for governance gaps, oversharing risks, and migration readiness before your next project.",
    href: "/sharepoint-readiness-quiz",
    icon: "📁",
  },
  {
    name: "Governance Maturity",
    description:
      "Benchmark your Microsoft 365 governance program — policies, lifecycle management, guest access controls, and compliance posture.",
    href: "/governance-maturity-quiz",
    icon: "📋",
  },
  {
    name: "Migration Readiness",
    description:
      "Assess how prepared your environment is for a cloud or tenant-to-tenant migration — dependencies, blockers, and risk factors.",
    href: "/migration-readiness-quiz",
    icon: "🚀",
  },
  {
    name: "Power Platform Readiness",
    description:
      "Gauge your organization's readiness to scale Power Apps and Power Automate safely — governance, connectors, and environment strategy.",
    href: "/power-platform-quiz",
    icon: "⚡",
  },
  {
    name: "Security & Compliance",
    description:
      "Identify gaps in your Microsoft 365 security stack — Defender, Purview, Entra ID, and your incident response readiness.",
    href: "/security-compliance-quiz",
    icon: "🔒",
  },
  {
    name: "Teams Maturity",
    description:
      "Measure how effectively your organization uses Microsoft Teams — governance, sprawl, adoption, and integration with the wider M365 stack.",
    href: "/teams-maturity-quiz",
    icon: "💬",
  },
];

export default function Assessments() {
  return (
    <Layout>
      <SEOMeta
        title="Free Microsoft 365 Assessments | Shane McCaw Consulting"
        description="Take a free self-service Microsoft 365 health assessment. 5 minutes. Instant PDF score report. No account or credit card required."
      />

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-28 pb-20 text-center px-6">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/15 border border-[#0078D4]/30 rounded-full px-4 py-1.5 mb-6">
            <ClipboardCheck className="w-4 h-4 text-[#00B4D8]" />
            <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">
              Free &amp; No Account Required
            </span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white leading-tight mb-5">
            Free Microsoft 365{" "}
            <span className="text-[#0078D4]">Health Assessments</span>
          </h1>
          <p className="text-lg text-white/65 max-w-2xl mx-auto leading-relaxed">
            Takes 5 minutes. Instant PDF score report. No credit card.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-6 mt-8 text-sm text-white/50">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-[#0078D4]" /> ~5 minutes each
            </span>
            <span className="flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-[#0078D4]" /> Instant PDF report
            </span>
            <span className="flex items-center gap-1.5">
              <ClipboardCheck className="w-4 h-4 text-[#0078D4]" /> No login needed
            </span>
          </div>
        </div>
      </section>

      {/* ── Assessment grid ───────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {ASSESSMENTS.map((a) => (
              <div
                key={a.href}
                className="group bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md hover:border-[#0078D4]/40 transition-all duration-200 flex flex-col p-6"
              >
                {/* Icon + badge row */}
                <div className="flex items-start justify-between mb-4">
                  <span className="text-3xl" role="img" aria-label={a.name}>
                    {a.icon}
                  </span>
                  <span className="inline-flex items-center gap-1 bg-[#0078D4]/8 text-[#0078D4] text-[11px] font-semibold px-2.5 py-1 rounded-full border border-[#0078D4]/20">
                    <Clock className="w-3 h-3" />
                    ~5 min
                  </span>
                </div>

                {/* Name */}
                <h2 className="text-base font-bold text-[#0A2540] mb-2 leading-snug">
                  {a.name}
                </h2>

                {/* Description */}
                <p className="text-sm text-gray-500 leading-relaxed flex-1 mb-5">
                  {a.description}
                </p>

                {/* CTA */}
                <Link
                  href={a.href}
                  className="inline-flex items-center justify-center gap-2 bg-[#0078D4] hover:bg-[#005A9E] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors group-hover:shadow-sm"
                >
                  Take Free Assessment
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-4">
            Ready for a deeper analysis?
          </h2>
          <p className="text-white/60 mb-8 text-base leading-relaxed">
            Our fixed-price Quick Win packages go beyond a score — they deliver
            a full audit, remediation plan, and hands-on implementation in a
            defined timeframe.
          </p>
          <Link
            href="/quick-wins"
            className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#005A9E] text-white font-semibold px-8 py-4 rounded-xl text-base transition-colors"
          >
            See our Quick Win packages
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>
    </Layout>
  );
}
