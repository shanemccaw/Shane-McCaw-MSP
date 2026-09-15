/**
 * Live Document Viewer (#2825, Feature #1658) — the authenticated,
 * single-document destination `buildPrintDocumentUrl()` /
 * `buildLiveDocumentPrintUrl()` (api-server's `portal-url.ts`) already build,
 * and the exact route `renderLiveDocumentToPdf()` (`html-pdf.ts`) navigates
 * for the real headless-Chromium PDF export. No Design export was needed for
 * this — per the issue's own 2026-09-15 correction, the 7 live-rendered
 * reports are already real and designed via `live-document-shares.ts` /
 * `shared-live-documents-public.tsx`; this reuses that exact visual pattern
 * (`PillarTile`, the per-report section list) rather than inventing new UI,
 * rendering ALL sections of the ONE selected report in full instead of just
 * headings/counts.
 *
 * Reached three ways:
 *   1. A real logged-in customer/staff session — already carries an access
 *      token, no query param needed.
 *   2. Headless Chromium's print tab, authenticated via `?docPrintToken=...`
 *      (auth-context.tsx's boot effect — already wired, exchanges before
 *      this component's own data fetch runs).
 *   3. An anonymous visitor with neither — shown a real sign-in prompt.
 *
 * Registered OUTSIDE ProtectedRoutes/PortalLayout (top-level Switch, App.tsx)
 * on purpose: a printed PDF should not carry the app's nav chrome, the same
 * reason shared-live-documents-public.tsx uses PublicShareShell instead of
 * PortalLayout — except this page needs a real auth-context session
 * (`useAuth()`), it is not genuinely public.
 *
 * Sets `[data-print-ready="true"]` once real data has loaded — the exact
 * marker `renderLiveDocumentToPdf()` already waits on (`html-pdf.ts:278`);
 * no change needed to that pipeline once this exists.
 */
import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { PublicShareShell } from "@/components/public-share/PublicShareShell";
import { PillarTile } from "@/components/public-share/PillarTile";
import type { LiveDocumentViewerReport } from "@/lib/live-document-viewer-types";

class LiveDocumentFetchError extends Error {
  readonly status: number;
  constructor(status: number, message?: string) {
    super(message ?? `Request failed (${status})`);
    this.status = status;
  }
}

async function fetchLiveDocument(
  fetchWithAuth: ReturnType<typeof useAuth>["fetchWithAuth"],
  docType: string,
): Promise<LiveDocumentViewerReport> {
  const res = await fetchWithAuth(`/api/portal/live-documents/${encodeURIComponent(docType)}`, undefined, {
    silent: true,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new LiveDocumentFetchError(res.status, body?.error);
  }
  return (await res.json()) as LiveDocumentViewerReport;
}

export default function LiveDocumentViewerPage() {
  const { docType } = useParams<{ slug: string; docType: string }>();
  const { user, isLoading: authLoading, fetchWithAuth } = useAuth();
  const [data, setData] = useState<LiveDocumentViewerReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Auth boot effect (incl. the ?docPrintToken= exchange) hasn't settled
    // yet — wait rather than fetching with a token that's about to change.
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    if (!docType) {
      setError("Unknown live document type");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchLiveDocument(fetchWithAuth, docType)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof LiveDocumentFetchError ? e.message : "Could not load this document");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, docType, fetchWithAuth]);

  if (authLoading || loading) {
    return (
      <PublicShareShell topLine="Loading document…">
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </PublicShareShell>
    );
  }

  if (!user) {
    return (
      <PublicShareShell topLine="Sign in required">
        <div className="flex w-[520px] max-w-full flex-col gap-2 rounded-2xl border border-white/[.09] bg-white/[.02] p-6 text-center">
          <span className="text-lg font-bold tracking-tight text-foreground">Sign in required</span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">
            You need to be signed in to view this document.
          </span>
          <Link href="/login" className="mt-2 text-sm font-semibold text-primary hover:underline">
            Go to sign in →
          </Link>
        </div>
      </PublicShareShell>
    );
  }

  if (error || !data) {
    return (
      <PublicShareShell topLine="Document">
        <div className="flex w-[520px] max-w-full flex-col gap-2 rounded-2xl border border-white/[.09] bg-white/[.02] p-6 text-center">
          <span className="text-lg font-bold tracking-tight text-foreground">Couldn't load this document</span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">
            {error ?? "Something went wrong loading this report."}
          </span>
        </div>
      </PublicShareShell>
    );
  }

  return (
    <PublicShareShell topLine="Live document · Copilot Readiness">
      <div className="flex w-[840px] max-w-full flex-col gap-3.5" data-print-ready="true">
        <div className="flex flex-col gap-3 rounded-2xl border border-white/[.09] bg-white/[.02] p-5.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
              <span className="text-[11px] font-semibold tracking-widest text-status-blue uppercase">
                {data.docType}
              </span>
              <span className="text-xl font-bold tracking-tight text-foreground">
                {data.companyName ?? "This tenant"} — {data.title}
              </span>
              <span className="text-[11px] leading-relaxed text-muted-foreground/70">
                Generated live from the tenant's latest scan each time this page opens.
              </span>
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5 border-t border-white/[.07] pt-3">
            {data.pillars.map((p) => (
              <PillarTile key={p.pillar} pillar={p} />
            ))}
          </div>
        </div>

        <div className="flex flex-col rounded-2xl border border-white/[.09] bg-white/[.02] px-5.5 pb-3.5">
          {data.sections.map((s) => (
            <div key={s.key} className="flex flex-col gap-1.5 border-t border-white/[.06] py-3.5 first:border-t-0">
              <span className="text-[13.5px] font-semibold text-foreground">{s.heading}</span>
              {s.html ? (
                <div
                  className="prose prose-invert max-w-none text-[12.5px] leading-relaxed text-muted-foreground [&_p]:my-1.5"
                  dangerouslySetInnerHTML={{ __html: s.html }}
                />
              ) : (
                <span className="rounded-full border border-status-amber/30 bg-status-amber/10 px-2 py-0.5 text-[10px] font-semibold text-status-amber self-start">
                  Could not be generated this time
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </PublicShareShell>
  );
}
