import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/toaster";
import LoginPage from "@/pages/Login";
import PortalProjects from "@/pages/portal/PortalProjects";
import PortalProjectDetail from "@/pages/portal/PortalProjectDetail";
import PortalServices from "@/pages/portal/PortalServices";
import PortalBilling from "@/pages/portal/PortalBilling";
import PortalInvoiceDetail from "@/pages/portal/PortalInvoiceDetail";
import PortalContractDetail from "@/pages/portal/PortalContractDetail";
import PortalMessages from "@/pages/portal/PortalMessages";
import PortalActivity from "@/pages/portal/PortalActivity";
import PortalBookMeeting from "@/pages/portal/PortalBookMeeting";
import ClientProjectDashboard from "@/pages/portal/ClientProjectDashboard";
import OnboardingSelect from "@/pages/portal/OnboardingSelect";
import OnboardingContract from "@/pages/portal/OnboardingContract";
import OnboardingSuccess from "@/pages/portal/OnboardingSuccess";
import ResetPasswordPage from "@/pages/ResetPassword";
import type { ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function RequireAuth({ children, role }: { children: ReactNode; role?: "admin" | "client" }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <Redirect to="/" />;
  if (role && user.role !== role) {
    if (user.role === "admin") { window.location.href = "/admin-panel/"; return null; }
    return <Redirect to="/portal" />;
  }
  return <>{children}</>;
}

function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/">
        {user ? (
          user.role === "admin"
            ? (() => { window.location.href = "/admin-panel/"; return null; })()
            : <Redirect to="/portal" />
        ) : <LoginPage />}
      </Route>

      {/* Admin dashboard moved to /admin-panel — redirect any direct hits */}
      <Route path="/dashboard">
        {() => { window.location.replace("/admin-panel/"); return null; }}
      </Route>

      {/* Client portal routes */}
      <Route path="/portal">
        <RequireAuth role="client"><ClientProjectDashboard /></RequireAuth>
      </Route>
      <Route path="/portal/projects">
        <RequireAuth role="client"><PortalProjects /></RequireAuth>
      </Route>
      <Route path="/portal/projects/:id">
        <RequireAuth role="client"><PortalProjectDetail /></RequireAuth>
      </Route>
      <Route path="/portal/services">
        <RequireAuth role="client"><PortalServices /></RequireAuth>
      </Route>
      <Route path="/portal/billing">
        <RequireAuth role="client"><PortalBilling /></RequireAuth>
      </Route>
      <Route path="/portal/billing/invoices/:id">
        <RequireAuth role="client"><PortalInvoiceDetail /></RequireAuth>
      </Route>
      <Route path="/portal/billing/contracts/:id">
        <RequireAuth role="client"><PortalContractDetail /></RequireAuth>
      </Route>
      <Route path="/portal/messages">
        <RequireAuth role="client"><PortalMessages /></RequireAuth>
      </Route>
      <Route path="/portal/activity">
        <RequireAuth role="client"><PortalActivity /></RequireAuth>
      </Route>
      <Route path="/portal/book-meeting">
        <RequireAuth role="client"><PortalBookMeeting /></RequireAuth>
      </Route>

      {/* Public reset-password route — token validated server-side */}
      <Route path="/reset-password">
        <ResetPasswordPage />
      </Route>

      {/* Onboarding routes — accessible to anyone (redirect to login inside if not authed) */}
      <Route path="/portal/onboarding/select">
        <OnboardingSelect />
      </Route>
      <Route path="/portal/onboarding/contract">
        <OnboardingContract />
      </Route>
      <Route path="/portal/onboarding/success">
        <RequireAuth role="client"><OnboardingSuccess /></RequireAuth>
      </Route>

      <Route>
        <Redirect to="/" />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
