import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreatePoam } from "@/lib/poams-api";
import type { CreatePoamRequest } from "@/lib/poams-types";

const TEXT_MAX = 4000;
const TITLE_MAX = 300;

/**
 * "Raise a plan" (#4037, design: `POAMs.dc.html`'s `creating` scene). A
 * customer-authored plan still starts `pending_signature` and goes through
 * the same real signature ceremony as any other plan — there is no bypass.
 *
 * `checkKey` and `sowId` are real, free-form optional fields on the wire
 * (`portal-poams.ts`'s `createPoamSchema`); there is no small, honest catalog
 * of either to pick from here (check keys span the whole drift-check
 * vocabulary, SOWs are not served to this app), so both are typed in rather
 * than offered from an invented dropdown.
 */
export function PoamCreatePanel({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [checkKey, setCheckKey] = useState("");
  const [sowId, setSowId] = useState("");
  const [weakness, setWeakness] = useState("");
  const [interim, setInterim] = useState("");
  const [resources, setResources] = useState("");
  const createMutation = useCreatePoam();

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  const canCreate =
    title.trim().length >= 1 &&
    title.trim().length <= TITLE_MAX &&
    [weakness, interim, resources].every((t) => t.trim().length >= 1 && t.trim().length <= TEXT_MAX) &&
    isoDatePattern.test(date) &&
    !createMutation.isPending;

  const handleSubmit = () => {
    if (!canCreate) return;
    const body: CreatePoamRequest = {
      title: title.trim(),
      weaknessDescription: weakness.trim(),
      checkKey: checkKey.trim() || null,
      scheduledCompletionDate: date,
      interimCompensatingControl: interim.trim(),
      resourcesRequired: resources.trim(),
      sowId: sowId.trim() || null,
    };
    createMutation.mutate(body, {
      onSuccess: (res) => onCreated(res.id),
    });
  };

  return (
    <Card className="border-primary/35 bg-primary/5">
      <CardContent className="flex flex-col gap-3.5 pt-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-[13.5px] font-semibold text-foreground">Raise a plan</span>
          <span className="text-[11px] leading-relaxed text-muted-foreground">
            It starts as awaiting signature. A plan you raise yourself still goes through the same
            signature ceremony; there is no bypass.
          </span>
          <Button variant="link" size="sm" className="ml-auto h-auto p-0 text-[11.5px] font-semibold text-muted-foreground" onClick={onCancel} disabled={createMutation.isPending}>
            Cancel
          </Button>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="poam-title">Title</Label>
          <Input
            id="poam-title"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
            placeholder="What this plan fixes, in one line"
            data-testid="poam-create-title"
          />
          <span className="text-[10.5px] text-muted-foreground/70">{title.trim().length} / {TITLE_MAX}</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="poam-date">Target completion date</Label>
            <Input id="poam-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="poam-create-date" />
            <span className="text-[10.5px] text-muted-foreground/70">Kept as the original date forever, even if the live target later moves.</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="poam-check">
              Check this plan answers <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input id="poam-check" value={checkKey} onChange={(e) => setCheckKey(e.target.value)} placeholder="e.g. exo.legacy_auth_enabled" data-testid="poam-create-check" />
            <span className="text-[10.5px] text-muted-foreground/70">
              With no check, no workload owner applies — any signed-in person here may sign it.
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="poam-sow">
            Linked statement of work <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input id="poam-sow" value={sowId} onChange={(e) => setSowId(e.target.value)} placeholder="SOW id" data-testid="poam-create-sow" />
          <span className="text-[10.5px] text-muted-foreground/70">Ties the plan to work your MSP has already quoted.</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="poam-weakness">The weakness</Label>
          <Textarea
            id="poam-weakness"
            value={weakness}
            onChange={(e) => setWeakness(e.target.value.slice(0, TEXT_MAX))}
            placeholder="What is wrong today, and what it exposes"
            className="min-h-[64px] resize-y"
            data-testid="poam-create-weakness"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="poam-interim">Interim compensating control</Label>
            <Textarea
              id="poam-interim"
              value={interim}
              onChange={(e) => setInterim(e.target.value.slice(0, TEXT_MAX))}
              placeholder="What limits the exposure until the fix lands"
              className="min-h-[64px] resize-y"
              data-testid="poam-create-interim"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="poam-resources">Resources required</Label>
            <Textarea
              id="poam-resources"
              value={resources}
              onChange={(e) => setResources(e.target.value.slice(0, TEXT_MAX))}
              placeholder="People, time, change windows, money"
              className="min-h-[64px] resize-y"
              data-testid="poam-create-resources"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
          <span className="flex-1 text-[11px] leading-relaxed text-muted-foreground" style={{ minWidth: 240 }}>
            Your organisation, tenant and provider are set by the server from your session. Nothing
            on this form can point at another tenant, and the plan code is assigned on save — you
            do not choose it.
          </span>
          <Button disabled={!canCreate} onClick={handleSubmit} data-testid="poam-create-submit">
            {createMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Raise plan
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
