import { useState, useEffect } from "react";
import { Link } from "wouter";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { trackEvent } from "@/lib/analytics";
import {
  Download,
  ArrowRight,
  Share2,
  Loader2,
  Search,
  ListChecks,
  PenLine,
  MessageSquare,
} from "lucide-react";
import { FaLinkedin, FaXTwitter } from "react-icons/fa6";
import { articles } from "@/data/articles";
import type { Article } from "@/data/articles";
import { pdf } from "@react-pdf/renderer";
import { CopilotReadinessPDF } from "@/lib/CopilotReadinessPDF";

const GRADIENT_BG = { background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" };

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

function shareArticle(slug: string, platform: "linkedin" | "x") {
  void fetch("/api/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, platform }),
  });
}

function ArticleMeta({ article, shareCount, testId }: { article: Article; shareCount?: number; testId?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[#94a3b8]">
      <span>{article.date}</span>
      <span className="text-[#64748b]">·</span>
      <span>{article.readingTime}</span>
      {(shareCount ?? 0) > 0 && (
        <>
          <span className="text-[#64748b]">·</span>
          <span className="flex items-center gap-1" data-testid={testId}>
            <Share2 className="w-3 h-3" />
            {shareCount} {shareCount === 1 ? "share" : "shares"}
          </span>
        </>
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

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadMagnetEmail);
  const leadInvalid = !(leadMagnetName.trim() && emailValid);

  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 & Copilot AI Insights | Shane McCaw Consulting"
        description="Practical Microsoft 365 guides and field notes by Shane McCaw — NASA's Lead M365 Architect. Tactical security and governance tips you can apply today, plus honest lessons from building a modern Microsoft practice."
      />

      {/* Hero — content-first framing */}
      <section
        className="relative overflow-hidden pt-32 sm:pt-40 pb-7 sm:pb-10 px-4 sm:px-6 lg:px-8"
        style={{
          background:
            "radial-gradient(circle 1100px at 76% -20%, rgba(139,92,246,.12), rgba(2,6,23,0) 62%), radial-gradient(circle 800px at 6% 12%, rgba(0,120,212,.06), rgba(2,6,23,0) 66%)",
        }}
      >
        <div className="max-w-[1160px] mx-auto relative">
          <div className="flex items-center gap-3">
            <span className="w-[26px] h-px" style={{ background: "linear-gradient(90deg,#00B4D8,rgba(0,180,216,.15))" }} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#00B4D8]">
              Resources &amp; Field Notes
            </span>
          </div>
          <h1 className="text-[28px] sm:text-[34px] lg:text-[42px] leading-[1.1] tracking-[-0.022em] font-extrabold text-[#f8fafc] mt-[22px] mb-5 max-w-[820px]">
            Practical Microsoft 365 guidance, <span className="text-[#00B4D8]">written from the field</span>
          </h1>
          <p className="text-base sm:text-lg leading-relaxed text-[#94a3b8] max-w-[760px]">
            Tactical, do-this-first guidance — the security controls, governance policies, and platform
            decisions that make a measurable difference — plus honest notes from Shane's own journey
            building a modern Microsoft practice. Thirty years in the ecosystem, currently Lead M365
            Architect at NASA. No fluff, nothing written for search engines.
          </p>
        </div>
      </section>

      {/* Featured — latest article */}
      {featured && (
        <section className="px-4 sm:px-6 lg:px-8 pb-3 sm:pb-4">
          <div className="max-w-[1160px] mx-auto">
            <article
              className="relative overflow-hidden rounded-3xl border border-[rgba(0,120,212,0.3)] hover:border-[rgba(0,120,212,0.55)] transition-colors p-6 md:p-11 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 lg:gap-14 items-end"
              style={{
                background:
                  "radial-gradient(900px 380px at 8% -10%,rgba(0,120,212,.16),transparent 60%),linear-gradient(168deg,rgba(10,37,64,.5),#070d1e 64%)",
              }}
              data-testid="featured-article"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3 mb-[18px]">
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#00B4D8]">Latest article</span>
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#60a5fa] bg-[rgba(96,165,250,0.1)] border border-[rgba(96,165,250,0.2)] rounded-full px-[11px] py-[5px]">
                    {featured.category}
                  </span>
                </div>
                <h2 className="text-2xl md:text-4xl leading-[1.15] tracking-[-0.025em] font-extrabold mb-3.5 max-w-[720px]">
                  <Link href={`/resources/${featured.slug}`} className="text-[#f8fafc] hover:text-[#00B4D8] transition-colors">
                    {featured.title}
                  </Link>
                </h2>
                <p className="text-base leading-[1.65] text-[#94a3b8] mb-6 max-w-[680px]">{featured.summary}</p>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3.5">
                  <Link
                    href={`/resources/${featured.slug}`}
                    className="inline-flex items-center gap-2 text-white text-sm font-semibold rounded-xl px-6 py-3 transition-opacity hover:opacity-90"
                    style={GRADIENT_BG}
                    data-testid="read-featured"
                  >
                    Read Article <ArrowRight className="w-4 h-4" />
                  </Link>
                  <ArticleMeta article={featured} shareCount={shareCounts[featured.slug]} testId="share-count-featured" />
                </div>
              </div>
              <div className="lg:justify-self-end w-full max-w-[300px] border-l border-[rgba(0,180,216,0.35)] pl-[18px] sm:pl-7 flex flex-col gap-[18px]">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#00B4D8]">Published</div>
                  <div className="text-[22px] sm:text-[28px] font-extrabold tracking-[-0.025em] text-[#f8fafc] mt-1.5 leading-[1.1]">
                    {featured.date}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#00B4D8]">Reading time</div>
                  <div className="text-[22px] sm:text-[28px] font-extrabold tracking-[-0.025em] text-[#f8fafc] mt-1.5 leading-[1.1]">
                    {featured.readingTime}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#00B4D8]">By</div>
                  <div className="text-[15px] font-semibold text-[#e2e8f0] mt-1.5 leading-[1.35]">
                    Shane McCaw
                    <span className="block text-[12.5px] font-normal text-[#94a3b8] mt-0.5">Lead M365 Architect at NASA</span>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>
      )}

      {/* Browse — search, category filter, article grid */}
      <section className="py-7 sm:py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-[1160px] mx-auto">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3.5 mb-7">
            <div className="relative flex-1 min-w-[260px] max-w-[420px]">
              <Search className="w-4 h-4 text-[#94a3b8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                placeholder="Search articles…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full rounded-[10px] border border-[rgba(148,163,184,0.25)] bg-[rgba(15,23,42,0.6)] pl-10 pr-3.5 py-[11px] text-sm text-[#f1f5f9] placeholder:text-[#64748b] outline-none focus:border-[#0078D4] focus:ring-2 focus:ring-[rgba(0,120,212,0.25)]"
                aria-label="Search articles"
                data-testid="resources-search"
              />
            </div>
            <div className="flex flex-wrap gap-2" data-testid="category-filter">
              {["All", ...presentCategories].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-4 py-[10px] rounded-full text-[13px] font-semibold transition-colors ${
                    activeCategory === cat
                      ? "text-white bg-[#0078D4] border border-[#0078D4]"
                      : "text-[#cbd5e1] bg-white/[0.04] border border-[rgba(148,163,184,0.2)] hover:text-[#f8fafc] hover:border-[rgba(0,180,216,0.45)]"
                  }`}
                  data-testid={`category-${cat.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  {cat} <span className={activeCategory === cat ? "opacity-75" : "opacity-60"}>({categoryCounts[cat] ?? 0})</span>
                </button>
              ))}
            </div>
          </div>

          {gridArticles.length === 0 && !featured ? (
            <div
              className="border border-[rgba(30,41,59,0.9)] rounded-2xl bg-[rgba(15,23,42,0.5)] p-10 text-center"
              data-testid="no-results"
            >
              <p className="text-[#f8fafc] font-semibold mb-2">No articles match your search.</p>
              <p className="text-[#94a3b8] text-sm mb-[22px]">Try a different term, or browse everything below.</p>
              <button
                onClick={() => { setQuery(""); setActiveCategory("All"); }}
                className="inline-flex items-center gap-2 text-[#e2e8f0] text-sm font-semibold border border-[rgba(148,163,184,0.3)] rounded-xl px-5 py-2.5 hover:border-[#00B4D8] hover:text-[#00B4D8] transition-colors"
                data-testid="clear-filters"
              >
                Show all articles
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {gridArticles.map((post, i) => (
                <article
                  key={post.slug}
                  className="flex flex-col border border-[rgba(30,41,59,0.9)] rounded-2xl bg-[rgba(15,23,42,0.5)] p-[22px] transition-all duration-200 hover:border-[rgba(0,120,212,0.45)] hover:-translate-y-[3px]"
                  data-testid={`blog-post-${i}`}
                >
                  <span className="self-start text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#60a5fa] bg-[rgba(96,165,250,0.1)] border border-[rgba(96,165,250,0.2)] rounded-full px-[11px] py-[5px] mb-4">
                    {post.category}
                  </span>
                  <h3 className="text-lg leading-[1.3] tracking-[-0.015em] font-bold mb-2.5">
                    <Link href={`/resources/${post.slug}`} className="text-[#f8fafc] hover:text-[#00B4D8] transition-colors">
                      {post.title}
                    </Link>
                  </h3>
                  <p className="text-sm leading-[1.6] text-[#94a3b8] mb-5 flex-1">{post.summary}</p>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 pt-3.5 border-t border-[rgba(30,41,59,0.9)]">
                    <ArticleMeta article={post} shareCount={shareCounts[post.slug]} testId={`share-count-${i}`} />
                    <div className="flex items-center gap-3">
                      <a
                        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${window.location.origin}/resources/${post.slug}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Share "${post.title}" on LinkedIn`}
                        className="text-[#94a3b8] hover:text-[#00B4D8] transition-colors flex p-2 -m-2"
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
                        className="text-[#94a3b8] hover:text-[#f8fafc] transition-colors flex p-2 -m-2"
                        data-testid={`share-x-${i}`}
                        onClick={e => {
                          e.stopPropagation();
                          shareArticle(post.slug, "x");
                        }}
                      >
                        <FaXTwitter className="w-[15px] h-[15px]" />
                      </a>
                      <Link
                        href={`/resources/${post.slug}`}
                        className="text-[#00B4D8] hover:text-[#5ed2ea] text-[13px] font-semibold flex items-center gap-1 whitespace-nowrap transition-colors"
                        data-testid={`read-more-${i}`}
                      >
                        Read More <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* What gets published here — the two content tracks */}
      <section className="py-10 sm:py-14 px-4 sm:px-6 lg:px-8 border-t border-[rgba(30,41,59,0.8)]">
        <div className="max-w-[1160px] mx-auto">
          <h2 className="text-2xl sm:text-[34px] leading-[1.14] tracking-[-0.025em] font-extrabold text-[#f8fafc] mb-3">
            What gets published here
          </h2>
          <p className="text-base leading-[1.65] text-[#94a3b8] max-w-[760px] mb-7">
            Everything on this page falls into one of two tracks — and both are written to be genuinely
            useful on their own, whether or not you ever hire anyone.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-[rgba(30,41,59,0.9)] bg-[rgba(15,23,42,0.5)] p-6">
              <div className="w-10 h-10 rounded-xl bg-[rgba(0,120,212,0.12)] border border-[rgba(0,120,212,0.25)] flex items-center justify-center mb-4 text-[#60a5fa]">
                <ListChecks className="w-5 h-5" />
              </div>
              <h3 className="text-[17px] font-bold tracking-[-0.01em] text-[#f8fafc] mb-2">Tactical guides</h3>
              <p className="text-sm leading-[1.6] text-[#94a3b8]">
                Concrete, do-this-first walkthroughs: the Conditional Access rules worth turning on before
                anything else, the DLP policies that actually move your score, the governance and platform
                configurations that pay for themselves. Written to be applied the same day you read them.
              </p>
            </div>
            <div className="rounded-2xl border border-[rgba(30,41,59,0.9)] bg-[rgba(15,23,42,0.5)] p-6">
              <div className="w-10 h-10 rounded-xl bg-[rgba(0,180,216,0.1)] border border-[rgba(0,180,216,0.25)] flex items-center justify-center mb-4 text-[#00B4D8]">
                <PenLine className="w-5 h-5" />
              </div>
              <h3 className="text-[17px] font-bold tracking-[-0.01em] text-[#f8fafc] mb-2">Field notes</h3>
              <p className="text-sm leading-[1.6] text-[#94a3b8]">
                The business journey, in the open: what Shane is building, the decisions behind it, what's
                working and what isn't — the honest lessons from thirty years in the Microsoft ecosystem
                and from running a modern Microsoft practice today.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Go deeper — checklist download */}
      <section
        className="py-10 sm:py-14 px-4 sm:px-6 lg:px-8 border-t border-[rgba(30,41,59,0.8)]"
        style={{ background: "linear-gradient(180deg,#020617,#040b1e 40%,#020617)" }}
      >
        <div className="max-w-[1160px] mx-auto">
          <h2 className="text-2xl sm:text-[34px] leading-[1.14] tracking-[-0.025em] font-extrabold text-[#f8fafc] mb-6">
            Go deeper
          </h2>
          <div
            className="rounded-[20px] border border-white/[0.12] bg-white/[0.05] backdrop-blur-2xl p-6 sm:p-9 grid grid-cols-1 md:grid-cols-2 gap-8 sm:gap-12 items-center"
          >
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[rgba(0,120,212,0.12)] border border-[rgba(0,120,212,0.25)] flex items-center justify-center text-[#60a5fa] flex-shrink-0">
                  <Download className="w-5 h-5" />
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#00B4D8]">Free download</span>
              </div>
              <h3 className="text-xl sm:text-[26px] font-bold tracking-[-0.018em] text-[#f8fafc] mb-2.5 leading-[1.2]">
                The M365 Copilot Readiness Checklist
              </h3>
              <p className="text-[15px] leading-[1.6] text-[#94a3b8] mb-2.5 max-w-[520px]">
                20 questions every IT leader should answer before buying Copilot licenses — across security,
                identity, data governance, and change readiness.
              </p>
              <p className="text-[12.5px] text-[#94a3b8]">Instant download · No email marketing spam · No sales call</p>
            </div>
            <div>
              {!submitted ? (
                <form onSubmit={handleLeadMagnet} className="flex flex-col gap-3" data-testid="lead-magnet-form">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="First name"
                      value={leadMagnetName}
                      onChange={e => setLeadMagnetName(e.target.value)}
                      required
                      className="w-full rounded-[10px] border border-[rgba(148,163,184,0.25)] bg-[rgba(2,6,23,0.55)] px-3.5 py-3 text-sm text-[#f1f5f9] placeholder:text-[#64748b] outline-none focus:border-[#0078D4] focus:ring-2 focus:ring-[rgba(0,120,212,0.25)]"
                      data-testid="lead-magnet-name"
                    />
                    <input
                      type="email"
                      placeholder="Work email"
                      value={leadMagnetEmail}
                      onChange={e => setLeadMagnetEmail(e.target.value)}
                      required
                      className="w-full rounded-[10px] border border-[rgba(148,163,184,0.25)] bg-[rgba(2,6,23,0.55)] px-3.5 py-3 text-sm text-[#f1f5f9] placeholder:text-[#64748b] outline-none focus:border-[#0078D4] focus:ring-2 focus:ring-[rgba(0,120,212,0.25)]"
                      data-testid="lead-magnet-email"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={pdfGenerating || leadInvalid}
                    className="inline-flex items-center justify-center rounded-xl px-6 py-[13px] text-[15px] font-semibold text-white whitespace-nowrap transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={GRADIENT_BG}
                    data-testid="lead-magnet-submit"
                  >
                    {pdfGenerating ? (
                      <>
                        <Loader2 className="w-[18px] h-[18px] animate-spin mr-2 inline-block" />
                        Preparing your checklist…
                      </>
                    ) : (
                      "Download Free Checklist"
                    )}
                  </button>
                </form>
              ) : (
                <div
                  className="border border-[rgba(0,180,216,0.3)] bg-[rgba(0,180,216,0.06)] rounded-xl px-5 py-[18px] text-[15px] leading-[1.5] font-medium text-[#f1f5f9]"
                  data-testid="lead-magnet-success"
                >
                  Thanks, {leadMagnetName}! Your checklist is on its way to {leadMagnetEmail}.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="max-w-[820px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 pb-16 sm:pb-24">
        <div
          className="relative overflow-hidden text-center rounded-3xl border border-[rgba(0,120,212,0.3)] px-5 sm:px-12 py-8 sm:py-14"
          style={{
            background:
              "radial-gradient(700px 320px at 50% -20%,rgba(0,120,212,.18),transparent 60%),linear-gradient(168deg,rgba(10,37,64,.5),#070d1e 64%)",
          }}
        >
          <h2 className="text-[26px] sm:text-[38px] leading-[1.12] tracking-[-0.025em] font-extrabold text-[#f8fafc] mb-3.5">
            Found a gap you'd rather not tackle <span className="text-[#00B4D8]">alone?</span>
          </h2>
          <p className="text-base leading-[1.65] text-[#94a3b8] max-w-[560px] mx-auto mb-[26px]">
            Shane has spent 30 years in the Microsoft ecosystem and currently serves as Lead M365
            Architect at NASA. Book a free 30-minute discovery call to talk through what you're seeing.
          </p>
          <div className="flex justify-center">
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 px-8 py-[15px] rounded-xl font-semibold text-white text-base transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              <MessageSquare className="w-4 h-4" />
              Book a Consultation
            </Link>
          </div>
          <p className="mt-[18px] text-[13px] tracking-[0.02em] text-[#94a3b8]">No pitch. No obligation. Just clarity.</p>
        </div>
      </section>
    </Layout>
  );
}
