import { useState } from "react";
import { useParams, Link } from "wouter";
import { ArrowLeft, Calendar, Tag, Link2, Check, Clock } from "lucide-react";
import { FaLinkedin } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { AuthorBio } from "@/components/AuthorBio";
import { ArticleAssessmentCTA } from "@/components/ArticleAssessmentCTA";
import { ArticlePersonalizedNudge } from "@/components/ArticlePersonalizedNudge";
import { articles } from "@/data/articles";
import NotFound from "@/pages/not-found";

const markdownComponents: Components = {
  h2: ({ children }) => (
    <h2 className="font-display text-2xl font-bold text-text-primary mt-10 mb-4 leading-snug">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-display text-lg font-bold text-text-primary mt-8 mb-3 leading-snug">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="text-text-secondary leading-relaxed mb-5">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-6 space-y-2 pl-0">{children}</ul>
  ),
  li: ({ children }) => (
    <li className="flex gap-3 text-text-secondary leading-relaxed">
      <span className="mt-2 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-accent-blue" />
      <span>{children}</span>
    </li>
  ),
  blockquote: ({ children }) => (
    <div className="my-8 border-l-4 border-accent-blue bg-white/[0.04] rounded-r-xl px-6 py-5">
      <div className="text-text-primary font-medium leading-relaxed [&>p]:mb-0">
        {children}
      </div>
    </div>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-text-primary">{children}</strong>
  ),
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
    <div className="flex items-center gap-3">
      <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Share</span>
      <a
        href={linkedInUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on LinkedIn"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-text-primary text-xs font-semibold hover:border-accent-blue/30 hover:text-accent-blue transition-colors"
      >
        <FaLinkedin className="w-3.5 h-3.5" />
        LinkedIn
      </a>
      <a
        href={xUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on X"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-text-primary text-xs font-semibold hover:border-accent-blue/30 hover:text-accent-blue transition-colors"
      >
        <FaXTwitter className="w-3.5 h-3.5" />
        X
      </a>
      <button
        onClick={handleCopy}
        aria-label="Copy link to clipboard"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] text-text-primary text-xs font-semibold hover:border-accent-blue/30 transition-colors"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-green-500" />
            <span className="text-green-500">Copied!</span>
          </>
        ) : (
          <>
            <Link2 className="w-3.5 h-3.5" />
            Copy link
          </>
        )}
      </button>
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

      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 border-b border-white/[0.06]">
        <div className="max-w-[800px] mx-auto">
          <Link
            href="/resources"
            className="inline-flex items-center gap-2 text-accent-blue text-sm font-semibold hover:underline mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Resources
          </Link>

          <div className="flex flex-wrap items-center gap-4 mb-6">
            <span className="inline-flex items-center gap-1.5 bg-white/[0.06] border border-white/[0.08] text-accent-blue text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide">
              <Tag className="w-3 h-3" />
              {article.category}
            </span>
            <span className="inline-flex items-center gap-1.5 text-text-tertiary text-xs">
              <Calendar className="w-3 h-3" />
              {article.date}
            </span>
            <span className="inline-flex items-center gap-1.5 text-text-tertiary text-xs">
              <Clock className="w-3 h-3" />
              {article.readingTime}
            </span>
          </div>

          <h1 className="font-display text-3xl md:text-4xl lg:text-5xl font-bold text-text-primary leading-tight">
            {article.title}
          </h1>

          <p className="mt-6 text-text-secondary text-lg leading-relaxed max-w-2xl">
            {article.summary}
          </p>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-[800px] mx-auto">
          <div className="prose-custom">
            <ReactMarkdown components={markdownComponents}>
              {article.content}
            </ReactMarkdown>
          </div>

          <ArticleAssessmentCTA category={article.category} title={article.title} />
          <ArticlePersonalizedNudge category={article.category} title={article.title} />

          <AuthorBio />

          <div className="mt-10 pt-8 border-t border-white/[0.06]">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
              <Link
                href="/resources"
                className="inline-flex items-center gap-2 text-accent-blue text-sm font-semibold hover:underline"
              >
                <ArrowLeft className="w-4 h-4" />
                More articles
              </Link>
            </div>
            <ShareButtons title={article.title} />
          </div>
        </div>
      </section>

      <ConsultationCTA />
    </Layout>
  );
}
