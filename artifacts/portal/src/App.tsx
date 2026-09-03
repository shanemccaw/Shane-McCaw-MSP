import { Route, Switch, Router as WouterRouter } from "wouter";
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
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

// This SPA mounts under /portal/ in every environment (see vite.config.ts and
// .replit-artifact/artifact.toml). wouter's Router base takes the path without
// the trailing slash.
const ROUTER_BASE = (import.meta.env.BASE_URL || "/portal/").replace(/\/$/, "");

// The auth model is carried verbatim from the retired portal (real, wired to
// /api/auth/*). Until a login page is rebuilt under its own issue, an
// unauthenticated visitor sees an honest sign-in-required panel rather than a
// redirect to a route that does not exist yet.
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
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-extrabold text-foreground">Sign in required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You need to be signed in to view the customer portal.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <PortalLayout>
      <Switch>
        <Route path="/" component={IndexPage} />
        <Route path="/support" component={SupportPage} />
        <Route path="/coming-soon" component={ComingSoon} />
        <Route component={NotFound} />
      </Switch>
    </PortalLayout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <SlugProvider slug={getStoredSlug() ?? ""}>
            <WouterRouter base={ROUTER_BASE}>
              <RequireAuth>
                <AppRoutes />
              </RequireAuth>
            </WouterRouter>
          </SlugProvider>
          <Toaster richColors closeButton />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
