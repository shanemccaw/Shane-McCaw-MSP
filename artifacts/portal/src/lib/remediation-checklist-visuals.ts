/**
 * Display-only derivations for the Remediation Tracking checklist, fix-route
 * and bypass-resolutions surfaces — colour/label lookups for the real enum
 * vocabularies in `docs/remediation-tracking-contract-pack.md` §3. An
 * unrecognised value renders as its own raw text in a neutral style rather
 * than being coerced into a bucket it does not belong in.
 */
import type {
  RemediationFixRoute,
  RemediationTrackerStepStatus,
  RemediationTrackerVerificationState,
} from "@/lib/remediation-checklist-types";

export interface Swatch {
  readonly label: string;
  readonly text: string;
  readonly bg: string;
  readonly border: string;
}

const NEUTRAL: Swatch = { label: "", text: "text-muted-foreground", bg: "bg-transparent", border: "border-border" };

const STATUS_SWATCH: Record<RemediationTrackerStepStatus, Swatch> = {
  not_started: { label: "Not started", text: "text-muted-foreground", bg: "bg-transparent", border: "border-border" },
  completed: { label: "Completed", text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/30" },
  already_handled: { label: "Already handled another way", text: "text-status-blue", bg: "bg-status-blue/10", border: "border-status-blue/30" },
  not_applicable: { label: "Not applicable to this tenant", text: "text-muted-foreground", bg: "bg-muted/10", border: "border-border" },
  deferred: { label: "Deferring to a later phase", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30" },
  shane_handles: { label: "Have Shane do this one", text: "text-status-teal", bg: "bg-status-teal/10", border: "border-status-teal/30" },
  accepted_risk: { label: "Accepted as a risk — signed", text: "text-status-violet", bg: "bg-status-violet/10", border: "border-status-violet/30" },
};

export function statusSwatch(status: RemediationTrackerStepStatus): Swatch {
  return STATUS_SWATCH[status] ?? { ...NEUTRAL, label: status };
}

const SEVERITY_SWATCH: Record<"critical" | "warning", Swatch> = {
  critical: { label: "Critical", text: "text-status-red", bg: "bg-status-red/10", border: "border-status-red/30" },
  warning: { label: "Warning", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30" },
};

export function severitySwatch(severity: "critical" | "warning"): Swatch {
  return SEVERITY_SWATCH[severity] ?? { ...NEUTRAL, label: severity };
}

export interface VerificationLabel {
  readonly label: string;
  readonly text: string;
  readonly note: string;
}

const VERIFICATION_LABEL: Record<RemediationTrackerVerificationState, VerificationLabel> = {
  verified: { label: "Verified on re-scan", text: "text-status-green", note: "A real scan found every mapped check clean." },
  drift: { label: "Drifted — verification withdrawn", text: "text-status-red", note: "A real scan found a problem on a mapped check, despite the claim." },
  unverified: { label: "Not yet scanned", text: "text-muted-foreground", note: "A claim exists; no scan has spoken to it yet. Any write resets to this." },
};

export function verificationLabel(state: RemediationTrackerVerificationState): VerificationLabel {
  return VERIFICATION_LABEL[state] ?? { label: state, text: "text-muted-foreground", note: "" };
}

export interface FixRouteVisual extends Swatch {
  readonly name: string;
  readonly description: string;
  readonly primaryLabel: string;
}

const FIX_ROUTE_VISUAL: Record<RemediationFixRoute, FixRouteVisual> = {
  we_can_run: {
    label: "WE CAN RUN IT",
    name: "We can run it",
    text: "text-status-green",
    bg: "bg-status-green/10",
    border: "border-status-green/30",
    description: "A reviewed pack exists and your consent allows us to apply it, through change control.",
    primaryLabel: "Run the fix",
  },
  you_must_run: {
    label: "YOU RUN THE SCRIPT",
    name: "You run the script",
    text: "text-status-teal",
    bg: "bg-status-teal/10",
    border: "border-status-teal/30",
    description: "We hand over the exact script — but only against an approved change request.",
    primaryLabel: "Get the script",
  },
  admin_center_only: {
    label: "ADMIN CENTRE ONLY",
    name: "Admin centre only",
    text: "text-muted-foreground",
    bg: "bg-muted/10",
    border: "border-border",
    description: "No scriptable route exists. This one is changed by hand and confirmed by scan.",
    primaryLabel: "Open admin centre",
  },
};

export function fixRouteVisual(route: RemediationFixRoute): FixRouteVisual {
  return (
    FIX_ROUTE_VISUAL[route] ?? {
      ...NEUTRAL,
      name: route,
      description: "",
      primaryLabel: "Open",
    }
  );
}

const VERDICT_SWATCH: Record<string, Swatch> = {
  attributed_unapproved: { label: "OUTSIDE CHANGE CONTROL", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30" },
  unattributed: { label: "UNATTRIBUTED CHANGE", text: "text-muted-foreground", bg: "bg-muted/10", border: "border-border" },
};

export function verdictSwatch(verdict: string): Swatch {
  return VERDICT_SWATCH[verdict] ?? { ...NEUTRAL, label: verdict };
}

/** "27 Aug 2026, 14:22" from a real ISO timestamp. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}
