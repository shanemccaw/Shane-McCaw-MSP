/**
 * useRegistryOptions
 *
 * Fetches the Engine Registry and Plan-Feature Registry from the API so that
 * the Monitoring Tier editor can populate its multiselects from live server
 * data rather than hardcoded constants.
 *
 * Falls back to static lists while loading or if the API is unreachable (e.g.
 * in Storybook / unit tests), so the form never renders empty option sets.
 */

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

export interface EngineOption { key: string; label: string; }
export interface FeatureOption { key: string; label: string; }

const FALLBACK_ENGINES: EngineOption[] = [
  { key: "priority",    label: "Priority" },
  { key: "pricing",     label: "Pricing" },
  { key: "health",      label: "Health" },
  { key: "drift",       label: "Drift" },
  { key: "forecasting", label: "Forecasting" },
  { key: "crm",         label: "CRM" },
  { key: "msp",         label: "MSP Portfolio" },
  { key: "sla",         label: "SLA" },
  { key: "scope_creep", label: "Scope Creep" },
  { key: "monitoring",  label: "Monitoring" },
  { key: "sales_offer", label: "Sales Offer" },
];

const FALLBACK_FEATURES: FeatureOption[] = [
  { key: "advanced_signals",             label: "Advanced Signals" },
  { key: "custom_workflows",             label: "Custom Workflows" },
  { key: "sla_scope_creep_custom_rules", label: "SLA / Scope-Creep Custom Rules" },
  { key: "sales_offers",                 label: "Sales Offers" },
  { key: "custom_bundle_composition",    label: "Custom Bundle Composition" },
];

export function useRegistryOptions(): {
  engines: EngineOption[];
  features: FeatureOption[];
  loading: boolean;
} {
  const { fetchWithAuth } = useAuth();
  const [engines, setEngines] = useState<EngineOption[]>(FALLBACK_ENGINES);
  const [features, setFeatures] = useState<FeatureOption[]>(FALLBACK_FEATURES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetchWithAuth("/api/admin/engines").then(r => r.json()),
      fetchWithAuth("/api/admin/plan-features").then(r => r.json()),
    ])
      .then(([engineData, featureData]) => {
        if (cancelled) return;
        if (Array.isArray(engineData?.engines)) {
          setEngines(
            (engineData.engines as { key: string; label: string }[]).map(e => ({
              key: e.key,
              label: e.label,
            })),
          );
        }
        if (Array.isArray(featureData?.features)) {
          setFeatures(
            (featureData.features as { key: string; label: string }[]).map(f => ({
              key: f.key,
              label: f.label,
            })),
          );
        }
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [fetchWithAuth]);

  return { engines, features, loading };
}
