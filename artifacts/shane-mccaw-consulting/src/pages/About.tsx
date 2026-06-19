import { useEffect } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { CheckCircle, Award, Star } from "lucide-react";

const timeline = [
  { years: "1994–2010", role: "Lead Software Developer & Architect", org: "Microsoft", desc: "16+ years building and architecting solutions within the Microsoft ecosystem. Deep expertise in Office platforms, enterprise software, and cloud infrastructure." },
  { years: "2010–2016", role: "Founder & Principal Architect", org: "McCawSoft", desc: "Founded McCawSoft to deliver enterprise Microsoft consulting. Built a practice around SharePoint, Office 365, and custom development for mid-market and enterprise clients." },
  { years: "2016–2018", role: "Director of Technologies", org: "Planet Technologies", desc: "Led technology practice for a leading Microsoft Gold Partner. Oversaw architecture, delivery, and team development across major enterprise engagements." },
  { years: "2018–Present", role: "Lead Microsoft 365 Architect", org: "NASA", desc: "Currently serving as the lead M365 architect for one of the most security-sensitive, mission-critical environments in the world. Responsible for governance, compliance, Copilot deployment, and platform strategy." },
];

const competencies = [
  "Microsoft 365", "Microsoft Teams", "SharePoint Online", "OneDrive for Business",
  "Exchange Online", "Entra ID (Azure AD)", "Microsoft Copilot AI", "Power Platform",
  "Power Automate", "Power Apps", "Dataverse", "Microsoft Purview",
  "DLP Policies", "Sensitivity Labels", "Retention Policies", "Conditional Access",
  "Cloud Migrations", "Information Architecture", "Governance Frameworks", "Enterprise Architecture",
];

const philosophy = [
  "Every engagement is handled personally by Shane — no project managers, no offshore handoffs.",
  "Recommendations are based on your specific environment, not templated playbooks.",
  "Governance is built in from day one, not retrofitted after problems emerge.",
  "Documentation and knowledge transfer are non-negotiable deliverables.",
  "The goal is your independence and long-term capability, not ongoing dependency.",
];

export default function About() {
  useEffect(() => {
    document.title = "About Shane McCaw | 30 Years Microsoft Expertise | Shane McCaw Consulting";
  }, []);

  return (
    <Layout>
      {/* Hero */}
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">About Shane</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            30 Years in the Microsoft Ecosystem. Currently Architecting for NASA. Here to Serve Your Business.
          </h1>
        </div>
      </section>

      {/* Narrative */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="max-w-3xl">
            <p className="text-lg text-foreground leading-relaxed mb-6">
              Shane McCaw's career in the Microsoft ecosystem began in 1994, when the internet was young and Office was still delivered on floppy disks. Over three decades, he's watched Microsoft evolve from a desktop software company into the world's dominant enterprise cloud platform — and he's been an architect of that transformation at every step. From writing code inside Microsoft itself to leading enterprise deployments for hundreds of organizations, Shane has seen this technology from every angle.
            </p>
            <p className="text-lg text-foreground leading-relaxed mb-6">
              After leaving Microsoft, Shane founded McCawSoft, a boutique consulting practice built on one conviction: enterprise Microsoft technology deserves enterprise-grade expertise. Not cookie-cutter implementations from a sales-led firm, but real architecture from someone who understands the platform at its core. McCawSoft served clients across industries — healthcare, financial services, government, manufacturing — helping them get Microsoft 365 working the way it was designed to work.
            </p>
            <p className="text-lg text-foreground leading-relaxed">
              Today, Shane serves as Lead Microsoft 365 Architect at NASA — one of the most demanding and security-sensitive IT environments in existence. He also consults directly with businesses and organizations that need the same quality of thinking applied to their Microsoft 365 investment. When you work with Shane McCaw Consulting, you get the mind behind NASA's M365 platform working on your problems.
            </p>
          </div>
        </div>
      </section>

      {/* NASA Section */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">The NASA Advantage</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">What Working at NASA Means for Your Business</h2>
              <p className="text-foreground leading-relaxed mb-6">
                NASA doesn't tolerate misconfiguration. A poorly governed SharePoint environment isn't a minor inconvenience — it's a potential national security issue. Working in this environment for 6+ years has fundamentally shaped how Shane approaches every engagement.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { title: "Security-First Thinking", desc: "Every architecture decision begins with the question: what could go wrong, and how do we prevent it?" },
                { title: "Governance Discipline", desc: "Policies, retention, permissions, and compliance aren't afterthoughts. They're the foundation." },
                { title: "Mission-Critical Delivery", desc: "NASA doesn't ship broken code. Shane brings that standard of precision to every client project." },
                { title: "Compliance Literacy", desc: "Deep familiarity with federal compliance standards translates directly to regulated industries and government contractors." },
              ].map((item, i) => (
                <div key={i} className="bg-white p-6 rounded-lg border border-border" data-testid={`nasa-benefit-${i}`}>
                  <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
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
            <div className="absolute left-8 top-0 bottom-0 w-px bg-border hidden md:block" />
            <div className="space-y-8">
              {timeline.map((item, i) => (
                <div key={i} className="relative md:pl-20" data-testid={`timeline-item-${i}`}>
                  <div className="hidden md:flex absolute left-4 top-6 w-8 h-8 rounded-full bg-[#0078D4] items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-white" />
                  </div>
                  <div className="bg-[#F7F9FC] rounded-lg p-6 border border-border">
                    <p className="text-[#0078D4] text-sm font-semibold mb-1">{item.years}</p>
                    <h3 className="text-xl font-bold text-[#0A2540] mb-1">{item.role}</h3>
                    <p className="text-[#00B4D8] font-semibold text-sm mb-3">{item.org}</p>
                    <p className="text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Award Callout */}
      <section className="bg-[#F7F9FC] py-10">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-xl p-8 flex items-start gap-6">
            <div className="flex-shrink-0 w-14 h-14 rounded-full bg-[#0078D4] flex items-center justify-center">
              <Award className="w-7 h-7 text-white" />
            </div>
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-2">Recognition</p>
              <h3 className="text-xl font-bold text-[#0A2540] mb-2">Forum of Innovation Award Winner</h3>
              <p className="text-foreground leading-relaxed">Shane has been recognized with the Forum of Innovation Award for his contributions to enterprise technology and Microsoft ecosystem innovation — among 20+ Microsoft certifications earned over his career.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Philosophy */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Philosophy</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">Hands-On. Direct. No Shortcuts.</h2>
              <ul className="space-y-4">
                {philosophy.map((item, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`philosophy-item-${i}`}>
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <p className="text-foreground leading-relaxed">{item}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#F7F9FC] rounded-xl p-8 border border-border">
              <Star className="w-8 h-8 text-[#0078D4] mb-4" />
              <blockquote className="text-lg text-foreground italic leading-relaxed mb-6">
                "I got into this field because I love what Microsoft technology can do when it's properly architected and governed. Too many organizations are running M365 at 20% of its potential — not because the technology is limited, but because it was set up wrong or never optimized. That's what I fix."
              </blockquote>
              <p className="font-bold text-[#0A2540]">— Shane McCaw</p>
              <p className="text-muted-foreground text-sm">Lead M365 Architect at NASA | Founder, McCawSoft</p>
            </div>
          </div>
        </div>
      </section>

      {/* Competencies */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-10">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Expertise</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">Core Competencies</h2>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {competencies.map((comp, i) => (
              <span key={i} className="bg-white border border-border text-foreground px-4 py-2 rounded-full text-sm font-medium hover:border-[#0078D4] hover:text-[#0078D4] transition-colors" data-testid={`competency-${i}`}>
                {comp}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Let's Work Together</h2>
          <p className="text-white/70 max-w-xl mx-auto mb-10">Book a free 30-minute discovery call. Let's talk about what's possible for your Microsoft 365 environment.</p>
          <CTAButton href="/book" className="px-10 py-4 text-base" data-testid="about-cta-button">
            Book Your Free Discovery Call
          </CTAButton>
        </div>
      </section>
    </Layout>
  );
}
