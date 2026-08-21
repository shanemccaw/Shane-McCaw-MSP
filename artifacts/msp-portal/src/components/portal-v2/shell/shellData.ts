/**
 * shellData.ts — the pure (no-JSX, no-icon) fixtures for the shell's header
 * systems: tenant identity, the change-control policy + header badge, the smart
 * alerts, and the change-request list the palette indexes. Ported from the
 * prototype's logic class.
 *
 * ── Why this file has no lucide import ─────────────────────────────────────
 * The palette's ranking and cap are unit-tested with `npx tsx --test`, and this
 * module sits under the palette index. Keeping it free of `lucide-react` (which
 * the menu fixtures need) keeps that test a pure-logic run rather than one that
 * has to load a React icon package. The icon-bearing menu fixtures live in
 * `shellMenus.ts`, and the hold-window derivation in `holdAlerts.ts`.
 *
 * ── UI only, and where the routes lead ─────────────────────────────────────
 * Every value here is the design's own fixture. The change-control badge
 * deep-links into the Change Control module, which exists; the module's own
 * policy sub-view (ccView === 'settings') is Part 4's to add, and the href moves
 * onto it when it does. Round Two is explicit that this entry point targets the
 * module's own view, NOT the inline copy in Settings, so it does not point at
 * `/portal-v2/settings/change`.
 */

/* ── Tenant / account identity ────────────────────────────────────────────── */

/** Account chip — shell 19236-19238. */
export const ACCOUNT = {
  initials: "JD",
  name: "Jordan Diaz",
  role: "IT Administrator",
} as const;

/** ShaneBot header sub-line — shell 6649. */
export const SB_TENANT_META = "tenant.com · 1,240 users · scan 14 · Growth tier";

/* ── Change-control policy + header badge ─────────────────────────────────── */

/** `ccPolicy` default — shell 7209. `on: true, approvals: 2`. */
export const CC_POLICY = { on: true, approvals: 2 } as const;

/**
 * The header change-control badge target (shell 19294). See the file header for
 * why this is the module root and not the Settings section.
 */
export const CC_BADGE_HREF = "/portal-v2/change-control";

export interface CcBadge {
  readonly label: string;
  readonly title: string;
  readonly tone: string;
  readonly borderTone: string;
  readonly fillTone: string;
  readonly href: string;
}

/** The header change-control badge — shell 19292-19296. */
export function ccBadge(policy: { on: boolean; approvals: number }): CcBadge {
  return {
    label: policy.on ? "Change control on" : "Change control off",
    title: policy.on
      ? `Every change runs through a request and ${policy.approvals} signatures. Click for the policy.`
      : "Actions run immediately and are logged to the register without approval. Click for the policy.",
    tone: policy.on ? "#34d399" : "#fbbf24",
    borderTone: policy.on ? "rgba(52,211,153,.34)" : "rgba(251,191,36,.4)",
    fillTone: policy.on ? "rgba(52,211,153,.08)" : "rgba(251,191,36,.1)",
    href: CC_BADGE_HREF,
  };
}

/* ── Alerts tray — smart alerts ───────────────────────────────────────────── */

export interface AlertItem {
  readonly pillarKey: string;
  readonly pillarLabel: string;
  readonly title: string;
  readonly why: string;
  /** The design opens the fix panel; here it deep-links to the owning pillar. */
  readonly href: string;
  /** Larger, heavier treatment on the first (most urgent) row. */
  readonly top: boolean;
}

/**
 * Smart alerts — shell 8732-8736. The design's wrench opens the fix panel for
 * `fixKey`; the fix panel is mounted on pillar pages this part must not touch,
 * so each alert deep-links to its pillar (Most Urgent lives there). Order and
 * copy are the prototype's, and the first row keeps its larger scale.
 */
export const ALERT_ITEMS: readonly AlertItem[] = [
  {
    pillarKey: "security",
    pillarLabel: "Security",
    title: "A new Global Admin was added outside your approval workflow",
    why: "Detected 3 hours ago — unapproved additions are the leading cause of account takeover.",
    href: "/portal-v2/security",
    top: true,
  },
  {
    pillarKey: "governance",
    pillarLabel: "Governance",
    title: "An OAuth app was granted full mailbox access without review",
    why: "Detected yesterday.",
    href: "/portal-v2/governance",
    top: false,
  },
  {
    pillarKey: "security",
    pillarLabel: "Security",
    title: 'SharePoint external sharing is set to "Anyone with the link"',
    why: "Detected 2 days ago.",
    href: "/portal-v2/security",
    top: false,
  },
];

/* ── Change requests (for the palette index) ──────────────────────────────── */

export interface CrPipelineEntry {
  readonly code: string;
  readonly title: string;
  readonly status: string;
}

/** `CR_PIPELINE` — shell 8142-8148. Used to index change requests by code. */
export const CR_PIPELINE: readonly CrPipelineEntry[] = [
  { code: "CR-0117", title: "Disable legacy authentication tenant-wide", status: "Deploying" },
  { code: "CR-0121", title: "Bring 12 mailboxes into retention", status: "Deploying" },
  { code: "CR-0142", title: "Enforce CA-014 tenant-wide (block legacy auth)", status: "Awaiting approval" },
  { code: "CR-0149", title: "Convert Client Deliverables to private", status: "Blocked" },
  { code: "CR-0147", title: "Restrict Teams external access", status: "Draft" },
];
