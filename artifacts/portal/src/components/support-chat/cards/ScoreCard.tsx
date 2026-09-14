import { formatCardDate, type ScoreCardData } from "./types";
import { CardShell } from "./CardChrome";

const PILLARS: Array<{ key: keyof Omit<ScoreCardData, "updatedAt" | "copilotReadiness">; label: string }> = [
  { key: "identity", label: "Identity" },
  { key: "security", label: "Security" },
  { key: "collaboration", label: "Collaboration" },
  { key: "compliance", label: "Compliance" },
];

function barColor(value: number): string {
  if (value >= 80) return "#34d399";
  if (value >= 50) return "#fbbf24";
  return "#f87171";
}

function PillarBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-[11px]">
      <span className="w-[100px] shrink-0 text-[11.5px]" style={{ color: "#94a3b8" }}>
        {label}
      </span>
      <div className="h-[6px] min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.06)" }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: barColor(value) }}
        />
      </div>
      <span className="w-[28px] shrink-0 text-right text-[11.5px] tabular-nums" style={{ color: "#cbd5e1" }}>
        {value}
      </span>
    </div>
  );
}

export function ScoreCard({ data }: { data: ScoreCardData }) {
  return (
    <CardShell testId="active-card-score">
      <div className="flex flex-wrap items-baseline gap-[9px]">
        <span className="text-[26px] font-extrabold tabular-nums" style={{ color: "#f8fafc", letterSpacing: "-.02em" }}>
          {data.copilotReadiness}
        </span>
        <span className="text-[12px]" style={{ color: "#94a3b8" }}>
          / 100 Copilot readiness
        </span>
        <span className="ml-auto shrink-0 text-[10.5px]" style={{ color: "#64748b" }}>
          Computed {formatCardDate(data.updatedAt)}
        </span>
      </div>
      <div className="flex flex-col gap-[8px]">
        {PILLARS.map((p) => (
          <PillarBar key={p.key} label={p.label} value={data[p.key]} />
        ))}
      </div>
    </CardShell>
  );
}
