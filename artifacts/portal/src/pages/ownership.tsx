import { useMemo, useState } from "react";
import { AlertTriangle, CreditCard, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MinePlaceCard } from "@/components/ownership/MinePlaceCard";
import { OverlayExtrasCard } from "@/components/ownership/OverlayExtrasCard";
import { OwnershipMatrixSection } from "@/components/ownership/OwnershipMatrixSection";
import { SourcesCard } from "@/components/ownership/SourcesCard";
import { useOwnership } from "@/lib/ownership-api";
import { buildMatrixRows, buildMineEntries, computeGaps, groupByType } from "@/lib/ownership-matrix";
import { cn } from "@/lib/utils";

const LEDGER: { gap: string; where: string }[] = [
  {
    gap: "No assign/reorder/accept/decline/delegate/add-row actions yet. This build wires only the read surface (GET /api/portal/ownership); the five real write routes wire in #3041.",
    where: "§1a/§1b",
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
    gap: "Consulted and Informed are never guessed. An empty C or I means nobody has ever recorded one — not \"the MSP\" and not \"everyone else\".",
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
    gap: 'A row added by hand under "promoted from a coverage gap" carries no name or sub-line from this table — that descriptive text lives only in a client-side fixture this app does not carry.',
    where: "§6",
  },
];

export default function OwnershipPage() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useOwnership();
  const [ledgerOpen, setLedgerOpen] = useState(true);

  const tierBlocked = (error as (Error & { code?: string }) | null)?.code === "TIER_UPGRADE_REQUIRED";

  const rows = useMemo(() => (data ? buildMatrixRows(data) : []), [data]);
  const grouped = useMemo(() => groupByType(rows), [rows]);
  const gaps = useMemo(() => computeGaps(rows), [rows]);
  const mine = useMemo(() => (data ? buildMineEntries(rows, data.currentUserId) : []), [rows, data]);

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
              tenant right now.
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

          <MinePlaceCard entries={mine} />

          {Array.from(grouped.entries()).map(([type, groupRows]) => (
            <OwnershipMatrixSection key={type} type={type} rows={groupRows} people={data.people} />
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
    </div>
  );
}
