/**
 * DashboardView.tsx
 *
 * Step 4c — the shared customer/MSP-facing viewer for the Dashboard / Web
 * Part System. Fetches the caller's resolved dashboard (template + their own
 * saved overrides merged) from GET /api/dashboard/resolved and renders it via
 * <DashboardCanvas> from @workspace/dashboard-canvas.
 *
 * Editing here is constrained, not freeform: a user can show/hide/resize/
 * reposition only among widgets already present in their assigned template.
 * There is no palette and no way to add a widget type that isn't already on
 * the canvas — <DashboardCanvas> itself has no palette/add-widget UI (see
 * Step 4a), so that constraint holds simply by never rendering one here. The
 * real enforcement (rejecting a request that names a widget id outside the
 * template) lives server-side in dashboard-overrides.ts's PUT handler.
 *
 * Used by both the MSP-facing (`msp_overview`) and customer-facing
 * (`customer_default`) pages — same component, different `scope` prop.
 *
 * A customer with more than one applicable dashboard (customer_default plus
 * any active monitoring_package templates) gets a tab strip above the canvas
 * — see <DashboardTabs> below, which fetches GET /api/dashboard/resolved-list
 * just to learn which tabs exist, and mounts one <DashboardView
 * targetKey=...> per tab. Each mounted DashboardView independently calls
 * /resolved-list itself and reads out its own entry (a second network round
 * trip, traded for each tab's load/edit/save state staying fully isolated —
 * see the DashboardTabs comment for the reasoning). Passing `targetKey` also
 * threads through the PUT/DELETE override calls so editing/reset apply to
 * that specific monitoring_package template instead of the caller's default.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DashboardCanvas,
  createDashboardDataFetcher,
  type WidgetInstance,
  type DashboardResolveScope,
} from "@workspace/dashboard-canvas";
import { EyeOff, Loader2, LayoutDashboard, Pencil, RotateCcw, Save, X } from "lucide-react";

// PlatformAdmin's Designer stays in admin-panel (cross-MSP oversight/support
// surface) — same-origin, path-prefixed deployment (see ImpersonationBanner's
// "/admin-panel/..." exit route for the existing precedent), so a plain
// cross-app href is correct there; client-side routing can't cross the app
// boundary. MSPAdmin/MSPOperator now have their own in-app Designer (this
// same app, /dashboard-designer) — see the role branch below.
const ADMIN_PANEL_DASHBOARD_DESIGNER_URL = `${window.location.origin}/admin-panel/content/dashboard-designer`;

interface ResolvedDashboard {
  configured: boolean;
  editable?: boolean;
  templateId?: number;
  templateType?: string;
  widgets?: WidgetInstance[];
  hasOverride?: boolean;
}

export interface DashboardViewProps {
  /** The scope this dashboard resolves against (drives POST /api/dashboard/resolve calls for each widget). */
  scope: DashboardResolveScope;
  title?: string;
  /**
   * Present only when this instance renders a monitoring_package tab (see
   * <DashboardTabs>). Selects that specific entry out of GET
   * /api/dashboard/resolved-list instead of the caller's default template,
   * and is threaded through to PUT/DELETE /overrides so editing/reset apply
   * to that template rather than the default. Omitted for the plain
   * customer_default/msp_overview case — behaves exactly as before tabs existed.
   */
  targetKey?: string;
}

export function DashboardView({ scope, title = "Dashboard", targetKey }: DashboardViewProps) {
  const { user, fetchWithAuth } = useAuth();
  const fetcher = useMemo(() => createDashboardDataFetcher(fetchWithAuth), [fetchWithAuth]);

  // Only roles that can plausibly go build a template get the CTA — a
  // CustomerUser can only edit within a template already assigned to them
  // (see the constrained-editing note in this file's header comment).
  const effectiveRole = user?.role === "admin" ? "PlatformAdmin" : user?.mspRole;
  const canCreateDashboard = effectiveRole === "PlatformAdmin" || effectiveRole === "MSPAdmin" || effectiveRole === "MSPOperator";

  const [resolved, setResolved] = useState<ResolvedDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftWidgets, setDraftWidgets] = useState<WidgetInstance[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let data: ResolvedDashboard;
      if (targetKey) {
        const res = await fetchWithAuth("/api/dashboard/resolved-list");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setLoadError(body.error ?? `Failed to load dashboard (${res.status})`);
          setResolved(null);
          return;
        }
        const body = (await res.json()) as { dashboards: Array<{ targetKey: string | null; resolved: ResolvedDashboard }> };
        const entry = body.dashboards.find((d) => d.targetKey === targetKey);
        data = entry?.resolved ?? { configured: false };
      } else {
        const res = await fetchWithAuth("/api/dashboard/resolved");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setLoadError(body.error ?? `Failed to load dashboard (${res.status})`);
          setResolved(null);
          return;
        }
        data = (await res.json()) as ResolvedDashboard;
      }
      setResolved(data);
      setDraftWidgets(data.widgets ?? []);
      setHiddenIds(new Set());
    } catch {
      setLoadError("Failed to load dashboard");
      setResolved(null);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, targetKey]);

  useEffect(() => {
    void load();
  }, [load]);

  function startEditing() {
    setDraftWidgets(resolved?.widgets ?? []);
    setHiddenIds(new Set());
    setSaveError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setDraftWidgets(resolved?.widgets ?? []);
    setHiddenIds(new Set());
    setSaveError(null);
    setEditing(false);
  }

  function hideWidget(id: string) {
    setHiddenIds((prev) => new Set(prev).add(id));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const positions: Record<string, { x: number; y: number; w: number; h: number }> = {};
      for (const w of draftWidgets) {
        positions[w.i] = { x: w.x, y: w.y, w: w.w, h: w.h };
      }
      const res = await fetchWithAuth("/api/dashboard/overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: [...hiddenIds], positions, targetKey: targetKey ?? null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.error ?? `Failed to save (${res.status})`);
        return;
      }
      setEditing(false);
      setRefreshKey((k) => k + 1);
      await load();
    } catch {
      setSaveError("Failed to save dashboard changes");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setSaveError(null);
    try {
      const resetUrl = targetKey
        ? `/api/dashboard/overrides?targetKey=${encodeURIComponent(targetKey)}`
        : "/api/dashboard/overrides";
      const res = await fetchWithAuth(resetUrl, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.error ?? `Failed to reset (${res.status})`);
        return;
      }
      setEditing(false);
      setRefreshKey((k) => k + 1);
      await load();
    } catch {
      setSaveError("Failed to reset dashboard");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  if (!resolved?.configured) {
    return (
      <div className="flex flex-col items-center justify-center h-64 border border-dashed border-border rounded-lg text-center p-6">
        <LayoutDashboard className="size-10 text-muted-foreground/30 mb-3" />
        <p className="font-medium text-sm text-muted-foreground">No dashboard configured yet</p>
        <p className="text-xs text-muted-foreground/80 mt-1 max-w-xs">
          {canCreateDashboard
            ? "Build a dashboard template in the Designer to get started."
            : "Your MSP hasn't set up a dashboard for this view yet. Check back later."}
        </p>
        {canCreateDashboard && effectiveRole === "PlatformAdmin" && (
          <Button asChild size="sm" className="mt-4">
            <a href={ADMIN_PANEL_DASHBOARD_DESIGNER_URL}>
              <LayoutDashboard className="size-3.5" />
              Create Dashboard
            </a>
          </Button>
        )}
        {canCreateDashboard && effectiveRole !== "PlatformAdmin" && (
          <Link href="/dashboard-designer">
            <Button size="sm" className="mt-4">
              <LayoutDashboard className="size-3.5" />
              Create Dashboard
            </Button>
          </Link>
        )}
      </div>
    );
  }

  const visibleWidgets = editing ? draftWidgets.filter((w) => !hiddenIds.has(w.i)) : (resolved.widgets ?? []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {resolved.editable && !editing && (
          <div className="flex items-center gap-2">
            {resolved.hasOverride && (
              <Button variant="outline" size="sm" onClick={() => void handleReset()} disabled={saving}>
                <RotateCcw className="size-3.5" />
                Reset to default
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={startEditing}>
              <Pencil className="size-3.5" />
              Edit Dashboard
            </Button>
          </div>
        )}
        {editing && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={cancelEditing} disabled={saving}>
              <X className="size-3.5" />
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save
            </Button>
          </div>
        )}
      </div>

      {saveError && (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      {editing ? (
        <ConstrainedEditor
          widgets={visibleWidgets}
          scope={scope}
          fetcher={fetcher}
          onLayoutChange={setDraftWidgets}
          onHide={hideWidget}
        />
      ) : (
        <DashboardCanvas widgets={visibleWidgets} editable={false} scope={scope} fetcher={fetcher} refreshKey={refreshKey} />
      )}
    </div>
  );
}

// ── DashboardTabs: multi-dashboard entry point ─────────────────────────────
//
// Wraps <DashboardView> rather than folding tab logic into it, so the common
// single-dashboard case (msp_overview, and most customer_default callers with
// no monitoring package assigned) stays exactly as it rendered before this
// existed — no extra fetch, no tab chrome — by simply not using this
// component. Only customer-dashboard.tsx (the one page where a caller can
// have >1 applicable dashboard) needs to switch to it.
//
// It calls /resolved-list purely to learn WHICH tabs exist (labels/keys);
// each tab's actual data is fetched by that tab's own <DashboardView> (which
// also calls /resolved-list and reads its own entry back out — see
// DashboardView's `targetKey` prop doc above). That means switching tabs is a
// fresh mount, not a cache read, which keeps each tab's edit state fully
// isolated for free (matches ConstrainedEditor's existing per-instance state).

interface DashboardListEntry {
  templateType: string;
  targetKey: string | null;
  label: string;
  resolved: ResolvedDashboard;
}

export interface DashboardTabsProps {
  scope: DashboardResolveScope;
  title?: string;
}

export function DashboardTabs({ scope, title = "Dashboard" }: DashboardTabsProps) {
  const { fetchWithAuth } = useAuth();
  const [entries, setEntries] = useState<DashboardListEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string>("__default__");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetchWithAuth("/api/dashboard/resolved-list");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setLoadError(body.error ?? `Failed to load dashboards (${res.status})`);
          return;
        }
        const body = (await res.json()) as { dashboards: DashboardListEntry[] };
        if (!cancelled) {
          setEntries(body.dashboards);
          setActiveKey(body.dashboards[0]?.targetKey ?? "__default__");
        }
      } catch {
        if (!cancelled) setLoadError("Failed to load dashboards");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  // Zero or one applicable dashboard: render exactly as the plain single-
  // dashboard case, no tab strip.
  if (!entries || entries.length <= 1) {
    return <DashboardView scope={scope} title={title} />;
  }

  return (
    <Tabs value={activeKey} onValueChange={setActiveKey}>
      <TabsList className="h-auto w-full justify-start rounded-none border-b border-border bg-transparent p-0">
        {entries.map((entry) => (
          <TabsTrigger
            key={entry.targetKey ?? "__default__"}
            value={entry.targetKey ?? "__default__"}
            className="rounded-none border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            {entry.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {entries.map((entry) => (
        <TabsContent key={entry.targetKey ?? "__default__"} value={entry.targetKey ?? "__default__"}>
          <DashboardView scope={scope} title={entry.label} targetKey={entry.targetKey ?? undefined} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

// ── Constrained editor: drag/resize/hide only, never add ──────────────────
// No palette is rendered — <DashboardCanvas> has no add-widget affordance of
// its own, so omitting a palette here is the entire enforcement of "can't add
// new widget types" on the frontend. The per-widget "hide" control below only
// removes a widget from THIS render's array (client-side), same technique the
// admin designer uses for its own remove button — the actual widget stays in
// the template and simply gets listed in the saved override's `hidden` array.

function ConstrainedEditor({
  widgets,
  scope,
  fetcher,
  onLayoutChange,
  onHide,
}: {
  widgets: WidgetInstance[];
  scope: DashboardResolveScope;
  fetcher: ReturnType<typeof createDashboardDataFetcher>;
  onLayoutChange: (widgets: WidgetInstance[]) => void;
  onHide: (id: string) => void;
}) {
  if (widgets.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 border border-dashed border-border rounded-lg text-sm text-muted-foreground">
        No widgets left to show. Reset to default to bring them back.
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="grid grid-cols-1 gap-1 mb-2">
        {widgets.map((w) => (
          <div key={w.i} className="flex items-center gap-2 text-[11px] text-muted-foreground bg-card border rounded px-2 py-1">
            <span className="font-medium text-foreground truncate flex-1">{w.metricKey}</span>
            <button
              onClick={() => onHide(w.i)}
              className="p-1 rounded hover:bg-destructive/10 hover:text-destructive"
              title="Hide widget"
            >
              <EyeOff className="size-3" />
            </button>
          </div>
        ))}
      </div>
      <DashboardCanvas widgets={widgets} editable scope={scope} fetcher={fetcher} onLayoutChange={onLayoutChange} />
    </div>
  );
}
