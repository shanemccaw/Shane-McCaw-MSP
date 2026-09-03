import { Route, Switch, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import IndexPage from "@/pages/index";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

// This SPA mounts under /msp-console/ in every environment (see vite.config.ts and
// .replit). wouter's Router base takes the path without the trailing slash.
const ROUTER_BASE = (import.meta.env.BASE_URL || "/msp-console/").replace(/\/$/, "");

// Real bare frame only (#2668) — no chrome, no auth gate yet. That's the next
// issue in this Feature's own chain (#2667) once Design lands for this app; a
// placeholder page here is honest, a fabricated shell is not.
function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={IndexPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={ROUTER_BASE}>
        <AppRoutes />
      </WouterRouter>
      <Toaster richColors closeButton />
    </QueryClientProvider>
  );
}
