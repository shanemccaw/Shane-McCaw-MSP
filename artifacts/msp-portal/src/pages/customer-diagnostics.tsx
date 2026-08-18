import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
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
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Cloud,
  Clock,
  Download,
  FileSignature,
  Info,
  KeyRound,
  Laptop,
  Layers,
  Loader2,
  Mail,
  MessageSquare,
  ScrollText,
  Share2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BenchmarkPillar {
  pillar: string;
  displayScore: number | null;
  industryAvgPct: number | null;
  msExcellencePct: number | null;
  source: string | null;
  asOfDate: string | null;
}

interface HealthBenchmarkData {
  pillars: BenchmarkPillar[];
  asOfDate: string | null;
}

interface DiagnosticRun {
  runId: string;
  status: string;
  checksTotal: number;
  checksOk: number;
  checksError: number;
  checksRequiresScript: number;
  createdAt: string;
  completedAt?: string;
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

interface LatestPresentation {
  id: number;
  status: string;
  totalPrice: number | null;
  createdAt: string | null;
}

interface LicenseWaste {
  monthlyCents: number;
  annualCents: number;
  seatCount: number;
  skuCount: number;
  sourceCheckKey: string;
  topSku: { displayName: string; count: number; monthlyCents: number } | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const PRESENTATION_STATUS: Record<
  string,
  { label: string; icon: React.ElementType; color: string }
> = {
  active: {
    label: "Pending review",
    icon: Clock,
    color: "text-amber-400",
  },
  signed: {
    label: "Agreement signed",
    icon: CheckCircle2,
    color: "text-green-400",
  },
  paid: {
    label: "Engagement confirmed",
    icon: CheckCircle2,
    color: "text-primary",
  },
};

// ── Finding severity config ───────────────────────────────────────────────────

const FINDING_SEVERITY_CONFIG = {
  critical: { label: "Critical", icon: AlertCircle, color: "text-red-400",   bg: "bg-red-500/10 border-red-500/30",     riskFrame: "Compliance risk exposure — immediate action recommended" },
  warning:  { label: "Warning",  icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", riskFrame: "Attention needed to maintain security posture" },
  info:     { label: "Info",     icon: Info,          color: "text-blue-400",  bg: "bg-blue-500/10 border-blue-500/30",   riskFrame: "Review recommended for optimisation" },
  ok:       { label: "OK",       icon: CheckCircle2,  color: "text-green-400", bg: "bg-green-500/10 border-green-500/30", riskFrame: "" },
} as const;

function FindingBadge({ severity }: { severity: DiagnosticFinding["severity"] }) {
  const cfg = FINDING_SEVERITY_CONFIG[severity];
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 border ${cfg.bg} ${cfg.color}`}>
      {cfg.label}
    </Badge>
  );
}

// ── Finding grouping by checkKey domain (#1154) ───────────────────────────────
//
// A real tenant's latest run returns ~50 actionable findings spanning ~11 check
// domains, previously rendered as one flat list sorted only by the severity
// string (which mis-orders "info" ahead of "warning"). We group by the checkKey
// domain prefix (`identity:`, `security:`, `appgov:`, …) — the only stable
// per-finding grouping the /api/portal/diagnostics/latest response already
// carries — into collapsible, severity-rolled-up sections sorted
// worst-severity-first, mirroring the #1102 Intelligence Signals redesign.
// Presentation/IA only: no API or schema change.

type ActionableSeverity = "critical" | "warning" | "info";

const FINDING_SEVERITY_RANK: Record<ActionableSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const FINDING_CATEGORY_META: Record<string, { label: string; icon: React.ElementType }> = {
  identity:   { label: "Identity & Access", icon: KeyRound },
  security:   { label: "Security",          icon: ShieldCheck },
  appgov:     { label: "App Governance",    icon: Boxes },
  governance: { label: "Governance",        icon: ScrollText },
  compliance: { label: "Compliance",        icon: ClipboardCheck },
  copilot:    { label: "Copilot AI",        icon: Sparkles },
  teams:      { label: "Teams",             icon: MessageSquare },
  sharepoint: { label: "SharePoint",        icon: Share2 },
  onedrive:   { label: "OneDrive",          icon: Cloud },
  exchange:   { label: "Exchange",          icon: Mail },
  adoption:   { label: "Adoption",          icon: TrendingUp },
  cost:       { label: "Cost & Licensing",  icon: CircleDollarSign },
  license:    { label: "Licensing",         icon: CircleDollarSign },
  devices:    { label: "Devices",           icon: Laptop },
  m365:       { label: "Microsoft 365",     icon: Layers },
};

/** The stable domain group for a finding — the checkKey prefix before the first ':'. */
function findingDomainKey(checkKey: string): string {
  const idx = checkKey.indexOf(":");
  return idx > 0 ? checkKey.slice(0, idx) : "other";
}

/** Human label for a domain prefix that has no explicit entry in FINDING_CATEGORY_META. */
function titleCasePrefix(prefix: string): string {
  return (
    prefix
      .replace(/[-_]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || "Other"
  );
}

function severityRank(severity: DiagnosticFinding["severity"]): number {
  return FINDING_SEVERITY_RANK[severity as ActionableSeverity] ?? FINDING_SEVERITY_RANK.info;
}

interface FindingGroup {
  key: string;
  label: string;
  icon: React.ElementType;
  findings: DiagnosticFinding[];
  counts: Record<ActionableSeverity, number>;
  worstRank: number;
}

/**
 * Bucket findings by checkKey domain, count severities per group, sort findings
 * within a group critical→warning→info, and order groups worst-severity-first
 * (ties broken by larger group first) so the tenant's biggest problem area leads.
 */
function groupDiagnosticFindings(findings: DiagnosticFinding[]): FindingGroup[] {
  const byKey = new Map<string, DiagnosticFinding[]>();
  for (const f of findings) {
    const key = findingDomainKey(f.checkKey);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(f);
    else byKey.set(key, [f]);
  }

  const groups: FindingGroup[] = Array.from(byKey.entries()).map(([key, groupFindings]) => {
    const counts: Record<ActionableSeverity, number> = { critical: 0, warning: 0, info: 0 };
    for (const f of groupFindings) {
      if (f.severity === "critical" || f.severity === "warning" || f.severity === "info") {
        counts[f.severity]++;
      }
    }
    const worstRank = Math.min(...groupFindings.map((f) => severityRank(f.severity)));
    const meta = FINDING_CATEGORY_META[key] ?? { label: titleCasePrefix(key), icon: Layers };
    return {
      key,
      label: meta.label,
      icon: meta.icon,
      findings: groupFindings
        .slice()
        .sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
      counts,
      worstRank,
    };
  });

  return groups.sort(
    (a, b) => a.worstRank - b.worstRank || b.findings.length - a.findings.length,
  );
}

// ── Benchmark bar ─────────────────────────────────────────────────────────────

const PILLAR_LABELS: Record<string, string> = {
  governance: "Governance",
  security: "Security",
  compliance: "Compliance",
  adoption: "Adoption",
  copilot: "Copilot AI",
  architecture: "Architecture",
  licensing: "Licensing",
};

function benchmarkBadge(score: number, industryAvg: number | null, msExcellence: number | null): {
  label: string;
  color: string;
  bg: string;
} {
  if (msExcellence !== null && score >= msExcellence) {
    return { label: "Above Excellence", color: "text-primary", bg: "bg-primary/15 border-primary/30" };
  }
  if (industryAvg !== null && score >= industryAvg) {
    return { label: "Above Industry Avg", color: "text-green-400", bg: "bg-green-500/15 border-green-500/30" };
  }
  if (industryAvg !== null && score >= industryAvg - 10) {
    return { label: "Near Industry Avg", color: "text-amber-400", bg: "bg-amber-500/15 border-amber-500/30" };
  }
  return { label: "Below Industry Avg", color: "text-red-400", bg: "bg-red-500/15 border-red-500/30" };
}

function BenchmarkBar({ data }: { data: BenchmarkPillar }) {
  const label = PILLAR_LABELS[data.pillar] ?? data.pillar;

  // Show placeholder when either the engine score or the benchmark reference
  // data is missing — a bar without any reference markers has no comparative value.
  const hasBenchmarkRef = data.industryAvgPct !== null || data.msExcellencePct !== null;
  if (data.displayScore === null || !hasBenchmarkRef) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-medium">{label}</span>
          <span className="text-muted-foreground/50 text-[10px]">Not enough data yet</span>
        </div>
        <div className="h-2 bg-muted rounded-full" />
      </div>
    );
  }

  const score = data.displayScore;
  const badge = benchmarkBadge(score, data.industryAvgPct, data.msExcellencePct);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
        <span className="text-muted-foreground font-medium">{label}</span>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 h-4 border ${badge.bg} ${badge.color}`}
          >
            {badge.label}
          </Badge>
          <span className={`font-bold text-xs ${badge.color}`}>{score}%</span>
        </div>
      </div>

      {/* Progress bar with optional benchmark markers */}
      <div className="relative h-2 bg-muted rounded-full overflow-visible">
        {/* Your score bar */}
        <div
          className="h-2 rounded-full bg-primary transition-all duration-700"
          style={{ width: `${score}%` }}
        />
        {/* Industry average marker */}
        {data.industryAvgPct !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3.5 bg-amber-400 rounded-full"
            style={{ left: `${data.industryAvgPct}%` }}
            title={`Industry avg: ${data.industryAvgPct}%`}
          />
        )}
        {/* MS Excellence marker */}
        {data.msExcellencePct !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3.5 bg-green-400 rounded-full"
            style={{ left: `${data.msExcellencePct}%` }}
            title={`MS Excellence: ${data.msExcellencePct}%`}
          />
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CustomerDiagnosticsPage() {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();

  const [presentation, setPresentation] = useState<LatestPresentation | null | undefined>(
    undefined,
  );
  const [licenseWaste, setLicenseWaste] = useState<LicenseWaste | null>(null);
  const [loadingPresentation, setLoadingPresentation] = useState(true);
  const [loadingCostSavings, setLoadingCostSavings] = useState(true);

  // Real diagnostic findings from the Monitoring Package engine
  const [latestRun, setLatestRun] = useState<DiagnosticRun | null>(null);
  const [diagnosticFindings, setDiagnosticFindings] = useState<DiagnosticFinding[]>([]);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(true);

  // Engine-backed health benchmark data
  const [benchmark, setBenchmark] = useState<HealthBenchmarkData | null>(null);
  const [loadingBenchmark, setLoadingBenchmark] = useState(true);

  const [downloadingScript, setDownloadingScript] = useState<string | null>(null);

  async function handleScriptDownload(checkKey: string) {
    setDownloadingScript(checkKey);
    try {
      const res = await fetchWithAuth(`/api/portal/scripts/${encodeURIComponent(checkKey)}/download`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Download failed" })) as { error?: string };
        toast.error(data.error ?? "This script isn't available yet — check back later or contact your MSP.");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match ? match[1] : `${checkKey}.ps1`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Script downloaded — run it in your environment when you're ready.");
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setDownloadingScript(null);
    }
  }

  useEffect(() => {
    let mounted = true;

    fetchWithAuth("/api/portal/presentations/latest")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { presentation: LatestPresentation | null };
        if (mounted) setPresentation(data.presentation);
      })
      .catch(() => {
        if (mounted) setPresentation(null);
      })
      .finally(() => {
        if (mounted) setLoadingPresentation(false);
      });

    fetchWithAuth("/api/portal/assessment/status")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { stats?: { licenseWaste?: LicenseWaste | null } };
        if (mounted) setLicenseWaste(data.stats?.licenseWaste ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoadingCostSavings(false);
      });

    fetchWithAuth("/api/portal/diagnostics/latest")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { run: DiagnosticRun | null; findings: DiagnosticFinding[] };
        if (!mounted) return;
        setLatestRun(data.run ?? null);
        setDiagnosticFindings(data.findings ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoadingDiagnostics(false);
      });

    fetchWithAuth("/api/portal/health-benchmark")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as HealthBenchmarkData;
        if (mounted) setBenchmark(data);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoadingBenchmark(false);
      });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Diagnostic findings: grouped + triaged for scannability (#1154) ──────────
  // Hide "ok" findings, group the rest by checkKey domain, worst-severity-first.
  const actionableFindings = useMemo(
    () => diagnosticFindings.filter((f) => f.severity !== "ok"),
    [diagnosticFindings],
  );
  const findingGroups = useMemo(
    () => groupDiagnosticFindings(actionableFindings),
    [actionableFindings],
  );
  const findingTotals = useMemo(() => {
    const t: Record<ActionableSeverity, number> = { critical: 0, warning: 0, info: 0 };
    for (const f of actionableFindings) {
      if (f.severity === "critical" || f.severity === "warning" || f.severity === "info") {
        t[f.severity]++;
      }
    }
    return t;
  }, [actionableFindings]);

  // Progressive disclosure: info-only groups start collapsed, groups carrying any
  // critical/warning start open. `collapsedOverrides` records only the groups the
  // user has explicitly toggled away from that default.
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const isGroupCollapsed = (g: FindingGroup) =>
    collapsedOverrides[g.key] ?? g.worstRank === FINDING_SEVERITY_RANK.info;
  const toggleGroup = (g: FindingGroup) =>
    setCollapsedOverrides((prev) => ({ ...prev, [g.key]: !isGroupCollapsed(g) }));

  const presStatus = presentation
    ? (PRESENTATION_STATUS[presentation.status] ?? PRESENTATION_STATUS.active)
    : null;

  return (
    <AppShell title="Diagnostics & Offers">
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Diagnostics & Offers</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Your Microsoft 365 environment findings and pending engagement offer.
          </p>
        </div>

        {/* ── Pending offer / presentation ── */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Engagement Offer</h3>

          {loadingPresentation ? (
            <Skeleton className="h-28 w-full rounded-xl" />
          ) : !presentation ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <Zap className="size-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No pending offer</p>
                <p className="text-xs text-muted-foreground/60 max-w-sm">
                  Once your MSP has reviewed your diagnostics and generated a proposal, it will
                  appear here for your review.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className={presentation.status === "paid" ? "border-primary/30" : ""}>
              <CardContent className="py-5 px-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3">
                    <div
                      className={`size-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        presentation.status === "paid"
                          ? "bg-primary/15"
                          : presentation.status === "signed"
                          ? "bg-green-500/15"
                          : "bg-amber-500/15"
                      }`}
                    >
                      {presStatus && (
                        <presStatus.icon
                          className={`size-4 ${presStatus.color}`}
                        />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {presentation.status === "paid"
                          ? "Engagement Confirmed — Work has begun"
                          : presentation.status === "signed"
                          ? "Agreement Signed — Awaiting payment confirmation"
                          : "Review & Sign Your Engagement Agreement"}
                      </p>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {presentation.totalPrice != null && presentation.totalPrice > 0 && (
                          <span className="text-xs text-muted-foreground font-medium">
                            ${Number(presentation.totalPrice).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                        )}
                        {presStatus && (
                          <Badge
                            className={`text-[10px] px-1.5 py-0 h-4 border ${
                              presentation.status === "paid"
                                ? "bg-primary/15 text-primary border-primary/30"
                                : presentation.status === "signed"
                                ? "bg-green-500/15 text-green-400 border-green-500/30"
                                : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                            }`}
                          >
                            {presStatus.label}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="size-3" />
                          {relativeDate(presentation.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {presentation.status === "active" && (
                    <Button
                      size="sm"
                      className="gap-2 shrink-0"
                      onClick={() => navigate(`/customer-sow/${presentation.id}`)}
                    >
                      <FileSignature className="size-3.5" />
                      Review & Sign
                    </Button>
                  )}

                  {presentation.status === "signed" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 shrink-0"
                      onClick={() => navigate(`/customer-sow/${presentation.id}`)}
                    >
                      View Agreement
                      <ChevronRight className="size-3.5" />
                    </Button>
                  )}

                  {presentation.status === "paid" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 shrink-0"
                      onClick={() => navigate(`/customer-sow/${presentation.id}`)}
                    >
                      View Details
                      <ChevronRight className="size-3.5" />
                    </Button>
                  )}
                </div>

                {/* Paid engagement status message */}
                {presentation.status === "paid" && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-primary/10 border border-primary/20 px-4 py-3">
                    <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-primary">Your engagement is confirmed</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Work has begun on your Microsoft 365 modernisation. Check your active
                        projects on your home dashboard for progress updates.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Live diagnostic findings (from Monitoring Package engine) ── */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Live Diagnostic Findings</h3>

          {loadingDiagnostics ? (
            <Skeleton className="h-28 w-full rounded-xl" />
          ) : !latestRun ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-8 text-center gap-2">
                <ShieldCheck className="size-7 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No diagnostic run yet</p>
                <p className="text-xs text-muted-foreground/60 max-w-sm">
                  Your MSP will run a Microsoft 365 environment check. Structured findings will appear here once complete.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {/* Run summary bar */}
              <Card>
                <CardContent className="py-3 px-5">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Last run</p>
                      <p className="text-sm font-medium">
                        {latestRun.checksTotal} checks · {latestRun.checksOk} passed · {latestRun.checksError} errors
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="size-3" />
                      {relativeDate(latestRun.createdAt)}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Findings — hide ok, group by domain, collapsible, worst-first (#1154) */}
              {actionableFindings.length === 0 ? (
                <Card className="border-green-500/20 bg-green-500/5">
                  <CardContent className="flex items-center gap-3 py-4 px-5">
                    <CheckCircle2 className="size-5 text-green-400 shrink-0" />
                    <p className="text-sm text-green-400">All checks passed — no issues found</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {/* Summary rollup — total to review + severity mix at a glance */}
                  <div className="flex items-center justify-between gap-3 flex-wrap px-1">
                    <p className="text-xs text-muted-foreground">
                      {actionableFindings.length} finding{actionableFindings.length === 1 ? "" : "s"} to
                      review across {findingGroups.length} area{findingGroups.length === 1 ? "" : "s"}
                    </p>
                    <div className="flex items-center gap-2">
                      {(["critical", "warning", "info"] as ActionableSeverity[])
                        .filter((sev) => findingTotals[sev] > 0)
                        .map((sev) => {
                          const cfg = FINDING_SEVERITY_CONFIG[sev];
                          return (
                            <Badge
                              key={sev}
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 h-4 border ${cfg.bg} ${cfg.color}`}
                            >
                              {findingTotals[sev]} {cfg.label}
                            </Badge>
                          );
                        })}
                    </div>
                  </div>

                  {/* Collapsible domain groups */}
                  <div className="space-y-2">
                    {findingGroups.map((group) => {
                      const collapsed = isGroupCollapsed(group);
                      const GroupIcon = group.icon;
                      return (
                        <div
                          key={group.key}
                          className="rounded-xl border border-border overflow-hidden"
                        >
                          <button
                            type="button"
                            onClick={() => toggleGroup(group)}
                            aria-expanded={!collapsed}
                            data-testid={`finding-group-${group.key}`}
                            className="w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-secondary/30 hover:bg-secondary/50 transition-colors text-left"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <GroupIcon className="size-4 text-muted-foreground shrink-0" />
                              <span className="text-sm font-semibold truncate">{group.label}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {group.findings.length}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {(["critical", "warning", "info"] as ActionableSeverity[])
                                .filter((sev) => group.counts[sev] > 0)
                                .map((sev) => {
                                  const cfg = FINDING_SEVERITY_CONFIG[sev];
                                  return (
                                    <Badge
                                      key={sev}
                                      variant="outline"
                                      className={`text-[10px] px-1.5 py-0 h-4 border ${cfg.bg} ${cfg.color}`}
                                    >
                                      {group.counts[sev]} {cfg.label}
                                    </Badge>
                                  );
                                })}
                              <ChevronDown
                                className={`size-4 text-muted-foreground transition-transform ${
                                  collapsed ? "-rotate-90" : ""
                                }`}
                              />
                            </div>
                          </button>

                          {!collapsed && (
                            <div className="p-2 space-y-2">
                              {group.findings.map((f) => {
                                const cfg = FINDING_SEVERITY_CONFIG[f.severity];
                                const Icon = cfg.icon;
                                return (
                                  <div
                                    key={f.findingId}
                                    className={`rounded-lg border px-4 py-3 ${cfg.bg}`}
                                  >
                                    <div className="flex items-start gap-3">
                                      <Icon className={`size-4 ${cfg.color} shrink-0 mt-0.5`} />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                          <p className="text-sm font-medium">{f.checkLabel || f.checkKey}</p>
                                          <FindingBadge severity={f.severity} />
                                        </div>
                                        <p className="text-xs text-muted-foreground">{f.title}</p>
                                        {f.description && (
                                          <p className="text-xs text-muted-foreground/70 mt-1">{f.description}</p>
                                        )}
                                        {cfg.riskFrame && (
                                          <p className={`text-[11px] font-medium mt-2 ${cfg.color}`}>
                                            {cfg.riskFrame}
                                          </p>
                                        )}
                                        {f.checkStatus === "requires_script" && (
                                          <div className="mt-2">
                                            <p className="text-xs text-muted-foreground/80">
                                              This check needs a script run in your environment — download it here.
                                              Results may take some time to appear after you run it.
                                            </p>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="mt-2 h-7 text-xs"
                                              disabled={downloadingScript === f.checkKey}
                                              onClick={() => handleScriptDownload(f.checkKey)}
                                            >
                                              {downloadingScript === f.checkKey ? (
                                                <Loader2 className="size-3 mr-1 animate-spin" />
                                              ) : (
                                                <Download className="size-3 mr-1" />
                                              )}
                                              Download script
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Annual Cost Savings (real Cost Engine license-waste data, Git #1156) ── */}
        <div data-testid="annual-cost-savings-section">
          <h3 className="text-sm font-semibold text-foreground mb-3">Annual Cost Savings</h3>

          {loadingCostSavings ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : !licenseWaste ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <CircleDollarSign className="size-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No license waste data yet</p>
                <p className="text-xs text-muted-foreground/60 max-w-sm">
                  Once your MSP completes a diagnostic scan, identified license waste in your
                  Microsoft 365 tenant will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-green-500/20 bg-green-500/5">
              <CardContent className="py-5 px-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">
                      Identified License Waste
                    </p>
                    <p className="text-3xl font-extrabold text-green-400" data-testid="annual-cost-savings-value">
                      ${Math.round(licenseWaste.annualCents / 100).toLocaleString("en-US")}
                      <span className="text-sm text-muted-foreground font-normal">/year</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      ${Math.round(licenseWaste.monthlyCents / 100).toLocaleString("en-US")}/month
                      across {licenseWaste.seatCount} unused seat{licenseWaste.seatCount === 1 ? "" : "s"}
                      {" "}in {licenseWaste.skuCount} license{licenseWaste.skuCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  {licenseWaste.topSku && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground font-medium">Biggest opportunity</p>
                      <p className="text-sm font-semibold text-foreground">{licenseWaste.topSku.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {licenseWaste.topSku.count} seat{licenseWaste.topSku.count === 1 ? "" : "s"} · $
                        {Math.round(licenseWaste.topSku.monthlyCents / 100).toLocaleString("en-US")}/mo
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Health Benchmarking ── */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Health Benchmarking</h3>

          {loadingBenchmark ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : !benchmark || benchmark.pillars.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <ShieldCheck className="size-7 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Benchmarking unavailable</p>
                <p className="text-xs text-muted-foreground/60 max-w-sm">
                  Health benchmarking requires at least one completed diagnostic run with signal data.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Microsoft 365 Environment Health</CardTitle>
                <CardDescription className="text-xs">
                  Your environment scored against industry averages and Microsoft Excellence targets.
                  {" "}
                  <span className="inline-flex items-center gap-1.5 mt-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-400" /> Industry avg
                    <span className="inline-block w-2 h-2 rounded-full bg-green-400 ml-2" /> MS Excellence
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {benchmark.pillars.map(p => (
                  <BenchmarkBar key={p.pillar} data={p} />
                ))}
                <div className="pt-1 space-y-0.5">
                  {(() => {
                    const sourced = benchmark.pillars.filter(p => p.source && p.asOfDate);
                    const uniqueSources = [...new Map(sourced.map(p => [p.source, p])).values()];
                    return uniqueSources.map(p => (
                      <p key={p.source} className="text-[10px] text-muted-foreground/50">
                        Industry benchmarks sourced from{" "}
                        <span className="italic">{p.source}</span>
                        {p.asOfDate ? `, as of ${p.asOfDate}` : ""}.
                      </p>
                    ));
                  })()}
                  <p className="text-[10px] text-muted-foreground/50">
                    Health scores computed by the platform&apos;s Health Engine from live tenant signals.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* CTA to review offer */}
        {presentation?.status === "active" && (
          <Card className="border border-primary/30 bg-primary/5">
            <CardContent className="flex items-center justify-between py-4 gap-4">
              <div className="flex items-center gap-3">
                <FileSignature className="size-5 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-semibold">You have a pending engagement offer</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Review the scope, pricing, and sign the agreement to get started.
                  </p>
                </div>
              </div>
              <Link href={`/customer-sow/${presentation.id}`}>
                <Button size="sm" className="gap-2 shrink-0">
                  Review Offer
                  <ArrowRight className="size-3.5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
