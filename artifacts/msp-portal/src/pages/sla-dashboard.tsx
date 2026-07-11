/**
 * SLA Dashboard — MSP Portal
 *
 * Displays active SLA timers, warnings, breaches, historical compliance,
 * and operator tasks sourced from /api/msp/sla/*. Near-real-time updates
 * arrive via the /api/msp/sla/events/stream SSE channel.
 *
 * No SLA scoring, detection, or escalation logic lives here — this page
 * only consumes the SLA Engine API and renders the results.
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
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  Timer,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SlaSummary {
  activeTimers: number;
  warningTimers: number;
  breachedTimers: number;
  openBreaches: number;
  avgCompliancePct: number | null;
}

interface SlaTimer {
  timerId: string;
  customerId: number;
  policyId: number;
  ticketRef: string | null;
  ticketType: string | null;
  status: string;
  phase: string;
  startedAt: string;
  warningFiredAt: string | null;
  breachedAt: string | null;
  createdAt: string;
}

interface SlaBreach {
  breachId: string;
  timerId: string;
  customerId: number;
  policyId: number;
  ticketRef: string | null;
  phase: string;
  breachType: string;
  elapsedMinutes: number;
  thresholdMinutes: number;
  resolvedAt: string | null;
  createdAt: string;
}

interface ComplianceRecord {
  recordId: string;
  customerId: number;
  policyId: number;
  periodStart: string;
  periodEnd: string;
  totalTickets: number;
  breachedTickets: number;
  compliancePct: number;
  avgResponseMinutes: number;
  avgResolutionMinutes: number;
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

const STATUS_COLORS: Record<string, string> = {
  active: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  breached: "bg-red-500/15 text-red-400 border-red-500/20",
  resolved: "bg-green-500/15 text-green-400 border-green-500/20",
  stopped: "bg-muted text-muted-foreground border-border",
};

function fmtMinutes(m: number): string {
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleString();
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

export default function SlaDashboardPage() {
  const { fetchWithAuth, accessToken } = useAuth();

  const [summary, setSummary] = useState<SlaSummary | null>(null);
  const [timers, setTimers] = useState<SlaTimer[]>([]);
  const [breaches, setBreaches] = useState<SlaBreach[]>([]);
  const [compliance, setCompliance] = useState<ComplianceRecord[]>([]);
  const [tasks, setTasks] = useState<OperatorTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [summaryRes, timersRes, breachesRes, complianceRes, tasksRes] =
        await Promise.all([
          fetchWithAuth("/api/msp/sla/summary"),
          fetchWithAuth("/api/msp/sla/timers?status=active"),
          fetchWithAuth("/api/msp/sla/breaches"),
          fetchWithAuth("/api/msp/sla/compliance"),
          fetchWithAuth("/api/msp/operator-tasks"),
        ]);

      if (summaryRes.ok) setSummary(await summaryRes.json() as SlaSummary);
      if (timersRes.ok) {
        const d = await timersRes.json() as { timers: SlaTimer[] };
        setTimers(d.timers ?? []);
      }
      if (breachesRes.ok) {
        const d = await breachesRes.json() as { breaches: SlaBreach[] };
        setBreaches(d.breaches ?? []);
      }
      if (complianceRes.ok) {
        const d = await complianceRes.json() as { records: ComplianceRecord[] };
        setCompliance(d.records ?? []);
      }
      if (tasksRes.ok) {
        const d = await tasksRes.json() as { tasks: OperatorTask[] };
        setTasks((d.tasks ?? []).filter(t => t.type === "sla_breach"));
      }
    } catch {
      if (!silent) toast.error("Failed to load SLA data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchWithAuth]);

  // Initial load
  useEffect(() => { void loadAll(); }, [loadAll]);

  // SSE subscription for real-time engine updates
  useEffect(() => {
    if (!accessToken) return;

    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const url = `${base}/api/msp/sla/events/stream`;
    const es = new EventSource(url + `?token=${encodeURIComponent(accessToken)}`);
    sseRef.current = es;

    es.onmessage = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data as string) as Record<string, unknown>;
        if (data["type"] === "sla_breach" || data["type"] === "sla_warning" || data["type"] === "sla_timer_update") {
          void loadAll(true);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      // SSE error — close and let the component re-mount on next render
      es.close();
    };

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

  // Merge timers including warning + breached statuses
  const warningTimers = timers.filter(t => t.status === "warning");
  const breachedTimers = timers.filter(t => t.status === "breached");
  const activeTimers = timers.filter(t => t.status === "active");

  return (
    <AppShell title="SLA Dashboard" actions={actions}>
      <div className="p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold">SLA Monitoring</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Active timers, warnings, breaches, and compliance history across your customer base.
          </p>
        </div>

        {/* Summary stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            title="Active Timers"
            value={summary?.activeTimers ?? 0}
            icon={Timer}
            loading={loading}
          />
          <StatCard
            title="Warnings"
            value={summary?.warningTimers ?? 0}
            icon={AlertTriangle}
            valueClass={summary?.warningTimers ? "text-amber-400" : ""}
            loading={loading}
          />
          <StatCard
            title="Breaches"
            value={summary?.breachedTimers ?? 0}
            icon={ShieldAlert}
            valueClass={summary?.breachedTimers ? "text-red-400" : ""}
            loading={loading}
          />
          <StatCard
            title="Avg Compliance"
            value={
              summary?.avgCompliancePct != null
                ? `${summary.avgCompliancePct}%`
                : "—"
            }
            sub="Last 90 days"
            icon={TrendingUp}
            valueClass={
              summary?.avgCompliancePct != null
                ? summary.avgCompliancePct >= 95
                  ? "text-green-400"
                  : summary.avgCompliancePct >= 80
                    ? "text-amber-400"
                    : "text-red-400"
                : ""
            }
            loading={loading}
          />
        </div>

        {/* Operator Tasks (SLA Breaches as Tasks) */}
        {!loading && tasks.length > 0 && (
          <Card className="border-red-500/20 bg-red-500/5">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-red-400" />
                <CardTitle className="text-sm text-red-400">
                  SLA Breach Operator Tasks ({tasks.length})
                </CardTitle>
              </div>
              <CardDescription className="text-xs">
                These breaches require immediate attention. Deep-link to the SLA Engine for full detail.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-red-500/15 bg-background/60 p-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-red-400">
                        {task.category}
                      </span>
                      {task.customerName && (
                        <span className="text-xs text-muted-foreground">
                          — {task.customerName}
                        </span>
                      )}
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

        {/* Active + Warning Timers */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm">Active Timers</CardTitle>
            </div>
            <CardDescription className="text-xs">
              {warningTimers.length > 0 && (
                <span className="text-amber-400 font-medium">
                  {warningTimers.length} warning{warningTimers.length !== 1 ? "s" : ""}
                </span>
              )}
              {warningTimers.length > 0 && breachedTimers.length > 0 && " · "}
              {breachedTimers.length > 0 && (
                <span className="text-red-400 font-medium">
                  {breachedTimers.length} breached
                </span>
              )}
              {warningTimers.length === 0 && breachedTimers.length === 0 && (
                <span>All timers within threshold</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : [...warningTimers, ...breachedTimers, ...activeTimers].length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <CheckCircle2 className="size-6 text-green-400" />
                <p className="text-sm text-muted-foreground">No active SLA timers</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Customer</TableHead>
                    <TableHead className="text-xs">Ticket</TableHead>
                    <TableHead className="text-xs">Phase</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...warningTimers, ...breachedTimers, ...activeTimers]
                    .slice(0, 20)
                    .map((timer) => (
                      <TableRow key={timer.timerId}>
                        <TableCell className="text-xs font-medium">
                          #{timer.customerId}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {timer.ticketRef ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs capitalize">
                          {timer.phase}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize ${STATUS_COLORS[timer.status] ?? ""}`}
                          >
                            {timer.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(timer.startedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Open Breaches */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm">Open Breaches</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Unresolved SLA breaches across your customer base
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {[1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : breaches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <CheckCircle2 className="size-6 text-green-400" />
                <p className="text-sm text-muted-foreground">No open breaches</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Customer</TableHead>
                    <TableHead className="text-xs">Ticket</TableHead>
                    <TableHead className="text-xs">Phase</TableHead>
                    <TableHead className="text-xs">Elapsed</TableHead>
                    <TableHead className="text-xs">Threshold</TableHead>
                    <TableHead className="text-xs">Breached At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {breaches.slice(0, 20).map((breach) => (
                    <TableRow key={breach.breachId} className="border-l-2 border-l-red-500/40">
                      <TableCell className="text-xs font-medium">
                        #{breach.customerId}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {breach.ticketRef ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs capitalize">{breach.phase}</TableCell>
                      <TableCell className="text-xs text-red-400">
                        {fmtMinutes(breach.elapsedMinutes)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtMinutes(breach.thresholdMinutes)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(breach.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Compliance History */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm">Compliance History</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Monthly SLA compliance per customer
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
                  Monthly snapshots are generated automatically by the SLA Engine.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Customer</TableHead>
                    <TableHead className="text-xs">Period</TableHead>
                    <TableHead className="text-xs">Compliance</TableHead>
                    <TableHead className="text-xs">Tickets</TableHead>
                    <TableHead className="text-xs">Breached</TableHead>
                    <TableHead className="text-xs">Avg Response</TableHead>
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
                            rec.compliancePct >= 95
                              ? "text-green-400"
                              : rec.compliancePct >= 80
                                ? "text-amber-400"
                                : "text-red-400"
                          }`}
                        >
                          {rec.compliancePct}%
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {rec.totalTickets}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {rec.breachedTickets}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {rec.avgResponseMinutes ? fmtMinutes(rec.avgResponseMinutes) : "—"}
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
