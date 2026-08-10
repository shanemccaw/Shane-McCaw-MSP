import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { InboxProvider } from "@/contexts/InboxContext";
import LoginPage from "@/pages/Login";
import GlobalIDEShell from "@/components/GlobalIDEShell";
import { AdminDebugPanel } from "@/components/debug/AdminDebugPanel";
import { AdminMfaSetupGate } from "@/components/AdminMfaSetupGate";

// ─── Workspace pages ──────────────────────────────────────────────────────────
import CommandWorkspace from "@/pages/workspaces/CommandWorkspace";
import PipelineWorkspace from "@/pages/workspaces/PipelineWorkspace";
import DeliveryWorkspace from "@/pages/workspaces/DeliveryWorkspace";
import FinanceWorkspace from "@/pages/workspaces/FinanceWorkspace";
import ContentWorkspace from "@/pages/workspaces/ContentWorkspace";
import SystemWorkspace from "@/pages/workspaces/SystemWorkspace";
import WorkflowsWorkspace from "@/pages/workspaces/WorkflowsWorkspace";

// ─── Detail pages (open without workspace layout) ─────────────────────────────
import ClientDetailPage from "@/pages/crm/ClientDetail";
import ProjectDetailPage from "@/pages/crm/ProjectDetail";
import InvoiceDetailPage from "@/pages/crm/InvoiceDetail";
import PurchaseDetailPage from "@/pages/crm/PurchaseDetail";
import PromptCenterEditPage from "@/pages/PromptCenterEdit";

// ─── MSP Platform admin pages ─────────────────────────────────────────────────
import MspAdminPage from "@/pages/MspAdmin";
import PlanManagementPage from "@/pages/PlanManagement";
import MspOverridesPage from "@/pages/MspOverrides";
import MspReportsPage from "@/pages/MspReports";

// ─── Labs (experimental spikes, full-bleed, no IDE shell) ─────────────────────
import FactoryFloorLab from "@/pages/labs/FactoryFloorLab";
import ShanePlayground from "@/pages/ShanePlayground";

// ─── adminv2 (Simulator Studio shell — brings its own chrome) ─────────────────
import AdminV2 from "@/adminv2/AdminV2";

// ─── Standalone pages (remain at legacy paths, tree leaves in the IDE shell) ─
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

/**
 * Git #439 — real MFA enforcement gate, production only. Fetches the same
 * status AdminSecurity.tsx's settings page already reads (passkeyCount,
 * gateRequired) so RequireAdmin — the single choke point every admin route
 * already passes through — can force enrollment before rendering anything
 * else. requireAuth's mfaSetupPending allowlist on the backend is the real
 * security boundary; this is what redirects the UI to a working enrollment
 * screen instead of every other request just 403ing.
 */
function useAdminMfaGate(user: { role: string } | null): { loading: boolean; required: boolean; recheck: () => void } {
  const { fetchWithAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!user || user.role !== "admin") {
      setLoading(false);
      setRequired(false);
      return;
    }

    setLoading(true);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 8_000),
    );

    Promise.race([
      fetchWithAuth("/api/auth/mfa/enrollments").then((r) => r.json()),
      timeout,
    ])
      .then((data: { passkeyCount?: number; gateRequired?: boolean }) => {
        setRequired(!!data.gateRequired && !data.passkeyCount);
      })
      .catch(() => {
        // On timeout or any error, unblock the UI — don't gate forever.
        setRequired(false);
      })
      .finally(() => setLoading(false));
  }, [user, fetchWithAuth, generation]);

  return { loading, required, recheck: () => setGeneration((g) => g + 1) };
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const { loading: mfaLoading, required: mfaRequired, recheck: recheckMfaGate } = useAdminMfaGate(user);

  if (isLoading || mfaLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
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
  if (mfaRequired) {
    return <AdminMfaSetupGate onEnrolled={recheckMfaGate} />;
  }
  // The debug panel (#285) mounts here rather than per-page: this is the single
  // choke point every admin route already passes through, and putting it after
  // the role check means it is genuinely never mounted for a non-admin — the
  // network recorder never patches window.fetch — rather than rendered-and-hidden.
  return (
    <>
      {children}
      <AdminDebugPanel />
    </>
  );
}

function PostLoginRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    const returnTo = sessionStorage.getItem("adminReturnTo") ?? "";
    sessionStorage.removeItem("adminReturnTo");
    navigate(returnTo && !returnTo.startsWith("/login") ? returnTo : "/system/simulator", { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ─── Shorthand wrapper ────────────────────────────────────────────────────────

function AdminRoute({ children }: { children: ReactNode }) {
  return <RequireAdmin><GlobalIDEShell>{children}</GlobalIDEShell></RequireAdmin>;
}

function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
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
        {user && user.role === "admin" ? <Redirect to="/system/simulator" /> : <Redirect to="/login" />}
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
        <Redirect to="/pipeline/zoho-leads" />
      </Route>
      <Route path="/pipeline/:section">
        {(params) => (
          <AdminRoute>
            <PipelineWorkspace section={params?.section ?? "zoho-leads"} />
          </AdminRoute>
        )}
      </Route>

      {/* ── DELIVERY workspace ── */}
      <Route path="/delivery">
        <Redirect to="/delivery/projects" />
      </Route>
      <Route path="/delivery/engines/:engineKey">
        {(params) => (
          <AdminRoute>
            <DeliveryWorkspace section={`engines/${params?.engineKey ?? ""}`} />
          </AdminRoute>
        )}
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
      {/* Dashboard Designer moved to Content & Offers workspace — old bookmarks redirect */}
      <Route path="/system/dashboard-designer">
        <Redirect to="/content/dashboard-designer" />
      </Route>
      <Route path="/system/:section">
        {(params) => (
          <AdminRoute>
            <SystemWorkspace section={params?.section ?? "inbox"} />
          </AdminRoute>
        )}
      </Route>

      {/* ── WORKFLOWS workspace ── */}
      <Route path="/workflows">
        <Redirect to="/workflows/list" />
      </Route>
      <Route path="/workflows/runs/:id">
        {(params) => (
          <AdminRoute>
            <WorkflowsWorkspace section="runs" params={params as Record<string, string>} />
          </AdminRoute>
        )}
      </Route>
      <Route path="/workflows/builder/:id">
        {(params) => (
          <AdminRoute>
            <WorkflowsWorkspace section="builder" params={params as Record<string, string>} />
          </AdminRoute>
        )}
      </Route>
      <Route path="/workflows/triggers/:id">
        {(params) => (
          <AdminRoute>
            <WorkflowsWorkspace section="triggers" params={params as Record<string, string>} />
          </AdminRoute>
        )}
      </Route>
      <Route path="/workflows/:section">
        {(params) => (
          <AdminRoute>
            <WorkflowsWorkspace section={params?.section ?? "list"} />
          </AdminRoute>
        )}
      </Route>

      {/* ── Detail pages (no workspace layout changes needed) ── */}
      {/* /crm/leads/:id and /crm/opportunities/:id were LeadDetail/OpportunityDetail,
          deleted in #135 (Decommission Legacy CRM Phase A). They are kept as
          redirects rather than removed outright because live deep links point at
          them — leads.ts stamps `linkPath: /crm/leads/:id` onto every
          lead_created notification, and MarketingCommandCenter navigates there
          from a task card. The old local-CRM row id has no Zoho equivalent to
          resolve, so both land on the superseding Zoho list page. */}
      <Route path="/crm/leads/:id"><Redirect to="/pipeline/zoho-leads" /></Route>
      <Route path="/crm/opportunities/:id"><Redirect to="/pipeline/zoho-deals" /></Route>
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

      {/* #135: /pipeline/leads and /pipeline/opportunities rendered the deleted
          local-CRM pages, so these legacy redirects now target the Zoho pages
          that superseded them (#83). */}
      <Route path="/crm/leads"><Redirect to="/pipeline/zoho-leads" /></Route>
      <Route path="/crm/quiz-leads"><Redirect to="/pipeline/quiz-leads" /></Route>
      <Route path="/crm/opportunities"><Redirect to="/pipeline/zoho-deals" /></Route>
      <Route path="/crm/clients"><Redirect to="/pipeline/clients" /></Route>
      <Route path="/crm/m365-intelligence"><Redirect to="/pipeline/m365-intelligence" /></Route>
      <Route path="/crm/messages"><Redirect to="/command/messages" /></Route>

      <Route path="/crm/projects"><Redirect to="/delivery/projects" /></Route>
      <Route path="/engagement-projects"><Redirect to="/delivery/engagement-projects" /></Route>
      <Route path="/activity-log"><Redirect to="/delivery/activity-logs" /></Route>
      <Route path="/sharepoint"><Redirect to="/delivery/hub-storage" /></Route>

      <Route path="/crm/invoices"><Redirect to="/finance/invoices" /></Route>
      <Route path="/crm/purchases"><Redirect to="/finance/purchases" /></Route>
      <Route path="/crm/contracts"><Redirect to="/finance/contracts" /></Route>
      <Route path="/coupons"><Redirect to="/finance/coupons" /></Route>
      <Route path="/crm/reports"><Redirect to="/finance/reports" /></Route>

      <Route path="/articles"><Redirect to="/content/articles" /></Route>
      <Route path="/services"><Redirect to="/content/services" /></Route>
      <Route path="/email-templates"><Redirect to="/content/email-templates" /></Route>
      <Route path="/contract-templates"><Redirect to="/content/contract-templates" /></Route>
      <Route path="/templates/library"><Redirect to="/content/template-library" /></Route>
      <Route path="/asset-library/instruction-sets"><Redirect to="/content/asset-library" /></Route>

      <Route path="/inbox"><Redirect to="/system/inbox" /></Route>
      <Route path="/security"><Redirect to="/system/security" /></Route>
      <Route path="/crm/quiz-pain-config"><Redirect to="/system/signal-mappings" /></Route>

      {/* ── adminv2 ──
          Deliberately NOT wrapped in AdminRoute: GlobalIDEShell supplies the
          left tree that this design removed on purpose (handoff.md section 1).
          RequireAdmin still applies — the auth choke point is not optional. */}
      <Route path="/adminv2">
        <RequireAdmin><AdminV2 /></RequireAdmin>
      </Route>
      <Route path="/adminv2/*">
        <RequireAdmin><AdminV2 /></RequireAdmin>
      </Route>

      {/* ── Labs (experimental spikes, full-bleed) ── */}
      <Route path="/labs/factory-floor">
        <RequireAdmin>
          <div className="relative w-full h-full">
            <FactoryFloorLab />
          </div>
        </RequireAdmin>
      </Route>

      {/* ── Git #663: PWA start_url — plain, full-bleed, no IDE shell ── */}
      <Route path="/playground">
        <RequireAdmin>
          <ShanePlayground />
        </RequireAdmin>
      </Route>

      {/* ── MSP Platform admin pages ── */}
      <Route path="/msp">
        <AdminRoute><MspAdminPage /></AdminRoute>
      </Route>
      <Route path="/msp/plans">
        <AdminRoute><PlanManagementPage /></AdminRoute>
      </Route>
      <Route path="/msp/overrides">
        <AdminRoute><MspOverridesPage /></AdminRoute>
      </Route>
      <Route path="/msp/reports">
        <AdminRoute><MspReportsPage /></AdminRoute>
      </Route>

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
