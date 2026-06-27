import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { InboxProvider } from "@/contexts/InboxContext";
import LoginPage from "@/pages/Login";
import DashboardShell from "@/components/DashboardShell";
import ArticlesPage from "@/pages/Articles";
import ServicesPage from "@/pages/Services";
import WorkflowsPage from "@/pages/Workflows";
import ContractTemplatesPage from "@/pages/ContractTemplates";
import EngagementProjectsPage from "@/pages/EngagementProjects";
import LeadsPage from "@/pages/crm/Leads";
import LeadDetailPage from "@/pages/crm/LeadDetail";
import ClientsPage from "@/pages/crm/Clients";
import ClientDetailPage from "@/pages/crm/ClientDetail";
import ProjectsPage from "@/pages/crm/Projects";
import ProjectDetailPage from "@/pages/crm/ProjectDetail";
import ReportsPage from "@/pages/crm/Reports";
import InvoicesPage from "@/pages/crm/Invoices";
import InvoiceDetailPage from "@/pages/crm/InvoiceDetail";
import DocumentsPage from "@/pages/crm/Documents";
import MessagesPage from "@/pages/crm/Messages";
import PurchasesPage from "@/pages/crm/Purchases";
import PurchaseDetailPage from "@/pages/crm/PurchaseDetail";
import ContractsPage from "@/pages/crm/Contracts";
import StatusReportsPage from "@/pages/crm/StatusReports";
import TestimonialsPage from "@/pages/crm/Testimonials";
import M365IntelligencePage from "@/pages/crm/M365Intelligence";
import QuizLeadsPage from "@/pages/crm/QuizLeads";
import QuizPainConfigPage from "@/pages/crm/QuizPainConfig";
import OpportunitiesPage from "@/pages/crm/Opportunities";
import OpportunityDetailPage from "@/pages/crm/OpportunityDetail";
import OverviewPage from "@/pages/Overview";
import AnalyticsPage from "@/pages/Analytics";
import EmailActivityPage from "@/pages/EmailActivity";
import InboxPage from "@/pages/inbox/Inbox";
import ActivityLogPage from "@/pages/ActivityLog";
import SharePointPage from "@/pages/SharePoint";
import TemplateLibraryPage from "@/pages/templates/TemplateLibrary";
import InstructionSetsPage from "@/pages/asset-library/InstructionSetsPage";
import ChecklistsPage from "@/pages/asset-library/ChecklistsPage";
import ArtifactSetsPage from "@/pages/asset-library/ArtifactSetsPage";
import DeliverableSetsPage from "@/pages/asset-library/DeliverableSetsPage";
import CategoriesPage from "@/pages/asset-library/CategoriesPage";
import EmailTemplatesPage from "@/pages/EmailTemplates";
import CouponsPage from "@/pages/Coupons";
import ServicePageTriggersPage from "@/pages/ServicePageTriggers";
import ScriptRunnerPage from "@/pages/ScriptRunner";
import M365ScriptCatalogPage from "@/pages/M365ScriptCatalog";
import M365RunResultsPage from "@/pages/M365RunResults";
import AdminSecurity from "@/pages/AdminSecurity";
import MarketingCommandCenterPage from "@/pages/MarketingCommandCenter";
import type { ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0D1117]">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user || user.role !== "admin") {
    // Preserve the intended destination so we can restore it after login
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const rel = window.location.pathname.replace(base, "") + window.location.search;
    if (rel && rel !== "/" && !rel.startsWith("/login")) {
      sessionStorage.setItem("adminReturnTo", rel);
    }
    return <Redirect to="/login" />;
  }
  return <>{children}</>;
}

// After a successful login, redirect to the page the user originally tried to visit
// (stored in sessionStorage by RequireAdmin), or fall back to the overview.
function PostLoginRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    const returnTo = sessionStorage.getItem("adminReturnTo") ?? "";
    sessionStorage.removeItem("adminReturnTo");
    navigate(returnTo && !returnTo.startsWith("/login") ? returnTo : "/overview", { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0D1117]">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/login">
        {user && user.role === "admin" ? <PostLoginRedirect /> : <LoginPage />}
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
      <Route path="/crm/leads/:id">
        {(params) => <RequireAdmin><DashboardShell><LeadDetailPage params={params} /></DashboardShell></RequireAdmin>}
      </Route>
      <Route path="/crm/leads">
        <RequireAdmin><DashboardShell><LeadsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/clients/:id">
        <RequireAdmin><DashboardShell><ClientDetailPage /></DashboardShell></RequireAdmin>
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
      <Route path="/crm/invoices/:id">
        <RequireAdmin><DashboardShell><InvoiceDetailPage /></DashboardShell></RequireAdmin>
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
      <Route path="/crm/purchases/:id">
        <RequireAdmin><DashboardShell><PurchaseDetailPage /></DashboardShell></RequireAdmin>
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
      <Route path="/crm/testimonials">
        <RequireAdmin><DashboardShell><TestimonialsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/m365-intelligence">
        <RequireAdmin><DashboardShell><M365IntelligencePage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/quiz-leads">
        <RequireAdmin><DashboardShell><QuizLeadsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/quiz-pain-config">
        <RequireAdmin><DashboardShell><QuizPainConfigPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/crm/opportunities/:id">
        {(params) => <RequireAdmin><DashboardShell><OpportunityDetailPage params={params} /></DashboardShell></RequireAdmin>}
      </Route>
      <Route path="/crm/opportunities">
        <RequireAdmin><DashboardShell><OpportunitiesPage /></DashboardShell></RequireAdmin>
      </Route>

      {/* Analytics */}
      <Route path="/analytics">
        <RequireAdmin><DashboardShell><AnalyticsPage /></DashboardShell></RequireAdmin>
      </Route>

      {/* Inbox (replaces Email Activity) */}
      <Route path="/inbox">
        <RequireAdmin><DashboardShell><InboxPage /></DashboardShell></RequireAdmin>
      </Route>

      {/* Legacy email-activity redirect */}
      <Route path="/email-activity">
        <Redirect to="/inbox" />
      </Route>

      {/* Activity Log */}
      <Route path="/activity-log">
        <RequireAdmin><DashboardShell><ActivityLogPage /></DashboardShell></RequireAdmin>
      </Route>

      {/* SharePoint Hub */}
      <Route path="/sharepoint">
        <RequireAdmin><DashboardShell><SharePointPage /></DashboardShell></RequireAdmin>
      </Route>

      {/* Template Library */}
      <Route path="/templates/library">
        <RequireAdmin><DashboardShell><TemplateLibraryPage /></DashboardShell></RequireAdmin>
      </Route>

      {/* Asset Library */}
      <Route path="/asset-library/instruction-sets">
        <RequireAdmin><DashboardShell><InstructionSetsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/asset-library/checklists">
        <RequireAdmin><DashboardShell><ChecklistsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/asset-library/artifact-sets">
        <RequireAdmin><DashboardShell><ArtifactSetsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/asset-library/deliverable-sets">
        <RequireAdmin><DashboardShell><DeliverableSetsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/asset-library/categories">
        <RequireAdmin><DashboardShell><CategoriesPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/email-templates">
        <RequireAdmin><DashboardShell><EmailTemplatesPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/coupons">
        <RequireAdmin><DashboardShell><CouponsPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/service-page-triggers">
        <RequireAdmin><DashboardShell><ServicePageTriggersPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/script-runner">
        <RequireAdmin><DashboardShell><ScriptRunnerPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/m365-scripts">
        <RequireAdmin><DashboardShell><M365ScriptCatalogPage /></DashboardShell></RequireAdmin>
      </Route>
      <Route path="/m365-run-results">
        <RequireAdmin><DashboardShell><M365RunResultsPage /></DashboardShell></RequireAdmin>
      </Route>

      {/* Marketing Command Center */}
      <Route path="/marketing-command-center">
        <RequireAdmin><DashboardShell><MarketingCommandCenterPage /></DashboardShell></RequireAdmin>
      </Route>

      {/* Security */}
      <Route path="/security">
        <RequireAdmin><AdminSecurity /></RequireAdmin>
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
        <InboxProvider>
        <div className="flex flex-col h-screen overflow-hidden">
          {import.meta.env.DEV && (
            <div className="flex-shrink-0 flex items-center justify-center gap-2 bg-amber-400 text-amber-950 text-xs font-semibold py-1 px-3 select-none">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-700 animate-pulse" />
              DEVELOPMENT ENVIRONMENT — changes here do not affect production
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
          </div>
        </div>
        <Toaster />
        </InboxProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
