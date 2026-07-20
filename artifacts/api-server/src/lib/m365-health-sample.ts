/**
 * m365-health-sample.ts
 *
 * Hourly historical sampling for M365 Third-Party SLA Tracking.
 *
 * The m365:service-health monitor check is live-fetch-only (see its
 * migration's own comment — built only to answer "what's the status right
 * now" for the public status page, no per-tenant items persisted). SLA
 * Uptime Percentage needs real history, so this module does its own Graph
 * fetch (reusing the same consent-revocation-aware graphFetchForTenant path
 * public-status.ts already uses — no second Graph client) and persists one
 * row per service per tenant into m365_service_health_samples. Mirrors
 * message-center-sync.ts's shape: reads its endpoint/config from the
 * monitor_checks row so the check stays DB-driven, but does its own
 * per-item persistence since the generic monitor-executor pipeline only
 * stores per-run aggregates.
 *
 * Invoked hourly by the "__system__: M365 Service Health Sampling" seeded
 * workflow (see seed-system-workflows.ts) via the m365_health_sample node
 * type — not a setInterval poller.
 */

import { db } from "@workspace/db";
import {
  monitorChecksTable,
  tenantConsentTable,
  mspCustomersTable,
  m365ServiceHealthSamplesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { graphFetchForTenant, ConsentRevokedError, markTenantConsentRevoked } from "./graph";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.azure" });

const CHECK_KEY = "m365:service-health";

interface GraphServiceHealth {
  id: string;
  service: string;
  status: string;
}

export interface M365HealthSampleResult {
  tenantId: string;
  status: "ok" | "error" | "consent_revoked" | "no_check" | "no_customer";
  serviceCount: number;
  errorMessage?: string;
}

/**
 * Samples current per-service health for one tenant and inserts one row per
 * service into m365_service_health_samples. Resolves mspId/customerId from
 * the tenant's msp_customers row (via tenant_consent -> customerId), same
 * bridge message-center-sync.ts uses.
 */
export async function sampleM365ServiceHealthForTenant(tenantId: string): Promise<M365HealthSampleResult> {
  const [check] = await db
    .select()
    .from(monitorChecksTable)
    .where(and(eq(monitorChecksTable.key, CHECK_KEY), eq(monitorChecksTable.status, "active")))
    .limit(1);

  if (!check) {
    log.warn({ tenantId }, "m365-health-sample: monitor_checks row m365:service-health not found or inactive — skipping");
    return { tenantId, status: "no_check", serviceCount: 0 };
  }

  const [consent] = await db
    .select({ customerId: tenantConsentTable.customerId })
    .from(tenantConsentTable)
    .where(eq(tenantConsentTable.tenantId, tenantId))
    .limit(1);

  if (!consent?.customerId) {
    log.warn({ tenantId }, "m365-health-sample: no msp_customers row bridged for this tenant — skipping");
    return { tenantId, status: "no_customer", serviceCount: 0 };
  }

  const [customer] = await db
    .select({ id: mspCustomersTable.id, mspId: mspCustomersTable.mspId })
    .from(mspCustomersTable)
    .where(eq(mspCustomersTable.id, consent.customerId))
    .limit(1);

  if (!customer) {
    log.warn({ tenantId, customerId: consent.customerId }, "m365-health-sample: msp_customers row missing — skipping");
    return { tenantId, status: "no_customer", serviceCount: 0 };
  }

  try {
    const res = await graphFetchForTenant(tenantId, check.endpoint, { method: check.method ?? "GET" });
    if (!res.ok) {
      log.warn({ tenantId, httpStatus: res.status }, "m365-health-sample: healthOverviews fetch failed");
      return { tenantId, status: "error", serviceCount: 0, errorMessage: `HTTP ${res.status}` };
    }

    const data = await res.json() as { value?: GraphServiceHealth[] };
    const services = (data.value ?? []).filter((s) => s?.service && s?.status);
    if (services.length === 0) {
      return { tenantId, status: "ok", serviceCount: 0 };
    }

    const sampledAt = new Date();
    await db.insert(m365ServiceHealthSamplesTable).values(
      services.map((s) => ({
        tenantId,
        mspId: customer.mspId,
        customerId: customer.id,
        service: s.service,
        status: s.status,
        sampledAt,
      })),
    );

    log.info({ tenantId, mspId: customer.mspId, serviceCount: services.length }, "m365-health-sample: sampled tenant");
    return { tenantId, status: "ok", serviceCount: services.length };
  } catch (err) {
    if (err instanceof ConsentRevokedError) {
      await markTenantConsentRevoked(tenantId);
      log.warn({ tenantId }, "m365-health-sample: consent revoked");
      return { tenantId, status: "consent_revoked", serviceCount: 0 };
    }
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error({ tenantId, err: errorMessage }, "m365-health-sample: sample failed");
    return { tenantId, status: "error", serviceCount: 0, errorMessage };
  }
}

/**
 * Runs sampleM365ServiceHealthForTenant for every tenant with granted
 * consent. Intended to be called hourly (matching the check's declared
 * frequency) via the seeded workflow's m365_health_sample node.
 */
export async function sampleM365ServiceHealthForAllTenants(): Promise<M365HealthSampleResult[]> {
  const tenants = await db
    .select({ tenantId: tenantConsentTable.tenantId })
    .from(tenantConsentTable)
    .where(eq(tenantConsentTable.consentStatus, "granted"));

  const results: M365HealthSampleResult[] = [];
  for (const t of tenants) {
    results.push(await sampleM365ServiceHealthForTenant(t.tenantId));
  }
  return results;
}

/**
 * Workflow node handler for the m365_health_sample node type
 * (workflow-executor.ts's executeNode switch).
 */
export async function handleM365HealthSample(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  void payload;
  const results = await sampleM365ServiceHealthForAllTenants();
  const okCount = results.filter((r) => r.status === "ok").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const consentRevokedCount = results.filter((r) => r.status === "consent_revoked").length;
  return {
    tenantCount: results.length,
    okCount,
    errorCount,
    consentRevokedCount,
  };
}
