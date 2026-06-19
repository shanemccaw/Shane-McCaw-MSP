import { useState } from "react";
import { useParams, Link } from "wouter";
import { ArrowLeft, Calendar, Tag, Link2, Check } from "lucide-react";
import { FaLinkedin } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { articles } from "@/data/articles";
import NotFound from "@/pages/not-found";

const markdownComponents: Components = {
  h2: ({ children }) => (
    <h2 className="text-2xl font-extrabold text-[#0A2540] mt-10 mb-4 leading-snug">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-bold text-[#0A2540] mt-8 mb-3 leading-snug">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="text-[#374151] leading-relaxed mb-5">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-6 space-y-2 pl-0">{children}</ul>
  ),
  li: ({ children }) => (
    <li className="flex gap-3 text-[#374151] leading-relaxed">
      <span className="mt-2 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078D4]" />
      <span>{children}</span>
    </li>
  ),
  blockquote: ({ children }) => (
    <div className="my-8 border-l-4 border-[#0078D4] bg-[#0078D4]/6 rounded-r-xl px-6 py-5">
      <div className="text-[#0A2540] font-medium leading-relaxed [&>p]:mb-0">
        {children}
      </div>
    </div>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[#0A2540]">{children}</strong>
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
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Share</span>
      <a
        href={linkedInUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on LinkedIn"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0A66C2] text-white text-xs font-semibold hover:bg-[#004182] transition-colors"
      >
        <FaLinkedin className="w-3.5 h-3.5" />
        LinkedIn
      </a>
      <a
        href={xUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on X"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#000000] text-white text-xs font-semibold hover:bg-[#333333] transition-colors"
      >
        <FaXTwitter className="w-3.5 h-3.5" />
        X
      </a>
      <button
        onClick={handleCopy}
        aria-label="Copy link to clipboard"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-white text-[#0A2540] text-xs font-semibold hover:bg-[#F7F9FC] transition-colors"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-green-600" />
            <span className="text-green-600">Copied!</span>
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

  return (
    <Layout>
      <SEOMeta
        title={`${article.title} | Shane McCaw Consulting`}
        description={article.summary}
      />

      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[800px] mx-auto px-6">
          <Link
            href="/resources"
            className="inline-flex items-center gap-2 text-[#0078D4] text-sm font-semibold hover:underline mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Resources
          </Link>

          <div className="flex flex-wrap items-center gap-4 mb-6">
            <span className="inline-flex items-center gap-1.5 bg-[#0078D4]/20 text-[#60B4FF] text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide">
              <Tag className="w-3 h-3" />
              {article.category}
            </span>
            <span className="inline-flex items-center gap-1.5 text-white/50 text-xs">
              <Calendar className="w-3 h-3" />
              {article.date}
            </span>
          </div>

          <h1 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-white leading-tight">
            {article.title}
          </h1>

          <p className="mt-6 text-white/70 text-lg leading-relaxed max-w-2xl">
            {article.summary}
          </p>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="max-w-[800px] mx-auto px-6">
          <div className="prose-custom">
            <ReactMarkdown components={markdownComponents}>
              {article.content}
            </ReactMarkdown>
          </div>

          <div className="mt-16 pt-10 border-t border-border">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
              <div>
                <p className="text-sm font-semibold text-[#0A2540]">Shane McCaw</p>
                <p className="text-xs text-muted-foreground">Lead Microsoft 365 Architect · 30-Year Microsoft Veteran</p>
              </div>
              <Link
                href="/resources"
                className="inline-flex items-center gap-2 text-[#0078D4] text-sm font-semibold hover:underline"
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
