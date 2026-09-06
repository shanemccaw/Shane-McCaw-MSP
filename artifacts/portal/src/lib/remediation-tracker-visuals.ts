/**
 * Display-only colour/label derivations for the Remediation Tracker's s1-s30
 * core surface (#3037). Colour choices follow the Design export's own values
 * (`Design/portal/design_handoff_full_site/screens/Remediation Tracking.dc.html`)
 * mapped onto this codebase's `status-*` token names, same discipline
 * `risk-register-visuals.ts` uses.
 */
import type {
  RemediationTerminalState,
  RemediationTrackerStepStatus,
  RemediationTrackerVerificationState,
} from "@/lib/remediation-tracker-types";
import { REMEDIATION_TRACKER_STEP_STATUS_LABELS } from "@/lib/remediation-tracker-types";

export interface Swatch {
  readonly label: string;
  readonly text: string;
  readonly bg: string;
  readonly border: string;
}

const STATUS_SWATCH: Record<RemediationTrackerStepStatus, Swatch> = {
  not_started: { label: "Not started", text: "text-muted-foreground", bg: "bg-transparent", border: "border-border" },
  completed: { label: "Completed", text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/30" },
  already_handled: { label: "Already handled another way", text: "text-status-blue", bg: "bg-status-blue/10", border: "border-status-blue/30" },
  not_applicable: { label: "Not applicable to this tenant", text: "text-muted-foreground", bg: "bg-muted/10", border: "border-border" },
  deferred: { label: "Deferring to a later phase", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30" },
  shane_handles: { label: "Have Shane do this one", text: "text-cyan-500", bg: "bg-cyan-500/10", border: "border-cyan-500/30" },
  accepted_risk: { label: "Accepted as a risk — signed", text: "text-violet-400", bg: "bg-violet-400/10", border: "border-violet-400/30" },
};

export function statusSwatch(status: RemediationTrackerStepStatus): Swatch {
  return STATUS_SWATCH[status] ?? { label: REMEDIATION_TRACKER_STEP_STATUS_LABELS[status] ?? status, text: "text-muted-foreground", bg: "bg-transparent", border: "border-border" };
}

export interface VerificationDisplay extends Swatch {
  readonly dashed: boolean;
  readonly note: string;
}

const VERIFICATION_DISPLAY: Record<RemediationTrackerVerificationState, VerificationDisplay> = {
  verified: {
    label: "Verified on re-scan",
    text: "text-status-green",
    bg: "bg-status-green/10",
    border: "border-status-green/40",
    dashed: false,
    note: "A real scan found every mapped check clean.",
  },
  drift: {
    label: "Drifted — verification withdrawn",
    text: "text-status-red",
    bg: "bg-status-red/10",
    border: "border-status-red/40",
    dashed: false,
    note: "A real scan found a problem on a mapped check, despite the claim.",
  },
  unverified: {
    label: "Not yet scanned",
    text: "text-muted-foreground",
    bg: "bg-transparent",
    border: "border-border",
    dashed: false,
    note: "A claim exists; no scan has spoken to it yet. Any write resets to this.",
  },
};

/** `nocheck` is not a real `verificationState` value — it is derived client-side from the catalogue. */
export const NO_CHECK_DISPLAY: VerificationDisplay = {
  label: "No automated check exists",
  text: "text-muted-foreground",
  bg: "bg-transparent",
  border: "border-muted-foreground/40",
  dashed: true,
  note: "Nothing maps to this step — it can never be verified. Permanent, not pending.",
};

export function verificationDisplay(state: RemediationTrackerVerificationState, hasCheck: boolean): VerificationDisplay {
  if (!hasCheck) return NO_CHECK_DISPLAY;
  return VERIFICATION_DISPLAY[state] ?? { ...NO_CHECK_DISPLAY, label: state };
}

const TERMINAL_SWATCH: Record<RemediationTerminalState, { label: string; text: string }> = {
  verified: { label: "RESOLVED · VERIFIED", text: "text-status-green" },
  accepted: { label: "RESOLVED · ACCEPTED", text: "text-violet-400" },
  outstanding: { label: "OUTSTANDING", text: "text-muted-foreground" },
};

export function terminalDisplay(term: RemediationTerminalState): { label: string; text: string } {
  return TERMINAL_SWATCH[term] ?? { label: term.toUpperCase(), text: "text-muted-foreground" };
}
