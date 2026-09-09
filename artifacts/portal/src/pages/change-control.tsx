/**
 * Change Control (#1717, Feature #1486) — wired against the real, regenerated
 * `docs/portal/change-control-contract-pack.md` (#2989) and
 * `Design/portal/design_handoff_full_site/screens/Change Control.dc.html`.
 *
 * Tri-state the design's own `dataState` enum maps onto real signals:
 *   - loading      → register query pending
 *   - read-failed  → register query errored
 *   - no-tenant    → register resolved with `scoped: false` (the fail-closed
 *                     envelope — a real HTTP 200, not an error)
 *   - live-empty   → `scoped: true` and zero requests
 *   - live         → `scoped: true` and at least one request
 *
 * `canApproveChanges` is derived the same way the server derives it: the
 * caller's own wire person id (`"u" + user.id`, `personIdForUser`'s exact
 * convention) tested against the settings surface's live `eligibleApprovers`
 * list — not a second, invented notion of the capability.
 */
import { useState } from "react";
import { AlertTriangle, Loader2, Plus, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { useChangeControlSettingsLive } from "@/components/settingsChangeControlLive";
import { FreezeCalendarCard, MaintenanceWindowsCard } from "@/components/change-control/CalendarSection";
import { CatalogSection } from "@/components/change-control/CatalogSection";
import { ChangeActionDialog, type ChangeActionTarget } from "@/components/change-control/ChangeActionDialog";
import { ChangeRow } from "@/components/change-control/ChangeRow";
import { MetricsSection } from "@/components/change-control/MetricsSection";
import { PolicySection } from "@/components/change-control/PolicySection";
import { RaiseChangeDialog } from "@/components/change-control/RaiseChangeDialog";
import {
  useChangeControlRegister,
  useChangeMetrics,
  useFreezeWindows,
  useMaintenanceWindows,
} from "@/lib/change-control-api";
import { cn } from "@/lib/utils";

const NOT_BUILT = [
  {
    title: "Rollback as an inverse change",
    tag: "MSP-SIDE ONLY",
    now: "The rollback affordance appears on an implemented change and no rollback route exists on the portal. Execution records, planned-versus-actual and rollback as an inverse change are real on your MSP's console.",
  },
  {
    title: "Moving a booked change",
    tag: "NO ROUTE",
    now: "New bookings are checked for collisions and window coverage, and blocked-by dependencies are shown — but an already-raised change cannot be moved from here.",
  },
  {
    title: "CAB, execution and post-implementation review",
    tag: "MSP-SIDE ONLY",
    now: "CAB membership, meetings, agendas and review close codes exist on your MSP's console. A review reaches this page only as an event on the change's timeline.",
  },
];

export default function ChangeControlPage() {
  const { user } = useAuth();
  const register = useChangeControlRegister();
  const settings = useChangeControlSettingsLive();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<ChangeActionTarget | null>(null);

  const isLoading = register.isLoading;
  const isFail = register.isError;
  const scoped = register.data?.scoped ?? false;
  const noTenant = !isLoading && !isFail && !scoped;
  const requests = register.data?.requests ?? [];
  const isEmpty = !isLoading && !isFail && scoped && requests.length === 0;
  const live = !isLoading && !isFail && scoped;

  const freezeWindows = useFreezeWindows(!isLoading && !isFail);
  const maintenanceWindows = useMaintenanceWindows(!isLoading && !isFail);
  const metrics = useChangeMetrics(!isLoading && !isFail && !noTenant);

  const myPersonId = user ? `u${user.id}` : null;
  const canApproveChanges = myPersonId !== null && settings.eligibleApprovers.includes(myPersonId);
  const activeFreeze = freezeWindows.data?.find((w) => w.activeNow) ?? null;

  const stats = register.data?.stats;

  return (
    <div className="flex flex-col gap-4 pb-14" data-testid="change-control-page">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Change control</h1>
        <span
          title="Every change to your tenant exists here as a change request first. An approved request is what authorises a write, and the execution stamps its reference back onto the change it made."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="change-control-status">
          <span
            className={cn(
              "size-1.5 rounded-full",
              isLoading ? "bg-muted-foreground" : isFail ? "bg-status-red" : noTenant ? "bg-status-amber" : isEmpty ? "bg-status-blue" : "bg-status-green",
            )}
          />
          {isLoading
            ? "Loading the register"
            : isFail
              ? "Couldn't load the register"
              : noTenant
                ? "No connected M365 tenant · fails closed"
                : isEmpty
                  ? "Live · genuinely empty"
                  : `Live · ${requests.length} change requests on your tenant`}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {canApproveChanges ? "You may approve changes" : "You may not approve changes"} · change control add-on active
        </span>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex animate-pulse flex-col gap-2 rounded-xl border border-border/60 bg-muted/10 p-4">
              <div className="h-2.5 w-2/5 rounded-full bg-muted-foreground/20" />
              <div className="h-2 w-1/2 rounded-full bg-muted-foreground/10" />
            </div>
          ))}
        </div>
      )}

      {(isFail || noTenant) && (
        <div className={cn("flex gap-2.5 rounded-xl border p-4", isFail ? "border-status-red/35 bg-status-red/5" : "border-status-amber/35 bg-status-amber/5")}>
          <AlertTriangle className={cn("mt-0.5 size-4 flex-none", isFail ? "text-status-red" : "text-status-amber")} />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">{isFail ? "Couldn't load the change register" : "No connected M365 tenant"}</span>
            <span className="max-w-[680px] text-xs leading-relaxed text-muted-foreground">
              {isFail
                ? "The register did not load. Nothing is shown in its place — an empty register would read as “no changes on your tenant”, which is a different and much worse claim."
                : "Your account has no resolvable Microsoft 365 tenant, so the register fails closed to empty rather than matching every other unidentified row. The counters below are the fail-closed envelope, not your tenant's answer."}
            </span>
            {isFail && (
              <Button variant="link" size="sm" className="h-auto w-fit p-0 text-[11.5px]" onClick={() => void register.refetch()} disabled={register.isRefetching}>
                {register.isRefetching && <Loader2 className="size-3 animate-spin" />}
                Try again
              </Button>
            )}
          </div>
        </div>
      )}

      {!isLoading && !isFail && stats && (
        <>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Open changes" value={stats.open} note="Pending approval, approved, scheduled or in window." />
            <StatTile label="Awaiting approval" value={stats.awaitingApproval} amber={stats.awaitingApproval > 0} note="A stage is pending a decision." />
            <StatTile
              label="Next window"
              value={stats.nextWindowCount}
              sub={stats.nextWindowLabel}
              note={stats.nextWindowDateOrdered ? "The earliest upcoming booked instant, and how many changes share it." : "No open change carries a real instant."}
              tag={stats.nextWindowDateOrdered ? "DATE-ORDERED" : "STRING-GROUPED †"}
              tagGood={stats.nextWindowDateOrdered}
            />
            <StatTile
              label={`Emergency · ${stats.emergencyLookbackDays} days`}
              value={stats.emergencyCount}
              sub={`${stats.snapshotsHeld} ${stats.snapshotsHeld === 1 ? "snapshot" : "snapshots"} held`}
              amber={stats.emergencyCount > 0}
              note={`Emergency changes raised in the last ${stats.emergencyLookbackDays} days. Snapshots are kept ${stats.snapshotRetentionDays} days.`}
              tag="SUBSTITUTE METRIC †"
            />
          </div>
          <span className="-mt-1.5 block max-w-[840px] text-[10.5px] leading-relaxed text-muted-foreground/70">
            † Next window is chronological only when an open change carries a real booked instant;
            otherwise it falls back to grouping identical window text. Snapshots held measures
            retention from when a change was raised, since the executed-at stamp is still free text.
          </span>
        </>
      )}

      {live && activeFreeze && (
        <div className="flex gap-3 rounded-xl border border-status-teal/35 bg-status-teal/5 p-4">
          <ShieldAlert className="mt-0.5 size-[17px] flex-none text-status-teal" />
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-semibold text-foreground">A freeze is in effect: {activeFreeze.name}</span>
              <Badge variant="outline" className="border-status-green/35 text-[9.5px] text-status-green">
                ENFORCED AT SUBMIT
              </Badge>
            </div>
            <span className="max-w-[780px] text-[12.5px] leading-relaxed text-foreground/90">
              {activeFreeze.reason ?? "Raising a change now is refused unless you submit a written justification with it."}
            </span>
            <span className="max-w-[780px] text-[11.5px] leading-relaxed text-muted-foreground">
              A change whose own booked window overlaps a freeze is refused too, not only one raised
              during it. The refusal happens on the server, so it cannot be clicked past.
            </span>
          </div>
        </div>
      )}

      {live && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[13.5px] font-semibold text-foreground">Register</span>
            <span className="text-[11px] text-muted-foreground">
              newest first · {requests.length} requests · approvals, freezes, maintenance windows, dependencies, comments and attachments are live
            </span>
            <Button size="sm" className="ml-auto" onClick={() => setWizardOpen(true)}>
              <Plus className="size-3.5" />
              Raise a change
            </Button>
          </div>
          {isEmpty ? (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-border p-6" data-testid="change-control-empty">
              <span className="text-[14px] font-semibold text-foreground">This tenant has no change requests yet</span>
              <span className="max-w-[640px] text-xs leading-relaxed text-muted-foreground">
                Your tenant resolved and the register really is empty — this is your own answer, not a
                failure. The counters above are genuine zeros.
              </span>
              <Button size="sm" className="mt-1" onClick={() => setWizardOpen(true)}>
                Raise the first change request
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {requests.map((cr) => (
                <ChangeRow
                  key={cr.code}
                  cr={cr}
                  expanded={expanded === cr.code}
                  onToggle={() => setExpanded((cur) => (cur === cr.code ? null : cr.code))}
                  onAction={setActionTarget}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!isLoading && !isFail && <CatalogSection />}

      {!isLoading && !isFail && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <FreezeCalendarCard windows={freezeWindows.data ?? []} noTenant={noTenant} />
          <MaintenanceWindowsCard windows={maintenanceWindows.data ?? []} noTenant={noTenant} enforced={settings.policy.maintenanceWindows} />
        </div>
      )}

      {!isLoading && !isFail && !noTenant && metrics.data && <MetricsSection metrics={metrics.data} />}

      {!isLoading && !isFail && <PolicySection settings={settings} />}

      <Card className="bg-muted/5">
        <CardContent className="flex flex-col gap-2.5 pt-6">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[13px] font-semibold text-foreground">Not on this page yet</span>
            <span className="text-[11px] text-muted-foreground">what the module still owes you</span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {NOT_BUILT.map((s) => (
              <div key={s.title} className="flex flex-col gap-1.5 rounded-lg border border-dashed border-muted-foreground/30 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-foreground">{s.title}</span>
                  <Badge variant="outline" className="ml-auto border-status-amber/40 text-[9.5px] text-status-amber">
                    {s.tag}
                  </Badge>
                </div>
                <span className="text-[11.5px] leading-relaxed text-muted-foreground">{s.now}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <RaiseChangeDialog open={wizardOpen} onOpenChange={setWizardOpen} />
      <ChangeActionDialog target={actionTarget} onOpenChange={(open) => !open && setActionTarget(null)} />
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  note,
  tag,
  tagGood,
  amber,
}: {
  label: string;
  value: number;
  sub?: string;
  note: string;
  tag?: string;
  tagGood?: boolean;
  amber?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1.5 pt-5">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="flex items-baseline gap-2">
          <span className={cn("text-[26px] font-extrabold leading-none tracking-tight tabular-nums", amber ? "text-status-amber" : "text-foreground")}>{value}</span>
          {sub && <span className="text-[11.5px] text-muted-foreground">{sub}</span>}
        </div>
        <span className="text-[10.5px] leading-relaxed text-muted-foreground">{note}</span>
        {tag && (
          <Badge variant="outline" className={cn("w-fit text-[9.5px] tracking-wider", tagGood ? "border-status-green/35 text-status-green" : "border-status-amber/40 text-status-amber")}>
            {tag}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
