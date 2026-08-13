/**
 * Scope Creep Dashboard — MSP Portal
 *
 * Displays drift/expansion/timeline-slip indicators, violations, escalations,
 * and compliance trend sourced from /api/msp/scope-creep/*. Near-real-time
 * updates arrive via the /api/msp/sla/events/stream SSE channel (shared).
 *
 * No scope-creep scoring, detection, or escalation logic lives here — this page
 * only consumes the Scope Creep Engine API and renders the results.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScopeCreepSummary {
  openDetections: number;
  openViolations: number;
  openEscalations: number;
  avgCompliancePct: number | null;
}

interface Detection {
  detectionId: string;
  customerId: number;
  detectionType: "drift" | "expansion" | "timeline_slip";
  ref: string | null;
  baselineValue: number;
  currentValue: number;
  changePct: number;
  status: string;
  detectedAt: string;
}

interface Violation {
  violationId: string;
  customerId: number;
  severity: string;
  compositeScore: number;
  threshold: number;
  resolvedAt: string | null;
  createdAt: string;
}

interface Escalation {
  escalationId: string;
  violationId: string;
  customerId: number;
  level: number;
  escalationType: string;
  flagSowAmendment: boolean;
  flagPricingReview: boolean;
  status: string;
  assignedTo: string | null;
  createdAt: string;
}

interface ComplianceRecord {
  recordId: string;
  customerId: number;
  periodStart: string;
  periodEnd: string;
  totalDetections: number;
  violationCount: number;
  compliancePct: number;
  avgCompositeScore: number;
}

interface OperatorTask {
  id: string;
  type: string;
  category: string;
  customerId: number;
  customerName: string | null;
  description: string;
  severity: string;
  createdAt: string;
  deepLink: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DETECTION_TYPE_LABELS: Record<string, string> = {
  drift: "Drift",
  expansion: "Expansion",
  timeline_slip: "Timeline Slip",
};

const DETECTION_TYPE_COLORS: Record<string, string> = {
  drift: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  expansion: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  timeline_slip: "bg-purple-500/15 text-purple-400 border-purple-500/20",
};

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  critical: "bg-red-500/15 text-red-400 border-red-500/20",
};

function fmtDate(s: string): string {
  return new Date(s).toLocaleString();
}

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100);
  const color =
    pct >= 75 ? "bg-red-500" : pct >= 50 ? "bg-amber-500" : "bg-blue-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">
        {Math.round(score)}
      </span>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  valueClass,
  loading,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  valueClass?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20 mt-1" />
        ) : (
          <div className={`text-2xl font-bold ${valueClass ?? ""}`}>{value}</div>
        )}
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ScopeCreepDashboardPage() {
  const { fetchWithAuth, accessToken } = useAuth();

  const [detections, setDetections] = useState<Detection[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [compliance, setCompliance] = useState<ComplianceRecord[]>([]);
  const [tasks, setTasks] = useState<OperatorTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  const summary: ScopeCreepSummary = {
    openDetections: detections.length,
    openViolations: violations.filter(v => !v.resolvedAt).length,
    openEscalations: escalations.length,
    avgCompliancePct:
      compliance.length > 0
        ? Math.round(
            compliance.reduce((acc, r) => acc + r.compliancePct, 0) /
              compliance.length,
          )
        : null,
  };

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [detectionsRes, violationsRes, escalationsRes, complianceRes, tasksRes] =
        await Promise.all([
          fetchWithAuth("/api/msp/scope-creep/detections?status=open"),
          fetchWithAuth("/api/msp/scope-creep/violations"),
          fetchWithAuth("/api/msp/scope-creep/escalations"),
          fetchWithAuth("/api/msp/scope-creep/compliance"),
          fetchWithAuth("/api/msp/operator-tasks"),
        ]);

      if (detectionsRes.ok) {
        const d = await detectionsRes.json() as { detections: Detection[] };
        setDetections(d.detections ?? []);
      }
      if (violationsRes.ok) {
        const d = await violationsRes.json() as { violations: Violation[] };
        setViolations(d.violations ?? []);
      }
      if (escalationsRes.ok) {
        const d = await escalationsRes.json() as { escalations: Escalation[] };
        setEscalations(d.escalations ?? []);
      }
      if (complianceRes.ok) {
        const d = await complianceRes.json() as { records: ComplianceRecord[] };
        setCompliance(d.records ?? []);
      }
      if (tasksRes.ok) {
        const d = await tasksRes.json() as { tasks: OperatorTask[] };
        setTasks((d.tasks ?? []).filter(t => t.type === "scope_creep_violation"));
      }
    } catch {
      if (!silent) toast.error("Failed to load scope creep data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // SSE subscription — reuse the shared MSP engine events stream
  useEffect(() => {
    if (!accessToken) return;

    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const url = `${base}/api/msp/sla/events/stream`;
    const es = new EventSource(url + `?token=${encodeURIComponent(accessToken)}`);
    sseRef.current = es;

    es.onmessage = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data as string) as Record<string, unknown>;
        if (
          data["type"] === "scope_creep_violation" ||
          data["type"] === "scope_creep_detection" ||
          data["type"] === "scope_creep_escalation"
        ) {
          void loadAll(true);
        }
      } catch { /* ignore */ }
    };

    es.onerror = () => { es.close(); };

    return () => {
      es.close();
      sseRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const actions = (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-muted-foreground"
      disabled={refreshing}
      onClick={() => loadAll(true)}
    >
      <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
      Refresh
    </Button>
  );

  return (
    <AppShell title="Scope Creep Dashboard" actions={actions}>
      <div className="p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Scope Creep Monitoring</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Drift, expansion, and timeline-slip indicators across your customer portfolio.
          </p>
        </div>

        {/* Summary stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            title="Open Detections"
            value={loading ? 0 : summary.openDetections}
            icon={GitBranch}
            valueClass={summary.openDetections > 0 ? "text-amber-400" : ""}
            loading={loading}
          />
          <StatCard
            title="Open Violations"
            value={loading ? 0 : summary.openViolations}
            icon={ShieldAlert}
            valueClass={summary.openViolations > 0 ? "text-red-400" : ""}
            loading={loading}
          />
          <StatCard
            title="Escalations"
            value={loading ? 0 : summary.openEscalations}
            icon={Zap}
            valueClass={summary.openEscalations > 0 ? "text-orange-400" : ""}
            loading={loading}
          />
          <StatCard
            title="Avg Compliance"
            value={
              summary.avgCompliancePct != null
                ? `${summary.avgCompliancePct}%`
                : "—"
            }
            sub="Historical trend"
            icon={TrendingUp}
            valueClass={
              summary.avgCompliancePct != null
                ? summary.avgCompliancePct >= 90
                  ? "text-green-400"
                  : summary.avgCompliancePct >= 70
                    ? "text-amber-400"
                    : "text-red-400"
                : ""
            }
            loading={loading}
          />
        </div>

        {/* Operator Tasks (Scope-Creep Violations as Tasks) */}
        {!loading && tasks.length > 0 && (
          <Card className="border-orange-500/20 bg-orange-500/5">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-orange-400" />
                <CardTitle className="text-sm text-orange-400">
                  Scope Creep Operator Tasks ({tasks.length})
                </CardTitle>
              </div>
              <CardDescription className="text-xs">
                Violations requiring operator action. Deep-link to the Scope Creep Engine for full detail.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-orange-500/15 bg-background/60 p-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-orange-400">
                        {task.category}
                      </span>
                      {task.customerName && (
                        <span className="text-xs text-muted-foreground">
                          — {task.customerName}
                        </span>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-[10px] capitalize ${SEVERITY_COLORS[task.severity] ?? ""}`}
                      >
                        {task.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{task.description}</p>
                    <p className="text-[11px] text-muted-foreground/60">
                      {fmtDate(task.createdAt)}
                    </p>
                  </div>
                  <a
                    href={task.deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0"
                  >
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7">
                      <ExternalLink className="size-3" />
                      View
                    </Button>
                  </a>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Open Detections */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <GitBranch className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm">Open Detections</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Drift, expansion, and timeline-slip signals awaiting resolution
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : detections.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <CheckCircle2 className="size-6 text-green-400" />
                <p className="text-sm text-muted-foreground">No open detections</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Customer</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Ref</TableHead>
                    <TableHead className="text-xs">Change</TableHead>
                    <TableHead className="text-xs">Detected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detections.slice(0, 20).map((d) => (
                    <TableRow key={d.detectionId}>
                      <TableCell className="text-xs font-medium">
                        #{d.customerId}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${DETECTION_TYPE_COLORS[d.detectionType] ?? ""}`}
                        >
                          {DETECTION_TYPE_LABELS[d.detectionType] ?? d.detectionType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {d.ref ?? "—"}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-xs font-medium ${
                            d.changePct >= 50
                              ? "text-red-400"
                              : d.changePct >= 20
                                ? "text-amber-400"
                                : "text-muted-foreground"
                          }`}
                        >
                          +{Math.round(d.changePct)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(d.detectedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Open Violations */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm">Open Violations</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Customers whose composite score exceeded the violation threshold
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {[1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : violations.filter(v => !v.resolvedAt).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <CheckCircle2 className="size-6 text-green-400" />
                <p className="text-sm text-muted-foreground">No open violations</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Customer</TableHead>
                    <TableHead className="text-xs">Severity</TableHead>
                    <TableHead className="text-xs">Score</TableHead>
                    <TableHead className="text-xs">Threshold</TableHead>
                    <TableHead className="text-xs">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {violations
                    .filter(v => !v.resolvedAt)
                    .slice(0, 20)
                    .map((v) => (
                      <TableRow key={v.violationId} className="border-l-2 border-l-red-500/40">
                        <TableCell className="text-xs font-medium">
                          #{v.customerId}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize ${SEVERITY_COLORS[v.severity] ?? ""}`}
                          >
                            {v.severity}
                          </Badge>
                        </TableCell>
                        <TableCell className="min-w-[100px]">
                          <ScoreBar score={v.compositeScore} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {v.threshold}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(v.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Active Escalations */}
        {!loading && escalations.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-muted-foreground" />
                <CardTitle className="text-sm">Active Escalations</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Violations that have been escalated and require follow-up
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Customer</TableHead>
                    <TableHead className="text-xs">Level</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Flags</TableHead>
                    <TableHead className="text-xs">Assigned To</TableHead>
                    <TableHead className="text-xs">Escalated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {escalations.slice(0, 10).map((esc) => (
                    <TableRow key={esc.escalationId}>
                      <TableCell className="text-xs font-medium">
                        #{esc.customerId}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        L{esc.level}
                      </TableCell>
                      <TableCell className="text-xs capitalize text-muted-foreground">
                        {esc.escalationType.replace("_", " ")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 flex-wrap">
                          {esc.flagSowAmendment && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-purple-500/15 text-purple-400 border-purple-500/20"
                            >
                              SOW Amendment
                            </Badge>
                          )}
                          {esc.flagPricingReview && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-blue-500/15 text-blue-400 border-blue-500/20"
                            >
                              Pricing Review
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {esc.assignedTo ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(esc.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Compliance Trend */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm">Compliance Trend</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Historical scope-creep compliance per customer
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : compliance.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <p className="text-sm text-muted-foreground">No compliance records yet.</p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Monthly snapshots are generated automatically by the Scope Creep Engine.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Customer</TableHead>
                    <TableHead className="text-xs">Period</TableHead>
                    <TableHead className="text-xs">Compliance</TableHead>
                    <TableHead className="text-xs">Detections</TableHead>
                    <TableHead className="text-xs">Violations</TableHead>
                    <TableHead className="text-xs">Avg Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {compliance.slice(0, 24).map((rec) => (
                    <TableRow key={rec.recordId}>
                      <TableCell className="text-xs font-medium">
                        #{rec.customerId}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(rec.periodStart).toLocaleDateString("default", {
                          month: "short",
                          year: "numeric",
                        })}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-xs font-medium ${
                            rec.compliancePct >= 90
                              ? "text-green-400"
                              : rec.compliancePct >= 70
                                ? "text-amber-400"
                                : "text-red-400"
                          }`}
                        >
                          {rec.compliancePct}%
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {rec.totalDetections}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {rec.violationCount}
                      </TableCell>
                      <TableCell className="text-xs min-w-[100px]">
                        <ScoreBar score={rec.avgCompositeScore} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
