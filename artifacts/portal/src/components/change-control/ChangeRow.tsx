/**
 * One change request row — collapsed summary + expanded detail (rationale,
 * before/after snapshot, approval ledger, actions, timeline/comments/
 * attachments). Mirrors the design's `r`/`d`/`s`/`b`/`t` row shapes
 * (`Change Control.dc.html:126-224`), reading every field from the real
 * `WireChangeRequest` — nothing here is computed beyond display formatting.
 */
import { useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ATTACHMENT_KINDS,
  type AttachmentKind,
  type WireChangeRequest,
} from "@/lib/change-control-types";
import { useAddChangeAttachment, useAddChangeComment, useChangeTimeline } from "@/lib/change-control-api";
import { approverRoleLabel, changeClassSwatch, decisionLabel, decisionSwatch, fmtDateTime, fmtDay, fmtImpacted, riskSwatch, statusSwatch } from "@/lib/change-control-visuals";
import { toast } from "sonner";
import type { ChangeActionTarget } from "./ChangeActionDialog";

const ATTACHMENT_LABELS: Record<AttachmentKind, string> = {
  evidence: "Evidence",
  test_result: "Test result",
  approval_email: "Approval email",
  other: "Other",
};

const SLA_DAYS: Record<string, number | null> = { Standard: null, Emergency: 1 };
function slaDaysFor(cls: string, risk: string): number | null {
  if (cls in SLA_DAYS) return SLA_DAYS[cls];
  if (risk === "Critical") return 1;
  if (risk === "High") return 2;
  if (risk === "Medium") return 5;
  return 7;
}

export function ChangeRow({
  cr,
  expanded,
  onToggle,
  onAction,
}: {
  cr: WireChangeRequest;
  expanded: boolean;
  onToggle: () => void;
  onAction: (target: ChangeActionTarget) => void;
}) {
  const [comment, setComment] = useState("");
  const timeline = useChangeTimeline(cr.code, expanded);
  const addComment = useAddChangeComment();
  const addAttachment = useAddChangeAttachment();

  const cls = changeClassSwatch(cr.changeClass);
  const rk = riskSwatch(cr.risk);
  const st = statusSwatch(cr.status);
  const { approvalState } = cr;
  const isRouted = !!cr.implementer;
  const hasDeps = cr.blockedBy.length + cr.blocks.length > 0;
  const depText = !hasDeps
    ? "None recorded"
    : [
        cr.blockedBy.length ? "Blocked by " + cr.blockedBy.map((d) => `${d.code} (${d.status})`).join(", ") : "",
        cr.blocks.length ? "Blocks " + cr.blocks.map((d) => `${d.code} (${d.status})`).join(", ") : "",
      ]
        .filter(Boolean)
        .join(" · ");

  const stageLine =
    approvalState.requiredStages === 0
      ? "pre-approved · no human stage"
      : approvalState.complete
        ? "approvals complete"
        : approvalState.rejectedTerminal
          ? "rejected"
          : `${approvalState.approved} of ${approvalState.requiredStages} stages cleared`;

  const disabledReason = approvalState.rejectedTerminal
    ? "This change is terminally rejected — no further decision can be recorded."
    : approvalState.nextStage === null
      ? "No stage is pending on this change."
      : "Approve/reject are not offered on this change from here.";

  const sla = slaDaysFor(cr.changeClass, cr.risk);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border",
        expanded ? "border-status-blue/35 bg-muted/[0.03]" : "border-border/70 bg-muted/[0.018]",
      )}
      data-testid={`change-row-${cr.code}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-accent/40"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-[11px] text-muted-foreground">{cr.code}</span>
          <span className="text-[13.5px] font-semibold text-foreground">{cr.title}</span>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            {isRouted && (
              <Badge variant="outline" className="border-status-teal/40 text-status-teal">
                {cr.implementer?.toUpperCase()} · {cr.intake?.toUpperCase()}
              </Badge>
            )}
            {approvalState.breached && (
              <Badge variant="outline" className="border-status-red/42 text-status-red">
                SLA BREACHED
              </Badge>
            )}
            <Badge variant="outline" className={cn(cls.text, cls.border, cls.dashed && "border-dashed")}>
              {cr.changeClass}
            </Badge>
            <Badge variant="outline" className={cn(rk.text, rk.border)}>
              {cr.risk}
            </Badge>
            <Badge className={cn(st.text, st.border, st.bg)}>{cr.status}</Badge>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3.5 text-[11px] text-muted-foreground">
          <span>{cr.workload}</span>
          <span className="text-foreground/70">{cr.target}</span>
          <span className="tabular-nums">{fmtImpacted(cr.impactedUsersCount)}</span>
          <span>{cr.window}</span>
          <span className={cn("font-semibold", approvalState.breached ? "text-status-red" : approvalState.complete ? "text-status-green" : "text-muted-foreground")}>
            {stageLine}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="flex flex-col gap-4 border-t border-border/60 bg-background/40 px-4 pb-4 pt-3.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Detail k="Rationale" v={cr.rationale} />
            <Detail
              k="Before · pre-change snapshot"
              v={cr.pre}
              mono
              muted={cr.pre === "{}"}
              note={cr.pre === "{}" ? "Empty, not missing: no pre-change state was captured." : undefined}
            />
            <Detail k="After · proposed payload" v={cr.post} mono />
            <Detail
              k="Booked window"
              v={cr.scheduledStart ? `${fmtDateTime(cr.scheduledStart)}${cr.scheduledEnd ? " → " + fmtDateTime(cr.scheduledEnd) : " · start only"}` : "No real instant booked"}
              muted={!cr.scheduledStart}
              note={
                cr.scheduledStart
                  ? "A real instant — can be date-ordered and checked against the freeze calendar."
                  : "Only the free-text label exists, so this change cannot be date-ordered or freeze-checked on its own window."
              }
            />
            <Detail
              k="Executed"
              v={cr.executedAt || "Not executed"}
              muted={!cr.executedAt}
              note={cr.executorRunId ? `Carried out by run ${cr.executorRunId}, which stamped this change's reference onto the configuration it changed.` : undefined}
            />
            <Detail
              k="Backup verified"
              v={cr.backupVerified ? "Yes — captured at execution" : "No"}
              note={!cr.backupVerified ? "Recorded false with an empty hash until a real execution captures a snapshot." : undefined}
            />
            <Detail
              k="Raised from"
              v={cr.linkedFinding || "Raised directly — no linked finding"}
              muted={!cr.linkedFinding}
              note={cr.remediationCheckKey ? `Structured link: ${cr.remediationCheckKey} — raising this CR discharged the matching active risk on your register.` : undefined}
            />
            <Detail k="Dependencies" v={depText} muted={!hasDeps} note={hasDeps ? "Edges are set by your MSP; this page reads them." : undefined} />
            <Detail k="Raised" v={fmtDay(cr.createdAt)} />
          </div>

          <div className="flex flex-col gap-2 border-t border-border/50 pt-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[11px] font-semibold text-foreground">Approval record</span>
              <span className="text-[10.5px] text-muted-foreground">
                {approvalState.requiredStages === 0
                  ? "no human stage · one inherited approval on record"
                  : `${approvalState.requiredStages} stage${approvalState.requiredStages > 1 ? "s" : ""} required${sla !== null ? ` · SLA ${sla} day${sla === 1 ? "" : "s"} from raising` : ""}`}
              </span>
            </div>
            {cr.approvalRecords.map((a) => {
              const d = decisionSwatch(a.decision);
              return (
                <div key={a.stage} className={cn("flex items-start gap-2.5 rounded-lg border p-2.5", d.border, d.bg, d.dashed && "border-dashed")}>
                  <span className={cn("mt-1 size-2 flex-none rounded-full border", d.border, a.decision === "pending" ? "bg-transparent" : d.bg)} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xs font-semibold text-foreground">
                        Stage {a.stage} · {decisionLabel(a.decision)}
                      </span>
                      <span className="text-[10.5px] text-muted-foreground">{approverRoleLabel(a.approverRole)}</span>
                    </div>
                    <span className="text-[11.5px] text-muted-foreground">
                      {a.approverName
                        ? a.onBehalfOfPersonId
                          ? `${a.approverName} — acting under a delegation`
                          : a.approverName
                        : "Nobody has taken this stage yet"}
                    </span>
                    <span className={cn("text-[10.5px]", a.breached && a.decision === "pending" ? "text-status-red" : "text-muted-foreground")}>
                      {a.decidedAt
                        ? "Decided " + fmtDateTime(a.decidedAt)
                        : a.dueAt
                          ? (a.breached ? "Due " + fmtDateTime(a.dueAt) + " — past its SLA" : "Due " + fmtDateTime(a.dueAt))
                          : "No SLA applies to a pre-approved change"}
                    </span>
                    {a.reason && <span className="text-[11px] text-foreground/90">{a.reason}</span>}
                  </div>
                </div>
              );
            })}
            <span className="text-[10.5px] leading-relaxed text-muted-foreground/80">
              How many stages a change needs comes from its class and its computed risk, floored up
              by your tenant&apos;s own signatures setting — never down. A stage added for a freeze
              exception can only be decided by your MSP.
            </span>
          </div>

          <div className="flex flex-col gap-2 border-t border-border/50 pt-3">
            <span className="text-[11px] font-semibold text-foreground">Actions</span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!cr.canApproveNow}
                title={cr.canApproveNow ? `Records a real approval on stage ${approvalState.nextStage}.` : disabledReason}
                onClick={() => onAction({ mode: "approve", code: cr.code, title: cr.title })}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!cr.canApproveNow}
                title={cr.canApproveNow ? "A reason is required." : disabledReason}
                onClick={() => onAction({ mode: "reject", code: cr.code, title: cr.title })}
              >
                Reject with a reason
              </Button>
              {isRouted && (
                <Button size="sm" variant="outline" onClick={() => onAction({ mode: "decline", code: cr.code, title: cr.title })}>
                  Decline this Microsoft change
                </Button>
              )}
              <Button size="sm" variant="outline" disabled title="New bookings are checked for collisions and window coverage — but no route moves an already-raised change.">
                Move the booked window · NO ROUTE
              </Button>
              <Button size="sm" variant="outline" disabled title="Execution records and rollback exist on your MSP's console. No rollback path exists on the portal.">
                Roll back · MSP-SIDE ONLY
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border/50 pt-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[11px] font-semibold text-foreground">Timeline</span>
              <span className="text-[10.5px] text-muted-foreground">system events are appended, never written by hand</span>
            </div>
            {timeline.isLoading && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading…
              </div>
            )}
            {timeline.isError && <span className="text-[11px] text-destructive">Could not load this change&apos;s timeline.</span>}
            {timeline.data && (
              <div className="flex flex-col gap-1.5">
                {timeline.data.events.map((e, i) => (
                  <div key={`e${i}`} className="flex flex-wrap items-baseline gap-2.5">
                    <span className="size-1.5 flex-none rounded-full bg-status-blue" />
                    <span className="min-w-[112px] text-[11px] tabular-nums text-muted-foreground">{fmtDateTime(e.occurredAt)}</span>
                    <span className="min-w-[220px] flex-1 text-[11.5px] leading-relaxed text-foreground/90">
                      {e.eventType}
                      {e.actorName ? ` · ${e.actorName}` : ""}
                      {e.reason ? ` — ${e.reason}` : ""}
                    </span>
                    <span className="text-[10px] font-semibold text-muted-foreground/60">EVENT</span>
                  </div>
                ))}
                {timeline.data.comments.map((c, i) => (
                  <div key={`c${i}`} className="flex flex-wrap items-baseline gap-2.5">
                    <span className="size-1.5 flex-none rounded-full bg-status-teal" />
                    <span className="min-w-[112px] text-[11px] tabular-nums text-muted-foreground">{fmtDateTime(c.createdAt)}</span>
                    <span className="min-w-[220px] flex-1 text-[11.5px] leading-relaxed text-foreground/90">
                      {c.authorName}: {c.body}
                    </span>
                    <span className="text-[10px] font-semibold text-muted-foreground/60">COMMENT</span>
                  </div>
                ))}
                {timeline.data.attachments.map((a, i) => (
                  <div key={`a${i}`} className="flex flex-wrap items-baseline gap-2.5">
                    <span className="size-1.5 flex-none rounded-full bg-status-teal" />
                    <span className="min-w-[112px] text-[11px] tabular-nums text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
                    <span className="min-w-[220px] flex-1 text-[11.5px] leading-relaxed text-foreground/90">
                      Attachment · {a.label} ({ATTACHMENT_LABELS[a.kind as AttachmentKind] ?? a.kind}) · {a.uploadedByName}
                    </span>
                    <span className="text-[10px] font-semibold text-muted-foreground/60">ATTACHMENT</span>
                  </div>
                ))}
                {timeline.data.events.length + timeline.data.comments.length + timeline.data.attachments.length === 0 && (
                  <span className="text-[11px] text-muted-foreground">No history recorded yet.</span>
                )}
              </div>
            )}

            <div className="mt-1 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/10 px-2.5 py-1.5">
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 4_000))}
                placeholder="Add a comment — up to 4,000 characters"
                className="h-auto border-0 bg-transparent px-0 py-0 text-[12px] focus-visible:ring-0"
              />
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-[11px]"
                disabled={comment.trim().length === 0 || addComment.isPending}
                onClick={() =>
                  addComment.mutate(
                    { code: cr.code, body: comment.trim() },
                    { onSuccess: () => setComment(""), onError: (e) => toast.error((e as Error).message) },
                  )
                }
              >
                Post
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10.5px] text-muted-foreground">Attach a file as</span>
              {ATTACHMENT_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={addAttachment.isPending}
                  className="inline-flex items-center gap-1 rounded-full border border-status-blue/40 px-2.5 py-0.5 text-[10.5px] font-semibold text-status-blue hover:border-status-blue/80 disabled:opacity-50"
                  onClick={() =>
                    addAttachment.mutate(
                      { code: cr.code, kind: k, label: `${ATTACHMENT_LABELS[k]} · uploaded by you` },
                      { onError: (e) => toast.error((e as Error).message) },
                    )
                  }
                >
                  <Paperclip className="size-3" />
                  {ATTACHMENT_LABELS[k]}
                </button>
              ))}
            </div>
            <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
              Comments and attachments are yours to add, and neither can be edited or removed once
              posted. The stored rollback command is deliberately never sent to the browser.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ k, v, mono, muted, note }: { k: string; v: string; mono?: boolean; muted?: boolean; note?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{k}</span>
      <span className={cn("whitespace-pre-wrap text-xs leading-relaxed", mono && "font-mono", muted ? "text-muted-foreground" : "text-foreground/90")}>{v}</span>
      {note && <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">{note}</span>}
    </div>
  );
}
