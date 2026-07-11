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
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return <Component />;
}

function Router() {
  const { user, isLoading } = useAuth();

  return (
    <Switch>
      <Route path="/login">
        {!isLoading && user ? <Redirect to="/dashboard" /> : <LoginPage />}
      </Route>
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
