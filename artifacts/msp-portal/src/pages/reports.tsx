/**
 * Reports — MSP Report Builder & Run History
 *
 * MSPAdmin/MSPOperator can:
 *   - Browse and manage report definitions (templates)
 *   - Create new definitions with docType, delivery settings, scope
 *   - Trigger generation on demand
 *   - Browse run history with status and PDF download
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Mail,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReportDefinition {
  id: number;
  definitionId: string;
  mspId: number;
  customerId: number | null;
  name: string;
  description: string | null;
  docType: string;
  deliveryMethod: string;
  deliveryEmail: string | null;
  fieldMappings: Record<string, unknown>;
  scheduleConfig: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

interface ReportRun {
  id: number;
  runId: string;
  definitionId: string;
  mspId: number;
  customerId: number | null;
  title: string;
  docType: string;
  status: string;
  pdfSizeBytes: number | null;
  deliveredAt: string | null;
  deliveryEmail: string | null;
  errorMessage: string | null;
  generatedAt: string | null;
  createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: "executive_summary", label: "Executive Summary" },
  { value: "full_readiness_report", label: "Full Readiness Report" },
  { value: "security_posture_report", label: "Security Posture Report" },
  { value: "governance_maturity_report", label: "Governance Maturity Report" },
  { value: "data_exposure_risk_report", label: "Data Exposure Risk Report" },
  { value: "license_optimization_report", label: "License Optimization Report" },
  { value: "license_waste_report", label: "License Waste Analysis" },
];

const DELIVERY_METHODS = [
  { value: "in_app", label: "In-App Download Only" },
  { value: "email", label: "Email Delivery" },
  { value: "both", label: "In-App + Email" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  generating: "bg-blue-500/15 text-blue-400",
  generated: "bg-green-500/15 text-green-400",
  delivering: "bg-amber-500/15 text-amber-400",
  delivered: "bg-green-500/15 text-green-400",
  failed: "bg-red-500/15 text-red-400",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  generating: "Generating…",
  generated: "Generated",
  delivering: "Delivering…",
  delivered: "Delivered",
  failed: "Failed",
};

// ── Create/Edit Definition Dialog ─────────────────────────────────────────────

function DefinitionDialog({
  open,
  onClose,
  existing,
  onSaved,
  fetchWithAuth,
}: {
  open: boolean;
  onClose: () => void;
  existing?: ReportDefinition | null;
  onSaved: () => void;
  fetchWithAuth: ReturnType<typeof useAuth>["fetchWithAuth"];
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [docType, setDocType] = useState(existing?.docType ?? "executive_summary");
  const [deliveryMethod, setDeliveryMethod] = useState(existing?.deliveryMethod ?? "in_app");
  const [deliveryEmail, setDeliveryEmail] = useState(existing?.deliveryEmail ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? "");
      setDescription(existing?.description ?? "");
      setDocType(existing?.docType ?? "executive_summary");
      setDeliveryMethod(existing?.deliveryMethod ?? "in_app");
      setDeliveryEmail(existing?.deliveryEmail ?? "");
    }
  }, [open, existing]);

  async function handleSave() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const url = existing
        ? `/api/msp/reports/definitions/${existing.definitionId}`
        : "/api/msp/reports/definitions";
      const method = existing ? "PATCH" : "POST";
      const res = await fetchWithAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, docType, deliveryMethod, deliveryEmail: deliveryEmail.trim() || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        toast.error(err.error ?? "Failed to save");
        return;
      }
      toast.success(existing ? "Definition updated" : "Definition created");
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Report Definition" : "New Report Definition"}</DialogTitle>
          <DialogDescription>
            Define the report type, delivery settings, and any context for the AI generator.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              placeholder="e.g. Monthly License Review"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description / Additional Context</Label>
            <Textarea
              placeholder="Optional — describe focus areas or special instructions for the AI…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Report Type</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Delivery</Label>
            <Select value={deliveryMethod} onValueChange={setDeliveryMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIVERY_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(deliveryMethod === "email" || deliveryMethod === "both") && (
            <div className="space-y-1.5">
              <Label>Delivery Email</Label>
              <Input
                type="email"
                placeholder="client@example.com"
                value={deliveryEmail}
                onChange={(e) => setDeliveryEmail(e.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
            {existing ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Definition Card ───────────────────────────────────────────────────────────

function DefinitionCard({
  def,
  onEdit,
  onDelete,
  onTrigger,
  triggeringId,
}: {
  def: ReportDefinition;
  onEdit: (d: ReportDefinition) => void;
  onDelete: (d: ReportDefinition) => void;
  onTrigger: (d: ReportDefinition) => void;
  triggeringId: string | null;
}) {
  const docType = DOC_TYPES.find((t) => t.value === def.docType);
  const delivery = DELIVERY_METHODS.find((m) => m.value === def.deliveryMethod);
  const isTriggering = triggeringId === def.definitionId;

  return (
    <Card className={def.isActive ? "" : "opacity-50"}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{def.name}</CardTitle>
            <CardDescription className="text-xs mt-0.5 truncate">
              {docType?.label ?? def.docType}
              {def.deliveryEmail && (
                <span className="ml-2 inline-flex items-center gap-1">
                  <Mail className="size-3" />
                  {def.deliveryEmail}
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="outline" className="text-[10px]">
              {delivery?.label ?? def.deliveryMethod}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {def.description && (
          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{def.description}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={() => onTrigger(def)}
            disabled={isTriggering || !def.isActive}
          >
            {isTriggering ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Play className="size-3" />
            )}
            {isTriggering ? "Triggering…" : "Generate Now"}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onEdit(def)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(def)}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Run Row ───────────────────────────────────────────────────────────────────

function RunRow({ run, onDownload }: { run: ReportRun; onDownload: (r: ReportRun) => void }) {
  const statusColor = STATUS_COLORS[run.status] ?? "bg-muted text-muted-foreground";
  const statusLabel = STATUS_LABELS[run.status] ?? run.status;
  const canDownload = run.status === "generated" || run.status === "delivered";

  return (
    <div className="flex items-center gap-3 py-3 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{run.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {new Date(run.createdAt).toLocaleString()}
          {run.generatedAt && ` · Generated ${new Date(run.generatedAt).toLocaleString()}`}
          {run.pdfSizeBytes && ` · ${(run.pdfSizeBytes / 1024).toFixed(0)} KB`}
        </p>
        {run.errorMessage && (
          <p className="text-xs text-red-400 mt-0.5 truncate">{run.errorMessage}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge className={`text-[10px] ${statusColor}`}>{statusLabel}</Badge>
        {canDownload && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => onDownload(run)}
          >
            <Download className="size-3" />
            PDF
          </Button>
        )}
        {run.deliveryEmail && run.status === "delivered" && (
          <Check className="size-4 text-green-400 shrink-0" aria-label={`Delivered to ${run.deliveryEmail}`} />
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { fetchWithAuth } = useAuth();

  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ReportDefinition | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReportDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [tab, setTab] = useState<"definitions" | "runs">("definitions");

  const fetchDefinitions = useCallback(async () => {
    setLoadingDefs(true);
    try {
      const res = await fetchWithAuth("/api/msp/reports/definitions");
      if (!res.ok) return;
      const data = await res.json() as { definitions: ReportDefinition[] };
      setDefinitions(data.definitions);
    } finally {
      setLoadingDefs(false);
    }
  }, [fetchWithAuth]);

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await fetchWithAuth("/api/msp/reports/runs?limit=50");
      if (!res.ok) return;
      const data = await res.json() as { runs: ReportRun[] };
      setRuns(data.runs);
    } finally {
      setLoadingRuns(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void fetchDefinitions(); }, [fetchDefinitions]);
  useEffect(() => { void fetchRuns(); }, [fetchRuns]);

  async function handleTrigger(def: ReportDefinition) {
    setTriggeringId(def.definitionId);
    try {
      const res = await fetchWithAuth(`/api/msp/reports/definitions/${def.definitionId}/trigger`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        toast.error(err.error ?? "Failed to trigger report");
        return;
      }
      const data = await res.json() as { runId: string; title: string };
      toast.success(`Report triggered: ${data.title}`);
      setTab("runs");
      void fetchRuns();
      // Poll for completion
      const poll = setInterval(async () => {
        const r = await fetchWithAuth(`/api/msp/reports/runs/${data.runId}`);
        if (!r.ok) { clearInterval(poll); return; }
        const d = await r.json() as { run: ReportRun };
        if (d.run.status !== "pending" && d.run.status !== "generating") {
          clearInterval(poll);
          void fetchRuns();
        }
      }, 3000);
      setTimeout(() => clearInterval(poll), 120_000);
    } finally {
      setTriggeringId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/msp/reports/definitions/${deleteTarget.definitionId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed to delete definition");
        return;
      }
      toast.success("Definition removed");
      setDeleteTarget(null);
      void fetchDefinitions();
    } finally {
      setDeleting(false);
    }
  }

  async function handleDownload(run: ReportRun) {
    try {
      const res = await fetchWithAuth(`/api/msp/reports/runs/${run.runId}/download`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to download" })) as { error?: string };
        toast.error(err.error ?? "Download failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${run.title.replace(/[^a-zA-Z0-9\s-]/g, "").trim()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed");
    }
  }

  return (
    <AppShell
      title="Reports"
      actions={
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => { setEditTarget(null); setDialogOpen(true); }}
        >
          <Plus className="size-3.5" />
          New Definition
        </Button>
      }
    >
      <div className="p-6 space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Report Builder</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Define and generate customer-facing and internal reports. Reports render to PDF and can be delivered by email.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 bg-muted/40 rounded-lg p-1 w-fit">
          {(["definitions", "runs"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                tab === t
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {t === "definitions" ? "Report Definitions" : "Run History"}
            </button>
          ))}
        </div>

        {/* Definitions tab */}
        {tab === "definitions" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {loadingDefs ? "Loading…" : `${definitions.length} definition${definitions.length !== 1 ? "s" : ""}`}
              </p>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void fetchDefinitions()}>
                <RefreshCw className="size-3.5" />
                Refresh
              </Button>
            </div>

            {loadingDefs ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-3 w-24 mt-1" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-7 w-28" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : definitions.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <FileText className="size-10 text-muted-foreground/50 mb-3" />
                  <p className="font-medium">No report definitions yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Create a definition to start generating reports for your customers.
                  </p>
                  <Button
                    className="mt-4 gap-1.5"
                    onClick={() => { setEditTarget(null); setDialogOpen(true); }}
                  >
                    <Plus className="size-3.5" />
                    Create First Definition
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {definitions.map((def) => (
                  <DefinitionCard
                    key={def.definitionId}
                    def={def}
                    onEdit={(d) => { setEditTarget(d); setDialogOpen(true); }}
                    onDelete={(d) => setDeleteTarget(d)}
                    onTrigger={(d) => void handleTrigger(d)}
                    triggeringId={triggeringId}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Runs tab */}
        {tab === "runs" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {loadingRuns ? "Loading…" : `${runs.length} run${runs.length !== 1 ? "s" : ""}`}
              </p>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void fetchRuns()}>
                <RefreshCw className="size-3.5" />
                Refresh
              </Button>
            </div>

            {loadingRuns ? (
              <Card>
                <CardContent className="py-4 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="flex-1">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-32 mt-1" />
                      </div>
                      <Skeleton className="h-6 w-16 rounded-full" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : runs.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Play className="size-10 text-muted-foreground/50 mb-3" />
                  <p className="font-medium">No runs yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Trigger a report definition to generate your first report.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setTab("definitions")}
                  >
                    View Definitions
                    <ChevronRight className="size-3.5 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-2 px-4">
                  {runs.map((run) => (
                    <RunRow key={run.runId} run={run} onDownload={(r) => void handleDownload(r)} />
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <DefinitionDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditTarget(null); }}
        existing={editTarget}
        onSaved={() => void fetchDefinitions()}
        fetchWithAuth={fetchWithAuth}
      />

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-400" />
              Remove Definition
            </DialogTitle>
            <DialogDescription>
              This will deactivate &ldquo;{deleteTarget?.name}&rdquo;. Existing runs will not be affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
