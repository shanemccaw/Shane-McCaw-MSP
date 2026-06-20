import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/Login";
import DashboardShell from "@/components/DashboardShell";
import ArticlesPage from "@/pages/Articles";
import ServicesPage from "@/pages/Services";
import WorkflowsPage from "@/pages/Workflows";
import ContractTemplatesPage from "@/pages/ContractTemplates";
import EngagementProjectsPage from "@/pages/EngagementProjects";
import LeadsPage from "@/pages/crm/Leads";
import ClientsPage from "@/pages/crm/Clients";
import ProjectsPage from "@/pages/crm/Projects";
import ProjectDetailPage from "@/pages/crm/ProjectDetail";
import ReportsPage from "@/pages/crm/Reports";
import InvoicesPage from "@/pages/crm/Invoices";
import DocumentsPage from "@/pages/crm/Documents";
import MessagesPage from "@/pages/crm/Messages";
import PurchasesPage from "@/pages/crm/Purchases";
import ContractsPage from "@/pages/crm/Contracts";
import StatusReportsPage from "@/pages/crm/StatusReports";
import OverviewPage from "@/pages/Overview";
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
        {user && user.role === "admin" ? <Redirect to="/overview" /> : <LoginPage />}
      </Route>
      <Route path="/">
        {user && user.role === "admin" ? <Redirect to="/overview" /> : <Redirect to="/login" />}
      </Route>

      {/* Overview */}
      <Route path="/overview">
        <RequireAdmin><DashboardShell><OverviewPage /></DashboardShell></RequireAdmin>
      </Route>

      {/* Content */}
      <Route path="/articles">
        <RequireAdmin><DashboardShell><ArticlesPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/services">
        <RequireAdmin><DashboardShell><ServicesPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/workflows">
        <RequireAdmin><DashboardShell><WorkflowsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/contract-templates">
        <RequireAdmin><DashboardShell><ContractTemplatesPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/engagement-projects">
        <RequireAdmin><DashboardShell><EngagementProjectsPage /></DashboardShell></RequireAdmin>
      </Route>

      {/* CRM */}
      <Route path="/crm/leads">
        <RequireAdmin><DashboardShell><LeadsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/clients">
        <RequireAdmin><DashboardShell><ClientsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/projects/:id">
        <RequireAdmin><DashboardShell><ProjectDetailPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/projects">
        <RequireAdmin><DashboardShell><ProjectsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/reports">
        <RequireAdmin><DashboardShell><ReportsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/invoices">
        <RequireAdmin><DashboardShell><InvoicesPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/documents">
        <RequireAdmin><DashboardShell><DocumentsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/messages">
        <RequireAdmin><DashboardShell><MessagesPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/purchases">
        <RequireAdmin><DashboardShell><PurchasesPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/contracts">
        <RequireAdmin><DashboardShell><ContractsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/status-reports">
        <RequireAdmin><DashboardShell><StatusReportsPage /></DashboardShell></RequireAdmin>
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
