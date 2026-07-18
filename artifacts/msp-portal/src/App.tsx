import { Switch, Route, Router as WouterRouter, Redirect, useLocation, useParams } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { SlugProvider, getStoredSlug, storeSlug } from "@/lib/slug-context";
import { SessionExpiryModal } from "@/components/session-expiry-modal";
import { useGetPortalTenant } from "@workspace/api-client-react";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import CustomersPage from "@/pages/customers";
import CustomerDetailPage from "@/pages/customer-detail";
import MspsPage from "@/pages/msps";
import MspDetailPage from "@/pages/msp-detail";
import SettingsPage from "@/pages/settings";
import SettingsOrgProfilePage from "@/pages/settings-org-profile";
import SettingsConnectorPage from "@/pages/settings-connector";
import SettingsServiceAccountsPage from "@/pages/settings-service-accounts";
import SettingsTeamPage from "@/pages/settings-team";
import UserManagementPage from "@/pages/user-management";
import SettingsBillingPage from "@/pages/settings-billing";
import PlanSettingsPage from "@/pages/plan-settings";
import SettingsEmailTemplatesPage from "@/pages/settings-email-templates";
import SettingsSessionsPage from "@/pages/settings-sessions";
import SettingsCustomDomainPage from "@/pages/settings-custom-domain";
import SecurityPage from "@/pages/security";
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
import AcceptInvitePage from "@/pages/accept-invite";
import OperatorTasksPage from "@/pages/operator-tasks";
import PendingApprovalsPage from "@/pages/pending-approvals";
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
import ChargebackPage from "@/pages/chargeback";
import CustomerOffersPage from "@/pages/customer-offers";
import CustomerPrivacyPage from "@/pages/customer-privacy";
import CustomerBillingPage from "@/pages/customer-billing";
import NotFound from "@/pages/not-found";
import ConsentDeclinedPage from "@/pages/consent-declined";
import ConsentSuccessPage from "@/pages/consent-success";
import BreakGlassVerifyPage from "@/pages/break-glass-verify";
import BreakGlassStatusPage from "@/pages/break-glass-status";
import AccountSetupPage from "@/pages/account-setup";
import ActivityFeedPage from "@/pages/activity-feed";
import SupportChatPage from "@/pages/support-chat";
import ProjectKanbanPage from "@/pages/project-kanban";
import AssessmentDashboardPage from "@/pages/assessment-dashboard";
import DashboardCanvasPreviewPage from "@/pages/dashboard-canvas-preview";
import CommandCenterPage from "@/pages/command-center";
import CustomerTeamPage from "@/pages/customer-team";
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

  // Use the generated type-safe hook from the MSP OpenAPI spec to resolve the
  // tenant slug. This replaces the previous raw fetch() call and gives us
  // compile-time type safety on the response shape.
  const { data, isError, isSuccess } = useGetPortalTenant(slug ?? "");

  useEffect(() => {
    if (isSuccess && data) {
      // Tenant exists — redirect to the slug-scoped login page.
      // In the outer router (base=/portal), "/{slug}/login" becomes /portal/{slug}/login.
      navigate(`/${slug}/login`, { replace: true });
    }
  }, [isSuccess, data, slug, navigate]);

  if (!slug || isError) return <NotFound />;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

// ── Agreement gate ────────────────────────────────────────────────────────────

function useAgreementGate(): { loading: boolean; required: boolean } {
  const { user, fetchWithAuth, isImpersonating } = useAuth();
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setRequired(false);
      return;
    }
    // PlatformAdmin never needs agreement gating — skip the fetch entirely.
    // Also skip during impersonation: the impersonated identity's own
    // acceptance status must never block the admin's preview session, since
    // accepting would require a write that requireAuth blocks while
    // impersonating (payload.impersonatedBy check).
    if (user.role === "admin" || !user.mspRole || isImpersonating) {
      setLoading(false);
      setRequired(false);
      return;
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 8_000),
    );

    Promise.race([
      fetchWithAuth("/api/platform/agreement/acceptance-status").then((r) => r.json()),
      timeout,
    ])
      .then((data: { required?: boolean; accepted?: boolean }) => {
        setRequired(!!(data.required && !data.accepted));
      })
      .catch(() => {
        // On timeout or any error, unblock the UI — don't gate forever.
        setRequired(false);
      })
      .finally(() => setLoading(false));
  }, [user, fetchWithAuth, isImpersonating]);

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
        {/* Render LoginPage immediately — it has its own useEffect that
            redirects to the dashboard if the user is already authenticated.
            This avoids a blank screen while the boot refresh is in flight. */}
        <LoginPage />
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
      <Route path="/msps/:id">
        <ProtectedRoute component={MspDetailPage} />
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
      <Route path="/users">
        <ProtectedRoute component={UserManagementPage} />
      </Route>
      <Route path="/user-management">
        <ProtectedRoute component={UserManagementPage} />
      </Route>
      <Route path="/settings/team">
        <ProtectedRoute component={UserManagementPage} />
      </Route>
      <Route path="/settings/billing">
        <ProtectedRoute component={SettingsBillingPage} />
      </Route>
      <Route path="/settings/plan">
        <ProtectedRoute component={PlanSettingsPage} />
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
      <Route path="/settings/security">
        <ProtectedRoute component={SecurityPage} />
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
      <Route path="/pending-approvals">
        <ProtectedRoute component={PendingApprovalsPage} />
      </Route>
      <Route path="/break-glass/:runId">
        <ProtectedRoute component={BreakGlassStatusPage} />
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
      <Route path="/command-center">
        <ProtectedRoute component={CommandCenterPage} />
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

      {/* Assessment Results Dashboard — one page for all 13 assessment products.
          Which modules render is driven by type_attributes.dashboardModules on the
          services table row — no per-assessment page needed. */}
      <Route path="/assessment-results/:serviceSlug">
        <ProtectedRoute component={AssessmentDashboardPage} />
      </Route>

      {/* Reports */}
      <Route path="/reports">
        <ProtectedRoute component={ReportsPage} />
      </Route>

      {/* Dashboard Web Part System — internal component preview, not linked
          in nav. Step 4a (Components) only; the real designer/viewer surfaces
          are later steps. */}
      <Route path="/dashboard-canvas-preview">
        <ProtectedRoute component={DashboardCanvasPreviewPage} />
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

      {/* Chargeback — MSP-scoped purchase ledger (wholesale vs. customer-quote pricing) */}
      <Route path="/chargeback">
        <ProtectedRoute component={ChargebackPage} />
      </Route>

      {/* Customer Offers — customer-facing */}
      <Route path="/customer-offers">
        <ProtectedRoute component={CustomerOffersPage} />
      </Route>

      {/* Customer Privacy & Data — customer-facing */}
      <Route path="/customer-privacy">
        <ProtectedRoute component={CustomerPrivacyPage} />
      </Route>

      {/* Customer Team Management — customer-facing */}
      <Route path="/customer-team">
        <ProtectedRoute component={CustomerTeamPage} />
      </Route>

      {/* Customer Billing — customer-facing */}
      <Route path="/customer-billing">
        <ProtectedRoute component={CustomerBillingPage} />
      </Route>

      {/* Slug root — role-aware landing.
          Render LoginPage directly instead of redirecting to /login.
          A Redirect would return null while scheduling navigation in a
          useLayoutEffect; in React 18 concurrent mode the browser can paint
          that blank null state before the re-render lands, producing the
          blank-blue-screen bug. Rendering LoginPage here is equivalent: the
          form appears immediately, and LoginPage's own useEffect handles the
          redirect-to-dashboard once the boot refresh completes. */}
      <Route path="/">
        {user ? <Redirect to={defaultLanding} /> : <LoginPage />}
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
      {/*
       * IMPORTANT: Wouter appends nested bases to the parent's base.
       * The outer WouterRouter already has base="/portal".
       * Passing `/${slug}` here yields an effective base of
       * "/portal" + "/${slug}" = "/portal/${slug}".
       * Passing `${BASE_PATH}/${slug}` would double the prefix to
       * "/portal/portal/${slug}" and break all inner path matching.
       */}
      <WouterRouter base={`/${slug}`}>
        <SlugInnerSwitch />
      </WouterRouter>
    </SlugProvider>
  );
}

// ── Root redirect ─────────────────────────────────────────────────────────────
// Handles /portal/ with no slug. If a slug was used previously in this session,
// redirect to the slug-scoped URL; otherwise show the flat login.

function RootRedirect() {
  const [, navigate] = useLocation();

  // Navigate immediately — don't wait for the boot refresh to complete.
  // The target /login route renders the form optimistically and its own
  // useEffect handles the redirect-to-dashboard if the user is authenticated.
  useEffect(() => {
    // Impersonation tabs open at the flat root with ?impersonation_token=...
    // AuthProvider's boot effect owns that case entirely (exchange + redirect
    // to the target tenant). If we navigate here we'd win the child-effect race
    // and wipe the token from the URL before the async exchange reads it — the
    // original bug. So bail out and let AuthProvider drive.
    if (new URLSearchParams(window.location.search).get("impersonation_token")) {
      return;
    }

    const stored = getStoredSlug();
    if (stored) {
      // User has a known slug — go to the slug-scoped login.
      navigate(`/${stored}/login`, { replace: true });
    } else {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  // Brief placeholder while the navigation resolves (single paint frame).
  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar">
      <Loader2 className="size-6 animate-spin text-white/70" />
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
  const { user, logout, fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const storedSlug = getStoredSlug();

  // Resolve slug: prefer stored (from a previous visit), then JWT claim.
  const resolvedSlug = storedSlug ?? user?.mspSlug ?? null;

  // For PlatformAdmin with no stored/JWT slug, look up their first MSP dynamically.
  const [adminLookupDone, setAdminLookupDone] = useState(false);
  const isPlatformAdmin = user?.role === "admin";

  useEffect(() => {
    if (resolvedSlug) {
      // Persist slug so next visit resolves instantly without needing the JWT.
      if (!storedSlug) storeSlug(resolvedSlug);
      const landing = user?.mspRole === "CustomerUser" ? "customer-home" : "dashboard";
      navigate(`/${resolvedSlug}/${landing}`, { replace: true });
      return;
    }

    // PlatformAdmin: fetch first MSP from the admin API and redirect to its dashboard.
    if (isPlatformAdmin && !adminLookupDone) {
      setAdminLookupDone(true);
      fetchWithAuth("/api/admin/msps?limit=1")
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as { msps?: Array<{ slug: string }> };
          const firstSlug = data.msps?.[0]?.slug;
          if (firstSlug) {
            storeSlug(firstSlug);
            navigate(`/${firstSlug}/dashboard`, { replace: true });
          }
        })
        .catch(() => {});
    }
    // No slug known — stay on this component; do NOT navigate to "/" (would loop)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedSlug]);

  // While redirect is pending (slug resolved or admin lookup in flight), show spinner
  if (resolvedSlug || (isPlatformAdmin && !adminLookupDone)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No slug known at all — genuine edge case: account has no MSP association
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

      {/* Public invite accept — no auth required */}
      <Route path="/invite/:token">
        <AcceptInvitePage />
      </Route>

      {/* Public break-glass verify landing — no auth required, the recipient may
          not have Portal access at all. See break-glass-verify.tsx. */}
      <Route path="/break-glass/verify/:token">
        <BreakGlassVerifyPage />
      </Route>

      {/* Account setup — public, no auth required.
          Email links for new customer accounts land here. The setup_token
          query param is validated server-side; on success the user is signed
          in automatically and redirected to their portal landing page. */}
      <Route path="/account-setup">
        <AccountSetupPage />
      </Route>

      {/* Microsoft admin-consent declined — public, no auth required.
          The API consent callback redirects here when the Global Admin clicks
          "No" at the Microsoft permission screen. Renders a friendly error
          page explaining what happened and how to re-initiate the flow. */}
      <Route path="/consent/declined">
        <ConsentDeclinedPage />
      </Route>

      {/* Microsoft admin-consent success — public, no auth required.
          The API consent callback redirects here when the Global Admin clicks
          "Accept" at the Microsoft permission screen. Renders a confirmation
          page explaining next steps. */}
      <Route path="/consent/success">
        <ConsentSuccessPage />
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

import { SupportChatProvider } from "@/lib/support-chat-context";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <SupportChatProvider>
            <WouterRouter base={BASE_PATH}>
              <AppInner />
            </WouterRouter>
            <Toaster richColors position="top-right" theme="dark" />
          </SupportChatProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
