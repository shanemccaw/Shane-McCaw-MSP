/**
 * customer-dashboard.tsx
 *
 * Step 4c — customer-facing real page for the Dashboard / Web Part System.
 * Renders the caller's "customer_default" dashboard (constrained show/hide/
 * resize/reposition editing only) via the shared <DashboardView>.
 *
 * Added as a new nav item/route alongside the existing customer landing
 * pages (customer-home.tsx, command-center.tsx) rather than replacing either
 * — full customer-facing navigation changes are out of scope for this task.
 */
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { DashboardView } from "@/components/dashboard-view/DashboardView";

export default function CustomerDashboardPage() {
  const { user } = useAuth();

  return (
    <AppShell title="Dashboard">
      <div className="p-6">
        <DashboardView scope={{ type: "customer", id: user?.customerId ?? 0 }} title="Dashboard" />
      </div>
    </AppShell>
  );
}
