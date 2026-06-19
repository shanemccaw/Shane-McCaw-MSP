import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/Login";
import DashboardShell from "@/components/DashboardShell";
import ArticlesPage from "@/pages/Articles";
import ServicesPage from "@/pages/Services";
import WorkflowsPage from "@/pages/Workflows";
import ProjectTemplatesPage from "@/pages/ProjectTemplates";
import ContractTemplatesPage from "@/pages/ContractTemplates";
import type { ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user || user.role !== "admin") return <Redirect to="/login" />;
  return <>{children}</>;
}

function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/login">
        {user && user.role === "admin" ? <Redirect to="/articles" /> : <LoginPage />}
      </Route>
      <Route path="/">
        {user && user.role === "admin" ? <Redirect to="/articles" /> : <Redirect to="/login" />}
      </Route>
      <Route path="/articles">
        <RequireAdmin>
          <DashboardShell><ArticlesPage /></DashboardShell>
        </RequireAdmin>
      </Route>
      <Route path="/services">
        <RequireAdmin>
          <DashboardShell><ServicesPage /></DashboardShell>
        </RequireAdmin>
      </Route>
      <Route path="/workflows">
        <RequireAdmin>
          <DashboardShell><WorkflowsPage /></DashboardShell>
        </RequireAdmin>
      </Route>
      <Route path="/project-templates">
        <RequireAdmin>
          <DashboardShell><ProjectTemplatesPage /></DashboardShell>
        </RequireAdmin>
      </Route>
      <Route path="/contract-templates">
        <RequireAdmin>
          <DashboardShell><ContractTemplatesPage /></DashboardShell>
        </RequireAdmin>
      </Route>
      <Route>
        <Redirect to="/login" />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
