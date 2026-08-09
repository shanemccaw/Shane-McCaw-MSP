/**
 * Build Tracker shared types for the adminv2 screen.
 * Mirrors the DB shape from bt_epics / bt_issues / bt_chats.
 */

export type EpicStatus = "open" | "in_progress" | "closed";
export type IssueStatus = "backlog" | "in_progress" | "done" | "closed";

export interface EpicRow {
  id: number;
  title: string;
  description: string | null;
  status: EpicStatus;
  githubNumber: number | null;
  createdAt: string;
  updatedAt: string;
  issueCount: number;
  chatCount: number;
}

export interface IssueRow {
  id: number;
  epicId: number | null;
  title: string;
  description: string | null;
  status: IssueStatus;
  githubNumber: number | null;
  githubUrl: string | null;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  chatCount: number;
}

export interface ChatRow {
  id: number;
  conversationId: string;
  /** Human-readable label set after ingest. */
  title: string;
  issueId: number | null;
  epicId: number | null;
  /** Free-form tag, e.g. "Marketing", "Planning". */
  category: string | null;
  notes: string | null;
  claudeUrl: string;
  createdAt: string;
  updatedAt: string;
}

// ── Status colours (theme-safe: ACCENT.* palette) ─────────────────────────

export const EPIC_STATUS_LABEL: Record<EpicStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  closed: "Closed",
};

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  done: "Done",
  closed: "Closed",
};

/** Status → next valid transition labels for the cycle button. */
export const ISSUE_STATUS_NEXT: Record<IssueStatus, IssueStatus> = {
  backlog: "in_progress",
  in_progress: "done",
  done: "closed",
  closed: "backlog",
};

/** Accent colour per issue status (references ACCENT constants by value). */
export const ISSUE_STATUS_COLOR: Record<IssueStatus, string> = {
  backlog: "#a19f9d",   // TEXT.dim — quiet, not actionable yet
  in_progress: "#f2ca63", // ACCENT.amber — needs attention
  done: "#7fae91",     // ACCENT.green — healthy
  closed: "#6d6b69",   // TEXT.faintest — retired
};

export const EPIC_STATUS_COLOR: Record<EpicStatus, string> = {
  open: "#7fb4d8",    // ACCENT.info
  in_progress: "#f2ca63",
  closed: "#6d6b69",
};

/** GitHub repo for issue/epic deep links and sync. */
export const GITHUB_REPO = "shanemccaw/Shane-McCaw-MSP";
export function githubIssueUrl(number: number): string {
  return `https://github.com/${GITHUB_REPO}/issues/${number}`;
}
