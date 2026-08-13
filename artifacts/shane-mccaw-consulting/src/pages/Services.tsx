import { Link } from "wouter";
import { ArrowRight, Shield, GraduationCap, Layout as LayoutIcon, Zap, ShieldCheck, Server, Lock, Bot } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";

const SERVICES = [
  {
    slug: "microsoft-365",
    title: "Microsoft 365 Architecture",
    subhead: "Fix tenant sprawl, close identity gaps, and build a governed, compliant M365 environment.",
    icon: Shield,
  },
  {
    slug: "copilot-ai",
    title: "Copilot & AI",
    subhead: "A governance-first readiness assessment before Copilot surfaces oversharing you didn't know you had.",
    icon: Bot,
  },
  {
    slug: "security-hardening",
    title: "Security Hardening",
    subhead: "Find and close the misconfigurations most responsible for cloud breaches — before an attacker does.",
    icon: Lock,
  },
  {
    slug: "governance",
    title: "Governance & Compliance",
    subhead: "DLP, sensitivity labeling, retention, and a compliance framework built for regulated industries.",
    icon: ShieldCheck,
  },
  {
    slug: "sharepoint",
    title: "SharePoint",
    subhead: "Information architecture, governance, and permissions built right before content ever moves.",
    icon: LayoutIcon,
  },
  {
    slug: "power-platform",
    title: "Power Platform",
    subhead: "Governed Power Apps and Power Automate flows that actually make it to production.",
    icon: Zap,
  },
  {
    slug: "cloud-migration",
    title: "Cloud Migration",
    subhead: "Exchange, SharePoint, Google Workspace, and tenant-to-tenant migrations with zero data loss.",
    icon: Server,
  },
  {
    slug: "m365-training",
    title: "Training & Enablement",
    subhead: "Live, instructor-led training so your team actually uses the tools you're paying for.",
    icon: GraduationCap,
  },
];

export default function Services() {
  return (
    <Layout>
      <SEOMeta
        title="Services | Shane McCaw Consulting"
        description="Microsoft 365 architecture, Copilot readiness, security hardening, governance, SharePoint, Power Platform, cloud migration, and training — delivered by NASA's former Lead M365 Architect."
      />

      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-secondary mb-4">Services</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Eight domains. <GradientText>One architect.</GradientText>
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed">
            NASA-grade discipline applied to every corner of your Microsoft 365 tenant — pick the domain closest to what's keeping you up at night, or start with a free assessment to find out.
          </p>
        </div>
      </section>

      <section className="pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {SERVICES.map((service) => {
            const Icon = service.icon;
            return (
              <Link key={service.slug} href={`/services/${service.slug}`} data-track="nav">
                <GlassPanel className="p-6 h-full flex flex-col hover:bg-white/[0.09] transition-colors group">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h2 className="font-display font-semibold text-text-primary mb-2">
                    {service.title}
                  </h2>
                  <p className="text-sm text-text-secondary leading-relaxed flex-grow mb-4">
                    {service.subhead}
                  </p>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-accent-blue group-hover:gap-2.5 transition-all">
                    Explore <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </GlassPanel>
              </Link>
            );
          })}
        </div>
      </section>
    </Layout>
  );
}
