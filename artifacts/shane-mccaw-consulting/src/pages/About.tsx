import { useEffect } from "react";
import { Layout } from "@/components/Layout";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { CheckCircle, Award, Star, Briefcase, Shield, Bot } from "lucide-react";

const timeline = [
  {
    years: "1994 — 2010",
    role: "Software Developer & Architect",
    org: "Microsoft ecosystem",
    desc: "Shane's career started when Microsoft was still figuring out what the internet meant for enterprise software. He spent the early years writing production code, building architecture for enterprise clients, and developing a deep intuition for the way Microsoft platforms actually work under the hood — not just how they're documented to work.",
  },
  {
    years: "2010 — 2016",
    role: "Founder & Principal Architect",
    org: "McCawSoft",
    desc: "Shane founded McCawSoft to build the kind of Microsoft consulting practice that didn't exist at the time: one where a senior architect with real platform knowledge handled engagements personally. McCawSoft served clients across healthcare, financial services, and the public sector — building SharePoint environments, Office 365 migrations, and governance frameworks that actually held up over time.",
  },
  {
    years: "2016 — 2018",
    role: "Director of Technologies",
    org: "Planet Technologies",
    desc: "As Director of Technologies at one of Microsoft's leading Gold Partners, Shane oversaw architecture and delivery across large enterprise engagements. This role sharpened his ability to structure complex, multi-workload M365 deployments at scale — and reinforced his conviction that governance and architecture must be designed together, not bolted on afterward.",
  },
  {
    years: "2018 — Present",
    role: "Lead Microsoft 365 Architect & Copilot SME",
    org: "NASA",
    desc: "Shane currently serves as Lead M365 Architect and Copilot for Microsoft 365 Subject Matter Expert at NASA. He is responsible for platform governance, compliance architecture, Copilot deployment strategy, and enterprise cloud modernization across one of the most security-sensitive M365 environments in the federal government. This is not a retired role. It is his primary day job.",
    isCurrent: true,
  },
];

const nasaPoints = [
  {
    title: "Security-first by default",
    desc: "At NASA, there is no acceptable error rate for misconfiguration. Every architecture decision starts with a failure-mode analysis — a discipline Shane applies to every client engagement.",
  },
  {
    title: "Governance before deployment",
    desc: "Federal compliance requirements mean governance frameworks aren't optional or retrofittable. They're foundational. Shane designs governance into the architecture from day one.",
  },
  {
    title: "Compliance at the highest tier",
    desc: "Operating in a FISMA High, FedRAMP-authorized M365 environment has given Shane familiarity with compliance standards that directly translates to regulated private-sector clients.",
  },
  {
    title: "Real Copilot deployment experience",
    desc: "Shane has navigated Copilot deployment in one of the most constrained M365 environments in existence — working through the actual governance, labeling, and rollout challenges that other consultants are still theorizing about.",
  },
];

const competencies = [
  "Microsoft 365 Architecture",
  "Microsoft Copilot for M365",
  "Copilot Governance & Readiness",
  "SharePoint Online",
  "Microsoft Teams",
  "OneDrive for Business",
  "Exchange Online",
  "Entra ID (Azure AD)",
  "Power Platform",
  "Power Automate",
  "Power Apps",
  "Microsoft Purview",
  "Sensitivity Labels",
  "DLP Policy Design",
  "Retention & Records Management",
  "Conditional Access",
  "Information Architecture",
  "Enterprise Governance Frameworks",
  "Cloud Migration Strategy",
  "M365 Tenant Health & Optimization",
];

const philosophy = [
  {
    title: "Every engagement is personal.",
    desc: "Shane handles his engagements directly. No project managers, no junior consultants, no offshore team. When you hire Shane McCaw Consulting, you get Shane.",
  },
  {
    title: "Governance is not a phase. It's a foundation.",
    desc: "Most M365 problems — oversharing, compliance gaps, Copilot risk — trace back to governance that was never properly designed. Shane builds it in from the start.",
  },
  {
    title: "The goal is your independence.",
    desc: "Shane's engagements are structured to leave organizations more capable, not more dependent. Documentation and knowledge transfer are non-negotiable deliverables.",
  },
  {
    title: "Recommendations are specific to your environment.",
    desc: "No templated playbooks. Shane's advice is based on a real assessment of your tenant, your data, and your organizational context.",
  },
];

export default function About() {
  useEffect(() => {
    document.title = "About Shane McCaw | NASA's M365 Architect & Copilot SME | Shane McCaw Consulting";
  }, []);

  return (
    <Layout>
      {/* Hero */}
      <section className="relative bg-[#0A2540] pt-32 pb-24 overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(#0078D4 1px, transparent 1px),
              linear-gradient(90deg, #0078D4 1px, transparent 1px)
            `,
            backgroundSize: "60px 60px",
          }}
        />
        <div
          className="absolute inset-0 opacity-10"
          style={{ background: "radial-gradient(ellipse 70% 60% at 20% 50%, #0078D4, transparent)" }}
        />
        <div className="relative z-10 max-w-[1200px] mx-auto px-6">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/15 border border-[#0078D4]/40 rounded-full px-5 py-2 mb-10">
            <span className="w-2 h-2 rounded-full bg-[#00B4D8] animate-pulse" />
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em]">
              About Shane McCaw
            </p>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-[3.25rem] font-extrabold text-white leading-[1.1] max-w-4xl mb-8">
            30 Years in the Microsoft Ecosystem. Currently NASA's Lead M365 Architect. Still Doing the Work.
          </h1>
          <p className="text-lg md:text-xl text-white/70 leading-relaxed max-w-3xl">
            Shane McCaw is not a former Microsoft executive turned consultant, or a generalist who took a few certifications. He is a working architect who has spent three decades inside this platform — and is actively doing at NASA today what he can do for your organization tomorrow.
          </p>
        </div>
      </section>

      {/* Narrative */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-16 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-6">Background</p>
              <div className="space-y-6 text-[1.0625rem] text-foreground leading-relaxed">
                <p>
                  Shane McCaw's career in the Microsoft ecosystem began in 1994. At the time, Office was still delivered on floppy disks, and the idea of enterprise software living in the cloud was science fiction. Over the three decades since, he has watched Microsoft evolve from a desktop software company into the dominant enterprise cloud platform — and he has been an architect of that transformation, not a spectator.
                </p>
                <p>
                  He started his career writing code. Not configuring platforms or presenting strategy decks — writing production software and building real architecture for real organizations. That foundation matters. It means Shane understands why the M365 platform behaves the way it does, not just how to navigate its admin portals. When a governance policy doesn't behave as expected or a Copilot deployment surfaces data it shouldn't, he knows where to look.
                </p>
                <p>
                  In 2010, Shane founded McCawSoft — a consulting practice built on the belief that enterprise Microsoft technology deserves genuine enterprise expertise. McCawSoft served clients across healthcare, financial services, manufacturing, and government: building SharePoint environments that didn't collapse under their own permissions sprawl, migrating organizations to Exchange Online without losing data, and designing governance frameworks that still hold up years later.
                </p>
                <p>
                  Today, Shane's primary role is Lead Microsoft 365 Architect and Copilot Subject Matter Expert at NASA. That is not a credential or a title from a past position. It is what he does every day — managing the governance, compliance, and platform architecture of one of the most security-constrained Microsoft 365 environments in the federal government. He consults on the side, which means every engagement benefits directly from what he is working on in production right now.
                </p>
              </div>
            </div>
            <div className="space-y-4 lg:pt-10">
              {[
                { icon: Briefcase, label: "Years in Microsoft ecosystem", value: "30+" },
                { icon: Shield, label: "Current role", value: "Lead M365 Architect, NASA" },
                { icon: Bot, label: "AI designation", value: "Copilot for M365 SME" },
                { icon: Award, label: "Microsoft certifications", value: "20+" },
                { icon: Star, label: "Recognition", value: "Forum of Innovation Award" },
              ].map((stat, i) => {
                const Icon = stat.icon;
                return (
                  <div key={i} className="flex items-center gap-5 bg-[#F7F9FC] rounded-xl p-5 border border-border" data-testid={`bio-stat-${i}`}>
                    <div className="w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-[#0078D4]" />
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">{stat.label}</p>
                      <p className="font-extrabold text-[#0A2540] text-base">{stat.value}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Quote */}
      <section className="bg-[#0A2540] py-16">
        <div className="max-w-[900px] mx-auto px-6 text-center">
          <Star className="w-8 h-8 text-[#0078D4] mx-auto mb-6" />
          <blockquote className="text-xl md:text-2xl text-white font-light leading-relaxed mb-6 italic">
            "I got into this field because I love what Microsoft technology can actually do when it's properly architected and governed. Too many organizations are running M365 at 20% of its capability — not because the platform is limited, but because it was stood up incorrectly and never fixed. That's the problem I spend my career solving."
          </blockquote>
          <p className="font-bold text-white text-base">Shane McCaw</p>
          <p className="text-white/50 text-sm mt-1">Lead M365 Architect & Copilot SME, NASA · Founder, McCawSoft</p>
        </div>
      </section>

      {/* NASA section */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">The NASA Advantage</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6 leading-tight">
                What Working at NASA Every Day Means for You
              </h2>
              <p className="text-foreground leading-relaxed mb-4">
                NASA's Microsoft 365 environment operates under constraints that most enterprise IT teams will never encounter — FISMA High compliance requirements, sensitive research data, multi-agency collaboration needs, and zero tolerance for misconfiguration.
              </p>
              <p className="text-foreground leading-relaxed mb-4">
                Working inside that environment since 2018 has fundamentally shaped how Shane thinks about architecture, governance, and deployment risk. He is not applying theoretical best practices. He is applying what he learned yesterday, in production, under real stakes.
              </p>
              <p className="text-foreground leading-relaxed">
                For your organization, that means access to a level of governance discipline and platform depth that even most large consulting firms cannot offer — delivered directly, without layers of overhead.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {nasaPoints.map((point, i) => (
                <div key={i} className="bg-white rounded-xl p-6 border border-border hover:border-[#0078D4]/30 hover:shadow-sm transition-all" data-testid={`nasa-point-${i}`}>
                  <h3 className="font-bold text-[#0A2540] mb-2 text-base">{point.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{point.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Career Timeline */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Career</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">30 Years. One Ecosystem.</h2>
          </div>
          <div className="relative">
            <div className="absolute left-8 top-4 bottom-4 w-px bg-border hidden md:block" />
            <div className="space-y-6">
              {timeline.map((item, i) => (
                <div key={i} className="relative md:pl-24" data-testid={`timeline-item-${i}`}>
                  <div className={`hidden md:flex absolute left-4 top-7 w-9 h-9 rounded-full items-center justify-center ${item.isCurrent ? "bg-[#0078D4]" : "bg-[#F7F9FC] border-2 border-[#0078D4]"}`}>
                    <div className={`w-3 h-3 rounded-full ${item.isCurrent ? "bg-white" : "bg-[#0078D4]"}`} />
                  </div>
                  <div className={`rounded-xl p-7 border ${item.isCurrent ? "bg-[#0A2540] border-[#0078D4]/40" : "bg-[#F7F9FC] border-border"}`}>
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                      <span className={`text-sm font-semibold ${item.isCurrent ? "text-[#00B4D8]" : "text-[#0078D4]"}`}>{item.years}</span>
                      {item.isCurrent && (
                        <span className="inline-flex items-center gap-1.5 bg-[#0078D4]/20 border border-[#0078D4]/30 rounded-full px-3 py-0.5 text-xs font-semibold text-[#00B4D8]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#00B4D8] animate-pulse" />
                          Current role
                        </span>
                      )}
                    </div>
                    <h3 className={`text-xl font-extrabold mb-1 ${item.isCurrent ? "text-white" : "text-[#0A2540]"}`}>{item.role}</h3>
                    <p className={`font-semibold text-sm mb-4 ${item.isCurrent ? "text-[#00B4D8]" : "text-[#0078D4]"}`}>{item.org}</p>
                    <p className={`leading-relaxed text-sm ${item.isCurrent ? "text-white/70" : "text-muted-foreground"}`}>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Award */}
      <section className="bg-[#F7F9FC] py-12">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-white rounded-xl border border-border p-8 flex items-start gap-6">
            <div className="flex-shrink-0 w-14 h-14 rounded-full bg-[#0078D4]/10 border border-[#0078D4]/20 flex items-center justify-center">
              <Award className="w-7 h-7 text-[#0078D4]" />
            </div>
            <div>
              <p className="text-[#0078D4] text-xs font-bold uppercase tracking-wider mb-2">Recognition</p>
              <h3 className="text-lg font-extrabold text-[#0A2540] mb-2">Forum of Innovation Award Winner · 20+ Microsoft Certifications</h3>
              <p className="text-muted-foreground leading-relaxed text-sm">
                Shane has been recognized with the Forum of Innovation Award for contributions to enterprise technology and Microsoft ecosystem innovation. He holds more than 20 Microsoft certifications — earned over decades of real-world practice, not exam preparation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Philosophy */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">How Shane Works</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-8 leading-tight">
                Hands-On. Direct. No Shortcuts.
              </h2>
              <div className="space-y-6">
                {philosophy.map((item, i) => (
                  <div key={i} className="flex items-start gap-4" data-testid={`philosophy-item-${i}`}>
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-[#0A2540] mb-1">{item.title}</p>
                      <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-[#F7F9FC] rounded-xl border border-border p-8">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-6">Who Works With Shane</p>
              <div className="space-y-5">
                {[
                  { label: "Mid-market organizations (100–5,000 seats)", desc: "Too large to wing their M365 setup, too lean to hire a full-time architect. Shane fills that gap." },
                  { label: "Government contractors", desc: "Compliance obligations that require someone who understands what FISMA, NIST, and FedRAMP actually mean in an M365 context." },
                  { label: "Regulated industries", desc: "Healthcare, financial services, and legal organizations with data governance and compliance requirements that demand precision." },
                  { label: "Organizations evaluating Copilot", desc: "Companies that want to deploy Copilot AI but need someone who has actually done it in a demanding environment first." },
                ].map((item, i) => (
                  <div key={i} className="border-l-2 border-[#0078D4]/30 pl-4" data-testid={`client-type-${i}`}>
                    <p className="font-semibold text-[#0A2540] text-sm mb-1">{item.label}</p>
                    <p className="text-muted-foreground text-xs leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Competencies */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-10">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Technical Expertise</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">Core Competencies</h2>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {competencies.map((comp, i) => (
              <span
                key={i}
                className="bg-white border border-border text-foreground px-4 py-2 rounded-full text-sm font-medium hover:border-[#0078D4] hover:text-[#0078D4] transition-colors cursor-default"
                data-testid={`competency-${i}`}
              >
                {comp}
              </span>
            ))}
          </div>
        </div>
      </section>

      <ConsultationCTA />
    </Layout>
  );
}
