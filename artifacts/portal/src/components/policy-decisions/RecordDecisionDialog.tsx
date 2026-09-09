import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { useComplianceObligations, useCreatePolicyDecision } from "@/lib/policy-decisions-api";
import { CLEARANCE_TRIGGER_TYPES, REVIEW_CADENCES, type ClearanceTriggerType, type ReviewCadence } from "@/lib/policy-decisions-types";
import { cn } from "@/lib/utils";

const OBLIGATION_OTHER = "__other__";
const STATEMENT_MAX = 2000;
const CONTROL_MAX = 2000;

const selectClass =
  "w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-[12.5px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * "Record a decision, and sign it" (#1724, contract pack §1.3). Recording and
 * signing are one act — there is no draft state; the typed name and the
 * confirmation checkbox together are the signature, and the time is set when
 * it reaches the server. `reviewCadence` XOR `clearanceCondition` matches the
 * route's own `superRefine` (never both, never neither).
 */
export function RecordDecisionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: obligations } = useComplianceObligations();
  const createMutation = useCreatePolicyDecision();

  const [title, setTitle] = useState("");
  const [obligationChoice, setObligationChoice] = useState<string>(OBLIGATION_OTHER);
  const [obligationText, setObligationText] = useState("");
  const [pillar, setPillar] = useState("");
  const [owner, setOwner] = useState("");
  const [clockMode, setClockMode] = useState<"cadence" | "dependency">("cadence");
  const [cadence, setCadence] = useState<ReviewCadence>("Annual");
  const [condition, setCondition] = useState("");
  const [triggerType, setTriggerType] = useState<ClearanceTriggerType>("manual");
  const [sku, setSku] = useState("");
  const [compensatingControl, setCompensatingControl] = useState("");
  const [signerName, setSignerName] = useState("");
  const [statement, setStatement] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const catalog = obligations ?? [];
  const selectedCatalogRow = useMemo(
    () => catalog.find((o) => o.id === obligationChoice),
    [catalog, obligationChoice],
  );
  const obligation = obligationChoice === OBLIGATION_OTHER ? obligationText.trim() : (selectedCatalogRow?.framework ?? "");

  const dependencyValid = clockMode === "dependency"
    ? condition.trim().length > 0 && (triggerType !== "license_sku" || sku.trim().length > 0)
    : true;

  const canSubmit =
    title.trim().length >= 2 &&
    obligation.length >= 2 &&
    owner.trim().length > 0 &&
    compensatingControl.trim().length > 0 &&
    signerName.trim().length >= 2 &&
    statement.trim().length > 0 &&
    confirmed &&
    dependencyValid &&
    !createMutation.isPending;

  const reset = () => {
    setTitle("");
    setObligationChoice(OBLIGATION_OTHER);
    setObligationText("");
    setPillar("");
    setOwner("");
    setClockMode("cadence");
    setCadence("Annual");
    setCondition("");
    setTriggerType("manual");
    setSku("");
    setCompensatingControl("");
    setSignerName("");
    setStatement("");
    setConfirmed(false);
  };

  const handleConfirmSign = () => {
    setShowConfirm(false);
    createMutation.mutate(
      {
        title: title.trim(),
        obligation,
        obligationId: obligationChoice !== OBLIGATION_OTHER ? Number(obligationChoice) : null,
        pillar: pillar.trim() || undefined,
        owner: owner.trim(),
        ...(clockMode === "cadence"
          ? { reviewCadence: cadence }
          : {
              clearanceCondition: condition.trim(),
              clearanceTriggerType: triggerType,
              ...(triggerType === "license_sku" ? { clearanceTriggerSkuPartNumber: sku.trim() } : {}),
            }),
        compensatingControl: compensatingControl.trim(),
        signerName: signerName.trim(),
        confirmed: true,
        statement: statement.trim(),
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!createMutation.isPending) {
            if (!next) reset();
            onOpenChange(next);
          }
        }}
      >
        <DialogContent closeDisabled={createMutation.isPending} className="max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Record a decision, and sign it</DialogTitle>
            <DialogDescription>
              Recording and signing are one act. Your typed name and the confirmation are the
              signature; the time it was signed is set when it reaches the server.
            </DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pd-title">What you have decided</Label>
              <Input
                id="pd-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Teams chat is kept for one year"
                data-testid="policy-decision-title-input"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pd-obligation">The rule it departs from</Label>
              <select
                id="pd-obligation"
                value={obligationChoice}
                onChange={(e) => setObligationChoice(e.target.value)}
                className={selectClass}
                data-testid="policy-decision-obligation-select"
              >
                <option value={OBLIGATION_OTHER}>Write it in…</option>
                {catalog.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.framework}
                  </option>
                ))}
              </select>
              {obligationChoice === OBLIGATION_OTHER && (
                <Input
                  value={obligationText}
                  onChange={(e) => setObligationText(e.target.value)}
                  placeholder="GDPR Art. 5(1)(e) · Art. 32"
                  data-testid="policy-decision-obligation-text-input"
                />
              )}
              <span className="text-[10px] text-muted-foreground/70">
                Pick from the catalogue, or write it in — a catalogue pick that fails to resolve is
                kept as the text you wrote.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pd-owner">Who answers for it</Label>
                <Input id="pd-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Anna Novak" data-testid="policy-decision-owner-input" />
                <span className="text-[10px] text-muted-foreground/70">A named person, not a team.</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pd-pillar">
                  Area <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input id="pd-pillar" value={pillar} onChange={(e) => setPillar(e.target.value)} placeholder="Compliance" data-testid="policy-decision-pillar-input" />
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={clockMode === "cadence" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setClockMode("cadence")}
                  data-testid="policy-decision-mode-cadence"
                >
                  Revisit on a cadence
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={clockMode === "dependency" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setClockMode("dependency")}
                  data-testid="policy-decision-mode-dependency"
                >
                  Or wait on one thing
                </Button>
              </div>
              <span className="text-[10.5px] leading-relaxed text-muted-foreground">
                A decision is revisited on a fixed cadence, or it waits on one thing to change. Pick
                whichever fits — never both. A dependency the platform can watch for you, such as a
                licence arriving, clears itself.
              </span>

              {clockMode === "cadence" ? (
                <select
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value as ReviewCadence)}
                  className={selectClass}
                  data-testid="policy-decision-cadence-select"
                >
                  {REVIEW_CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex flex-col gap-2">
                  <Input
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    placeholder="Entra ID P2 licences land on the tenant"
                    data-testid="policy-decision-condition-input"
                  />
                  <select
                    value={triggerType}
                    onChange={(e) => setTriggerType(e.target.value as ClearanceTriggerType)}
                    className={selectClass}
                    data-testid="policy-decision-trigger-type-select"
                  >
                    {CLEARANCE_TRIGGER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t === "license_sku" ? "A licence the platform can watch for" : "Something only a person can confirm"}
                      </option>
                    ))}
                  </select>
                  {triggerType === "license_sku" && (
                    <Input
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                      placeholder="SKU part number, e.g. AAD_PREMIUM_P2"
                      data-testid="policy-decision-sku-input"
                    />
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pd-control">What holds the risk down</Label>
              <Textarea
                id="pd-control"
                value={compensatingControl}
                onChange={(e) => setCompensatingControl(e.target.value.slice(0, CONTROL_MAX))}
                placeholder="What protects you in the meantime"
                className="min-h-[62px] resize-y"
                data-testid="policy-decision-control-input"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pd-statement">Why, and your name</Label>
              <Textarea
                id="pd-statement"
                value={statement}
                onChange={(e) => setStatement(e.target.value.slice(0, STATEMENT_MAX))}
                placeholder="The reasoning behind this decision"
                className="min-h-[62px] resize-y"
                data-testid="policy-decision-statement-input"
              />
              <span className="text-[10.5px] text-muted-foreground/70">
                Kept word for word with your signature.{" "}
                {statement.length > 0 ? `${statement.length} of ${STATEMENT_MAX} characters` : `Up to ${STATEMENT_MAX} characters.`}
              </span>
              <Input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Your full name, as you sign it"
                data-testid="policy-decision-signer-input"
              />
              <span className="text-[10.5px] text-muted-foreground/70">Recorded as typed. It is not checked against your account name.</span>
            </div>

            <label className={cn("flex cursor-pointer items-start gap-2.5")}>
              <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" data-testid="policy-decision-confirm-checkbox" />
              <span className="max-w-[560px] text-xs leading-relaxed text-foreground">
                I confirm this position on behalf of my organisation and understand it is recorded
                the moment I sign it.
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button disabled={!canSubmit} onClick={() => setShowConfirm(true)} data-testid="policy-decision-submit">
              {createMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Sign this decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign this decision as {signerName.trim()}?</DialogTitle>
            <DialogDescription>
              The decision is recorded the moment you confirm, along with your statement word for
              word, and the time it was signed.
            </DialogDescription>
          </DialogHeader>
          <p className="text-[11.5px] leading-relaxed text-status-amber">
            Positions cannot be edited or withdrawn, because the record is the signature. To change
            one later, you record the position you hold then as a new, separately signed decision.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              Go back
            </Button>
            <Button onClick={handleConfirmSign} disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Confirm and sign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
