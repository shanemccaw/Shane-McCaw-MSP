import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { SessionExpiryModal } from "@/components/session-expiry-modal";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import CustomersPage from "@/pages/customers";
import CustomerDetailPage from "@/pages/customer-detail";
import MspsPage from "@/pages/msps";
import SettingsPage from "@/pages/settings";
import SettingsOrgProfilePage from "@/pages/settings-org-profile";
import SettingsConnectorPage from "@/pages/settings-connector";
import SettingsServiceAccountsPage from "@/pages/settings-service-accounts";
import SettingsTeamPage from "@/pages/settings-team";
import SettingsBillingPage from "@/pages/settings-billing";
import SettingsEmailTemplatesPage from "@/pages/settings-email-templates";
import SettingsSessionsPage from "@/pages/settings-sessions";
import EventsPage from "@/pages/events";
import AuditPage from "@/pages/audit";
import OffboardingPage from "@/pages/offboarding";
import WebhooksPage from "@/pages/webhooks";
import InitiateOnboardingPage from "@/pages/initiate-onboarding";
import AcceptAgreementPage from "@/pages/accept-agreement";
import TrustPage from "@/pages/trust";
import CustomerHomePage from "@/pages/customer-home";
import CustomerDocumentsPage from "@/pages/customer-documents";
import CustomerDiagnosticsPage from "@/pages/customer-diagnostics";
import CustomerSowPage from "@/pages/customer-sow";
import SignupPage from "@/pages/signup";
import SignupSuccessPage from "@/pages/signup-success";
import OperatorTasksPage from "@/pages/operator-tasks";
import DlqPage from "@/pages/dlq";
import RunsPage from "@/pages/runs";
import RunDetailPage from "@/pages/run-detail";
import CustomerSlaPage from "@/pages/customer-sla";
import CustomerScopePage from "@/pages/customer-scope";
import SlaDashboardPage from "@/pages/sla-dashboard";
import ScopeCreepDashboardPage from "@/pages/scope-creep-dashboard";
import ScriptLibraryPage from "@/pages/scripts";
import AiBillingPage from "@/pages/ai-billing";
import NotFound from "@/pages/not-found";
import ActivityFeedPage from "@/pages/activity-feed";
import { Loader2 } from "lucide-react";
import { useState, useEffect } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

// ── Agreement gate ────────────────────────────────────────────────────────────
// After authentication, check whether the user has accepted the current
// platform agreement. PlatformAdmin users that have MFA enrolled will
// already be challenged at login; all MSP users are gated here.

function useAgreementGate(): { loading: boolean; required: boolean } {
  const { user, fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setRequired(false);
      return;
    }
    // Only gate users that have an MSP role (not plain client/admin portal users)
    if (!user.mspRole) {
      setLoading(false);
      setRequired(false);
      return;
    }
    fetchWithAuth("/api/platform/agreement/acceptance-status")
      .then((r) => r.json())
      .then((data: { required?: boolean; accepted?: boolean }) => {
        setRequired(!!(data.required && !data.accepted));
      })
      .catch(() => {
        // Don't block on network failure — fail open
        setRequired(false);
      })
      .finally(() => setLoading(false));
  }, [user, fetchWithAuth]);

  return { loading, required };
}

// ── Protected route with agreement gate ───────────────────────────────────────

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  const { loading: agreementLoading, required: agreementRequired } = useAgreementGate();

  if (isLoading || agreementLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (agreementRequired) {
    return <Redirect to="/accept-agreement" />;
  }

  return <Component />;
}

function Router() {
  const { user, isLoading } = useAuth();

  // Determine the default landing page based on role
  const defaultLanding =
    !isLoading && user?.mspRole === "CustomerUser" ? "/customer-home" : "/dashboard";

  return (
    <Switch>
      {/* Public routes */}
      <Route path="/login">
        {!isLoading && user ? <Redirect to={defaultLanding} /> : <LoginPage />}
      </Route>
      <Route path="/signup/success">
        <SignupSuccessPage />
      </Route>
      <Route path="/signup">
        {!isLoading && user ? <Redirect to="/dashboard" /> : <SignupPage />}
      </Route>
      <Route path="/trust">
        <TrustPage />
      </Route>

      {/* Auth-required but no agreement gate (the gate page itself) */}
      <Route path="/accept-agreement">
        <AcceptAgreementPage />
      </Route>

      {/* MSP-facing pages */}
      <Route path="/dashboard">
        <ProtectedRoute component={DashboardPage} />
      </Route>
      <Route path="/customers/:id">
        <ProtectedRoute component={CustomerDetailPage} />
      </Route>
      <Route path="/customers">
        <ProtectedRoute component={CustomersPage} />
      </Route>
      <Route path="/msps">
        <ProtectedRoute component={MspsPage} />
      </Route>
      <Route path="/events">
        <ProtectedRoute component={EventsPage} />
      </Route>
      <Route path="/audit">
        <ProtectedRoute component={AuditPage} />
      </Route>
      <Route path="/settings/profile">
        <ProtectedRoute component={SettingsOrgProfilePage} />
      </Route>
      <Route path="/settings/connector">
        <ProtectedRoute component={SettingsConnectorPage} />
      </Route>
      <Route path="/settings/service-accounts">
        <ProtectedRoute component={SettingsServiceAccountsPage} />
      </Route>
      <Route path="/settings/team">
        <ProtectedRoute component={SettingsTeamPage} />
      </Route>
      <Route path="/settings/billing">
        <ProtectedRoute component={SettingsBillingPage} />
      </Route>
      <Route path="/settings/email-templates">
        <ProtectedRoute component={SettingsEmailTemplatesPage} />
      </Route>
      <Route path="/settings/sessions">
        <ProtectedRoute component={SettingsSessionsPage} />
      </Route>
      <Route path="/settings">
        <ProtectedRoute component={SettingsPage} />
      </Route>
      <Route path="/offboarding">
        <ProtectedRoute component={OffboardingPage} />
      </Route>
      <Route path="/webhooks">
        <ProtectedRoute component={WebhooksPage} />
      </Route>
      <Route path="/initiate-onboarding">
        <ProtectedRoute component={InitiateOnboardingPage} />
      </Route>
      <Route path="/sla">
        <ProtectedRoute component={SlaDashboardPage} />
      </Route>
      <Route path="/activity">
        <ProtectedRoute component={ActivityFeedPage} />
      </Route>
      <Route path="/scripts">
        <ProtectedRoute component={ScriptLibraryPage} />
      </Route>
      <Route path="/scope-creep">
        <ProtectedRoute component={ScopeCreepDashboardPage} />
      </Route>
      <Route path="/operator-tasks">
        <ProtectedRoute component={OperatorTasksPage} />
      </Route>
      <Route path="/dlq">
        <ProtectedRoute component={DlqPage} />
      </Route>
      <Route path="/runs/:runId">
        <ProtectedRoute component={RunDetailPage} />
      </Route>
      <Route path="/runs">
        <ProtectedRoute component={RunsPage} />
      </Route>

      {/* Customer-facing pages */}
      <Route path="/customer-home">
        <ProtectedRoute component={CustomerHomePage} />
      </Route>
      <Route path="/customer-documents">
        <ProtectedRoute component={CustomerDocumentsPage} />
      </Route>
      <Route path="/customer-diagnostics">
        <ProtectedRoute component={CustomerDiagnosticsPage} />
      </Route>
      <Route path="/customer-sow/:id">
        <ProtectedRoute component={CustomerSowPage} />
      </Route>
      <Route path="/customer-sla">
        <ProtectedRoute component={CustomerSlaPage} />
      </Route>
      <Route path="/customer-scope">
        <ProtectedRoute component={CustomerScopePage} />
      </Route>

      {/* AI Billing */}
      <Route path="/ai-billing">
        <ProtectedRoute component={AiBillingPage} />
      </Route>

      {/* Root redirect — role-aware */}
      <Route path="/">
        {isLoading ? (
          <div className="min-h-screen flex items-center justify-center bg-background">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Redirect to={defaultLanding} />
        )}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function AppInner() {
  return (
    <>
      <Router />
      <SessionExpiryModal />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AppInner />
          </WouterRouter>
          <Toaster richColors position="top-right" theme="dark" />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
