/**
 * m365-health-status.ts
 *
 * Shared serviceHealthStatus (Graph v1.0 serviceHealth resource) enum
 * judgment call — which raw statuses count as "the service is fine" for
 * this platform. Single source of truth for both public-status.ts's public
 * healthy/degraded/interruption sanitization and sla-uptime.ts's Uptime
 * Percentage calculation, so the same status never reads as "up" in one
 * place and "down" in the other.
 *
 * Full enum (per the m365:service-health monitor check's migration
 * comment, verified against Microsoft's Graph v1.0 docs): serviceOperational,
 * investigating, restoringService, verifyingService, serviceRestored,
 * postIncidentReviewPublished, serviceDegradation, serviceInterruption,
 * extendedRecovery, falsePositive, investigationSuspended, resolved,
 * mitigatedExternal, mitigated, resolvedExternal, confirmed, reported,
 * unknownFutureValue.
 *
 * Judgment calls on the less-obvious ones:
 *   - postIncidentReviewPublished / resolvedExternal: the incident is over,
 *     Microsoft is just publishing/finalizing the post-mortem — healthy.
 *   - investigationSuspended: Microsoft paused investigating, most often
 *     because the reported impact could not be confirmed/reproduced —
 *     treated as healthy rather than an open outage.
 *   - mitigated / mitigatedExternal: deliberately NOT healthy — a
 *     mitigation reduces impact but isn't the same as resolved.
 *   - unknownFutureValue and anything else undocumented here: NOT healthy
 *     (conservative default, never silently reports a new/unknown status
 *     as fine).
 */

export const HEALTHY_STATUSES = new Set([
  "serviceOperational",
  "serviceRestored",
  "postIncidentReviewPublished",
  "resolved",
  "resolvedExternal",
  "falsePositive",
  "investigationSuspended",
]);

export function isHealthyServiceStatus(rawStatus: string): boolean {
  return HEALTHY_STATUSES.has(rawStatus);
}
