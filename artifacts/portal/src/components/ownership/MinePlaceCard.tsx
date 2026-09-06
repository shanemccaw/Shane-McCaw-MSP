import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MineEntry } from "@/lib/ownership-matrix";
import { OWN_ROLE_KEYS } from "@/lib/ownership-types";
import { acceptanceSwatch } from "@/lib/ownership-visuals";
import { cn } from "@/lib/utils";
import { useAcceptOwnership } from "@/lib/ownership-api";
import type { DeclineTarget } from "./DeclineOwnershipDialog";

const ROLE_WORD: Record<string, string> = Object.fromEntries(OWN_ROLE_KEYS.map((r) => [r.key, r.word]));

/**
 * "Your place on this matrix" — every cell the signed-in person holds, with
 * accept/decline wired to the real writes (§1b, `POST /portal/ownership/
 * accept|decline`, #3041) so acceptance is answered from one place rather
 * than a row that has to be found.
 */
export function MinePlaceCard({ entries, onDecline }: { entries: readonly MineEntry[]; onDecline: (target: DeclineTarget) => void }) {
  const acceptMutation = useAcceptOwnership();
  if (entries.length === 0) return null;
  const pending = entries.filter((e) => e.holder.acceptance === "pending");
  const settled = entries.filter((e) => e.holder.acceptance !== "pending");

  return (
    <Card className="border-status-blue/30 bg-status-blue/5">
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[9.5px] font-bold tracking-wider text-status-blue">YOUR PLACE ON THIS MATRIX</span>
          <span className={cn("text-[11.5px] font-semibold", pending.length ? "text-status-amber" : "text-status-green")}>
            {pending.length ? `${pending.length} need${pending.length === 1 ? "s" : ""} your answer` : "nothing waiting on you"}
          </span>
        </div>

        {pending.length > 0 && (
          <div className="flex flex-col gap-2">
            {pending.map((e, i) => (
              <div
                key={`${e.object.id}-${e.roleKey}-${i}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-status-amber/30 bg-status-amber/5 p-3"
                data-testid={`ownership-mine-${e.object.id}-${e.roleKey}`}
              >
                <span className="flex size-[22px] flex-none items-center justify-center rounded-md border border-status-amber/40 bg-status-amber/15 text-[10px] font-extrabold text-status-amber">
                  {e.roleKey.toUpperCase()}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[12.5px] font-medium text-foreground">
                    You have been named <span className="text-status-amber">{ROLE_WORD[e.roleKey]}</span> for {e.object.name}
                  </span>
                  {e.object.sub && <span className="text-[10.5px] text-muted-foreground">{e.object.sub}</span>}
                </div>
                <div className="flex flex-none gap-2">
                  <Button
                    size="sm"
                    className="h-7 bg-status-green px-3 text-[11px] text-white hover:bg-status-green/90"
                    disabled={acceptMutation.isPending}
                    data-testid={`ownership-mine-accept-${e.object.id}-${e.roleKey}`}
                    onClick={() => acceptMutation.mutate({ objectId: e.object.id, roleKey: e.roleKey, ownerPersonId: e.holder.personId })}
                  >
                    {acceptMutation.isPending && <Loader2 className="size-3 animate-spin" />}
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-status-red/40 px-3 text-[11px] text-status-red hover:bg-status-red/10"
                    data-testid={`ownership-mine-decline-${e.object.id}-${e.roleKey}`}
                    onClick={() =>
                      onDecline({
                        objectId: e.object.id,
                        objectName: e.object.name,
                        roleKey: e.roleKey,
                        roleWord: ROLE_WORD[e.roleKey] ?? e.roleKey,
                        ownerPersonId: e.holder.personId,
                      })
                    }
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {settled.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {settled.map((e, i) => {
              const acc = acceptanceSwatch(e.holder.acceptance);
              return (
                <div
                  key={`${e.object.id}-${e.roleKey}-${i}`}
                  className="flex items-center gap-2 rounded-full border border-border py-1 pl-1.5 pr-3"
                >
                  <span className="flex size-[19px] flex-none items-center justify-center rounded-[5px] border border-border bg-muted/20 text-[9px] font-extrabold text-foreground">
                    {e.roleKey.toUpperCase()}
                  </span>
                  <span className="text-[11px] text-foreground">{e.object.name}</span>
                  <span className={cn("text-[10px]", acc.text)}>{acc.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
