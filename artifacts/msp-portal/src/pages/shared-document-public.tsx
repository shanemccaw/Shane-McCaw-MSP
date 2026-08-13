/**
 * Public shared-document viewer.
 * Accessible via share token — no authentication required.
 * Route: /shared-documents/:shareToken
 *
 * Mirrors msp-sow-public.tsx's share-token access pattern, minus signing —
 * this is a read-only view of a general document (assessment, health report,
 * roadmap) shared from customer-documents.tsx.
 */

import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { Loader2, ShieldAlert } from "lucide-react";

interface SharedDocument {
  title: string;
  htmlContent: string;
  docType: string | null;
  expiresAt: string;
}

export default function SharedDocumentPublicPage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [doc, setDoc] = useState<SharedDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"not_found" | "expired" | "unknown" | null>(null);
  const dwellStart = useRef<number>(Date.now());

  useEffect(() => {
    if (!shareToken) { setError("not_found"); setLoading(false); return; }
    fetch(`/api/public/documents/${encodeURIComponent(shareToken)}`)
      .then(async (res) => {
        if (res.status === 410) throw new Error("expired");
        if (!res.ok) throw new Error("not_found");
        return (await res.json()) as SharedDocument;
      })
      .then(setDoc)
      .catch((e) => setError(e instanceof Error && e.message === "expired" ? "expired" : "not_found"))
      .finally(() => setLoading(false));
  }, [shareToken]);

  useEffect(() => {
    if (!shareToken) return;
    dwellStart.current = Date.now();
    const recordDwell = () => {
      const dwellSeconds = Math.round((Date.now() - dwellStart.current) / 1000);
      if (dwellSeconds < 1) return;
      const body = JSON.stringify({ dwellSeconds });
      const url = `/api/public/documents/${encodeURIComponent(shareToken)}/doc-views`;
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      } else {
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    };
    window.addEventListener("pagehide", recordDwell);
    return () => {
      recordDwell();
      window.removeEventListener("pagehide", recordDwell);
    };
  }, [shareToken]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <ShieldAlert className="size-10 text-muted-foreground/40 mb-4" />
        <h1 className="text-lg font-semibold mb-1">
          {error === "expired" ? "Link Expired" : "Link Not Found"}
        </h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          {error === "expired"
            ? "This share link is only valid for 30 days. Ask your colleague to generate a new one."
            : "This link doesn't exist or has been removed."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="shrink-0 border-b border-border px-5 py-3 flex items-center justify-between">
        <h1 className="text-sm font-semibold truncate">{doc.title}</h1>
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground border border-border rounded-full px-2.5 py-1 shrink-0">
          Read only
        </span>
      </div>
      <div className="flex-1">
        <iframe
          srcDoc={doc.htmlContent}
          title={doc.title}
          className="w-full h-full border-0"
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}
