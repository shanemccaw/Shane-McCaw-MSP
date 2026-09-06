import { useMemo } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BypassResolutionCard } from "@/components/remediation-checklist/BypassResolutionCard";
import { ChecklistItemCard } from "@/components/remediation-checklist/ChecklistItemCard";
import { FixRouteLegend } from "@/components/remediation-checklist/FixRouteLegend";
import { RemediationProgrammeTab } from "@/components/remediation-tracker/RemediationProgrammeTab";
import {
  useBypassResolutions,
  useRemediationChecklist,
  useRemediationFixRoutes,
} from "@/lib/remediation-checklist-api";
import type { RemediationFixRoute } from "@/lib/remediation-checklist-types";
import { cn } from "@/lib/utils";

const LEDGER: string[] = [
  "It never sets a checklist item to accepted-as-risk from a plain status change. That value is reachable only through a signed acceptance, and this page's status control cannot select it.",
  "It never releases a tenant-changing script without an approved change request, and a pending request counts as no request.",
  "It never treats a tick as evidence. Verification is a separate, real fact a re-scan confirms — a claim on its own is not proof.",
  "It never invents a checklist item, a fix route, or a bypass correlation. An empty result is shown as an empty result, not a fixture.",
];

/**
 * Remediation Tracking (#1489, Feature #1485) — real Design export
 * (`Design/portal/design_handoff_full_site/screens/Remediation Tracking.dc.html`)
 * wired against `docs/remediation-tracking-contract-pack.md`. Three real
 * functional units, dispatched as separate issues, compose on this one page:
 *
 *   - "28-step programme" (§1a) — #3037's `RemediationProgrammeTab`.
 *   - "Your findings" + "Fixed outside change control" (§1b-1e) — this
 *     build (#3038): the findings-derived checklist, the fix-route
 *     dimension, the CR-gated reveal, and the bypass-resolutions read.
 *   - Pillar scores + CSV/PDF/evidence exports (§1f-1g) — #3039, tracked
 *     separately; that panel lives inside the programme tab per the design
 *     and is #3037/#3039's territory, not duplicated here.
 */
export default function RemediationTrackingPage() {
  const checklist = useRemediationChecklist();
  const fixRoutes = useRemediationFixRoutes();
  const bypass = useBypassResolutions();

  const isLoading = checklist.isLoading || fixRoutes.isLoading;
  const isError = checklist.isError;

  const items = checklist.data?.items ?? [];
  const findingCapabilityByKey = useMemo(() => {
    const map = new Map<string, RemediationFixRoute>();
    for (const i of fixRoutes.data?.items ?? []) map.set(i.checkKey, i.findingCapability ?? i.fixRoute);
    return map;
  }, [fixRoutes.data]);

  const routeCounts = useMemo(() => {
    const counts: Record<RemediationFixRoute, number> = { we_can_run: 0, you_must_run: 0, admin_center_only: 0 };
    for (const i of items) counts[i.fixRoute] += 1;
    return counts;
  }, [items]);

  const bypassItems = bypass.data ?? [];

  const stateLine = isLoading
    ? "Loading"
    : isError
      ? "Could not read your checklist"
      : checklist.data?.runId
        ? "Live"
        : "No scan history";
  const stateDot = isLoading ? "bg-muted-foreground" : isError ? "bg-status-red" : checklist.data?.runId ? "bg-status-green" : "bg-muted-foreground";

  return (
    <div className="flex flex-col gap-4 pb-14" data-testid="remediation-tracking-page">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Remediation tracking</h1>
        <span
          title="Three separate facts per item: what you claim, whether a re-scan agreed, and how it finally resolved. A tick on its own is never evidence."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="remediation-tracking-status">
          <span className={cn("size-1.5 rounded-full", stateDot)} />
          {stateLine}
        </span>
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

      {isError && (
        <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-4">
          <AlertTriangle className="mt-0.5 size-4 flex-none text-status-red" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">Your checklist could not be read</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              This is a failed read, not an empty checklist. Real findings may stand against your
              tenant right now.
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit p-0 text-[11.5px]"
              onClick={() => void checklist.refetch()}
              disabled={checklist.isRefetching}
            >
              {checklist.isRefetching && <Loader2 className="size-3 animate-spin" />}
              Try again
            </Button>
          </div>
        </div>
      )}

      {!isLoading && !isError && (
        <Tabs defaultValue="checklist">
          <TabsList>
            <TabsTrigger value="checklist" data-testid="remediation-tab-checklist">
              Your findings <span className="ml-1.5 text-[10px] text-muted-foreground">{items.length}</span>
            </TabsTrigger>
            <TabsTrigger value="programme" data-testid="remediation-tab-programme">
              28-step programme <span className="ml-1.5 text-[10px] text-muted-foreground">28</span>
            </TabsTrigger>
            <TabsTrigger value="bypass" data-testid="remediation-tab-bypass">
              Fixed outside change control <span className="ml-1.5 text-[10px] text-muted-foreground">{bypassItems.length}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="checklist" className="flex flex-col gap-3.5">
            <FixRouteLegend routeCounts={routeCounts} tenantWriteCeiling={fixRoutes.data?.tenantWriteCeiling ?? null} />

            {items.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[13.5px] font-semibold text-foreground">This scan's findings</span>
                  <span className="text-[11px] text-muted-foreground">{items.length} open findings · critical and warning only</span>
                </div>
                {items.map((item) => (
                  <ChecklistItemCard key={item.checkKey} item={item} findingCapability={findingCapabilityByKey.get(item.checkKey) ?? null} />
                ))}
                <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
                  Every row is a real adverse finding — critical or warning — from your latest scan,
                  keyed by check. Marking one here writes the same claim the 28-step programme reads.
                </span>
              </div>
            ) : (
              <Card data-testid="remediation-checklist-empty">
                <CardContent className="flex flex-col gap-2 pt-6">
                  <span className="text-[13.5px] font-semibold text-foreground">
                    {checklist.data?.runId ? "Nothing adverse on the latest scan" : "No scan has run yet"}
                  </span>
                  <span className="max-w-[600px] text-[11.5px] leading-relaxed text-muted-foreground">
                    {checklist.data?.runId
                      ? "Your latest scan returned no critical or warning findings, so there is nothing to work. This is a real result rather than an empty list waiting to load."
                      : "This list is built from your tenant's own findings, so it stays empty until the first scan completes. Nothing is filled in from a template in the meantime."}
                  </span>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="programme" className="flex flex-col gap-3">
            <RemediationProgrammeTab />
          </TabsContent>

          <TabsContent value="bypass" className="flex flex-col gap-2.5">
            <Card>
              <CardContent className="flex flex-col gap-1.5 pt-6">
                <span className="text-[13.5px] font-semibold text-foreground">Fixed, but outside change control</span>
                <span className="max-w-[720px] text-[11.5px] leading-relaxed text-muted-foreground">
                  Where a re-scan verified a step and the same run also recorded a configuration
                  change with no approved change request behind it. This is an observation, not a
                  finding: nothing here is enforced, scored, or held against you.
                </span>
              </CardContent>
            </Card>

            {bypass.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Reading your correlation
              </div>
            ) : bypassItems.length > 0 ? (
              bypassItems.map((b, i) => <BypassResolutionCard key={`${b.stepId}-${i}`} resolution={b} checklistItems={items} />)
            ) : (
              <Card data-testid="remediation-bypass-empty">
                <CardContent className="flex flex-col gap-2 pt-6">
                  <span className="text-[13.5px] font-semibold text-foreground">Nothing to correlate</span>
                  <span className="max-w-[620px] text-[11.5px] leading-relaxed text-muted-foreground">
                    This is the common case, and it is a real answer rather than a blank panel:
                    either no step is verified yet, no verified step is drift-tracked, or no
                    unapproved change landed in the same run. Nothing is inferred when the join
                    comes back empty.
                  </span>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}

      <Card className="bg-muted/5">
        <CardContent className="flex flex-col gap-2 pt-6">
          <span className="text-[12.5px] font-semibold text-foreground">What this page does not do</span>
          <div className="flex flex-col gap-1.5">
            {LEDGER.map((l, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="mt-1.5 size-[5px] flex-none rounded-full bg-muted-foreground" />
                <span className="text-[11.5px] leading-relaxed text-muted-foreground">{l}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
