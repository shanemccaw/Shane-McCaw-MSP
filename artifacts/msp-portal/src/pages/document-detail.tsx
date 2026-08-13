/**
 * MSP Internal Document detail — current content + real version history,
 * against the existing msp-documents.ts backend (create/list/versions/publish).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  ArrowLeft,
  Clock,
  Eye,
  FileText,
  Loader2,
  Plus,
  Send,
  User,
} from "lucide-react";
import type { MspDocument } from "./documents";

interface DocumentVersionSummary {
  versionId: string;
  documentId: string;
  versionNumber: number;
  contentHash: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  pdfSizeBytes: number | null;
  sharepointFileId: string | null;
  sharepointFileUrl: string | null;
  pipelineStatus: string | null;
  authorUserId: number;
  changeNote: string | null;
  createdAt: string;
}

interface DocumentVersionFull extends DocumentVersionSummary {
  content: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-500/20",
  draft: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  archived: "bg-muted text-muted-foreground border-border",
};

const PIPELINE_LABELS: Record<string, string> = {
  pending: "Queued",
  html_stored: "HTML Stored",
  pdf_generating: "Generating PDF",
  pdf_ready: "PDF Ready",
  sharepoint_uploading: "Uploading to SharePoint",
  sharepoint_uploaded: "Uploaded to SharePoint",
  version_registered: "Version Registered",
  published: "Published",
  failed: "Failed",
};

const IN_FLIGHT_PIPELINE_STATUSES = new Set([
  "pending",
  "html_stored",
  "pdf_generating",
  "pdf_ready",
  "sharepoint_uploading",
  "sharepoint_uploaded",
]);

function pipelineBadgeClass(status: string | null): string {
  if (status === "failed") return "bg-red-500/15 text-red-400 border-red-500/20";
  if (status === "published" || status === "version_registered") {
    return "bg-green-500/15 text-green-400 border-green-500/20";
  }
  if (status == null) return "bg-muted text-muted-foreground border-border";
  return "bg-blue-500/15 text-blue-400 border-blue-500/20";
}

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();

  const [document, setDocument] = useState<MspDocument | null>(null);
  const [versions, setVersions] = useState<DocumentVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [viewingVersion, setViewingVersion] = useState<DocumentVersionFull | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadContent, setUploadContent] = useState("");
  const [uploadNote, setUploadNote] = useState("");
  const [uploadSubmitting, setUploadSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const [docRes, versionsRes] = await Promise.all([
      fetchWithAuth(`/api/msp/documents/${id}`),
      fetchWithAuth(`/api/msp/documents/${id}/versions`),
    ]);
    if (!docRes.ok) {
      setNotFound(true);
      return;
    }
    const docData = (await docRes.json()) as { document: MspDocument | null };
    if (!docData.document) {
      setNotFound(true);
      return;
    }
    setDocument(docData.document);
    if (versionsRes.ok) {
      const vData = (await versionsRes.json()) as { versions: DocumentVersionSummary[] };
      setVersions(vData.versions ?? []);
    }
  }, [fetchWithAuth, id]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchAll().finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Poll while the conversion pipeline is still running so status/version-history stay live.
  useEffect(() => {
    const inFlight = document ? IN_FLIGHT_PIPELINE_STATUSES.has(document.pipelineStatus ?? "") : false;
    if (inFlight && !pollRef.current) {
      pollRef.current = setInterval(() => void fetchAll(), 4000);
    } else if (!inFlight && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [document, fetchAll]);

  async function handlePublish() {
    if (!document) return;
    setPublishing(true);
    try {
      const res = await fetchWithAuth(`/api/msp/documents/${document.documentId}/publish`, {
        method: "POST",
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Failed to publish document");
        return;
      }
      toast.success(`"${document.title}" published`);
      await fetchAll();
    } catch {
      toast.error("Failed to publish document");
    } finally {
      setPublishing(false);
    }
  }

  async function handleViewVersion(versionId: string) {
    setViewLoading(true);
    try {
      const res = await fetchWithAuth(`/api/msp/documents/${id}/versions/${versionId}`);
      if (!res.ok) {
        toast.error("Could not load that version.");
        return;
      }
      const data = (await res.json()) as { version: DocumentVersionFull };
      setViewingVersion(data.version);
    } finally {
      setViewLoading(false);
    }
  }

  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!document) return;
    if (uploadContent.trim().length === 0) {
      setUploadError("Content is required.");
      return;
    }
    setUploadError(null);
    setUploadSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/msp/documents/${document.documentId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          htmlContent: uploadContent,
          changeNote: uploadNote.trim() || undefined,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setUploadError(body.error ?? "Failed to upload new version");
        return;
      }
      toast.success("New version submitted — pipeline running");
      setUploadOpen(false);
      setUploadContent("");
      setUploadNote("");
      await fetchAll();
    } catch {
      setUploadError("Unexpected error — please try again.");
    } finally {
      setUploadSubmitting(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Document">
        <div className="p-6 space-y-6 max-w-5xl mx-auto">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </AppShell>
    );
  }

  if (notFound || !document) {
    return (
      <AppShell title="Document">
        <div className="p-6 space-y-4 max-w-5xl mx-auto">
          <Link href="/documents">
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> Back to Document Library
            </button>
          </Link>
          <p className="text-sm text-muted-foreground">Document not found.</p>
        </div>
      </AppShell>
    );
  }

  const canPublish = !!document.currentVersionId && document.status !== "archived" && document.status !== "active";

  const actions = (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setUploadOpen(true)}>
        <Plus className="size-4" /> Upload New Version
      </Button>
      <Button
        size="sm"
        className="gap-1.5"
        disabled={!canPublish || publishing}
        onClick={() => void handlePublish()}
      >
        {publishing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Publish
      </Button>
    </div>
  );

  return (
    <AppShell title={document.title} actions={actions}>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <Link href="/documents">
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Back to Document Library
          </button>
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold tracking-tight">{document.title}</h2>
              <Badge
                variant="outline"
                className={`capitalize text-[11px] px-2 py-0.5 border font-medium ${STATUS_COLORS[document.status] ?? ""}`}
              >
                {document.status}
              </Badge>
              <Badge variant="outline" className="capitalize text-[11px] px-2 py-0.5 border font-medium">
                {document.documentType.replace(/_/g, " ")}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Created {new Date(document.createdAt).toLocaleString()} · Updated{" "}
              {new Date(document.updatedAt).toLocaleString()}
              {document.publishedAt && <> · Published {new Date(document.publishedAt).toLocaleString()}</>}
            </p>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="bg-slate-900/60 border border-slate-800/80 p-1 rounded-xl flex flex-wrap gap-1 h-auto">
            <TabsTrigger value="overview" className="rounded-lg text-xs font-semibold px-4 py-2">
              Overview
            </TabsTrigger>
            <TabsTrigger value="versions" className="rounded-lg text-xs font-semibold px-4 py-2">
              Version History ({versions.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-slate-900/30 backdrop-blur-md p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium uppercase">Pipeline Status</span>
                <Badge
                  variant="outline"
                  className={`text-[11px] px-2 py-0.5 border font-medium ${pipelineBadgeClass(document.pipelineStatus)}`}
                >
                  {document.pipelineStatus ? PIPELINE_LABELS[document.pipelineStatus] ?? document.pipelineStatus : "—"}
                </Badge>
              </div>
              {IN_FLIGHT_PIPELINE_STATUSES.has(document.pipelineStatus ?? "") && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" /> Conversion pipeline running — this page refreshes automatically.
                </p>
              )}
              {document.pipelineStatus === "failed" && (
                <p className="text-xs text-red-400">
                  The document pipeline failed on its last run. Uploading a new version will retry it.
                </p>
              )}
              {!document.currentVersionId && !IN_FLIGHT_PIPELINE_STATUSES.has(document.pipelineStatus ?? "") && (
                <p className="text-xs text-muted-foreground">
                  No version has completed the pipeline yet.
                </p>
              )}
            </div>

            {document.currentVersionId && (
              <div className="rounded-xl border border-border/60 bg-slate-900/30 backdrop-blur-md p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground font-medium uppercase">Current Version</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => void handleViewVersion(document.currentVersionId!)}
                    disabled={viewLoading}
                  >
                    {viewLoading ? <Loader2 className="size-3 animate-spin" /> : <Eye className="size-3" />}
                    View Content
                  </Button>
                </div>
                {versions.find((v) => v.versionId === document.currentVersionId) ? (
                  <p className="text-sm text-slate-300">
                    Version {versions.find((v) => v.versionId === document.currentVersionId)?.versionNumber} —{" "}
                    {versions.find((v) => v.versionId === document.currentVersionId)?.changeNote || "No change note"}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Version details loading…</p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="versions" className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-slate-900/30 backdrop-blur-md overflow-hidden shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="font-semibold">Version</TableHead>
                    <TableHead className="font-semibold">Change Note</TableHead>
                    <TableHead className="font-semibold">Pipeline</TableHead>
                    <TableHead className="font-semibold">Size</TableHead>
                    <TableHead className="font-semibold">Created</TableHead>
                    <TableHead className="w-24 text-right font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-28 text-center text-muted-foreground text-sm">
                        No versions yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    versions.map((v) => (
                      <TableRow key={v.versionId} className="hover:bg-slate-800/40 transition-colors">
                        <TableCell className="font-semibold text-slate-200">
                          <div className="flex items-center gap-2">
                            v{v.versionNumber}
                            {v.versionId === document.currentVersionId && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-primary/40 text-primary">
                                Current
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-slate-300 max-w-xs truncate">
                          {v.changeNote || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[11px] px-2 py-0.5 border font-medium ${pipelineBadgeClass(v.pipelineStatus)}`}
                          >
                            {v.pipelineStatus ? PIPELINE_LABELS[v.pipelineStatus] ?? v.pipelineStatus : "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatBytes(v.pdfSizeBytes ?? v.sizeBytes)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {new Date(v.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => void handleViewVersion(v.versionId)}
                          >
                            <Eye className="size-3" /> View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Version content viewer */}
      {viewingVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="relative bg-background rounded-xl border border-border shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <h3 className="text-sm font-semibold text-foreground truncate flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" />
                {document.title} — v{viewingVersion.versionNumber}
              </h3>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="size-3" /> User #{viewingVersion.authorUserId}
                </span>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setViewingVersion(null)}>
                  Close
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {viewingVersion.content ? (
                <iframe
                  srcDoc={viewingVersion.content}
                  title={`${document.title} v${viewingVersion.versionNumber}`}
                  className="w-full h-full border-0 bg-white"
                  sandbox="allow-same-origin"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  This version has no stored content yet — the pipeline may still be running.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload New Version Dialog */}
      <Dialog open={uploadOpen} onOpenChange={(open) => { if (!uploadSubmitting) setUploadOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload New Version</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUploadSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="version-content">Content (HTML)</Label>
              <Textarea
                id="version-content"
                value={uploadContent}
                onChange={(e) => setUploadContent(e.target.value)}
                placeholder="<h1>Updated content</h1>..."
                className="min-h-32 font-mono text-xs"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="version-note">Change Note</Label>
              <Input
                id="version-note"
                value={uploadNote}
                onChange={(e) => setUploadNote(e.target.value)}
                placeholder="What changed in this version?"
              />
            </div>
            {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setUploadOpen(false)} disabled={uploadSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={uploadSubmitting} className="gap-1.5">
                {uploadSubmitting && <Loader2 className="size-4 animate-spin" />}
                Upload
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
