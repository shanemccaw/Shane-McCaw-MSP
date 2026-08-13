/**
 * ExecutiveSummaryCard.tsx
 *
 * AI-generated executive summary tile for the customer_default monitoring
 * dashboard (Deliverable 4 of "Wire Real Dashboard Modules"). Reads the
 * cached summary from GET /api/dashboard/executive-summary — generation and
 * the once-per-day cache are entirely server-side (dashboard-executive-summary.ts).
 *
 * Not part of the metric-driven widget/canvas system (no metricKey/rendererType) —
 * this is a distinct, purpose-built tile, same way OMG cards sit outside the
 * generic renderer catalog on the Assessment side.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SummaryBullet {
  severity: "red" | "amber" | "green";
  text: string;
}

interface ExecutiveSummary {
  headline: string;
  bullets: SummaryBullet[];
  generatedAt: string | null;
  stale: boolean;
}

const SEVERITY_DOT: Record<SummaryBullet["severity"], string> = {
  red: "bg-destructive",
  amber: "bg-amber-500",
  green: "bg-emerald-500",
};

export function ExecutiveSummaryCard() {
  const { fetchWithAuth } = useAuth();
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (force: boolean) => {
      force ? setRefreshing(true) : setLoading(true);
      try {
        const res = await fetchWithAuth(`/api/dashboard/executive-summary${force ? "?refresh=true" : ""}`);
        if (res.ok) {
          const body = (await res.json()) as { summary: ExecutiveSummary | null };
          setSummary(body.summary);
        }
      } catch {
        // Best-effort tile — a failed load just means nothing renders below.
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!summary) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" />
          AI Executive Summary
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void load(true)} disabled={refreshing}>
          {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Regenerate
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium">{summary.headline}</p>
        <ul className="space-y-1.5">
          {summary.bullets.map((bullet, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", SEVERITY_DOT[bullet.severity])} />
              {bullet.text}
            </li>
          ))}
        </ul>
        {summary.generatedAt && (
          <p className="text-[11px] text-muted-foreground/70">
            {summary.stale ? "Last refreshed" : "Generated"} {new Date(summary.generatedAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
