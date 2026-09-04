# Write-Pack Mapping — every Config Pack and micro-remediation: steps, Graph calls, inputs, gates, and real payload shapes

**Issue:** #1484 (parent #1202) · **Companion to:** #1481 (`docs/pillarmapping.md`) · **Investigated:** 2026-08-28 · **Author:** Claude Code build session (read-only investigation)

This document is written for **Claude Design**, which has **no access to this repository or its database**. Everything needed to build the write / remediation UI is here. #1481 answered *"what can the platform read?"*; this answers *"what can the platform change?"* — and the write side has approval gates, destructive consequences, and per-action parameters the read side does not, so a UI built without this will be wrong in ways that matter. Read-side checks (pillars, monitor checks, scan payloads) are #1481's subject and are not repeated here.

**Evidence discipline.** Every claim traces to one of: (a) a live SQL query against the local PostgreSQL database (`shanemccawmsp`), run 2026-08-28; (b) a real file path + line in this repo (worktree off `origin/main @ 0eb6c3bc`); (c) a **real `planOnly` / dry-run response** captured this session through the only two execution surfaces that never mutate — `buildConfigPackDryRun` (live Graph **reads** only) and the pack `run/plan` materializer (pure, no tenant I/O). §8 is the full evidence log; §9 the explicit unknowns. Where a shape could only be obtained by a real mutation, it is recorded as an unknown with the reason — **never invented.**

### ⛔ Safety note carried through this whole document
The testbed customer (`mccawsoft2.onmicrosoft.com`, `tenants.id = 1`, Entra tenant `c4c814d4-3afe-441e-9145-62461d0a4fd3`, `is_testbed = true`) **is Shane's real production Microsoft 365 tenant**, with write-back and consent gates armed. These packs revoke sessions, remove licences, isolate devices, force password resets, disable and delete accounts. **No real write pack or micro-remediation was fired in producing this document.** The one non-testbed connected tenant is `id = 3` (`Test Me`, not testbed). Gov/GCC tenants are out of platform scope. Zoho Books is outbound-only (no read-back) and is not part of this write layer.

---

## 1. Executive summary

There are **two kinds of write product** and one engine behind both.

- A **Config Pack** ("Quick-Start Write Pack") is an ordered sequence of Graph writes, materialized on demand from database rows (`config_packs` + `config_pack_templates` → `baseline_action_templates`) into a real Workflow Engine definition and fired as a run.
- A **micro-remediation** is a single Graph write — one `baseline_action_templates` row — fired directly.

Both resolve a **sellable catalog product** (`services` row) to its executable through one function, `resolveServiceExecutable` (`lib/remediation-catalog.ts`), and both ultimately call the same two functions: `resolveBaselineTemplateRequest` (substitute `{{variables}}` — used for both preview and execution, so they can never drift) and `graphWriteForTenant` (the single write choke point, `lib/graph.ts:1000`).

### Counts (live, 2026-08-28)

| | REAL | PARTIAL | ABSENT | Total |
|---|---|---|---|---|
| **Config Packs** (active) | 4 | 9 | 1 | 14 |
| **Micro-remediations** (sellable) | 9 | 3 | 2 | 14 |

Plus one **archived** pack (`msp-configure`, no sellable service) and **99** `baseline_action_templates` rows total (of which the packs and the 14 micro-remediations reference a subset; the rest are standalone Launch-Control / Simulator write actions).

**REAL** here means: the executable is genuinely wired, materializes a valid plan **and** a real dry-run, and every write step targets an endpoint the platform's sole executor can actually issue (Microsoft Graph REST). **It does not mean a write will succeed against the live tenant today** — see finding 1. **PARTIAL** means the product exists and is sellable but cannot deliver as wired (broken pack graph, empty pack, or a step whose endpoint the executor cannot transport). **ABSENT** means a sellable product with no executable behind it.

### Headline findings, most consequential first

1. **No write pack or micro-remediation can currently complete a successful write against the testbed tenant — the write app is refused `403 Authorization_RequestDenied`.** This is the single most important live-execution fact. A real pack run on 2026-08-26 (`wf_runs.id = 30301`, `quickstart-v1`, customer 1) reached Microsoft Graph and its first write, `POST /users` (create the break-glass account), came back **`403 { "error": { "code": "Authorization_RequestDenied", "message": "Insufficient privileges to complete the operation." } }`**. At the time of that run, `MT_APP_WRITE_CLIENT_ID` resolved to the **PROD** write app registration (`3308b280-e41e-42ba-9f73-73aac2ad3dee`) — it obtained a token and passed both write gates (the tenant's `writeBack` consent is `granted`), but its directory-write permissions were not admin-consented on the tenant. **Since #1812, local dev's `MT_APP_WRITE_CLIENT_ID` has been repointed to the DEV write app registration, `MSP Platform Write (DEV)` (`9f6f4772-b5be-421f-815e-b392336c373a`)** — agent-modifiable per CLAUDE.md's production-change gate, with its Graph permissions admin-consented. Whether the same 403 still reproduces against the DEV app is not re-verified in this document; the finding above documents the PROD-app run that produced it. This refines the issue's premise: locally `MT_APP_WRITE_CLIENT_ID` (36 chars) and `MT_APP_WRITE_CLIENT_SECRET` (40 chars) **are present** (`MT_APP_WRITE_TENANT_ID` and `MT_APP_WRITE_CERT_PRIVATE_KEY` are empty, and `getWriteAccessTokenForTenant` does not need them) — so a write **token** mints locally; the blocker (as observed against the PROD app) is the **tenant-side permission consent (403)**, not a missing local credential. Earlier runs the same morning (`30166`, `30171`) instead failed with `MT_APP_WRITE_CLIENT_ID / MT_APP_WRITE_CLIENT_SECRET not configured` — i.e. the client credentials were added to the local env mid-day 2026-08-26. **Design implication:** the confirmation UI must render a real "write refused by tenant permissions" state; it must not present any of these as a green, ready-to-fire action.

2. **Six sellable Config Packs cannot even produce a plan — they throw `dependency_cycle` — because their `config_pack_templates` rows are duplicated (each step inserted twice).** `baseline-licensing-v1`, `conditional-access-baseline-v1`, `device-compliance-v1`, `email-security-v1`, `identity-hygiene-v1`, and `privileged-access-v1` each have exactly **2× the rows** they should (e.g. `identity-hygiene-v1`: 12 rows, 6 distinct templates — ids 114 & 144 both `action.require-security-info-reregistration` at `sort_order 0`, and so on). The topological sort keys nodes on the template id (`getStepId`), so the duplicate rows collapse to the same node and the Kahn loop can never satisfy `ordered.length < templates.length` — it aborts with `dependency_cycle` and an **empty** `templateIds` list. Every one of these six is `status = active`, `visibility = public`, `is_public = true` and priced (\$199–\$299). A buyer's dry-run preview for any of them returns `executable: false` with `error.code = "dependency_cycle"`. **This is a new finding and a data-integrity bug** (the duplicate rows, seeded by the 2026-08-21 pack wave, need de-duping). See §3 and the per-pack rows in §3.

3. **One sellable Config Pack has zero steps.** `break-glass-access-v1` (`Break-Glass Access Pack`, sellable at \$249, public) has **no `config_pack_templates` rows at all**, so `loadConfigPack` throws `pack_empty` ("has no templates assigned"). It resolves to an executable reference that is hollow. **New finding — classified ABSENT.**

4. **The executor can only issue Microsoft Graph REST calls. Every template whose endpoint is Exchange Online (`exchange-online://…`) or Microsoft Defender (`/api/machines/…`, `/api/indicators`) cannot be executed as wired.** `runBaselineTemplateAgainstTenant` → `graphWriteForTenant` unconditionally does `fetch(`https://graph.microsoft.com/v1.0` + endpoint)` with a Graph-audience token; **no code anywhere branches on the `exchange-online://` scheme** (grep-verified across the api-server), and the correct Defender transport (`lib/defender-endpoint.ts`, `isolateMachine` / `releaseMachineFromIsolation`, correct host `api.security.microsoft.com` + `securitycenter` token) **has no caller** (grep-verified). So an `exchange-online://Set-Mailbox` endpoint becomes the nonsensical URL `https://graph.microsoft.com/v1.0exchange-online://Set-Mailbox`, and `/api/machines/{id}/isolate` is sent to the Graph host. This affects **13 `exchange-online://` templates** and **2 Defender templates**, including the micro-remediations `remediate-isolate-device`, `remediate-block-file-hash`, and `remediate-enable-mailbox-archive`, and the gated Exchange steps inside `offboarding-v1`, `compromised-account-recovery-v1`, and `security-incident-response-v1`. **New finding.** The exact failure payload is an explicit unknown (§9) — obtaining it would require firing a real write.

5. **The pack "plan" endpoint and the pack "dry-run" endpoint disagree on `gatedHere` for read-only (checkKey-only) steps.** The `run/plan` payload computes `gatedHere = (t.templateId === gatedTemplateId)`; for a monitor-check step `templateId` is `null`, and when the pack has no gated template `gatedTemplateId` is also `null`, so `null === null` makes **every checkKey step falsely report `gatedHere: true`** (seen in `sharepoint-oversharing-v1`'s plan). The dry-run payload hard-codes `gatedHere: false` for those same steps and is correct. **Design must treat the dry-run's `gatedHere`/`gatedTemplateId` as authoritative**, not the plan's, and never render a verification gate on a monitor-check step.

6. **The break-glass verification gate produces a generated secret that is surfaced exactly once — a hard UI constraint.** Any pack containing a template flagged `requires_verification_gate` (not only Quick-Start) gets **one** `break_glass_verification_gate` spliced in after its first flagged step; the orchestrator stamps a freshly generated strong password (`generateStrongPassword()`, `Bg9!…`, 28 chars) onto the run payload, the gate encrypts it, pauses the run (`wf_runs.status = "awaiting_approval"`), and **strips the plaintext from the persisted payload**. The secret is revealed to a tenant-admin who proves an eligible directory role, exactly once, then purged on acknowledgement. Dry-run and plan payloads redact it (`••••••••••••`). See §5.4.

7. **What is genuinely wired is substantial and the plumbing is real.** Four packs (`quickstart-v1`, `onboarding-v1`, `mfa-enforcement-v1`, `sharepoint-oversharing-v1`) materialize a clean plan **and** a clean dry-run with every write step on a Graph-REST endpoint the executor can issue; nine of the fourteen micro-remediations resolve to a real Graph-REST template. The dry-run reads the **actual current tenant state** live for update-type writes, and the whole gate/consent/audit spine (§5) is real. The gap between "wired" and "fires successfully today" is entirely finding 1 (tenant permission consent) and finding 4 (missing EXO/Defender transport).

---

## 2. How a write executes — the one engine path, and the two safe preview surfaces

**Product → executable resolution** (`resolveServiceExecutable`, `lib/remediation-catalog.ts:129`). A `services` row is classified by `category`:
- `category = "config_pack"` (or a `type_attributes.packKey` present) → `{ kind: "config_pack", packKey }`, preferring the persisted `type_attributes.packKey`, then a static fallback map. All 14 pack services carry a persisted `packKey`, so the fallback never fires in practice — **the DB is the source of truth** (verified: every pack service's `type_attributes.packKey` is set; §8).
- `category = "micro_remediation"` (or slug starts `remediate-`) → `{ kind: "micro_remediation", templateId }`, preferring persisted `type_attributes.templateId`, then the static `MICROREM_TEMPLATE_BY_SLUG` map. Two slugs map to `null` → `{ kind: "unwired", reason }`.
- otherwise → `{ kind: "not_in_catalog" }`.

**Single write choke point** (`graphWriteForTenant`, `lib/graph.ts:1000`). Every real write — from a pack step, a micro-remediation, Launch Control, or the workflow engine — goes through here, which enforces two gates fail-closed before any HTTP call (§5.1), then issues `fetch("https://graph.microsoft.com/v1.0" + path, { method, body })` with the **write app** token. **Local dev's write app is the DEV registration `9f6f4772-b5be-421f-815e-b392336c373a` (`MSP Platform Write (DEV)`, since #1812), not the PROD registration `3308b280-e41e-42ba-9f73-73aac2ad3dee`** — the two are distinct app registrations, per CLAUDE.md's production-change gate. Success = HTTP status in `[200, 201, 204]`.

**Config Pack materialization** (`config-pack-orchestrator.ts` + `config-pack-graph.ts`). `loadConfigPack` reads the pack + its ordered template rows; `buildConfigPackGraph` topologically sorts them into a **strictly linear chain** (deliberately — the executor's pause/resume abandons anything still in the ready-queue, so no parallel branch may straddle a gate) and splices in the verification gate; `prepareConfigPackRun` derives the initial payload; `runConfigPackForCustomer` persists a Workflow Definition + published Version and fires `fireWorkflowForDefinition → wf_runs → executeWorkflowRun`. Every pack run is therefore a normal Workflow Engine run, visible as `Config Pack: <packKey>`.

**The two surfaces that never mutate (the only ones used for this document):**
- **`run/plan`** (`GET /admin/config-packs/:packKey/run/plan`, `execute_write_pack` with `planOnly: true`): pure materialization — topological step order, which step carries the single gate, and the operator variables to supply. No customer, no tenant I/O, no writes.
- **dry-run** (`buildConfigPackDryRun`, behind `GET /public/purchase/pack-dry-run`): resolves every write's exact request through the same substitution execution uses, then reads the **real current tenant value** for update-type steps via the **read** app (`graphFetchForTenant`) — reads only, never writes. Secrets (`/password|secret/i` keys) are replaced with `••••••••••••` **before** any interpolation.

**A run's lifecycle states** (`wf_runs.status`, observed + declared): `pending → running`, then `completed` | `failed` | `cancelled`, or `awaiting_approval` when paused at the break-glass gate. Live counts across all runs: `completed` 23,382 · `failed` 4,856.

---

## 3. Config Pack catalog

All 14 active packs are `visibility = public`, `is_public = true`, `fulfillment_type = manual`, `fulfillment_type_key = config_pack`. "Blast radius" is the scope one run touches. "Destructive?" states whether the tenant change is reversible. **Executor-transportable** flags whether every write step targets a Graph-REST endpoint `graphWriteForTenant` can actually issue (finding 4).

### 3.0 Status at a glance

| Pack key (service slug) | Price | Steps | Plan / dry-run | Gate | Class | Blocker |
|---|---|---|---|---|---|---|
| `quickstart-v1` (`entra-id-quickstart-v1`) | \$799 | 8 | ✅ / ✅ executable | yes | **REAL** | live write 403 (finding 1) |
| `onboarding-v1` (`onboarding-pack-v1`) | \$149 | 3 | ✅ / ✅ | no | **REAL** | operator vars; live write 403 |
| `mfa-enforcement-v1` (`mfa-enforcement-pack-v1`) | \$299 | 2 | ✅ / ✅ | yes | **REAL** | operator vars; live write 403 |
| `sharepoint-oversharing-v1` (`sharepoint-oversharing-pack-v1`) | \$349 | 6 (2 checks + 4 writes) | ✅ / ✅ | no | **REAL** | operator vars; live write 403 |
| `offboarding-v1` (`offboarding-pack-v1`) | \$199 | 5 | ✅ / ✅ | yes | **PARTIAL** | 1 EXO step non-transportable (finding 4) |
| `compromised-account-recovery-v1` (`…-pack-v1`) | \$149 | 3 | ✅ / ✅ | yes | **PARTIAL** | 1 EXO step non-transportable |
| `security-incident-response-v1` (`…-pack-v1`) | \$299 | 5 | ✅ / ✅ | yes | **PARTIAL** | Defender + EXO steps non-transportable |
| `baseline-licensing-v1` (`baseline-licensing-pack-v1`) | \$199 | 5×2 dup | ❌ `dependency_cycle` | — | **PARTIAL** | duplicate rows (finding 2) |
| `conditional-access-baseline-v1` (`…-pack-v1`) | \$199 | 4×2 dup | ❌ `dependency_cycle` | — | **PARTIAL** | duplicate rows |
| `device-compliance-v1` (`device-compliance-pack-v1`) | \$249 | 5×2 dup | ❌ `dependency_cycle` | — | **PARTIAL** | duplicate rows |
| `email-security-v1` (`email-security-pack-v1`) | \$249 | 5×2 dup | ❌ `dependency_cycle` | — | **PARTIAL** | duplicate rows (also all-EXO) |
| `identity-hygiene-v1` (`identity-hygiene-pack-v1`) | \$249 | 6×2 dup | ❌ `dependency_cycle` | — | **PARTIAL** | duplicate rows |
| `privileged-access-v1` (`privileged-access-pack-v1`) | \$299 | 5×2 dup | ❌ `dependency_cycle` | — | **PARTIAL** | duplicate rows |
| `break-glass-access-v1` (`break-glass-access-pack-v1`) | \$249 | 0 | ❌ `pack_empty` | — | **ABSENT** | no steps (finding 3) |

Prices from `services.price_cents`. "×2 dup" = each step exists twice in `config_pack_templates` (finding 2).

### 3.1 `quickstart-v1` — Entra ID Quick-Start Pack — **REAL** (only pack that dry-runs `executable: true`)

Establishes an emergency-access ("break-glass") admin and a baseline Conditional Access posture. **Blast radius:** whole tenant (creates a Global Admin, changes tenant security-default and guest policies). **Destructive?** Non-reversible creations (`reversible = false` on every step); it does not delete anything. **Executor-transportable:** yes — every step is Graph REST. **Operator variables:** `domain`, `tenantId` (both auto-derived by the orchestrator from the customer/tenant row — so in practice **no operator input is required**, which is why it is the only pack on the purchase self-executable allowlist). **Gated:** yes — see §5.4.

Ordered steps (real, from the plan/dry-run):

| # | template_id | Method + Graph endpoint | Change | Notes |
|---|---|---|---|---|
| 1 | `quickstart-v1.create-break-glass-account` | `POST /users` | create | **gate splices here.** Body sets `displayName`, `mailNickname`, `accountEnabled`, `passwordProfile.password` (the generated secret, redacted in previews), `userPrincipalName: breakglass-admin@{{domain}}`. `success_criteria` captures the new id as `breakGlassUserId`. |
| 2 | `quickstart-v1.assign-global-admin-role` | `POST /roleManagement/directory/roleAssignments` | create | Assigns Global Admin (`roleDefinitionId 62e90394-69f5-4237-9190-012177145e10`) to `{{breakGlassUserId}}` (produced mid-run by step 1). |
| 3 | `quickstart-v1.create-ca-exclusion-group` | `POST /groups` | create | Captures new group id as `breakGlassGroupId`; pack `parameter_mapping` maps it forward. |
| 4 | `quickstart-v1.add-break-glass-to-exclusion-group` | `POST /groups/{{breakGlassGroupId}}/members/$ref` | create | Adds the break-glass user to the exclusion group. |
| 5 | `quickstart-v1.disable-security-defaults` | `PATCH /policies/identitySecurityDefaultsEnforcementPolicy` | update | Tenant-wide. |
| 6 | `quickstart-v1.create-ca-baseline-policy` | `POST /identity/conditionalAccess/policies` | create | Baseline CA policy excluding `{{breakGlassGroupId}}`. |
| 7 | `quickstart-v1.set-tenant-branding` | `PATCH /organization/{{tenantId}}/branding/localizations/0` | update | Tenant-wide. |
| 8 | `quickstart-v1.restrict-guest-access` | `PATCH /policies/authorizationPolicy` | update | Tenant-wide. |

Five steps are flagged `requires_verification_gate` (1, 2, 5, 6, 8); only step 1 gets the actual gate — the other four are **coalesced** (they run post-verification anyway). See §5.4.

### 3.2 `onboarding-v1` — New Employee Onboarding Pack — **REAL**

**Blast radius:** single user. **Destructive?** No (creations/additions). **Executor-transportable:** yes (all Graph REST). **Gated:** no. **Operator variables:** `displayName`, `mailNickname`, `userPrincipalName`, `initialPassword`, `userId`, `skuId`, `groupId`, `memberId` (dry-run `executable: false` until supplied). Steps: `action.create-user` (`POST /users`) → `action.assign-single-license` (`POST /users/{{userId}}/assignLicense`) → `action.add-group-member` (`POST /groups/{{groupId}}/members/$ref`).

### 3.3 `mfa-enforcement-v1` — MFA Enforcement Pack — **REAL**

**Blast radius:** single user. **Destructive?** No (reversible in effect, though `reversible = false` is recorded). **Executor-transportable:** yes. **Gated:** yes — the gate splices after step 2. **Operator variables:** `userId`. Steps: `action.require-security-info-reregistration` (`POST /users/{{userId}}/authentication/methods`) → `action.enforce-per-user-mfa` (`PATCH /users/{{userId}}/authentication/requirements`, **gatedHere**). Note: this pack's step 2 is gate-flagged but there is no break-glass **account** created — the gate still fires and still generates + surfaces a secret (finding 6 / §5.4), a semantic quirk worth surfacing to the operator. It also carries a monitor `check_key` (`identity:mfa-registration`) on step 2's row, but the materializer treats `check_key` and `template_id` on the same row as the template (write) node.

### 3.4 `sharepoint-oversharing-v1` — SharePoint & OneDrive Oversharing Pack — **REAL** (mixed check + write)

**Blast radius:** tenant sharing policy (steps 3–5, tenant-wide) + a single item permission (step 6). **Destructive?** Step 6 deletes a sharing link (`DELETE`); the policy PATCHes are reversible settings. **Executor-transportable:** yes (Graph `/admin/sharepoint/settings` and `/sites/…`). **Gated:** no. **Operator variables:** `sharingCapability`, `siteId`, `itemId`, `permissionId`. Steps (real, from dry-run):

| # | step | Endpoint | Change | Notes |
|---|---|---|---|---|
| 1 | check `sharepoint:tenant-sharing-capability` | — | read | monitor check, no write |
| 2 | check `onedrive:overshared-files` | — | read | monitor check, no write |
| 3 | `action.enforce-tenant-sharing-policy` | `PATCH /admin/sharepoint/settings` | update | needs `sharingCapability` |
| 4 | `action.block-external-resharing` | `PATCH /admin/sharepoint/settings` | update | dry-run **read the real current tenant value** (`fetched: true`) |
| 5 | `action.require-invited-user-signin` | `PATCH /admin/sharepoint/settings` | update | dry-run `fetched: true` |
| 6 | `microrem.remove-sharing-link` | `DELETE /sites/{{siteId}}/drive/items/{{itemId}}/permissions/{{permissionId}}` | delete | needs 3 ids |

This pack demonstrates the tri-state the UI must render: monitor-check steps (no write), update steps where the dry-run **shows current state** and an `alreadySatisfied` verdict, and a delete step whose targets are only known once the operator supplies ids.

### 3.5 `offboarding-v1` — Employee Offboarding Pack — **PARTIAL** (1 non-transportable step)

**Blast radius:** single user. **Destructive?** Yes — disables sign-in, revokes sessions, removes a licence, converts to shared mailbox, removes from a group. **Gated:** yes (after `action.convert-user-to-shared-mailbox`). **Operator variables:** `userId`, `skuId`, `userPrincipalName`, `groupId`. Steps: `action.disable-user-signin` (`PATCH /users/{{userId}}`) → `microrem.revoke-sign-in-sessions` (`POST /users/{{userId}}/revokeSignInSessions`) → `microrem.remove-unused-license` (`POST /users/{{userId}}/assignLicense`, body `removeLicenses:[{{skuId}}]`) → **`action.convert-user-to-shared-mailbox` (`POST exchange-online://Set-Mailbox`, gatedHere) — NON-TRANSPORTABLE (finding 4)** → `microrem.remove-stale-group-member` (`DELETE /groups/{{groupId}}/members/{{userId}}/$ref`). Plan + dry-run materialize fine; the Exchange step cannot execute as wired.

### 3.6 `compromised-account-recovery-v1` — **PARTIAL** (1 non-transportable step)

**Blast radius:** single user. **Destructive?** Yes (forces password reset, kills sessions, removes forwarding). **Gated:** yes (after `action.remove-forwarding-rule`). **Operator variables:** `userId`, `userPrincipalName`. Steps: `microrem.force-password-reset` (`PATCH /users/{{userId}}`, body `passwordProfile.forceChangePasswordNextSignIn:true`) → `microrem.revoke-sign-in-sessions` (`POST /users/{{userId}}/revokeSignInSessions`) → **`action.remove-forwarding-rule` (`POST exchange-online://Set-Mailbox`, gatedHere) — NON-TRANSPORTABLE.**

### 3.7 `security-incident-response-v1` — **PARTIAL** (Defender + EXO steps non-transportable)

**Blast radius:** device + user + mailbox + incident. **Destructive?** Yes (isolates a device, disables a user, revokes sessions, blocks outbound send, updates an incident). **Gated:** yes (after `microrem.isolate-device`). **Operator variables:** `deviceId`, `userId`, `mailboxId`, `incidentId`, `status`, `classification`. Steps: **`microrem.isolate-device` (`POST /api/machines/{{deviceId}}/isolate`, gatedHere) — Defender, NON-TRANSPORTABLE** → `action.disable-user-signin` (`PATCH /users/{{userId}}`) → `microrem.revoke-sign-in-sessions` (`POST /users/{{userId}}/revokeSignInSessions`) → **`action.block-outbound-send` (`POST exchange-online://Set-Mailbox`) — EXO, NON-TRANSPORTABLE** → `action.manage-incident` (`PATCH /security/incidents/{{incidentId}}`, Graph, OK). Note the gate sits on step 1 here, which is itself non-transportable — so a real run would pause at the gate having already failed the isolate write.

### 3.8 The six duplicate-row packs — **PARTIAL** (cannot plan; `dependency_cycle`)

`baseline-licensing-v1`, `conditional-access-baseline-v1`, `device-compliance-v1`, `email-security-v1`, `identity-hygiene-v1`, `privileged-access-v1`. Each has every step row **inserted twice** (finding 2), so `buildConfigPackGraph` aborts with `dependency_cycle` before producing any plan or dry-run. Their *intended* step lists (from the distinct template rows) are, for reference only (they cannot execute until de-duped):
- `baseline-licensing-v1`: `action.bulk-reassign-license`, `action.group-based-license-assign`, `action.group-based-license-remove`, `action.sku-swap`, `microrem.enable-mailbox-archive` (last is EXO/non-transportable too).
- `conditional-access-baseline-v1`: `microrem.enforce-ca-policy`, `action.create-named-location`, `action.manage-ca-exclusions`, `action.delete-ca-policy` (Graph).
- `device-compliance-v1`: `microrem.remediate-device-compliance`, `action.update-compliance-policy-assignment`, `action.update-config-profile-assignment`, `action.assign-app-protection-policy`, `action.update-device-category` (Graph).
- `email-security-v1`: `action.set-forwarding-rule`, `action.set-mail-flow-rule`, `action.grant-full-access-delegate`, `action.grant-send-as`, `action.toggle-litigation-hold` — **all five are EXO/non-transportable.**
- `identity-hygiene-v1`: `action.require-security-info-reregistration`, `action.admin-set-password`, `action.enable-user-signin`, `action.convert-user-to-guest`, `action.restore-deleted-user`, `action.generate-temporary-access-pass` (Graph).
- `privileged-access-v1`: `action.pim-assign-role-eligibility`, `action.pim-activate-role`, `action.pim-approve-elevation`, `action.pim-assign-permanent-role`, `action.pim-remove-role-eligibility` (Graph).

### 3.9 `break-glass-access-v1` — **ABSENT** (empty pack)

Sellable at \$249, `active`, `public` — but **zero `config_pack_templates` rows** → `pack_empty` (finding 3). Nothing executes.

---

## 4. Micro-remediation catalog

All 14 are `services.category = micro_remediation`, `fulfillment_type_key = micro_remediation`, `visibility = private`, `is_public = false` (they surface via the admin testing tab and the MCP `execute_action` tool, **not** the public catalog). Each carries an honest `type_attributes.executionReadiness` (`signal_pending`, `scopes_pending`, `execution_unverified`) and a `requiredPermission` string. "Transportable" = the resolved template endpoint is Graph REST (finding 4).

| Service slug | Price | → template_id | Method + endpoint | Reversible | Gate | Transportable | Class |
|---|---|---|---|---|---|---|---|
| `remediate-force-password-reset` | \$25 | `microrem.force-password-reset` | `PATCH /users/{{userId}}` | no | no | ✅ Graph | **REAL** |
| `remediate-revoke-sessions` | \$25 | `microrem.revoke-sign-in-sessions` | `POST /users/{{userId}}/revokeSignInSessions` | no | no | ✅ | **REAL** |
| `remediate-remove-waste-license` | \$19 | `microrem.remove-unused-license` | `POST /users/{{userId}}/assignLicense` | no | no | ✅ | **REAL** |
| `remediate-remove-stale-group-member` | \$25 | `microrem.remove-stale-group-member` | `DELETE /groups/{{groupId}}/members/{{userId}}/$ref` | no | no | ✅ | **REAL** |
| `remediate-remove-sharing-link` | \$19 | `microrem.remove-sharing-link` | `DELETE /sites/{{siteId}}/drive/items/{{itemId}}/permissions/{{permissionId}}` | no | no | ✅ | **REAL** |
| `remediate-remove-risky-app-consent` | \$39 | `microrem.remove-risky-app-consent` | `DELETE /oauth2PermissionGrants/{{grantId}}` | no | **yes** | ✅ | **REAL** |
| `remediate-enable-ca-policy` | \$19 | `microrem.enforce-ca-policy` | `PATCH /identity/conditionalAccess/policies/{{policyId}}` (body `state:enabled`) | no | **yes** | ✅ | **REAL** |
| `remediate-device-compliance-gap` | \$29 | `microrem.remediate-device-compliance` | `POST /deviceManagement/managedDevices/{{deviceId}}/syncDevice` | no | no | ✅ | **REAL** |
| `remediate-deactivate-ownerless-team` | \$25 | `microrem.deactivate-ownerless-team` | `POST /teams/{{teamId}}/archive` | no | no | ✅ | **REAL** |
| `remediate-enable-mailbox-archive` | \$29 | `microrem.enable-mailbox-archive` | `POST exchange-online://Enable-Mailbox` | no | no | ❌ EXO | **PARTIAL** (no EXO transport) |
| `remediate-isolate-device` | \$49 | `microrem.isolate-device` | `POST /api/machines/{{deviceId}}/isolate` | no | **yes** | ❌ Defender | **PARTIAL** (no Defender transport) |
| `remediate-block-file-hash` | \$49 | `microrem.block-file-hash` | `POST /api/indicators` | no | no | ❌ Defender | **PARTIAL** (no Defender transport) |
| `remediate-increase-storage-quota` | \$29 | `null` (SharePoint CSOM, no Graph template) | — | — | — | — | **ABSENT / UNWIRED** |
| `remediate-release-quarantine` | \$39 | `null` (no EXO quarantine-release template) | — | — | — | — | **ABSENT / UNWIRED** |

**The two declared-unwired remediations** (`remediate-increase-storage-quota`, `remediate-release-quarantine`) resolve to `{ kind: "unwired", reason: "no executable template exists for this micro-remediation yet" }` — captured live. `execute_action` refuses them with `409 { error: "'…' has no executable yet: …" }`. **No other micro-remediation is unwired** in the resolver sense; the three PARTIAL ones (finding 4) *are* wired to a real template — they simply resolve to a non-Graph endpoint the executor cannot transport, a distinct failure from "unwired."

**Every micro-remediation is `reversible = false`.** There are no reverse templates for this family (Launch-Control's reversible/reverse-template pairing exists on other `baseline_action_templates`, but not on the `microrem.*` set). Design should present each as a one-way action with no built-in undo.

---

## 5. Gates, consent, and the approval model — the whole write-permission story

This is the one place to learn what must be true before a write is permitted, and the real refusal shape when it isn't. There are **five distinct gate layers**; a write must clear every layer that applies to its path.

### 5.1 The two hard write-back gates (enforced inside `graphWriteForTenant`, `lib/graph.ts:1008`)
Every real write passes through these, fail-closed, before any HTTP call:
1. **MSP write-back toggle** — the customer's MSP must have `msps.write_back_enabled = true` (resolved from `customerId`). Else `WriteBackNotEnabledError` (`reason: "write_back_not_enabled"`), or `WriteBackCustomerNotFoundError` if the customer row can't be resolved. *(Both MSPs in the DB have `write_back_enabled = true`.)*
2. **Tenant write consent** — the tenant's `tenants.consent.writeBack.status` must be `"granted"` (keyed on the tenant GUID, independent of the read-side `graph` consent). Else `WriteConsentRequiredError` (`reason: "write_consent_not_granted"`, `detail: "no_row"` | `"status_<x>"`). *(Both connected tenants have `writeBack.status = "granted"`.)*

A mid-call consent-signature error (`invalid_grant` / `AADSTS65001` / `consent_required` / `AADSTS700016`) flips **only** the `writeBack` key to `revoked` and re-throws `WriteConsentRequiredError` (`detail: "revoked_mid_call"`). A bare `401`/`403` without that signature is **not** treated as revocation — it returns `{ success: false, status, errorType: "insufficient_privilege", data: <body> }`. **This is the shape run 30301 hit (finding 1):** consent stayed granted; the write got a plain `403 insufficient_privilege` with the `Authorization_RequestDenied` body.

These three refusals are distinct, named error types so a caller can surface *which* gate blocked — the routes map them to **`409`** with a `gate` field: `{ error: <message>, gate: "write_back_not_enabled" | "write_consent_not_granted" | "write_back_customer_not_found" }`.

### 5.2 The testbed authorization gate (who may target a real tenant)
- **Config Pack runs** (`runConfigPackForCustomer`): a run may target a tenant only if the customer `is_testbed = true`, **or** a `purchaseAuthorization` (a paid checkout session) is present **and** that tenant's `writeBack` consent is `granted` (re-checked here, fail-closed). Otherwise `ConfigPackError` `customer_not_testbed` (→ HTTP 422) or `customer_write_consent_missing` (→ 422). The admin `run/plan` and admin `run` routes are `PlatformAdmin`-only and v1 documents "testbed customers only."
- **Micro-remediations** (`POST /admin/remediation/execute-action`, the `execute_action` MCP tool): **no testbed gate — deliberately** (`admin-execute-action.ts:11`, per Shane's #1319 direction). These fire at real production tenants from day one; only the §5.1 write-back gates and the confirm flag (§5.3) stand in front.
- **Simulator "Write Actions"** (`admin-write-actions.ts`): testbed-only, refuses a non-`is_testbed` customer with `403`.
- **Mission-control instant remediation** (`portal-mission-control.ts:582`): testbed-only, `403` otherwise, then runs a Config Pack.

### 5.3 The confirm / preview gate (micro-remediations)
`POST /admin/remediation/execute-action` requires `confirmed: true` server-side to perform the write. Anything else returns a **preview** — `mode: "preview"` with the byte-for-byte resolved request (`endpoint`, `method`, `body`, `requiredVariables`, `missingVariables`) and a `safety` block (`reversible`, `reverseTemplateId`, `requiresVerificationGate`, `successCriteria`) — and never touches Graph. The `execute_action` MCP tool maps its `confirm` arg to this flag and, by contract, previews first and only re-calls with `confirm: true` on explicit human go-ahead. `execute_write_pack` has the analogous `planOnly: true` preview.

### 5.4 The break-glass verification gate (the once-only secret)
When a pack contains a template flagged `requires_verification_gate`, `buildConfigPackGraph` splices **exactly one** `break_glass_verification_gate` node after the first flagged template (later flagged templates are *coalesced* — reported in `coalescedGateTemplateIds`; they already run post-gate). At that node (`workflow-executor.ts:7217`):
1. The orchestrator has already stamped a generated secret onto the payload under the key **`generatedPassword`** (`GATE_SECRET_FIELD`), via `generateStrongPassword()` — a `Bg9!`-prefixed, 28-char strong password, the same generator used platform-wide.
2. The gate encrypts it (`break_glass_pending_secrets.encrypted_value`), sets `wf_runs.status = "awaiting_approval"`, and writes a **redacted** payload back to `wf_runs.payload` — the plaintext (`generatedPassword` and any `secretTemplate`-referenced keys) is deleted; `pendingSecretId` and the (non-secret) `breakGlassAccountId` are added. The plaintext never lands in `wf_runs.payload`, the node-output tables, or logs.
3. Delivery (`routes/break-glass-verification.ts`): a portal user invites 1–5 recipients; each opens a single-use link that redirects into **that tenant's** Microsoft OAuth; the callback checks the signed-in user holds an **active Global Administrator** role (`ELIGIBLE_ROLE_TEMPLATE_IDS`); the first to prove it sees the secret **once**; on their explicit acknowledgement the plaintext is purged and the run resumes. An admin can force-reset the credential if every link dead-ends (which generates a **new** secret).

**Hard UI constraint for Design:** the generated secret is surfaced **exactly once**, to a verified tenant admin, and is unrecoverable afterward (only re-generatable via admin override). Any UI that shows it must make that one-time nature unmistakable and must never assume it can be re-read. Preview surfaces (plan, dry-run) only ever show `••••••••••••`.

### 5.5 The purchase / consent ordering gates (public buy flow)
For a public purchase to reach `pack-execute` (`public-purchase-packs.ts`), all fail-closed and server-resolved: (1) live checkout session; (2) session `status = "paid"`; (3) **read** consent granted for the session's tenant; (4) **write** consent granted (`409 { error: "write_consent_required" }` otherwise); (5) the pack is in the paid set; (6) EXECUTE additionally requires the pack key in `SELF_EXECUTABLE_PACK_KEYS` — currently **only `quickstart-v1`**. Any other paid pack is refused `{ code: "pack_not_self_executable" }` ("fulfilled by your architect rather than executed automatically") — because it needs per-entity operator input the checkout session can't supply. The read/write consent grant itself reuses Microsoft's `/adminconsent` flow (`buildAdminConsentUrl`, `read-consent-flow.ts`, `consent-invite.ts`), which passes **no scope parameter** and grants whatever the app registration declares. `readConsentRequirementForServiceType` makes read consent **required** for every product except `retainer` (fail-closed: an unknown service type is treated as required).

### 5.6 The MCP mandatory-audit gate
Both `execute_write_pack` and `execute_action` declare `audit: { access: "write" }`. The MCP api-client (`Git #1325`) refuses any mutating call unless that declaration is present and a **write-ahead, fail-closed** `msp_audit_logs` attempt row is persisted first — so even a network-failed attempt leaves a durable trace. `TenantConsentMap` (`lib/db/schema/msp.ts:115`) is the shape of `tenants.consent` — `{ graph?, writeBack?, sharepoint?: TenantConsentRecord, complianceGroup? }` — each a record of `status`/`consentedAt`/`revokedAt`; `writeBack` is the one gate 5.1(2) reads.

---

## 6. Real payload shapes (observed, unless labelled otherwise)

Every shape below is from a **real** `planOnly`/dry-run response captured this session or a **real** historical run record — never inferred from a TypeScript interface. Where only the interface exists, it is labelled *"declared in code, never observed live."*

### 6.1 The pack **plan** payload (`GET /admin/config-packs/:packKey/run/plan`) — observed
```json
{
  "packKey": "quickstart-v1",
  "label": "Entra ID Quick-Start Pack",
  "gatedTemplateId": "quickstart-v1.create-break-glass-account",
  "coalescedGateTemplateIds": [
    "quickstart-v1.assign-global-admin-role",
    "quickstart-v1.disable-security-defaults",
    "quickstart-v1.create-ca-baseline-policy",
    "quickstart-v1.restrict-guest-access"
  ],
  "operatorVariables": ["domain", "tenantId"],
  "ordered": [
    {
      "templateId": "quickstart-v1.create-break-glass-account",
      "label": "Create Break-Glass Account",
      "sortOrder": 1,
      "effectiveDependsOn": [],
      "requiresVerificationGate": true,
      "requiredVariables": ["domain", "generatedPassword"],
      "gatedHere": true
    }
    // … one entry per step …
  ]
}
```
Refusal (observed): `{ "error": "Dependency cycle among pack templates: ", "code": "dependency_cycle", "templateIds": [] }` (the six duplicate-row packs). Also observed: `{ "code": "pack_empty", "message": "Config pack 'break-glass-access-v1' has no templates assigned" }`. **`gatedHere` in this payload is unreliable for checkKey-only steps — use the dry-run's (finding 5).**

### 6.2 The pack **dry-run** payload (`buildConfigPackDryRun`) — observed, live tenant reads
```json
{
  "packKey": "quickstart-v1",
  "label": "Entra ID Quick-Start Pack",
  "gated": true,
  "executable": true,
  "missingOperatorVariables": [],
  "readAt": "2026-08-28T…Z",
  "actions": [
    {
      "templateId": "quickstart-v1.create-break-glass-account",
      "checkKey": null,
      "label": "Create Break-Glass Account",
      "description": "Creates an emergency access account …",
      "category": "identity",
      "method": "POST",
      "endpoint": "/users",
      "plannedWrite": {
        "displayName": "Emergency Access Admin",
        "mailNickname": "breakglass-admin",
        "accountEnabled": true,
        "passwordProfile": { "password": "••••••••••••", "forceChangePasswordNextSignIn": false },
        "userPrincipalName": "breakglass-admin@mccawsoft2.onmicrosoft.com"
      },
      "changeKind": "create",
      "currentState": { "fetched": false, "note": "creates a new resource — nothing exists to read" },
      "alreadySatisfied": null,
      "reversible": false,
      "gatedHere": true,
      "dependsOnRunOutputs": [],
      "missingVariables": []
    }
    // … one action per step …
  ]
}
```
Field semantics (real): `changeKind ∈ {create, update, delete, check}`; `plannedWrite` = the exact body execution will send (secrets redacted); for `update` steps with a fully-resolved endpoint the dry-run **reads the real current value** and fills `currentState.values` + an `alreadySatisfied` boolean (e.g. `sharepoint-oversharing-v1` steps 4–5 came back `"fetched": true`); `dependsOnRunOutputs` lists variables produced mid-run by earlier steps (e.g. `["breakGlassUserId"]`); `missingVariables` lists operator inputs still absent; a `check` step carries `note: "read-only monitor check — no write to preview"`. A checkKey-only step correctly reports `gatedHere: false` here.

### 6.3 The **run record** (`wf_runs`) and per-step outputs (`wf_run_node_outputs`) — observed
`wf_runs` real columns: `id, version_id, definition_id, trigger_type ('manual'), trigger_ref, status, payload (jsonb), branch_path (jsonb), started_at, finished_at, error_message, created_at, retriggered_from_run_id`. Real `trigger_ref` values observed: `purchase:<sessionUUID>:pack:quickstart-v1`, `config-pack:<packKey>:customer:1:admin:1`. `status` vocabulary: `pending | running | awaiting_approval | completed | failed | cancelled`.

Per-step output (`wf_run_node_outputs`: `run_id, node_id, input (jsonb), output (jsonb), duration_ms, status, error_message, timestamp`), real example from run 30301, **secret redacted for this document** (the raw row held the plaintext in `input`, which is why the redacted-payload gate exists):
```json
{
  "node_id": "tpl-quickstart-v1-create-break-glass-account",
  "status": "error",
  "duration_ms": 1497,
  "error_message": "node error",
  "output": {
    "success": false,
    "status": 403,
    "errorType": "insufficient_privilege",
    "templateId": "quickstart-v1.create-break-glass-account",
    "label": "Create Break-Glass Account",
    "data": "{\"error\":{\"code\":\"Authorization_RequestDenied\",\"message\":\"Insufficient privileges to complete the operation.\",\"innerError\":{…}}}"
  }
}
```
The `start` node's own output carried the full payload including `"generatedPassword": "<a real 28-char Bg9!… value>"` — confirming the generated secret is real and is present pre-gate; the gate is what strips it before persistence for gated packs.

### 6.4 The micro-remediation **preview / executed** payload (`execute_action`) — declared in code, never observed live
The route returns `{ mode: "preview", service: {slug,name,templateId}, tenant: {customerId,name,isTestbed}, resolvedRequest: {endpoint, rawEndpoint, method, body, rawBodyTemplate, requiredVariables, missingVariables}, ready: <bool>, safety: {reversible, reverseTemplateId, requiresVerificationGate, successCriteria}, confirmationRequired: "…" }` on preview, and `{ mode: "executed", service, tenant, result: {success, status, errorType?, endpoint, method, label, missingVariables?, auditLogId}, successCriteria: {defined, expectedStatus?, actualStatus, met?, note} }` on execute. The **executed** shape is declared in code and by the route handler; it was **not** observed live here because obtaining it requires a real mutation (forbidden). The **preview** shape is real in structure (built by `resolveBaselineTemplateRequest`, the same substitution the dry-run uses) but was not separately captured through the HTTP route this session.

### 6.5 The refusal shapes (observed unless noted)
| Condition | Where | Shape |
|---|---|---|
| Unwired micro-remediation | `resolveServiceExecutable` (observed) | `{ "kind": "unwired", "reason": "no executable template exists for this micro-remediation yet" }` |
| Unknown micro-remediation slug | resolver (observed) | `{ "kind": "unwired", "reason": "micro-remediation slug '…' is not declared in the wiring map" }` |
| Not a pack/remediation product | resolver (observed) | `{ "kind": "not_in_catalog" }` |
| Unwired product at `execute_action` | route (declared) | `409 { "error": "'…' has no executable yet: …" }` |
| Config-pack slug sent to `execute_action` | route (declared) | `400 { "error": "'…' is a config_pack product … Use POST /admin/config-packs/:packKey/run instead." }` |
| Pack not found / archived | `loadConfigPack` (observed) | `{ "code": "pack_not_found", "message": "…not found" }` · `{ "code": "pack_not_active", "message": "…has status 'archived'" }` |
| Customer not found | `prepareConfigPackRun` (observed) | `{ "code": "customer_not_found", "message": "Customer 999999 not found" }` |
| Missing operator variables | run route (declared) | `400 { "error": "Missing required variables for pack '…': …", "code": "missing_variables", "missingVariables": [ … ] }` |
| Not testbed / no purchase auth | run route (declared) | `422 { "error": "…is not a testbed customer…", "code": "customer_not_testbed" }` |
| Write-back gate | `graphWriteForTenant` (declared; the `403 insufficient_privilege` variant observed via run 30301) | `409 { "error": "…", "gate": "write_back_not_enabled" \| "write_consent_not_granted" \| "write_back_customer_not_found" }` |
| Concurrency limit (a run of this pack already in flight) | orchestrator (declared) | `409 { "code": "concurrency_limit", "error": "…" }` |
| Duplicate-row pack | plan/dry-run (observed) | `{ "code": "dependency_cycle", "templateIds": [] }` |
| Empty pack | plan/dry-run (observed) | `{ "code": "pack_empty", "message": "…has no templates assigned" }` |
| Live write insufficient privilege | Graph, run 30301 (observed) | `403 { "error": { "code": "Authorization_RequestDenied", "message": "Insufficient privileges to complete the operation." } }` |

---

## 7. Existing UI surfaces — and what they get wrong

1. **Admin "Packs & Remediations" testing tab** — `artifacts/admin-panel/src/pages/CatalogTesting.tsx` (355 lines), fed by `GET /admin/remediation-catalog`. Renders every `config_pack` / `micro_remediation` service joined to its resolved executable, with a testbed-customer picker. Packs run via `GET/POST /admin/config-packs/:packKey/run(/plan)`; micro-remediations preview/execute via `POST /admin/write-actions/:templateId/preview|execute` (note: this admin surface uses the **Simulator write-actions** route, which is testbed-only, **not** the no-testbed-gate `execute_action` route the MCP tool uses — a real divergence Design should be aware of). **What it gets wrong / omits:** it surfaces `executable.existsInDb` and step count but does **not** flag the six duplicate-row packs (they show a step count of 10, not "broken"), does not flag the empty `break-glass-access-v1`, does not distinguish Graph-transportable from EXO/Defender endpoints, and offers a "Run for REAL" button that will 403 on every pack today (finding 1). It confirms via `window.confirm`, not a real plan-review screen.

2. **Portal mission-control instant remediation** — `artifacts/api-server/src/routes/portal-mission-control.ts` (`POST /portal/mission-control/remediate`), consumed by `artifacts/msp-portal/src/components/BreakGlassPendingActionCard.tsx`. Fires a Config Pack for a testbed customer's accepted sales-offer, then surfaces the break-glass pending-secret via `GET /portal/break-glass/by-run/:runId`. **What it gets wrong / omits:** testbed-only (a non-testbed customer silently has zero remediable offers); it inherits every finding-1 / finding-4 limitation of the pack it runs.

3. **Public buy flow** — `artifacts/shane-mccaw-consulting/src/hooks/useBuyPackLive.ts` against `pack-dry-run` / `pack-execute` / `pack-run-status`. Renders the real dry-run before/after. **What it gets wrong / omits:** only `quickstart-v1` ever self-executes; the dry-run for any of the six duplicate-row packs returns `executable: false` with a raw `dependency_cycle` error the UI has no friendly rendering for.

4. **MCP tools** — `execute_write_pack` (`planOnly` preview → real pack run) and `execute_action` (preview → confirmed micro-remediation), both write-ahead-audited. These are the cleanest existing contracts and the closest model for a rebuilt UI's data flow.

---

## 8. Evidence log

- **DB queries (local PostgreSQL `shanemccawmsp`, 2026-08-28):** `config_packs` (15 rows: 14 active + `msp-configure` archived); `config_pack_templates` per pack (revealed the 2× duplication on six packs and the zero rows on `break-glass-access-v1`); `baseline_action_templates` (99 rows — full `template_id/label/category/endpoint/method/body_template/required_variables/success_criteria/requires_verification_gate/reversible/status` dumped); `services` where `fulfillment_type_key ∈ (config_pack, micro_remediation)` (28 rows — packKey/templateId/executionReadiness/price/visibility/is_public); `tenants` + `msps` (write_back_enabled, consent.writeBack) for customers 1 and 3; `wf_definitions`/`wf_runs`/`wf_run_node_outputs` for the two `Config Pack:` definitions (30656, 30657) and runs 30166/30171/30301; `baseline_action_template_audit_log` (29 rows — history: only `simulator`-sourced quickstart writes ever succeeded, on 2026-07-24); `break_glass_pending_secrets` (0 live rows); `simulator_migration_runs` (pack seed provenance).
- **Live `planOnly` / dry-run captures (2026-08-28):** all 14 packs through `loadConfigPack`+`buildConfigPackGraph`+`operatorRequiredVariables` (plan) and `buildConfigPackDryRun` (dry-run, live Graph **reads** only, customer 1); refusal captures via `loadConfigPack("msp-configure")`, `loadConfigPack("no-such-pack-xyz")`, `prepareConfigPackRun({customerId: 999999})`; `resolveServiceExecutable` for the two unwired slugs. Run through a throwaway esbuild bundle mirroring `build.mjs`; **no `runConfigPackForCustomer`, `runBaselineTemplateAgainstTenant`, or `graphWriteForTenant` call was made.** The temp files were deleted; nothing was committed but this document and the bookend.
- **File + line evidence:** `lib/remediation-catalog.ts:50,79,129`; `lib/config-pack-orchestrator.ts:114,253,360,393`; `lib/config-pack-graph.ts:174,224,373` (Kahn sort + gate splice); `lib/config-pack-dry-run.ts:31,115,181`; `lib/graph.ts:56,128,298,1000-1112` (write app scopes, write gates, GRAPH_BASE); `lib/workflow-executor.ts:458,511,7217,8801` (substitution, execute, gate node, execute_baseline_template node); `routes/break-glass-verification.ts:288` (`generateStrongPassword`); `routes/admin-execute-action.ts`; `routes/admin-config-pack-run.ts`; `routes/public-purchase-packs.ts:76` (`SELF_EXECUTABLE_PACK_KEYS`); `lib/read-consent-flow.ts:45`; `lib/consent-invite.ts:38`; `lib/write-action-safety.ts:51,116`; `lib/db/schema/msp.ts:115` (`TenantConsentMap`); `lib/defender-endpoint.ts:317` (`isolateMachine`, no caller — grep-verified). No `shaneapp://` protocol calls were made (all evidence is direct SQL or in-process capture); nothing to log to `sql-runner.protocol`.

---

## 9. Explicit unknowns — including everything not verified because verifying it would require a real mutation

1. **The real payload of any successful write** (create-user response body, assignLicense 200 body, revokeSignInSessions 200 body, a completed pack run's finalization payload) — **not obtained; obtaining it requires a real mutation against the production testbed tenant, forbidden by this issue's safety rule.** The only live write outcome on record is the `403 Authorization_RequestDenied` refusal (§6.3).
2. **The exact failure payload of an Exchange Online (`exchange-online://`) or Defender (`/api/…`) step** (finding 4) — not obtained. The code path guarantees the URL is malformed / mis-hosted, but the precise HTTP error would require firing a real write.
3. **The `execute_action` "executed" (`mode: "executed"`) payload and the `successCriteria` evaluation on a real write** — declared in code (§6.4) but never observed live, for the same reason.
4. **Whether the PROD write app's (`3308b280-e41e-42ba-9f73-73aac2ad3dee`) directory-write permissions are consentable/consented on Staging** — the code comments (`REQUIRED_WRITE_APP_PERMISSIONS`, #1328) say `User.ReadWrite.All` etc. must be added to the live registration and admin-consented; #855 says the write credential story is "wired on Staging." Not verifiable from local dev — Staging was not reached this session. (Local dev itself uses the separate DEV write app, `9f6f4772-b5be-421f-815e-b392336c373a`, since #1812 — this open question is about the PROD registration Staging/Production actually run against.)
5. **Whether the six duplicate-row packs are duplicated on Staging/production too, or only in this local DB** — verified duplicated locally; the seeding migration (2026-08-21 wave) is the likely common cause, but the remote state was not queried.
6. **Per-endpoint Graph permission scope for each write** — the templates do not store a required-scope column; scope attribution beyond the app's declared `REQUIRED_WRITE_APP_PERMISSIONS` (`Application.ReadWrite.All`, `Group.Create`, `RoleManagement.ReadWrite.Directory`, `User.ReadWrite.All`) would be inference and is deliberately not tabulated per step.

**Flagged for a follow-up issue (Shane to decide):** (a) the six duplicate-row packs — de-dupe `config_pack_templates` so they can plan/execute; (b) `break-glass-access-v1` — seed its steps or unpublish it; (c) the missing Exchange Online and Defender execution transports — 13 EXO + 2 Defender templates (and every pack/remediation that uses them) cannot execute as wired; (d) the plan-endpoint `gatedHere` bug on checkKey steps; (e) confirm the PROD write app's (`3308b280-e41e-42ba-9f73-73aac2ad3dee`) tenant-side permission consent so any pack can actually complete a write on Staging/Production — local dev now runs against the separate, already-consented DEV write app (`9f6f4772-b5be-421f-815e-b392336c373a`, #1812) and is not affected by this open item.
