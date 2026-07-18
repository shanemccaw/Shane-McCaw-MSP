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
        <DashboardView scope={{ type: "msp", id: 0 }} title="Widget Dashboard" />
      </div>
    </AppShell>
  );
}
