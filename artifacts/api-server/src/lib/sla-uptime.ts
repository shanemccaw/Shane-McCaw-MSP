/**
 * sla-uptime.ts
 *
 * M365 Third-Party SLA Tracking — computes Uptime Percentage from
 * m365_service_health_samples against Microsoft's own published commitment:
 * 99.9% Monthly Uptime Percentage per service (Volume Licensing SLA for
 * Online Services). A handful of voice services (Calling Plans, Teams
 * Phone, Audio Conferencing) carry a higher 99.999% target — out of scope
 * here; every service uses the flat 99.9% target.
 *
 * Time-weighted, not sample-averaged: each sample's status is held to have
 * applied for the whole interval since the previous sample (or since the
 * window start, for the first sample in range), not counted as one equal
 * "vote" among N samples. A service degraded for 1 hour out of a 720-hour
 * (30-day) window is ~99.86% uptime, not "1 bad sample out of N good ones."
 *
 * up/down status mapping: reuses public-status.ts's HEALTHY_STATUSES set
 * rather than re-deriving a second judgment call for the same enum in the
 * same codebase. That set already resolves the ambiguous cases this task
 * flags:
 *   - postIncidentReviewPublished / resolvedExternal: the incident is over,
 *     Microsoft is just publishing/finalizing the post-mortem — counts up.
 *   - investigationSuspended: Microsoft paused investigating, most often
 *     because the reported impact could not be confirmed/reproduced —
 *     treated as up rather than an open outage.
 *   - falsePositive / resolved / serviceRestored / serviceOperational: up.
 *   - Everything else (investigating, restoringService, verifyingService,
 *     serviceDegradation, serviceInterruption, extendedRecovery, confirmed,
 *     reported, mitigated, mitigatedExternal, unknownFutureValue): down.
 *     "mitigated"/"mitigatedExternal" deliberately stay down — a mitigation
 *     reduces impact but isn't the same as resolved, and public-status.ts's
 *     own set already draws that same line.
 */

import { db, m365ServiceHealthSamplesTable } from "@workspace/db";
import { and, asc, desc, eq, gt, lte } from "drizzle-orm";
import { isHealthyServiceStatus } from "./m365-health-status";

export const SLA_TARGET_UPTIME_PERCENT = 99.9;

export type SlaWindowDays = 30 | 90;

export interface M365ServiceUptimeResult {
  service: string;
  windowDays: SlaWindowDays;
  windowStart: string;
  windowEnd: string;
  /** null when there is no sample coverage at all in/before the window. */
  uptimePercent: number | null;
  breached: boolean;
  sampleCount: number;
  /** Fraction (0-1) of the window actually covered by samples — low coverage means the % above is based on partial history, not a full month. */
  coverage: number;
}

export function isUpStatus(status: string): boolean {
  return isHealthyServiceStatus(status);
}

export interface TimelinePoint {
  status: string;
  at: Date;
}

export function computeWeightedUptime(
  points: TimelinePoint[],
  windowStart: Date,
  windowEnd: Date,
): { totalMs: number; upMs: number } {
  let totalMs = 0;
  let upMs = 0;

  for (let i = 0; i < points.length; i++) {
    const segStart = Math.max(points[i].at.getTime(), windowStart.getTime());
    const segEndRaw = i + 1 < points.length ? points[i + 1].at.getTime() : windowEnd.getTime();
    const segEnd = Math.min(segEndRaw, windowEnd.getTime());
    if (segEnd <= segStart) continue;

    const durationMs = segEnd - segStart;
    totalMs += durationMs;
    if (isUpStatus(points[i].status)) upMs += durationMs;
  }

  return { totalMs, upMs };
}

/**
 * Computes time-weighted Uptime Percentage for one (tenant, service) over a
 * trailing window. Looks up the latest sample at-or-before the window start
 * (if any) to seed the status that was in effect entering the window, then
 * time-weights every sample within the window through to windowEnd (now).
 */
export async function computeM365ServiceUptime(
  tenantId: string,
  service: string,
  windowDays: SlaWindowDays,
): Promise<M365ServiceUptimeResult> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [priorSample] = await db
    .select({ status: m365ServiceHealthSamplesTable.status, sampledAt: m365ServiceHealthSamplesTable.sampledAt })
    .from(m365ServiceHealthSamplesTable)
    .where(and(
      eq(m365ServiceHealthSamplesTable.tenantId, tenantId),
      eq(m365ServiceHealthSamplesTable.service, service),
      lte(m365ServiceHealthSamplesTable.sampledAt, windowStart),
    ))
    .orderBy(desc(m365ServiceHealthSamplesTable.sampledAt))
    .limit(1);

  const inWindowSamples = await db
    .select({ status: m365ServiceHealthSamplesTable.status, sampledAt: m365ServiceHealthSamplesTable.sampledAt })
    .from(m365ServiceHealthSamplesTable)
    .where(and(
      eq(m365ServiceHealthSamplesTable.tenantId, tenantId),
      eq(m365ServiceHealthSamplesTable.service, service),
      gt(m365ServiceHealthSamplesTable.sampledAt, windowStart),
      lte(m365ServiceHealthSamplesTable.sampledAt, windowEnd),
    ))
    .orderBy(asc(m365ServiceHealthSamplesTable.sampledAt));

  const points: TimelinePoint[] = [
    ...(priorSample ? [{ status: priorSample.status, at: priorSample.sampledAt }] : []),
    ...inWindowSamples.map((s) => ({ status: s.status, at: s.sampledAt })),
  ];

  const sampleCount = points.length;
  if (sampleCount === 0) {
    return {
      service,
      windowDays,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      uptimePercent: null,
      breached: false,
      sampleCount: 0,
      coverage: 0,
    };
  }

  const { totalMs, upMs } = computeWeightedUptime(points, windowStart, windowEnd);
  const windowMs = windowEnd.getTime() - windowStart.getTime();
  const uptimePercent = totalMs > 0 ? (upMs / totalMs) * 100 : null;
  const coverage = windowMs > 0 ? totalMs / windowMs : 0;

  return {
    service,
    windowDays,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    uptimePercent,
    breached: uptimePercent !== null && uptimePercent < SLA_TARGET_UPTIME_PERCENT,
    sampleCount,
    coverage,
  };
}

export interface M365TenantUptimeSummary {
  service: string;
  windows: Record<SlaWindowDays, M365ServiceUptimeResult>;
}

/**
 * Uptime for every service this tenant has ever been sampled for, across
 * both the 30-day and 90-day windows.
 */
export async function computeM365UptimeForTenant(tenantId: string): Promise<M365TenantUptimeSummary[]> {
  const serviceRows = await db
    .selectDistinct({ service: m365ServiceHealthSamplesTable.service })
    .from(m365ServiceHealthSamplesTable)
    .where(eq(m365ServiceHealthSamplesTable.tenantId, tenantId));

  const summaries: M365TenantUptimeSummary[] = [];
  for (const { service } of serviceRows) {
    const [uptime30, uptime90] = await Promise.all([
      computeM365ServiceUptime(tenantId, service, 30),
      computeM365ServiceUptime(tenantId, service, 90),
    ]);
    summaries.push({ service, windows: { 30: uptime30, 90: uptime90 } });
  }

  return summaries.sort((a, b) => a.service.localeCompare(b.service));
}
