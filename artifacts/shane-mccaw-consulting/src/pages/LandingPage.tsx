import { useEffect, useState } from "react";
import { useParams, useSearch } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";

interface LandingPageData {
  id: number;
  slug: string;
  title: string;
  headline?: string | null;
  subheadline?: string | null;
  valuePropBlocks: Array<{ icon?: string; heading: string; body: string }>;
  socialProof: Array<{ quote: string; author: string; role?: string }>;
  cta: { buttonText: string; href: string; subtext?: string } | null;
  published: boolean;
  _preview?: boolean;
}

export default function LandingPage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearch();
  const [page, setPage] = useState<LandingPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
  const ctaText = page.cta?.buttonText ?? "Get Started";

  return (
    <Layout>
      {page._preview && (
        <div className="sticky top-0 z-50 bg-amber-500 text-amber-950 text-sm font-semibold text-center py-2 px-4 flex items-center justify-center gap-2 shadow-md">
          <span>🔍 Preview Mode</span>
          <span className="font-normal opacity-75">— this page is a draft and not visible to the public</span>
        </div>
      )}

      <div className="bg-[#0A2540] text-white pt-32 pb-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          {page.headline && (
            <h1 className="text-4xl md:text-5xl font-extrabold leading-tight mb-5">
              {page.headline}
            </h1>
          )}
          {page.subheadline && (
            <p className="text-xl text-blue-200 mb-10 max-w-2xl mx-auto">
              {page.subheadline}
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href={ctaHref} className="text-lg px-8 py-4">{ctaText}</CTAButton>
          </div>
          {page.cta?.subtext && (
            <p className="mt-4 text-sm text-blue-300">{page.cta.subtext}</p>
          )}
        </div>
      </div>

      {page.valuePropBlocks.length > 0 && (
        <section className="py-16 px-4 bg-white">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {page.valuePropBlocks.map((block, i) => (
                <div key={i} className="text-center p-6">
                  {block.icon && (
                    <div className="text-4xl mb-4">{block.icon}</div>
                  )}
                  <h3 className="text-xl font-bold text-[#0A2540] mb-3">{block.heading}</h3>
                  <p className="text-gray-600">{block.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {page.socialProof.length > 0 && (
        <section className="py-16 px-4 bg-[#F7F9FC]">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-center text-[#0A2540] mb-10">What Clients Say</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {page.socialProof.map((proof, i) => (
                <div key={i} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                  <blockquote className="text-gray-700 italic mb-4">"{proof.quote}"</blockquote>
                  <div>
                    <p className="font-semibold text-[#0A2540]">{proof.author}</p>
                    {proof.role && <p className="text-sm text-gray-500">{proof.role}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="py-20 px-4 bg-[#0078D4] text-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">{page.title}</h2>
          <p className="text-blue-100 mb-8">Ready to transform how your organisation uses Microsoft 365?</p>
          <CTAButton href={ctaHref} className="bg-white text-[#0078D4] hover:bg-gray-100 text-lg px-8 py-4">
            {ctaText}
          </CTAButton>
          {page.cta?.subtext && <p className="mt-4 text-sm text-blue-200">{page.cta.subtext}</p>}
        </div>
      </section>
    </Layout>
  );
}
