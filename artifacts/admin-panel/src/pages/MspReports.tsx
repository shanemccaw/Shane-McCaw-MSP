/**
 * MspReports — Admin panel page for MSP Report Definitions and Async Runs.
 *
 * Reports are now generated asynchronously via the Portal Workflow Engine.
 * Triggering a report returns a runId immediately (202 Accepted); this page
 * polls GET /api/msp/reports/runs/:runId until the status transitions from
 * "pending" / "generating" to "delivered" / "generated" or "failed".
 *
 * Failed runs show an inline error message and a Retry button.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReportDefinition {
  definitionId: string;
  mspId: number;
  customerId: number | null;
  name: string;
  description: string | null;
  docType: string;
  deliveryMethod: string;
  isActive: boolean;
  createdAt: string;
}

type RunStatus = "pending" | "generating" | "generated" | "delivering" | "delivered" | "failed";

interface ReportRun {
  id: number;
  runId: string;
  definitionId: string;
  mspId: number;
  customerId: number | null;
  title: string;
  docType: string;
  status: RunStatus;
  pdfSizeBytes: number | null;
  deliveredAt: string | null;
  deliveryEmail: string | null;
  errorMessage: string | null;
  generatedAt: string | null;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_TERMINAL: ReadonlySet<RunStatus> = new Set(["delivered", "generated", "failed"]);

function isTerminal(status: RunStatus): boolean {
  return STATUS_TERMINAL.has(status);
}

function StatusBadge({ status }: { status: RunStatus }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="w-3 h-3" /> Pending
        </Badge>
      );
    case "generating":
      return (
        <Badge variant="secondary" className="gap-1 animate-pulse">
          <Loader2 className="w-3 h-3 animate-spin" /> Generating
        </Badge>
      );
    case "delivered":
    case "generated":
      return (
        <Badge variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-700">
          <CheckCircle2 className="w-3 h-3" /> {status === "delivered" ? "Delivered" : "Generated"}
        </Badge>
      );
    case "delivering":
      return (
        <Badge variant="secondary" className="gap-1 animate-pulse">
          <Loader2 className="w-3 h-3 animate-spin" /> Sending
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="w-3 h-3" /> Failed
        </Badge>
      );
    default:
      return <Badge variant="outline">{String(status)}</Badge>;
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function fmtBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  executive_summary:           "Executive Summary",
  full_readiness_report:       "Full Readiness Report",
  security_posture_report:     "Security Posture Report",
  governance_maturity_report:  "Governance Maturity Report",
  data_exposure_risk_report:   "Data Exposure Risk Report",
  license_optimization_report: "License Optimization Report",
  license_waste_report:        "License Waste Analysis",
};

// ── Main component ────────────────────────────────────────────────────────────

export default function MspReports() {
  const { adminFetch } = useAdminFetch();

  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Keep a ref of the latest runs so the polling interval closure can update it
  // without capturing a stale copy.
  const runsRef = useRef<ReportRun[]>([]);
  runsRef.current = runs;

  // ── Fetch helpers ──────────────────────────────────────────────────────────

  const fetchDefinitions = useCallback(async () => {
    try {
      const res = await adminFetch("/api/msp/reports/definitions");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { definitions: ReportDefinition[] };
      setDefinitions(data.definitions ?? []);
    } catch {
      toast.error("Failed to load report definitions");
    } finally {
      setLoadingDefs(false);
    }
  }, [adminFetch]);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await adminFetch("/api/msp/reports/runs?limit=50");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { runs: ReportRun[] };
      setRuns(data.runs ?? []);
    } catch {
      toast.error("Failed to load report runs");
    } finally {
      setLoadingRuns(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    void fetchDefinitions();
    void fetchRuns();
  }, [fetchDefinitions, fetchRuns]);

  // ── Polling: refresh in-flight runs every 4 seconds ──────────────────────

  useEffect(() => {
    const id = setInterval(async () => {
      const inFlight = runsRef.current.filter(r => !isTerminal(r.status));
      if (inFlight.length === 0) return;

      try {
        const res = await adminFetch("/api/msp/reports/runs?limit=50");
        if (!res.ok) return;
        const data = await res.json() as { runs: ReportRun[] };
        setRuns(data.runs ?? []);
      } catch {
        // Silently skip — the user will still see the last known state
      }
    }, 4_000);
    return () => clearInterval(id);
  }, [adminFetch]);

  // ── Trigger a new report run ───────────────────────────────────────────────

  const triggerReport = useCallback(async (defId: string) => {
    setTriggeringId(defId);
    try {
      const res = await adminFetch(`/api/msp/reports/definitions/${defId}/trigger`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? "Trigger failed");
      }
      const data = await res.json() as { runId: string; title: string };
      toast.success(`Report queued: "${data.title}" — generating asynchronously`);
      // Refresh run list so the new pending row appears immediately
      void fetchRuns();
    } catch (err) {
      toast.error(`Failed to trigger report: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTriggeringId(null);
    }
  }, [adminFetch, fetchRuns]);

  // ── Retry a failed run by re-triggering its definition ────────────────────

  const retryRun = useCallback(async (run: ReportRun) => {
    setRetryingId(run.runId);
    try {
      const res = await adminFetch(`/api/msp/reports/definitions/${run.definitionId}/trigger`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? "Retry failed");
      }
      toast.success("Retry queued — a new run has been created");
      void fetchRuns();
    } catch (err) {
      toast.error(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRetryingId(null);
    }
  }, [adminFetch, fetchRuns]);

  // ── Download PDF ──────────────────────────────────────────────────────────

  const downloadPdf = useCallback(async (runId: string, title: string) => {
    try {
      const res = await adminFetch(`/api/msp/reports/runs/${runId}/download`);
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? "Download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[^a-zA-Z0-9\s-]/g, "").trim()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [adminFetch]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasInFlight = runs.some(r => !isTerminal(r.status));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MSP Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate and download AI-powered M365 reports for your MSP clients.
            Reports are built asynchronously via the workflow engine — failures land in the DLQ
            and create an operator task automatically.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { void fetchDefinitions(); void fetchRuns(); }}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* ── Report Definitions ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" /> Report Definitions
          </CardTitle>
          <CardDescription>
            Each definition describes a report type scoped to an MSP or a specific customer.
            Click Generate to queue a new asynchronous run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingDefs ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : definitions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No report definitions found. Create one via the API or the MSP Portal.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {definitions.map(def => (
                  <TableRow key={def.definitionId}>
                    <TableCell className="font-medium">{def.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {DOC_TYPE_LABELS[def.docType] ?? def.docType}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground capitalize">
                      {def.deliveryMethod.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>
                      {def.isActive
                        ? <Badge variant="outline" className="text-emerald-700 border-emerald-300">Active</Badge>
                        : <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                      }
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        disabled={!def.isActive || triggeringId === def.definitionId}
                        onClick={() => void triggerReport(def.definitionId)}
                      >
                        {triggeringId === def.definitionId
                          ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Queuing…</>
                          : "Generate"
                        }
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Recent Runs ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Recent Runs
            {hasInFlight && (
              <Badge variant="secondary" className="animate-pulse gap-1 ml-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Live
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {hasInFlight
              ? "In-flight runs refresh automatically every 4 seconds."
              : "All recent report generation runs. Re-trigger any failed run to retry via the workflow engine."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingRuns ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No runs yet. Trigger a report from a definition above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map(run => (
                  <TableRow key={run.runId}>
                    <TableCell className="font-medium max-w-[240px] truncate" title={run.title}>
                      {run.title}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {DOC_TYPE_LABELS[run.docType] ?? run.docType}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtDate(run.generatedAt ?? run.deliveredAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtBytes(run.pdfSizeBytes)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(run.status === "delivered" || run.status === "generated") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void downloadPdf(run.runId, run.title)}
                          >
                            <Download className="w-3.5 h-3.5 mr-1.5" /> PDF
                          </Button>
                        )}
                        {run.status === "failed" && (
                          <div className="flex items-center gap-2">
                            {run.errorMessage && (
                              <span
                                className="text-xs text-destructive max-w-[200px] truncate"
                                title={run.errorMessage}
                              >
                                <AlertTriangle className="w-3 h-3 inline mr-1" />
                                {run.errorMessage}
                              </span>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={retryingId === run.runId}
                              onClick={() => void retryRun(run)}
                            >
                              {retryingId === run.runId
                                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Retrying…</>
                                : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry</>
                              }
                            </Button>
                          </div>
                        )}
                        {!isTerminal(run.status) && (
                          <span className="text-xs text-muted-foreground">
                            <Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" />
                            In progress…
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
