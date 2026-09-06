import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-context";
import { useAcceptRisk } from "@/lib/risk-register-api";
import type { WireRisk } from "@/lib/risk-register-types";
import {
  acceptanceSwatch,
  formatDateTime,
  formatLiability,
  reviewSwatch,
  riskStatusSwatch,
  severitySwatch,
} from "@/lib/risk-register-visuals";
import { cn } from "@/lib/utils";
import { comingSoonHref } from "@/components/shell/moduleNav";
import { RiskDocumentPanel } from "./RiskDocumentPanel";

const STATEMENT_MAX = 2000;

function Fact({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div className="flex min-w-[150px] max-w-[260px] flex-col gap-1">
      <span className="text-[10px] font-bold tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-[12.5px] leading-snug", tone ?? "text-foreground")}>{value}</span>
      {note && <span className="text-[10.5px] leading-relaxed text-muted-foreground">{note}</span>}
    </div>
  );
}

export function RiskRow({ risk, open, onToggle }: { risk: WireRisk; open: boolean; onToggle: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [statement, setStatement] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const acceptMutation = useAcceptRisk();

  const accepted = risk.accepted;
  const accStatus = accepted?.status ?? "none";
  const accSwatch = acceptanceSwatch(accStatus);
  const rsSwatch = riskStatusSwatch(risk.status);
  const rvSwatch = reviewSwatch(risk.reviewState);
  const sevSwatch = severitySwatch(risk.inherent);

  // Deterministic, matching the backend's own personIdForUser("u" + userId) —
  // see artifacts/api-server/src/lib/portal-ownership.ts. Used only for a
  // proactive UI hint; the server re-derives and enforces this itself on
  // every accept attempt (contract pack §1.4).
  const myPersonId = typeof user?.id === "number" ? `u${user.id}` : null;

  const authority = risk.authority;
  const holderIds = authority?.holders.map((h) => h.personId) ?? [];
  const noHolder = !!authority && holderIds.length === 0;
  const notMine = !!authority && holderIds.length > 0 && !!myPersonId && !holderIds.includes(myPersonId);
  const signable = !risk.isAccepted && risk.status !== "Closed" && !noHolder && !notMine;
  const canSubmit = signable && name.trim().length >= 2 && statement.trim().length > 0 && confirmed;

  const raciHref = comingSoonHref("Ownership / RACI", "module");

  const handleConfirmSign = () => {
    setShowConfirm(false);
    acceptMutation.mutate(
      { rbdId: risk.id, body: { fullName: name.trim(), confirmed: true, statement: statement.trim() } },
      {
        onSuccess: () => {
          setName("");
          setStatement("");
          setConfirmed(false);
        },
      },
    );
  };

  return (
    <div id={`risk-row-${risk.id}`} className="scroll-mt-4 border-t border-border/60 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 py-2.5 text-left transition-opacity hover:opacity-90"
        data-testid={`risk-row-toggle-${risk.id}`}
      >
        <span
          title={risk.inherent ? `${risk.inherent} inherent risk` : undefined}
          className={cn("h-[30px] w-[3px] flex-none rounded-sm", sevSwatch.text.replace("text-", "bg-"))}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[12.5px] font-semibold text-foreground">{risk.title}</span>
          <span className="truncate text-[10.5px] text-muted-foreground">
            {risk.id} · {risk.pillar ?? "No pillar"} · {risk.framework} {risk.controlViolated}
          </span>
        </div>
        <Badge variant="outline" className={cn("w-[84px] flex-none justify-center", rsSwatch.text, rsSwatch.bg, rsSwatch.border)}>
          {rsSwatch.label}
        </Badge>
        <Badge variant="outline" className={cn("w-[92px] flex-none justify-center", accSwatch.text, accSwatch.bg, accSwatch.border)}>
          {accSwatch.label}
        </Badge>
        <Badge variant="outline" className={cn("w-[74px] flex-none justify-center", rvSwatch.text, rvSwatch.bg, rvSwatch.border)}>
          {rvSwatch.label}
        </Badge>
        <span className="w-16 flex-none text-right text-[11.5px] tabular-nums text-foreground">
          {formatLiability(risk.liabilityValueUsd)}
        </span>
        <ChevronRight className={cn("size-3.5 flex-none text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>

      {open && (
        <div className="flex flex-col gap-4 pb-5 pt-1">
          <div className="flex flex-wrap gap-5">
            <Fact
              label="SEVERITY"
              value={`${risk.inherent ?? "Not recorded"} inherent · ${risk.residual ?? "Not recorded"} residual`}
              note="Residual is what stands after the controls below."
            />
            <Fact
              label="POSITION"
              value={risk.likelihood == null || risk.impact == null ? "Not recorded" : `Likelihood ${risk.likelihood} · impact ${risk.impact}`}
              tone={risk.likelihood == null ? "text-status-amber" : undefined}
              note={risk.likelihood == null ? "Left off the heat map rather than placed at a guess." : undefined}
            />
            <Fact
              label="OWNER"
              value={risk.owner ?? "Not recorded"}
              tone={risk.owner ? undefined : "text-status-amber"}
              note="Display text on the risk. Who may sign is decided by the workload below, not by this name."
            />
            <Fact
              label="AUTHORITY TO SIGN"
              value={authority ? (authority.holders.length ? authority.holders.map((h) => h.name).join(", ") : "Nobody holds it") : "Not workload-owned"}
              tone={authority && authority.holders.length === 0 ? "text-status-amber" : undefined}
              note={
                authority
                  ? `Accountable for ${authority.workloadLabel}. Any holder may sign; the order means nothing.`
                  : "This check spans workloads, so no single owner resolves and anyone signed in here may sign."
              }
            />
            <Fact
              label="OBLIGATION"
              value={risk.obligation ?? "Not recorded"}
              tone={risk.obligation ? undefined : "text-status-amber"}
              note={risk.obligationType ? `Matched to your ${risk.obligationType} catalogue.` : undefined}
            />
            <Fact
              label="PROVENANCE"
              value={risk.spawnedByChangeRequestCode ? `Raised by ${risk.spawnedByChangeRequestCode}` : "Recorded by your MSP"}
              note={
                risk.dischargedByChangeRequestCode
                  ? `Discharged by ${risk.dischargedByChangeRequestCode}.`
                  : risk.spawnedByChangeRequestCode
                    ? "Declining that change request is what created this risk."
                    : undefined
              }
            />
            <Fact
              label="REVIEW"
              value={risk.review ?? "No review clock set"}
              tone={risk.reviewState === "overdue" ? "text-status-red" : risk.review ? undefined : "text-status-amber"}
              note={risk.reviewState === "overdue" ? "An overdue review does not lapse a signature — it stays valid." : undefined}
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-border/60 pt-3.5">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold tracking-wider text-muted-foreground">WHAT IT IS</span>
              <span className="max-w-[700px] text-[12.5px] leading-relaxed text-foreground">{risk.what}</span>
            </div>
            {risk.outcome && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold tracking-wider text-muted-foreground">IF IT HAPPENS</span>
                <span className="max-w-[700px] text-[12.5px] leading-relaxed text-foreground">{risk.outcome}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-5 pt-0.5">
              <div className="flex min-w-[260px] flex-1 flex-col gap-1.5">
                <span className="text-[10px] font-bold tracking-wider text-muted-foreground">COMPENSATING CONTROLS</span>
                {risk.controls.length > 0 ? (
                  risk.controls.map((c, i) => (
                    <span key={i} className="text-xs leading-relaxed text-foreground">
                      {c}
                    </span>
                  ))
                ) : (
                  <span className="text-xs leading-relaxed text-status-amber">
                    None recorded. Nothing is reducing this risk today.
                  </span>
                )}
              </div>
              <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
                <span className="text-[10px] font-bold tracking-wider text-muted-foreground">PLAN &amp; EVIDENCE</span>
                <span className={cn("text-xs leading-relaxed", risk.plan ? "text-foreground" : "text-status-amber")}>
                  {risk.plan ?? "No plan recorded"}
                </span>
                <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {risk.evidence ? `Evidence: ${risk.evidence}` : "Evidence not recorded"}
                </span>
              </div>
            </div>
          </div>

          {accepted && (
            <div className="flex flex-col gap-2.5 rounded-xl border border-status-green/30 bg-status-green/5 p-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[12.5px] font-semibold text-foreground">
                  {accStatus === "revoked" ? "This acceptance was revoked" : `Accepted by ${accepted.by} on ${formatDateTime(accepted.on)}`}
                </span>
                <Badge variant="outline" className={cn(accSwatch.text, accSwatch.bg, accSwatch.border)}>
                  {accSwatch.label}
                </Badge>
              </div>
              {accepted.statement && (
                <p className="max-w-[700px] border-l-2 border-status-green/40 pl-3 text-[12.5px] leading-relaxed text-foreground">
                  {accepted.statement}
                </p>
              )}
              <div className="flex flex-wrap gap-5">
                <Fact label="SIGNED BY" value={accepted.by} />
                <Fact label="WHEN" value={formatDateTime(accepted.on)} />
                <Fact label="REGISTER REF" value={accepted.register ?? "Not recorded"} />
                <Fact
                  label="BACKED BY"
                  value={
                    accepted.authorizedBy
                      ? `${accepted.authorizedBy.holders.map((h) => h.name).join(", ") || "Nobody"}, as Accountable for ${accepted.authorizedBy.workloadLabel} at the time of signing`
                      : "No workload owner resolved for this check at the time of signing"
                  }
                />
              </div>
              <span className="max-w-[700px] text-[10.5px] leading-relaxed text-muted-foreground">
                {accStatus === "revoked"
                  ? `Revoking ends the acceptance; it does not remove it. This risk is currently marked "${rsSwatch.label}", and this signature cannot be reused or re-signed.`
                  : "Recorded once and never rewritten, including the time, the signing address and who held authority at that moment. There is no expiry date and no renewal — a later change request is what discharges it."}
              </span>
            </div>
          )}

          {!accepted && signable && (
            <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
              <div className="flex flex-col gap-1">
                <span className="text-[12.5px] font-semibold text-foreground">Accept this risk</span>
                <span className="max-w-[640px] text-[11.5px] leading-relaxed text-muted-foreground">
                  Signing records that you have read this line and are keeping the exposure named
                  above rather than remediating it. It cannot be signed twice, it does not lapse,
                  and neither you nor your MSP can renew or reissue it later.
                </span>
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                  <Label htmlFor={`accept-name-${risk.id}`} className="text-[11px] text-muted-foreground">
                    Your full name
                  </Label>
                  <Input
                    id={`accept-name-${risk.id}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name as you sign it"
                    data-testid={`risk-accept-name-${risk.id}`}
                  />
                  <span className="text-[10.5px] text-muted-foreground/70">
                    Recorded as typed. It is not checked against your account name.
                  </span>
                </div>
                <div className="flex min-w-[260px] flex-[2] flex-col gap-1.5">
                  <Label htmlFor={`accept-statement-${risk.id}`} className="text-[11px] text-muted-foreground">
                    Your statement
                  </Label>
                  <Textarea
                    id={`accept-statement-${risk.id}`}
                    value={statement}
                    onChange={(e) => setStatement(e.target.value.slice(0, STATEMENT_MAX))}
                    placeholder="Why you are accepting this rather than fixing it"
                    className="min-h-[62px] resize-y"
                    data-testid={`risk-accept-statement-${risk.id}`}
                  />
                  <span className="text-[10.5px] text-muted-foreground/70">
                    Kept word for word with your signature.{" "}
                    {statement.length > 0 ? `${statement.length} of ${STATEMENT_MAX} characters` : `Up to ${STATEMENT_MAX} characters.`}
                  </span>
                </div>
              </div>
              <label className="flex cursor-pointer items-start gap-2.5">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                  className="mt-0.5"
                  data-testid={`risk-accept-confirm-${risk.id}`}
                />
                <span className="max-w-[620px] text-xs leading-relaxed text-foreground">
                  I accept this risk on behalf of my organisation and understand the exposure
                  stays with us until a change discharges it.
                </span>
              </label>
              <div className="flex items-center gap-3 border-t border-border/60 pt-3">
                <span className="max-w-[440px] text-[10.5px] leading-relaxed text-muted-foreground">
                  {authority
                    ? `You are signing as an Accountable holder for ${authority.workloadLabel}. Your MSP cannot sign this for you.`
                    : "This check has no single workload owner, so any signed-in person here may sign it. Your MSP cannot sign it for you."}
                </span>
                <Button
                  size="sm"
                  className="ml-auto flex-none"
                  disabled={!canSubmit || acceptMutation.isPending}
                  onClick={() => setShowConfirm(true)}
                  data-testid={`risk-accept-sign-${risk.id}`}
                >
                  {acceptMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  Sign and accept
                </Button>
              </div>
            </div>
          )}

          {!accepted && !signable && (noHolder || notMine) && (
            <div
              className={cn(
                "flex gap-3 rounded-xl border p-4",
                noHolder ? "border-status-amber/40 bg-status-amber/5" : "border-status-red/35 bg-status-red/5",
              )}
            >
              <div className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-semibold text-foreground">
                  {noHolder ? "Nobody can sign this yet" : "You are not the person who can sign this"}
                </span>
                <span className="max-w-[640px] text-xs leading-relaxed text-muted-foreground">
                  {noHolder
                    ? `Nobody currently holds Accountable for ${authority?.workloadLabel}, and acceptance follows that role rather than a per-risk assignment. Assign a holder and this becomes signable — by them, or by you if it is you.`
                    : `Accountable for ${authority?.workloadLabel} is held by ${authority?.holders.map((h) => h.name).join(" and ")}. Any of them can sign this line; you cannot sign on their behalf, and neither can your MSP.`}
                </span>
                <Link href={raciHref} className="pt-0.5 text-[11.5px] font-semibold text-primary hover:underline">
                  {noHolder ? "Open Ownership / RACI to assign a holder" : "See the current holders on Ownership / RACI"}
                </Link>
              </div>
            </div>
          )}

          <RiskDocumentPanel rbdId={risk.id} open={open} />
        </div>
      )}

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign this acceptance as {name.trim()}?</DialogTitle>
            <DialogDescription>
              The line is recorded as accepted the moment you confirm, along with your statement
              word for word, the time, your address and who held authority for the workload right
              now.
            </DialogDescription>
          </DialogHeader>
          <p className="text-[11.5px] leading-relaxed text-status-amber">
            It cannot be signed a second time and it does not expire. If your position changes
            later, your MSP revokes it and raises the risk again — the original signature stays on
            the record either way.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              Go back
            </Button>
            <Button onClick={handleConfirmSign} disabled={acceptMutation.isPending}>
              {acceptMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Confirm and sign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
