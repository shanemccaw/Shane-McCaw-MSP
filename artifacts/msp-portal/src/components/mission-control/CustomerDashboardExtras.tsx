/**
 * CustomerDashboardExtras.tsx
 *
 * Content relocated from the pre-redesign customer-home.tsx onto the real
 * customer landing page (customer-dashboard.tsx), sitting below <MissionControl>.
 * Preserves working functionality that Mission Control doesn't cover: the
 * re-activation promo banner, quick-action links, active projects/services,
 * recent reports, and a help card. The welcome header keeps only the greeting —
 * the old unread-notifications count is dropped as redundant with the
 * top-bar <NotificationBell> (live SSE-driven, already mounted for every
 * customer-facing page via AppShell).
 *
 * Data sources:
 *   - /api/portal/dashboard for customerStatus/mspId (promo banner gate) and
 *     projects/clientServices/reports. Same endpoint app-shell.tsx already
 *     calls for its own inactive-account banner — customerStatus/mspId were
 *     added to that response's payload alongside this task so both banners
 *     actually fire (previously always undefined, so both were permanently
 *     dark regardless of real customer status).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
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
  CheckCircle2,
  Clock,
  FileText,
  FolderOpen,
  FolderSync,
  MessageSquare,
  ShieldCheck,
  Zap,
} from "lucide-react";

// ── Types (server payload shapes — /api/portal/dashboard) ───────────────────

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

interface DashboardData {
  projects: EnrichedProject[];
  clientServices: ClientService[];
  reports: Report[];
  customerStatus: string | null;
  mspId: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

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

const STATUS_DOT: Record<string, string> = {
  active: "bg-status-green",
  paused: "bg-status-amber",
  completed: "bg-status-blue",
  cancelled: "bg-status-red",
};

const STATUS_TEXT: Record<string, string> = {
  active: "text-status-green",
  paused: "text-status-amber",
  completed: "text-status-blue",
  cancelled: "text-status-red",
};

/** Status tag — same dot + text treatment as Mission Control's engine strip / finding cards, never color alone. */
function StatusTag({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground rounded-[var(--radius-control)] border border-border px-2 py-0.5">
      <span className={`size-2 rounded-full ${STATUS_DOT[status] ?? "bg-muted-foreground"}`} aria-hidden="true" />
      <span className={STATUS_TEXT[status] ?? "text-muted-foreground"}>{status}</span>
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export function CustomerDashboardExtras() {
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
    <div className="space-y-6">
      {/* Welcome header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Welcome back, {firstName}
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Your Microsoft 365 modernisation dashboard
        </p>
      </div>

      {/* Re-activation promo campaign banner for offboarded customers */}
      {data?.customerStatus === "inactive" && data?.mspId === 1 && (
        <Card className="border-primary/45 bg-gradient-to-r from-primary/10 via-primary/5 to-background overflow-hidden relative shadow-lg">
          <div className="absolute top-0 right-0 size-32 bg-primary/5 rounded-full blur-2xl" />
          <CardContent className="p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <Badge className="bg-primary/20 text-primary border-primary/30 hover:bg-primary/20">Special Offer</Badge>
              <h3 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
                Take Your M365 Modernisation to the Next Level
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your cloud modernisation, security, and compliance shouldn&apos;t be left to chance. Re-activate your modernisation and monitoring retainer with <strong>Shane McCaw</strong> (NASA M365 Architect & 30-year veteran) today and secure <strong>15% off your first month</strong>.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto shrink-0">
              <Link href="/offboarding" className="w-full sm:w-auto">
                <Button className="w-full sm:w-auto gap-2 shadow-md">
                  <Zap className="size-4" />
                  Re-activate Retainer
                </Button>
              </Link>
              <Link href="/support" className="w-full sm:w-auto">
                <Button variant="outline" className="w-full sm:w-auto">
                  Talk to Shane
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick-action cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link href="/customer-documents">
          <Card className="cursor-pointer hover:border-primary/50 transition-colors group">
            <CardContent className="flex items-center gap-3 py-5">
              <div className="size-9 rounded-[var(--radius-control)] bg-muted flex items-center justify-center group-hover:bg-secondary transition-colors">
                <FileText className="size-4 text-status-blue" />
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
              <div className="size-9 rounded-[var(--radius-control)] bg-muted flex items-center justify-center group-hover:bg-secondary transition-colors">
                <Zap className="size-4 text-status-violet" />
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
              <div className="size-9 rounded-[var(--radius-control)] bg-muted flex items-center justify-center group-hover:bg-secondary transition-colors">
                <ShieldCheck className="size-4 text-status-green" />
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
              <div className="size-9 rounded-[var(--radius-control)] bg-muted flex items-center justify-center group-hover:bg-secondary transition-colors">
                <FolderSync className="size-4 text-status-blue" />
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
            <div className="size-9 rounded-[var(--radius-control)] bg-muted flex items-center justify-center">
              <MessageSquare className="size-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Messages</p>
              <p className="text-xs text-muted-foreground">See bell for unread</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active projects */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold tracking-tight text-foreground">Active Projects</h3>
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
          <Card>
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
                        <StatusTag status={project.status} />
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
          <h3 className="text-lg font-semibold tracking-tight text-foreground mb-3">Active Services</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data?.clientServices.slice(0, 4).map((cs) => (
              <Card key={cs.cs.id}>
                <CardContent className="flex items-center gap-3 py-4">
                  <CheckCircle2 className="size-4 text-status-green shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{cs.service.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {cs.service.billingType.replace("_", " ")} · ${cs.service.price}
                    </p>
                  </div>
                  <StatusTag status={cs.cs.status} />
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
            <h3 className="text-lg font-semibold tracking-tight text-foreground">Recent Reports</h3>
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
      <Card className="bg-muted/20">
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
              <span className="text-status-blue underline underline-offset-2 cursor-pointer">
                Diagnostics &amp; Offers
              </span>
            </Link>
            , or browse your documents under{" "}
            <Link href="/customer-documents">
              <span className="text-status-blue underline underline-offset-2 cursor-pointer">
                Documents
              </span>
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
