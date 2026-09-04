# PowerShell app-only capability survey

**Generated from the database, not written by hand.** Every row below is one live execution against a real tenant through the `ps-execution` container. Regenerate with `pnpm --filter @workspace/scripts run ps-capability-survey-doc` after any re-run; the source of truth is `ps_capability_survey_results`, and this file is a rendering of it (Git #1793).

## Run provenance

| | |
|---|---|
| Survey run | `#4` (`ps_capability_survey_runs.id`) |
| Tenant | `tenants.id = 1` — `mccawsoft2.onmicrosoft.com` |
| Container revision | `ca-ps-execution-dev--survey1793d` |
| Container image | `acrsmccaw2184.azurecr.io/ps-execution:dev` |
| Started | 2026-08-30T06:17:43.578Z |
| Completed | 2026-08-30T06:27:42.692Z |
| Run status | `completed` |

The surveyed tenant is Shane's real production Microsoft 365 tenant with write-back consent armed. The survey therefore executes **`Get-*` only**, never passes a caller-supplied parameter to a probed cmdlet, and records **property names only — never property values**. What it stores is a schema of the execution surface, not an extract of tenant data.

## Totals by session type

| Session | Commands enumerated | `ok` | `access_denied` | `cmdlet_unavailable` | `not_supported_app_only` | `error` | `not_attempted` |
|---|---:|---:|---:|---:|---:|---:|---:|
| `compliance` | 126 | 55 | 0 | 0 | 0 | 17 | 54 |
| `exchange` | 365 | 139 | 0 | 3 | 2 | 42 | 179 |
| `teams` | 675 | 143 | 5 | 0 | 0 | 14 | 513 |
| **all** | **1166** | **337** | **5** | **3** | **2** | **73** | **746** |

Outcome vocabulary, as recorded:

| Status | Means |
|---|---|
| `ok` | Executed successfully under app-only certificate auth. Its real output shape was captured. |
| `access_denied` | Ran, and the service refused it — a permission/RBAC gap, not an auth failure. |
| `cmdlet_unavailable` | A real `CommandNotFoundException`: never registered into this tenant's session at all (licensing **or** role-provisioning gap — the container cannot tell those apart, see #250). |
| `not_supported_app_only` | The service explicitly rejected the application context / certificate auth for this cmdlet. |
| `throttled` | Rejected by Microsoft's own throttling or cmdlet-budget limits. |
| `error` | Threw for some other reason. The verbatim message is in the table. |
| `auth_failed` | The session itself could not be established, so nothing under it was measured. |
| `not_attempted` | Deliberately never executed. The exact gate that rejected it is recorded per row. |
| `timeout` | Ran, but did not return within the container's per-cmdlet wall-clock guard (`PS_EXECUTION_CMDLET_TIMEOUT_SECONDS`, Git #1852) and was abandoned. Introduced after run `#4` above — `Get-ScopeEntities` (see the deny-list entry in `survey.ps1`) is the cmdlet that motivated it; it is still excluded from probing rather than exercised under the new guard, since no run has re-verified it live yet. |

## Cmdlets that work app-only (`ok`)

`Items` is the count returned by this one probe against this one tenant — a property of the tenant, not of the cmdlet, and it is **not** evidence that a cmdlet returning 0 is broken. `Output properties` is the real shape, and is the column #1795's resource model reads.

### `compliance` — 55 working

| Cmdlet | Items | ms | Invoked with | Output type | Output properties |
|---|---:|---:|---|---|---|
| `Get-ActivityAlert` | 0 | 4514 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-AdaptiveScope` | 0 | 4912 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-AdminAuditLogConfig` | 1 | 2484 | (no parameters) | System.Management.Automation.PSObject | AdminAuditLogEnabled, LogLevel, TestCmdletLoggingEnabled, AdminAuditLogCmdlets, AdminAuditLogParameters, AdminAuditLogExcludedCmdlets, AdminAuditLogAgeLimit, LoadBalancerCount, RefreshInterval, PartitionInfo, AdminAuditLogMailbox, UnifiedAuditLogIngestionEnabled, UnifiedAuditLogFirstOptInDate, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-AppRetentionCompliancePolicy` | 0 | 3992 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-AppRetentionComplianceRule` | 0 | 1822 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-ClassificationGradingPolicy` | 0 | 4173 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-ComplianceBoundary` | 0 | 2074 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-ComplianceRetentionEvent` | 0 | 3976 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-ComplianceRetentionEventType` | 3 | 3220 | (no parameters) | System.Management.Automation.PSObject | ComplianceTags, ReadOnly, ExternalIdentity, ImmutableId, Priority, Workload, Policy, Comment, Disabled, Mode, ObjectVersion, CreatedBy, LastModifiedBy, Guid, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, OriginatingServer, ObjectState |
| `Get-ComplianceTag` | 0 | 3627 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-ConnectionInformation` | 1 | 184 | (no parameters) | Microsoft.Exchange.Management.ExoPowershellSnapin.ConnectionInformation | ConnectionId, State, Id, Name, UserPrincipalName, ConnectionUri, AzureAdAuthorizationEndpointUri, TokenExpiryTimeUTC, CertificateAuthentication, ModuleName, ModulePrefix, Organization, DelegatedOrganization, AppId, PageSize, TenantID, TokenStatus, ConnectionUsedForInbuiltCmdlets, IsEopSession |
| `Get-DeviceComplianceDetailsReportFilter` | 2 | 2438 | (no parameters) | System.Management.Automation.PSObject | Platform |
| `Get-DeviceCompliancePolicyInventory` | 1 | 2761 | (no parameters) | System.Management.Automation.PSObject | PolicyId, PolicyName, EndDate |
| `Get-DeviceComplianceReportDate` | 1 | 503 | (no parameters) | System.Management.Automation.PSObject | StartDate, EndDate |
| `Get-DeviceComplianceUserInventory` | 100 | 2218 | (no parameters) | System.Management.Automation.PSObject | DeviceUserName, EndDate |
| `Get-DeviceConditionalAccessPolicy` | 0 | 5173 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DeviceConditionalAccessRule` | 0 | 3496 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DeviceConfigurationPolicy` | 0 | 4497 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DeviceConfigurationRule` | 0 | 15730 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DevicePolicy` | 0 | 4740 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DeviceTenantPolicy` | 0 | 2305 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DeviceTenantRule` | 0 | 4412 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DlpCompliancePolicy` | 0 | 1552 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DlpComplianceRule` | 0 | 1757 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DlpEdmSchema` | 0 | 5087 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DlpKeywordDictionary` | 0 | 399 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DlpSensitiveInformationType` | 225 | 7584 | (no parameters) | System.Management.Automation.PSObject | Identity, Name, Description, Id, Clonable, RecommendedConfidence, RecommendedConfidenceLevel, HighConfidenceLevelEntityDetails, MediumConfidenceLevelEntityDetails, LowConfidenceLevelEntityDetails, PrimitiveElementDetails, Publisher, Type, Classifier, BaseId, BaseType, Guidance, IsOutOfBox, PrimitiveType, Fingerprints, DlpSensitiveInformationTypeRuleCollection, RulePackId, WhenChanged, MinEngineVersion, FormalName, State, Capability, LastModifiedTime, PerfEvaluationState, LocalizedName, AllLocalizedNames, AllLocalizedDescriptions, DefaultCulture, ThresholdConfig, IsExact, ObjectState, PhysicalInstanceID |
| `Get-DlpSensitiveInformationTypeConfig` | 0 | 1928 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DlpSensitiveInformationTypeRulePackage` | 1 | 6996 | (no parameters) | System.Management.Automation.PSObject | SerializedClassificationRuleCollection, RuleCollectionName, LocalizedName, Description, Publisher, Version, IsEncrypted, IsFingerprintRuleCollection, IsAIPoweredRuleCollection, IsExportable, rulePackSize, ClassificationRuleCollectionXml, CreationTimeUtc, ModificationTimeUtc, Identity, DistinguishedName, OrganizationId, Name, IsValid, WhenChanged, ObjectState |
| `Get-eDiscoveryCaseAdmin` | 0 | 4075 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-FilePlanPropertyAuthority` | 3 | 4677 | (no parameters) | System.Management.Automation.PSObject | UnrestrictedName, DisplayName, FilePlanPropertyType, ReadOnly, ExternalIdentity, ImmutableId, Priority, Workload, Policy, Comment, Disabled, Mode, ObjectVersion, CreatedBy, LastModifiedBy, Guid, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, OriginatingServer, ObjectState |
| `Get-FilePlanPropertyCategory` | 13 | 4946 | (no parameters) | System.Management.Automation.PSObject | UnrestrictedName, DisplayName, FilePlanPropertyType, ReadOnly, ExternalIdentity, ImmutableId, Priority, Workload, Policy, Comment, Disabled, Mode, ObjectVersion, CreatedBy, LastModifiedBy, Guid, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, OriginatingServer, ObjectState |
| `Get-FilePlanPropertyCitation` | 5 | 2160 | (no parameters) | System.Management.Automation.PSObject | CitationUrl, CitationJurisdiction, UnrestrictedName, DisplayName, FilePlanPropertyType, ReadOnly, ExternalIdentity, ImmutableId, Priority, Workload, Policy, Comment, Disabled, Mode, ObjectVersion, CreatedBy, LastModifiedBy, Guid, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, OriginatingServer, ObjectState |
| `Get-FilePlanPropertyDepartment` | 10 | 4022 | (no parameters) | System.Management.Automation.PSObject | UnrestrictedName, DisplayName, FilePlanPropertyType, ReadOnly, ExternalIdentity, ImmutableId, Priority, Workload, Policy, Comment, Disabled, Mode, ObjectVersion, CreatedBy, LastModifiedBy, Guid, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, OriginatingServer, ObjectState |
| `Get-FilePlanPropertyReferenceId` | 0 | 3588 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-FilePlanPropertyStructure` | 0 | 637 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-FilePlanPropertySubCategory` | 0 | 5011 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-GlobalList` | 0 | 3663 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-Group` | 5 | 1228 | -ResultSize 5 | System.Management.Automation.PSObject | AdministrativeUnits, DisplayName, GroupType, ManagedBy, SamAccountName, Sid, SidHistory, SimpleDisplayName, RecipientType, RecipientTypeDetails, WindowsEmailAddress, Notes, Members, Owners, PhoneticDisplayName, OrganizationalUnit, SeniorityIndex, IsHierarchicalGroup, IsDirSynced, CustomAttribute1, CustomAttribute2, CustomAttribute3, CustomAttribute4, CustomAttribute5, CustomAttribute6, CustomAttribute7, CustomAttribute8, CustomAttribute9, CustomAttribute10, CustomAttribute11, CustomAttribute12, CustomAttribute13, CustomAttribute14, CustomAttribute15, Description, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged… |
| `Get-JitConfiguration` | 0 | 3977 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-Label` | 0 | 2210 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-LabelPolicy` | 0 | 1842 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-LabelPolicyRule` | 0 | 4187 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-ManagementRole` | 122 | 3150 | (no parameters) | System.Management.Automation.PSObject | RoleEntries, RoleType, ImplicitRecipientReadScope, ImplicitRecipientWriteScope, ImplicitConfigReadScope, ImplicitConfigWriteScope, IsRootRole, IsEndUserRole, MailboxPlanIndex, Description, Parent, RoleState, IsDeprecated, IsServicePrincipalRole, AllowEmptyRole, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-OrganizationSegment` | 0 | 3626 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-PolicyConfig` | 1 | 1797 | (no parameters) | System.Management.Automation.PSObject | EndpointDlpGlobalSettingsPsws, DlpAppGroupsPsws, SiteGroupsPsws, DlpPrinterGroupsPsws, DlpRemovableMediaGroupsPsws, DlpNetworkShareGroupsPsws, DlpExtensionGroupsPsws, EnableSpoAipMigration, ReservedForFutureUse, PurviewLabelConsent, PurviewLabelConsentCaller, PurviewLabelConsentTime, ExtendTeamsDlpToSpoOdbConsent, ExtendTeamsDlpToSpoOdbConsentCaller, ExtendTeamsDlpToSpoOdbConsentTime, MaxClassificationCountLimit, LabelScheme, EndpointDlpGlobalSettings, ComplianceUrl, CustomClassificationMigrationStatus, OnPremisesWorkload, RuleErrorAction, ProcessingLimitExceededSeverity, DocumentIsUnsupportedSeverity, SenderAddressLocation, CaseHoldPolicyLimit, RetentionForwardCrawl, SensitiveInformationSc… |
| `Get-ProtectionAlert` | 47 | 2866 | (no parameters) | System.Management.Automation.PSObject | Filter, Operation, LogicalOperationName, NotificationEnabled, NotifyUser, Severity, Threshold, VolumeThreshold, ExternalScenarioData, TimeWindow, NotifyUserOnFilterMatch, MergedRuleXml, StreamType, ThreatType, PrivacyManagementScopedSensitiveInformationTypes, PrivacyManagementScopedSensitiveInformationTypesForCounting, PrivacyManagementScopedSensitiveInformationTypesThreshold, AlertBy, AlertFor, AlertScenario, Scenario, NotifyUserThrottleThreshold, NotifyUserThrottleWindow, NotifyUserSuppressionExpiryDate, NotificationCulture, AlertOverrideChangedUtc, AggregationType, Category, IsSystemRule, TagFilter, UserTags, RecipientTags, SenderTags, CustomProperties, UseCreatedDateTime, CorrelationPol… |
| `Get-QuarantineMessage` | 6 | 5255 | (no parameters) | System.Management.Automation.PSObject | Identity, ReceivedTime, Organization, MessageId, SenderAddress, RecipientAddress, Subject, Size, Type, PolicyType, PolicyName, TagName, PermissionToBlockSender, PermissionToDelete, PermissionToPreview, PermissionToRelease, PermissionToRequestRelease, PermissionToViewHeader, PermissionToDownload, PermissionToAllowSender, Released, ReleaseStatus, SystemReleased, RecipientCount, QuarantineTypes, Expires, RecipientTag, DeletedForRecipients, QuarantinedUser, ReleasedUser, Reported, Direction, CustomData, EntityType, SourceId, TeamsConversationType, ApprovalUPN, ApprovalId, MoveToQuarantineAdminActionTakenBy, MoveToQuarantineApprovalId, OverrideReasonIntValue, OverrideReason, ReleasedCount, Relea… |
| `Get-Recipient` | 5 | 2489 | -ResultSize 5 | System.Management.Automation.PSObject | Identity, Alias, ArchiveGuid, AuthenticationType, City, Notes, Company, CountryOrRegion, PostalCode, CustomAttribute1, CustomAttribute2, CustomAttribute3, CustomAttribute4, CustomAttribute5, CustomAttribute6, CustomAttribute7, CustomAttribute8, CustomAttribute9, CustomAttribute10, CustomAttribute11, CustomAttribute12, CustomAttribute13, CustomAttribute14, CustomAttribute15, ExtensionCustomAttribute1, ExtensionCustomAttribute2, ExtensionCustomAttribute3, ExtensionCustomAttribute4, ExtensionCustomAttribute5, Database, ArchiveDatabase, DatabaseName, Department, ExternalDirectoryObjectId, ManagedFolderMailboxPolicy, EmailAddresses, ExpansionServer, ExternalEmailAddress, DisplayName, FirstName, … |
| `Get-RetentionCompliancePolicy` | 0 | 3396 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-RetentionComplianceRule` | 0 | 4022 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-RoleGroup` | 5 | 3111 | -ResultSize 5 | System.Management.Automation.PSObject | ManagedBy, RoleAssignments, Roles, DisplayName, ExternalDirectoryObjectId, Members, SamAccountName, Description, RoleGroupType, LinkedGroup, Capabilities, LinkedPartnerGroupId, LinkedPartnerOrganizationId, WellKnownObject, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-ServiceDomainGroup` | 0 | 3209 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-TenantAllowBlockListSpoofItems` | 0 | 2078 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-User` | 5 | 1047 | -ResultSize 5 | System.Management.Automation.PSObject | IsSecurityPrincipal, DelayReleaseHoldApplied, SiloName, SamAccountName, Sid, SidHistory, UserPrincipalName, BulkMailEnabled, ResetPasswordOnNextLogon, CertificateSubject, RemotePowerShellEnabled, EXOModuleEnabled, WindowsLiveID, MicrosoftOnlineServicesID, NetID, IsCloudCacheProvisioningComplete, IsCloudCache, CloudCacheProvider, CloudCacheAccountType, CloudCacheScope, CloudCacheRemoteEmailAddress, CloudCacheUserName, IsCloudCacheBlocked, ConsumerNetID, UserAccountControl, OrganizationalUnit, IsLinked, LinkedMasterAccount, LegalAgeGroup, CreationType, RoamingOptIn, UserPersona, ExternalDirectoryObjectId, SKUAssigned, IsSoftDeletedByRemove, IsSoftDeletedByDisable, WhenSoftDeleted, DirectRepor… |

### `exchange` — 139 working

| Cmdlet | Items | ms | Invoked with | Output type | Output properties |
|---|---:|---:|---|---|---|
| `Get-AcceptedDomain` | 5 | 590 | -ResultSize 5 | System.Management.Automation.PSCustomObject | DomainName, CatchAllRecipientID, DomainType, MatchSubDomains, AddressBookEnabled, Default, EmailOnly, ExternallyManaged, RawAuthenticationType, AuthenticationType, LiveIdInstanceType, PendingRemoval, PendingCompletion, FederatedOrganizationLink, MailFlowPartner, OutboundOnly, PendingFederatedAccountNamespace, PendingFederatedDomain, IsCoexistenceDomain, PerimeterDuplicateDetected, IsDefaultFederatedDomain, EnableNego2Authentication, CanHaveCloudCache, SendingFromDomainDisabled, SendingToDomainDisabled, SmtpDaneStatus, MailFlowRegion, AzureProvisioningRegion, MoeraDnsProvisioningMode, InitialDomain, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity,… |
| `Get-ActiveSyncDevice` | 5 | 510 | -ResultSize 5 | System.Management.Automation.PSObject | DeviceActiveSyncVersion, FriendlyName, DeviceId, DeviceImei, DeviceMobileOperator, DeviceOS, DeviceOSLanguage, DeviceTelephoneNumber, DeviceType, DeviceUserAgent, DeviceModel, FirstSyncTime, UserDisplayName, DeviceAccessState, DeviceAccessStateReason, DeviceAccessControlRule, ClientType, IsManaged, IsCompliant, IsDisabled, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-ActiveSyncDeviceAccessRule` | 0 | 113 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-ActiveSyncDeviceClass` | 1 | 122 | (no parameters) | System.Management.Automation.PSObject | DeviceType, DeviceModel, LastUpdateTime, Name, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-ActiveSyncMailboxPolicy` | 1 | 126 | (no parameters) | System.Management.Automation.PSObject | AlphanumericDevicePasswordRequired, DevicePasswordEnabled, AllowSimpleDevicePassword, MinDevicePasswordLength, IsDefaultPolicy, MaxInactivityTimeDeviceLock, MaxDevicePasswordFailedAttempts, DevicePasswordExpiration, DevicePasswordHistory, MinDevicePasswordComplexCharacters, AllowNonProvisionableDevices, AttachmentsEnabled, DeviceEncryptionEnabled, RequireStorageCardEncryption, PasswordRecoveryEnabled, DevicePolicyRefreshInterval, MaxAttachmentSize, WSSAccessEnabled, UNCAccessEnabled, IsDefault, AllowApplePushNotifications, AllowStorageCard, AllowCamera, RequireDeviceEncryption, AllowUnsignedApplications, AllowUnsignedInstallationPackages, AllowWiFi, AllowTextMessaging, AllowPOPIMAPEmail, Al… |
| `Get-ActiveSyncOrganizationSettings` | 1 | 150 | (no parameters) | System.Management.Automation.PSObject | DefaultAccessLevel, TenantAdminPreference, UserMailInsert, AllowAccessForUnSupportedPlatform, EnableMobileMailboxPolicyWhenCAInplace, AllowRMSSupportForUnenlightenedApps, AdminMailRecipients, OtaNotificationMailInsert, DeviceFiltering, Name, IsIntuneManaged, HasAzurePremiumSubscription, OtherWellKnownObjects, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-AdaptiveScope` | 0 | 139 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-AddressBookPolicy` | 0 | 130 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-AdminAuditLogConfig` | 1 | 1558 | (no parameters) | System.Management.Automation.PSCustomObject | AdminAuditLogEnabled, LogLevel, TestCmdletLoggingEnabled, AdminAuditLogCmdlets, AdminAuditLogParameters, AdminAuditLogExcludedCmdlets, AdminAuditLogAgeLimit, LoadBalancerCount, RefreshInterval, PartitionInfo, AdminAuditLogMailbox, UnifiedAuditLogIngestionEnabled, UnifiedAuditLogFirstOptInDate, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-AntiPhishPolicy` | 2 | 106 | (no parameters) | System.Management.Automation.PSCustomObject | Enabled, ImpersonationProtectionState, EnableTargetedUserProtection, EnableMailboxIntelligenceProtection, EnableTargetedDomainsProtection, EnableOrganizationDomainsProtection, EnableMailboxIntelligence, EnableFirstContactSafetyTips, EnableSimilarUsersSafetyTips, EnableSimilarDomainsSafetyTips, EnableUnusualCharactersSafetyTips, TargetedUserProtectionAction, TargetedUserQuarantineTag, MailboxIntelligenceProtectionAction, MailboxIntelligenceQuarantineTag, TargetedDomainProtectionAction, TargetedDomainQuarantineTag, AuthenticationFailAction, SpoofQuarantineTag, EnableSpoofIntelligence, EnableViaTag, EnableUnauthenticatedSender, EnableSuspiciousSafetyTip, HonorDmarcPolicy, DmarcRejectAction, Dm… |
| `Get-AntiPhishRule` | 1 | 111 | (no parameters) | System.Management.Automation.PSCustomObject | AntiPhishPolicy, State, Priority, Comments, Description, RuleVersion, SentTo, SentToMemberOf, RecipientDomainIs, ExceptIfSentTo, ExceptIfSentToMemberOf, ExceptIfRecipientDomainIs, Conditions, Exceptions, Identity, DistinguishedName, Guid, ImmutableId, OrganizationId, Name, IsValid, WhenChanged |
| `Get-ArcConfig` | 0 | 114 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-ATPBuiltInProtectionRule` | 1 | 106 | (no parameters) | System.Management.Automation.PSObject | SafeAttachmentPolicy, SafeLinksPolicy, State, Priority, Comments, Description, RuleVersion, SentTo, SentToMemberOf, RecipientDomainIs, ExceptIfSentTo, ExceptIfSentToMemberOf, ExceptIfRecipientDomainIs, Conditions, Exceptions, Identity, DistinguishedName, Guid, ImmutableId, OrganizationId, Name, IsValid, WhenChanged, ObjectState |
| `Get-ATPEvaluationRule` | 0 | 112 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-AtpPolicyForO365` | 1 | 174 | (no parameters) | System.Management.Automation.PSCustomObject | AdminDisplayName, EnableATPForSPOTeamsODB, EnableSafeDocs, AllowSafeDocsOpen, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-ATPProtectionPolicyRule` | 0 | 105 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-AuthenticationPolicy` | 0 | 93 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-AuthServer` | 26 | 141 | (no parameters) | System.Management.Automation.PSObject | IssuerIdentifier, CertificateBytes, CertificateStrings, RsaKeyModulusExponents, CurrentEncryptedAppSecret, PreviousEncryptedAppSecret, TokenIssuingEndpoint, AuthorizationEndpoint, ApplicationIdentifier, AuthMetadataUrl, Realm, Type, Enabled, IsDefaultAuthorizationEndpoint, TimesOfUnmatchPartner, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-CASMailbox` | 5 | 221 | -ResultSize 5 | System.Management.Automation.PSCustomObject | ExternalDirectoryObjectId, EmailAddresses, LegacyExchangeDN, LinkedMasterAccount, PrimarySmtpAddress, SamAccountName, ServerLegacyDN, ServerName, DisplayName, ActiveSyncAllowedDeviceIDs, ActiveSyncBlockedDeviceIDs, ActiveSyncMailboxPolicy, ActiveSyncMailboxPolicyIsDefaulted, ActiveSyncDebugLogging, ActiveSyncEnabled, HasActiveSyncDevicePartnership, ActiveSyncSuppressReadReceipt, ExternalImapSettings, InternalImapSettings, ExternalPopSettings, InternalPopSettings, ExternalSmtpSettings, InternalSmtpSettings, OwaMailboxPolicy, OWAEnabled, OWAforDevicesEnabled, IsOptimizedForAccessibility, ECPEnabled, PopEnabled, PopMessageDeleteEnabled, PopUseProtocolDefaults, PopMessagesRetrievalMimeFormat, P… |
| `Get-CASMailboxPlan` | 4 | 145 | -ResultSize 5 | System.Management.Automation.PSObject | ActiveSyncMailboxPolicy, ActiveSyncEnabled, ActiveSyncSuppressReadReceipt, DisplayName, ECPEnabled, ImapEnabled, ImapUseProtocolDefaults, ImapMessagesRetrievalMimeFormat, ImapEnableExactRFC822Size, ImapProtocolLoggingEnabled, ImapSuppressReadReceipt, ImapForceICalForCalendarRetrievalOption, MAPIEnabled, MapiHttpEnabled, MAPIBlockOutlookNonCachedMode, MAPIBlockOutlookVersions, MAPIBlockOutlookRpcHttp, PublicFolderClientAccess, MAPIBlockOutlookExternalConnectivity, OwaMailboxPolicy, OWAEnabled, OWAforDevicesEnabled, PopEnabled, PopMessageDeleteEnabled, PopUseProtocolDefaults, PopMessagesRetrievalMimeFormat, PopEnableExactRFC822Size, PopProtocolLoggingEnabled, PopSuppressReadReceipt, PopForceI… |
| `Get-ClassificationRuleCollection` | 1 | 1848 | (no parameters) | System.Management.Automation.PSObject | SerializedClassificationRuleCollection, RuleCollectionName, LocalizedName, Description, Publisher, Version, IsEncrypted, IsFingerprintRuleCollection, IsAIPoweredRuleCollection, IsExportable, rulePackSize, ClassificationRuleCollectionXml, CreationTimeUtc, ModificationTimeUtc, Identity, DistinguishedName, OrganizationId, Name, IsValid, WhenChanged, ObjectState |
| `Get-ComplianceTag` | 0 | 267 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-ComplianceTagStorage` | 0 | 159 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-ConnectionInformation` | 1 | 195 | (no parameters) | Microsoft.Exchange.Management.ExoPowershellSnapin.ConnectionInformation | ConnectionId, State, Id, Name, UserPrincipalName, ConnectionUri, AzureAdAuthorizationEndpointUri, TokenExpiryTimeUTC, CertificateAuthentication, ModuleName, ModulePrefix, Organization, DelegatedOrganization, AppId, PageSize, TenantID, TokenStatus, ConnectionUsedForInbuiltCmdlets, IsEopSession |
| `Get-Contact` | 2 | 442 | -ResultSize 5 | System.Management.Automation.PSCustomObject | OrganizationalUnit, AdministrativeUnits, AssistantName, City, Company, CountryOrRegion, Department, DirectReports, DisplayName, Fax, FirstName, GeoCoordinates, HomePhone, Initials, IsDirSynced, LastName, Manager, MobilePhone, Notes, Office, OtherFax, OtherHomePhone, OtherTelephone, Pager, Phone, PhoneticDisplayName, PostalCode, PostOfficeBox, RecipientType, RecipientTypeDetails, SimpleDisplayName, StateOrProvince, StreetAddress, Title, UMDialPlan, UMDtmfMap, AllowUMCallsFromNonUsers, WebPage, TelephoneAssistant, WindowsEmailAddress, UMCallingLineIds, SeniorityIndex, VoiceMailSettings, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, Ob… |
| `Get-CustomDlpEmailTemplates` | 0 | 178 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DataClassification` | 225 | 3257 | (no parameters) | System.Management.Automation.PSCustomObject | Identity, Name, Description, Fingerprints, LocalizedName, Publisher, ClassificationType, IsEncrypted, RecommendedConfidence, RecommendedConfidenceLevel, ClassificationRuleCollection, MinEngineVersion, WhenChanged, DefaultCulture, AllLocalizedNames, AllLocalizedDescriptions |
| `Get-DataClassificationConfig` | 1 | 167 | (no parameters) | System.Management.Automation.PSObject | RegExGrammarLimit, DistinctRegExes, KeywordLength, NumberOfKeywords, DistinctFunctions, MaxAnyBlocks, MaxNestedAnyBlocks, RegExLength, MaxRulePackageSize, MaxFingerprintRulePackageSize, MaxRulePackages, MaxFingerprints, FingerprintThreshold, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-DeviceComplianceDetailsReportFilter` | 2 | 188 | (no parameters) | System.Management.Automation.PSObject | Platform |
| `Get-DeviceCompliancePolicyInventory` | 1 | 1326 | (no parameters) | System.Management.Automation.PSObject | PolicyId, PolicyName, EndDate |
| `Get-DeviceComplianceReportDate` | 1 | 385 | (no parameters) | System.Management.Automation.PSObject | StartDate, EndDate |
| `Get-DeviceComplianceUserInventory` | 100 | 119 | (no parameters) | System.Management.Automation.PSObject | DeviceUserName, EndDate |
| `Get-DeviceConditionalAccessPolicy` | 0 | 385 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DeviceConditionalAccessRule` | 0 | 1393 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DeviceConfigurationPolicy` | 0 | 162 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DeviceConfigurationRule` | 0 | 135 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DevicePolicy` | 0 | 136 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DeviceTenantPolicy` | 0 | 134 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DeviceTenantRule` | 0 | 160 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DistributionGroup` | 5 | 253 | -ResultSize 5 | System.Management.Automation.PSCustomObject | GroupType, SamAccountName, BypassNestedModerationEnabled, IsDirSynced, ManagedBy, MemberJoinRestriction, MemberDepartRestriction, MigrationToUnifiedGroupInProgress, HiddenGroupMembershipEnabled, ExpansionServer, AcceptMessagesOnlyFromWithDisplayNames, AcceptMessagesOnlyFromSendersOrMembersWithDisplayNames, ManagedByWithDisplayName, AcceptMessagesOnlyFromDLMembersWithDisplayNames, BypassModerationFromSendersOrMembersWithDisplayNames, GrantSendOnBehalfToWithDisplayNames, ModeratedByWithDisplayNames, RejectMessagesFromSendersOrMembersWithDisplayNames, ReportToManagerEnabled, ReportToOriginatorEnabled, SendOofMessageToOriginatorEnabled, Description, BccBlocked, AcceptMessagesOnlyFrom, AcceptMes… |
| `Get-DkimSigningConfig` | 9 | 139 | (no parameters) | System.Management.Automation.PSCustomObject | Domain, AdminDisplayName, Selector1KeySize, Selector1CNAME, Selector1PublicKey, Selector2KeySize, Selector2CNAME, Selector2PublicKey, Enabled, IsDefault, HeaderCanonicalization, BodyCanonicalization, Algorithm, NumberOfBytesToSign, IncludeSignatureCreationTime, IncludeKeyExpiration, KeyCreationTime, LastChecked, RotateOnDate, SelectorBeforeRotateOnDate, SelectorAfterRotateOnDate, Status, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-DlpPolicy` | 0 | 153 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DynamicDistributionGroup` | 0 | 105 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-ElevatedAccessAuthorization` | 0 | 1707 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-EligibleDistributionGroupForMigration` | 5 | 217 | -ResultSize 5 | System.Management.Automation.PSCustomObject | Id, ExternalDirectoryObjectId, RawManagedBy, DisplayName, PrimarySmtpAddress, LegacyExchangeDN, Members, WhenChanged, WhenCreated, Identity, IsValid, ObjectState |
| `Get-EmailTenantSettings` | 1 | 172 | (no parameters) | System.Management.Automation.PSObject | EnablePriorityAccountProtection, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-EOPProtectionPolicyRule` | 0 | 93 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-EtrLimits` | 1 | 192 | (no parameters) | System.Management.Automation.PSObject | MaximumNumberOfTransportRules, CurrentTransportRulesCount, MaximumSizeOfAnIndividualTransportRule, CurrentLargestTransportRule, CharacterLimitForAllRegExInTransportRules, CurrentRegExCharacterCountInAllTransportRules, CurrentTransportRuleWithLargestRegExCharacterCount, MaximumNumberOfAddedRecipientsByAllTransportRules, CurrentAddedRecipientCountByAllTransportRules, CurrentTransportRuleWithMaximumNumberOfAddedRecipients, Identity, IsValid, ObjectState |
| `Get-EvaluationModeReportSeries` | 0 | 357 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-EXOCasMailbox` | 5 | 547 | -ResultSize 5 | System.Management.Automation.PSCustomObject | ExternalDirectoryObjectId, Identity, PrimarySmtpAddress, DisplayName, Name, Guid, ServerLegacyDN, ExchangeVersion, ECPEnabled, EmailAddresses, OWAEnabled, OrganizationId, ImapEnabled, PopEnabled, MAPIEnabled, EwsEnabled, ActiveSyncEnabled |
| `Get-ExoInformationBarrierPolicy` | 0 | 243 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-ExoInformationBarrierSegment` | 0 | 94 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-EXOMailbox` | 5 | 455 | -ResultSize 5 | System.Management.Automation.PSCustomObject | ExternalDirectoryObjectId, UserPrincipalName, Alias, DisplayName, EmailAddresses, PrimarySmtpAddress, RecipientType, RecipientTypeDetails, Identity, Id, ExchangeVersion, Name, DistinguishedName, OrganizationId, Guid |
| `Get-EXORecipient` | 5 | 592 | -ResultSize 5 | System.Management.Automation.PSCustomObject | ExternalDirectoryObjectId, Identity, Alias, EmailAddresses, DisplayName, Name, PrimarySmtpAddress, RecipientType, RecipientTypeDetails, ExchangeVersion, DistinguishedName, OrganizationId |
| `Get-EXORecipientPermission` | 5 | 143 | -ResultSize 5 | System.Management.Automation.PSCustomObject | Identity, Trustee, AccessControlType, AccessRights, IsInherited, InheritanceType |
| `Get-FederatedOrganizationIdentifier` | 1 | 532 | (no parameters) | System.Management.Automation.PSObject | AccountNamespace, Domains, DefaultDomain, Enabled, OrganizationContact, DelegationTrustLink, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-FederationTrust` | 2 | 151 | (no parameters) | System.Management.Automation.PSObject | ApplicationIdentifier, ApplicationUri, OrgCertificate, OrgNextCertificate, OrgPrevCertificate, OrgPrivCertificate, OrgNextPrivCertificate, OrgPrevPrivCertificate, TokenIssuerCertificate, TokenIssuerPrevCertificate, PolicyReferenceUri, TokenIssuerMetadataEpr, MetadataPollInterval, TokenIssuerType, TokenIssuerUri, TokenIssuerEpr, WebRequestorRedirectEpr, MetadataEpr, MetadataPutEpr, TokenIssuerCertReference, TokenIssuerPrevCertReference, NamespaceProvisioner, TimesOfUnmatchPartner, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalU… |
| `Get-Group` | 5 | 188 | -ResultSize 5 | System.Management.Automation.PSCustomObject | AdministrativeUnits, DisplayName, GroupType, ManagedBy, SamAccountName, Sid, SidHistory, SimpleDisplayName, RecipientType, RecipientTypeDetails, WindowsEmailAddress, Notes, Members, Owners, PhoneticDisplayName, OrganizationalUnit, SeniorityIndex, IsHierarchicalGroup, IsDirSynced, CustomAttribute1, CustomAttribute2, CustomAttribute3, CustomAttribute4, CustomAttribute5, CustomAttribute6, CustomAttribute7, CustomAttribute8, CustomAttribute9, CustomAttribute10, CustomAttribute11, CustomAttribute12, CustomAttribute13, CustomAttribute14, CustomAttribute15, Description, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged… |
| `Get-HostedConnectionFilterPolicy` | 1 | 142 | (no parameters) | System.Management.Automation.PSCustomObject | AdminDisplayName, IsDefault, IPAllowList, IPBlockList, EnableSafeList, DirectoryBasedEdgeBlockMode, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-HostedContentFilterPolicy` | 2 | 117 | (no parameters) | System.Management.Automation.PSCustomObject | AdminDisplayName, AddXHeaderValue, BulkMovesEnabled, ModifySubjectValue, RedirectToRecipients, TestModeBccToRecipients, FalsePositiveAdditionalRecipients, QuarantineRetentionPeriod, TestModeAction, IncreaseScoreWithImageLinks, IncreaseScoreWithNumericIps, IncreaseScoreWithRedirectToOtherPort, IncreaseScoreWithBizOrInfoUrls, MarkAsSpamEmptyMessages, MarkAsSpamJavaScriptInHtml, MarkAsSpamFramesInHtml, MarkAsSpamObjectTagsInHtml, MarkAsSpamEmbedTagsInHtml, MarkAsSpamFormTagsInHtml, MarkAsSpamWebBugsInHtml, MarkAsSpamSensitiveWordList, MarkAsSpamSpfRecordHardFail, MarkAsSpamFromAddressAuthFail, MarkAsSpamBulkMail, MarkAsSpamNdrBackscatter, IsDefault, LanguageBlockList, RegionBlockList, HighConf… |
| `Get-HostedContentFilterRule` | 1 | 143 | (no parameters) | System.Management.Automation.PSCustomObject | HostedContentFilterPolicy, State, Priority, Comments, Description, RuleVersion, SentTo, SentToMemberOf, RecipientDomainIs, ExceptIfSentTo, ExceptIfSentToMemberOf, ExceptIfRecipientDomainIs, Conditions, Exceptions, Identity, DistinguishedName, Guid, ImmutableId, OrganizationId, Name, IsValid, WhenChanged |
| `Get-HostedOutboundSpamFilterPolicy` | 1 | 115 | (no parameters) | System.Management.Automation.PSCustomObject | AdminDisplayName, IsDefault, ConfigurationType, Enabled, RecipientLimitExternalPerHour, RecipientLimitInternalPerHour, RecipientLimitPerDay, ActionWhenThresholdReached, NotifyOutboundSpamRecipients, BccSuspiciousOutboundAdditionalRecipients, BccSuspiciousOutboundMail, NotifyOutboundSpam, RecommendedPolicyType, AutoForwardingMode, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-HostedOutboundSpamFilterRule` | 0 | 94 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-InboundConnector` | 1 | 213 | -ResultSize 5 | System.Management.Automation.PSCustomObject | Enabled, ConnectorType, ConnectorSource, Comment, SenderIPAddresses, SenderDomains, TrustedOrganizations, ClientHostNames, AssociatedAcceptedDomains, RequireTls, RestrictDomainsToIPAddresses, RestrictDomainsToCertificate, CloudServicesMailEnabled, TreatMessagesAsInternal, TlsSenderCertificateName, EFTestMode, ScanAndDropRecipients, EFSkipLastIP, EFSkipIPs, EFSkipMailGateway, EFUsers, NameHashGuid, OrganizationalUnitRootInternal, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer… |
| `Get-InboxRule` | 0 | 408 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-IntraOrganizationConfiguration` | 1 | 151 | (no parameters) | System.Management.Automation.PSCustomObject | OnPremiseDiscoveryEndpoint, OnPremiseWebServiceEndpoint, DeploymentIsCompleteIOCReady, HasNonIOCReadyExchangeCASServerVersions, HasNonIOCReadyExchangeMailboxServerVersions, OnlineDiscoveryEndpoint, OnlineTargetAddress, OnPremiseTargetAddresses, Identity, IsValid, ObjectState |
| `Get-IntraOrganizationConnector` | 0 | 134 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-IRMConfiguration` | 1 | 127 | (no parameters) | System.Management.Automation.PSObject | Name, ServiceLocation, PublishingLocation, LicensingLocation, InternalLicensingEnabled, ExternalLicensingEnabled, AzureRMSLicensingEnabled, AutomaticServiceUpdateEnabled, EnablePdfEncryption, SimplifiedClientAccessEncryptOnlyDisabled, SimplifiedClientAccessDoNotForwardDisabled, DecryptAttachmentForEncryptOnly, EnablePortalTrackingLogs, TransportDecryptionSetting, JournalReportDecryptionEnabled, SimplifiedClientAccessEnabled, ClientAccessServerEnabled, SearchEnabled, EDiscoverySuperUserEnabled, InternetConfidentialEnabled, DecryptAttachmentFromPortal, RMSOnlineKeySharingLocation, SystemCleanupPeriod, RejectIfRecipientHasNoRights, ServerCertificatesVersion, SharedServerBoxRacIdentity, RMSOnli… |
| `Get-JournalRule` | 0 | 95 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-LinkedUser` | 0 | 115 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-Mailbox` | 5 | 484 | -ResultSize 5 | System.Management.Automation.PSCustomObject | AcceptMessagesOnlyFromWithDisplayNames, AcceptMessagesOnlyFromSendersOrMembersWithDisplayNames, AcceptMessagesOnlyFromDLMembersWithDisplayNames, GrantSendOnBehalfToWithDisplayNames, ForwardingAddressWithDisplayNames, Database, DatabaseGuid, MailboxProvisioningConstraint, IsMonitoringMailbox, MailboxRegion, MailboxRegionLastUpdateTime, MailboxRegionSuffix, MessageRecallProcessingEnabled, UniqueUnrestrictedGroupsLimitEnabled, UniqueRecipientsCountLimitLevel, MessageCopyForSentAsEnabled, MessageCopyForSendOnBehalfEnabled, MailboxProvisioningPreferences, UseDatabaseRetentionDefaults, RetainDeletedItemsUntilBackup, DeliverToMailboxAndForward, IsExcludedFromServingHierarchy, IsHierarchyReady, IsH… |
| `Get-MailboxAuditBypassAssociation` | 5 | 123 | -ResultSize 5 | System.Management.Automation.PSObject | ObjectId, AuditBypassEnabled, Name, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-MailboxPlan` | 4 | 198 | -ResultSize 5 | System.Management.Automation.PSCustomObject | IsDefault, IsDefaultForPreviousVersion, MailboxPlanRelease, IsPilotMailboxPlan, MailboxPlanIndex, HiddenFromAddressListsEnabled, AcceptMessagesOnlyFromWithDisplayNames, AcceptMessagesOnlyFromSendersOrMembersWithDisplayNames, AcceptMessagesOnlyFromDLMembersWithDisplayNames, GrantSendOnBehalfToWithDisplayNames, ForwardingAddressWithDisplayNames, Database, DatabaseGuid, MailboxProvisioningConstraint, IsMonitoringMailbox, MailboxRegion, MailboxRegionLastUpdateTime, MailboxRegionSuffix, MessageRecallProcessingEnabled, UniqueUnrestrictedGroupsLimitEnabled, UniqueRecipientsCountLimitLevel, MessageCopyForSentAsEnabled, MessageCopyForSendOnBehalfEnabled, MailboxProvisioningPreferences, UseDatabaseRe… |
| `Get-MailContact` | 2 | 505 | -ResultSize 5 | System.Management.Automation.PSCustomObject | ExternalEmailAddress, MaxRecipientPerMessage, UseMapiRichTextFormat, UsePreferMessageFormat, MessageFormat, MessageBodyFormat, MacAttachmentFormat, UserCertificate, UserSMimeCertificate, HasPicture, HasSpokenName, IsDirSynced, AcceptMessagesOnlyFrom, AcceptMessagesOnlyFromDLMembers, AcceptMessagesOnlyFromSendersOrMembers, AddressListMembership, AdministrativeUnits, Alias, ArbitrationMailbox, BypassModerationFromSendersOrMembers, OrganizationalUnit, CustomAttribute1, CustomAttribute10, CustomAttribute11, CustomAttribute12, CustomAttribute13, CustomAttribute14, CustomAttribute15, CustomAttribute2, CustomAttribute3, CustomAttribute4, CustomAttribute5, CustomAttribute6, CustomAttribute7, Custom… |
| `Get-MailPublicFolder` | 0 | 605 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-MailUser` | 2 | 208 | -ResultSize 5 | System.Management.Automation.PSCustomObject | DeliverToMailboxAndForward, ExchangeGuid, MailboxContainerGuid, AggregatedMailboxGuids, ArchiveGuid, ArchiveName, ArchiveQuota, ArchiveWarningQuota, ProhibitSendQuota, ProhibitSendReceiveQuota, IssueWarningQuota, ForwardingAddress, ArchiveDatabase, ArchiveStatus, DisabledArchiveDatabase, DisabledArchiveGuid, MailboxProvisioningConstraint, IsMonitoringMailbox, MailboxRegion, MailboxRegionSuffix, MailboxRegionLastUpdateTime, MailboxProvisioningPreferences, ExchangeUserAccountControl, ExternalEmailAddress, UsePreferMessageFormat, JournalArchiveAddress, MessageFormat, MessageBodyFormat, MacAttachmentFormat, ProtocolSettings, RecipientLimits, SamAccountName, UseMapiRichTextFormat, UserPrincipalN… |
| `Get-MalwareFilterPolicy` | 2 | 105 | (no parameters) | System.Management.Automation.PSCustomObject | AdminDisplayName, CustomExternalBody, CustomExternalSubject, CustomInternalBody, CustomInternalSubject, CustomFromAddress, CustomFromName, CustomNotifications, EnableExternalSenderAdminNotifications, EnableFileFilter, EnableInternalSenderAdminNotifications, ExternalSenderAdminAddress, FileTypeAction, FileTypes, InternalSenderAdminAddress, IsDefault, IsPolicyOverrideApplied, QuarantineTag, RecommendedPolicyType, ZapEnabled, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-MalwareFilterRule` | 1 | 125 | (no parameters) | System.Management.Automation.PSCustomObject | MalwareFilterPolicy, State, Priority, Comments, Description, RuleVersion, SentTo, SentToMemberOf, RecipientDomainIs, ExceptIfSentTo, ExceptIfSentToMemberOf, ExceptIfRecipientDomainIs, Conditions, Exceptions, Identity, DistinguishedName, Guid, ImmutableId, OrganizationId, Name, IsValid, WhenChanged |
| `Get-ManagementRole` | 110 | 683 | (no parameters) | System.Management.Automation.PSCustomObject | RoleEntries, RoleType, ImplicitRecipientReadScope, ImplicitRecipientWriteScope, ImplicitConfigReadScope, ImplicitConfigWriteScope, IsRootRole, IsEndUserRole, MailboxPlanIndex, Description, Parent, RoleState, IsDeprecated, IsServicePrincipalRole, AllowEmptyRole, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-ManagementRoleAssignment` | 215 | 1277 | (no parameters) | System.Management.Automation.PSCustomObject | DataObject, User, App, AssignmentMethod, Identity, EffectiveUserName, AssignmentChain, RoleAssigneeType, RoleAssignee, Role, RoleAssignmentDelegationType, CustomRecipientWriteScope, CustomResourceScope, CustomConfigWriteScope, RecipientReadScope, ConfigReadScope, RecipientWriteScope, ConfigWriteScope, Enabled, RoleAssigneeName, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-ManagementScope` | 0 | 137 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-MeetingInsightsSettings` | 1 | 742 | (no parameters) | System.String | Length |
| `Get-MessageCategory` | 0 | 206 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-MigrationBatch` | 0 | 416 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-MigrationConfig` | 1 | 528 | (no parameters) | System.Management.Automation.PSObject | Identity, MaxNumberOfBatches, MaxConcurrentMigrations, Features, CanSubmitNewBatch, HasBatches, SupportsCutover, PartitionGuid, PartitionName, IsDefaultPartition, EndpointCount, SGMProperties, IsValid, ObjectState |
| `Get-MigrationEndpoint` | 0 | 329 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-MigrationStatistics` | 1 | 846 | (no parameters) | System.Management.Automation.PSObject | Identity, TotalCount, ActiveCount, StoppedCount, SyncedCount, FinalizedCount, FailedCount, PendingCount, ProvisionedCount, MigrationType, Diagnostics, DiagnosticInfo, IsValid, ObjectState |
| `Get-MigrationUser` | 0 | 242 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-MobileDevice` | 5 | 468 | -ResultSize 5 | System.Management.Automation.PSCustomObject | FriendlyName, DeviceId, DeviceImei, DeviceMobileOperator, DeviceOS, DeviceOSLanguage, DeviceTelephoneNumber, DeviceType, DeviceUserAgent, DeviceModel, FirstSyncTime, UserDisplayName, DeviceAccessState, DeviceAccessStateReason, DeviceAccessControlRule, ClientVersion, ClientType, IsManaged, IsCompliant, IsDisabled, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-MobileDeviceMailboxPolicy` | 1 | 116 | (no parameters) | System.Management.Automation.PSCustomObject | AllowNonProvisionableDevices, AlphanumericPasswordRequired, AttachmentsEnabled, DeviceEncryptionEnabled, RequireStorageCardEncryption, PasswordEnabled, PasswordRecoveryEnabled, DevicePolicyRefreshInterval, AllowSimplePassword, MaxAttachmentSize, WSSAccessEnabled, UNCAccessEnabled, MinPasswordLength, MaxInactivityTimeLock, MaxPasswordFailedAttempts, PasswordExpiration, PasswordHistory, IsDefault, AllowApplePushNotifications, AllowMicrosoftPushNotifications, AllowGooglePushNotifications, AllowStorageCard, AllowCamera, RequireDeviceEncryption, AllowUnsignedApplications, AllowUnsignedInstallationPackages, AllowWiFi, AllowTextMessaging, AllowPOPIMAPEmail, AllowIrDA, RequireManualSyncWhenRoaming,… |
| `Get-MoveRequest` | 0 | 104 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-OnPremisesOrganization` | 0 | 208 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-OrganizationalUnit` | 2 | 127 | -ResultSize 5 | System.Management.Automation.PSCustomObject | Type, CanonicalName, IsWellKnownContainer, DirSyncStatusAck, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-OrganizationConfig` | 1 | 417 | (no parameters) | System.Management.Automation.PSCustomObject | OrganizationId, Name, Identity, Guid, ObjectVersion, DelayedDelicensingEnabledState, TenantAdminNotificationForDelayedDelicensingState, EndUserMailNotificationForDelayedDelicensingState, DelayedDelicensingBlockedExplicitlyState, DefaultPublicFolderAgeLimit, DefaultPublicFolderIssueWarningQuota, DefaultPublicFolderProhibitPostQuota, DefaultPublicFolderMaxItemSize, DefaultPublicFolderDeletedItemRetention, DefaultPublicFolderMovedItemRetention, PublicFoldersLockedForMigration, PublicFolderMigrationComplete, PublicFolderMailboxesLockedForNewConnections, PublicFolderMailboxesMigrationComplete, PublicFolderShowClientControl, PublicFoldersEnabled, ActivityBasedAuthenticationTimeoutEnabled, Activit… |
| `Get-OrganizationRelationship` | 0 | 109 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-OutboundConnector` | 1 | 105 | -ResultSize 5 | System.Management.Automation.PSCustomObject | Enabled, UseMXRecord, Comment, ConnectorType, ConnectorSource, RecipientDomains, SmartHosts, TlsDomain, TlsSettings, IsTransportRuleScoped, RouteAllMessagesViaOnPremises, CloudServicesMailEnabled, AllAcceptedDomains, SenderRewritingEnabled, MtaStsMode, SmtpDaneMode, TestMode, LinkForModifiedConnector, ValidationRecipients, IsValidated, LastValidationTimestamp, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-OutlookProtectionRule` | 0 | 137 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-OwaMailboxPolicy` | 1 | 169 | (no parameters) | System.Management.Automation.PSCustomObject | WacEditingEnabled, PrintWithoutDownloadEnabled, OneDriveAttachmentsEnabled, ThirdPartyFileProvidersEnabled, AdditionalStorageProvidersAvailable, ClassicAttachmentsEnabled, ReferenceAttachmentsEnabled, SaveAttachmentsToCloudEnabled, InternalSPMySiteHostURL, ExternalSPMySiteHostURL, ExternalImageProxyEnabled, NpsSurveysEnabled, MessagePreviewsDisabled, PersonalAccountCalendarsEnabled, TeamsnapCalendarsEnabled, BookingsMailboxCreationEnabled, BookingsMailboxDomain, PersonalBookingsDisabled, ProjectMocaEnabled, DirectFileAccessOnPublicComputersEnabled, DirectFileAccessOnPrivateComputersEnabled, WebReadyDocumentViewingOnPublicComputersEnabled, WebReadyDocumentViewingOnPrivateComputersEnabled, Fo… |
| `Get-PartnerApplication` | 0 | 90 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-PendingDelicenseUser` | 0 | 174 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-PerimeterConfig` | 1 | 672 | (no parameters) | System.Management.Automation.PSObject | Name, PerimeterOrgId, SyncToHotmailEnabled, RouteOutboundViaEhfEnabled, IPSkiplistingEnabled, EhfConfigSyncEnabled, EhfAdminAccountSyncEnabled, IPSafelistingSyncEnabled, MigrationInProgress, RouteOutboundViaFfoFrontendEnabled, EheEnabled, RMSOFwdSyncEnabled, EheDecryptEnabled, MSIPCDisabled, GatewayIPAddresses, InternalServerIPAddresses, PartnerRoutingDomain, PartnerConnectorDomain, MailFlowPartner, SafelistingUIMode, BookingsNamingPolicyPrefix, BookingsNamingPolicySuffix, OtherWellKnownObjects, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, Organ… |
| `Get-PolicyConfig` | 1 | 458 | (no parameters) | System.Management.Automation.PSCustomObject | EndpointDlpGlobalSettingsPsws, DlpAppGroupsPsws, SiteGroupsPsws, DlpPrinterGroupsPsws, DlpRemovableMediaGroupsPsws, DlpNetworkShareGroupsPsws, DlpExtensionGroupsPsws, EnableSpoAipMigration, ReservedForFutureUse, PurviewLabelConsent, PurviewLabelConsentCaller, PurviewLabelConsentTime, ExtendTeamsDlpToSpoOdbConsent, ExtendTeamsDlpToSpoOdbConsentCaller, ExtendTeamsDlpToSpoOdbConsentTime, MaxClassificationCountLimit, LabelScheme, EndpointDlpGlobalSettings, ComplianceUrl, CustomClassificationMigrationStatus, OnPremisesWorkload, RuleErrorAction, ProcessingLimitExceededSeverity, DocumentIsUnsupportedSeverity, SenderAddressLocation, CaseHoldPolicyLimit, RetentionForwardCrawl, SensitiveInformationSc… |
| `Get-PolicyTipConfig` | 0 | 115 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-PublicFolderMailboxMigrationRequest` | 0 | 173 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-PublicFolderStatistics` | 2 | 1806 | -ResultSize 5 | System.Management.Automation.PSCustomObject | InternalSchema, AssociatedItemCount, ContactCount, CreationTime, DeletedItemCount, EntryId, FolderPath, ItemCount, LastModificationTime, Name, OwnerCount, TotalAssociatedItemSize, TotalDeletedItemSize, TotalItemSize, MailboxOwnerId, Identity, IsValid, ObjectState |
| `Get-QuarantineMessage` | 6 | 3050 | (no parameters) | System.Management.Automation.PSCustomObject | Identity, ReceivedTime, Organization, MessageId, SenderAddress, RecipientAddress, Subject, Size, Type, PolicyType, PolicyName, TagName, PermissionToBlockSender, PermissionToDelete, PermissionToPreview, PermissionToRelease, PermissionToRequestRelease, PermissionToViewHeader, PermissionToDownload, PermissionToAllowSender, Released, ReleaseStatus, SystemReleased, RecipientCount, QuarantineTypes, Expires, RecipientTag, DeletedForRecipients, QuarantinedUser, ReleasedUser, Reported, Direction, CustomData, EntityType, SourceId, TeamsConversationType, ApprovalUPN, ApprovalId, MoveToQuarantineAdminActionTakenBy, MoveToQuarantineApprovalId, OverrideReasonIntValue, OverrideReason, ReleasedCount, Relea… |
| `Get-QuarantinePolicy` | 4 | 163 | (no parameters) | System.Management.Automation.PSObject | EndUserQuarantinePermissions, ESNEnabled, QuarantinePolicyType, QuarantineRetentionDays, IncludeMessagesFromBlockedSenderAddress, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-Recipient` | 5 | 486 | -ResultSize 5 | System.Management.Automation.PSCustomObject | Identity, Alias, ArchiveGuid, AuthenticationType, City, Notes, Company, CountryOrRegion, PostalCode, CustomAttribute1, CustomAttribute2, CustomAttribute3, CustomAttribute4, CustomAttribute5, CustomAttribute6, CustomAttribute7, CustomAttribute8, CustomAttribute9, CustomAttribute10, CustomAttribute11, CustomAttribute12, CustomAttribute13, CustomAttribute14, CustomAttribute15, ExtensionCustomAttribute1, ExtensionCustomAttribute2, ExtensionCustomAttribute3, ExtensionCustomAttribute4, ExtensionCustomAttribute5, Database, ArchiveDatabase, DatabaseName, Department, ExternalDirectoryObjectId, ManagedFolderMailboxPolicy, EmailAddresses, ExpansionServer, ExternalEmailAddress, DisplayName, FirstName, … |
| `Get-RecipientPermission` | 5 | 116 | -ResultSize 5 | System.Management.Automation.PSObject | Identity, Trustee, AccessControlType, AccessRights, IsInherited, InheritanceType, TrusteeSidString, PrimarySmtpAddress, TrusteeWithPrimarySmtpAddress, IsValid, ObjectState |
| `Get-RemoteDomain` | 1 | 1174 | -ResultSize 5 | System.Management.Automation.PSObject | DomainName, IsInternal, TargetDeliveryDomain, ByteEncoderTypeFor7BitCharsets, CharacterSet, NonMimeCharacterSet, AllowedOOFType, AutoReplyEnabled, AutoForwardEnabled, DeliveryReportEnabled, NDREnabled, MeetingForwardNotificationEnabled, ContentType, DisplaySenderName, PreferredInternetCodePageForShiftJis, RequiredCharsetCoverage, TNEFEnabled, LineWrapSize, TrustedMailOutboundEnabled, TrustedMailInboundEnabled, UseSimpleDisplayName, NDRDiagnosticInfoEnabled, MessageCountThreshold, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalU… |
| `Get-ReportExecutionInstance` | 0 | 573 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-ReportScheduleList` | 0 | 34616 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-ReportSubmissionPolicy` | 1 | 116 | (no parameters) | System.Management.Automation.PSCustomObject | AdminDisplayName, ConfigurationType, DisableUserSubmissionOptions, OnlyShowPhishingDisclaimer, EnableReportToMicrosoft, EnableCustomizedMsg, ReportJunkToCustomizedAddress, ReportNotJunkToCustomizedAddress, ReportPhishToCustomizedAddress, EnableThirdPartyAddress, CustomizedReportRecipients, ReportJunkAddresses, ReportNotJunkAddresses, ReportPhishAddresses, ThirdPartyReportAddresses, CustomizedContents, PreSubmitMessage, PreSubmitMessageTitle, PostSubmitMessage, PostSubmitMessageTitle, PreSubmitMessageForJunk, PreSubmitMessageTitleForJunk, PostSubmitMessageForJunk, PostSubmitMessageTitleForJunk, PreSubmitMessageForPhishing, PreSubmitMessageTitleForPhishing, PostSubmitMessageForPhishing, PostS… |
| `Get-ReportSubmissionRule` | 0 | 96 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-RetentionPolicy` | 2 | 2017 | (no parameters) | System.Management.Automation.PSCustomObject | RetentionId, RetentionPolicyTagLinks, IsDefault, IsDefaultArbitrationMailbox, MinAdminVersion, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-RetentionPolicyTag` | 13 | 176 | (no parameters) | System.Management.Automation.PSCustomObject | MessageClassDisplayName, MessageClass, Description, RetentionEnabled, RetentionAction, AgeLimitForRetention, MoveToDestinationFolder, TriggerForRetention, MessageFormatForJournaling, JournalingEnabled, AddressForJournaling, LabelForJournaling, Type, IsDefaultAutoGroupPolicyTag, IsDefaultModeratedRecipientsPolicyTag, SystemTag, IsPrimary, LocalizedRetentionPolicyTagName, Comment, RetentionId, LocalizedComment, MustDisplayCommentEnabled, LegacyManagedFolder, RawRetentionId, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot,… |
| `Get-RMSTemplate` | 0 | 158 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-RoleAssignmentPolicy` | 1 | 172 | (no parameters) | System.Management.Automation.PSObject | IsDefault, Description, RoleAssignments, AssignedRoles, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-RoleGroup` | 5 | 472 | -ResultSize 5 | System.Management.Automation.PSCustomObject | ManagedBy, RoleAssignments, Roles, DisplayName, ExternalDirectoryObjectId, Members, SamAccountName, Description, RoleGroupType, LinkedGroup, Capabilities, LinkedPartnerGroupId, LinkedPartnerOrganizationId, WellKnownObject, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-SafeAttachmentPolicy` | 2 | 100 | (no parameters) | System.Management.Automation.PSCustomObject | Action, AdminDisplayName, Enable, EnableBlockingEncryptedAttachments, EnableOrganizationBranding, ExcludedTypesFromBlockingEncryptedAttachments, IsBuiltInProtection, IsDefault, QuarantineTag, QuarantineTagForBlockingEncryptedAttachments, RecommendedPolicyType, Redirect, RedirectAddress, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-SafeAttachmentRule` | 0 | 90 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-SafeLinksPolicy` | 2 | 131 | (no parameters) | System.Management.Automation.PSCustomObject | EnableSafeLinksForEmail, EnableSafeLinksForTeams, EnableSafeLinksForOffice, TrackClicks, AllowClickThrough, ScanUrls, EnableForInternalSenders, DeliverMessageAfterScan, DisableUrlRewrite, DoNotRewriteUrls, AdminDisplayName, CustomUrlList, CustomNotificationText, LocalizedUrlTextList, LocalizedNotificationTextList, EnableOrganizationBranding, RecommendedPolicyType, IsBuiltInProtection, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-SafeLinksRule` | 0 | 88 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-SCInsights` | 0 | 254 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-SharingPolicy` | 1 | 238 | (no parameters) | System.Management.Automation.PSObject | Domains, Enabled, Default, AdminDisplayName, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, Identity, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Id, Guid, OriginatingServer, IsValid, ObjectState |
| `Get-SpoofIntelligenceInsight` | 5 | 271 | (no parameters) | System.Management.Automation.PSObject | SpoofedUser, SendingInfrastructure, MessageCount, LastSeen, SpoofType, Action |
| `Get-SupervisoryReviewPolicyV2` | 0 | 142 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-SupervisoryReviewRule` | 0 | 176 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-SyncConfig` | 1 | 483 | (no parameters) | System.Management.Automation.PSObject | FederatedTenant, DisableWindowsLiveID, FederatedIdentitySourceADAttribute, WlidUseSMTPPrimary, PasswordFilePath, FederatedNamespace, ResetPasswordOnNextLogon, ProvisioningDomain, EnterpriseExchangeVersion, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-SyncRequest` | 0 | 1101 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-TeamsProtectionPolicy` | 1 | 138 | (no parameters) | System.Management.Automation.PSObject | AdminDisplayName, ZapEnabled, MalwareQuarantineTag, HighConfidencePhishQuarantineTag, Identity, Id, IsValid, ExchangeVersion, DirectoryObjectVersion, Name, DistinguishedName, ObjectCategory, ObjectClass, WhenChanged, WhenCreated, WhenChangedUTC, WhenCreatedUTC, ExchangeObjectId, OrganizationalUnitRoot, OrganizationId, Guid, OriginatingServer, ObjectState |
| `Get-TeamsProtectionPolicyRule` | 0 | 88 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-TenantAllowBlockListSpoofItems` | 0 | 92 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-TransportConfig` | 1 | 169 | (no parameters) | System.Management.Automation.PSCustomObject | Name, TLSReceiveDomainSecureList, TLSSendDomainSecureList, GenerateCopyOfDSNFor, InternalSMTPServers, JournalingReportNdrTo, OrganizationFederatedMailbox, MaxDumpsterSizePerDatabase, MaxDumpsterTime, VerifySecureSubmitEnabled, ClearCategories, AddressBookPolicyRoutingEnabled, ConvertDisclaimerWrapperToEml, PreserveReportBodypart, ConvertReportToMessage, DSNConversionMode, VoicemailJournalingEnabled, HeaderPromotionModeSetting, Xexch50Enabled, Rfc2231EncodingEnabled, OpenDomainRoutingEnabled, MaxReceiveSize, MaxRecipientEnvelopeLimit, MaxSendSize, ExternalDelayDsnEnabled, ExternalDsnDefaultLanguage, ExternalDsnLanguageDetectionEnabled, ExternalDsnMaxMessageAttachSize, ExternalDsnReportingAut… |
| `Get-TransportRule` | 5 | 266 | -ResultSize 5 | System.Management.Automation.PSCustomObject | Priority, DlpPolicy, DlpPolicyId, Comments, CreatedBy, LastModifiedBy, ManuallyModified, ActivationDate, ExpiryDate, Description, RuleVersion, Size, Conditions, Exceptions, Actions, State, Mode, IsRuleConfigurationSupported, RuleConfigurationUnsupportedReason, RuleErrorAction, SenderAddressLocation, RecipientAddressType, RuleSubType, RegexSize, UseLegacyRegex, From, FromMemberOf, FromScope, SentTo, SentToMemberOf, SentToScope, BetweenMemberOf1, BetweenMemberOf2, ManagerAddresses, ManagerForEvaluatedUser, SenderManagementRelationship, ADComparisonAttribute, ADComparisonOperator, SenderADAttributeContainsWords, SenderADAttributeMatchesPatterns, RecipientADAttributeContainsWords, RecipientADAt… |
| `Get-TransportRuleAction` | 29 | 108 | (no parameters) | System.Management.Automation.PSObject | ConnectorName, Name, Rank, LinkedDisplayText, Identity, IsValid, ObjectState |
| `Get-TransportRulePredicate` | 58 | 115 | (no parameters) | System.Management.Automation.PSObject | Addresses, RuleSubTypes, Name, Rank, LinkedDisplayText, Identity, IsValid, ObjectState |
| `Get-UnifiedGroup` | 5 | 1713 | -ResultSize 5 | System.Management.Automation.PSCustomObject | AccessType, AuditLogAgeLimit, AutoSubscribeNewMembers, AlwaysSubscribeMembersToCalendarEvents, CalendarMemberReadOnly, CalendarUrl, Database, ExchangeGuid, FileNotificationsSettings, GroupSKU, InboxUrl, IsExternalResourcesPublished, IsMailboxConfigured, Language, MailboxProvisioningConstraint, ManagedByDetails, Notes, PeopleUrl, PhotoUrl, ServerName, SharePointSiteUrl, SharePointDocumentsUrl, SharePointNotebookUrl, SubscriptionEnabled, WelcomeMessageEnabled, ConnectorsEnabled, IsMembershipDynamic, Classification, GroupPersonification, YammerEmailAddress, GroupMemberCount, MailboxRegion, GroupExternalMemberCount, AllowAddGuests, WhenSoftDeleted, HiddenFromExchangeClientsEnabled, ExpirationTi… |
| `Get-User` | 5 | 209 | -ResultSize 5 | System.Management.Automation.PSCustomObject | IsSecurityPrincipal, DelayReleaseHoldApplied, SiloName, SamAccountName, Sid, SidHistory, UserPrincipalName, BulkMailEnabled, ResetPasswordOnNextLogon, CertificateSubject, RemotePowerShellEnabled, EXOModuleEnabled, WindowsLiveID, MicrosoftOnlineServicesID, NetID, IsCloudCacheProvisioningComplete, IsCloudCache, CloudCacheProvider, CloudCacheAccountType, CloudCacheScope, CloudCacheRemoteEmailAddress, CloudCacheUserName, IsCloudCacheBlocked, ConsumerNetID, UserAccountControl, OrganizationalUnit, IsLinked, LinkedMasterAccount, LegalAgeGroup, CreationType, RoamingOptIn, UserType, UserPersona, ExternalDirectoryObjectId, SKUAssigned, IsSoftDeletedByRemove, IsSoftDeletedByDisable, WhenSoftDeleted, D… |

### `teams` — 143 working

| Cmdlet | Items | ms | Invoked with | Output type | Output properties |
|---|---:|---:|---|---|---|
| `Get-CsAgent` | 0 | 847 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsApplicationAccessPolicy` | 1 | 624 | (no parameters) | System.Management.Automation.PSObject | AppIds, Description, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsApplicationMeetingConfiguration` | 1 | 287 | (no parameters) | System.Management.Automation.PSObject | AllowRemoveParticipantAppIds, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsAutoAttendant` | 0 | 438 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsAutoAttendantSupportedLanguage` | 54 | 431 | (no parameters) | Microsoft.Rtc.Management.Hosted.OAA.Models.Language | Id, DisplayName, Voices, VoiceResponseSupported |
| `Get-CsAutoAttendantSupportedTimeZone` | 108 | 414 | (no parameters) | Microsoft.Rtc.Management.Hosted.OAA.Models.TimeZone | Id, DisplayName |
| `Get-CsAutoAttendantTenantInformation` | 1 | 441 | (no parameters) | Microsoft.Rtc.Management.Hosted.OAA.Models.TenantInformation | DefaultLanguageId, DefaultTimeZoneId, FlightedFeatures |
| `Get-CsAutoRecordingTemplate` | 0 | 393 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsBatchPolicyAssignmentOperation` | 0 | 408 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsCallingLineIdentity` | 1 | 265 | (no parameters) | System.Management.Automation.PSObject | Description, EnableUserOverride, ServiceNumber, CallingIDSubstitute, BlockIncomingPstnCallerID, ResourceAccount, CompanyName, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsCallQueue` | 0 | 614 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsComplianceRecordingForCallQueueTemplate` | 0 | 752 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsExternalAccessPolicy` | 4 | 480 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.ExternalAccessPolicy | Identity, AllowedExternalDomains, BlockedExternalDomains, Description, EnableFederationAccess, EnableXmppAccess, EnablePublicCloudAudioVideoAccess, EnableTeamsSmsAccess, EnableOutsideAccess, EnableAcsFederationAccess, EnableTeamsConsumerAccess, EnableTeamsConsumerInbound, RestrictTeamsConsumerAccessToExternalUserProfiles, FederatedBilateralChats, CommunicationWithExternalOrgs |
| `Get-CsGroupPolicyAssignment` | 0 | 220 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsInboundBlockedNumberPattern` | 0 | 985 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsInboundExemptNumberPattern` | 0 | 997 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsMainlineAttendantAppointmentBookingFlow` | 0 | 724 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsMainlineAttendantFlow` | 0 | 361 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsMainlineAttendantQuestionAnswerFlow` | 0 | 339 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsMainlineAttendantSupportedLanguages` | 63 | 398 | (no parameters) | Microsoft.Rtc.Management.Hosted.OAA.Models.MainlineAttendantLanguage | Id, DisplayName |
| `Get-CsMainlineAttendantSupportedVoices` | 9 | 400 | (no parameters) | Microsoft.Rtc.Management.Hosted.OAA.Models.MainlineAttendantVoice | Id, Name |
| `Get-CsMainlineAttendantTenantInformation` | 1 | 393 | (no parameters) | Microsoft.Rtc.Management.Hosted.OAA.Models.MainlineAttendantTenantInformation | DefaultLanguageId, DefaultVoiceId, DefaultTimeZoneId, SupportedLanguages, SupportedVoices |
| `Get-CsOnlineAudioConferencingRoutingPolicy` | 1 | 358 | (no parameters) | System.Management.Automation.PSObject | OnlinePstnUsages, Description, RouteType, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsOnlineAudioFile` | 1 | 458 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsOnlineDialinConferencingBridge` | 0 | 836 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsOnlineDialinConferencingLanguagesSupported` | 44 | 97 | (no parameters) | Microsoft.Teams.ConfigAPI.Cmdlets.Generated.Models.SupportedLanguage | Code, Name |
| `Get-CsOnlineDialinConferencingPolicy` | 3 | 341 | (no parameters) | System.Management.Automation.PSObject | AllowService, Description, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsOnlineDialinConferencingTenantConfiguration` | 1 | 890 | (no parameters) | System.Management.Automation.PSObject | Status, EnableCustomTrunking, ThirdPartyNumberStatus, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsOnlineDialInConferencingTenantSettings` | 1 | 410 | (no parameters) | System.Management.Automation.PSObject | AllowedDialOutExternalDomains, EnableEntryExitNotifications, EntryExitAnnouncementsType, EnableNameRecording, IncludeTollFreeNumberInMeetingInvites, MaskPstnNumbersType, PinLength, AllowPSTNOnlyMeetingsByDefault, AutomaticallySendEmailsToUsers, SendEmailFromOverride, SendEmailFromAddress, SendEmailFromDisplayName, AutomaticallyReplaceAcpProvider, UseUniqueConferenceIds, AutomaticallyMigrateUserMeetings, MigrateServiceNumbersOnCrossForestMove, EnableDialOutJoinConfirmation, AllowFederatedUsersToDialOutToSelf, AllowFederatedUsersToDialOutToThirdParty, DynamicCallerIdMode, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsOnlineDialInConferencingUser` | 0 | 252 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-CsOnlineDialOutPolicy` | 13 | 732 | (no parameters) | System.Management.Automation.PSObject | AllowPSTNConferencingDialOutType, AllowPSTNOutboundCallingType, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsOnlineLisCivicAddress` | 0 | 260 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-CsOnlineLisLocation` | 0 | 182 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-CsOnlineLisPort` | 0 | 178 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsOnlineLisSubnet` | 0 | 179 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsOnlineLisSwitch` | 0 | 175 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsOnlineLisWirelessAccessPoint` | 0 | 188 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsOnlinePSTNGateway` | 0 | 433 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsOnlinePstnUsage` | 1 | 268 | (no parameters) | System.Management.Automation.PSObject | Usage, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsOnlineSchedule` | 0 | 349 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsOnlineSipDomain` | 9 | 313 | (no parameters) | Microsoft.Teams.ConfigAPI.Cmdlets.Generated.Models.TenantVerifiedSipDomain | Name, Status |
| `Get-CsOnlineTelephoneNumberCountry` | 30 | 1923 | (no parameters) | Microsoft.Teams.ConfigAPI.Cmdlets.Generated.Models.SkypeTelephoneNumberMgmtCountry | Name, Value |
| `Get-CsOnlineUser` | 5 | 886 | -ResultSize 5 | System.Management.Automation.PSCustomObject | AccountEnabled, AccountType, AdministrativeUnitReference, Alias, ApplicationAccessPolicy, AssignedPlan, CallingLineIdentity, City, Company, Country, CountryAbbreviation, Department, DisplayName, EffectivePolicyAssignments, EnterpriseVoiceEnabled, ExternalAccessPolicy, FeatureTypes, GivenName, HideFromAddressLists, HostingProvider, Identity, InterpretedUserType, IsSipEnabled, LastName, LineUri, OnPremEnterpriseVoiceEnabled, OnPremHostingProvider, OnPremLineUri, OnPremOptionFlags, OnPremSIPEnabled, OnPremSipAddress, OnlineAudioConferencingRoutingPolicy, OnlineDialOutPolicy, OnlineVoiceRoutingPolicy, OnlineVoicemailPolicy, OwnerUrn, PostalCode, PreferredDataLocation, PreferredLanguage, Provisi… |
| `Get-CsOnlineVoicemailPolicy` | 4 | 485 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.OnlineVoicemailPolicy | Identity, Description, EnableTranscription, ShareData, EnableTranscriptionProfanityMasking, EnableEditingCallAnswerRulesSetting, MaximumRecordingLength, EnableTranscriptionTranslation, PrimarySystemPromptLanguage, SecondarySystemPromptLanguage, PreambleAudioFile, PostambleAudioFile, PreamblePostambleMandatory, EnableVoicemailTriage |
| `Get-CsOnlineVoicemailValidationConfiguration` | 1 | 273 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.OnlineVoicemailValidationConfiguration | Identity, AudioFileValidationEnabled, AudioFileValidationUri |
| `Get-CsOnlineVoiceRoute` | 1 | 334 | (no parameters) | System.Management.Automation.PSObject | Description, NumberPattern, OnlinePstnUsages, OnlinePstnGatewayList, BridgeSourcePhoneNumber, Name, Identity, Priority, ConfigMetadata |
| `Get-CsOnlineVoiceRoutingPolicy` | 1 | 225 | (no parameters) | System.Management.Automation.PSObject | OnlinePstnUsages, Description, RouteType, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsPhoneNumberAssignment` | 0 | 231 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsPhoneNumberPolicyAssignment` | 0 | 994 | -ResultSize 5 | — | — (returned no items, so no shape observed) |
| `Get-CsPhoneNumberTag` | 0 | 196 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsPhoneNumberTenantConfiguration` | 1 | 216 | (no parameters) | Microsoft.Teams.ConfigAPI.Cmdlets.Generated.Models.SkypeTelephoneNumberMgmtGetTenantConfigurationResponse | AllowOnPremToOnlineMigration, AssignmentBlockedDays, AssignmentBlockedForever, AssignmentEmailEnabled, TenantId, UnassignmentEmailEnabled |
| `Get-CsPrivacyConfiguration` | 1 | 1020 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.PrivacyConfiguration | Identity, EnablePrivacyMode, AutoInitiateContacts, PublishLocationDataDefault, DisplayPublishedPhotoDefault |
| `Get-CsSharedCallHistoryTemplate` | 0 | 857 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsSharedCallQueueHistoryTemplate` | 0 | 309 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsSharedVoicemailTriageSettingsTemplate` | 0 | 348 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsTagsTemplate` | 0 | 311 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsTeamsAcsFederationConfiguration` | 1 | 239 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsAcsFederationConfiguration | Identity, AllowedAcsResources, EnableAcsUsers, RequireAcsFederationForMeeting, LabelForAllowedAcsUsers, HideBannerForAllowedAcsUsers |
| `Get-CsTeamsAIPolicy` | 1 | 455 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsAIPolicy | Identity, Description, EnrollFace, EnrollVoice, SpeakerAttributionForBYOD, PassiveVoiceEnrollment |
| `Get-CsTeamsAppPermissionPolicy` | 1 | 326 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsAppPermissionPolicy | Identity, DefaultCatalogApps, GlobalCatalogApps, PrivateCatalogApps, Description, DefaultCatalogAppsType, GlobalCatalogAppsType, PrivateCatalogAppsType |
| `Get-CsTeamsAppSetupPolicy` | 2 | 355 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsAppSetupPolicy | Identity, AppPresetList, PinnedAppBarApps, PinnedMessageBarApps, AppPresetMeetingList, AdditionalCustomizationApps, PinnedCallingBarApps, Description, AllowSideLoading, AllowUserPinning |
| `Get-CsTeamsAudioConferencingPolicy` | 1 | 291 | (no parameters) | System.Management.Automation.PSObject | MeetingInvitePhoneNumbers, AllowTollFreeDialin, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsBYODAndDesksPolicy` | 1 | 414 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsBYODAndDesksPolicy | Identity, DeviceDataCollection |
| `Get-CsTeamsCallHoldPolicy` | 1 | 463 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsCallHoldPolicy | Identity, Description, AudioFileId, StreamingSourceUrl, StreamingSourceAuthType |
| `Get-CsTeamsCallingPolicy` | 5 | 401 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsCallingPolicy | Identity, Description, AllowPrivateCalling, AllowWebPSTNCalling, AllowSIPDevicesCalling, AllowVoicemail, AllowCallGroups, AllowDelegation, AllowCallForwardingToUser, AllowCallForwardingToPhone, PreventTollBypass, BusyOnBusyEnabledType, MusicOnHoldEnabledType, AllowCloudRecordingForCalls, ExplicitRecordingConsent, PreventComplianceRecording, EnableRecordingAndTranscriptionCustomMessage, RecordingAndTranscriptionCustomMessageIdentifier, AllowMeetingKnowledgeGeneration, AllowTranscriptionForCalling, RecordingAndTranscriptionAudioNotification, PopoutForIncomingPstnCalls, PopoutAppPathForIncomingPstnCalls, LiveCaptionsEnabledTypeForCalling, AutoAnswerEnabledType, SpamFilteringEnabledType, CallRe… |
| `Get-CsTeamsCallParkPolicy` | 1 | 304 | (no parameters) | System.Management.Automation.PSObject | Description, AllowCallPark, PickupRangeStart, PickupRangeEnd, ParkTimeoutSeconds, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsChannelsPolicy` | 3 | 460 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsChannelsPolicy | Identity, Description, AllowOrgWideTeamCreation, EnablePrivateTeamDiscovery, AllowPrivateChannelCreation, AllowSharedChannelCreation, AllowChannelSharingToExternalUser, AllowUserToParticipateInExternalSharedChannel, ThreadedChannelCreation, AllowCreateChannel, AllowCreateClassicChannel, AllowCreatePrivateChannel, AllowCreateSharedChannel, CreateSharedChannelsByDefault, AllowUsersFromOutsideTeam, AllowGuestsFromOutsideTeam, AllowUsersFromOutsideTeamInPrivateChannel, AllowGuestsFromOutsideTeamInPrivateChannel, AllowSharingWithTeamInOrg, AllowSharingPrivateChannelWithTeamInOrg |
| `Get-CsTeamsClientConfiguration` | 1 | 193 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsClientConfiguration | Identity, AllowEmailIntoChannel, RestrictedSenderList, AllowDropBox, AllowBox, AllowGoogleDrive, AllowShareFile, AllowEgnyte, AllowOrganizationTab, AllowSkypeBusinessInterop, ContentPin, AllowResourceAccountSendMessage, ResourceAccountContentAccess, AllowGuestUser, AllowScopedPeopleSearchandAccess, AllowRoleBasedChatPermissions, ExtendedWorkInfoInPeopleSearch, UseUnifiedDomain |
| `Get-CsTeamsComplianceRecordingApplication` | 0 | 324 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsTeamsComplianceRecordingPolicy` | 1 | 290 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsComplianceRecordingPolicy | Identity, ComplianceRecordingApplications, Enabled, WarnUserOnRemoval, DisableComplianceRecordingAudioNotificationForCalls, Description, RecordReroutedCalls, CustomPromptsEnabled, CustomPromptsPackageId, CustomBanner |
| `Get-CsTeamsCortanaPolicy` | 1 | 412 | (no parameters) | System.Management.Automation.PSObject | Description, CortanaVoiceInvocationMode, AllowCortanaVoiceInvocation, AllowCortanaAmbientListening, AllowCortanaInContextSuggestions, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsCustomBannerText` | 0 | 182 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsTeamsEducationAssignmentsAppPolicy` | 1 | 312 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsEducationAssignmentsAppPolicy | Identity, ParentDigestEnabledType, MakeCodeEnabledType, TurnItInEnabledType, TurnItInApiUrl, TurnItInApiKey |
| `Get-CsTeamsEducationConfiguration` | 1 | 234 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsEducationConfiguration | Identity, ParentGuardianPreferredContactMethod, EduGenerativeAIEnhancements, UpdateParentInformation |
| `Get-CsTeamsEmergencyCallingPolicy` | 1 | 205 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsEmergencyCallingPolicy | Identity, ExtendedNotifications, NotificationGroup, NotificationDialOutNumber, ExternalLocationLookupMode, NotificationMode, EnhancedEmergencyServiceDisclaimer, Description |
| `Get-CsTeamsEmergencyCallRoutingPolicy` | 1 | 236 | (no parameters) | System.Management.Automation.PSObject | EmergencyNumbers, AllowEnhancedEmergencyServices, Description, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsEnhancedEncryptionPolicy` | 3 | 385 | (no parameters) | System.Management.Automation.PSObject | CallingEndtoEndEncryptionEnabledType, MeetingEndToEndEncryption, Description, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsEventsPolicy` | 1 | 537 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsEventsPolicy | Identity, AllowWebinars, EventAccessType, AllowTownhalls, TownhallEventAttendeeAccess, ExternalPresenterJoinVerification, AllowEmailEditing, AllowedQuestionTypesInRegistrationForm, AllowEventIntegrations, AllowedWebinarTypesForRecordingPublish, AllowedTownhallTypesForRecordingPublish, RecordingForTownhall, RecordingForWebinar, TranscriptionForTownhall, TranscriptionForWebinar, TownhallChatExperience, BroadcastPremiumApps, UseMicrosoftECDN, ImmersiveEvents, TownhallMaxResolution, HighBitrateForTownhall, BackroomChat, Registration, AllowEngagementReport, InfoShownInReportMode, Description |
| `Get-CsTeamsExternalAccessConfiguration` | 1 | 163 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsExternalAccessConfiguration | Identity, BlockedUsers, BlockExternalUserAccess |
| `Get-CsTeamsFeedbackPolicy` | 4 | 305 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsFeedbackPolicy | Identity, UserInitiatedMode, ReceiveSurveysMode, AllowScreenshotCollection, AllowEmailCollection, AllowLogCollection, EnableFeatureSuggestions |
| `Get-CsTeamsFilesPolicy` | 1 | 295 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsFilesPolicy | Identity, NativeFileEntryPoints, SPChannelFilesTab, DefaultFileUploadAppId, FileSharingInChatswithExternalUsers |
| `Get-CsTeamsFirstPartyMeetingTemplateConfiguration` | 1 | 320 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsFirstPartyMeetingTemplateConfiguration | Identity, TeamsMeetingTemplates, Description |
| `Get-CsTeamsGuestCallingConfiguration` | 1 | 422 | (no parameters) | System.Management.Automation.PSObject | AllowPrivateCalling, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsGuestMeetingConfiguration` | 1 | 150 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsGuestMeetingConfiguration | Identity, AllowIPVideo, ScreenSharingMode, AllowMultipleScreenshare, AllowMeetNow, LiveCaptionsEnabledType, AllowTranscription, AllowParticipantGiveRequestControl, AllowExternalParticipantGiveRequestControl |
| `Get-CsTeamsGuestMessagingConfiguration` | 1 | 182 | (no parameters) | System.Management.Automation.PSObject | AllowUserEditMessage, AllowUserDeleteMessage, UsersCanDeleteBotMessages, AllowUserDeleteChat, AllowUserChat, AllowGiphy, GiphyRatingType, AllowMemes, AllowImmersiveReader, AllowStickers, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsIPPhonePolicy` | 1 | 325 | (no parameters) | System.Management.Automation.PSObject | Description, SignInMode, SearchOnCommonAreaPhoneMode, AllowHomeScreen, AllowBetterTogether, AllowHotDesking, HotDeskingIdleTimeoutInMinutes, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsMediaConnectivityPolicy` | 1 | 318 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsMediaConnectivityPolicy | Identity, DirectConnection |
| `Get-CsTeamsMediaLoggingPolicy` | 2 | 260 | (no parameters) | System.Management.Automation.PSObject | Description, AllowMediaLogging, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsMeetingBrandingPolicy` | 1 | 348 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsMeetingBrandingPolicy | Identity, NdiAssuranceSlateImages, MeetingBackgroundImages, MeetingBrandingThemes, DefaultTheme, EnableMeetingOptionsThemeOverride, EnableNdiAssuranceSlate, EnableMeetingBackgroundImages, RequireBackgroundEffect |
| `Get-CsTeamsMeetingBroadcastConfiguration` | 1 | 218 | (no parameters) | System.Management.Automation.PSObject | Identity, SchemaVersion, SupportURL, AllowSdnProviderForBroadcastMeeting, ConfigId, ConfigMetadata |
| `Get-CsTeamsMeetingBroadcastPolicy` | 2 | 223 | (no parameters) | System.Management.Automation.PSObject | Description, AllowBroadcastScheduling, AllowBroadcastTranscription, BroadcastAttendeeVisibilityMode, BroadcastRecordingMode, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsMeetingConfiguration` | 1 | 157 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsMeetingConfiguration | Identity, PublishedEntraAuthenticationContexts, LogoURL, LegalURL, HelpURL, CustomFooterText, DisableAnonymousJoin, DisableAppInteractionForAnonymousUsers, EnableQoS, EnableAttributedTranscripts, EnableGraphTranscriptAccess, ClientAudioPort, ClientAudioPortRange, ClientVideoPort, ClientVideoPortRange, ClientAppSharingPort, ClientAppSharingPortRange, ClientMediaPortRangeEnabled, LimitPresenterRolePermissions, FeedbackSurveyForAnonymousUsers, ReportMeeting |
| `Get-CsTeamsMeetingPolicy` | 7 | 477 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsMeetingPolicy | Identity, Description, AllowChannelMeetingScheduling, AllowMeetNow, AllowPrivateMeetNow, MeetingChatEnabledType, AllowExternalNonTrustedMeetingChat, CopyRestriction, LiveCaptionsEnabledType, DesignatedPresenterRoleMode, AllowIPAudio, AllowIPVideo, AllowEngagementReport, AllowTrackingInReport, IPAudioMode, IPVideoMode, AllowAnonymousUsersToDialOut, AllowAnonymousUsersToStartMeeting, AllowAnonymousUsersToJoinMeeting, ConditionalAccessAttendeeVerification, BlockedAnonymousJoinClientTypes, AllowedStreamingMediaInput, ExplicitRecordingConsent, PreventComplianceRecording, EnableRecordingAndTranscriptionCustomMessage, RecordingAndTranscriptionCustomMessageIdentifier, AllowLocalRecording, AutoRecor… |
| `Get-CsTeamsMeetingTemplateConfiguration` | 1 | 442 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsMeetingTemplateConfiguration | Identity, TeamsMeetingTemplates, Description |
| `Get-CsTeamsMeetingTemplatePermissionPolicy` | 2 | 366 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsMeetingTemplatePermissionPolicy | Identity, HiddenMeetingTemplates, Description, DefaultMeetingTemplateId |
| `Get-CsTeamsMessagingConfiguration` | 1 | 312 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsMessagingConfiguration | Identity, EnableVideoMessageCaptions, EnableInOrganizationChatControl, CustomEmojis, Storyline, Communities, MessagingNotes, FileTypeCheck, UrlReputationCheck, ContentBasedPhishingCheck, ReportIncorrectSecurityDetections |
| `Get-CsTeamsMessagingPolicy` | 4 | 358 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsMessagingPolicy | Identity, Description, AllowUrlPreviews, AllowOwnerDeleteMessage, AllowUserEditMessage, AllowUserDeleteMessage, UsersCanDeleteBotMessages, AllowUserDeleteChat, AllowUserChat, AllowRemoveUser, AllowGiphy, GiphyRatingType, AllowGiphyDisplay, AllowPasteInternetImage, AllowMemes, AllowImmersiveReader, AllowStickers, AllowUserTranslation, ReadReceiptsEnabledType, AllowPriorityMessages, AllowSmartReply, AllowSmartCompose, ChannelsInChatListEnabledType, AudioMessageEnabledType, ChatPermissionRole, AllowFullChatPermissionUserToDeleteAnyMessage, AllowFluidCollaborate, AllowVideoMessages, AllowCommunicationComplianceEndUserReporting, AllowChatWithGroup, AllowSecurityEndUserReporting, InOrganizationCh… |
| `Get-CsTeamsMigrationConfiguration` | 1 | 284 | (no parameters) | System.Management.Automation.PSObject | EnableLegacyClientInterop, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsMobilityPolicy` | 2 | 440 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsMobilityPolicy | Identity, Description, IPVideoMobileMode, IPAudioMobileMode, MobileDialerPreference, LinksInTeams |
| `Get-CsTeamsMultiTenantOrganizationConfiguration` | 1 | 271 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsMultiTenantOrganizationConfiguration | Identity, CopilotFromHomeTenant |
| `Get-CsTeamsNetworkRoamingPolicy` | 1 | 315 | (no parameters) | System.Management.Automation.PSObject | AllowIPVideo, MediaBitRateKb, Description, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsNotificationAndFeedsPolicy` | 2 | 298 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsNotificationAndFeedsPolicy | Identity, Description, SuggestedFeedsEnabledType, TrendingFeedsEnabledType |
| `Get-CsTeamsPersonalAttendantPolicy` | 1 | 165 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsPersonalAttendantPolicy | Identity, PersonalAttendant, CallScreening, CalendarBookings, InboundInternalCalls, InboundFederatedCalls, InboundPSTNCalls, AutomaticTranscription, AutomaticRecording |
| `Get-CsTeamsRecordingAndTranscriptionCustomMessage` | 0 | 182 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsTeamsRecordingRollOutPolicy` | 1 | 340 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsRecordingRollOutPolicy | Identity, MeetingRecordingOwnership |
| `Get-CsTeamsRemoteLogCollectionConfiguration` | 1 | 173 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsRemoteLogCollectionConfiguration | Identity, Devices |
| `Get-CsTeamsRemoteLogCollectionDevice` | 0 | 133 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsTeamsRoomVideoTeleConferencingPolicy` | 1 | 275 | (no parameters) | System.Management.Automation.PSObject | Description, Enabled, AreaCode, ReceiveExternalCalls, ReceiveInternalCalls, PlaceExternalCalls, PlaceInternalCalls, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsSharedCallingRoutingPolicy` | 1 | 165 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsSharedCallingRoutingPolicy | Identity, EmergencyNumbers, ResourceAccount, Description |
| `Get-CsTeamsShiftsAppPolicy` | 2 | 248 | (no parameters) | System.Management.Automation.PSObject | AllowTimeClockLocationDetection, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsShiftsConnection` | 1 | 61 | (no parameters) | Microsoft.Teams.ConfigAPI.Cmdlets.Generated.Models.ErrorResponseAutoGenerated2 | Code, Detail, InnerErrorCode, InnerErrorMessage, InnerErrorTarget, Message, Target |
| `Get-CsTeamsShiftsConnectionConnector` | 1 | 58 | (no parameters) | Microsoft.Teams.ConfigAPI.Cmdlets.Generated.Models.ErrorResponseAutoGenerated2 | Code, Detail, InnerErrorCode, InnerErrorMessage, InnerErrorTarget, Message, Target |
| `Get-CsTeamsShiftsConnectionInstance` | 1 | 60 | (no parameters) | Microsoft.Teams.ConfigAPI.Cmdlets.Generated.Models.ErrorResponseAutoGenerated2 | Code, Detail, InnerErrorCode, InnerErrorMessage, InnerErrorTarget, Message, Target |
| `Get-CsTeamsShiftsPolicy` | 2 | 346 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsShiftsPolicy | Identity, ShiftNoticeFrequency, ShiftNoticeMessageType, ShiftNoticeMessageCustom, AccessType, AccessGracePeriodMinutes, EnableScheduleOwnerPermissions |
| `Get-CsTeamsSipDevicesConfiguration` | 1 | 303 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsSipDevicesConfiguration | Identity, BulkSignIn |
| `Get-CsTeamsSurvivableBranchAppliance` | 1 | 347 | (no parameters) | System.Management.Automation.PSObject | Fqdn, Site, Description, Identity, ConfigMetadata |
| `Get-CsTeamsSurvivableBranchAppliancePolicy` | 1 | 267 | (no parameters) | System.Management.Automation.PSObject | BranchApplianceFqdns, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsTargetingPolicy` | 1 | 261 | (no parameters) | System.Management.Automation.PSObject | Description, ManageTagsPermissionMode, TeamOwnersEditWhoCanManageTagsMode, SuggestedPresetTags, CustomTagsMode, ShiftBackedTagsMode, AutomaticTagsMode, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsTemplatePermissionPolicy` | 1 | 294 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsTemplatePermissionPolicy | Identity, HiddenTemplates, Description |
| `Get-CsTeamsTranslationRule` | 0 | 343 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsTeamsUnassignedNumberTreatment` | 0 | 319 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsTeamsUpdateManagementPolicy` | 2 | 291 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsUpdateManagementPolicy | Identity, DisabledInProductMessages, Description, AllowManagedUpdates, AllowPreview, UpdateDayOfWeek, UpdateTime, UpdateTimeOfDay, AllowPublicPreview, UseNewTeamsClient, BlockLegacyAuthorization |
| `Get-CsTeamsUpgradeConfiguration` | 1 | 140 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsUpgradeConfiguration | Identity, DownloadTeams, SfBMeetingJoinUx, BlockLegacyAuthorization |
| `Get-CsTeamsUpgradePolicy` | 11 | 381 | (no parameters) | System.Management.Automation.PSObject | Description, Mode, NotifySfbUsers, Action, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsVdiPolicy` | 1 | 167 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsVdiPolicy | Identity, DisableCallsAndMeetings, DisableAudioVideoInCallsAndMeetings, VDI2Optimization |
| `Get-CsTeamsVideoInteropServicePolicy` | 6 | 316 | (no parameters) | System.Management.Automation.PSObject | Description, ProviderName, Enabled, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsVirtualAppointmentsPolicy` | 1 | 205 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsVirtualAppointmentsPolicy | Identity, EnableSmsNotifications |
| `Get-CsTeamsVoiceApplicationsPolicy` | 2 | 167 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsVoiceApplicationsPolicy | Identity, Description, AllowAutoAttendantBusinessHoursGreetingChange, AllowAutoAttendantAfterHoursGreetingChange, AllowAutoAttendantHolidayGreetingChange, AllowAutoAttendantBusinessHoursChange, AllowAutoAttendantTimeZoneChange, AllowAutoAttendantLanguageChange, AllowAutoAttendantHolidaysChange, AllowAutoAttendantBusinessHoursRoutingChange, AllowAutoAttendantAfterHoursRoutingChange, AllowAutoAttendantHolidayRoutingChange, AllowCallQueueWelcomeGreetingChange, AllowCallQueueMusicOnHoldChange, AllowCallQueueOverflowSharedVoicemailGreetingChange, AllowCallQueueTimeoutSharedVoicemailGreetingChange, AllowCallQueueOptOutChange, AllowCallQueueAgentOptChange, AllowCallQueueMembershipChange, AllowCall… |
| `Get-CsTeamsWorkLoadPolicy` | 1 | 230 | (no parameters) | System.Management.Automation.PSObject | Description, AllowMeeting, AllowMeetingPinned, AllowMessaging, AllowMessagingPinned, AllowCalling, AllowCallingPinned, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTeamsWorkLocationDetectionPolicy` | 1 | 570 | (no parameters) | Microsoft.Teams.Policy.Administration.Cmdlets.Core.TeamsWorkLocationDetectionPolicy | Identity, EnableWorkLocationDetection, UserSettingsDefault |
| `Get-CsTeamTemplateList` | 15 | 2175 | (no parameters) | Microsoft.Teams.ConfigAPI.Cmdlets.Generated.Models.TeamTemplateSummary | AppCount, Category, ChannelCount, Description, IconUri, Id, Locale, ModifiedBy, ModifiedOn, Name, OdataId, PublishedBy, Scope, ShortDescription, Visibility |
| `Get-CsTenantBlockedCallingNumbers` | 1 | 590 | (no parameters) | System.Management.Automation.PSObject | InboundBlockedNumberPatterns, InboundExemptNumberPatterns, Enabled, Name, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTenantDialPlan` | 1 | 161 | (no parameters) | System.Management.Automation.PSObject | Description, NormalizationRules, ExternalAccessPrefix, SimpleName, OptimizeDeviceDialing, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTenantFederationConfiguration` | 1 | 337 | (no parameters) | System.Management.Automation.PSObject | AllowedDomains, BlockedDomains, AllowedTrialTenantDomains, AllowFederatedUsers, AllowTeamsSms, AllowTeamsConsumer, AllowTeamsConsumerInbound, TreatDiscoveredPartnersAsUnverified, SharedSipAddressSpace, RestrictTeamsConsumerToExternalUserProfiles, BlockAllSubdomains, ExternalAccessWithTrialTenants, SecurityTeamAllowBlockListDelegation, EnableExternalAccessRestrictionsForChatParticipants, EnableMutualFederationForChatParticipants, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTenantLicensingConfiguration` | 1 | 276 | (no parameters) | System.Management.Automation.PSObject | Status, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTenantMigrationConfiguration` | 1 | 306 | (no parameters) | System.Management.Automation.PSObject | MeetingMigrationEnabled, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTenantNetworkConfiguration` | 1 | 284 | (no parameters) | System.Management.Automation.PSObject | NetworkRegions, NetworkSites, Subnets, PostalCodes, Key, Identity, ConfigMetadata, ConfigId |
| `Get-CsTenantNetworkRegion` | 0 | 327 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsTenantNetworkSite` | 0 | 572 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsTenantNetworkSubnet` | 0 | 270 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsTenantTrustedIPAddress` | 0 | 304 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-CsVideoInteropServiceProvider` | 0 | 271 | (no parameters) | — | — (returned no items, so no shape observed) |
| `Get-DirectToGroupAssignmentsMigrationStatus` | 1 | 119 | (no parameters) | System.String | Length |
| `Get-Team` | 18 | 965 | (no parameters) | Microsoft.Teams.PowerShell.TeamsCmdlets.Model.TeamSettings | GroupId, InternalId, DisplayName, Description, Visibility, MailNickName, Classification, Archived, AllowGiphy, GiphyContentRating, AllowStickersAndMemes, AllowCustomMemes, AllowGuestCreateUpdateChannels, AllowGuestDeleteChannels, AllowCreateUpdateChannels, AllowCreatePrivateChannels, AllowDeleteChannels, AllowAddRemoveApps, AllowCreateUpdateRemoveTabs, AllowCreateUpdateRemoveConnectors, AllowUserEditMessages, AllowUserDeleteMessages, AllowOwnerDeleteMessages, AllowTeamMentions, AllowChannelMentions, ShowInTeamsSearchAndSuggestions |

## DSC-derived shapes for shapeless cmdlets (Git #1853)

Of the 130 `ok` cmdlets above with no live-observed shape (the tenant genuinely has zero instances of that resource), Shane's recorded decision on #1853 was to derive a property set for as many as possible from Microsoft365DSC's own resource definitions — **matched, never guessed**: only an exact cmdlet-name match against a DSC resource's declared read cmdlets counts, never a similarly-named resource or a family resemblance. A DSC-derived shape is a DIFFERENT epistemic state from an observed one and is labelled `derived_from_dsc` everywhere it is stored — it is never written into `property_names` and never overrides a live observation.

**Real match rate — not 130 of 130.** 54 of 130 (41.5%) matched a Microsoft365DSC resource with a real, non-connection property set. 76 did not, and are recorded below with the exact reason rather than left silently unlabeled.

| Session | Shapeless | DSC-derived | No match |
|---|---:|---:|---:|
| `compliance` | 34 | 14 | 20 |
| `exchange` | 55 | 29 | 26 |
| `teams` | 41 | 11 | 30 |
| **all** | **130** | **54** | **76** |

### Cmdlets with a DSC-derived shape

| Session | Cmdlet | Source DSC resource(s) | Derived properties |
|---|---|---|---|
| `compliance` | `Get-ComplianceTag` | m365dsc:SCComplianceTag | Comment, EventType, FilePlanProperty, IsRecordLabel, Name, Notes, Regulatory, RetentionAction, RetentionDuration, RetentionType, ReviewerEmail |
| `compliance` | `Get-DeviceConditionalAccessPolicy` | m365dsc:SCDeviceConditionalAccessPolicy, m365dsc:SCDeviceConditionalAccessRule | AccountName, AccountUserName, AllowAppStore, AllowAssistantWhileLocked, AllowConvenienceLogon, AllowDiagnosticSubmission, AllowJailbroken, AllowPassbookWhileLocked, AllowScreenshot, AllowSimplePassword, AllowVideoConferencing, AllowVoiceAssistant, AllowVoiceDialing, AllowiCloudBackup, AllowiCloudDocSync, AllowiCloudPhotoSync, AntiVirusSignatureStatus, AntiVirusStatus, AppsRating, AutoUpdateStatus, BluetoothEnabled, CameraEnabled, Comment, EmailAddress, EnableRemovableStorage, Enabled, ExchangeActiveSyncHost, FirewallStatus, ForceAppStorePassword, ForceEncryptedBackup, MaxPasswordAttemptsBeforeWipe, MaxPasswordGracePeriod, MoviesRating, Name, PasswordComplexity, PasswordExpirationDays, Passw… |
| `compliance` | `Get-DeviceConditionalAccessRule` | m365dsc:SCDeviceConditionalAccessRule | AccountName, AccountUserName, AllowAppStore, AllowAssistantWhileLocked, AllowConvenienceLogon, AllowDiagnosticSubmission, AllowJailbroken, AllowPassbookWhileLocked, AllowScreenshot, AllowSimplePassword, AllowVideoConferencing, AllowVoiceAssistant, AllowVoiceDialing, AllowiCloudBackup, AllowiCloudDocSync, AllowiCloudPhotoSync, AntiVirusSignatureStatus, AntiVirusStatus, AppsRating, AutoUpdateStatus, BluetoothEnabled, CameraEnabled, EmailAddress, EnableRemovableStorage, ExchangeActiveSyncHost, FirewallStatus, ForceAppStorePassword, ForceEncryptedBackup, MaxPasswordAttemptsBeforeWipe, MaxPasswordGracePeriod, MoviesRating, Name, PasswordComplexity, PasswordExpirationDays, PasswordHistoryCount, P… |
| `compliance` | `Get-DeviceConfigurationPolicy` | m365dsc:SCDeviceConfigurationPolicy, m365dsc:SCDeviceConfigurationRule | AccountName, AccountUserName, AllowAppStore, AllowAssistantWhileLocked, AllowConvenienceLogon, AllowDiagnosticSubmission, AllowPassbookWhileLocked, AllowScreenshot, AllowSimplePassword, AllowVideoConferencing, AllowVoiceAssistant, AllowVoiceDialing, AllowiCloudBackup, AllowiCloudDocSync, AllowiCloudPhotoSync, AntiVirusSignatureStatus, AntiVirusStatus, AppsRating, AutoUpdateStatus, BluetoothEnabled, CameraEnabled, Comment, EmailAddress, EnableRemovableStorage, Enabled, ExchangeActiveSyncHost, FirewallStatus, ForceAppStorePassword, ForceEncryptedBackup, MaxPasswordAttemptsBeforeWipe, MaxPasswordGracePeriod, MoviesRating, Name, PasswordComplexity, PasswordExpirationDays, PasswordHistoryCount, … |
| `compliance` | `Get-DeviceConfigurationRule` | m365dsc:SCDeviceConfigurationRule | AccountName, AccountUserName, AllowAppStore, AllowAssistantWhileLocked, AllowConvenienceLogon, AllowDiagnosticSubmission, AllowPassbookWhileLocked, AllowScreenshot, AllowSimplePassword, AllowVideoConferencing, AllowVoiceAssistant, AllowVoiceDialing, AllowiCloudBackup, AllowiCloudDocSync, AllowiCloudPhotoSync, AntiVirusSignatureStatus, AntiVirusStatus, AppsRating, AutoUpdateStatus, BluetoothEnabled, CameraEnabled, EmailAddress, EnableRemovableStorage, ExchangeActiveSyncHost, FirewallStatus, ForceAppStorePassword, ForceEncryptedBackup, MaxPasswordAttemptsBeforeWipe, MaxPasswordGracePeriod, MoviesRating, Name, PasswordComplexity, PasswordExpirationDays, PasswordHistoryCount, PasswordMinComplex… |
| `compliance` | `Get-DlpCompliancePolicy` | m365dsc:SCDLPCompliancePolicy | Comment, EndpointDlpLocation, EndpointDlpLocationException, ExceptIfOneDriveSharedBy, ExceptIfOneDriveSharedByMemberOf, ExchangeLocation, ExchangeSenderMemberOf, ExchangeSenderMemberOfException, Mode, Name, OnPremisesScannerDlpLocation, OnPremisesScannerDlpLocationException, OneDriveLocation, OneDriveLocationException, OneDriveSharedBy, OneDriveSharedByMemberOf, PowerBIDlpLocation, PowerBIDlpLocationException, Priority, SharePointLocation, SharePointLocationException, TeamsLocation, TeamsLocationException, ThirdPartyAppDlpLocation, ThirdPartyAppDlpLocationException |
| `compliance` | `Get-DlpComplianceRule` | m365dsc:SCDLPComplianceRule | AccessScope, AdvancedRule, AnyOfRecipientAddressContainsWords, AnyOfRecipientAddressMatchesPatterns, BlockAccess, BlockAccessScope, Comment, ContentCharacterSetContainsWords, ContentContainsSensitiveInformation, ContentExtensionMatchesWords, ContentIsNotLabeled, ContentPropertyContainsWords, Disabled, DocumentContainsWords, DocumentIsPasswordProtected, DocumentIsUnsupported, DocumentNameMatchesPatterns, DocumentNameMatchesWords, EndpointDlpRestrictions, ExceptIfAnyOfRecipientAddressContainsWords, ExceptIfAnyOfRecipientAddressMatchesPatterns, ExceptIfContentCharacterSetContainsWords, ExceptIfContentContainsSensitiveInformation, ExceptIfContentExtensionMatchesWords, ExceptIfContentPropertyCon… |
| `compliance` | `Get-FilePlanPropertyReferenceId` | m365dsc:SCFilePlanPropertyReferenceId | Name |
| `compliance` | `Get-FilePlanPropertySubCategory` | m365dsc:SCFilePlanPropertySubCategory | Category, Name |
| `compliance` | `Get-Label` | m365dsc:SCLabelPolicy | AddExchangeLocation, AddExchangeLocationException, AddLabels, AddModernGroupLocation, AddModernGroupLocationException, AdvancedSettings, Comment, ExchangeLocation, ExchangeLocationException, Labels, ModernGroupLocation, ModernGroupLocationException, Name, RemoveExchangeLocation, RemoveExchangeLocationException, RemoveLabels, RemoveModernGroupLocation, RemoveModernGroupLocationException |
| `compliance` | `Get-LabelPolicy` | m365dsc:SCLabelPolicy | AddExchangeLocation, AddExchangeLocationException, AddLabels, AddModernGroupLocation, AddModernGroupLocationException, AdvancedSettings, Comment, ExchangeLocation, ExchangeLocationException, Labels, ModernGroupLocation, ModernGroupLocationException, Name, RemoveExchangeLocation, RemoveExchangeLocationException, RemoveLabels, RemoveModernGroupLocation, RemoveModernGroupLocationException |
| `compliance` | `Get-RetentionCompliancePolicy` | m365dsc:SCRetentionCompliancePolicy, m365dsc:SCRetentionComplianceRule | Comment, ContentMatchQuery, DynamicScopeLocation, Enabled, ExchangeLocation, ExchangeLocationException, ExcludedItemClasses, ExpirationDateOption, ModernGroupLocation, ModernGroupLocationException, Name, OneDriveLocation, OneDriveLocationException, Policy, PublicFolderLocation, RestrictiveRetention, RetentionComplianceAction, RetentionDuration, RetentionDurationDisplayHint, SharePointLocation, SharePointLocationException, SkypeLocation, SkypeLocationException, TeamsChannelLocation, TeamsChannelLocationException, TeamsChatLocation, TeamsChatLocationException |
| `compliance` | `Get-RetentionComplianceRule` | m365dsc:SCRetentionComplianceRule | Comment, ContentMatchQuery, ExcludedItemClasses, ExpirationDateOption, Name, Policy, RetentionComplianceAction, RetentionDuration, RetentionDurationDisplayHint |
| `compliance` | `Get-TenantAllowBlockListSpoofItems` | m365dsc:EXOTenantAllowBlockListSpoofItems | Action, Identity, SendingInfrastructure, SpoofType, SpoofedUser |
| `exchange` | `Get-ActiveSyncDeviceAccessRule` | m365dsc:EXOActiveSyncDeviceAccessRule | AccessLevel, Characteristic, Identity, QueryString |
| `exchange` | `Get-AddressBookPolicy` | m365dsc:EXOAddressBookPolicy | AddressLists, GlobalAddressList, Name, OfflineAddressBook, RoomList |
| `exchange` | `Get-ArcConfig` | m365dsc:EXOArcConfig | ArcTrustedSealers, IsSingleInstance |
| `exchange` | `Get-ATPProtectionPolicyRule` | m365dsc:ResourceName | Comments, Enabled, ExceptIfRecipientDomainIs, ExceptIfSentTo, ExceptIfSentToMemberOf, Identity, Name, Priority, RecipientDomainIs, SafeAttachmentPolicy, SafeLinksPolicy, SentTo, SentToMemberOf |
| `exchange` | `Get-AuthenticationPolicy` | m365dsc:EXOAuthenticationPolicy, m365dsc:EXOAuthenticationPolicyAssignment | AllowBasicAuthActiveSync, AllowBasicAuthAutodiscover, AllowBasicAuthImap, AllowBasicAuthMapi, AllowBasicAuthOfflineAddressBook, AllowBasicAuthOutlookService, AllowBasicAuthPop, AllowBasicAuthPowershell, AllowBasicAuthReportingWebServices, AllowBasicAuthRpc, AllowBasicAuthSmtp, AllowBasicAuthWebServices, AuthenticationPolicyName, Identity, UserName |
| `exchange` | `Get-ComplianceTag` | m365dsc:SCComplianceTag | Comment, EventType, FilePlanProperty, IsRecordLabel, Name, Notes, Regulatory, RetentionAction, RetentionDuration, RetentionType, ReviewerEmail |
| `exchange` | `Get-DeviceConditionalAccessPolicy` | m365dsc:SCDeviceConditionalAccessPolicy, m365dsc:SCDeviceConditionalAccessRule | AccountName, AccountUserName, AllowAppStore, AllowAssistantWhileLocked, AllowConvenienceLogon, AllowDiagnosticSubmission, AllowJailbroken, AllowPassbookWhileLocked, AllowScreenshot, AllowSimplePassword, AllowVideoConferencing, AllowVoiceAssistant, AllowVoiceDialing, AllowiCloudBackup, AllowiCloudDocSync, AllowiCloudPhotoSync, AntiVirusSignatureStatus, AntiVirusStatus, AppsRating, AutoUpdateStatus, BluetoothEnabled, CameraEnabled, Comment, EmailAddress, EnableRemovableStorage, Enabled, ExchangeActiveSyncHost, FirewallStatus, ForceAppStorePassword, ForceEncryptedBackup, MaxPasswordAttemptsBeforeWipe, MaxPasswordGracePeriod, MoviesRating, Name, PasswordComplexity, PasswordExpirationDays, Passw… |
| `exchange` | `Get-DeviceConditionalAccessRule` | m365dsc:SCDeviceConditionalAccessRule | AccountName, AccountUserName, AllowAppStore, AllowAssistantWhileLocked, AllowConvenienceLogon, AllowDiagnosticSubmission, AllowJailbroken, AllowPassbookWhileLocked, AllowScreenshot, AllowSimplePassword, AllowVideoConferencing, AllowVoiceAssistant, AllowVoiceDialing, AllowiCloudBackup, AllowiCloudDocSync, AllowiCloudPhotoSync, AntiVirusSignatureStatus, AntiVirusStatus, AppsRating, AutoUpdateStatus, BluetoothEnabled, CameraEnabled, EmailAddress, EnableRemovableStorage, ExchangeActiveSyncHost, FirewallStatus, ForceAppStorePassword, ForceEncryptedBackup, MaxPasswordAttemptsBeforeWipe, MaxPasswordGracePeriod, MoviesRating, Name, PasswordComplexity, PasswordExpirationDays, PasswordHistoryCount, P… |
| `exchange` | `Get-DeviceConfigurationPolicy` | m365dsc:SCDeviceConfigurationPolicy, m365dsc:SCDeviceConfigurationRule | AccountName, AccountUserName, AllowAppStore, AllowAssistantWhileLocked, AllowConvenienceLogon, AllowDiagnosticSubmission, AllowPassbookWhileLocked, AllowScreenshot, AllowSimplePassword, AllowVideoConferencing, AllowVoiceAssistant, AllowVoiceDialing, AllowiCloudBackup, AllowiCloudDocSync, AllowiCloudPhotoSync, AntiVirusSignatureStatus, AntiVirusStatus, AppsRating, AutoUpdateStatus, BluetoothEnabled, CameraEnabled, Comment, EmailAddress, EnableRemovableStorage, Enabled, ExchangeActiveSyncHost, FirewallStatus, ForceAppStorePassword, ForceEncryptedBackup, MaxPasswordAttemptsBeforeWipe, MaxPasswordGracePeriod, MoviesRating, Name, PasswordComplexity, PasswordExpirationDays, PasswordHistoryCount, … |
| `exchange` | `Get-DeviceConfigurationRule` | m365dsc:SCDeviceConfigurationRule | AccountName, AccountUserName, AllowAppStore, AllowAssistantWhileLocked, AllowConvenienceLogon, AllowDiagnosticSubmission, AllowPassbookWhileLocked, AllowScreenshot, AllowSimplePassword, AllowVideoConferencing, AllowVoiceAssistant, AllowVoiceDialing, AllowiCloudBackup, AllowiCloudDocSync, AllowiCloudPhotoSync, AntiVirusSignatureStatus, AntiVirusStatus, AppsRating, AutoUpdateStatus, BluetoothEnabled, CameraEnabled, EmailAddress, EnableRemovableStorage, ExchangeActiveSyncHost, FirewallStatus, ForceAppStorePassword, ForceEncryptedBackup, MaxPasswordAttemptsBeforeWipe, MaxPasswordGracePeriod, MoviesRating, Name, PasswordComplexity, PasswordExpirationDays, PasswordHistoryCount, PasswordMinComplex… |
| `exchange` | `Get-DynamicDistributionGroup` | m365dsc:EXODynamicDistributionGroup | AcceptMessagesOnlyFrom, AcceptMessagesOnlyFromDLMembers, Alias, BypassModerationFromSendersOrMembers, ConditionalCompany, ConditionalCustomAttribute1, ConditionalCustomAttribute10, ConditionalCustomAttribute11, ConditionalCustomAttribute12, ConditionalCustomAttribute13, ConditionalCustomAttribute14, ConditionalCustomAttribute15, ConditionalCustomAttribute2, ConditionalCustomAttribute3, ConditionalCustomAttribute4, ConditionalCustomAttribute5, ConditionalCustomAttribute6, ConditionalCustomAttribute7, ConditionalCustomAttribute8, ConditionalCustomAttribute9, ConditionalDepartment, ConditionalStateOrProvince, CustomAttribute1, CustomAttribute10, CustomAttribute11, CustomAttribute12, CustomAttr… |
| `exchange` | `Get-EOPProtectionPolicyRule` | m365dsc:EXOEOPProtectionPolicyRule | Comments, ExceptIfRecipientDomainIs, ExceptIfSentTo, ExceptIfSentToMemberOf, Identity, Name, Priority, RecipientDomainIs, SentTo, SentToMemberOf, State |
| `exchange` | `Get-HostedOutboundSpamFilterRule` | m365dsc:EXOHostedOutboundSpamFilterRule | Comments, Enabled, ExceptIfFrom, ExceptIfFromMemberOf, ExceptIfSenderDomainIs, From, FromMemberOf, HostedOutboundSpamFilterPolicy, Identity, Priority, SenderDomainIs |
| `exchange` | `Get-IntraOrganizationConnector` | m365dsc:EXOIntraOrganizationConnector | DiscoveryEndpoint, Enabled, Identity, TargetAddressDomains, TargetSharingEpr |
| `exchange` | `Get-JournalRule` | m365dsc:EXOJournalRule | Enabled, JournalEmailAddress, Name, Recipient, RuleScope |
| `exchange` | `Get-ManagementScope` | m365dsc:EXOManagementScope | Exclusive, Identity, Name, RecipientRestrictionFilter, RecipientRoot |
| `exchange` | `Get-MigrationBatch` | m365dsc:EXOMigration | AddUsers, BadItemLimit, CompleteAfter, Identity, LargeItemLimit, MigrationUsers, MoveOptions, NotificationEmails, SkipMerging, SourceEndpoint, StartAfter, Status, TargetDeliveryDomain, Update |
| `exchange` | `Get-MigrationEndpoint` | m365dsc:EXOMigrationEndpoint | AcceptUntrustedCertificates, AppID, AppSecretKeyVaultUrl, Authentication, EndpointType, ExchangeServer, Identity, MailboxPermission, MaxConcurrentIncrementalSyncs, MaxConcurrentMigrations, NspiServer, Port, RemoteServer, RemoteTenant, RpcProxyServer, Security, SourceMailboxLegacyDN, UseAutoDiscover |
| `exchange` | `Get-MigrationUser` | m365dsc:EXOMigration | AddUsers, BadItemLimit, CompleteAfter, Identity, LargeItemLimit, MigrationUsers, MoveOptions, NotificationEmails, SkipMerging, SourceEndpoint, StartAfter, Status, TargetDeliveryDomain, Update |
| `exchange` | `Get-OnPremisesOrganization` | m365dsc:EXOOnPremisesOrganization | Comment, HybridDomains, Identity, InboundConnector, OrganizationGuid, OrganizationName, OrganizationRelationship, OutboundConnector |
| `exchange` | `Get-OrganizationRelationship` | m365dsc:EXOOrganizationRelationship | ArchiveAccessEnabled, DeliveryReportEnabled, DomainNames, Enabled, FreeBusyAccessEnabled, FreeBusyAccessLevel, FreeBusyAccessScope, MailTipsAccessEnabled, MailTipsAccessLevel, MailTipsAccessScope, MailboxMoveCapability, MailboxMoveEnabled, MailboxMovePublishedScopes, Name, OauthApplicationId, OrganizationContact, PhotosEnabled, TargetApplicationUri, TargetAutodiscoverEpr, TargetOwaURL, TargetSharingEpr |
| `exchange` | `Get-PartnerApplication` | m365dsc:EXOPartnerApplication | AcceptSecurityIdentifierInformation, AccountType, ApplicationIdentifier, Enabled, LinkedAccount, Name |
| `exchange` | `Get-PolicyTipConfig` | m365dsc:EXOPolicyTipConfig | Name, Value |
| `exchange` | `Get-ReportSubmissionRule` | m365dsc:EXOReportSubmissionRule | Comments, Identity, IsSingleInstance, SentTo |
| `exchange` | `Get-SafeAttachmentRule` | m365dsc:EXOSafeAttachmentRule | Comments, Enabled, ExceptIfRecipientDomainIs, ExceptIfSentTo, ExceptIfSentToMemberOf, Identity, Priority, RecipientDomainIs, SafeAttachmentPolicy, SentTo, SentToMemberOf |
| `exchange` | `Get-SafeLinksRule` | m365dsc:EXOSafeLinksRule | Comments, Enabled, ExceptIfRecipientDomainIs, ExceptIfSentTo, ExceptIfSentToMemberOf, Identity, Priority, RecipientDomainIs, SafeLinksPolicy, SentTo, SentToMemberOf |
| `exchange` | `Get-SupervisoryReviewPolicyV2` | m365dsc:SCSupervisoryReviewPolicy, m365dsc:SCSupervisoryReviewRule | Comment, Condition, Name, Policy, Reviewers, SamplingRate |
| `exchange` | `Get-SupervisoryReviewRule` | m365dsc:SCSupervisoryReviewRule | Condition, Name, Policy, SamplingRate |
| `exchange` | `Get-TenantAllowBlockListSpoofItems` | m365dsc:EXOTenantAllowBlockListSpoofItems | Action, Identity, SendingInfrastructure, SpoofType, SpoofedUser |
| `teams` | `Get-CsCallQueue` | m365dsc:TeamsCallQueue | AgentAlertTime, AllowOptOut, AuthorizedUsers, AutoRecordingTemplateId, CallToAgentRatioThresholdBeforeOfferingCallback, CallbackEmailNotificationTarget, CallbackOfferAudioFilePromptResourceId, CallbackOfferTextToSpeechPrompt, CallbackRequestDtmf, ChannelId, ChannelUserObjectId, ComplianceRecordingForCallQueueTemplateId, ConferenceMode, CustomAudioFileAnnouncementForCR, CustomAudioFileAnnouncementForCRFailure, DistributionLists, EnableNoAgentSharedVoicemailSystemPromptSuppression, EnableNoAgentSharedVoicemailTranscription, EnableOverflowSharedVoicemailSystemPromptSuppression, EnableOverflowSharedVoicemailTranscription, EnableTimeoutSharedVoicemailSystemPromptSuppression, EnableTimeoutSharedV… |
| `teams` | `Get-CsGroupPolicyAssignment` | m365dsc:TeamsGroupPolicyAssignment | GroupDisplayName, GroupId, PolicyName, PolicyType, Priority |
| `teams` | `Get-CsOnlinePSTNGateway` | m365dsc:TeamsVoiceRoute | BridgeSourcePhoneNumber, Description, Identity, NumberPattern, OnlinePstnGatewayList, OnlinePstnUsages, Priority |
| `teams` | `Get-CsPhoneNumberAssignment` | m365dsc:TeamsOnlineVoiceUser | Identity, LocationID, TelephoneNumber |
| `teams` | `Get-CsTeamsComplianceRecordingApplication` | m365dsc:TeamsComplianceRecordingPolicy | ComplianceRecordingApplications, Description, DisableComplianceRecordingAudioNotificationForCalls, Enabled, Identity, RecordReroutedCalls, WarnUserOnRemoval |
| `teams` | `Get-CsTeamsTranslationRule` | m365dsc:TeamsTranslationRule | Description, Identity, Pattern, Translation |
| `teams` | `Get-CsTeamsUnassignedNumberTreatment` | m365dsc:TeamsUnassignedNumberTreatment | Description, Identity, Pattern, Target, TargetType, TreatmentPriority |
| `teams` | `Get-CsTenantNetworkRegion` | m365dsc:TeamsTenantNetworkRegion | CentralSite, Description, Identity |
| `teams` | `Get-CsTenantNetworkSite` | m365dsc:TeamsTenantNetworkSite | Description, EmergencyCallRoutingPolicy, EmergencyCallingPolicy, EnableLocationBasedRouting, Identity, LocationPolicy, NetworkRegionID, NetworkRoamingPolicy, SiteAddress |
| `teams` | `Get-CsTenantNetworkSubnet` | m365dsc:TeamsTenantNetworkSubnet | Description, Identity, MaskBits, NetworkSiteID |
| `teams` | `Get-CsTenantTrustedIPAddress` | m365dsc:TeamsTenantTrustedIPAddress | Description, Identity, MaskBits |

### Cmdlets with no DSC match — the honest gap

Every row here was checked against Microsoft365DSC's full read-cmdlet catalog and genuinely has no match. Not inferred, not left blank — recorded.

| Session | Cmdlet | Reason |
|---|---|---|
| `compliance` | `Get-ActivityAlert` | No Microsoft365DSC resource declares Get-ActivityAlert as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-AdaptiveScope` | No Microsoft365DSC resource declares Get-AdaptiveScope as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-AppRetentionCompliancePolicy` | No Microsoft365DSC resource declares Get-AppRetentionCompliancePolicy as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-AppRetentionComplianceRule` | No Microsoft365DSC resource declares Get-AppRetentionComplianceRule as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-ClassificationGradingPolicy` | No Microsoft365DSC resource declares Get-ClassificationGradingPolicy as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-ComplianceBoundary` | No Microsoft365DSC resource declares Get-ComplianceBoundary as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-ComplianceRetentionEvent` | No Microsoft365DSC resource declares Get-ComplianceRetentionEvent as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-DevicePolicy` | No Microsoft365DSC resource declares Get-DevicePolicy as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-DeviceTenantPolicy` | No Microsoft365DSC resource declares Get-DeviceTenantPolicy as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-DeviceTenantRule` | No Microsoft365DSC resource declares Get-DeviceTenantRule as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-DlpEdmSchema` | No Microsoft365DSC resource declares Get-DlpEdmSchema as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-DlpKeywordDictionary` | No Microsoft365DSC resource declares Get-DlpKeywordDictionary as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-DlpSensitiveInformationTypeConfig` | No Microsoft365DSC resource declares Get-DlpSensitiveInformationTypeConfig as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-eDiscoveryCaseAdmin` | No Microsoft365DSC resource declares Get-eDiscoveryCaseAdmin as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-FilePlanPropertyStructure` | No Microsoft365DSC resource declares Get-FilePlanPropertyStructure as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-GlobalList` | No Microsoft365DSC resource declares Get-GlobalList as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-JitConfiguration` | No Microsoft365DSC resource declares Get-JitConfiguration as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-LabelPolicyRule` | No Microsoft365DSC resource declares Get-LabelPolicyRule as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-OrganizationSegment` | No Microsoft365DSC resource declares Get-OrganizationSegment as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `compliance` | `Get-ServiceDomainGroup` | No Microsoft365DSC resource declares Get-ServiceDomainGroup as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-AdaptiveScope` | No Microsoft365DSC resource declares Get-AdaptiveScope as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-ATPEvaluationRule` | No Microsoft365DSC resource declares Get-ATPEvaluationRule as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-ComplianceTagStorage` | No Microsoft365DSC resource declares Get-ComplianceTagStorage as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-CustomDlpEmailTemplates` | No Microsoft365DSC resource declares Get-CustomDlpEmailTemplates as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-DevicePolicy` | No Microsoft365DSC resource declares Get-DevicePolicy as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-DeviceTenantPolicy` | No Microsoft365DSC resource declares Get-DeviceTenantPolicy as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-DeviceTenantRule` | No Microsoft365DSC resource declares Get-DeviceTenantRule as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-DlpPolicy` | No Microsoft365DSC resource declares Get-DlpPolicy as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-ElevatedAccessAuthorization` | No Microsoft365DSC resource declares Get-ElevatedAccessAuthorization as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-EvaluationModeReportSeries` | No Microsoft365DSC resource declares Get-EvaluationModeReportSeries as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-ExoInformationBarrierPolicy` | No Microsoft365DSC resource declares Get-ExoInformationBarrierPolicy as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-ExoInformationBarrierSegment` | No Microsoft365DSC resource declares Get-ExoInformationBarrierSegment as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-InboxRule` | No Microsoft365DSC resource declares Get-InboxRule as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-LinkedUser` | No Microsoft365DSC resource declares Get-LinkedUser as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-MailPublicFolder` | No Microsoft365DSC resource declares Get-MailPublicFolder as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-MessageCategory` | No Microsoft365DSC resource declares Get-MessageCategory as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-MoveRequest` | No Microsoft365DSC resource declares Get-MoveRequest as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-OutlookProtectionRule` | No Microsoft365DSC resource declares Get-OutlookProtectionRule as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-PendingDelicenseUser` | No Microsoft365DSC resource declares Get-PendingDelicenseUser as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-PublicFolderMailboxMigrationRequest` | No Microsoft365DSC resource declares Get-PublicFolderMailboxMigrationRequest as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-ReportExecutionInstance` | No Microsoft365DSC resource declares Get-ReportExecutionInstance as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-ReportScheduleList` | No Microsoft365DSC resource declares Get-ReportScheduleList as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-RMSTemplate` | No Microsoft365DSC resource declares Get-RMSTemplate as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-SCInsights` | No Microsoft365DSC resource declares Get-SCInsights as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-SyncRequest` | No Microsoft365DSC resource declares Get-SyncRequest as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `exchange` | `Get-TeamsProtectionPolicyRule` | No Microsoft365DSC resource declares Get-TeamsProtectionPolicyRule as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsAgent` | No Microsoft365DSC resource declares Get-CsAgent as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsAutoAttendant` | No Microsoft365DSC resource declares Get-CsAutoAttendant as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsAutoRecordingTemplate` | No Microsoft365DSC resource declares Get-CsAutoRecordingTemplate as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsBatchPolicyAssignmentOperation` | No Microsoft365DSC resource declares Get-CsBatchPolicyAssignmentOperation as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsComplianceRecordingForCallQueueTemplate` | No Microsoft365DSC resource declares Get-CsComplianceRecordingForCallQueueTemplate as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsInboundBlockedNumberPattern` | No Microsoft365DSC resource declares Get-CsInboundBlockedNumberPattern as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsInboundExemptNumberPattern` | No Microsoft365DSC resource declares Get-CsInboundExemptNumberPattern as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsMainlineAttendantAppointmentBookingFlow` | No Microsoft365DSC resource declares Get-CsMainlineAttendantAppointmentBookingFlow as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsMainlineAttendantFlow` | No Microsoft365DSC resource declares Get-CsMainlineAttendantFlow as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsMainlineAttendantQuestionAnswerFlow` | No Microsoft365DSC resource declares Get-CsMainlineAttendantQuestionAnswerFlow as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsOnlineAudioFile` | No Microsoft365DSC resource declares Get-CsOnlineAudioFile as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsOnlineDialinConferencingBridge` | No Microsoft365DSC resource declares Get-CsOnlineDialinConferencingBridge as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsOnlineDialInConferencingUser` | No Microsoft365DSC resource declares Get-CsOnlineDialInConferencingUser as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsOnlineLisCivicAddress` | No Microsoft365DSC resource declares Get-CsOnlineLisCivicAddress as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsOnlineLisLocation` | No Microsoft365DSC resource declares Get-CsOnlineLisLocation as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsOnlineLisPort` | No Microsoft365DSC resource declares Get-CsOnlineLisPort as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsOnlineLisSubnet` | No Microsoft365DSC resource declares Get-CsOnlineLisSubnet as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsOnlineLisSwitch` | No Microsoft365DSC resource declares Get-CsOnlineLisSwitch as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsOnlineLisWirelessAccessPoint` | No Microsoft365DSC resource declares Get-CsOnlineLisWirelessAccessPoint as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsOnlineSchedule` | No Microsoft365DSC resource declares Get-CsOnlineSchedule as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsPhoneNumberPolicyAssignment` | No Microsoft365DSC resource declares Get-CsPhoneNumberPolicyAssignment as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsPhoneNumberTag` | No Microsoft365DSC resource declares Get-CsPhoneNumberTag as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsSharedCallHistoryTemplate` | No Microsoft365DSC resource declares Get-CsSharedCallHistoryTemplate as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsSharedCallQueueHistoryTemplate` | No Microsoft365DSC resource declares Get-CsSharedCallQueueHistoryTemplate as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsSharedVoicemailTriageSettingsTemplate` | No Microsoft365DSC resource declares Get-CsSharedVoicemailTriageSettingsTemplate as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsTagsTemplate` | No Microsoft365DSC resource declares Get-CsTagsTemplate as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsTeamsCustomBannerText` | No Microsoft365DSC resource declares Get-CsTeamsCustomBannerText as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsTeamsRecordingAndTranscriptionCustomMessage` | No Microsoft365DSC resource declares Get-CsTeamsRecordingAndTranscriptionCustomMessage as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsTeamsRemoteLogCollectionDevice` | No Microsoft365DSC resource declares Get-CsTeamsRemoteLogCollectionDevice as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |
| `teams` | `Get-CsVideoInteropServiceProvider` | No Microsoft365DSC resource declares Get-CsVideoInteropServiceProvider as a read cmdlet (checked 224 distinct powershell-transport cmdlets from #1794's model). |

## Cmdlets that were executed and failed

Verbatim service messages, truncated only for width. These are real observations, not inferences.

### `compliance` — 17 failed

| Cmdlet | Status | ms | Verbatim message |
|---|---|---:|---|
| `Get-DefaultTenantBriefingConfig` | `error` | 22 | You must call Connect-ExchangeOnline before calling any other cmdlet. |
| `Get-DefaultTenantMyAnalyticsFeatureConfig` | `error` | 1 | You must call Connect-ExchangeOnline before calling any other cmdlet. |
| `Get-EXOCasMailbox` | `error` | 23 | You must call Connect-ExchangeOnline before calling any other cmdlet. |
| `Get-EXOMailbox` | `error` | 2 | You must call Connect-ExchangeOnline before calling any other cmdlet. |
| `Get-EXOMailboxFolderPermission` | `error` | 3 | You must call Connect-ExchangeOnline before calling any other cmdlet. |
| `Get-EXOMailboxFolderStatistics` | `error` | 1 | You must call Connect-ExchangeOnline before calling any other cmdlet. |
| `Get-EXOMailboxPermission` | `error` | 2 | You must call Connect-ExchangeOnline before calling any other cmdlet. |
| `Get-EXOMailboxStatistics` | `error` | 1 | You must call Connect-ExchangeOnline before calling any other cmdlet. |
| `Get-EXOMobileDeviceStatistics` | `error` | 1 | You must call Connect-ExchangeOnline before calling any other cmdlet. |
| `Get-EXORecipient` | `error` | 2 | You must call Connect-ExchangeOnline before calling any other cmdlet. |
| `Get-EXORecipientPermission` | `error` | 1 | You must call Connect-ExchangeOnline before calling any other cmdlet. |
| `Get-InsiderRiskEntityList` | `error` | 2564 | \|Microsoft.Exchange.Management.UnifiedPolicy.ErrorIrmEntityListInvalidGetParametersException\|Either Identity or Type should be provided as parameter. |
| `Get-RetentionEvent` | `error` | 425 | This command is not allowed to run in Exchange Online Protection environment. |
| `Get-TeamsRetentionComplianceRule` | `error` | 476 | \|Microsoft.Exchange.Configuration.Tasks.ThrowTerminatingErrorException\|This cmdlet has been blocked because it is no longer in use. If you believe this is incorrect and you still require access to this cmdlet, please contact the Exchange Manageability team at exocmdletissue@service.microsoft.com with the reason for your request so it can be reviewed and unblocked if appropriate. |
| `Get-ThreatResponsePolicy` | `error` | 2509 | \|Microsoft.Exchange.Configuration.Tasks.ThrowTerminatingErrorException\|This cmdlet has been blocked because it is no longer in use. If you believe this is incorrect and you still require access to this cmdlet, please contact the Exchange Manageability team at exocmdletissue@service.microsoft.com with the reason for your request so it can be reviewed and unblocked if appropriate. |
| `Get-ThreatResponseRule` | `error` | 480 | \|Microsoft.Exchange.Configuration.Tasks.ThrowTerminatingErrorException\|This cmdlet has been blocked because it is no longer in use. If you believe this is incorrect and you still require access to this cmdlet, please contact the Exchange Manageability team at exocmdletissue@service.microsoft.com with the reason for your request so it can be reviewed and unblocked if appropriate. |
| `Get-WrappedCommand` | `error` | 4 | Cannot validate argument on parameter 'Name'. The argument is null, empty, or an element of the argument collection contains a null value. Supply a collection that does not contain any null values and then try the command again. |

### `exchange` — 47 failed

| Cmdlet | Status | ms | Verbatim message |
|---|---|---:|---|
| `Get-DlpPolicyTemplate` | `cmdlet_unavailable` | 103 | The cmdlet you attempted to run is currently unavailable. It may be deprecated, restricted from use, or temporarily blocked due to an internal issue. If you believe this cmdlet should be accessible, please contact us at exocmdletissue@microsoft.com for assistance. |
| `Get-JitConfiguration` | `cmdlet_unavailable` | 79 | The cmdlet you attempted to run is currently unavailable. It may be deprecated, restricted from use, or temporarily blocked due to an internal issue. If you believe this cmdlet should be accessible, please contact us at exocmdletissue@microsoft.com for assistance. |
| `Get-RbacDiagnosticInfo` | `cmdlet_unavailable` | 203 | Cmdlet type is not supported. Please check the name of the cmdlet: Get-RbacDiagnosticInfo |
| `Get-DefaultTenantBriefingConfig` | `not_supported_app_only` | 995 | The following authorization requirements are not satisfied: ((TokenTypeAuthorizationRequirement(UserActAs, AppOnly)&ScopeAuthorizationRequirement(OrganizationSettings.Read, OrganizationSettings.ReadWrite, OrganizationSettings.Read, OrganizationSettings.ReadWrite))\|WidsAuthorizationRequirement(62e90394-69f5-4237-9190-012177145e10,29232cdf-9323-42fd-ade2-1d097af3e4de,69091246-20e8-4a56-aa4d-066075b… |
| `Get-DefaultTenantMyAnalyticsFeatureConfig` | `not_supported_app_only` | 720 | The following authorization requirements are not satisfied: ((TokenTypeAuthorizationRequirement(UserActAs, AppOnly)&ScopeAuthorizationRequirement(OrganizationSettings.Read, OrganizationSettings.ReadWrite, OrganizationSettings.Read, OrganizationSettings.ReadWrite))\|WidsAuthorizationRequirement(62e90394-69f5-4237-9190-012177145e10,29232cdf-9323-42fd-ade2-1d097af3e4de,69091246-20e8-4a56-aa4d-066075b… |
| `Get-App` | `error` | 234 | \|\|This action cannot be performed directly to arbitration mailboxes. Please use the OrganizationApp parameter instead. |
| `Get-ApplicationAccessPolicy` | `error` | 142 | \|\|The operation couldn't be performed because object 'OU=mccawsoft2.onmicrosoft.com,OU=Microsoft Exchange Hosted Organizations,DC=NAMPR05A001,DC=prod,DC=outlook,DC=com\*' couldn't be found on 'SA5PR05A01DC001.NAMPR05A001.prod.outlook.com'. |
| `Get-AuditConfig` | `error` | 69 | Object reference not set to an instance of an object. |
| `Get-BlockedConnector` | `error` | 76 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-BlockedSenderAddress` | `error` | 58 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-BookingMailbox` | `error` | 73 | Object reference not set to an instance of an object. |
| `Get-CalendarSettings` | `error` | 84 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-DlpKeywordDictionary` | `error` | 106 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-DlpSensitiveInformationTypeConfig` | `error` | 74 | This command is only allowed to run in Exchange Online Protection environment. |
| `Get-DlpSensitiveInformationTypeRulePackage` | `error` | 125 | \|\|This command is only allowed to run in Exchange Online Protection environment. |
| `Get-EXOMailboxFolderPermission` | `error` | 3 | Identity "" is not a valid value. The identity should be <MailboxId>:\<FolderPath> or <MailboxId>:<FolderId> format. Valid Value for Mailbox Identity is either GUID(XXXXXXXX - XXXX - XXXX - XXXX - XXXXXXXXXXXX  format) or UserPrincipalName(xxxx@yyyy.zzz format) or Alias. |
| `Get-EXOMailboxFolderStatistics` | `error` | 2 | Identity is a mandatory value to provide for running Get-ExoMailboxFolderStatistics. You can specify identity by using either of the following Identity, ExternalDirectoryObjectId, UserPrincipalName. |
| `Get-EXOMailboxPermission` | `error` | 296 | Identity is a mandatory value to provide for running Get-ExoMailboxPermission. You can specify identity by using any one of the three available parameters: Identity, ExternalDirectoryObjectId, UserPrincipalName. |
| `Get-EXOMailboxStatistics` | `error` | 3 | Identity is a mandatory value to provide for running Get-ExoMailboxStatistics. You can specify identity by using either of the following 1. Any one of the three available parameters: Identity, ExchangeGuid, UserPrincipalName. 2. ExchangeGuid and DatabaseGuid |
| `Get-EXOMobileDeviceStatistics` | `error` | 1 | "Mailbox" "Identity" or "ExternalDirectoryObjectId" or "UserPrincipalName" or "PrimarySmtpAddress" parameter must be specified |
| `Get-ExternalInOutlook` | `error` | 457 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-InformationBarrierReportDetails` | `error` | 3502 | \|\|We cannot currently process your request, please wait a few minutes and try again. |
| `Get-InformationBarrierReportSummary` | `error` | 3401 | \|\|We cannot currently process your request, please wait a few minutes and try again. |
| `Get-LimitsEnforcementStatus` | `error` | 104 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-LogonStatistics` | `error` | 5 | Cannot process command because of one or more missing mandatory parameters: Identity. |
| `Get-MailboxAnalysisRequest` | `error` | 98 | Object reference not set to an instance of an object. |
| `Get-MailboxCalendarConfiguration` | `error` | 2 | Parameter set cannot be resolved using the specified named parameters. One or more parameters issued cannot be used together or an insufficient number of parameters were provided. |
| `Get-MailboxFolder` | `error` | 5 | Parameter set cannot be resolved using the specified named parameters. One or more parameters issued cannot be used together or an insufficient number of parameters were provided. |
| `Get-MailboxFolderStatistics` | `error` | 6 | Cannot process command because of one or more missing mandatory parameters: Identity. |
| `Get-MailboxIRMAccess` | `error` | 113 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-MailboxOverrideConfiguration` | `error` | 108 | \|\|Parameter set cannot be resolved using the specified named parameters. Multiple parameter sets are applicable. |
| `Get-MailboxRegionalConfiguration` | `error` | 20 | Parameter set cannot be resolved using the specified named parameters. One or more parameters issued cannot be used together or an insufficient number of parameters were provided. |
| `Get-MailboxSpellingConfiguration` | `error` | 59 | \|\|Parameter set cannot be resolved using the specified named parameters. Multiple parameter sets are applicable. |
| `Get-MailboxStatistics` | `error` | 6 | Cannot process command because of one or more missing mandatory parameters: Identity. |
| `Get-MessageClassification` | `error` | 615 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-OMEConfiguration` | `error` | 62 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-OnlineMeetingConfiguration` | `error` | 91 | \|\|Parameter set cannot be resolved using the specified named parameters. Multiple parameter sets are applicable. |
| `Get-OnPremServerExemptionQuota` | `error` | 71 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-OnPremServerReportInfo` | `error` | 67 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-PhishSimOverridePolicy` | `error` | 993 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-PublicFolder` | `error` | 16 | Parameter set cannot be resolved using the specified named parameters. One or more parameters issued cannot be used together or an insufficient number of parameters were provided. |
| `Get-SecOpsOverridePolicy` | `error` | 76 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-ServiceStatus` | `error` | 14753 | \|\|Use the ReportingServer and ReportingDatabase parameters to specify the appropriate System Center Operations Manager reporting server and database. Error: A network-related or instance-specific error occurred while establishing a connection to SQL Server. The server was not found or was not accessible. Verify that the instance name is correct and that SQL Server is configured to allow remote co… |
| `Get-SmimeConfig` | `error` | 72 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-SweepRule` | `error` | 185 | \|\|The operation on mailbox "SystemMailbox{bb558c35-97f1-4cb9-8ff7-d53741dc928c}" failed because it's out of the current user's read scope. You may need elevated permissions. 'SystemMailbox{bb558c35-97f1-4cb9-8ff7-d53741dc928c}' isn't within your current write scopes. Can't perform save operation. |
| `Get-TenantScanRequestStatistics` | `error` | 492 | A server side error has occurred because of which the operation could not be completed. Please try again after some time. If the problem still persists, please reach out to MS support. |
| `Get-WrappedCommand` | `error` | 5 | Cannot validate argument on parameter 'Name'. The argument is null, empty, or an element of the argument collection contains a null value. Supply a collection that does not contain any null values and then try the command again. |

### `teams` — 19 failed

| Cmdlet | Status | ms | Verbatim message |
|---|---|---:|---|
| `Get-CsLocationPolicy` | `access_denied` | 179 | {"code":"Forbidden","message":"You are not authorized to perform this action","action":"Please refer to documentation. CorrelationId: a39b4173-27b0-42b7-b085-753cc86977d5","errorCode":40301} |
| `Get-CsPolicyPackage` | `access_denied` | 72 | Access Denied. |
| `Get-CsSdgBulkSignInRequestsSummary` | `access_denied` | 133 | Access Denied. |
| `Get-CsTeamsCarrierEmergencyCallRoutingPolicy` | `access_denied` | 209 | {"code":"Forbidden","message":"You are not authorized to perform this action","action":"Please refer to documentation. CorrelationId: d6c31d53-32eb-489f-a10b-1678006bdb93","errorCode":40301} |
| `Get-CsTeamsTenantAbuseConfiguration` | `access_denied` | 175 | {"code":"Forbidden","message":"You are not authorized to perform this action","action":"Please refer to documentation. CorrelationId: 12b8c48b-0b47-4fe9-96d6-0d668a05654f","errorCode":40301} |
| `Get-AllM365TeamsApps` | `error` | 287 | — |
| `Get-AssociatedTeam` | `error` | 131 | Error occurred while executing  Code: BadRequest Message: /me request is only valid with delegated authentication flow. InnerError:   RequestId: 78643049-0322-43fe-93aa-1c65d30ed260   DateTimeStamp: 2026-08-30T06:24:54 HttpStatusCode: BadRequest |
| `Get-CsHybridTelephoneNumber` | `error` | 153 | [BadArgument] : This cmdlet is no longer supported, please consult public documentation for alternative options. Parameter name: GetHybridNumberAsync |
| `Get-CsOnlineDialInConferencingServiceNumber` | `error` | 220 | The server responded with a Request Error, Status: NotFound |
| `Get-CsOnlineTelephoneNumber` | `error` | 95 | This cmdlet is no longer supported, please consult public documentation |
| `Get-CsOnlineVoiceUser` | `error` | 123 | [InternalServerError] : This cmdlet has been deprecated. Alternative approach to achieve same functionalities is described in the official documentation. Refer this documentation https://learn.microsoft.com/en-us/powershell/module/skype/get-csonlinevoiceuser?view=skype-ps for more details. |
| `Get-CsTeamsAudioConferencingCustomPromptsConfiguration` | `error` | 242 | {"code":"ClientError","message":"Type TeamsAudioConferencingCustomPromptsConfiguration is not currently enabled in flighting","action":"Please refer to documentation. CorrelationId: a7764fb7-eb2f-4c6d-91ff-44b45ccf759b","errorCode":40003} |
| `Get-CsTenant` | `error` | 67 | A parameter cannot be found that matches parameter name 'ResultSize'. |
| `Get-M365UnifiedCustomPendingApps` | `error` | 231 | — |
| `Get-M365UnifiedTenantSettings` | `error` | 49 | — |
| `Get-TeamsApp` | `error` | 53 | Error occurred while executing  Code: Forbidden Message: Missing role permissions on the request. API requires one of 'AppCatalog.Read.All, AppCatalog.ReadWrite.All'. Roles on the request 'RealTimeActivityFeed.Read.All, RoleEligibilitySchedule.Read.Directory, DeviceManagementManagedDevices.Read.All, BitlockerKey.Read.All, SharePointTenantSettings.Read.All, SecurityEvents.Read.All, IdentityRiskySe… |
| `Get-TeamsArtifacts` | `error` | 4 | EXPORT_TOOL.CLIENT_ID environment variable not set. |
| `Get-TeamTargetingHierarchyStatus` | `error` | 437 | — |
| `Get-TenantPrivateChannelMigrationStatus` | `error` | 210 | {"errors":[{"message":"S2S12040: Bearer_AppToken.IsApplicationIdValid returned false. The 'appid' or 'azp' claim found in token did not match any of the ValidApplicationIds specified in: 'Bearer_AppToken'. Claim value: '[PII of type 'System.String' is hidden]'.\r\nS2S12040: Bearer_CDT.IsApplicationIdValid returned false. The 'appid' or 'azp' claim found in token did not match any of the ValidAppl… |

## Unknowns — what this survey did NOT establish

Every cmdlet in this section was **never executed**, so its app-only behaviour is genuinely unknown. None of it should be read as "does not work" — that is exactly the false-negative failure #1793 warns a careless survey produces.

| Not attempted because | Count |
|---|---:|
| Set-* is not a read verb (survey executes Get-* only) | 157 |
| New-* is not a read verb (survey executes Get-* only) | 132 |
| Remove-* is not a read verb (survey executes Get-* only) | 121 |
| requires mandatory parameter(s) […] — probing would require inventing a target value | 116 |
| Grant-* is not a read verb (survey executes Get-* only) | 51 |
| excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history | 47 |
| declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established | 25 |
| Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) | 15 |
| Update-* is not a read verb (survey executes Get-* only) | 11 |
| Add-* is not a read verb (survey executes Get-* only) | 9 |
| Export-* is not a read verb (survey executes Get-* only) | 9 |
| Connect-* is not a read verb (survey executes Get-* only) | 5 |
| Invoke-* is not a read verb (survey executes Get-* only) | 4 |
| Disconnect-* is not a read verb (survey executes Get-* only) | 3 |
| Validate-* is not a read verb (survey executes Get-* only) | 3 |
| excluded as unbounded against a live production tenant — message-trace family: unbounded time-range query over live mail flow | 3 |
| Start-* is not a read verb (survey executes Get-* only) | 3 |
| Check-* is not a read verb (survey executes Get-* only) | 2 |
| excluded as unbounded against a live production tenant — measured to hang past the container's child timeout AND wedge the parent listener until a manual revision restart (Git #1852); its real timed-out result is recorded in survey run #2 | 2 |
| non-verb-noun command is not a read verb (survey executes Get-* only) | 2 |
| Preview-* is not a read verb (survey executes Get-* only) | 2 |
| Enable-* is not a read verb (survey executes Get-* only) | 2 |
| Clear-* is not a read verb (survey executes Get-* only) | 2 |
| Find-* is not a read verb (survey executes Get-* only) | 2 |
| Import-* is not a read verb (survey executes Get-* only) | 2 |
| Cancel-* is not a read verb (survey executes Get-* only) | 1 |
| Delete-* is not a read verb (survey executes Get-* only) | 1 |
| Execute-* is not a read verb (survey executes Get-* only) | 1 |
| Release-* is not a read verb (survey executes Get-* only) | 1 |
| Restore-* is not a read verb (survey executes Get-* only) | 1 |
| excluded as unbounded against a live production tenant — message-trace family: unbounded historical search over live mail flow | 1 |
| Reset-* is not a read verb (survey executes Get-* only) | 1 |
| Search-* is not a read verb (survey executes Get-* only) | 1 |
| Stop-* is not a read verb (survey executes Get-* only) | 1 |
| Troubleshoot-* is not a read verb (survey executes Get-* only) | 1 |
| Complete-* is not a read verb (survey executes Get-* only) | 1 |
| Disable-* is not a read verb (survey executes Get-* only) | 1 |
| Move-* is not a read verb (survey executes Get-* only) | 1 |
| Register-* is not a read verb (survey executes Get-* only) | 1 |
| Sync-* is not a read verb (survey executes Get-* only) | 1 |
| Unregister-* is not a read verb (survey executes Get-* only) | 1 |

### The one deliberate, load-bearing exclusion: `Test-*`

#1793 names `Test-*` a read verb. This survey excludes it anyway, and that is a judgement call worth stating plainly rather than burying: several `ExchangeOnlineManagement` `Test-*` cmdlets are not reads. `Test-Mailflow` sends a real probe message through the live transport pipeline. `Test-MigrationServerAvailability` opens an outbound connection to a third-party host. `Test-OAuthConnectivity` performs a live token exchange. Against Shane's real production tenant, the verb alone cannot separate those from a genuine read, so the whole verb fails the issue's own "read-safety establishable from the cmdlet's own help output" bar and is recorded `not_attempted`. Establishing app-only support for individual `Test-*` cmdlets needs a per-cmdlet read of Microsoft's documentation and is deliberately left as follow-up work.

There are **15** such cmdlets across all session types:

- **`exchange`** (9): `Test-ApplicationAccessPolicy`, `Test-ClientAccessRule`, `Test-DatabaseEvent`, `Test-DataEncryptionPolicy`, `Test-DlpPolicies`, `Test-M365DataAtRestEncryptionPolicy`, `Test-MailboxAssistant`, `Test-Message`, `Test-OrganizationRelationship`
- **`teams`** (6): `Test-CsEffectiveTenantDialPlan`, `Test-CsInboundBlockedNumberPattern`, `Test-CsTeamsShiftsConnectionValidate`, `Test-CsTeamsTranslationRule`, `Test-CsTeamsUnassignedNumberTreatment`, `Test-CsVoiceNormalizationRule`

### Cmdlets requiring a mandatory parameter

These are read cmdlets that could not be probed without inventing a target value — and inventing input is precisely the fabrication this project forbids. Their app-only behaviour is reachable, but only with a real identity supplied from tenant data the survey deliberately does not read.

| Session | Cmdlet | Mandatory parameters |
|---|---|---|
| `compliance` | `Get-AdaptiveScopeMembers` | Identity |
| `compliance` | `Get-DeviceComplianceUserReport` | DeviceId |
| `compliance` | `Get-DlpEdmSession` | DataStoreName |
| `compliance` | `Get-MachineAssistedTagResource` | Resource |
| `compliance` | `Get-MyAnalyticsFeatureConfig` | Identity |
| `compliance` | `Get-QuarantineMessageHeader` | Identity |
| `compliance` | `Get-RoleGroupMember` | Identity |
| `compliance` | `Get-TenantAllowBlockListItems` | ListType |
| `compliance` | `Get-UserBriefingConfig` | Identity |
| `compliance` | `Get-VivaInsightsSettings` | Identity |
| `compliance` | `Get-VivaModuleFeature` | ModuleId |
| `compliance` | `Get-VivaModuleFeatureEnablement` | ModuleId, FeatureId, Identity |
| `compliance` | `Get-VivaModuleFeaturePolicy` | ModuleId |
| `compliance` | `Get-VivaOrgInsightsDelegatedRole` | Delegator |
| `compliance` | `Get-WorkforceInsightsDelegationAccess` | Delegator |
| `exchange` | `Get-AccessLabel` | Identity |
| `exchange` | `Get-ActiveSyncDeviceStatistics` | Identity |
| `exchange` | `Get-AdaptivePolicyLocation` | PageCookie |
| `exchange` | `Get-AdaptiveScopeLocation` | PageCookie |
| `exchange` | `Get-AdaptiveScopeMembers` | Identity |
| `exchange` | `Get-CalendarDiagnosticAnalysis` | CalendarLogs |
| `exchange` | `Get-CalendarDiagnosticLog` | Identity |
| `exchange` | `Get-CalendarDiagnosticObjects` | Identity |
| `exchange` | `Get-CalendarProcessing` | Identity |
| `exchange` | `Get-CalendarViewDiagnostics` | Identity, WindowEndUtc, WindowStartUtc |
| `exchange` | `Get-Clutter` | Identity |
| `exchange` | `Get-ConfigAnalyzerPolicyRecommendation` | RecommendedPolicyType |
| `exchange` | `Get-ConnectorSyncStatsAggregationRequest` | ConnectionLogicalId |
| `exchange` | `Get-CrawlState` | AssistantName |
| `exchange` | `Get-DistributionGroupMember` | Identity |
| `exchange` | `Get-DnssecStatusForVerifiedDomain` | DomainName |
| `exchange` | `Get-DynamicDistributionGroupMember` | Identity |
| `exchange` | `Get-EventsFromEmailConfiguration` | Identity |
| `exchange` | `Get-ExoConnectivityTableSnapshot` | Organization |
| `exchange` | `Get-ExoInformationBarrierRelationship` | RecipientId1, RecipientId2 |
| `exchange` | `Get-ExoInformationBarrierRelationshipTable` | Organization |
| `exchange` | `Get-ExoInformationBarrierUpgradeImpact` | Organization |
| `exchange` | `Get-ExoRecipientsStatus` | RecipientIds |
| `exchange` | `Get-ExoSegmentsSnapshot` | Organization |
| `exchange` | `Get-ExoUsersByIBSegment` | Mode, Organization |
| `exchange` | `Get-FederationInformation` | DomainName |
| `exchange` | `Get-HVEAccountBillingPolicy` | Identity |
| `exchange` | `Get-HVEAccountSettings` | Identity |
| `exchange` | `Get-MailboxAnalysisRequestStatistics` | Identity |
| `exchange` | `Get-MailboxAutoReplyConfiguration` | Identity |
| `exchange` | `Get-MailboxCalendarFolder` | Identity |
| `exchange` | `Get-MailboxFolderPermission` | Identity |
| `exchange` | `Get-MailboxJunkEmailConfiguration` | Identity |
| `exchange` | `Get-MailboxLocation` | Identity |
| `exchange` | `Get-MailboxMessageConfiguration` | Identity |
| `exchange` | `Get-MailboxPermission` | Identity |
| `exchange` | `Get-MailboxUserConfiguration` | Identity, Mailbox |
| `exchange` | `Get-ManagementRoleEntry` | Identity |
| `exchange` | `Get-MessageTraceDetailV2` | MessageTraceId, RecipientAddress |
| `exchange` | `Get-MessageTrackingReport` | Identity |
| `exchange` | `Get-MigrationUserStatistics` | Identity |
| `exchange` | `Get-MobileDeviceStatistics` | Identity |
| `exchange` | `Get-MoveRequestStatistics` | Identity |
| `exchange` | `Get-MyAnalyticsFeatureConfig` | Identity |
| `exchange` | `Get-PerimeterMessageTrace` | Recipient |
| `exchange` | `Get-PublicFolderClientPermission` | Identity |
| `exchange` | `Get-PublicFolderItemStatistics` | Identity |
| `exchange` | `Get-PublicFolderMailboxDiagnostics` | Identity |
| `exchange` | `Get-PublicFolderMailboxMigrationRequestStatistics` | Identity |
| `exchange` | `Get-QuarantineMessageHeader` | Identity |
| `exchange` | `Get-ReportSchedule` | ScheduleId |
| `exchange` | `Get-RoleGroupMember` | Identity |
| `exchange` | `Get-SmtpDaneInboundStatus` | DomainName |
| `exchange` | `Get-SupervisoryReviewActivity` | EndDate, PolicyId, StartDate |
| `exchange` | `Get-SyncRequestStatistics` | Identity |
| `exchange` | `Get-TDPReport` | ReportType |
| `exchange` | `Get-TenantAllowBlockListItems` | ListType |
| `exchange` | `Get-TenantExemptionInfo` | BlockingScenario |
| `exchange` | `Get-TenantExemptionQuota` | BlockingScenario |
| `exchange` | `Get-TenantExemptionQuotaEligibility` | BlockingScenario |
| `exchange` | `Get-TenantRecipientLimitInfo` | BlockingScenario |
| `exchange` | `Get-ToolInformation` | Identity, Version |
| `exchange` | `Get-UnifiedAuditSetting` | Identity |
| `exchange` | `Get-UnifiedGroupLinks` | Identity, LinkType |
| `exchange` | `Get-UserBriefingConfig` | Identity |
| `exchange` | `Get-VivaInsightsSettings` | Identity |
| `exchange` | `Get-VivaModuleFeature` | ModuleId |
| `exchange` | `Get-VivaModuleFeatureEnablement` | ModuleId, FeatureId, Identity |
| `exchange` | `Get-VivaModuleFeaturePolicy` | ModuleId |
| `exchange` | `Get-VivaOrgInsightsDelegatedRole` | Delegator |
| `exchange` | `Get-WorkforceInsightsDelegationAccess` | Delegator |
| `teams` | `Get-AIGeneratedKnowledgeContainer` | ThreadId |
| `teams` | `Get-CsAiAgents` | ProviderId |
| `teams` | `Get-CsAutoAttendantHolidays` | Identity |
| `teams` | `Get-CsAutoAttendantStatus` | Identity |
| `teams` | `Get-CsBatchTeamsDeploymentStatus` | OrchestrationId |
| `teams` | `Get-CsEffectiveTenantDialPlan` | Identity |
| `teams` | `Get-CsExportAcquiredPhoneNumberStatus` | OrderId |
| `teams` | `Get-CsOnlineApplicationInstanceAssociation` | Identity |
| `teams` | `Get-CsOnlineApplicationInstanceAssociationStatus` | Identity |
| `teams` | `Get-CsOnlineEnhancedEmergencyServiceDisclaimer` | CountryOrRegion |
| `teams` | `Get-CsOnlineTelephoneNumberOrder` | OrderId |
| `teams` | `Get-CsOnlineTelephoneNumberType` | Country |
| `teams` | `Get-CsOnlineVoicemailUserSettings` | Identity |
| `teams` | `Get-CsPersonalAttendantSettings` | Identity |
| `teams` | `Get-CsSdgBulkSignInRequestStatus` | Batchid |
| `teams` | `Get-CsTeamsShiftsConnectionOperation` | OperationId |
| `teams` | `Get-CsTeamsShiftsConnectionSyncResult` | InputObject |
| `teams` | `Get-CsTeamsShiftsConnectionTeamMap` | ConnectorInstanceId |
| `teams` | `Get-CsTeamsShiftsConnectionWfmTeam` | ConnectorInstanceId |
| `teams` | `Get-CsTeamsShiftsConnectionWfmUser` | InputObject |
| `teams` | `Get-CsTeamTemplate` | OdataId |
| `teams` | `Get-CsUserCallingSettings` | Identity |
| `teams` | `Get-CsUserPolicyAssignment` | Identity |
| `teams` | `Get-CsUserPolicyPackage` | Identity |
| `teams` | `Get-CsUserPolicyPackageRecommendation` | Identity |
| `teams` | `Get-GroupAssignmentRecommendationsPerPolicyName` | EntityType, PolicyType |
| `teams` | `Get-GroupAssignmentRecommendationsPerPolicyType` | EntityType |
| `teams` | `Get-GroupPolicyAssignmentConflict` | GroupId, PolicyType |
| `teams` | `Get-M365TeamsApp` | Id |
| `teams` | `Get-MultiGeoRegion` | EntityId, EntityType |
| `teams` | `Get-Operation` | GroupId, OperationId |
| `teams` | `Get-SharedWithTeam` | HostTeamId, ChannelId |
| `teams` | `Get-SharedWithTeamUser` | HostTeamId, ChannelId, SharedWithTeamId |
| `teams` | `Get-TeamAllChannel` | GroupId |
| `teams` | `Get-TeamChannel` | GroupId |
| `teams` | `Get-TeamChannelUser` | GroupId, DisplayName |
| `teams` | `Get-TeamIncomingChannel` | GroupId |
| `teams` | `Get-TeamUser` | GroupId |

### Full `not_attempted` list

| Session | Cmdlet | Reason |
|---|---|---|
| `compliance` | `Add-VivaModuleFeaturePolicy` | Add-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Add-VivaOrgInsightsDelegatedRole` | Add-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Add-WorkforceInsightsDelegationAccess` | Add-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Cancel-DlpEdmSession` | Cancel-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Check-PurviewConfig` | Check-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Connect-ExchangeOnline` | Connect-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Connect-IPPSSession` | Connect-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Delete-QuarantineMessage` | Delete-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Disconnect-ExchangeOnline` | Disconnect-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Execute-AzureAdLabelSync` | Execute-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Export-ActivityExplorerData` | Export-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Export-PurviewConfig` | Export-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Export-QuarantineMessage` | Export-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Export-QuarantineMessageV1` | Export-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Get-AdaptiveScopeMembers` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `compliance` | `Get-DataRetentionReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `compliance` | `Get-DeviceComplianceDetailsReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `compliance` | `Get-DeviceComplianceSummaryReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `compliance` | `Get-DeviceComplianceUserReport` | requires mandatory parameter(s) [DeviceId] — probing would require inventing a target value |
| `compliance` | `Get-DlpDetailReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `compliance` | `Get-DlpDetectionsReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `compliance` | `Get-DlpEdmSession` | requires mandatory parameter(s) [DataStoreName] — probing would require inventing a target value |
| `compliance` | `Get-DlpIncidentDetailReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `compliance` | `Get-DlpSiDetectionsReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `compliance` | `Get-LabelExplorerConfig` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `compliance` | `Get-MachineAssistedTagResource` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `compliance` | `Get-MyAnalyticsFeatureConfig` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `compliance` | `Get-QuarantineMessageHeader` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `compliance` | `Get-RoleGroupMember` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `compliance` | `Get-ScopeEntities` | excluded as unbounded against a live production tenant — measured to hang past the container's child timeout AND wedge the parent listener until a manual revision restart (Git #1852); its real timed-out result is recorded in survey run #2 |
| `compliance` | `Get-TeamsRetentionCompliancePolicy` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `compliance` | `Get-TenantAllowBlockListItems` | requires mandatory parameter(s) [ListType] — probing would require inventing a target value |
| `compliance` | `Get-UserBriefingConfig` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `compliance` | `Get-VivaInsightsSettings` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `compliance` | `Get-VivaModuleFeature` | requires mandatory parameter(s) [ModuleId] — probing would require inventing a target value |
| `compliance` | `Get-VivaModuleFeatureEnablement` | requires mandatory parameter(s) [ModuleId, FeatureId, Identity] — probing would require inventing a target value |
| `compliance` | `Get-VivaModuleFeaturePolicy` | requires mandatory parameter(s) [ModuleId] — probing would require inventing a target value |
| `compliance` | `Get-VivaOrgInsightsDelegatedRole` | requires mandatory parameter(s) [Delegator] — probing would require inventing a target value |
| `compliance` | `Get-WorkforceInsightsDelegationAccess` | requires mandatory parameter(s) [Delegator] — probing would require inventing a target value |
| `compliance` | `IsCloudShellEnvironment` | non-verb-noun command is not a read verb (survey executes Get-* only) |
| `compliance` | `Preview-QuarantineMessage` | Preview-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Preview-QuarantineMessageV1` | Preview-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Release-QuarantineMessage` | Release-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Remove-VivaModuleFeaturePolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Remove-VivaOrgInsightsDelegatedRole` | Remove-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Remove-WorkforceInsightsDelegationAccess` | Remove-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Restore-TemporaryDeletedQuarantineMessage` | Restore-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Set-DefaultTenantBriefingConfig` | Set-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Set-DefaultTenantMyAnalyticsFeatureConfig` | Set-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Set-MyAnalyticsFeatureConfig` | Set-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Set-UserBriefingConfig` | Set-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Set-VivaInsightsSettings` | Set-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Update-VivaModuleFeaturePolicy` | Update-* is not a read verb (survey executes Get-* only) |
| `compliance` | `Validate-RetentionRuleQuery` | Validate-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Add-HVEAppAccess` | Add-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Add-VivaModuleFeaturePolicy` | Add-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Add-VivaOrgInsightsDelegatedRole` | Add-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Add-WorkforceInsightsDelegationAccess` | Add-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Check-ExoInformationBarrierSymmetry` | Check-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Connect-ExchangeOnline` | Connect-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Connect-IPPSSession` | Connect-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Disconnect-ExchangeOnline` | Disconnect-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Enable-ExoInformationBarriersMultiSegment` | Enable-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Export-MailboxDiagnosticLogs` | Export-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Export-TransportRuleCollection` | Export-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Get-AccessLabel` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-ActiveSyncDeviceStatistics` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-AdaptivePolicyLocation` | requires mandatory parameter(s) [PageCookie] — probing would require inventing a target value |
| `exchange` | `Get-AdaptiveScopeLocation` | requires mandatory parameter(s) [PageCookie] — probing would require inventing a target value |
| `exchange` | `Get-AdaptiveScopeMembers` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-AdministrativeUnit` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-AggregateZapReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-ATPTotalTrafficReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-CalendarDiagnosticAnalysis` | requires mandatory parameter(s) [CalendarLogs] — probing would require inventing a target value |
| `exchange` | `Get-CalendarDiagnosticLog` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-CalendarDiagnosticObjects` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-CalendarProcessing` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-CalendarViewDiagnostics` | requires mandatory parameter(s) [Identity, WindowEndUtc, WindowStartUtc] — probing would require inventing a target value |
| `exchange` | `Get-ClientAccessRule` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-Clutter` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-CompromisedUserAggregateReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-CompromisedUserDetailReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-ConfigAnalyzerPolicyRecommendation` | requires mandatory parameter(s) [RecommendedPolicyType] — probing would require inventing a target value |
| `exchange` | `Get-ConnectorSyncStatsAggregationRequest` | requires mandatory parameter(s) [ConnectionLogicalId] — probing would require inventing a target value |
| `exchange` | `Get-ContentMalwareMdoAggregateReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-ContentMalwareMdoDetailReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-CrawlState` | requires mandatory parameter(s) [AssistantName] — probing would require inventing a target value |
| `exchange` | `Get-CrossTenantAccessPolicy` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-DataEncryptionPolicy` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-DetailZapReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-DeviceComplianceDetailsReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-DeviceComplianceSummaryReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-DeviceComplianceUserReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-DistributionGroupMember` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-DlpDetailReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-DlpDetectionsReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-DlpIncidentDetailReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-DlpSiDetectionsReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-DnssecStatusForVerifiedDomain` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-DynamicDistributionGroupMember` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-EvaluationModeReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-EventsFromEmailConfiguration` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-ExoConnectivityTableSnapshot` | requires mandatory parameter(s) [Organization] — probing would require inventing a target value |
| `exchange` | `Get-ExoInformationBarrierRelationship` | requires mandatory parameter(s) [RecipientId1, RecipientId2] — probing would require inventing a target value |
| `exchange` | `Get-ExoInformationBarrierRelationshipTable` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-ExoInformationBarrierUpgradeImpact` | requires mandatory parameter(s) [Organization] — probing would require inventing a target value |
| `exchange` | `Get-ExoPhishSimOverrideRule` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-ExoRecipientsStatus` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-ExoSecOpsOverrideRule` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-ExoSegmentsSnapshot` | requires mandatory parameter(s) [Organization] — probing would require inventing a target value |
| `exchange` | `Get-ExoUsersByIBSegment` | requires mandatory parameter(s) [Mode, Organization] — probing would require inventing a target value |
| `exchange` | `Get-FederationInformation` | requires mandatory parameter(s) [DomainName] — probing would require inventing a target value |
| `exchange` | `Get-FfoMigrationReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-HistoricalSearch` | excluded as unbounded against a live production tenant — message-trace family: unbounded historical search over live mail flow |
| `exchange` | `Get-HVEAccountBillingPolicy` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-HVEAccountSettings` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-IPv6StatusForAcceptedDomain` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-M365CrossTenantAccessPolicy` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-M365DataAtRestEncryptionPolicy` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-MailboxAnalysisRequestStatistics` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-MailboxAutoReplyConfiguration` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-MailboxCalendarFolder` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-MailboxFolderPermission` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-MailboxJunkEmailConfiguration` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-MailboxLocation` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-MailboxMessageConfiguration` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-MailboxPermission` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-MailboxUserConfiguration` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-MailDetailATPReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-MailDetailEncryptionReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-MailDetailEvaluationModeReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-MailDetailTransportRuleReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-MailFilterListReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-MailFlowStatusReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-MailTrafficATPReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-MailTrafficEncryptionReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-MailTrafficPolicyReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-MailTrafficSummaryReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-ManagementRoleEntry` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-MessageTrace` | excluded as unbounded against a live production tenant — message-trace family: unbounded time-range query over live mail flow |
| `exchange` | `Get-MessageTraceDetail` | excluded as unbounded against a live production tenant — message-trace family: unbounded time-range query over live mail flow |
| `exchange` | `Get-MessageTraceDetailV2` | requires mandatory parameter(s) [MessageTraceId, RecipientAddress] — probing would require inventing a target value |
| `exchange` | `Get-MessageTraceV2` | excluded as unbounded against a live production tenant — message-trace family: unbounded time-range query over live mail flow |
| `exchange` | `Get-MessageTrackingReport` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-MigrationUserStatistics` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-MobileDeviceDashboardSummaryReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-MobileDeviceStatistics` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-MoveRequestStatistics` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-MxRecordReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-MxRecordsReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-MyAnalyticsFeatureConfig` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-OutboundConnectorReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-PerimeterMessageTrace` | requires mandatory parameter(s) [Recipient] — probing would require inventing a target value |
| `exchange` | `Get-Place` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-PublicFolderClientPermission` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-PublicFolderItemStatistics` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-PublicFolderMailboxDiagnostics` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `exchange` | `Get-PublicFolderMailboxMigrationRequestStatistics` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-QuarantineMessageHeader` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-RecipientStatisticsReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-ReportSchedule` | requires mandatory parameter(s) [ScheduleId] — probing would require inventing a target value |
| `exchange` | `Get-RoleGroupMember` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-SafeLinksAggregateReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-SafeLinksDetailReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-ScopeEntities` | excluded as unbounded against a live production tenant — measured to hang past the container's child timeout AND wedge the parent listener until a manual revision restart (Git #1852); its real timed-out result is recorded in survey run #2 |
| `exchange` | `Get-SensitivityLabelActivityDetailsReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-SensitivityLabelActivityReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-ServiceDeliveryReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-SmtpDaneInboundStatus` | requires mandatory parameter(s) [DomainName] — probing would require inventing a target value |
| `exchange` | `Get-SpoofMailReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-SupervisoryReviewActivity` | requires mandatory parameter(s) [EndDate, PolicyId, StartDate] — probing would require inventing a target value |
| `exchange` | `Get-SupervisoryReviewPolicyReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-SupervisoryReviewReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `exchange` | `Get-SyncRequestStatistics` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-TDPReport` | requires mandatory parameter(s) [ReportType] — probing would require inventing a target value |
| `exchange` | `Get-TenantAllowBlockListItems` | requires mandatory parameter(s) [ListType] — probing would require inventing a target value |
| `exchange` | `Get-TenantExemptionInfo` | requires mandatory parameter(s) [BlockingScenario] — probing would require inventing a target value |
| `exchange` | `Get-TenantExemptionQuota` | requires mandatory parameter(s) [BlockingScenario] — probing would require inventing a target value |
| `exchange` | `Get-TenantExemptionQuotaEligibility` | requires mandatory parameter(s) [BlockingScenario] — probing would require inventing a target value |
| `exchange` | `Get-TenantRecipientLimitInfo` | requires mandatory parameter(s) [BlockingScenario] — probing would require inventing a target value |
| `exchange` | `Get-ToolInformation` | requires mandatory parameter(s) [Identity, Version] — probing would require inventing a target value |
| `exchange` | `Get-UnifiedAuditSetting` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-UnifiedGroupLinks` | requires mandatory parameter(s) [Identity, LinkType] — probing would require inventing a target value |
| `exchange` | `Get-UserBriefingConfig` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-VivaInsightsSettings` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `exchange` | `Get-VivaModuleFeature` | requires mandatory parameter(s) [ModuleId] — probing would require inventing a target value |
| `exchange` | `Get-VivaModuleFeatureEnablement` | requires mandatory parameter(s) [ModuleId, FeatureId, Identity] — probing would require inventing a target value |
| `exchange` | `Get-VivaModuleFeaturePolicy` | requires mandatory parameter(s) [ModuleId] — probing would require inventing a target value |
| `exchange` | `Get-VivaOrgInsightsDelegatedRole` | requires mandatory parameter(s) [Delegator] — probing would require inventing a target value |
| `exchange` | `Get-WorkforceInsightsDelegationAccess` | requires mandatory parameter(s) [Delegator] — probing would require inventing a target value |
| `exchange` | `Invoke-ChangeMeetingOrganizer` | Invoke-* is not a read verb (survey executes Get-* only) |
| `exchange` | `IsCloudShellEnvironment` | non-verb-noun command is not a read verb (survey executes Get-* only) |
| `exchange` | `New-ProtectionServicePolicy` | New-* is not a read verb (survey executes Get-* only) |
| `exchange` | `New-TenantExemptionInfo` | New-* is not a read verb (survey executes Get-* only) |
| `exchange` | `New-TenantExemptionQuota` | New-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Remove-ExoInformationBarriersV1Configuration` | Remove-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Remove-HVEAppAccess` | Remove-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Remove-M365CrossTenantAccessPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Remove-PublicFolderMailboxMigrationRequest` | Remove-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Remove-VivaModuleFeaturePolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Remove-VivaOrgInsightsDelegatedRole` | Remove-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Remove-WorkforceInsightsDelegationAccess` | Remove-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Reset-EventsFromEmailBlockStatus` | Reset-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Search-MessageTrackingReport` | Search-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Set-DefaultTenantBriefingConfig` | Set-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Set-DefaultTenantMyAnalyticsFeatureConfig` | Set-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Set-EventsFromEmailConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Set-ExternalInOutlook` | Set-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Set-LabelProperties` | Set-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Set-MyAnalyticsFeatureConfig` | Set-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Set-ProtectionServicePolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Set-RegulatoryComplianceUI` | Set-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Set-ReportSchedule` | Set-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Set-SmimeConfig` | Set-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Set-UnifiedAuditSetting` | Set-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Set-UserBriefingConfig` | Set-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Set-VivaInsightsSettings` | Set-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Start-AuditAssistant` | Start-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Start-HistoricalSearch` | Start-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Stop-HistoricalSearch` | Stop-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Test-ApplicationAccessPolicy` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `exchange` | `Test-ClientAccessRule` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `exchange` | `Test-DatabaseEvent` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `exchange` | `Test-DataEncryptionPolicy` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `exchange` | `Test-DlpPolicies` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `exchange` | `Test-M365DataAtRestEncryptionPolicy` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `exchange` | `Test-MailboxAssistant` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `exchange` | `Test-Message` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `exchange` | `Test-OrganizationRelationship` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `exchange` | `Troubleshoot-AgendaMail` | Troubleshoot-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Update-VivaModuleFeaturePolicy` | Update-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Validate-CrawlFilter` | Validate-* is not a read verb (survey executes Get-* only) |
| `exchange` | `Validate-RetentionRuleQuery` | Validate-* is not a read verb (survey executes Get-* only) |
| `teams` | `Add-TeamChannelUser` | Add-* is not a read verb (survey executes Get-* only) |
| `teams` | `Add-TeamUser` | Add-* is not a read verb (survey executes Get-* only) |
| `teams` | `Clear-CsOnlineTelephoneNumberOrder` | Clear-* is not a read verb (survey executes Get-* only) |
| `teams` | `Clear-TeamsEnvironmentConfig` | Clear-* is not a read verb (survey executes Get-* only) |
| `teams` | `Complete-CsOnlineTelephoneNumberOrder` | Complete-* is not a read verb (survey executes Get-* only) |
| `teams` | `Connect-MicrosoftTeams` | Connect-* is not a read verb (survey executes Get-* only) |
| `teams` | `Disable-CsOnlineSipDomain` | Disable-* is not a read verb (survey executes Get-* only) |
| `teams` | `Disconnect-MicrosoftTeams` | Disconnect-* is not a read verb (survey executes Get-* only) |
| `teams` | `Enable-CsOnlineSipDomain` | Enable-* is not a read verb (survey executes Get-* only) |
| `teams` | `Export-CsAcquiredPhoneNumber` | Export-* is not a read verb (survey executes Get-* only) |
| `teams` | `Export-CsAutoAttendantHolidays` | Export-* is not a read verb (survey executes Get-* only) |
| `teams` | `Export-CsOnlineAudioFile` | Export-* is not a read verb (survey executes Get-* only) |
| `teams` | `Find-CsGroup` | Find-* is not a read verb (survey executes Get-* only) |
| `teams` | `Find-CsOnlineApplicationInstance` | Find-* is not a read verb (survey executes Get-* only) |
| `teams` | `Get-AIGeneratedKnowledgeContainer` | requires mandatory parameter(s) [ThreadId] — probing would require inventing a target value |
| `teams` | `Get-CsAiAgents` | requires mandatory parameter(s) [ProviderId] — probing would require inventing a target value |
| `teams` | `Get-CsAutoAttendantHolidays` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `teams` | `Get-CsAutoAttendantStatus` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `teams` | `Get-CsBatchTeamsDeploymentStatus` | requires mandatory parameter(s) [OrchestrationId] — probing would require inventing a target value |
| `teams` | `Get-CsCloudCallDataConnection` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `teams` | `Get-CsEffectiveTenantDialPlan` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `teams` | `Get-CsExportAcquiredPhoneNumberStatus` | requires mandatory parameter(s) [OrderId] — probing would require inventing a target value |
| `teams` | `Get-CsMeetingMigrationStatus` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `teams` | `Get-CsOnlineApplicationInstance` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `teams` | `Get-CsOnlineApplicationInstanceAssociation` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `teams` | `Get-CsOnlineApplicationInstanceAssociationStatus` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `teams` | `Get-CsOnlineDirectoryTenant` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `teams` | `Get-CsOnlineEnhancedEmergencyServiceDisclaimer` | requires mandatory parameter(s) [CountryOrRegion] — probing would require inventing a target value |
| `teams` | `Get-CsOnlineTelephoneNumberOrder` | requires mandatory parameter(s) [OrderId] — probing would require inventing a target value |
| `teams` | `Get-CsOnlineTelephoneNumberType` | requires mandatory parameter(s) [Country] — probing would require inventing a target value |
| `teams` | `Get-CsOnlineVoicemailUserSettings` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `teams` | `Get-CsPersonalAttendantSettings` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `teams` | `Get-CsSdgBulkSignInRequestStatus` | requires mandatory parameter(s) [Batchid] — probing would require inventing a target value |
| `teams` | `Get-CsTeamsSettingsCustomApp` | declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established |
| `teams` | `Get-CsTeamsShiftsConnectionErrorReport` | excluded as unbounded against a live production tenant — tenant-wide reporting cmdlet: unbounded aggregation over live tenant history |
| `teams` | `Get-CsTeamsShiftsConnectionOperation` | requires mandatory parameter(s) [OperationId] — probing would require inventing a target value |
| `teams` | `Get-CsTeamsShiftsConnectionSyncResult` | requires mandatory parameter(s) [InputObject] — probing would require inventing a target value |
| `teams` | `Get-CsTeamsShiftsConnectionTeamMap` | requires mandatory parameter(s) [ConnectorInstanceId] — probing would require inventing a target value |
| `teams` | `Get-CsTeamsShiftsConnectionWfmTeam` | requires mandatory parameter(s) [ConnectorInstanceId] — probing would require inventing a target value |
| `teams` | `Get-CsTeamsShiftsConnectionWfmUser` | requires mandatory parameter(s) [InputObject] — probing would require inventing a target value |
| `teams` | `Get-CsTeamTemplate` | requires mandatory parameter(s) [OdataId] — probing would require inventing a target value |
| `teams` | `Get-CsUserCallingSettings` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `teams` | `Get-CsUserPolicyAssignment` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `teams` | `Get-CsUserPolicyPackage` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `teams` | `Get-CsUserPolicyPackageRecommendation` | requires mandatory parameter(s) [Identity] — probing would require inventing a target value |
| `teams` | `Get-GroupAssignmentRecommendationsPerPolicyName` | requires mandatory parameter(s) [EntityType, PolicyType] — probing would require inventing a target value |
| `teams` | `Get-GroupAssignmentRecommendationsPerPolicyType` | requires mandatory parameter(s) [EntityType] — probing would require inventing a target value |
| `teams` | `Get-GroupPolicyAssignmentConflict` | requires mandatory parameter(s) [GroupId, PolicyType] — probing would require inventing a target value |
| `teams` | `Get-M365TeamsApp` | requires mandatory parameter(s) [Id] — probing would require inventing a target value |
| `teams` | `Get-MultiGeoRegion` | requires mandatory parameter(s) [EntityId, EntityType] — probing would require inventing a target value |
| `teams` | `Get-Operation` | requires mandatory parameter(s) [GroupId, OperationId] — probing would require inventing a target value |
| `teams` | `Get-SharedWithTeam` | requires mandatory parameter(s) [HostTeamId, ChannelId] — probing would require inventing a target value |
| `teams` | `Get-SharedWithTeamUser` | requires mandatory parameter(s) [HostTeamId, ChannelId, SharedWithTeamId] — probing would require inventing a target value |
| `teams` | `Get-TeamAllChannel` | requires mandatory parameter(s) [GroupId] — probing would require inventing a target value |
| `teams` | `Get-TeamChannel` | requires mandatory parameter(s) [GroupId] — probing would require inventing a target value |
| `teams` | `Get-TeamChannelUser` | requires mandatory parameter(s) [GroupId, DisplayName] — probing would require inventing a target value |
| `teams` | `Get-TeamIncomingChannel` | requires mandatory parameter(s) [GroupId] — probing would require inventing a target value |
| `teams` | `Get-TeamUser` | requires mandatory parameter(s) [GroupId] — probing would require inventing a target value |
| `teams` | `Grant-CsApplicationAccessPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsCallingLineIdentity` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsDialoutPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsExternalAccessPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsGroupPolicyPackageAssignment` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsOnlineAudioConferencingRoutingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsOnlineVoicemailPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsOnlineVoiceRoutingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsAIPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsAppPermissionPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsAppSetupPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsAudioConferencingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsBYODAndDesksPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsCallHoldPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsCallingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsCallParkPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsCarrierEmergencyCallRoutingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsChannelsPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsComplianceRecordingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsCortanaPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsEmergencyCallingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsEmergencyCallRoutingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsEnhancedEncryptionPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsEventsPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsFeedbackPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsFilesPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsIPPhonePolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsMediaConnectivityPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsMediaLoggingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsMeetingBrandingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsMeetingBroadcastPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsMeetingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsMeetingTemplatePermissionPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsMessagingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsMobilityPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsPersonalAttendantPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsRecordingRollOutPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsRoomVideoTeleConferencingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsSharedCallingRoutingPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsShiftsPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsSurvivableBranchAppliancePolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsUpdateManagementPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsUpgradePolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsVdiPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsVideoInteropServicePolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsVirtualAppointmentsPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsVoiceApplicationsPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsWorkLoadPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTeamsWorkLocationDetectionPolicy` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsTenantDialPlan` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Grant-CsUserPolicyPackage` | Grant-* is not a read verb (survey executes Get-* only) |
| `teams` | `Import-CsAutoAttendantHolidays` | Import-* is not a read verb (survey executes Get-* only) |
| `teams` | `Import-CsOnlineAudioFile` | Import-* is not a read verb (survey executes Get-* only) |
| `teams` | `Invoke-ClearDirectToGroupAssignmentMigration` | Invoke-* is not a read verb (survey executes Get-* only) |
| `teams` | `Invoke-CsInternalPsTelemetry` | Invoke-* is not a read verb (survey executes Get-* only) |
| `teams` | `Invoke-StartDirectToGroupAssignmentMigration` | Invoke-* is not a read verb (survey executes Get-* only) |
| `teams` | `Move-CsInternalHelper` | Move-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsAgent` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsApplicationAccessPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsAutoAttendant` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsAutoAttendantCallableEntity` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsAutoAttendantCallFlow` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsAutoAttendantCallHandlingAssociation` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsAutoAttendantDialScope` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsAutoAttendantMenu` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsAutoAttendantMenuOption` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsAutoAttendantPrompt` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsAutoRecordingTemplate` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsBatchPolicyAssignmentOperation` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsBatchPolicyPackageAssignmentOperation` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsBatchTeamsDeployment` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsCallingLineIdentity` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsCallQueue` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsCloudCallDataConnection` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsComplianceRecordingForCallQueueTemplate` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsCustomPolicyPackage` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsCustomPrompt` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsCustomPromptPackage` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsEdgeAllowAllKnownDomains` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsEdgeAllowList` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsEdgeDomainPattern` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsExternalAccessPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsGroupPolicyAssignment` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsHybridTelephoneNumber` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsInboundBlockedNumberPattern` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsInboundExemptNumberPattern` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsLocationPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsMainlineAttendantAppointmentBookingFlow` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsMainlineAttendantQuestionAnswerFlow` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineApplicationInstance` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineApplicationInstanceAssociation` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineAudioConferencingRoutingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineDateTimeRange` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineDirectRoutingTelephoneNumberUploadOrder` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineLisCivicAddress` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineLisLocation` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlinePSTNGateway` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineSchedule` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineTelephoneNumberOrder` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineTelephoneNumberReleaseOrder` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineTimeRange` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineVoicemailPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineVoiceRoute` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsOnlineVoiceRoutingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsPhoneNumberBulkUpdateDrNumberAcquiredCapabilitiesOrder` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsPhoneNumberBulkUpdateLocationIdOrder` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsPhoneNumberBulkUpdateNetworkSiteIdOrder` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsPhoneNumberBulkUpdateReverseNumberLookupOrder` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsPhoneNumberBulkUpdateTagsOrder` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsSdgBulkSignInRequest` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsSharedCallHistoryTemplate` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsSharedCallQueueHistoryTemplate` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsSharedVoicemailTriageSettingsTemplate` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTag` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTagsTemplate` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsAIPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsAppPermissionPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsAppSetupPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsAudioConferencingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsBYODAndDesksPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsCallHoldPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsCallingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsCallParkPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsCarrierEmergencyCallRoutingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsChannelsPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsComplianceRecordingApplication` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsComplianceRecordingPairedApplication` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsComplianceRecordingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsCortanaPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsCustomBannerText` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsEmergencyCallingExtendedNotification` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsEmergencyCallingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsEmergencyCallRoutingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsEmergencyNumber` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsEnhancedEncryptionPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsEventsPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsFeedbackPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsFilesPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsHiddenMeetingTemplate` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsHiddenTemplate` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsIPPhonePolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsMediaConnectivityPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsMeetingBackgroundImage` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsMeetingBrandingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsMeetingBrandingTheme` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsMeetingBroadcastPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsMeetingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsMeetingTemplatePermissionPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsMessagingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsMobilityPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsNdiAssuranceSlate` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsNetworkRoamingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsPersonalAttendantPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsRecordingAndTranscriptionCustomMessage` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsRecordingAndTranscriptionLocalizationCustomMessage` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsRecordingRollOutPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsRemoteLogCollectionDevice` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsRoomVideoTeleConferencingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsSharedCallingRoutingPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsShiftsConnection` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsShiftsConnectionBatchTeamMap` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsShiftsConnectionInstance` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsShiftsPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsSurvivableBranchAppliance` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsSurvivableBranchAppliancePolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsTemplatePermissionPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsTranslationRule` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsUnassignedNumberTreatment` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsUpdateManagementPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsVdiPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsVirtualAppointmentsPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsVoiceApplicationsPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsWorkLoadPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamsWorkLocationDetectionPolicy` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTeamTemplate` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTenantDialPlan` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTenantNetworkRegion` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTenantNetworkSite` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTenantNetworkSubnet` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsTenantTrustedIPAddress` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsUserCallingDelegate` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsVideoInteropServiceProvider` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-CsVoiceNormalizationRule` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-Team` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-TeamChannel` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `New-TeamsApp` | New-* is not a read verb (survey executes Get-* only) |
| `teams` | `Register-CsOnlineDialInConferencingServiceNumber` | Register-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-AIGeneratedKnowledge` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsAgent` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsApplicationAccessPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsAutoAttendant` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsAutoRecordingTemplate` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsCallingLineIdentity` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsCallQueue` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsComplianceRecordingForCallQueueTemplate` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsCustomPolicyPackage` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsExternalAccessPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsGroupPolicyAssignment` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsHybridTelephoneNumber` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsInboundBlockedNumberPattern` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsInboundExemptNumberPattern` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsLocationPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsMainlineAttendantAppointmentBookingFlow` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsMainlineAttendantQuestionAnswerFlow` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineApplicationInstanceAssociation` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineAudioConferencingRoutingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineAudioFile` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineDialInConferencingTenantSettings` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineLisCivicAddress` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineLisLocation` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineLisPort` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineLisSubnet` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineLisSwitch` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineLisWirelessAccessPoint` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlinePSTNGateway` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineSchedule` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineTelephoneNumber` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineVoicemailPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineVoiceRoute` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsOnlineVoiceRoutingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsPhoneNumberAssignment` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsPhoneNumberAssignmentBlock` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsPhoneNumberSmsActivation` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsPhoneNumberTag` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsPhoneNumberTenantConfiguration` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsSharedCallHistoryTemplate` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsSharedCallQueueHistoryTemplate` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsSharedVoicemailTriageSettingsTemplate` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTagsTemplate` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsAIPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsAppPermissionPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsAppSetupPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsAudioConferencingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsBYODAndDesksPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsCallHoldPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsCallingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsCallParkPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsCarrierEmergencyCallRoutingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsChannelsPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsComplianceRecordingApplication` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsComplianceRecordingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsCortanaPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsCustomBannerText` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsEmergencyCallingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsEmergencyCallRoutingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsEnhancedEncryptionPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsEventsPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsFeedbackPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsFilesPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsIPPhonePolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsMediaConnectivityPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsMeetingBrandingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsMeetingBroadcastPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsMeetingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsMeetingTemplatePermissionPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsMessagingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsMobilityPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsNetworkRoamingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsNotificationAndFeedsPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsPersonalAttendantPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsRecordingAndTranscriptionCustomMessage` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsRecordingRollOutPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsRemoteLogCollectionDevice` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsRoomVideoTeleConferencingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsSharedCallingRoutingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsShiftsConnection` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsShiftsConnectionInstance` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsShiftsConnectionTeamMap` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsShiftsPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsShiftsScheduleRecord` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsSurvivableBranchAppliance` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsSurvivableBranchAppliancePolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsTargetingPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsTemplatePermissionPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsTranslationRule` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsUnassignedNumberTreatment` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsUpdateManagementPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsVdiPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsVirtualAppointmentsPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsVoiceApplicationsPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsWorkLoadPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamsWorkLocationDetectionPolicy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTeamTemplate` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTenantDialPlan` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTenantNetworkRegion` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTenantNetworkSite` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTenantNetworkSubnet` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsTenantTrustedIPAddress` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsUserCallingDelegate` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsUserLicenseGracePeriod` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-CsVideoInteropServiceProvider` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-SharedWithTeam` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-Team` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-TeamChannel` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-TeamChannelUser` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-TeamsApp` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-TeamTargetingHierarchy` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Remove-TeamUser` | Remove-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsAgent` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsApplicationAccessPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsApplicationMeetingConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsAutoAttendant` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsAutoRecordingTemplate` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsCallingLineIdentity` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsCallQueue` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsComplianceRecordingForCallQueueTemplate` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsExternalAccessPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsInboundBlockedNumberPattern` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsInboundExemptNumberPattern` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsLocationPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsMainlineAttendantAppointmentBookingFlow` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsMainlineAttendantQuestionAnswerFlow` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineApplicationInstance` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineAudioConferencingRoutingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineDialInConferencingBridge` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineDialInConferencingServiceNumber` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineDialInConferencingTenantSettings` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineDialInConferencingUser` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineEnhancedEmergencyServiceDisclaimer` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineLisCivicAddress` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineLisLocation` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineLisPort` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineLisSubnet` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineLisSwitch` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineLisWirelessAccessPoint` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlinePSTNGateway` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlinePstnUsage` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineSchedule` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineVoiceApplicationInstance` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineVoicemailPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineVoicemailUserSettings` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineVoicemailValidationConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineVoiceRoute` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineVoiceRoutingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsOnlineVoiceUser` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsPersonalAttendantSettings` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsPhoneNumberAssignment` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsPhoneNumberAssignmentBlock` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsPhoneNumberPolicyAssignment` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsPhoneNumberSmsActivation` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsPhoneNumberTag` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsPhoneNumberTenantConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsPrivacyConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsSharedCallHistoryTemplate` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsSharedCallQueueHistoryTemplate` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsSharedVoicemailTriageSettingsTemplate` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTagsTemplate` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsAcsFederationConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsAIPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsAppPermissionPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsAppSetupPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsAudioConferencingCustomPromptsConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsAudioConferencingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsBYODAndDesksPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsCallHoldPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsCallingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsCallParkPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsCarrierEmergencyCallRoutingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsChannelsPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsClientConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsComplianceRecordingApplication` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsComplianceRecordingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsCortanaPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsCustomBannerText` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsEducationAssignmentsAppPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsEducationConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsEmergencyCallingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsEmergencyCallRoutingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsEnhancedEncryptionPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsEventsPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsExternalAccessConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsFeedbackPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsFilesPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsFirstPartyMeetingTemplateConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsGuestCallingConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsGuestMeetingConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsGuestMessagingConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsIPPhonePolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsMediaConnectivityPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsMeetingBrandingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsMeetingBroadcastConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsMeetingBroadcastPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsMeetingConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsMeetingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsMeetingTemplatePermissionPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsMessagingConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsMessagingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsMigrationConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsMobilityPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsMultiTenantOrganizationConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsNetworkRoamingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsNotificationAndFeedsPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsPersonalAttendantPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsRecordingAndTranscriptionCustomMessage` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsRecordingRollOutPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsRemoteLogCollectionDevice` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsRoomVideoTeleConferencingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsSettingsCustomApp` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsSharedCallingRoutingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsShiftsAppPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsShiftsConnection` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsShiftsConnectionInstance` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsShiftsPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsSipDevicesConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsSurvivableBranchAppliance` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsSurvivableBranchAppliancePolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsTargetingPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsTemplatePermissionPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsTenantAbuseConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsTranslationRule` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsUnassignedNumberTreatment` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsUpdateManagementPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsUpgradeConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsVdiPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsVirtualAppointmentsPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsVoiceApplicationsPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsWorkLoadPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTeamsWorkLocationDetectionPolicy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTenantBlockedCallingNumbers` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTenantDialPlan` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTenantFederationConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTenantMigrationConfiguration` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTenantNetworkRegion` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTenantNetworkSite` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTenantNetworkSubnet` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsTenantTrustedIPAddress` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsUser` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsUserCallingDelegate` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsUserCallingSettings` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-CsVideoInteropServiceProvider` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-Team` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-TeamArchivedState` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-TeamChannel` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-TeamPicture` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-TeamsApp` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-TeamsEnvironmentConfig` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Set-TeamTargetingHierarchy` | Set-* is not a read verb (survey executes Get-* only) |
| `teams` | `Start-CsExMeetingMigration` | Start-* is not a read verb (survey executes Get-* only) |
| `teams` | `Sync-CsOnlineApplicationInstance` | Sync-* is not a read verb (survey executes Get-* only) |
| `teams` | `Test-CsEffectiveTenantDialPlan` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `teams` | `Test-CsInboundBlockedNumberPattern` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `teams` | `Test-CsTeamsShiftsConnectionValidate` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `teams` | `Test-CsTeamsTranslationRule` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `teams` | `Test-CsTeamsUnassignedNumberTreatment` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `teams` | `Test-CsVoiceNormalizationRule` | Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state) |
| `teams` | `Unregister-CsOnlineDialInConferencingServiceNumber` | Unregister-* is not a read verb (survey executes Get-* only) |
| `teams` | `Update-CsAutoAttendant` | Update-* is not a read verb (survey executes Get-* only) |
| `teams` | `Update-CsCustomPolicyPackage` | Update-* is not a read verb (survey executes Get-* only) |
| `teams` | `Update-CsPhoneNumberTag` | Update-* is not a read verb (survey executes Get-* only) |
| `teams` | `Update-CsTeamsShiftsConnection` | Update-* is not a read verb (survey executes Get-* only) |
| `teams` | `Update-CsTeamsShiftsConnectionInstance` | Update-* is not a read verb (survey executes Get-* only) |
| `teams` | `Update-CsTeamTemplate` | Update-* is not a read verb (survey executes Get-* only) |
| `teams` | `Update-M365TeamsApp` | Update-* is not a read verb (survey executes Get-* only) |
| `teams` | `Update-M365UnifiedCustomPendingApp` | Update-* is not a read verb (survey executes Get-* only) |
| `teams` | `Update-M365UnifiedTenantSettings` | Update-* is not a read verb (survey executes Get-* only) |

## How to re-run this

```
# 1. Deploy the container (the survey code is in services/ps-execution/survey.ps1):
az acr build --registry acrsmccaw2184 --image ps-execution:dev services/ps-execution
az containerapp update -n ca-ps-execution-dev -g rg-smccaw-2184 \
  --image acrsmccaw2184.azurecr.io/ps-execution:dev --revision-suffix <suffix>

# 2. Run the survey (writes ps_capability_survey_runs / _results):
pnpm --filter @workspace/scripts run ps-capability-survey

# 3. Regenerate this document from what landed in the database:
pnpm --filter @workspace/scripts run ps-capability-survey-doc
```

Read it back over HTTP with `GET /api/simulator/ps-execution/capability-survey` (`?runId=`, `?session=`, `?status=`, `?cmdlet=`).
