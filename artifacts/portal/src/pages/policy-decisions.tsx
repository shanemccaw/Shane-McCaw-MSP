import { useMemo, useState } from "react";
import { AlertTriangle, CreditCard, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ObligationsCard } from "@/components/policy-decisions/ObligationsCard";
import { PolicyDecisionRow } from "@/components/policy-decisions/PolicyDecisionRow";
import { RecordDecisionDialog } from "@/components/policy-decisions/RecordDecisionDialog";
import { useComplianceObligations, usePolicyRegister } from "@/lib/policy-decisions-api";
import { formatDate } from "@/lib/risk-register-visuals";
import { cn } from "@/lib/utils";

const HOW: { head: string; body: string }[] = [
  {
    head: "A position is signed the moment it is recorded",
    body: "There is no draft and no separate approval step. Your name, the reasoning and the confirmation are captured together, and the time is set on the server.",
  },
  {
    head: "Every position names who answers for it",
    body: "One person, not a team. That name travels with the decision.",
  },
  {
    head: "Each one is revisited, or waits on something",
    body: "A fixed cadence, or a single condition that clears it. Never both. A licence arriving can be watched for you; anything else needs someone to confirm it.",
  },
  {
    head: "A lapsed review does not undo the decision",
    body: "Overdue describes the review, not the position. The signature stays true; it just has not been looked at when it was meant to be.",
  },
  {
    head: "Restating a position means signing a new one",
    body: "Positions cannot be edited or withdrawn, because the record is the signature. To change one, record the position you hold now.",
  },
  {
    head: "A position taken on an accepted risk lives on the risk register",
    body: "When you accept a risk and record a policy position against it, that decision stays with the risk it answers — this page and the risk register are never merged, so nothing appears twice.",
  },
  {
    head: "Seeing this register depends on your tier",
    body: "Reading positions back is bundled from a higher Monitoring tier. Recording one never is: a signed position is kept whatever your tier, and its review clock runs regardless.",
  },
  {
    head: "Standing policies are separate and not shown here",
    body: "Target settings your MSP holds for you — mailbox sizes, VIP handling — are operated on their own console. They carry no authority and no signature, so they are not positions.",
  },
];

const LEDGER: { gap: string; where: string }[] = [
  {
    gap: "No restate or withdraw action. A position is changed by signing a new one, and a signature cannot be withdrawn — there is no route for either.",
    where: "§1",
  },
  {
    gap: "Your own authorities (an insurance schedule, an internal records schedule) can only be cited as text on a decision. No route — yours or your MSP's — can enter one into the catalogue yet.",
    where: "§6, #3042",
  },
  {
    gap: "No MSP-side create for this register. A deliberate trust decision, not a missing column.",
    where: "#2589 §2.4, #3035",
  },
  {
    gap: "This page shows only the positions you started from scratch here. A position taken on an accepted risk lives on the Risk Register's own section instead — the two registers are never merged.",
    where: "§0/§9",
  },
];

export default function PolicyDecisionsPage() {
  const { data: decisions, isLoading, isError, error, refetch, isRefetching } = usePolicyRegister();
  const { data: obligations } = useComplianceObligations();
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [attnOpen, setAttnOpen] = useState(true);
  const [ledgerOpen, setLedgerOpen] = useState(true);

  const tierBlocked = (error as (Error & { code?: string }) | null)?.code === "TIER_UPGRADE_REQUIRED";

  const toggleRow = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rows = decisions ?? [];
  const isEmpty = !isLoading && !isError && rows.length === 0;
  const hasRows = !isLoading && !isError && rows.length > 0;

  const overdue = useMemo(() => rows.filter((d) => d.reviewState === "overdue"), [rows]);
  const waiting = useMemo(() => rows.filter((d) => d.clearanceCondition !== null && !d.isCleared), [rows]);
  const hasAttention = overdue.length > 0 || waiting.length > 0;

  const openRow = (id: string) => {
    setOpenIds((prev) => new Set(prev).add(id));
    requestAnimationFrame(() => {
      document.getElementById(`policy-decision-row-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <div className="flex flex-col gap-4 pb-14">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground" data-testid="policy-decisions-page-title">
          Policy decisions
        </h1>
        <span
          title="Places where you have chosen to do something different from a rule you are bound by or a security baseline you follow — taken deliberately and signed by the person who answers for it."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="policy-decisions-live-state">
          <span className={cn("size-1.5 rounded-full", isError ? "bg-status-red" : isLoading ? "bg-muted-foreground" : "bg-status-green")} />
          {isLoading
            ? "Reading your positions"
            : isError
              ? tierBlocked
                ? "Not in your current tier"
                : "Could not read your positions"
              : isEmpty
                ? "None on record"
                : `Live — ${rows.length} signed`}
        </span>
        {!isLoading && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 gap-1.5 border-primary/40 text-[11px] text-primary hover:bg-primary/10"
            onClick={() => setFormOpen(true)}
            data-testid="policy-decisions-record-open"
          >
            <Plus className="size-3" /> Record a decision
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex animate-pulse flex-col gap-2 rounded-xl border border-border/60 bg-muted/10 p-4">
              <div className="h-2.5 w-2/5 rounded-full bg-muted-foreground/20" />
              <div className="h-2 w-1/2 rounded-full bg-muted-foreground/10" />
            </div>
          ))}
        </div>
      )}

      {isError && tierBlocked && (
        <div className="flex gap-2.5 rounded-xl border border-dashed border-status-blue/40 bg-status-blue/[.06] p-4">
          <CreditCard className="mt-0.5 size-4 flex-none text-status-blue" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">Policy decisions are not part of your Monitoring tier</span>
            <span className="max-w-[640px] text-xs leading-relaxed text-muted-foreground">
              Reading your register back is bundled from a higher tier than the one you hold. Nothing has been
              removed: any position already signed for your organisation is kept, its review clock keeps
              running, and a new position can still be recorded and signed below. Only reading is gated.
            </span>
            <span className="text-[10.5px] text-muted-foreground/70">Tier changes are made with your MSP, not from this page.</span>
          </div>
        </div>
      )}

      {isError && !tierBlocked && (
        <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-4">
          <AlertTriangle className="mt-0.5 size-4 flex-none text-status-red" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">Your positions could not be loaded</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              You may well have positions on record. This page cannot read them right now, and shows none rather
              than implying there are none.
            </span>
            <Button variant="link" size="sm" className="h-auto w-fit p-0 text-[11.5px]" onClick={() => void refetch()} disabled={isRefetching}>
              {isRefetching && <Loader2 className="size-3 animate-spin" />}
              Try again
            </Button>
          </div>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-7">
          <span className="text-[15px] font-semibold text-foreground">Nothing has been decided yet</span>
          <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
            Your register read cleanly and holds no signed positions. Until one is recorded, every rule below
            applies to you as written.
          </span>
          <Button size="sm" className="mt-1" onClick={() => setFormOpen(true)} data-testid="policy-decisions-record-first">
            Record your first decision
          </Button>
        </div>
      )}

      {hasAttention && (
        <Card className="border-status-amber/30 bg-status-amber/[.03]">
          <CardContent className="flex flex-col gap-2.5 pt-5">
            <button type="button" onClick={() => setAttnOpen((o) => !o)} className="flex items-center gap-2.5 text-left">
              <span className="text-[9.5px] font-bold tracking-widest text-status-amber">NEEDS REVISITING</span>
              <span className="text-[11.5px] font-semibold text-foreground">
                {overdue.length} overdue · {waiting.length} waiting
              </span>
              <span className="ml-auto text-[10.5px] font-semibold text-muted-foreground">{attnOpen ? "Hide" : "Show"}</span>
            </button>
            {attnOpen && (
              <div className="flex flex-wrap gap-6">
                {overdue.map((d) => (
                  <button
                    type="button"
                    key={d.id}
                    onClick={() => openRow(d.id)}
                    className="flex min-w-[240px] flex-1 flex-col gap-0.5 border-l-2 border-status-amber pl-3 text-left transition-opacity hover:opacity-80"
                  >
                    <span className="text-[8.5px] font-extrabold tracking-wider text-status-amber">REVIEW OVERDUE</span>
                    <span className="text-[12px] font-semibold text-foreground">{d.title}</span>
                    <span className="text-[10.5px] text-muted-foreground">was due {d.reviewDueAt ? formatDate(d.reviewDueAt) : "—"}</span>
                  </button>
                ))}
                {waiting.map((d) => (
                  <button
                    type="button"
                    key={d.id}
                    onClick={() => openRow(d.id)}
                    className="flex min-w-[240px] flex-1 flex-col gap-0.5 border-l-2 border-status-teal pl-3 text-left transition-opacity hover:opacity-80"
                  >
                    <span className="text-[8.5px] font-extrabold tracking-wider text-status-teal">
                      {d.clearanceTriggerType === "license_sku" ? "CLEARS ITSELF" : "WAITING"}
                    </span>
                    <span className="text-[12px] font-semibold text-foreground">{d.title}</span>
                    <span className="text-[10.5px] text-muted-foreground">{d.clearanceCondition}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {hasRows && (
        <Card>
          <div className="flex items-center gap-3 px-5 pb-2 pt-4">
            <span className="text-[13.5px] font-semibold text-foreground">Your positions</span>
            <span className="text-[11px] text-muted-foreground">newest first · signed when recorded</span>
          </div>
          <CardContent className="flex flex-col px-5 pb-3 pt-0">
            {rows.map((d) => (
              <PolicyDecisionRow key={d.id} decision={d} open={openIds.has(d.id)} onToggle={() => toggleRow(d.id)} />
            ))}
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && obligations && obligations.length > 0 && <ObligationsCard obligations={obligations} />}

      {!isLoading && (!isError || tierBlocked) && (
        <Card className="bg-muted/5">
          <CardContent className="flex flex-col gap-2.5 pt-6">
            <button type="button" onClick={() => setHowOpen((o) => !o)} className="flex items-baseline gap-2.5 text-left">
              <span className="text-[9.5px] font-bold tracking-widest text-muted-foreground">HOW THIS REGISTER WORKS</span>
              <span className="ml-auto text-[10.5px] font-semibold text-muted-foreground">{howOpen ? "Hide" : "Show"}</span>
            </button>
            {howOpen && (
              <div className="grid gap-3 sm:grid-cols-2">
                {HOW.map((h) => (
                  <div key={h.head} className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-semibold text-foreground">{h.head}</span>
                    <span className="text-[11.5px] leading-relaxed text-muted-foreground">{h.body}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="bg-muted/5">
        <CardContent className="flex flex-col gap-2.5 pt-6">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[13px] font-semibold text-foreground">What this page deliberately does not do</span>
            <Button
              variant="link"
              size="sm"
              className="ml-auto h-auto p-0 text-[11.5px] font-semibold text-muted-foreground"
              onClick={() => setLedgerOpen((o) => !o)}
            >
              {ledgerOpen ? "Collapse" : "Expand"}
            </Button>
          </div>
          {ledgerOpen && (
            <div className="flex flex-col">
              {LEDGER.map((l, i) => (
                <div key={i} className="flex items-start gap-3 border-t border-border/50 py-2 first:border-t-0">
                  <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-foreground">{l.gap}</div>
                  <span className="flex-none font-mono text-[10.5px] text-muted-foreground/70">{l.where}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <RecordDecisionDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
