import { useState } from "react";
import { Link } from "wouter";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { Download, ArrowRight } from "lucide-react";
import { FaLinkedin, FaXTwitter } from "react-icons/fa6";
import { articles } from "@/data/articles";

const categories = ["All", "Copilot AI Tips", "M365 Best Practices", "Power Platform How-Tos", "Governance & Compliance", "Digital Transformation"];

export default function Resources() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [leadMagnetEmail, setLeadMagnetEmail] = useState("");
  const [leadMagnetName, setLeadMagnetName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const filtered = activeCategory === "All" ? articles : articles.filter(p => p.category === activeCategory);

  const handleLeadMagnet = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 & Copilot AI Insights | Shane McCaw Consulting"
        description="Microsoft 365 and Copilot AI insights, guides, and articles by Shane McCaw — NASA's Lead M365 Architect. Practical, experience-backed advice for IT leaders and Microsoft admins."
      />
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
                    <div className="flex items-center gap-3">
                      <p className="text-muted-foreground text-xs">{post.date}</p>
                      <span className="text-muted-foreground text-xs">·</span>
                      <p className="text-muted-foreground text-xs">{post.readingTime}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <a
                        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${window.location.origin}/resources/${post.slug}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Share "${post.title}" on LinkedIn`}
                        className="text-muted-foreground hover:text-[#0A66C2] transition-colors"
                        data-testid={`share-linkedin-${i}`}
                        onClick={e => e.stopPropagation()}
                      >
                        <FaLinkedin className="w-4 h-4" />
                      </a>
                      <a
                        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}&url=${encodeURIComponent(`${window.location.origin}/resources/${post.slug}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Share "${post.title}" on X`}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        data-testid={`share-x-${i}`}
                        onClick={e => e.stopPropagation()}
                      >
                        <FaXTwitter className="w-4 h-4" />
                      </a>
                      <Link
                        href={`/resources/${post.slug}`}
                        className="text-[#0078D4] text-sm font-semibold hover:underline flex items-center gap-1"
                        data-testid={`read-more-${i}`}
                      >
                        Read More <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <ConsultationCTA />
    </Layout>
  );
}
