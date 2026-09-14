/**
 * Wire types for the customer-facing "My Architect" (retainer) surface,
 * #1746 (Feature #1569), extracted verbatim from
 * `Design/portal/design_handoff_full_site/docs/my-architect-contract-pack.md`
 * against the real `GET /api/portal/retainer` response
 * (`artifacts/api-server/src/routes/portal-retainer.ts:98-112`,
 * `admin-retainer.ts:67-102` for the shared `entryToWire`/`bucketToWire`
 * mappers).
 *
 * `hourlyRateCents` is deliberately NOT typed here — contract pack §6.1:
 * "Money fields are forbidden on this surface, full stop." The route sends
 * it; this page never reads it.
 */

export interface WireRetainerSettings {
  retainedHours: number;
  architectName: string | null;
  active: boolean;
}

export interface WireRetainerBucket {
  period: string;
  retainedHours: number;
  rolledHours: number;
  usedHours: number;
  remainingHours: number;
  overHours: number;
  isOverMonth: boolean;
}

export type RetainerWorkState = "in_progress" | "closed" | "in_review" | "scheduled";
export type RetainerWorkSource = "change_control" | "remediation_tracker" | "unscoped";

export interface WireRetainerEntry {
  id: number;
  periodMonth: string;
  week: string | null;
  item: string;
  hours: number;
  minutes: number;
  pillar: string | null;
  pillarColor: string;
  finding: string | null;
  outcome: string | null;
  state: string;
  stateStored: RetainerWorkState | string;
  source: RetainerWorkSource | string;
  sourceRefId: number | null;
  occurredAt: string;
}

export type StatusReportPeriod = "weekly" | "monthly" | "executive_summary" | "other";
export type StatusReportClientStatus = "pending" | "accepted" | "has_questions";

export interface WireStatusReportActivity {
  title: string;
  description: string;
}

export interface WireStatusReportThreadEntry {
  sender: "client" | "admin";
  content: string;
  timestamp: string;
}

export interface WireStatusReport {
  id: number;
  title: string;
  period: StatusReportPeriod | string;
  executiveSummary: string | null;
  completedActivities: WireStatusReportActivity[];
  keyOutcomes: string | null;
  reportDate: string | null;
  sentAt: string | null;
  clientStatus: StatusReportClientStatus | string;
  clientQuestion: string | null;
  adminReply: string | null;
  replyThread: WireStatusReportThreadEntry[];
}

export type RetainerAdjustmentAction = "create" | "update" | "delete";

/**
 * A `retainer_adjustment_notes` row (Git #4026) — the real, persisted reason
 * behind any hours change the MSP Console made to an already-CLOSED period.
 * `adjustmentNoteToWire`, `artifacts/api-server/src/routes/msp-retainer.ts`.
 */
export interface WireRetainerAdjustmentNote {
  id: number;
  periodKey: string;
  workLogEntryId: number | null;
  action: RetainerAdjustmentAction | string;
  reason: string;
  item: string;
  beforeHours: number | null;
  afterHours: number | null;
  createdAt: string;
}

/** `portal-retainer.ts:98-114` — the route's actual response shape. */
export interface WireRetainerPayload {
  configured: boolean;
  settings: WireRetainerSettings | null;
  bucket: WireRetainerBucket;
  months: string[];
  entries: WireRetainerEntry[];
  adjustmentNotes: WireRetainerAdjustmentNote[];
  statusReports: WireStatusReport[];
}

/** `portal-retainer.ts` sends `{ error: "<message>" }` — a bare string, not
 * the `{ error: { message } }` shape some other portal routes use. */
export interface ApiErrorBody {
  error?: string;
}
