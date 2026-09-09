/**
 * change-control-visuals.ts — swatch/label lookups for Change Control's class,
 * risk, status and approval-decision vocabularies, matching the design's own
 * token mapping (`Design/portal/design_handoff_full_site/screens/Change
 * Control.dc.html`'s `CLS`/`RISK`/`ST`/`DEC` tables) onto this codebase's
 * `status-*` Tailwind tokens rather than the design's raw hex values.
 */
import type { ChangeClass, ChangeRequestDisplayStatus, CrApprovalDecision, CrApproverRole } from "./change-control-types";

export interface Swatch {
  readonly text: string;
  readonly border: string;
  readonly bg: string;
  readonly dashed?: boolean;
}

const CLASS_SWATCH: Record<ChangeClass, Swatch> = {
  Standard: { text: "text-status-blue", border: "border-status-blue/35", bg: "bg-status-blue/10", dashed: true },
  Normal: { text: "text-muted-foreground", border: "border-muted-foreground/30", bg: "bg-muted/10" },
  Emergency: { text: "text-status-red", border: "border-status-red/40", bg: "bg-status-red/10" },
};

export function changeClassSwatch(cls: ChangeClass): Swatch {
  return CLASS_SWATCH[cls] ?? CLASS_SWATCH.Normal;
}

const RISK_SWATCH: Record<string, Swatch> = {
  Low: { text: "text-status-green", border: "border-status-green/35", bg: "bg-status-green/10" },
  Medium: { text: "text-status-amber", border: "border-status-amber/40", bg: "bg-status-amber/10" },
  High: { text: "text-orange-400", border: "border-orange-400/40", bg: "bg-orange-400/10" },
  Critical: { text: "text-status-red", border: "border-status-red/40", bg: "bg-status-red/10" },
};

export function riskSwatch(risk: string): Swatch {
  return RISK_SWATCH[risk] ?? RISK_SWATCH.Medium;
}

const STATUS_SWATCH: Record<ChangeRequestDisplayStatus, Swatch> = {
  "Pending approval": { text: "text-status-amber", border: "border-status-amber/40", bg: "bg-status-amber/10" },
  Approved: { text: "text-status-green", border: "border-status-green/40", bg: "bg-status-green/10" },
  Scheduled: { text: "text-status-blue", border: "border-status-blue/35", bg: "bg-status-blue/10" },
  "In window": { text: "text-status-teal", border: "border-status-teal/40", bg: "bg-status-teal/10" },
  Implemented: { text: "text-foreground/80", border: "border-border", bg: "bg-muted/10" },
  Rejected: { text: "text-muted-foreground", border: "border-muted-foreground/30", bg: "bg-transparent" },
  "Rolled back": { text: "text-status-red", border: "border-status-red/35", bg: "bg-status-red/5" },
};

export function statusSwatch(status: ChangeRequestDisplayStatus): Swatch {
  return STATUS_SWATCH[status] ?? STATUS_SWATCH["Pending approval"];
}

const DECISION_LABEL: Record<CrApprovalDecision, string> = {
  approved: "Approved",
  pending: "Awaiting a decision",
  rejected: "Rejected",
  superseded: "Superseded",
};

const DECISION_SWATCH: Record<CrApprovalDecision, Swatch> = {
  approved: { text: "text-status-green", border: "border-status-green/35", bg: "bg-status-green/5" },
  pending: { text: "text-status-amber", border: "border-status-amber/38", bg: "bg-status-amber/[.04]" },
  rejected: { text: "text-status-red", border: "border-status-red/40", bg: "bg-status-red/5" },
  superseded: { text: "text-muted-foreground", border: "border-muted-foreground/35", bg: "bg-transparent", dashed: true },
};

export function decisionLabel(decision: CrApprovalDecision): string {
  return DECISION_LABEL[decision] ?? decision;
}

export function decisionSwatch(decision: CrApprovalDecision): Swatch {
  return DECISION_SWATCH[decision] ?? DECISION_SWATCH.pending;
}

const ROLE_LABEL: Record<CrApproverRole, string> = {
  customer: "your side",
  msp: "your MSP",
  catalog_inherited: "inherited from the catalogue",
  microsoft_forced: "forced by Microsoft",
};

export function approverRoleLabel(role: CrApproverRole): string {
  return ROLE_LABEL[role] ?? role;
}

/** `Aug 21, 9:14 UTC`-style formatting used throughout this module's timestamps. */
export function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + d.toISOString().slice(11, 16) + " UTC"
  );
}

export function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtImpacted(n: number): string {
  return n.toLocaleString("en-US") + (n === 1 ? " user" : " users");
}
