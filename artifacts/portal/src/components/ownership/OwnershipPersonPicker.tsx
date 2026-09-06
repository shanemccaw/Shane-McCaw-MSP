import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { initialsFor } from "@/lib/ownership-visuals";
import type { WireOwnPerson } from "@/lib/ownership-types";

/**
 * The "add a holder" picker (§1b, `POST /portal/ownership/assign`) — search
 * over the full roster, with people already holding a cell elsewhere on this
 * matrix surfaced first (a real signal off the data, not a guess about org
 * charts), matching the design's own suggestion ranking.
 */
export function OwnershipPersonPicker({
  people,
  excludeIds,
  frequency,
  onPick,
  onClose,
  pending,
}: {
  people: readonly WireOwnPerson[];
  excludeIds: ReadonlySet<string>;
  frequency: ReadonlyMap<string, number>;
  onPick: (personId: string) => void;
  onClose: () => void;
  pending: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const matches = useMemo(() => {
    return people
      .filter((p) => !excludeIds.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q) || p.side.toLowerCase().includes(q))
      .sort((a, b) => (frequency.get(b.id) ?? 0) - (frequency.get(a.id) ?? 0));
  }, [people, excludeIds, q, frequency]);
  const shown = q ? matches : matches.slice(0, 6);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/10 p-3" data-testid="ownership-picker-panel">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, role or team"
            className="h-7 pl-6 text-[11px]"
            data-testid="ownership-picker-search"
          />
        </div>
        <button type="button" onClick={onClose} className="flex-none text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
        {shown.length === 0 && <span className="px-1 py-1 text-[10.5px] text-muted-foreground">Nobody else matches.</span>}
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={pending}
            data-testid={`ownership-picker-pick-${p.id}`}
            onClick={() => onPick(p.id)}
            className="flex items-center gap-2 rounded-lg border border-border/70 px-2 py-1.5 text-left hover:border-primary/50 hover:bg-muted/30 disabled:opacity-50"
          >
            <span className="flex size-[20px] flex-none items-center justify-center rounded-full bg-muted/40 text-[8.5px] font-bold text-foreground">
              {initialsFor(p.name)}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[11px] font-medium text-foreground">{p.name}</span>
              <span className="truncate text-[9.5px] text-muted-foreground">
                {p.role} · {p.side}
              </span>
            </div>
            {p.side === "MSP" && (
              <Badge variant="outline" className="ml-1 flex-none border-status-teal/40 text-[8px] text-status-teal">
                MSP
              </Badge>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
