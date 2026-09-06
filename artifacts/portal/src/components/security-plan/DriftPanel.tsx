import { Badge } from "@/components/ui/badge";
import type { WireSecurityPlanDrift } from "@/lib/security-plan-types";
import { cn } from "@/lib/utils";

/**
 * "Changes since signing" (#1562's live-vs-last-signed comparison, wired at
 * #3027 against the new `GET /api/portal/security-plan/drift` endpoint).
 * Mechanical DATA drift only — added/removed/changed rows across the source
 * modules. Deliberately never claims the authored prose is stale; that is a
 * human judgment, not something a diff can assert (contract pack §3.7/§6.5).
 */
export function DriftPanel({ drift }: { drift: WireSecurityPlanDrift }) {
  if (!drift.hasLastSignedVersion) {
    return (
      <span className="text-xs leading-relaxed text-muted-foreground">
        Nothing has been signed yet, so there is no baseline to compare today against. This is
        not the same as nothing having changed.
      </span>
    );
  }

  const hasDrift = drift.totalAdded + drift.totalRemoved + drift.totalChanged > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-5">
        <Stat n={drift.totalAdded} label="added" tone="text-status-green" />
        <Stat n={drift.totalRemoved} label="removed" tone="text-status-red" />
        <Stat n={drift.totalChanged} label="changed" tone="text-status-amber" />
      </div>

      {!hasDrift ? (
        <span className="text-xs leading-relaxed text-muted-foreground">
          Nothing has moved in any source register since version {drift.lastSignedVersionNumber} was
          signed.
        </span>
      ) : (
        <div className="flex flex-col gap-4">
          {drift.modules.map((m) => (
            <div key={m.moduleKey} className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-semibold text-foreground">{m.label}</span>
              {m.added.map((item) => (
                <DriftRow key={`add-${item.id}`} kind="added" title={item.title} detail={item.detail} />
              ))}
              {m.removed.map((item) => (
                <DriftRow key={`rem-${item.id}`} kind="removed" title={item.title} detail={item.detail} />
              ))}
              {m.changed.map((item) => (
                <DriftRow
                  key={`chg-${item.id}`}
                  kind="changed"
                  title={item.title}
                  detail={`${item.from.state ?? "—"} → ${item.to.state ?? "—"}`}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <span className="border-t border-border/50 pt-3 text-[10.5px] leading-relaxed text-muted-foreground">
        A row counts as moved when its status or detail line differs from the sealed version.
        Whether the written sections have gone out of date is a judgement made when the next
        version is prepared, and is not measured here.
      </span>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn("text-xl font-extrabold tabular-nums", tone)}>{n}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function DriftRow({ kind, title, detail }: { kind: "added" | "removed" | "changed"; title: string; detail: string | null }) {
  const swatch =
    kind === "added"
      ? { text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/30" }
      : kind === "removed"
        ? { text: "text-status-red", bg: "bg-status-red/10", border: "border-status-red/30" }
        : { text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30" };
  return (
    <div className="flex items-start gap-3 py-1">
      <Badge variant="outline" className={cn("w-[74px] flex-none justify-center text-[9.5px]", swatch.text, swatch.bg, swatch.border)}>
        {kind}
      </Badge>
      <span className="min-w-0 flex-1 text-[11.5px] text-foreground">{title}</span>
      {detail && <span className="flex-none text-[11px] text-muted-foreground">{detail}</span>}
    </div>
  );
}
