/**
 * dashboard-canvas-preview.tsx
 *
 * Internal-only preview page for the Dashboard Web Part System's Components
 * step (Step 4a). Mounts <DashboardCanvas> with a hand-picked widget per
 * renderer type, resolved against a real customer via the real
 * POST /api/dashboard/resolve endpoint (createDashboardDataFetcher) — no mock.
 *
 * Not linked from any nav menu; reachable only by navigating directly to
 * /dashboard-canvas-preview while signed in. Wiring this into a real page
 * (command-center.tsx replacement, admin designer, etc.) is a later step.
 */
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { DashboardCanvas, createDashboardDataFetcher, type WidgetInstance } from "@workspace/dashboard-canvas";

// One sample widget per renderer type, chosen so each metric's shape/flags
// satisfy that renderer's acceptance rules in getValidRenderersForMetric:
//   Stat        -> scalar                                  identity.disabledAccountCount
//   Gauge       -> scalar                                   engine.healthScore
//   Trend       -> trend                                    identity.failedSigninCount
//   Distribution-> distribution                              security.alertsBySeverity
//   Bar         -> distribution (registry also accepts trend) licensing.skuBreakdown
//   Heatmap     -> heatmap                                   identity.signinActivity
//   Timeline    -> timeline                                  identity.provisioningEventCount
//   Radar       -> distribution, 3+ dims                     engine.pillarSnapshot
//   ScoreRing   -> scalar + denominatorMetric set             compliance.oversharedSiteCount
//   Smart       -> scalar + smartEligible                     identity.mfaRegisteredCount
const SAMPLE_WIDGETS: WidgetInstance[] = [
  { i: "w-stat", x: 0, y: 0, w: 2, h: 2, metricKey: "identity.disabledAccountCount", rendererType: "Stat" },
  { i: "w-gauge", x: 2, y: 0, w: 3, h: 3, metricKey: "engine.healthScore", rendererType: "Gauge" },
  { i: "w-trend", x: 5, y: 0, w: 4, h: 3, metricKey: "identity.failedSigninCount", rendererType: "Trend" },
  { i: "w-dist", x: 9, y: 0, w: 3, h: 3, metricKey: "security.alertsBySeverity", rendererType: "Distribution" },
  { i: "w-bar", x: 0, y: 3, w: 4, h: 3, metricKey: "licensing.skuBreakdown", rendererType: "Bar" },
  { i: "w-heatmap", x: 4, y: 3, w: 4, h: 3, metricKey: "identity.signinActivity", rendererType: "Heatmap" },
  { i: "w-timeline", x: 8, y: 3, w: 4, h: 4, metricKey: "identity.provisioningEventCount", rendererType: "Timeline" },
  { i: "w-radar", x: 0, y: 6, w: 4, h: 4, metricKey: "engine.pillarSnapshot", rendererType: "Radar" },
  { i: "w-scorering", x: 4, y: 6, w: 3, h: 3, metricKey: "compliance.oversharedSiteCount", rendererType: "ScoreRing" },
  { i: "w-smart", x: 7, y: 6, w: 3, h: 3, metricKey: "identity.mfaRegisteredCount", rendererType: "Smart" },
];

export default function DashboardCanvasPreviewPage() {
  const { fetchWithAuth, user } = useAuth();
  const fetcher = useMemo(() => createDashboardDataFetcher(fetchWithAuth), [fetchWithAuth]);

  const [customerId, setCustomerId] = useState<number | null>(null);
  const [loadingCustomer, setLoadingCustomer] = useState(true);

  // Resolve a real customer to preview against — reuse the same
  // /api/msp/customers list source reports.tsx uses for its test-email picker,
  // rather than hardcoding a guessed id.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/msp/customers?limit=1&mspId=${user?.mspId}`);
        if (!res.ok) return;
        const data = (await res.json()) as { customers: { id: number }[] };
        if (!cancelled && data.customers?.[0]) setCustomerId(data.customers[0].id);
      } finally {
        if (!cancelled) setLoadingCustomer(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, user?.mspId]);

  return (
    <AppShell title="Dashboard Canvas Preview (internal)">
      <div className="p-6 space-y-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Dashboard Web Part Components — Preview</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Not linked in nav. One sample widget per renderer type, resolved against real data via{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">POST /api/dashboard/resolve</code>.
            {customerId != null && <> Customer scope: <span className="font-medium text-foreground">#{customerId}</span>.</>}
          </p>
        </div>

        {loadingCustomer && <p className="text-sm text-muted-foreground">Resolving a customer to preview against…</p>}

        {!loadingCustomer && customerId == null && (
          <p className="text-sm text-destructive">
            No customer found for this MSP — cannot preview customer-scope widgets. (MSP-scope widgets would still resolve.)
          </p>
        )}

        {!loadingCustomer && customerId != null && (
          <DashboardCanvas
            widgets={SAMPLE_WIDGETS}
            editable={false}
            scope={{ type: "customer", id: customerId }}
            fetcher={fetcher}
          />
        )}
      </div>
    </AppShell>
  );
}
