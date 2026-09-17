/**
 * ca-policy-impact.ts
 *
 * Git #4522 — the pure half of the Conditional Access promotion gate (#4518:
 * monitor-first, promote to enforced only after real sign-in impact is verified).
 *
 * While a policy is report-only (`enabledForReportingButNotEnforced`), Entra ID
 * still evaluates it on every sign-in and records what it WOULD have done on the
 * sign-in log entry's `appliedConditionalAccessPolicies[]`:
 *
 *   reportOnlyFailure      — the policy would have BLOCKED this sign-in
 *   reportOnlyInterrupted  — it would have interrupted it for a grant control the
 *                            user had not satisfied (e.g. an MFA prompt)
 *   reportOnlySuccess      — its grant controls were already satisfied
 *   reportOnlyNotApplied   — its conditions did not match this sign-in
 *
 * This module turns the real `GET /auditLogs/signIns` rows into what an operator
 * has to see before enforcing: how many sign-ins would have been blocked or
 * interrupted, for whom, and when. No Graph, no db — ca-policy-promotion.ts reads
 * the rows and hands them here.
 */

import { createHash } from "node:crypto";
import { CA_STATE_REPORT_ONLY } from "./ca-enforcement-mode.ts";

/** Entra keeps sign-in logs for 30 days on P1/P2 tenants; older rows are gone. */
export const SIGN_IN_RETENTION_DAYS = 30;
export const MAX_AFFECTED_USERS = 50;
export const MAX_IMPACT_EVENTS = 25;

export interface GraphConditionalAccessPolicy {
  id: string;
  displayName?: string | null;
  state?: string | null;
  createdDateTime?: string | null;
  modifiedDateTime?: string | null;
}

export interface GraphAppliedConditionalAccessPolicy {
  id?: string | null;
  displayName?: string | null;
  result?: string | null;
  enforcedGrantControls?: string[] | null;
}

export interface GraphSignInForImpact {
  id?: string | null;
  createdDateTime?: string | null;
  userId?: string | null;
  userPrincipalName?: string | null;
  userDisplayName?: string | null;
  appDisplayName?: string | null;
  ipAddress?: string | null;
  clientAppUsed?: string | null;
  appliedConditionalAccessPolicies?: GraphAppliedConditionalAccessPolicy[] | null;
}

export type ReportOnlyOutcome = "would_block" | "would_interrupt" | "would_satisfy" | "not_applied";

const OUTCOME_BY_RESULT: Record<string, ReportOnlyOutcome> = {
  reportonlyfailure: "would_block",
  reportonlyinterrupted: "would_interrupt",
  reportonlysuccess: "would_satisfy",
  reportonlynotapplied: "not_applied",
};

export interface ImpactWindow {
  /** Start of the sign-ins read: when the policy entered its current state, clamped to log retention. */
  from: string;
  to: string;
  /** The policy's last modification (its current report-only period began no later than this). */
  reportOnlySince: string | null;
  /** Whole days since reportOnlySince, or null when the policy carries no timestamp. */
  reportOnlyDays: number | null;
  /** True when reportOnlySince is older than retention, so the earliest sign-ins are no longer readable. */
  clampedToRetention: boolean;
}

export interface AffectedUser {
  userId: string | null;
  userPrincipalName: string | null;
  userDisplayName: string | null;
  wouldBlock: number;
  wouldInterrupt: number;
  lastImpactAt: string | null;
}

export interface ImpactEvent {
  createdDateTime: string | null;
  userPrincipalName: string | null;
  userDisplayName: string | null;
  appDisplayName: string | null;
  ipAddress: string | null;
  clientAppUsed: string | null;
  outcome: "would_block" | "would_interrupt";
  enforcedGrantControls: string[];
}

export interface ReportOnlyImpactSummary {
  signInsScanned: number;
  /** Sign-ins on which this policy was evaluated at all (any report-only result). */
  evaluated: number;
  wouldBlock: number;
  wouldInterrupt: number;
  wouldSatisfy: number;
  notApplied: number;
  affectedUserCount: number;
  /** Most-impacted first, capped at MAX_AFFECTED_USERS. */
  affectedUsers: AffectedUser[];
  /** Newest first, capped at MAX_IMPACT_EVENTS. */
  impactEvents: ImpactEvent[];
}

/** Where the report-only period's sign-ins are read from. */
export function computeImpactWindow(policy: GraphConditionalAccessPolicy, now: Date): ImpactWindow {
  const retentionStart = new Date(now.getTime() - SIGN_IN_RETENTION_DAYS * 86_400_000);
  const sinceRaw = policy.modifiedDateTime ?? policy.createdDateTime ?? null;
  const since = sinceRaw ? new Date(sinceRaw) : null;
  const validSince = since && !Number.isNaN(since.getTime()) ? since : null;
  const clampedToRetention = !validSince || validSince < retentionStart;
  const from = clampedToRetention ? retentionStart : validSince;
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    reportOnlySince: validSince ? validSince.toISOString() : null,
    reportOnlyDays: validSince ? Math.max(0, Math.floor((now.getTime() - validSince.getTime()) / 86_400_000)) : null,
    clampedToRetention,
  };
}

/** Summarize what `policyId` would have done across real sign-in log rows. */
export function summarizeReportOnlyImpact(
  signIns: readonly GraphSignInForImpact[],
  policyId: string,
): ReportOnlyImpactSummary {
  const wanted = policyId.trim().toLowerCase();
  const counts = { would_block: 0, would_interrupt: 0, would_satisfy: 0, not_applied: 0 };
  let evaluated = 0;
  const users = new Map<string, AffectedUser>();
  const events: ImpactEvent[] = [];

  for (const signIn of signIns) {
    const applied = (signIn.appliedConditionalAccessPolicies ?? []).find(
      (p) => (p.id ?? "").trim().toLowerCase() === wanted,
    );
    const outcome = applied ? OUTCOME_BY_RESULT[(applied.result ?? "").toLowerCase()] : undefined;
    if (!applied || !outcome) continue;
    evaluated++;
    counts[outcome]++;
    if (outcome !== "would_block" && outcome !== "would_interrupt") continue;

    const key = (signIn.userId ?? signIn.userPrincipalName ?? "").toLowerCase() || `signin:${signIn.id ?? events.length}`;
    const user = users.get(key) ?? {
      userId: signIn.userId ?? null,
      userPrincipalName: signIn.userPrincipalName ?? null,
      userDisplayName: signIn.userDisplayName ?? null,
      wouldBlock: 0,
      wouldInterrupt: 0,
      lastImpactAt: null,
    };
    if (outcome === "would_block") user.wouldBlock++;
    else user.wouldInterrupt++;
    if (signIn.createdDateTime && (!user.lastImpactAt || signIn.createdDateTime > user.lastImpactAt)) {
      user.lastImpactAt = signIn.createdDateTime;
    }
    users.set(key, user);

    events.push({
      createdDateTime: signIn.createdDateTime ?? null,
      userPrincipalName: signIn.userPrincipalName ?? null,
      userDisplayName: signIn.userDisplayName ?? null,
      appDisplayName: signIn.appDisplayName ?? null,
      ipAddress: signIn.ipAddress ?? null,
      clientAppUsed: signIn.clientAppUsed ?? null,
      outcome,
      enforcedGrantControls: (applied.enforcedGrantControls ?? []).filter((c): c is string => typeof c === "string"),
    });
  }

  const affectedUsers = [...users.values()]
    .sort((a, b) =>
      (b.wouldBlock + b.wouldInterrupt) - (a.wouldBlock + a.wouldInterrupt) ||
      (b.lastImpactAt ?? "").localeCompare(a.lastImpactAt ?? ""),
    )
    .slice(0, MAX_AFFECTED_USERS);
  const impactEvents = events
    .sort((a, b) => (b.createdDateTime ?? "").localeCompare(a.createdDateTime ?? ""))
    .slice(0, MAX_IMPACT_EVENTS);

  return {
    signInsScanned: signIns.length,
    evaluated,
    wouldBlock: counts.would_block,
    wouldInterrupt: counts.would_interrupt,
    wouldSatisfy: counts.would_satisfy,
    notApplied: counts.not_applied,
    affectedUserCount: users.size,
    affectedUsers,
    impactEvents,
  };
}

/**
 * What the operator reviewed, as a stable hash. The promote call re-derives impact
 * server-side and refuses when this no longer matches — a new blocked or
 * interrupted sign-in, a newly affected user, a policy edited since review, or a
 * read that has become (in)complete all change it. New sign-ins the policy would
 * have let through do not, so a busy tenant is not forced into an endless re-review.
 */
export function impactFingerprint(input: {
  policy: GraphConditionalAccessPolicy;
  summary: Pick<ReportOnlyImpactSummary, "wouldBlock" | "wouldInterrupt" | "affectedUsers" | "affectedUserCount">;
  complete: boolean;
}): string {
  const canonical = JSON.stringify({
    policyId: input.policy.id.toLowerCase(),
    state: input.policy.state ?? null,
    modifiedDateTime: input.policy.modifiedDateTime ?? null,
    wouldBlock: input.summary.wouldBlock,
    wouldInterrupt: input.summary.wouldInterrupt,
    affectedUserCount: input.summary.affectedUserCount,
    affectedUsers: input.summary.affectedUsers
      .map((u) => `${(u.userId ?? u.userPrincipalName ?? "").toLowerCase()}:${u.wouldBlock}:${u.wouldInterrupt}`)
      .sort(),
    complete: input.complete,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export interface PromotionReadiness {
  /** False when promotion cannot go ahead at all (not report-only). */
  eligible: boolean;
  /** Present when !eligible. */
  ineligibleReason: string | null;
  /**
   * True when the operator must explicitly acknowledge what the evidence shows (or
   * does not show) before the promote call is accepted.
   */
  requiresAcknowledgement: boolean;
  /** Plain-language reasons the acknowledgement is required. */
  acknowledgementReasons: string[];
}

export function promotionReadiness(input: {
  policy: GraphConditionalAccessPolicy;
  summary: ReportOnlyImpactSummary;
  complete: boolean;
  window: ImpactWindow;
}): PromotionReadiness {
  if (input.policy.state !== CA_STATE_REPORT_ONLY) {
    return {
      eligible: false,
      ineligibleReason: `The policy is '${input.policy.state ?? "unknown"}', not report-only — only a report-only policy has sign-in impact to review.`,
      requiresAcknowledgement: false,
      acknowledgementReasons: [],
    };
  }
  const reasons: string[] = [];
  const { wouldBlock, wouldInterrupt, affectedUserCount, evaluated } = input.summary;
  if (wouldBlock > 0) reasons.push(`${wouldBlock} sign-in${wouldBlock === 1 ? "" : "s"} would have been blocked.`);
  if (wouldInterrupt > 0) {
    reasons.push(`${wouldInterrupt} sign-in${wouldInterrupt === 1 ? "" : "s"} would have been interrupted for a grant control.`);
  }
  if (wouldBlock + wouldInterrupt > 0) {
    reasons.push(`${affectedUserCount} user${affectedUserCount === 1 ? "" : "s"} would be affected.`);
  }
  if (evaluated === 0) {
    reasons.push("No sign-in in the report-only period was evaluated against this policy, so there is no evidence of its impact yet.");
  }
  if (!input.complete) {
    reasons.push("Not every sign-in in the period could be read, so the impact shown is a lower bound.");
  }
  if (input.window.clampedToRetention && input.window.reportOnlySince) {
    reasons.push(`Sign-ins older than ${SIGN_IN_RETENTION_DAYS} days are no longer retained, so the start of the report-only period is not covered.`);
  }
  return {
    eligible: true,
    ineligibleReason: null,
    requiresAcknowledgement: reasons.length > 0,
    acknowledgementReasons: reasons,
  };
}
