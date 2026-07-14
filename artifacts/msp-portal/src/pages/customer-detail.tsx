/**
 * CustomerDetail — tabbed scaffold for a single customer.
 *
 * Tabs:
 *   Overview · Documents · Diagnostics · Offers · Billing · Reports
 *
 * The Diagnostics tab provides the "Run Diagnostics" trigger button with a
 * live SSE progress modal and shows recent diagnostics run history.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  DollarSign,
  FileText,
  Globe,
  Info,
  LayoutDashboard,
  Loader2,
  Mail,
  MoreHorizontal,
  Play,
  ShieldCheck,
  TrendingUp,
  Users,
  X,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DiagnosticRun {
  runId: string;
  status: string;
  packageKey: string;
  checksTotal: number;
  checksOk: number;
  checksError: number;
  checksRequiresScript: number;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
}

interface DiagnosticFinding {
  findingId: string;
  checkKey: string;
  checkLabel: string;
  severity: "ok" | "info" | "warning" | "critical";
  title: string;
  description?: string;
  checkStatus?: string;
}

type DiagnosticsSSEEvent =
  | { type: "diagnostics_progress"; checkKey: string; checkLabel: string; status: string; index: number; total: number; requiresCustomerScript: boolean; errorMessage?: string }
  | { type: "diagnostics_complete"; status: string; checksTotal: number; checksOk: number; checksError: number; requiresScript: number; findings: number }
  | { type: "diagnostics_error"; message: string };

interface CustomerDetail {
  id: number;
  name: string;
  domain?: string;
  status: "active" | "inactive" | "onboarding" | "archived";
  tenantId?: string;
  primaryContact?: string;
  primaryEmail?: string;
  primaryPhone?: string;
  employeeCount?: number;
  mspId?: number;
  mspName?: string;
  createdAt: string;
  notes?: string;
  industry?: string;
  ownerType?: "customer" | "msp" | "platform";
}

// ── Finding severity helpers ───────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical: { label: "Critical", icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/10 border-red-500/30" },
  warning:  { label: "Warning",  icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
  info:     { label: "Info",     icon: Info,         color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/30" },
  ok:       { label: "OK",       icon: CheckCircle2, color: "text-green-400", bg: "bg-green-500/10 border-green-500/30" },
} as const;

function SeverityBadge({ severity }: { severity: DiagnosticFinding["severity"] }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 border font-semibold ${cfg.bg} ${cfg.color}`}>
      {cfg.label}
    </Badge>
  );
}

function relativeDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (diff < 1) return "Just now";
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  const days = Math.floor(diff / 1440);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── DiagnosticsTab ─────────────────────────────────────────────────────────────

interface DiagnosticsTabProps {
  customerId: number;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
  accessToken: string | null;
}

function DiagnosticsTab({ customerId, fetchWithAuth, accessToken }: DiagnosticsTabProps) {
  const [runs, setRuns] = useState<DiagnosticRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [triggering, setTriggering] = useState(false);
  // undefined = loading, null = no subscription found, string = resolved packageKey
  const [monitoringPackageKey, setMonitoringPackageKey] = useState<string | null | undefined>(undefined);

  // Active run SSE state
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [progressEvents, setProgressEvents] = useState<Array<{ checkKey: string; checkLabel: string; status: string; index: number; total: number }>>([]);
  const [runComplete, setRunComplete] = useState<DiagnosticsSSEEvent & { type: "diagnostics_complete" } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Selected run for detail view
  const [selectedRun, setSelectedRun] = useState<{ run: DiagnosticRun; findings: DiagnosticFinding[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const sseRef = useRef<EventSource | null>(null);

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/diagnostics`);
      if (res.ok) {
        const data = (await res.json()) as { runs: DiagnosticRun[] };
        setRuns(data.runs ?? []);
      }
    } catch { /* ignore */ }
    finally { setLoadingRuns(false); }
  }, [customerId, fetchWithAuth]);

  const loadMonitoringPackage = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/monitoring-package`);
      if (res.ok) {
        const data = (await res.json()) as { packageKey: string | null };
        setMonitoringPackageKey(data.packageKey);
      } else {
        setMonitoringPackageKey(null);
      }
    } catch {
      setMonitoringPackageKey(null);
    }
  }, [customerId, fetchWithAuth]);

  useEffect(() => {
    void loadRuns();
    void loadMonitoringPackage();
  }, [loadRuns, loadMonitoringPackage]);

  const openSSE = useCallback((runId: string) => {
    sseRef.current?.close();
    const token = accessToken ?? "";
    const url = `/api/msp/customers/${customerId}/diagnostics/runs/${runId}/sse?jwt=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    sseRef.current = es;

    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data as string) as DiagnosticsSSEEvent;
        if (data.type === "diagnostics_progress") {
          setProgressEvents(prev => {
            const existing = prev.findIndex(e => e.checkKey === data.checkKey);
            const updated = { checkKey: data.checkKey, checkLabel: data.checkLabel, status: data.status, index: data.index, total: data.total };
            if (existing >= 0) {
              const next = [...prev];
              next[existing] = updated;
              return next;
            }
            return [...prev, updated];
          });
        } else if (data.type === "diagnostics_complete") {
          setRunComplete(data);
          es.close();
          void loadRuns();
        } else if (data.type === "diagnostics_error") {
          setRunError(data.message);
          es.close();
          void loadRuns();
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      es.close();
    };
  }, [customerId, accessToken, loadRuns]);

  useEffect(() => () => { sseRef.current?.close(); }, []);

  const handleRunDiagnostics = async () => {
    setTriggering(true);
    setActiveRunId(null);
    setProgressEvents([]);
    setRunComplete(null);
    setRunError(null);
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/diagnostics/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageKey: monitoringPackageKey ?? "" }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setRunError(err.error ?? "Failed to start diagnostics");
        return;
      }
      const data = (await res.json()) as { runId: string };
      setActiveRunId(data.runId);
      openSSE(data.runId);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Failed to start diagnostics");
    } finally {
      setTriggering(false);
    }
  };

  const handleViewRun = async (run: DiagnosticRun) => {
    setLoadingDetail(true);
    setSelectedRun(null);
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/diagnostics/runs/${run.runId}`);
      if (res.ok) {
        const data = (await res.json()) as { run: DiagnosticRun; findings: DiagnosticFinding[] };
        setSelectedRun(data);
      }
    } catch { /* ignore */ }
    finally { setLoadingDetail(false); }
  };

  const handleCloseModal = () => {
    sseRef.current?.close();
    setActiveRunId(null);
    setProgressEvents([]);
    setRunComplete(null);
    setRunError(null);
  };

  const isRunning = !!activeRunId && !runComplete && !runError;
  const currentTotal = progressEvents[0]?.total ?? 0;
  const currentIndex = progressEvents.length > 0 ? progressEvents[progressEvents.length - 1].index + 1 : 0;
  const progressPct = currentTotal > 0 ? Math.round((currentIndex / currentTotal) * 100) : 0;

  // ── Progress Modal ────────────────────────────────────────────────────────────

  const modal = activeRunId ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <Card className="w-full max-w-lg shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">
              {runComplete ? "Diagnostics Complete" : runError ? "Diagnostics Failed" : "Running Diagnostics…"}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {runComplete
                ? `${runComplete.checksTotal} checks completed · ${runComplete.findings} findings`
                : runError
                ? "An error occurred during the diagnostics run"
                : progressEvents.length > 0
                ? `Check ${currentIndex} of ${currentTotal}`
                : "Initialising…"}
            </CardDescription>
          </div>
          {(runComplete || runError) && (
            <Button variant="ghost" size="icon" className="size-7" onClick={handleCloseModal}>
              <X className="size-4" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Progress bar */}
          {(isRunning || runComplete) && (
            <Progress value={runComplete ? 100 : progressPct} className="h-2" />
          )}

          {/* Check log */}
          {progressEvents.length > 0 && (
            <div className="max-h-52 overflow-y-auto space-y-1 rounded-lg bg-muted/40 p-3">
              {progressEvents.map((evt) => {
                const isDone = evt.status === "ok" || evt.status === "error" || evt.status === "consent_revoked" || evt.status === "requires_script";
                return (
                  <div key={evt.checkKey} className="flex items-center gap-2 text-xs">
                    {isDone
                      ? evt.status === "ok"
                        ? <CheckCircle2 className="size-3 text-green-400 shrink-0" />
                        : evt.status === "requires_script"
                        ? <Info className="size-3 text-blue-400 shrink-0" />
                        : <AlertCircle className="size-3 text-red-400 shrink-0" />
                      : <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" />
                    }
                    <span className="truncate text-muted-foreground">{evt.checkLabel || evt.checkKey}</span>
                    <span className={`ml-auto shrink-0 font-medium ${evt.status === "ok" ? "text-green-400" : evt.status === "requires_script" ? "text-blue-400" : evt.status === "running" ? "text-muted-foreground" : "text-red-400"}`}>
                      {evt.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Error message */}
          {runError && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3">
              <p className="text-xs text-red-400">{runError}</p>
            </div>
          )}

          {/* Complete summary */}
          {runComplete && (
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: "Passed",  value: runComplete.checksOk,    color: "text-green-400" },
                { label: "Errors",  value: runComplete.checksError,  color: "text-red-400" },
                { label: "Scripted", value: runComplete.requiresScript, color: "text-blue-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-lg bg-muted/40 py-2">
                  <p className={`text-lg font-bold ${color}`}>{value}</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          )}

          {(runComplete || runError) && (
            <Button className="w-full" variant={runError ? "outline" : "default"} size="sm" onClick={handleCloseModal}>
              Close
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  ) : null;

  // ── Run detail view ───────────────────────────────────────────────────────────

  if (selectedRun) {
    const { run, findings } = selectedRun;
    const criticalCount = findings.filter(f => f.severity === "critical").length;
    const warningCount = findings.filter(f => f.severity === "warning").length;

    return (
      <>
        {modal}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-1.5 -ml-1" onClick={() => setSelectedRun(null)}>
              <ArrowLeft className="size-3.5" /> Back
            </Button>
            <span className="text-xs text-muted-foreground">
              Run {run.runId.slice(0, 8)} · {relativeDate(run.createdAt)}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total", value: run.checksTotal, color: "text-foreground" },
              { label: "Passed", value: run.checksOk, color: "text-green-400" },
              { label: "Critical", value: criticalCount, color: "text-red-400" },
              { label: "Warnings", value: warningCount, color: "text-amber-400" },
            ].map(({ label, value, color }) => (
              <Card key={label}>
                <CardContent className="py-3 px-4">
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {findings.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center">
                <CheckCircle2 className="size-8 text-green-400/60 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No findings generated</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {findings.map((f) => {
                const cfg = SEVERITY_CONFIG[f.severity];
                const Icon = cfg.icon;
                return (
                  <div key={f.findingId} className={`rounded-xl border px-4 py-3 ${cfg.bg}`}>
                    <div className="flex items-start gap-3">
                      <Icon className={`size-4 ${cfg.color} shrink-0 mt-0.5`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="text-sm font-medium">{f.checkLabel || f.checkKey}</p>
                          <SeverityBadge severity={f.severity} />
                        </div>
                        <p className="text-xs text-muted-foreground">{f.title}</p>
                        {f.description && (
                          <p className="text-xs text-muted-foreground/70 mt-1">{f.description}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </>
    );
  }

  // ── Run list view ─────────────────────────────────────────────────────────────

  return (
    <>
      {modal}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Diagnostics Runs</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Run a live Microsoft 365 environment health check for this customer.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              className="gap-2"
              onClick={() => { void handleRunDiagnostics(); }}
              disabled={triggering || isRunning || monitoringPackageKey == null}
            >
              {triggering || isRunning
                ? <Loader2 className="size-3.5 animate-spin" />
                : <Play className="size-3.5" />}
              Run Diagnostics
            </Button>
            {monitoringPackageKey === null && (
              <p className="text-[10px] text-muted-foreground">No monitoring package linked</p>
            )}
          </div>
        </div>

        {loadingRuns ? (
          <div className="space-y-2">
            {[1, 2].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : runs.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <Activity className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No diagnostics run yet</p>
              <p className="text-xs text-muted-foreground/60 max-w-xs">
                Click "Run Diagnostics" to execute a live Microsoft 365 health check. Results stream in real time.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => {
              const statusCfg = {
                completed: { color: "text-green-400", bg: "bg-green-500/10 border-green-500/30", label: "Completed" },
                failed:    { color: "text-red-400",   bg: "bg-red-500/10 border-red-500/30",   label: "Failed" },
                partial:   { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", label: "Partial" },
                running:   { color: "text-blue-400",  bg: "bg-blue-500/10 border-blue-500/30",  label: "Running" },
                pending:   { color: "text-muted-foreground", bg: "",                             label: "Pending" },
              }[run.status] ?? { color: "text-muted-foreground", bg: "", label: run.status };

              return (
                <button
                  key={run.runId}
                  className="w-full text-left rounded-xl border border-border bg-card hover:bg-muted/40 transition-colors px-4 py-3"
                  onClick={() => { void handleViewRun(run); }}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 border ${statusCfg.bg} ${statusCfg.color}`}>
                          {statusCfg.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{relativeDate(run.createdAt)}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                        <span>{run.checksTotal} checks</span>
                        {run.checksOk > 0 && <span className="text-green-400">{run.checksOk} passed</span>}
                        {run.checksError > 0 && <span className="text-red-400">{run.checksError} errors</span>}
                        {run.checksRequiresScript > 0 && <span className="text-blue-400">{run.checksRequiresScript} need script</span>}
                      </div>
                      {run.errorMessage && (
                        <p className="text-xs text-red-400/80 mt-1 truncate">{run.errorMessage}</p>
                      )}
                    </div>
                    {loadingDetail ? (
                      <Loader2 className="size-4 animate-spin text-muted-foreground shrink-0" />
                    ) : (
                      <Activity className="size-4 text-muted-foreground shrink-0" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-500/20",
  inactive: "bg-muted text-muted-foreground border-border",
  onboarding: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  archived: "bg-amber-500/15 text-amber-400 border-amber-500/20",
};

// ── Placeholder tab content ───────────────────────────────────────────────────

function PlaceholderTab({ icon: Icon, label, description }: { icon: React.ElementType; label: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <div className="rounded-xl bg-muted/40 p-4">
        <Icon className="size-7 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">{description}</p>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { fetchWithAuth, accessToken } = useAuth();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");

  // Edit Customer state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    domain: "",
    industry: "",
    status: "onboarding" as CustomerDetail["status"],
    ownerType: "customer" as "customer" | "msp" | "platform",
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const handleOpenEditDialog = () => {
    if (!customer) return;
    setEditForm({
      name: customer.name ?? "",
      domain: customer.domain ?? "",
      industry: customer.industry ?? "",
      status: customer.status ?? "onboarding",
      ownerType: customer.ownerType ?? "customer",
    });
    setEditError(null);
    setEditDialogOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editForm.name.trim()) {
      setEditError("Name is required");
      return;
    }
    setEditLoading(true);
    setEditError(null);
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          domain: editForm.domain.trim() || null,
          industry: editForm.industry.trim() || null,
          status: editForm.status,
          ownerType: editForm.ownerType,
        }),
      });
      if (!res.ok) {
        const errData = await res.json() as { error?: string };
        setEditError(errData.error ?? "Failed to update customer");
        return;
      }
      const updated = await res.json() as CustomerDetail;
      setCustomer(updated);
      setEditDialogOpen(false);
      toast.success("Customer details updated");
    } catch {
      setEditError("Network error - please try again.");
    } finally {
      setEditLoading(false);
    }
  };

  const handleImpersonate = async () => {
    if (!customer || !customer.mspId) {
      toast.error("Cannot impersonate this customer (missing MSP association)");
      return;
    }
    try {
      const res = await fetchWithAuth(`/api/msp/${customer.mspId}/customers/${customer.id}/impersonate`, {
        method: "POST",
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Impersonation failed: ${errData.error ?? "Unknown error"}`);
        return;
      }
      const data = (await res.json()) as { token?: string };
      if (data.token) {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        window.open(`${base}/?impersonation_token=${encodeURIComponent(data.token)}`, "_blank");
      }
    } catch {
      toast.error("Impersonation request failed");
    }
  };

  const handleGenerateDocuments = () => {
    toast.info("Document generation started... (not wired up yet)");
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchWithAuth(`/api/msp/customers/${id}`)
      .then(async (res) => {
        if (res.ok && mounted) {
          const data = (await res.json()) as CustomerDetail;
          setCustomer(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const breadcrumb = (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Link href="/customers">
        <button className="flex items-center gap-1 hover:text-foreground transition-colors">
          <ArrowLeft className="size-3.5" />
          Customers
        </button>
      </Link>
      <span>/</span>
      {loading ? (
        <Skeleton className="h-4 w-28 inline-block" />
      ) : (
        <span className="text-foreground font-medium">{customer?.name ?? `Customer #${id}`}</span>
      )}
    </div>
  );

  const title = loading
    ? "Customer"
    : (customer?.name ?? `Customer #${id}`);

  return (
    <AppShell title={title}>
      <div className="p-6 space-y-6">
        {/* Breadcrumb */}
        {breadcrumb}

        {/* Header card */}
        <Card>
          <CardContent className="p-6">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-4 w-32" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              </div>
            ) : customer ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-primary/10 p-3">
                      <Building2 className="size-6 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">{customer.name}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        {customer.domain && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Globe className="size-3" />
                            {customer.domain}
                          </div>
                        )}
                        <Badge
                          variant="outline"
                          className={`capitalize text-[11px] ${STATUS_COLORS[customer.status] ?? ""}`}
                        >
                          {customer.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1.5">
                        <MoreHorizontal className="size-4" />
                        Actions
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem className="text-sm gap-2 cursor-pointer" onSelect={handleImpersonate}>
                        <Users className="size-4 text-muted-foreground" />
                        <span>View as Customer</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-sm gap-2 cursor-pointer" onSelect={handleOpenEditDialog}>
                        <Building2 className="size-4 text-muted-foreground" />
                        <span>Edit Customer</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-sm gap-2 cursor-pointer" onSelect={handleGenerateDocuments}>
                        <FileText className="size-4 text-muted-foreground" />
                        <span>Generate Documents</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <Separator className="my-4" />

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  {customer.primaryContact && (
                    <div>
                      <dt className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                        <Users className="size-3" /> Primary Contact
                      </dt>
                      <dd className="font-medium">{customer.primaryContact}</dd>
                    </div>
                  )}
                  {customer.primaryEmail && (
                    <div>
                      <dt className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                        <Mail className="size-3" /> Email
                      </dt>
                      <dd className="font-medium truncate">{customer.primaryEmail}</dd>
                    </div>
                  )}
                  {customer.employeeCount != null && (
                    <div>
                      <dt className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                        <Users className="size-3" /> Employees
                      </dt>
                      <dd className="font-medium">{customer.employeeCount.toLocaleString()}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                      <Calendar className="size-3" /> Added
                    </dt>
                    <dd className="font-medium">
                      {new Date(customer.createdAt).toLocaleDateString()}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">Customer not found.</p>
            )}
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-3 sm:grid-cols-6 w-full h-auto">
            <TabsTrigger value="overview" className="text-xs gap-1.5 py-2">
              <LayoutDashboard className="size-3.5" />
              <span className="hidden sm:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="text-xs gap-1.5 py-2">
              <FileText className="size-3.5" />
              <span className="hidden sm:inline">Documents</span>
            </TabsTrigger>
            <TabsTrigger value="monitoring" className="text-xs gap-1.5 py-2">
              <Activity className="size-3.5" />
              <span className="hidden sm:inline">Monitoring</span>
            </TabsTrigger>
            <TabsTrigger value="offers" className="text-xs gap-1.5 py-2">
              <TrendingUp className="size-3.5" />
              <span className="hidden sm:inline">Offers</span>
            </TabsTrigger>
            <TabsTrigger value="billing" className="text-xs gap-1.5 py-2">
              <DollarSign className="size-3.5" />
              <span className="hidden sm:inline">Billing</span>
            </TabsTrigger>
            <TabsTrigger value="reports" className="text-xs gap-1.5 py-2">
              <ShieldCheck className="size-3.5" />
              <span className="hidden sm:inline">Reports</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Tenant ID</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-5 w-40" />
                  ) : (
                    <p className="font-mono text-sm text-muted-foreground break-all">
                      {customer?.tenantId ?? "Not linked"}
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">MSP</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-5 w-28" />
                  ) : (
                    <p className="text-sm font-medium">{customer?.mspName ?? "—"}</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Status</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-5 w-20" />
                  ) : (
                    <Badge
                      variant="outline"
                      className={`capitalize ${STATUS_COLORS[customer?.status ?? ""] ?? ""}`}
                    >
                      {customer?.status ?? "—"}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            </div>

            {customer?.notes && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{customer.notes}</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <PlaceholderTab
                  icon={FileText}
                  label="Documents"
                  description="SOWs, contracts, and proposals for this customer will appear here. Coming in the Billing/SOW task."
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="monitoring" className="mt-4">
            {customer ? (
              <DiagnosticsTab
                customerId={customer.id}
                fetchWithAuth={fetchWithAuth as (url: string, init?: RequestInit) => Promise<Response>}
                accessToken={accessToken}
              />
            ) : (
              <Card>
                <CardContent className="p-0">
                  <PlaceholderTab
                    icon={Activity}
                    label="Diagnostics"
                    description="Load a customer to run diagnostics."
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="offers" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <PlaceholderTab
                  icon={TrendingUp}
                  label="Sales Offers"
                  description="Active and past sales offers for this customer will appear here. Coming in the Sales Offers task."
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="billing" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <PlaceholderTab
                  icon={DollarSign}
                  label="Billing & SOW"
                  description="Invoices, SOW documents, and subscription details will appear here. Coming in the Billing task."
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <PlaceholderTab
                  icon={ShieldCheck}
                  label="Reports"
                  description="Automated health reports and usage analytics will appear here. Coming in the Reporting task."
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4 py-2">
            {editError && (
              <div className="p-3 text-xs bg-destructive/10 text-destructive border border-destructive/20 rounded-md">
                {editError}
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="edit-name" className="text-xs">Company Name</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-domain" className="text-xs">Domain</Label>
              <Input
                id="edit-domain"
                placeholder="example.com"
                value={editForm.domain}
                onChange={(e) => setEditForm(prev => ({ ...prev, domain: e.target.value }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-industry" className="text-xs">Industry</Label>
              <Input
                id="edit-industry"
                placeholder="e.g. Technology, Healthcare"
                value={editForm.industry}
                onChange={(e) => setEditForm(prev => ({ ...prev, industry: e.target.value }))}
                className="h-9"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="edit-status" className="text-xs">Status</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(val: any) => setEditForm(prev => ({ ...prev, status: val }))}
                >
                  <SelectTrigger id="edit-status" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="onboarding">Onboarding</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-ownerType" className="text-xs">Owner Type</Label>
                <Select
                  value={editForm.ownerType}
                  onValueChange={(val: any) => setEditForm(prev => ({ ...prev, ownerType: val }))}
                >
                  <SelectTrigger id="edit-ownerType" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">Customer</SelectItem>
                    <SelectItem value="msp">MSP</SelectItem>
                    <SelectItem value="platform">Platform</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={editLoading}>
                {editLoading ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
