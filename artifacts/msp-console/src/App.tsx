import { Redirect, Route, Switch, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { AuthGate } from "@/console/AuthGate";
import NotFound from "@/pages/not-found";
import SignInPage from "@/auth/SignInPage";
import TwoFactorPage from "@/auth/TwoFactorPage";
import ForgotPasswordPage from "@/auth/ForgotPasswordPage";
import ChangeMfaPage from "@/auth/ChangeMfaPage";
import SessionsPage from "@/auth/SessionsPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// This SPA mounts under /msp-console/ in every environment (see vite.config.ts
// and .replit). wouter's Router base takes the path without the trailing slash.
const ROUTER_BASE = (import.meta.env.BASE_URL || "/msp-console/").replace(/\/$/, "");

// Every console route renders the same AuthGate → ConsoleShell; the shell derives
// its selection from the URL (README "Navigation": each selection has a real URL).
function AppRoutes() {
  return (
    <Switch>
      {/* Pre-login / self-service auth routes (screen 38, Git #3814) —
          standalone, outside AuthGate/ConsoleShell: sign-in happens before
          the shell exists (README, "Where they sit in the tree"). */}
      <Route path="/login" component={SignInPage} />
      <Route path="/mfa" component={TwoFactorPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/account/mfa" component={ChangeMfaPage} />
      <Route path="/account/sessions" component={SessionsPage} />

      <Route path="/">{() => <Redirect to="/tenants" />}</Route>
      <Route path="/tenants" component={AuthGate} />
      <Route path="/tenants/:id" component={AuthGate} />
      <Route path="/tenants/:id/:page" component={AuthGate} />
      <Route path="/ops/:page" component={AuthGate} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={ROUTER_BASE}>
          <AppRoutes />
        </WouterRouter>
      </AuthProvider>
      <Toaster richColors closeButton theme="dark" />
    </QueryClientProvider>
  );
}
