# Settings — contract extraction pack

**Module:** Settings (`#1596` Feature: Settings (Portal), part of `#1485` EPIC: Portal). Leaf
issue `#1734`, step 3 of `#1578`'s per-module sequence (schema → honest read → **contract pack**
→ Design → wire), per the `#1642` pattern. **Extracted, not authored — every claim below is
cited to `file:line` against the code on `main`.** Read-only build: no product code, schema, or
UI was changed to produce this document.

## 0. What "Settings" actually is today — the architecture question this pack answers

`#1596`'s own body asked the open question directly: *"What is genuinely 'settings' once Change
Control and RACI take their pieces back."* Its 2026-09-02 status correction says the Feature is
"backend-complete" and only the contract-pack/Design/wire phases remain — but it does **not**
say what remains is still shaped the way `#1592` originally built it. Reading the current code
answers the question the issue posed:

**There is no single "Settings" page.** The shell design (`Design/portal/design_handoff_ui_shell/
README.md:118-135`) specifies a shell-owned Settings container (a nav + pane, groups `ALERTS` →
Alert preferences and `YOUR ACCOUNT` → Your data — footer note: *"Each module adds its own
settings here as it lands — this list grows"*), but that container's own shell chrome is **not
built**. `PortalShell.tsx:66-67` says so explicitly: *"the three popovers' contents, ShaneBot
dock and Settings container remain out of scope, under their own chained issues (#1820-#1823)."*
`UserMenu`'s "Settings" row still points at `/coming-soon` (confirmed live: no route in
`App.tsx` mounts a page at a `/settings` path at all — see `App.tsx:118-150`, no such entry).

So every "settings" surface in the portal today lives on **its own standalone page or module**,
not inside a shared container, and each has already been contract-packed **where the module
claimed it**:

| Settings-shaped surface | Backend route | Owning module / page | Contract pack |
|---|---|---|---|
| Alert / notification preferences | `notification-preferences.ts` | `/notification-preferences` (standalone page, #2992) | `docs/portal/notification-preferences-contract-pack.md` |
| Your data (export + deletion) | `portal-privacy.ts` | `/privacy` (`data-rights-and-privacy.tsx`) | `docs/portal/data-rights-and-privacy-contract-pack.md` |
| Account security | (separate module) | `/account-security` | `docs/portal/account-security-contract-pack.md` |
| Ownership/RACI acceptance-gate + per-workload RACI membership | `portal-settings-ownership.ts` | **No page yet** — Ownership/RACI's own scope stop | `docs/portal/ownership-raci-contract-pack.md` §"Surfaces E/F" (already covers this route) |
| Change Control policy + notification rules | `portal-settings-change-control.ts` | `/change-control` → `PolicySection.tsx` (#1717) | `docs/portal/change-control-contract-pack.md` §10 — **stale, see §6 below** |
| **Departments** | `portal-settings-departments.ts` | **No page anywhere** | **none — this pack, below** |

Four of the six rows are already documented by the module that actually owns them, matching
`#1596`'s and `#1933`'s own stated principle: *"Settings is a container — it surfaces each
module's own configuration and owns no concepts of its own... this setting belongs to
[the owning module] and Settings renders it"* (`#1933` issue body). Duplicating those four here
would drift from their owning pack the moment either changes. This pack's real, non-duplicative
job is:

1. **Extract Departments in full** (§1-2 below) — the one settings-shaped surface with **no
   contract pack and no consuming page anywhere in the codebase**.
2. **Extract Change Control's settings surface** (§3) since it is genuinely wired into a real
   page now (`PolicySection.tsx`, #1717) but the pack that should reflect that
   (`change-control-contract-pack.md §10`) is stale — flagged, not silently duplicated.
3. **Record the cross-module map above** so `#1735` (Design) knows exactly which of the six
   rows still needs a design pass (Departments — nothing else does; see §7).

---

## 1. Departments — the live surface

Three endpoints, **zero consumers** (`artifacts/portal/src/components/settingsDepartmentsWire.ts:6-13`,
`settingsDepartmentsLive.ts:13`, unchanged since `#1592`, verified still true this session):

| Method | Path | Role floor | State |
|---|---|---|---|
| `GET` | `/api/portal/settings/departments` | `requireCapability("ladder.customer-user")` (`portal-settings-departments.ts:56`) | **CURRENT** |
| `PUT` | `/api/portal/settings/departments/:name/mapping` | same (`:112`) | **CURRENT** |
| `DELETE` | `/api/portal/settings/departments/:name/mapping` | same (`:160`) | **CURRENT** |

**Scoping (CURRENT).** `resolveCustomerId(req)` off the JWT (`portal-customer-scope.ts:38-41`) —
`tenants.id`, direct comparison, no MSP-era `tenantId` resolution needed (this is a portal-native
table, not one of the pre-portal `msp_id` + free-text-`tenant_id` tables). A missing customer
claim fails closed with `403` (`:58-61`), matching every other portal-settings route.

### 1.1 `GET /api/portal/settings/departments` — response contract

Envelope `WireDepartmentsPayload` (`portal-settings-departments.ts:49-52`):

| Field | Type | Null? | Marker | Source |
|---|---|---|---|---|
| `departments` | `WireDepartmentRow[]` | no, may be `[]` | **CURRENT** | `:99` |
| `unmapped` | `number` | never null | **CURRENT** | `groupByDepartment` (`lib/portal-settings-departments.ts:33-48`) |

`WireDepartmentRow` (`:41-47`):

| Field | Type | Null? | Marker | Source / real column |
|---|---|---|---|---|
| `name` | `string` | never | **CURRENT** | live-computed, `users.department` (`:37,49`) — **not a stored department row anywhere**; see §2 |
| `n` | `number` | never | **CURRENT** | live `COUNT`, computed fresh on every read (`groupByDepartment`, lib `:44-46`) — never persisted, never stale by construction |
| `src` | `"attribute" \| "group"` | never | **CURRENT** | `portal_department_mappings.source`, default `"attribute"` when unmapped (`:93`) |
| `group` | `string` | never (falls back to `"Not set"`) | **CURRENT** | `portal_department_mappings.security_group_name ?? security_group_id ?? "Not set"` (`:94`) |
| `unmappedFallback` | `"unmapped" \| "attribute_fallback"` | never | **CURRENT** | `portal_department_mappings.unmapped_fallback`, default `"attribute_fallback"` (`:95`) |

**The row set is a union, not a straight readout of the attribute.** `names` (`:83`) is
`{ every department the live attribute reports } ∪ { every department name a customer has
mapped by group }` — so a department mapped-by-group with **zero current attribute members**
still appears with `n: 0`, because "a group-mapped department is a real settings object the
moment it is saved, not only once someone's attribute matches it" (route header `:79-82`). This
is a genuine, deliberate divergence from a pure `GROUP BY users.department` — Design must not
assume every row it draws corresponds to a nonzero headcount.

**`unmapped` is a real live count**, not a placeholder: rows with a blank/null `users.department`
after `.trim()` (`groupByDepartment`, lib `:37-40`) — never bucketed into a fake `"Unassigned"`
row (the lib header says so explicitly, `:31-32`).

**Honest limitation, stated in the route's own header (`:19-25`) and not softened here:** a
department mapped to a security group is **not corrected** by live Graph group-membership —
"this platform has no facility yet to read live security-group membership from Microsoft Graph."
`n` always reflects the Entra `department` attribute count regardless of `src`; the mapping only
changes which *source the customer says should be authoritative*, not what the platform actually
counts. `GET` deliberately returns both so a future UI can show the disagreement, not hide it.
This is a real, current product gap, not a bug — **OPEN GAP**, no issue currently tracks building
live Graph group-membership reads for this row (filed below, §7).

### 1.2 `PUT /api/portal/settings/departments/:name/mapping` — write contract

Body (`:126-130`): `source` (`"attribute" | "group"`, default `"group"` if invalid —
**note the asymmetry**: an invalid/missing `source` defaults to `"group"` on write but
`"attribute"` on read (`:93`) — those are two different fallback values for the same concept,
worth Design and any future test knowing about), `securityGroupId`/`securityGroupName` (strings,
required together with `source === "group"` — validated server-side, `:132-135`, 400 on
violation), `unmappedFallback` (default `"attribute_fallback"`, `:130`).

Upsert on `(customer_id, department_name)` unique index (`:139-144`, schema `msp.ts:8595-8598`).
**CURRENT.**

### 1.3 `DELETE /api/portal/settings/departments/:name/mapping`

Deletes the mapping overlay row entirely — "the reciprocal of PUT... which the design's own
drawer had no way to undo" (route header `:155-157`). Reverts the department to reading from the
Entra attribute (the default). Returns `{ ok: true, removed: boolean }` (`:176`) — `removed:
false` on a no-op delete (nothing was mapped), not an error. **CURRENT.**

---

## 2. Departments — schema

One table, `portal_department_mappings` (`lib/db/src/schema/msp.ts:8566-8582`):

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `customer_id` | `integer` | `tenants.id`, no FK (matches every `portal_*` table this era) |
| `department_name` | `text` | "the value exactly as it appears on `users.department` for this tenant" (`:8567`) |
| `source` | `text`, `{enum: PORTAL_DEPARTMENT_SOURCES}` | `"attribute" \| "group"`, default `"attribute"` |
| `security_group_id` | `text`, nullable | set only when `source = "group"` |
| `security_group_name` | `text`, nullable | display name, same condition |
| `unmapped_fallback` | `text`, `{enum: PORTAL_DEPARTMENT_UNMAPPED_FALLBACKS}` | `"unmapped" \| "attribute_fallback"`, default `"attribute_fallback"` |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: `portal_department_mappings_customer_id_idx` (`customer_id`),
`portal_department_mappings_customer_department_idx` (unique, `customer_id, department_name`).

**The department LIST and headcounts are never stored here** (schema header `:8558-8565`) —
computed live off `users.department` (`lib/db/schema/index.ts`, per the schema comment) for the
tenant's active users, the same column and scoping `portal-ownership.ts` already reads for its
own people list. This table stores **only** the durable overlay choice.

Both enums are `text` columns with a TypeScript `{enum: [...] as const}` guard
(`PORTAL_DEPARTMENT_SOURCES`, `PORTAL_DEPARTMENT_UNMAPPED_FALLBACKS`, `msp.ts:8558-8563`), **not**
a Postgres `pgEnum`/`CHECK` constraint — same pattern as every other `portal_*` settings table in
this file (confirmed: `grep -n "pgEnum" lib/db/src/schema/msp.ts` returns zero matches
repo-wide, matching `change-control-contract-pack.md §12`'s same finding for that module). A
direct `INSERT` bypassing the route could write any string into either column; nothing at the DB
layer prevents it. Flagged honestly, not glossed as a "real enum."

---

## 3. Change Control's settings surface — now genuinely wired, and where the record is stale

**`portal-settings-change-control.ts` is CURRENT and has a real consumer as of `#1717`.**
`artifacts/portal/src/components/change-control/PolicySection.tsx:1-6` imports
`useChangeControlSettingsLive()` from `settingsChangeControlLive.ts` and renders it inside
`/change-control`'s own page, gated behind a collapsible "Your change policy" panel
(`PolicySection.tsx:36-51`). This is real, live-wired UI — `data-testid="change-control-policy"`
(`:43`) — not unconsumed client code.

**`docs/portal/change-control-contract-pack.md §10` is stale on exactly this point.** It states
*"No page imports the hook yet — it is real, backend-ready, unconsumed client code"*
(`change-control-contract-pack.md:464`) and its field table (`:468-472`) does not mention
`maintenanceWindows`/`enforceMaintenanceWindows` (`#1717`'s own addition, alongside
`enforceFreezeCalendar`) at all. Both facts are now wrong against current `main`. This is a
**stale doc contradicting the code** — a real finding under this project's own filing rule, not
something this read-only pack silently patches into someone else's file. Filed as `#4052`
(§7).

Three endpoints, unchanged shape from `change-control-contract-pack.md §1/§10` except for the
one new field:

| Method | Path | Role floor | State |
|---|---|---|---|
| `GET` | `/api/portal/settings/change-control` | `requireCapability("ladder.customer-user")` (`:139`) | **CURRENT** |
| `PUT` | `/api/portal/settings/change-control/policy` | same (`:229`) | **CURRENT** |
| `PUT` | `/api/portal/settings/change-control/notifications/:eventKey` | same (`:274`) | **CURRENT** |

`WireCcPolicy` (`portal-settings-change-control.ts:86-98`, mirrored in
`settingsChangeControlWire.ts:17-29`):

| Field | Type | Marker | Enforced where |
|---|---|---|---|
| `on` | `boolean` | **CURRENT** | master switch; does not itself block anything (route header `:8391-8393`) |
| `gated` | `Record<CcGateKey, boolean>`, keyed `CC_GATE_KEYS = fix\|sop\|remediation\|copilot\|graph` | **CURRENT**, real `as const` union, `msp.ts:8384` | no consumer found this session reading `gated` outside this route itself — **OPEN GAP**, see §6 |
| `approvals` (`requiredSignatures`) | `number`, min 1 | **CURRENT**, enforced | `portal-change-approvals-store.ts:157,318` — floors the human stage count, `requiredStages()` |
| `separate` (`requireSeparateApprover`) | `boolean` | **CURRENT**, enforced | `portal-change-approvals-store.ts:263`, `portal-change-rejection.ts:49` — `violatesSeparationOfDuties` |
| `freeze` (`enforceFreezeCalendar`) | `boolean` | **CURRENT**, enforced (`#1500`) | `portal-change-control-raise.ts:132-136`, `msp-changes.ts:189-202` |
| `maintenanceWindows` (`enforceMaintenanceWindows`) | `boolean` | **CURRENT**, enforced (`#1504`/`#1717`, catalog-execute gate `#3044`) | `portal-change-catalog.ts:192-198`, `portal-change-control-raise.ts:138-144`, `msp-changes.ts:189-202` |
| `emergency` (`allowEmergencyPath`) | `boolean` | **CURRENT**, persisted only | no enforcement consumer found this session — **OPEN GAP**, see §6 |

`eligibleApprovers` and `people` are unchanged from `change-control-contract-pack.md:480-484` —
computed live off `users.can_approve_changes`, never a stored set (`#1759`); no `PUT` for
approvers exists, deliberately. Notification rules (`WireCcNotifRule`, 7 fixed `CC_NOTIF_EVENT_KEYS`)
are unchanged from that pack's §10.

**Full schema:** `portal_change_control_policy` (`msp.ts:8387-8425`) gains
`enforce_maintenance_windows boolean not null default false` (`:8418`, `#1504`) beyond what
`change-control-contract-pack.md` documents; `portal_change_control_notifications` (`msp.ts:8511-8532`)
is unchanged.

---

## 4. Cross-surface edges

- **Departments ↔ Ownership/RACI: none, despite the obvious-looking overlap.** Both read
  `users.department`/`users.tenantId` scoping via the identical `and(eq(tenantId, customerId),
  eq(isActive, true))` shape (`portal-settings-departments.ts:69`, `portal-ownership.ts`'s own
  `activeTenantUsers`-equivalent) — but neither table references the other, and Departments does
  not feed Ownership's people list or vice versa. A future Design pass should not assume they are
  the same customer configuration surface just because they read the same column.
- **Change Control policy ↔ the approval/CR-raise/catalog-execute paths** — six real consumers
  now (§3 table), up from the two (`freeze`, and none) `change-control-contract-pack.md §10`
  recorded. This is the edge that pack's staleness actually obscures.
- **Ownership/RACI's Settings-rendered gates** (`portal_ownership_policy.gate_mode`,
  `portal_ownership_workload_membership.tracked`) are consumed by `routes/portal-ownership.ts`
  and the symmetric `routes/msp-ownership.ts` — fully documented in
  `docs/portal/ownership-raci-contract-pack.md` "Surfaces E/F"; not re-derived here to avoid a
  second copy that can drift.
- **The shell Settings container (`#1820-#1823`) has no code to wire into yet.** `#1735`
  (Design) and `#1736` (wire) should target Departments as a standalone panel/page the way
  Change Control's policy landed on its own module page — not wait on the shell container, which
  this session confirms is still unbuilt (§0).

---

## 5. Honest tri-state (loading / live-empty / read-failed)

Both live hooks (`settingsDepartmentsLive.ts:41-72`, `settingsChangeControlLive.ts:46-81`) follow
the same real shape, verified against their actual `useState`/`try`/`catch` bodies, not assumed:

| State | Departments | Change Control |
|---|---|---|
| **Loading** | `loading: true` until the first `reload()` resolves (`:45,60`) | same (`:52,69`) |
| **Live-genuinely-empty** | `departments: []`, `unmapped: "0"` — a tenant with zero users and zero mappings reads exactly this, not an error (`toDeptRows`/`toUnmappedLabel` default to empty/`"0"` on any malformed or absent payload too — §6 notes this conflates "empty" and "malformed") | `policy` at its wire-level `DEFAULT_POLICY` (all `false`/`1`), `notifications: []`, `people: []`, `eligibleApprovers: []` |
| **Read-failed** | `error` set to the thrown message; `loading` still flips to `false` (`finally`, `:59-61`); **state is left at its last-known values**, not reset to empty — a failed reload after a successful one shows stale-but-real data with an error banner available, not a blank page | identical pattern (`:65-70`) |

Neither hook has a fixture fallback anywhere in the file (confirmed by reading both in full) —
matching the HARD RULE and `change-control-contract-pack.md:465`'s same finding for its own hook.

---

## 6. Forbidden / open-gap list — swept from the route and lib headers themselves

- **No live Microsoft Graph security-group membership read for Departments.** Route header
  `portal-settings-departments.ts:19-25` states this outright: a group-mapped department's `n`
  is never corrected by real group membership. **OPEN GAP**, no issue currently tracks it —
  filed as `#4053` (§7).
- **`gated` (Change Control) has no read consumer this session could find outside its own
  settings route.** The design's stated purpose — "anything true here cannot run until its
  change request is approved" (`msp.ts:8396-8397`) — is not wired into the CR-raise or
  catalog-execute gates the way `freeze`/`maintenanceWindows` are (§3 table). **OPEN GAP**, not
  filed as a new issue this session (Change Control's own module, not Settings', owns this
  finding — noted here for visibility, left to that module's own tracking per the Feature-first
  filing rule).
- **`allowEmergencyPath` (Change Control) is persisted with no enforcement consumer found.**
  Same caveat as above — a Change Control finding, not a Settings one; noted, not filed here.
- **No `PUT .../departments/reset-all` or bulk-mapping affordance** — every write is
  per-department-name; nothing in the design or the route suggests a bulk path is wanted, so this
  is not flagged as a gap, only noted as a real API shape constraint for Design.
- **No unit or integration test exists for either `portal-settings-departments.ts` or
  `portal-settings-change-control.ts`** (`grep -rl` across `artifacts/api-server/src/**/*.test.ts`
  for `portal-settings-departments`/`portal-settings-change-control`/
  `portal_department_mappings`/`portal_change_control_policy` returns nothing for these two
  routes specifically). Not filed as a finding — matches this project's opt-in test-manifest
  policy (manifests are scoped to `artifacts/msp-portal/`/`artifacts/shane-mccaw-consulting/`
  customer-facing flows; a backend route with a real live consumer for Change Control and none
  yet for Departments does not meet that bar on its own) — noted for the record, not actioned.

---

## 7. Orphaned endpoints and findings filed this session

**Departments (`GET`/`PUT`/`DELETE /api/portal/settings/departments...`) has zero consumers
anywhere in `artifacts/portal/src`** — confirmed by the unchanged header comment in both
`settingsDepartmentsWire.ts:6-13` and `settingsDepartmentsLive.ts:13`, and by grepping
`artifacts/portal/src/pages` for any import of `useDepartmentsLive`/`settingsDepartmentsWire`
(no matches). This is exactly the shape of finding the build prompt requires filing at pack time
rather than letting it reach Design untracked (the `#1601`-`#1604` precedent). Filed as a real
sub-issue of `#1596` (the Feature-tier parent — Settings' own contract-pack step is `#1734`
itself, so the finding belongs one level up, matching the Feature-first rule):

- **`#4051`** — "Settings: Departments backend (`portal-settings-departments.ts`) has zero
  consumers — needs a Design pass, not just a contract pack" — parented to `#1596`, labelled
  `bug`, board status `AI Batter Up`.
- **`#4052`** — "`docs/portal/change-control-contract-pack.md §10` is stale: says 'no page
  imports the hook yet' and omits `maintenanceWindows`, both now wrong against `main`" —
  parented to `#1486` (Change Control's own Feature, since the stale doc is that module's, not
  Settings') per the Feature-first rule, labelled `bug`.
- **`#4053`** — "Departments settings: no live Microsoft Graph security-group membership read —
  a mapped department's headcount is never corrected by real group membership" — parented to
  `#1596`, labelled `bug`.

No other real, live endpoint under this pack's scope (Departments + Change Control's settings
route) lacks a consumer or a tracking issue. Ownership/RACI's Settings-rendered gates are real,
consumed, and already documented in their own pack (§0, §4) — not re-flagged here.
