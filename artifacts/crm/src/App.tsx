import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { QuickWinModeProvider } from "@/context/QuickWinModeContext";
import { useQuickWinRealImpl } from "@/hooks/useQuickWinRealImpl";
import FullScreenWrapper from "@/components/quickwin/FullScreenWrapper";
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
import OnboardingWizard from "@/pages/portal/OnboardingWizard";
import PortalProfile from "@/pages/portal/PortalProfile";
import PortalArchive from "@/pages/portal/PortalArchive";
import PortalM365Profile from "@/pages/portal/PortalM365Profile";
import PortalAppRegistration from "@/pages/portal/PortalAppRegistration";
import PortalSecurity from "@/pages/portal/PortalSecurity";
import PortalInsights from "@/pages/portal/PortalInsights";
import PortalJourneyMap from "@/pages/portal/PortalJourneyMap";
import PortalHealthScore from "@/pages/portal/PortalHealthScore";
import QuickWinResultsPage from "@/pages/QuickWinResultsPage";
import PortalPresentation from "@/pages/portal/PortalPresentation";
import ResetPasswordPage from "@/pages/ResetPassword";
import { useState, useEffect, useRef, type ReactNode } from "react";

// Bridge: sits inside AuthProvider so it can read the auth context and inject
// real runAutoStep / escalateToProject implementations into QuickWinModeProvider.
function QuickWinBridge({ children }: { children: ReactNode }) {
  const { runAutoStep, escalateToProject } = useQuickWinRealImpl();
  return (
    <QuickWinModeProvider runAutoStep={runAutoStep} escalateToProject={escalateToProject}>
      {children}
    </QuickWinModeProvider>
  );
}

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

function RequireOnboarding({ children }: { children: ReactNode }) {
  const { user, fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [checked, setChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!user || user.role !== "client" || fetchedRef.current) return;
    fetchedRef.current = true;
    fetchWithAuth("/api/portal/onboarding/wizard-status")
      .then(r => r.ok ? r.json() as Promise<{ needsOnboarding: boolean }> : { needsOnboarding: false })
      .then(data => {
        setNeedsOnboarding(data.needsOnboarding);
        setChecked(true);
      })
      .catch(() => setChecked(true));
  }, [user, fetchWithAuth]);

  if (!user || user.role !== "client") return <>{children}</>;

  if (!checked) {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (needsOnboarding) {
    navigate("/portal/onboarding/wizard");
    return null;
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

      {/* Wizard — inside RequireAuth but NOT RequireOnboarding to avoid redirect loop */}
      <Route path="/portal/onboarding/wizard">
        <RequireAuth role="client"><OnboardingWizard /></RequireAuth>
      </Route>

      {/* Re-run wizard from Profile page — update mode for Automation Setup credentials */}
      <Route path="/portal/m365-wizard">
        <RequireAuth role="client"><RequireOnboarding><OnboardingWizard mode="update" /></RequireOnboarding></RequireAuth>
      </Route>

      {/* Client portal routes — gated behind RequireOnboarding */}
      <Route path="/portal">
        <RequireAuth role="client"><RequireOnboarding><ClientProjectDashboard /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/projects">
        <RequireAuth role="client"><RequireOnboarding><PortalProjects /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/projects/:id">
        <RequireAuth role="client"><RequireOnboarding><PortalProjectDetail /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/services">
        <RequireAuth role="client"><RequireOnboarding><PortalServices /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/billing">
        <RequireAuth role="client"><RequireOnboarding><PortalBilling /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/billing/invoices/:id">
        <RequireAuth role="client"><RequireOnboarding><PortalInvoiceDetail /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/billing/contracts/:id">
        <RequireAuth role="client"><RequireOnboarding><PortalContractDetail /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/messages">
        <RequireAuth role="client"><RequireOnboarding><PortalMessages /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/activity">
        <RequireAuth role="client"><RequireOnboarding><PortalActivity /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/book-meeting">
        <RequireAuth role="client"><RequireOnboarding><PortalBookMeeting /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/profile">
        <RequireAuth role="client"><RequireOnboarding><PortalProfile /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/archive">
        <RequireAuth role="client"><RequireOnboarding><PortalArchive /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/m365-profile">
        <RequireAuth role="client"><RequireOnboarding><PortalM365Profile /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/automation-setup">
        <RequireAuth role="client"><RequireOnboarding><PortalAppRegistration /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/security">
        <RequireAuth role="client"><RequireOnboarding><PortalSecurity /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/insights">
        <RequireAuth role="client"><RequireOnboarding><PortalInsights /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/journey">
        <RequireAuth role="client"><RequireOnboarding><PortalJourneyMap /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/health">
        <RequireAuth role="client"><RequireOnboarding><PortalHealthScore /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/quick-wins">
        <RequireAuth role="client"><RequireOnboarding><QuickWinResultsPage /></RequireOnboarding></RequireAuth>
      </Route>
      <Route path="/portal/presentation/:id">
        <PortalPresentation />
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
        <OnboardingSuccess />
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
        <QuickWinBridge>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
            <FullScreenWrapper />
          </WouterRouter>
          <Toaster />
        </QuickWinBridge>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
