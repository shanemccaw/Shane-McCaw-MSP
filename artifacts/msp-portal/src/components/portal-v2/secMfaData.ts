/**
 * secMfaData.ts — the MFA drill-down content.
 *
 * Transcribed VERBATIM from the prototype's MFA fixtures in
 * `Customer Portal Shell.dc.html`: `mfaGapUsers` (from `secAreaLinks[0].who`,
 * 17985), `mfaPartialUsersRaw` (18038), `mfaWizardSteps` (18049), the four
 * `mfaPreviewOptions` (21102) and `MFA_CONTROLS` (18145). The page
 * (`isMfaPage`, 4816-4972) shows one of four tenant states plus the always-on
 * "MFA controls we check" panel.
 *
 * The MFA controls' per-control risk / reward / manual / graph / result fields
 * are FIX-PANEL playbook content (`mfa-<key>`), not page content, so — as on the
 * CA page — only the id / label / status / detail the row renders are kept here.
 *
 * `MFA_GAP_USERS` and `MFA_PARTIAL_USERS` are the FALLBACK for the "gaps" and
 * "partial" states — the page prefers real `identity:mfa-registration` rows
 * via `useMfaRegistrationLive` (Git #1234) and only falls back to these
 * fixtures until that first response lands or when the tenant genuinely has
 * no collected rows. `MFA_CONTROLS` stays fixture-only: no current check
 * collects authentication-methods-policy, registration-campaign or break-glass
 * facts at item level.
 *
 * ── Design content, not tenant data ─────────────────────────────────────────
 * The named accounts, counts and control states are the prototype's fictional
 * Halden Materials tenant, whose MFA is enforced with a handful of gaps — the
 * default state below is `gaps`, matching the prototype's own fallback
 * (`stageMfaMap[tenantStage] || 'gaps'`, 18036). The other three states are
 * reachable through the preview strip, exactly as the prototype ships them.
 */

import { CA_STATUS_META, type CaStatus } from "./secCaData";

export type MfaState = "unconfigured" | "partial" | "gaps" | "healthy";

/** MFA controls reuse the CA status meta (`caStatusMeta`, shared in the proto). */
export const MFA_STATUS_META = CA_STATUS_META;

export const MFA_MONO = "'SF Mono',Menlo,Consolas,monospace";

/** The prototype's fallback effective state (18036). */
export const MFA_DEFAULT_STATE: MfaState = "gaps";

/** `mfaPreviewOptions` (21102). */
export const MFA_PREVIEW_OPTIONS: readonly { key: MfaState; label: string }[] = [
  { key: "unconfigured", label: "Not configured" },
  { key: "partial", label: "Configured, not enrolled" },
  { key: "gaps", label: "Enabled, a few gaps" },
  { key: "healthy", label: "Healthy" },
];

/** `secAreaLinks[0].who` (17985) — the 8 accounts without MFA. */
export const MFA_GAP_USERS: readonly string[] = [
  "R. Delgado",
  "K. Osei",
  "J. Park",
  "M. Alvarez",
  "T. Nguyen",
  "S. Whitfield",
  "D. Cho (admin)",
  "A. Reyes (admin)",
];

/** `mfaPartialUsersRaw` (18038). */
export const MFA_PARTIAL_USERS: readonly { name: string; registered: boolean }[] = [
  { name: "B. Ferris", registered: false },
  { name: "L. Mercer", registered: true },
  { name: "C. Obi", registered: false },
  { name: "H. Tanaka", registered: true },
  { name: "D. Cho", registered: false },
];

/** `mfaWizardSteps` (18049). `n` is `i + 1`, as in the prototype's `.map`. */
export const MFA_WIZARD_STEPS: readonly { title: string; desc: string }[] = [
  {
    title: "Configure via Microsoft Graph",
    desc: "We create the Conditional Access policy and authentication method configuration through the Graph API — nothing manual in the admin center. A break-glass account is excluded automatically so no one gets locked out.",
  },
  {
    title: "Block legacy authentication first",
    desc: "Legacy protocols (IMAP, POP3, older Office clients) can’t satisfy MFA, so they get blocked ahead of enforcement — otherwise they become a silent bypass.",
  },
  {
    title: "Open registration, don’t lock anyone out",
    desc: "Set a grace period so users can register a method before enforcement begins.",
  },
  {
    title: "Set an enrollment deadline",
    desc: "After this many days, unregistered users will be prompted at every sign-in.",
  },
  {
    title: "Remove the password-only channel",
    desc: "Once registration is healthy, retire the fallback that let people skip MFA entirely.",
  },
  {
    title: "Enforce MFA tenant-wide",
    desc: "Turn on enforcement. This is the point of no return for this rollout — reviewed and ready.",
  },
];

export interface MfaControl {
  key: string;
  label: string;
  detail: string;
  status: CaStatus;
}

/** `MFA_CONTROLS` (18145) — page fields only (id/label/detail/status). */
export const MFA_CONTROLS: readonly MfaControl[] = [
  {
    key: "methods-policy",
    label: "Authentication methods policy",
    detail: "SMS and voice call are still enabled as methods. Microsoft Authenticator number matching is on.",
    status: "partial",
  },
  {
    key: "registration-campaign",
    label: "Registration campaign",
    detail: "Off. Nothing is nudging users from a weaker method onto Microsoft Authenticator.",
    status: "missing",
  },
  {
    key: "per-user-migration",
    label: "Legacy per-user MFA states",
    detail: "8 accounts are still governed by legacy per-user MFA rather than Conditional Access.",
    status: "partial",
  },
  {
    key: "admin-phishing-resistant",
    label: "Phishing-resistant MFA for admins",
    detail: "No FIDO2 key or passkey is registered for 7 of your 9 privileged accounts.",
    status: "missing",
  },
  {
    key: "break-glass",
    label: "Break-glass account coverage",
    detail: "1 of 2 emergency accounts is excluded from every MFA policy; the second is not consistently excluded and has no sign-in alert.",
    status: "partial",
  },
  {
    key: "sspr",
    label: "Self-service password reset",
    detail: "Enabled, but only one method is required to reset and the registration interruption is off.",
    status: "partial",
  },
];
