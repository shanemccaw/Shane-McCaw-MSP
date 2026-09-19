/**
 * pillar-signal-specs.ts — the design's SIGNALS grid, as data (Git #4578).
 *
 * `Design/portal/design_handoff_full_site/screens/Pillar Pages.dc.html` →
 * `D[pillar].groups`: per pillar, named groups of per-check cards, each with an
 * icon, a label, a grid span and a check key. That curation is design metadata
 * — `monitor_checks` has no pillar or group column — so it lives here, in code,
 * exactly where `PILLAR_STAT_SPECS` (pillar-summary-stats.ts) already keeps the
 * tiles' equivalent: a static per-pillar table that names its check key AND the
 * exact `extracted_properties` field its number is read from.
 *
 * ── WHY NOT A REGISTRY OR A TABLE ───────────────────────────────────────────
 * `lib/dashboard-registry` resolves a metric through a `sourceKey` claim that
 * has rotted three times (#441, #1103, #4560) and has no notion of a per-card
 * value field. A DB table would put design copy in an admin-editable catalog
 * with nothing to gain: no operator edits it and it never varies per tenant.
 * See build-journal/4578-plan.md, "User Review Required".
 *
 * ── WHAT IS CARRIED FROM THE DESIGN, AND WHAT IS NOT ────────────────────────
 * Carried verbatim: group titles, card labels, icons, spans, check keys, and
 * any sub-caption that is true for ANY value ("no activity in 90 days",
 * "teams with a policy"). NOT carried: the design's demo VALUES, and any
 * sub-caption that asserts a demo tenant's state ("legacy auth is not blocked —
 * MFA can be bypassed", "PowerShell errored") — printed under another tenant's
 * number it would be false. Where the design's caption is "of N <things>", the
 * words are kept and N is read from a real denominator field.
 *
 * Every `field` below was checked against the real `tenant_monitor_profiles`
 * rows of the testbed tenant, or against the check's declared
 * `monitor_checks.mapping` targets where the tenant cannot observe it (licence
 * gap / service not configured / never run). `pillar-signal-specs.test.ts`
 * re-asserts that every `checkKey` is a real catalog key.
 */

export type PillarSignalIcon =
  | "users" | "lock" | "shield" | "mail" | "file" | "device" | "grid" | "globe" | "chart";

/** How one card's headline figure is read off the check's latest observation. */
export type SignalValueSpec =
  /** A numeric field, shown as a count. */
  | { format: "count"; field: string }
  /** A numeric field, shown as a percentage. */
  | { format: "percent"; field: string }
  /** A boolean field, shown as the design's own words for each state. */
  | { format: "flag"; field: string; on: string; off: string }
  /** A string field, shown verbatim. */
  | { format: "text"; field: string }
  /** `field` out of `denominatorField`, both real numbers — "18 / 18". */
  | { format: "ratio"; field: string; denominatorField: string }
  /** A number of days; Microsoft's 2147483647 "never expires" sentinel reads "never". */
  | { format: "days"; field: string }
  /** A byte count, shown in the largest sensible unit. */
  | { format: "bytes"; field: string }
  /** The sum of several real numeric fields the check reports separately. */
  | { format: "sum"; fields: string[] }
  /** How many of the listed real boolean fields are `false` — "2 gaps". */
  | { format: "gaps"; fields: string[] }
  /**
   * The tenant's PAID seats from `resolveSeatFigures` — the same priced-SKU-only
   * arithmetic the licensing tiles use (#333). The per-SKU checks behind these
   * cards carry no scalar of their own, and a raw field read would count free
   * SKUs as seats.
   */
  | { format: "paidSeats"; part: "ratio" | "unassigned" }
  /** The check returns a list, not one figure: no number is shown rather than a guessed one. */
  | { format: "none" };

export interface PillarSignalSpec {
  checkKey: string;
  icon: PillarSignalIcon;
  label: string;
  /** Column span out of 12, the design's own. */
  span: number;
  value: SignalValueSpec;
  /** A design sub-caption that is true for any value, verbatim. */
  sub?: string;
  /** A design "of N …" caption: `{value}` is replaced by the real `field` number. */
  subDenominator?: { field: string; template: string };
}

export interface PillarSignalGroupSpec {
  title: string;
  cards: readonly PillarSignalSpec[];
}

export type SignalPillarKey =
  "governance" | "security" | "compliance" | "licensing" | "adoption" | "health";

export const PILLAR_SIGNAL_SPECS: Record<SignalPillarKey, readonly PillarSignalGroupSpec[]> = {
  governance: [
    { title: "SHARING & COLLABORATION", cards: [
      { checkKey: "governance:public-teams-discoverable", icon: "users", label: "Public, discoverable teams", span: 4, value: { format: "count", field: "publicTeamCount" }, subDenominator: { field: "teamsScanned", template: "of {value} teams" } },
      { checkKey: "governance:public-groups-discoverable", icon: "users", label: "Public Microsoft 365 groups", span: 4, value: { format: "count", field: "publicGroupCount" }, subDenominator: { field: "groupsScanned", template: "of {value} groups" } },
      { checkKey: "sharepoint:inactive-sites", icon: "grid", label: "Inactive SharePoint sites", span: 4, value: { format: "count", field: "inactiveSiteCount" }, sub: "no activity in 90 days" },
      { checkKey: "onedrive:external-sharing-settings", icon: "globe", label: "OneDrive external sharing", span: 3, value: { format: "flag", field: "onedriveExternalSharingEnabled", on: "on", off: "off" } },
      { checkKey: "sharepoint:site-label-coverage", icon: "grid", label: "Sites carrying a label", span: 3, value: { format: "count", field: "sitesWithLabelCount" }, subDenominator: { field: "_itemCount", template: "of {value} sites" } },
      { checkKey: "teams:channel-sprawl", icon: "users", label: "Channels across teams", span: 3, value: { format: "count", field: "channelCount" } },
      { checkKey: "sharepoint:tenant-sharing-capability", icon: "lock", label: "Tenant sharing capability", span: 3, value: { format: "text", field: "sharingCapabilityName" } },
      { checkKey: "sharepoint:anonymous-links", icon: "globe", label: "Anonymous links", span: 6, value: { format: "count", field: "anonymousSharingLinkCount" } },
      { checkKey: "sharepoint:orgwide-links", icon: "globe", label: "Org-wide links", span: 6, value: { format: "count", field: "orgWideSharingLinkCount" } },
    ] },
    { title: "TEAMS GOVERNANCE", cards: [
      { checkKey: "teams:ownerless-teams", icon: "users", label: "Teams without an owner", span: 4, value: { format: "count", field: "ownerlessTeamCount" }, subDenominator: { field: "_itemCount", template: "of {value} teams" } },
      { checkKey: "teams:guest-membership", icon: "users", label: "Teams with guests", span: 3, value: { format: "count", field: "teamsWithGuestsCount" }, subDenominator: { field: "_itemCount", template: "of {value} teams" } },
      { checkKey: "teams:inactive-teams", icon: "users", label: "Inactive teams", span: 3, value: { format: "count", field: "inactiveTeamCount" }, sub: "no activity in 90 days" },
      { checkKey: "teams:external-access-settings", icon: "globe", label: "External access", span: 2, value: { format: "flag", field: "externalAccessEnabled", on: "on", off: "off" } },
      { checkKey: "teams:guest-settings-governance", icon: "shield", label: "Guest settings", span: 4, value: { format: "count", field: "_itemCount" }, sub: "per-team guest controls read" },
      { checkKey: "teams:meeting-policy-coverage", icon: "file", label: "Meeting policy coverage", span: 3, value: { format: "ratio", field: "meetingPolicyAssignedCount", denominatorField: "_itemCount" }, sub: "teams with a policy" },
      { checkKey: "teams:messaging-policy-coverage", icon: "file", label: "Messaging policy coverage", span: 3, value: { format: "ratio", field: "messagingPolicyAssignedCount", denominatorField: "_itemCount" }, sub: "teams with a policy" },
      { checkKey: "teams:inventory-count", icon: "grid", label: "Teams inventoried", span: 2, value: { format: "count", field: "teamCount" }, sub: "full team census" },
    ] },
    { title: "IDENTITY & OWNERSHIP", cards: [
      { checkKey: "governance:ownerless-groups", icon: "users", label: "Groups without an owner", span: 5, value: { format: "count", field: "ownerlessGroupCount" }, subDenominator: { field: "_itemCount", template: "of {value} groups scanned" } },
      { checkKey: "governance:guest-staleness", icon: "users", label: "Stale guests", span: 3, value: { format: "count", field: "staleGuestCount" }, sub: "no sign-in in 90 days" },
      { checkKey: "governance:empty-security-groups", icon: "shield", label: "Empty security groups", span: 2, value: { format: "count", field: "emptySecurityGroupCount" }, subDenominator: { field: "securityGroupCount", template: "of {value} security groups" } },
      { checkKey: "governance:guest-count", icon: "users", label: "Guest accounts", span: 2, value: { format: "count", field: "guestAccountCount" }, sub: "in the directory" },
      { checkKey: "identity:stale-accounts", icon: "users", label: "Stale user accounts", span: 4, value: { format: "count", field: "staleAccountCount" } },
      { checkKey: "identity:guest-mfa-enforcement", icon: "lock", label: "Guest MFA enforcement", span: 4, value: { format: "flag", field: "guestMfaPolicyExists", on: "yes", off: "no" } },
      { checkKey: "identity:b2b-collaboration-settings", icon: "globe", label: "B2B invite policy", span: 2, value: { format: "text", field: "guestInviteRestriction" } },
      { checkKey: "identity:cross-tenant-access", icon: "globe", label: "Cross-tenant access", span: 2, value: { format: "flag", field: "crossTenantAccessConfigured", on: "set", off: "not set" } },
    ] },
    { title: "REVIEWS & LIFECYCLE", cards: [
      { checkKey: "governance:access-review-completion", icon: "file", label: "Access reviews completed", span: 4, value: { format: "count", field: "accessReviewCompletedCount" } },
      { checkKey: "governance:guest-access-reviews", icon: "users", label: "Guest access reviews", span: 4, value: { format: "flag", field: "guestAccessReviewExists", on: "yes", off: "no" } },
      { checkKey: "governance:overdue-access-reviews", icon: "file", label: "Overdue access reviews", span: 4, value: { format: "count", field: "overdueAccessReviewCount" } },
      { checkKey: "governance:group-expiration-policy", icon: "grid", label: "Group expiration policy", span: 3, value: { format: "flag", field: "groupExpirationPolicyConfigured", on: "set", off: "not set" } },
      { checkKey: "governance:dynamic-group-usage", icon: "users", label: "Dynamic groups in use", span: 3, value: { format: "count", field: "dynamicGroupCount" }, subDenominator: { field: "_itemCount", template: "of {value} groups" } },
      { checkKey: "governance:sensitivity-label-adoption", icon: "file", label: "Sensitivity labels published", span: 3, value: { format: "count", field: "sensitivityLabelCount" } },
      { checkKey: "governance:auto-labeling-coverage", icon: "file", label: "Auto-labeling policy", span: 3, value: { format: "flag", field: "autoLabelingPolicyExists", on: "set", off: "not set" } },
    ] },
    { title: "APPS & MAIL", cards: [
      { checkKey: "appgov:dormant-service-principals", icon: "file", label: "Dormant service principals", span: 5, value: { format: "count", field: "dormantServicePrincipalCount" }, subDenominator: { field: "servicePrincipalCount", template: "of {value} enterprise apps" } },
      { checkKey: "appgov:stale-app-registrations", icon: "file", label: "Stale app registrations", span: 4, value: { format: "count", field: "appRegistrationsOver365dCount" }, subDenominator: { field: "_itemCount", template: "of {value} · over 12 months old" } },
      { checkKey: "appgov:consent-policy-status", icon: "shield", label: "User consent policy", span: 3, value: { format: "flag", field: "userConsentAllowed", on: "on", off: "off" } },
      { checkKey: "exchange:distribution-list-count", icon: "mail", label: "Distribution lists", span: 3, value: { format: "count", field: "distributionListCount" }, sub: "mail-enabled groups" },
      { checkKey: "exchange:mail-flow-rule-review", icon: "mail", label: "Mail flow rules", span: 3, value: { format: "count", field: "mailFlowRulesForReviewCount" } },
      { checkKey: "copilot:sensitivity-labels-exist", icon: "file", label: "Labels for Copilot to honour", span: 3, value: { format: "count", field: "labelCount" } },
      { checkKey: "m365:message-center", icon: "mail", label: "Microsoft announcements", span: 3, value: { format: "count", field: "majorChangeCount" }, sub: "tracked for your services" },
    ] },
    { title: "LICENSING TOUCHPOINTS & BLOCKED", cards: [
      { checkKey: "cost:group-based-licensing-adoption", icon: "users", label: "Group-based licensing", span: 4, value: { format: "count", field: "groupBasedLicensingGroupCount" } },
      { checkKey: "license:sku-utilization", icon: "file", label: "SKU utilisation", span: 4, value: { format: "paidSeats", part: "ratio" }, sub: "purchased / assigned" },
      { checkKey: "license:unused-assigned", icon: "lock", label: "Licences on inactive accounts", span: 4, value: { format: "count", field: "inactiveLicensedUsers" } },
      { checkKey: "onedrive:departed-user-access", icon: "users", label: "Departed-user access", span: 6, value: { format: "count", field: "departedUserOneDriveExposureCount" } },
      { checkKey: "platform:branding-config", icon: "grid", label: "Tenant branding", span: 6, value: { format: "flag", field: "brandingConfigured", on: "set", off: "not set" } },
    ] },
  ],
  security: [
    { title: "CONDITIONAL ACCESS", cards: [
      { checkKey: "identity:ca-policy-count", icon: "shield", label: "Conditional Access policies", span: 6, value: { format: "count", field: "caPolicyCount" } },
      { checkKey: "identity:ca-legacy-auth-block", icon: "shield", label: "Legacy auth block", span: 6, value: { format: "count", field: "caLegacyAuthBlockEnforcedPolicyCount" } },
      { checkKey: "identity:ca-mfa-coverage", icon: "lock", label: "MFA coverage policy", span: 3, value: { format: "count", field: "caMfaEnforcedPolicyCount" } },
      { checkKey: "identity:ca-device-compliance", icon: "device", label: "Device compliance policy", span: 3, value: { format: "count", field: "caDeviceCompliancePolicyEnforcedCount" } },
      { checkKey: "identity:guest-mfa-enforcement", icon: "users", label: "Guest MFA policy", span: 3, value: { format: "flag", field: "guestMfaPolicyExists", on: "yes", off: "no" } },
      { checkKey: "identity:signin-risk-policy", icon: "shield", label: "Sign-in risk policy", span: 3, value: { format: "flag", field: "signInRiskPolicyExists", on: "set", off: "not set" } },
      { checkKey: "identity:user-risk-policy", icon: "shield", label: "User risk policy", span: 3, value: { format: "flag", field: "userRiskPolicyExists", on: "set", off: "not set" } },
      { checkKey: "identity:ca-report-only", icon: "file", label: "Report-only policies", span: 3, value: { format: "count", field: "caReportOnlyPolicyCount" } },
      { checkKey: "identity:continuous-access-evaluation", icon: "shield", label: "Continuous access evaluation", span: 2, value: { format: "count", field: "caePolicyTotal" } },
      { checkKey: "identity:named-locations", icon: "globe", label: "Named locations", span: 2, value: { format: "count", field: "namedLocationCount" } },
      { checkKey: "identity:cross-tenant-access", icon: "globe", label: "Cross-tenant access", span: 2, value: { format: "flag", field: "crossTenantAccessConfigured", on: "set", off: "not set" } },
    ] },
    { title: "IDENTITY RISK — ENTRA ID P1/P2 GATED", cards: [
      { checkKey: "identity:mfa-registration", icon: "lock", label: "MFA registration", span: 3, value: { format: "count", field: "mfaRegistrationGapCount" } },
      { checkKey: "identity:privileged-mfa-gap", icon: "lock", label: "Privileged MFA gap", span: 3, value: { format: "count", field: "privilegedMfaGapCount" } },
      { checkKey: "identity:mfa-method-breakdown", icon: "lock", label: "MFA method breakdown", span: 3, value: { format: "count", field: "legacyMfaMethodCount" } },
      { checkKey: "identity:legacy-auth-usage", icon: "shield", label: "Legacy auth sign-ins", span: 3, value: { format: "count", field: "legacyAuthSignInCount" } },
      { checkKey: "identity:risky-users", icon: "users", label: "Risky users", span: 3, value: { format: "count", field: "riskyUserCount" } },
      { checkKey: "identity:risky-signins", icon: "shield", label: "Risky sign-ins", span: 3, value: { format: "count", field: "riskySignInCount" } },
      { checkKey: "identity:pim-eligible-roles", icon: "lock", label: "PIM eligible roles", span: 3, value: { format: "count", field: "pimEligibleRoleCount" } },
      { checkKey: "identity:pim-groups", icon: "users", label: "PIM groups", span: 3, value: { format: "count", field: "eligibleAssignmentsTotal" } },
    ] },
    { title: "PRIVILEGE & ACCOUNTS", cards: [
      { checkKey: "identity:global-admin-count", icon: "users", label: "Global Administrators", span: 4, value: { format: "count", field: "globalAdminCount" } },
      { checkKey: "identity:pim-permanent-roles", icon: "lock", label: "Standing privileged assignments", span: 4, value: { format: "count", field: "permanentRoleAssignmentCount" } },
      { checkKey: "identity:break-glass-health", icon: "shield", label: "Break-glass accounts", span: 2, value: { format: "ratio", field: "breakGlassAccountsHealthy", denominatorField: "breakGlassAccountCount" }, sub: "accounts healthy" },
      { checkKey: "security:azure-roleDefinitions-compliance", icon: "file", label: "Role definitions read", span: 2, value: { format: "count", field: "customRoleDefinitionCount" } },
      { checkKey: "identity:stale-accounts", icon: "users", label: "Stale user accounts", span: 3, value: { format: "count", field: "staleAccountCount" } },
      { checkKey: "governance:guest-staleness", icon: "users", label: "Stale guests", span: 3, value: { format: "count", field: "staleGuestCount" }, sub: "no sign-in in 90 days" },
      { checkKey: "identity:sspr-config", icon: "lock", label: "Self-service password reset", span: 2, value: { format: "flag", field: "adminSsprAllowed", on: "on", off: "off" } },
      { checkKey: "security:password-protection-policy", icon: "shield", label: "Password protection", span: 2, value: { format: "count", field: "customPasswordProtectionPolicyCount" } },
      { checkKey: "identity:password-expiration-policy", icon: "lock", label: "Password expiration", span: 2, value: { format: "days", field: "passwordExpirationDays" } },
      { checkKey: "platform:tenant-password-expiration", icon: "lock", label: "Tenant password expiry", span: 12, value: { format: "days", field: "tenantPasswordExpirationDays" } },
    ] },
    { title: "DEFENDER & ALERTS — LICENCE-GATED", cards: [
      { checkKey: "security:alert-count-by-severity", icon: "shield", label: "Alerts by severity", span: 3, value: { format: "count", field: "totalSecurityAlertCount" } },
      { checkKey: "security:open-incidents", icon: "shield", label: "Open incidents", span: 3, value: { format: "count", field: "openIncidentCount" } },
      { checkKey: "security:automated-investigation", icon: "shield", label: "Automated investigation", span: 3, value: { format: "count", field: "airInvestigatedAlertCount" } },
      { checkKey: "security:insider-risk-alerts", icon: "users", label: "Insider risk alerts", span: 3, value: { format: "count", field: "_itemCount" } },
      { checkKey: "security:antiphishing-coverage", icon: "mail", label: "Anti-phishing coverage", span: 3, value: { format: "count", field: "antiPhishingPolicyCount" } },
      { checkKey: "security:safe-links-coverage", icon: "globe", label: "Safe Links coverage", span: 3, value: { format: "count", field: "safeLinksPolicyCount" } },
      { checkKey: "security:safe-attachments-coverage", icon: "mail", label: "Safe Attachments coverage", span: 3, value: { format: "count", field: "safeAttachmentsPolicyCount" } },
      { checkKey: "security:dlp-violations", icon: "file", label: "DLP violations", span: 3, value: { format: "count", field: "dlpViolationCount" } },
      { checkKey: "security:dlp-true-positive-rate", icon: "chart", label: "DLP true-positive rate", span: 4, value: { format: "count", field: "dlpTruePositiveCount" } },
      { checkKey: "appgov:workload-identity-risk", icon: "file", label: "Workload identity risk", span: 4, value: { format: "count", field: "highRiskServicePrincipalCount" } },
      { checkKey: "cost:entra-license-tier-distribution", icon: "chart", label: "Licence tier distribution", span: 4, value: { format: "count", field: "_itemCount" } },
    ] },
    { title: "DEVICE SECURITY", cards: [
      { checkKey: "devices:app-protection-coverage", icon: "device", label: "App protection policies", span: 2, value: { format: "count", field: "appProtectionPolicyAssignedCount" } },
      { checkKey: "devices:bitlocker-key-escrow", icon: "lock", label: "BitLocker keys escrowed", span: 2, value: { format: "count", field: "bitlockerKeysEscrowedCount" } },
      { checkKey: "devices:compliance-policy-coverage", icon: "file", label: "Compliance policies", span: 2, value: { format: "count", field: "devicesWithoutCompliancePolicyCount" } },
      { checkKey: "devices:compliant-vs-noncompliant", icon: "device", label: "Non-compliant devices", span: 2, value: { format: "count", field: "nonCompliantDeviceCount" } },
      { checkKey: "devices:encryption-status", icon: "lock", label: "Unencrypted devices", span: 2, value: { format: "count", field: "unencryptedDeviceCount" } },
      { checkKey: "devices:os-patch-compliance", icon: "device", label: "Outdated OS devices", span: 2, value: { format: "count", field: "outdatedOsDeviceCount" } },
    ] },
    { title: "MAIL & DNS", cards: [
      { checkKey: "exchange:dkim-spf-dmarc-status", icon: "globe", label: "Email authentication (DNS)", span: 4, value: { format: "gaps", fields: ["spfConfigured", "dmarcConfigured", "dkimConfiguredAtDefaultSelectors"] } },
      { checkKey: "exchange:antispam-policy-coverage", icon: "mail", label: "Anti-spam policies", span: 2, value: { format: "count", field: "antiSpamPolicyCount" } },
      { checkKey: "exchange:transport-rule-count", icon: "mail", label: "Transport rules", span: 2, value: { format: "count", field: "transportRuleCount" } },
      { checkKey: "exchange:mail-flow-rule-review", icon: "mail", label: "Mail flow rules", span: 2, value: { format: "count", field: "mailFlowRulesForReviewCount" } },
      { checkKey: "exchange:connector-health", icon: "mail", label: "Connector TLS health", span: 2, value: { format: "count", field: "connectorMisconfigurationCount" } },
    ] },
    { title: "APP GOVERNANCE & SHAREPOINT", cards: [
      { checkKey: "appgov:risky-permission-grants", icon: "file", label: "Risky app permission grants", span: 4, value: { format: "count", field: "riskyPermissionGrantCount" }, subDenominator: { field: "totalConsentGrantCount", template: "of {value} grants" } },
      { checkKey: "appgov:unreviewed-consents", icon: "file", label: "Unreviewed consents", span: 4, value: { format: "count", field: "unreviewedConsentCount" }, subDenominator: { field: "totalConsentGrantCount", template: "of {value} grants" } },
      { checkKey: "appgov:consent-policy-status", icon: "shield", label: "User consent policy", span: 4, value: { format: "flag", field: "userConsentAllowed", on: "on", off: "off" } },
      { checkKey: "copilot:data-exposure-risk", icon: "globe", label: "Sites Copilot could over-reach", span: 3, value: { format: "count", field: "copilotExposedSiteCount" }, subDenominator: { field: "copilotSitesScanned", template: "of {value} sites scanned" } },
      { checkKey: "appgov:enterprise-app-count", icon: "file", label: "Enterprise apps inventoried", span: 3, value: { format: "count", field: "enterpriseAppCount" } },
      { checkKey: "sharepoint:tenant-sharing-capability", icon: "lock", label: "Tenant sharing capability", span: 2, value: { format: "text", field: "sharingCapabilityName" } },
      { checkKey: "sharepoint:anonymous-links", icon: "globe", label: "Anonymous links", span: 2, value: { format: "count", field: "anonymousSharingLinkCount" } },
      { checkKey: "exchange:auto-forwarding-rules", icon: "mail", label: "Auto-forwarding rules", span: 2, value: { format: "count", field: "externalAutoForwardCount" } },
    ] },
    { title: "TEAMS", cards: [
      { checkKey: "teams:external-access-settings", icon: "globe", label: "External access", span: 4, value: { format: "flag", field: "externalAccessEnabled", on: "on", off: "off" } },
      { checkKey: "teams:app-permission-policy", icon: "file", label: "App permission policy", span: 4, value: { format: "ratio", field: "appPermissionPolicyAssignedCount", denominatorField: "_itemCount" }, sub: "teams covered" },
      { checkKey: "teams:guest-settings-governance", icon: "shield", label: "Guest settings", span: 4, value: { format: "count", field: "_itemCount" }, sub: "per-team guest controls read" },
    ] },
  ],
  compliance: [
    { title: "DATA EXPOSURE", cards: [
      { checkKey: "compliance:eeeu-site-sharing", icon: "globe", label: "Sites shared with Everyone", span: 7, value: { format: "count", field: "eeeuSiteCount" }, subDenominator: { field: "sitesScanned", template: "of {value} sites scanned" } },
      { checkKey: "identity:terms-of-use", icon: "file", label: "Terms of use agreements", span: 2, value: { format: "count", field: "termsOfUseAgreementCount" } },
      { checkKey: "onedrive:overshared-files", icon: "grid", label: "Overshared OneDrive files", span: 3, value: { format: "count", field: "oversharedDriveCount" } },
    ] },
    { title: "LABELS, RETENTION & REVIEWS", cards: [
      { checkKey: "governance:sensitivity-label-adoption", icon: "file", label: "Sensitivity labels published", span: 4, value: { format: "count", field: "sensitivityLabelCount" } },
      { checkKey: "governance:access-review-completion", icon: "file", label: "Access reviews completed", span: 2, value: { format: "count", field: "accessReviewCompletedCount" } },
      { checkKey: "governance:guest-access-reviews", icon: "users", label: "Guest access reviews", span: 2, value: { format: "flag", field: "guestAccessReviewExists", on: "yes", off: "no" } },
      { checkKey: "governance:retention-label-adoption", icon: "lock", label: "Retention labels", span: 2, value: { format: "count", field: "retentionLabelCount" } },
      { checkKey: "governance:retention-policy-coverage", icon: "lock", label: "Retention policy coverage", span: 2, value: { format: "count", field: "retentionPolicyCount" } },
    ] },
    { title: "PURVIEW PIPELINE — DOWN", cards: [
      { checkKey: "compliance:missing-labels", icon: "file", label: "Missing sensitivity labels", span: 3, value: { format: "count", field: "_itemCount" } },
      { checkKey: "compliance:weak-dlp-policies", icon: "shield", label: "Weak DLP policies", span: 3, value: { format: "count", field: "_itemCount" } },
      { checkKey: "compliance:zero-dlp-policies", icon: "shield", label: "DLP policy census", span: 3, value: { format: "count", field: "dlpPoliciesCount" } },
      { checkKey: "compliance:dlp-incidents", icon: "file", label: "DLP incidents", span: 3, value: { format: "count", field: "_itemCount" } },
      { checkKey: "compliance:label-errors", icon: "file", label: "Label policy errors", span: 4, value: { format: "count", field: "_itemCount" } },
      { checkKey: "compliance:audit-log-retention", icon: "file", label: "Audit log retention", span: 4, value: { format: "count", field: "_itemCount" } },
      { checkKey: "exchange:litigation-hold-coverage", icon: "mail", label: "Litigation hold coverage", span: 4, value: { format: "ratio", field: "litigationHoldEnabledCount", denominatorField: "_itemCount" } },
    ] },
  ],
  licensing: [
    { title: "SEATS & SPEND", cards: [
      { checkKey: "cost:utilization-by-sku", icon: "file", label: "Paid seats vs assigned", span: 3, value: { format: "paidSeats", part: "ratio" }, sub: "purchased / assigned" },
      { checkKey: "cost:license-count-by-sku", icon: "file", label: "SKUs on tenant", span: 2, value: { format: "count", field: "_itemCount" }, sub: "full licence census" },
      { checkKey: "cost:unused-unassigned-licenses", icon: "file", label: "Unassigned paid licences", span: 2, value: { format: "paidSeats", part: "unassigned" } },
      { checkKey: "cost:duplicate-assignments", icon: "users", label: "Duplicate assignments", span: 2, value: { format: "count", field: "duplicateLicenseAssignmentCount" }, subDenominator: { field: "_itemCount", template: "of {value} users" } },
      { checkKey: "cost:underutilized-premium", icon: "chart", label: "Under-used premium", span: 3, value: { format: "count", field: "underutilizedPremiumLicenseCount" }, subDenominator: { field: "_itemCount", template: "of {value} users" } },
    ] },
    { title: "FOOTPRINT", cards: [
      { checkKey: "cost:entra-license-tier-distribution", icon: "chart", label: "Licence tier distribution", span: 3, value: { format: "count", field: "_itemCount" } },
      { checkKey: "licensing:project-online-detection", icon: "grid", label: "Project licences", span: 3, value: { format: "sum", fields: ["projectPlanOneCount", "projectPlanThreeCount", "projectPlanFiveCount"] } },
      { checkKey: "copilot:license-vs-total-users", icon: "file", label: "Copilot vs total users", span: 2, value: { format: "count", field: "copilotLicenseCount" } },
      { checkKey: "onedrive:storage-utilization", icon: "grid", label: "OneDrive storage read", span: 2, value: { format: "bytes", field: "onedriveStorageUsedBytes" } },
      { checkKey: "sharepoint:storage-utilization", icon: "grid", label: "SharePoint storage read", span: 2, value: { format: "percent", field: "sharepointStorageUsagePercent" }, sub: "of tenant quota" },
    ] },
    { title: "COPILOT READINESS — ROLL-UP CHECKS", cards: [
      { checkKey: "license:copilot-assignment", icon: "file", label: "Copilot seats assigned", span: 6, value: { format: "none" } },
      { checkKey: "copilot:readiness-prerequisite", icon: "file", label: "Copilot prerequisite SKUs", span: 6, value: { format: "count", field: "copilotSkuCount" } },
    ] },
    { title: "UNMEASURABLE TODAY", cards: [
      { checkKey: "exchange:shared-mailbox-licensing", icon: "mail", label: "Shared-mailbox licensing", span: 4, value: { format: "count", field: "sharedMailboxCount" } },
      { checkKey: "exchange:archive-mailbox-rate", icon: "mail", label: "Archive mailbox rate", span: 4, value: { format: "count", field: "archiveMailboxEnabledCount" } },
      { checkKey: "exchange:mailbox-quota-utilization", icon: "mail", label: "Mailbox quota utilisation", span: 4, value: { format: "count", field: "mailboxesNearQuotaCount" } },
    ] },
  ],
  adoption: [
    { title: "WORKLOAD ACTIVITY — LAST 7 DAYS", cards: [
      { checkKey: "adoption:teams-activity-trend", icon: "users", label: "Active Teams users", span: 4, value: { format: "count", field: "teamsActiveUserCount" }, subDenominator: { field: "teamsLicensedUserCount", template: "of {value} licensed" } },
      { checkKey: "adoption:sharepoint-onedrive-trend", icon: "grid", label: "Active SharePoint users", span: 3, value: { format: "count", field: "sharepointActiveUserCount" }, sub: "last 7 days" },
      { checkKey: "onedrive:active-users", icon: "grid", label: "Active OneDrive users", span: 3, value: { format: "count", field: "oneDriveActiveUserCount" }, sub: "last 7 days" },
      { checkKey: "adoption:email-activity-trend", icon: "mail", label: "Active email users", span: 2, value: { format: "count", field: "emailActiveUserCount" }, sub: "last 7 days" },
    ] },
    { title: "REACH & PEOPLE", cards: [
      { checkKey: "adoption:overall-active-rate", icon: "users", label: "Overall active users", span: 4, value: { format: "count", field: "overallActiveUserCount" } },
      { checkKey: "adoption:m365-mobile-app-usage", icon: "device", label: "Mobile app users", span: 3, value: { format: "count", field: "mobileActiveUserCount" }, sub: "M365 apps · 7 days" },
      { checkKey: "adoption:sharepoint-user-activity", icon: "grid", label: "SharePoint user activity", span: 3, value: { format: "count", field: "sharepointUserActiveCount" } },
      { checkKey: "identity:department-directory", icon: "users", label: "Users mapped to departments", span: 2, value: { format: "count", field: "department_count" }, sub: "full directory" },
    ] },
    { title: "COPILOT & COMMUNITIES — ROLL-UP CHECKS", cards: [
      { checkKey: "copilot:active-usage-rate", icon: "file", label: "Active Copilot users", span: 3, value: { format: "count", field: "copilotActiveUserCount" } },
      { checkKey: "copilot:usage-by-app", icon: "chart", label: "Copilot usage by app", span: 3, value: { format: "none" } },
      { checkKey: "copilot:licensed-but-inactive", icon: "file", label: "Licensed but inactive", span: 2, value: { format: "count", field: "neverActiveCount" } },
      { checkKey: "adoption:viva-engage-health", icon: "users", label: "Viva Engage communities", span: 2, value: { format: "count", field: "vivaEngageCommunityCount" }, sub: "community" },
      { checkKey: "adoption:viva-engage-user-activity", icon: "users", label: "Viva Engage activity", span: 2, value: { format: "count", field: "vivaEngageUserActiveCount" }, sub: "active users · 7 days" },
    ] },
    { title: "STRUCTURE & BLOCKED", cards: [
      { checkKey: "teams:inactive-teams", icon: "users", label: "Inactive teams", span: 3, value: { format: "count", field: "inactiveTeamCount" }, subDenominator: { field: "_itemCount", template: "of {value} · no activity 90d" } },
      { checkKey: "devices:kfm-configuration", icon: "device", label: "Known Folder Move", span: 3, value: { format: "count", field: "kfmConfiguredProfileCount" } },
      { checkKey: "copilot:usage-activity", icon: "chart", label: "Copilot 30-day activity", span: 2, value: { format: "none" } },
      { checkKey: "adoption:planner-usage", icon: "grid", label: "Planner adoption", span: 2, value: { format: "count", field: "plannerPlanCount" } },
      { checkKey: "adoption:teams-phone-provisioning", icon: "device", label: "Teams Phone provisioning", span: 2, value: { format: "count", field: "_itemCount" } },
    ] },
  ],
  health: [
    { title: "DEVICES", cards: [
      { checkKey: "devices:enrollment-status", icon: "device", label: "Devices enrolled in Intune", span: 4, value: { format: "count", field: "enrolledDeviceCount" } },
      { checkKey: "devices:stale-duplicate-records", icon: "device", label: "Stale or duplicate device records", span: 4, value: { format: "count", field: "staleDeviceRecordCount" } },
      { checkKey: "devices:autopilot-coverage", icon: "device", label: "Autopilot profiles", span: 2, value: { format: "count", field: "autopilotProfileCount" } },
      { checkKey: "devices:update-rings-config", icon: "device", label: "Update rings", span: 2, value: { format: "count", field: "updateRingCount" } },
      { checkKey: "devices:unassigned-intune-profiles", icon: "file", label: "Unassigned Intune profiles", span: 3, value: { format: "count", field: "unassignedIntuneProfileCount" } },
      { checkKey: "devices:kfm-configuration", icon: "device", label: "Known Folder Move", span: 3, value: { format: "count", field: "kfmConfiguredProfileCount" } },
      { checkKey: "devices:compliance-policy-coverage", icon: "file", label: "Compliance policies", span: 3, value: { format: "count", field: "devicesWithoutCompliancePolicyCount" } },
      { checkKey: "devices:os-patch-compliance", icon: "device", label: "Outdated OS devices", span: 3, value: { format: "count", field: "outdatedOsDeviceCount" } },
    ] },
    { title: "IDENTITY & PLATFORM", cards: [
      { checkKey: "identity:hybrid-sync-health", icon: "globe", label: "Hybrid sync", span: 3, value: { format: "flag", field: "hybridSyncEnabled", on: "on", off: "off" } },
      { checkKey: "identity:ca-policy-count", icon: "shield", label: "Conditional Access policies", span: 3, value: { format: "count", field: "caPolicyCount" } },
      { checkKey: "identity:pim-eligible-roles", icon: "lock", label: "PIM eligible roles", span: 2, value: { format: "count", field: "pimEligibleRoleCount" } },
      { checkKey: "platform:multi-geo-status", icon: "globe", label: "Multi-geo", span: 2, value: { format: "flag", field: "multiGeoEnabled", on: "on", off: "off" } },
      { checkKey: "appgov:cert-secret-expiration", icon: "file", label: "App credentials expiring", span: 2, value: { format: "count", field: "expiredPasswordCredentialCount" }, subDenominator: { field: "passwordCredentialCount", template: "of {value} app secrets on file" } },
    ] },
    { title: "SCORE & SERVICES", cards: [
      { checkKey: "security:secure-score", icon: "chart", label: "Microsoft Secure Score", span: 4, value: { format: "count", field: "secureScoreCurrent" }, subDenominator: { field: "secureScoreMax", template: "of {value} points" } },
      { checkKey: "security:secure-score-by-category", icon: "chart", label: "Score by category", span: 2, value: { format: "none" }, sub: "control categories read" },
      { checkKey: "m365:service-health", icon: "globe", label: "Service health", span: 2, value: { format: "ratio", field: "operationalServiceCount", denominatorField: "totalServiceCount" }, sub: "services operational" },
      { checkKey: "teams:rooms-device-health", icon: "device", label: "Teams Rooms devices", span: 2, value: { format: "count", field: "nonCompliantTeamsRoomsCount" } },
      { checkKey: "teams:inventory-count", icon: "grid", label: "Teams inventoried", span: 2, value: { format: "count", field: "teamCount" }, sub: "full team census" },
    ] },
    { title: "STORAGE & SITES", cards: [
      { checkKey: "sharepoint:site-count", icon: "grid", label: "SharePoint sites", span: 2, value: { format: "count", field: "sharepointSiteCount" }, sub: "full site census" },
      { checkKey: "sharepoint:storage-near-limit", icon: "grid", label: "Sites near storage limit", span: 2, value: { format: "count", field: "sitesNearStorageLimitCount" }, subDenominator: { field: "_itemCount", template: "of {value} sites" } },
      { checkKey: "sharepoint:storage-utilization", icon: "grid", label: "SharePoint storage", span: 2, value: { format: "percent", field: "sharepointStorageUsagePercent" }, sub: "of tenant quota" },
      { checkKey: "onedrive:storage-utilization", icon: "grid", label: "OneDrive storage", span: 2, value: { format: "bytes", field: "onedriveStorageUsedBytes" } },
      { checkKey: "onedrive:sync-errors", icon: "grid", label: "OneDrive sync errors", span: 2, value: { format: "count", field: "oneDriveStaleSyncAccountCount" }, sub: "stale sync accounts" },
      { checkKey: "teams:team-count", icon: "users", label: "Teams counted", span: 2, value: { format: "count", field: "teamCount" }, sub: "team census" },
    ] },
    { title: "UNMEASURABLE TODAY", cards: [
      { checkKey: "exchange:archive-mailbox-rate", icon: "mail", label: "Archive mailbox rate", span: 6, value: { format: "count", field: "archiveMailboxEnabledCount" } },
      { checkKey: "exchange:mailbox-quota-utilization", icon: "mail", label: "Mailbox quota utilisation", span: 6, value: { format: "count", field: "mailboxesNearQuotaCount" } },
    ] },
  ],
};
