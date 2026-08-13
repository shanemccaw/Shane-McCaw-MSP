# Full Data Catalog → Chart/Display Mapping

Every real data source in the platform (all ~100 active `monitor_checks` + every platform/business table with real data), each tagged with a recommended display type and which dashboard(s) it feeds. This is the source list for both the MSP business dashboard and the Customer tenant dashboard specs.

**Display type legend:**
- **Trend** — line/area chart over time (needs snapshot history, not just a point-in-time count)
- **Distribution** — pie/donut, category breakdown
- **Bar** — comparison across categories/items
- **Heatmap** — 2D intensity grid (day×hour, domain×severity, etc.)
- **Radar** — multi-dimension spider chart
- **Stat** — single number/card, optionally with a trend arrow
- **Gauge** — score/percentage with a threshold ring
- **Timeline** — event feed / activity list
- **Funnel** — staged conversion (offers, provisioning, etc.)
- **Table** — list view, no chart needed
- **Badge/Status** — simple state indicator (up/down, healthy/unhealthy)

**Scope legend:** `[MSP]` MSP-aggregate dashboard · `[CUST]` Customer tenant dashboard · `[BOTH]` both, aggregated differently

---

## PART 1 — M365 Monitor Check Catalog (per-tenant Graph data)

Every check here is `[CUST]` at the source (one tenant), and rolls up to `[MSP]` as an aggregate/average/sum across the MSP's whole customer book. I'm marking scope per that logic rather than repeating it per row.

### Identity & Access

| Metric (targetField) | Display | Trend-able? |
|---|---|---|
| `mfaRegisteredCount` (identity:mfa-registration) | Gauge (% of users) | Yes |
| `legacyAuthCount` (identity:legacy-auth-usage) | Trend | Yes |
| `passwordlessUserCount` (identity:passwordless-adoption) | Gauge (% adoption) | Yes |
| `disabledAccountCount` (identity:disabled-accounts) | Stat | Yes |
| `staleAccountCount` (identity:stale-accounts) | Stat + Table (list of accounts) | Yes |
| `failedSigninCount` (identity:failed-signins, audit:signins-failed) | Trend | Yes |
| `impossibleTravelCount` (identity:impossible-travel) | Stat, alert-worthy | Yes |
| `riskyUserCount` (identity:risky-users) | Trend + Table | Yes |
| `highRiskSigninCount` (multiple checks) | Trend | Yes |
| Sign-in activity (audit:signins, raw createdDateTime) | Heatmap (day × hour) | Needs bucketing transform |
| `caFailureCount` (audit/security:conditional-access-failures) | Trend | Yes |
| `provisioningEventCount` (audit:provisioning) | Timeline | Yes |
| `privilegedRoleChangeCount` (audit:directory-role-changes) | Timeline | Yes |
| `changeEventCount` (audit:directory-audits) | Timeline | Yes |

### Identity Governance

| Metric | Display | Trend-able? |
|---|---|---|
| `orphanedAccessPackageCount` | Stat + Table | Point-in-time |
| `accessReviewDriftCount` | Stat | Yes |
| `overdueAccessReviewCount` | Stat, alert-worthy | Yes |
| `activeEntitlementAssignmentCount` | Stat | Yes |
| `entitlementPolicyDriftCount` | Timeline | Yes |
| `workflowDriftCount` (lifecycle workflows) | Timeline | Yes |
| `workflowFailureCount` (lifecycle workflows) | Stat, alert-worthy | Yes |

### Security & Defender

| Metric | Display | Trend-able? |
|---|---|---|
| `activeAlertCount` (defender/security:active-alerts) | Stat + Trend | Yes |
| `highSeverityAlertCount` | Stat, alert-worthy | Yes |
| `malwareAlertCount`, `phishingAlertCount` | Distribution (by category) or Trend | Yes |
| Alert `severity`/`category` raw properties | Distribution (by severity, by workload) | Needs group-by transform |
| `riskDetectionCount` (+ `riskEventType`) | Distribution (by risk type) | Needs group-by transform |
| `failedSimulationCount` (attack simulation) | Stat | Yes |
| Secure Score raw response (`averageComparativeScores`) | Gauge (top-line score) + Trend | Needs field extraction |
| `controlCategory`/`score`/`maxScore` (secure score controls) | Radar or Bar (by category) | Needs group-by transform |
| `secureScoreDriftCount`, `lowScoreControlCount` | Stat | Yes |

### Compliance & Governance

| Metric | Display | Trend-able? |
|---|---|---|
| `dlpIncidentCount` | Trend | Yes |
| `weakDlpPolicyCount` | Stat | Point-in-time |
| `activeEdiscoveryCount` | Stat | Point-in-time |
| `labelErrorCount`, `labelPolicyDriftCount` | Stat | Yes |
| `retentionDriftCount`, `missingRetentionTagCount` | Stat + Gauge (coverage %) | Yes |
| `missingLabelCount` (sensitivity labels) | Gauge (coverage %) | Yes |
| `guestUserCount` | Stat + Trend | Yes |
| `externalInviteCount` | Trend | Yes |
| `orphanedSiteCount`, `orphanedTeamCount` | Stat + Table | Point-in-time |
| `oversharedSiteCount` | Stat + Table (dedupe the two duplicate checks first) | Yes |
| `publicChannelCount` | Stat | Point-in-time |
| `oneDriveExternalCount` | Stat + Trend | Yes |

### Collaboration & Exchange

| Metric | Display | Trend-able? |
|---|---|---|
| `mailboxCount` | Stat | Point-in-time |
| `forwardingMailboxCount` (external auto-forward) | Stat, alert-worthy | Yes |
| `inboxRuleCount` | Stat | Point-in-time |
| `delegationGrantCount` | Stat | Point-in-time |
| `sharedMailboxSigninEnabledCount` | Stat, alert-worthy | Point-in-time |
| `teamsChannelCount` | Stat | Point-in-time |
| Raw file activity counts (usage:onedrive/sharepoint-activity) | Heatmap (day × hour) | Needs bucketing transform |
| `activeEmailUserCount`, `activeTeamsUserCount`, `activeSharePointUserCount`, `activeOneDriveUserCount` | Trend (per service) | Yes |
| `meetingsOrganized` (raw property, teams activity) | Trend | Needs mapping |

### Licensing & Cost

| Metric | Display | Trend-able? |
|---|---|---|
| `skuBreakdown` (consumed/prepaid per SKU) | Distribution (pie) + Bar | Yes |
| `wasteEstimateBreakdown` | Bar (waste by SKU) | Yes |
| `duplicateLicenseCount` | Stat | Point-in-time |
| `inactiveLicenseCount` | Stat, remediation-worthy | Yes |
| `copilotLicenseBreakdown` | Distribution | Yes |
| $ cost, $ waste, cost trend | *Not collected — needs pricing data source* | — |

### Intune & Devices

| Metric | Display | Trend-able? |
|---|---|---|
| `nonCompliantDeviceCount` | Gauge (% compliant) + Trend | Yes |
| `configDriftCount` (device config) | Stat | Yes |
| `unencryptedDeviceCount` | Stat, alert-worthy | Yes |
| `unenrolledDeviceCount` | Stat | Yes |
| `jailbrokenDeviceCount`, `rootedDeviceCount` | Stat, alert-worthy | Yes |
| `highThreatDeviceCount` | Stat + Trend | Yes |
| `outdatedDeviceCount` (OS version) | Stat + Gauge | Yes |

### Configuration Drift (dedicated engine)

| Metric | Display | Trend-able? |
|---|---|---|
| All 8 `drift:*` checks (CA policy, directory settings, license assignment, mailbox config, role assignment, security defaults, SharePoint admin, Teams policy) | Timeline (unified feed) + Stat (count this week) | Yes |
| `configDriftCount`, `redirectUriDriftCount`, `secretDriftCount`, `certificateDriftCount`, `permissionDriftCount` (app registration/Graph permission drift) | Timeline, security-flagged | Yes |
| `tenantConfigDriftCount` (baseline) | Timeline | Yes |

### Dynamics 365 (if in scope for this MSP)

| Metric | Display | Trend-able? |
|---|---|---|
| `dynamicsAppPermissionCount`, `dynamicsRoleAssignmentCount`, `dynamicsPermissionGrantCount` | Stat + Table | Point-in-time |
| `dynamicsAppRoleDriftCount`, `dynamicsSpDriftCount`, `dynamicsConsentChangeCount` | Timeline | Yes |
| `dynamicsOrphanedSpCount` | Stat | Point-in-time |

### Power Platform

| Metric | Display | Trend-able? |
|---|---|---|
| `powerPlatformAppCount`, `flowCount` | Stat + Trend | Yes |

### Copilot

| Metric | Display | Trend-able? |
|---|---|---|
| `copilotLicenseBreakdown` | Distribution | Yes |
| `overshareExposureCount` (Copilot oversharing) | Stat, alert-worthy | Yes |
| Prompt/usage-per-user | *Not collected — needs a Copilot usage report check* | — |

### Usage & Adoption

| Metric | Display | Trend-able? |
|---|---|---|
| `exchangeUsageCount`/`sharePointUsageCount`/`oneDriveUsageCount`/`teamsUsageCount` (adoption score) | Radar (per-service adoption) or Stacked Trend | Yes |
| `exchangeActiveCount`/`sharePointActiveCount`/`oneDriveActiveCount`/`teamsActiveCount` (product usage summary) | Trend | Yes |
| Mobile vs. desktop split | *Not collected* | — |

### Platform/Custom (not tenant data — platform's own health)

| Metric | Display | Trend-able? |
|---|---|---|
| `failedEndpointCount`, `rateLimitEventCount`, `expiringTokenCount` (Graph API health) | Stat, ops-facing | Yes |
| `dbFailureCount`, `queueDepthCount`, `schedulerDelayCount`, `failedServiceCount` | Gauge/Badge, ops dashboard only, not MSP/Customer facing | Yes |

### Workflow Engine

| Metric | Display | Trend-able? |
|---|---|---|
| `workflowFailureCount` | Stat, alert-worthy | Yes |
| `unhealthyNodeCount`, `highLatencyNodeCount`, `invalidSchemaNodeCount`, `nodeTimeoutCount`, `dependencyFailureCount` | Table (ops/admin only) | Yes |
| `queueBacklogCount` | Gauge (queue depth) | Yes |

---

## PART 2 — Platform / Business Data (not Graph-sourced)

These come from the platform's own tables, not `monitor_checks`. Confirmed to exist via schema; not all confirmed populated/wired yet — flagging where that's the case.

### Engine Scores (tenant_engine_snapshots)

| Data | Display | Scope |
|---|---|---|
| Per-engine composite score + history (health, drift, priority, forecasting, security, compliance, governance, adoption, copilot, CRM, MSP Intelligence) | Radar (pillar snapshot) + Trend (per engine over time) | `[BOTH]` |
| `breakdown` JSON per snapshot | Table/expandable detail under each radar point | `[BOTH]` |
| `trendDirection` | Small arrow indicator on each stat | `[BOTH]` |

### Alerts (msp_alert_events, msp_alert_rules)

| Data | Display | Scope |
|---|---|---|
| Recent alerts, by severity/category | Timeline / alert feed | `[BOTH]` |
| Alert volume over time | Trend | `[BOTH]` |
| Alert rule coverage (rules configured vs. active) | Stat | `[MSP]` |

### Client Health (client_health_history, msp_score_history)

| Data | Display | Scope |
|---|---|---|
| Health score history per client | Trend, feeds "Avg Client Health" MSP stat | `[BOTH]` |
| Health across all clients | Heatmap (client × time or client × dimension) | `[MSP]` |

### Projects & Delivery (projects, kanban_tasks, client_services)

| Data | Display | Scope |
|---|---|---|
| Active project count, phase, progress % | Stat + Progress bar | `[BOTH]` |
| Open tasks / tasks assigned to customer | Table + Stat | `[CUST]` |
| Project velocity (tasks completed per period) | Trend | `[MSP]` |
| Task counts by column (kanban) | Bar/Funnel | `[BOTH]` |

### SLA & Scope Creep (existing engines — `runSlaEngineForTenant`, `runScopeCreepEngineForTenant`, confirmed live)

| Data | Display | Scope |
|---|---|---|
| SLA compliance %, response performance | Gauge + Trend | `[CUST]`, rolls up `[MSP]` |
| Active breaches, warning timers | Stat, alert-worthy | `[BOTH]` |
| Scope drift/expansion/timeline status | Badge (3 areas) | `[CUST]` |

### Financial (msp_charges, msp_subscriptions, invoices, msp_sows)

| Data | Display | Scope |
|---|---|---|
| Total Revenue, MRR, Projected ARR | Stat cards | `[MSP]` |
| Outstanding Revenue / invoices needing payment | Stat + Table | `[MSP]` |
| Revenue by service type | Distribution/Bar | `[MSP]` |
| Revenue trend | Trend | `[MSP]` |
| Pipeline value (opportunities table) | Stat + Funnel | `[MSP]` |

### Sales Offers (sales_offers, sales_offer_events, msp_sales_offers)

| Data | Display | Scope |
|---|---|---|
| Active offers per customer | Table/Cards | `[CUST]` |
| Offer funnel (triggered → viewed → accepted) | Funnel | `[MSP]` |
| Remediation offers tied to specific findings | List, linked to the finding that triggered it | `[CUST]` |

### Monitoring Packages (monitoring_packages, msp_customers)

| Data | Display | Scope |
|---|---|---|
| Active monitoring packages per customer | Table/Cards | `[BOTH]` |
| Package coverage across MSP's book (% of customers on which package) | Distribution | `[MSP]` |
| Assessment coverage (% of customers with a completed assessment) | Gauge | `[MSP]` |

### AI Usage (ai_usage_events, ai_balance_ledger, msp_ai_purchases)

| Data | Display | Scope |
|---|---|---|
| Token burn over time | Trend | `[MSP]` |
| Current balance / remaining | Gauge | `[MSP]` |
| Cost by feature/usage type | Distribution | `[MSP]` |

### Workflow Runs (portal_wf_runs, portal_wf_operator_tasks)

| Data | Display | Scope |
|---|---|---|
| Workflows failed (recent) | Stat + Table, alert-worthy | `[MSP]` |
| Approvals waiting (pending_approvals) | Stat + Table | `[MSP]` |
| Background job queue depth (msp_job_queue) | Gauge | `[MSP]` |
| Workflow success rate | Gauge + Trend | `[MSP]` |

### Diagnostics (msp_diagnostic_runs, msp_diagnostic_findings)

| Data | Display | Scope |
|---|---|---|
| Recent tenant scan results | Table/Timeline | `[BOTH]` |
| Findings by severity | Distribution | `[BOTH]` |

### Benchmarking (industry_benchmark_reference)

| Data | Display | Scope |
|---|---|---|
| Client score vs. industry benchmark, per pillar | Radar overlay (client line vs. benchmark line) or Bullet chart | `[CUST]` |
| **Needs SQL confirmation this table is actually populated** — schema exists, population status unconfirmed | — | — |

### Microsoft Service Health (not yet collected — new scope)

| Data | Display | Scope |
|---|---|---|
| M365 service uptime status + incident timer | Badge/Status widget + timer | `[CUST]`, possibly `[MSP]` rollup |
| **No check exists for `/admin/serviceAnnouncement/healthOverviews` yet — this is net-new Monitor Check work**, straightforward Graph endpoint | — | — |

### Message Center (explicitly deferred by you — "coming soon")

| Data | Display | Scope |
|---|---|---|
| Feature flagged, not built | — | `[CUST]` |

---

## Things I found in the data that weren't on either of your lists

Surfacing these since you said "everything else we can find" — these have real data and might be worth adding:

- **Guest user governance** (`guestUserCount`, `externalInviteCount`) — real trend data, external-access risk indicator, fits either dashboard's risk section
- **Orphaned resources** (orphaned Teams, orphaned SharePoint sites, orphaned access packages, orphaned service principals) — real, point-in-time, good "cleanup opportunity" list for the MSP's remediation offers
- **App registration / service principal security** (secret drift, certificate drift, permission drift, orphaned SPs, high-privilege SPs) — real drift data, currently has no home in either dashboard spec — this is genuinely important security-adjacent data
- **eDiscovery case tracking** — real, compliance-adjacent, niche but present
- **Graph API platform health** (endpoint failures, rate limits, token expiry) — this is platform ops data, not customer-facing; flag for an internal ops view, not the MSP/Customer dashboards
- **Dynamics 365 security posture** — real, but only relevant if a given MSP customer actually uses Dynamics; should probably be conditionally shown, not always-on
- **Power Platform governance** (app/flow inventory) — real but thin (inventory count only, no governance depth yet)

---

## Net-new collection gaps (confirmed nothing exists)

For completeness, the honest gap list from this pass:
- License/service cost in dollars (no pricing data source anywhere)
- Copilot prompt/usage-per-user (license count exists, usage doesn't)
- SharePoint storage growth
- Teams Call Quality Dashboard
- Mobile vs. desktop usage split
- Secure Score category breakdown as a shaped output (raw data exists, no group-by transform)
- Sign-in/file-activity heatmap bucketing (raw timestamped data exists, no day/hour transform)
- M365 Service Health / uptime (straightforward to add, just not built)
- Message Center (deferred by you)
