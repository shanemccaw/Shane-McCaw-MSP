/**
 * alertPrefsData.ts — the Alert preferences page fixture (Part 12).
 *
 * EXTRACTED from the prototype's `ALERT_CATS` (Customer Portal Shell.dc.html
 * 15139-15177), `ALERT_PRESETS` (15178-15209), `alertModes` (15212-15216) and
 * the seed state (7369-7386). Every string is the design's, verbatim.
 *
 * ── One taxonomy, two delivery surfaces ─────────────────────────────────────
 * These categories are the SAME set the Webhooks page keys its events off (the
 * prototype's comment, 15316). What differs is the delivery: alert preferences
 * choose email vs in-app; webhooks choose an endpoint.
 *
 * UI-only: design content. A later pass persists the choices to a notification
 * profile; here they are local state seeded from the "Balanced" preset.
 */

export const ALERT_TITLE = "Alert preferences";
export const ALERT_SUBTITLE =
  "What you get told about, and how. Two decisions per category: whether you want it, and where it goes. In-app is always on so nothing is ever lost — the choice is what leaves the portal.";
export const ALERT_PRESET_PREFIX = "Preset:";
export const ALERT_POSTURE_LABEL = "Start from a posture";
export const ALERT_CATS_KICKER = "Categories";
export const ALERT_CATS_NOTE = "Adjusting any row switches the preset to Custom";
export const ALERT_OFF_LINE = "Off. These still appear in the portal — nothing is sent.";
export const ALERT_ALWAYS_EMAIL_NOTE = "Always on for tickets you raised";

export const ALERT_QUIET_KICKER = "Quiet hours";
export const ALERT_QUIET_TITLE = "Hold email overnight";
export const ALERT_QUIET_BODY =
  "Anything raised during quiet hours is sent in one email when the window closes.";
export const ALERT_QUIET_BREAK = "Break quiet hours for critical";
export const ALERT_QUIET_BREAK_NOTE = "Recommended while a pillar is red";

export const ALERT_RECIPIENTS_KICKER = "Who else gets these";
export const ALERT_RECIPIENTS_ADD = "Add recipient";
export const ALERT_RECIPIENTS_NOTE =
  "Support ticket updates always go to whoever raised the ticket, regardless of the settings above.";

export const ALERT_SAVE = "Save preferences";
export const ALERT_RESET = "Reset to Balanced";
export const ALERT_UNSAVED = "Unsaved changes";
export const ALERT_SAVED_AT_SEED = "Last saved 3 weeks ago by Jordan Diaz";
export const ALERT_SAVED_AT_JUST_NOW = "Saved just now by Jordan Diaz";

export const ALERT_DEST_LABELS = { inapp: "In-app only", email: "In-app + email" } as const;
export const ALERT_WHERE_LABEL = "Where it goes";
export const ALERT_HOW_OFTEN_LABEL = "How often";
export const ALERT_WHAT_COUNTS_LABEL = "What counts";

export type AlertCatKey =
  | "findings"
  | "drift"
  | "progress"
  | "reviews"
  | "remediation"
  | "billing"
  | "support";

export type AlertMode = "immediate" | "daily" | "weekly";

/** One delivery mode option — prototype `alertModes` (15212-15216). */
export const ALERT_MODES: readonly { key: AlertMode; label: string }[] = [
  { key: "immediate", label: "Immediately" },
  { key: "daily", label: "Daily digest" },
  { key: "weekly", label: "Weekly digest" },
];

export interface AlertThreshold {
  key: string;
  label: string;
}

/** One alert category — prototype `ALERT_CATS` (15139-15177). */
export interface AlertCat {
  key: AlertCatKey;
  name: string;
  trigger: string;
  volume: string;
  /** True for the tickets-you-raised category, which is always email. */
  alwaysEmail?: boolean;
  thresholds: readonly AlertThreshold[];
}

export const ALERT_CATS: readonly AlertCat[] = [
  {
    key: "findings",
    name: "New critical findings",
    trigger: "A scan finds something new that is red or high severity.",
    volume: "About 2 a week in your current state",
    thresholds: [
      { key: "critical", label: "Critical only" },
      { key: "high", label: "Critical and high" },
      { key: "any", label: "Any new finding" },
    ],
  },
  {
    key: "drift",
    name: "Drift",
    trigger: "Something you fixed comes back, or a setting moves away from your baseline.",
    volume: "3 in the last 30 days",
    thresholds: [
      { key: "worse", label: "Only when it gets worse" },
      { key: "both", label: "Better and worse" },
    ],
  },
  {
    key: "progress",
    name: "Verified fixes and score moves",
    trigger: "A fix is confirmed by re-scan, or a pillar score moves by 5 or more.",
    volume: "Roughly weekly during remediation",
    thresholds: [
      { key: "five", label: "Moves of 5 or more" },
      { key: "all", label: "Every verified fix" },
    ],
  },
  {
    key: "reviews",
    name: "Risk acceptance and policy reviews",
    trigger: "An accepted risk or documented policy decision reaches its review date.",
    volume: "Rare — 4 review dates this year",
    thresholds: [
      { key: "fourteen", label: "14 days before the date" },
      { key: "seven", label: "7 days before" },
      { key: "onday", label: "On the day" },
    ],
  },
  {
    key: "remediation",
    name: "Remediation and scan activity",
    trigger: "A scan completes, a phase gate is verified, or a task is waiting on you.",
    volume: "Daily while a phase is running",
    thresholds: [
      { key: "waiting", label: "Only when waiting on you" },
      { key: "all", label: "All activity" },
    ],
  },
  {
    key: "billing",
    name: "Billing, purchases and renewals",
    trigger: "A statement of work is signed, an invoice is issued, a licence changes, or a renewal date approaches.",
    volume: "A few a month",
    thresholds: [
      { key: "all", label: "Everything" },
      { key: "money", label: "Only charges and renewals" },
    ],
  },
  {
    key: "support",
    name: "Support ticket updates",
    trigger: "Shane McCaw Consulting responds on something you raised.",
    volume: "Follows your own tickets",
    alwaysEmail: true,
    thresholds: [
      { key: "mine", label: "Tickets I raised" },
      { key: "all", label: "All tenant tickets" },
    ],
  },
];

/** Per-category preference — prototype's per-key `alertPrefs` shape. */
export interface AlertPref {
  on: boolean;
  email: boolean;
  mode: AlertMode;
  threshold: string;
}
export type AlertPrefs = Record<AlertCatKey, AlertPref>;

export type AlertPresetKey = "close" | "balanced" | "quiet";

/** One posture preset — prototype `ALERT_PRESETS` (15178-15209). */
export interface AlertPreset {
  key: AlertPresetKey;
  label: string;
  desc: string;
  apply: () => AlertPrefs;
}

export const ALERT_PRESETS: readonly AlertPreset[] = [
  {
    key: "close",
    label: "Stay on top of everything",
    desc: "Email and in-app on every category, immediately, at the lowest threshold. The right setting while a tenant is red and moving.",
    apply: () => ({
      findings: { on: true, email: true, mode: "immediate", threshold: "any" },
      drift: { on: true, email: true, mode: "immediate", threshold: "both" },
      progress: { on: true, email: true, mode: "immediate", threshold: "all" },
      reviews: { on: true, email: true, mode: "immediate", threshold: "fourteen" },
      remediation: { on: true, email: true, mode: "immediate", threshold: "all" },
      billing: { on: true, email: true, mode: "immediate", threshold: "all" },
      support: { on: true, email: true, mode: "immediate", threshold: "mine" },
    }),
  },
  {
    key: "balanced",
    label: "Balanced",
    desc: "Critical and high findings and worsening drift arrive immediately. Everything else batches into one daily email.",
    apply: () => ({
      findings: { on: true, email: true, mode: "immediate", threshold: "high" },
      drift: { on: true, email: true, mode: "immediate", threshold: "worse" },
      progress: { on: true, email: true, mode: "daily", threshold: "five" },
      reviews: { on: true, email: true, mode: "daily", threshold: "fourteen" },
      remediation: { on: true, email: false, mode: "daily", threshold: "waiting" },
      billing: { on: true, email: true, mode: "immediate", threshold: "all" },
      support: { on: true, email: true, mode: "immediate", threshold: "mine" },
    }),
  },
  {
    key: "quiet",
    label: "Only when something is wrong",
    desc: "Critical findings and backslides only, plus anything to do with money. Progress and activity stay in the app for when you look.",
    apply: () => ({
      findings: { on: true, email: true, mode: "immediate", threshold: "critical" },
      drift: { on: true, email: true, mode: "immediate", threshold: "worse" },
      progress: { on: true, email: false, mode: "weekly", threshold: "five" },
      reviews: { on: true, email: true, mode: "weekly", threshold: "seven" },
      remediation: { on: false, email: false, mode: "weekly", threshold: "waiting" },
      billing: { on: true, email: true, mode: "immediate", threshold: "money" },
      support: { on: true, email: true, mode: "immediate", threshold: "mine" },
    }),
  },
];

/** The custom-preset fallback description — prototype 15245. */
export const ALERT_CUSTOM_DESC =
  "Adjusted row by row. Nothing is inherited from a posture any more.";

/** Quiet-hours seed — prototype 7381. */
export interface AlertQuiet {
  on: boolean;
  from: string;
  to: string;
  breakForCritical: boolean;
}
export const ALERT_QUIET_SEED: AlertQuiet = { on: true, from: "19:00", to: "07:30", breakForCritical: true };

/** One notification recipient — prototype 7382-7386. */
export interface AlertRecipient {
  email: string;
  role: string;
  scope: string;
  primary: boolean;
}
export const ALERT_RECIPIENTS_SEED: readonly AlertRecipient[] = [
  { email: "jordan.diaz@tenant.com", role: "IT Administrator · you", scope: "All categories", primary: true },
  { email: "r.delgado@tenant.com", role: "Service desk lead", scope: "Remediation and support only", primary: false },
  { email: "controller@tenant.com", role: "Controller", scope: "Billing and renewals only", primary: false },
];
