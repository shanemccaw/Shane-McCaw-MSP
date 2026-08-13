/**
 * MSP-Wide Customer Documents Hub — aggregated, filterable view of every
 * customer-generated document (assessment reports, SOWs, generated
 * deliverables) across the caller's entire book, so MSP staff don't have to
 * open each customer individually to find one. Distinct from documents.tsx
 * (the MSP's own internal document library) and from customer-documents.tsx
 * (a single customer's own self-service view of their documents).
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  Share2,
} from "lucide-react";
import { toast } from "sonner";

interface HubDocument {
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
  customerId: number | null;
  customerName: string | null;
  deepLink: string | null;
}

const PAGE_SIZE = 25;

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

// ── Download button ─────────────────────────────────────────────────────────

function DownloadButton({ url, filename }: { url: string; filename: string }) {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(url);
      if (!res.ok) { toast.error("Download failed. Please try again."); return; }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
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
    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => void handleDownload()} disabled={loading}>
      {loading ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
      Download
    </Button>
  );
}

// ── Share dialog (creates a link via the MSP-scoped share endpoint, which
// writes to the SAME quick_win_result_shares table/token pattern the
// existing customer self-service share flow uses) ──────────────────────────

function ShareDialog({ docId, title, onClose }: { docId: number; title: string; onClose: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchWithAuth(`/api/msp/documents-hub/${docId}/share`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) { toast.error("Could not generate a share link. Please try again."); return; }
        const data = (await res.json()) as { shareUrl: string; expiresAt: string };
        if (mounted) { setShareUrl(data.shareUrl); setExpiresAt(data.expiresAt); }
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
            Anyone with this link can view this document without signing in. The link expires in 30 days.
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

// ── Document viewer modal (same sandboxed-iframe pattern as
// AssessmentDocumentViewer.tsx / customer-documents.tsx) ───────────────────

function DocumentViewer({ docId, title, onClose }: { docId: number; title: string; onClose: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth(`/api/msp/documents-hub/${docId}/view`)
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
          <div className="flex items-center gap-2 shrink-0">
            <DownloadButton
              url={`/api/msp/documents-hub/${docId}/pdf`}
              filename={`${title.replace(/[^a-zA-Z0-9 ]/g, "")}.pdf`}
            />
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>Close</Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : html ? (
            <iframe srcDoc={html} title={title} className="w-full h-full border-0" sandbox="allow-same-origin" />
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

// ── Main page ────────────────────────────────────────────────────────────────

export default function DocumentsHubPage() {
  const { fetchWithAuth, user } = useAuth();

  const [documents, setDocuments] = useState<HubDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);

  const [customerId, setCustomerId] = useState<string>("all");
  const [docType, setDocType] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [offset, setOffset] = useState(0);

  const [viewingDoc, setViewingDoc] = useState<HubDocument | null>(null);
  const [sharingDoc, setSharingDoc] = useState<HubDocument | null>(null);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/msp/customers?limit=200&mspId=${user?.mspId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { customers: { id: number; name: string }[] };
      setCustomers(data.customers || []);
    } catch {
      // ignore
    }
  }, [fetchWithAuth, user?.mspId]);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (customerId !== "all") params.set("customerId", customerId);
      if (docType !== "all") params.set("docType", docType);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));

      const res = await fetchWithAuth(`/api/msp/documents-hub?${params.toString()}`);
      if (!res.ok) { setDocuments([]); setTotal(0); return; }
      const data = (await res.json()) as { documents: HubDocument[]; total: number };
      setDocuments(data.documents || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, customerId, docType, dateFrom, dateTo, offset]);

  useEffect(() => { void fetchCustomers(); }, [fetchCustomers]);
  useEffect(() => { void fetchDocuments(); }, [fetchDocuments]);

  const docTypes = Array.from(new Set(documents.map((d) => d.docType).filter((v): v is string => !!v))).sort();

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">Customer Documents</h1>
            <p className="text-sm text-muted-foreground">
              Every generated document — assessments, SOWs, health reports — across all customers in your book.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setOffset(0); }}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Customer" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={docType} onValueChange={(v) => { setDocType(v); setOffset(0); }}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Document Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {docTypes.map((dt) => (
                <SelectItem key={dt} value={dt}>{docTypeLabel(dt)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setOffset(0); }}
            className="w-[160px]"
            placeholder="From"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setOffset(0); }}
            className="w-[160px]"
            placeholder="To"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {loading ? "Loading…" : `${total} document${total === 1 ? "" : "s"}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
            ) : documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                <FolderOpen className="size-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No documents match the current filters</p>
              </div>
            ) : (
              documents.map((doc) => (
                <div key={doc.id} className="flex items-start gap-4 rounded-md border p-3">
                  <div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <FileText className="size-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{doc.title}</p>
                      <Badge className={`text-[10px] px-1.5 py-0 h-4 border ${DOC_TYPE_COLORS[doc.docType ?? ""] ?? "bg-muted text-muted-foreground border-border"}`}>
                        {docTypeLabel(doc.docType)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      {doc.customerName && (
                        doc.deepLink ? (
                          <Link href={doc.deepLink} className="hover:underline">{doc.customerName}</Link>
                        ) : (
                          <span>{doc.customerName}</span>
                        )
                      )}
                      {doc.projectTitle && <span>Project: {doc.projectTitle}</span>}
                      {doc.sowTotalPrice != null && Number(doc.sowTotalPrice) > 0 && (
                        <span>${Number(doc.sowTotalPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                      )}
                      <span>{relativeDate(doc.deliveredAt ?? doc.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {doc.deepLink && (
                      <Link href={doc.deepLink}>
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                          Customer <ChevronRight className="size-3" />
                        </Button>
                      </Link>
                    )}
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setViewingDoc(doc)}>
                      View
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setSharingDoc(doc)}>
                      <Share2 className="size-3" />
                      Share
                    </Button>
                    <DownloadButton
                      url={`/api/msp/documents-hub/${doc.id}/pdf`}
                      filename={`${(doc.title ?? "document").replace(/[^a-zA-Z0-9 ]/g, "")}.pdf`}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>

      {viewingDoc && (
        <DocumentViewer docId={viewingDoc.id} title={viewingDoc.title} onClose={() => setViewingDoc(null)} />
      )}
      {sharingDoc && (
        <ShareDialog docId={sharingDoc.id} title={sharingDoc.title} onClose={() => setSharingDoc(null)} />
      )}
    </AppShell>
  );
}
