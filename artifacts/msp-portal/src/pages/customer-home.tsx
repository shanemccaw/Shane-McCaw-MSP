import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock,
  FileText,
  FolderOpen,
  FolderSync,
  MessageSquare,
  ShieldCheck,
  Zap,
  Loader2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnrichedProject {
  id: number;
  title: string;
  status: string;
  progress: number;
  currentStepTitle: string | null;
  updatedAt: string | null;
  currentTask: {
    stepNumber: number;
    totalSteps: number;
    title: string;
  } | null;
}

interface ClientService {
  cs: {
    id: number;
    status: string;
    purchasedAt: string | null;
  };
  service: {
    name: string;
    billingType: string;
    price: number;
  };
}

interface Report {
  id: number;
  title: string;
  period: string | null;
  createdAt: string | null;
}
import AssessmentModulePanel from "@/components/assessment-modules/AssessmentModulePanel";
import { type AssessmentResultsPayload } from "@/components/assessment-modules/module-registry";

interface DashboardData {
  projects: EnrichedProject[];
  clientServices: ClientService[];
  invoices: unknown[];
  reports: Report[];
  unreadNotifications: number;
  unreadMessages: number;
  telemetryStatus?: "in_progress" | "completed";
  type_attributes?: string[];
  results?: AssessmentResultsPayload;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-500/30",
  paused: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  completed: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  cancelled: "bg-red-500/15 text-red-400 border-red-500/30",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerHomePage() {
  const { user, fetchWithAuth } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/portal/dashboard")
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as DashboardData;
        if (mounted) setData(json);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstName = user?.name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "there";

  return (
    <AppShell title="My Portal">
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        {/* Welcome header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              Welcome back, {firstName}
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              Your Microsoft 365 modernisation dashboard
            </p>
          </div>
          {(data?.unreadNotifications ?? 0) + (data?.unreadMessages ?? 0) > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
              <Bell className="size-4 shrink-0" />
              <span className="font-medium">
                {data!.unreadNotifications + data!.unreadMessages} unread
              </span>
            </div>
          )}
        </div>

        {/* Quick-action cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link href="/customer-documents">
            <Card className="cursor-pointer hover:border-primary/50 transition-colors group">
              <CardContent className="flex items-center gap-3 py-5">
                <div className="size-9 rounded-lg bg-blue-500/15 flex items-center justify-center group-hover:bg-blue-500/25 transition-colors">
                  <FileText className="size-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Documents</p>
                  <p className="text-xs text-muted-foreground">Reports & SOWs</p>
                </div>
                <ArrowRight className="size-3.5 text-muted-foreground ml-auto" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/customer-diagnostics">
            <Card className="cursor-pointer hover:border-primary/50 transition-colors group">
              <CardContent className="flex items-center gap-3 py-5">
                <div className="size-9 rounded-lg bg-violet-500/15 flex items-center justify-center group-hover:bg-violet-500/25 transition-colors">
                  <Zap className="size-4 text-violet-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Diagnostics</p>
                  <p className="text-xs text-muted-foreground">Offers & findings</p>
                </div>
                <ArrowRight className="size-3.5 text-muted-foreground ml-auto" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/customer-sla">
            <Card className="cursor-pointer hover:border-primary/50 transition-colors group">
              <CardContent className="flex items-center gap-3 py-5">
                <div className="size-9 rounded-lg bg-emerald-500/15 flex items-center justify-center group-hover:bg-emerald-500/25 transition-colors">
                  <ShieldCheck className="size-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Service Levels</p>
                  <p className="text-xs text-muted-foreground">Response & compliance</p>
                </div>
                <ArrowRight className="size-3.5 text-muted-foreground ml-auto" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/customer-scope">
            <Card className="cursor-pointer hover:border-primary/50 transition-colors group">
              <CardContent className="flex items-center gap-3 py-5">
                <div className="size-9 rounded-lg bg-sky-500/15 flex items-center justify-center group-hover:bg-sky-500/25 transition-colors">
                  <FolderSync className="size-4 text-sky-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Project Scope</p>
                  <p className="text-xs text-muted-foreground">Scope & timeline</p>
                </div>
                <ArrowRight className="size-3.5 text-muted-foreground ml-auto" />
              </CardContent>
            </Card>
          </Link>

          <Card className="opacity-60">
            <CardContent className="flex items-center gap-3 py-5">
              <div className="size-9 rounded-lg bg-muted flex items-center justify-center">
                <MessageSquare className="size-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Messages</p>
                <p className="text-xs text-muted-foreground">
                  {data?.unreadMessages ?? 0} unread
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Telemetry & Assessment Modules */}
        {data?.telemetryStatus === "in_progress" && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-4">
              <Loader2 className="size-8 text-primary animate-spin" />
              <div>
                <h3 className="text-lg font-semibold text-foreground">Analysis In Progress</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  We are actively generating telemetry and mapping your Microsoft 365 environment.
                  This process analyzes signals across identity, devices, and data.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {data?.telemetryStatus === "completed" && data?.type_attributes && data.type_attributes.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-foreground">Assessment Results</h3>
            </div>
            {data.type_attributes.map((moduleKey) => (
              <AssessmentModulePanel
                key={moduleKey}
                moduleKey={moduleKey}
                serviceSlug="dashboard"
                results={data.results ?? null}
                loading={false}
                error={null}
              />
            ))}
          </div>
        )}

        {/* Active projects */}
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Active Projects</h3>
            <Link href="/customer-documents">
              <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground h-7">
                View documents
                <ArrowRight className="size-3" />
              </Button>
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          ) : data?.projects.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <FolderOpen className="size-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No active projects yet</p>
                <p className="text-xs text-muted-foreground/60">
                  Your engagement projects will appear here once confirmed.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {data?.projects.map((project) => (
                <Card key={project.id}>
                  <CardContent className="py-4 px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium truncate">{project.title}</p>
                          <Badge
                            className={`text-[10px] px-1.5 py-0 h-4 border ${STATUS_COLORS[project.status] ?? "bg-muted text-muted-foreground border-border"}`}
                          >
                            {project.status}
                          </Badge>
                        </div>
                        {project.currentTask && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Activity className="size-3 text-primary shrink-0" />
                            Step {project.currentTask.stepNumber}/{project.currentTask.totalSteps}:{" "}
                            {project.currentTask.title}
                          </p>
                        )}
                        {!project.currentTask && project.currentStepTitle && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Activity className="size-3 text-primary shrink-0" />
                            {project.currentStepTitle}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-foreground">
                          {project.progress}%
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {relativeDate(project.updatedAt)}
                        </p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, project.progress))}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Active subscriptions */}
        {(data?.clientServices?.length ?? 0) > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Active Services</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data?.clientServices.slice(0, 4).map((cs) => (
                <Card key={cs.cs.id}>
                  <CardContent className="flex items-center gap-3 py-4">
                    <CheckCircle2 className="size-4 text-green-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{cs.service.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {cs.service.billingType.replace("_", " ")} · ${cs.service.price}
                      </p>
                    </div>
                    <Badge
                      className={`text-[10px] px-1.5 py-0 h-4 border ${STATUS_COLORS[cs.cs.status] ?? "bg-muted text-muted-foreground border-border"}`}
                    >
                      {cs.cs.status}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Recent reports */}
        {(data?.reports?.length ?? 0) > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Recent Reports</h3>
              <Link href="/customer-documents">
                <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground h-7">
                  All documents
                  <ArrowRight className="size-3" />
                </Button>
              </Link>
            </div>
            <div className="space-y-2">
              {data?.reports.map((report) => (
                <Card key={report.id}>
                  <CardContent className="flex items-center gap-3 py-3">
                    <FileText className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{report.title}</p>
                      {report.period && (
                        <p className="text-xs text-muted-foreground capitalize">{report.period} report</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <Clock className="size-3" />
                      {relativeDate(report.createdAt)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Help card */}
        <Card className="border-dashed bg-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Need help?</CardTitle>
            <CardDescription className="text-xs">
              Your modernisation journey is backed by a 30-year Microsoft veteran and M365 Architect
              for NASA.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">
              Review your diagnostics findings and pending offer under{" "}
              <Link href="/customer-diagnostics">
                <span className="text-primary underline underline-offset-2 cursor-pointer">
                  Diagnostics &amp; Offers
                </span>
              </Link>
              , or browse your documents under{" "}
              <Link href="/customer-documents">
                <span className="text-primary underline underline-offset-2 cursor-pointer">
                  Documents
                </span>
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
