// ── Shared M365 scoring utilities ─────────────────────────────────────────────
// Single source of truth for the M365Profile type, score calculations, alert
// derivation, and completion logic.  Both PortalM365Profile.tsx and
// M365ProfileSummaryCard.tsx import from here so they can never silently drift.

// ── Profile type ──────────────────────────────────────────────────────────────

export interface M365Profile {
  orgName?: string;
  industry?: string;
  employeeCount?: string;
  licensedUserCount?: string;
  tenantDomain?: string;
  itContactName?: string;
  itContactEmail?: string;
  isMicrosoftPartner?: boolean;
  licenseSKUs?: string[];
  activeUserPercent?: string;
  allUsersLicensed?: boolean;
  usesExchange?: boolean;
  usesTeams?: boolean;
  usesSharePoint?: boolean;
  usesOneDrive?: boolean;
  usesYammer?: boolean;
  sharepointSiteCount?: string;
  teamCount?: string;
  securityGroupCount?: string;
  authMethod?: string;
  externalSharingEnabled?: boolean;
  guestUsersPresent?: boolean;
  isHybrid?: boolean;
  hasOnPremExchange?: boolean;
  usesAADConnect?: boolean;
  mfaEnforced?: boolean;
  conditionalAccessEnabled?: boolean;
  hasAADP1orP2?: boolean;
  intuneEnabled?: boolean;
  hasDefender?: boolean;
  hasDLP?: boolean;
  usesComplianceCenter?: boolean;
  sensitivityLabelsConfigured?: boolean;
  hasRetentionPolicies?: boolean;
  hasInsiderRisk?: boolean;
  hasCopilotLicenses?: boolean;
  copilotLicenseCount?: string;
  copilotUseCase?: string;
  currentAITools?: string;
  dataGovernanceConcerns?: string;
  copilotReadinessScore?: string;
  copilotBlockedBy?: string;
  // Fields used by the summary card / engagement context
  businessGoals?: string;
  engagementType?: string;
  engagementStartDate?: string;
  estimatedDuration?: string;
  budgetRange?: string;
  decisionMakerName?: string;
  decisionMakerEmail?: string;
  referralSource?: string;
}

// ── Command Center score calculations ─────────────────────────────────────────

export function boolScore(fields: (boolean | undefined)[]): number {
  const answered = fields.filter(f => f !== undefined);
  if (answered.length === 0) return 0;
  return Math.round((fields.filter(f => f === true).length / fields.length) * 100);
}

export function computeScores(v: M365Profile) {
  const secScore      = boolScore([v.mfaEnforced, v.conditionalAccessEnabled, v.intuneEnabled, v.hasAADP1orP2, v.hasDefender, v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies]);
  const compScore     = boolScore([v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies, v.hasInsiderRisk]);
  const copScore      = boolScore([v.hasCopilotLicenses, v.mfaEnforced, v.sensitivityLabelsConfigured, v.hasDLP, v.hasRetentionPolicies]);
  const govScore      = boolScore([v.hasRetentionPolicies, v.sensitivityLabelsConfigured, v.usesComplianceCenter, v.conditionalAccessEnabled]);
  const pct           = parseInt(v.activeUserPercent ?? "0", 10);
  const adoptionScore = Math.min((isNaN(pct) ? 60 : pct) + (v.allUsersLicensed ? 10 : 0), 100);
  return { secScore, compScore, copScore, govScore, adoptionScore };
}

// ── Alerts & Kudos derivation ─────────────────────────────────────────────────

export interface Alert { level: "critical" | "warning"; headline: string; why: string; }
export interface Kudo  { headline: string; }

export function deriveAlerts(v: M365Profile): Alert[] {
  const alerts: Alert[] = [];
  if (v.mfaEnforced === false)               alerts.push({ level: "critical", headline: "MFA is not enforced",               why: "Without multi-factor authentication, a single stolen password gives attackers full tenant access." });
  if (v.conditionalAccessEnabled === false)  alerts.push({ level: "critical", headline: "No Conditional Access policies",    why: "Conditional Access is the primary control that limits where, how, and from which devices users can sign in." });
  if (v.hasDLP === false)                    alerts.push({ level: "critical", headline: "No Data Loss Prevention policies",  why: "Sensitive data such as financials or PII can leave the organisation via email or Teams with no automated safeguards." });
  if (v.hasDefender === false)               alerts.push({ level: "warning",  headline: "Microsoft Defender not active",     why: "Defender provides anti-phishing, malware, and Safe Links protection for email and collaboration." });
  if (v.sensitivityLabelsConfigured === false) alerts.push({ level: "warning", headline: "Sensitivity labels not configured", why: "Labelling is a prerequisite for Copilot data governance and regulatory compliance frameworks." });
  if (v.hasRetentionPolicies === false)      alerts.push({ level: "warning",  headline: "No retention policies in place",   why: "Without retention policies, business-critical data may be permanently deleted or retained indefinitely, creating compliance risk." });
  return alerts;
}

export function deriveKudos(v: M365Profile): Kudo[] {
  const kudos: Kudo[] = [];
  if (v.mfaEnforced === true)                 kudos.push({ headline: "MFA enforced — accounts are protected" });
  if (v.hasDefender === true)                  kudos.push({ headline: "Microsoft Defender is active" });
  if (v.sensitivityLabelsConfigured === true)  kudos.push({ headline: "Sensitivity labels are configured" });
  if (v.conditionalAccessEnabled === true)     kudos.push({ headline: "Conditional Access policies in place" });
  if (v.hasDLP === true)                       kudos.push({ headline: "DLP policies protecting data" });
  if (v.usesComplianceCenter === true)         kudos.push({ headline: "Microsoft Purview in use" });
  if (v.hasCopilotLicenses === true)           kudos.push({ headline: "Copilot for M365 licensed and ready" });
  if (v.hasRetentionPolicies === true)         kudos.push({ headline: "Retention policies configured" });
  return kudos;
}

// ── Profile completion ────────────────────────────────────────────────────────

const COMPLETION_STRING_FIELDS: (keyof M365Profile)[] = [
  "orgName", "industry", "employeeCount", "licensedUserCount",
  "itContactName", "itContactEmail", "tenantDomain",
  "activeUserPercent", "sharepointSiteCount", "teamCount",
  "securityGroupCount", "authMethod",
  "copilotUseCase", "currentAITools", "dataGovernanceConcerns",
  "engagementType", "engagementStartDate", "estimatedDuration",
  "budgetRange", "decisionMakerName", "decisionMakerEmail",
  "businessGoals", "referralSource",
];

const COMPLETION_BOOL_FIELDS: (keyof M365Profile)[] = [
  "isMicrosoftPartner", "allUsersLicensed", "usesExchange", "usesTeams",
  "usesSharePoint", "usesOneDrive", "externalSharingEnabled",
  "guestUsersPresent", "isHybrid", "mfaEnforced", "conditionalAccessEnabled",
  "intuneEnabled", "hasCopilotLicenses",
];

const COMPLETION_TOTAL = COMPLETION_STRING_FIELDS.length + COMPLETION_BOOL_FIELDS.length + 1; // +1 for licenseSKUs

export function computeCompletion(profile: M365Profile): number {
  let filled = 0;
  for (const k of COMPLETION_STRING_FIELDS) {
    const v = profile[k];
    if (typeof v === "string" && v.trim() !== "") filled++;
  }
  for (const k of COMPLETION_BOOL_FIELDS) {
    if (profile[k] !== undefined) filled++;
  }
  if ((profile.licenseSKUs ?? []).length > 0) filled++;
  return Math.round((filled / COMPLETION_TOTAL) * 100);
}

// ── Workload catalogue ────────────────────────────────────────────────────────

export const WORKLOADS: { key: keyof M365Profile; label: string }[] = [
  { key: "usesExchange",   label: "Exchange Online" },
  { key: "usesTeams",      label: "Microsoft Teams" },
  { key: "usesSharePoint", label: "SharePoint Online" },
  { key: "usesOneDrive",   label: "OneDrive for Business" },
  { key: "usesYammer",     label: "Viva Engage" },
];

export const WORKLOAD_LABELS: { key: keyof M365Profile; label: string; icon: string }[] = [
  { key: "usesTeams",      label: "Teams",       icon: "💬" },
  { key: "usesExchange",   label: "Exchange",    icon: "📧" },
  { key: "usesSharePoint", label: "SharePoint",  icon: "🗂️" },
  { key: "usesOneDrive",   label: "OneDrive",    icon: "☁️" },
  { key: "usesYammer",     label: "Viva Engage", icon: "👥" },
];

export function activeWorkloadLabels(profile: M365Profile) {
  return WORKLOAD_LABELS.filter(w => profile[w.key] === true).slice(0, 3);
}
