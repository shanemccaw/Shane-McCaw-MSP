import type { LiveSharePillar } from "@/lib/public-share-types";

/**
 * Extracted from shared-live-documents-public.tsx (#4001, Feature #1663) so
 * the Live Document Viewer (#2825, Feature #1658) can reuse the exact same
 * pillar-score tile rather than duplicating it — same visual pattern, one
 * real implementation.
 */
function scoreBarColor(score: number | null): string {
  if (score == null) return "bg-muted-foreground/40";
  if (score >= 80) return "bg-status-green";
  if (score >= 60) return "bg-status-amber";
  return "bg-status-red";
}

export function PillarTile({ pillar }: { pillar: LiveSharePillar }) {
  const width = pillar.score != null ? `${Math.max(0, Math.min(100, pillar.score))}%` : "0%";
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-white/[.07] bg-white/[.015] px-3.5 py-2.5">
      <span className="text-[9px] font-bold tracking-widest text-muted-foreground/70 uppercase">
        {pillar.pillar}
      </span>
      <span className="text-[22px] font-bold tracking-tight tabular-nums text-foreground">
        {pillar.score ?? "—"}
      </span>
      <div className="h-1 overflow-hidden rounded-full bg-white/[.06]">
        <div className={`h-full ${scoreBarColor(pillar.score)}`} style={{ width }} />
      </div>
    </div>
  );
}
