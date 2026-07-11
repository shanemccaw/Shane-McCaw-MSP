import { useEffect, useState } from "react";
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
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileSignature,
  Info,
  Loader2,
  ShieldCheck,
  Zap,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface QuizResult {
  id: string;
  totalScore: number | null;
  tier: string | null;
  categoryScores: Record<string, number> | null;
  analysisText: string | null;
  createdAt: string | null;
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

const TIER_STYLES: Record<string, { label: string; bg: string; text: string; bar: string }> = {
  critical: {
    label: "Critical",
    bg: "bg-red-500/10 border-red-500/30",
    text: "text-red-400",
    bar: "bg-red-400",
  },
  high: {
    label: "High Priority",
    bg: "bg-amber-500/10 border-amber-500/30",
    text: "text-amber-400",
    bar: "bg-amber-400",
  },
  medium: {
    label: "Moderate",
    bg: "bg-yellow-500/10 border-yellow-500/30",
    text: "text-yellow-400",
    bar: "bg-yellow-400",
  },
  low: {
    label: "Low Risk",
    bg: "bg-green-500/10 border-green-500/30",
    text: "text-green-400",
    bar: "bg-green-400",
  },
};

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

// ── Score bar ──────────────────────────────────────────────────────────────────

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const tierKey = pct < 30 ? "critical" : pct < 50 ? "high" : pct < 70 ? "medium" : "low";
  const style = TIER_STYLES[tierKey];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground font-medium capitalize">
          {label.replace(/_/g, " ")}
        </span>
        <span className={`font-semibold ${style.text}`}>{Math.round(pct)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${style.bar}`}
          style={{ width: `${pct}%` }}
        />
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
  const [quizResults, setQuizResults] = useState<QuizResult[]>([]);
  const [loadingPresentation, setLoadingPresentation] = useState(true);
  const [loadingQuiz, setLoadingQuiz] = useState(true);

  // Real diagnostic findings from the Monitoring Package engine
  const [latestRun, setLatestRun] = useState<DiagnosticRun | null>(null);
  const [diagnosticFindings, setDiagnosticFindings] = useState<DiagnosticFinding[]>([]);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(true);

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

    fetchWithAuth("/api/portal/quiz-results")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as QuizResult | QuizResult[] | null;
        if (!mounted) return;
        if (Array.isArray(data)) setQuizResults(data);
        else if (data) setQuizResults([data]);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoadingQuiz(false);
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

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latestQuiz = quizResults[0] ?? null;
  const categoryScores = latestQuiz?.categoryScores ?? {};
  const hasScores = Object.keys(categoryScores).length > 0;

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

              {/* Findings list — hide ok findings to keep it actionable */}
              {diagnosticFindings.filter(f => f.severity !== "ok").length === 0 ? (
                <Card className="border-green-500/20 bg-green-500/5">
                  <CardContent className="flex items-center gap-3 py-4 px-5">
                    <CheckCircle2 className="size-5 text-green-400 shrink-0" />
                    <p className="text-sm text-green-400">All checks passed — no issues found</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {diagnosticFindings
                    .filter(f => f.severity !== "ok")
                    .map((f) => {
                      const cfg = FINDING_SEVERITY_CONFIG[f.severity];
                      const Icon = cfg.icon;
                      return (
                        <div key={f.findingId} className={`rounded-xl border px-4 py-3 ${cfg.bg}`}>
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
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Quiz-based scores ── */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Assessment Scores</h3>

          {loadingQuiz ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : !latestQuiz ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
                <AlertCircle className="size-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No diagnostic completed yet</p>
                <p className="text-xs text-muted-foreground/60 max-w-sm">
                  Your MSP will run a Microsoft 365 environment diagnostic. Results and findings
                  will appear here once complete.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Summary card */}
              {latestQuiz.tier && (
                <Card
                  className={`border ${TIER_STYLES[latestQuiz.tier]?.bg ?? "border-border"}`}
                >
                  <CardContent className="py-4 px-5">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">
                          Overall Risk Level
                        </p>
                        <p
                          className={`text-2xl font-extrabold ${TIER_STYLES[latestQuiz.tier]?.text ?? "text-foreground"}`}
                        >
                          {TIER_STYLES[latestQuiz.tier]?.label ?? latestQuiz.tier}
                        </p>
                      </div>
                      {latestQuiz.totalScore != null && (
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground font-medium">Compliance Score</p>
                          <p className="text-2xl font-extrabold text-foreground">
                            {Math.round(latestQuiz.totalScore)}
                            <span className="text-sm text-muted-foreground font-normal">/100</span>
                          </p>
                        </div>
                      )}
                    </div>
                    {latestQuiz.createdAt && (
                      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                        <Clock className="size-3" />
                        Assessment completed {relativeDate(latestQuiz.createdAt)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Category breakdown */}
              {hasScores && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Category Breakdown</CardTitle>
                    <CardDescription className="text-xs">
                      Compliance scores across your Microsoft 365 environment
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {Object.entries(categoryScores).map(([key, score]) => (
                      <ScoreBar key={key} label={key} score={score} />
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Analysis text */}
              {latestQuiz.analysisText && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Expert Analysis</CardTitle>
                    <CardDescription className="text-xs">
                      Key findings from your environment diagnostic
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto">
                      {latestQuiz.analysisText}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
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
