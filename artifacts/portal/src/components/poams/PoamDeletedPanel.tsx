import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRequestPoamAcceleration } from "@/lib/poams-api";
import type { AccelerationReasonKind } from "@/lib/poams-types";
import { cn } from "@/lib/utils";

/**
 * The "was deleted" view (#4037, design's `showDeleted` scene). Rendered from
 * the real `DELETE /portal/poams/:poamId` response — soft-deleted plans are
 * excluded from the list read (Git #3451), so there is nothing left to
 * re-fetch; this panel is driven entirely by that one response plus this
 * mutation's own response, never fabricated state.
 */
export function PoamDeletedPanel({ poamId }: { poamId: string }) {
  const accelMutation = useRequestPoamAcceleration();
  const [stage, setStage] = useState<"idle" | "form" | "done">("idle");
  const [kind, setKind] = useState<AccelerationReasonKind>("no_longer_needed");
  const [reason, setReason] = useState("");
  const [rt, setRt] = useState("");
  const [rid, setRid] = useState("");

  const canSend = reason.trim().length > 0 && (kind !== "superseded_by" || (rt.trim().length > 0 && rid.trim().length > 0)) && !accelMutation.isPending;

  const handleSend = () => {
    if (!canSend) return;
    accelMutation.mutate(
      {
        poamId,
        body: {
          reasonKind: kind,
          reason: reason.trim(),
          ...(kind === "superseded_by" ? { supersededByRecordType: rt.trim(), supersededByRecordId: rid.trim() } : {}),
        },
      },
      { onSuccess: () => setStage("done") },
    );
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13.5px] font-semibold text-foreground">{poamId} was deleted</span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            &ldquo;POA&amp;M deleted successfully&rdquo; — the server's message. The plan is out of your
            list and inside its retention window; your MSP can still see it, and can recover it,
            until the window closes.
          </span>
          <span className="text-[11px] leading-relaxed text-muted-foreground/70">
            Their console list still shows it as if nothing happened: the MSP-side read does not
            yet hide deleted plans. A known, filed gap — stated here so the two views disagreeing
            does not surprise you.
          </span>
        </div>

        {stage === "idle" && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
            <span className="flex-1 text-[11.5px] leading-relaxed text-muted-foreground" style={{ minWidth: 220 }}>
              If it should be gone before the window closes, you can ask your MSP to purge it
              early. Asking purges nothing by itself.
            </span>
            <Button variant="outline" className="flex-none" onClick={() => setStage("form")} data-testid={`poam-accel-arm-${poamId}`}>
              Ask to purge early…
            </Button>
          </div>
        )}

        {stage === "form" && (
          <div className="flex flex-col gap-2.5 border-t border-border/60 pt-3">
            <span className="text-[11px] font-semibold text-muted-foreground">Why it should go early</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setKind("superseded_by")}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11.5px] font-semibold",
                  kind === "superseded_by" ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground",
                )}
                data-testid={`poam-accel-kind-superseded-${poamId}`}
              >
                Superseded by another record
              </button>
              <button
                type="button"
                onClick={() => setKind("no_longer_needed")}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11.5px] font-semibold",
                  kind === "no_longer_needed" ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground",
                )}
                data-testid={`poam-accel-kind-nolongerneeded-${poamId}`}
              >
                No longer needed
              </button>
            </div>
            {kind === "superseded_by" && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input value={rt} onChange={(e) => setRt(e.target.value)} placeholder="Record type, e.g. msp_risk_decisions" className="font-mono text-xs" data-testid={`poam-accel-rt-${poamId}`} />
                <Input value={rid} onChange={(e) => setRid(e.target.value)} placeholder="Record id" className="font-mono text-xs" data-testid={`poam-accel-rid-${poamId}`} />
              </div>
            )}
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="In your words — an operator reads this" className="min-h-[52px] resize-y" data-testid={`poam-accel-reason-${poamId}`} />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setStage("idle")} data-testid={`poam-accel-cancel-${poamId}`}>
                Cancel
              </Button>
              <Button disabled={!canSend} onClick={handleSend} data-testid={`poam-accel-send-${poamId}`}>
                {accelMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                Send the request
              </Button>
            </div>
            {accelMutation.isError && (
              <span className="text-[11.5px] text-status-red">{accelMutation.error instanceof Error ? accelMutation.error.message : "The request could not be sent."}</span>
            )}
          </div>
        )}

        {stage === "done" && (
          <div className="flex gap-2.5 rounded-xl border border-status-green/30 bg-status-green/5 p-3.5">
            <CheckCircle2 className="mt-0.5 size-3.5 flex-none text-status-green" />
            <div className="flex flex-col gap-1">
              <span className="text-[12.5px] font-semibold text-foreground">Acceleration requested — awaiting operator review</span>
              <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                The server's message, word for word. An operator decides on their retention queue.
                Nothing has been purged, and this page has no status to show for their decision —
                it arrives, if at all, outside this page.
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
