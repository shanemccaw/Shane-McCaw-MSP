/**
 * Wire types for the Customer Home / Overview page (#2921, contract pack
 * `docs/portal/customer-home-and-timeline-contract-pack.md`). Minimal client-side
 * mirror of the two real endpoints this page reads — apps in this monorepo
 * don't share types across the `artifacts/*` boundary (see CLAUDE.md,
 * "Workspace / monorepo"), same convention `usePillarSummary.ts` already
 * follows for `/api/portal/pillars`.
 */

// ── GET /api/portal/customer/timeline ───────────────────────────────────────

export type TimelineEventType = "scan_completed" | "scan_failed" | "finding" | "score_change" | "document" | "offer";
export type TimelineStatus = "default" | "success" | "warning" | "error" | "info";

export interface TimelineEventWire {
  id: string;
  type: TimelineEventType;
  title: string;
  description?: string;
  status: TimelineStatus;
  timestamp: string;
}

export interface TimelineResponseWire {
  events: TimelineEventWire[];
  nextCursor: string | null;
}

// ── GET /api/portal/dashboard ───────────────────────────────────────────────

export interface PriorityItemWire {
  checkKey: string;
  severity: "critical" | "warning";
  /** null for an unpaid customer (#164 paywall) — severity/checkKey still real. */
  title: string | null;
  description: string | null;
}

export interface PillarEntryWire {
  score: number;
  status: "complete";
  // Paid tier:
  findings?: string[];
  recommendations?: string[];
  // Unpaid tier:
  findingsCount?: number;
  recommendationsCount?: number;
}

export interface EnrichedProjectWire {
  id: number;
  title: string;
  description: string | null;
  status: "active" | "on_hold" | "completed";
  phase: string | null;
  progress: number;
  startDate: string | null;
  endDate: string | null;
  currentTask: { stepNumber: number; totalSteps: number; title: string } | null;
}

export interface ReportWire {
  id: number;
  title: string;
  period: "weekly" | "monthly" | "executive_summary" | "other";
  reportDate: string | null;
  createdAt: string;
}

/** #2922 — six cross-Feature roll-up counts, real `0` when unresolvable/unentitled. */
export interface OverviewCountsWire {
  rbdWaiting: number;
  rbdActive: number;
  microsoftChangesThisWeek: number;
  changeScheduleThisWeek: number;
  remediationInProgress: number;
  policiesExpiringSoon: number;
  /** #3049 — Ownership/RACI r/a cells named to this login, still `acceptance: "pending"`. */
  raciPendingAcceptance: number;
}

export interface DashboardResponseWire {
  scores: Record<string, number>;
  telemetryStatus: "in_progress" | "completed";
  type_attributes: string[];
  results: {
    status: "running" | "complete";
    runId: string | null;
    generatedAt: string | null;
    summary: {
      compositeScore: number | null;
      priorityItems: PriorityItemWire[];
    };
    pillars: Record<string, PillarEntryWire>;
  };
  projects: EnrichedProjectWire[];
  reports: ReportWire[];
  unreadNotifications: number;
  unreadMessages: number;
  customerStatus: string | null;
  customerName: string | null;
  mspId: number | null;
  /**
   * #3344 — false when `resolveTenantScope(customerId)` came back null: the
   * six `tenantScope`-scoped fields in `overviewCounts` (everything but
   * `raciPendingAcceptance`) are a real `0`, not an absence of anything due.
   * Design's own `no_tenant_scope` state (Overview.dc.html state legend).
   */
  tenantScopeResolved: boolean;
  overviewCounts: OverviewCountsWire;
}
