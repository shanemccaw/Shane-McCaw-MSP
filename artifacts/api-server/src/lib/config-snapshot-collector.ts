/**
 * config-snapshot-collector.ts — the producer that fills the tenant configuration
 * snapshot store (Git #1796).
 *
 * #1795 landed the store: four tables, a 1,539-row registry, and database triggers
 * that make a sealed snapshot immutable. This file is the only thing that writes to
 * them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What it does, and the five rules that decide every line below
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. IT REUSES THE EXISTING EXECUTION LAYER. There is no transport in this file.
 *    Graph goes through `graphFetchPaginated` → `graphFetchForTenant`, which
 *    already carries multi-tenant app-only auth, consent-revocation detection,
 *    licence-gap classification, `@odata.nextLink` paging, 429 backoff and #1847's
 *    Intune service-state resolution — behaviour that survived #1400, #1614 and
 *    #1483 and must not be re-implemented. PowerShell goes through
 *    `callPsExecution` to the ps-execution container. DNS (Git #2010) goes
 *    through `queryTxtRecords`, the same TXT lookup `monitor-executor.ts`'s
 *    `dns` check executor (#496) already runs — no tenant credential involved,
 *    a plain public-DNS resolution. A second transport of any of the three
 *    kinds was explicitly forbidden and none was written.
 *
 * 2. IT IS DRIVEN BY THE REGISTRY, NEVER A HARDCODED LIST. Every target comes from
 *    `config_snapshot_resource_types WHERE is_collectable`. Adding a resource is a
 *    registry row, not a code change. The ONE code-owned table in this file is
 *    `PS_CATALOG_BY_CMDLET` — and it exists because the ps-execution container's
 *    security model requires it, not because a list was convenient (see below).
 *
 * 3. IT IS READ-ONLY. Every Graph call is a GET; every PowerShell call resolves to
 *    a `Get-*` catalog entry whose `IsWrite` is absent. The testbed tenant is
 *    Shane's real production Microsoft 365 tenant with write-back gates armed, so
 *    this is a hard property of the code, not an intention.
 *
 * 4. PARTIAL SUCCESS IS A REAL OUTCOME, AND A SKIP IS RECORDED, NEVER OMITTED. One
 *    `tenant_config_snapshot_resource_status` row is written for EVERY targeted
 *    resource, whatever happened to it. No single resource can abort a snapshot —
 *    the per-resource work is wrapped so that a throw becomes a `failed` row and
 *    the run continues. A resource that could not be read is structurally distinct
 *    from a tenant that has none of that resource, which is the entire product.
 *
 * 5. THROTTLING IS EXPECTED, NOT EXCEPTIONAL. `graphFetchPaginated`'s opt-in
 *    throttle handling is switched ON here (it is off by default for scheduled
 *    check runs): a 429 waits the server's own `Retry-After` and resumes at the
 *    same page. A snapshot that a 429 aborted would be a bug, so it is retried
 *    rather than recorded.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The PowerShell half is genuinely narrow, and that is recorded rather than hidden
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `services/ps-execution/cmdlet-catalog.ps1` resolves the request's `cmdletKey`
 * against a fixed, code-owned allowlist. By #209's design a caller CANNOT name a
 * cmdlet — that is the security boundary that keeps "what code runs" out of the
 * request body, and #1793 re-affirmed it when the survey was moved into the
 * container for the same reason.
 *
 * Two consequences, both real:
 *   - A registry resource whose read cmdlet has no catalog entry is unreachable.
 *     It is recorded `skipped` / `no_executor` naming the exact missing cmdlet.
 *   - Several catalog entries carry a `PostFilter` that narrows results to a
 *     check's "gap" subset (`get-litigation-hold-gap`, `get-labels`,
 *     `get-cs-online-user`, …). Those are LOSSY BY DESIGN and unusable here:
 *     #1795's first constraint is full fidelity, and a filtered subset stored as
 *     if it were the whole set would make the differ report every excluded object
 *     as deleted. They are deliberately not mapped, and the resources behind them
 *     are recorded `no_executor` with that stated as the reason.
 *
 * So a small number of resource types are reachable over PowerShell today. That
 * number is a finding, not a design — it is reported honestly in the snapshot
 * rather than papered over, and widening it means adding un-filtered catalog
 * entries in the container, which is its own issue.
 *
 * Non-goals, per the issue: no diffing (#1797), no UI, and no `monitor_checks` row
 * is read, written or retired. The two systems coexist.
 */

import { db } from "@workspace/db";
import {
  tenantsTable,
  configSnapshotResourceTypesTable,
  tenantConfigSnapshotsTable,
  tenantConfigSnapshotObjectsTable,
  tenantConfigSnapshotResourceStatusTable,
  type ConfigSnapshotResourceType,
  type SnapshotTrigger,
  type SnapshotSkipReason,
  type SnapshotResourceStatus,
  type SnapshotIdentityStrategy,
  type InsertTenantConfigSnapshotObject,
} from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { logger } from "./logger";
import { ConsentRevokedError, LicenseGapError } from "./graph";
import { PsExecutionError, callPsExecution } from "./ps-execution-client";

const log = logger.child({ channel: "integration.azure" });

/**
 * Stamped onto every snapshot header. Bump it whenever the collection or identity
 * logic changes in a way that could alter what a snapshot contains, so a later
 * fidelity question can be scoped to the runs that could have been affected.
 */
export const CONFIG_SNAPSHOT_COLLECTOR_VERSION = "1796.1";

/** Verbatim wire evidence kept on a status row is truncated to this many characters. */
const EVIDENCE_BODY_CHARS = 2000;

/** Rows are inserted in batches of this many. */
const INSERT_BATCH = 250;

// ── Defaults, all overridable per run ────────────────────────────────────────

/**
 * Wall-clock budget for a whole run. Reaching it does not fail the snapshot: every
 * resource not yet attempted is recorded `skipped` / `budget_exhausted`, and the
 * snapshot seals as incomplete — which is exactly what #1795's `is_complete` flag
 * exists to express.
 */
const DEFAULT_TIME_BUDGET_MS = 45 * 60_000;
/** Pages per resource. Beyond this the resource is `partial`, never silently cut. */
const DEFAULT_MAX_PAGES_PER_RESOURCE = 20;
/**
 * Resources read concurrently. Deliberately low: the target is a live production
 * tenant, and rule 5 says throttling is handled, not provoked.
 */
const DEFAULT_CONCURRENCY = 4;
/** 429 retries per paginated fetch, and the base of its exponential backoff. */
const DEFAULT_THROTTLE_RETRIES = 6;
const DEFAULT_THROTTLE_BASE_DELAY_MS = 2_000;

// ── The PowerShell reachability map ──────────────────────────────────────────

/**
 * Read cmdlet → the ps-execution catalog key that invokes it WHOLE.
 *
 * Only entries with no `PostFilter` and no result-narrowing fixed parameter are
 * listed, because a snapshot must hold the real object set (see the file header).
 * Every value here is generated from, and was checked against, the real
 * `services/ps-execution/cmdlet-catalog.ps1` — not assumed.
 *
 * #1961 grew this from 5 catalog keys to 81. Before it, only five registry
 * resource types were PowerShell-reachable and 215 were recorded `no_executor`
 * on every snapshot: they named a real read cmdlet the container's code-owned
 * allowlist had no entry for, and by #209's design a caller can never name a
 * cmdlet, so the gap could only be closed inside the container. #1961 added 63
 * unfiltered, `AllowedParams = @()`, `Get-*`-only entries there — Exchange
 * Online + Purview/SecurityCompliance in pass 1 — each one already proven to
 * work under app-only certificate auth by #1793's live capability survey. This
 * map is the api-server half of that change; without it the new entries exist
 * but nothing routes to them.
 *
 * Several spellings map to one key on purpose: Microsoft365DSC's `read_cmdlets`
 * records real case variants of the same cmdlet (`Get-DLPCompliancePolicy` and
 * `Get-DlpCompliancePolicy`, `Get-OutBoundConnector` and `Get-OutboundConnector`),
 * and the lookup is exact-match, so each real spelling gets its own row rather
 * than a case-insensitive compare that would hide which spellings actually occur.
 *
 * Deliberately ABSENT, with the reason, so nobody re-adds them as an oversight.
 * Note that five of these now have an unfiltered TWIN in the catalog under a
 * `get-all-*` key, which IS mapped below — the filtered key stays out, the
 * unfiltered twin comes in; that is #1961's whole shape:
 *   get-dlp-policies               PostFilter -> weak policies only
 *                                  (twin: get-all-dlp-policies)
 *   get-labels                     PostFilter -> disabled labels only
 *                                  (twin: get-all-label)
 *   get-label-policies             PostFilter -> non-Success distribution only
 *                                  (twin: get-all-label-policy)
 *   get-auto-forward-risk-policies PostFilter -> AutoForwardingMode On only
 *                                  (twin: get-all-hosted-outbound-spam-filter-policy)
 *   get-dkim-disabled-domains      PostFilter -> DKIM-disabled domains only
 *                                  (twin: get-all-dkim-signing-config)
 *   get-inbound-connector-tls-gap  PostFilter -> connectors without RequireTls
 *                                  (twin: get-all-inbound-connector)
 *   get-cs-online-user             PostFilter -> Teams Phone users only
 *                                  (twin: get-all-cs-online-user, Git #2850)
 *   get-litigation-hold-gap        PostFilter -> mailboxes without hold
 *   get-archive-mailbox-gap        PostFilter -> mailboxes without an active archive
 *   get-shared-mailboxes           fixed RecipientTypeDetails -> shared mailboxes only
 *   get-mailbox-quota-utilization  Script + PostFilter -> mailboxes over 90% only
 *   get-dlp-incidents              Export-ActivityExplorerData -> event data, not config
 *   add-role-group-member          IsWrite = $true. Never reachable from a read path.
 *
 * Git #2850 landed pass 2: the Microsoft Teams block pass 1 deferred. 57 further
 * `Get-Cs*` cmdlets are mapped below — every one named by a real `powershell`-transport
 * registry row AND recorded `status = 'ok'` by #1793's capability survey run 4, same
 * evidence bar as pass 1. `Get-CsOnlineUser` is mapped to the unfiltered twin
 * `get-all-cs-online-user`, never to the check-shaped `get-cs-online-user`.
 *
 * Still unmapped, deliberately, and tracked as real follow-up work rather than left
 * silent — these keep producing an honest `no_executor` row:
 *   - Five Teams cmdlets the registry names that #1793's survey recorded
 *     `not_attempted`, so nothing proves they run app-only in this container:
 *     Get-CsOnlineApplicationInstance, Get-CsOnlineVoicemailUserSettings,
 *     Get-CsTeamsSettingsCustomApp, Get-CsUserCallingSettings,
 *     Get-CsUserPolicyAssignment. Allowlisting an unproven cmdlet on a guess is
 *     exactly what pass 1's evidence rule forbids.
 *   - Per-user / per-mailbox / directory enumerations (Get-Mailbox, Get-User,
 *     Get-Recipient, Get-Group, Get-ManagementRoleAssignment, …). Tenant
 *     INVENTORY, not tenant CONFIGURATION: unbounded, and not what a
 *     Dev→Test→Prod promotion moves.
 */
const PS_CATALOG_BY_CMDLET: Readonly<Record<string, string>> = {
  "Get-AcceptedDomain": "get-accepted-domain",
  "Get-ActiveSyncDeviceAccessRule": "get-active-sync-device-access-rule",
  "Get-AddressBookPolicy": "get-address-book-policy",
  "Get-AdminAuditLogConfig": "get-admin-audit-log-config",
  "Get-AntiPhishPolicy": "get-antiphish-policies",
  "Get-AntiphishRule": "get-anti-phish-rule",
  "Get-AntiPhishRule": "get-anti-phish-rule",
  "Get-ArcConfig": "get-arc-config",
  "Get-ATPBuiltInProtectionRule": "get-atp-built-in-protection-rule",
  "Get-AtpPolicyForO365": "get-atp-policy-for-o365",
  "Get-ATPProtectionPolicyRule": "get-atp-protection-policy-rule",
  "Get-AuthenticationPolicy": "get-authentication-policy",
  "Get-CASMailboxPlan": "get-cas-mailbox-plan",
  "Get-ComplianceRetentionEventType": "get-retention-event-types",
  "Get-ComplianceTag": "get-compliance-tags",
  "Get-CsCallQueue": "get-cs-call-queue",
  "Get-CsGroupPolicyAssignment": "get-cs-group-policy-assignment",
  "Get-CsOnlineDialInConferencingTenantSettings": "get-cs-online-dial-in-conferencing-tenant-settings",
  "Get-CsOnlinePSTNGateway": "get-cs-online-pstn-gateway",
  "Get-CsOnlinePstnUsage": "get-cs-online-pstn-usage",
  "Get-CsOnlineUser": "get-all-cs-online-user",
  "Get-CsOnlineVoicemailPolicy": "get-cs-online-voicemail-policy",
  "Get-CsOnlineVoiceRoute": "get-cs-online-voice-route",
  "Get-CsOnlineVoiceRoutingPolicy": "get-cs-online-voice-routing-policy",
  "Get-CsPhoneNumberAssignment": "get-cs-phone-number-assignment",
  "Get-CsTeamsAIPolicy": "get-cs-teams-ai-policy",
  "Get-CsTeamsAppPermissionPolicy": "get-cs-teams-app-permission-policy",
  "Get-CsTeamsAppSetupPolicy": "get-cs-teams-app-setup-policy",
  "Get-CsTeamsAudioConferencingPolicy": "get-cs-teams-audio-conferencing-policy",
  "Get-CsTeamsCallHoldPolicy": "get-cs-teams-call-hold-policy",
  "Get-CsTeamsCallingPolicy": "get-cs-teams-calling-policy",
  "Get-CsTeamsCallParkPolicy": "get-cs-teams-call-park-policy",
  "Get-CsTeamsChannelsPolicy": "get-cs-teams-channels-policy",
  "Get-CsTeamsClientConfiguration": "get-cs-teams-client-configuration",
  "Get-CsTeamsComplianceRecordingApplication": "get-cs-teams-compliance-recording-application",
  "Get-CsTeamsComplianceRecordingPolicy": "get-cs-teams-compliance-recording-policy",
  "Get-CsTeamsCortanaPolicy": "get-cs-teams-cortana-policy",
  "Get-CsTeamsEmergencyCallingPolicy": "get-cs-teams-emergency-calling-policy",
  "Get-CsTeamsEmergencyCallRoutingPolicy": "get-cs-teams-emergency-call-routing-policy",
  "Get-CsTeamsEnhancedEncryptionPolicy": "get-cs-teams-enhanced-encryption-policy",
  "Get-CsTeamsEventsPolicy": "get-cs-teams-events-policy",
  "Get-CsTeamsFeedbackPolicy": "get-cs-teams-feedback-policy",
  "Get-CsTeamsFilesPolicy": "get-cs-teams-files-policy",
  "Get-CsTeamsGuestCallingConfiguration": "get-cs-teams-guest-calling-configuration",
  "Get-CsTeamsGuestMeetingConfiguration": "get-cs-teams-guest-meeting-configuration",
  "Get-CsTeamsGuestMessagingConfiguration": "get-cs-teams-guest-messaging-configuration",
  "Get-CsTeamsIPPhonePolicy": "get-cs-teams-ip-phone-policy",
  "Get-CsTeamsMeetingBroadcastConfiguration": "get-cs-teams-meeting-broadcast-configuration",
  "Get-CsTeamsMeetingBroadcastPolicy": "get-cs-teams-meeting-broadcast-policy",
  "Get-CsTeamsMeetingConfiguration": "get-cs-teams-meeting-configuration",
  "Get-CsTeamsMeetingPolicy": "get-cs-teams-meeting-policy",
  "Get-CsTeamsMessagingConfiguration": "get-cs-teams-messaging-configuration",
  "Get-CsTeamsMessagingPolicy": "get-cs-teams-messaging-policy",
  "Get-CsTeamsMobilityPolicy": "get-cs-teams-mobility-policy",
  "Get-CsTeamsNetworkRoamingPolicy": "get-cs-teams-network-roaming-policy",
  "Get-CsTeamsNotificationAndFeedsPolicy": "get-cs-teams-notification-and-feeds-policy",
  "Get-CsTeamsShiftsPolicy": "get-cs-teams-shifts-policy",
  "Get-CsTeamsTargetingPolicy": "get-cs-teams-targeting-policy",
  "Get-CsTeamsTemplatePermissionPolicy": "get-cs-teams-template-permission-policy",
  "Get-CsTeamsTranslationRule": "get-cs-teams-translation-rule",
  "Get-CsTeamsUnassignedNumberTreatment": "get-cs-teams-unassigned-number-treatment",
  "Get-CsTeamsUpdateManagementPolicy": "get-cs-teams-update-management-policy",
  "Get-CsTeamsUpgradeConfiguration": "get-cs-teams-upgrade-configuration",
  "Get-CsTeamsUpgradePolicy": "get-cs-teams-upgrade-policy",
  "Get-CsTeamsVdiPolicy": "get-cs-teams-vdi-policy",
  "Get-CsTeamsWorkLoadPolicy": "get-cs-teams-work-load-policy",
  "Get-CsTeamTemplateList": "get-cs-team-template-list",
  "Get-CsTenantDialPlan": "get-cs-tenant-dial-plan",
  "Get-CsTenantFederationConfiguration": "get-cs-tenant-federation-configuration",
  "Get-CsTenantNetworkRegion": "get-cs-tenant-network-region",
  "Get-CsTenantNetworkSite": "get-cs-tenant-network-site",
  "Get-CsTenantNetworkSubnet": "get-cs-tenant-network-subnet",
  "Get-CsTenantTrustedIPAddress": "get-cs-tenant-trusted-ip-address",
  "Get-DataClassification": "get-data-classification",
  "Get-DeviceConditionalAccessPolicy": "get-device-conditional-access-policies",
  "Get-DeviceConditionalAccessRule": "get-device-conditional-access-rule",
  "Get-DeviceConfigurationPolicy": "get-device-configuration-policies",
  "Get-DeviceConfigurationRule": "get-device-configuration-rule",
  "Get-DkimSigningConfig": "get-all-dkim-signing-config",
  "Get-DlpCompliancePolicy": "get-all-dlp-policies",
  "Get-DLPCompliancePolicy": "get-all-dlp-policies",
  "Get-DlpComplianceRule": "get-dlp-compliance-rules",
  "Get-DLPComplianceRule": "get-dlp-compliance-rules",
  "Get-DlpSensitiveInformationType": "get-dlp-sensitive-info-types",
  "Get-DLPSensitiveInformationType": "get-dlp-sensitive-info-types",
  "Get-DlpSensitiveInformationTypeRulePackage": "get-dlp-sensitive-information-type-rule-package",
  "Get-DLPSensitiveInformationTypeRulePackage": "get-dlp-sensitive-information-type-rule-package",
  "Get-EmailTenantSettings": "get-email-tenant-settings",
  "Get-EOPProtectionPolicyRule": "get-eop-protection-policy-rule",
  "Get-FilePlanPropertyAuthority": "get-file-plan-property-authority",
  "Get-FilePlanPropertyCategory": "get-file-plan-property-category",
  "Get-FilePlanPropertyCitation": "get-file-plan-property-citation",
  "Get-FilePlanPropertyDepartment": "get-file-plan-property-department",
  "Get-FilePlanPropertyReferenceId": "get-file-plan-property-reference-id",
  "Get-FilePlanPropertySubCategory": "get-file-plan-property-sub-category",
  "Get-HostedConnectionFilterPolicy": "get-hosted-connection-filter-policy",
  "Get-HostedContentFilterPolicy": "get-antispam-policies",
  "Get-HostedContentFilterRule": "get-hosted-content-filter-rule",
  "Get-HostedOutboundSpamFilterPolicy": "get-all-hosted-outbound-spam-filter-policy",
  "Get-HostedOutboundSpamFilterRule": "get-hosted-outbound-spam-filter-rule",
  "Get-InboundConnector": "get-all-inbound-connector",
  "Get-IntraOrganizationConnector": "get-intra-organization-connector",
  "Get-IRMConfiguration": "get-irm-configuration",
  "Get-JournalRule": "get-journal-rule",
  "Get-Label": "get-all-label",
  "Get-LabelPolicy": "get-all-label-policy",
  "Get-MailboxPlan": "get-mailbox-plan",
  "Get-MalwareFilterPolicy": "get-malware-filter-policy",
  "Get-MalwareFilterRule": "get-malware-filter-rule",
  "Get-ManagementScope": "get-management-scope",
  "Get-MigrationEndpoint": "get-migration-endpoint",
  "Get-MobileDeviceMailboxPolicy": "get-mobile-device-mailbox-policy",
  "Get-OnPremisesOrganization": "get-on-premises-organization",
  "Get-OrganizationConfig": "get-organization-config",
  "Get-OrganizationRelationship": "get-organization-relationship",
  "Get-OutboundConnector": "get-outbound-connector",
  "Get-OutBoundConnector": "get-outbound-connector",
  "Get-OwaMailboxPolicy": "get-owa-mailbox-policy",
  "Get-PartnerApplication": "get-partner-application",
  "Get-PerimeterConfig": "get-perimeter-config",
  "Get-PolicyConfig": "get-policy-config",
  "Get-PolicyTipConfig": "get-policy-tip-config",
  "Get-ProtectionAlert": "get-protection-alerts",
  "Get-QuarantinePolicy": "get-quarantine-policy",
  "Get-RemoteDomain": "get-remote-domain",
  "Get-ReportSubmissionPolicy": "get-report-submission-policy",
  "Get-ReportSubmissionRule": "get-report-submission-rule",
  "Get-RetentionCompliancePolicy": "get-retention-compliance-policies",
  "Get-RetentionComplianceRule": "get-retention-compliance-rules",
  "Get-RetentionPolicy": "get-retention-policy",
  "Get-RetentionPolicyTag": "get-retention-policy-tag",
  "Get-RoleAssignmentPolicy": "get-role-assignment-policy",
  "Get-RoleGroup": "get-compliance-role-groups",
  "Get-SafeAttachmentPolicy": "get-safe-attachment-policies",
  "Get-SafeAttachmentRule": "get-safe-attachment-rule",
  "Get-SafeLinksPolicy": "get-safe-links-policies",
  "Get-SafeLinksRule": "get-safe-links-rule",
  "Get-SharingPolicy": "get-sharing-policy",
  "Get-SupervisoryReviewPolicyV2": "get-supervisory-review-policy-v2",
  "Get-SupervisoryReviewRule": "get-supervisory-review-rule",
  "Get-TenantAllowBlockListSpoofItems": "get-tenant-allow-block-list-spoof-items",
  "Get-TransportConfig": "get-transport-config",
  "Get-TransportRule": "get-transport-rules",
  "Get-UnifiedAuditLogRetentionPolicy": "get-audit-retention-policy",
};

/**
 * Microsoft365DSC lists helper cmdlets alongside the real read cmdlet in a
 * resource's `read_cmdlets`. They are not what fetches the objects, so they must
 * not be what decides reachability, and they must not appear in a "no executor for
 * X" reason either — naming `Get-CompareParameters` as the missing capability
 * would be a misleading diagnosis.
 *
 *   Get-CompareParameters             DSC's own parameter-diff helper
 *   Get-MSCloudLoginConnectionProfile MSCloudLoginAssistant's session helper
 *   Get-MgGroup / Get-MgUser          Graph SDK lookups DSC uses to resolve a
 *                                     principal, not to read the resource itself
 */
const PS_NON_READ_HELPER_CMDLETS: ReadonlySet<string> = new Set([
  "Get-CompareParameters",
  "Get-MSCloudLoginConnectionProfile",
  "Get-MgGroup",
  "Get-MgUser",
]);

// ── Public shapes ────────────────────────────────────────────────────────────

export interface CollectSnapshotOptions {
  /** `tenants.id` — the platform's own customer key. */
  tenantId: number;
  trigger: SnapshotTrigger;
  /** Free text naming what asked for this run. */
  triggerRef?: string | null;
  /** The Workflow Engine run that produced it, when there is one. */
  wfRunId?: number | null;
  requestedByUserId?: number | null;

  /** Collect only these registry keys. Anything not collectable is still rejected. */
  resourceKeys?: string[];
  /** Restrict to these transports — e.g. `["graph"]` for a Graph-only run. */
  transports?: string[];
  /** Restrict to these surfaces, as the registry spells them. */
  surfaces?: string[];
  /** Hard cap on how many registry rows this run targets, applied after ordering. */
  maxResources?: number;

  timeBudgetMs?: number;
  maxPagesPerResource?: number;
  concurrency?: number;

  onProgress?: (evt: SnapshotProgressEvent) => void;
}

export interface SnapshotProgressEvent {
  index: number;
  total: number;
  resourceKey: string;
  status: SnapshotResourceStatus;
  objectCount: number;
  skipReason: SnapshotSkipReason | null;
}

export interface SnapshotResourceOutcome {
  resourceKey: string;
  readTransport: string;
  status: SnapshotResourceStatus;
  skipReason: SnapshotSkipReason | null;
  reasonDetail: string | null;
  objectCount: number;
  pageCount: number | null;
  requestRef: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number;
}

export interface CollectSnapshotResult {
  snapshotRowId: number;
  snapshotId: string;
  tenantId: number;
  entraTenantId: string;
  status: "sealed" | "failed";
  isComplete: boolean;
  resourceTypesTargeted: number;
  resourceTypesCollected: number;
  resourceTypesEmpty: number;
  resourceTypesPartial: number;
  resourceTypesSkipped: number;
  resourceTypesFailed: number;
  objectCount: number;
  durationMs: number;
  error: string | null;
  outcomes: SnapshotResourceOutcome[];
}

/** Raised when the run cannot even begin. Nothing is written when this throws. */
export class SnapshotPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotPreconditionError";
  }
}

// ── Canonicalisation and hashing ─────────────────────────────────────────────

/**
 * RFC 8785 (JSON Canonicalization Scheme) serialisation of a JSON value.
 *
 * This is the real thing rather than an approximation, for values that came out of
 * `JSON.parse` — which is every value this module hashes:
 *   - object members are sorted by their UTF-16 code units, which is exactly what
 *     `Array.prototype.sort()` does by default;
 *   - numbers serialise via ECMAScript's own Number-to-string, which is what
 *     `JSON.stringify` uses;
 *   - strings use JSON's own escaping, likewise.
 *
 * The recipe is written down here and recorded per row as `hash_algorithm`
 * (`jcs-sha256`) because a hash whose derivation is not stated is a number, not
 * evidence — #1797 will compare these across snapshots taken months apart.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  const t = typeof value;
  if (t === "number") return Number.isFinite(value as number) ? JSON.stringify(value) : "null";
  if (t === "boolean" || t === "string") return JSON.stringify(value);
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`).join(",")}}`;
  }
  // undefined / function / symbol cannot appear in JSON.parse output. Reaching
  // here would mean a non-JSON value was handed in; `null` keeps the hash total
  // rather than throwing mid-snapshot.
  return "null";
}

export function hashObject(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

// ── Identity ─────────────────────────────────────────────────────────────────

/**
 * The diff pairing key for one object, computed by the strategy its resource type
 * DECLARES — never inferred per object, because an identity that changes rule
 * between two snapshots pairs with nothing and manufactures churn.
 *
 * The returned `strategy` is what actually produced the value, which is why it is
 * stored per object: when a declared strategy cannot be satisfied (an object with
 * no `id`, a `dsc-identity` object whose `Identity` is absent) the fallback to
 * `content-hash` is visible in the data instead of being mixed in silently. A
 * content-hashed object pairs on its content, so a modification reads as a delete
 * plus an add — a real limitation of the diff for those rows, recorded rather than
 * hidden.
 */
export function resolveObjectIdentity(
  obj: Record<string, unknown>,
  declared: SnapshotIdentityStrategy,
  identityPropertyNames: string[],
  objectHash: string,
): { identity: string; strategy: SnapshotIdentityStrategy } {
  const read = (name: string): string | null => {
    const v = obj[name];
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return v.length > 0 ? v : null;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return null;
  };

  switch (declared) {
    case "graph-singleton":
      // The resource IS the object, so the resource key is the identity and there
      // is exactly one per snapshot. A literal keeps the value stable even if the
      // registry's display name later changes.
      return { identity: "singleton", strategy: "graph-singleton" };

    case "graph-id": {
      const id = read(identityPropertyNames[0] ?? "id") ?? read("id");
      return id ? { identity: id, strategy: "graph-id" } : { identity: objectHash, strategy: "content-hash" };
    }

    case "dsc-identity": {
      const name = identityPropertyNames[0] ?? "Identity";
      // Exchange/Purview/Teams objects come back with PascalCase property names,
      // but the transports are not consistent about it, so the declared name is
      // tried first and a case-insensitive match second — matching on the real
      // property rather than failing over to a hash for a casing difference.
      const direct = read(name);
      if (direct) return { identity: direct, strategy: "dsc-identity" };
      const lower = name.toLowerCase();
      const match = Object.keys(obj).find((k) => k.toLowerCase() === lower);
      const viaMatch = match ? read(match) : null;
      return viaMatch
        ? { identity: viaMatch, strategy: "dsc-identity" }
        : { identity: objectHash, strategy: "content-hash" };
    }

    case "composite-key": {
      const parts = identityPropertyNames.map((n) => read(n));
      // ALL declared parts must be present. A composite key with a missing member
      // is not a weaker key, it is a different key — and two objects differing
      // only in the absent member would collide.
      if (parts.length > 0 && parts.every((p) => p !== null)) {
        return { identity: parts.join("|"), strategy: "composite-key" };
      }
      return { identity: objectHash, strategy: "content-hash" };
    }

    case "content-hash":
      return { identity: objectHash, strategy: "content-hash" };

    case "unresolved":
    default:
      // Unreachable in practice: the database refuses `is_collectable = true` on an
      // `unresolved` type. Kept total rather than throwing mid-run.
      return { identity: objectHash, strategy: "content-hash" };
  }
}

/** A label for operator surfaces. Never used for pairing — that is `object_identity`. */
function resolveDisplayName(obj: Record<string, unknown>): string | null {
  for (const key of ["displayName", "DisplayName", "name", "Name", "Identity", "title", "id"]) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) return v.slice(0, 400);
  }
  return null;
}

// ── Error classification ─────────────────────────────────────────────────────

/** Graph's own error literal, lifted out of a response body. */
export function extractErrorCode(body: string): string | null {
  const m = /"code"\s*:\s*"([^"]+)"/.exec(body);
  return m ? m[1] : null;
}

/**
 * Turn a real failure into one of #1795's skip reasons.
 *
 * Every branch below keys off something the platform has ACTUALLY OBSERVED — a
 * typed error this codebase already raises, or an error literal recorded in the
 * survey/resource-model tables. Anything else lands on `unknown_error` on purpose:
 * an unclassified failure filed under a guessed cause is worse than one labelled
 * unknown, because it stops looking like a question.
 *
 * Git #2115 sharpened this against the largest real snapshot (row 10, 778
 * failures): `unknown_error` was 304 of them (39%) before the branches below
 * existed, because `status`/`body` were real evidence the earlier version simply
 * never looked past 401/403/429/5xx to read. #2115 folds in #1962's smaller,
 * earlier dataset (snapshot row 8) too — three of its four distinguishable causes
 * are literals matched here; the fourth, `not_supported_app_only`'s PowerShell
 * form, was already handled above via `PsExecutionError`.
 */
export function classifySnapshotFailure(
  err: unknown,
  status: number | null,
  body: string | null,
): { reason: SnapshotSkipReason; detail: string } {
  if (err instanceof LicenseGapError) {
    return { reason: "license_required", detail: err.message };
  }
  if (err instanceof ConsentRevokedError) {
    // Admin consent for the whole tenant is gone. Not a property of this resource,
    // and the run aborts on it — see the caller.
    return { reason: "permission_denied", detail: err.message };
  }
  if (err instanceof PsExecutionError) {
    switch (err.kind) {
      case "cmdlet_unavailable":
        return { reason: "cmdlet_unavailable", detail: err.message };
      case "auth_failed":
        return { reason: "permission_denied", detail: err.message };
      case "unreachable":
      case "script_error":
      default:
        return { reason: "transport_error", detail: err.message };
    }
  }

  // Git #2010: the `dns` transport has no HTTP status/body — a Node resolver
  // failure carries its own `NodeJS.ErrnoException.code` instead. Anything
  // other than "no record of this type" (which `queryTxtRecords` already
  // resolves to an empty array, never a throw) is a real resolver/network
  // fault, not a fact about the tenant.
  const errnoCode = (err as NodeJS.ErrnoException)?.code;
  if (errnoCode && ["ECONNREFUSED", "ETIMEOUT", "ESERVFAIL", "EREFUSED", "ECONNRESET"].includes(errnoCode)) {
    return { reason: "transport_error", detail: `DNS resolver error ${errnoCode}: ${err instanceof Error ? err.message : String(err)}` };
  }

  const code = body ? extractErrorCode(body) : null;
  const text = `${code ?? ""} ${body ?? ""} ${err instanceof Error ? err.message : String(err ?? "")}`;
  const lower = text.toLowerCase();

  if (status === 403 || code === "Authorization_RequestDenied" || code === "accessDenied") {
    return { reason: "permission_denied", detail: (code ?? `HTTP ${status}`) + (body ? `: ${body.slice(0, 400)}` : "") };
  }
  if (status === 401) {
    // A 401 that survived graphFetchForTenant's fresh-token retry is a real
    // scope/audience problem on THIS call, which that function's own comment
    // states explicitly — not a tenant-wide consent revocation.
    return { reason: "permission_denied", detail: `HTTP 401 after a fresh-token retry: ${body?.slice(0, 400) ?? ""}` };
  }
  if (lower.includes("not licensed") || lower.includes("premium license") || lower.includes("not provisioned")) {
    return { reason: "license_required", detail: body?.slice(0, 400) ?? text.slice(0, 400) };
  }
  if (status === 429) {
    // Only reachable once the backoff's own retries are spent, so this is a
    // sustained throttle rather than the ordinary one rule 5 absorbs.
    return { reason: "transport_error", detail: "429 TooManyRequests persisted after the configured backoff retries" };
  }
  if (status !== null && status >= 500) {
    return { reason: "transport_error", detail: `HTTP ${status}: ${body?.slice(0, 400) ?? ""}` };
  }

  // ── #2115: the endpoint is real, but Graph says it doesn't apply to THIS
  // tenant/account — three observed literal shapes, all the same underlying
  // fact. 178 rows on snapshot row 10 alone (400/AuthenticationError,
  // 400/BadRequest), previously all `unknown_error`.
  if (
    lower.includes("not supported for aad accounts") ||
    lower.includes("not applicable to target tenant") ||
    lower.includes("aadsts500011")
  ) {
    return { reason: "not_applicable_to_account_type", detail: body?.slice(0, 400) ?? text.slice(0, 400) };
  }
  // Graph-side app-only-context restriction (#1962 named the PowerShell form of
  // this; this is the Graph literal — 412 PreconditionFailed).
  if (lower.includes("not supported in application-only context")) {
    return { reason: "not_supported_app_only", detail: body?.slice(0, 400) ?? text.slice(0, 400) };
  }
  // ── #2115: the resource does not exist at this path/version at all — a plain
  // 404, the OData "segment doesn't resolve" 400, or Graph's own nested
  // `apiNotFound` code (#1962's cause 3, e.g. the CSDL-derived resources Graph
  // never actually serves). 173 rows on snapshot row 10, previously all
  // `unknown_error`.
  if (
    status === 404 ||
    lower.includes("resource not found for the segment") ||
    lower.includes("apinotfound")
  ) {
    return { reason: "endpoint_not_found", detail: (code ?? `HTTP ${status}`) + (body ? `: ${body.slice(0, 400)}` : "") };
  }

  return {
    reason: "unknown_error",
    detail: err instanceof Error ? err.message.slice(0, 800) : String(err ?? "").slice(0, 800),
  };
}

// ── Per-resource collection ──────────────────────────────────────────────────

interface RawCollection {
  objects: Record<string, unknown>[];
  pageCount: number | null;
  requestRef: string;
  /** True when the read succeeded but is known incomplete — the `partial` verdict. */
  truncated: boolean;
}

/**
 * Read one Graph resource, whole.
 *
 * The URL is built from the registry's own `graph_version` + `graph_path`, so beta
 * and v1.0 resources take the same path through the same transport. Beta became
 * reachable at all in this issue: `graphFetchForTenant` hardcoded the v1.0 root, so
 * the 464 collectable beta resources had nothing to call. It now accepts an
 * absolute Graph URL (host-gated), which is a widening of the existing transport
 * rather than a new one.
 */
async function collectGraphResource(
  entraTenantId: string,
  rt: ConfigSnapshotResourceType,
  maxPages: number,
): Promise<RawCollection> {
  const { graphFetchPaginated } = await import("./monitor-executor");
  const path = rt.graphPath ?? "";
  const version = rt.graphVersion ?? "v1.0";
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const requestRef = `${version}${suffix}`;
  const endpoint = version === "v1.0" ? suffix : `https://graph.microsoft.com/${version}${suffix}`;

  const { items, pageCount } = await graphFetchPaginated(entraTenantId, endpoint, "GET", undefined, {
    throttleRetry: { maxRetries: DEFAULT_THROTTLE_RETRIES, baseDelayMs: DEFAULT_THROTTLE_BASE_DELAY_MS },
  });

  // `graphFetchPaginated` has its own NEXT_LINK_MAX_PAGES = 50 safety cap and this
  // run has its own, usually lower, budget. Either one being hit means the object
  // SET is not whole, which is `partial` — a differ must read a missing object
  // under a truncated resource as unknown, never as a deletion.
  const truncated = pageCount >= 50 || pageCount > maxPages;

  const objects = items.filter(
    (i): i is Record<string, unknown> => i !== null && typeof i === "object" && !Array.isArray(i),
  );
  return { objects, pageCount, requestRef, truncated };
}


/**
 * Pick WHICH of a resource's mapped read cmdlets actually reads THAT resource.
 *
 * Microsoft365DSC records every cmdlet a resource's `Get-TargetResource` touches,
 * not just the one that fetches the objects, and the order is the order they appear
 * in that function — not an order of importance. So "first mapped wins" silently
 * reads the wrong object type whenever a rule-shaped resource happens to call its
 * policy-shaped sibling first. That is not hypothetical and it is not new:
 * `m365dsc:EXOHostedContentFilterRule` lists `Get-HostedContentFilterPolicy` ahead
 * of `Get-HostedContentFilterRule`, and snapshot row 8 duly recorded 2 CONTENT
 * FILTER POLICIES against the resource type named "…Rule". #1961 mapping 81 keys
 * instead of 5 would have turned that one latent case into seven
 * (`EXOHostedOutboundSpamFilterRule`, `SCDeviceConditionalAccessRule`,
 * `SCDeviceConfigurationRule`, `SCFilePlanPropertySubCategory`, `SCLabelPolicy`,
 * `SCSupervisoryReviewRule` and the pre-existing one), so the selection rule is
 * fixed here rather than worked around per-resource.
 *
 * The rule: prefer the mapped cmdlet whose NOUN is a suffix of the resource's own
 * DSC name, longest noun first — `EXOHostedContentFilterRule` ends with
 * "HostedContentFilterRule", so `Get-HostedContentFilterRule` beats
 * `Get-HostedContentFilterPolicy`, which is not a suffix of it at all. When no
 * mapped cmdlet's noun matches, the registry's own first-listed mapped cmdlet is
 * kept, which is the right answer for the resources that genuinely read a
 * differently-named object (`EXODnssecForVerifiedDomain` really is read via
 * `Get-AcceptedDomain`; `EXOAuthenticationPolicyAssignment` really is read via
 * `Get-AuthenticationPolicy`).
 *
 * Comparison is case-insensitive because `read_cmdlets` genuinely carries case
 * variants of one cmdlet (`Get-DLPCompliancePolicy` / `Get-DlpCompliancePolicy`).
 */
/**
 * The ps-execution catalog key a read cmdlet routes to, or `undefined` when the
 * container has no unfiltered entry for it. Exported so a test can assert the routing
 * itself — e.g. that `Get-CsOnlineUser` resolves to the unfiltered `get-all-cs-online-user`
 * twin and never to the check-shaped `get-cs-online-user` (Git #2850).
 */
export function psCatalogKeyForCmdlet(cmdlet: string): string | undefined {
  return PS_CATALOG_BY_CMDLET[cmdlet];
}

/**
 * The forms of a cmdlet noun that may legitimately be compared against a DSC resource
 * name, longest first.
 *
 * Git #2850 — Exchange and Purview cmdlet nouns and their DSC resource names share a
 * spelling (`EXOHostedContentFilterRule` / `Get-HostedContentFilterRule`), which is why
 * the plain suffix test above worked for pass 1. Teams cmdlets do not: every one carries
 * a `Cs` / `CsOnline` / `CsTeams` / `CsTenant` module prefix that the DSC name never
 * has, so `teamsvoiceroute`.endsWith(`csonlinevoiceroute`) is false for EVERY Teams
 * resource. The suffix rule therefore never fired for Teams and every multi-cmdlet Teams
 * resource silently fell back to whichever cmdlet Microsoft365DSC happened to list first
 * — the exact failure #1961 fixed for Exchange, re-appearing in a shape its rule could
 * not see.
 *
 * Observed live, not hypothesised: in snapshot 59 `m365dsc:TeamsVoiceRoutingPolicy`
 * resolved to `Get-CsOnlinePstnUsage` and stored a PSTN USAGE against a resource type
 * named "…VoiceRoutingPolicy", and `m365dsc:TeamsVoiceRoute` resolved to
 * `Get-CsOnlinePSTNGateway`. Stripping the module prefix makes the noun comparable
 * again (`csonlinevoiceroutingpolicy` -> `voiceroutingpolicy`, a real suffix of
 * `teamsvoiceroutingpolicy`).
 *
 * Prefixes are stripped only from the FRONT and only when the remainder is non-empty;
 * no Exchange/Purview noun in the catalog starts with `cs`, so pass 1's behaviour is
 * unchanged.
 */
function comparableNounForms(noun: string): string[] {
  const forms = [noun];
  for (const prefix of ["csteams", "csonline", "cstenant", "cs"]) {
    if (noun.startsWith(prefix) && noun.length > prefix.length) {
      forms.push(noun.slice(prefix.length));
    }
  }
  return forms;
}

export function selectReadCmdlet(resourceKey: string, cmdlets: string[]): string | undefined {
  const mappedCmdlets = cmdlets.filter((c) => PS_CATALOG_BY_CMDLET[c] !== undefined);
  if (mappedCmdlets.length <= 1) return mappedCmdlets[0];

  // "m365dsc:EXOHostedContentFilterRule" -> "exohostedcontentfilterrule"
  const localName = (resourceKey.split(":").pop() ?? resourceKey).toLowerCase();

  let best: string | undefined;
  let bestNounLength = 0;
  for (const cmdlet of mappedCmdlets) {
    const noun = cmdlet.replace(/^Get-/i, "").toLowerCase();
    for (const form of comparableNounForms(noun)) {
      if (!localName.endsWith(form)) continue;
      if (form.length > bestNounLength) {
        best = cmdlet;
        bestNounLength = form.length;
      }
    }
  }
  return best ?? mappedCmdlets[0];
}
/**
 * Read one PowerShell resource through the ps-execution container.
 *
 * Returns an `unreachable` reason when no un-filtered catalog entry invokes this
 * resource's read cmdlet — the caller turns that into a `no_executor` row naming
 * the exact cmdlet, so an unreachable resource is a stated gap rather than an
 * absence.
 */
async function collectPowerShellResource(
  entraTenantId: string,
  organization: string,
  rt: ConfigSnapshotResourceType,
): Promise<RawCollection | { unreachable: string }> {
  const cmdlets = (rt.readCmdlets ?? []).filter((c) => !PS_NON_READ_HELPER_CMDLETS.has(c));
  const mapped = selectReadCmdlet(rt.resourceKey, cmdlets);
  if (!mapped) {
    const named = cmdlets.length > 0 ? cmdlets.join(", ") : "(no read cmdlet recorded)";
    return {
      unreachable:
        `No ps-execution catalog entry invokes this resource's read cmdlet unfiltered — needs ${named}. ` +
        `cmdletKey resolves only to a code-owned entry in services/ps-execution/cmdlet-catalog.ps1 (#209), ` +
        `so this is unreachable until an unfiltered entry for that cmdlet is added to the container.`,
    };
  }
  const cmdletKey = PS_CATALOG_BY_CMDLET[mapped];
  const { items } = await callPsExecution(cmdletKey, { Organization: organization, TenantId: entraTenantId });
  const objects = items.filter(
    (i): i is Record<string, unknown> => i !== null && typeof i === "object" && !Array.isArray(i),
  );
  return { objects, pageCount: 1, requestRef: `ps:${cmdletKey} (${mapped})`, truncated: false };
}

/**
 * Read the DNS-backed resource: SPF/DKIM/DMARC TXT records for the tenant's own
 * verified domains (Git #2010).
 *
 * Reuses `monitor-executor.ts`'s `queryTxtRecords` verbatim — per #1796's own
 * first constraint, this file introduces no transport of its own, and a second
 * DNS client was explicitly ruled out on this issue too. Domains come from a
 * live Graph call to `/domains` (the same transport `collectGraphResource`
 * already uses), filtered to `isVerified`, rather than from this run's own
 * in-progress `graph:v1.0:/domains` objects: a bounded-concurrency worker pool
 * gives no guarantee that resource finishes before this one starts, so reading
 * it back live is the only way to not race the collector's own domain list.
 *
 * One object per (domain, record type, name) — the composite key the registry
 * declares — rather than one blob per tenant, so SPF/DKIM/DMARC on each
 * verified domain diffs independently in #1797.
 */
async function collectDnsResource(entraTenantId: string): Promise<RawCollection> {
  const { graphFetchPaginated, queryTxtRecords, DKIM_DEFAULT_SELECTORS } = await import("./monitor-executor");

  const { items: domainItems } = await graphFetchPaginated(entraTenantId, "/domains", "GET");
  const domains = domainItems
    .filter((d): d is Record<string, unknown> => d !== null && typeof d === "object" && !Array.isArray(d))
    .filter((d) => d.isVerified === true)
    .map((d) => String(d.id));

  const lookupsFor = (domain: string): Array<{ recordType: string; name: string }> => [
    { recordType: "spf", name: domain },
    { recordType: "dmarc", name: `_dmarc.${domain}` },
    ...DKIM_DEFAULT_SELECTORS.map((selector) => ({ recordType: "dkim", name: `${selector}._domainkey.${domain}` })),
  ];

  const objects: Record<string, unknown>[] = [];
  await Promise.all(
    domains.flatMap((domain) =>
      lookupsFor(domain).map(async ({ recordType, name }) => {
        const rawTxtRecords = await queryTxtRecords(name);
        // Same recognition rule runDnsCheck applies for the check path, kept
        // identical so the snapshot and the live check never disagree about
        // which of a name's TXT records is the SPF/DMARC one.
        const recognizedRecord =
          recordType === "spf"
            ? rawTxtRecords.find((r) => r.startsWith("v=spf1")) ?? null
            : recordType === "dmarc"
              ? rawTxtRecords.find((r) => r.startsWith("v=DMARC1")) ?? null
              : rawTxtRecords[0] ?? null;
        objects.push({
          domain,
          recordType,
          name,
          rawTxtRecords,
          recognizedRecord,
          found: rawTxtRecords.length > 0,
        });
      }),
    ),
  );

  return {
    objects,
    pageCount: 1,
    requestRef: "dns:txt (spf/dmarc/dkim, per verified domain)",
    truncated: false,
  };
}

// ── The run ──────────────────────────────────────────────────────────────────

/**
 * Collect one whole snapshot for one tenant.
 *
 * Sequence, and why it is this order:
 *   1. Resolve the tenant. A missing tenant or a missing Entra GUID throws BEFORE
 *      any row is written — a snapshot header with nothing behind it would be a
 *      false gap in the history.
 *   2. Open the header `running`. Everything after this point writes into it, and
 *      the run is visible while it is in flight.
 *   3. Collect, bounded-concurrently, in the registry's own `collection_order`.
 *      Each resource is isolated: it produces an outcome, never an exception that
 *      escapes. The single exception is `ConsentRevokedError`, which is a
 *      tenant-wide fact — continuing would write hundreds of identical failures
 *      that all say the same thing once — so the run stops and seals `failed`.
 *   4. Seal. Counts come from the outcomes actually recorded, never estimated, and
 *      `is_complete` is asserted only when nothing was partial, skipped or failed.
 *      From this instant the database triggers make the snapshot immutable.
 */
export async function collectTenantConfigSnapshot(
  opts: CollectSnapshotOptions,
): Promise<CollectSnapshotResult> {
  const startedAt = Date.now();
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const maxPages = opts.maxPagesPerResource ?? DEFAULT_MAX_PAGES_PER_RESOURCE;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);

  // 1. Tenant ────────────────────────────────────────────────────────────────
  const [tenant] = await db
    .select({
      id: tenantsTable.id,
      entraTenantId: tenantsTable.tenantId,
      domain: tenantsTable.domain,
      customerName: tenantsTable.customerName,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, opts.tenantId))
    .limit(1);

  if (!tenant) throw new SnapshotPreconditionError(`No tenants row with id ${opts.tenantId}`);
  if (!tenant.entraTenantId) {
    throw new SnapshotPreconditionError(
      `Tenant ${opts.tenantId} has no Entra tenant id — nothing to authenticate against`,
    );
  }
  const entraTenantId = tenant.entraTenantId;
  const organization = tenant.domain || entraTenantId;

  // 2. Targets, straight from the registry ───────────────────────────────────
  const filters = [eq(configSnapshotResourceTypesTable.isCollectable, true)];
  if (opts.resourceKeys?.length) {
    filters.push(inArray(configSnapshotResourceTypesTable.resourceKey, opts.resourceKeys));
  }
  if (opts.transports?.length) {
    filters.push(inArray(configSnapshotResourceTypesTable.readTransport, opts.transports as never[]));
  }
  if (opts.surfaces?.length) {
    filters.push(inArray(configSnapshotResourceTypesTable.surface, opts.surfaces as never[]));
  }

  let targets = await db
    .select()
    .from(configSnapshotResourceTypesTable)
    .where(and(...filters))
    .orderBy(asc(configSnapshotResourceTypesTable.collectionOrder), asc(configSnapshotResourceTypesTable.resourceKey));

  if (opts.maxResources !== undefined && opts.maxResources >= 0) {
    targets = targets.slice(0, opts.maxResources);
  }
  if (targets.length === 0) {
    throw new SnapshotPreconditionError(
      "No collectable resource types matched — the registry is empty or every filter excluded everything. " +
        "Run scripts/config-state/build-snapshot-registry.mjs first.",
    );
  }

  // 3. Open the header ───────────────────────────────────────────────────────
  const [header] = await db
    .insert(tenantConfigSnapshotsTable)
    .values({
      tenantId: tenant.id,
      entraTenantId,
      trigger: opts.trigger,
      triggerRef: opts.triggerRef ?? null,
      wfRunId: opts.wfRunId ?? null,
      requestedByUserId: opts.requestedByUserId ?? null,
      status: "running",
      resourceTypesTargeted: targets.length,
      collectorVersion: CONFIG_SNAPSHOT_COLLECTOR_VERSION,
    })
    .returning({ id: tenantConfigSnapshotsTable.id, snapshotId: tenantConfigSnapshotsTable.snapshotId });

  const snapshotRowId = header.id;
  log.info(
    {
      snapshotRowId,
      snapshotId: header.snapshotId,
      tenantId: tenant.id,
      entraTenantId,
      customerName: tenant.customerName,
      targets: targets.length,
      trigger: opts.trigger,
      timeBudgetMs,
    },
    "config-snapshot-collector: opened snapshot",
  );

  // 4. Collect ───────────────────────────────────────────────────────────────
  const outcomes: SnapshotResourceOutcome[] = [];
  /**
   * Held in an object rather than a plain `let` deliberately. TypeScript's
   * control-flow analysis does not track assignments made inside the worker
   * closures below, so a `let` would be narrowed to `null` at the seal step and
   * the compiler would reject reading `.message` off it — a false negative that
   * would otherwise get "fixed" with a cast that hides the real nullability.
   */
  const consent: { revoked: ConsentRevokedError | null } = { revoked: null };
  let nextIndex = 0;

  const runOne = async (rt: ConfigSnapshotResourceType, index: number): Promise<void> => {
    const t0 = Date.now();
    const base = {
      resourceKey: rt.resourceKey,
      readTransport: rt.readTransport,
      pageCount: null as number | null,
      requestRef: null as string | null,
      httpStatus: null as number | null,
      errorCode: null as string | null,
      errorMessage: null as string | null,
    };

    const record = (o: SnapshotResourceOutcome) => {
      outcomes.push(o);
      opts.onProgress?.({
        index,
        total: targets.length,
        resourceKey: o.resourceKey,
        status: o.status,
        objectCount: o.objectCount,
        skipReason: o.skipReason,
      });
    };

    // The run's own budget, checked per resource. Everything past it is recorded
    // `skipped` / `budget_exhausted` rather than omitted, so the snapshot still
    // states what it did not get to.
    if (Date.now() - startedAt > timeBudgetMs) {
      record({
        ...base,
        status: "skipped",
        skipReason: "budget_exhausted",
        reasonDetail: `Run time budget of ${timeBudgetMs}ms was already spent when this resource came up`,
        objectCount: 0,
        durationMs: 0,
      });
      return;
    }

    try {
      let raw: RawCollection;

      if (rt.readTransport === "graph") {
        if (!rt.graphPath) {
          record({
            ...base,
            status: "skipped",
            skipReason: "not_collectable",
            reasonDetail: "Registry row has read_transport 'graph' but no graph_path to call",
            objectCount: 0,
            durationMs: Date.now() - t0,
          });
          return;
        }
        raw = await collectGraphResource(entraTenantId, rt, maxPages);
      } else if (rt.readTransport === "powershell" || rt.readTransport === "sharepoint-admin") {
        const psResult = await collectPowerShellResource(entraTenantId, organization, rt);
        if ("unreachable" in psResult) {
          record({
            ...base,
            status: "skipped",
            skipReason: "no_executor",
            reasonDetail: psResult.unreachable,
            objectCount: 0,
            durationMs: Date.now() - t0,
          });
          return;
        }
        raw = psResult;
      } else if (rt.readTransport === "dns") {
        raw = await collectDnsResource(entraTenantId);
      } else {
        // #1849: `azure-rm` and `power-platform` have no executor in this platform
        // at all. The registry already marks them not collectable, so this is a
        // belt-and-braces branch — reached only if a row is ever mis-set.
        record({
          ...base,
          status: "skipped",
          skipReason: "no_executor",
          reasonDetail: `No execution path exists for read_transport '${rt.readTransport}' (#1849)`,
          objectCount: 0,
          durationMs: Date.now() - t0,
        });
        return;
      }

      base.pageCount = raw.pageCount;
      base.requestRef = raw.requestRef;

      // A genuine zero. `empty` and not `collected`, and distinguishable from every
      // failure state — this is the value that stops "we could not read it" being
      // reported as "you do not have any".
      if (raw.objects.length === 0) {
        record({
          ...base,
          status: raw.truncated ? "partial" : "empty",
          skipReason: raw.truncated ? "budget_exhausted" : null,
          reasonDetail: raw.truncated
            ? `Paging truncated at ${raw.pageCount} pages before any object was read`
            : null,
          objectCount: 0,
          durationMs: Date.now() - t0,
        });
        return;
      }

      // Build the rows. `object_json` is the object VERBATIM — no projection onto
      // the derived property model, which is #1795's first constraint and the
      // reason #1846's six undeclared Graph properties survive into the store.
      const seen = new Set<string>();
      const rows: InsertTenantConfigSnapshotObject[] = [];
      let duplicateIdentities = 0;

      for (const obj of raw.objects) {
        const objectHash = hashObject(obj);
        const { identity, strategy } = resolveObjectIdentity(
          obj,
          rt.identityStrategy,
          rt.identityPropertyNames ?? [],
          objectHash,
        );
        const key = identity.slice(0, 1000);
        if (seen.has(key)) {
          // Two objects sharing an identity would make pairing ambiguous, and the
          // unique index refuses the pair outright. Keep the first, count the rest,
          // and say so on the row — a dropped object must never be invisible.
          duplicateIdentities++;
          continue;
        }
        seen.add(key);
        rows.push({
          snapshotRowId,
          tenantId: tenant.id,
          resourceKey: rt.resourceKey,
          objectIdentity: key,
          identityStrategy: strategy,
          displayName: resolveDisplayName(obj),
          objectJson: obj,
          objectHash,
          hashAlgorithm: "jcs-sha256",
          propertyCount: Object.keys(obj).length,
          odataType: typeof obj["@odata.type"] === "string" ? (obj["@odata.type"] as string) : null,
          sourceRef: raw.requestRef,
        });
      }

      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        await db.insert(tenantConfigSnapshotObjectsTable).values(rows.slice(i, i + INSERT_BATCH));
      }

      const detailParts: string[] = [];
      if (raw.truncated) detailParts.push(`Paging truncated at ${raw.pageCount} pages`);
      if (duplicateIdentities > 0) {
        detailParts.push(
          `${duplicateIdentities} object(s) shared an identity under strategy '${rt.identityStrategy}' and were dropped — the first of each was kept`,
        );
      }

      record({
        ...base,
        status: raw.truncated ? "partial" : "collected",
        skipReason: raw.truncated ? "budget_exhausted" : null,
        reasonDetail: detailParts.length > 0 ? detailParts.join("; ") : null,
        objectCount: rows.length,
        durationMs: Date.now() - t0,
      });
    } catch (err) {
      if (err instanceof ConsentRevokedError) {
        // Tenant-wide. Recorded once here, and the run stops — see the loop.
        consent.revoked = err;
        record({
          ...base,
          status: "failed",
          skipReason: "permission_denied",
          reasonDetail: err.message,
          objectCount: 0,
          durationMs: Date.now() - t0,
        });
        return;
      }

      // #1847's real service-level verdict, when the failure was Intune refusing to
      // answer at all. `service_not_configured` is a different customer
      // conversation from `permission_denied`, so it is resolved rather than
      // lumped in.
      const { ServiceNotConfiguredError } = await import("./service-availability");
      if (err instanceof ServiceNotConfiguredError) {
        record({
          ...base,
          status: "failed",
          skipReason: err.state === "not_licensed" ? "license_required" : "service_not_configured",
          reasonDetail: err.reason,
          objectCount: 0,
          httpStatus: err.httpStatus,
          errorCode: err.detectionSignature,
          errorMessage: err.responseBody.slice(0, EVIDENCE_BODY_CHARS),
          durationMs: Date.now() - t0,
        });
        return;
      }

      const { GraphPaginatedError } = await import("./monitor-executor");
      // Git #2115: LicenseGapError carries real wire evidence (the res.status it
      // was thrown from, and its raw Graph body) but was never read here — every
      // LicenseGapError catch recorded NO http_status/error_code at all (31 of the
      // snapshot's 32 no-evidence rows). Read it the same way GraphPaginatedError
      // already is.
      const status = err instanceof GraphPaginatedError
        ? err.status
        : err instanceof LicenseGapError
          ? err.httpStatus
          : null;
      const body = err instanceof GraphPaginatedError
        ? err.body
        : err instanceof LicenseGapError
          ? err.rawBody
          : null;
      const { reason, detail } = classifySnapshotFailure(err, status, body);

      record({
        ...base,
        status: "failed",
        skipReason: reason,
        reasonDetail: detail.slice(0, EVIDENCE_BODY_CHARS),
        objectCount: 0,
        httpStatus: status,
        errorCode: body ? extractErrorCode(body) : err instanceof PsExecutionError ? err.kind : null,
        errorMessage: (body ?? (err instanceof Error ? err.message : String(err))).slice(0, EVIDENCE_BODY_CHARS),
        durationMs: Date.now() - t0,
      });
    }
  };

  // Bounded-concurrency worker pool. Each worker pulls the next index; a resource
  // never takes another one down, because runOne cannot throw.
  const worker = async () => {
    for (;;) {
      if (consent.revoked) return;
      const i = nextIndex++;
      if (i >= targets.length) return;
      await runOne(targets[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));

  // Consent died partway. Every resource never reached is still recorded — an
  // omitted resource and a resource we never got to are different facts.
  if (consent.revoked) {
    const recorded = new Set(outcomes.map((o) => o.resourceKey));
    for (const rt of targets) {
      if (recorded.has(rt.resourceKey)) continue;
      outcomes.push({
        resourceKey: rt.resourceKey,
        readTransport: rt.readTransport,
        status: "skipped",
        skipReason: "permission_denied",
        reasonDetail:
          "Admin consent for this tenant was revoked mid-run — the snapshot was stopped before this resource was attempted",
        objectCount: 0,
        pageCount: null,
        requestRef: null,
        httpStatus: null,
        errorCode: null,
        errorMessage: null,
        durationMs: 0,
      });
    }
  }

  // 5. Write the completeness rows — one per targeted resource, always ───────
  for (let i = 0; i < outcomes.length; i += INSERT_BATCH) {
    await db.insert(tenantConfigSnapshotResourceStatusTable).values(
      outcomes.slice(i, i + INSERT_BATCH).map((o) => ({
        snapshotRowId,
        resourceKey: o.resourceKey,
        readTransport: o.readTransport as never,
        status: o.status,
        skipReason: o.skipReason,
        reasonDetail: o.reasonDetail,
        objectCount: o.objectCount,
        pageCount: o.pageCount,
        requestRef: o.requestRef,
        httpStatus: o.httpStatus,
        errorCode: o.errorCode,
        errorMessage: o.errorMessage,
        durationMs: o.durationMs,
      })),
    );
  }

  // 6. Seal ──────────────────────────────────────────────────────────────────
  const count = (s: SnapshotResourceStatus) => outcomes.filter((o) => o.status === s).length;
  const collected = count("collected");
  const empty = count("empty");
  const partial = count("partial");
  const skipped = count("skipped");
  const failed = count("failed");
  const objectCount = outcomes.reduce((n, o) => n + o.objectCount, 0);
  const isComplete = partial === 0 && skipped === 0 && failed === 0;
  const revoked = consent.revoked;
  const finalStatus: "sealed" | "failed" = revoked ? "failed" : "sealed";
  const errorText = revoked ? `Admin consent revoked mid-run: ${revoked.message}` : null;
  const now = new Date();

  await db
    .update(tenantConfigSnapshotsTable)
    .set({
      status: finalStatus,
      sealedAt: now,
      finishedAt: now,
      resourceTypesCollected: collected,
      resourceTypesEmpty: empty,
      resourceTypesPartial: partial,
      resourceTypesSkipped: skipped,
      resourceTypesFailed: failed,
      objectCount,
      isComplete,
      error: errorText,
    })
    .where(eq(tenantConfigSnapshotsTable.id, snapshotRowId));

  const durationMs = Date.now() - startedAt;
  log.info(
    {
      snapshotRowId,
      snapshotId: header.snapshotId,
      tenantId: tenant.id,
      status: finalStatus,
      isComplete,
      targeted: targets.length,
      collected,
      empty,
      partial,
      skipped,
      failed,
      objectCount,
      durationMs,
    },
    "config-snapshot-collector: sealed snapshot",
  );

  return {
    snapshotRowId,
    snapshotId: header.snapshotId,
    tenantId: tenant.id,
    entraTenantId,
    status: finalStatus,
    isComplete,
    resourceTypesTargeted: targets.length,
    resourceTypesCollected: collected,
    resourceTypesEmpty: empty,
    resourceTypesPartial: partial,
    resourceTypesSkipped: skipped,
    resourceTypesFailed: failed,
    objectCount,
    durationMs,
    error: errorText,
    outcomes,
  };
}

/**
 * Mark long-dead `running` snapshots `abandoned`.
 *
 * A run whose process died never seals itself, and #1795 made `abandoned` a real
 * state precisely so a gap in snapshot history has a stated cause rather than
 * looking like a period nobody collected. Only a later sweep can set it — the dead
 * run cannot.
 */
export async function sweepAbandonedSnapshots(olderThanMs = 6 * 60 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const now = new Date();
  const rows = await db
    .update(tenantConfigSnapshotsTable)
    .set({
      status: "abandoned",
      sealedAt: now,
      finishedAt: now,
      error: `No completion recorded; marked abandoned by the sweep after ${olderThanMs}ms`,
    })
    .where(
      and(
        eq(tenantConfigSnapshotsTable.status, "running"),
        sql`${tenantConfigSnapshotsTable.startedAt} < ${cutoff}`,
      ),
    )
    .returning({ id: tenantConfigSnapshotsTable.id });
  if (rows.length > 0) {
    log.warn({ count: rows.length, olderThanMs }, "config-snapshot-collector: swept abandoned snapshots");
  }
  return rows.length;
}
