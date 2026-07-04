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
import QuickWinOnboardingResults from "@/pages/portal/QuickWinOnboardingResults";
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
import PortalDiagnostic from "@/pages/portal/PortalDiagnostic";
import SharedResultsPage from "@/pages/SharedResultsPage";
import ResetPasswordPage from "@/pages/ResetPassword";
import DiagnosticSimPreview from "@/pages/DiagnosticSimPreview";
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

interface EngagementStatus {
  needsOnboarding: boolean;
  hasActiveEngagement: boolean;
  hasCredentials: boolean;
  wizardResultsReady: boolean;
}

// RequireEngagement: the main portal gate.
// - If client has an active engagement → render full portal (children)
// - If no engagement + results ready → redirect to /portal/onboarding/results
// - If no engagement + no results → redirect to /portal/onboarding/wizard
// Re-checks on every navigation so the gate lifts immediately after payment.
function RequireEngagement({ children }: { children: ReactNode }) {
  const { user, fetchWithAuth } = useAuth();
  const [location] = useLocation();
  const [status, setStatus] = useState<EngagementStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const fetchingRef = useRef(false);

  useEffect(() => {
    if (!user || user.role !== "client") return;
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setChecked(false);

    fetchWithAuth("/api/portal/onboarding/wizard-status")
      .then(r => {
        if (!r.ok) {
          // Non-OK response → fail-closed: treat as no active engagement
          setStatus({ needsOnboarding: true, hasActiveEngagement: false, hasCredentials: false, wizardResultsReady: false });
          return;
        }
        return r.json().then((data: EngagementStatus) => setStatus(data));
      })
      .catch(() => {
        // Network/parse error → fail-closed: redirect to wizard so client isn't silently unblocked
        setStatus({ needsOnboarding: true, hasActiveEngagement: false, hasCredentials: false, wizardResultsReady: false });
      })
      .finally(() => {
        setChecked(true);
        fetchingRef.current = false;
      });
  // Re-run when location changes so the gate re-evaluates after Stripe redirect etc.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, location]);

  if (!user || user.role !== "client") return <>{children}</>;

  if (!checked) {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Gate lifted — full portal accessible
  if (status?.hasActiveEngagement) return <>{children}</>;

  // Results ready (scan done + no active quick_win project) → show results
  if (status?.wizardResultsReady) {
    return <Redirect to="/portal/onboarding/results" />;
  }

  // Wizard not yet completed → send to wizard
  if (status?.needsOnboarding) {
    return <Redirect to="/portal/onboarding/wizard" />;
  }

  // Wizard done but Quick Win project still in progress → stay on diagnostic page
  return <Redirect to="/portal/diagnostic" />;
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

      {/* Public shared diagnostic results — no auth required */}
      <Route path="/shared-results/:token">
        {(params) => <SharedResultsPage />}
      </Route>

      {/* Wizard — inside RequireAuth but NOT RequireEngagement to avoid redirect loop */}
      <Route path="/portal/onboarding/wizard">
        <RequireAuth role="client"><OnboardingWizard /></RequireAuth>
      </Route>

      {/* Quick Win Results — inside RequireAuth but NOT RequireEngagement to avoid redirect loop */}
      <Route path="/portal/onboarding/results">
        <RequireAuth role="client"><QuickWinOnboardingResults /></RequireAuth>
      </Route>

      {/* Re-run wizard from Profile page — update mode for Automation Setup credentials */}
      <Route path="/portal/m365-wizard">
        <RequireAuth role="client"><RequireEngagement><OnboardingWizard mode="update" /></RequireEngagement></RequireAuth>
      </Route>

      {/* Client portal routes — gated behind RequireEngagement */}
      <Route path="/portal">
        <RequireAuth role="client"><RequireEngagement><ClientProjectDashboard /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/projects">
        <RequireAuth role="client"><RequireEngagement><PortalProjects /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/projects/:id">
        <RequireAuth role="client"><RequireEngagement><PortalProjectDetail /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/services">
        <RequireAuth role="client"><RequireEngagement><PortalServices /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/billing">
        <RequireAuth role="client"><RequireEngagement><PortalBilling /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/billing/invoices/:id">
        <RequireAuth role="client"><RequireEngagement><PortalInvoiceDetail /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/billing/contracts/:id">
        <RequireAuth role="client"><RequireEngagement><PortalContractDetail /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/messages">
        <RequireAuth role="client"><RequireEngagement><PortalMessages /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/activity">
        <RequireAuth role="client"><RequireEngagement><PortalActivity /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/book-meeting">
        <RequireAuth role="client"><RequireEngagement><PortalBookMeeting /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/profile">
        <RequireAuth role="client"><RequireEngagement><PortalProfile /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/archive">
        <RequireAuth role="client"><RequireEngagement><PortalArchive /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/m365-profile">
        <RequireAuth role="client"><RequireEngagement><PortalM365Profile /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/automation-setup">
        <RequireAuth role="client"><PortalAppRegistration /></RequireAuth>
      </Route>
      <Route path="/portal/security">
        <RequireAuth role="client"><RequireEngagement><PortalSecurity /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/insights">
        <RequireAuth role="client"><RequireEngagement><PortalInsights /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/journey">
        <RequireAuth role="client"><RequireEngagement><PortalJourneyMap /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/health">
        <RequireAuth role="client"><RequireEngagement><PortalHealthScore /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/quick-wins">
        <RequireAuth role="client"><RequireEngagement><QuickWinResultsPage /></RequireEngagement></RequireAuth>
      </Route>
      <Route path="/portal/diagnostic/:projectId">
        <RequireAuth role="client"><PortalDiagnostic /></RequireAuth>
      </Route>
      <Route path="/portal/diagnostic">
        <RequireAuth role="client"><PortalDiagnostic /></RequireAuth>
      </Route>
      <Route path="/portal/presentation/:id">
        <PortalPresentation />
      </Route>

      {/* Public reset-password route — token validated server-side */}
      <Route path="/reset-password">
        <ResetPasswordPage />
      </Route>

      {/* Diagnostic simulation preview — forces the animated overlay without needing a real project */}
      <Route path="/portal/diagnostic-sim">
        <DiagnosticSimPreview />
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
