/**
 * Wire types for the customer-facing Projects surface, #1739 (Feature #1570),
 * extracted against the real response of
 * `GET /api/portal/projects/:id` (`artifacts/api-server/src/routes/portal-projects.ts:65-181`)
 * per `docs/portal/projects-contract-pack.md` §1a.
 *
 * `closure` is not part of the pack's original field list — the route had no
 * read of `project_closures` at all before this build. Added alongside this
 * page since the design's closure-requested banner can't be drawn honestly
 * without it (real table, no migration — see the route's own comment).
 */

export type ProjectStatus = "active" | "on_hold" | "completed";
export type ProjectType = "project" | "retainer" | "quick_win";
export type WorkflowStepStatus = "pending" | "in_progress" | "completed" | "blocked";
export type KanbanColumn = "backlog" | "in_progress" | "waiting_on_customer" | "review" | "completed";
export type ProjectUpdateType = "update" | "milestone" | "message" | "file";
export type StatusReportClientStatus = "pending" | "accepted" | "has_questions";

export interface WireProject {
  id: number;
  title: string;
  description: string | null;
  status: ProjectStatus | string;
  phase: string | null;
  progress: number;
  clientUserId: number | null;
  startDate: string | null;
  endDate: string | null;
  projectType: ProjectType | string;
  sharepointFolderUrl: string | null;
  generatedArtifacts: Array<{ artifactName: string; sharepointUrl: string; generatedAt: string }> | null;
  signedOffAt: string | null;
  signedOffBy: number | null;
  quickWinElapsedSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WireWorkflowStep {
  id: number;
  projectId: number | null;
  clientServiceId: number | null;
  title: string;
  description: string | null;
  status: WorkflowStepStatus | string;
  order: number;
  notes: string | null;
  completedAt: string | null;
  dueDate: string | null;
  createdAt: string;
  workflowTemplateStepId: number | null;
}

export interface WireKanbanTask {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  column: KanbanColumn | string;
  order: number;
  assignedTo: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  workflowStepId: number | null;
  groupName: string | null;
  waitingReason: string | null;
  priority: string;
  taskType: string | null;
}

export interface WirePreviewTask {
  stepId: number;
  title: string;
  groupName: string | null;
  description: string | null;
}

export interface WireDocument {
  id: number;
  projectId: number;
  name: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

export interface WireProjectUpdate {
  id: number;
  projectId: number;
  content: string;
  authorUserId: number | null;
  type: ProjectUpdateType | string;
  createdAt: string;
}

export interface WireStatusReport {
  id: number;
  title: string;
  period: string;
  executiveSummary: string | null;
  sentAt: string | null;
  clientStatus: StatusReportClientStatus | string;
}

export interface WireContract {
  id: number;
  signedAt: string;
  signerName: string | null;
  pdfFilename: string | null;
  sharepointFileUrl: string | null;
  sharepointFileId: string | null;
  localFilePath: string | null;
  serviceName: string;
}

export interface WireAppliedCoupon {
  couponCode: string;
  discountAmount: string | null;
}

export interface WireProjectClosure {
  requestedAt: string;
  feedback: string | null;
  permissionGranted: boolean;
  signedAt: string | null;
}

/** `portal-projects.ts:167` (+ this build's `closure` addition) — the route's actual response shape. */
export interface WireProjectDetail {
  project: WireProject;
  steps: WireWorkflowStep[];
  tasks: WireKanbanTask[];
  previewTasks: WirePreviewTask[];
  documents: WireDocument[];
  updates: WireProjectUpdate[];
  statusReports: WireStatusReport[];
  pendingStatusReport: WireStatusReport | null;
  contract: WireContract | null;
  contracts: WireContract[];
  appliedCoupon: WireAppliedCoupon | null;
  closure: WireProjectClosure | null;
}

export interface ApiErrorBody {
  error?: string;
}

/** Real event shape `sse-channels.ts`'s `broadcastKanbanChange` sends over
 * `GET /api/portal/projects/:id/kanban-events` — no envelope `type`, just
 * this. */
export interface KanbanChangeEvent {
  action: "created" | "updated" | "deleted";
  task: WireKanbanTask;
}
