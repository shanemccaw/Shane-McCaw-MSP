/**
 * fixPanelLibrary.ts — the remediation playbooks the fix panel reads, keyed by
 * `fixKey`.
 *
 * Shape and copy are transcribed from `Customer Portal Shell.dc.html`'s
 * `GOV_FIXES` (line 10392) and the merged `fixPanelLibrary` (~line 16400). The
 * prototype's per-fix shape is `{ key, title, desc, risk, reward, manual[],
 * graph[], result }`; the merged library normalises that into the richer object
 * the panel renders. Both are represented here.
 *
 * ── Copy is final ───────────────────────────────────────────────────────────
 * The handoff is explicit that all copy is written in Shane's voice and must not
 * be rewritten, shortened or "improved". Every string below is verbatim from the
 * prototype. If a playbook needs different words, that is a design change, not
 * an implementation detail.
 *
 * ── Why a fallback exists ───────────────────────────────────────────────────
 * From the prototype's own comment: "Any finding can raise a change, so a key
 * without a bespoke library entry still gets a complete flow: change request,
 * runbook, snapshot, rollback." A finding must never be a dead end — that is the
 * README's "no dead ends" rule applied to the gate itself.
 */

export interface FixManualStep {
  text: string;
  link?: string;
}

export interface FixPlaybook {
  key: string;
  title: string;
  /** Identity colour of the pillar this fix belongs to. Never severity-driven. */
  pillarColor: string;
  description: string;
  /** When false, the "Automate via Microsoft Graph" route is not offered. */
  canAutomate: boolean;
  /** The named runbook attached to the change request. */
  sopRef: string;
  riskText: string;
  rewardText: string;
  manualSteps: FixManualStep[];
  graphSteps: string[];
  resultSummary: string;
}

/** Governance pillar identity colour — journeyTokens PILLARS.governance.primary. */
const GOVERNANCE = "#3B82F6";

/**
 * The governance playbooks wired for this build.
 *
 * Only the fixes the Governance pillar actually references are transcribed. The
 * prototype's full catalogue spans several arrays (GOV_FIXES, CMP_FIXES,
 * EVIDENCE_FIXES, CA/MFA-derived libraries) merged into one lookup; adding a
 * pillar means adding its entries here, not changing the panel.
 */
export const FIX_PLAYBOOKS: Readonly<Record<string, FixPlaybook>> = {
  "gov-anon-links": {
    key: "gov-anon-links",
    title: "Expire the anonymous sharing links",
    pillarColor: GOVERNANCE,
    description:
      "Anyone who obtains one of these links — forwarded, leaked, or guessed — can open the file without signing in. Setting an expiry closes the open-ended ones without removing anybody's access today.",
    canAutomate: true,
    sopRef: "SOP-GOV-04 · External sharing link hygiene",
    riskText:
      "Links already in circulation stop working at the expiry date. Anyone relying on one — including an external party mid-project — loses access at that moment unless they are re-shared properly first.",
    rewardText:
      "Open-ended anonymous access becomes time-bound, and the exposure stops growing while the underlying sharing policy is corrected.",
    manualSteps: [
      {
        text: "Open the SharePoint admin centre and sign in with an account holding SharePoint Administrator.",
        link: "https://admin.microsoft.com",
      },
      { text: "Record the current expiry setting before you touch it — this is the rollback point." },
      { text: "Set anonymous link expiry to 30 days at the tenant level." },
      { text: "Notify the owners of the sites with the highest link counts before it takes effect." },
      { text: "Come back here and run a re-scan so the evidence entry and the score both reflect the change." },
    ],
    graphSteps: [
      "Authenticating with Microsoft Graph",
      "Capturing the pre-change snapshot",
      "Applying the 30-day anonymous link expiry",
      "Verifying the new tenant sharing state",
      "Triggering the verification re-scan",
    ],
    resultSummary:
      "Anonymous link expiry set to 30 days. Pre-change state held in the rollback vault for 90 days.",
  },

  "gov-orphan-teams-archive": {
    key: "gov-orphan-teams-archive",
    title: "Archive the Teams with no active members",
    pillarColor: GOVERNANCE,
    description:
      "These Teams still hold file storage, connectors, and permissions with no one left to manage them. Archiving preserves the content read-only rather than deleting anything.",
    canAutomate: true,
    sopRef: "SOP-GOV-07 · Orphaned workspace disposition",
    riskText:
      "An archived Team becomes read-only. If one of these is dormant rather than abandoned, the next person to need it has to ask for it to be restored — which is recoverable, but it is an interruption.",
    rewardText:
      "Storage, connectors and permissions stop being held by workspaces nobody owns, and the governance surface shrinks to what is actually in use.",
    manualSteps: [
      {
        text: "Open the Teams admin centre and sign in with an account holding Teams Administrator.",
        link: "https://admin.teams.microsoft.com",
      },
      { text: "Record the current state of each Team before you touch it — this is the rollback point." },
      { text: "Confirm with the last known owner, or their manager, that the Team is genuinely finished." },
      { text: "Archive each confirmed Team, leaving the SharePoint site read-only rather than deleting it." },
      { text: "Come back here and run a re-scan so the evidence entry and the score both reflect the change." },
    ],
    graphSteps: [
      "Authenticating with Microsoft Graph",
      "Capturing the pre-change snapshot",
      "Archiving the confirmed Teams with their sites set read-only",
      "Verifying the new state",
      "Triggering the verification re-scan",
    ],
    resultSummary:
      "Teams archived with their SharePoint sites read-only. Nothing deleted; the pre-change snapshot is held for 90 days.",
  },
};

/**
 * The generic playbook for any finding with no bespoke entry. Transcribed
 * verbatim from the prototype's `fixFallback(key)` (line 16705) — including the
 * reference-number sentence, which is what tells the customer the change is
 * genuinely prepared from the finding they opened rather than a stock template.
 */
export function fixFallback(key: string): FixPlaybook {
  return {
    key,
    title: "Apply the recommended change",
    pillarColor: GOVERNANCE,
    description:
      "This change is prepared from the finding you opened (reference " +
      key +
      "). It goes through a change request first, runs from the matching runbook, and captures a pre-change snapshot so it can be rolled back from the vault.",
    canAutomate: true,
    sopRef: "Matched from the SOP library on submission",
    riskText:
      "It writes a tenant setting. The pre-change state is captured first, and the change request records who approved it and in which window.",
    rewardText:
      "Closes the finding, returns its points to the pillar score on the verification re-scan, and writes the evidence entry for your audit file.",
    manualSteps: [
      {
        text: "Open the admin centre for the affected workload and sign in with an account that holds the role named in the runbook.",
        link: "https://admin.microsoft.com",
      },
      { text: "Record the current value of the setting before you touch it — this is the rollback point." },
      { text: "Apply the change exactly as the runbook states, with no extra adjustments in the same session." },
      { text: "Come back here and run a re-scan so the evidence entry and the score both reflect the change." },
    ],
    graphSteps: [
      "Authenticating with Microsoft Graph",
      "Capturing the pre-change snapshot",
      "Applying the approved change",
      "Verifying the new state",
      "Triggering the verification re-scan",
    ],
    resultSummary:
      "Change applied under the approved change request, with the pre-change snapshot held in the rollback vault for 90 days.",
  };
}

/** Resolve a fixKey to its playbook. Never returns null — see fixFallback. */
export function playbookFor(key: string): FixPlaybook {
  return FIX_PLAYBOOKS[key] ?? fixFallback(key);
}

/**
 * The maintenance windows offered on the CR step. `emergency` is deliberately
 * last and carries its own warning, because it runs outside a window and is
 * approved retrospectively — a flag an auditor will read.
 */
export const CR_WINDOWS: readonly { id: string; label: string; emergency?: boolean }[] = [
  { id: "thu", label: "Thu 27 Aug · 07:00–09:00" },
  { id: "sat", label: "Sat 29 Aug · 06:00–10:00" },
  { id: "next", label: "Next available window" },
  { id: "emergency", label: "Emergency change", emergency: true },
];

export const CR_DEFAULT_WINDOW = "Thu 27 Aug · 07:00–09:00";
