import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { WireObligation } from "@/lib/policy-decisions-types";
import { authorityTypeSwatch, obligationToneSwatch } from "@/lib/policy-decisions-visuals";
import { cn } from "@/lib/utils";

/**
 * "What you are measured against" (#1724, contract pack §3) — the real
 * obligations catalogue, grouped by the real `scope` field the route serves
 * (`In scope` / `Marked out of scope`) rather than the design's own
 * fabricated "required of you / good practice" split, which has no backing
 * field on this wire.
 */
export function ObligationsCard({ obligations }: { obligations: readonly WireObligation[] }) {
  const inScope = obligations.filter((o) => o.scope === "In scope");
  const outOfScope = obligations.filter((o) => o.scope === "Marked out of scope");
  const groups = [
    { label: "IN SCOPE FOR YOU", rows: inScope },
    { label: "MARKED OUT OF SCOPE", rows: outOfScope },
  ].filter((g) => g.rows.length > 0);

  if (obligations.length === 0) return null;

  return (
    <Card>
      <CardHeader className="gap-1.5 space-y-0">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="text-[13.5px] font-semibold text-foreground">What you are measured against</span>
          <span className="text-[11px] text-muted-foreground">
            {inScope.length} in scope · {outOfScope.length} marked out of scope
          </span>
        </div>
        <p className="max-w-[720px] text-xs leading-relaxed text-muted-foreground">
          The obligations catalogue your MSP checks you against, and whether an open finding sits
          against each one right now. Scope is decided in onboarding — tell your MSP if it changed.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-0">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-0">
            <div className="flex items-center gap-2 pb-2">
              <span className="text-[8.5px] font-bold tracking-widest text-muted-foreground">{g.label}</span>
            </div>
            {g.rows.map((o) => {
              const auth = authorityTypeSwatch(o.type || null);
              const tone = obligationToneSwatch(o.tone);
              return (
                <div
                  key={o.id}
                  className="flex flex-wrap items-start gap-3 border-t border-border/50 py-2.5 first:border-t-0"
                  data-testid={`policy-obligation-row-${o.id}`}
                >
                  <span className={cn("mt-1.5 size-1.5 flex-none rounded-full", tone.dot)} />
                  <div className="flex min-w-[180px] flex-none flex-col gap-1">
                    <span className="font-mono text-[11px] leading-tight text-foreground">{o.framework}</span>
                    <Badge variant="outline" className={cn("w-fit text-[8.5px] tracking-wider", auth.text, auth.bg, auth.border)}>
                      {auth.label}
                    </Badge>
                  </div>
                  <span className="min-w-[220px] flex-1 text-[11.5px] leading-relaxed text-muted-foreground">{o.requires}</span>
                  <span className={cn("w-[220px] flex-none text-right text-[11px] leading-relaxed", tone.text)}>{o.state}</span>
                </div>
              );
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
