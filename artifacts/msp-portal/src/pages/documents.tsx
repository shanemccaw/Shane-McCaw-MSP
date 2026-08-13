/**
 * MSP Internal Document Library — the MSP's own authored/versioned playbooks,
 * templates, and internal reference material. Distinct from customer-generated
 * reports/SOWs (see customer-documents.tsx / reports.tsx).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  FileText,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";

export interface MspDocument {
  id: number;
  documentId: string;
  mspId: number;
  customerId: number | null;
  ownerType: "customer" | "msp" | "platform";
  title: string;
  documentType: string;
  status: "draft" | "active" | "archived";
  currentVersionId: string | null;
  createdByUserId: number;
  pipelineStatus: string | null;
  pipelineRunId: string | null;
  publishedAt: string | null;
  publishedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-500/20",
  draft: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  archived: "bg-muted text-muted-foreground border-border",
};

const DOC_TYPE_OPTIONS = [
  "general",
  "playbook",
  "template",
  "reference",
  "sop",
  "policy",
];

type SortField = "title" | "documentType" | "status" | "updatedAt";
type SortOrder = "asc" | "desc";

interface DocumentForm {
  title: string;
  documentType: string;
  htmlContent: string;
  changeNote: string;
  autoPublish: boolean;
}

const EMPTY_FORM: DocumentForm = {
  title: "",
  documentType: "general",
  htmlContent: "",
  changeNote: "Initial version",
  autoPublish: false,
};

export default function DocumentsPage() {
  const [, setLocation] = useLocation();
  const { fetchWithAuth } = useAuth();

  const [documents, setDocuments] = useState<MspDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<DocumentForm>(EMPTY_FORM);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchDocuments = useCallback(
    async (status = statusFilter) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (status !== "all") params.set("status", status);
        const res = await fetchWithAuth(`/api/msp/documents?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as { documents: MspDocument[] };
        setDocuments(data.documents ?? []);
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth, statusFilter],
  );

  useEffect(() => {
    void fetchDocuments(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filteredAndSorted = useMemo(() => {
    let result = [...documents];
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (d) => d.title.toLowerCase().includes(q) || d.documentType.toLowerCase().includes(q),
      );
    }
    result.sort((a, b) => {
      let valA: string | number = a[sortField] ?? "";
      let valB: string | number = b[sortField] ?? "";
      if (sortField === "updatedAt") {
        valA = new Date(a.updatedAt).getTime();
        valB = new Date(b.updatedAt).getTime();
      } else if (typeof valA === "string") {
        valA = valA.toLowerCase();
        valB = String(valB).toLowerCase();
      }
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
    return result;
  }, [documents, search, sortField, sortOrder]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (createForm.title.trim().length < 2) {
      setCreateError("Title must be at least 2 characters.");
      return;
    }
    if (createForm.htmlContent.trim().length === 0) {
      setCreateError("Content is required.");
      return;
    }

    setCreateError(null);
    setCreateSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/msp/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createForm.title.trim(),
          documentType: createForm.documentType,
          htmlContent: createForm.htmlContent,
          changeNote: createForm.changeNote.trim() || undefined,
          autoPublish: createForm.autoPublish,
        }),
      });
      const body = (await res.json()) as { documentId?: string; error?: string };
      if (!res.ok || !body.documentId) {
        setCreateError(body.error ?? "Failed to create document");
        return;
      }
      toast.success(`"${createForm.title.trim()}" submitted — pipeline running`);
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
      setLocation(`/documents/${body.documentId}`);
    } catch {
      setCreateError("Unexpected error — please try again.");
    } finally {
      setCreateSubmitting(false);
    }
  }

  const actions = (
    <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" /> New Document
    </Button>
  );

  return (
    <AppShell title="Document Library" actions={actions}>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Top Summary Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Total Documents</p>
              <p className="text-2xl font-bold mt-1">{documents.length}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
              <BookOpen className="size-5" />
            </div>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Published</p>
              <p className="text-2xl font-bold mt-1 text-emerald-400">
                {documents.filter((d) => d.status === "active").length}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Send className="size-5" />
            </div>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Drafts</p>
              <p className="text-2xl font-bold mt-1 text-amber-400">
                {documents.filter((d) => d.status === "draft").length}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400">
              <FileText className="size-5" />
            </div>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Archived</p>
              <p className="text-2xl font-bold mt-1">
                {documents.filter((d) => d.status === "archived").length}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-muted text-muted-foreground">
              <FileText className="size-5" />
            </div>
          </div>
        </div>

        {/* Filters & Search Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="flex flex-1 items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search title or type..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-sm rounded-lg border-border/60 bg-background/50"
              />
            </div>

            <div className="w-40">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 text-sm rounded-lg border-border/60">
                  <div className="flex items-center gap-1.5">
                    <Filter className="size-3.5 text-muted-foreground" />
                    <SelectValue placeholder="All Statuses" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-muted-foreground rounded-lg"
            onClick={() => void fetchDocuments(statusFilter)}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>

        {/* Data Table */}
        <div className="rounded-xl border border-border/60 bg-slate-900/30 backdrop-blur-md overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead
                  className="cursor-pointer font-semibold select-none"
                  onClick={() => handleSort("title")}
                >
                  <div className="flex items-center gap-1.5">
                    Title
                    {sortField === "title" ? (
                      sortOrder === "asc" ? <ArrowUp className="size-3.5 text-primary" /> : <ArrowDown className="size-3.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
                    )}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer font-semibold select-none"
                  onClick={() => handleSort("documentType")}
                >
                  <div className="flex items-center gap-1.5">
                    Type
                    {sortField === "documentType" ? (
                      sortOrder === "asc" ? <ArrowUp className="size-3.5 text-primary" /> : <ArrowDown className="size-3.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
                    )}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer font-semibold select-none"
                  onClick={() => handleSort("status")}
                >
                  <div className="flex items-center gap-1.5">
                    Status
                    {sortField === "status" ? (
                      sortOrder === "asc" ? <ArrowUp className="size-3.5 text-primary" /> : <ArrowDown className="size-3.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="font-semibold">Pipeline</TableHead>
                <TableHead
                  className="cursor-pointer font-semibold select-none"
                  onClick={() => handleSort("updatedAt")}
                >
                  <div className="flex items-center gap-1.5">
                    Last Updated
                    {sortField === "updatedAt" ? (
                      sortOrder === "asc" ? <ArrowUp className="size-3.5 text-primary" /> : <ArrowDown className="size-3.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
                    )}
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : filteredAndSorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-36 text-center text-muted-foreground text-sm">
                    {search || statusFilter !== "all"
                      ? "No documents match your search."
                      : "No documents created yet. Click \"New Document\" to author your first one."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSorted.map((d) => (
                  <TableRow
                    key={d.documentId}
                    className="group hover:bg-slate-800/40 transition-colors cursor-pointer"
                    onClick={() => setLocation(`/documents/${d.documentId}`)}
                  >
                    <TableCell className="font-semibold text-slate-200 group-hover:text-primary transition-colors">
                      {d.title}
                    </TableCell>
                    <TableCell className="text-slate-300 text-sm capitalize">
                      {d.documentType.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`capitalize text-[11px] px-2 py-0.5 border font-medium ${STATUS_COLORS[d.status] ?? ""}`}
                      >
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground capitalize">
                      {d.pipelineStatus === "failed" ? (
                        <span className="text-red-400">failed</span>
                      ) : d.pipelineStatus === "published" || d.status === "active" ? (
                        "—"
                      ) : (
                        (d.pipelineStatus ?? "pending").replace(/_/g, " ")
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(d.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Create Document Dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!createSubmitting) setCreateOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Document</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="doc-title">Title</Label>
              <Input
                id="doc-title"
                value={createForm.title}
                onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Onboarding Playbook"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-type">Document Type</Label>
              <Select
                value={createForm.documentType}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, documentType: v }))}
              >
                <SelectTrigger id="doc-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-content">Content (HTML)</Label>
              <Textarea
                id="doc-content"
                value={createForm.htmlContent}
                onChange={(e) => setCreateForm((f) => ({ ...f, htmlContent: e.target.value }))}
                placeholder="<h1>Playbook Title</h1><p>...</p>"
                className="min-h-32 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-note">Change Note</Label>
              <Input
                id="doc-note"
                value={createForm.changeNote}
                onChange={(e) => setCreateForm((f) => ({ ...f, changeNote: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
              <div>
                <Label htmlFor="doc-autopublish" className="text-sm">Publish immediately</Label>
                <p className="text-xs text-muted-foreground">Skip the draft stage once the pipeline finishes.</p>
              </div>
              <Switch
                id="doc-autopublish"
                checked={createForm.autoPublish}
                onCheckedChange={(c) => setCreateForm((f) => ({ ...f, autoPublish: c }))}
              />
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={createSubmitting} className="gap-1.5">
                {createSubmitting && <Loader2 className="size-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
