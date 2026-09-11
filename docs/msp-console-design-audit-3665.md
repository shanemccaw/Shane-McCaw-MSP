# MSP Console Design — real, systematic freshness audit (Git #3665)

Read-only audit. Covers all 32 real screens found in
`Design/MSP_Console/design_handoff_msp_console/MSP Console.dc.html` (the file's own
`class Component extends DCLogic`, starting ~line 1504, is the real specification —
this audit is built from that, not from screenshots or nav labels) against the 32 real
contract packs in `docs/msp-console/`, and, where a pack itself needed independent
verification, the real route/lib code under `artifacts/api-server/src/`.

**Real screen count is 32, not 33.** The file's own `childGroups`/`childPages`
(~line 1569) and `mspPages` (~line 1643) arrays enumerate 22 tenant-scoped pages + 9
MSP-wide ("Operations") pages = 31, plus the root "Managed Tenants" directory screen
(`sel.kind === "root"`) = 32 distinct real screens. The design's own README says "33
distinct screens" in prose; that count does not match either the nav arrays or the
issue body's own 31-item enumeration — a minor, harmless inconsistency in the design's
self-description, not a real gap, noted here rather than silently reconciled.

**Methodology.** The design annotates many of its actions/panels with a real
`wire: "METHOD /path"` string (106 occurrences across the file) — the design's own
claim about which real route backs that piece of UI. Each screen below was read at its
real render block in the .dc.html (found via the logic class's `page === "..."` /
`mspSel === "..."` checks, not by nav label), its `wire:` claims and `notes[]` gap
statements extracted, and cross-checked against the actual content of the matching
`docs/msp-console/*.md` pack (never assumed from filename alone — this file already
contains one confirmed case, "Signals", where the nav label doesn't match the real
backing module). Several packs were independently checked against the live route file
where a claim needed direct verification rather than trusting the pack's own prose.

## Per-screen results

| # | Screen | Screen ID | Real data source | Matching pack | Status | Note |
|---|---|---|---|---|---|---|
| 1 | Managed Tenants | `sel.kind==="root"` | `tenantData` static mock array (dc.html:1562-1567); no `wire:` claim | none | **No backend/pack** | No pack, and no real route (`artifacts/api-server/src/routes/*.ts` grepped directly), documents a "list all customers in book" endpoint returning per-tenant seats/people/lastScan/openSignals. Genuine, unbuilt gap. |
| 2 | Tenant Overview | `page==="overview"` | Client-side rollup of 9 real domains (dc.html:3121-3189): `crs`, `rosters`, `bgSecrets`, `rbds`, `runbooks`/`holdWindows`, `slaTimers`/`slaBreaches`/`scopeDetections`, `sopRuns`, `hubDocs`, `drActivity`, `webhooks`. Zero `wire:` claims of its own (it's a pure aggregation screen). | 8 of 9 sources map to real packs (change-control, risk-register, runbooks, scope-and-sla, sops, documents, data-rights-and-privacy, msp-console-webhooks) | **Stale** | The "Break-glass credentials unclaimed" tile and row (dc.html:3151,3167, sourced from `bgSecrets`) has no matching pack anywhere — same root cause as row 17 (Break-glass), see there. |
| 3 | Signals | `page==="signals"` | **Confirmed unbuilt placeholder.** Resolves only to `pageMeta.signals` (dc.html:2008-2011), rendered by the generic `isFrames`/`frames` template (dc.html:639-649) — dashed-border boxes with an icon/name/note, no real rows, no data binding, no `wire:` string anywhere. | none | **No backend/pack (design placeholder)** | **Refutes the issue's own stated premise.** The issue asserts Signals "draws from Scope-Creep/SLA data... not the newly-built Tenant Scores backend." Neither is true: the per-tenant Signals nav screen has **no real render block at all** — `isSla`/`mspSel==="sla"` (the screen the scope-creep formula at dc.html:3652 actually belongs to) is a wholly separate, MSP-wide "Scope & SLA" Operations page (row 30), never reached via `page==="signals"`. The two are never true together. `tenantScores`/`GET /msp/customers/:id/scores` (dc.html:3059-3117) also isn't on this screen — it's inside `isTenantHome` (the tenant-record landing page reached with no `page` selected at all, a third, distinct screen from both Signals and "Tenant Overview"). This is a real, first-order finding: the per-tenant Signals screen simply hasn't been designed yet. |
| 4 | Diagnostics | `page==="diag"` | `this.diagRuns[tIdx]`/`this.diagFindings[tIdx]`, wire dc.html:3834-3870 | `diagnostics-msp-console-contract-pack.md` | **Current** | Exact match incl. the severity-sort-by-text bug (pack:570-575) and 50%-coverage CIO-narrative gate (pack:270,308-315). |
| 5 | Remediation | `page==="rem"` | `remBundle.checklist/.fix/.bypass/.steps`, wire dc.html:3894-3949 | `remediation-tracking-msp-console-contract-pack.md` | **Current** | Exact match incl. the design's own gap note (checklist accepts `accepted_risk`, s1-s30 tracker 400s on it) — already documented in the pack as a known real discrepancy (pack §4, "Filed §7.1"). |
| 6 | CR register | `cc.register` | `this.crs`, wire dc.html:2678-2682,2707,2709 | `change-control-msp-console-contract-pack.md` §2.1,§9 | **Current** | Matches incl. "no MSP-side change metrics endpoint" gap note (pack §9 OPEN GAP). |
| 7 | Standard Catalog | `cc.catalog` | `this.catalogData`, wire dc.html:2728,2730 | same pack §4 | **Current** | Matches incl. approve-has-no-source-state-check note. |
| 8 | CAB | `cc.cab` | `this.cabData`, wire dc.html:2749,2751 | same pack §5 | **Current** | Matches verbatim incl. "standard changes structurally cannot reach an agenda." |
| 9 | Freeze & maintenance | `cc.calendars` | `this.calendarData`, wire dc.html:2770,2772 | same pack §6 | **Current** | Matches incl. no-delete-route/PATCH-active-false behavior. |
| 10 | Dependencies | `cc.deps` | `this.depData`, wire dc.html:2790,2792 | same pack §6 | **Current** | Matches incl. direct-reverse-cycle-only rejection. |
| 11 | Executions | `cc.exec` | `this.execData`, wire dc.html:2811,2813-2814 | same pack §7 | **Stale** | Third note (dc.html:2814, `POST .../executions/:id/evidence`) cites a real, mounted route in `msp-evidence-attachments.ts` (routed at `routes/index.ts:561`, part of #3503) that the pack's "eight routers" inventory (§1) and §7 route table never mention. **Pack is out of date** relative to a real, already-shipped capability the design already wires against. |
| 12 | PIRs | `cc.pir` | `this.pirData`, wire dc.html:2833,2835 | same pack §8 | **Current** | Near-verbatim match incl. "reports zero drift by construction" for first-run baselines. |
| 13 | Risk Register | `risk` | RBD table, wire dc.html:3292-3332 | `risk-register-msp-console-contract-pack.md` | **Current** | Matches incl. unscoped list route and dropped `expired` status. |
| 14 | Runbooks | `run` | runbook/hold-window data, wire dc.html:3210-3265 | `runbooks-msp-console-contract-pack.md` | **Current** | Matches incl. one-customer-per-call constraint and unbuilt author/reorder/record-outcome actions. |
| 15 | Data rights | `dr` | DR activity feed, wire dc.html:2917-2940 | `data-rights-and-privacy-msp-console-contract-pack.md` | **Current** | Matches field-for-field; `retention-queue` pack confirmed to be a genuinely different module, not this screen's "manual fulfillment" note. |
| 16 | Team | `team` | roster + danger-drawer, wire dc.html:2617-2621,5017 | `team-management-and-invitations-msp-console-contract-pack.md` | **Current** | Correctly targets `/api/msp/team/...` (`msp-team.ts`), not the similarly-named but structurally different `/msp/settings/users/...` in `account-security-msp-console-contract-pack.md` — a real, confirmed near-miss worth flagging for implementers. |
| 17 | Break-glass | `bg` | pending-secret data, wire dc.html:2872,2888,2895-2897 | **none** | **No pack (backend is real & Current)** | Verified directly against `artifacts/api-server/src/routes/msp-break-glass.ts` + `break-glass-verification.ts` — every claim (routes, `ELIGIBLE_ROLE_TEMPLATE_IDS` GUID, 409/502/503 error shapes) is real and accurate. **No contract pack exists anywhere in `docs/msp-console/` for this module** — a documentation gap in the pack set, not a design defect. Same root cause as row 2's Overview stale finding. |
| 18 | Launch Control | `lc` | action catalog + audit log, wire dc.html:3980-4004 | `msp-launch-control-contract-pack.md` | **Current** | Matches incl. identical 6-gate error sequence and 123-catalog/102-template unlinked counts. |
| 19 | Webhooks | `wh` | webhook + delivery data, wire dc.html:4027-4075 | `msp-console-webhooks-contract-pack.md` | **Current** | The `/api/portal/webhooks/:id` PATCH citation (dc.html:4075) is confirmed **correct, not an error** — a real, documented cross-surface behavior (the customer-portal route silently clears MSP-disable-tracking columns on any `isActive` touch, pack §4). Worth flagging to product as a real UX edge case, not a design bug. |
| 20 | Contracts | `contracts` | **Confirmed unbuilt placeholder** (`pageMeta.contracts`, dc.html:2003-2007, same `isFrames` skeleton as Signals). No `page==="contracts"` block exists anywhere in the file. | none (fragments in `offers-and-sow-acceptance` and `scope-and-sla` packs, none matching) | **No backend/pack (design placeholder)** | No unified "contracts" backend exists. Real SOW routes exist but are flagged "live, zero UI callers" in their own pack; "retainer" is only ever a tag, never a terms record; "SLA terms by severity" has no real match (`sla_policies` is a breach-detection table with 0 live rows, not a contract-terms document). |
| 21 | Documents (tenant) | `hub` | `hubDocs` + pipeline, wire dc.html:3756-3805 | `documents-msp-console-contract-pack.md` | **Current** | Matches almost verbatim incl. limit/paging, PDF-gate-to-approved/delivered, and one-live-share-link/30-day-expiry behavior. |
| 22 | Billing | `billing` | **Confirmed unbuilt placeholder** (`pageMeta.billing`, dc.html:2012-2015, same `isFrames` skeleton). No `page==="billing"` block exists anywhere in the file. | none (`msp-plan-self-service` and `partner-revenue` packs are both MSP-wide, not per-tenant) | **No backend/pack (design placeholder)** | Both real billing-adjacent routes that exist are explicitly MSP-wide (the MSP's own platform subscription tier; MSP-wide wholesale revenue) — `partner-revenue-msp-console-contract-pack.md` states directly there is "no Stripe-verified or invoiced record anywhere in this codebase of what an MSP actually charges its own customers." **This exact gap is already tracked** as issue **#2609**, blocked on Design export **#2608** — no new issue needed, just confirming the existing tracking is still accurate. |
| 23 | Audit log (tenant) | `audit` | **Confirmed unbuilt placeholder** (`pageMeta.audit`, dc.html:2016-2018, same `isFrames` skeleton). No `page==="audit"` block exists anywhere in the file. | `audit-log-msp-console-contract-pack.md` | **Stale** | A real, live `GET /api/msp/audit` route exists, but per its own pack: "there is no `customerId` filter param today even though the table carries a `customerId` column" — a genuine tenant-scoped Audit log screen cannot be built against the endpoint as-is without adding that filter. Pack itself also confirms `artifacts/msp-console` is bare scaffolding with no audit page yet, consistent with the design placeholder. |
| 24 | MSP settings | `settings` | Admin-record patch/impersonate/suspend, wire dc.html:4516-4536 | **none** (real backend is `msp-admin-settings.ts` + `admin-panel`'s `AdMspCanvas.tsx`, both verified directly) | **No backend/pack** | `msp-settings-contract-pack.md` is a **false match by filename** — it documents the unrelated operator self-service surface (`msp-settings.ts`: connector mode, mailbox, team roster, billing templates), never `msp-admin-settings.ts`/`AdMspCanvas.tsx`. The design's claims were verified directly against the real route/canvas code and are accurate; the gap is purely that no pack in `docs/msp-console/` extracts this specific module. |
| 25 | Executive view | `exec` | executive book, wire dc.html:3698-3700 | `msp-executive-contract-pack.md` | **Current** | Exact match incl. hard-capped `topN=5` and unrestricted-book QBR generation. |
| 26 | Activity timeline | `timeline` | 5-source merged timeline, wire dc.html:3543-3546 | `customer-timeline-msp-console-contract-pack.md` | **Current** | Pack explicitly covers this separate, cross-tenant MSP-console view (not the narrower per-tenant one) — confirmed correct match. |
| 27 | Configuration State | `config` | diffs/baselines/registry/collections, wire dc.html:3440-3516 | `config-state-msp-console-contract-pack.md` | **Current** | Registry counts (1,541 / 1,063 collectable) match the pack exactly. |
| 28 | Sales | `sales` | bundles + sales-offers, wire dc.html:3356-3417 | `sales-offers-and-bundles-msp-console-contract-pack.md` | **Current** | Every wire claim verified (409 delete guard, `packages: []` silent mismatch, unreferenced expire-stale sweep, etc). |
| 29 | Scope & SLA | `sla` | scope-creep + SLA composite, wire dc.html:3617-3689 | `scope-and-sla-msp-console-contract-pack.md` | **Current** | Formula matches verbatim (`min(100, (drift+expansion+slip)/3)`); `POST /msp/scope-creep/evaluate` genuinely requires `customerId` (fix #2726). This is the real screen the Signals nav item's suspected data source actually lives on — see row 3. |
| 30 | SOPs | `sops` | SOP runs, wire dc.html:3570-3592 | `sops-msp-console-contract-pack.md` | **Current** | All four notes verified line-for-line incl. the duplicate-`sopId`-falls-to-500 behavior. |
| 31 | Documents (MSP-wide) | `docs` | authored-document pipeline, wire dc.html:3720-3721,3788 | `documents-msp-console-contract-pack.md` | **Current** | Confirmed genuinely distinct from the tenant `hub` screen (different route/table, `msp-documents.ts` vs `msp-documents-hub.ts`) despite the shared "Documents" label. Manual-publish non-idempotency gap matches pack exactly. |
| 32 | SharePoint connectors | `connectors` | connector CRUD, wire dc.html:3741-3742 | `documents-msp-console-contract-pack.md` §1.8 | **Current** | Same pack as row 31 (confirmed by grep — connectors are documented in the same route file, not a separate module). Soft-delete and prod-only-400-on-plaintext-secret behavior both match. |

## Summary

- **Current: 22 of 32 screens** (69%) — genuinely match a real, existing pack. This
  module is largely well-documented relative to its real backend.
- **Stale: 4** — rows 2 (Overview, break-glass tile), 11 (cc.exec, missing evidence
  router), 23 (tenant Audit log, missing customerId filter). Row 2 and row 17 share one
  root cause (no break-glass pack exists at all).
- **No backend/pack: 6** — rows 1 (Managed Tenants directory), 3 (Signals — confirmed
  unbuilt design placeholder, refutes the issue's own stated premise about its data
  source), 17 (Break-glass — pack-only gap, backend itself is real and correct), 20
  (Contracts — unbuilt design placeholder, no unified backend), 22 (Billing — unbuilt
  design placeholder, already tracked as #2609/#2608), 24 (MSP settings — pack-only
  gap, `msp-settings-contract-pack.md` is a false match by filename).

## Findings filed

See the completion comment on Git #3665 for the list of new issues filed from this
audit (parented to #1571, EPIC: Portal Admin — #3665 has no Feature-tier parent).
