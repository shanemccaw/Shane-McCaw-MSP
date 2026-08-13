/**
 * Break-Glass Run Status — /break-glass/:runId
 *
 * Hosts the pending-action surface for a specific workflow run. Note: this repo
 * has no existing customer/MSP-facing "wf_runs single-run detail" view to embed
 * BreakGlassPendingActionCard into (the two closest analogs — /runs/:runId and
 * project-kanban.tsx — are wired to a different run engine / don't persist a
 * runId respectively), so this is a small dedicated page. The card itself is a
 * standalone, reusable component and can be dropped into a future run-detail
 * view once one exists for this engine.
 */

import { useParams } from "wouter";
import { AppShell } from "@/components/app-shell";
import { BreakGlassPendingActionCard } from "@/components/BreakGlassPendingActionCard";
import { Card, CardContent } from "@/components/ui/card";

export default function BreakGlassStatusPage() {
  const { runId } = useParams<{ runId: string }>();
  const parsedRunId = Number(runId);
  const isValid = Number.isFinite(parsedRunId);

  return (
    <AppShell title="Automation Status">
      <div className="p-6 max-w-2xl space-y-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-bold tracking-tight">Automation Status</h1>
          <p className="text-sm text-muted-foreground">
            Run #{isValid ? parsedRunId : runId}
          </p>
        </div>

        {isValid ? (
          <BreakGlassPendingActionCard runId={parsedRunId} />
        ) : (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Invalid run reference.
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
