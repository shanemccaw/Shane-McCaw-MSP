/**
 * "Your change policy" — the customer settings surface (#1592/#1759/#1717),
 * consuming the real `useChangeControlSettingsLive()` hook that previously had
 * no page to wire into. Policy switches, a live-computed approver list, and
 * the seven fixed notification rules.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ChangeControlLiveState } from "@/components/settingsChangeControlLive";
import type { CcPolicy } from "@/components/settingsChangeControlWire";
import { toast } from "sonner";

const POLICY_ROWS: ReadonlyArray<{ key: keyof CcPolicy; label: string; desc: string }> = [
  { key: "on", label: "Change control is on", desc: "Every change to your tenant is raised here first and authorises the write that follows." },
  { key: "separate", label: "Separate approver required", desc: "Whoever raised a change cannot approve it. Your MSP is held to the same rule on approvals." },
  { key: "freeze", label: "Enforce the freeze calendar", desc: "A change raised or booked inside a freeze is refused without a written justification." },
  { key: "maintenanceWindows", label: "Enforce maintenance windows", desc: "A booked change must sit entirely inside an active window. No exception route exists." },
  { key: "emergency", label: "Allow the emergency path", desc: "An emergency change takes one stage on a one-day SLA and may be signed off retrospectively." },
];

const NOTIF_LABELS: Record<string, string> = {
  ms_enforcement_approaching: "A Microsoft enforcement date is approaching",
  message_center_impact: "A Message Center post affects your tenant",
  cr_raised: "A change request is raised",
  cr_awaiting_signature: "A change is waiting for a signature",
  cr_window_opening: "A booked window is about to open",
  cr_deployed_or_rolled_back: "A change was deployed or rolled back",
  freeze_declared_or_lifted: "A freeze is declared or lifted",
};

export function PolicySection({ settings }: { settings: ChangeControlLiveState }) {
  const [open, setOpen] = useState(false);
  const { policy, notifications, eligibleApprovers, people, saving, savePolicy, saveNotifRule } = settings;

  const approvers = people.filter((p) => eligibleApprovers.includes(p.id));

  return (
    <div className="flex flex-col gap-2.5" data-testid="change-control-policy">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13.5px] font-semibold text-foreground">Your change policy</span>
        <span className="text-[11px] text-muted-foreground">the rules the register above enforces — yours to set</span>
        <Button variant="link" size="sm" className="ml-auto h-auto p-0 text-[11px]" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-5">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {POLICY_ROWS.map((row) => {
                const toggle = () =>
                  void savePolicy({ [row.key]: !policy[row.key] } as Partial<CcPolicy>).then((err) => {
                    if (err) toast.error(err);
                  });
                return (
                  <div
                    key={row.key}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border border-border/60 p-2.5",
                      saving ? "opacity-60" : "cursor-pointer hover:border-primary/40",
                    )}
                    onClick={() => !saving && toggle()}
                  >
                    <Switch checked={Boolean(policy[row.key])} disabled={saving} className="pointer-events-none mt-0.5" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-semibold text-foreground">{row.label}</span>
                      <span className="text-[10.5px] leading-relaxed text-muted-foreground">{row.desc}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <span className="text-[11px] leading-relaxed text-muted-foreground">
              Signatures required: <b className="font-semibold text-foreground">at least {policy.approvals}</b>. This
              is a floor — a change&apos;s class and computed risk can demand more stages, and this
              setting can never demand fewer.
            </span>

            <div className="flex flex-col gap-1.5 border-t border-border/50 pt-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[11px] font-semibold text-foreground">Who can approve</span>
                <span className="text-[10.5px] text-muted-foreground">computed live from each account&apos;s approve-changes flag — there is no list to edit here</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {approvers.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">No account on this tenant currently holds the approve-changes capability.</span>
                ) : (
                  approvers.map((a) => (
                    <span key={a.id} className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-foreground/90">
                      {a.name}
                    </span>
                  ))
                )}
              </div>
              <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
                The approve and reject actions read the same flag, so this list and the gate cannot
                disagree. Changing who holds it is an account change, made with your MSP.
              </span>
            </div>

            <div className="flex flex-col gap-2 border-t border-border/50 pt-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[11px] font-semibold text-foreground">Who is told, and when</span>
                <span className="text-[10.5px] text-muted-foreground">seven fixed events · each rule is saved on its own</span>
              </div>
              {notifications.map((n) => (
                <NotifRow key={n.event} event={n.event} to={n.to} saving={saving} onSave={saveNotifRule} />
              ))}
              <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
                A rule with no recipient names nobody on purpose — you choose who is told; no name is
                pre-filled by guessing.
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NotifRow({
  event,
  to,
  saving,
  onSave,
}: {
  event: string;
  to: string;
  saving: boolean;
  onSave: (event: string, patch: { to?: string }) => Promise<string | null>;
}) {
  const [value, setValue] = useState(to);
  const [pending, setPending] = useState(false);
  const dirty = value !== to;

  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-border/40 pb-2 last:border-b-0">
      <span className="min-w-[240px] flex-1 text-xs text-foreground/90">{NOTIF_LABELS[event] ?? event}</span>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="No recipient set"
        className={cn("h-7 min-w-[150px] max-w-[220px] text-[11px]", !to && "border-status-amber/40")}
      />
      {dirty && (
        <Button
          size="sm"
          variant="link"
          className="h-auto p-0 text-[11px]"
          disabled={pending || saving}
          onClick={async () => {
            setPending(true);
            const err = await onSave(event, { to: value });
            setPending(false);
            if (err) toast.error(err);
          }}
        >
          {pending && <Loader2 className="size-3 animate-spin" />}
          Save
        </Button>
      )}
      <span className="font-mono text-[10px] text-muted-foreground/60">{event}</span>
    </div>
  );
}
