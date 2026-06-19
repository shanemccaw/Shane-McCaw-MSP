import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { Download, BookOpen, ArrowRight } from "lucide-react";

const categories = ["All", "Copilot AI Tips", "M365 Best Practices", "Power Platform How-Tos", "Governance & Compliance", "Digital Transformation"];

const posts = [
  {
    category: "Copilot AI Tips",
    title: "5 Reasons Your Copilot Rollout Is Failing (And How to Fix It)",
    summary: "Most Copilot deployments underperform not because of the AI, but because of data governance gaps and lack of adoption strategy. Here are the five most common failure points and exactly how to address each one.",
    date: "June 5, 2025",
  },
  {
    category: "M365 Best Practices",
    title: "The M365 Tenant Health Check: What We Look For at NASA Scale",
    summary: "After years of managing Microsoft 365 for one of the world's most security-sensitive organizations, I've developed a systematic audit methodology. This is what we check — and why each item matters.",
    date: "May 22, 2025",
  },
  {
    category: "M365 Best Practices",
    title: "SharePoint Intranet Architecture: The Blueprint That Actually Works",
    summary: "Most SharePoint intranets fail because they were built without a coherent information architecture. Here's the planning framework I use for every modern intranet engagement — from hub structure to taxonomy design.",
    date: "May 8, 2025",
  },
  {
    category: "Power Platform How-Tos",
    title: "Power Automate Approval Workflows: Build Once, Scale Forever",
    summary: "Approval workflows are one of the highest-ROI automations in Power Automate. Learn the design patterns that keep workflows maintainable as your organization's processes evolve.",
    date: "April 24, 2025",
  },
  {
    category: "Governance & Compliance",
    title: "DLP and Sensitivity Labels: The Governance Stack Every Organization Needs",
    summary: "Data loss prevention and sensitivity labeling are the foundation of a secure Microsoft 365 environment — especially with Copilot in the picture. Here's how to build and govern them correctly.",
    date: "April 10, 2025",
  },
  {
    category: "Digital Transformation",
    title: "Microsoft 365 Migration Checklist: 30 Things to Do Before You Move",
    summary: "M365 migrations fail when teams skip the discovery and planning phase. This checklist covers every critical item — from license mapping to identity readiness — that you should verify before migrating a single mailbox.",
    date: "March 27, 2025",
  },
];

export default function Resources() {
  useEffect(() => {
    document.title = "Microsoft 365 & Copilot AI Insights | Shane McCaw Consulting";
  }, []);

  const [activeCategory, setActiveCategory] = useState("All");
  const [leadMagnetEmail, setLeadMagnetEmail] = useState("");
  const [leadMagnetName, setLeadMagnetName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const filtered = activeCategory === "All" ? posts : posts.filter(p => p.category === activeCategory);

  const handleLeadMagnet = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <Layout>
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Resources</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft 365 & Copilot AI Insights — From the Desk of a NASA Architect
          </h1>
        </div>
      </section>

      {/* Lead Magnet */}
      <section className="bg-[#F7F9FC] py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-white rounded-xl border border-[#0078D4]/30 p-8 md:p-10 flex flex-col md:flex-row gap-8 items-center">
            <div className="flex-shrink-0 w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center">
              <Download className="w-8 h-8 text-[#0078D4]" />
            </div>
            <div className="flex-grow">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-2">Free Download</p>
              <h2 className="text-2xl font-extrabold text-[#0A2540] mb-2">The M365 Copilot Readiness Checklist</h2>
              <p className="text-muted-foreground mb-6">20 points to know before you deploy. Know exactly where your organization stands before investing in Copilot licenses.</p>
              {!submitted ? (
                <form onSubmit={handleLeadMagnet} className="flex flex-col sm:flex-row gap-3" data-testid="lead-magnet-form">
                  <input
                    type="text"
                    placeholder="First name"
                    value={leadMagnetName}
                    onChange={e => setLeadMagnetName(e.target.value)}
                    required
                    className="flex-1 border border-border rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                    data-testid="lead-magnet-name"
                  />
                  <input
                    type="email"
                    placeholder="Work email"
                    value={leadMagnetEmail}
                    onChange={e => setLeadMagnetEmail(e.target.value)}
                    required
                    className="flex-1 border border-border rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                    data-testid="lead-magnet-email"
                  />
                  <CTAButton type="submit" className="text-sm whitespace-nowrap" data-testid="lead-magnet-submit">
                    Download Free Checklist
                  </CTAButton>
                </form>
              ) : (
                <div className="bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-lg px-6 py-4 text-[#0A2540] font-medium" data-testid="lead-magnet-success">
                  Thanks, {leadMagnetName}! Your checklist is on its way to {leadMagnetEmail}.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Blog */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          {/* Category Filter */}
          <div className="flex flex-wrap gap-2 mb-12" data-testid="category-filter">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  activeCategory === cat
                    ? "bg-[#0078D4] text-white"
                    : "bg-[#F7F9FC] text-foreground hover:bg-[#0078D4]/10 hover:text-[#0078D4]"
                }`}
                data-testid={`category-${cat.replace(/\s+/g, "-").toLowerCase()}`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Posts Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((post, i) => (
              <article
                key={i}
                className="bg-[#F7F9FC] rounded-xl border border-border overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
                data-testid={`blog-post-${i}`}
              >
                <div className="p-6">
                  <span className="inline-block bg-[#0078D4]/10 text-[#0078D4] text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide mb-4">
                    {post.category}
                  </span>
                  <h3 className="text-lg font-bold text-[#0A2540] mb-3 leading-snug">{post.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-6">{post.summary}</p>
                  <div className="flex items-center justify-between">
                    <p className="text-muted-foreground text-xs">{post.date}</p>
                    <button className="text-[#0078D4] text-sm font-semibold hover:underline flex items-center gap-1" data-testid={`read-more-${i}`}>
                      Read More <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <BookOpen className="w-12 h-12 text-[#0078D4] mx-auto mb-4" />
          <h2 className="text-3xl font-extrabold text-white mb-4">Ready to go from insight to action?</h2>
          <p className="text-white/70 max-w-xl mx-auto mb-10">Book a free discovery call and let's talk about what your Microsoft 365 environment actually needs.</p>
          <CTAButton href="/book" className="px-10 py-4 text-base" data-testid="resources-final-cta">
            Book Your Free Discovery Call
          </CTAButton>
        </div>
      </section>
    </Layout>
  );
}
