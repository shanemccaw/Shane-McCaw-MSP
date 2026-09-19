import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PoamCreatePanel } from "@/components/poams/PoamCreatePanel";
import { PoamDeletedPanel } from "@/components/poams/PoamDeletedPanel";
import { PoamDetailPanel } from "@/components/poams/PoamDetailPanel";
import { PoamListRow } from "@/components/poams/PoamListRow";
import { useListPoams } from "@/lib/poams-api";
import type { PoamDeletion } from "@/lib/poams-types";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/shell/PageContainer";

export default function PoamsPage() {
  const { poams, isLoading, isError, tierGated, refetch, isRefetching } = useListPoams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [deletedState, setDeletedState] = useState<{ poamId: string; deletion: PoamDeletion } | null>(null);

  const isEmpty = !isLoading && !isError && !tierGated && (poams?.length ?? 0) === 0;
  const isLive = !isLoading && !isError && !tierGated && (poams?.length ?? 0) > 0;

  const selected = useMemo(() => {
    if (!poams || deletedState) return null;
    return poams.find((p) => p.id === selectedId) ?? poams[0] ?? null;
  }, [poams, selectedId, deletedState]);

  const { nActive, nOver, nWait } = useMemo(() => {
    if (!poams) return { nActive: 0, nOver: 0, nWait: 0 };
    return {
      nActive: poams.filter((p) => p.status === "active").length,
      nOver: poams.filter((p) => p.status === "active" && p.isOverdue).length,
      nWait: poams.filter((p) => p.status === "pending_signature").length,
    };
  }, [poams]);

  const summary = nOver
    ? {
        tag: "PAST TARGET",
        cls: "border-status-red/30 bg-status-red/5 text-status-red",
        text: `${nOver} active plan${nOver === 1 ? " is" : "s are"} past ${nOver === 1 ? "its" : "their"} live target date. Overdue is computed from the target each time this page loads; nothing marks it later, and a cancelled or converted plan is never overdue.`,
      }
    : nWait
      ? {
          tag: "YOUR SIGNATURE",
          cls: "border-status-amber/30 bg-status-amber/5 text-status-amber",
          text: `${nWait} plan${nWait === 1 ? " is" : "s are"} waiting for a signature from an Accountable holder. Nothing starts until it is signed.`,
        }
      : {
          tag: "ON TRACK",
          cls: "border-status-green/30 bg-status-green/5 text-status-green",
          text: "Every active plan is inside its target date.",
        };

  const stateLine = tierGated
    ? "Read closed · 402 · your tier does not include POA&Ms"
    : isError
      ? "Read failed · could not reach the server"
      : isEmpty
        ? "Live · no plans"
        : isLoading
          ? "Reading your plans"
          : `Live · ${poams?.length ?? 0} plan${(poams?.length ?? 0) === 1 ? "" : "s"} · ${nActive} active${nOver ? ` (${nOver} overdue)` : ""} · ${nWait} awaiting signature`;

  const openCreate = () => {
    setCreating(true);
    setCreatedId(null);
    setDeletedState(null);
  };

  const handleCreated = (id: string) => {
    setCreating(false);
    if (tierGated) {
      setCreatedId(id);
    } else {
      setSelectedId(id);
    }
  };

  const handleDeleted = (poamId: string, deletion: PoamDeletion) => {
    setDeletedState({ poamId, deletion });
    setSelectedId(null);
  };

  return (
    <PageContainer>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">POA&amp;Ms</h1>
        <span
          title="Plans of Action and Milestones — the sibling exit to the Risk Register. Where a risk acceptance says 'we accept the consequence', a plan says 'we are fixing this, and here is how and by when'. Your MSP authors and tracks the plan; your organisation signs it."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", tierGated ? "bg-status-amber" : isError ? "bg-status-red" : isLoading ? "bg-muted-foreground" : "bg-status-green")} />
          {stateLine}
        </span>
        {!tierGated && !isError && !creating && (
          <Button size="sm" className="ml-auto" onClick={openCreate} data-testid="poam-raise-button">
            Raise a plan
          </Button>
        )}
      </div>

      {tierGated && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-status-amber/30 bg-status-amber/5 p-4">
          <span className="text-[13.5px] font-semibold text-foreground">POA&amp;Ms aren&apos;t included in your Monitoring tier</span>
          <span className="max-w-[700px] text-xs leading-relaxed text-muted-foreground">
            The read behind this page checks that the tier your organisation purchased bundles the
            POA&amp;M module. Today no tier does — Foundation, Growth and Premier all leave it out —
            so the list and detail reads answer 402 for every organisation on the platform, not
            only yours. That is a pricing decision still to be made, not a fault.
          </span>
          <span className="max-w-[700px] text-xs leading-relaxed text-muted-foreground/80">
            Raising and signing a plan are not gated. A plan you raise here is recorded and your
            MSP sees it on their console — but you could not read it back here until your tier
            includes POA&amp;Ms.
          </span>
          <span className="font-mono text-[10.5px] text-muted-foreground/60">402 PAYMENT_REQUIRED · requireTierFeature(poams) · the server&apos;s own answer, not a paraphrase</span>
          {!creating && (
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <Button variant="outline" size="sm" onClick={openCreate} data-testid="poam-raise-anyway-button">
                Raise a plan anyway
              </Button>
              <Link href="/billing" className="text-[12px] font-semibold text-primary hover:underline">
                Your plan and tier under Billing →
              </Link>
            </div>
          )}
        </div>
      )}

      {createdId && !creating && (
        <div className="flex gap-2.5 rounded-xl border border-status-green/30 bg-status-green/5 p-3.5">
          <CheckCircle2 className="mt-0.5 size-3.5 flex-none text-status-green" />
          <div className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-foreground">{createdId} was recorded</span>
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              &ldquo;POA&amp;M created successfully&rdquo; — the server's message, with the plan code
              it assigned. It is awaiting signature on your MSP's console. This page cannot show it
              to you until your tier includes POA&amp;Ms.
            </span>
          </div>
        </div>
      )}

      {creating && <PoamCreatePanel onCreated={handleCreated} onCancel={() => setCreating(false)} />}

      {isLoading && !creating && (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex animate-pulse flex-col gap-2 rounded-xl border border-border/60 bg-muted/10 p-4">
              <div className="h-2.5 w-2/5 rounded-full bg-muted-foreground/20" />
              <div className="h-2 w-1/2 rounded-full bg-muted-foreground/10" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-4">
          <AlertTriangle className="mt-0.5 size-4 flex-none text-status-red" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">Your plans could not be read</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              A failed read, not an empty list. Your plans, signatures and milestones are
              unchanged; the server's own error message is returned, never swallowed into an empty
              success.
            </span>
            <Button variant="link" size="sm" className="h-auto w-fit p-0 text-[11.5px]" onClick={() => refetch()} disabled={isRefetching}>
              {isRefetching && <Loader2 className="size-3 animate-spin" />}
              Try again
            </Button>
          </div>
        </div>
      )}

      {isEmpty && !creating && (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-8 text-center">
          <span className="text-[13.5px] font-semibold text-foreground">No plans yet</span>
          <span className="mx-auto max-w-[680px] text-xs leading-relaxed text-muted-foreground">
            A successful read with nothing in it: no plan of action exists for your organisation.
            Your MSP raises most plans from a finding; you can raise one yourself when you want a
            weakness fixed on a schedule rather than accepted as a risk.
          </span>
          <span className="mx-auto max-w-[680px] text-[11px] leading-relaxed text-muted-foreground/70">
            The same empty answer is returned when your tenant scope cannot be resolved at all. The
            two share one shape and only the server log tells them apart, so this page does not
            claim to.
          </span>
        </div>
      )}

      {isLive && poams && !creating && (
        <>
          <div className={cn("flex items-center gap-3 rounded-xl border p-3", summary.cls)}>
            <span className="text-[10px] font-bold tracking-wider">{summary.tag}</span>
            <span className="flex-1 text-xs leading-relaxed text-foreground">{summary.text}</span>
          </div>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              {poams.map((p) => (
                <PoamListRow
                  key={p.id}
                  poam={p}
                  active={!deletedState && selected?.id === p.id}
                  onClick={() => {
                    setSelectedId(p.id);
                    setDeletedState(null);
                  }}
                />
              ))}
              <span className="px-1 py-0.5 text-[10.5px] leading-relaxed text-muted-foreground/70">
                Newest first. Status words are the server's own six; a plan your MSP cancels or
                converts keeps that word here rather than disappearing.
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {deletedState ? (
                <PoamDeletedPanel poamId={deletedState.poamId} />
              ) : (
                selected && <PoamDetailPanel poam={selected} onDeleted={handleDeleted} />
              )}
            </div>
          </div>
        </>
      )}

    </PageContainer>
  );
}
