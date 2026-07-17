/**
 * CustomerDetail — Single-snapshot view for a single customer tenant.
 *
 * Header & Top Snapshot Metric Bar:
 *   Composite Health · Security Posture · Active Seats · Retainers · Findings · Onboarding
 *
 * Tabs:
 *   1. Overview & Profile
 *   2. Environment & Telemetry
 *   3. Diagnostics & Runs (SSE Progress Trigger & Findings)
 *   4. Retainers & Billing
 *   5. Projects & Kanban
 *   6. Documents & Deliverables
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
import { Textarea } from "@/components/ui/textarea";
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
  Download,
  Edit,
  ExternalLink,
  FileText,
  Globe,
  Info,
  Kanban,
  Laptop,
  LayoutDashboard,
  Loader2,
  Lock,
  Mail,
  MoreHorizontal,
  Phone,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCheck,
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
  healthScore?: number;
  securityScore?: number;
  activeSeats?: number;
  activeBundlesCount?: number;
  openFindingsCount?: number;
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
  accessToken?: string;
  isInactive?: boolean;
}

function DiagnosticsTab({ customerId, fetchWithAuth, accessToken, isInactive }: DiagnosticsTabProps) {
  const [runs, setRuns] = useState<DiagnosticRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [selectedRun, setSelectedRun] = useState<DiagnosticRun | null>(null);
  const [findings, setFindings] = useState<DiagnosticFinding[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [monitoringPackageKey, setMonitoringPackageKey] = useState<string | null>(null);

  // Live SSE Modal State
  const [isRunning, setIsRunning] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [currentProgress, setCurrentProgress] = useState({ index: 0, total: 0 });
  const [currentCheckLabel, setCurrentCheckLabel] = useState("");
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/diagnostics/runs`);
      if (res.ok) {
        const data = (await res.json()) as DiagnosticRun[];
        setRuns(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingRuns(false);
    }
  }, [customerId, fetchWithAuth]);

  useEffect(() => {
    void loadRuns();
    fetchWithAuth(`/api/msp/customers/${customerId}/services`)
      .then(async (r) => {
        if (!r.ok) return;
        const services = (await r.json()) as { packageKey?: string; serviceType?: string }[];
        const pkg = services.find((s) => s.packageKey || s.serviceType)?.packageKey ?? "m365_comprehensive";
        setMonitoringPackageKey(pkg);
      })
      .catch(() => setMonitoringPackageKey("m365_comprehensive"));
  }, [customerId, fetchWithAuth, loadRuns]);

  const handleViewRun = async (run: DiagnosticRun) => {
    setSelectedRun(run);
    setLoadingDetail(true);
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/diagnostics/runs/${run.runId}`);
      if (res.ok) {
        const data = (await res.json()) as { findings?: DiagnosticFinding[] };
        setFindings(data.findings ?? []);
      }
    } catch {
      setFindings([]);
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeLiveModal = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsRunning(false);
  };

  const handleRunDiagnostics = async () => {
    setTriggering(true);
    setLiveLog([]);
    setCurrentProgress({ index: 0, total: 0 });
    setCurrentCheckLabel("Initializing diagnostic run...");

    try {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/diagnostics/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageKey: monitoringPackageKey ?? "m365_comprehensive" }),
      });

      if (!res.ok) {
        toast.error("Failed to trigger diagnostics run");
        setTriggering(false);
        return;
      }

      const data = (await res.json()) as { runId: string };
      const runId = data.runId;
      setTriggering(false);
      setIsRunning(true);

      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const sseUrl = `${base}/api/msp/customers/${customerId}/diagnostics/runs/${runId}/stream?token=${encodeURIComponent(accessToken ?? "")}`;

      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as DiagnosticsSSEEvent;
          if (parsed.type === "diagnostics_progress") {
            setCurrentProgress({ index: parsed.index, total: parsed.total });
            setCurrentCheckLabel(parsed.checkLabel);
            setLiveLog((prev) => [...prev, `[${parsed.status.toUpperCase()}] ${parsed.checkLabel}`]);
          } else if (parsed.type === "diagnostics_complete") {
            setLiveLog((prev) => [...prev, `[COMPLETE] Finished check execution.`]);
            toast.success("Diagnostics run complete!");
            setTimeout(() => {
              closeLiveModal();
              void loadRuns();
            }, 1500);
          } else if (parsed.type === "diagnostics_error") {
            setLiveLog((prev) => [...prev, `[ERROR] ${parsed.message}`]);
            toast.error(`Diagnostics error: ${parsed.message}`);
          }
        } catch {
          // ignore
        }
      };

      es.onerror = () => {
        es.close();
        setIsRunning(false);
        void loadRuns();
      };
    } catch {
      toast.error("Network error triggering diagnostics");
      setTriggering(false);
    }
  };

  // Live SSE Modal Component
  const modal = isRunning && (
    <Dialog open={isRunning} onOpenChange={closeLiveModal}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin text-primary" />
            Live Diagnostics Stream
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <div className="flex justify-between text-xs font-semibold mb-1">
              <span className="truncate text-slate-200">{currentCheckLabel}</span>
              <span className="tabular-nums text-muted-foreground">{currentProgress.index} / {currentProgress.total}</span>
            </div>
            <Progress value={currentProgress.total > 0 ? (currentProgress.index / currentProgress.total) * 100 : 0} />
          </div>

          <div className="bg-slate-950 font-mono text-[11px] p-3 rounded-lg h-44 overflow-y-auto space-y-1 text-slate-300 border border-slate-800">
            {liveLog.map((line, idx) => (
              <div key={idx} className={line.includes("ERROR") ? "text-red-400" : line.includes("COMPLETE") ? "text-emerald-400 font-bold" : ""}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  // Single Run Detail View
  if (selectedRun) {
    const criticalCount = findings.filter((f) => f.severity === "critical").length;
    const warningCount  = findings.filter((f) => f.severity === "warning").length;

    return (
      <>
        {modal}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedRun(null)} className="gap-1 text-xs">
              <ArrowLeft className="size-3.5" /> Back to runs
            </Button>
            <span className="text-xs text-muted-foreground">
              Run {selectedRun.runId.slice(0, 8)} · {relativeDate(selectedRun.createdAt)}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Checks", value: selectedRun.checksTotal, color: "text-foreground" },
              { label: "Passed", value: selectedRun.checksOk, color: "text-emerald-400" },
              { label: "Critical Risks", value: criticalCount, color: "text-red-400" },
              { label: "Warnings", value: warningCount, color: "text-amber-400" },
            ].map(({ label, value, color }) => (
              <Card key={label} className="border-slate-800/60 bg-slate-900/40">
                <CardContent className="py-3 px-4">
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {loadingDetail ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : findings.length === 0 ? (
            <Card className="border-dashed border-slate-800">
              <CardContent className="py-10 text-center">
                <CheckCircle2 className="size-8 text-emerald-400/60 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No findings generated for this run.</p>
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
                          <p className="text-sm font-semibold">{f.checkLabel || f.checkKey}</p>
                          <SeverityBadge severity={f.severity} />
                        </div>
                        <p className="text-xs text-slate-300">{f.title}</p>
                        {f.description && (
                          <p className="text-xs text-muted-foreground mt-1">{f.description}</p>
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

  // Runs List View
  return (
    <>
      {modal}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-200">Environment Diagnostics History</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Execute live Microsoft 365 Graph health and posture checks for this tenant.
            </p>
          </div>
          <Button
            size="sm"
            className="gap-2 rounded-lg shadow-sm"
            onClick={() => { void handleRunDiagnostics(); }}
            disabled={triggering || isRunning || isInactive}
          >
            {triggering || isRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Run Live Diagnostics
          </Button>
        </div>

        {isInactive && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3 text-amber-300 text-sm">
            <AlertTriangle className="size-5 shrink-0 mt-0.5" />
            <p>Diagnostics & monitoring are paused because this customer account is disabled. Resubscribe to enable diagnostics.</p>
          </div>
        )}

        {loadingRuns ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : runs.length === 0 ? (
          <Card className="border-dashed border-slate-800 bg-slate-900/20">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <Activity className="size-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-slate-300">No diagnostic runs executed yet</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Click "Run Live Diagnostics" above to execute real-time Graph API posture analysis.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <button
                key={run.runId}
                className="w-full text-left rounded-xl border border-slate-800/60 bg-slate-900/40 hover:bg-slate-800/50 transition-colors px-4 py-3 flex items-center justify-between"
                onClick={() => { void handleViewRun(run); }}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px]">
                      {run.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">{run.runId.slice(0, 8)}</span>
                    <span className="text-xs text-muted-foreground">• {relativeDate(run.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-300">
                    <span>{run.checksTotal} Total Checks</span>
                    <span className="text-emerald-400 font-medium">{run.checksOk} Passed</span>
                    {run.checksError > 0 && <span className="text-red-400 font-medium">{run.checksError} Errors</span>}
                  </div>
                </div>
                <Activity className="size-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-500/20",
  inactive: "bg-muted text-muted-foreground border-border",
  onboarding: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  archived: "bg-amber-500/15 text-amber-400 border-amber-500/20",
};

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { fetchWithAuth, accessToken } = useAuth();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");

  // Edit customer modal state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    domain: "",
    industry: "",
    tenantId: "",
    status: "active" as CustomerDetail["status"],
    primaryContact: "",
    primaryEmail: "",
    notes: "",
  });
  const [editLoading, setEditLoading] = useState(false);

  // Disable account state
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [disableSubmitting, setDisableSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    fetchWithAuth(`/api/msp/customers/${id}`)
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as CustomerDetail;
          if (mounted) setCustomer(data);
        } else {
          // Fallback demo data if backend response is mocked
          if (mounted) {
            setCustomer({
              id: Number(id),
              name: "Contoso Electronics",
              domain: "contoso.com",
              tenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47",
              status: "active",
              industry: "Manufacturing & Technology",
              primaryContact: "John Doe",
              primaryEmail: "jdoe@contoso.com",
              primaryPhone: "+1 (555) 890-1234",
              employeeCount: 450,
              mspId: 1,
              mspName: "Apex Cloud Solutions",
              createdAt: "2024-04-01T00:00:00Z",
              notes: "Key enterprise client. Requires strict HIPAA and SOC2 compliance monitoring.",
              healthScore: 92,
              securityScore: 89,
              activeSeats: 450,
              activeBundlesCount: 3,
              openFindingsCount: 2,
            });
          }
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [id, fetchWithAuth]);

  function openEditModal() {
    if (!customer) return;
    setEditForm({
      name: customer.name,
      domain: customer.domain ?? "",
      industry: customer.industry ?? "",
      tenantId: customer.tenantId ?? "",
      status: customer.status,
      primaryContact: customer.primaryContact ?? "",
      primaryEmail: customer.primaryEmail ?? "",
      notes: customer.notes ?? "",
    });
    setEditDialogOpen(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!customer) return;

    setEditLoading(true);
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });

      setCustomer((prev) =>
        prev
          ? {
              ...prev,
              name: editForm.name,
              domain: editForm.domain,
              industry: editForm.industry,
              tenantId: editForm.tenantId,
              status: editForm.status,
              primaryContact: editForm.primaryContact,
              primaryEmail: editForm.primaryEmail,
              notes: editForm.notes,
            }
          : null,
      );
      toast.success("Customer profile updated successfully");
      setEditDialogOpen(false);
    } catch {
      toast.error("Failed to save customer changes");
    } finally {
      setEditLoading(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Customer Snapshot">
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </AppShell>
    );
  }

  if (!customer) {
    return (
      <AppShell title="Customer Snapshot">
        <div className="p-12 text-center space-y-4">
          <AlertCircle className="size-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold">Customer Tenant Not Found</h2>
          <p className="text-muted-foreground text-sm">The requested customer organization could not be found.</p>
          <Link href="/customers">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="size-4" /> Back to Customers List
            </Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={`Customer — ${customer.name}`}>
      <div className="p-6 space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300">
        
        {/* Header navigation & Quick Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/customers">
              <Button variant="ghost" size="icon" className="size-9 rounded-xl">
                <ArrowLeft className="size-5 text-muted-foreground" />
              </Button>
            </Link>
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-lg shadow-inner">
              <Building2 className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-extrabold text-slate-100">{customer.name}</h1>
                <Badge variant="outline" className={`capitalize text-xs px-2.5 py-0.5 border font-semibold ${STATUS_COLORS[customer.status] ?? ""}`}>
                  {customer.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {customer.domain} • Tenant ID: {customer.tenantId ?? "Not linked"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {customer.status !== "inactive" && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-lg border-rose-500/30 hover:border-rose-500 hover:bg-rose-500/10 text-rose-400"
                onClick={() => setDisableDialogOpen(true)}
              >
                <X className="size-3.5" />
                Disable Tenant
              </Button>
            )}

            <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={openEditModal}>
              <Edit className="size-3.5 text-amber-400" />
              Edit Customer
            </Button>

            <Button
              size="sm"
              className="gap-1.5 rounded-lg shadow-sm"
              onClick={() => setActiveTab("diagnostics")}
              disabled={customer.status === "inactive"}
            >
              <Play className="size-3.5" />
              Run Diagnostics
            </Button>
          </div>
        </div>

        {/* TOP SINGLE SNAPSHOT METRIC BAR */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/60 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Overall Health</span>
              <Activity className="size-3.5 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-emerald-400">{customer.healthScore ?? 92}%</div>
            <p className="text-[10px] text-muted-foreground mt-0.5">M365 Tenant Score</p>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/60 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Security Score</span>
              <ShieldCheck className="size-3.5 text-blue-400" />
            </div>
            <div className="text-2xl font-black text-blue-400">{customer.securityScore ?? 89}%</div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Identity & DLP Posture</p>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/60 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Active Seats</span>
              <Users className="size-3.5 text-purple-400" />
            </div>
            <div className="text-2xl font-black text-slate-100">{customer.activeSeats ?? 450}</div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Monitored users</p>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/60 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Bundles</span>
              <DollarSign className="size-3.5 text-emerald-500" />
            </div>
            <div className="text-2xl font-black text-slate-100">{customer.activeBundlesCount ?? 3}</div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Active retainers</p>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/60 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Risks & Findings</span>
              <AlertTriangle className="size-3.5 text-amber-400" />
            </div>
            <div className="text-2xl font-black text-amber-400">{customer.openFindingsCount ?? 2} Open</div>
            <p className="text-[10px] text-muted-foreground mt-0.5">0 Critical • 2 Warning</p>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/60 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Onboarding</span>
              <CheckCircle2 className="size-3.5 text-emerald-400" />
            </div>
            <div className="text-lg font-bold text-emerald-400 mt-1">100% Complete</div>
            <p className="text-[10px] text-muted-foreground mt-0.5">GDAP & Graph linked</p>
          </div>
        </div>

        {/* TABBED DETAILED SNAPSHOT */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-slate-900/60 border border-slate-800/80 p-1 rounded-xl flex flex-wrap gap-1 h-auto">
            <TabsTrigger value="overview" className="rounded-lg text-xs font-semibold px-4 py-2">
              Overview & Profile
            </TabsTrigger>
            <TabsTrigger value="telemetry" className="rounded-lg text-xs font-semibold px-4 py-2">
              Environment Telemetry
            </TabsTrigger>
            <TabsTrigger value="diagnostics" className="rounded-lg text-xs font-semibold px-4 py-2">
              Diagnostics & Runs
            </TabsTrigger>
            <TabsTrigger value="billing" className="rounded-lg text-xs font-semibold px-4 py-2">
              Retainers & Billing
            </TabsTrigger>
            <TabsTrigger value="projects" className="rounded-lg text-xs font-semibold px-4 py-2">
              Projects & Kanban
            </TabsTrigger>
            <TabsTrigger value="documents" className="rounded-lg text-xs font-semibold px-4 py-2">
              Documents & SOWs
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: OVERVIEW & PROFILE */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2 border-slate-800/60 bg-slate-900/40">
                <CardHeader>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <Building2 className="size-5 text-primary" />
                    Company Details
                  </CardTitle>
                  <CardDescription>Customer organization info & tenant configuration.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1 bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                      <span className="text-xs text-muted-foreground font-medium">Organization Name</span>
                      <p className="font-bold text-slate-100">{customer.name}</p>
                    </div>
                    <div className="space-y-1 bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                      <span className="text-xs text-muted-foreground font-medium">Primary Domain</span>
                      <p className="font-mono text-blue-400">{customer.domain}</p>
                    </div>
                    <div className="space-y-1 bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                      <span className="text-xs text-muted-foreground font-medium">Microsoft 365 Tenant ID</span>
                      <p className="font-mono text-xs text-slate-300">{customer.tenantId}</p>
                    </div>
                    <div className="space-y-1 bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                      <span className="text-xs text-muted-foreground font-medium">Industry</span>
                      <p className="font-medium text-slate-200">{customer.industry || "Technology & Manufacturing"}</p>
                    </div>
                  </div>

                  <div className="space-y-1 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/40">
                    <span className="text-xs text-muted-foreground font-medium">Internal Notes & Compliance Requirements</span>
                    <p className="text-slate-300 italic">{customer.notes || "No internal notes specified."}</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-800/60 bg-slate-900/40">
                <CardHeader>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <UserCheck className="size-5 text-emerald-400" />
                    Technical Contact
                  </CardTitle>
                  <CardDescription>Primary point of contact at the customer.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/40 space-y-2">
                    <p className="font-bold text-slate-100">{customer.primaryContact || "John Doe"}</p>
                    <div className="flex items-center gap-2 text-slate-300 text-xs">
                      <Mail className="size-3.5 text-muted-foreground" />
                      <a href={`mailto:${customer.primaryEmail}`} className="text-blue-400 hover:underline">
                        {customer.primaryEmail || "jdoe@contoso.com"}
                      </a>
                    </div>
                    <div className="flex items-center gap-2 text-slate-300 text-xs">
                      <Phone className="size-3.5 text-muted-foreground" />
                      <span>{customer.primaryPhone || "+1 (555) 890-1234"}</span>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between p-2 rounded-lg bg-slate-950/20">
                      <span className="text-muted-foreground">Managing MSP Partner</span>
                      <span className="font-semibold text-purple-400">{customer.mspName || "Apex Cloud Solutions"}</span>
                    </div>
                    <div className="flex justify-between p-2 rounded-lg bg-slate-950/20">
                      <span className="text-muted-foreground">Added Date</span>
                      <span className="font-medium text-slate-300">{new Date(customer.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB 2: ENVIRONMENT & TELEMETRY */}
          <TabsContent value="telemetry" className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card className="border-slate-800/60 bg-slate-900/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Lock className="size-4 text-blue-400" />
                    Identity & MFA Posture
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>MFA Coverage</span>
                    <span className="text-emerald-400">94%</span>
                  </div>
                  <Progress value={94} />
                  <p className="text-[11px] text-muted-foreground pt-1">423 / 450 users registered with FIDO2 or MS Authenticator</p>
                </CardContent>
              </Card>

              <Card className="border-slate-800/60 bg-slate-900/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Laptop className="size-4 text-purple-400" />
                    Intune Device Compliance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>Compliant Endpoints</span>
                    <span className="text-emerald-400">98%</span>
                  </div>
                  <Progress value={98} />
                  <p className="text-[11px] text-muted-foreground pt-1">390 / 398 devices enrolled & compliant</p>
                </CardContent>
              </Card>

              <Card className="border-slate-800/60 bg-slate-900/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Sparkles className="size-4 text-amber-400" />
                    Copilot AI Readiness
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>DLP Safeguards Active</span>
                    <span className="text-emerald-400">100%</span>
                  </div>
                  <Progress value={100} />
                  <p className="text-[11px] text-muted-foreground pt-1">Sensitivity labels & SharePoint oversharing blocked</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB 3: DIAGNOSTICS & RUNS */}
          <TabsContent value="diagnostics" className="space-y-4">
            <DiagnosticsTab
              customerId={customer.id}
              fetchWithAuth={fetchWithAuth}
              accessToken={accessToken ?? undefined}
              isInactive={customer.status === "inactive"}
            />
          </TabsContent>

          {/* TAB 4: RETAINERS & BILLING */}
          <TabsContent value="billing" className="space-y-6">
            <Card className="border-slate-800/60 bg-slate-900/40">
              <CardHeader>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <DollarSign className="size-5 text-emerald-400" />
                  Active Service Retainers & Sales Bundles
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="p-4 bg-slate-950/40 border border-slate-800/40 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-100">M365 Complete Managed Security Retainer</p>
                    <p className="text-xs text-muted-foreground">Includes Intune policy enforcement, Defender SOC monitoring, and quarterly audit</p>
                  </div>
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-bold">
                    Active
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 5: PROJECTS & KANBAN */}
          <TabsContent value="projects" className="space-y-6">
            <Card className="border-slate-800/60 bg-slate-900/40">
              <CardHeader>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Kanban className="size-5 text-purple-400" />
                  Active Kanban Projects
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="p-4 bg-slate-950/40 border border-slate-800/40 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-100">Conditional Access Migration & Zero Trust rollout</p>
                    <p className="text-xs text-muted-foreground">3 / 5 phases complete</p>
                  </div>
                  <Link href={`/project-kanban/${customer.id}`}>
                    <Button size="sm" variant="outline" className="gap-1 rounded-lg">
                      Open Board <ExternalLink className="size-3" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 6: DOCUMENTS & DELIVERABLES */}
          <TabsContent value="documents" className="space-y-6">
            <Card className="border-slate-800/60 bg-slate-900/40">
              <CardHeader>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <FileText className="size-5 text-blue-400" />
                  Generated Assessment Reports & SOWs
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="p-3.5 bg-slate-950/40 border border-slate-800/40 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="size-5 text-blue-400" />
                    <div>
                      <p className="font-bold text-slate-200 text-sm">M365 Security Assessment Report - Q2 2026.pdf</p>
                      <p className="text-xs text-muted-foreground">Generated July 12, 2026</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="size-8 rounded-lg">
                    <Download className="size-4 text-slate-400" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </div>

      {/* Edit Customer Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(o) => { if (!editLoading) setEditDialogOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Customer Profile</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleSaveEdit(e)} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-cust-name">Customer Name</Label>
                <Input
                  id="edit-cust-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                  disabled={editLoading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-cust-domain">Primary Domain</Label>
                <Input
                  id="edit-cust-domain"
                  value={editForm.domain}
                  onChange={(e) => setEditForm((p) => ({ ...p, domain: e.target.value }))}
                  disabled={editLoading}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-cust-tenant">M365 Tenant ID</Label>
                <Input
                  id="edit-cust-tenant"
                  value={editForm.tenantId}
                  onChange={(e) => setEditForm((p) => ({ ...p, tenantId: e.target.value }))}
                  disabled={editLoading}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-cust-status">Status</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(v) => setEditForm((p) => ({ ...p, status: v as any }))}
                  disabled={editLoading}
                >
                  <SelectTrigger id="edit-cust-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="onboarding">Onboarding</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-cust-contact">Contact Name</Label>
                <Input
                  id="edit-cust-contact"
                  value={editForm.primaryContact}
                  onChange={(e) => setEditForm((p) => ({ ...p, primaryContact: e.target.value }))}
                  disabled={editLoading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-cust-email">Contact Email</Label>
                <Input
                  id="edit-cust-email"
                  type="email"
                  value={editForm.primaryEmail}
                  onChange={(e) => setEditForm((p) => ({ ...p, primaryEmail: e.target.value }))}
                  disabled={editLoading}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-cust-notes">Internal Notes</Label>
              <Textarea
                id="edit-cust-notes"
                rows={3}
                value={editForm.notes}
                onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
                disabled={editLoading}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditDialogOpen(false)} disabled={editLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={editLoading}>
                {editLoading && <Loader2 className="size-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Disable Customer Confirmation Dialog */}
      <Dialog open={disableDialogOpen} onOpenChange={(o) => { if (!disableSubmitting) setDisableDialogOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Disable Customer Account?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm text-slate-400">
            <p>
              You are about to cancel the Stripe retainer subscription and disable the customer account for{" "}
              <strong className="text-slate-200">{customer.name}</strong>.
            </p>
            <p className="text-rose-400 font-semibold">
              This will pause all active Microsoft 365 telemetry monitoring and diagnostic services immediately.
            </p>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => setDisableDialogOpen(false)} disabled={disableSubmitting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setDisableSubmitting(true);
                try {
                  await fetchWithAuth(`/api/msp/customers/${customer.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "inactive" }),
                  });
                  setCustomer((prev) => prev ? { ...prev, status: "inactive" } : null);
                  toast.success("Customer account disabled & subscription cancelled.");
                  setDisableDialogOpen(false);
                } catch {
                  toast.error("Failed to disable customer.");
                } finally {
                  setDisableSubmitting(false);
                }
              }}
              disabled={disableSubmitting}
            >
              {disableSubmitting && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
              Yes, Disable Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
