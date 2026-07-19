/**
 * AssessmentDocumentViewer.tsx
 *
 * The real content that renders inside the Assessment wizard's unlocked "Review
 * findings" step (task 3). It fills in what task 2 left as a locked placeholder —
 * it does NOT change the wizard's locked-sequential navigation.
 *
 * Two things per document:
 *   1. "OMG cards" — the AI-extracted, most alarming/notable findings, shown
 *      prominently at the top as color-coded severity cards with a big headline
 *      number. This is the conversion hook, so it leads the view, never buried.
 *   2. The full report itself, rendered read-only in a sandboxed iframe from the
 *      document's stored htmlContent — the exact pattern used by customer-sow.tsx
 *      and customer-documents.tsx.
 *
 * The SOW (last document in the sequence) renders here read-only too, through this
 * same viewer. Task 4 layers the interactive scope selector on top of this view;
 * it does not replace it.
 *
 * Content + cards come from GET /api/portal/assessment/documents/:id, which
 * extracts the OMG cards lazily on first open (so we never spend an AI call on a
 * document the customer never opens) and returns the stored cards on later views.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Maximize2,
  ShieldAlert,
  X,
} from "lucide-react";

// Mirrors the doc summary the wizard already holds from the status endpoint.
export interface AssessmentDocumentSummary {
  id: number;
  docType: string;
  category: string;
  title: string;
  status: string;
}

interface OmgCard {
  severity: "red" | "amber" | "green";
  metric: string;
  metricLabel: string;
  headline: string;
  detail: string;
}

interface DocumentPayload {
  id: number;
  docType: string;
  category: string;
  title: string;
  status: string;
  htmlContent: string;
  omgCards: OmgCard[];
}

type FetchWithAuth = (
  path: string,
  init?: RequestInit,
  opts?: { silent?: boolean },
) => Promise<Response>;

// ── Severity styling ────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<
  OmgCard["severity"],
  { card: string; metric: string; chip: string; label: string; icon: typeof ShieldAlert }
> = {
  red: {
    card: "border-red-500/30 bg-red-500/[0.06]",
    metric: "text-red-500",
    chip: "bg-red-500/15 text-red-500",
    label: "Critical",
    icon: ShieldAlert,
  },
  amber: {
    card: "border-amber-500/30 bg-amber-500/[0.06]",
    metric: "text-amber-500",
    chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    label: "Attention",
    icon: AlertTriangle,
  },
  green: {
    card: "border-emerald-500/30 bg-emerald-500/[0.06]",
    metric: "text-emerald-500",
    chip: "bg-emerald-500/15 text-emerald-500",
    label: "Strength",
    icon: CheckCircle2,
  },
};

function OmgCardTile({ card }: { card: OmgCard }) {
  const s = SEVERITY_STYLES[card.severity] ?? SEVERITY_STYLES.amber;
  const Icon = s.icon;
  return (
    <div className={`flex flex-col rounded-2xl border p-5 ${s.card}`}>
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${s.chip}`}>
          <Icon className="size-3" />
          {s.label}
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className={`text-4xl font-extrabold leading-none tracking-tight tabular-nums ${s.metric}`}>
          {card.metric}
        </span>
        <span className="text-xs font-medium text-muted-foreground">{card.metricLabel}</span>
      </div>
      <p className="mt-3 text-sm font-semibold leading-snug text-foreground">{card.headline}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{card.detail}</p>
    </div>
  );
}

// ── Document content (OMG cards + iframe) ─────────────────────────────────────

function DocumentContent({
  documentId,
  fetchWithAuth,
}: {
  documentId: number;
  fetchWithAuth: FetchWithAuth;
}) {
  const [payload, setPayload] = useState<DocumentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const res = await fetchWithAuth(`/api/portal/assessment/documents/${documentId}`);
      if (!res.ok) {
        setErrored(true);
        return;
      }
      setPayload((await res.json()) as DocumentPayload);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, [documentId, fetchWithAuth]);

  useEffect(() => {
    setPayload(null);
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (errored || !payload) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <FileText className="mx-auto size-8 text-muted-foreground/40" />
        <p className="mt-2 text-sm text-muted-foreground">We couldn't load this report just now.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── OMG cards — the hero of the view ── */}
      {payload.omgCards.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">What stood out</h3>
            <span className="text-xs text-muted-foreground">— the findings that matter most</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {payload.omgCards.map((card, i) => (
              <OmgCardTile key={i} card={card} />
            ))}
          </div>
        </div>
      )}

      {/* ── Full report (read-only iframe — same pattern as customer-sow.tsx) ── */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileText className="size-4 text-muted-foreground" />
            Full report
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setFullscreen(true)}
          >
            <Maximize2 className="size-3" />
            Full screen
          </Button>
        </div>
        <iframe
          srcDoc={payload.htmlContent}
          title={payload.title}
          className="w-full border-0 bg-white"
          style={{ height: "560px" }}
          sandbox="allow-same-origin"
        />
      </div>

      {fullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80">
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-background px-5 py-3">
            <p className="truncate text-sm font-semibold text-foreground">{payload.title}</p>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setFullscreen(false)}>
              <X className="size-4" />
              Close
            </Button>
          </div>
          <iframe
            srcDoc={payload.htmlContent}
            title={payload.title}
            className="flex-1 border-0 bg-white"
            sandbox="allow-same-origin"
          />
        </div>
      )}
    </div>
  );
}

// ── Viewer with document selector ─────────────────────────────────────────────

export function AssessmentDocumentViewer({
  documents,
  fetchWithAuth,
}: {
  documents: AssessmentDocumentSummary[];
  fetchWithAuth: FetchWithAuth;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(documents[0]?.id ?? null);

  // Keep a valid selection as the document set loads/changes.
  useEffect(() => {
    if (documents.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !documents.some((d) => d.id === selectedId)) {
      setSelectedId(documents[0].id);
    }
  }, [documents, selectedId]);

  if (documents.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Your reports are being prepared — they'll appear here shortly.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Document selector — one report per row/chip */}
      {documents.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {documents.map((doc) => {
            const active = doc.id === selectedId;
            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => setSelectedId(doc.id)}
                aria-pressed={active}
                className={[
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                  active
                    ? "border-primary/40 bg-primary/5 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted/60",
                ].join(" ")}
              >
                <FileText className={`size-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
                <span className="max-w-[16rem] truncate font-medium">{doc.title}</span>
                {doc.category === "consulting" && (
                  <Badge className="shrink-0 border-none bg-muted text-[9px] uppercase text-muted-foreground">
                    {doc.docType.includes("sow") ? "SOW" : "Plan"}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selectedId != null && (
        <DocumentContent documentId={selectedId} fetchWithAuth={fetchWithAuth} />
      )}
    </div>
  );
}
