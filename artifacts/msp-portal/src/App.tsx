import { Switch, Route, Router as WouterRouter, Redirect, useLocation, useParams } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { SlugProvider, getStoredSlug } from "@/lib/slug-context";
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
import SettingsCustomDomainPage from "@/pages/settings-custom-domain";
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
import MspCustomerSowPage from "@/pages/msp-customer-sow";
import MspSowPublicPage from "@/pages/msp-sow-public";
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
import ReportsPage from "@/pages/reports";
import SalesBundlesPage from "@/pages/sales-bundles";
import OffersPage from "@/pages/offers";
import CustomerOffersPage from "@/pages/customer-offers";
import NotFound from "@/pages/not-found";
import ActivityFeedPage from "@/pages/activity-feed";
import SupportChatPage from "@/pages/support-chat";
import ProjectKanbanPage from "@/pages/project-kanban";
import { Loader2, ShieldCheck } from "lucide-react";
import { useState, useEffect } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

/** Vite base path, e.g. "/portal" */
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Tenant slug entry point ────────────────────────────────────────────────────
// Handles /{tenantSlug} URLs inside the outer router.
// Validates the slug via the API, then redirects to /{slug}/login.
// Falls back to NotFound if the slug does not correspond to any MSP.

function TenantEntryPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const [state, setState] = useState<"loading" | "redirect" | "notfound">("loading");

  useEffect(() => {
    if (!slug) { setState("notfound"); return; }
    fetch(`/api/portal/tenant/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (!r.ok) { setState("notfound"); return; }
        // Tenant exists — redirect to the slug-scoped login page.
        // In the outer router (base=/portal), "/{slug}/login" becomes /portal/{slug}/login.
        navigate(`/${slug}/login`, { replace: true });
        setState("redirect");
      })
      .catch(() => setState("notfound"));
  }, [slug, navigate]);

  if (state === "notfound") return <NotFound />;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

// ── Agreement gate ────────────────────────────────────────────────────────────

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
        setRequired(false);
      })
      .finally(() => setLoading(false));
  }, [user, fetchWithAuth]);

  return { loading, required };
}

// ── Protected route with agreement gate ───────────────────────────────────────
// Redirects to /login and /accept-agreement — both are valid relative paths
// inside the slug-scoped inner router, so they resolve correctly to
// /portal/{slug}/login and /portal/{slug}/accept-agreement automatically.

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

// ── Slug-scoped inner switch ───────────────────────────────────────────────────
// Rendered inside a WouterRouter whose base is /portal/{slug}.
// Every navigate() and <Link> in this subtree automatically resolves relative
// to /portal/{slug}, so no page needs to know the slug explicitly.

function SlugInnerSwitch() {
  const { user, isLoading } = useAuth();

  const defaultLanding =
    !isLoading && user?.mspRole === "CustomerUser" ? "/customer-home" : "/dashboard";

  return (
    <Switch>
      {/* Public slug-scoped routes */}
      <Route path="/login">
        {!isLoading && user ? <Redirect to={defaultLanding} /> : <LoginPage />}
      </Route>

      {/* Agreement gate page — auth-required but not gated itself */}
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
      <Route path="/settings/custom-domain">
        <ProtectedRoute component={SettingsCustomDomainPage} />
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
      <Route path="/msp-sow/:sowId">
        <ProtectedRoute component={MspCustomerSowPage} />
      </Route>
      <Route path="/customer-sla">
        <ProtectedRoute component={CustomerSlaPage} />
      </Route>
      <Route path="/customer-scope">
        <ProtectedRoute component={CustomerScopePage} />
      </Route>
      <Route path="/support">
        <ProtectedRoute component={SupportChatPage} />
      </Route>
      <Route path="/project-kanban/:id">
        <ProtectedRoute component={ProjectKanbanPage} />
      </Route>

      {/* Reports */}
      <Route path="/reports">
        <ProtectedRoute component={ReportsPage} />
      </Route>

      {/* AI Billing */}
      <Route path="/ai-billing">
        <ProtectedRoute component={AiBillingPage} />
      </Route>

      {/* Sales Bundles */}
      <Route path="/sales-bundles">
        <ProtectedRoute component={SalesBundlesPage} />
      </Route>

      {/* Offer Pipeline — MSP-facing */}
      <Route path="/offers">
        <ProtectedRoute component={OffersPage} />
      </Route>

      {/* Customer Offers — customer-facing */}
      <Route path="/customer-offers">
        <ProtectedRoute component={CustomerOffersPage} />
      </Route>

      {/* Slug root — role-aware landing */}
      <Route path="/">
        {isLoading ? (
          <div className="min-h-screen flex items-center justify-center bg-background">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : user ? (
          <Redirect to={defaultLanding} />
        ) : (
          <Redirect to="/login" />
        )}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

// ── Slug scope wrapper ─────────────────────────────────────────────────────────
// Extracts the slug param from the outer route and creates a new WouterRouter
// whose base is /portal/{slug}. All links, redirects, and navigate() calls
// inside this subtree automatically resolve to slug-prefixed URLs.

function SlugScope() {
  const { slug } = useParams<{ slug: string }>();

  if (!slug) return <NotFound />;

  return (
    <SlugProvider slug={slug}>
      <WouterRouter base={`${BASE_PATH}/${slug}`}>
        <SlugInnerSwitch />
      </WouterRouter>
    </SlugProvider>
  );
}

// ── Root redirect ─────────────────────────────────────────────────────────────
// Handles /portal/ with no slug. If a slug was used previously in this session,
// redirect to the slug-scoped URL; otherwise show the flat login.

function RootRedirect() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    const stored = getStoredSlug();
    if (stored) {
      // User has a known slug — go to the slug-scoped landing.
      // If already authenticated, the inner router's /login route will
      // immediately redirect to /dashboard or /customer-home.
      navigate(`/${stored}/login`, { replace: true });
    } else {
      navigate("/login", { replace: true });
    }
  }, [isLoading, navigate, user]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

// ── Flat logged-in redirect ───────────────────────────────────────────────────
// Used in the flat /login route when the user is already authenticated but
// there is no slug in the URL.
//
// If a slug is stored in sessionStorage, redirect to the slug-scoped landing.
// If no slug is known at all, render a stable "you're signed in" screen
// instead of navigating — this prevents a /login ↔ / redirect loop.

function FlatLoggedInRedirect() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const storedSlug = getStoredSlug();

  useEffect(() => {
    if (storedSlug) {
      const landing = user?.mspRole === "CustomerUser" ? "customer-home" : "dashboard";
      navigate(`/${storedSlug}/${landing}`, { replace: true });
    }
    // No slug known — stay on this component; do NOT navigate to "/" (would loop)
  }, [storedSlug, user, navigate]);

  // While redirect is pending (storedSlug exists), show spinner
  if (storedSlug) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No slug known — stable fallback: prompt the user to navigate to their portal URL
  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm text-center text-sidebar-foreground space-y-4">
        <ShieldCheck className="mx-auto size-10 text-sidebar-primary" />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">You're signed in</h1>
          <p className="text-sm text-sidebar-foreground/60 mt-1">
            Please navigate to your organisation's portal URL to continue.
          </p>
          <p className="text-xs text-sidebar-foreground/40 mt-2 font-mono">
            /portal/your-org-slug
          </p>
        </div>
        <button
          className="text-sm text-sidebar-foreground/50 hover:text-sidebar-foreground underline"
          onClick={() => void logout()}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

// ── Outer router ──────────────────────────────────────────────────────────────
// Flat routes (no slug) live here. Everything under a slug goes through SlugScope.

function Router() {
  const { user, isLoading } = useAuth();

  return (
    <Switch>
      {/* Flat public routes — must come before /:slug to avoid slug conflicts */}
      <Route path="/login">
        {/* If user is already authenticated but no slug in the URL, send them
            to the slug-scoped landing. Otherwise render the unbranded login. */}
        {!isLoading && user ? <FlatLoggedInRedirect /> : <LoginPage />}
      </Route>
      <Route path="/signup/success">
        <SignupSuccessPage />
      </Route>
      <Route path="/signup">
        <SignupPage />
      </Route>
      <Route path="/trust">
        <TrustPage />
      </Route>

      {/* Public MSP SOW viewer — share token, no auth required */}
      <Route path="/sow/:shareToken">
        <MspSowPublicPage />
      </Route>

      {/* Root — redirect to last-used slug or flat login */}
      <Route path="/">
        <RootRedirect />
      </Route>

      {/* Slug + sub-path — rendered inside a slug-scoped inner router */}
      <Route path="/:slug/*">
        <SlugScope />
      </Route>

      {/* Slug only (no sub-path) — branded tenant entry, redirects to /:slug/login */}
      <Route path="/:slug">
        <TenantEntryPage />
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
          <WouterRouter base={BASE_PATH}>
            <AppInner />
          </WouterRouter>
          <Toaster richColors position="top-right" theme="dark" />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
