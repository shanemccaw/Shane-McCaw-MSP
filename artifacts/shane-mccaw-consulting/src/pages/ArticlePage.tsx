import { useState, Children, isValidElement, type ReactElement } from "react";
import { useParams, Link } from "wouter";
import { ArrowLeft, Calendar, Tag, Link2, Check, Clock, FileText, Quote } from "lucide-react";
import { FaLinkedin } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { AuthorBio } from "@/components/AuthorBio";
import { articles } from "@/data/articles";
import NotFound from "@/pages/not-found";

// Article body markdown styling — Design/fractional_architecture/README.md §6.
const markdownComponents: Components = {
  h2: ({ children }) => (
    <h2 className="mt-11 mb-3.5 text-[clamp(22px,3vw,27px)] font-bold leading-[1.25] tracking-[-0.02em] text-[#f8fafc] text-pretty">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-8 mb-2.5 text-[19px] font-bold leading-[1.3] tracking-[-0.012em] text-[#f8fafc] text-pretty">
      {children}
    </h3>
  ),
  p: ({ children }) => {
    // A closing italic line (markdown "*...*") renders as <p><em>...</em></p> —
    // spec calls for a distinct, smaller italic treatment for it.
    const kids = Children.toArray(children);
    const isClosingLine =
      kids.length === 1 &&
      isValidElement(kids[0]) &&
      (kids[0] as ReactElement).type === "em";

    if (isClosingLine) {
      return (
        <p className="mb-5 text-[14.5px] italic leading-[1.65] text-[#94a3b8]">
          {children}
        </p>
      );
    }

    return (
      <p className="mb-5 text-[17px] leading-[1.75] text-[#cbd5e1] text-pretty">
        {children}
      </p>
    );
  },
  strong: ({ children }) => (
    <strong className="font-semibold text-[#f8fafc]">{children}</strong>
  ),
  ul: ({ children }) => (
    <ul className="m-0 mb-6 flex list-none flex-col gap-2.5 pl-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="article-ol m-0 mb-6 flex list-none flex-col gap-2.5 pl-0">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="flex items-start gap-3.5 text-[17px] leading-[1.65] text-[#cbd5e1]">
      <span className="article-li-dot mt-[11px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#00B4D8]" />
      <span>{children}</span>
    </li>
  ),
  blockquote: ({ children }) => (
    <div className="my-[30px] flex items-start gap-4 rounded-2xl border border-[rgba(0,180,216,0.3)] bg-[rgba(0,180,216,0.06)] px-[26px] py-[22px]">
      <Quote
        className="mt-1 h-[22px] w-[22px] flex-shrink-0 text-[#00B4D8]/60"
        fill="currentColor"
        strokeWidth={0}
      />
      <div className="text-[16.5px] font-medium leading-[1.65] text-[#f1f5f9] [&>p]:mb-0 [&>p]:mt-0">
        {children}
      </div>
    </div>
  ),
  hr: () => <hr className="my-9 border-0 border-t border-[rgba(30,41,59,0.9)]" />,
};

function ShareButtons({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? window.location.href : "";
  const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">
        Share
      </span>
      <a
        href={linkedInUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on LinkedIn"
        className="inline-flex items-center gap-[7px] rounded-[9px] border border-[rgba(148,163,184,0.2)] bg-white/[0.05] px-3.5 py-2.5 text-[12.5px] font-semibold text-[#f1f5f9] transition-colors hover:border-[rgba(0,120,212,0.5)] hover:text-[#00B4D8]"
      >
        <FaLinkedin className="h-3.5 w-3.5" />
        LinkedIn
      </a>
      <a
        href={xUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on X"
        className="inline-flex items-center gap-[7px] rounded-[9px] border border-[rgba(148,163,184,0.2)] bg-white/[0.05] px-3.5 py-2.5 text-[12.5px] font-semibold text-[#f1f5f9] transition-colors hover:border-[rgba(0,120,212,0.5)] hover:text-[#00B4D8]"
      >
        <FaXTwitter className="h-[13px] w-[13px]" />
        X
      </a>
      {copied ? (
        <span className="inline-flex items-center gap-[7px] rounded-[9px] border border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.08)] px-3.5 py-2.5 text-[12.5px] font-semibold text-[#4ADE80]">
          <Check className="h-3.5 w-3.5" />
          Copied!
        </span>
      ) : (
        <button
          onClick={handleCopy}
          aria-label="Copy link to clipboard"
          className="inline-flex items-center gap-[7px] rounded-[9px] border border-[rgba(148,163,184,0.2)] bg-white/[0.04] px-3.5 py-2.5 text-[12.5px] font-semibold text-[#f1f5f9] transition-colors hover:border-[rgba(0,120,212,0.5)]"
        >
          <Link2 className="h-3.5 w-3.5" />
          Copy link
        </button>
      )}
    </div>
  );
}

export default function ArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const article = articles.find((a) => a.slug === slug);

  if (!article) {
    return <NotFound />;
  }

  const canonicalUrl = `https://shanemccaw.com/resources/${article.slug}`;
  const dateIso = (() => {
    const d = new Date(article.date);
    return isNaN(d.getTime()) ? article.date : d.toISOString().split("T")[0];
  })();

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.summary,
    datePublished: dateIso,
    url: canonicalUrl,
    author: {
      "@type": "Person",
      name: "Shane McCaw",
      jobTitle: "Lead Microsoft 365 Architect",
      url: "https://shanemccaw.com/about",
    },
    publisher: {
      "@type": "Organization",
      name: "Shane McCaw Consulting",
      url: "https://shanemccaw.com",
      logo: {
        "@type": "ImageObject",
        url: "https://shanemccaw.com/og-image.png",
      },
    },
  };

  return (
    <Layout>
      <SEOMeta
        title={`${article.title} | Shane McCaw Consulting`}
        description={article.summary}
        ogUrl={canonicalUrl}
        jsonLd={articleJsonLd}
      />

      {/* Header — Design/fractional_architecture/README.md §6 "Article" */}
      <section
        className="relative overflow-hidden border-b border-[rgba(30,41,59,0.8)]"
        style={{
          background:
            "radial-gradient(circle 1100px at 76% -20%, rgba(139,92,246,.12), transparent 62%), radial-gradient(circle 800px at 6% 12%, rgba(0,120,212,.06), transparent 66%)",
        }}
      >
        <FileText
          aria-hidden="true"
          width={440}
          height={440}
          strokeWidth={0.7}
          className="pointer-events-none absolute right-[-60px] top-1/2 hidden -translate-y-1/2 text-[#a78bfa] opacity-10 sm:block"
          style={{ filter: "drop-shadow(0 0 26px rgba(139,92,246,.3))" }}
        />
        <div
          className="relative mx-auto max-w-[800px] px-[clamp(16px,4vw,32px)]"
          style={{
            paddingTop: "calc(72px + clamp(40px, 7vw, 72px))",
            paddingBottom: "clamp(40px, 6vw, 56px)",
          }}
        >
          <Link
            href="/resources"
            className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#00B4D8] transition-colors hover:text-[#5ed2ea]"
          >
            <ArrowLeft className="h-[15px] w-[15px]" strokeWidth={2.2} />
            Back to Resources
          </Link>

          <div className="mt-[30px] mb-[22px] flex flex-wrap items-center gap-x-[18px] gap-y-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(96,165,250,0.2)] bg-[rgba(96,165,250,0.1)] px-[11px] py-[5px] text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#60a5fa]">
              <Tag className="h-[11px] w-[11px]" strokeWidth={2.4} />
              {article.category}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#94a3b8]">
              <Calendar className="h-[13px] w-[13px]" />
              {article.date}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#94a3b8]">
              <Clock className="h-[13px] w-[13px]" />
              {article.readingTime}
            </span>
          </div>

          <h1 className="text-[clamp(28px,4.2vw,46px)] font-extrabold leading-[1.1] tracking-[-0.025em] text-[#f8fafc] text-pretty">
            {article.title}
          </h1>

          <p className="mt-[22px] max-w-[680px] text-[clamp(16px,2.2vw,19px)] leading-[1.6] text-[#94a3b8] text-pretty">
            {article.summary}
          </p>

          <div className="mt-[30px] flex items-center gap-3 border-t border-[rgba(30,41,59,0.9)] pt-[22px]">
            <span
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] text-[12.5px] font-extrabold tracking-[-0.5px] text-white"
              style={{ background: "linear-gradient(135deg,#0078D4,#00B4D8)" }}
            >
              SM
            </span>
            <div className="leading-[1.35]">
              <div className="text-sm font-bold text-[#f8fafc]">Shane McCaw</div>
              <div className="text-[12.5px] text-[#94a3b8]">
                Lead M365 Architect at NASA · 30 years in the Microsoft ecosystem
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Body */}
      <section
        className="px-4 sm:px-6 lg:px-8"
        style={{
          paddingTop: "clamp(36px, 5vw, 56px)",
          paddingBottom: "clamp(56px, 8vw, 88px)",
        }}
      >
        <div className="mx-auto max-w-[800px]">
          <div className="article-body text-[17px] leading-[1.75] text-[#cbd5e1]">
            <ReactMarkdown components={markdownComponents}>
              {article.content}
            </ReactMarkdown>
          </div>

          <AuthorBio />

          <div className="mt-9 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t border-[rgba(30,41,59,0.9)] pt-[26px]">
            <Link
              href="/resources"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#00B4D8] hover:text-[#5ed2ea]"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
              More articles
            </Link>
            <ShareButtons title={article.title} />
          </div>
        </div>
      </section>

      <ConsultationCTA />
    </Layout>
  );
}
