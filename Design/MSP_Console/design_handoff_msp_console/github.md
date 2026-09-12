repo: shanemccaw/Shane-McCaw-MSP
branch: main
path: artifacts/api-server/src/routes (plus artifacts/admin-panel/src/components for the AdminV2 Active Directory panes)

## Last sync

date: 2026-09-11T22:16:00Z

### Updated in this project

- Checked the Tenant Overview roll-up's remaining eight domains against their own contract packs under `docs/msp-console/` (risk register, runbooks, scope & SLA, SOPs, documents, data rights, webhooks, break-glass).
- Added a "How this roll-up is assembled" note block to Tenant Overview recording, per domain, which read each row actually comes from and what it cannot say: the risk register is returned whole and filtered client-side; runbooks/holds are one call with no cross-book read; SLA and scope counts are capped at 200/100 so they are floors; SOP runs are filtered out of the MSP-wide history and a hybrid run with open manual steps settles to Blocked; documents is the one records row with a real customerId filter; data rights is MSPAdmin-only, limit-capped and status-less; break-glass can never show the credential.
- Corrected the webhooks row: operator-disabled (who/when/why recorded) is now counted separately from owner-switched-off, because the owner touching the active flag clears all three columns. SOP row now leads with runs blocked on a manual step.
- Break-glass needed no change — its pack's design cross-check confirms the overview tile and row apply the same `pending_delivery` filter the server does.

## Previous sync

date: 2026-09-11T22:10:00Z

### Updated in this project

- Compared `artifacts/api-server/src/routes` against the last-synced commit: 38 files changed, of which four map to screens here — `msp-customer-scores.ts`, `msp-customer-timeline.ts`, `msp-diagnostics.ts`, `msp-sales-offers.ts`.
- Client → Tenant, Scores and results: priority items now carry the recommendation text alongside the finding. The operator route reads recommendations out of each engine's breakdown and never applies the customer-side paywall, so both lines show in full here.
- Activity Timeline re-checked against the cross-tenant timeline route as it now stands (graded partial runs, the five sources, the significance floor of 5, sent/accepted/rejected/expired offers, unattributed documents) — already accurate, nothing rebuilt.
- Ownership (new screen this session) is the operator half of RACI: what our staff hold across the book, per-customer coverage including the zero rows, and one customer's matrix with cell detail. Its own feature is not architected upstream, which the screen states on itself.

## Previous sync

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
| Client → Ownership | `msp-ownership.ts`, `portal-ownership.ts`, `portal-settings-ownership.ts` |
| Client → Runbooks | `msp-runbooks.ts` |
| Operations → Executive view | `msp-executive.ts` |
| Operations → Scope & SLA | `msp-sla.ts`, `msp-scope-creep.ts` |
| Operations → SOPs | `msp-sops.ts` |
| Operations → Sales | `msp-sales-offers.ts`, `msp-sales-bundles.ts` |
| Operations → Configuration state | `msp-config-state.ts`, `msp-config-state-diffs.ts` |
| Operations → Activity timeline | `msp-customer-timeline.ts` |
| Client → Overview (roll-up + assembly notes) | `msp-rbd.ts`, `msp-runbooks.ts`, `msp-sla.ts`, `msp-scope-creep.ts`, `msp-sops.ts`, `msp-documents-hub.ts`, `msp-data-rights.ts`, `msp-console-webhooks.ts`, `msp-break-glass.ts` |
| Client → Diagnostics | `msp-diagnostics.ts` |
| Operations → Documents, SharePoint connectors | `msp-documents.ts` |

## Not yet covered

Route files on main with no screen in this console yet:

`msp-active-directory` · `msp-admin-settings` · `msp-alerts` · `msp-audit-log` · `msp-compliance-frameworks` · `msp-consent` · `msp-custom-domain` · `msp-dlq` · `msp-engine-history` · `msp-engines` · `msp-m365-sla` · `msp-marketplace-purchase` · `msp-message-center` · `msp-onboarding` · `msp-partner-revenue` · `msp-plan-management` · `msp-plan-self-service` · `msp-poams` · `msp-policy-decisions` · `msp-policy-engine-settings` · `msp-portal` · `msp-reports` · `msp-retention-queue` · `msp-security-plan` · `msp-settings` · `msp-sow` · `msp-staff` · `msp-staff-search` · `msp-standing-policies` · `msp-support` · `msp-vip-classifications`

Deliberately out of scope: `msp-billing-webhook`, `msp-webhooks` (inbound Stripe / app-signature receivers, no operator surface), `msp-signup` (public), `msp-v1` (the `/api/msp/v1/*` programmatic mount — an API surface, not an operator screen).
