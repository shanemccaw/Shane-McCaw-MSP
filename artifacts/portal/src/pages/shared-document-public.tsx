/**
 * Public shared-document viewer (#4001, Feature #1663).
 * Route: /shared-documents/:shareToken — no authentication.
 *
 * Wired to `GET /api/public/documents/:shareToken` and
 * `POST /api/public/documents/:shareToken/doc-views`
 * (contract pack §1, condensed there from `docs/portal/documents-contract-pack.md`
 * §2c–2e). The design's "share-viewer" / "share-expired" / "share-missing"
 * scenes live on `Documents.dc.html`, not a separate export — this page
 * is not duplicated there (per that design's own ledger, §1).
 *
 * `htmlContent` is already run through `stripStagedForReviewBanner()`
 * server-side — rendered here via an iframe, same as the archived page,
 * so the document's own styling is self-contained and isolated from this
 * shell.
 */
import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { Loader2 } from "lucide-react";
import { PublicShareShell } from "@/components/public-share/PublicShareShell";
import { fetchPublicDocument, recordDocumentDwell, ShareFetchError } from "@/lib/public-share-api";
import type { PublicSharedDocument } from "@/lib/public-share-types";

const GONE_COPY: Record<"expired" | "not_found", { title: string; body: string; code: string }> = {
  expired: {
    title: "This share link has expired",
    body: "Links last 30 days from when they were created. Ask whoever sent it to share the document again — a fresh link is one click for them.",
    code: "410",
  },
  not_found: {
    title: "This link does not lead anywhere",
    body: "Either it was copied incompletely or the document it pointed to is gone. Nothing is shown in either case.",
    code: "404",
  },
};

export default function SharedDocumentPublicPage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [doc, setDoc] = useState<PublicSharedDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState<"expired" | "not_found" | null>(null);
  const dwellStart = useRef<number>(Date.now());

  useEffect(() => {
    if (!shareToken) {
      setGone("not_found");
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchPublicDocument(shareToken)
      .then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setGone(e instanceof ShareFetchError && e.kind === "expired" ? "expired" : "not_found");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  useEffect(() => {
    if (!shareToken) return;
    dwellStart.current = Date.now();
    const recordDwell = () => {
      const dwellSeconds = Math.round((Date.now() - dwellStart.current) / 1000);
      if (dwellSeconds < 1) return;
      recordDocumentDwell(shareToken, dwellSeconds);
    };
    window.addEventListener("pagehide", recordDwell);
    return () => {
      recordDwell();
      window.removeEventListener("pagehide", recordDwell);
    };
  }, [shareToken]);

  if (loading) {
    return (
      <PublicShareShell topLine="Shared link">
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </PublicShareShell>
    );
  }

  if (gone || !doc) {
    const copy = GONE_COPY[gone ?? "not_found"];
    return (
      <PublicShareShell topLine="Shared link">
        <div className="flex w-[620px] max-w-full flex-col gap-2 rounded-2xl border border-white/[.09] bg-white/[.02] p-6">
          <span className="text-lg font-bold tracking-tight text-foreground">{copy.title}</span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">{copy.body}</span>
          <span className="pt-1 font-mono text-[11px] text-muted-foreground/70">{copy.code}</span>
        </div>
      </PublicShareShell>
    );
  }

  return (
    <PublicShareShell topLine="Shared document · no sign-in needed">
      <div className="flex w-[840px] max-w-full flex-col gap-3.5 rounded-2xl border border-white/[.09] bg-white/[.02] p-1">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
          <h1 className="truncate text-[15px] font-semibold text-foreground">{doc.title}</h1>
          <span className="shrink-0 rounded-full border border-white/[.12] px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Read only
          </span>
        </div>
        <div className="h-[70vh] overflow-hidden rounded-b-2xl">
          <iframe
            srcDoc={doc.htmlContent}
            title={doc.title}
            className="size-full border-0 bg-white"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </PublicShareShell>
  );
}
