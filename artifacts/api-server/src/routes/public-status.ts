/**
 * Public Status Page — platform's-own-uptime + M365 Service Health.
 *
 * GET /api/status — unauthenticated. Derives a sanitized overall state from
 * the same underlying signals admin-observability.ts's heartbeats use (cron
 * loop health, API heartbeat), but returns ONLY the boolean/enum state —
 * never raw internals like queue depths, DB stats, or tenant-identifying
 * data. Also returns the last 90 days of platform_incidents, most recent
 * first, plus an m365Health section (see fetchM365Health below).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  pool,
  platformIncidentsTable,
  monitorChecksTable,
  tenantConsentTable,
  mspCustomersTable,
  mspsTable,
} from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { graphFetchForTenant, ConsentRevokedError } from "../lib/graph";
import { HEALTHY_STATUSES } from "../lib/m365-health-status";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const log = logger.child({ channel: "system.core" });
const m365Log = logger.child({ channel: "integration.azure" });

const M365_CHECK_KEY = "m365:service-health";

interface GraphServiceHealth {
  id: string;
  service: string;
  status: string;
}

export type M365ServiceStatus = "healthy" | "degraded" | "interruption";

export interface M365ServiceHealthEntry {
  service: string;
  status: M365ServiceStatus;
}

export type M365HealthSection =
  | { available: true; services: M365ServiceHealthEntry[] }
  | { available: false; reason: string };

// serviceHealthStatus enum (Graph v1.0 serviceHealth resource docs) mapped
// down to the sanitized 3-value public enum. HEALTHY_STATUSES lives in
// m365-health-status.ts (shared with sla-uptime.ts's Uptime Percentage
// calculation, so the same status never reads as up in one place and down
// in the other). Unknown/future values default to "degraded" rather than
// silently reporting healthy.
const INTERRUPTION_STATUSES = new Set(["serviceInterruption"]);

function toSanitizedStatus(rawStatus: string): M365ServiceStatus {
  if (HEALTHY_STATUSES.has(rawStatus)) return "healthy";
  if (INTERRUPTION_STATUSES.has(rawStatus)) return "interruption";
  return "degraded";
}

// Live Graph result cached briefly so an unauthenticated, publicly-linkable
// page can't be used to hammer Graph on every request/bot crawl.
const M365_HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;
let m365HealthCache: { value: M365HealthSection; expiresAt: number } | null = null;

/**
 * Resolves Shane's own real M365 tenant: the single msp_customers row under
 * the isDirectBusiness MSP flagged isTestbed with granted Graph consent.
 * isTestbed=true is this codebase's established marker for "the one real
 * tenant it's safe to run live Graph writes/tests against, never a paying
 * customer's" (same flag Launch Control, baseline-template testing, and
 * Mission Control's remediate action all gate on) — it identifies Shane's
 * own tenant, not throwaway/fake data, so it must be INCLUDED here, not
 * excluded. Filtering isTestbed=false (the prior behavior) selects real
 * paying direct-business customers instead, which both fails to resolve
 * Shane's own tenant and would leak a real customer's M365 health onto this
 * unauthenticated public page if one ever had granted consent.
 * This is a PUBLIC page, so we deliberately show only this one tenant's
 * health — not a per-customer selector. If a real customer base exists
 * later, this needs to become an authenticated per-customer view instead
 * (flagged, not solved here).
 */
async function resolveOwnTenantId(): Promise<string | null> {
  const [row] = await db
    .select({ tenantId: tenantConsentTable.tenantId })
    .from(tenantConsentTable)
    .innerJoin(mspCustomersTable, eq(mspCustomersTable.id, tenantConsentTable.customerId))
    .innerJoin(mspsTable, eq(mspsTable.id, mspCustomersTable.mspId))
    .where(and(
      eq(mspsTable.isDirectBusiness, true),
      eq(mspCustomersTable.isTestbed, true),
      eq(tenantConsentTable.consentStatus, "granted"),
    ))
    .limit(1);

  return row?.tenantId ?? null;
}

async function fetchM365Health(): Promise<M365HealthSection> {
  const now = Date.now();
  if (m365HealthCache && now < m365HealthCache.expiresAt) {
    return m365HealthCache.value;
  }

  const result = await computeM365Health();
  m365HealthCache = { value: result, expiresAt: now + M365_HEALTH_CACHE_TTL_MS };
  return result;
}

async function computeM365Health(): Promise<M365HealthSection> {
  try {
    const [check] = await db
      .select()
      .from(monitorChecksTable)
      .where(and(eq(monitorChecksTable.key, M365_CHECK_KEY), eq(monitorChecksTable.status, "active")))
      .limit(1);

    if (!check) {
      return { available: false, reason: "not_configured" };
    }

    const tenantId = await resolveOwnTenantId();
    if (!tenantId) {
      return { available: false, reason: "no_tenant" };
    }

    const res = await graphFetchForTenant(tenantId, check.endpoint, { method: check.method ?? "GET" });
    if (!res.ok) {
      m365Log.warn({ status: res.status }, "public-status: m365 health-overview fetch failed");
      return { available: false, reason: "fetch_failed" };
    }

    const data = await res.json() as { value?: GraphServiceHealth[] };
    const services: M365ServiceHealthEntry[] = (data.value ?? [])
      .filter((s) => s?.service)
      .map((s) => ({ service: s.service, status: toSanitizedStatus(s.status) }));

    return { available: true, services };
  } catch (err) {
    if (err instanceof ConsentRevokedError) {
      m365Log.warn({ tenantId: err.tenantId }, "public-status: m365 health consent revoked");
      return { available: false, reason: "consent_revoked" };
    }
    m365Log.error({ err }, "public-status: m365 health fetch error");
    return { available: false, reason: "error" };
  }
}

router.get("/status", async (_req: Request, res: Response) => {
  try {
    // API engine heartbeat is healthy because we successfully process this request
    // (same reasoning admin-observability.ts's apiEngineHeartbeat uses).
    const apiHealthy = true;

    const cronHealthStats = await pool
      .query<{ max_delay_seconds: number }>(`
        SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) as max_delay_seconds
        FROM msp_job_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
      `)
      .catch(() => ({ rows: [] as { max_delay_seconds: number }[] }));

    const maxQueueDelay = cronHealthStats.rows[0]?.max_delay_seconds ?? 0;
    const cronHealthy = maxQueueDelay <= 300;

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const incidents = await db
      .select({
        id: platformIncidentsTable.id,
        title: platformIncidentsTable.title,
        description: platformIncidentsTable.description,
        severity: platformIncidentsTable.severity,
        status: platformIncidentsTable.status,
        startedAt: platformIncidentsTable.startedAt,
        resolvedAt: platformIncidentsTable.resolvedAt,
      })
      .from(platformIncidentsTable)
      .where(and(gte(platformIncidentsTable.startedAt, ninetyDaysAgo)))
      .orderBy(desc(platformIncidentsTable.startedAt));

    const hasUnresolvedCritical = incidents.some(
      (i) => i.status !== "resolved" && i.severity === "critical",
    );
    const hasUnresolved = incidents.some((i) => i.status !== "resolved");

    let overall: "operational" | "degraded" | "outage" = "operational";
    if (!apiHealthy || hasUnresolvedCritical) {
      overall = "outage";
    } else if (!cronHealthy || hasUnresolved) {
      overall = "degraded";
    }

    const m365Health = await fetchM365Health();

    res.json({
      status: overall,
      incidents,
      m365Health,
    });
  } catch (err) {
    log.error({ err }, "GET /status failed");
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

export default router;
