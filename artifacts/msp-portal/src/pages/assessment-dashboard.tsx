/**
 * assessment-dashboard.tsx
 *
 * Assessment Results Dashboard — msp-portal customer-facing page.
 *
 * Route: /assessment-results/:serviceSlug  (registered in App.tsx)
 *
 * How it works:
 * 1. Fetches the service catalogue entry for this slug from /api/catalog/assessments
 *    to get the service name, description, and type_attributes.
 * 2. Reads type_attributes.dashboardModules: string[] to know which modules to show
 *    and in what order. Falls back to all 8 modules if the key is absent.
 * 3. Fetches assessment results from /api/portal/assessment-results/:serviceSlug.
 * 4. Renders each listed module key via <AssessmentModulePanel> — one fetch, shared
 *    results prop; no per-module re-fetching.
 * 5. Shows the document download link from results.document if available.
 *
 * No per-assessment branching in this page. Adding support for a new assessment
 * product requires only seeding type_attributes.dashboardModules on the service row.
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
import { AlertCircle, Download, RefreshCw } from "lucide-react";
import AssessmentModulePanel from "@/components/assessment-modules/AssessmentModulePanel";
import { ASSESSMENT_MODULE_DEFS } from "@/components/assessment-modules/module-registry";
import type { AssessmentResultsPayload } from "@/components/assessment-modules/module-registry";
import { toast } from "sonner";

// ── All 8 module keys in default display order ─────────────────────────────────
const DEFAULT_MODULE_ORDER = ASSESSMENT_MODULE_DEFS.map((d) => d.key);

// ── Catalogue service shape (subset we need from /api/catalog/assessments) ─────
interface CatalogService {
  slug: string;
  name: string;
  description: string | null;
  tagline: string | null;
  type_attributes: Record<string, unknown> | null;
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
  // Reads type_attributes.dashboardModules from the service row.
  // Falls back to DEFAULT_MODULE_ORDER (all 8) if the key is missing or empty.
  const rawModules = service?.type_attributes?.dashboardModules;
  const moduleKeys: string[] =
    Array.isArray(rawModules) && rawModules.length > 0
      ? (rawModules as string[])
      : DEFAULT_MODULE_ORDER;

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

        {/* ── Module grid ── */}
        {(!serviceError) && (
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
