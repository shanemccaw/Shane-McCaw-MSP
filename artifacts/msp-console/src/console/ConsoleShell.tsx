import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import type { MspUserProfile } from "@workspace/api-client-react";
import { useAlerts, useBreakGlass, useDirectory } from "@/api/console-api";
import { useAuth } from "@/contexts/AuthContext";
import { Header } from "./Header";
import { TreeSidebar } from "./TreeSidebar";
import { Breadcrumbs } from "./Breadcrumbs";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "./CommandPalette";
import { ScreenSlot } from "./ScreenSlot";
import { Remediation } from "./modules/Remediation";
import { surface } from "./tokens";
import { RunbooksPage } from "@/pages/runbooks/RunbooksPage";
import {
  buildCommands, buildCrumbs, buildRailNodes, buildTreeNodes,
  contextPath, pageMeta, statusLeft, statusRight,
  type PageMeta, type TreeHandlers,
} from "./treeModel";
import {
  groupForPage, parseLocation, selectionToPath, type Selection,
} from "./nav";

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
            {moduleFor(effectiveSel)}
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
 */
function moduleFor(sel: Selection): React.ReactNode {
  if (sel.kind === "page" && sel.page === "run") {
    return <RunbooksPage customerId={sel.tenant} />;
  }
  if (sel.kind === "page" && sel.page === "rem") {
    return <Remediation customerId={sel.tenant} />;
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
