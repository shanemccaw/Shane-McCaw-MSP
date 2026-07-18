/**
 * msp-dashboard.tsx
 *
 * Step 4c — MSP-facing real page for the Dashboard / Web Part System.
 * Renders the caller's "msp_overview" dashboard (constrained show/hide/
 * resize/reposition editing only) via the shared <DashboardView>.
 */
import { AppShell } from "@/components/app-shell";
import { DashboardView } from "@/components/dashboard-view/DashboardView";

export default function MspDashboardPage() {
  return (
    <AppShell title="Widget Dashboard">
      <div className="p-6">
        {/* `id` is required by DashboardResolveScope's shape but genuinely unused
            for type "msp": both createDashboardDataFetcher (only reads scope.id
            for type "customer") and the server's /dashboard/resolved + /resolve
            handlers resolve MSP scope purely from req.user.mspId. 0 is a valid
            placeholder, not a missed real value. */}
        <DashboardView scope={{ type: "msp", id: 0 }} title="Widget Dashboard" />
      </div>
    </AppShell>
  );
}
