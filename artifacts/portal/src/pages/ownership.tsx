import { useMemo, useState } from "react";
import { AlertTriangle, CreditCard, Loader2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AddOwnershipRowDialog } from "@/components/ownership/AddOwnershipRowDialog";
import { DeclineOwnershipDialog, type DeclineTarget } from "@/components/ownership/DeclineOwnershipDialog";
import { MinePlaceCard } from "@/components/ownership/MinePlaceCard";
import { OverlayExtrasCard } from "@/components/ownership/OverlayExtrasCard";
import { OwnershipMatrixSection } from "@/components/ownership/OwnershipMatrixSection";
import { SourcesCard } from "@/components/ownership/SourcesCard";
import { useAssignOwnership, useOwnership } from "@/lib/ownership-api";
import { buildCustomRows, buildMatrixRows, buildMineEntries, computeGaps, groupByType, type MatrixRow } from "@/lib/ownership-matrix";
import { OWN_TYPE_LABEL } from "@/lib/ownership-types";
import { cn } from "@/lib/utils";

/**
 * Ownership / RACI (#3040/#3041, Feature #1491). Adapted from
 * `Design/portal/design_handoff_full_site/screens/Ownership RACI.dc.html`
 * per that package's own README ("recreate these designs... using this
 * codebase's existing... patterns") and wired per
 * `docs/ownership-raci-contract-pack.md` against the real
 * `/api/portal/ownership*` endpoints — the read surface (§1a) landed at
 * #3040; this pass (#3041) wires the write overlay (§1b): assign, accept,
 * decline and add-a-row, all real POSTs against the tables
 * `ownership-matrix.ts`'s own header documents.
 */
const LEDGER: { gap: string; where: string }[] = [
  {
    gap: 'No reorder or handover ("delegation") controls. Both write routes are real and live (`POST /portal/ownership/reorder`, `/delegations`, `/delegations/end`), but the Design export draws no control for either anywhere on this screen, precedence carries no succession/activation logic to reorder for (§4), and #1491\'s own structured index still lists #1518/#1524 ("decide the fate of portal_ownership_delegations") as an open decision.',
    where: "§1b/§4",
  },
  {
    gap: 'No "away" date or standing deputy on any person. No column records either yet, so both are always blank.',
    where: "§6",
  },
  {
    gap: 'Every person is kind "Person". "Group" and "Vendor" are typed on the wire but no roster table produces either.',
    where: "§6",
  },
  {
    gap: 'The "External" side is offered but nothing populates a real person with it — people here are exactly your own active users plus your MSP\'s staff.',
    where: "§6",
  },
  {
    gap: 'Consulted and Informed are never guessed. An empty C or I means nobody has ever recorded one — not "the MSP" and not "everyone else". They can be placed the same way R/A can (the same write route), but nothing here fills one in for you.',
    where: "§2/§6",
  },
  {
    gap: "No default MSP placement. Your MSP's staff can hold any cell and start on none — there is no template position.",
    where: "§4/§6",
  },
  {
    gap: 'Untracked-but-enabled workloads are omitted from this list entirely by the route itself, so this page cannot show an "untracked" count — that flag is only consulted server-side to decide what to omit.',
    where: "§4",
  },
  {
    gap: "A decline reaches only whoever assigned the cell. Nothing here records a reports-to chain to escalate further (a real, already-filed gap).",
    where: "§6, #2527",
  },
  {
    gap: 'No "promote a coverage gap into a row" flow. That needs a client-side catalog of known-missing object types this app does not carry (contract pack §1b names this as the one place such a fixture would be legitimate) — the real write this page does wire is the design\'s own "Add a row" panel (`source: "custom"`), which renders as a full matrix row with its own RACI cells.',
    where: "§1b",
  },
];

export default function OwnershipPage() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useOwnership();
  const [ledgerOpen, setLedgerOpen] = useState(true);
  const [declineTarget, setDeclineTarget] = useState<DeclineTarget | null>(null);
  const [addRowOpen, setAddRowOpen] = useState(false);
  const assignMutation = useAssignOwnership();

  const tierBlocked = (error as (Error & { code?: string }) | null)?.code === "TIER_UPGRADE_REQUIRED";

  const rows = useMemo<readonly MatrixRow[]>(
    () => (data ? [...buildMatrixRows(data), ...buildCustomRows(data)] : []),
    [data],
  );
  const grouped = useMemo(() => groupByType(rows), [rows]);
  const gaps = useMemo(() => computeGaps(rows), [rows]);
  const mine = useMemo(() => (data ? buildMineEntries(rows, data.currentUserId) : []), [rows, data]);
  const frequency = useMemo(() => {
    const freq = new Map<string, number>();
    for (const row of rows) {
      for (const rk of ["r", "a", "c", "i"] as const) {
        for (const holder of row.cells[rk]) freq.set(holder.personId, (freq.get(holder.personId) ?? 0) + 1);
      }
    }
    return freq;
  }, [rows]);

  const isEmpty = !isLoading && !isError && rows.length === 0;
  const hasRows = !isLoading && !isError && rows.length > 0;

  return (
    <div className="flex flex-col gap-4 pb-14">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground" data-testid="ownership-page-title">
          Who owns what
        </h1>
        <span
          title="Who is Responsible, Accountable, Consulted and Informed for what your MSP monitors — placed by you, never assumed."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="ownership-live-state">
          <span
            className={cn(
              "size-1.5 rounded-full",
              isError ? "bg-status-red" : isLoading ? "bg-muted-foreground" : data?.tenantScoped ? "bg-status-green" : "bg-status-amber",
            )}
          />
          {isLoading
            ? "Reading your matrix"
            : isError
              ? "Could not read your matrix"
              : data?.tenantScoped
                ? `Live — ${rows.length} rows`
                : `Partly served — ${rows.length} rows`}
        </span>
        {!isLoading && !isError && (
          <span className="text-[10.5px] text-muted-foreground">
            {data?.gateMode === "strict" ? "A cell counts once accepted" : "A cell counts as soon as it is placed"}
          </span>
        )}
        {!isLoading && !isError && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 gap-1.5 border-primary/40 text-[11px] text-primary hover:bg-primary/10"
            onClick={() => setAddRowOpen(true)}
            data-testid="ownership-add-row-open"
          >
            <Plus className="size-3" /> Add a row
          </Button>
        )}
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

      {isError && tierBlocked && (
        <div className="flex gap-2.5 rounded-xl border border-dashed border-status-blue/40 bg-status-blue/[.06] p-4">
          <CreditCard className="mt-0.5 size-4 flex-none text-status-blue" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">Not included in your current plan</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              Ownership / RACI is a Monitoring tier feature your active plan does not bundle. This is a plan
              limit, not a failed read.
            </span>
          </div>
        </div>
      )}

      {isError && !tierBlocked && (
        <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-4">
          <AlertTriangle className="mt-0.5 size-4 flex-none text-status-red" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">Your matrix could not be read</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              This is a failed read, not an empty matrix. Any assignments you've already saved are unaffected.
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit p-0 text-[11.5px]"
              onClick={() => void refetch()}
              disabled={isRefetching}
            >
              {isRefetching && <Loader2 className="size-3 animate-spin" />}
              Try again
            </Button>
          </div>
        </div>
      )}

      {isEmpty && data && (
        <>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
            <span className="text-[13.5px] font-semibold text-foreground">Nothing on your matrix yet</span>
            <span className="max-w-[560px] text-xs leading-relaxed text-muted-foreground">
              No workloads, services, Microsoft changes, change requests or hold windows resolved for your
              tenant right now, and no rows have been added by hand.
            </span>
          </div>
          <SourcesCard sources={data.sources} tenantScoped={data.tenantScoped} />
        </>
      )}

      {hasRows && data && (
        <>
          <div className="flex flex-wrap gap-3">
            <Card className="flex-1 min-w-[280px]">
              <CardContent className="flex flex-col gap-2.5 pt-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold tracking-tight tabular-nums text-foreground">{rows.length}</span>
                  <span className="text-xs text-muted-foreground">rows on your matrix</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className={cn(gaps.noAccountable ? "text-status-amber border-status-amber/30" : "text-status-green border-status-green/30")}>
                    {gaps.noAccountable} with no accountable owner
                  </Badge>
                  <Badge variant="outline" className={cn(gaps.noResponsible ? "text-status-amber border-status-amber/30" : "text-status-green border-status-green/30")}>
                    {gaps.noResponsible} with nobody responsible
                  </Badge>
                  <Badge variant="outline" className={cn(gaps.awaitingAcceptance ? "text-status-amber border-status-amber/30" : "text-status-green border-status-green/30")}>
                    {gaps.awaitingAcceptance} awaiting acceptance
                  </Badge>
                </div>
                <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {data.people.filter((p) => p.side !== "MSP").length} of your people ·{" "}
                  {data.people.filter((p) => p.side === "MSP").length} from your MSP can hold a cell
                </span>
              </CardContent>
            </Card>
          </div>

          <MinePlaceCard entries={mine} onDecline={setDeclineTarget} />

          {Array.from(grouped.entries()).map(([type, groupRows]) => (
            <OwnershipMatrixSection
              key={type}
              type={type}
              label={type === "control" ? "Added by hand" : OWN_TYPE_LABEL[type]}
              rows={groupRows}
              people={data.people}
              frequency={frequency}
              assignPending={assignMutation.isPending}
              onAssign={(objectId, roleKey, personId) => assignMutation.mutate({ objectId, roleKey, ownerPersonId: personId })}
            />
          ))}

          <OverlayExtrasCard delegations={data.overlay.delegations} rows={data.overlay.rows} people={data.people} />

          <SourcesCard sources={data.sources} tenantScoped={data.tenantScoped} />
        </>
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

      <AddOwnershipRowDialog open={addRowOpen} onOpenChange={setAddRowOpen} />
      <DeclineOwnershipDialog target={declineTarget} onOpenChange={(open) => !open && setDeclineTarget(null)} />
    </div>
  );
}
