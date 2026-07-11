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
import EventsPage from "@/pages/events";
import AuditPage from "@/pages/audit";
import OffboardingPage from "@/pages/offboarding";
import WebhooksPage from "@/pages/webhooks";
import InitiateOnboardingPage from "@/pages/initiate-onboarding";
import AcceptAgreementPage from "@/pages/accept-agreement";
import TrustPage from "@/pages/trust";
import NotFound from "@/pages/not-found";
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

  return (
    <Switch>
      {/* Public routes */}
      <Route path="/login">
        {!isLoading && user ? <Redirect to="/dashboard" /> : <LoginPage />}
      </Route>
      <Route path="/trust">
        <TrustPage />
      </Route>

      {/* Auth-required but no agreement gate (the gate page itself) */}
      <Route path="/accept-agreement">
        <AcceptAgreementPage />
      </Route>

      {/* Protected routes */}
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

      <Route path="/">
        <Redirect to="/dashboard" />
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
