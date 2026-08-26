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
  tenantsTable,
  mspsTable,
} from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { graphFetchForTenant, ConsentRevokedError } from "../lib/graph";
import { HEALTHY_STATUSES } from "../lib/m365-health-status";
import { computeM365UptimeForTenant, SLA_TARGET_UPTIME_PERCENT } from "../lib/sla-uptime";
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

// Rolling 90-day time-weighted Uptime Percentage per M365 workload, read from
// the real m365_service_health_samples history via sla-uptime.ts (the math is
// NOT reimplemented here — this route only exposes it for Shane's own tenant on
// the public page). Distinct from m365Health above, which is the current
// live/sanitized state; this is the measured 90-day availability against
// Microsoft's own 99.9% published SLA. overallUptimePercent is the unweighted
// mean of the workloads that have real sample coverage (null when none do).
export interface M365UptimeServiceEntry {
  service: string;
  uptimePercent: number | null;
  breached: boolean;
  coverage: number;
  sampleCount: number;
}

export type M365UptimeSection =
  | { available: true; target: number; services: M365UptimeServiceEntry[]; overallUptimePercent: number | null }
  | { available: false; reason: string };

// A real, platform-WIDE 90-day daily history strip derived from the same
// platform_incidents rows the incident feed uses — NOT a fabricated per-day
// per-component series. Each day is classified by the worst real incident whose
// [startedAt, resolvedAt|now] window overlapped that UTC day (critical/major →
// "outage", minor → "degraded", none → "operational"). title/description carry
// that worst incident's real text for the per-bar hover tooltip; null on a clean
// day. Per-COMPONENT daily bars remain a genuine gap (no daily-rollup source, no
// per-component SLO thresholds) — this platform-wide strip is what can be
// grounded honestly today.
export interface DailyHistoryEntry {
  date: string; // UTC calendar day, YYYY-MM-DD
  status: "operational" | "degraded" | "outage";
  title: string | null;
  description: string | null;
}

export interface IncidentWindow {
  severity: "minor" | "major" | "critical";
  title: string;
  description: string;
  startedAt: Date;
  endedAt: Date;
}

const STATUS_RANK: Record<DailyHistoryEntry["status"], number> = { operational: 0, degraded: 1, outage: 2 };

function severityToDayStatus(severity: "minor" | "major" | "critical"): DailyHistoryEntry["status"] {
  return severity === "minor" ? "degraded" : "outage";
}

// 90 UTC-day buckets, oldest first (index 89 = today), so the frontend renders
// "newest on the right". Each day inherits the worst overlapping real incident.
export function computeDailyHistory(incidents: IncidentWindow[], now: Date): DailyHistoryEntry[] {
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const DAY_MS = 24 * 60 * 60 * 1000;
  const out: DailyHistoryEntry[] = [];

  for (let offset = 89; offset >= 0; offset--) {
    const dayStart = startOfTodayUtc - offset * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const iso = new Date(dayStart).toISOString().slice(0, 10);

    let status: DailyHistoryEntry["status"] = "operational";
    let worst: IncidentWindow | null = null;
    for (const inc of incidents) {
      const overlaps = inc.startedAt.getTime() < dayEnd && inc.endedAt.getTime() > dayStart;
      if (!overlaps) continue;
      const dayStatus = severityToDayStatus(inc.severity);
      if (STATUS_RANK[dayStatus] > STATUS_RANK[status]) {
        status = dayStatus;
        worst = inc;
      } else if (STATUS_RANK[dayStatus] === STATUS_RANK[status] && !worst) {
        worst = inc;
      }
    }

    out.push({
      date: iso,
      status,
      title: worst?.title ?? null,
      description: worst?.description ?? null,
    });
  }

  return out;
}

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
 * Resolves Shane's own real M365 tenant: the single `tenants` row under
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
  // Graph consent now lives in the tenants.consent jsonb column keyed by type.
  // Only the `graph` key gates this page — writeBack/sharepoint are independent
  // grants and neither implies a Graph read grant. The status is filtered in JS
  // (matching every other consent reader in the codebase) rather than pushed
  // into SQL, so the candidate set is deliberately narrowed by the two indexed
  // boolean flags first; on a public, unauthenticated page a tenant without an
  // explicitly granted `graph` record is never selected.
  const rows = await db
    .select({ tenantId: tenantsTable.tenantId, consent: tenantsTable.consent })
    .from(tenantsTable)
    .innerJoin(mspsTable, eq(mspsTable.id, tenantsTable.mspId))
    .where(and(
      eq(mspsTable.isDirectBusiness, true),
      eq(tenantsTable.isTestbed, true),
    ));

  const granted = rows.find((r) => r.consent?.graph?.status === "granted");
  return granted?.tenantId ?? null;
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

// Uptime computation is a handful of indexed sample reads per service; cached
// on the same 5-minute cadence as the live health above so a public,
// bot-crawlable page can't turn every hit into a burst of DB work.
const M365_UPTIME_CACHE_TTL_MS = 5 * 60 * 1000;
let m365UptimeCache: { value: M365UptimeSection; expiresAt: number } | null = null;

async function fetchM365Uptime(): Promise<M365UptimeSection> {
  const now = Date.now();
  if (m365UptimeCache && now < m365UptimeCache.expiresAt) {
    return m365UptimeCache.value;
  }
  const result = await computeM365Uptime();
  m365UptimeCache = { value: result, expiresAt: now + M365_UPTIME_CACHE_TTL_MS };
  return result;
}

async function computeM365Uptime(): Promise<M365UptimeSection> {
  try {
    const tenantId = await resolveOwnTenantId();
    if (!tenantId) {
      return { available: false, reason: "no_tenant" };
    }

    // Reads samples only (no Graph call) — reuses sla-uptime.ts's time-weighted
    // math verbatim rather than re-deriving a second uptime judgment here.
    const summaries = await computeM365UptimeForTenant(tenantId);
    if (summaries.length === 0) {
      return { available: false, reason: "no_samples" };
    }

    const services: M365UptimeServiceEntry[] = summaries.map((s) => {
      const w = s.windows[90];
      return {
        service: s.service,
        uptimePercent: w.uptimePercent,
        breached: w.breached,
        coverage: w.coverage,
        sampleCount: w.sampleCount,
      };
    });

    const measured = services
      .map((s) => s.uptimePercent)
      .filter((p): p is number => p !== null);
    const overallUptimePercent = measured.length > 0
      ? measured.reduce((sum, p) => sum + p, 0) / measured.length
      : null;

    return { available: true, target: SLA_TARGET_UPTIME_PERCENT, services, overallUptimePercent };
  } catch (err) {
    m365Log.error({ err }, "public-status: m365 uptime compute error");
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

    const [m365Health, m365Uptime] = await Promise.all([fetchM365Health(), fetchM365Uptime()]);

    // Real platform-wide 90-day daily strip, built from the incidents just read.
    const now = new Date();
    const dailyHistory = computeDailyHistory(
      incidents.map((i) => ({
        severity: i.severity,
        title: i.title,
        description: i.description,
        startedAt: i.startedAt,
        endedAt: i.resolvedAt ?? now,
      })),
      now,
    );

    res.json({
      status: overall,
      incidents,
      m365Health,
      m365Uptime,
      dailyHistory,
    });
  } catch (err) {
    log.error({ err }, "GET /status failed");
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

export default router;
