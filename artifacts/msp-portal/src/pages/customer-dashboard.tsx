/**
 * customer-dashboard.tsx
 *
 * Step 4c — customer-facing real page for the Dashboard / Web Part System.
 * Renders the caller's applicable dashboard(s) (constrained show/hide/
 * resize/reposition editing only) via the shared <DashboardTabs>. A customer
 * with only "customer_default" (no monitoring package assigned, the common
 * case) sees no tab strip — <DashboardTabs> falls back to plain
 * <DashboardView> rendering when there's nothing to switch between.
 *
 * Added as a new nav item/route alongside the existing customer landing
 * pages (customer-home.tsx, command-center.tsx) rather than replacing either
 * — full customer-facing navigation changes are out of scope for this task.
 */
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { DashboardTabs } from "@/components/dashboard-view/DashboardView";
import { MissionControl } from "@/components/mission-control/MissionControl";
import { CustomerDashboardExtras, NeedHelpCard, WelcomeHeader } from "@/components/mission-control/CustomerDashboardExtras";

export default function CustomerDashboardPage() {
  const { user } = useAuth();

  return (
    <AppShell title="Dashboard">
      <div className="p-6 space-y-6">
        {/* Page-level Mission Control content (hero / engine strip / findings
            feed) — sits above the resolved dashboard(s); only customers with a
            customer identity get it (MSP staff visiting this route don't).
            CustomerDashboardExtras carries the real content relocated from the
            old customer-home.tsx landing page (promo banner, recent reports). */}
        {user?.customerId != null && (
          <>
            <WelcomeHeader />
            <MissionControl />
            <CustomerDashboardExtras />
          </>
        )}
        <DashboardTabs scope={{ type: "customer", id: user?.customerId ?? 0 }} title="Dashboard" />
        {/* Need-help card sits at the very bottom of the page, below the
            resolved dashboard canvas. */}
        {user?.customerId != null && <NeedHelpCard />}
      </div>
    </AppShell>
  );
}
