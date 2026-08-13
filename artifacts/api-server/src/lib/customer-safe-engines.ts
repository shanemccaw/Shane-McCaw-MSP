/**
 * customer-safe-engines.ts
 *
 * The subset of ENGINE_DEFS (engine-registry.ts) safe to expose directly to a
 * CustomerUser session. Excludes MSP/platform-internal engines — priority
 * (ops triage ranking), pricing (revenue capture), crm (sales intent), msp
 * (portfolio-wide, not tenant-scoped), forecasting (resource planning), and
 * sales_offer (sales pipeline; its customer-visible output is the offers
 * themselves, not the engine's internal scoring).
 *
 * Shared by portal-mission-control.ts (engine status strip) and
 * portal-engine-history.ts (trend history) so the customer-facing surface
 * never drifts between the two.
 */

export const CUSTOMER_SAFE_ENGINES: Array<{ key: string; label: string }> = [
  { key: "health", label: "Tenant Health" },
  { key: "security", label: "Security" },
  { key: "drift", label: "Configuration Drift" },
  { key: "monitoring", label: "Monitoring" },
  { key: "sla", label: "Service Levels" },
  { key: "scope_creep", label: "Scope" },
];

export const CUSTOMER_SAFE_ENGINE_KEYS = CUSTOMER_SAFE_ENGINES.map((e) => e.key);
