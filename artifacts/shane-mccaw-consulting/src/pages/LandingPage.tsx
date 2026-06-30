import { useEffect, useRef, useState } from "react";
import { useParams, useSearch } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { CheckCircle, ArrowRight, Loader2, Shield, Zap, Lock, ChevronDown } from "lucide-react";

interface LinkedService {
  id: number;
  slug: string | null;
  name: string;
  visibility: string;
  billingType: string;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  turnaround: string | null;
}

type WhyThisMattersContent = { body: string };
type AuthorityContent = {
  heading: string;
  body: string;
  complianceBadges: string[];
  stats: Array<{ stat: string; label: string }>;
};
type ProcessContent = {
  steps: Array<{ step: string; title: string; description: string; note?: string }>;
};
type TrustBadgesContent = { badges: string[] };
type RichTextContent = { title?: string; body: string; list?: string[] };
type FaqContent = { title?: string; items: Array<{ q: string; a: string }> };
type TestimonialsContent = { items: Array<{ quote: string; author: string; role?: string; company?: string }> };
type ProblemSolutionContent = { problem: string; solution: string; bullets?: string[] };
type ChecklistContent = { title?: string; items: string[] };
type StatsBarContent = { stats: Array<{ value: string; label: string }> };
type FeaturedQuoteContent = { quote: string; attribution?: string };
type QuizCtaContent = { quizType: string; title?: string; description?: string; buttonText?: string };

type LayoutBlock =
  | { blockType: "why_this_matters"; content: WhyThisMattersContent }
  | { blockType: "authority"; content: AuthorityContent }
  | { blockType: "process"; content: ProcessContent }
  | { blockType: "trust_badges"; content: TrustBadgesContent }
  | { blockType: "rich_text"; content: RichTextContent }
  | { blockType: "faq"; content: FaqContent }
  | { blockType: "testimonials"; content: TestimonialsContent }
  | { blockType: "problem_solution"; content: ProblemSolutionContent }
  | { blockType: "checklist"; content: ChecklistContent }
  | { blockType: "stats_bar"; content: StatsBarContent }
  | { blockType: "featured_quote"; content: FeaturedQuoteContent }
  | { blockType: "quiz_cta"; content: QuizCtaContent }
  | { blockType: string; content: unknown };

interface LandingPageData {
  id: number;
  slug: string;
  title: string;
  headline?: string | null;
  subheadline?: string | null;
  valuePropBlocks: Array<{ icon?: string; heading: string; body: string }>;
  cta: { buttonText: string; href: string; subtext?: string } | null;
  published: boolean;
  _preview?: boolean;
  linkedService?: LinkedService | null;
  layoutBlocks?: LayoutBlock[];
}

const QUIZ_LABELS: Record<string, string> = {
  copilot: "Copilot Readiness",
  "m365-health": "M365 Tenant Health",
  sharepoint: "SharePoint Architecture",
  "power-platform": "Power Platform Maturity",
  "security-compliance": "Security & Compliance",
  teams: "Teams Health",
  migration: "Migration Readiness",
  governance: "Governance Maturity",
};

const QUIZ_ROUTES: Record<string, string> = {
  copilot: "/copilot-quiz",
  "m365-health": "/m365-health-quiz",
  sharepoint: "/sharepoint-readiness-quiz",
  "power-platform": "/power-platform-quiz",
  "security-compliance": "/security-compliance-quiz",
  teams: "/teams-maturity-quiz",
  migration: "/migration-readiness-quiz",
  governance: "/governance-maturity-quiz",
};

function FaqSection({ content }: { content: FaqContent }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <section className="bg-[#F7F9FC] py-16 px-6 border-b border-border">
      <div className="max-w-[800px] mx-auto">
        {content.title && (
          <div className="text-center mb-8">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Questions Answered</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">{content.title}</h2>
          </div>
        )}
        <div className="space-y-2">
          {content.items.map((item, i) => (
            <div key={i} className="bg-white border border-border rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-6 py-4 text-left gap-4"
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
              >
                <span className="font-semibold text-[#0A2540] text-sm leading-snug">{item.q}</span>
                <ChevronDown className={`w-4 h-4 text-[#0078D4] flex-shrink-0 transition-transform duration-200 ${openIdx === i ? "rotate-180" : ""}`} />
              </button>
              {openIdx === i && (
                <div className="px-6 pb-5 text-muted-foreground text-sm leading-relaxed border-t border-border pt-4">{item.a}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearch();
  const [page, setPage] = useState<LandingPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [fetchingToken, setFetchingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const isLpOnly = page?.linkedService?.visibility === "landing_page_only";
  const [hasServiceAccess, setHasServiceAccess] = useState(false);
  const ctaClickedRef = useRef(false);

  useEffect(() => {
    if (!slug) return;
    fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
      .then(r => r.ok ? (r.json() as Promise<{ accessToken?: string }>) : null)
      .then(data => {
        if (!data?.accessToken) return;
        return fetch(`/api/landing-pages/${encodeURIComponent(slug)}/gate-status`, {
          headers: { Authorization: `Bearer ${data.accessToken}` },
        })
          .then(r => r.ok ? (r.json() as Promise<{ isLpOnly?: boolean; hasAccess?: boolean }>) : null)
          .then(gs => { if (gs?.hasAccess) setHasServiceAccess(true); });
      })
      .catch(() => {});
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const params = new URLSearchParams(search);
    const previewToken = params.get("preview");
    const url = previewToken
      ? `/api/landing-pages/${encodeURIComponent(slug)}?preview=${encodeURIComponent(previewToken)}`
      : `/api/landing-pages/${encodeURIComponent(slug)}`;
    fetch(url)
      .then(r => {
        if (!r.ok) { setNotFound(true); return null; }
        return r.json() as Promise<LandingPageData>;
      })
      .then(d => { if (d) setPage(d); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug, search]);

  async function handleLpCtaClick(e: React.MouseEvent) {
    e.preventDefault();
    if (!page || !slug || ctaClickedRef.current) return;
    ctaClickedRef.current = true;
    setFetchingToken(true);
    setTokenError(null);
    try {
      const res = await fetch(`/api/landing-pages/${encodeURIComponent(slug)}/token`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Unable to generate access token");
      }
      const { token, serviceId, exp } = await res.json() as { token: string; serviceId: number; exp: number };
      sessionStorage.setItem("onboardingLpToken", token);
      if (typeof exp === "number") sessionStorage.setItem("onboardingLpTokenExp", String(exp));
      sessionStorage.setItem("onboardingLpUrl", window.location.href);
      sessionStorage.setItem("onboardingLpSlug", slug ?? "");
      if (page.linkedService) sessionStorage.setItem("onboardingLpService", JSON.stringify(page.linkedService));
      if (typeof exp === "number" && slug) {
        const lsKey = `onboardingLp_${exp}`;
        try {
          localStorage.setItem(lsKey, JSON.stringify({ slug, lpUrl: window.location.href, exp }));
          localStorage.setItem("onboardingLpLatestExp", String(exp));
        } catch { /* storage full or private browsing — silently skip */ }
      }
      window.location.href = `/crm/onboarding/select?serviceId=${serviceId}`;
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : "Unable to continue. Please try again.");
      ctaClickedRef.current = false;
    } finally {
      setFetchingToken(false);
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (notFound || !page) {
    return (
      <Layout>
        <div className="min-h-screen flex flex-col items-center justify-center text-center px-4 py-20">
          <h1 className="text-3xl font-bold text-[#0A2540] mb-4">Page Not Found</h1>
          <p className="text-gray-600 mb-8">This landing page doesn't exist or is no longer available.</p>
          <CTAButton href="/">Go Home</CTAButton>
        </div>
      </Layout>
    );
  }

  const ctaHref = page.cta?.href ?? "/contact";
  const defaultCtaText = isLpOnly && !hasServiceAccess ? "Sign Up to Access" : "Get Started";
  const ctaText = page.cta?.buttonText?.trim() || defaultCtaText;

  const blocks = page.layoutBlocks ?? [];
  const trustBadges = (blocks.find(b => b.blockType === "trust_badges")?.content as TrustBadgesContent | undefined)?.badges ?? [];

  function ctaProps(extraClassName?: string) {
    if (isLpOnly) {
      return {
        onClick: handleLpCtaClick as React.MouseEventHandler,
        disabled: fetchingToken,
        className: extraClassName,
        children: fetchingToken ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</span> : ctaText,
      } as const;
    }
    return { href: ctaHref, className: extraClassName, children: ctaText } as const;
  }

  function renderBlock(block: LayoutBlock, i: number) {
    switch (block.blockType) {
      case "trust_badges":
        return null;

      case "why_this_matters": {
        const c = block.content as WhyThisMattersContent;
        return (
          <section key={i} className="bg-white py-16 px-6 border-b border-border">
            <div className="max-w-[800px] mx-auto text-center">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Why This Matters</p>
              <p className="text-[#0A2540] text-lg leading-relaxed">{c.body}</p>
            </div>
          </section>
        );
      }

      case "authority": {
        const c = block.content as AuthorityContent;
        return (
          <section key={i} className="bg-[#0A2540] py-20 px-6">
            <div className="max-w-[1100px] mx-auto">
              <div className="text-center mb-10">
                <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Your Consultant</p>
                <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">{c.heading}</h2>
                <p className="text-white/60 max-w-2xl mx-auto leading-relaxed">{c.body}</p>
              </div>
              {c.complianceBadges.length > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-3 mb-10">
                  {c.complianceBadges.map((badge, bi) => (
                    <span key={bi} className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-lg px-5 py-2.5 text-white font-bold text-sm">
                      <Shield className="w-4 h-4 text-[#00B4D8] flex-shrink-0" />{badge}
                    </span>
                  ))}
                </div>
              )}
              {c.stats.length > 0 && (
                <div className={`grid grid-cols-1 gap-6 max-w-[860px] mx-auto ${c.stats.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
                  {c.stats.map((item, si) => (
                    <div key={si} className="bg-white/5 border border-white/10 rounded-xl p-6 text-center">
                      <div className="text-3xl font-extrabold text-[#00B4D8] mb-2">{item.stat}</div>
                      <div className="text-white/60 text-sm font-medium">{item.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        );
      }

      case "process": {
        const c = block.content as ProcessContent;
        if (!c.steps.length) return null;
        const stepColors = ["#0078D4", "#00B4D8", "#0A2540"];
        return (
          <section key={i} className="bg-[#F7F9FC] py-20 px-6">
            <div className="max-w-[1100px] mx-auto">
              <div className="text-center mb-14">
                <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">The Process</p>
                <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">How It Works</h2>
              </div>

              {/* Desktop: horizontal workflow cards with arrows */}
              <div className="hidden md:flex items-stretch gap-3">
                {c.steps.map((step, si) => (
                  <div key={si} className="flex items-center gap-3 flex-1">
                    <div className="flex-1 bg-white border border-border rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow flex flex-col">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-extrabold text-sm mb-5 shadow-sm"
                        style={{ backgroundColor: stepColors[si % stepColors.length] }}
                      >
                        {String(si + 1).padStart(2, "0")}
                      </div>
                      <p className="text-[#0078D4] text-[10px] font-bold uppercase tracking-wider mb-2">Step {si + 1}</p>
                      <h3 className="font-extrabold text-[#0A2540] text-base mb-2.5">{step.title}</h3>
                      <p className="text-muted-foreground text-sm leading-relaxed flex-1">{step.description}</p>
                      {step.note && (
                        <p className="text-xs font-semibold text-[#0078D4] italic mt-3 pt-3 border-t border-border">
                          {step.note}
                        </p>
                      )}
                    </div>
                    {si < c.steps.length - 1 && (
                      <ArrowRight className="w-5 h-5 text-[#0078D4]/35 flex-shrink-0" />
                    )}
                  </div>
                ))}
              </div>

              {/* Mobile: vertical timeline */}
              <div className="flex flex-col gap-0 md:hidden">
                {c.steps.map((step, si) => (
                  <div key={si} className="flex gap-4">
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-extrabold text-sm shadow-sm"
                        style={{ backgroundColor: stepColors[si % stepColors.length] }}
                      >
                        {String(si + 1).padStart(2, "0")}
                      </div>
                      {si < c.steps.length - 1 && (
                        <div className="w-0.5 flex-1 mt-2 min-h-[40px] bg-gradient-to-b from-[#0078D4]/25 to-transparent" />
                      )}
                    </div>
                    <div className="flex-1 pb-8">
                      <p className="text-[#0078D4] text-[10px] font-bold uppercase tracking-wider mb-1.5">Step {si + 1}</p>
                      <h3 className="font-extrabold text-[#0A2540] text-base mb-2">{step.title}</h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">{step.description}</p>
                      {step.note && <p className="text-xs font-semibold text-[#0078D4] italic mt-2">{step.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      }

      case "rich_text": {
        const c = block.content as RichTextContent;
        return (
          <section key={i} className="bg-white py-16 px-6 border-b border-border">
            <div className="max-w-[800px] mx-auto">
              {c.title && <h2 className="text-2xl font-extrabold text-[#0A2540] mb-4">{c.title}</h2>}
              <p className="text-muted-foreground leading-relaxed text-base">{c.body}</p>
              {c.list && c.list.length > 0 && (
                <ul className="mt-5 space-y-2">
                  {c.list.map((item, li) => (
                    <li key={li} className="flex items-start gap-2 text-sm text-[#0A2540]">
                      <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        );
      }

      case "faq":
        return <FaqSection key={i} content={block.content as FaqContent} />;

      case "testimonials": {
        const c = block.content as TestimonialsContent;
        if (!c.items.length) return null;
        return (
          <section key={i} className="bg-[#F7F9FC] py-20 px-6">
            <div className="max-w-[1100px] mx-auto">
              <div className="text-center mb-12">
                <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">What Clients Say</p>
                <h2 className="text-3xl font-extrabold text-[#0A2540]">Results Speak Loudest</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {c.items.map((t, ti) => (
                  <div key={ti} className="bg-white rounded-xl border border-border p-8 flex flex-col">
                    <div className="text-4xl text-[#0078D4]/20 mb-3 leading-none font-serif">"</div>
                    <p className="text-[#0A2540] text-sm leading-relaxed mb-4 flex-1 italic">"{t.quote}"</p>
                    <div>
                      <p className="font-bold text-sm text-[#0A2540]">{t.author}</p>
                      {(t.role || t.company) && (
                        <p className="text-xs text-muted-foreground">{[t.role, t.company].filter(Boolean).join(", ")}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      }

      case "problem_solution": {
        const c = block.content as ProblemSolutionContent;
        return (
          <section key={i} className="bg-white py-20 px-6 border-b border-border">
            <div className="max-w-[1100px] mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                <div className="bg-red-50 border border-red-100 rounded-2xl p-8">
                  <p className="text-red-600 text-xs font-semibold uppercase tracking-[0.1em] mb-3">The Problem</p>
                  <p className="text-[#0A2540] font-semibold leading-relaxed">{c.problem}</p>
                </div>
                <div className="bg-[#0078D4]/5 border border-[#0078D4]/20 rounded-2xl p-8">
                  <p className="text-[#0078D4] text-xs font-semibold uppercase tracking-[0.1em] mb-3">The Solution</p>
                  <p className="text-[#0A2540] font-semibold leading-relaxed">{c.solution}</p>
                  {c.bullets && c.bullets.length > 0 && (
                    <ul className="mt-4 space-y-2">
                      {c.bullets.map((b, bi) => (
                        <li key={bi} className="flex items-start gap-2 text-sm text-[#0A2540]">
                          <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />{b}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </section>
        );
      }

      case "checklist": {
        const c = block.content as ChecklistContent;
        return (
          <section key={i} className="bg-[#F7F9FC] py-16 px-6 border-b border-border">
            <div className="max-w-[800px] mx-auto">
              {c.title && (
                <div className="text-center mb-8">
                  <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">What's Included</p>
                  <h2 className="text-3xl font-extrabold text-[#0A2540]">{c.title}</h2>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {c.items.map((item, ci) => (
                  <div key={ci} className="flex items-start gap-3 bg-white rounded-xl border border-border px-5 py-4">
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span className="text-sm font-medium text-[#0A2540]">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      }

      case "stats_bar": {
        const c = block.content as StatsBarContent;
        return (
          <section key={i} className="bg-[#0A2540] py-14 px-6">
            <div className="max-w-[1100px] mx-auto">
              <div className={`grid gap-8 max-w-[860px] mx-auto ${
                c.stats.length <= 2 ? "grid-cols-2"
                : c.stats.length === 3 ? "grid-cols-3"
                : "grid-cols-2 md:grid-cols-4"
              }`}>
                {c.stats.map((s, si) => (
                  <div key={si} className="text-center">
                    <div className="text-3xl md:text-4xl font-extrabold text-[#00B4D8] mb-2">{s.value}</div>
                    <div className="text-white/60 text-sm font-medium">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      }

      case "featured_quote": {
        const c = block.content as FeaturedQuoteContent;
        return (
          <section key={i} className="bg-white py-16 px-6 border-b border-border">
            <div className="max-w-[760px] mx-auto text-center">
              <div className="text-6xl text-[#0078D4]/15 mb-2 leading-none font-serif">"</div>
              <blockquote className="text-xl md:text-2xl font-semibold text-[#0A2540] leading-relaxed italic">
                {c.quote}
              </blockquote>
              {c.attribution && (
                <p className="mt-6 text-sm font-semibold text-[#0078D4]">— {c.attribution}</p>
              )}
            </div>
          </section>
        );
      }

      case "quiz_cta": {
        const c = block.content as QuizCtaContent;
        const label = QUIZ_LABELS[c.quizType] ?? c.quizType;
        const quizHref = QUIZ_ROUTES[c.quizType] ?? `/${c.quizType}-quiz`;
        return (
          <section key={i} className="bg-[#F7F9FC] py-16 px-6 border-b border-border">
            <div className="max-w-[680px] mx-auto text-center">
              <div className="inline-flex items-center gap-2 bg-[#0078D4]/10 border border-[#0078D4]/25 rounded-full px-5 py-2 mb-6">
                <span className="w-2 h-2 rounded-full bg-[#0078D4] animate-pulse" />
                <span className="text-[#0078D4] text-xs font-semibold uppercase tracking-[0.08em]">Free — {label} Assessment</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4">
                {c.title ?? `How Ready Is Your Organisation for ${label}?`}
              </h2>
              <p className="text-muted-foreground text-base leading-relaxed mb-8">
                {c.description ?? "Answer 10 questions and receive a personalised readiness report with actionable recommendations — in minutes."}
              </p>
              <a
                href={quizHref}
                className="inline-flex items-center gap-2 bg-[#0078D4] text-white font-bold text-base px-10 py-4 rounded-xl hover:bg-[#0065b3] transition-colors shadow-lg shadow-[#0078D4]/20"
              >
                {c.buttonText ?? "Start Free Assessment"}
                <ArrowRight className="w-5 h-5" />
              </a>
              <p className="mt-4 text-xs text-muted-foreground">10 questions · No sign-up required · Instant personalised report</p>
            </div>
          </section>
        );
      }

      default:
        return null;
    }
  }

  return (
    <Layout>
      {page._preview && (
        <div className="sticky top-0 z-50 bg-amber-500 text-amber-950 text-sm font-semibold text-center py-2 px-4 flex items-center justify-center gap-2 shadow-md">
          <span>🔍 Preview Mode</span>
          <span className="font-normal opacity-75">— this page is a draft and not visible to the public</span>
        </div>
      )}

      {/* ── HERO ── */}
      <section className="relative min-h-[85vh] flex items-center justify-center bg-[#0A2540] overflow-hidden">
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
          className="absolute inset-0 opacity-20"
          style={{ background: "radial-gradient(ellipse 70% 60% at 50% 40%, #0078D4, transparent)" }}
        />

        <div className="relative z-10 max-w-[1100px] mx-auto px-6 py-32 pt-44 text-center">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/15 border border-[#0078D4]/40 rounded-full px-5 py-2 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#00B4D8] animate-pulse" />
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em]">
              Specialist Engagement — Shane McCaw Consulting
            </p>
          </div>

          {page.headline && (
            <h1 className="text-4xl md:text-5xl lg:text-[3.5rem] font-extrabold text-white leading-[1.1] mb-5 max-w-4xl mx-auto">
              {page.headline}
            </h1>
          )}
          {page.subheadline && (
            <p className="text-xl text-[#00B4D8] font-semibold max-w-2xl mx-auto mb-4">
              {page.subheadline}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8 mb-4">
            <CTAButton {...ctaProps("text-base px-10 py-4 shadow-lg shadow-[#0078D4]/30")} />
            {tokenError && <p className="text-red-300 text-sm text-center">{tokenError}</p>}
            <a
              href="/micro-offers"
              className="inline-flex items-center gap-2 text-white/80 font-semibold text-base hover:text-white transition-colors border border-white/20 px-8 py-3.5 rounded-xl hover:border-white/40"
            >
              See All Packages <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          {isLpOnly && !hasServiceAccess && (
            <div className="flex justify-center mb-6">
              <span className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 text-white/80 text-xs font-semibold">
                <Lock className="w-3 h-3 text-[#00B4D8] flex-shrink-0" />
                Members only — sign up to access
              </span>
            </div>
          )}

          {trustBadges.length > 0 && (
            <div className="pt-8 border-t border-white/10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-white/50 text-sm font-medium">
              {trustBadges.map((badge, i) => (
                <span key={i} className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0" />
                  {badge}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#F7F9FC] to-transparent" />
      </section>

      {/* ── WHAT YOU GET (valuePropBlocks) ── */}
      {page.valuePropBlocks.length > 0 && (
        <section className="bg-[#F7F9FC] py-20 px-6">
          <div className="max-w-[1100px] mx-auto">
            <div className="text-center mb-14">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">What's Included</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">What You Get</h2>
            </div>

            <div
              className={`grid grid-cols-1 gap-6 ${
                page.valuePropBlocks.length === 1
                  ? "max-w-xl mx-auto"
                  : page.valuePropBlocks.length === 2
                  ? "md:grid-cols-2 max-w-3xl mx-auto"
                  : "md:grid-cols-2 lg:grid-cols-3"
              }`}
            >
              {page.valuePropBlocks.map((block, i) => (
                <div
                  key={i}
                  className="bg-white rounded-xl border border-border p-8 flex flex-col hover:border-[#0078D4]/30 hover:shadow-sm transition-all"
                >
                  {block.icon ? (
                    <div className="text-3xl mb-4">{block.icon}</div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center mb-4 flex-shrink-0">
                      <Zap className="w-5 h-5 text-[#0078D4]" />
                    </div>
                  )}
                  <h3 className="text-lg font-extrabold text-[#0A2540] mb-3">{block.heading}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{block.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── LAYOUT BLOCKS (sequential) ── */}
      {blocks.map((block, i) => renderBlock(block, i))}

      {/* ── FINAL CTA ── */}
      <section className="bg-[#0078D4] py-20 px-6 text-white text-center">
        <div className="max-w-2xl mx-auto">
          <p className="text-blue-200 text-sm font-semibold uppercase tracking-[0.1em] mb-3">Ready to Get Started?</p>
          <h2 className="text-3xl md:text-4xl font-extrabold mb-4">{page.title}</h2>
          <CTAButton {...ctaProps("bg-white text-[#0078D4] hover:bg-gray-100 text-lg px-10 py-4 shadow-lg")} />
          {isLpOnly && !hasServiceAccess && (
            <div className="flex justify-center mt-4">
              <span className="inline-flex items-center gap-1.5 bg-white/15 border border-white/25 rounded-full px-4 py-1.5 text-white/80 text-xs font-semibold">
                <Lock className="w-3 h-3 text-white/60 flex-shrink-0" />
                Members only — sign up to access
              </span>
            </div>
          )}
          {page.cta?.subtext && (
            <p className="mt-4 text-sm text-blue-200">{page.cta.subtext}</p>
          )}
          {trustBadges.length > 0 && (
            <div className="mt-10 pt-8 border-t border-white/20 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-white/70 text-sm font-medium">
              {trustBadges.map((badge, i) => (
                <span key={i} className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-white/50 flex-shrink-0" />
                  {badge}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
