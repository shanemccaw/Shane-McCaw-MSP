import { useState, useEffect } from "react";
import { Link } from "wouter";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { trackEvent } from "@/lib/analytics";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { Download, ArrowRight, Share2, Loader2, Shield, BookOpen, ClipboardCheck, MessageSquare, CheckCircle2 } from "lucide-react";
import { FaLinkedin, FaXTwitter } from "react-icons/fa6";
import { articles } from "@/data/articles";
import { pdf } from "@react-pdf/renderer";
import { CopilotReadinessPDF } from "@/lib/CopilotReadinessPDF";

const categories = ["All", "Copilot AI Tips", "M365 Best Practices", "Power Platform How-Tos", "Governance & Compliance", "Digital Transformation"];

export default function Resources() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [leadMagnetEmail, setLeadMagnetEmail] = useState("");
  const [leadMagnetName, setLeadMagnetName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [shareCounts, setShareCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/shares")
      .then(r => r.ok ? r.json() : null)
      .then((data: { counts: Record<string, { total: number }> } | null) => {
        if (!data?.counts) return;
        const totals: Record<string, number> = {};
        for (const [slug, v] of Object.entries(data.counts)) {
          totals[slug] = v.total;
        }
        setShareCounts(totals);
      })
      .catch(() => {});
  }, []);

  const filtered = activeCategory === "All" ? articles : articles.filter(p => p.category === activeCategory);

  const handleLeadMagnet = async (e: React.FormEvent) => {
    e.preventDefault();
    setPdfGenerating(true);
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: leadMagnetName,
          email: leadMagnetEmail,
          source: "lead_magnet",
        }),
      });
    } catch {
      // Continue regardless — don't block the UX on API failure
    }

    try {
      const blob = await pdf(<CopilotReadinessPDF />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "M365-Copilot-Readiness-Checklist-Shane-McCaw.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      void fetch("/api/downloads/checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset: "copilot-readiness" }),
      }).catch(() => {});

      trackEvent("checklist_downloaded", {
        event_category: "lead_magnet",
        event_label: "M365-Copilot-Readiness-Checklist",
      });
    } catch {
      // PDF generation failed silently — success state still shown
    }

    setPdfGenerating(false);
    setSubmitted(true);
  };

  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 & Copilot AI Insights | Shane McCaw Consulting"
        description="Microsoft 365 and Copilot AI insights, guides, and articles by Shane McCaw — NASA's Lead M365 Architect. Practical, experience-backed advice for IT leaders and Microsoft admins."
      />

      {/* Hero */}
      <section className="bg-[#0A2540] pt-[172px] pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Resources</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl mb-6">
            Microsoft 365 & Copilot AI Insights
          </h1>
          <p className="text-white/80 text-lg md:text-xl max-w-2xl leading-relaxed mb-4">
            Senior-level guidance on Copilot adoption, M365 governance, cloud migrations, and SharePoint architecture — written by a Lead M365 Architect with 30 years in the Microsoft ecosystem.
          </p>
          <p className="text-white/60 text-base max-w-2xl mb-6">
            Built for IT Directors, M365 Admins, and technology leaders in mid-market and regulated environments who need guidance they can trust — not content written for search engines.
          </p>
          <p className="text-[#00B4D8] text-sm font-semibold tracking-wide">
            Actionable. Real-world. No fluff.
          </p>
        </div>
      </section>

      {/* Why These Resources Exist */}
      <section className="bg-white py-16 border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-8">Why These Resources Exist</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#0078D4]/10 flex items-center justify-center mt-0.5">
                <CheckCircle2 className="w-5 h-5 text-[#0078D4]" />
              </div>
              <div>
                <h3 className="font-bold text-[#0A2540] mb-1">30 years of hands-on Microsoft experience</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Every article draws directly from Shane's career — not from certification prep material or recycled vendor documentation. These insights reflect decisions made and lessons learned across hundreds of real deployments.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#0078D4]/10 flex items-center justify-center mt-0.5">
                <CheckCircle2 className="w-5 h-5 text-[#0078D4]" />
              </div>
              <div>
                <h3 className="font-bold text-[#0A2540] mb-1">Tested under federal accountability at NASA</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  As Lead M365 Architect at NASA, Shane architects solutions where security, compliance, and reliability aren't optional. The frameworks and principles here are forged in one of the most demanding IT environments in the world.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#0078D4]/10 flex items-center justify-center mt-0.5">
                <CheckCircle2 className="w-5 h-5 text-[#0078D4]" />
              </div>
              <div>
                <h3 className="font-bold text-[#0A2540] mb-1">Written for mid-market and regulated-industry IT teams</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Enterprise-scale advice rarely translates cleanly to organizations with 200–2,000 seats. These resources are deliberately scoped for teams that face real compliance requirements, limited resources, and high-stakes Microsoft 365 decisions.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#0078D4]/10 flex items-center justify-center mt-0.5">
                <CheckCircle2 className="w-5 h-5 text-[#0078D4]" />
              </div>
              <div>
                <h3 className="font-bold text-[#0A2540] mb-1">Focused on the topics that move the needle</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Copilot readiness, governance frameworks, cloud migrations, security hardening, and SharePoint architecture — the areas where poor decisions are expensive and good ones compound. No filler, no buzzword-driven content.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Resource Library Overview */}
      <section className="bg-[#F7F9FC] py-16 border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-3">About This Resource Library</h2>
          <p className="text-muted-foreground max-w-3xl mb-10 leading-relaxed">
            This library is organized around the Microsoft 365 decisions that matter most to IT leaders in compliance-sensitive environments. Here's what you'll find and how to get the most from it.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            <div className="bg-white rounded-xl border border-border p-6">
              <div className="w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center mb-4">
                <BookOpen className="w-5 h-5 text-[#0078D4]" />
              </div>
              <h3 className="font-bold text-[#0A2540] mb-2">Articles & Guides</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Deep-dive articles covering Copilot AI adoption, M365 governance, SharePoint architecture, Power Platform best practices, cloud migrations, and digital transformation strategy. Mapped to the same service categories Shane delivers as a consultant.
              </p>
            </div>
            <div className="bg-white rounded-xl border border-border p-6">
              <div className="w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center mb-4">
                <ClipboardCheck className="w-5 h-5 text-[#0078D4]" />
              </div>
              <h3 className="font-bold text-[#0A2540] mb-2">Free Assessments</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                AI-powered quiz tools that benchmark your Microsoft 365 environment across eight domains — Copilot readiness, tenant health, SharePoint, Power Platform, security, Teams, migration, and governance. Each delivers a personalized PDF report.
              </p>
            </div>
            <div className="bg-white rounded-xl border border-border p-6">
              <div className="w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center mb-4">
                <Download className="w-5 h-5 text-[#0078D4]" />
              </div>
              <h3 className="font-bold text-[#0A2540] mb-2">Downloads & Checklists</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Practical tools you can use immediately — starting with the M365 Copilot Readiness Checklist. Each download is built around the frameworks Shane uses with consulting clients and applies at NASA.
              </p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-[#0078D4]/20 p-6 flex flex-col md:flex-row gap-6 items-start">
            <p className="text-sm font-semibold text-[#0078D4] uppercase tracking-widest md:whitespace-nowrap mt-0.5">How to use this library</p>
            <div className="flex flex-col sm:flex-row gap-4 flex-1">
              <div className="flex items-start gap-3 flex-1">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#0078D4] text-white text-xs font-bold flex items-center justify-center">1</span>
                <div>
                  <p className="font-semibold text-[#0A2540] text-sm">Learn</p>
                  <p className="text-muted-foreground text-sm">Read the articles relevant to your current challenge or roadmap initiative.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 flex-1">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#0078D4] text-white text-xs font-bold flex items-center justify-center">2</span>
                <div>
                  <p className="font-semibold text-[#0A2540] text-sm">Assess</p>
                  <p className="text-muted-foreground text-sm">Take the matching free assessment to benchmark where your environment actually stands.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 flex-1">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#0078D4] text-white text-xs font-bold flex items-center justify-center">3</span>
                <div>
                  <p className="font-semibold text-[#0A2540] text-sm">Engage</p>
                  <p className="text-muted-foreground text-sm">If your score reveals gaps that need senior guidance, book a consultation with Shane directly.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Start Here */}
      <section className="bg-white py-16 border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-3">Start Here</h2>
          <p className="text-muted-foreground max-w-2xl mb-10 leading-relaxed">
            Not sure where to begin? These five starting points cover the most common scenarios IT leaders bring to Shane. Each links to a recommended article and the matching assessment quiz.
          </p>
          <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
            {[
              {
                scenario: "We're evaluating Microsoft 365 Copilot",
                context: "Understand what tenant readiness actually means before purchasing licenses — security posture, data hygiene, identity, and change management all factor in.",
                articleLabel: "5 Reasons Your Copilot Rollout Is Failing",
                articleHref: "/resources/copilot-rollout-failing",
                quizLabel: "Copilot Readiness Assessment",
                quizHref: "/copilot-quiz",
              },
              {
                scenario: "Our M365 tenant has grown messy over the years",
                context: "Sprawling Teams, ungoverned SharePoint sites, stale guest accounts, and orphaned licenses are the norm — not the exception. Start with a health benchmark.",
                articleLabel: "The M365 Tenant Health Check",
                articleHref: "/resources/m365-tenant-health-check",
                quizLabel: "M365 Health Check",
                quizHref: "/m365-health-quiz",
              },
              {
                scenario: "We have an on-premises to cloud migration coming up",
                context: "Migration projects fail most often in planning, not execution. Source inventory, identity readiness, and stakeholder alignment are the variables that matter.",
                articleLabel: "M365 Migration Checklist: 30 Things to Do First",
                articleHref: "/resources/m365-migration-checklist",
                quizLabel: "Migration Readiness Assessment",
                quizHref: "/migration-quiz",
              },
              {
                scenario: "We need to tighten our governance and compliance posture",
                context: "DLP policies, sensitivity labels, retention schedules, and access governance need to work together as a framework — not as isolated configurations.",
                articleLabel: "DLP and Sensitivity Labels: The Governance Stack",
                articleHref: "/resources/dlp-sensitivity-labels",
                quizLabel: "Governance Maturity Assessment",
                quizHref: "/governance-quiz",
              },
              {
                scenario: "We want to modernize our SharePoint intranet",
                context: "A successful intranet is built on solid information architecture, clear ownership, and adoption-first design — not just a visual refresh.",
                articleLabel: "SharePoint Intranet Architecture: The Blueprint",
                articleHref: "/resources/sharepoint-intranet-architecture",
                quizLabel: "SharePoint & Intranet Readiness Assessment",
                quizHref: "/sharepoint-quiz",
              },
            ].map((item, i) => (
              <div key={i} className="flex flex-col md:flex-row md:items-center gap-4 p-6 bg-white hover:bg-[#F7F9FC] transition-colors">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#0078D4]/10 flex items-center justify-center">
                  <span className="text-[#0078D4] text-sm font-bold">{i + 1}</span>
                </div>
                <div className="flex-grow">
                  <p className="font-bold text-[#0A2540] mb-1">{item.scenario}</p>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.context}</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
                  <Link
                    href={item.articleHref}
                    className="inline-flex items-center gap-1.5 text-[#0078D4] text-sm font-semibold border border-[#0078D4]/30 rounded-lg px-4 py-2 hover:bg-[#0078D4]/5 transition-colors whitespace-nowrap"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    {item.articleLabel}
                  </Link>
                  <a
                    href={item.quizHref}
                    className="inline-flex items-center gap-1.5 text-white text-sm font-semibold bg-[#0078D4] rounded-lg px-4 py-2 hover:bg-[#005A9E] transition-colors whitespace-nowrap"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" />
                    Take Assessment
                  </a>
                </div>
              </div>
            ))}
          </div>
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
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-2">Free Download — The M365 Copilot Readiness Checklist</p>
              <h2 className="text-2xl font-extrabold text-[#0A2540] mb-2">20 Questions Every IT Leader Must Answer Before Deploying Copilot</h2>
              <p className="text-muted-foreground mb-3">Know exactly where your organization stands before investing in Copilot licenses — across security, identity, data governance, and change readiness.</p>
              <p className="text-muted-foreground text-xs mb-6">Instant download · No email marketing spam · No sales call</p>
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
                  <CTAButton
                    type="submit"
                    className="text-sm whitespace-nowrap"
                    data-testid="lead-magnet-submit"
                    disabled={pdfGenerating}
                  >
                    {pdfGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2 inline-block" />
                        Preparing your checklist…
                      </>
                    ) : (
                      "Download Free Checklist"
                    )}
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

          {/* NASA-Grade Methodology Callout */}
          <div className="mb-8 border-l-4 border-[#0078D4] bg-[#0078D4]/6 rounded-r-xl px-5 py-4 flex items-start gap-3" data-testid="nasa-methodology-callout">
            <Shield className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-[#0A2540] leading-relaxed italic">
              Every article is based on the same architecture principles Shane applies at NASA — adapted for real-world mid‑market and compliance-driven environments.
            </p>
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
                      {shareCounts[post.slug] > 0 && (
                        <span className="flex items-center gap-1 text-muted-foreground text-xs" data-testid={`share-count-${i}`}>
                          <Share2 className="w-3 h-3" />
                          {shareCounts[post.slug]} {shareCounts[post.slug] === 1 ? "share" : "shares"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <a
                        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${window.location.origin}/resources/${post.slug}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Share "${post.title}" on LinkedIn`}
                        className="text-muted-foreground hover:text-[#0A66C2] transition-colors"
                        data-testid={`share-linkedin-${i}`}
                        onClick={e => {
                          e.stopPropagation();
                          void fetch("/api/shares", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ slug: post.slug, platform: "linkedin" }),
                          });
                        }}
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
                        onClick={e => {
                          e.stopPropagation();
                          void fetch("/api/shares", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ slug: post.slug, platform: "x" }),
                          });
                        }}
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

      {/* Free Assessments */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Free · AI-Powered · 5 Minutes</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540] mb-4">Free Assessment Quizzes</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Benchmark your Microsoft 365 environment with a free AI-powered assessment. Each quiz delivers a personalized PDF report with your score, risks, and next steps.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                href: "/copilot-quiz",
                title: "Copilot Readiness",
                description: "Is your tenant ready for Microsoft 365 Copilot? Score across infrastructure, data, AI literacy, change management, and business process.",
                badge: "Most Popular",
              },
              {
                href: "/m365-health-quiz",
                title: "M365 Health Check",
                description: "Benchmark your tenant health across security posture, identity, Conditional Access, collaboration sprawl, and data protection.",
                badge: null,
              },
              {
                href: "/sharepoint-quiz",
                title: "SharePoint & Intranet Readiness",
                description: "Assess your SharePoint architecture, permissions governance, search quality, content lifecycle, and adoption depth.",
                badge: null,
              },
              {
                href: "/power-platform-quiz",
                title: "Power Platform Maturity",
                description: "Measure your Power Platform governance, maker skills, data connectivity, automation maturity, and AI Builder readiness.",
                badge: null,
              },
              {
                href: "/security-quiz",
                title: "Security & Compliance Maturity",
                description: "Evaluate your identity & access controls, data protection, device management, threat detection, and compliance framework readiness.",
                badge: null,
              },
              {
                href: "/teams-quiz",
                title: "Teams Collaboration Maturity",
                description: "Score your Teams governance, meetings & calling setup, information architecture, adoption culture, and app governance.",
                badge: null,
              },
              {
                href: "/migration-quiz",
                title: "Migration Readiness",
                description: "Check your source inventory accuracy, identity readiness, data governance, stakeholder alignment, and risk planning completeness.",
                badge: null,
              },
              {
                href: "/governance-quiz",
                title: "Governance Maturity",
                description: "Assess your DLP & sensitivity labels, retention & records management, access governance, compliance framework, and policy documentation.",
                badge: null,
              },
            ].map((q) => (
              <a
                key={q.href}
                href={q.href}
                className="group bg-white border border-border rounded-xl p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col"
              >
                {q.badge && (
                  <span className="inline-block bg-[#00B4D8]/10 text-[#00B4D8] text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full mb-3 w-fit">
                    {q.badge}
                  </span>
                )}
                <h3 className="text-base font-bold text-[#0A2540] mb-2 group-hover:text-[#0078D4] transition-colors leading-snug">{q.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed flex-1">{q.description}</p>
                <p className="text-[#0078D4] text-sm font-semibold mt-4 flex items-center gap-1 group-hover:gap-2 transition-all">
                  Take Free Assessment <ArrowRight className="w-3.5 h-3.5" />
                </p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="bg-white py-20 border-t border-border">
        <div className="max-w-[860px] mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6 leading-tight">
            Your Microsoft 365 environment deserves senior expertise
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl mx-auto mb-8">
            Shane has spent 30 years in the Microsoft ecosystem and currently serves as Lead M365 Architect at NASA — where security, compliance, and reliability aren't optional. If the articles and assessments have identified gaps you'd rather not tackle alone, book a free 30-minute discovery call.
          </p>
          <CTAButton href="/book" className="text-base px-10 py-4">
            <MessageSquare className="w-4 h-4 mr-2 inline-block" />
            Book a Consultation
          </CTAButton>
          <p className="mt-5 text-muted-foreground text-sm tracking-wide">No pitch. No obligation. Just clarity.</p>
        </div>
      </section>

      <ConsultationCTA />
    </Layout>
  );
}
