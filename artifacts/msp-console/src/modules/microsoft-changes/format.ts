/**
 * Display helpers for the Microsoft Changes module (Git #2600) — tone/label
 * maps for the real enums `admin-m365-interpretations.ts` and its resolution/
 * routing layers expose on the wire (`m365-changes-api.ts`).
 */
import type {
  M365Actor, M365ChangeClass, M365Controllability, M365InterpretationStatus,
  M365ResolutionStatus, M365RoutingDecision,
} from "@/api/m365-changes-api";

export type ToneKind = "green" | "amber" | "red" | "blue" | "violet" | "slate";
export type Tone = readonly [color: string, tint: string, line: string];

const TONES: Record<ToneKind, Tone> = {
  green: ["#34d399", "rgba(52,211,153,.1)", "rgba(52,211,153,.26)"],
  amber: ["#fbbf24", "rgba(251,191,36,.1)", "rgba(251,191,36,.26)"],
  red: ["#f87171", "rgba(248,113,113,.1)", "rgba(248,113,113,.26)"],
  blue: ["#60a5fa", "rgba(96,165,250,.1)", "rgba(96,165,250,.26)"],
  violet: ["#a78bfa", "rgba(167,139,250,.1)", "rgba(167,139,250,.26)"],
  slate: ["#94a3b8", "rgba(148,163,184,.08)", "rgba(148,163,184,.2)"],
};

export function tone(kind: ToneKind | undefined): Tone {
  return TONES[kind ?? "slate"];
}

const STATUS_TONE: Record<M365InterpretationStatus, ToneKind> = {
  proposed: "amber",
  confirmed: "green",
  rejected: "slate",
};
export function statusTone(status: M365InterpretationStatus): Tone {
  return tone(STATUS_TONE[status]);
}
export function statusLabel(status: M365InterpretationStatus): string {
  if (status === "proposed") return "awaiting confirmation";
  return status;
}

const CHANGE_CLASS_LABEL: Record<M365ChangeClass, string> = {
  retirement: "Retirement",
  default_flip: "Default flip",
  new_feature: "New feature",
  breaking_change: "Breaking change",
  licensing: "Licensing",
};
export function changeClassLabel(c: M365ChangeClass): string {
  return CHANGE_CLASS_LABEL[c] ?? c;
}

export function actorLabel(a: M365Actor): string {
  return a === "microsoft" ? "Microsoft" : "Admin";
}

export function controllableLabel(c: M365Controllability): string {
  if (c === "yes") return "Yes — has an opt-out";
  if (c === "no") return "No opt-out";
  return "Unknown";
}
export function controllableTone(c: M365Controllability): Tone {
  if (c === "yes") return tone("green");
  if (c === "no") return tone("red");
  return tone("slate");
}

const RESOLUTION_TONE: Record<M365ResolutionStatus, ToneKind> = {
  measured: "green",
  not_measured: "slate",
  error: "red",
};
export function resolutionTone(status: M365ResolutionStatus): Tone {
  return tone(RESOLUTION_TONE[status]);
}
export function resolutionLabel(status: M365ResolutionStatus): string {
  if (status === "not_measured") return "not measured";
  return status;
}

const ROUTING_TONE: Record<M365RoutingDecision, ToneKind> = {
  auto_created: "green",
  proposed: "amber",
  declined_risk: "violet",
  none: "slate",
};
export function routingTone(decision: M365RoutingDecision): Tone {
  return tone(ROUTING_TONE[decision]);
}
export function routingLabel(decision: M365RoutingDecision): string {
  switch (decision) {
    case "auto_created": return "Change Request created";
    case "proposed": return "Proposed — no CR yet";
    case "declined_risk": return "Declined — risk accepted";
    case "none": return "Nothing routed";
  }
}

const ROUTING_REASON_LABEL: Record<string, string> = {
  auto_created: "Measured, affected and dated — routed automatically.",
  undated: "The announcement carries no real structural date yet.",
  zero_affected: "Measured, but this tenant has zero affected objects.",
  not_measured: "This tenant has not been resolved (counted) yet.",
  no_announcement: "No tenant-facing announcement to route from.",
};
export function routingReasonText(reason: string): string {
  return ROUTING_REASON_LABEL[reason] ?? reason;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
