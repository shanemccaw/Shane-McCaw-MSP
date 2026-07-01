export const QW_COPY = {
  entering: "Initializing diagnostic sequence…",
  ready: "Subsystem ready. Awaiting operator command.",

  autoStep: {
    heading: "Running automated check…",
    subtext: "Subsystem telemetry incoming…",
    telemetry: [
      "Initializing diagnostic sequence…",
      "Running automated check…",
      "Subsystem telemetry incoming…",
      "Integrity check in progress…",
      "Telemetry received.",
      "Score updated.",
      "All checks passed.",
      "Continuing sequence…",
    ],
  },

  manualStep: {
    heading: "Operator action required.",
    downloadBtn: "Download script package.",
    dropzoneLabel: "Awaiting data uplink…",
    dropzoneHint: "Execute locally and return telemetry.",
    telemetry: [
      "Operator action required.",
      "Download script package.",
      "Execute locally and return telemetry.",
      "Awaiting data uplink…",
      "Standing by for telemetry upload.",
    ],
  },

  stepComplete: {
    line: "Telemetry received.",
    scoreLine: "Score updated.",
    continueLine: "Continuing sequence…",
  },

  complete: {
    heading: "Diagnostic sequence complete.",
    subtext: "All subsystems nominal.",
    escalateBtn: "Proceed to next diagnostic",
    exitBtn: "Return to CRM",
    escalateRecommended: "Escalation recommended.",
  },

  escalating: {
    telemetry: "Returning to command interface…",
  },

  exit: "Returning to command interface…",
} as const;

export const DEFAULT_QUICK_WIN_STEPS = [
  { id: "step-1", title: "Security baseline scan", type: "auto" as const },
  { id: "step-2", title: "Compliance check", type: "manual" as const },
  { id: "step-3", title: "Copilot readiness", type: "auto" as const },
];
