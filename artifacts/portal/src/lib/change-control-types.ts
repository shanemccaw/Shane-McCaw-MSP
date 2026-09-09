/**
 * change-control-types.ts — the wire shapes behind the real Change Control
 * customer-portal routes (#1717, Feature #1486), extracted from the routes'
 * own `Wire*` interfaces per `docs/portal/change-control-contract-pack.md` (#2989).
 *
 * Pure types + normalizers, no React — fetching lives in
 * `change-control-api.ts`. Field names and nullability match the server's
 * `WireChangeRequest` (`portal-change-control.ts:174-275`) exactly; nothing
 * here is invented.
 */

export const CHANGE_CLASSES = ["Standard", "Normal", "Emergency"] as const;
export type ChangeClass = (typeof CHANGE_CLASSES)[number];

export const CHANGE_REQUEST_DISPLAY_STATUSES = [
  "Pending approval",
  "Approved",
  "Scheduled",
  "In window",
  "Implemented",
  "Rejected",
  "Rolled back",
] as const;
export type ChangeRequestDisplayStatus = (typeof CHANGE_REQUEST_DISPLAY_STATUSES)[number];

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export type CrApprovalDecision = "pending" | "approved" | "rejected" | "superseded";
export type CrApproverRole = "customer" | "msp" | "catalog_inherited" | "microsoft_forced";

export interface WireApprovalRecord {
  readonly stage: number;
  readonly decision: CrApprovalDecision;
  readonly approverRole: CrApproverRole;
  readonly approverName: string | null;
  readonly approverPersonId: string | null;
  readonly onBehalfOfPersonId: string | null;
  readonly reason: string | null;
  readonly decidedAt: string | null;
  readonly dueAt: string | null;
  readonly breached: boolean;
  readonly escalatedAt: string | null;
}

export interface ApprovalState {
  readonly requiredStages: number;
  readonly approved: number;
  readonly rejected: number;
  readonly pending: number;
  readonly superseded: number;
  readonly breached: boolean;
  readonly complete: boolean;
  readonly rejectedTerminal: boolean;
  readonly nextStage: number | null;
}

export interface WireDependencyRef {
  readonly code: string;
  readonly status: string;
}

export interface WireChangeRequest {
  readonly code: string;
  readonly title: string;
  readonly changeClass: ChangeClass;
  readonly status: ChangeRequestDisplayStatus;
  readonly workload: string;
  readonly target: string;
  readonly ticket: string;
  readonly requester: string;
  readonly window: string;
  readonly scheduledStart: string | null;
  readonly scheduledEnd: string | null;
  readonly risk: string;
  readonly impactedUsersCount: number;
  readonly rationale: string;
  readonly pre: string;
  readonly post: string;
  readonly approvals: readonly string[];
  readonly canApprove: boolean;
  readonly canRollback: boolean;
  readonly executedAt: string | null;
  readonly backupVerified: boolean;
  readonly linkedFinding: string | null;
  readonly remediationCheckKey: string | null;
  readonly intake: string | null;
  readonly implementer: string | null;
  readonly sourceGraphMessageId: string | null;
  readonly sourceInterpretationId: number | null;
  readonly sourceResolutionId: number | null;
  readonly linkedHoldWindowId: number | null;
  readonly createdAt: string;
  readonly executorRunId: number | null;
  readonly approvalRecords: readonly WireApprovalRecord[];
  readonly approvalState: ApprovalState;
  readonly canApproveNow: boolean;
  readonly blockedBy: readonly WireDependencyRef[];
  readonly blocks: readonly WireDependencyRef[];
}

export interface WireChangeControlStats {
  readonly open: number;
  readonly awaitingApproval: number;
  readonly nextWindowCount: number;
  readonly nextWindowLabel: string;
  readonly nextWindowDateOrdered: boolean;
  readonly emergencyCount: number;
  readonly emergencyLookbackDays: number;
  readonly snapshotsHeld: number;
  readonly snapshotRetentionDays: number;
}

export interface WireChangeControlRegister {
  readonly requests: readonly WireChangeRequest[];
  readonly stats: WireChangeControlStats;
  /** false = no resolvable tenant scope — the fail-closed envelope, not a real empty register. */
  readonly scoped: boolean;
}

export interface WireFreezeOrMaintenanceWindow {
  readonly id: number;
  readonly scope: string;
  readonly workload: string | null;
  readonly name: string;
  readonly reason: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly recurrence: string;
  readonly recurrenceUntil: string | null;
  /** Whether `now` falls inside a live occurrence of this standing rule. */
  readonly activeNow: boolean;
}

export interface WireCatalogItem {
  readonly id: number;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly riskLevel: string;
  readonly approvedByName: string | null;
  readonly approvedAt: string | null;
}

export interface WireCrEvent {
  readonly eventType: string;
  readonly fromValue: string | null;
  readonly toValue: string;
  readonly stage: number | null;
  readonly actorRole: string;
  readonly actorName: string | null;
  readonly reason: string | null;
  readonly occurredAt: string;
}

export interface WireCrComment {
  readonly authorRole: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
}

export const ATTACHMENT_KINDS = ["evidence", "test_result", "approval_email", "other"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface WireCrAttachment {
  readonly kind: string;
  readonly label: string;
  readonly externalUrl: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly uploadedByRole: string;
  readonly uploadedByName: string;
  readonly createdAt: string;
}

export interface WireCrTimeline {
  readonly code: string;
  readonly events: readonly WireCrEvent[];
  readonly comments: readonly WireCrComment[];
  readonly attachments: readonly WireCrAttachment[];
}

export interface WireRateMetric {
  readonly available: boolean;
  readonly rate: number | null;
  readonly numerator: number;
  readonly denominator: number;
}

export interface WireDurationMetric {
  readonly available: boolean;
  readonly averageHours: number | null;
  readonly medianHours: number | null;
  readonly sampleSize: number;
}

export interface WireCabThroughputMetric {
  readonly available: boolean;
  readonly meetingsHeld: number;
  readonly itemsDecided: number;
  readonly itemsDeferred: number;
  readonly averageDecisionLatencyHours: number | null;
}

export interface WireChangeMetrics {
  readonly changeSuccessRate: WireRateMetric;
  readonly failedChangeRate: WireRateMetric;
  readonly emergencyChangeRatio: WireRateMetric;
  readonly leadTime: WireDurationMetric;
  readonly cabThroughput: WireCabThroughputMetric;
}

/** POST /api/portal/change-control request body. */
export interface RaiseChangeRequestBody {
  readonly title: string;
  readonly target: string;
  readonly ticket?: string;
  readonly pre?: string;
  readonly post: string;
  readonly changeClass: ChangeClass;
  readonly impactedUsersCount: number;
  readonly window: string;
  readonly scheduledStart?: string;
  readonly scheduledEnd?: string;
  readonly freezeException?: { readonly justification: string };
  readonly remediationCheckKey?: string;
}

export interface ApiErrorBody {
  readonly error?: string;
  readonly [key: string]: unknown;
}
