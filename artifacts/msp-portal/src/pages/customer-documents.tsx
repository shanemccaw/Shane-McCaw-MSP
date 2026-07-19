import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Check,
  Clock,
  Copy,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  Share2,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Report {
  id: number;
  title: string;
  period: string | null;
  filename: string | null;
  createdAt: string | null;
}

interface InsightDocument {
  id: number;
  title: string;
  category: string | null;
  docType: string | null;
  status: string | null;
  deliveredAt: string | null;
  createdAt: string | null;
  sowTotalPrice: number | null;
  projectId: number | null;
  projectTitle: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function docTypeLabel(docType: string | null): string {
  switch (docType) {
    case "scoped_sow": return "Scoped SOW";
    case "consolidated_sow": return "Statement of Work";
    case "sow": return "Statement of Work";
    case "health_report": return "Health Report";
    case "roadmap": return "Roadmap";
    case "assessment": return "Assessment";
    default: return docType?.replace(/_/g, " ") ?? "Document";
  }
}

const DOC_TYPE_COLORS: Record<string, string> = {
  scoped_sow: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  consolidated_sow: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  sow: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  health_report: "bg-green-500/15 text-green-400 border-green-500/30",
  roadmap: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  assessment: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
};

// ── Sub-component: Download button ─────────────────────────────────────────────

function DownloadButton({
  url,
  filename,
  children,
}: {
  url: string;
  filename?: string;
  children?: React.ReactNode;
}) {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(url);
      if (!res.ok) {
        toast.error("Download failed. Please try again.");
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename ?? "document";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error("Download failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 h-7 text-xs"
      onClick={() => void handleDownload()}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Download className="size-3" />
      )}
      {children ?? "Download"}
    </Button>
  );
}

// ── Sub-component: Share dialog ──────────────────────────────────────────────

function ShareDialog({
  docId,
  title,
  onClose,
}: {
  docId: number;
  title: string;
  onClose: () => void;
}) {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchWithAuth(`/api/portal/documents/${docId}/share`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          toast.error("Could not generate a share link. Please try again.");
          return;
        }
        const data = (await res.json()) as { shareUrl: string; expiresAt: string };
        if (mounted) {
          setShareUrl(data.shareUrl);
          setExpiresAt(data.expiresAt);
        }
      })
      .catch(() => toast.error("Could not generate a share link. Please try again."))
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const handleCopy = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => toast.error("Could not copy link. Please copy it manually."));
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share "{title}"</DialogTitle>
          <DialogDescription>
            Anyone with this link can view this document without signing in. The link expires
            in 30 days.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <Skeleton className="h-9 w-full rounded-lg" />
        ) : shareUrl ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input readOnly value={shareUrl} className="text-xs font-mono" onFocus={(e) => e.target.select()} />
              <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={handleCopy}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {expiresAt && (
              <p className="text-xs text-muted-foreground">
                Expires {new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Unable to generate a share link for this document.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-component: Document viewer modal ───────────────────────────────────────

function DocumentViewer({
  docId,
  title,
  onClose,
}: {
  docId: number;
  title: string;
  onClose: () => void;
}) {
  const { fetchWithAuth, accessToken } = useAuth();
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth(`/api/portal/insights-documents/${docId}/view`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { htmlContent: string };
        setHtml(data.htmlContent);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative bg-background rounded-xl border border-border shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
          <div className="flex items-center gap-2 shrink-0">
            <DownloadButton
              url={`/api/portal/insights-documents/${docId}/pdf`}
              filename={`${title.replace(/[^a-zA-Z0-9 ]/g, "")}.pdf`}
            >
              Download PDF
            </DownloadButton>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : html ? (
            <iframe
              srcDoc={html}
              title={title}
              className="w-full h-full border-0"
              sandbox="allow-same-origin"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Document content not available.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CustomerDocumentsPage() {
  const { fetchWithAuth } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [docs, setDocs] = useState<InsightDocument[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [viewingDoc, setViewingDoc] = useState<InsightDocument | null>(null);
  const [sharingDoc, setSharingDoc] = useState<InsightDocument | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/portal/reports")
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as Report[];
        if (mounted) setReports(json);
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoadingReports(false); });

    fetchWithAuth("/api/portal/insights-documents")
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as InsightDocument[];
        if (mounted) setDocs(json);
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoadingDocs(false); });

    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell title="Documents & Reports">
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Documents & Reports</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Your generated reports, assessments, and statements of work.
          </p>
        </div>

        <Tabs defaultValue="documents">
          <TabsList className="grid w-full grid-cols-2 max-w-xs">
            <TabsTrigger value="documents">Assessments & SOWs</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          {/* ── Insight Documents tab ── */}
          <TabsContent value="documents" className="mt-4 space-y-3">
            {loadingDocs ? (
              <>
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-20 w-full rounded-xl" />
              </>
            ) : docs.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
                  <FolderOpen className="size-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No documents yet</p>
                  <p className="text-xs text-muted-foreground/60 max-w-xs">
                    Assessments, roadmaps, and statements of work will appear here once
                    your engagement begins.
                  </p>
                </CardContent>
              </Card>
            ) : (
              docs.map((doc) => (
                <Card key={doc.id}>
                  <CardContent className="flex items-start gap-4 py-4 px-5">
                    <div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                      <FileText className="size-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium truncate">{doc.title}</p>
                        <Badge
                          className={`text-[10px] px-1.5 py-0 h-4 border ${DOC_TYPE_COLORS[doc.docType ?? ""] ?? "bg-muted text-muted-foreground border-border"}`}
                        >
                          {docTypeLabel(doc.docType)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        {doc.projectTitle && (
                          <span>Project: {doc.projectTitle}</span>
                        )}
                        {doc.sowTotalPrice != null && doc.sowTotalPrice > 0 && (
                          <span>
                            ${Number(doc.sowTotalPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {relativeDate(doc.deliveredAt ?? doc.createdAt)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setViewingDoc(doc)}
                      >
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1.5"
                        onClick={() => setSharingDoc(doc)}
                      >
                        <Share2 className="size-3" />
                        Share
                      </Button>
                      <DownloadButton
                        url={`/api/portal/insights-documents/${doc.id}/pdf`}
                        filename={`${(doc.title ?? "document").replace(/[^a-zA-Z0-9 ]/g, "")}.pdf`}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* ── Reports tab ── */}
          <TabsContent value="reports" className="mt-4 space-y-3">
            {loadingReports ? (
              <>
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </>
            ) : reports.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
                  <FolderOpen className="size-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No reports yet</p>
                  <p className="text-xs text-muted-foreground/60 max-w-xs">
                    Weekly and monthly reports will appear here as your engagement progresses.
                  </p>
                </CardContent>
              </Card>
            ) : (
              reports.map((report) => (
                <Card key={report.id}>
                  <CardContent className="flex items-center gap-4 py-4 px-5">
                    <div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <FileText className="size-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{report.title}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {report.period ? `${report.period} report` : "Report"} ·{" "}
                        {relativeDate(report.createdAt)}
                      </p>
                    </div>
                    <DownloadButton
                      url={`/api/portal/reports/${report.id}/download`}
                      filename={report.filename ?? `report-${report.id}.pdf`}
                    />
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Document viewer modal */}
      {viewingDoc && (
        <DocumentViewer
          docId={viewingDoc.id}
          title={viewingDoc.title}
          onClose={() => setViewingDoc(null)}
        />
      )}

      {/* Share dialog */}
      {sharingDoc && (
        <ShareDialog
          docId={sharingDoc.id}
          title={sharingDoc.title}
          onClose={() => setSharingDoc(null)}
        />
      )}
    </AppShell>
  );
}
