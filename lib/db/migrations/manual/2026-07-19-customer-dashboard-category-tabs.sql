-- Reorganize Customer Dashboard Into 10 Category Tabs
-- Manual migration — review and run by hand (do NOT run drizzle-kit push/push --force).
--
-- WHAT THIS DOES
-- Defines the 10 standard customer-dashboard category tabs — Executive,
-- Identity & Access, Security Posture, Compliance & Governance,
-- Collaboration & Sharing, Licensing & Cost, Configuration Drift,
-- Intune & Devices, Usage & Adoption, Operational Maturity — as real
-- dashboard tabs, reusing the EXISTING multi-dashboard tab mechanism
-- (dashboard-overrides.ts GET /api/dashboard/resolved-list + <DashboardTabs>).
-- NO schema change, NO new template_type, NO endpoint/code change.
--
-- MECHANISM (per the chosen "SQL-only via monitoring_package" approach)
-- resolved-list surfaces a tab for every monitoring_package that (a) has a
-- dashboard_templates row of templateType='monitoring_package' with that
-- target_key for the caller's MSP, AND (b) the caller's customer has active
-- via an msp_sales_bundle_assignment whose bundle's monitoringPackageKeys
-- include that key. So each category = one monitoring_packages row (for the
-- tab label) + one monitoring_package dashboard_templates row (the widgets).
--
-- IMPORTANT — GATING (accepted tradeoff, chosen deliberately):
-- These category tabs only APPEAR for a customer once that customer has an
-- ACTIVE bundle assignment covering these package keys. This migration creates
-- a ready-to-use bundle ("Customer Dashboard Category Tabs") per MSP but does
-- NOT auto-assign it to any customer — assignment is Shane's operational step
-- (see Part E, commented). Until assigned, a customer sees only their existing
-- "Overview" (customer_default) tab. This is the sales-artifact coupling that
-- was knowingly accepted over a resolver code-change.
--
-- These 10 monitoring_packages are DASHBOARD-TAB CONTAINERS ONLY: they have no
-- monitoring_package_checks rows, so assigning the bundle surfaces the tabs
-- WITHOUT scheduling any real check execution (zero checks = no-op execution).
-- The widget DATA comes from the metric registry resolvers, exactly like the
-- customer_default dashboard — not from package check execution.
--
-- WIDGET SELECTION (honest coverage — see PLATFORM_BUILD.md DONE row for the
-- full per-category audit):
--   * Only registry metrics with status "available" (Tier 1, fully wired) or
--     status "needs_aggregation" (Tier 2 — real underlying data with an
--     IMPLEMENTED transform in dashboard-resolvers.ts) are wired.
--   * The 3 registry stubs (status "not_collected") are NEVER wired:
--       licensing.costTrend        (not_collected:license-cost)
--       copilot.usagePerUser       (not_collected:copilot-usage)
--       serviceHealth.uptimeStatus (not_collected:service-health-overview)
--   * projects.* customer-scope metrics resolve to not_available (user-keyed,
--     no customer→user bridge) so they are NOT wired.
--   * rendererType per widget obeys the registry's shape rules
--     (getValidRenderersForMetric): scalar→Stat/Gauge/ScoreRing/Smart,
--     trend→Trend/Bar, distribution→Distribution/Bar/Radar, heatmap→Heatmap,
--     timeline→Timeline.
--
-- RELOCATION: the 17 auto-* widgets a prior task (2026-07-19-dashboard-modules-
-- widgets.sql) appended to customer_default are REMOVED from customer_default
-- here (Part D) and re-homed on their correct category tab below — relocated,
-- not duplicated. customer_default keeps its original pre-modules widgets.
--
-- IDEMPOTENT: safe to re-run. monitoring_packages upsert-by-key (ON CONFLICT),
-- dashboard_templates + bundle guarded by NOT EXISTS, the customer_default
-- prune guarded so it only touches rows that still carry the auto-* widgets.

BEGIN;

-- ── Category definitions (key, label, description, canvas layout) ───────────────
-- Temp table so the same 10 rows drive every INSERT below in one place.
CREATE TEMPORARY TABLE _dash_cat (
  ord         integer NOT NULL,
  key         text    NOT NULL,
  label       text    NOT NULL,
  description text,
  layout      jsonb   NOT NULL
) ON COMMIT DROP;

INSERT INTO _dash_cat (ord, key, label, description, layout) VALUES

-- 1) EXECUTIVE ────────────────────────────────────────────────────────────────
(1, 'cat-executive', 'Executive', 'Overall posture, engine pillar scores and score trend.', '[
  {"i":"exec-health","x":0,"y":0,"w":3,"h":3,"metricKey":"engine.healthScore","rendererType":"Gauge"},
  {"i":"exec-security","x":3,"y":0,"w":3,"h":3,"metricKey":"engine.securityScore","rendererType":"Gauge"},
  {"i":"exec-compliance","x":6,"y":0,"w":3,"h":3,"metricKey":"engine.complianceScore","rendererType":"Gauge"},
  {"i":"exec-adoption","x":9,"y":0,"w":3,"h":3,"metricKey":"engine.adoptionScore","rendererType":"Gauge"},
  {"i":"exec-pillars","x":0,"y":3,"w":6,"h":4,"metricKey":"engine.pillarSnapshot","rendererType":"Radar"},
  {"i":"exec-benchmark","x":6,"y":3,"w":6,"h":4,"metricKey":"benchmark.scoreVsIndustry","rendererType":"Bar"},
  {"i":"exec-scoretrend","x":0,"y":7,"w":6,"h":4,"metricKey":"engine.scoreTrend","rendererType":"Trend"},
  {"i":"exec-healthhistory","x":6,"y":7,"w":6,"h":4,"metricKey":"health.clientHealthHistory","rendererType":"Trend"}
]'::jsonb),

-- 2) IDENTITY & ACCESS ─────────────────────────────────────────────────────────
(2, 'cat-identity-access', 'Identity & Access', 'MFA, legacy auth, sign-in risk, provisioning and privileged-role activity.', '[
  {"i":"idn-mfa","x":0,"y":0,"w":3,"h":3,"metricKey":"identity.mfaRegisteredCount","rendererType":"Smart"},
  {"i":"idn-passwordless","x":3,"y":0,"w":3,"h":3,"metricKey":"identity.passwordlessUserCount","rendererType":"Smart"},
  {"i":"idn-stale","x":6,"y":0,"w":3,"h":3,"metricKey":"identity.staleAccountCount","rendererType":"Smart"},
  {"i":"idn-impossibletravel","x":9,"y":0,"w":3,"h":3,"metricKey":"identity.impossibleTravelCount","rendererType":"Smart"},
  {"i":"idn-legacyauth","x":0,"y":3,"w":3,"h":3,"metricKey":"identity.legacyAuthCount","rendererType":"Trend"},
  {"i":"idn-riskyusers","x":3,"y":3,"w":3,"h":3,"metricKey":"identity.riskyUserCount","rendererType":"Trend"},
  {"i":"idn-highrisksignin","x":6,"y":3,"w":3,"h":3,"metricKey":"identity.highRiskSigninCount","rendererType":"Trend"},
  {"i":"idn-failedsignin","x":9,"y":3,"w":3,"h":3,"metricKey":"identity.failedSigninCount","rendererType":"Trend"},
  {"i":"idn-signinheatmap","x":0,"y":6,"w":6,"h":4,"metricKey":"identity.signinActivity","rendererType":"Heatmap"},
  {"i":"idn-provisioning","x":6,"y":6,"w":6,"h":4,"metricKey":"identity.provisioningEventCount","rendererType":"Timeline"},
  {"i":"idn-privroles","x":0,"y":10,"w":6,"h":4,"metricKey":"identity.privilegedRoleChangeCount","rendererType":"Timeline"}
]'::jsonb),

-- 3) SECURITY POSTURE ──────────────────────────────────────────────────────────
(3, 'cat-security-posture', 'Security Posture', 'Secure score, alerts by severity/category, risk detections and email threats.', '[
  {"i":"sec-enginescore","x":0,"y":0,"w":3,"h":3,"metricKey":"engine.securityScore","rendererType":"Gauge"},
  {"i":"sec-securescore","x":3,"y":0,"w":3,"h":3,"metricKey":"security.secureScore","rendererType":"Gauge"},
  {"i":"sec-highsev","x":6,"y":0,"w":3,"h":3,"metricKey":"security.highSeverityAlertCount","rendererType":"Smart"},
  {"i":"sec-lowctrl","x":9,"y":0,"w":3,"h":3,"metricKey":"security.lowScoreControlCount","rendererType":"Smart"},
  {"i":"sec-activealerts","x":0,"y":3,"w":3,"h":2,"metricKey":"security.activeAlertCount","rendererType":"Stat"},
  {"i":"sec-alertsbysev","x":0,"y":5,"w":6,"h":4,"metricKey":"security.alertsBySeverity","rendererType":"Distribution"},
  {"i":"sec-scorectrls","x":6,"y":5,"w":6,"h":4,"metricKey":"security.secureScoreControls","rendererType":"Bar"},
  {"i":"sec-riskdetect","x":0,"y":9,"w":6,"h":4,"metricKey":"security.riskDetectionCount","rendererType":"Distribution"},
  {"i":"sec-findingssev","x":6,"y":9,"w":6,"h":4,"metricKey":"diagnostics.findingsBySeverity","rendererType":"Distribution"},
  {"i":"sec-malware","x":0,"y":13,"w":6,"h":3,"metricKey":"security.malwareAlertCount","rendererType":"Trend"},
  {"i":"sec-phishing","x":6,"y":13,"w":6,"h":3,"metricKey":"security.phishingAlertCount","rendererType":"Trend"}
]'::jsonb),

-- 4) COMPLIANCE & GOVERNANCE ────────────────────────────────────────────────────
(4, 'cat-compliance-governance', 'Compliance & Governance', 'DLP, labels, retention, oversharing, guest/external exposure and access governance.', '[
  {"i":"cmp-compscore","x":0,"y":0,"w":3,"h":3,"metricKey":"engine.complianceScore","rendererType":"Gauge"},
  {"i":"cmp-govscore","x":3,"y":0,"w":3,"h":3,"metricKey":"engine.governanceScore","rendererType":"Gauge"},
  {"i":"cmp-overshared","x":6,"y":0,"w":3,"h":3,"metricKey":"compliance.oversharedSiteCount","rendererType":"ScoreRing"},
  {"i":"cmp-weakdlp","x":9,"y":0,"w":3,"h":3,"metricKey":"compliance.weakDlpPolicyCount","rendererType":"Smart"},
  {"i":"cmp-missinglabel","x":0,"y":3,"w":3,"h":3,"metricKey":"compliance.missingLabelCount","rendererType":"Smart"},
  {"i":"cmp-missingretention","x":3,"y":3,"w":3,"h":3,"metricKey":"compliance.missingRetentionTagCount","rendererType":"Smart"},
  {"i":"cmp-orphansite","x":6,"y":3,"w":3,"h":3,"metricKey":"compliance.orphanedSiteCount","rendererType":"Smart"},
  {"i":"cmp-orphanteam","x":9,"y":3,"w":3,"h":3,"metricKey":"compliance.orphanedTeamCount","rendererType":"Smart"},
  {"i":"cmp-overduereview","x":0,"y":6,"w":3,"h":3,"metricKey":"governance.overdueAccessReviewCount","rendererType":"Smart"},
  {"i":"cmp-orphanpkg","x":3,"y":6,"w":3,"h":3,"metricKey":"governance.orphanedAccessPackageCount","rendererType":"Smart"},
  {"i":"cmp-dlpincidents","x":0,"y":9,"w":3,"h":3,"metricKey":"compliance.dlpIncidentCount","rendererType":"Trend"},
  {"i":"cmp-guests","x":3,"y":9,"w":3,"h":3,"metricKey":"compliance.guestUserCount","rendererType":"Trend"},
  {"i":"cmp-extinvites","x":6,"y":9,"w":3,"h":3,"metricKey":"compliance.externalInviteCount","rendererType":"Trend"},
  {"i":"cmp-onedriveext","x":9,"y":9,"w":3,"h":3,"metricKey":"compliance.oneDriveExternalCount","rendererType":"Trend"},
  {"i":"cmp-entitlementdrift","x":0,"y":12,"w":6,"h":4,"metricKey":"governance.entitlementPolicyDriftCount","rendererType":"Timeline"}
]'::jsonb),

-- 5) COLLABORATION & SHARING ────────────────────────────────────────────────────
(5, 'cat-collaboration-sharing', 'Collaboration & Sharing', 'Mailbox/sharing exposure, Copilot oversharing, workload activity and file activity.', '[
  {"i":"col-forwarding","x":0,"y":0,"w":3,"h":3,"metricKey":"collaboration.forwardingMailboxCount","rendererType":"Smart"},
  {"i":"col-sharedsignin","x":3,"y":0,"w":3,"h":3,"metricKey":"collaboration.sharedMailboxSigninEnabledCount","rendererType":"Smart"},
  {"i":"col-copilotovershare","x":6,"y":0,"w":3,"h":3,"metricKey":"copilot.overshareExposureCount","rendererType":"Smart"},
  {"i":"col-mailboxes","x":0,"y":3,"w":3,"h":2,"metricKey":"collaboration.mailboxCount","rendererType":"Stat"},
  {"i":"col-teamschannels","x":3,"y":3,"w":3,"h":2,"metricKey":"collaboration.teamsChannelCount","rendererType":"Stat"},
  {"i":"col-delegations","x":6,"y":3,"w":3,"h":2,"metricKey":"collaboration.delegationGrantCount","rendererType":"Stat"},
  {"i":"col-activeemail","x":0,"y":5,"w":3,"h":3,"metricKey":"collaboration.activeEmailUserCount","rendererType":"Trend"},
  {"i":"col-activeteams","x":3,"y":5,"w":3,"h":3,"metricKey":"collaboration.activeTeamsUserCount","rendererType":"Trend"},
  {"i":"col-activesp","x":6,"y":5,"w":3,"h":3,"metricKey":"collaboration.activeSharePointUserCount","rendererType":"Trend"},
  {"i":"col-activeod","x":9,"y":5,"w":3,"h":3,"metricKey":"collaboration.activeOneDriveUserCount","rendererType":"Trend"},
  {"i":"col-fileactivity","x":0,"y":8,"w":6,"h":4,"metricKey":"collaboration.fileActivity","rendererType":"Heatmap"}
]'::jsonb),

-- 6) LICENSING & COST ────────────────────────────────────────────────────────────
(6, 'cat-licensing-cost', 'Licensing & Cost', 'License SKU mix, waste estimate and Copilot license readiness.', '[
  {"i":"lic-duplicate","x":0,"y":0,"w":3,"h":3,"metricKey":"licensing.duplicateLicenseCount","rendererType":"Smart"},
  {"i":"lic-inactive","x":3,"y":0,"w":3,"h":3,"metricKey":"licensing.inactiveLicenseCount","rendererType":"Smart"},
  {"i":"lic-sku","x":0,"y":3,"w":6,"h":4,"metricKey":"licensing.skuBreakdown","rendererType":"Distribution"},
  {"i":"lic-copilot","x":6,"y":3,"w":6,"h":4,"metricKey":"licensing.copilotLicenseBreakdown","rendererType":"Distribution"},
  {"i":"lic-waste","x":0,"y":7,"w":6,"h":4,"metricKey":"licensing.wasteEstimateBreakdown","rendererType":"Bar"}
]'::jsonb),

-- 7) CONFIGURATION DRIFT ─────────────────────────────────────────────────────────
(7, 'cat-configuration-drift', 'Configuration Drift', 'Recent configuration-change events across identity, security, workloads and Dynamics.', '[
  {"i":"drf-capolicy","x":0,"y":0,"w":6,"h":4,"metricKey":"drift.caPolicyDriftCount","rendererType":"Timeline"},
  {"i":"drf-roleassign","x":6,"y":0,"w":6,"h":4,"metricKey":"drift.roleAssignmentDriftCount","rendererType":"Timeline"},
  {"i":"drf-secdefaults","x":0,"y":4,"w":6,"h":4,"metricKey":"drift.securityDefaultsDriftCount","rendererType":"Timeline"},
  {"i":"drf-tenantconfig","x":6,"y":4,"w":6,"h":4,"metricKey":"drift.tenantConfigDriftCount","rendererType":"Timeline"},
  {"i":"drf-mailboxconfig","x":0,"y":8,"w":6,"h":4,"metricKey":"drift.mailboxConfigDriftCount","rendererType":"Timeline"},
  {"i":"drf-teamspolicy","x":6,"y":8,"w":6,"h":4,"metricKey":"drift.teamsPolicyDriftCount","rendererType":"Timeline"},
  {"i":"drf-spadmin","x":0,"y":12,"w":6,"h":4,"metricKey":"drift.sharePointAdminDriftCount","rendererType":"Timeline"},
  {"i":"drf-permission","x":6,"y":12,"w":6,"h":4,"metricKey":"drift.permissionDriftCount","rendererType":"Timeline"},
  {"i":"drf-secret","x":0,"y":16,"w":6,"h":4,"metricKey":"drift.secretDriftCount","rendererType":"Timeline"},
  {"i":"drf-certificate","x":6,"y":16,"w":6,"h":4,"metricKey":"drift.certificateDriftCount","rendererType":"Timeline"},
  {"i":"drf-dynappRole","x":0,"y":20,"w":6,"h":4,"metricKey":"dynamics.appRoleDriftCount","rendererType":"Timeline"},
  {"i":"drf-dynconsent","x":6,"y":20,"w":6,"h":4,"metricKey":"dynamics.consentChangeCount","rendererType":"Timeline"}
]'::jsonb),

-- 8) INTUNE & DEVICES ────────────────────────────────────────────────────────────
(8, 'cat-intune-devices', 'Intune & Devices', 'Device compliance, encryption, enrollment, jailbreak/root and threat posture.', '[
  {"i":"dev-noncompliant","x":0,"y":0,"w":3,"h":3,"metricKey":"intune.nonCompliantDeviceCount","rendererType":"Smart"},
  {"i":"dev-unencrypted","x":3,"y":0,"w":3,"h":3,"metricKey":"intune.unencryptedDeviceCount","rendererType":"Smart"},
  {"i":"dev-unenrolled","x":6,"y":0,"w":3,"h":3,"metricKey":"intune.unenrolledDeviceCount","rendererType":"Smart"},
  {"i":"dev-outdated","x":9,"y":0,"w":3,"h":3,"metricKey":"intune.outdatedDeviceCount","rendererType":"Smart"},
  {"i":"dev-jailbroken","x":0,"y":3,"w":3,"h":3,"metricKey":"intune.jailbrokenDeviceCount","rendererType":"Smart"},
  {"i":"dev-rooted","x":3,"y":3,"w":3,"h":3,"metricKey":"intune.rootedDeviceCount","rendererType":"Smart"},
  {"i":"dev-configdrift","x":6,"y":3,"w":3,"h":2,"metricKey":"intune.configDriftCount","rendererType":"Stat"},
  {"i":"dev-highthreat","x":0,"y":6,"w":6,"h":3,"metricKey":"intune.highThreatDeviceCount","rendererType":"Trend"}
]'::jsonb),

-- 9) USAGE & ADOPTION ────────────────────────────────────────────────────────────
(9, 'cat-usage-adoption', 'Usage & Adoption', 'Workload usage/active-user trends, adoption & Copilot engine scores, Power Platform footprint.', '[
  {"i":"usg-adoptionscore","x":0,"y":0,"w":3,"h":3,"metricKey":"engine.adoptionScore","rendererType":"Gauge"},
  {"i":"usg-copilotscore","x":3,"y":0,"w":3,"h":3,"metricKey":"engine.copilotScore","rendererType":"Gauge"},
  {"i":"usg-teamsusage","x":0,"y":3,"w":3,"h":3,"metricKey":"usage.teamsUsageCount","rendererType":"Trend"},
  {"i":"usg-exchangeusage","x":3,"y":3,"w":3,"h":3,"metricKey":"usage.exchangeUsageCount","rendererType":"Trend"},
  {"i":"usg-spusage","x":6,"y":3,"w":3,"h":3,"metricKey":"usage.sharePointUsageCount","rendererType":"Trend"},
  {"i":"usg-odusage","x":9,"y":3,"w":3,"h":3,"metricKey":"usage.oneDriveUsageCount","rendererType":"Trend"},
  {"i":"usg-teamsactive","x":0,"y":6,"w":3,"h":3,"metricKey":"usage.teamsActiveCount","rendererType":"Trend"},
  {"i":"usg-exchangeactive","x":3,"y":6,"w":3,"h":3,"metricKey":"usage.exchangeActiveCount","rendererType":"Trend"},
  {"i":"usg-spactive","x":6,"y":6,"w":3,"h":3,"metricKey":"usage.sharePointActiveCount","rendererType":"Trend"},
  {"i":"usg-odactive","x":9,"y":6,"w":3,"h":3,"metricKey":"usage.oneDriveActiveCount","rendererType":"Trend"},
  {"i":"usg-ppapps","x":0,"y":9,"w":3,"h":3,"metricKey":"powerPlatform.appCount","rendererType":"Trend"},
  {"i":"usg-ppflows","x":3,"y":9,"w":3,"h":3,"metricKey":"powerPlatform.flowCount","rendererType":"Trend"},
  {"i":"usg-meetings","x":6,"y":9,"w":3,"h":3,"metricKey":"collaboration.meetingsOrganized","rendererType":"Trend"}
]'::jsonb),

-- 10) OPERATIONAL MATURITY ───────────────────────────────────────────────────────
(10, 'cat-operational-maturity', 'Operational Maturity', 'SLA compliance, scope creep, alert volume, scans, offers and finding severity.', '[
  {"i":"ops-sla","x":0,"y":0,"w":3,"h":3,"metricKey":"sla.compliancePercent","rendererType":"Gauge"},
  {"i":"ops-slabreach","x":3,"y":0,"w":3,"h":3,"metricKey":"sla.activeBreachCount","rendererType":"Smart"},
  {"i":"ops-scopecreep","x":6,"y":0,"w":3,"h":2,"metricKey":"sla.scopeCreepStatus","rendererType":"Stat"},
  {"i":"ops-packages","x":9,"y":0,"w":3,"h":2,"metricKey":"packages.activePackageCount","rendererType":"Stat"},
  {"i":"ops-offers","x":0,"y":3,"w":3,"h":2,"metricKey":"offers.activeOfferCount","rendererType":"Stat"},
  {"i":"ops-alertvolume","x":0,"y":5,"w":6,"h":3,"metricKey":"alerts.alertVolume","rendererType":"Trend"},
  {"i":"ops-findingssev","x":6,"y":5,"w":6,"h":4,"metricKey":"diagnostics.findingsBySeverity","rendererType":"Distribution"},
  {"i":"ops-recentalerts","x":0,"y":9,"w":6,"h":4,"metricKey":"alerts.recentAlerts","rendererType":"Timeline"},
  {"i":"ops-recentscans","x":6,"y":9,"w":6,"h":4,"metricKey":"diagnostics.recentScans","rendererType":"Timeline"},
  {"i":"ops-remediation","x":0,"y":13,"w":6,"h":4,"metricKey":"offers.remediationOffers","rendererType":"Timeline"}
]'::jsonb);

-- ── Part A: monitoring_packages (global) — tab-label containers ─────────────────
-- No monitoring_package_checks are attached (dashboard-tab containers only).
INSERT INTO monitoring_packages (key, label, description)
SELECT key, label, description FROM _dash_cat
ON CONFLICT (key) DO NOTHING;

-- ── Part B: dashboard_templates (one monitoring_package row per category) ───────
-- Created for every MSP that already runs the dashboard system (has a
-- customer_default template) — the same MSP population the modules task touched.
INSERT INTO dashboard_templates (msp_id, template_type, target_key, canvas_layout, allow_customer_edit, is_default)
SELECT m.msp_id, 'monitoring_package', c.key, c.layout, true, false
FROM (SELECT DISTINCT msp_id FROM dashboard_templates WHERE template_type = 'customer_default') m
CROSS JOIN _dash_cat c
WHERE NOT EXISTS (
  SELECT 1 FROM dashboard_templates t2
  WHERE t2.msp_id = m.msp_id
    AND t2.template_type = 'monitoring_package'
    AND t2.target_key = c.key
);

-- ── Part C: a ready-to-assign Sales Bundle per MSP covering all 10 category keys ─
-- status 'active' so it is assignable immediately. resale_price_cents = 0 (this
-- is a dashboard-surfacing bundle, not a priced product). Not auto-assigned.
INSERT INTO msp_sales_bundles (msp_id, name, description, monitoring_package_keys, status, resale_price_cents)
SELECT m.msp_id,
       'Customer Dashboard Category Tabs',
       'Surfaces the 10 standard customer dashboard category tabs. Assign to a customer to enable Executive, Identity & Access, Security Posture, Compliance & Governance, Collaboration & Sharing, Licensing & Cost, Configuration Drift, Intune & Devices, Usage & Adoption and Operational Maturity as dashboard tabs.',
       (SELECT jsonb_agg(key ORDER BY ord) FROM _dash_cat),
       'active',
       0
FROM (SELECT DISTINCT msp_id FROM dashboard_templates WHERE template_type = 'customer_default') m
WHERE NOT EXISTS (
  SELECT 1 FROM msp_sales_bundles b
  WHERE b.msp_id = m.msp_id AND b.name = 'Customer Dashboard Category Tabs'
);

-- ── Part D: RELOCATE — remove the 17 auto-* widgets from customer_default ────────
-- They now live on their category tab above (relocated, not duplicated). Only
-- touches customer_default rows that still carry them (idempotent). Existing
-- customer overrides referencing these ids simply become no-ops in mergeLayout.
UPDATE dashboard_templates t
SET canvas_layout = (
      SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
      FROM jsonb_array_elements(t.canvas_layout) elem
      WHERE elem->>'i' NOT IN (
        'auto-sharing-guest-users','auto-sharing-external-invites','auto-sharing-forwarding-mailboxes',
        'auto-sharing-shared-mailbox-signin','auto-devicehealth-noncompliant','auto-devicehealth-config-drift',
        'auto-devicehealth-unencrypted','auto-devicehealth-unenrolled','auto-devicehealth-jailbroken',
        'auto-devicehealth-rooted','auto-devicehealth-high-threat','auto-devicehealth-outdated',
        'auto-copilot-overshare-exposure','auto-powerplatform-apps','auto-powerplatform-flows',
        'auto-emailsecurity-malware','auto-emailsecurity-phishing'
      )
    ),
    updated_at = now()
WHERE t.template_type = 'customer_default'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(t.canvas_layout) e
    WHERE e->>'i' IN (
      'auto-sharing-guest-users','auto-sharing-external-invites','auto-sharing-forwarding-mailboxes',
      'auto-sharing-shared-mailbox-signin','auto-devicehealth-noncompliant','auto-devicehealth-config-drift',
      'auto-devicehealth-unencrypted','auto-devicehealth-unenrolled','auto-devicehealth-jailbroken',
      'auto-devicehealth-rooted','auto-devicehealth-high-threat','auto-devicehealth-outdated',
      'auto-copilot-overshare-exposure','auto-powerplatform-apps','auto-powerplatform-flows',
      'auto-emailsecurity-malware','auto-emailsecurity-phishing'
    )
  );

COMMIT;

-- ── Part E (OPTIONAL — run by hand per customer to LIGHT UP the tabs) ────────────
-- The category tabs stay hidden until a customer has an ACTIVE assignment of the
-- bundle above. To enable them for a specific customer, uncomment and set the
-- customer id. (tenant_id copied from the customer so package execution routing,
-- if ever attached, is correct; these packages have no checks so it is a no-op.)
--
-- INSERT INTO msp_sales_bundle_assignments (bundle_id, msp_id, customer_id, tenant_id, status, activated_at)
-- SELECT b.bundle_id, c.msp_id, c.id, c.tenant_id, 'active', now()
-- FROM msp_customers c
-- JOIN msp_sales_bundles b ON b.msp_id = c.msp_id AND b.name = 'Customer Dashboard Category Tabs'
-- WHERE c.id = <CUSTOMER_ID>
--   AND NOT EXISTS (
--     SELECT 1 FROM msp_sales_bundle_assignments a
--     WHERE a.bundle_id = b.bundle_id AND a.customer_id = c.id AND a.status = 'active'
--   );
