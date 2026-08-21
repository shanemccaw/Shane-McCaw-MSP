/**
 * secCaData.ts — the Conditional Access baseline drill-down content.
 *
 * Transcribed VERBATIM from the prototype's `CA_BANDS` (shell 18063) and
 * `CA_POLICIES` (18071). The page (`isCaPage`, 4975-5039) renders each policy's
 * id, status, "Entra ID P2" badge, purpose and note, plus a wrench that opens
 * the CR gate on `ca-<id>`; those are the fields kept here. The per-policy
 * assignment / target / condition / control / risk / reward fields the prototype
 * also carries are the FIX-PANEL playbook content (`ca-<id>`), not page content,
 * so they belong with the fix library when it is wired — not on this UI-only
 * page.
 *
 * ── Design content, not tenant data ─────────────────────────────────────────
 * The 21 policies, their statuses and the named exclusions are the prototype's
 * fictional Halden Materials tenant. The heading copy says "22 named" while the
 * fixture holds 21 — that is the prototype's own wording, reproduced verbatim,
 * against a derived count of 21.
 */

export type CaStatus = "missing" | "partial" | "present";

export interface CaBand {
  key: string;
  range: string;
  label: string;
  desc: string;
}

export interface CaPolicy {
  band: string;
  id: string;
  purpose: string;
  status: CaStatus;
  note: string;
  /** Requires an Entra ID P2 licence — renders the P2 badge. */
  p2?: boolean;
}

/** `caStatusMeta` (18099). Shared with the MFA controls page. */
export const CA_STATUS_META: Readonly<Record<CaStatus, { label: string; c: string }>> = {
  missing: { label: "Missing", c: "#f87171" },
  partial: { label: "Needs attention", c: "#fbbf24" },
  present: { label: "In place", c: "#34d399" },
};

export const CA_MONO = "'SF Mono',Menlo,Consolas,monospace";

export const CA_BANDS: readonly CaBand[] = [
  { key: "foundation", range: "000–099", label: "Foundation & Global Baselines", desc: "Universal policies that establish fundamental tenant boundary protection." },
  { key: "admin", range: "100–199", label: "Administrator & Privileged Access", desc: "Hardened policies targeted at directory roles and cloud admin tools." },
  { key: "enduser", range: "200–299", label: "End-User Access & Device Compliance", desc: "Core productivity access controls for internal employees and standard accounts." },
  { key: "guest", range: "300–399", label: "Guest & External Access", desc: "Policies designed for B2B collaboration, vendors, and external identities." },
  { key: "risk", range: "400–499", label: "Dynamic Risk-Based Controls", desc: "Zero Trust real-time telemetry policies using Entra ID Protection signals." },
  { key: "emergency", range: "900–999", label: "Resiliency & Emergency Controls", desc: "Outage fallback policies, created and maintained in an 'Off' state." },
];

export const CA_POLICIES: readonly CaPolicy[] = [
  { band: "foundation", id: "CA001-AllUsers-AllApps-BlockLegacyAuth", purpose: "Blocks IMAP, POP3, SMTP AUTH and older Office clients that cannot satisfy an MFA prompt.", status: "missing", note: "Legacy authentication is still enabled tenant-wide — 4 accounts connected over IMAP/POP3 in the last 30 days." },
  { band: "foundation", id: "CA002-AllUsers-SecurityInfo-RequireTrustedNetwork", purpose: "Restricts registering or changing MFA methods to a trusted network location.", status: "missing", note: "Security info registration is currently open from any network, including unmanaged devices abroad." },
  { band: "foundation", id: "CA003-AllUsers-AllApps-BlockUnsupportedPlatforms", purpose: "Blocks device platforms your organisation does not manage or support.", status: "missing", note: "No platform boundary exists — sign-ins are currently accepted from every OS, including Linux and unsupported mobile." },
  { band: "foundation", id: "CA004-AllUsers-DeviceRegistration-RequireMFA", purpose: "Requires MFA before a device can be joined or registered to the tenant.", status: "present", note: "In place and enabled since your first scan. No action needed." },
  { band: "foundation", id: "CA005-AllUsers-AllApps-BlockDeviceCodeFlow", purpose: "Blocks the device code authentication flow, a common phishing and token-theft vector.", status: "missing", note: "Device code flow is permitted for all users and all apps." },

  { band: "admin", id: "CA101-Admins-AllApps-RequirePhishingResistantMFA", purpose: "Forces privileged roles onto FIDO2, passkeys, or certificate-based authentication.", status: "partial", note: "Policy exists but is scoped to 3 of 9 privileged roles, and 2 admin accounts sit in the exclusion group." },
  { band: "admin", id: "CA102-Admins-AzurePortal-RequireCompliantDevice", purpose: "Restricts admin portal access to Intune-compliant or hybrid-joined devices.", status: "missing", note: "Admins can currently reach the Azure and Entra portals from any device, managed or not." },
  { band: "admin", id: "CA103-Admins-AllApps-ReauthEvery4Hours", purpose: "Caps privileged session lifetime so a stolen token expires in hours, not weeks.", status: "missing", note: "Privileged sessions currently inherit the default 90-day refresh token lifetime." },
  { band: "admin", id: "CA104-Admins-AllApps-BlockNonApprovedLocations", purpose: "Limits privileged sign-in to the countries and networks your admins actually work from.", status: "missing", note: "No location boundary on privileged access — admin sign-in is accepted worldwide." },

  { band: "enduser", id: "CA201-AllUsers-AllApps-RequireMFA", purpose: "The tenant-wide multifactor requirement for every interactive sign-in.", status: "partial", note: "6 accounts sit in the exclusion group, including 2 service accounts that should be moved to workload identities." },
  { band: "enduser", id: "CA202-AllUsers-M365-RequireCompliantOrHybridJoinedDevice", purpose: "Requires a managed device for Microsoft 365 access.", status: "missing", note: "No Conditional Access enforcement on device state — this is one of the findings blocking your Copilot gate." },
  { band: "enduser", id: "CA203-AllUsers-M365-RequireApprovedAppOrMAM", purpose: "Forces mobile access through approved apps with app protection policies applied.", status: "missing", note: "Mobile access is unrestricted — corporate mail and files can be opened in any third-party app." },
  { band: "enduser", id: "CA204-AllUsers-AllApps-BlockUnapprovedCountries", purpose: "Blocks sign-in from countries where you have no staff or operations.", status: "present", note: "In place and enabled. 17 countries currently blocked." },

  { band: "guest", id: "CA301-Guests-AllApps-RequireMFA", purpose: "Requires guests to satisfy MFA in their home tenant or yours.", status: "partial", note: "Policy exists but is still in report-only mode after 94 days. 34 guests are unaffected by it." },
  { band: "guest", id: "CA302-Guests-AllApps-RequireTermsOfUse", purpose: "Presents and records acceptance of your terms of use before external access is granted.", status: "missing", note: "No terms of use is attached to guest access, so nothing is recorded or auditable." },
  { band: "guest", id: "CA303-Guests-HighValueApps-RequireCompliantDevice", purpose: "Requires a managed device for guest access to your most sensitive applications.", status: "missing", note: "Guests can reach high-value apps from any device, including personal and unmanaged." },

  { band: "risk", id: "CA401-AllUsers-HighSignInsRisk-BlockAccess", purpose: "Blocks a sign-in outright when Entra ID Protection scores it high risk.", status: "missing", p2: true, note: "No real-time sign-in risk policy exists. Entra ID Protection signals are being generated and ignored." },
  { band: "risk", id: "CA402-AllUsers-MediumSignInsRisk-RequireMFA", purpose: "Steps up to an MFA challenge when a sign-in scores medium risk.", status: "missing", p2: true, note: "Medium-risk sign-ins currently proceed with no additional challenge." },
  { band: "risk", id: "CA403-AllUsers-HighUserRisk-RequirePasswordReset", purpose: "Forces a secure password change when an account itself is scored high risk.", status: "missing", p2: true, note: "Compromised-credential signals are not driving any automatic remediation." },

  { band: "emergency", id: "EM001-EMERGENCY-MFADisruption-AllUsers-RequireHybridJoinedDevice", purpose: "Fallback for an MFA provider outage: trades the MFA requirement for a hybrid-joined device requirement.", status: "missing", note: "No MFA-outage fallback exists. An authentication provider outage would mean disabling MFA tenant-wide by hand." },
  { band: "emergency", id: "EM002-EMERGENCY-IDPDisruption-AllUsers-RequireTrustedLocation", purpose: "Fallback for an identity provider disruption: falls back to trusted network location as the control.", status: "missing", note: "No identity-provider fallback policy exists." },
];
