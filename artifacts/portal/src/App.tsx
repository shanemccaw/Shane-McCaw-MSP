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
import AccountSecurityPage from "@/pages/account-security";
import BillingPage from "@/pages/billing";
import ConfigStatePage from "@/pages/config-state";
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import AccountSetupPage from "@/pages/account-setup";
import SignInHelpPage from "@/pages/sign-in-help";
import NotificationPreferencesPage from "@/pages/notification-preferences";
import WebhooksPage from "@/pages/webhooks";
import SopsPage from "@/pages/sops";
import RunbooksPage from "@/pages/runbooks";
import RiskRegisterPage from "@/pages/risk-register";
import PolicyDecisionsPage from "@/pages/policy-decisions";
import OwnershipPage from "@/pages/ownership";
import SecurityPlanPage from "@/pages/security-plan";
import RemediationTrackingPage from "@/pages/remediation-tracking";
import MicrosoftChangesPage from "@/pages/microsoft-changes";
import ChangeControlPage from "@/pages/change-control";
import PillarPage from "@/pages/pillar";
import NotFound from "@/pages/not-found";

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

  return <>{children}</>;
}

function ProtectedRoutes() {
  return (
    <RequireAuth>
      <PortalLayout>
        <Switch>
          <Route path="/" component={IndexPage} />
          <Route path="/support" component={SupportPage} />
          <Route path="/account-security" component={AccountSecurityPage} />
          <Route path="/billing" component={BillingPage} />
          <Route path="/config-state" component={ConfigStatePage} />
          <Route path="/notification-preferences" component={NotificationPreferencesPage} />
          <Route path="/webhooks" component={WebhooksPage} />
          <Route path="/sops" component={SopsPage} />
          <Route path="/runbooks" component={RunbooksPage} />
          <Route path="/risk-register" component={RiskRegisterPage} />
          <Route path="/policy-decisions" component={PolicyDecisionsPage} />
          <Route path="/ownership" component={OwnershipPage} />
          <Route path="/security-plan" component={SecurityPlanPage} />
          <Route path="/remediation-tracking" component={RemediationTrackingPage} />
          <Route path="/microsoft-changes" component={MicrosoftChangesPage} />
          <Route path="/change-control" component={ChangeControlPage} />
          <Route path="/pillars/:pillar" component={PillarPage} />
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
