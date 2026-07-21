import { useState, useEffect } from "react";
import { Link } from "wouter";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { trackEvent } from "@/lib/analytics";
import {
  Download,
  ArrowRight,
  Share2,
  Loader2,
  Search,
  ListChecks,
  PenLine,
  ClipboardCheck,
  MessageSquare,
} from "lucide-react";
import { FaLinkedin, FaXTwitter } from "react-icons/fa6";
import { articles } from "@/data/articles";
import type { Article } from "@/data/articles";
import { pdf } from "@react-pdf/renderer";
import { CopilotReadinessPDF } from "@/lib/CopilotReadinessPDF";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

// Canonical filter order (matches src/content/articles/README.md); only categories
// with at least one published article render, and any new category an author adds
// in frontmatter appears automatically after these.
const CATEGORY_ORDER = [
  "Copilot AI Tips",
  "M365 Best Practices",
  "Power Platform How-Tos",
  "Governance & Compliance",
  "Digital Transformation",
];

const presentCategories = [
  ...CATEGORY_ORDER.filter((c) => articles.some((a) => a.category === c)),
  ...Array.from(new Set(articles.map((a) => a.category)))
    .filter((c) => c && !CATEGORY_ORDER.includes(c))
    .sort(),
];

const categoryCounts: Record<string, number> = articles.reduce(
  (acc, a) => {
    acc[a.category] = (acc[a.category] ?? 0) + 1;
    return acc;
  },
  { All: articles.length } as Record<string, number>
);

const ASSESSMENTS = [
  { href: "/copilot-quiz", title: "Copilot Readiness" },
  { href: "/m365-health-quiz", title: "M365 Health Check" },
  { href: "/sharepoint-quiz", title: "SharePoint & Intranet" },
  { href: "/power-platform-quiz", title: "Power Platform Maturity" },
  { href: "/security-quiz", title: "Security & Compliance" },
  { href: "/teams-quiz", title: "Teams Collaboration" },
  { href: "/migration-quiz", title: "Migration Readiness" },
  { href: "/governance-quiz", title: "Governance Maturity" },
];

function shareArticle(slug: string, platform: "linkedin" | "x") {
  void fetch("/api/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, platform }),
  });
}

function ArticleMeta({ article, shareCount, testId }: { article: Article; shareCount?: number; testId?: string }) {
  return (
    <div className="flex items-center gap-3">
      <p className="text-text-secondary text-xs">{article.date}</p>
      <span className="text-text-tertiary text-xs">·</span>
      <p className="text-text-secondary text-xs">{article.readingTime}</p>
      {(shareCount ?? 0) > 0 && (
        <span className="flex items-center gap-1 text-text-secondary text-xs" data-testid={testId}>
          <Share2 className="w-3 h-3" />
          {shareCount} {shareCount === 1 ? "share" : "shares"}
        </span>
      )}
    </div>
  );
}

export default function Resources() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [query, setQuery] = useState("");
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

  const q = query.trim().toLowerCase();
  const byCategory = activeCategory === "All" ? articles : articles.filter(a => a.category === activeCategory);
  const filtered = q
    ? byCategory.filter(a => `${a.title} ${a.summary} ${a.category}`.toLowerCase().includes(q))
    : byCategory;

  // The newest article gets the featured slot, but only in the default view —
  // any active filter or search switches to a plain results grid.
  const showFeatured = activeCategory === "All" && !q && filtered.length > 0;
  const featured = showFeatured ? filtered[0] : null;
  const gridArticles = showFeatured ? filtered.slice(1) : filtered;

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
        description="Practical Microsoft 365 guides and field notes by Shane McCaw — NASA's Lead M365 Architect. Tactical security and governance tips you can apply today, plus honest lessons from building a modern Microsoft practice."
      />

      {/* Hero — content-first framing */}
      <section className="pt-32 sm:pt-40 pb-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-secondary mb-4">Resources &amp; Field Notes</p>
          <h1 className="font-display text-4xl sm:text-6xl font-bold text-text-primary tracking-tight leading-tight max-w-4xl mb-6">
            Practical Microsoft 365 guidance, <GradientText>written from the field</GradientText>
          </h1>
          <p className="text-text-secondary text-lg md:text-xl max-w-3xl leading-relaxed">
            Tactical, do-this-first guidance — the security controls, governance policies, and platform
            decisions that make a measurable difference — plus honest notes from Shane's own journey
            building a modern Microsoft practice. Thirty years in the ecosystem, currently Lead M365
            Architect at NASA. No fluff, nothing written for search engines.
          </p>
        </div>
      </section>

      {/* Featured — latest article */}
      {featured && (
        <section className="pb-4 px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <article
              className="bg-charcoal-1 rounded-2xl border border-white/[0.06] hover:border-accent-blue/30 transition-colors p-6 md:p-10"
              data-testid="featured-article"
            >
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="text-accent-violet text-xs font-bold uppercase tracking-widest">Latest article</span>
                <span className="inline-block bg-white/[0.06] text-accent-blue text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide border border-white/[0.08]">
                  {featured.category}
                </span>
              </div>
              <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary leading-snug mb-3 max-w-3xl">
                <Link href={`/resources/${featured.slug}`} className="hover:text-accent-blue transition-colors">
                  {featured.title}
                </Link>
              </h2>
              <p className="text-text-secondary leading-relaxed mb-6 max-w-3xl">{featured.summary}</p>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <ArticleMeta article={featured} shareCount={shareCounts[featured.slug]} testId="share-count-featured" />
                <Link
                  href={`/resources/${featured.slug}`}
                  className="inline-flex items-center gap-2 text-white text-sm font-semibold rounded-lg px-5 py-2.5 transition-opacity hover:opacity-90"
                  style={GRADIENT_BG}
                  data-testid="read-featured"
                >
                  Read Article <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </article>
          </div>
        </section>
      )}

      {/* Browse — search, category filter, article grid */}
      <section className="py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center gap-4 mb-8">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-text-secondary absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                placeholder="Search articles…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent-blue/60"
                aria-label="Search articles"
                data-testid="resources-search"
              />
            </div>
            <div className="flex flex-wrap gap-2" data-testid="category-filter">
              {["All", ...presentCategories].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    activeCategory === cat
                      ? "text-white"
                      : "bg-white/[0.06] text-text-secondary hover:text-text-primary border border-white/[0.08]"
                  }`}
                  style={activeCategory === cat ? GRADIENT_BG : undefined}
                  data-testid={`category-${cat.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  {cat} <span className="opacity-70">({categoryCounts[cat] ?? 0})</span>
                </button>
              ))}
            </div>
          </div>

          {gridArticles.length === 0 && !featured ? (
            <div className="border border-white/[0.06] rounded-2xl bg-charcoal-1 p-10 text-center" data-testid="no-results">
              <p className="text-text-primary font-semibold mb-2">No articles match your search.</p>
              <p className="text-text-secondary text-sm mb-6">Try a different term, or browse everything below.</p>
              <button
                onClick={() => { setQuery(""); setActiveCategory("All"); }}
                className="inline-flex items-center gap-2 text-accent-blue text-sm font-semibold border border-accent-blue/30 rounded-lg px-5 py-2.5 hover:bg-accent-blue/10 transition-colors"
                data-testid="clear-filters"
              >
                Show all articles
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {gridArticles.map((post, i) => (
                <article
                  key={post.slug}
                  className="bg-charcoal-1 rounded-2xl border border-white/[0.06] overflow-hidden hover:border-accent-blue/30 hover:-translate-y-1 transition-all duration-300 flex flex-col"
                  data-testid={`blog-post-${i}`}
                >
                  <div className="p-6 flex flex-col flex-1">
                    <span className="inline-block bg-white/[0.06] text-accent-blue text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide mb-4 border border-white/[0.08] w-fit">
                      {post.category}
                    </span>
                    <h3 className="font-display text-lg font-bold text-text-primary mb-3 leading-snug">
                      <Link href={`/resources/${post.slug}`} className="hover:text-accent-blue transition-colors">
                        {post.title}
                      </Link>
                    </h3>
                    <p className="text-text-secondary text-sm leading-relaxed mb-6 flex-1">{post.summary}</p>
                    <div className="flex items-center justify-between gap-3">
                      <ArticleMeta article={post} shareCount={shareCounts[post.slug]} testId={`share-count-${i}`} />
                      <div className="flex items-center gap-3">
                        <a
                          href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${window.location.origin}/resources/${post.slug}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Share "${post.title}" on LinkedIn`}
                          className="text-text-tertiary hover:text-accent-blue transition-colors"
                          data-testid={`share-linkedin-${i}`}
                          onClick={e => {
                            e.stopPropagation();
                            shareArticle(post.slug, "linkedin");
                          }}
                        >
                          <FaLinkedin className="w-4 h-4" />
                        </a>
                        <a
                          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}&url=${encodeURIComponent(`${window.location.origin}/resources/${post.slug}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Share "${post.title}" on X`}
                          className="text-text-tertiary hover:text-text-primary transition-colors"
                          data-testid={`share-x-${i}`}
                          onClick={e => {
                            e.stopPropagation();
                            shareArticle(post.slug, "x");
                          }}
                        >
                          <FaXTwitter className="w-4 h-4" />
                        </a>
                        <Link
                          href={`/resources/${post.slug}`}
                          className="text-accent-blue text-sm font-semibold hover:underline flex items-center gap-1 whitespace-nowrap"
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
          )}
        </div>
      </section>

      {/* What gets published here — the two content tracks */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-3">What gets published here</h2>
          <p className="text-text-secondary max-w-3xl mb-8 leading-relaxed">
            Everything on this page falls into one of two tracks — and both are written to be genuinely
            useful on their own, whether or not you ever hire anyone.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-6">
              <div className="w-10 h-10 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4 text-accent-blue">
                <ListChecks className="w-5 h-5" />
              </div>
              <h3 className="font-display font-bold text-text-primary mb-2">Tactical guides</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Concrete, do-this-first walkthroughs: the Conditional Access rules worth turning on before
                anything else, the DLP policies that actually move your score, the governance and platform
                configurations that pay for themselves. Written to be applied the same day you read them.
              </p>
            </div>
            <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-6">
              <div className="w-10 h-10 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4 text-accent-violet">
                <PenLine className="w-5 h-5" />
              </div>
              <h3 className="font-display font-bold text-text-primary mb-2">Field notes</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                The business journey, in the open: what Shane is building, the decisions behind it, what's
                working and what isn't — the honest lessons from thirty years in the Microsoft ecosystem
                and from running a modern Microsoft practice today.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Go deeper — checklist download + free assessments (secondary CTAs) */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-8">Go deeper</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Lead magnet — compact */}
            <GlassPanel className="p-6 md:p-8 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue flex-shrink-0">
                  <Download className="w-5 h-5" />
                </div>
                <p className="text-accent-blue text-xs font-semibold uppercase tracking-[0.1em]">Free download</p>
              </div>
              <h3 className="font-display text-xl font-bold text-text-primary mb-2">The M365 Copilot Readiness Checklist</h3>
              <p className="text-text-secondary text-sm mb-2 leading-relaxed">
                20 questions every IT leader should answer before buying Copilot licenses — across security,
                identity, data governance, and change readiness.
              </p>
              <p className="text-text-secondary text-xs mb-5">Instant download · No email marketing spam · No sales call</p>
              <div className="mt-auto">
                {!submitted ? (
                  <form onSubmit={handleLeadMagnet} className="flex flex-col gap-3" data-testid="lead-magnet-form">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="text"
                        placeholder="First name"
                        value={leadMagnetName}
                        onChange={e => setLeadMagnetName(e.target.value)}
                        required
                        className="flex-1 bg-white/[0.04] border border-white/[0.1] rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent-blue/60"
                        data-testid="lead-magnet-name"
                      />
                      <input
                        type="email"
                        placeholder="Work email"
                        value={leadMagnetEmail}
                        onChange={e => setLeadMagnetEmail(e.target.value)}
                        required
                        className="flex-1 bg-white/[0.04] border border-white/[0.1] rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent-blue/60"
                        data-testid="lead-magnet-email"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={pdfGenerating}
                      className="inline-flex items-center justify-center rounded-xl px-6 py-2.5 text-sm font-semibold text-white whitespace-nowrap transition-opacity hover:opacity-90 disabled:opacity-50"
                      style={GRADIENT_BG}
                      data-testid="lead-magnet-submit"
                    >
                      {pdfGenerating ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2 inline-block" />
                          Preparing your checklist…
                        </>
                      ) : (
                        "Download Free Checklist"
                      )}
                    </button>
                  </form>
                ) : (
                  <div className="bg-white/[0.06] border border-white/[0.1] rounded-lg px-6 py-4 text-text-primary font-medium" data-testid="lead-magnet-success">
                    Thanks, {leadMagnetName}! Your checklist is on its way to {leadMagnetEmail}.
                  </div>
                )}
              </div>
            </GlassPanel>

            {/* Assessments — compact */}
            <GlassPanel className="p-6 md:p-8 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-violet flex-shrink-0">
                  <ClipboardCheck className="w-5 h-5" />
                </div>
                <p className="text-accent-violet text-xs font-semibold uppercase tracking-[0.1em]">Free · AI-powered · 5 minutes</p>
              </div>
              <h3 className="font-display text-xl font-bold text-text-primary mb-2">Benchmark your environment</h3>
              <p className="text-text-secondary text-sm mb-5 leading-relaxed">
                Read something that hits close to home? Each free assessment scores your Microsoft 365
                environment and delivers a personalized PDF report with your risks and next steps.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-auto">
                {ASSESSMENTS.map((quiz) => (
                  <a
                    key={quiz.href}
                    href={quiz.href}
                    className="group flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:border-accent-blue/30 px-4 py-2.5 text-sm text-text-primary font-medium transition-colors"
                  >
                    {quiz.title}
                    <ArrowRight className="w-3.5 h-3.5 text-text-tertiary group-hover:text-accent-blue transition-colors flex-shrink-0" />
                  </a>
                ))}
              </div>
            </GlassPanel>
          </div>
        </div>
      </section>

      {/* Closing CTA — compact */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto text-center">
          <GlassPanel className="p-8 sm:p-10">
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-text-primary mb-3">
              Found a gap you'd rather not tackle <GradientText>alone?</GradientText>
            </h2>
            <p className="text-text-secondary leading-relaxed max-w-xl mx-auto mb-6">
              Shane has spent 30 years in the Microsoft ecosystem and currently serves as Lead M365
              Architect at NASA. Book a free 30-minute discovery call to talk through what you're seeing.
            </p>
            <a
              href="/book"
              className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-semibold text-white text-base transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              <MessageSquare className="w-4 h-4" />
              Book a Consultation
            </a>
            <p className="mt-4 text-text-secondary text-sm tracking-wide">No pitch. No obligation. Just clarity.</p>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
