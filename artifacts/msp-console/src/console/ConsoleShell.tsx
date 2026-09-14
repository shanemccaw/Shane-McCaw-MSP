import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import type { MspUserProfile } from "@workspace/api-client-react";
import { useAlerts, useBreakGlass, useDirectory, type DirectoryCustomer } from "@/api/console-api";
import { useAuth } from "@/contexts/AuthContext";
import { Header } from "./Header";
import { TreeSidebar } from "./TreeSidebar";
import { Breadcrumbs } from "./Breadcrumbs";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "./CommandPalette";
import { ScreenSlot } from "./ScreenSlot";
import { Diagnostics } from "./modules/Diagnostics";
import { Remediation } from "./modules/Remediation";
import { Webhooks } from "./modules/Webhooks";
import { DataRights } from "./modules/DataRights";
import { StatusReports } from "./modules/StatusReports";
import { Documents } from "./modules/Documents";
import { Team } from "./modules/Team";
import { BreakGlassWatchlist } from "./modules/BreakGlassWatchlist";
import { ScopeSla } from "./modules/ScopeSla";
import { Ownership } from "./modules/Ownership";
import { Sales } from "./modules/Sales";
import { ActivityTimeline } from "./modules/ActivityTimeline";
import { AuditLog } from "./modules/AuditLog";
import { PolicyEngine } from "./modules/PolicyEngine";
import { ConsentOnboarding } from "./modules/ConsentOnboarding";
import { AccountSecurity } from "./modules/AccountSecurity";
import { StaffRoster } from "./modules/StaffRoster";
import { Dlq } from "./modules/Dlq";
import { PlanSelfService } from "./modules/PlanSelfService";
import { Reports } from "./modules/Reports";
import { MarketplacePurchase } from "./modules/MarketplacePurchase";
import { SeatPricing } from "./modules/SeatPricing";
import { RetainerIntervalSwitch } from "./modules/RetainerIntervalSwitch";
import { OffersAndSows } from "./modules/OffersAndSows";
import { SopsPage } from "@/pages/Sops";
import { OffboardingPage } from "@/pages/Offboarding";
import { ExecutiveView } from "@/pages/executive/ExecutiveView";
import { ChangeControl, CHANGE_CONTROL_TABS, type ChangeControlTab } from "@/pages/change-control/ChangeControl";
import { surface } from "./tokens";
import { RunbooksPage } from "@/pages/runbooks/RunbooksPage";
import { BreakGlassPage } from "@/pages/break-glass/BreakGlassPage";
import { AdOuAssignmentPage } from "@/pages/ad-ou-assignment/AdOuAssignmentPage";
import { PoamsPage } from "@/pages/poams/PoamsPage";
import { ConfigState } from "@/pages/config-state/ConfigState";
import {
  buildCommands, buildCrumbs, buildRailNodes, buildTreeNodes,
  contextPath, pageMeta, statusLeft, statusRight,
  type PageMeta, type TreeHandlers,
} from "./treeModel";
import {
  groupForPage, parseLocation, selectionToPath, type Selection,
} from "./nav";
import { RiskRegister } from "@/modules/risk-register/RiskRegister";
import { RetentionQueue } from "@/modules/retention/RetentionQueue";
import { RetainerHours } from "@/modules/retainer/RetainerHours";
import { PartnerRevenue } from "./modules/PartnerRevenue";
import { Overview } from "./modules/Overview";
import { LaunchControl } from "./modules/LaunchControl";
import { AzureCredential } from "./modules/AzureCredential";
import { Projects } from "./modules/Projects";
import { PlaceholderModule } from "./modules/PlaceholderModule";

function roleLabelFor(p: MspUserProfile): string {
  if (p.mspRole === "PlatformAdmin") return "PlatformAdmin — full access";
  if (p.mspRole) return p.mspRole;
  return p.role === "admin" ? "Admin" : "MSP operator";
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ConsoleShell({ profile }: { profile: MspUserProfile }) {
  const [location, setLocation] = useLocation();
  const { logout } = useAuth();

  const directory = useDirectory();
  const breakGlass = useBreakGlass();
  const alertsQuery = useAlerts();

  const customers = useMemo(() => directory.data?.customers ?? [], [directory.data]);
  const loading = directory.isLoading;
  const empty = !loading && customers.length === 0;

  // Selection is derived entirely from the URL (the shell's real, only nav state).
  const sel: Selection = parseLocation(location) ?? { kind: "root" };
  const effectiveSel: Selection = loading || empty ? { kind: "root" } : sel;

  // ── Ephemeral chrome state ────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(true);
  const [treeQuery, setTreeQuery] = useState("");
  const [openTenants, setOpenTenants] = useState<Set<number>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [mspOpen, setMspOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [notifsOpen, setNotifsOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const closeOverlays = useCallback(() => {
    setPaletteOpen(false); setNotifsOpen(false); setUserOpen(false);
  }, []);

  const navigate = useCallback((next: Selection) => {
    setLocation(selectionToPath(next));
    closeOverlays();
  }, [setLocation, closeOverlays]);

  const handlers: TreeHandlers = useMemo(() => ({
    navigate,
    toggleTenant: (id: number) => {
      setOpenTenants((prev) => {
        const nextSet = new Set(prev);
        if (nextSet.has(id)) { nextSet.delete(id); return nextSet; }
        nextSet.add(id);
        navigate({ kind: "tenant", tenant: id });
        return nextSet;
      });
    },
    toggleGroup: (key: string) => {
      setOpenGroups((prev) => {
        const nextSet = new Set(prev);
        if (nextSet.has(key)) nextSet.delete(key); else nextSet.add(key);
        return nextSet;
      });
    },
    toggleMsp: () => setMspOpen((v) => !v),
  }), [navigate]);

  // Auto-expand the tenant (and owning group) for the current selection, so a
  // deep link like /tenants/5/risk opens the tree to that node.
  useEffect(() => {
    if (sel.kind === "tenant" || sel.kind === "page") {
      setOpenTenants((prev) => (prev.has(sel.tenant) ? prev : new Set(prev).add(sel.tenant)));
    }
    if (sel.kind === "page") {
      const grp = groupForPage(sel.page);
      if (grp) {
        const key = `${sel.tenant}:${grp.id}`;
        setOpenGroups((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
      }
    }
    closeOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // ⌘K opens the palette; Escape closes every overlay (README "Keyboard").
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteQuery("");
        setPaletteOpen(true);
        setNotifsOpen(false);
        setUserOpen(false);
      } else if (e.key === "Escape") {
        closeOverlays();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeOverlays]);

  // ── Derived view models ───────────────────────────────────────────────────
  const nodes = useMemo(
    () => buildTreeNodes(customers, effectiveSel, openTenants, openGroups, mspOpen, treeQuery, handlers),
    [customers, effectiveSel, openTenants, openGroups, mspOpen, treeQuery, handlers],
  );
  const railNodes = useMemo(() => buildRailNodes(customers, effectiveSel, handlers), [customers, effectiveSel, handlers]);
  const commands = useMemo(() => buildCommands(customers, handlers), [customers, handlers]);
  const crumbs = useMemo(() => buildCrumbs(effectiveSel, customers, handlers), [effectiveSel, customers, handlers]);

  const roleLabel = roleLabelFor(profile);
  const userName = profile.name?.trim() || profile.email;

  const meta: PageMeta = loading
    ? { eyebrow: "DIRECTORY", title: "Tree loading", note: "The chrome paints first and the tree fills in after. Nothing in the header or status bar waits on the directory request." }
    : empty
      ? { eyebrow: "DIRECTORY", title: "No tenants yet", note: "An MSP with no customers gets the same chrome and an honest empty tree, not a blocked console." }
      : pageMeta(sel, customers);

  const left = loading ? "Loading the directory…" : empty ? "0 tenants · nothing to scan yet" : statusLeft(sel, customers);
  const right = loading || empty ? `Signed in as ${roleLabel}` : statusRight(sel, customers, roleLabel);
  const ctxPath = loading ? "Loading the directory…" : contextPath(effectiveSel, customers);

  const bgCount = breakGlass.data?.pending.length ?? 0;
  const alerts = alertsQuery.data?.alerts ?? [];

  const wire = wireFor(sel);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 640, background: surface.canvas, color: "#e2e8f0", fontFamily: "Inter, system-ui, sans-serif", fontSize: 14, overflow: "hidden", position: "relative" }}>
      <Header
        contextPath={ctxPath}
        onOpenPalette={() => { setPaletteQuery(""); setPaletteOpen(true); }}
        breakGlassCount={bgCount}
        onBreakGlass={() => navigate({ kind: "root" })}
        alerts={alerts}
        hasUnread={alerts.length > 0}
        notifsOpen={notifsOpen}
        onToggleNotifs={() => { setNotifsOpen((v) => !v); setUserOpen(false); }}
        userOpen={userOpen}
        onToggleUser={() => { setUserOpen((v) => !v); setNotifsOpen(false); }}
        userName={userName}
        userInitials={initialsFor(userName)}
        roleLabel={roleLabel}
        onNavigateSettings={() => navigate({ kind: "msp", page: "settings" })}
        onNavigateSecurity={() => { setLocation("/account/mfa"); closeOverlays(); }}
        onLogout={() => void logout()}
      />

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <TreeSidebar
          expanded={expanded}
          onToggleSidebar={() => setExpanded((v) => !v)}
          treeQuery={treeQuery}
          onTreeQuery={setTreeQuery}
          loading={loading}
          empty={empty}
          nodes={nodes}
          railNodes={railNodes}
          onOnboard={() => toast("Onboarding a tenant isn't wired up in the console yet.")}
        />

        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Breadcrumbs crumbs={crumbs} />
          <ScreenSlot meta={meta} wire={wire}>
            {moduleFor(effectiveSel, customers, navigate, profile)}
          </ScreenSlot>
          <StatusBar left={left} right={right} />
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        query={paletteQuery}
        onQuery={setPaletteQuery}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}

/**
 * Which module page (if any) mounts into the screen slot for the current
 * selection. Each module is dispatched as its own issue, blocked_by the shell
 * (#3677); until a given module lands, `ScreenSlot` falls back to its own
 * designed placeholder — this function returning `undefined` for every
 * not-yet-built page is that fallback, not a stubbed empty state.
 *
 * `root` mounts the cross-tenant break-glass watchlist tile (README screen 1's
 * lead panel, #2630) — the rest of screen 1 (advisory panel, data-rights feed,
 * tenant table) is out of this function's scope until its own issue lands.
 */
function moduleFor(sel: Selection, customers: DirectoryCustomer[], navigate: (next: Selection) => void, profile: MspUserProfile): React.ReactNode {
  if (sel.kind === "root") {
    return <BreakGlassWatchlist onOpenTenant={(customerId) => navigate({ kind: "page", tenant: customerId, page: "bg" })} />;
  }
  if (sel.kind === "page" && sel.page === "overview") {
    // Tenant Overview roll-up (#3822) needs the full customer row — the same
    // real M365 tenantId GUID Risk Register and Change Control need above —
    // to filter the MSP-wide reads it aggregates down to this one tenant.
    const customer = customers.find((c) => c.id === sel.tenant);
    return customer ? <Overview customer={customer} navigate={navigate} /> : undefined;
  }
  if (sel.kind === "page" && sel.page === "run") {
    return <RunbooksPage customerId={sel.tenant} />;
  }
  if (sel.kind === "page" && sel.page === "diag") {
    return <Diagnostics customerId={sel.tenant} />;
  }
  if (sel.kind === "page" && sel.page === "rem") {
    return <Remediation customerId={sel.tenant} />;
  }
  if (sel.kind === "page" && sel.page === "risk") {
    // Risk Register needs the full customer row (the real M365 tenantId GUID
    // the register scopes on), not just the numeric id the other modules take.
    const customer = customers.find((c) => c.id === sel.tenant);
    return customer ? <RiskRegister customer={customer} /> : undefined;
  }
  if (sel.kind === "page" && sel.page === "poams") {
    // POA&Ms (#3897), README screen 41. This route has no customerId and
    // `msp_poams.tenantId` is free text with no real FK, so the list itself
    // is the whole book regardless of which tenant node this is opened from
    // (see PoamsPage's own header/notes) — the customer row here is only used
    // to prefill the create form's free-text tenant fields.
    // Cancel/convert/delete all require ladder.msp-admin server-side
    // (msp-poams.ts); MSPOperator can read/author/edit/complete/add
    // milestones but not those three.
    const customer = customers.find((c) => c.id === sel.tenant);
    const isAdmin = profile.role === "admin" || profile.mspRole === "PlatformAdmin" || profile.mspRole === "MSPAdmin";
    return <PoamsPage customer={customer ? { name: customer.name, tenantId: customer.tenantId, domain: customer.domain } : undefined} isAdmin={isAdmin} />;
  }
  if (sel.kind === "page" && sel.page === "lc") {
    // Launch Control (#2615), README screen 19. The routes are path-scoped by
    // mspId, taken from the customer's own directory row so a PlatformAdmin
    // session (no mspId claim) still addresses the right MSP.
    const customer = customers.find((c) => c.id === sel.tenant);
    return customer ? <LaunchControl mspId={customer.mspId} customerId={sel.tenant} customerName={customer.name} /> : undefined;
  }
  if (sel.kind === "page" && sel.page === "wh") {
    return <Webhooks customerId={sel.tenant} />;
  }
  if (sel.kind === "page" && sel.page === "dr") {
    return <DataRights customerId={sel.tenant} />;
  }
  if (sel.kind === "page" && sel.page === "status-reports") {
    return <StatusReports customerId={sel.tenant} />;
  }
  if (sel.kind === "page" && sel.page === "offers-sows") {
    // Offers & SOWs (#4014), README screen 66 — the whole SOW book for this
    // customer, plus the offers-to-accept and clickwrap surfaces.
    const customer = customers.find((c) => c.id === sel.tenant);
    return <OffersAndSows customerId={sel.tenant} customerName={customer?.name ?? `Customer ${sel.tenant}`} mspId={profile.mspId ?? null} />;
  }
  if (sel.kind === "page" && sel.page === "team") {
    const customer = customers.find((c) => c.id === sel.tenant);
    return <Team customerId={sel.tenant} customerName={customer?.name} />;
  }
  if (sel.kind === "page" && sel.page === "bg") {
    return <BreakGlassPage customerId={sel.tenant} />;
  }
  if (sel.kind === "page" && sel.page === "ou") {
    return <AdOuAssignmentPage customerId={sel.tenant} />;
  }
  if (sel.kind === "page" && sel.page === "azurecred") {
    // Azure Credential (#3968), README screen unassigned in this pass — the
    // routes are path-scoped by mspId, taken from the directory row, same
    // reason Launch Control needs it above.
    const customer = customers.find((c) => c.id === sel.tenant);
    return <AzureCredential mspId={customer?.mspId ?? null} customerId={sel.tenant} customerName={customer?.name} />;
  }
  if (sel.kind === "page" && sel.page === "raci") {
    // Ownership / RACI (#2594) needs the full customer row for its display
    // name — the "mine"/"coverage" tabs read across every customer in the
    // book regardless, but the matrix tab's own header wants this tenant's
    // real name, same reason Team needs it above.
    const customer = customers.find((c) => c.id === sel.tenant);
    return (
      <Ownership
        customerId={sel.tenant}
        customerName={customer?.name ?? `Customer ${sel.tenant}`}
        customers={customers}
        onOpenTenant={(customerId) => navigate({ kind: "page", tenant: customerId, page: "raci" })}
      />
    );
  }
  if (sel.kind === "page" && sel.page === "hub") {
    // Documents (#2647), README screen 22 — the tenant-scoped hub, "Ours" and
    // "SharePoint connectors" tabs all mount from this one shared component.
    const customer = customers.find((c) => c.id === sel.tenant);
    return <Documents scopeCustomerId={sel.tenant} scopeCustomerName={customer?.name} initialTab="hub" />;
  }
  if (sel.kind === "page" && sel.page === "marketplace") {
    // Marketplace Purchase (#3819), README screen 47 — buying a catalog item
    // on this customer's behalf, charged to the MSP's card.
    const customer = customers.find((c) => c.id === sel.tenant);
    return <MarketplacePurchase customerId={sel.tenant} customerName={customer?.name ?? `Customer ${sel.tenant}`} />;
  }
  if (sel.kind === "page" && sel.page === "billing") {
    // Two independent, narrow slices of this still-unwired nav slot stack
    // here rather than fighting over it — the full Billing screen (Design
    // screen 23) stays blocked on a real Design export (#2608):
    //   - Seat Pricing (#4111) — automatic pricing from the customer's real,
    //     live M365 licensed-user count, plus the manual service-account
    //     exclusion override.
    //   - Retainer Interval Switch (#4112, Feature #1692) — propose a
    //     month<->year retainer interval switch for the customer to
    //     approve/reject.
    const customer = customers.find((c) => c.id === sel.tenant);
    if (!customer) return undefined;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <SeatPricing customerId={sel.tenant} customerName={customer.name} />
        <RetainerIntervalSwitch mspId={customer.mspId} customerId={sel.tenant} customerName={customer.name} />
      </div>
    );
  }
  if (sel.kind === "page" && sel.page === "audit") {
    // Audit Log (#4012, README screen 63), per-tenant leaf — narrowed
    // server-side by customerId (#3671). Same component as the Operations
    // mount below, one prop.
    const customer = customers.find((c) => c.id === sel.tenant);
    const isPlatformAdmin = profile.mspRole === "PlatformAdmin";
    return (
      <AuditLog
        customerId={sel.tenant}
        customerName={customer?.name ?? `Customer ${sel.tenant}`}
        isPlatformAdmin={isPlatformAdmin}
        ownMspId={profile.mspId ?? null}
        ownMspLabel={profile.mspSlug ?? "your MSP"}
      />
    );
  }
  if (sel.kind === "msp" && sel.page === "docs") {
    // Documents (#2647), README screen 32 — the MSP-wide library, unscoped.
    return <Documents initialTab="hub" />;
  }
  if (sel.kind === "msp" && sel.page === "connectors") {
    // Documents (#2647), README screen 33 — SharePoint connectors, unscoped.
    return <Documents initialTab="connectors" />;
  }
  if (sel.kind === "msp" && sel.page === "sops") {
    return <SopsPage />;
  }
  if (sel.kind === "msp" && sel.page === "offboarding") {
    return <OffboardingPage profile={profile} />;
  }
  if (sel.kind === "msp" && sel.page === "config") {
    // Configuration State diff view (#3836) — attribution + lifecycle read and the
    // attribution re-run trigger, over `GET/POST /api/msp/config-state/diffs*`. See
    // `pages/config-state/ConfigState.tsx`'s own header for what is deliberately out
    // of scope (snapshots/baselines/registry, each their own separate module).
    return <ConfigState />;
  }
  if (sel.kind === "msp" && sel.page === "timeline") {
    // Activity Timeline (#4011, README screen 27) — cross-tenant feed over
    // GET /api/msp/timeline. Staff scoping is resolved server-side.
    return (
      <ActivityTimeline
        customers={customers}
        onOpenTenant={(customerId) => navigate({ kind: "tenant", tenant: customerId })}
      />
    );
  }
  if (sel.kind === "msp" && sel.page === "exec") {
    return <ExecutiveView onOpenTenant={(customerId) => navigate({ kind: "tenant", tenant: customerId })} />;
  }
  if (sel.kind === "msp" && sel.page === "sla") {
    return (
      <ScopeSla
        customers={customers}
        onOpenTenant={(customerId) => navigate({ kind: "tenant", tenant: customerId })}
      />
    );
  }
  if (sel.kind === "msp" && sel.page === "acctsec") {
    return <AccountSecurity />;
  }
  if (sel.kind === "msp" && sel.page === "staff") {
    return <StaffRoster profile={profile} />;
  }
  if (sel.kind === "msp" && sel.page === "dlq") {
    return <Dlq />;
  }
  if (sel.kind === "msp" && sel.page === "sales") {
    // Bundle write actions require ladder.msp-admin server-side
    // (msp-sales-bundles.ts); MSPOperator can read everything but not
    // create/edit/delete a bundle or assign/revoke a customer on one.
    const isAdmin = profile.role === "admin" || profile.mspRole === "PlatformAdmin" || profile.mspRole === "MSPAdmin";
    return <Sales mspId={profile.mspId ?? null} isAdmin={isAdmin} />;
  }
  if (sel.kind === "msp" && sel.page === "policy") {
    return <PolicyEngine />;
  }
  if (sel.kind === "msp" && sel.page === "consent") {
    return <ConsentOnboarding />;
  }
  if (sel.kind === "msp" && sel.page === "plan") {
    return <PlanSelfService />;
  }
  if (sel.kind === "msp" && sel.page === "reports") {
    // Deleting a report definition requires ladder.msp-admin server-side (msp-reports.ts);
    // MSPOperator can read/create/trigger/pause everything but not delete a definition.
    const isAdmin = profile.role === "admin" || profile.mspRole === "PlatformAdmin" || profile.mspRole === "MSPAdmin";
    return <Reports isAdmin={isAdmin} />;
  }
  if (sel.kind === "msp" && sel.page === "retention") {
    return <RetentionQueue />;
  }
  if (sel.kind === "msp" && sel.page === "retainer") {
    // Reopen and the "adjust after close" override both require
    // ladder.msp-admin server-side (msp-retainer.ts); MSPOperator can log,
    // adjust, delete and close an open period but not either of those two.
    const isAdmin = profile.role === "admin" || profile.mspRole === "PlatformAdmin" || profile.mspRole === "MSPAdmin";
    return <RetainerHours mspId={profile.mspId ?? null} isAdmin={isAdmin} />;
  }
  if (sel.kind === "msp" && sel.page === "revenue") {
    return <PartnerRevenue embedded />;
  }
  if (sel.kind === "msp" && sel.page === "projects") {
    // Projects — Simple Kanban (#2621), README-equivalent placement per
    // `MSP Console.dc.html`. Per-customer buckets/cards; the customer picker
    // lives inside the module itself, not the outer tree, since the backend
    // has no cross-customer aggregate route (pack §5).
    return <Projects customers={customers} embedded />;
  }
  if (sel.kind === "msp" && sel.page === "workflows") {
    // Workflows (#4080, Feature #3768) — real nav slot, generic
    // `PlaceholderModule` mount. Scope isn't defined yet; see the issue.
    return (
      <PlaceholderModule
        icon="workflow"
        title="Workflows isn't built yet"
        description="This nav slot is real — what runs here hasn't been scoped yet. Shane will define it while dogfooding the console on his own tenant, and this placeholder is replaced with the real module once it lands."
      />
    );
  }
  if (sel.kind === "msp" && sel.page === "agents") {
    // Agents (#4080, Feature #3768) — real nav slot, generic
    // `PlaceholderModule` mount. Scope isn't defined yet; see the issue.
    return (
      <PlaceholderModule
        icon="sparkles"
        title="Agents isn't built yet"
        description="This nav slot is real — what runs here hasn't been scoped yet. Shane will define it while dogfooding the console on his own tenant, and this placeholder is replaced with the real module once it lands."
      />
    );
  }
  if (sel.kind === "msp" && sel.page === "audit") {
    // Audit Log (#4012, README screen 63), Operations mount — no customer
    // filter, the whole MSP. Same component as the per-tenant leaf above.
    const isPlatformAdmin = profile.mspRole === "PlatformAdmin";
    return (
      <AuditLog
        isPlatformAdmin={isPlatformAdmin}
        ownMspId={profile.mspId ?? null}
        ownMspLabel={profile.mspSlug ?? "your MSP"}
      />
    );
  }
  if (sel.kind === "page" && (CHANGE_CONTROL_TABS as readonly string[]).includes(sel.page)) {
    // Change Control (#2579) needs the full customer row too — its Register,
    // Windows, Dependencies, Executions and PIRs tabs all filter this MSP's
    // whole book down to the real M365 tenantId GUID, same reason Risk
    // Register needs it above.
    const customer = customers.find((c) => c.id === sel.tenant);
    const tab = sel.page as ChangeControlTab;
    return (
      <ChangeControl
        tab={tab}
        customer={customer}
        onNavigateTab={(nextTab) => navigate({ kind: "page", tenant: sel.tenant, page: nextTab })}
      />
    );
  }
  return undefined;
}

function wireFor(sel: Selection): string {
  switch (sel.kind) {
    case "root": return "MSP Console · GET /api/msp/customers";
    case "tenant": return `MSP Console · tenant ${sel.tenant}`;
    case "page": return `MSP Console · page === ${sel.page}`;
    case "msp": return `MSP Console · ops === ${sel.page}`;
  }
}
