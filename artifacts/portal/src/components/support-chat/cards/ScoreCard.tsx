import { Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatCardDate, type ScoreCardData } from "./types";

const PILLARS: Array<{ key: keyof Omit<ScoreCardData, "updatedAt" | "copilotReadiness">; label: string }> = [
  { key: "identity", label: "Identity" },
  { key: "security", label: "Security" },
  { key: "collaboration", label: "Collaboration" },
  { key: "compliance", label: "Compliance" },
];

function scoreBarColor(value: number): string {
  if (value >= 80) return "bg-primary";
  if (value >= 50) return "bg-amber-500";
  return "bg-destructive";
}

function PillarBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full ${scoreBarColor(value)}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export function ScoreCard({ data }: { data: ScoreCardData }) {
  return (
    <Card className="max-w-md" data-testid="active-card-score">
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <Gauge className="size-4 text-primary" />
        <div>
          <CardTitle>Copilot Readiness Score</CardTitle>
          <CardDescription>As of {formatCardDate(data.updatedAt)}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-foreground">{data.copilotReadiness}</span>
          <span className="text-sm text-muted-foreground">/ 100 overall</span>
        </div>
        <div className="space-y-3">
          {PILLARS.map((p) => (
            <PillarBar key={p.key} label={p.label} value={data[p.key]} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
