/**
 * assessment-dashboard.tsx
 *
 * Assessment Results Dashboard — msp-portal customer-facing page.
 *
 * Route: /assessment-results/:serviceSlug  (registered in App.tsx)
 *
 * How it works:
 * 1. Fetches the service catalogue entry for this slug from /api/catalog/assessments
 *    to get the service name, description, type_attributes, and resultsTemplateFamily
 *    (the product's results_templates.family mapping, #162/#163, parent #161).
 * 2. Resolves which module keys to render:
 *    a. resultsTemplateFamily === 'framework_gap_list' | 'readiness_logistics' —
 *       renders that family's single dedicated module, bypassing dashboardModules
 *       entirely (see FAMILY_MODULE_OVERRIDES). These two families don't fit the
 *       pillar-module system, per #161's architecture doc.
 *    b. Otherwise (pillar_scored/copilot family, or unmapped) — falls back to the
 *       original behaviour: type_attributes.dashboardModules: string[] from the
 *       service row, or DEFAULT_MODULE_ORDER (the 8 pillar modules) if absent.
 * 3. Fetches assessment results from /api/portal/assessment-results/:serviceSlug.
 * 4. Renders each listed module key via <AssessmentModulePanel> — one fetch, shared
 *    results prop; no per-module re-fetching.
 * 5. Shows the document download link from results.document if available.
 *
 * No per-assessment branching in this page. Adding support for a new pillar_scored/
 * copilot assessment product requires only seeding type_attributes.dashboardModules
 * on the service row; adding a framework_gap_list/readiness_logistics product
 * requires only a results_templates row (#162's admin CRUD).
 *
 * type_attributes.dashboardModules format (JSON array of module keys):
 *   ["priority-health", "findings", "governance", "security", "compliance"]
 * Valid keys: priority-health | findings | governance | security | compliance |
 *             copilot | architecture | cost
 */
import { useEffect, useState, useCallback } from "react";
import { useParams } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Download, RefreshCw, Loader2 } from "lucide-react";
import AssessmentModulePanel from "@/components/assessment-modules/AssessmentModulePanel";
import { PILLAR_FAMILY_MODULE_KEYS } from "@/components/assessment-modules/module-registry";
import type { AssessmentResultsPayload } from "@/components/assessment-modules/module-registry";
import { toast } from "sonner";

// ── Default module order for the `pillar_scored`/`copilot` families (or any
//    product with no resultsTemplateFamily mapped yet) ─────────────────────────
const DEFAULT_MODULE_ORDER = PILLAR_FAMILY_MODULE_KEYS;

// ── Results Template family → module routing (#162/#163, parent #161) ──────────
// `framework_gap_list` and `readiness_logistics` don't fit the pillar-module
// system at all, so a product mapped to either bypasses type_attributes.
// dashboardModules entirely and renders its single dedicated module.
// `pillar_scored`/`copilot` (or an unmapped/null family) fall through to the
// existing dashboardModules-or-default-8 logic below, unchanged.
const FAMILY_MODULE_OVERRIDES: Record<string, string[]> = {
  framework_gap_list: ["framework-gap-list"],
  readiness_logistics: ["readiness-logistics"],
};

// ── Catalogue service shape (subset we need from /api/catalog/assessments) ─────
interface CatalogService {
  slug: string;
  name: string;
  description: string | null;
  tagline: string | null;
  type_attributes: Record<string, unknown> | null;
  resultsTemplateFamily: string | null;
}

// ── Status badge ──────────────────────────────────────────────────────────────
function RunStatusBadge({ status }: { status: AssessmentResultsPayload["status"] | null }) {
  if (!status) return null;
  const map: Record<string, { label: string; color: string }> = {
    complete: { label: "Complete",  color: "text-green-400 border-green-500/30" },
    pending:  { label: "Pending",   color: "text-amber-400 border-amber-500/30" },
    running:  { label: "Running",   color: "text-blue-400 border-blue-500/30"   },
    failed:   { label: "Failed",    color: "text-red-400 border-red-500/30"     },
  };
  const cfg = map[status] ?? { label: status, color: "text-muted-foreground border-border" };
  return (
    <Badge variant="outline" className={`text-xs ${cfg.color}`}>
      {cfg.label}
    </Badge>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

export default function AssessmentDashboardPage() {
  const { serviceSlug } = useParams<{ serviceSlug: string }>();
  const { fetchWithAuth } = useAuth();

  const [service, setService] = useState<CatalogService | null>(null);
  const [serviceLoading, setServiceLoading] = useState(true);
  const [serviceError, setServiceError] = useState<string | null>(null);

  const [results, setResults] = useState<AssessmentResultsPayload | null>(null);
  const [resultsLoading, setResultsLoading] = useState(true);
  const [resultsError, setResultsError] = useState<string | null>(null);

  // ── Fetch the service catalogue entry ─────────────────────────────────────
  useEffect(() => {
    if (!serviceSlug) return;
    let mounted = true;
    setServiceLoading(true);
    setServiceError(null);

    fetchWithAuth("/api/catalog/assessments")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load assessment catalogue");
        const rows = (await res.json()) as CatalogService[];
        const found = rows.find((r) => r.slug === serviceSlug) ?? null;
        if (mounted) setService(found);
      })
      .catch((err: unknown) => {
        if (mounted) setServiceError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => { if (mounted) setServiceLoading(false); });

    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceSlug]);

  // ── Fetch assessment results ───────────────────────────────────────────────
  const fetchResults = useCallback(() => {
    if (!serviceSlug) return;
    let mounted = true;
    setResultsLoading(true);
    setResultsError(null);

    fetchWithAuth(`/api/portal/assessment-results/${serviceSlug}`)
      .then(async (res) => {
        if (res.status === 404) {
          // No run started yet — treat as "pending" with null results
          if (mounted) setResults(null);
          return;
        }
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data = (await res.json()) as AssessmentResultsPayload;
        if (mounted) setResults(data);
      })
      .catch((err: unknown) => {
        if (mounted) setResultsError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => { if (mounted) setResultsLoading(false); });

    return () => { mounted = false; };
  }, [serviceSlug, fetchWithAuth]);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  // ── Resolve which module keys to render ───────────────────────────────────
  // 1. If the product's results_templates row maps it to `framework_gap_list`
  //    or `readiness_logistics`, that family's single dedicated module wins —
  //    those two don't fit the pillar-module system, so dashboardModules is
  //    not consulted at all for them.
  // 2. Otherwise (pillar_scored/copilot family, or no mapping yet), fall back
  //    to the pre-existing behaviour: type_attributes.dashboardModules from
  //    the service row, or DEFAULT_MODULE_ORDER (the 8 pillar modules) if
  //    that key is missing or empty.
  const familyOverride = service?.resultsTemplateFamily
    ? FAMILY_MODULE_OVERRIDES[service.resultsTemplateFamily]
    : undefined;
  const rawModules = service?.type_attributes?.dashboardModules;
  const moduleKeys: string[] = familyOverride
    ? familyOverride
    : Array.isArray(rawModules) && rawModules.length > 0
      ? (rawModules as string[])
      : DEFAULT_MODULE_ORDER;

  // ── Fetch telemetry state from dashboard ──────────────────────────────────
  const [telemetryStatus, setTelemetryStatus] = useState<"in_progress" | "completed" | null>(null);
  
  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/portal/assessment/telemetry")
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) setTelemetryStatus(data.telemetryStatus);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [fetchWithAuth]);

  const title = serviceLoading ? "Assessment Results" : (service?.name ?? serviceSlug ?? "Assessment Results");

  return (
    <AppShell title={title}>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">

        {/* ── Page header ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            {serviceLoading ? (
              <Skeleton className="h-7 w-64 mb-1" />
            ) : (
              <h2 className="text-xl font-bold tracking-tight">{title}</h2>
            )}
            {serviceLoading ? (
              <Skeleton className="h-4 w-80 mt-1" />
            ) : service?.tagline ? (
              <p className="text-muted-foreground text-sm mt-1">{service.tagline}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <RunStatusBadge status={results?.status ?? null} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchResults();
                toast.success("Refreshing results…");
              }}
            >
              <RefreshCw className="size-3.5 mr-1.5" />
              Refresh
            </Button>
          </div>
        </div>

        {/* ── Service not found ── */}
        {!serviceLoading && !service && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <AlertCircle className="size-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">
              Assessment service not found
            </p>
            <p className="text-xs text-muted-foreground/60 max-w-xs">
              No assessment matching <code className="font-mono bg-muted px-1 rounded">{serviceSlug}</code> was found
              in the catalogue. Please check the URL.
            </p>
          </div>
        )}

        {/* ── Results error ── */}
        {resultsError && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            <AlertCircle className="size-4 shrink-0" />
            <span>Could not load results: {resultsError}</span>
          </div>
        )}

        {/* ── Document download ── */}
        {results?.document?.downloadUrl && (
          <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg px-4 py-3">
            <Download className="size-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Assessment Report Available</p>
              <p className="text-xs text-muted-foreground">Your full assessment report is ready to download.</p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href={results.document.downloadUrl} target="_blank" rel="noopener noreferrer">
                Download
              </a>
            </Button>
          </div>
        )}

        {/* ── Telemetry Status ── */}
        {telemetryStatus === "in_progress" && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-4">
              <Loader2 className="size-8 text-primary animate-spin" />
              <div>
                <h3 className="text-lg font-semibold text-foreground">Analysis In Progress</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  We are actively generating telemetry and mapping your Microsoft 365 environment.
                  This process analyzes signals across identity, devices, and data.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Module grid ── */}
        {(!serviceError && telemetryStatus !== "in_progress") && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {moduleKeys.map((key) => (
              <AssessmentModulePanel
                key={key}
                moduleKey={key}
                serviceSlug={serviceSlug ?? ""}
                results={results}
                loading={resultsLoading}
                error={resultsError}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
