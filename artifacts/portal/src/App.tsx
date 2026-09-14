import { useState } from "react";
import { Route, Switch, Router as WouterRouter, Link } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";
import { SlugProvider, getStoredSlug } from "@/lib/slug-context";
import { PortalLayout } from "@/components/layout";
import IndexPage from "@/pages/index";
import ComingSoon from "@/pages/coming-soon";
import SupportPage from "@/pages/support";
import CustomerRequestsPage from "@/pages/customer-requests";
import AccountSecurityPage from "@/pages/account-security";
import DataRightsAndPrivacyPage from "@/pages/data-rights-and-privacy";
import BillingPage from "@/pages/billing";
import CustomerTeamPage from "@/pages/customer-team";
import ConfigStatePage from "@/pages/config-state";
import EmailAuthSetupPage from "@/pages/email-auth-setup";
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import AccountSetupPage from "@/pages/account-setup";
import SignInHelpPage from "@/pages/sign-in-help";
import SignupPage from "@/pages/signup";
import SignupSuccessPage from "@/pages/signup-success";
import AcceptInvitePage from "@/pages/accept-invite";
import SharedDocumentPublicPage from "@/pages/shared-document-public";
import SharedLiveDocumentsPublicPage from "@/pages/shared-live-documents-public";
import MspSowPublicPage from "@/pages/msp-sow-public";
import NotificationPreferencesPage from "@/pages/notification-preferences";
import WebhooksPage from "@/pages/webhooks";
import SopsPage from "@/pages/sops";
import RunbooksPage from "@/pages/runbooks";
import RiskRegisterPage from "@/pages/risk-register";
import PoamsPage from "@/pages/poams";
import PolicyDecisionsPage from "@/pages/policy-decisions";
import OwnershipPage from "@/pages/ownership";
import SecurityPlanPage from "@/pages/security-plan";
import MyArchitectPage from "@/pages/my-architect";
import StatusReportsPage from "@/pages/status-reports";
import RemediationTrackingPage from "@/pages/remediation-tracking";
import MicrosoftChangesPage from "@/pages/microsoft-changes";
import ChangeControlPage from "@/pages/change-control";
import ScopeAndSlaPage from "@/pages/scope-and-sla";
import OffboardingPage from "@/pages/offboarding";
import PillarPage from "@/pages/pillar";
import ProjectDetailPage from "@/pages/project-detail";
import CustomerDiagnosticsPage from "@/pages/customer-diagnostics";
import BreakGlassStatusPage from "@/pages/break-glass-status";
import BreakGlassVerifyPage from "@/pages/break-glass-verify";
import CustomerDocumentsPage from "@/pages/customer-documents";
import NotFound from "@/pages/not-found";
import ConsentSuccessPage from "@/pages/consent-success";
import ConsentDeclinedPage from "@/pages/consent-declined";
import ConsentTenantConflictPage from "@/pages/consent-tenant-conflict";
import OnboardingLinkPage from "@/pages/onboarding-link";
import PortalIdentityInterstitialPage from "@/pages/portal-identity-interstitial";

const queryClient = new QueryClient();

// This SPA mounts under /portal/ in every environment (see vite.config.ts and
// .replit-artifact/artifact.toml). wouter's Router base takes the path without
// the trailing slash.
const ROUTER_BASE = (import.meta.env.BASE_URL || "/portal/").replace(/\/$/, "");

// The auth model is carried verbatim from the retired portal (real, wired to
// /api/auth/*). #2991 (Feature #1648, Auth Core) wired the 6 real screens
// this now links to, so an unauthenticated visitor gets a real path in
// instead of a dead end.
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  // Feature #1650 / Git #3993 — a staff role that authenticated at the
  // customer-facing /portal/ login instead of /admin-panel/ gets the
  // interstitial once per browser tab (not persisted — a hard reload or a
  // fresh tab re-asks, matching the archived page's own "client-side only,
  // no request made to decide this" framing).
  const [staffAcknowledged, setStaffAcknowledged] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background px-6"
        data-testid="require-auth-panel"
      >
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-extrabold text-foreground">Sign in required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You need to be signed in to view the customer portal.
          </p>
          <Link href="/login" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
            Go to sign in →
          </Link>
        </div>
      </div>
    );
  }

  if (user.mspRole && user.mspRole !== "CustomerUser" && !staffAcknowledged) {
    return <PortalIdentityInterstitialPage onContinue={() => setStaffAcknowledged(true)} />;
  }

  return <>{children}</>;
}

function ProtectedRoutes() {
  return (
    <RequireAuth>
      <PortalLayout>
        <Switch>
          <Route path="/" component={IndexPage} />
          <Route path="/support" component={SupportPage} />
          <Route path="/requests" component={CustomerRequestsPage} />
          <Route path="/account-security" component={AccountSecurityPage} />
          <Route path="/privacy" component={DataRightsAndPrivacyPage} />
          <Route path="/billing" component={BillingPage} />
          <Route path="/team" component={CustomerTeamPage} />
          <Route path="/config-state" component={ConfigStatePage} />
          <Route path="/email-auth-setup" component={EmailAuthSetupPage} />
          <Route path="/notification-preferences" component={NotificationPreferencesPage} />
          <Route path="/webhooks" component={WebhooksPage} />
          <Route path="/sops" component={SopsPage} />
          <Route path="/runbooks" component={RunbooksPage} />
          <Route path="/risk-register" component={RiskRegisterPage} />
          <Route path="/poams" component={PoamsPage} />
          <Route path="/policy-decisions" component={PolicyDecisionsPage} />
          <Route path="/ownership" component={OwnershipPage} />
          <Route path="/security-plan" component={SecurityPlanPage} />
          <Route path="/documents" component={CustomerDocumentsPage} />
          <Route path="/my-architect" component={MyArchitectPage} />
          <Route path="/status-reports" component={StatusReportsPage} />
          <Route path="/status-reports/:id" component={StatusReportsPage} />
          <Route path="/remediation-tracking" component={RemediationTrackingPage} />
          <Route path="/microsoft-changes" component={MicrosoftChangesPage} />
          <Route path="/change-control" component={ChangeControlPage} />
          <Route path="/scope-and-sla" component={ScopeAndSlaPage} />
          <Route path="/diagnostics" component={CustomerDiagnosticsPage} />
          <Route path="/offboarding" component={OffboardingPage} />
          <Route path="/pillars/:pillar" component={PillarPage} />
          {/* Projects (#1739, Feature #1570) — by-id only, no list route on
              the server, so no sidebar entry; reached from a link. */}
          <Route path="/projects/:id" component={ProjectDetailPage} />
          <Route path="/break-glass" component={BreakGlassStatusPage} />
          <Route path="/break-glass/:runId" component={BreakGlassStatusPage} />
          <Route path="/coming-soon" component={ComingSoon} />
          <Route component={NotFound} />
        </Switch>
      </PortalLayout>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <SlugProvider slug={getStoredSlug() ?? ""}>
            <WouterRouter base={ROUTER_BASE}>
              {/*
                Auth Core (#2991, Feature #1648) — the 5 unauthenticated
                entry points render OUTSIDE RequireAuth/PortalLayout: a
                logged-out visitor has no session for PortalLayout's shell to
                key off, and these routes are precisely the ones reachable
                without one. The MFA challenge is not a separate route — see
                pages/login.tsx's own header comment.
              */}
              <Switch>
                <Route path="/login" component={LoginPage} />
                <Route path="/forgot-password" component={ForgotPasswordPage} />
                <Route path="/reset-password" component={ResetPasswordPage} />
                <Route path="/account-setup" component={AccountSetupPage} />
                <Route path="/sign-in-help" component={SignInHelpPage} />
                {/*
                  Signup, Agreement and Invite (#3992, Feature #1649) — public,
                  unauthenticated. Paths are load-bearing: msp-signup.ts's own
                  Stripe success_url/cancel_url are literally
                  `${portalBase}/signup/success` and `${portalBase}/signup`.
                */}
                <Route path="/signup" component={SignupPage} />
                <Route path="/signup/success" component={SignupSuccessPage} />
                <Route path="/invite/:token" component={AcceptInvitePage} />
                {/* Public break-glass verify landing (#3994) — every invite email
                    links here, and the recipient may have no portal account at
                    all. Must stay ahead of ProtectedRoutes' /break-glass/:runId. */}
                <Route path="/break-glass/verify/:token" component={BreakGlassVerifyPage} />
                {/*
                  Consent and Onboarding (Feature #1650, Git #3993) — the
                  "portal"-origin redirect targets of GET /api/consent/callback
                  and the public invite-link landing page. None of these carry
                  a requireRole gate server-side (contract pack #2758 §1/§6a),
                  so they render outside RequireAuth like the Auth Core screens
                  above.
                */}
                <Route path="/consent/success" component={ConsentSuccessPage} />
                <Route path="/consent/declined" component={ConsentDeclinedPage} />
                <Route path="/consent/tenant-conflict" component={ConsentTenantConflictPage} />
                <Route path="/onboarding/:token" component={OnboardingLinkPage} />
{/*
                  Public Share Pages (#4001, Feature #1663) — public,
                  unauthenticated, no session context available. Paths are
                  load-bearing: the server mints share URLs literally as
                  `{getMspPortalBaseUrl()}/shared-documents/{shareToken}`,
                  `/shared-live-documents/{token}`, and the shareUrl
                  msp-sow.ts's mint routes never construct directly, but the
                  frontend historically served at `/sow/{shareToken}`.

                  #4003 (Feature #1658, Documents) built its own
                  SharedDocumentPage against this exact route + endpoint
                  concurrently with this build landing — dropped in favor of
                  this SharedDocumentPublicPage, which reached main first.
                */}
                <Route path="/shared-documents/:shareToken" component={SharedDocumentPublicPage} />
                <Route path="/shared-live-documents/:shareToken" component={SharedLiveDocumentsPublicPage} />
                <Route path="/sow/:shareToken" component={MspSowPublicPage} />
                <Route>
                  <ProtectedRoutes />
                </Route>
              </Switch>
            </WouterRouter>
          </SlugProvider>
          <Toaster richColors closeButton />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
