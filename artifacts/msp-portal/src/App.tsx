import { Switch, Route, Router as WouterRouter, Redirect, useLocation, useParams } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { SlugProvider, getStoredSlug, storeSlug } from "@/lib/slug-context";
import { SessionExpiryModal } from "@/components/session-expiry-modal";
import { useGetPortalTenant } from "@workspace/api-client-react";
import LoginPage from "@/pages/login";
import PortalIdentityInterstitialPage from "@/pages/portal-identity-interstitial";
import DashboardPage from "@/pages/dashboard";
import CustomersPage from "@/pages/customers";
import CustomerDetailPage from "@/pages/customer-detail";
import DocumentsPage from "@/pages/documents";
import DocumentDetailPage from "@/pages/document-detail";
import MspsPage from "@/pages/msps";
import MspDetailPage from "@/pages/msp-detail";
import SettingsPage from "@/pages/settings";
import SettingsOrgProfilePage from "@/pages/settings-org-profile";
import SettingsConnectorPage from "@/pages/settings-connector";
import SettingsServiceAccountsPage from "@/pages/settings-service-accounts";
import SettingsTeamPage from "@/pages/settings-team";
import UserManagementPage from "@/pages/user-management";
import SettingsBillingPage from "@/pages/settings-billing";
import RevenuePage from "@/pages/revenue";
import PlanSettingsPage from "@/pages/plan-settings";
import SettingsEmailTemplatesPage from "@/pages/settings-email-templates";
import SettingsSessionsPage from "@/pages/settings-sessions";
import SettingsCustomDomainPage from "@/pages/settings-custom-domain";
import SecurityPage from "@/pages/security";
import EventsPage from "@/pages/events";
import AuditPage from "@/pages/audit";
import DataRightsPage from "@/pages/data-rights";
import EmailAuthSetupPage from "@/pages/email-auth-setup";
import OffboardingPage from "@/pages/offboarding";
import WebhooksPage from "@/pages/webhooks";
import InitiateOnboardingPage from "@/pages/initiate-onboarding";
import AcceptAgreementPage from "@/pages/accept-agreement";
import { AssessmentMfaEnrollment } from "@/components/assessment/AssessmentMfaEnrollment";
import TrustPage from "@/pages/trust";
import CustomerHomePage from "@/pages/customer-home";
import CustomerDocumentsPage from "@/pages/customer-documents";
import CustomerDiagnosticsPage from "@/pages/customer-diagnostics";
import CustomerTimelinePage from "@/pages/customer-timeline";
import CustomerSowPage from "@/pages/customer-sow";
import MspCustomerSowPage from "@/pages/msp-customer-sow";
import MspSowPublicPage from "@/pages/msp-sow-public";
import SharedDocumentPublicPage from "@/pages/shared-document-public";
import SharedLiveDocumentsPublicPage from "@/pages/shared-live-documents-public";
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
import CustomerRequestsPage from "@/pages/customer-requests";
import SlaDashboardPage from "@/pages/sla-dashboard";
import ScopeCreepDashboardPage from "@/pages/scope-creep-dashboard";
import ScriptLibraryPage from "@/pages/scripts";
import AiBillingPage from "@/pages/ai-billing";
import ReportsPage from "@/pages/reports";
import AlertsPage from "@/pages/alerts";
import LaunchControlPage from "@/pages/launch-control";
import MspExecutivePage from "@/pages/msp-executive";
import MspTimelinePage from "@/pages/msp-timeline";
import MessageCenterPage from "@/pages/message-center";
import M365SlaPage from "@/pages/m365-sla";
import DocumentsHubPage from "@/pages/documents-hub";
import SalesBundlesPage from "@/pages/sales-bundles";
import OffersPage from "@/pages/offers";
import ChargebackPage from "@/pages/chargeback";
import CustomerOffersPage from "@/pages/customer-offers";
import MarketplacePage from "@/pages/marketplace";
import CustomerPrivacyPage from "@/pages/customer-privacy";
import CustomerNotificationsPage from "@/pages/customer-notifications";
import CustomerBillingPage from "@/pages/customer-billing";
import NotFound from "@/pages/not-found";
// Customer Portal v2 — isolated parallel build (Overview + six pillar pages).
// Deliberately separate routes from the live /governance, /m365-health, …
// pages, which are untouched. See components/portal-v2/.
import PortalV2OverviewPage from "@/pages/portal-v2-overview";
import PortalV2PillarPage from "@/pages/portal-v2-pillar";
import PortalV2GovernancePage from "@/pages/portal-v2-governance";
import PortalV2GovDetailPage from "@/pages/portal-v2-gov-detail";
import PortalV2SecurityPage from "@/pages/portal-v2-security";
import PortalV2CompliancePage from "@/pages/portal-v2-compliance";
import PortalV2LicensingPage from "@/pages/portal-v2-licensing";
import PortalV2AdoptionPage from "@/pages/portal-v2-adoption";
import PortalV2HealthPage from "@/pages/portal-v2-health";
import PortalV2DocumentsPage from "@/pages/portal-v2-documents";
import PortalV2RiskRegisterPage from "@/pages/portal-v2-risk-register";
import PortalV2GovOversharingPage from "@/pages/portal-v2-gov-oversharing";
import PortalV2GovOversharingAllPage from "@/pages/portal-v2-gov-oversharing-all";
import PortalV2ChangeControlPage from "@/pages/portal-v2-change-control";
import PortalV2RunbooksPage from "@/pages/portal-v2-runbooks";
import PortalV2SettingsPage from "@/pages/portal-v2-settings";
import PortalV2OwnershipPage from "@/pages/portal-v2-ownership";
import PortalV2MsChangesPage from "@/pages/portal-v2-ms-changes";
import PortalV2RetainerPage from "@/pages/portal-v2-retainer";
import PortalV2CopilotPage from "@/pages/portal-v2-copilot";
import PortalV2ProjectsPage from "@/pages/portal-v2-projects";
import PortalV2RemediationPage from "@/pages/portal-v2-remediation";
import PortalV2PolicyDecisionsPage from "@/pages/portal-v2-policy-decisions";
import PortalV2SecurityPlanPage from "@/pages/portal-v2-security-plan";
import PortalV2PiiPage from "@/pages/portal-v2-pii";
import PortalV2AccountSecurityPage from "@/pages/portal-v2-account-security";
import PortalV2BillingPage from "@/pages/portal-v2-billing";
import PortalV2WebhooksPage from "@/pages/portal-v2-webhooks";
import PortalV2AlertPreferencesPage from "@/pages/portal-v2-alert-preferences";
import PortalV2ReceiptPage from "@/pages/portal-v2-receipt";
import PortalV2SopHubPage from "@/pages/portal-v2-sop-hub";
import PortalV2SopCategoryPage from "@/pages/portal-v2-sop-category";
// Part 11 — pillar drill-downs (reached from the pillar pages, no top-level nav).
import PortalV2SecurityMfaPage from "@/pages/portal-v2-security-mfa";
import PortalV2SecurityCaPage from "@/pages/portal-v2-security-ca";
import PortalV2SecurityEvidencePage from "@/pages/portal-v2-security-evidence";
import PortalV2ComplianceGapsPage from "@/pages/portal-v2-compliance-gaps";
import PortalV2ComplianceDecisionsPage from "@/pages/portal-v2-compliance-decisions";
import PortalV2ComplianceObligationsPage from "@/pages/portal-v2-compliance-obligations";
import PortalV2GovAreaPage from "@/pages/portal-v2-gov-area";
import ConsentDeclinedPage from "@/pages/consent-declined";
import ConsentSuccessPage from "@/pages/consent-success";
import ConsentTenantConflictPage from "@/pages/consent-tenant-conflict";
import BreakGlassVerifyPage from "@/pages/break-glass-verify";
import BreakGlassStatusPage from "@/pages/break-glass-status";
import AccountSetupPage from "@/pages/account-setup";
import ResetPasswordPage from "@/pages/reset-password";
import ActivityFeedPage from "@/pages/activity-feed";
import SupportChatPage from "@/pages/support-chat";
import ProjectKanbanPage from "@/pages/project-kanban";
import ZohoProjectBoardPage from "@/pages/zoho-project-board";
import AssessmentDashboardPage from "@/pages/assessment-dashboard";
import CopilotAssessmentPage from "@/pages/copilot-assessment";
import CopilotAssessmentFluentPreviewPage from "@/pages/copilot-assessment-fluent-preview";
import DashboardCanvasPreviewPage from "@/pages/dashboard-canvas-preview";
import DevStyleGuidePage from "@/pages/dev-style-guide";
import MspWidgetDashboardPage from "@/pages/msp-dashboard";
import DashboardDesignerPage from "@/pages/dashboard-designer";
import MspPortalPage from "@/pages/msp-portal";
import OverviewTestPage from "@/pages/overview-test";
import AssessmentTestPage from "@/pages/assessment-test";
import M365HealthPage from "@/pages/m365-health";
import SecurityOverviewPage from "@/pages/security-overview";
import GovernancePage from "@/pages/governance";
import CompliancePage from "@/pages/compliance";
import AdoptionPage from "@/pages/adoption";
import CopilotPage from "@/pages/copilot";
import ArchitecturePage from "@/pages/architecture";
import LicensingPage from "@/pages/licensing";
import WarRoomRadarPage from "@/pages/war-room-radar";
import WarRoomLadderPage from "@/pages/war-room-ladder";
import CopilotReadinessPage from "@/pages/copilot-readiness";
import CopilotReadinessDocumentsPage from "@/pages/copilot-readiness-documents";
import CopilotReadinessRemediationTrackerPage from "@/pages/copilot-readiness-remediation-tracker";
import CopilotReadinessProposalPage from "@/pages/copilot-readiness-proposal";
import CopilotReadinessCheckoutPage from "@/pages/copilot-readiness-checkout";
import AssessmentShellPage from "@/pages/assessment-shell";
import AssessmentSowComparePage from "@/pages/assessment-sow-compare";
import CustomerTeamPage from "@/pages/customer-team";
import CustomerSettingsPage from "@/pages/customer-settings";
import ComingSoonPage from "@/pages/coming-soon";
import MspTenantsPage from "@/pages/msp-tenants";
import MspTenantViewPage from "@/pages/msp-tenantview";
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

// ── MFA gate (Git #439) ────────────────────────────────────────────────────────
// Mirrors useAgreementGate below: production-only (dev-server test logins are
// never gated), and skipped for the Assessment role, which already has its
// own richer mandatory MFA gate inline in AssessmentWizard/AssessmentMfaEnrollment
// as part of its first-login flow — this generic route-level gate exists for
// every OTHER role (CustomerUser, MSPAdmin, MSPOperator, Free), which land
// straight on /m365-health or /dashboard with no equivalent gate today.
// The real security boundary is requireAuth's mfaSetupPending allowlist on the
// backend; this hook is what redirects the UI to /setup-mfa instead of 403ing
// on every other request.

function useMfaGate(): { loading: boolean; required: boolean } {
  const { user, fetchWithAuth, isImpersonating } = useAuth();
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState(false);

  useEffect(() => {
    if (!user || isImpersonating || user.role === "admin" || user.mspRole === "Assessment") {
      setLoading(false);
      setRequired(false);
      return;
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 8_000),
    );

    Promise.race([
      fetchWithAuth("/api/auth/mfa/enrollments").then((r) => r.json()),
      timeout,
    ])
      .then((data: { totp?: boolean; passkey?: boolean; gateRequired?: boolean }) => {
        setRequired(!!data.gateRequired && !data.totp && !data.passkey);
      })
      .catch(() => {
        // On timeout or any error, unblock the UI — don't gate forever.
        setRequired(false);
      })
      .finally(() => setLoading(false));
  }, [user, fetchWithAuth, isImpersonating]);

  return { loading, required };
}

// Standalone page (auth-required but not itself gated) — reuses the exact
// same enrollment surface AssessmentWizard's mandatory gate uses, just for
// every non-Assessment role. onEnrolled refreshes the access token (the
// current one is mfaSetupPending) before returning to the intended landing.
function SetupMfaPage() {
  const { user, extendSession } = useAuth();
  const [, navigate] = useLocation();

  const defaultLanding =
    user?.mspRole === "CustomerUser" ? "/portal-v2" : "/dashboard";

  return (
    <AssessmentMfaEnrollment
      onEnrolled={() => {
        void extendSession().then(() => navigate(defaultLanding, { replace: true }));
      }}
    />
  );
}

// ── Protected route with agreement + MFA gates ─────────────────────────────────
// Redirects to /login, /accept-agreement, and /setup-mfa — all valid relative
// paths inside the slug-scoped inner router, so they resolve correctly to
// /portal/{slug}/login etc. automatically.

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  const { loading: agreementLoading, required: agreementRequired } = useAgreementGate();
  const { loading: mfaLoading, required: mfaRequired } = useMfaGate();

  if (isLoading || agreementLoading || mfaLoading) {
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

  if (mfaRequired) {
    return <Redirect to="/setup-mfa" />;
  }

  return <Component />;
}

// ── Consolidated customer-settings redirects ───────────────────────────────────
// The five formerly-standalone customer account pages (team, password & MFA,
// notifications, privacy, cancel services) now live as tabs inside the single
// /customer-settings hub. For CustomerUser, the old routes redirect to the
// matching tab so bookmarks and deep links keep working. Non-customer roles
// keep the original page where it still genuinely serves them:
//   /settings/security — the only MFA/password/session UI for admin/MSP roles
//   /offboarding       — the real MSPAdmin 3-step offboarding flow
//   /customer-privacy  — linked from the admin top-bar menu
// These wrappers render inside ProtectedRoute, so `user` is always resolved.
function makeCustomerTabRedirect(tab: string, Fallback: React.ComponentType) {
  return function CustomerTabRedirect() {
    const { user } = useAuth();
    if (user?.mspRole === "CustomerUser") {
      return <Redirect to={`/customer-settings?tab=${tab}`} />;
    }
    return <Fallback />;
  };
}

const TeamRouteOrRedirect = makeCustomerTabRedirect("team", CustomerTeamPage);
const SecurityRouteOrRedirect = makeCustomerTabRedirect("security", SecurityPage);
const NotificationsRouteOrRedirect = makeCustomerTabRedirect("notifications", CustomerNotificationsPage);
const PrivacyRouteOrRedirect = makeCustomerTabRedirect("privacy", CustomerPrivacyPage);
const OffboardingRouteOrRedirect = makeCustomerTabRedirect("cancel", OffboardingPage);

// ── Slug-scoped inner switch ───────────────────────────────────────────────────
// Rendered inside a WouterRouter whose base is /portal/{slug}.
// Every navigate() and <Link> in this subtree automatically resolves relative
// to /portal/{slug}, so no page needs to know the slug explicitly.

function SlugInnerSwitch() {
  const { user, isLoading } = useAuth();

  const defaultLanding = isLoading
    ? "/dashboard"
    : user?.mspRole === "Assessment"
      ? "/copilot-readiness"
      : user?.mspRole === "CustomerUser"
        // Portal v2: a CustomerUser's "home" is now the /portal-v2 Overview, not
        // the legacy /m365-health page. The old pages stay live and directly
        // URL-reachable as the fallback until Portal v2 is confirmed end to end.
        ? "/portal-v2"
        : "/dashboard";

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

      {/* MFA gate page (Git #439) — auth-required but not gated itself */}
      <Route path="/setup-mfa">
        <SetupMfaPage />
      </Route>

      {/* Identity interstitial (Git #1296) — where login.tsx sends every
          non-CustomerUser role instead of straight to /dashboard, since
          /portal/ is customer-only. Auth-required but not itself gated,
          same as /setup-mfa above. */}
      <Route path="/identity">
        <PortalIdentityInterstitialPage />
      </Route>

      {/* MSP-facing pages */}
      <Route path="/dashboard">
        <ProtectedRoute component={DashboardPage} />
      </Route>
      <Route path="/msp-dashboard">
        <ProtectedRoute component={MspWidgetDashboardPage} />
      </Route>
      <Route path="/msp-portal">
        <ProtectedRoute component={MspPortalPage} />
      </Route>
      <Route path="/dashboard-designer">
        <ProtectedRoute component={DashboardDesignerPage} />
      </Route>
      <Route path="/customers/:id">
        <ProtectedRoute component={CustomerDetailPage} />
      </Route>
      <Route path="/customers">
        <ProtectedRoute component={CustomersPage} />
      </Route>
      <Route path="/documents/:id">
        <ProtectedRoute component={DocumentDetailPage} />
      </Route>
      <Route path="/documents">
        <ProtectedRoute component={DocumentsPage} />
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
      <Route path="/data-rights">
        <ProtectedRoute component={DataRightsPage} />
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
      <Route path="/settings/revenue">
        <ProtectedRoute component={RevenuePage} />
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
        {/* CustomerUser → Password & MFA tab of the consolidated hub;
            admin/MSP roles keep the standalone page (their only MFA UI). */}
        <ProtectedRoute component={SecurityRouteOrRedirect} />
      </Route>
      <Route path="/settings">
        <ProtectedRoute component={SettingsPage} />
      </Route>
      <Route path="/offboarding">
        {/* CustomerUser → Cancel Services tab of the consolidated hub;
            MSPAdmin keeps the real 3-step MSP offboarding flow. */}
        <ProtectedRoute component={OffboardingRouteOrRedirect} />
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
      <Route path="/customer-dashboard">
        <Redirect to="/portal-v2" />
      </Route>
      <Route path="/overview-test">
        <ProtectedRoute component={OverviewTestPage} />
      </Route>
      {/* ── Customer Portal v2 — isolated parallel build ──────────────────
          Overview + the six pillar dashboards in the new navy/journeyTokens
          design language, wired to the SAME real backend the live pages use
          (GET /api/portal/assessment/war-room-pillars). Deliberately on their
          own /portal-v2 prefix so nothing collides with /governance,
          /m365-health, /security-overview, … which are untouched.
          The specific "/portal-v2" route is declared BEFORE "/portal-v2/:pillar"
          so the index does not get swallowed by the param match. */}
      <Route path="/portal-v2">
        <ProtectedRoute component={PortalV2OverviewPage} />
      </Route>
      {/* Governance is rebuilt to the design's own composition (hero ring +
          trend + cluster area cards) and its drill-downs to the reference
          drill-down template. Both are declared BEFORE the generic
          "/portal-v2/:pillar" so the param route does not swallow them; the
          other five pillars still fall through to the generic page. */}
      {/* Overshared SharePoint is its own template, not a GOV_PAGES entry — the
          prototype renders `governance-oversharing` from `isGovOversharingDetail`
          and `governance-oversharing-full` from a third, bulk-list section. Both
          are declared before "/portal-v2/governance/:area" so the param route
          does not swallow them; "…/oversharing/all" precedes "…/oversharing" for
          the same reason. */}
      <Route path="/portal-v2/governance/oversharing/all">
        <ProtectedRoute component={PortalV2GovOversharingAllPage} />
      </Route>
      <Route path="/portal-v2/governance/oversharing">
        <ProtectedRoute component={PortalV2GovOversharingPage} />
      </Route>
      {/* Part 11 — the "generic area" Governance drill-downs (list / drift /
          inventory shapes). Each governance tile links to
          "/portal-v2/governance/<slug>", which the ":area" param route below
          otherwise swallows into the GOV_PAGES drill-down (→ NotFound for these
          slugs). So each is declared here as a specific literal route ABOVE
          ":area", the same precedence pattern "…/oversharing" already uses.
          They share one page component that reads its slug from the location.
          This is the one place these must go — the App.tsx insertion marker sits
          below ":area" and would not reach them. */}
      <Route path="/portal-v2/governance/orphaned-teams">
        <ProtectedRoute component={PortalV2GovAreaPage} />
      </Route>
      <Route path="/portal-v2/governance/team-owners">
        <ProtectedRoute component={PortalV2GovAreaPage} />
      </Route>
      <Route path="/portal-v2/governance/device-inventory">
        <ProtectedRoute component={PortalV2GovAreaPage} />
      </Route>
      <Route path="/portal-v2/governance/device-lifecycle">
        <ProtectedRoute component={PortalV2GovAreaPage} />
      </Route>
      <Route path="/portal-v2/governance/sharing-drift-legacy">
        <ProtectedRoute component={PortalV2GovAreaPage} />
      </Route>
      <Route path="/portal-v2/governance/:area">
        <ProtectedRoute component={PortalV2GovDetailPage} />
      </Route>
      <Route path="/portal-v2/governance">
        <ProtectedRoute component={PortalV2GovernancePage} />
      </Route>
      {/* Security is the design's own composition too, and a materially
          different one from Governance — see portal-v2-security.tsx's header for
          the seven verified structural differences. Declared before the param
          route for the same reason Governance is. */}
      <Route path="/portal-v2/security">
        <ProtectedRoute component={PortalV2SecurityPage} />
      </Route>
      {/* Compliance is the pillar the README's "finding rows" line is actually
          right about — it renders them, and three sections no other pillar has.
          See portal-v2-compliance.tsx's header. */}
      <Route path="/portal-v2/compliance">
        <ProtectedRoute component={PortalV2CompliancePage} />
      </Route>
      {/* Licensing is a money page, not a risk page — the prototype says so in
          its own source comment. No scan strip, no status pill, no area cards,
          a wider container for the ledger table, and its own trend maths. */}
      <Route path="/portal-v2/licensing">
        <ProtectedRoute component={PortalV2LicensingPage} />
      </Route>
      {/* Adoption shares Licensing's frame but is a measurement page, not a
          write-action one: four of its six plays cannot be automated at all,
          and parking a play is explicitly NOT accepting a risk. */}
      <Route path="/portal-v2/adoption">
        <ProtectedRoute component={PortalV2AdoptionPage} />
      </Route>
      {/* Health is the sixth and last pillar to get its own page. With this
          route in place ALL SIX pillar keys are matched above the param route,
          so "/portal-v2/:pillar" below can now only ever receive a NON-pillar
          segment — which its own isPillarKey guard turns into a NotFound.
          It is kept deliberately rather than deleted: it is the last consumer of
          the per-pillar LIVE-data render path (usePortalV2Pillars +
          PortalV2Pieces), and if any pillar later needs to move off its fixture
          onto the real payload, that page is the reference for how. Deleting it
          is Shane's call, not a side effect of finishing Layer 1. */}
      <Route path="/portal-v2/health">
        <ProtectedRoute component={PortalV2HealthPage} />
      </Route>
      {/* Library — the Document Library. Not a pillar, but declared here with
          the rest of the specific routes so "/portal-v2/:pillar" cannot swallow
          it. See portal-v2-documents.tsx for the four behavioural rules that
          make it a system rather than a list. */}
      <Route path="/portal-v2/documents">
        <ProtectedRoute component={PortalV2DocumentsPage} />
      </Route>
      {/* Standards & risk — the Risk Register. Declared before
          "/portal-v2/:pillar" like every other specific route. It reads
          `?pillar=` on mount, which is how the prototype's goRiskGov/Sec/Cmp
          entry points survive the move from shell state to real URLs. */}
      <Route path="/portal-v2/risk-register">
        <ProtectedRoute component={PortalV2RiskRegisterPage} />
      </Route>
      {/* Operate — Change Control. Declared BEFORE "/portal-v2/:pillar" so the
          param route does not swallow it, same reason as the pillar pages
          above. Rebuilt to the standalone Change Control.dc.html module (Part 4):
          UI-only against the design's own fixtures. The customer-scoped
          /api/portal/change-control endpoint remains for the later wiring pass. */}
      {/* Operate — Active Runbooks, including the hold-window panel. Declared
          before "/portal-v2/:pillar" for the same reason as the rows above. */}
      <Route path="/portal-v2/runbooks">
        <ProtectedRoute component={PortalV2RunbooksPage} />
      </Route>
      {/* The sub-view segment — /portal-v2/change-control/<view> — is the shell
          sub-nav's five view tabs (briefing / register / catalogue / calendar /
          review) plus the deep-linkable policy view (`settings`), held as
          `state.view` in the prototype and passed down as the module's `view`
          prop. Declared before the bare route so the param match is tried first,
          and both precede "/portal-v2/:pillar". */}
      <Route path="/portal-v2/change-control/:view">
        <ProtectedRoute component={PortalV2ChangeControlPage} />
      </Route>
      <Route path="/portal-v2/change-control">
        <ProtectedRoute component={PortalV2ChangeControlPage} />
      </Route>
      {/* Settings — reached from the account menu, not the left nav, which is
          where the design puts it. Its four sections are a real deep link
          rather than a state key: the prototype's own hash parser already
          treats them that way (`bits[1] === 'settings'` sets `setSection` from
          `bits[2]`, shell 20049), so "/portal-v2/settings/change" is the
          faithful URL, not an invention. The section route is declared BEFORE
          the bare one so the param match is tried first, and both precede
          "/portal-v2/:pillar" for the same reason every specific route above
          does. */}
      <Route path="/portal-v2/settings/:section">
        <ProtectedRoute component={PortalV2SettingsPage} />
      </Route>
      <Route path="/portal-v2/settings">
        <ProtectedRoute component={PortalV2SettingsPage} />
      </Route>
      {/* Governance — Ownership. The `:type` segment is the shell sub-nav's
          eight-way object-type filter, which the prototype holds as
          `state.ownType` and passes down as the module's `typeFilter` prop; a
          URL is the equivalent here, and makes each filtered view linkable.
          Declared before "/portal-v2/:pillar" like every specific route. */}
      <Route path="/portal-v2/ownership/:type">
        <ProtectedRoute component={PortalV2OwnershipPage} />
      </Route>
      <Route path="/portal-v2/ownership">
        <ProtectedRoute component={PortalV2OwnershipPage} />
      </Route>
      {/* Reference — Microsoft Changes. The `:wave` segment is the shell
          sub-nav's five-way wave selector, held as `state.mscWave` in the
          prototype and passed down as the module's `waveSel` prop. The
          prototype's own keys are index strings ('0'…'4'); readable slugs are
          used here because this is a URL a customer can send to someone. */}
      <Route path="/portal-v2/ms-changes/:wave">
        <ProtectedRoute component={PortalV2MsChangesPage} />
      </Route>
      <Route path="/portal-v2/ms-changes">
        <ProtectedRoute component={PortalV2MsChangesPage} />
      </Route>
      {/* Ungrouped, above the Pillars group — My Architect (the retainer page).
          Part 9. A plain /portal-v2/retainer route with no param segments. */}
      <Route path="/portal-v2/retainer">
        <ProtectedRoute component={PortalV2RetainerPage} />
      </Route>
      {/* Standalone, after the Pillars group — Copilot readiness, now the only
          surface for the Copilot gate after the Overview rebuild dropped its
          gate band. Part 9. */}
      <Route path="/portal-v2/copilot">
        <ProtectedRoute component={PortalV2CopilotPage} />
      </Route>
      {/* Ungrouped, above the Pillars group — Projects (SOW-based delivery),
          beside My Architect. Part 8. A plain /portal-v2/projects route with no
          param segments; declared before "/portal-v2/:pillar" like every
          specific route above so the param route cannot swallow it. */}
      <Route path="/portal-v2/projects">
        <ProtectedRoute component={PortalV2ProjectsPage} />
      </Route>
      {/* Operate — Remediation Tracker + Policy Decisions (Part 5). Plain,
          param-free routes declared before "/portal-v2/:pillar" so the param
          route cannot swallow them.

          Round Four: the tracker's seven phases live in the left nav, each a
          real, linkable URL (`/portal-v2/remediation/<phase-slug>`) that filters
          the list to that phase — the same pattern Microsoft Changes' waves
          already use above. The `:phase` route is declared before the bare one
          so the param form matches first. */}
      <Route path="/portal-v2/remediation/:phase">
        <ProtectedRoute component={PortalV2RemediationPage} />
      </Route>
      <Route path="/portal-v2/remediation">
        <ProtectedRoute component={PortalV2RemediationPage} />
      </Route>
      <Route path="/portal-v2/policy-decisions">
        <ProtectedRoute component={PortalV2PolicyDecisionsPage} />
      </Route>
      {/* Governance — Security Plan + PII Governance (Part 7). Plain,
          param-free routes declared before "/portal-v2/:pillar" so the param
          route cannot swallow them. */}
      <Route path="/portal-v2/security-plan">
        <ProtectedRoute component={PortalV2SecurityPlanPage} />
      </Route>
      <Route path="/portal-v2/pii">
        <ProtectedRoute component={PortalV2PiiPage} />
      </Route>
      {/* Account settings (Part 12) — the five account-MENU pages, not left-nav
          rows. Reached from the account menu (HeaderMenus.tsx). All plain,
          param-free routes declared before "/portal-v2/:pillar" so the param
          route cannot swallow them. Receipt takes an optional id segment, so its
          two-segment form is declared before its bare form. */}
      <Route path="/portal-v2/account-security">
        <ProtectedRoute component={PortalV2AccountSecurityPage} />
      </Route>
      <Route path="/portal-v2/billing">
        <ProtectedRoute component={PortalV2BillingPage} />
      </Route>
      <Route path="/portal-v2/webhooks">
        <ProtectedRoute component={PortalV2WebhooksPage} />
      </Route>
      <Route path="/portal-v2/alert-preferences">
        <ProtectedRoute component={PortalV2AlertPreferencesPage} />
      </Route>
      <Route path="/portal-v2/receipt/:id">
        <ProtectedRoute component={PortalV2ReceiptPage} />
      </Route>
      <Route path="/portal-v2/receipt">
        <ProtectedRoute component={PortalV2ReceiptPage} />
      </Route>
      {/* Reference — SOPs & Runbooks hub (Part 6). The four sop-* category pages
          are EXPLICIT routes declared BEFORE "/portal-v2/sops/:view" so the
          hub's sub-view param does not swallow them; the hub's sub-views
          (library / queue / audit) are the design's nav sub-items, so the base
          route is the library and "/sops/:view" carries queue/audit. All precede
          "/portal-v2/:pillar" like every specific route above. */}
      <Route path="/portal-v2/sops/incident-response">
        <ProtectedRoute component={PortalV2SopCategoryPage} />
      </Route>
      <Route path="/portal-v2/sops/security-drift">
        <ProtectedRoute component={PortalV2SopCategoryPage} />
      </Route>
      <Route path="/portal-v2/sops/mail-flow">
        <ProtectedRoute component={PortalV2SopCategoryPage} />
      </Route>
      <Route path="/portal-v2/sops/device-mgmt">
        <ProtectedRoute component={PortalV2SopCategoryPage} />
      </Route>
      <Route path="/portal-v2/sops/:view">
        <ProtectedRoute component={PortalV2SopHubPage} />
      </Route>
      <Route path="/portal-v2/sops">
        <ProtectedRoute component={PortalV2SopHubPage} />
      </Route>
      {/* Part 11 — Security drill-downs (MFA, Conditional Access, and the three
          evidence pages) and Compliance drill-downs (open gaps, decisions,
          obligations). Two-segment routes that "/portal-v2/:pillar" cannot
          swallow, declared at the marker per the plan. Evidence's three slugs
          share one page component that reads its slug from the location. */}
      <Route path="/portal-v2/security/mfa">
        <ProtectedRoute component={PortalV2SecurityMfaPage} />
      </Route>
      <Route path="/portal-v2/security/ca">
        <ProtectedRoute component={PortalV2SecurityCaPage} />
      </Route>
      <Route path="/portal-v2/security/oauth">
        <ProtectedRoute component={PortalV2SecurityEvidencePage} />
      </Route>
      <Route path="/portal-v2/security/legacy-auth">
        <ProtectedRoute component={PortalV2SecurityEvidencePage} />
      </Route>
      <Route path="/portal-v2/security/email">
        <ProtectedRoute component={PortalV2SecurityEvidencePage} />
      </Route>
      <Route path="/portal-v2/compliance/open-gaps">
        <ProtectedRoute component={PortalV2ComplianceGapsPage} />
      </Route>
      <Route path="/portal-v2/compliance/decisions">
        <ProtectedRoute component={PortalV2ComplianceDecisionsPage} />
      </Route>
      <Route path="/portal-v2/compliance/obligations">
        <ProtectedRoute component={PortalV2ComplianceObligationsPage} />
      </Route>
      {/* ═══════════════════════════════════════════════════════════════════
          PORTAL-V2 ROUTE INSERTION POINT — ADD NEW /portal-v2 ROUTES ABOVE.

          Add them ABOVE this marker, never below it. The "/portal-v2/:pillar"
          route immediately after is a PARAM route: wouter matches in source
          order, so anything declared after it is swallowed and renders the
          pillar page instead of yours. Every specific route above is ordered
          that way for this reason, and a two-segment route (".../ownership/
          :type") goes above its own one-segment form for the same reason.

          This marker exists so that the parts of the portal build running as
          concurrent agents all append at ONE known line instead of each
          choosing its own and conflicting. See PORTAL_V2_PARALLEL_PLAN.md.
          ═══════════════════════════════════════════════════════════════════ */}
      <Route path="/portal-v2/:pillar">
        <ProtectedRoute component={PortalV2PillarPage} />
      </Route>

      {/* M365 Health Suite — 8 isolated, structure-only pages wired into the
          real AppShell, matching the /overview-test and /assessment-test
          precedent. Mock data only; real backend wiring is a later task. */}
      <Route path="/m365-health">
        <ProtectedRoute component={M365HealthPage} />
      </Route>
      <Route path="/security-overview">
        <ProtectedRoute component={SecurityOverviewPage} />
      </Route>
      <Route path="/governance">
        <ProtectedRoute component={GovernancePage} />
      </Route>
      <Route path="/compliance">
        <ProtectedRoute component={CompliancePage} />
      </Route>
      <Route path="/adoption">
        <ProtectedRoute component={AdoptionPage} />
      </Route>
      <Route path="/copilot">
        <ProtectedRoute component={CopilotPage} />
      </Route>
      <Route path="/architecture">
        <ProtectedRoute component={ArchitecturePage} />
      </Route>
      <Route path="/licensing">
        <ProtectedRoute component={LicensingPage} />
      </Route>
      {/* The radar on its own, with none of the room around it — a reference
          surface for how large the diagram can actually get once the persona
          strip, composer, bubble, host card and right dock are gone. Same
          real per-pillar scores as the room; `?labels=1` drops embed mode so
          every node chip is drawn. Its own path, not a /war-room/:section stop,
          because it is not a position in the briefing. */}
      <Route path="/war-room-radar">
        <ProtectedRoute component={WarRoomRadarPage} />
      </Route>
      {/* Candidate replacement for the radial diagram — the seven pillars as
          rows on one shared 0-100 axis, sorted worst-first, with every real
          stat callout named. Same real payload the room's pillar cards use. */}
      <Route path="/war-room-ladder">
        <ProtectedRoute component={WarRoomLadderPage} />
      </Route>
      {/* Copilot Readiness journey — the post-scan customer arc, in four screens:
          the Reveal (a linear scroll narrative that opens on the live tenant scan
          and pays it off with the verdict and six pillar findings), the Document
          Viewer, the SOW Proposal, and Checkout. Ported from the Claude Design
          handoff in Design/.

          Each screen owns the whole viewport and renders outside AppShell, for
          the same reason the War Room does — the shell would be covered either
          way. They are ordinary Routes rather than one `:screen?` pattern because
          they are genuinely four destinations with different chrome, not four
          positions in one experience; only the viewer needs to keep a param, so
          a ready report is deep-linkable and survives a refresh.

          The more specific documents route is declared first: wouter's Switch
          takes the first match, and while `/copilot-readiness` cannot match
          `/copilot-readiness/documents` today, ordering it this way means adding
          a wildcard later cannot silently swallow the children. */}
      <Route path="/copilot-readiness/documents/:docId?">
        <ProtectedRoute component={CopilotReadinessDocumentsPage} />
      </Route>
      {/* The Remediation Tracker as its own destination (design's original
          intent — see the page's own header comment), not only reachable as
          one pane inside the documents reader above. */}
      <Route path="/copilot-readiness/remediation-tracker">
        <ProtectedRoute component={CopilotReadinessRemediationTrackerPage} />
      </Route>
      <Route path="/copilot-readiness/proposal">
        <ProtectedRoute component={CopilotReadinessProposalPage} />
      </Route>
      <Route path="/copilot-readiness/checkout">
        <ProtectedRoute component={CopilotReadinessCheckoutPage} />
      </Route>
      <Route path="/copilot-readiness">
        <ProtectedRoute component={CopilotReadinessPage} />
      </Route>
      {/* Email Authentication Setup Instructions — Git #1041, sub-issue of
          epic #647. Standalone customer self-service page linked in from the
          live Remediation Guide document, not a numbered remediation step. */}
      <Route path="/email-auth-setup">
        <ProtectedRoute component={EmailAuthSetupPage} />
      </Route>
      {/* /assessment now serves the real, standard-AppShell assessment
          experience (real portal nav incl. Marketplace, same as every other
          role) — /assessment-test's former content, promoted in place. The
          prior self-contained "no left nav" shell + wizard is preserved,
          untouched and fully reachable, at /assessment-legacy below. */}
      <Route path="/assessment">
        <ProtectedRoute component={AssessmentTestPage} />
      </Route>
      {/* Legacy Assessment-role landing shell (RBAC-foundation placeholder) —
          kept reachable for its proven debug trigger + real SSE wiring
          patterns, which may still be referenced or reverted to later. */}
      <Route path="/assessment-legacy">
        <ProtectedRoute component={AssessmentShellPage} />
      </Route>
      {/* Assessment Comparison Mode — side-by-side SOW scope versions, read-only
          over the same archived-version storage the SOW Scope Selector produces. */}
      <Route path="/assessment/compare">
        <ProtectedRoute component={AssessmentSowComparePage} />
      </Route>
      <Route path="/customer-documents">
        <ProtectedRoute component={CustomerDocumentsPage} />
      </Route>
      <Route path="/customer-diagnostics">
        <ProtectedRoute component={CustomerDiagnosticsPage} />
      </Route>
      <Route path="/customer-timeline">
        <ProtectedRoute component={CustomerTimelinePage} />
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
      <Route path="/customer-requests">
        <ProtectedRoute component={CustomerRequestsPage} />
      </Route>
      <Route path="/support">
        <ProtectedRoute component={SupportChatPage} />
      </Route>
      <Route path="/project-kanban/:id">
        <ProtectedRoute component={ProjectKanbanPage} />
      </Route>
      <Route path="/zoho-project-board/:id">
        <ProtectedRoute component={ZohoProjectBoardPage} />
      </Route>

      {/* Assessment Results Dashboard — one page for all 13 assessment products.
          Which modules render is driven by type_attributes.dashboardModules on the
          services table row — no per-assessment page needed. */}
      <Route path="/assessment-results/:serviceSlug">
        <ProtectedRoute component={AssessmentDashboardPage} />
      </Route>

      {/* Copilot Assessment — each step (home/quiz/telemetry/personas/
          use-cases/security/security2/governance/roi/report/documents/sow)
          is now its own deep-linkable URL under this dynamic route, rather
          than one fixed URL with an in-memory step. Still on static/mock
          data in most steps; real telemetry/signal wiring is future work. */}
      <Route path="/copilot-assessment">
        <Redirect to="/copilot-assessment/home" />
      </Route>
      <Route path="/copilot-assessment/:step">
        <ProtectedRoute component={CopilotAssessmentPage} />
      </Route>

      {/* Reports */}
      <Route path="/reports">
        <ProtectedRoute component={ReportsPage} />
      </Route>

      {/* Cross-Tenant Alerts */}
      <Route path="/alerts">
        <ProtectedRoute component={AlertsPage} />
      </Route>

      {/* M365 Launch Control */}
      <Route path="/launch-control">
        <ProtectedRoute component={LaunchControlPage} />
      </Route>

      {/* MSP Executive Mode — simplified leadership view: top-risk + top-opportunity
          tenants across the book, plus an AI Partner QBR. A stripped-down companion
          to /customers, not a replacement. */}
      <Route path="/executive">
        <ProtectedRoute component={MspExecutivePage} />
      </Route>

      {/* Cross-Tenant Timeline */}
      <Route path="/msp-timeline">
        <ProtectedRoute component={MspTimelinePage} />
      </Route>

      {/* M365 Message Center */}
      <Route path="/message-center">
        <ProtectedRoute component={MessageCenterPage} />
      </Route>

      {/* M365 Third-Party SLA Tracking */}
      <Route path="/m365-sla">
        <ProtectedRoute component={M365SlaPage} />
      </Route>

      {/* MSP-Wide Customer Documents Hub */}
      <Route path="/documents-hub">
        <ProtectedRoute component={DocumentsHubPage} />
      </Route>

      {/* Dashboard Web Part System — internal component preview, not linked
          in nav. Step 4a (Components) only; the real designer/viewer surfaces
          are later steps. */}
      <Route path="/dashboard-canvas-preview">
        <ProtectedRoute component={DashboardCanvasPreviewPage} />
      </Route>

      {/* Portal Foundation Redesign — internal token/component style guide,
          not linked in nav. Visual QA only; no real page migrates yet. */}
      <Route path="/dev/style-guide">
        <ProtectedRoute component={DevStyleGuidePage} />
      </Route>

      {/* Real Fluent 2 mock of the Personas page (#288, epic #183) — an isolated
          duplicate of PersonasScreen restyled in @fluentui/react-components,
          fed the customer's own real quiz profile + real generated personas.
          Deliberately NOT under /copilot-assessment/:step: it is a design
          evaluation artifact, testbed-gated inside the page, not linked from
          nav or from the wizard, and the production Personas screen and route
          are untouched. No migration decision is implied by its existence. */}
      <Route path="/dev/fluent-personas-preview">
        <ProtectedRoute component={CopilotAssessmentFluentPreviewPage} />
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

      {/* Marketplace — shared across roles (Assessment + CustomerUser); RBAC
          controls catalog scope + which sections render inside the page. */}
      <Route path="/marketplace">
        <ProtectedRoute component={MarketplacePage} />
      </Route>

      {/* Consolidated Customer Settings hub — team, password & MFA,
          notifications, privacy & data, and cancel services as tabs. */}
      <Route path="/customer-settings">
        <ProtectedRoute component={CustomerSettingsPage} />
      </Route>

      {/* Customer Privacy & Data — CustomerUser redirects to the hub's
          Privacy tab; admin roles (whose top-bar menu links here) keep the
          standalone page. */}
      <Route path="/customer-privacy">
        <ProtectedRoute component={PrivacyRouteOrRedirect} />
      </Route>

      {/* Customer Notification Preferences — redirects to the hub's
          Notifications tab. */}
      <Route path="/customer-notifications">
        <ProtectedRoute component={NotificationsRouteOrRedirect} />
      </Route>

      {/* Customer Team Management — redirects to the hub's Team tab. */}
      <Route path="/customer-team">
        <ProtectedRoute component={TeamRouteOrRedirect} />
      </Route>

      {/* Customer Billing — customer-facing */}
      <Route path="/customer-billing">
        <ProtectedRoute component={CustomerBillingPage} />
      </Route>

      {/* Temporary nav access for in-progress Stitch pages (msp-tenants,
          msp-tenantview) — additive-for-now per Shane, same precedent as the
          M365 Health Suite. Each page owns its own self-contained nav
          component; routing/nav access only, no internal wiring here. */}
      <Route path="/msp-tenants">
        <ProtectedRoute component={MspTenantsPage} />
      </Route>
      <Route path="/msp-tenantview">
        <ProtectedRoute component={MspTenantViewPage} />
      </Route>

      {/* Coming-soon placeholders for customer account actions whose backend
          is a later phase (Password & MFA, Download My Data, Cancel Service).
          Real navigable destinations, not faked functionality. */}
      <Route path="/coming-soon/:feature">
        <ProtectedRoute component={ComingSoonPage} />
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
      const landing =
        user?.mspRole === "Assessment"
          ? "copilot-readiness"
          : user?.mspRole === "CustomerUser"
            ? "portal-v2"
            : "dashboard";
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

      {/* Public shared-document viewer — share token, no auth required */}
      <Route path="/shared-documents/:shareToken">
        <SharedDocumentPublicPage />
      </Route>

      {/* Public live-document-set viewer (Git #1044) — share token, no auth required */}
      <Route path="/shared-live-documents/:shareToken">
        <SharedLiveDocumentsPublicPage />
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

      {/* Password reset — public, no auth required.
          Email links from the forgot-password flow land here. The token
          query param is validated server-side; on success the user is
          redirected to sign in with their new password (not auto-logged-in,
          since /auth/reset-password issues no tokens). */}
      <Route path="/reset-password">
        <ResetPasswordPage />
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

      {/* Cross-MSP tenant conflict — public, no auth required.
          The API consent callback redirects here when a self-service checkout's
          Microsoft tenant is already connected to a different MSP/account. The
          purchase is rejected before payment; this explains why and points to
          support. See routes/consent.ts cross-MSP tenant boundary guard. */}
      <Route path="/consent/tenant-conflict">
        <ConsentTenantConflictPage />
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
      <MarketplaceModalHost />
      {/* Reconsent nudge lives in the sidebar as a subtle pill (ReconsentPill in
          app-shell.tsx) — deliberately NOT a modal or banner. */}
    </>
  );
}

import { SupportChatProvider } from "@/lib/support-chat-context";
import { ScanStatusProvider } from "@/lib/scan-status-context";
import { ShellStatusProvider } from "@/lib/shell-status-context";
import { MarketplaceProvider } from "@/lib/marketplace-context";
import { MarketplaceModalHost } from "@/components/marketplace-modal-host";
import { ThemeProvider } from "@/lib/theme-context";
import { ErrorBoundary } from "@/components/error-boundary";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ErrorBoundary>
          <AuthProvider>
            {/* ThemeProvider must live inside AuthProvider — it reads the session
                to load the account-level theme preference. It owns the `dark`
                class on <html> from here on (main.tsx no longer hardcodes it). */}
            <ThemeProvider>
              <SupportChatProvider>
                <ScanStatusProvider>
                  <ShellStatusProvider>
                    <MarketplaceProvider>
                      <WouterRouter base={BASE_PATH}>
                        <AppInner />
                      </WouterRouter>
                      <Toaster richColors position="top-right" />
                    </MarketplaceProvider>
                  </ShellStatusProvider>
                </ScanStatusProvider>
              </SupportChatProvider>
            </ThemeProvider>
          </AuthProvider>
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
