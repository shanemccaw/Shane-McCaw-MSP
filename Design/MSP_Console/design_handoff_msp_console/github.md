repo: shanemccaw/Shane-McCaw-MSP
branch: main
path: artifacts/api-server/src/routes (plus artifacts/admin-panel/src/components for the AdminV2 Active Directory panes, and docs/msp-console for the UI contract packs)

## Last sync

date: 2026-09-12T18:12:33Z

### Updated in this project

- Built **Partner Revenue** (`Partner Revenue.dc.html`) from `partner-revenue-msp-console-contract-pack.md` — the single `msp-partner-revenue.ts` route, drawn as the two sections the route's own header insists must never be conflated.
- The verified half (what the MSP pays the platform) is a solid statement panel; the resale worksheet is deliberately a dashed, muted panel with the disclaimer always present, because MSPs invoice their own customers outside the platform and no figure there has ever been charged or reconciled. The two are never totalled together.
- Recorded on the screen: the monthly cost is absent rather than zero when the subscribed service has no price (the live state — the one subscription in the system points at an add-on, not a tier); a bundle never assigned and one whose assignments were all revoked are identical on the wire; the cost side is platform-computed while only the resale price is the MSP's own, a distinction the response does not mark; draft and archived bundles are invisible even to their owner; no history, date range or pagination exists.
- With this, all 38 `docs/msp-console` contract packs that map to a screen are built — the uncovered-pack list is empty except `msp-webhooks-inbound`, which stays deliberately out of scope.
- `msp-partner-revenue` comes off the uncovered list. No commit sha recorded (the tree call returns a tree hash).

## Previous sync

date: 2026-09-12T18:09:12Z

### Updated in this project

- Built **Marketplace Purchase** (`Marketplace Purchase.dc.html`) from `marketplace-purchase-msp-console-contract-pack.md` — the two `msp-marketplace-purchase.ts` routes: the customer-scoped catalog and staff-initiated checkout on the MSP's card.
- The pack's four filed findings are all designed against rather than hidden. #3400 leads the page: the accepted offer is written and broadcast to the customer before payment is attempted and nothing ever rolls it back, so the screen confirms before sending and a "card that will decline" action shows exactly what a failure leaves — a permanent wrong accepted offer, no money, no audit entry.
- #3403: retainer items carry a per-item warning that a monthly engagement will bill once and record no subscription. #3404: items whose fulfilment type matches nothing carry a "nothing will be provisioned" warning, and the outcome panel states it. #3405: the free path notes the missing allow-free-activation gate the customer's own checkout honours.
- The three real refusals (signature-gated project item, no fixed price, per-seat rate) are computed per row so the catalog labels what can actually be bought here.
- `msp-marketplace-purchase` comes off the uncovered list. No commit sha recorded (the tree call returns a tree hash).

## Previous sync

date: 2026-09-12T18:03:59Z

### Updated in this project

- Built **AD OU Assignment** (`AD OU Assignment.dc.html`) from `active-directory-ou-assignment-msp-console-contract-pack.md` — two tabs over the six `msp-active-directory.ts` routes: unit placements (list, place, move, clear) and the customer-raised request queue (list with status filter, resolve).
- The banner leads with the resolution order that makes a placement meaningful: a manual row wins, and everyone else falls to a department-name guess — so clearing a placement hands the person back to that guess, which the clear action states outright.
- Carried through from the pack: a tenant-less unit is refused before any lookup (no column ties it to one MSP); placing verifies the address in the real directory but moving does not re-verify; re-placing moves rather than duplicates, enforced by a real uniqueness rule; clearing is a hard delete with no history; a request's unit-at-the-time is a snapshot that is never rechecked; approving a request that names a non-existent unit changes only the status, so the button reads "Approve (writes nothing)"; approved and fulfilled are identical server-side and neither can return to waiting; the display name is never authoritative.
- `msp-active-directory` comes off the uncovered list. No commit sha recorded (the tree call returns a tree hash).

## Previous sync

date: 2026-09-12T18:00:13Z

### Updated in this project

- Built **Offboarding** (`Offboarding.dc.html`) from `offboarding-msp-console-contract-pack.md` — the whole-MSP, forward-only lifecycle across the three `msp-portal.ts` routes (request, export, archive) plus the state fields read off the dashboard response.
- Drawn as a four-step stepper with exactly one action available at a time, because nothing resets the state: the first step carries the heaviest warning on the screen rather than a quiet confirm.
- Recorded on the screen: the export route does not verify cancellation ever happened (it refuses only an archived MSP), so the sequence is enforced by the UI; archival suspends the MSP with the same status value non-payment produces, so status alone cannot distinguish the two; the three steps have three different repeat behaviours (conflict, silent success, reported no-op); only the first export is audited, so the log cannot say how many times customer data left.
- Archival is the PlatformAdmin step and names its target MSP explicitly rather than reading the session — the role pill switches between the two sides of that gate.
- `msp-portal` comes off the uncovered list. No commit sha recorded (the tree call returns a tree hash).

## Previous sync

date: 2026-09-12T17:56:56Z

### Updated in this project

- Built **Retention Queue** (`Retention Queue.dc.html`) from `retention-queue-msp-console-contract-pack.md` — the three `msp-retention-queue.ts` routes: the pending list, decide (approve or decline), and discuss (decline-then-restore).
- The pack's §4 finding sets the whole design: no record class is registered and nothing calls soft-delete or request-acceleration, so the queue can never hold a row on any deployment. The screen opens on that as its real state — three blocker tiles naming what is missing — and the populated queue sits behind an explicitly labelled "not live data" view so the page is ready when a module wires in.
- Also recorded on the screen: approve purges inside the same request with no staged step or undo; against a hand-inserted row both approve and restore fail at the record-class lookup with an unmappable error; the approve field treats anything but the exact boolean true as a decline; restore requires a reason but a missing one arrives as an empty string and is caught late; the decline note written during a restore is hardcoded, not the operator's words.
- The two reasons (why deleted, why now) are kept as separate panels — the distinction the data model exists to preserve.
- `msp-retention-queue` comes off the uncovered list. No commit sha recorded (the tree call returns a tree hash).

## Previous sync

date: 2026-09-12T17:50:43Z

### Updated in this project

- Built **DLQ** (`DLQ.dc.html`) from `dlq-msp-console-contract-pack.md` — the four `msp-dlq.ts` routes: list, single replay, patch (resolve and/or replace payload), bulk replay.
- The screen derives replayability from the payload and holds Replay closed when there is no workflow key, because the route has no precheck and answers a bare 500 with only the raw message — and, per the pack's live check, every row in the table today is a job-drainer failure that fails exactly that way (#3446). The platform-admin sibling's clean refusal is what the client-side gate imitates.
- Bulk replay is drawn disabled: it is registered with an extra path prefix, so it 404s at the address its siblings imply (#3445). Clicking it states that.
- Also carried through from the pack: replay creates a new run rather than retrying in place and never increments the attempt count (the runbook claiming otherwise is #3447), payload edits replace rather than merge with no fix-and-replay in one call, an empty patch succeeds while changing nothing, resolution is write-once and a person can only write discarded or manual, and the filters are labelled as client-side because the route takes no parameters and returns a bare array.
- `msp-dlq` comes off the uncovered list. No commit sha recorded (the tree call returns a tree hash).

## Previous sync

date: 2026-09-12T17:40:57Z

### Updated in this project

- Built **Reports** (`Reports.dc.html`) from `reports-msp-console-contract-pack.md` — four tabs over the nineteen `msp-reports.ts` routes: definitions (create with the eight real doc types and three delivery methods, pause, admin-only soft delete), runs, canvases and schedules, license waste.
- The pack's filed UX gap is designed against directly: a run whose email send failed stays marked generated with the failure only in an error field, so the run row carries an explicit "generated, but the email never arrived" warning instead of reading as a success the way the existing admin-panel page does.
- Trigger is modelled as accepted-then-polled (the response returns before any work happens and later failures never surface), the runs footer states that the returned count is the page size rather than a real total with no offset to page past it, retry is labelled as a brand-new run with no link to the failure, and risk-decision-document rows are marked as rendered elsewhere rather than generated here.
- Schedules show no next-send date because nothing executes them and those columns are never written; the canvas recipient type is labelled stored-but-never-read; license waste distinguishes no-data from zero.
- `msp-reports` comes off the uncovered list. No commit sha recorded (the tree call returns a tree hash).

## Previous sync

date: 2026-09-12T17:34:11Z

### Updated in this project

- Built **POA&Ms** (`POA&Ms.dc.html`) from `poams-msp-console-contract-pack.md` — the eight `msp-poams.ts` routes: list, create (draft or pending-signature only), one plan with milestones, generic edit, dedicated cancel, and milestone add/complete/delete.
- The role toggle is load-bearing: as an operator, Cancel plan goes through the generic edit route and the screen says so, because the dedicated cancel route requires an admin while the generic one accepts the same status at the operator floor (#3452 upstream).
- Also surfaced from the pack: completed is reachable only through that same generic route with no condition, so marking a plan complete with open milestones is shown as exactly that; a completed milestone is frozen against edits but still deletable, and the row carries that warning; overdue and signed are derived client-side because these routes return the bare row while the customer portal derives both server-side for the same table.
- Signature, the accountable-holder trail and the move to active are shown read-only — only `portal-poams.ts` writes them.

## Previous sync

date: 2026-09-12T17:30:19Z

### Updated in this project

- Built **Account Security** (`Account Security.dc.html`) from `account-security-msp-console-contract-pack.md` — roster resolved by MSP id alone, the five `msp-settings.ts` credential routes and the per-user session revoke, each labelled with its route and real response. The target-role ceiling is enforced by the screen only (#3032 upstream), the enforcement toggle is marked unconfirmable because it answers ok for a non-existent id, and each roster row shows its scope since four of the nine reachable accounts are customer users caught by the Phase-0 leftover id.
- Built **Status Reports** (`Status Reports.dc.html`) from `status-reports-msp-console-contract-pack.md` — the five `msp-status-reports.ts` routes: draft create, paginated list sorted by the period covered, one report, draft-only patch, and the one-way publish. Empty state is the live truth (zero rows, no caller anywhere), publish carries a confirm step because there is no unpublish and no edit after it, and a null author renders as "Unknown operator" since the wire has no fallback.
- Superseded note: an earlier interrupted turn described Status Reports as health/audit/compliance report types with a matrix and remediations. The pack has no such thing — one untyped text field, two states, five routes. The screen matches the pack.
- Screen map and pack inventory updated; `msp-status-reports` comes off the uncovered list. No commit sha recorded (the tree call returns a tree hash).

## Previous sync

date: 2026-09-12T17:22:30Z

### Updated in this project

- Inventoried `docs/msp-console` at `main`: 38 contract packs. 27 map to a screen in this project; 11 have no screen. Blob shas for all 38 are recorded in "## Contract packs" below so the next pass can detect a changed pack instead of re-reading everything.
- Two packs have a file here that is an empty stub, not a screen: **account-security** (20.6 KB) and **status-reports** (14.0 KB). These are the real gaps.
- Read `account-security-msp-console-contract-pack.md` in full. It is **not** the self-service auth screen built earlier today — it is the operator acting on another account, and it documents only five routes, all in `msp-settings.ts` (reset-password, temp-password, reset-mfa, mfa-enforcement, status), plus `DELETE .../users/:userId/sessions`. Its own findings: no target-role ceiling on any of the five (filed upstream as #3032, a live privilege-escalation path once a real MSPAdmin exists), `requireChange` on the temp password is advisory and enforced nowhere, `mfa-enforcement` has no existence check and returns ok for a userId that does not exist, and no `tenantId`-scoped equivalent exists at all.
- That pack shares its five routes verbatim with the msp-staff-roles-and-onboarding pack §4, so an Account Security screen and any staff-roster screen would be two views of one surface.
- No screen rebuilt this pass. No commit sha recorded (the tree call returns a tree hash).

## Previous sync

date: 2026-09-12T17:19:27Z

### Updated in this project

- Compared `artifacts/api-server/src/routes` from the last recorded commit (c10d85919617) through `main`: 54 files changed, and the list came back server-truncated, so unlisted mapped files are treated as possibly changed. No screen rebuilt — the 05:54 review of this same range already established that none of the mapped route files change visible behavior.
- `auth.ts` is in the changed set, but the Authentication screen was built earlier this turn from a fresh read of `auth.ts` and `mfa.ts` at `main`, so it is already current. No other screen maps to either file.
- Screen map now records Authentication against `auth.ts` / `mfa.ts`, and both come off the uncovered list.
- `Status Reports.dc.html` is an empty stub in this project, not a built screen, so `msp-status-reports.ts` stays uncovered. `msp-kanban.ts`, `msp-communications-push.ts` and `msp-training-sessions.ts` are still uncovered for the reasons recorded below.
- No commit sha recorded: the compare resolves `main` by name and the tree call returns a tree hash, not a commit.

## Previous sync

date: 2026-09-12T17:14:18Z

### Updated in this project

- New screen: Authentication (`Authentication.dc.html`) — sign in, two-factor challenge, forgot/reset password, change MFA, sign out — built from `auth.ts` and `mfa.ts`, both previously uncovered.
- Login encodes the real branches: 400 missing fields, generic 401, the distinguishable "no password set" 401, the 423 per-account lockout (env-tunable threshold/window/duration) and the `mfaRequired` + 10-minute mfaToken split, plus the `mfaSetupPending` session that reaches only the enrollment routes.
- Forgot-password shows the response and the server truth separately, because `{ ok: true }` is returned before the lookup: reset token (1h), account-setup token (72h) for an entitled passwordless buyer, and the silent refusal for a prospect with no `client_services` row.
- Change MFA covers TOTP/SMS/passkey enrolment and removal, the admin passkey-only gates, and the PlatformAdmin reset. Recorded as gaps: no per-credential passkey delete, removal of the last method needs no re-auth, logout revokes the refresh token but not the 15-minute access token, and reset-password revokes no sessions while change-password revokes all others.

## Previous sync

date: 2026-09-12T05:54:07Z

### Updated in this project

- Compared `artifacts/api-server/src/routes` against the last-synced commit (c10d85919617) through `main`: 49 files changed under this scope. Of those mapped to a screen here — `msp-changes.ts`, `msp-change-dependencies.ts`, `msp-customer-scores.ts`, `msp-customer-timeline.ts`, `msp-diagnostics.ts`, `msp-sales-offers.ts`, `msp-sops.ts`, `msp-admin-settings.ts`, `msp-audit-log.ts` — none change visible behavior: the Change Control changes are internal hardening (approval-gating on the generic PATCH transition, a single unified rejection path, a batched dependency-aggregate read the Dependencies tab already covers), and the rest are additive/defensive fixes with no new UI surface.
- New this range: `msp-kanban.ts` — real `kanban_buckets`/`kanban_cards` CRUD for a Simple Kanban board, scoped per customer. Its own header states this is backend/data-model only with **no MSP Console UI screen yet — blocked on real nav placement (#3768)**. Not a build source for the requested Project Management page yet; that page still needs real Figma designs. Watching for #3768 to land before treating this as the page's data source.
- Also new/added upstream with no mapped screen: `msp-communications-push.ts`, `msp-status-reports.ts`, `msp-training-sessions.ts` — all outside this console's current screen map, noted for awareness only.
- Everything else in the wider repo diff (`admin-panel`, `msp-poams`/`msp-portal`/`msp-reports`/`msp-settings`, test-only files) is either unrelated to this console's mapped routes or already tracked in "Not yet covered."

## Previous sync

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
| Authentication (sign in / two-factor / forgot password / change MFA / sign out) | `auth.ts`, `mfa.ts` |
| Account Security (operator acting on another account) | `msp-settings.ts` (users/:userId security routes) |
| Status Reports | `msp-status-reports.ts` |
| Partner Revenue | `msp-partner-revenue.ts` (+ `msp-sales-bundles.ts`, `msp-plan-pricing.ts`) |
| Marketplace Purchase | `msp-marketplace-purchase.ts` (+ `portal-marketplace.ts`, `catalog-pricing.ts`, `resolve-fulfillment.ts`) |
| AD OU Assignment | `msp-active-directory.ts` (+ `admin-active-directory.ts` helpers, `policy-compliance-graph.ts`) |
| Offboarding | `msp-portal.ts` (offboarding routes + dashboard state fields) |
| Retention Queue | `msp-retention-queue.ts` (+ `lib/retention/lifecycle.ts`, `registry.ts`) |
| DLQ | `msp-dlq.ts` (+ `portal-workflow-engine.ts`, `lib/dlq.ts`, `admin-dlq.ts` for the cross-surface comparison) |
| Reports | `msp-reports.ts` (+ `report-nodes.ts`, `compileReportToHtml.ts`, `rbd-document-render.ts`) |
| POA&Ms | `msp-poams.ts` (+ `portal-poams.ts`, `poam-ref.ts` for the cross-surface reads) |
| Operations → Documents, SharePoint connectors | `msp-documents.ts` |

## Not yet covered

Route files on main with no screen in this console yet:

`msp-admin-settings` · `msp-alerts` · `msp-audit-log` · `msp-communications-push` · `msp-compliance-frameworks` · `msp-consent` · `msp-custom-domain` · `msp-engine-history` · `msp-engines` · `msp-m365-sla` · `msp-message-center` · `msp-onboarding` · `msp-plan-management` · `msp-plan-self-service` · `msp-policy-decisions` · `msp-policy-engine-settings` · `msp-security-plan` · `msp-sow` · `msp-staff` · `msp-staff-search` · `msp-standing-policies` · `msp-support` · `msp-vip-classifications`

Deliberately out of scope: `msp-billing-webhook`, `msp-webhooks` (inbound Stripe / app-signature receivers, no operator surface), `msp-signup` (public), `msp-v1` (the `/api/msp/v1/*` programmatic mount — an API surface, not an operator screen).

## Contract packs (docs/msp-console @ main, read 2026-09-12T17:22:30Z)

Blob sha per pack — a changed sha means the pack was updated upstream.

| Pack | Screen here | Blob |
|---|---|---|
| msp-webhooks-inbound | none — deliberately out of scope (inbound receivers) | eb7637149782 |
| account-security | Account Security | 2f24fa872f0a |
| status-reports | Status Reports | 2184761bb38c |
| poams | POA&Ms | 2b2180715c58 |
| reports | Reports | c1203675460e |
| dlq | DLQ | fcc7caac0670 |
| retention-queue | Retention Queue | adcf2e013d1a |
| offboarding | Offboarding | 33a9b4d1d6f5 |
| active-directory-ou-assignment | AD OU Assignment | e129cdeea1cf |
| marketplace-purchase | Marketplace Purchase | 788ae58df6f7 |
| partner-revenue | Partner Revenue | 048759f15dc8 |
| admin-panel-msp-tenant-management | MSP Console (tenant canvas + MSP settings) | 7cf216c979d0 |
| audit-log | MSP Console (MSP → Settings activity) — partial | 45224f604f29 |
| break-glass | Break Glass | 01f55c2150e4 |
| change-control | Change Control | 0c1395f64821 |
| config-state | Configuration State | feaafcd4249b |
| consent-and-onboarding | MSP Console (tenant Consent) — partial | 1c636b4d564b |
| customer-timeline | Activity Timeline | c8850864d6fd |
| data-rights-and-privacy | Data Rights | 50cd6b41db0d |
| diagnostics | Diagnostics | d1f94db599dc |
| documents | Documents | 498454ebfc79 |
| managed-tenants-directory | Console Shell / MSP Console | 57d15927b0f0 |
| msp-console-webhooks | Webhooks | 3c3364766816 |
| msp-executive | Executive View | c54e5f120490 |
| msp-launch-control | Launch Control | c9910735a62d |
| msp-plan-self-service | Plan Self-Service | bc91da330022 |
| msp-settings | MSP Console (MSP → Settings) | 2251307f05ee |
| msp-staff-roles-and-onboarding | Team / Ownership — partial | 6fe470cef94b |
| offers-and-sow-acceptance | Sales — partial (SOW acceptance not built) | 891188a21142 |
| policy-decisions | Policy Engine | 16df4a602c2c |
| remediation-tracking | Remediation | e05426ea83d0 |
| risk-register | Risk Register | fe05e83fcf84 |
| runbooks | Runbooks | 6a1d23551a20 |
| sales-offers-and-bundles | Sales | 8eadd355fbfc |
| scope-and-sla | Scope and SLA | 452f244deff8 |
| sops | SOPs | aaea6b9a33b2 |
| team-management-and-invitations | Team | 2d498c9464f1 |
| tenant-scores-and-results | MSP Console (Client → Tenant, scores) | 51095816e828 |

No pack covers `auth.ts`/`mfa.ts` self-service sign-in, MFA change or session sign-out, so `Authentication.dc.html` was built from the routes directly. The customer-facing read side lives outside this folder, at `docs/portal/account-security-contract-pack.md`.
