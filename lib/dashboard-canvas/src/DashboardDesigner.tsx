/**
 * DashboardDesigner — the shared design surface for building a
 * dashboard_templates canvas layout (grid/palette/widget-placement). Used by
 * both admin-panel's PlatformAdmin Designer (cross-MSP, with an MSP picker)
 * and msp-portal's MSPAdmin/MSPOperator Designer (always their own MSP, no
 * picker) via the `targetSelector` and `adapter` props below — the two apps'
 * route paths, auth patterns, and MSP-scoping differences never need to be
 * hardcoded here.
 *
 * This package has no dependency on either app's `@/components/ui/*` (shadcn)
 * tree, so the handful of chrome components the designer needs (Card, Button,
 * Select, Switch, Badge, Dialog) are injected via the `ui` prop instead of
 * imported directly. admin-panel and msp-portal both carry byte-identical
 * shadcn wrappers around the same Radix primitives — so each app just passes
 * its own `@/components/ui/*` exports straight through, and both Designers
 * render pixel-identical to how admin-panel's original, pre-extraction page
 * looked.
 *
 * Flow: (targetSelector picks/derives an mspId) -> pick a templateType ->
 * (for assessment/project/monitoring_package) pick a targetKey -> load the
 * existing template for that combination if one exists, else start blank ->
 * add widgets from the metric palette -> drag/resize on the canvas -> Save.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode, type ComponentType } from "react";
import { Loader2, Save, Trash2, LayoutDashboard } from "lucide-react";
import {
  DASHBOARD_METRICS,
  getValidRenderersForMetric,
  getMetric,
} from "@workspace/dashboard-registry";
import type { MetricDef, RendererDef } from "@workspace/dashboard-registry";
import { DashboardCanvas } from "./DashboardCanvas";
import { mockDashboardDataFetcher } from "./mock-data-fetcher";
import type { WidgetInstance, WidgetDisplayMode } from "./types";

// ── Target picker types ──────────────────────────────────────────────────────

export const TEMPLATE_TYPES = [
  { value: "assessment", label: "Assessment" },
  { value: "project", label: "Project" },
  { value: "monitoring_package", label: "Monitoring Package" },
  { value: "msp_overview", label: "MSP Overview" },
  { value: "customer_default", label: "Customer Default" },
] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number]["value"];

const TARGET_KEY_TEMPLATE_TYPES = new Set<TemplateType>(["assessment", "project", "monitoring_package"]);

export interface TargetKeyOption {
  value: string;
  label: string;
}

export interface DashboardTemplate {
  id: number;
  mspId: number;
  templateType: TemplateType;
  targetKey: string | null;
  canvasLayout: WidgetInstance[];
  allowCustomerEdit: boolean;
  isDefault: boolean;
}

/**
 * How the designer talks to its backend. Each app supplies its own base path
 * (admin-panel: /api/admin/dashboard-templates, msp-portal: /api/msp/dashboard-templates)
 * and its own fetchWithAuth — the designer never assumes which auth scheme is in play.
 */
export interface DashboardDesignerAdapter {
  fetchWithAuth: (input: string, init?: RequestInit) => Promise<Response>;
  /** e.g. "/api/admin/dashboard-templates" or "/api/msp/dashboard-templates" */
  basePath: string;
  /** For assessment/project targetKey pickers. */
  fetchTargetKeyOptions: (templateType: TemplateType) => Promise<TargetKeyOption[]>;
}

export interface DashboardDesignerProps {
  adapter: DashboardDesignerAdapter;
  /**
   * Resolves the mspId this designer session operates on, and renders whatever
   * UI (or none) is needed to pick/display it. admin-panel renders an MSP
   * picker here; msp-portal renders nothing and always resolves its own mspId.
   */
  targetSelector: {
    mspId: number | null;
    /** Rendered inline in the Target card, to the left of the templateType picker. */
    render: () => ReactNode;
  };
  /** The calling app's own shadcn (`@/components/ui/*`) primitives. */
  ui: DesignerUIKit;
}

// ── Injected UI kit ─────────────────────────────────────────────────────────
// Typed structurally against each app's actual shadcn wrapper props, so
// admin-panel/msp-portal can pass their real `@/components/ui/*` exports with
// zero adapter glue — both carry identical wrappers around the same Radix
// primitives.

export interface DesignerUIKit {
  Card: ComponentType<{ className?: string; children?: ReactNode }>;
  CardHeader: ComponentType<{ className?: string; children?: ReactNode }>;
  CardTitle: ComponentType<{ className?: string; children?: ReactNode }>;
  CardDescription: ComponentType<{ className?: string; children?: ReactNode }>;
  CardContent: ComponentType<{ className?: string; children?: ReactNode }>;
  Button: ComponentType<{
    className?: string;
    onClick?: () => void;
    disabled?: boolean;
    variant?: "default" | "outline" | "destructive" | "secondary" | "ghost" | "link";
    children?: ReactNode;
  }>;
  Label: ComponentType<{ className?: string; children?: ReactNode }>;
  Badge: ComponentType<{
    variant?: "default" | "outline" | "destructive" | "secondary";
    className?: string;
    children?: ReactNode;
  }>;
  Switch: ComponentType<{ checked: boolean; onCheckedChange: (v: boolean) => void }>;
  Select: ComponentType<{ value?: string; onValueChange: (v: string) => void; disabled?: boolean; children?: ReactNode }>;
  SelectTrigger: ComponentType<{ className?: string; children?: ReactNode }>;
  SelectValue: ComponentType<{ placeholder?: string }>;
  SelectContent: ComponentType<{ children?: ReactNode }>;
  SelectItem: ComponentType<{ value: string; className?: string; children?: ReactNode }>;
  Dialog: ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void; children?: ReactNode }>;
  DialogContent: ComponentType<{ className?: string; children?: ReactNode }>;
  DialogHeader: ComponentType<{ children?: ReactNode }>;
  DialogTitle: ComponentType<{ children?: ReactNode }>;
  DialogFooter: ComponentType<{ children?: ReactNode }>;
}

// ── Metric category grouping ─────────────────────────────────────────────────

function metricCategory(metric: MetricDef): string {
  return metric.key.split(".")[0];
}

const METRICS_BY_CATEGORY: Map<string, MetricDef[]> = (() => {
  const map = new Map<string, MetricDef[]>();
  for (const metric of DASHBOARD_METRICS) {
    const cat = metricCategory(metric);
    const list = map.get(cat) ?? [];
    list.push(metric);
    map.set(cat, list);
  }
  return map;
})();

const CATEGORY_LABELS: Record<string, string> = {
  identity: "Identity & Access",
  governance: "Identity Governance",
  security: "Security & Defender",
  compliance: "Compliance & Governance",
  collaboration: "Collaboration & Exchange",
  licensing: "Licensing & Cost",
  intune: "Intune & Devices",
  drift: "Configuration Drift",
  dynamics: "Dynamics 365",
  powerPlatform: "Power Platform",
  copilot: "Copilot",
  usage: "Usage & Adoption",
  platform: "Platform Ops",
  workflow: "Workflow Engine",
  engine: "Engine Scores",
  alerts: "Alerts",
  health: "Client Health",
  projects: "Projects & Delivery",
  sla: "SLA & Scope Creep",
  financial: "Financial",
  offers: "Sales Offers",
  packages: "Monitoring Packages",
  ai: "AI Usage",
  portalWf: "Workflow Runs",
  diagnostics: "Diagnostics",
  benchmark: "Benchmarking",
  serviceHealth: "Service Health",
};

// ── Layout helpers ────────────────────────────────────────────────────────────

function nextWidgetPosition(widgets: WidgetInstance[], _w: number, _h: number): { x: number; y: number } {
  const maxY = widgets.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  return { x: 0, y: maxY };
}

let widgetSeq = 0;
function newWidgetId(): string {
  widgetSeq += 1;
  return `w-${Date.now()}-${widgetSeq}`;
}

// ── Renderer-choice dialog (multiple valid renderers for a metric) ────────────

function RendererChoiceDialog({
  ui,
  metric,
  renderers,
  open,
  onClose,
  onChoose,
}: {
  ui: DesignerUIKit;
  metric: MetricDef | null;
  renderers: RendererDef[];
  open: boolean;
  onClose: () => void;
  onChoose: (renderer: RendererDef) => void;
}) {
  const { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button } = ui;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a chart type</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          "{metric?.label}" supports more than one display — pick how it should render.
        </p>
        <div className="grid grid-cols-2 gap-2 py-2">
          {renderers.map((r) => (
            <button
              key={r.type}
              onClick={() => onChoose(r)}
              className="text-left p-3 rounded-lg border bg-muted/30 hover:bg-muted/80 transition-colors"
            >
              <p className="text-sm font-semibold">{r.type}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{r.label}</p>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Widget palette ────────────────────────────────────────────────────────────

function WidgetPalette({ ui, onPick }: { ui: DesignerUIKit; onPick: (metric: MetricDef) => void }) {
  const { Badge } = ui;
  const [search, setSearch] = useState("");
  const categories = useMemo(() => [...METRICS_BY_CATEGORY.keys()].sort(), []);

  const filtered = useMemo(() => {
    if (!search.trim()) return METRICS_BY_CATEGORY;
    const q = search.toLowerCase();
    const map = new Map<string, MetricDef[]>();
    for (const [cat, metrics] of METRICS_BY_CATEGORY) {
      const matches = metrics.filter((m) => m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q));
      if (matches.length > 0) map.set(cat, matches);
    }
    return map;
  }, [search]);

  return (
    <div className="w-72 border bg-card rounded-lg p-3 flex flex-col gap-3 overflow-hidden shrink-0">
      <div>
        <h3 className="font-semibold text-sm">Metric Palette</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">Click a metric to add it to the canvas.</p>
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search metrics…"
        className="h-8 text-xs px-2 rounded-md border bg-background"
      />
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {(search.trim() ? [...filtered.keys()] : categories).map((cat) => {
          const metrics = filtered.get(cat);
          if (!metrics || metrics.length === 0) return null;
          return (
            <div key={cat}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1 mb-1">
                {CATEGORY_LABELS[cat] ?? cat}
              </p>
              <div className="space-y-1">
                {metrics.map((m) => {
                  const validRenderers = getValidRenderersForMetric(m.key);
                  const disabled = validRenderers.length === 0;
                  return (
                    <button
                      key={m.key}
                      disabled={disabled}
                      onClick={() => onPick(m)}
                      title={disabled ? "No renderer supports this metric's shape yet" : m.key}
                      className={`w-full text-left px-2 py-1.5 rounded-md text-xs border transition-colors ${
                        disabled
                          ? "opacity-40 cursor-not-allowed bg-muted/20"
                          : "bg-muted/20 hover:bg-muted/70 cursor-pointer"
                      }`}
                    >
                      <span className="font-medium">{m.label}</span>
                      {m.status !== "available" && (
                        <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0">
                          {m.status === "needs_aggregation" ? "aggregated" : "not collected"}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DashboardDesigner({ adapter, targetSelector, ui }: DashboardDesignerProps) {
  const { fetchWithAuth, basePath, fetchTargetKeyOptions } = adapter;
  const {
    Card, CardHeader, CardTitle, CardDescription, CardContent,
    Button, Label, Badge, Switch,
    Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  } = ui;
  const mspId = targetSelector.mspId;

  // ── Target picker ──
  const [templateType, setTemplateType] = useState<TemplateType>("msp_overview");
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [targetKeyOptions, setTargetKeyOptions] = useState<TargetKeyOption[]>([]);

  const needsTargetKey = TARGET_KEY_TEMPLATE_TYPES.has(templateType);

  useEffect(() => {
    setTargetKey(null);
    if (!needsTargetKey) {
      setTargetKeyOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const options = await fetchTargetKeyOptions(templateType);
      if (!cancelled) setTargetKeyOptions(options);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateType, needsTargetKey]);

  // ── Load existing template for the current mspId+templateType+targetKey ──
  const [widgets, setWidgets] = useState<WidgetInstance[]>([]);
  const [allowCustomerEdit, setAllowCustomerEdit] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [existingTemplateId, setExistingTemplateId] = useState<number | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canLoad = mspId != null && (!needsTargetKey || targetKey != null);

  const loadTemplate = useCallback(async () => {
    if (!canLoad || mspId == null) return;
    setLoadingTemplate(true);
    try {
      const params = new URLSearchParams({ mspId: String(mspId), templateType });
      if (targetKey) params.set("targetKey", targetKey);
      const res = await fetchWithAuth(`${basePath}/lookup?${params}`);
      if (!res.ok) {
        setError("Failed to look up existing template");
        return;
      }
      const data = (await res.json()) as { template: DashboardTemplate | null };
      if (data.template) {
        setWidgets(data.template.canvasLayout ?? []);
        setAllowCustomerEdit(data.template.allowCustomerEdit);
        setIsDefault(data.template.isDefault);
        setExistingTemplateId(data.template.id);
      } else {
        setWidgets([]);
        setAllowCustomerEdit(true);
        setIsDefault(false);
        setExistingTemplateId(null);
      }
    } finally {
      setLoadingTemplate(false);
    }
  }, [canLoad, mspId, templateType, targetKey, fetchWithAuth, basePath]);

  useEffect(() => {
    void loadTemplate();
  }, [loadTemplate]);

  // ── Palette -> canvas placement ──
  const [rendererChoice, setRendererChoice] = useState<{ metric: MetricDef; renderers: RendererDef[] } | null>(null);

  function placeWidget(metric: MetricDef, renderer: RendererDef) {
    const { x, y } = nextWidgetPosition(widgets, renderer.defaultSize.w, renderer.defaultSize.h);
    const displayMode: WidgetDisplayMode | undefined = metric.denominatorMetric ? "percentage" : undefined;
    const widget: WidgetInstance = {
      i: newWidgetId(),
      x,
      y,
      w: renderer.defaultSize.w,
      h: renderer.defaultSize.h,
      metricKey: metric.key,
      rendererType: renderer.type,
      ...(displayMode ? { displayMode } : {}),
    };
    setWidgets((prev) => [...prev, widget]);
  }

  function handlePickMetric(metric: MetricDef) {
    const renderers = getValidRenderersForMetric(metric.key);
    if (renderers.length === 0) return;
    if (renderers.length === 1) {
      placeWidget(metric, renderers[0]);
      return;
    }
    setRendererChoice({ metric, renderers });
  }

  function removeWidget(id: string) {
    setWidgets((prev) => prev.filter((w) => w.i !== id));
  }

  function toggleDisplayMode(id: string) {
    setWidgets((prev) =>
      prev.map((w) => {
        if (w.i !== id) return w;
        const metric = getMetric(w.metricKey);
        if (!metric?.denominatorMetric) return w;
        return { ...w, displayMode: w.displayMode === "percentage" ? "count" : "percentage" };
      }),
    );
  }

  // ── Save ──
  async function handleSave() {
    setError(null);
    if (mspId == null) {
      setError("Pick an MSP first");
      return;
    }
    if (needsTargetKey && !targetKey) {
      setError(`A ${TEMPLATE_TYPES.find((t) => t.value === templateType)?.label} target is required`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mspId,
          templateType,
          targetKey,
          canvasLayout: widgets,
          allowCustomerEdit,
          isDefault,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "Unknown error" }))) as { error?: string };
        setError(err.error ?? "Save failed");
        return;
      }
      const data = (await res.json()) as { template: DashboardTemplate };
      setExistingTemplateId(data.template.id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 h-[calc(100vh-4rem)] flex flex-col gap-4 overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <LayoutDashboard className="size-5" />
            Dashboard Designer
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Design the widget layout customers and MSP operators see for a given assessment, project, monitoring
            package, or overview dashboard.
          </p>
        </div>
        <Button onClick={() => void handleSave()} disabled={saving || mspId == null} className="gap-1.5">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {existingTemplateId ? "Save Template" : "Create Template"}
        </Button>
      </div>

      {error && (
        <div className="shrink-0 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Target picker */}
      <Card className="shrink-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Target</CardTitle>
          <CardDescription className="text-xs">Pick what this layout applies to.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          {targetSelector.render()}

          <div className="space-y-1.5">
            <Label className="text-xs">Template Type</Label>
            <Select value={templateType} onValueChange={(v) => setTemplateType(v as TemplateType)}>
              <SelectTrigger className="h-8 text-xs w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsTargetKey && (
            <div className="space-y-1.5">
              <Label className="text-xs">
                {templateType === "assessment" ? "Assessment" : templateType === "project" ? "Project" : "Monitoring Package"}
              </Label>
              <Select value={targetKey ?? undefined} onValueChange={setTargetKey}>
                <SelectTrigger className="h-8 text-xs w-64">
                  <SelectValue placeholder="Select a target" />
                </SelectTrigger>
                <SelectContent>
                  {targetKeyOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-2 pb-1.5">
            <Switch checked={allowCustomerEdit} onCheckedChange={setAllowCustomerEdit} />
            <Label className="text-xs">Allow customer edit</Label>
          </div>
          <div className="flex items-center gap-2 pb-1.5">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            <Label className="text-xs">Default template</Label>
          </div>

          {existingTemplateId && (
            <Badge variant="outline" className="text-[10px]">
              Editing existing template #{existingTemplateId}
            </Badge>
          )}
          {!existingTemplateId && canLoad && !loadingTemplate && (
            <Badge variant="outline" className="text-[10px]">
              New template
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Palette + canvas */}
      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        <WidgetPalette ui={ui} onPick={handlePickMetric} />

        <div className="flex-1 border bg-muted/10 rounded-lg p-4 overflow-y-auto relative">
          {!canLoad ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
              <LayoutDashboard className="size-10 text-muted-foreground/30 mb-3" />
              <p className="font-medium text-sm text-muted-foreground">
                {mspId == null ? "Pick an MSP to begin" : "Pick a target to begin"}
              </p>
            </div>
          ) : loadingTemplate ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <DashboardCanvasEditor
              widgets={widgets}
              onLayoutChange={setWidgets}
              onRemove={removeWidget}
              onToggleDisplayMode={toggleDisplayMode}
            />
          )}
        </div>
      </div>

      <RendererChoiceDialog
        ui={ui}
        metric={rendererChoice?.metric ?? null}
        renderers={rendererChoice?.renderers ?? []}
        open={rendererChoice != null}
        onClose={() => setRendererChoice(null)}
        onChoose={(renderer) => {
          if (rendererChoice) placeWidget(rendererChoice.metric, renderer);
          setRendererChoice(null);
        }}
      />
    </div>
  );
}

// ── Canvas wrapper: overlays remove/display-mode controls on each tile ────────

function DashboardCanvasEditor({
  widgets,
  onLayoutChange,
  onRemove,
  onToggleDisplayMode,
}: {
  widgets: WidgetInstance[];
  onLayoutChange: (widgets: WidgetInstance[]) => void;
  onRemove: (id: string) => void;
  onToggleDisplayMode: (id: string) => void;
}) {
  if (widgets.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
        <LayoutDashboard className="size-10 text-muted-foreground/30 mb-3" />
        <p className="font-medium text-sm text-muted-foreground">Empty canvas</p>
        <p className="text-xs text-muted-foreground/80 mt-1 max-w-xs">
          Click a metric in the palette to add your first widget.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="grid grid-cols-1 gap-1 mb-2">
        {widgets.map((w) => {
          const metric = getMetric(w.metricKey);
          return (
            <div key={w.i} className="flex items-center gap-2 text-[11px] text-muted-foreground bg-card border rounded px-2 py-1">
              <span className="font-medium text-foreground truncate flex-1">{metric?.label ?? w.metricKey}</span>
              <span className="text-muted-foreground">{w.rendererType}</span>
              {metric?.denominatorMetric && (
                <button
                  onClick={() => onToggleDisplayMode(w.i)}
                  className="px-1.5 py-0.5 rounded border bg-muted/30 hover:bg-muted/70"
                >
                  {w.displayMode === "percentage" ? "%" : "#"}
                </button>
              )}
              <button
                onClick={() => onRemove(w.i)}
                className="p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                title="Remove widget"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
      <DashboardCanvas
        widgets={widgets}
        editable
        scope={{ type: "msp", id: 0 }}
        fetcher={mockDashboardDataFetcher}
        onLayoutChange={onLayoutChange}
      />
    </div>
  );
}
