import { useEffect, useState } from "react";
import { Check, Copy, Download, FileText, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  useDownloadDocumentPdf,
  useDownloadReportFile,
  useFetchDocumentView,
  useInsightsDocuments,
  useReports,
  useShareDocument,
} from "@/lib/documents-api";
import { LIVE_RENDERED_DOC_TYPES, type WireInsightDocument, type WireReport } from "@/lib/documents-types";

/**
 * Documents (#4003, Feature #1658). Adapted from
 * `Design/portal/design_handoff_full_site/screens/Documents.dc.html` per that
 * package's own instruction to recreate the reference with this codebase's
 * React + Tailwind + shadcn/ui patterns (not port `support.js`), wired per
 * `Design/portal/design_handoff_full_site/docs/documents-contract-pack.md`
 * against the real, live `portal-documents.ts` endpoints.
 *
 * Two real lists, not one: `insights-documents` (documents your provider
 * generated — reports, SOWs, consulting write-ups) and `reports` (files your
 * provider uploaded). The design's own logic class refuses to merge them
 * ("Two lists, not one... merging them would invent a shape neither has").
 *
 * The 7 `LIVE_RENDERED_DOC_TYPES` render live from a tenant's own scan data
 * and have no stored HTML. Per the design's own ledger entry and the contract
 * pack §4 finding, their View/PDF actions are shown disabled with an honest
 * tooltip rather than a button that fails — the live Document Viewer route
 * they'd need (`/copilot-readiness/documents/:id`) does not exist anywhere in
 * `artifacts/portal` yet (#2825/#2866, still open — this build does not build
 * that route; no Design export for it exists either).
 */

type DocStatusKind = "delivered" | "approved" | "review";

const STATUS_STYLE: Record<DocStatusKind, { label: string; className: string }> = {
  delivered: { label: "Delivered", className: "border-status-green/30 bg-status-green/10 text-status-green" },
  approved: { label: "Approved", className: "border-status-blue/30 bg-status-blue/10 text-status-blue" },
  review: { label: "Under review", className: "border-status-amber/30 bg-status-amber/10 text-status-amber" },
};

const PERIOD_LABEL: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  executive_summary: "Executive summary",
  other: "Other",
};

function docStatus(doc: WireInsightDocument): DocStatusKind {
  if (doc.status === "delivered") return "delivered";
  if (doc.docType === "scoped_sow") return "review";
  if (doc.status === "approved") return "approved";
  return "review";
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function docMeta(doc: WireInsightDocument): string {
  const parts: string[] = [];
  parts.push(doc.category === "consulting" ? "Consulting" : doc.docType === "scoped_sow" ? "Statement of work" : "Report");
  if (doc.docType && doc.docType !== "scoped_sow") parts.push(doc.docType);
  if (doc.projectTitle) parts.push(`project: ${doc.projectTitle}`);
  if (doc.sowTotalPrice != null && doc.sowTotalPrice > 0) {
    parts.push(`$${Number(doc.sowTotalPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  }
  const dateLabel = doc.status === "delivered" ? `delivered ${formatDate(doc.deliveredAt ?? doc.createdAt)}` : `scoped ${formatDate(doc.createdAt)}`;
  parts.push(dateLabel);
  return parts.join(" · ");
}

export default function CustomerDocumentsPage() {
  const reportsQuery = useReports();
  const docsQuery = useInsightsDocuments();
  const downloadDocumentPdf = useDownloadDocumentPdf();
  const downloadReportFile = useDownloadReportFile();
  const fetchDocumentView = useFetchDocumentView();
  const shareMutation = useShareDocument();

  const [viewingDoc, setViewingDoc] = useState<WireInsightDocument | null>(null);
  const [viewHtml, setViewHtml] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  const [sharingDoc, setSharingDoc] = useState<WireInsightDocument | null>(null);
  const [pdfBusyId, setPdfBusyId] = useState<number | null>(null);
  const [reportBusyId, setReportBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loading = reportsQuery.isLoading || docsQuery.isLoading;
  const failed = reportsQuery.isError || docsQuery.isError;
  const reports = reportsQuery.data ?? [];
  const docs = docsQuery.data ?? [];
  const isEmpty = !loading && !failed && reports.length === 0 && docs.length === 0;

  const openView = async (doc: WireInsightDocument) => {
    setViewingDoc(doc);
    setViewHtml(null);
    setViewError(null);
    setViewLoading(true);
    try {
      const result = await fetchDocumentView(doc.id);
      setViewHtml(result.htmlContent);
    } catch (err) {
      setViewError(err instanceof Error ? err.message : "Could not open this document.");
    } finally {
      setViewLoading(false);
    }
  };

  const handlePdf = async (doc: WireInsightDocument) => {
    setActionError(null);
    setPdfBusyId(doc.id);
    const err = await downloadDocumentPdf(doc.id, doc.title);
    setPdfBusyId(null);
    if (err) setActionError(err);
  };

  const handleReportDownload = async (report: WireReport) => {
    setActionError(null);
    setReportBusyId(report.id);
    const err = await downloadReportFile(report.id, report.filename);
    setReportBusyId(null);
    if (err) setActionError(err);
  };

  return (
    <div className="flex flex-col gap-4 pb-14">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Documents</h1>
        <span
          title="Two kinds live here: documents your provider generated for you (reports, statements of work, consulting write-ups) and report files they uploaded. Both are read across every login of your organisation."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", failed ? "bg-status-red" : loading ? "bg-muted-foreground" : isEmpty ? "bg-muted-foreground" : "bg-status-green")} />
          {loading
            ? "Reading your documents"
            : failed
              ? "Could not read your documents"
              : isEmpty
                ? "Live — nothing delivered yet"
                : `Live — ${docs.length} generated · ${reports.length} report files`}
        </span>
      </div>

      {loading && (
        <div className="flex flex-col gap-2.5">
          {[0, 1].map((i) => (
            <div key={i} className="flex animate-pulse flex-col gap-2 rounded-xl border border-border/60 bg-muted/10 p-4">
              <div className="h-2.5 w-2/5 rounded-full bg-muted-foreground/20" />
              <div className="h-2 w-1/2 rounded-full bg-muted-foreground/10" />
            </div>
          ))}
        </div>
      )}

      {failed && !loading && (
        <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-4">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">Failed to load your documents</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              A failed read. Nothing is shown below because nothing could be fetched.
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit p-0 text-[11.5px]"
              onClick={() => {
                void reportsQuery.refetch();
                void docsQuery.refetch();
              }}
              data-testid="documents-retry"
            >
              Try again
            </Button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-3 text-xs text-status-red">
          <span className="flex-1">{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {isEmpty && (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <span className="text-[13.5px] font-semibold text-foreground">Nothing has been delivered to you yet</span>
            <span className="max-w-[660px] text-xs leading-relaxed text-muted-foreground">
              Both lists were read successfully and both are empty. Generated documents appear here once your
              provider marks them delivered — a statement of work under review is the one exception, and shows as
              soon as it is scoped. Uploaded report files appear as soon as they are filed.
            </span>
          </CardContent>
        </Card>
      )}

      {!loading && !failed && docs.length > 0 && (
        <Card data-testid="documents-generated">
          <CardContent className="flex flex-col pt-4">
            <div className="flex flex-wrap items-center gap-2.5 pb-2">
              <span className="text-[13.5px] font-semibold text-foreground">Generated for you</span>
              <span className="text-[11px] text-muted-foreground">newest first · delivered, plus statements of work under review</span>
            </div>
            {docs.map((doc) => {
              const live = LIVE_RENDERED_DOC_TYPES.has(doc.docType);
              const status = docStatus(doc);
              const canView = (doc.status === "delivered" || doc.docType === "scoped_sow") && !live;
              const canPdf = (doc.status === "delivered" || doc.status === "approved") && !live;
              const canShare = doc.status === "delivered" || doc.status === "approved" || doc.docType === "scoped_sow";
              return (
                <div key={doc.id} className="flex flex-wrap items-start gap-3 border-t border-border/50 py-2.5 first:border-t-0" data-testid={`documents-generated-row-${doc.id}`}>
                  <div className="flex min-w-[240px] flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12.5px] text-foreground">{doc.title}</span>
                      <Badge variant="outline" className={cn("text-[10px]", STATUS_STYLE[status].className)}>
                        {STATUS_STYLE[status].label}
                      </Badge>
                    </div>
                    <span className="text-[11px] leading-relaxed text-muted-foreground">{docMeta(doc)}</span>
                    {live && (
                      <span className="text-[11px] leading-relaxed text-[#c2a63d]">
                        Renders live — its PDF export currently fails (#2507) and there is no stored copy to view.
                        Your provider can present it to you directly.
                      </span>
                    )}
                  </div>
                  <div className="flex flex-none flex-wrap gap-1.5">
                    {canView ? (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void openView(doc)} data-testid={`documents-view-${doc.id}`}>
                        View
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 cursor-help text-xs opacity-50"
                        disabled
                        title={live ? "This report renders live and has no stored HTML to view here" : "Only a delivered document can be viewed"}
                      >
                        View
                      </Button>
                    )}
                    {canPdf ? (
                      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => void handlePdf(doc)} disabled={pdfBusyId === doc.id} data-testid={`documents-pdf-${doc.id}`}>
                        {pdfBusyId === doc.id ? <Loader2 className="size-3 animate-spin" /> : null}
                        PDF
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 cursor-help text-xs opacity-50"
                        disabled
                        title={live ? "Could not render this report to PDF right now — the live-render route it depends on no longer exists" : "Under review — a PDF is available once approved"}
                      >
                        PDF
                      </Button>
                    )}
                    {canShare && (
                      <Button size="sm" className="h-7 text-xs" onClick={() => setSharingDoc(doc)} data-testid={`documents-share-${doc.id}`}>
                        Share
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            <span className="border-t border-border/50 pt-2.5 text-[10.5px] leading-relaxed text-muted-foreground/70">
              Newest first. Only delivered documents are listed, plus any statement of work still under review. Drafts,
              archived copies and anything mid-generation stay with your provider until delivered.
            </span>
          </CardContent>
        </Card>
      )}

      {!loading && !failed && reports.length > 0 && (
        <Card data-testid="documents-reports">
          <CardContent className="flex flex-col pt-4">
            <div className="flex flex-wrap items-center gap-2.5 pb-2">
              <span className="text-[13.5px] font-semibold text-foreground">Report files</span>
              <span className="text-[11px] text-muted-foreground">uploaded by your provider · newest first</span>
            </div>
            {reports.map((report) => (
              <div key={report.id} className="flex items-center gap-3 border-t border-border/50 py-2.5 first:border-t-0" data-testid={`documents-report-row-${report.id}`}>
                <div className="flex size-8 flex-none items-center justify-center rounded-lg bg-muted">
                  <FileText className="size-4 text-muted-foreground" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[12.5px] text-foreground">{report.title}</span>
                  <span className="truncate font-mono text-[10.5px] text-muted-foreground">{report.filename}</span>
                </div>
                <span className="w-[110px] flex-none text-[11.5px] text-muted-foreground">{PERIOD_LABEL[report.period] ?? report.period}</span>
                <span className="w-[64px] flex-none text-right text-[11.5px] tabular-nums text-muted-foreground">{formatBytes(report.sizeBytes)}</span>
                <span className="w-[80px] flex-none text-right text-[11px] text-muted-foreground">{formatDate(report.reportDate ?? report.createdAt)}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 flex-none gap-1 text-xs"
                  onClick={() => void handleReportDownload(report)}
                  disabled={reportBusyId === report.id}
                  data-testid={`documents-report-download-${report.id}`}
                >
                  {reportBusyId === report.id ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                  Download
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {viewingDoc && (
        <DocumentViewerModal
          title={viewingDoc.title}
          html={viewHtml}
          loading={viewLoading}
          error={viewError}
          onDownloadPdf={() => void handlePdf(viewingDoc)}
          onClose={() => {
            setViewingDoc(null);
            setViewHtml(null);
            setViewError(null);
          }}
        />
      )}

      {sharingDoc && <ShareDocumentDialog doc={sharingDoc} onClose={() => setSharingDoc(null)} />}
    </div>
  );
}

function DocumentViewerModal({
  title,
  html,
  loading,
  error,
  onDownloadPdf,
  onClose,
}: {
  title: string;
  html: string | null;
  loading: boolean;
  error: string | null;
  onDownloadPdf: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" data-testid="documents-view-modal">
      <div className="relative flex h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
          <div className="flex shrink-0 items-center gap-2">
            {!error && (
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={onDownloadPdf}>
                <Download className="size-3" />
                Download PDF
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">{error}</div>
          ) : html ? (
            <iframe srcDoc={html} title={title} className="h-full w-full border-0" sandbox="allow-same-origin" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Document content not available.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ShareDocumentDialog({ doc, onClose }: { doc: WireInsightDocument; onClose: () => void }) {
  const shareMutation = useShareDocument();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    shareMutation.mutate(doc.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  const handleCopy = () => {
    if (!shareMutation.data?.shareUrl) return;
    navigator.clipboard
      .writeText(shareMutation.data.shareUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="documents-share-dialog">
        <DialogHeader>
          <DialogTitle>Share &ldquo;{doc.title}&rdquo;</DialogTitle>
        </DialogHeader>
        {shareMutation.isPending || shareMutation.isIdle ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Creating a share link…
          </div>
        ) : shareMutation.isError ? (
          <p className="text-sm text-muted-foreground">
            {shareMutation.error instanceof Error ? shareMutation.error.message : "Could not generate a share link. Please try again."}
          </p>
        ) : shareMutation.data ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input readOnly value={shareMutation.data.shareUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={handleCopy}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Anyone with this link can read the document without signing in, until{" "}
              {formatDate(shareMutation.data.expiresAt)}. Sharing this document again replaces this link only — a
              colleague's link to a different document keeps working. Views and reading time on the link are
              counted and visible to your provider.
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

