/**
 * CustomerDashboardExtras.tsx
 *
 * Content relocated from the pre-redesign customer-home.tsx onto the real
 * customer landing page (customer-dashboard.tsx), sitting below <MissionControl>.
 * Preserves working functionality that Mission Control doesn't cover: the
 * re-activation promo banner and recent reports. Quick-action cards, Active
 * Projects, and Active Services were removed as redundant with Mission
 * Control / the dashboard canvas. The "Need help?" card (NeedHelpCard) is
 * exported separately so customer-dashboard.tsx can mount it at the very
 * bottom of the page, below <DashboardTabs>. The welcome header keeps only
 * the greeting — the old unread-notifications count is dropped as redundant
 * with the top-bar <NotificationBell> (live SSE-driven, already mounted for
 * every customer-facing page via AppShell).
 *
 * Data sources:
 *   - /api/portal/dashboard for customerStatus/mspId (promo banner gate) and
 *     reports. Same endpoint app-shell.tsx already calls for its own
 *     inactive-account banner — customerStatus/mspId were added to that
 *     response's payload alongside this task so both banners actually fire
 *     (previously always undefined, so both were permanently dark regardless
 *     of real customer status).
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
import { ArrowRight, AlertTriangle, CheckCircle2, Clock, CloudCog, FileText, Zap } from "lucide-react";

// ── Types (server payload shapes — /api/portal/dashboard) ───────────────────

interface Report {
  id: number;
  title: string;
  period: string | null;
  createdAt: string | null;
}

interface DashboardData {
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

// ── Component ─────────────────────────────────────────────────────────────

export function WelcomeHeader() {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "there";

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">
        Welcome back, {firstName}
      </h2>
      <p className="text-muted-foreground text-sm mt-1">
        Your Microsoft 365 modernisation dashboard
      </p>
    </div>
  );
}

export function CustomerDashboardExtras() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/portal/dashboard")
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as DashboardData;
        if (mounted) setData(json);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
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
    </div>
  );
}

// ── M365 Uptime card ─────────────────────────────────────────────────────────
// Compact summary of GET /api/portal/m365-sla/summary — the worst-performing
// service per window and an overall breach flag against Microsoft's own
// 99.9% Monthly Uptime Percentage SLA commitment. The full per-service
// breakdown is an MSP-facing view only (m365-sla.tsx); customers just need
// to know whether their tenant is meeting the SLA.

interface M365SlaWindowSummary {
  uptimePercent: number | null;
  breached: boolean;
  worstService: string | null;
}

interface M365SlaSummaryResponse {
  available: boolean;
  target: number;
  window: Partial<Record<"30" | "90", M365SlaWindowSummary>>;
}

/** "Your M365 uptime" card — mounted on customer-dashboard.tsx below <CustomerDashboardExtras>. */
export function M365UptimeCard() {
  const { fetchWithAuth } = useAuth();
  const [summary, setSummary] = useState<M365SlaSummaryResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/portal/m365-sla/summary")
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as M365SlaSummaryResponse;
        if (mounted) setSummary(json);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!summary?.available) return null;

  const w30 = summary.window["30"];
  if (!w30) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CloudCog className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm">Your M365 Uptime</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Against Microsoft&apos;s {summary.target}% Monthly Uptime Percentage SLA commitment, trailing 30 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {w30.breached ? (
            <Badge className="bg-red-500/15 text-red-400 border-red-500/30 gap-1">
              <AlertTriangle className="size-3" /> Below SLA
            </Badge>
          ) : (
            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1">
              <CheckCircle2 className="size-3" /> Meeting SLA
            </Badge>
          )}
          {w30.uptimePercent !== null && (
            <span className="text-sm font-medium">{w30.uptimePercent.toFixed(3)}%</span>
          )}
        </div>
        {w30.worstService && (
          <span className="text-xs text-muted-foreground">Lowest: {w30.worstService}</span>
        )}
      </CardContent>
    </Card>
  );
}

/** "Need help?" card — mounted at the very bottom of customer-dashboard.tsx, below <DashboardTabs>. */
export function NeedHelpCard() {
  return (
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
  );
}
