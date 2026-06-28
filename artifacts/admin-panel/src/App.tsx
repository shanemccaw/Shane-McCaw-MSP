import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { InboxProvider } from "@/contexts/InboxContext";
import LoginPage from "@/pages/Login";
import DashboardShell from "@/components/DashboardShell";

// ─── Workspace pages ──────────────────────────────────────────────────────────
import CommandWorkspace from "@/pages/workspaces/CommandWorkspace";
import PipelineWorkspace from "@/pages/workspaces/PipelineWorkspace";
import DeliveryWorkspace from "@/pages/workspaces/DeliveryWorkspace";
import FinanceWorkspace from "@/pages/workspaces/FinanceWorkspace";
import ContentWorkspace from "@/pages/workspaces/ContentWorkspace";
import SystemWorkspace from "@/pages/workspaces/SystemWorkspace";

// ─── Detail pages (open without workspace layout) ─────────────────────────────
import LeadDetailPage from "@/pages/crm/LeadDetail";
import ClientDetailPage from "@/pages/crm/ClientDetail";
import ProjectDetailPage from "@/pages/crm/ProjectDetail";
import InvoiceDetailPage from "@/pages/crm/InvoiceDetail";
import PurchaseDetailPage from "@/pages/crm/PurchaseDetail";
import OpportunityDetailPage from "@/pages/crm/OpportunityDetail";
import PromptCenterEditPage from "@/pages/PromptCenterEdit";

// ─── Standalone pages (remain at legacy paths, still need DashboardShell) ────
import DocumentsPage from "@/pages/crm/Documents";
import StatusReportsPage from "@/pages/crm/StatusReports";
import TestimonialsPage from "@/pages/crm/Testimonials";
import ChecklistsPage from "@/pages/asset-library/ChecklistsPage";
import ArtifactSetsPage from "@/pages/asset-library/ArtifactSetsPage";
import DeliverableSetsPage from "@/pages/asset-library/DeliverableSetsPage";
import CategoriesPage from "@/pages/asset-library/CategoriesPage";

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
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const rel = window.location.pathname.replace(base, "") + window.location.search;
    if (rel && rel !== "/" && !rel.startsWith("/login")) {
      sessionStorage.setItem("adminReturnTo", rel);
    }
    return <Redirect to="/login" />;
  }
  return <>{children}</>;
}

function PostLoginRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    const returnTo = sessionStorage.getItem("adminReturnTo") ?? "";
    sessionStorage.removeItem("adminReturnTo");
    navigate(returnTo && !returnTo.startsWith("/login") ? returnTo : "/command/overview", { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ─── Shorthand wrapper ────────────────────────────────────────────────────────

function AdminRoute({ children }: { children: ReactNode }) {
  return <RequireAdmin><DashboardShell>{children}</DashboardShell></RequireAdmin>;
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
      {/* ── Auth ── */}
      <Route path="/login">
        {user && user.role === "admin" ? <PostLoginRedirect /> : <LoginPage />}
      </Route>
      <Route path="/">
        {user && user.role === "admin" ? <Redirect to="/command/overview" /> : <Redirect to="/login" />}
      </Route>

      {/* ── COMMAND workspace ── */}
      <Route path="/command">
        <Redirect to="/command/overview" />
      </Route>
      <Route path="/command/:section">
        {(params) => (
          <AdminRoute>
            <CommandWorkspace section={params?.section ?? "overview"} />
          </AdminRoute>
        )}
      </Route>

      {/* ── PIPELINE workspace ── */}
      <Route path="/pipeline">
        <Redirect to="/pipeline/leads" />
      </Route>
      <Route path="/pipeline/:section">
        {(params) => (
          <AdminRoute>
            <PipelineWorkspace section={params?.section ?? "leads"} />
          </AdminRoute>
        )}
      </Route>

      {/* ── DELIVERY workspace ── */}
      <Route path="/delivery">
        <Redirect to="/delivery/projects" />
      </Route>
      <Route path="/delivery/:section">
        {(params) => (
          <AdminRoute>
            <DeliveryWorkspace section={params?.section ?? "projects"} />
          </AdminRoute>
        )}
      </Route>

      {/* ── FINANCE workspace ── */}
      <Route path="/finance">
        <Redirect to="/finance/invoices" />
      </Route>
      <Route path="/finance/:section">
        {(params) => (
          <AdminRoute>
            <FinanceWorkspace section={params?.section ?? "invoices"} />
          </AdminRoute>
        )}
      </Route>

      {/* ── CONTENT workspace ── */}
      <Route path="/content">
        <Redirect to="/content/articles" />
      </Route>
      <Route path="/content/:section">
        {(params) => (
          <AdminRoute>
            <ContentWorkspace section={params?.section ?? "articles"} />
          </AdminRoute>
        )}
      </Route>

      {/* ── SYSTEM workspace ── */}
      <Route path="/system">
        <Redirect to="/system/inbox" />
      </Route>
      <Route path="/system/:section">
        {(params) => (
          <AdminRoute>
            <SystemWorkspace section={params?.section ?? "inbox"} />
          </AdminRoute>
        )}
      </Route>

      {/* ── Detail pages (no workspace layout changes needed) ── */}
      <Route path="/crm/leads/:id">
        {(params) => <AdminRoute><LeadDetailPage params={params} /></AdminRoute>}
      </Route>
      <Route path="/crm/clients/:id">
        <AdminRoute><ClientDetailPage /></AdminRoute>
      </Route>
      <Route path="/crm/projects/:id">
        <AdminRoute><ProjectDetailPage /></AdminRoute>
      </Route>
      <Route path="/crm/invoices/:id">
        <AdminRoute><InvoiceDetailPage /></AdminRoute>
      </Route>
      <Route path="/crm/purchases/:id">
        <AdminRoute><PurchaseDetailPage /></AdminRoute>
      </Route>
      <Route path="/crm/opportunities/:id">
        {(params) => <AdminRoute><OpportunityDetailPage params={params} /></AdminRoute>}
      </Route>
      <Route path="/prompt-center/:id">
        {(params) => <AdminRoute><PromptCenterEditPage params={params} /></AdminRoute>}
      </Route>

      {/* ── Standalone pages still at legacy paths ── */}
      <Route path="/crm/documents">
        <AdminRoute><DocumentsPage /></AdminRoute>
      </Route>
      <Route path="/crm/status-reports">
        <AdminRoute><StatusReportsPage /></AdminRoute>
      </Route>
      <Route path="/crm/testimonials">
        <AdminRoute><TestimonialsPage /></AdminRoute>
      </Route>
      <Route path="/asset-library/checklists">
        <AdminRoute><ChecklistsPage /></AdminRoute>
      </Route>
      <Route path="/asset-library/artifact-sets">
        <AdminRoute><ArtifactSetsPage /></AdminRoute>
      </Route>
      <Route path="/asset-library/deliverable-sets">
        <AdminRoute><DeliverableSetsPage /></AdminRoute>
      </Route>
      <Route path="/asset-library/categories">
        <AdminRoute><CategoriesPage /></AdminRoute>
      </Route>

      {/* ── Old routes → workspace redirects ── */}
      <Route path="/overview"><Redirect to="/command/overview" /></Route>
      <Route path="/analytics"><Redirect to="/command/analytics" /></Route>
      <Route path="/marketing-command-center"><Redirect to="/command/marketing" /></Route>
      <Route path="/prompt-center"><Redirect to="/command/prompts" /></Route>
      <Route path="/m365-scripts"><Redirect to="/command/scripts" /></Route>
      <Route path="/script-runner"><Redirect to="/command/scripts" /></Route>
      <Route path="/m365-run-results"><Redirect to="/command/scripts" /></Route>

      <Route path="/crm/leads"><Redirect to="/pipeline/leads" /></Route>
      <Route path="/crm/quiz-leads"><Redirect to="/pipeline/quiz-leads" /></Route>
      <Route path="/crm/opportunities"><Redirect to="/pipeline/opportunities" /></Route>
      <Route path="/crm/clients"><Redirect to="/pipeline/clients" /></Route>
      <Route path="/crm/m365-intelligence"><Redirect to="/pipeline/m365-intelligence" /></Route>
      <Route path="/crm/messages"><Redirect to="/command/messages" /></Route>

      <Route path="/crm/projects"><Redirect to="/delivery/projects" /></Route>
      <Route path="/engagement-projects"><Redirect to="/delivery/engagement-projects" /></Route>
      <Route path="/workflows"><Redirect to="/delivery/workflows" /></Route>
      <Route path="/activity-log"><Redirect to="/delivery/activity-logs" /></Route>
      <Route path="/sharepoint"><Redirect to="/delivery/hub-storage" /></Route>

      <Route path="/crm/invoices"><Redirect to="/finance/invoices" /></Route>
      <Route path="/crm/purchases"><Redirect to="/finance/purchases" /></Route>
      <Route path="/crm/contracts"><Redirect to="/finance/contracts" /></Route>
      <Route path="/coupons"><Redirect to="/finance/coupons" /></Route>
      <Route path="/crm/reports"><Redirect to="/finance/reports" /></Route>

      <Route path="/articles"><Redirect to="/content/articles" /></Route>
      <Route path="/services"><Redirect to="/content/services" /></Route>
      <Route path="/service-page-triggers"><Redirect to="/content/service-triggers" /></Route>
      <Route path="/email-templates"><Redirect to="/content/email-templates" /></Route>
      <Route path="/contract-templates"><Redirect to="/content/contract-templates" /></Route>
      <Route path="/templates/library"><Redirect to="/content/template-library" /></Route>
      <Route path="/asset-library/instruction-sets"><Redirect to="/content/asset-library" /></Route>

      <Route path="/inbox"><Redirect to="/system/inbox" /></Route>
      <Route path="/security"><Redirect to="/system/security" /></Route>
      <Route path="/crm/quiz-pain-config"><Redirect to="/system/signal-mappings" /></Route>

      {/* ── Catch-all ── */}
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
