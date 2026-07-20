/**
 * executive-mode.tsx
 *
 * Executive Mode — Simplified Leadership View. A single-page, five-tile
 * summary for leadership who don't want the full Mission Control dashboard:
 * overall score, top risks, next best actions, AI executive summary, and a
 * Quarterly Summary action. Deliberately does not render <MissionControl>,
 * <DashboardTabs>, or any dashboard-canvas widgets — this is a fenced-off,
 * stripped-down alternate view, not a smaller copy of the full dashboard.
 *
 * All five tiles are real reuse of already-existing, already-scoped data:
 *   - Score: GET /api/portal/mission-control/engines, health.score inverted
 *     via the same toGoodnessPercent formula MissionControl.tsx uses (raw
 *     score is a higher-is-worse risk sum, not a 0-100 percentage).
 *   - Risks: GET /api/portal/mission-control/overview — same findings feed
 *     Mission Control renders, already severity + recency sorted; this tile
 *     just takes the first few.
 *   - Next Best Action: derived from the SAME overview findings' `action`
 *     field (already the per-finding recommendation text the server
 *     computes) — not a new AI call. ai-next-best-actions.ts was
 *     investigated and is not reusable here: it runs on the legacy CRM
 *     schema (usersTable/projectsTable/opportunitiesTable), is
 *     requireAdmin-only, and is shaped for MSP staff triaging their whole
 *     client portfolio ("what should Shane do today"), not a tenant's own
 *     next action.
 *   - AI Summary: <ExecutiveSummaryCard> reused verbatim, zero changes.
 *   - Quarterly Summary: reuses the existing POST /api/portal/dashboard/share
 *     flow (dashboard-export.ts) that already renders a frozen snapshot into
 *     insights_generated_documents and returns a share link — no new
 *     generation path built.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { ExecutiveSummaryCard } from "@/components/dashboard-view/ExecutiveSummaryCard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ScoreRing, type ScoreRingColor } from "@/components/ui/score-ring";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, AlertCircle, CheckCircle2, Check, Copy, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

// ── Server payload shapes (portal-mission-control.ts) ───────────────────────

interface EnginesResponse {
  health: { score: number | null; pillars: Array<{ pillar: string; score: number }> };
}

interface OverviewFinding {
  id: number;
  checkLabel: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string | null;
  action: string | null;
  createdAt: string;
}

interface OverviewResponse {
  summary: { critical: number; warning: number; info: number };
  findings: OverviewFinding[];
}

const SEVERITY_RANK: Record<OverviewFinding["severity"], number> = { critical: 0, warning: 1, info: 2 };

const SEVERITY_META: Record<OverviewFinding["severity"], { label: string; dot: string; icon: typeof AlertTriangle }> = {
  critical: { label: "Critical", dot: "bg-status-red", icon: AlertTriangle },
  warning: { label: "Warning", dot: "bg-status-amber", icon: AlertCircle },
  info: { label: "Nominal", dot: "bg-status-green", icon: CheckCircle2 },
};

/** Same inversion MissionControl.tsx uses — raw score is a higher-is-worse risk sum. */
function toGoodnessPercent(rawScore: number): number {
  return Math.max(0, Math.min(100, 100 - rawScore));
}

function healthRingColor(goodnessPercent: number | null): ScoreRingColor {
  if (goodnessPercent == null) return "blue";
  if (goodnessPercent < 60) return "red";
  if (goodnessPercent < 85) return "amber";
  return "green";
}

function ScoreTile() {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/portal/mission-control/engines")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as EnginesResponse;
        if (mounted) setScore(data.health.score != null ? toGoodnessPercent(data.health.score) : null);
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="p-6 flex flex-col items-center justify-center gap-3">
      <h2 className="text-sm font-medium text-muted-foreground self-start">Overall Health Score</h2>
      {loading ? (
        <Skeleton className="size-[100px] rounded-full" />
      ) : (
        <ScoreRing value={score ?? 0} color={healthRingColor(score)} size={100} label={score == null ? "No data" : undefined} />
      )}
    </Card>
  );
}

function RiskListTile() {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState<OverviewFinding[]>([]);

  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/portal/mission-control/overview")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as OverviewResponse;
        if (mounted) setFindings(data.findings.slice(0, 5));
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="p-6 space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Top Risks</h2>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      ) : findings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open findings — everything's nominal.</p>
      ) : (
        <ul className="space-y-2">
          {findings.map((f) => {
            const meta = SEVERITY_META[f.severity];
            const Icon = meta.icon;
            return (
              <li key={f.id} className="flex items-start gap-2 rounded-lg border p-3">
                <Icon className={`size-4 mt-0.5 shrink-0 ${meta.dot.replace("bg-", "text-")}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{f.title}</p>
                  <p className="text-xs text-muted-foreground">{meta.label} · {f.checkLabel}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function NextBestActionTile() {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [actions, setActions] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/portal/mission-control/overview")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as OverviewResponse;
        const sorted = [...data.findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
        const distinct: string[] = [];
        for (const f of sorted) {
          if (f.action && !distinct.includes(f.action)) distinct.push(f.action);
          if (distinct.length >= 5) break;
        }
        if (mounted) setActions(distinct);
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="p-6 space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Next Best Actions</h2>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-8 w-full rounded-lg" />
        </div>
      ) : actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recommended actions right now.</p>
      ) : (
        <ol className="space-y-2 list-decimal list-inside">
          {actions.map((a, i) => (
            <li key={i} className="text-sm">{a}</li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function QuarterlySummaryDialog({ onClose }: { onClose: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/portal/dashboard/share", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          toast.error("Could not generate the quarterly summary. Please try again.");
          return;
        }
        const data = (await res.json()) as { shareUrl: string; expiresAt: string };
        if (mounted) {
          setShareUrl(data.shareUrl);
          setExpiresAt(data.expiresAt);
        }
      })
      .catch(() => toast.error("Could not generate the quarterly summary. Please try again."))
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => toast.error("Could not copy link. Please copy it manually."));
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Quarterly Summary</DialogTitle>
          <DialogDescription>
            A point-in-time snapshot of your current status, generated and saved for the record.
            Anyone with this link can view it without signing in — it won't update after creation,
            and the link expires in 30 days.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <Skeleton className="h-9 w-full rounded-lg" />
        ) : shareUrl ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input readOnly value={shareUrl} className="text-xs font-mono" onFocus={(e) => e.target.select()} />
              <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={handleCopy}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {expiresAt && (
              <p className="text-xs text-muted-foreground">
                Expires {new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Unable to generate a summary right now.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ExecutiveModePage() {
  const [summaryOpen, setSummaryOpen] = useState(false);

  return (
    <AppShell title="Executive Mode">
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Executive Mode</h1>
            <p className="text-sm text-muted-foreground">The five things leadership needs — nothing else.</p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setSummaryOpen(true)}>
            <FileText className="size-3.5" />
            Quarterly Summary
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ScoreTile />
          <RiskListTile />
          <NextBestActionTile />
        </div>

        <ExecutiveSummaryCard />
      </div>
      {summaryOpen && <QuarterlySummaryDialog onClose={() => setSummaryOpen(false)} />}
    </AppShell>
  );
}
