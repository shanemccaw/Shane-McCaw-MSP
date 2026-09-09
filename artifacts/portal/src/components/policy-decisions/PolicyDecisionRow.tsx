import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useResolveClearance } from "@/lib/policy-decisions-api";
import type { WirePolicyRegisterEntry } from "@/lib/policy-decisions-types";
import { authorityTypeSwatch, reviewStateSwatch } from "@/lib/policy-decisions-visuals";
import { formatDate, formatDateTime } from "@/lib/risk-register-visuals";
import { cn } from "@/lib/utils";

const RESOLVE_NOTE_MAX = 2000;

function Fact({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div className="flex min-w-[220px] max-w-[340px] flex-col gap-1">
      <span className="text-[10px] font-bold tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-[12.5px] leading-snug", tone ?? "text-foreground")}>{value}</span>
      {note && <span className="text-[10.5px] leading-relaxed text-muted-foreground">{note}</span>}
    </div>
  );
}

/**
 * One row on the own-table Policy Decisions register (#1724, contract pack
 * §1). A row is signed the moment it exists — there is no draft state and no
 * "Restate"/"Withdraw" action, because neither has a real route: a position
 * is changed by signing a new one, and a signature is a fact that cannot be
 * withdrawn. That absence is stated on the page's own ledger rather than
 * drawn as a disabled control here.
 */
export function PolicyDecisionRow({ decision, open, onToggle }: { decision: WirePolicyRegisterEntry; open: boolean; onToggle: () => void }) {
  const [resolveOpen, setResolveOpen] = useState(false);
  const [note, setNote] = useState("");
  const resolveMutation = useResolveClearance();

  const dependency = decision.clearanceCondition !== null;
  const rvSwatch = reviewStateSwatch(decision.reviewState);
  const authSwatch = authorityTypeSwatch(decision.obligationType);
  const canResolve = dependency && decision.clearanceTriggerType === "manual" && !decision.isCleared;

  const clockLabel = dependency
    ? decision.isCleared
      ? "Ready to revisit"
      : "Waiting on one thing"
    : rvSwatch.label;
  const clockSwatch = dependency
    ? decision.isCleared
      ? { text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/30" }
      : { text: "text-status-teal", bg: "bg-status-teal/10", border: "border-status-teal/30" }
    : rvSwatch;

  const handleResolve = () => {
    if (note.trim().length === 0) return;
    resolveMutation.mutate(
      { id: decision.id, note: note.trim() },
      {
        onSuccess: () => {
          setNote("");
          setResolveOpen(false);
        },
      },
    );
  };

  return (
    <div id={`policy-decision-row-${decision.id}`} className="scroll-mt-4 border-t border-border/60 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 py-3 text-left transition-opacity hover:opacity-90"
        data-testid={`policy-decision-toggle-${decision.id}`}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[13.5px] font-semibold leading-snug text-foreground">{decision.title}</span>
          <span className="truncate text-[10.5px] text-muted-foreground">
            {decision.pillar ?? "No area"} · signed by {decision.signedBy} on {formatDate(decision.signedAt)}
          </span>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-1.5 pt-0.5">
          <Badge variant="outline" className={cn("justify-center text-[9px] tracking-wider", authSwatch.text, authSwatch.bg, authSwatch.border)}>
            {authSwatch.label}
          </Badge>
          <Badge variant="outline" className={cn("justify-center text-[9px] tracking-wider", clockSwatch.text, clockSwatch.bg, clockSwatch.border)}>
            {clockLabel}
          </Badge>
        </div>
        <ChevronRight className={cn("mt-1 size-3.5 flex-none text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>

      {open && (
        <div className="flex flex-col gap-4 pb-5 pt-1">
          <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/5 p-3.5 sm:grid-cols-[1fr_auto_1fr]">
            <div className="flex flex-col gap-1">
              <span className="text-[8.5px] font-bold tracking-widest text-muted-foreground">THE RULE</span>
              <span className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">{decision.obligation}</span>
            </div>
            <div className="flex items-center justify-center text-muted-foreground">→</div>
            <div className="flex flex-col gap-1">
              <span className="text-[8.5px] font-bold tracking-widest text-status-amber">WHAT YOU DO INSTEAD</span>
              <span className="text-[12px] leading-relaxed text-foreground">{decision.statement}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-5">
            {dependency ? (
              <>
                <Fact
                  label="WHAT CLEARS IT"
                  value={decision.clearanceCondition ?? ""}
                  note={
                    decision.clearanceTriggerType === "license_sku"
                      ? `Your licence data is watched for ${decision.clearanceTriggerSkuPartNumber ?? "the required SKU"}, so this clears on its own the moment it appears.`
                      : "Nobody can watch this for you, so it stays open until someone records how it was confirmed."
                  }
                />
                <Fact
                  label="STATE"
                  value={decision.isCleared ? "Confirmed" : "Not yet"}
                  tone={decision.isCleared ? "text-status-green" : undefined}
                  note={
                    decision.isCleared && decision.clearanceResolvedAt
                      ? `Resolved ${formatDateTime(decision.clearanceResolvedAt)}${decision.clearanceResolvedNote ? ` — ${decision.clearanceResolvedNote}` : ""}`
                      : "A decision waiting on a condition has no review date — a date here would be a deadline nobody set."
                  }
                />
              </>
            ) : (
              <>
                <Fact label="REVIEW CADENCE" value={decision.reviewCadence ?? "Not recorded"} note="Counted from the day it was signed." />
                <Fact
                  label="NEXT REVIEW"
                  value={decision.reviewDueAt ? formatDate(decision.reviewDueAt) : "Not recorded"}
                  tone={decision.reviewState === "overdue" ? "text-status-amber" : undefined}
                  note={decision.reviewState === "overdue" ? "That date has passed. The position still stands — only its review has lapsed." : undefined}
                />
              </>
            )}
            <Fact
              label="AUTHORITY"
              value={decision.obligation}
              note={decision.obligationId === null ? "Cited as text — no catalogue match resolved for this citation." : undefined}
            />
            <Fact label="OWNER" value={`${decision.owner}${decision.pillar ? ` · ${decision.pillar}` : ""}`} />
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3.5">
            <span className="text-[10px] font-bold tracking-wider text-status-green">WHAT HOLDS THE RISK DOWN</span>
            <span className="max-w-[720px] text-[12.5px] leading-relaxed text-foreground">{decision.compensatingControl}</span>
          </div>

          {canResolve && (
            <div className="flex flex-col gap-2.5 rounded-xl border border-status-teal/35 bg-status-teal/5 p-4">
              <span className="text-[12.5px] font-semibold text-foreground">Confirm the condition is met</span>
              <span className="max-w-[640px] text-[11.5px] leading-relaxed text-muted-foreground">
                Records how the condition was confirmed and clears the decision. Anyone on your side can record it —
                this is an observed fact, not a policy position — and it can only be recorded once.
              </span>
              {resolveOpen ? (
                <div className="flex flex-col gap-2.5">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, RESOLVE_NOTE_MAX))}
                    placeholder="How this was confirmed"
                    className="min-h-[62px] resize-y"
                    data-testid={`policy-decision-resolve-note-${decision.id}`}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={note.trim().length === 0 || resolveMutation.isPending}
                      onClick={handleResolve}
                      data-testid={`policy-decision-resolve-submit-${decision.id}`}
                    >
                      {resolveMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                      Confirm and clear
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setResolveOpen(false)} disabled={resolveMutation.isPending}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-fit border-status-teal/40 text-status-teal hover:bg-status-teal/10"
                  onClick={() => setResolveOpen(true)}
                  data-testid={`policy-decision-resolve-open-${decision.id}`}
                >
                  Confirm the condition is met
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
