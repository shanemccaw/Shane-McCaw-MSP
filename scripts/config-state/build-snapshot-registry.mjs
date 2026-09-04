#!/usr/bin/env node
/**
 * #1795 — Populate `config_snapshot_resource_types`, the snapshot store's registry of
 * what the collector (#1796) is allowed to collect.
 *
 * Nothing here calls Microsoft. Every input is already in the local database:
 * `config_resources` and `config_resource_properties` (from #1794), the Graph type
 * model (`graph_entity_types`), and `ps_capability_survey_results` (from #1793).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS SCRIPT NEVER DELETES. It is the deliberate opposite of
 * `build-resource-model.mjs`, which wholesale-DELETEs its tables on every run and
 * thereby destroyed accumulated live evidence (Git #1895).
 *
 * The registry is UPSERTed by `resource_key`. A resource that disappears from
 * `config_resources` is RETIRED — marked non-collectable with the reason recorded —
 * never removed, because past snapshots reference `resource_key` by text and deleting
 * the row would strip the meaning from evidence that is supposed to be immutable.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The one fact this script authors that no published source states is the IDENTITY
 * STRATEGY — how an object of this type gets a key that is stable across snapshots.
 * Without it #1797's differ cannot pair objects between two points in time, and every
 * object would read as deleted-and-recreated. Derivation, all of it evidence-based:
 *
 *   graph, single object      -> graph-singleton  (the path IS the identity)
 *   graph, collection         -> graph-id, from the entity type's CSDL <Key>, resolved
 *                                by walking BaseType up to `microsoft.graph.entity`
 *                                (subtypes inherit the key rather than redeclaring it:
 *                                `device` and `servicePrincipal` both have an empty
 *                                own key and inherit `id` from `graph.entity`)
 *   powershell / SP / ARM /   -> dsc-identity from the DSC `Identity` parameter, or
 *   power-platform               from the MOF Key properties; composite-key when there
 *                                is more than one
 *   anything unresolved       -> `unresolved`, and therefore NOT collectable
 *
 * `unresolved` is a real, expected outcome and is left standing rather than papered
 * over with a row number. A CHECK constraint refuses to let such a type be marked
 * collectable, so the honest gap cannot turn into false diff churn later.
 *
 * Usage: node scripts/config-state/build-snapshot-registry.mjs [--dry-run]
 */
import { connect } from "./db.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Transports this platform has an executor for. Mirrors EXECUTOR_BACKED_TRANSPORTS in
 * lib/db/src/schema/config-state.ts, which derives from MONITOR_CHECK_EXECUTOR_TYPES.
 * Git #1849: azure-rm and power-platform have no executor, so their resources are
 * unreachable by any code path and are registered non-collectable for that reason.
 */
const EXECUTOR_BACKED = new Set(["graph", "powershell", "sharepoint-admin", "dns"]);

/**
 * Git #2841 — `powershell` transport being in EXECUTOR_BACKED means the platform has
 * *an* executor for the transport in general; it does not mean any given row's own
 * `read_cmdlets` is actually invokable through it. `collectPowerShellResource()` in
 * config-snapshot-collector.ts only calls a cmdlet the ps-execution container has an
 * unfiltered catalog entry for (`PS_CATALOG_BY_CMDLET`) — everything else returns
 * `skipReason: "no_executor"` at run time, forever, no matter how many snapshots run.
 * Mirrors PS_CATALOG_BY_CMDLET's KEYS (same convention as EXECUTOR_BACKED mirroring
 * EXECUTOR_BACKED_TRANSPORTS above) so the registry can make the same call the
 * collector makes, without this plain Node script importing api-server's TS. Keep in
 * sync by hand when that catalog changes; only membership matters here, not the
 * catalog's own (cmdlet -> container key) values.
 *
 * Git #2850 re-synced this set after pass 2 added 57 Microsoft Teams `Get-Cs*` entries
 * (87 -> 144 keys). Re-run this script after any catalog change: it is what turns a new
 * catalog entry into `is_collectable = true` on the rows that name that cmdlet.
 */
const PS_CATALOG_CMDLETS = new Set([
  "Get-AcceptedDomain", "Get-ActiveSyncDeviceAccessRule", "Get-AddressBookPolicy",
  "Get-AdminAuditLogConfig", "Get-AntiPhishPolicy", "Get-AntiphishRule", "Get-AntiPhishRule",
  "Get-ArcConfig", "Get-ATPBuiltInProtectionRule", "Get-AtpPolicyForO365",
  "Get-ATPProtectionPolicyRule", "Get-AuthenticationPolicy", "Get-CASMailboxPlan",
  "Get-ComplianceRetentionEventType", "Get-ComplianceTag", "Get-CsCallQueue",
  "Get-CsGroupPolicyAssignment", "Get-CsOnlineDialInConferencingTenantSettings",
  "Get-CsOnlinePSTNGateway", "Get-CsOnlinePstnUsage", "Get-CsOnlineUser",
  "Get-CsOnlineVoicemailPolicy", "Get-CsOnlineVoiceRoute", "Get-CsOnlineVoiceRoutingPolicy",
  "Get-CsPhoneNumberAssignment", "Get-CsTeamsAIPolicy", "Get-CsTeamsAppPermissionPolicy",
  "Get-CsTeamsAppSetupPolicy", "Get-CsTeamsAudioConferencingPolicy", "Get-CsTeamsCallHoldPolicy",
  "Get-CsTeamsCallingPolicy", "Get-CsTeamsCallParkPolicy", "Get-CsTeamsChannelsPolicy",
  "Get-CsTeamsClientConfiguration", "Get-CsTeamsComplianceRecordingApplication",
  "Get-CsTeamsComplianceRecordingPolicy", "Get-CsTeamsCortanaPolicy",
  "Get-CsTeamsEmergencyCallingPolicy", "Get-CsTeamsEmergencyCallRoutingPolicy",
  "Get-CsTeamsEnhancedEncryptionPolicy", "Get-CsTeamsEventsPolicy", "Get-CsTeamsFeedbackPolicy",
  "Get-CsTeamsFilesPolicy", "Get-CsTeamsGuestCallingConfiguration",
  "Get-CsTeamsGuestMeetingConfiguration", "Get-CsTeamsGuestMessagingConfiguration",
  "Get-CsTeamsIPPhonePolicy", "Get-CsTeamsMeetingBroadcastConfiguration",
  "Get-CsTeamsMeetingBroadcastPolicy", "Get-CsTeamsMeetingConfiguration",
  "Get-CsTeamsMeetingPolicy", "Get-CsTeamsMessagingConfiguration", "Get-CsTeamsMessagingPolicy",
  "Get-CsTeamsMobilityPolicy", "Get-CsTeamsNetworkRoamingPolicy",
  "Get-CsTeamsNotificationAndFeedsPolicy", "Get-CsTeamsShiftsPolicy",
  "Get-CsTeamsTargetingPolicy", "Get-CsTeamsTemplatePermissionPolicy",
  "Get-CsTeamsTranslationRule", "Get-CsTeamsUnassignedNumberTreatment",
  "Get-CsTeamsUpdateManagementPolicy", "Get-CsTeamsUpgradeConfiguration",
  "Get-CsTeamsUpgradePolicy", "Get-CsTeamsVdiPolicy", "Get-CsTeamsWorkLoadPolicy",
  "Get-CsTeamTemplateList", "Get-CsTenantDialPlan", "Get-CsTenantFederationConfiguration",
  "Get-CsTenantNetworkRegion", "Get-CsTenantNetworkSite", "Get-CsTenantNetworkSubnet",
  "Get-CsTenantTrustedIPAddress", "Get-DataClassification", "Get-DeviceConditionalAccessPolicy",
  "Get-DeviceConditionalAccessRule", "Get-DeviceConfigurationPolicy",
  "Get-DeviceConfigurationRule", "Get-DkimSigningConfig", "Get-DlpCompliancePolicy",
  "Get-DLPCompliancePolicy", "Get-DlpComplianceRule", "Get-DLPComplianceRule",
  "Get-DlpSensitiveInformationType", "Get-DLPSensitiveInformationType",
  "Get-DlpSensitiveInformationTypeRulePackage", "Get-DLPSensitiveInformationTypeRulePackage",
  "Get-EmailTenantSettings", "Get-EOPProtectionPolicyRule", "Get-FilePlanPropertyAuthority",
  "Get-FilePlanPropertyCategory", "Get-FilePlanPropertyCitation",
  "Get-FilePlanPropertyDepartment", "Get-FilePlanPropertyReferenceId",
  "Get-FilePlanPropertySubCategory", "Get-HostedConnectionFilterPolicy",
  "Get-HostedContentFilterPolicy", "Get-HostedContentFilterRule",
  "Get-HostedOutboundSpamFilterPolicy", "Get-HostedOutboundSpamFilterRule",
  "Get-InboundConnector", "Get-IntraOrganizationConnector", "Get-IRMConfiguration",
  "Get-JournalRule", "Get-Label", "Get-LabelPolicy", "Get-MailboxPlan", "Get-MalwareFilterPolicy",
  "Get-MalwareFilterRule", "Get-ManagementScope", "Get-MigrationEndpoint",
  "Get-MobileDeviceMailboxPolicy", "Get-OnPremisesOrganization", "Get-OrganizationConfig",
  "Get-OrganizationRelationship", "Get-OutboundConnector", "Get-OutBoundConnector",
  "Get-OwaMailboxPolicy", "Get-PartnerApplication", "Get-PerimeterConfig", "Get-PolicyConfig",
  "Get-PolicyTipConfig", "Get-ProtectionAlert", "Get-QuarantinePolicy", "Get-RemoteDomain",
  "Get-ReportSubmissionPolicy", "Get-ReportSubmissionRule", "Get-RetentionCompliancePolicy",
  "Get-RetentionComplianceRule", "Get-RetentionPolicy", "Get-RetentionPolicyTag",
  "Get-RoleAssignmentPolicy", "Get-RoleGroup", "Get-SafeAttachmentPolicy",
  "Get-SafeAttachmentRule", "Get-SafeLinksPolicy", "Get-SafeLinksRule", "Get-SharingPolicy",
  "Get-SupervisoryReviewPolicyV2", "Get-SupervisoryReviewRule",
  "Get-TenantAllowBlockListSpoofItems", "Get-TransportConfig", "Get-TransportRule",
  "Get-UnifiedAuditLogRetentionPolicy",
]);

/** Mirrors PS_NON_READ_HELPER_CMDLETS in config-snapshot-collector.ts (Git #2841). */
const PS_NON_READ_HELPER_CMDLETS = new Set([
  "Get-CompareParameters",
  "Get-MSCloudLoginConnectionProfile",
  "Get-MgGroup",
  "Get-MgUser",
]);

/**
 * Whether at least one of this row's `read_cmdlets` is actually reachable through the
 * ps-execution container, mirroring `collectPowerShellResource()`'s own filter+lookup.
 */
function hasCatalogedPsCmdlet(readCmdlets) {
  const cmdlets = (Array.isArray(readCmdlets) ? readCmdlets : []).filter(
    (c) => !PS_NON_READ_HELPER_CMDLETS.has(c),
  );
  return cmdlets.some((c) => PS_CATALOG_CMDLETS.has(c));
}

/**
 * Collection order. Cheap and certainly-readable resources run first so that a run
 * which exhausts its budget has already banked the resources most likely to succeed,
 * rather than having spent the budget on ones that were going to 403 anyway.
 * A singleton costs one request; a collection pages.
 */
const AVAILABILITY_RANK = {
  available_now: 100,
  needs_additional_scope: 500,
  unknown: 700,
  needs_license: 900,
  unavailable: 950,
};
function collectionOrderFor(availability, isCollection) {
  return (AVAILABILITY_RANK[availability] ?? 700) + (isCollection ? 10 : 0);
}

/**
 * CSDL keys, resolved through inheritance. Returns Map<entity_type_id, string[]>.
 * The BaseType reference is alias-qualified as published (`graph.entity`) while
 * qualified_name is namespace-qualified (`microsoft.graph.entity`), so the alias is
 * normalised before the join. Depth is capped: a malformed cycle must not hang the run.
 */
async function loadInheritedKeys(client) {
  const { rows } = await client.query(`
    WITH RECURSIVE norm AS (
      SELECT id, graph_version, qualified_name, key_properties,
             CASE WHEN base_type IS NULL THEN NULL
                  ELSE regexp_replace(base_type, '^graph\\.', 'microsoft.graph.')
             END AS base_qname
        FROM graph_entity_types
    ),
    walk AS (
      SELECT n.id AS root_id, n.key_properties, n.base_qname, n.graph_version, 0 AS depth
        FROM norm n
      UNION ALL
      SELECT w.root_id, p.key_properties, p.base_qname, p.graph_version, w.depth + 1
        FROM walk w
        JOIN norm p ON p.qualified_name = w.base_qname AND p.graph_version = w.graph_version
       WHERE jsonb_array_length(w.key_properties) = 0 AND w.depth < 12
    )
    SELECT root_id, key_properties
      FROM (
        SELECT root_id, key_properties,
               row_number() OVER (PARTITION BY root_id ORDER BY depth) AS rn
          FROM walk
         WHERE jsonb_array_length(key_properties) > 0
      ) t
     WHERE rn = 1
  `);
  return new Map(rows.map((r) => [r.root_id, r.key_properties]));
}

/** DSC key/Identity parameters per resource. Connection parameters are excluded. */
async function loadDscKeys(client) {
  const { rows } = await client.query(`
    SELECT config_resource_id,
           array_agg(name ORDER BY ordinal) FILTER (WHERE is_key) AS key_names,
           bool_or(lower(name) = 'identity')                      AS has_identity
      FROM config_resource_properties
     WHERE source = 'm365dsc-mof' AND is_connection_parameter = false
     GROUP BY config_resource_id
  `);
  return new Map(rows.map((r) => [r.config_resource_id, r]));
}

/** Cmdlets whose real output shape #1793 actually observed (property_names non-null). */
async function loadObservedCmdlets(client) {
  const { rows } = await client.query(`
    SELECT DISTINCT lower(cmdlet_name) AS cmdlet
      FROM ps_capability_survey_results
     WHERE status = 'ok' AND property_names IS NOT NULL
  `);
  return new Set(rows.map((r) => r.cmdlet));
}

/** Which resources have any Graph-metadata-derived property rows at all. */
async function loadGraphShapedResources(client) {
  const { rows } = await client.query(`
    SELECT DISTINCT config_resource_id
      FROM config_resource_properties WHERE source = 'graph-metadata'
  `);
  return new Set(rows.map((r) => r.config_resource_id));
}

function resolveIdentity(res, inheritedKeys, dscKeys) {
  if (res.read_transport === "graph") {
    // A single-object resource has no per-object key: the path itself identifies it.
    if (!res.graph_is_collection) {
      return { strategy: "graph-singleton", props: [], basis: "single-object Graph path; the path is the identity" };
    }
    const keys = res.graph_entity_type_id ? inheritedKeys.get(res.graph_entity_type_id) : null;
    if (keys && keys.length === 1) {
      return { strategy: "graph-id", props: keys, basis: `CSDL <Key> on ${res.graph_entity_type ?? "the linked entity type"} (inherited where not redeclared)` };
    }
    if (keys && keys.length > 1) {
      return { strategy: "composite-key", props: keys, basis: `CSDL multi-part <Key> on ${res.graph_entity_type ?? "the linked entity type"}` };
    }
    return { strategy: "unresolved", props: [], basis: "no CSDL <Key> resolvable for this path's entity type" };
  }

  const dsc = dscKeys.get(res.id);
  if (dsc?.has_identity) {
    return { strategy: "dsc-identity", props: ["Identity"], basis: "Microsoft365DSC declares an Identity parameter" };
  }
  const keys = (dsc?.key_names ?? []).filter(Boolean);
  if (keys.length === 1) {
    return { strategy: "dsc-identity", props: keys, basis: `Microsoft365DSC MOF Key parameter ${keys[0]}` };
  }
  if (keys.length > 1) {
    return { strategy: "composite-key", props: keys, basis: `Microsoft365DSC MOF Key parameters ${keys.join(" + ")}` };
  }
  return { strategy: "unresolved", props: [], basis: "no Identity or Key parameter published for this resource" };
}

function resolveShapeProvenance(res, observedCmdlets, graphShaped) {
  const cmdlets = Array.isArray(res.read_cmdlets) ? res.read_cmdlets : [];
  if (cmdlets.some((c) => observedCmdlets.has(String(c).toLowerCase()))) return "observed_live";
  if (res.read_transport === "graph") {
    if (res.verification_status === "verified_live") return "observed_live";
    if (graphShaped.has(res.id)) return "derived_from_graph_metadata";
  }
  // Git #1853: DSC-derived shapes are DERIVED, never observed, and are labelled so.
  if (cmdlets.length > 0 || res.m365dsc_resource) return "derived_from_dsc";
  return "none";
}

async function main() {
  const client = await connect();
  try {
    // Sequential, not Promise.all: a single pg Client serialises queries anyway and
    // overlapping them on one connection is deprecated as of pg 8.20.
    const inheritedKeys = await loadInheritedKeys(client);
    const dscKeys = await loadDscKeys(client);
    const observedCmdlets = await loadObservedCmdlets(client);
    const graphShaped = await loadGraphShapedResources(client);
    console.log(
      `[registry] inputs: ${inheritedKeys.size} entity types with a resolvable key, ` +
      `${dscKeys.size} DSC resources with parameters, ${observedCmdlets.size} cmdlets with an observed shape`,
    );

    const { rows: resources } = await client.query(`
      SELECT id, resource_key, display_name, surface, workload, read_transport,
             graph_version, graph_path, graph_is_collection, graph_container_kind,
             graph_entity_type_id, graph_entity_type, read_cmdlets, m365dsc_resource,
             required_app_permissions, graph_read_permission_options,
             availability, verification_status
        FROM config_resources
       ORDER BY resource_key
    `);

    const stats = { total: resources.length, collectable: 0, byStrategy: {}, byReason: {}, byProvenance: {} };
    const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

    if (!DRY_RUN) await client.query("BEGIN");

    for (const res of resources) {
      const identity = resolveIdentity(res, inheritedKeys, dscKeys);
      const hasExecutor = EXECUTOR_BACKED.has(res.read_transport);

      // no_executor is evaluated FIRST and wins, matching coverageStateFor() in
      // config-state.ts: a resource no code path can reach is not merely missing an
      // identity strategy, and conflating the two is what Git #1849 asked to end.
      let reason = null;
      let notes = null;
      if (!hasExecutor) {
        reason = "no_executor";
        notes = `no executor exists for the ${res.read_transport} transport (Git #1849)`;
      } else if (res.read_transport === "powershell" && !hasCatalogedPsCmdlet(res.read_cmdlets)) {
        // Git #2841: the transport being executor-backed in general doesn't mean THIS
        // row's own cmdlet has a ps-execution catalog entry. Same reason string the
        // runtime collector already uses for this exact case (skipReason: "no_executor"
        // in collectPowerShellResource()) — this just stops the registry claiming
        // collectable ahead of a call that can never succeed.
        reason = "no_executor";
        const named = (Array.isArray(res.read_cmdlets) ? res.read_cmdlets : [])
          .filter((c) => !PS_NON_READ_HELPER_CMDLETS.has(c));
        notes = `No ps-execution catalog entry invokes this resource's read cmdlet unfiltered — needs ` +
          `${named.length > 0 ? named.join(", ") : "(no read cmdlet recorded)"} (Git #2841)`;
      } else if (identity.strategy === "unresolved") {
        reason = "identity_unresolved";
      } else if (res.graph_container_kind === "function") {
        reason = "not_collectable";
        // A bound Function is an OPERATION, not persistent configuration state:
        // /reports/getApiUsage and /deviceManagement/getEffectivePermissions compute
        // an answer on demand, many require parameters, and re-invoking one yields a
        // different result with no object to pair across snapshots. Snapshotting them
        // would put report output into a configuration store and manufacture diff
        // churn. Registered and reasoned rather than dropped — see the finding filed
        // against the resource model for whether they belong in it at all.
        notes = "Graph bound Function: an operation, not configuration state, so there is nothing stable to snapshot or diff";
      } else if (res.availability === "unavailable") {
        reason = "not_collectable";
        notes = "published sources state no app-only read path exists for this resource";
      }

      const isCollectable = reason === null;
      if (isCollectable) stats.collectable += 1;
      bump(stats.byStrategy, identity.strategy);
      if (reason) bump(stats.byReason, reason);

      const provenance = resolveShapeProvenance(res, observedCmdlets, graphShaped);
      bump(stats.byProvenance, provenance);

      if (DRY_RUN) continue;

      await client.query(
        `INSERT INTO config_snapshot_resource_types (
           resource_key, display_name, surface, workload, read_transport, graph_version,
           graph_path, is_collection, read_cmdlets, identity_strategy,
           identity_property_names, identity_basis, required_app_permissions,
           graph_read_permission_options, is_collectable, not_collectable_reason,
           collection_order, last_known_availability, availability_refreshed_at,
           shape_provenance, notes, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13::jsonb,$14::jsonb,
           $15,$16,$17,$18,now(),$19,$20,now()
         )
         ON CONFLICT (resource_key) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           surface = EXCLUDED.surface,
           workload = EXCLUDED.workload,
           read_transport = EXCLUDED.read_transport,
           graph_version = EXCLUDED.graph_version,
           graph_path = EXCLUDED.graph_path,
           is_collection = EXCLUDED.is_collection,
           read_cmdlets = EXCLUDED.read_cmdlets,
           identity_strategy = EXCLUDED.identity_strategy,
           identity_property_names = EXCLUDED.identity_property_names,
           identity_basis = EXCLUDED.identity_basis,
           required_app_permissions = EXCLUDED.required_app_permissions,
           graph_read_permission_options = EXCLUDED.graph_read_permission_options,
           is_collectable = EXCLUDED.is_collectable,
           not_collectable_reason = EXCLUDED.not_collectable_reason,
           collection_order = EXCLUDED.collection_order,
           last_known_availability = EXCLUDED.last_known_availability,
           availability_refreshed_at = now(),
           shape_provenance = EXCLUDED.shape_provenance,
           notes = EXCLUDED.notes,
           updated_at = now()`,
        [
          res.resource_key, res.display_name, res.surface, res.workload, res.read_transport,
          res.graph_version, res.graph_path, res.graph_is_collection ?? false,
          JSON.stringify(res.read_cmdlets ?? []), identity.strategy,
          JSON.stringify(identity.props), identity.basis,
          JSON.stringify(res.required_app_permissions ?? []),
          JSON.stringify(res.graph_read_permission_options ?? []),
          isCollectable, reason,
          collectionOrderFor(res.availability, res.graph_is_collection ?? false),
          res.availability, provenance, notes,
        ],
      );
    }

    // Retire, never delete. A registry row whose resource_key has left the derived
    // model still gives meaning to every snapshot object that referenced it.
    //
    // Git #2010: `dns`-transport rows are exempt. They are not derived FROM
    // `config_resources` at all — there is no published Graph/DSC source for
    // "SPF/DKIM/DMARC public DNS TXT records", so they are seeded once by that
    // issue's own migration and never appear as a row in `config_resources` to
    // upsert against. Without this exclusion every run of this script would
    // retire them as "no longer present in the model" the instant it runs.
    let retired = 0;
    if (!DRY_RUN) {
      const { rowCount } = await client.query(`
        UPDATE config_snapshot_resource_types t
           SET is_collectable = false,
               not_collectable_reason = 'not_collectable',
               notes = 'retired: no longer present in config_resources as of ' || now()::date,
               updated_at = now()
         WHERE NOT EXISTS (SELECT 1 FROM config_resources r WHERE r.resource_key = t.resource_key)
           AND t.read_transport <> 'dns'
           AND (t.is_collectable = true OR t.notes IS DISTINCT FROM 'retired')
      `);
      retired = rowCount ?? 0;
      await client.query("COMMIT");
    }

    console.log(`[registry] ${DRY_RUN ? "would upsert" : "upserted"} ${stats.total} resource types`);
    console.log(`[registry] collectable: ${stats.collectable} / ${stats.total}`);
    console.log(`[registry] identity strategy:`, stats.byStrategy);
    console.log(`[registry] not-collectable reason:`, stats.byReason);
    console.log(`[registry] shape provenance:`, stats.byProvenance);
    if (retired) console.log(`[registry] retired ${retired} row(s) no longer in the model (not deleted)`);
  } catch (err) {
    if (!DRY_RUN) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[registry] FAILED:", err);
  process.exit(1);
});
