import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-context";
import { useDeletePoam, useSignPoam } from "@/lib/poams-api";
import type { PoamDeletion, WirePoam } from "@/lib/poams-types";
import { formatDateOnly, formatDateTime, isPoamClosed, poamStatusSwatch } from "@/lib/poams-visuals";
import { cn } from "@/lib/utils";

const STATEMENT_MAX = 2000;

function Fact({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div className="flex min-w-[160px] flex-col gap-1">
      <span className="text-[9px] font-bold tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-[12.5px] leading-snug", tone ?? "text-foreground")}>{value}</span>
      {note && <span className="text-[10.5px] leading-relaxed text-muted-foreground">{note}</span>}
    </div>
  );
}

export function PoamDetailPanel({
  poam,
  onDeleted,
}: {
  poam: WirePoam;
  onDeleted: (poamId: string, deletion: PoamDeletion) => void;
}) {
  const { user } = useAuth();
  const signMutation = useSignPoam();
  const deleteMutation = useDeletePoam();

  const [signName, setSignName] = useState("");
  const [signStatement, setSignStatement] = useState("");
  const [signConfirmed, setSignConfirmed] = useState(false);
  const [delStep, setDelStep] = useState<0 | 1>(0);
  const [delReason, setDelReason] = useState("");
  const [delTyped, setDelTyped] = useState("");

  const swatch = poamStatusSwatch(poam.status);
  const pendingSig = poam.status === "pending_signature" || poam.status === "draft";
  const closed = isPoamClosed(poam.status);

  // Deterministic, matching the backend's own personIdForUser("u" + userId) —
  // see artifacts/api-server/src/lib/portal-ownership.ts. A proactive UI hint
  // only; the server re-derives and enforces this itself on every attempt.
  const myPersonId = typeof user?.id === "number" ? `u${user.id}` : null;
  const authority = poam.authority;
  const holderIds = authority?.holders.map((h) => h.personId) ?? [];
  const noHolder = !!authority && holderIds.length === 0;
  const notMine = !!authority && holderIds.length > 0 && !!myPersonId && !holderIds.includes(myPersonId);
  const showSign = pendingSig && !noHolder && !notMine;
  const showBlocked = pendingSig && (noHolder || notMine);

  const canSign =
    signName.trim().length >= 2 &&
    signName.trim().length <= 200 &&
    signStatement.trim().length >= 1 &&
    signStatement.trim().length <= STATEMENT_MAX &&
    signConfirmed &&
    !signMutation.isPending;

  const canDelete = delReason.trim().length > 0 && delTyped.trim() === poam.id && !deleteMutation.isPending;

  const doneCount = poam.milestones.filter((m) => m.status === "completed").length;

  const handleSign = () => {
    if (!canSign) return;
    signMutation.mutate(
      { poamId: poam.id, body: { fullName: signName.trim(), confirmed: true, statement: signStatement.trim() } },
      {
        onSuccess: () => {
          setSignName("");
          setSignStatement("");
          setSignConfirmed(false);
        },
      },
    );
  };

  const handleDelete = () => {
    if (!canDelete) return;
    deleteMutation.mutate(
      { poamId: poam.id, body: { reason: delReason.trim() } },
      {
        onSuccess: (res) => {
          setDelStep(0);
          setDelReason("");
          setDelTyped("");
          onDeleted(res.poamId, res.deletion);
        },
      },
    );
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3.5 pt-6">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">{poam.id}</span>
            <Badge variant="outline" className={cn("text-[10px]", swatch.text, swatch.bg, swatch.border)}>
              {swatch.label}
            </Badge>
            {poam.isOverdue && (
              <Badge variant="outline" className="border-status-red/45 text-[10px] text-status-red">
                Overdue · past the live target
              </Badge>
            )}
          </div>
          <span className="text-base font-bold leading-tight tracking-tight text-foreground">{poam.title}</span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">{poam.weakness}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-3 sm:grid-cols-4">
          <Fact
            label="TARGET COMPLETION"
            value={formatDateOnly(poam.scheduledCompletionDate)}
            tone={poam.isOverdue ? "text-status-red" : undefined}
            note={
              poam.scheduledCompletionDate !== poam.originalScheduledCompletionDate
                ? `Moved from ${formatDateOnly(poam.originalScheduledCompletionDate)}. The original date is kept and never rewritten.`
                : "Unchanged since the plan was raised."
            }
          />
          <Fact
            label="ACCOUNTABLE TODAY"
            value={
              authority
                ? authority.holders.length
                  ? authority.holders.map((h) => h.name).join(", ")
                  : `${authority.workloadLabel} — nobody holds Accountable right now`
                : "No single workload owner for this check"
            }
            tone={noHolder ? "text-status-amber" : undefined}
            note="Who holds the role now, read live from Ownership. It can differ from who backed the signature below."
          />
          <Fact label="CHECK" value={poam.checkKey ?? "No check linked"} />
          <Fact label="STATEMENT OF WORK" value={poam.sowId ? `SOW ${poam.sowId.slice(0, 8)}` : "None linked"} />
        </div>

        <div className="grid grid-cols-1 gap-3.5 border-t border-border/60 pt-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold tracking-wider text-muted-foreground">INTERIM COMPENSATING CONTROL</span>
            <span className="text-xs leading-relaxed text-foreground">{poam.interimCompensatingControl}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold tracking-wider text-muted-foreground">RESOURCES REQUIRED</span>
            <span className="text-xs leading-relaxed text-foreground">{poam.resourcesRequired}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[9px] font-bold tracking-wider text-muted-foreground">MILESTONES</span>
            {poam.milestones.length > 0 && (
              <span className="text-[10.5px] text-muted-foreground">{doneCount} of {poam.milestones.length} done</span>
            )}
          </div>
          {poam.milestones.length > 0 ? (
            <div className="flex flex-col">
              {poam.milestones.map((m) => {
                const late = m.status !== "completed" && m.isOverdue;
                return (
                  <div key={m.id} className="flex items-start gap-2.5 border-t border-border/40 py-1.5 first:border-t-0">
                    <span
                      className={cn(
                        "mt-1 size-2 flex-none rounded-full",
                        m.status === "completed" ? "bg-status-green" : late ? "bg-status-red" : "bg-muted-foreground/50",
                      )}
                    />
                    <span className="flex-1 text-xs leading-relaxed text-foreground">{m.title}</span>
                    <span
                      className={cn(
                        "flex-none whitespace-nowrap text-[11px]",
                        m.status === "completed" ? "text-status-green" : late ? "text-status-red" : "text-muted-foreground",
                      )}
                    >
                      {m.status === "completed" && m.completedAt
                        ? `Done ${formatDateOnly(m.completedAt)}`
                        : late
                          ? `Overdue · due ${formatDateOnly(m.dueDate)}`
                          : `Due ${formatDateOnly(m.dueDate)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              None recorded. Your MSP adds milestones as the work is planned.
            </span>
          )}
          <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
            Milestones are set and completed by your MSP. This page reads them; it cannot add, edit
            or tick one off.
          </span>
        </div>

        {poam.isSigned && poam.signed && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-status-green/30 bg-status-green/5 p-3.5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-3.5 flex-none text-status-green" />
              <span className="text-[12.5px] font-semibold text-foreground">
                Signed by {poam.signed.by} on {formatDateTime(poam.signed.on)}
              </span>
            </div>
            {poam.signed.statement && (
              <span className="text-xs italic leading-relaxed text-foreground">&ldquo;{poam.signed.statement}&rdquo;</span>
            )}
            <span className="text-[11px] leading-relaxed text-muted-foreground">
              {poam.signed.authorizedBy
                ? `Backed at signing by Accountable for ${poam.signed.authorizedBy.workloadLabel}: ${poam.signed.authorizedBy.holders.map((h) => h.name).join(", ") || "nobody"} — as the role stood at that moment, replayed on every read.`
                : "No workload resolved for this check, so it was signed under the open rule: any signed-in person here could sign it."}
            </span>
          </div>
        )}

        {showSign && (
          <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
            <span className="text-[12.5px] font-semibold text-foreground">Sign this plan</span>
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              {authority
                ? `You are signing as an Accountable holder for ${authority.workloadLabel}. Your MSP cannot sign this for you.`
                : "This check has no single workload owner, so any signed-in person here may sign it. Your MSP cannot sign it for you."}
            </span>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`sign-name-${poam.id}`}>Your full name</Label>
              <Input
                id={`sign-name-${poam.id}`}
                value={signName}
                onChange={(e) => setSignName(e.target.value)}
                placeholder="Name as you sign it"
                className="max-w-[360px]"
                data-testid={`poam-sign-name-${poam.id}`}
              />
              <span className="text-[10.5px] text-muted-foreground/70">Recorded as typed. It is not checked against your account name.</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`sign-statement-${poam.id}`}>Statement</Label>
              <Textarea
                id={`sign-statement-${poam.id}`}
                value={signStatement}
                onChange={(e) => setSignStatement(e.target.value.slice(0, STATEMENT_MAX))}
                placeholder="What your organisation is agreeing to, in your words"
                className="min-h-[60px] resize-y"
                data-testid={`poam-sign-statement-${poam.id}`}
              />
              <span className="text-[10.5px] text-muted-foreground/70">
                {signStatement.length.toLocaleString()} / {STATEMENT_MAX.toLocaleString()}
              </span>
            </div>
            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox checked={signConfirmed} onCheckedChange={(v) => setSignConfirmed(v === true)} className="mt-0.5" data-testid={`poam-sign-confirm-${poam.id}`} />
              <span className="max-w-[560px] text-[11.5px] leading-relaxed text-foreground">
                I confirm this plan, its interim control and its target date on behalf of my
                organisation. The checkbox is the consent — the server accepts nothing else in its
                place.
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={!canSign} onClick={handleSign} data-testid={`poam-sign-submit-${poam.id}`}>
                {signMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                Sign and activate
              </Button>
              <span className="text-[10.5px] text-muted-foreground/70">Signed once. No edit, no withdrawal; a second attempt is refused.</span>
            </div>
            {signMutation.isError && (
              <span className="text-[11.5px] text-status-red">{signMutation.error instanceof Error ? signMutation.error.message : "The signature could not be recorded."}</span>
            )}
          </div>
        )}

        {showBlocked && (
          <div
            className={cn(
              "flex flex-col gap-1.5 rounded-xl border p-3.5",
              noHolder ? "border-status-amber/35 bg-status-amber/5" : "border-status-red/35 bg-status-red/5",
            )}
          >
            <span className={cn("text-[12.5px] font-semibold", noHolder ? "text-status-amber" : "text-status-red")}>
              {noHolder ? "Nobody can sign this yet" : "You are not the person who can sign this"}
            </span>
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              {noHolder
                ? `No one currently holds Accountable authority for ${authority?.workloadLabel}. Assign an owner on the Ownership page before this plan can be signed.`
                : `Only an Accountable holder for ${authority?.workloadLabel} can sign this plan. Today that is ${authority?.holders.map((h) => h.name).join(" and ")}; you cannot sign on their behalf, and neither can your MSP.`}
            </span>
            <span className="font-mono text-[10.5px] text-muted-foreground/70">
              {noHolder ? "409 CONFLICT — the server's own message, shown as it came back" : "403 FORBIDDEN — the holders' names come back with it"}
            </span>
            <Link href="/ownership" className="pt-0.5 text-[11.5px] font-semibold text-primary hover:underline">
              {noHolder ? "Open Ownership / RACI to assign a holder" : "See the current holders on Ownership / RACI"}
            </Link>
          </div>
        )}

        {closed && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-border/70 bg-muted/5 p-3.5">
            <span className="text-[12.5px] font-semibold text-foreground">
              {poam.status === "cancelled" ? "Cancelled by your MSP" : poam.status === "converted_to_risk_acceptance" ? "Converted to a risk acceptance by your MSP" : "Completed"}
            </span>
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              {poam.status === "cancelled"
                ? "Cancelling is your MSP's console action; this page has no cancel and no un-cancel. The plan cannot be signed — the server refuses with 409 — and it stays here under its final word rather than disappearing."
                : poam.status === "converted_to_risk_acceptance"
                  ? 'Your MSP turned this plan into a risk acceptance on their console — "we accept the consequence" instead of "we are fixing this". The plan keeps its final word here; the acceptance lives on the Risk Register. Neither side of that conversion can be done from this page.'
                  : "Marked completed by your MSP. No route on this page writes that word."}
            </span>
            {poam.status === "converted_to_risk_acceptance" && (
              <Link href="/risk-register" className="pt-0.5 text-[11.5px] font-semibold text-primary hover:underline">
                Open the Risk Register →
              </Link>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2.5 border-t border-border/60 pt-3">
          {delStep === 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex-1 text-[11px] leading-relaxed text-muted-foreground" style={{ minWidth: 220 }}>
                Deleting moves the plan into a recoverable retention window. It leaves this list at
                once; your MSP can still see and recover it until the window closes.
              </span>
              <Button
                variant="outline"
                className="flex-none border-status-red/40 text-status-red hover:bg-status-red/10"
                onClick={() => setDelStep(1)}
                data-testid={`poam-delete-arm-${poam.id}`}
              >
                Delete this plan…
              </Button>
            </div>
          ) : (
            <>
              <span className="text-[12.5px] font-semibold text-status-red">Delete {poam.id}?</span>
              <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                {(poam.isSigned ? "This plan carries a signature. " : poam.milestones.length ? "This plan has milestones your MSP is tracking. " : "This plan has no signature and no milestones yet. ") +
                  "Deletion is soft — it enters a retention window your MSP can still see and recover from — but it leaves this page immediately and the signature, if any, goes with it."}
              </span>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`del-reason-${poam.id}`}>Why you are deleting it</Label>
                <Textarea
                  id={`del-reason-${poam.id}`}
                  value={delReason}
                  onChange={(e) => setDelReason(e.target.value)}
                  placeholder="Required, whatever state the plan is in"
                  className="min-h-[52px] resize-y border-status-red/35"
                  data-testid={`poam-delete-reason-${poam.id}`}
                />
                <span className="text-[10.5px] text-muted-foreground/70">Recorded with your name against the deletion. The server refuses a delete without one — even for an empty plan.</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`del-typed-${poam.id}`}>Type {poam.id} to confirm</Label>
                <Input
                  id={`del-typed-${poam.id}`}
                  value={delTyped}
                  onChange={(e) => setDelTyped(e.target.value)}
                  placeholder={poam.id}
                  className="max-w-[260px] border-status-red/35 font-mono"
                  data-testid={`poam-delete-typed-${poam.id}`}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => { setDelStep(0); setDelReason(""); setDelTyped(""); }} data-testid={`poam-delete-keep-${poam.id}`}>
                  Keep the plan
                </Button>
                <Button
                  variant="destructive"
                  disabled={!canDelete}
                  onClick={handleDelete}
                  data-testid={`poam-delete-confirm-${poam.id}`}
                >
                  {deleteMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  Delete this plan
                </Button>
                <span className="text-[10.5px] text-muted-foreground/70">This warn-then-type ladder is the page's own care. The server asks only for the reason.</span>
              </div>
              {deleteMutation.isError && (
                <span className="text-[11.5px] text-status-red">{deleteMutation.error instanceof Error ? deleteMutation.error.message : "The plan could not be deleted."}</span>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
