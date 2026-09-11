repo: shanemccaw/Shane-McCaw-MSP
branch: main
path: artifacts/api-server/src/routes (plus artifacts/admin-panel/src/components for the AdminV2 Active Directory panes)

## Last sync

date: 2026-09-11T02:09:40Z
commit: c10d85919617

### Updated in this project

- One new route upstream since the last sync: `msp-customer-scores.ts` (74 non-test `msp-*` route files, was 73) — the MSP-side view of a single customer's composite score, per-engine scores, pillar breakdown and priority findings, reading the same `tenant_engine_snapshots` data behind the customer's own portal dashboard.
- Client → Tenant: added a Scores and results section — composite score, the six engine scores (security, health, governance, drift, SLA, scope creep) with bars, and the latest run's critical/warning findings worst-severity-first, capped at five.
- Noted on that screen that the portal's free-tier paywall does not apply here: the customer-facing route redacts finding and recommendation text behind a paid assessment, this one never does, because the operator is the one doing the work.

## Previous sync

date: 2026-09-10T23:16:48Z

### Updated in this project

- Rebuilt the tenant page as the AdminV2 AD customer canvas: profile tiles (tenant GUID, industry, status, owning MSP) with the editable Business Unit field, Consent rows with armed revoke and a re-consent link, Write-back consent (admin), Recent scans, Purchased services, Users, and the two-step hard delete.
- Run scan mirrors the canvas: one package runs unprompted, more than one opens the picker pre-selected to the customer's resolved subscription, and the outcome banner is dismissible.
- Dropped the invented subscription/payment/control cards from that screen in favour of the canvas's own sections.

## Previous sync

date: 2026-09-10T23:12:02Z

### Updated in this project

- Clicking a tenant name now opens a Tenant control screen (profile, subscription and entitlements, payment state, consent, scan trigger with last-scan results, control cards). Overview went back to being the health roll-up only.
- Clicking the Shane McCaw Consulting node opens MSP settings: profile, contact, subscription, derived entitlements, admin actions (edit / impersonate / suspend / reactivate), platform agreement acceptances and per-MSP activity.
- Noted on that screen that the admin panel has two Active Directory surfaces: the original pane is read-only apart from suspend/reactivate, while the AdminV2 object canvas adds profile edit, MSP impersonation, contact and notes fields, the audit trail and the RBAC org-roles panel.

## Previous sync

date: 2026-09-10T23:07:08Z

### Updated in this project

- Client → Overview is now a tenant roll-up: identity/profile card (status, tenant GUID, tenant URL, industry, testbed, owning MSP), Subscription and entitlements, Tenant consent, Tenant control, then the existing outstanding-work roll-up.
- Added a Scan tenant action with a last-scan panel (run id, check counts, package, trigger, narrative), read from the tenant's diagnostic runs.
- Built from the admin panel's Active Directory customer pane — its Profile / Pillar / Telemetry / Consent / DLP-provisioning / Actions / Recent Diagnostic Runs sections — plus the MSP pane's Subscription and Entitlements fields.

## Previous sync

date: 2026-09-10T22:43:07Z

### Updated in this project

- Three new `msp-*` route files upstream: `msp-evidence-attachments.ts`, `msp-m365-sla.ts`, `msp-v1.ts` (70 → 73).
- Change Control → Executions: added a note for execution screenshot evidence (image-only, 20 MB, tenant GUID resolved to the portal customer, MSP-scoped file serving).
- Client → Remediation, tracker tab: added a note for step screenshot evidence — upload refuses a step with no tracked status; the listing returns an empty array instead.
- `msp-m365-sla.ts` is a separate domain from `msp-sla.ts` (Microsoft's 99.9% uptime commitment, not the MSP's ticket SLA) and has no screen yet.

## Sync history

- 2026-09-09T23:51:10Z — checked every mapped route file against upstream: all unchanged, no screen rebuilt.

- 2026-09-09T23:10:14Z — audited all 70 `msp-*` route files, recorded the uncovered set below.
- 2026-09-09T22:47:27Z — confirmed risk decisions are keyed by tenant GUID; moved the Risk Register into the customer tree.

## Screen map

| Screen (MSP Console.dc.html) | Repo files |
|---|---|
| Client → Tenant (tenant node) | `adminv2/screens/ad/canvases/AdCustomerCanvas.tsx`, `msp-diagnostics.ts`, `msp-consent.ts`, `msp-customer-scores.ts` |
| MSP → Settings (root node) | `adminv2/screens/ad/canvases/AdMspCanvas.tsx`, `components/ActiveDirectoryMspPane.tsx`, `msp-admin-settings.ts`, `msp-audit-log.ts` |
| Client → Team | `msp-team.ts` |
| Client → Change Control | `msp-changes.ts`, `msp-evidence-attachments.ts`, `msp-change-catalog.ts`, `msp-change-control-cab.ts`, `msp-change-freeze-windows.ts`, `msp-change-maintenance-windows.ts`, `msp-change-dependencies.ts`, `msp-change-executions.ts`, `msp-change-pir.ts` |
| Client → Break-glass (+ root watchlist) | `msp-break-glass.ts` |
| Client → Data rights (+ root feed) | `msp-data-rights.ts` |
| Client → Documents (hub) | `msp-documents-hub.ts` |
| Client → Webhooks | `msp-console-webhooks.ts` |
| Client → Launch Control | `msp-launch-control.ts` |
| Client → Remediation | `msp-remediation-tracker.ts`, `msp-evidence-attachments.ts`, `msp-remediation-tracker-scores.ts`, `msp-remediation-tracker-export.ts`, `msp-remediation-checklist.ts`, `msp-remediation-fix-routes.ts`, `msp-remediation-reveal.ts`, `msp-remediation-bypass-resolutions.ts` |
| Client → Risk Register | `msp-rbd.ts`, `msp-rbd-instances.ts`, `msp-rbd-versions.ts` |
| Client → Runbooks | `msp-runbooks.ts` |
| Operations → Executive view | `msp-executive.ts` |
| Operations → Scope & SLA | `msp-sla.ts`, `msp-scope-creep.ts` |
| Operations → SOPs | `msp-sops.ts` |
| Operations → Documents, SharePoint connectors | `msp-documents.ts` |

## Not yet covered

Route files on main with no screen in this console yet:

`msp-active-directory` · `msp-admin-settings` · `msp-alerts` · `msp-audit-log` · `msp-compliance-frameworks` · `msp-config-state` · `msp-config-state-diffs` · `msp-consent` · `msp-custom-domain` · `msp-customer-timeline` · `msp-diagnostics` · `msp-dlq` · `msp-engine-history` · `msp-engines` · `msp-m365-sla` · `msp-marketplace-purchase` · `msp-message-center` · `msp-onboarding` · `msp-ownership` · `msp-partner-revenue` · `msp-plan-management` · `msp-plan-self-service` · `msp-poams` · `msp-policy-decisions` · `msp-policy-engine-settings` · `msp-portal` · `msp-reports` · `msp-retention-queue` · `msp-sales-bundles` · `msp-sales-offers` · `msp-security-plan` · `msp-settings` · `msp-sow` · `msp-staff` · `msp-staff-search` · `msp-standing-policies` · `msp-support` · `msp-vip-classifications`

Deliberately out of scope: `msp-billing-webhook`, `msp-webhooks` (inbound Stripe / app-signature receivers, no operator surface), `msp-signup` (public), `msp-v1` (the `/api/msp/v1/*` programmatic mount — an API surface, not an operator screen).
