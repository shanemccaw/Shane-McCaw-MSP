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
import { Switch } from "@/components/ui/switch";
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
  Layout as LayoutIcon,
  Calendar,
  ChevronLeft,
  Edit,
  Eye,
  Settings,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import GridLayout, { Layout } from "react-grid-layout";
import { WidthProvider } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

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

// ── Canvas Types & Constants ──────────────────────────────────────────────────

interface MspReportCanvas {
  id: string;
  mspId: number;
  name: string;
  description: string | null;
  canvasLayout: {
    layout: { i: string; x: number; y: number; w: number; h: number }[];
    widgets: Record<string, {
      type: "billing" | "open_items" | "telemetry" | "rich_text";
      properties?: {
        content?: string;
      };
    }>;
  };
  deliveryConfig: {
    sendAsHtmlEmail: boolean;
    attachPdf: boolean;
    recipientType: "msp_admin" | "customer_contacts";
  };
  createdAt: string;
  updatedAt: string;
}

interface MspReportSchedule {
  id: string;
  mspId: number;
  canvasId: string;
  cadence: "daily" | "weekly" | "monthly";
  recipientEmails: string[];
  enabled: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

const DEFAULT_BRANDING_CONTENT = `<div style="background-color: #0A2540; padding: 24px; text-align: center; border-radius: 8px; color: #ffffff; font-family: 'Segoe UI', Arial, sans-serif;">
  <h2 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">Shane McCaw Consulting</h2>
  <p style="margin: 6px 0 0 0; font-size: 14px; color: #94a3b8;">Managed Services & Systems Security</p>
  <div style="margin-top: 12px; height: 1px; background-color: #334155; display: inline-block; width: 60px;"></div>
</div>`;

const DEFAULT_RICH_TEXT_CONTENT = `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #334155;">
  <h3 style="margin-top: 0; font-size: 16px; color: #0A2540;">Executive Summary Insights</h3>
  <p style="margin: 6px 0; font-size: 14px; line-height: 1.5;">This custom report covers our monthly review of billing, outstanding operations, and infrastructure telemetry. All systems remain within compliance thresholds.</p>
</div>`;

// @ts-ignore
const ResponsiveGridLayout = WidthProvider(GridLayout) as any;

function CanvasCard({
  canvas,
  schedule,
  onEdit,
  onDelete,
  onSendTest,
}: {
  canvas: MspReportCanvas;
  schedule?: MspReportSchedule;
  onEdit: (c: MspReportCanvas) => void;
  onDelete: (c: MspReportCanvas) => void;
  onSendTest: (c: MspReportCanvas) => void;
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{canvas.name}</CardTitle>
            <CardDescription className="text-xs truncate mt-0.5">
              {canvas.description || "No description"}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {schedule?.enabled ? (
              <Badge className="bg-green-500/15 text-green-400 border border-green-500/20 text-[10px] capitalize">
                {schedule.cadence}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                No Schedule
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-xs text-muted-foreground mb-3 space-y-1">
          <p>
            Email: {canvas.deliveryConfig?.sendAsHtmlEmail ? "Inline HTML" : "None"} · PDF Attachment:{" "}
            {canvas.deliveryConfig?.attachPdf ? "Enabled" : "Disabled"}
          </p>
          {schedule?.enabled && (
            <p className="truncate">
              Recipients: {schedule.recipientEmails?.join(", ") || "None"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" className="h-7 text-xs" onClick={() => onEdit(canvas)}>
            Edit Layout
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs font-medium" onClick={() => onSendTest(canvas)}>
            Send Test
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground hover:text-destructive ml-auto"
            onClick={() => onDelete(canvas)}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { fetchWithAuth, user } = useAuth();

  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);

  // Definition edit/delete state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ReportDefinition | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReportDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Tab switcher ("definitions" | "canvases" | "runs")
  const [tab, setTab] = useState<"definitions" | "canvases" | "runs">("definitions");

  // Custom Canvases state
  const [canvases, setCanvases] = useState<MspReportCanvas[]>([]);
  const [schedules, setSchedules] = useState<MspReportSchedule[]>([]);
  const [loadingCanvases, setLoadingCanvases] = useState(true);

  // Editor Workspace states
  const [editingCanvas, setEditingCanvas] = useState<MspReportCanvas | null>(null);
  const [isCreatingCanvas, setIsCreatingCanvas] = useState(false);
  const [layouts, setLayouts] = useState<Layout>([]);
  const [widgets, setWidgets] = useState<Record<string, any>>({});
  const [sendAsHtmlEmail, setSendAsHtmlEmail] = useState(false);
  const [attachPdf, setAttachPdf] = useState(true);
  const [savingCanvas, setSavingCanvas] = useState(false);

  // Editor schedule state
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleCadence, setScheduleCadence] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [scheduleRecipientEmails, setScheduleRecipientEmails] = useState("");
  const [scheduleId, setScheduleId] = useState<string | null>(null);

  // Edit custom text modal
  const [richTextDialogOpen, setRichTextDialogOpen] = useState(false);
  const [activeEditingWidgetId, setActiveEditingWidgetId] = useState<string | null>(null);
  const [richTextContent, setRichTextContent] = useState("");

  // Canvas delete states
  const [deleteCanvasTarget, setDeleteCanvasTarget] = useState<MspReportCanvas | null>(null);
  const [deletingCanvas, setDeletingCanvas] = useState(false);

  // Customers for test email
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);
  const [sendTestOpen, setSendTestOpen] = useState(false);
  const [testRecipientEmail, setTestRecipientEmail] = useState("");
  const [testCustomerId, setTestCustomerId] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [sendTestTargetCanvas, setSendTestTargetCanvas] = useState<MspReportCanvas | null>(null);

  const pageActions = (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => {
          setIsCreatingCanvas(true);
          setEditingCanvas({
            id: "",
            mspId: user?.mspId ?? 0,
            name: "New Custom Report",
            description: "",
            canvasLayout: {
              layout: [
                { i: "widget-header", x: 0, y: 0, w: 12, h: 2 }
              ],
              widgets: {
                "widget-header": {
                  type: "rich_text",
                  properties: { content: DEFAULT_BRANDING_CONTENT }
                }
              }
            },
            deliveryConfig: {
              sendAsHtmlEmail: false,
              attachPdf: true,
              recipientType: "msp_admin"
            },
            createdAt: "",
            updatedAt: ""
          });
          setScheduleEnabled(false);
          setScheduleCadence("weekly");
          setScheduleRecipientEmails(user?.email ?? "");
          setScheduleId(null);
        }}
      >
        <Plus className="size-3.5" />
        New Canvas Report
      </Button>
      <Button
        size="sm"
        className="gap-1.5"
        onClick={() => { setEditTarget(null); setDialogOpen(true); }}
      >
        <Plus className="size-3.5" />
        New Definition
      </Button>
    </div>
  );

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

  const fetchCanvases = useCallback(async () => {
    setLoadingCanvases(true);
    try {
      const res = await fetchWithAuth(`/api/msp/reports/canvases?mspId=${user?.mspId}`);
      if (!res.ok) return;
      const data = await res.json() as { canvases: MspReportCanvas[] };
      setCanvases(data.canvases || []);
    } finally {
      setLoadingCanvases(false);
    }
  }, [fetchWithAuth, user?.mspId]);

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/msp/reports/schedules?mspId=${user?.mspId}`);
      if (!res.ok) return;
      const data = await res.json() as { schedules: MspReportSchedule[] };
      setSchedules(data.schedules || []);
    } catch {
      // ignore
    }
  }, [fetchWithAuth, user?.mspId]);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/msp/customers?limit=100&mspId=${user?.mspId}`);
      if (!res.ok) return;
      const data = await res.json() as { customers: { id: number; name: string }[] };
      setCustomers(data.customers || []);
    } catch {
      // ignore
    }
  }, [fetchWithAuth, user?.mspId]);

  useEffect(() => { void fetchDefinitions(); }, [fetchDefinitions]);
  useEffect(() => { void fetchRuns(); }, [fetchRuns]);
  
  useEffect(() => {
    if (user?.mspId) {
      void fetchCanvases();
      void fetchSchedules();
      void fetchCustomers();
    }
  }, [user?.mspId, fetchCanvases, fetchSchedules, fetchCustomers]);

  // ── Test Email Trigger ──────────────────────────────────────────────────────
  const handleOpenSendTest = (canvas: MspReportCanvas) => {
    setSendTestTargetCanvas(canvas);
    setTestRecipientEmail(user?.email ?? "");
    if (customers.length > 0) {
      setTestCustomerId(String(customers[0].id));
    }
    setSendTestOpen(true);
  };

  const handleSendTest = async () => {
    if (!sendTestTargetCanvas) return;
    if (!testRecipientEmail) {
      toast.error("Recipient email is required");
      return;
    }
    if (!testCustomerId) {
      toast.error("Customer context is required");
      return;
    }
    setSendingTest(true);
    try {
      const url = `/api/msp/reports/canvases/${sendTestTargetCanvas.id}/send-test?mspId=${user?.mspId}`;
      const res = await fetchWithAuth(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmail: testRecipientEmail.trim(),
          customerId: Number(testCustomerId),
        }),
      });
      if (res.ok) {
        toast.success("Test email dispatched successfully!");
        setSendTestOpen(false);
      }
    } finally {
      setSendingTest(false);
    }
  };

  // ── Canvas CRUD ─────────────────────────────────────────────────────────────
  const handleOpenEditor = (canvas: MspReportCanvas) => {
    setIsCreatingCanvas(false);
    setEditingCanvas(canvas);
    
    // Parse canvasLayout
    const parsedLayout = canvas.canvasLayout?.layout || [];
    const parsedWidgets = canvas.canvasLayout?.widgets || {};
    setLayouts(parsedLayout);
    setWidgets(parsedWidgets);

    // Set delivery config
    setSendAsHtmlEmail(canvas.deliveryConfig?.sendAsHtmlEmail ?? false);
    setAttachPdf(canvas.deliveryConfig?.attachPdf ?? true);

    // Find schedule
    const sched = schedules.find(s => s.canvasId === canvas.id);
    if (sched) {
      setScheduleId(sched.id);
      setScheduleEnabled(sched.enabled);
      setScheduleCadence(sched.cadence);
      setScheduleRecipientEmails(sched.recipientEmails?.join(", ") || "");
    } else {
      setScheduleId(null);
      setScheduleEnabled(false);
      setScheduleCadence("weekly");
      setScheduleRecipientEmails(user?.email ?? "");
    }
  };

  const handleCloseEditor = () => {
    setEditingCanvas(null);
    setIsCreatingCanvas(false);
  };

  const handleSaveCanvas = async () => {
    if (!editingCanvas) return;
    if (!editingCanvas.name.trim()) {
      toast.error("Canvas name is required");
      return;
    }
    setSavingCanvas(true);
    try {
      const payload = {
        name: editingCanvas.name.trim(),
        description: editingCanvas.description?.trim() || null,
        canvasLayout: {
          layout: layouts,
          widgets: widgets
        },
        deliveryConfig: {
          sendAsHtmlEmail,
          attachPdf,
          recipientType: "msp_admin" as const
        },
        mspId: user?.mspId
      };

      const url = isCreatingCanvas
        ? `/api/msp/reports/canvases?mspId=${user?.mspId}`
        : `/api/msp/reports/canvases/${editingCanvas.id}?mspId=${user?.mspId}`;
      const method = isCreatingCanvas ? "POST" : "PUT";

      const res = await fetchWithAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        toast.error("Failed to save canvas");
        return;
      }

      const savedCanvas = await res.json() as MspReportCanvas;
      const targetCanvasId = savedCanvas.id;
      const recipientList = scheduleRecipientEmails
        .split(",")
        .map(e => e.trim())
        .filter(Boolean);

      if (scheduleEnabled) {
        if (scheduleId) {
          // Update existing
          await fetchWithAuth(`/api/msp/reports/schedules/${scheduleId}?mspId=${user?.mspId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cadence: scheduleCadence,
              recipientEmails: recipientList,
              enabled: true
            })
          });
        } else {
          // Create new
          await fetchWithAuth(`/api/msp/reports/schedules?mspId=${user?.mspId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              canvasId: targetCanvasId,
              cadence: scheduleCadence,
              recipientEmails: recipientList,
              enabled: true
            })
          });
        }
      } else {
        // Disable existing schedule if it was configured
        if (scheduleId) {
          await fetchWithAuth(`/api/msp/reports/schedules/${scheduleId}?mspId=${user?.mspId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              enabled: false
            })
          });
        }
      }

      toast.success(isCreatingCanvas ? "Canvas report created" : "Canvas report updated");
      setIsCreatingCanvas(false);
      setEditingCanvas(null);
      void fetchCanvases();
      void fetchSchedules();
    } catch (err) {
      toast.error("An error occurred while saving");
    } finally {
      setSavingCanvas(false);
    }
  };

  const handleDeleteCanvas = async () => {
    if (!deleteCanvasTarget) return;
    setDeletingCanvas(true);
    try {
      const res = await fetchWithAuth(`/api/msp/reports/canvases/${deleteCanvasTarget.id}?mspId=${user?.mspId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        toast.success("Canvas report deleted");
        setDeleteCanvasTarget(null);
        void fetchCanvases();
        void fetchSchedules();
      }
    } finally {
      setDeletingCanvas(false);
    }
  };

  // ── Canvas Builder Layout Methods ──────────────────────────────────────────
  const handleLayoutChange = (newLayout: Layout) => {
    setLayouts(newLayout);
  };

  const addPaletteItem = (type: string) => {
    const id = `widget-${Date.now()}`;
    const defaultW = type === "msp_header" || type === "rich_text" ? 12 : 6;
    const defaultH = type === "telemetry" ? 5 : 4;
    const nextY = layouts.reduce((maxY, item) => Math.max(maxY, item.y + item.h), 0);

    const newLayout: any = {
      i: id,
      x: 0,
      y: nextY,
      w: defaultW,
      h: defaultH,
    };

    const newWidget = {
      type: type === "msp_header" ? "rich_text" : type,
      properties: {
        content: type === "msp_header" ? DEFAULT_BRANDING_CONTENT :
                 type === "rich_text" ? DEFAULT_RICH_TEXT_CONTENT : ""
      }
    };

    setLayouts([...layouts, newLayout]);
    setWidgets({ ...widgets, [id]: newWidget });
    toast.success("Added block to canvas");
  };

  const removeWidget = (id: string) => {
    setLayouts(layouts.filter(item => item.i !== id));
    const nextWidgets = { ...widgets };
    delete nextWidgets[id];
    setWidgets(nextWidgets);
    toast.success("Block removed from canvas");
  };

  const handleOpenRichTextEditor = (id: string) => {
    setActiveEditingWidgetId(id);
    setRichTextContent(widgets[id]?.properties?.content || "");
    setRichTextDialogOpen(true);
  };

  const handleApplyRichText = () => {
    if (!activeEditingWidgetId) return;
    setWidgets({
      ...widgets,
      [activeEditingWidgetId]: {
        ...widgets[activeEditingWidgetId],
        properties: { content: richTextContent }
      }
    });
    setRichTextDialogOpen(false);
    toast.success("Rich text updated");
  };

  // ── Widget Previews inside layout ──────────────────────────────────────────
  const renderWidgetPreview = (id: string, type: string, properties: any) => {
    switch (type) {
      case "rich_text":
        return (
          <div className="text-sm prose prose-sm max-w-none text-muted-foreground p-3 bg-muted/10 min-h-[60px] overflow-y-auto max-h-[180px]">
            <div dangerouslySetInnerHTML={{ __html: properties?.content || "<em>No content. Click Edit to add text.</em>" }} />
          </div>
        );
      case "billing":
        return (
          <div className="p-3 text-xs space-y-2">
            <div className="flex justify-between border-b pb-1 font-semibold text-muted-foreground uppercase text-[9px]">
              <span>Subscription</span>
              <span>Cycle</span>
              <span>Amount</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Office 365 E5</span>
              <span>Monthly</span>
              <span>$380.00</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Azure VM D2 v3</span>
              <span>Monthly</span>
              <span>$145.00</span>
            </div>
            <div className="flex justify-between text-muted-foreground border-t pt-1 font-bold text-foreground">
              <span>Monthly Total</span>
              <span></span>
              <span className="text-primary">$525.00</span>
            </div>
          </div>
        );
      case "open_items":
        return (
          <div className="p-3 text-xs space-y-2">
            <div className="flex justify-between border-b pb-1 font-semibold text-muted-foreground uppercase text-[9px]">
              <span>Description</span>
              <span>Status</span>
              <span>Due/Target</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span className="truncate max-w-[150px]"><span className="bg-muted px-1 rounded text-[8px] mr-1 font-bold">TASK</span>Upgrade Firewall</span>
              <span className="text-blue-500 font-medium">In Progress</span>
              <span>07/20/2026</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span className="truncate max-w-[150px]"><span className="bg-muted px-1 rounded text-[8px] mr-1 font-bold">FULFILL</span>Provision Mailbox</span>
              <span className="text-orange-500 font-medium">Not Started</span>
              <span>07/18/2026</span>
            </div>
          </div>
        );
      case "telemetry":
        return (
          <div className="p-3 text-xs space-y-3">
            <div className="space-y-1.5">
              <div className="flex justify-between text-[9px] uppercase font-semibold text-muted-foreground">
                <span>Health Category</span>
                <span>Score</span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span>Identity Protection</span>
                  <span className="text-green-500 font-semibold">85%</span>
                </div>
                <div className="w-full bg-muted h-1 rounded-full overflow-hidden">
                  <div className="bg-green-500 h-1 rounded-full" style={{ width: "85%" }}></div>
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span>Threat Security</span>
                  <span className="text-yellow-500 font-semibold">75%</span>
                </div>
                <div className="w-full bg-muted h-1 rounded-full overflow-hidden">
                  <div className="bg-yellow-500 h-1 rounded-full" style={{ width: "75%" }}></div>
                </div>
              </div>
            </div>
            <div className="pt-2 border-t space-y-1">
              <div className="flex justify-between text-[11px]">
                <span>MFA Enforced</span>
                <span className="text-green-500 font-bold">✓</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span>Defender Engaged</span>
                <span className="text-green-500 font-bold">✓</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span>DLP Configured</span>
                <span className="text-red-500 font-bold">✗</span>
              </div>
            </div>
          </div>
        );
      default:
        return <div className="p-3 text-xs text-muted-foreground">Unknown type: {type}</div>;
    }
  };

  // ── Standard definitions trigger/delete ────────────────────────────────────
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

  // ── Render Workspace Editor View ────────────────────────────────────────────
  if (editingCanvas) {
    return (
      <AppShell
        title={isCreatingCanvas ? "New Canvas Report" : `Edit Canvas: ${editingCanvas.name}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCloseEditor} className="gap-1.5 h-8">
              <ChevronLeft className="size-3.5" />
              Back
            </Button>
            {!isCreatingCanvas && (
              <Button variant="outline" size="sm" onClick={() => handleOpenSendTest(editingCanvas)} className="gap-1.5 h-8">
                <Send className="size-3.5" />
                Send Test
              </Button>
            )}
            <Button size="sm" onClick={handleSaveCanvas} disabled={savingCanvas} className="gap-1.5 h-8">
              {savingCanvas ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Save Canvas
            </Button>
          </div>
        }
      >
        <div className="p-6 h-[calc(100vh-4rem)] flex flex-col gap-6 overflow-hidden">
          {/* Top Metadata inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-card border rounded-lg p-4 shrink-0">
            <div className="space-y-1.5">
              <Label>Report Canvas Name</Label>
              <Input
                placeholder="e.g. Executive Performance Report"
                value={editingCanvas.name}
                onChange={(e) => setEditingCanvas({ ...editingCanvas, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                placeholder="Brief description of this report canvas context"
                value={editingCanvas.description || ""}
                onChange={(e) => setEditingCanvas({ ...editingCanvas, description: e.target.value })}
              />
            </div>
          </div>

          {/* Builder Workspace body */}
          <div className="flex-1 flex gap-6 overflow-hidden min-h-0">
            {/* Left Palette */}
            <div className="w-64 border bg-card rounded-lg p-4 flex flex-col gap-4 overflow-y-auto shrink-0">
              <div>
                <h3 className="font-semibold text-sm">Building Blocks</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Click blocks to add to the canvas grid.</p>
              </div>
              <div className="space-y-2">
                {[
                  { type: "msp_header", label: "MSP Header/Logo", desc: "Navy brand title banner", icon: LayoutIcon },
                  { type: "billing", label: "Billing Summary", desc: "Active subscription costs", icon: Mail },
                  { type: "open_items", label: "Open Fulfillment Items", desc: "List of open tickets", icon: FileText },
                  { type: "telemetry", label: "Telemetry & Signals", desc: "Health grades & signaling", icon: Settings },
                  { type: "rich_text", label: "Custom Rich Text", desc: "Editable markdown/HTML textbox", icon: Edit },
                ].map((item) => (
                  <button
                    key={item.type}
                    onClick={() => addPaletteItem(item.type)}
                    className="w-full text-left p-2.5 rounded-lg border bg-muted/30 hover:bg-muted/80 transition-colors flex items-start gap-2.5 group"
                  >
                    <div className="p-1.5 rounded bg-background border shrink-0 text-muted-foreground group-hover:text-primary transition-colors">
                      <item.icon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-none text-foreground">{item.label}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight mt-1 line-clamp-2">{item.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Middle Canvas (Scrollable area) */}
            <div className="flex-1 border bg-muted/10 rounded-lg p-4 overflow-y-auto relative">
              {layouts.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
                  <LayoutIcon className="size-10 text-muted-foreground/30 mb-3" />
                  <p className="font-medium text-sm text-muted-foreground">Empty canvas layout</p>
                  <p className="text-xs text-muted-foreground/80 mt-1 max-w-xs">
                    Select a building block from the sidebar to populate your custom report.
                  </p>
                </div>
              ) : (
                <ResponsiveGridLayout
                  className="layout"
                  layout={layouts}
                  onLayoutChange={handleLayoutChange}
                  cols={12}
                  rowHeight={60}
                  draggableHandle=".drag-handle"
                  isDraggable={true}
                  isResizable={true}
                >
                  {layouts.map((item) => {
                    const widget = widgets[item.i] || { type: "rich_text", properties: {} };
                    const isRichText = widget.type === "rich_text";
                    return (
                      <div
                        key={item.i}
                        className="bg-card border rounded-lg shadow-sm flex flex-col overflow-hidden group select-none"
                      >
                        {/* Drag Handle Bar */}
                        <div className="h-8 border-b bg-muted/30 flex items-center justify-between px-3 cursor-default shrink-0">
                          <div className="drag-handle flex-1 flex items-center gap-1.5 cursor-move h-full font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                            <LayoutIcon className="size-3" />
                            <span>{widget.type.replace("_", " ")} block</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {isRichText && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-5 rounded text-muted-foreground hover:text-foreground"
                                onClick={() => handleOpenRichTextEditor(item.i)}
                                title="Edit Text Content"
                              >
                                <Edit className="size-3" />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-5 rounded text-muted-foreground hover:text-destructive"
                              onClick={() => removeWidget(item.i)}
                              title="Delete Widget"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        </div>

                        {/* Widget Preview Context */}
                        <div className="flex-1 overflow-hidden min-h-0 bg-background">
                          {renderWidgetPreview(item.i, widget.type, widget.properties)}
                        </div>
                      </div>
                    );
                  })}
                </ResponsiveGridLayout>
              )}
            </div>

            {/* Right Output & Scheduling Controls */}
            <div className="w-80 border bg-card rounded-lg p-4 flex flex-col gap-5 overflow-y-auto shrink-0">
              <div>
                <h3 className="font-semibold text-sm">Delivery & Schedule</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Control how and when this report compiles.</p>
              </div>

              {/* Delivery switches */}
              <div className="space-y-4 border-b pb-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs">Send Inline HTML Email</Label>
                    <p className="text-[10px] text-muted-foreground">Emails layout inline instead of standard text link</p>
                  </div>
                  <Switch checked={sendAsHtmlEmail} onCheckedChange={setSendAsHtmlEmail} />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs">Attach PDF Copy</Label>
                    <p className="text-[10px] text-muted-foreground">Attach a compiled downloadable PDF copy to emails</p>
                  </div>
                  <Switch checked={attachPdf} onCheckedChange={setAttachPdf} />
                </div>
              </div>

              {/* Schedule toggles */}
              <div className="space-y-4 flex-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Enable Recurring Schedule</Label>
                  <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} />
                </div>

                {scheduleEnabled && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Schedule Cadence</Label>
                      <Select
                        value={scheduleCadence}
                        onValueChange={(v) => setScheduleCadence(v as any)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select cadence" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Recipient Emails</Label>
                      <Input
                        className="h-8 text-xs"
                        placeholder="admin@customer.com, staff@msp.com"
                        value={scheduleRecipientEmails}
                        onChange={(e) => setScheduleRecipientEmails(e.target.value)}
                      />
                      <p className="text-[10px] text-muted-foreground">Comma-separated email list.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Text editor Modal */}
        <Dialog open={richTextDialogOpen} onOpenChange={(v) => !v && setRichTextDialogOpen(false)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Edit Rich Text Block</DialogTitle>
              <DialogDescription>
                Customize HTML markup or plain text below to display within this block.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2 space-y-3">
              <Label className="text-xs">HTML / Rich Text Content</Label>
              <Textarea
                rows={10}
                className="font-mono text-xs"
                placeholder="Enter rich text HTML style here..."
                value={richTextContent}
                onChange={(e) => setRichTextContent(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setRichTextDialogOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleApplyRichText}>
                Apply Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Send Test Email Modal */}
        <Dialog open={sendTestOpen} onOpenChange={(v) => !v && setSendTestOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Send Test Report Email</DialogTitle>
              <DialogDescription>
                Sends a one-off compiled preview email using active customer data context.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Recipient Email</Label>
                <Input
                  className="h-9"
                  placeholder="recipient@example.com"
                  value={testRecipientEmail}
                  onChange={(e) => setTestRecipientEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Target Customer Context</Label>
                <Select value={testCustomerId} onValueChange={setTestCustomerId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select customer context" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((cust) => (
                      <SelectItem key={cust.id} value={String(cust.id)}>
                        {cust.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setSendTestOpen(false)} disabled={sendingTest}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSendTest} disabled={sendingTest}>
                {sendingTest && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
                Send Test Email
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Reports"
      actions={
        pageActions
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
          {(["definitions", "canvases", "runs"] as const).map((t) => (
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
              {t === "definitions" ? "Report Definitions" : t === "canvases" ? "Custom Canvases" : "Run History"}
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

        {/* Custom Canvases tab */}
        {tab === "canvases" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {loadingCanvases ? "Loading…" : `${canvases.length} canvas report${canvases.length !== 1 ? "s" : ""}`}
              </p>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void fetchCanvases()}>
                <RefreshCw className="size-3.5" />
                Refresh
              </Button>
            </div>

            {loadingCanvases ? (
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
            ) : canvases.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <LayoutIcon className="size-10 text-muted-foreground/50 mb-3" />
                  <p className="font-medium">No custom canvases yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Design layout-driven visual report templates.
                  </p>
                  <Button
                    className="mt-4 gap-1.5"
                    onClick={() => {
                      setIsCreatingCanvas(true);
                      setEditingCanvas({
                        id: "",
                        mspId: user?.mspId ?? 0,
                        name: "New Custom Report",
                        description: "",
                        canvasLayout: {
                          layout: [
                            { i: "widget-header", x: 0, y: 0, w: 12, h: 2 }
                          ],
                          widgets: {
                            "widget-header": {
                              type: "rich_text",
                              properties: { content: DEFAULT_BRANDING_CONTENT }
                            }
                          }
                        },
                        deliveryConfig: {
                          sendAsHtmlEmail: false,
                          attachPdf: true,
                          recipientType: "msp_admin"
                        },
                        createdAt: "",
                        updatedAt: ""
                      });
                      setScheduleEnabled(false);
                      setScheduleCadence("weekly");
                      setScheduleRecipientEmails(user?.email ?? "");
                      setScheduleId(null);
                    }}
                  >
                    <Plus className="size-3.5" />
                    Create First Canvas
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {canvases.map((canvas) => (
                  <CanvasCard
                    key={canvas.id}
                    canvas={canvas}
                    schedule={schedules.find(s => s.canvasId === canvas.id)}
                    onEdit={handleOpenEditor}
                    onDelete={(c) => setDeleteCanvasTarget(c)}
                    onSendTest={handleOpenSendTest}
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

      {/* Canvas Delete Confirm Dialog */}
      <Dialog open={!!deleteCanvasTarget} onOpenChange={(v) => !v && setDeleteCanvasTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-400" />
              Remove Canvas Report
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the custom canvas report &ldquo;{deleteCanvasTarget?.name}&rdquo;. Any active schedule associated with it will also be deactivated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCanvasTarget(null)} disabled={deletingCanvas}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleDeleteCanvas()} disabled={deletingCanvas}>
              {deletingCanvas && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Test Email Modal */}
      <Dialog open={sendTestOpen} onOpenChange={(v) => !v && setSendTestOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Test Report Email</DialogTitle>
            <DialogDescription>
              Sends a one-off compiled preview email using active customer data context.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Recipient Email</Label>
              <Input
                className="h-9"
                placeholder="recipient@example.com"
                value={testRecipientEmail}
                onChange={(e) => setTestRecipientEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Target Customer Context</Label>
              <Select value={testCustomerId} onValueChange={setTestCustomerId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select customer context" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((cust) => (
                    <SelectItem key={cust.id} value={String(cust.id)}>
                      {cust.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSendTestOpen(false)} disabled={sendingTest}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSendTest} disabled={sendingTest}>
              {sendingTest && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
              Send Test Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
