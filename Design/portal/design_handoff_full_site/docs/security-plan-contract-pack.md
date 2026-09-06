# Security Plan — contract extraction pack for Claude Design

**#1731** (regenerate from the finished backend, the #1642 pattern), superseding the pack shipped
under **#1495** on 2026-08-29. Method fixed by **#1577** (contract extraction pack, run per module
as step 3 of **#1578**), under **#1485** (EPIC: Portal New Design). Backend sub-issues
**#1561–#1568**, all closed; **#2085** (business-unit scope gap) closed with a real fix.

**Also serves #2601** (same "regenerate the contract pack" ask, filed minutes after #1731 as a
sibling under #1689, "Feature: Security Plan (MSP Console)" — the operator/authoring half of this
same module, per #1689's own body: "The operator half is architected during #1495's own
architecture conversation, against that module's real contract pack — not invented here"). §2 of
this pack **is** that operator/authoring contract: `msp-security-plan.ts`'s freeze → author prose →
seal → sign sequence, `MSPOperator`/`MSPAdmin`-gated, is the write surface #1689 needs, already
built and already documented here. `artifacts/msp-console` (#1689's own home, blocked on #1680)
does not exist in this repo yet — confirmed at #2601 pack-verification time — so there is no UI to
wire this contract to today; that is #1689's own stated blocker, not a gap this pack introduces.
#2601's own audit re-verified this pack against current `main` (route line numbers, wire
interfaces, and local DB row counts all re-checked and found unchanged since #1731's extraction)
rather than re-deriving a duplicate file — see §9.

Read-only. Every field below is extracted verbatim from a route's own `Wire*`/exported interface
and the Drizzle schema, cited to file:line. **Nothing here is authored or invented.** No product
code, no schema changes, no UI, no `drizzle-kit push`.

**Why this pack replaces the #1495 one wholesale, not edited.** The prior pack's whole thesis
(§2 there) was that a real, live, admin-authored plan existed but did **not** implement the
settled 2026-08-28 architecture — "a view over the other eight modules, owning almost no data of
its own" (#1561). That architecture has since actually shipped: #1561–#1567 landed real code
(`security-plan-assembly.ts`, `security-plan-versioning.ts`, `security-plan-drift.ts`,
`security-plan-prose.ts`, `security-plan-draft.ts`, `routes/msp-security-plan.ts`), and #2085 (a
finding raised by the #1561 build itself) landed a real `tenants.business_unit` column plus its
own AdminV2 editor. So the situation this pack must document has fully inverted from the last
one: **the settled architecture is now the real, built, tested MSP-side surface** — and the
**original admin-authored table is now the stale one**, unchanged since 2026-08-21 and, as of this
pack, disconnected from any live customer-facing page at all (§0.3). Both halves are documented
here on their own terms; neither is presented as if it were the other.

Backend routes: `artifacts/api-server/src/routes/portal-security-plan.ts` (customer-scoped,
GET-only, unchanged since #1495) and `artifacts/api-server/src/routes/msp-security-plan.ts`
(MSP-scoped, the assembled/versioned/signed surface, #1561–#1567)
Assembly/versioning/drift/prose/draft libs: `artifacts/api-server/src/lib/security-plan-assembly.ts`,
`security-plan-versioning.ts`, `security-plan-drift.ts`, `security-plan-prose.ts`,
`security-plan-draft.ts`, `security-plan-cross-tenant.ts` (#2145, no route yet — §7.2)
Schema: `lib/db/src/schema/msp.ts:6391-6679` (`msp_security_plan_versions` +
`msp_security_plan_drafts` + their shared TS types) and `lib/db/src/schema/msp.ts:7441-7580`
(`portal_security_plans` + 3 child tables, unchanged since #1495)
Seed/DDL migrations: `lib/db/migrations/manual/2026-08-21-portal-v2-security-plan.sql`,
`2026-08-31-security-plan-versioning-1561.sql`, `2026-08-31-security-plan-prose-1566.sql`,
`2026-09-01-tenants-business-unit-2085.sql`
Customer-facing page: **none currently in the live portal build** — see §0.3.

---

## 0. The surfaces and their consumers

**msp-portal was retired and replaced by `artifacts/portal` (Git commit `f40438cdc`, "Portal
scaffolding: create artifacts/portal, retire artifacts/msp-portal") since the #1495 pack was
written.** `artifacts/msp-portal` no longer exists in the repo. `artifacts/portal/src/pages`
currently holds four files: `coming-soon.tsx`, `index.tsx`, `not-found.tsx`, `support.tsx` — no
Security Plan page, no `securityPlanWire.ts`/`securityPlanModel.ts`/`securityPlanLive.ts`, and no
`securityPlanData.ts` fixture (`find … -iname securityPlanData.ts` across the repo, outside
`node_modules`, returns nothing). `Design/portal/` (the live #1485 design source) has no Security
Plan `.dc.html` export either. Per the standing convention, that means Security Plan has **no
design and no page today** — this pack is the input the eventual Design pass needs, not a
description of something already wired. The shell nav does carry a placeholder entry —
`artifacts/portal/src/components/shell/moduleNav.ts:52`:
`{ key: "security-plan", label: "Security Plan", icon: FileCheck2, builtPath: null }` —
`builtPath: null` marks it explicitly unbuilt, consistent with everything else in this section.

| Endpoint | Method | Route file:line | Role | Consumed by | Orphaned? |
|---|---|---|---|---|---|
| `/api/portal/security-plan` | GET | `portal-security-plan.ts:109-212` | `CustomerUser` | **Nothing.** No page in `artifacts/portal` calls it. | **Yes — orphaned since the portal-v2→portal migration removed its only caller.** Not a new sub-issue (see §0.3): the endpoint's data model is itself superseded by §0.2 below, so re-wiring the old page verbatim would be wiring the wrong contract. |
| `/api/msp/security-plan/:customerId/assembled` | GET | `msp-security-plan.ts:209-225` | `MSPOperator` | Nothing (§0.2) | **Yes — deliberately, per the route's own header ("SCOPE STOP … there is no `Design/portal` export and no `artifacts/portal` page to wire it to yet")** |
| `/api/msp/security-plan/:customerId/drift` | GET | `msp-security-plan.ts:238-253` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/versions` | GET | `msp-security-plan.ts:256-271` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/versions/current` | GET | `msp-security-plan.ts:275-294` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/draft/freeze` | POST | `msp-security-plan.ts:308-332` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/draft` | GET | `msp-security-plan.ts:336-355` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/draft/prose` | PATCH | `msp-security-plan.ts:365-389` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/versions` | POST | `msp-security-plan.ts:397-456` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/versions/:versionUid/sign` | PATCH | `msp-security-plan.ts:468-508` | `MSPAdmin` | Nothing | Yes, same reason |

Both routers are genuinely mounted and live: `routes/index.ts:487` (`router.use(portalSecurityPlanRouter)`)
and `routes/index.ts:537` (`router.use(mspSecurityPlanRouter)`), imported at `:180` and `:268`
respectively — these are real, reachable endpoints, not dead imports.

### 0.1 Why nine endpoints are orphaned and this pack does not file nine sub-issues for them

Per §"Trigger for filing sub-issues" in #1731's own issue body: a pack files a sub-issue for "a
real, live endpoint the page does not call." All nine MSP-side endpoints qualify literally, but
`msp-security-plan.ts:23-27`'s own header already states the scope stop explicitly and by design:
*"SCOPE STOP on #1561/#1562/#1566 ends this build at the wire contract — there is no
`Design/portal` export and no `artifacts/portal` page to wire it to yet."* That is not an
oversight to file as a gap — it is a **documented, deliberate handoff point**, and #1568's own
resolution (§7.2) makes the same call for the MSP cross-tenant read. Filing "the endpoint your own
header says is not wired yet" as a surprise finding would misrepresent a planned stopping point as
an accidental one. What this pack *does* flag as a genuine, previously-undocumented gap is §0.3.

### 0.2 What each MSP-side surface is, briefly (full detail in §1–§6)

`/assembled` — the live, honest (or scoped) assembled document: every module's current rows,
`GET`, non-mutating. `/drift` — the same live document plus its diff against the last **signed**
version. `/draft/*` — the frozen-state holding pen between "freeze" and "seal" (#1566's fixed
authoring sequence). `/versions` (`POST`) — seals the frozen draft as a new, superseding version.
`/versions/:versionUid/sign` — signs the current, unsigned version.

### 0.3 New finding — the customer-facing endpoint's own data model is now stale, not just its page

`portal-security-plan.ts` has exactly one commit in its history (`d3c3bfa3c`, the #1495 build) and
has not been touched since. It still serves `portal_security_plans` — a table of **hand-typed**
`req`/`state`/`detail` rows, authored once via a manual-migration seed, with **zero reads from any
of the seven source modules** the settled #1561 architecture assembles from. Meanwhile the MSP
side now has a real, tested assembly/versioning/signing pipeline over exactly those seven modules.
So there are now genuinely **two different, disconnected models of "the Security Plan" in the same
codebase**: an old admin-authored plan-of-record table with a customer-facing (but currently
page-less) read route, and a new assembled/versioned/signed pipeline with an MSP-facing (but
currently unwired) surface. Nothing bridges them — the customer route does not read
`msp_security_plan_versions`, and nothing on the MSP side writes to `portal_security_plans`. This
is filed as a sub-issue (§8) because it is a genuine, previously-undocumented architectural split,
not something either #1561's header or #1568 already named.

---

## 1. Customer-facing wire contract — the ORIGINAL model (CURRENT, but orphaned — §0.3)

`GET /api/portal/security-plan` reads `portalSecurityPlansTable` and its three child tables
(`msp.ts:7471-7580`), scoped to the caller's own `customerId` (`portal-security-plan.ts:113, 123`
— a direct `tenants.id` equality, no `(mspId, tenantId)` pair, matching #1495's original note that
nothing here reads an MSP-era table).

```ts
// portal-security-plan.ts:64-107 — verbatim
export interface WireSecPlanRow {
  readonly req: string;
  readonly state: string;      // met | partial | gap
  readonly detail: string;
  readonly to: string;         // a portal route path
  readonly toLabel: string;
}
export interface WireSecPlanSection {
  readonly k: string;
  readonly n: string;
  readonly label: string;
  readonly lead: string;
  readonly rows: readonly WireSecPlanRow[];
}
export interface WireSecPlanVersion {
  readonly v: string;
  readonly when: string;
  readonly who: string;
  readonly what: string;
  readonly cr: string;
}
export interface WireSecurityPlan {
  readonly tenant: string;
  readonly env: string;
  readonly tier: string;
  readonly version: string;
  readonly updated: string;
  readonly approver: string;
  readonly owner: { readonly initials: string; readonly tone: string };
  readonly sections: readonly WireSecPlanSection[];
  readonly history: readonly WireSecPlanVersion[];
}
export interface WireSecurityPlanPayload {
  readonly plan: WireSecurityPlan | null;
}
```

| Wire field | Source column | DB type | Status |
|---|---|---|---|
| `tenant` | `tenant` (`msp.ts:7476`) | text, notNull | CURRENT — authored label |
| `env` | `env` (`msp.ts:7478`) | text, notNull | CURRENT — authored |
| `tier` | `tier` (`msp.ts:7480`) | text, notNull | CURRENT — authored |
| `version` | `version` (`msp.ts:7482`) | text, notNull | CURRENT — authored string, **not** the versioning model §2 describes |
| `updated` | `updated_label` (`msp.ts:7489`) | text, notNull | CURRENT — a display string, not a timestamp |
| `approver` | `approver` (`msp.ts:7491`) | text, notNull | CURRENT — authored name+title; **not** the signature record §3.4 describes |
| `owner.initials` / `owner.tone` | `owner_initials` / `owner_tone` (`msp.ts:7493-7495`) | text, notNull | CURRENT |
| `sections[].k`/`n`/`label`/`lead` | `portal_security_plan_sections` (`msp.ts:7506-7523`) | text, notNull | CURRENT |
| `sections[].rows[].req`/`state`/`detail` | `portal_security_plan_rows` (`msp.ts:7528-7553`) | text/enum, notNull | CURRENT — **hand-typed judgment**, no read from any of the seven source modules |
| `sections[].rows[].to`/`toLabel` | `to_route`/`to_label` (`msp.ts:7545-7547`) | text, notNull | CURRENT — a navigation link, not a data join |
| `history[]` | `portal_security_plan_versions` (`msp.ts:7558-7577`) | text, notNull | CURRENT — hand-typed; `cr` (`msp.ts:7572`) carries no FK to `msp_change_requests` |

**Derived, client-side only (dead in the current portal build — the code that read this payload no
longer exists):** the header verdict, met percentage, per-section gap count and tallies were
computed in `securityPlanModel.ts`, which was removed along with the rest of `artifacts/msp-portal`
(§0.3). If/when this data is wired into a new page, "derive, don't store a copy" remains the right
model to carry forward.

### 1.1 Local DB state, honestly reported

Queried directly against the local `DATABASE_URL` at pack time: `portal_security_plans`,
`portal_security_plan_sections`, `portal_security_plan_rows`, `portal_security_plan_versions` all
report **0 rows**, even though `simulator_migration_runs` records
`2026-08-21-portal-v2-security-plan.sql` as having run (`ran_at 2026-08-21 19:16:00-04`) and that
file's own seed is idempotent (`DELETE ... WHERE customer_id = v_customer_id` then re-`INSERT`,
`lib/db/migrations/manual/2026-08-21-portal-v2-security-plan.sql:141-244`). The local database was
evidently reset since that seed last ran, and this read-only pack does not re-run it (out of scope
for a pack that changes no data). This does not change any field mapping above — the migration
file, route, and schema are all real and unchanged — but a session verifying live behavior locally
should not be surprised to find `{ plan: null }` for the testbed customer today.

---

## 2. MSP-side wire contract — the SETTLED architecture, as actually built (CURRENT, real, orphaned by design — §0.1)

`assembleSecurityPlan(tenant, scope)` (`security-plan-assembly.ts:424-451`) reads seven source
tables — no eighth "own" table beyond the version/draft records themselves:

```
Policy Decisions   (#1490) — policy_decisions            (security-plan-assembly.ts:122-149)
Risk Register      (#1487) — msp_risk_decisions           (:151-179)
Ownership / RACI    (#1491) — portal_ownership_rows        (:181-207)
SOPs / Runbooks     (#1493) — msp_sops                     (:209-240)
Remediation         (#1489) — remediation_tracker_steps    (:242-267)
Change Control      (#1486) — msp_change_requests          (:269-296)
Microsoft Changes   (#1494) — m365_change_interpretations  (:298-324)
```

Every reader is scoped by `(mspId, tenantId)` or `customerId` off the resolved `TenantScope`
(`portal-customer-scope.ts:43-52`), never by a caller-supplied id. Each returns a uniform
`SecurityPlanAssembledItem` (`msp.ts:6495-6503`):

```ts
// msp.ts:6495-6503 — verbatim
export interface SecurityPlanAssembledItem {
  readonly id: string;
  readonly title: string;
  readonly state: string | null;
  readonly detail: string | null;
  readonly pillar: string | null;
  readonly framework: string | null;
  readonly businessUnit: string | null;
}
```

`state`/`detail` per module (all real column reads, none fabricated — `security-plan-assembly.ts`):

| Module | `state` from | `detail` from |
|---|---|---|
| Policy Decisions | `decision_state` | `Review: {reviewState}` if present, else `obligation` |
| Risk Register | `status` | `Raw {rawRiskLevel} → residual {residualRiskLevel}` |
| Ownership / RACI | `obj_type` | `sub` |
| SOPs / Runbooks | `version_status` | `{category} · {automationType}` |
| Remediation | `status` | `Verification: {verificationState}` if present |
| Change Control | `status` | `{changeClass} · {riskLevel} · {category}` |
| Microsoft Changes | `status` | `{changeClass} · controllable: {controllable}` if present |

`pillar`/`framework` are only populated where a real column exists (Policy Decisions: `pillar`
only; Risk Register: both; every other module: both `null` — SOPs' own `category` is deliberately
**not** mapped onto `pillar`, "conflating two different vocabularies," `security-plan-assembly.ts:231-234`).
`businessUnit` is the same value on every item in one assembly — `tenants.business_unit` (§2.1),
not a per-row column.

### 2.1 Scope dimensions (#1563, #2085) — real, all three backed

```ts
// msp.ts:6437 — verbatim
export const SECURITY_PLAN_SCOPE_DIMENSIONS = ["pillar", "framework", "businessUnit"] as const;
```

| Dimension | Backing column | Status |
|---|---|---|
| `pillar` | `policy_decisions.pillar`, `msp_risk_decisions.pillar` | CURRENT — varies per row |
| `framework` | `msp_risk_decisions.framework` | CURRENT — varies per row |
| `businessUnit` | `tenants.business_unit` (added by `2026-09-01-tenants-business-unit-2085.sql`) | **CURRENT as of #2085** — nullable freeform text, one value per tenant (so scoping on it within one plan is all-or-nothing, `security-plan-assembly.ts:28-30`); editable via `PATCH /admin/active-directory/customer/:id` (`admin-active-directory.ts:641-674`), wired in AdminV2's `AdCustomerCanvas.tsx`. Locally, both seeded tenants (`id 1`, `id 3`) currently have `business_unit` **null** — the column and its editor are real, but no tenant has been given a value yet, so the dimension is real-but-currently-inert on this DB. |

`isExcludedByScope` (`security-plan-assembly.ts:108-118`, tested `security-plan-assembly.test.ts:52-90`
including a dedicated `businessUnit (#2085) excludes/retains exactly like pillar/framework` case,
`:72-76`): a row is excluded by a dimension only when it *carries* a value not in the allowed set;
a `null` value is always retained, never dropped by absence. **No outcome filter exists anywhere in
this module** — the `scopeSchema` (`msp-security-plan.ts:156-164`) accepts only `dimensions.pillar`
/ `dimensions.framework` / `dimensions.businessUnit` and an optional `statement`; any other query
key (e.g. an attempted `severity=`) is silently ignored (`msp-security-plan.ts:166-180`), which is
what structurally enforces #1563 rather than merely documenting it.

### 2.2 Filter footprint (#1565) — always computed, snapshotted at seal

```ts
// msp.ts:6468-6476 — verbatim
export interface SecurityPlanFilterFootprint {
  readonly scope: SecurityPlanScope & { readonly statement: string };
  readonly isHonestView: boolean;
  readonly excludedByModule: readonly SecurityPlanModuleExclusion[];
  readonly totalExcluded: number;
  readonly computedAt: string;
}
```

Computed by `applyScopeAndFootprint` (`security-plan-assembly.ts:380-418`), pure and unit-tested
(`security-plan-assembly.test.ts:114-139`) independent of any DB seed. `scope.statement` is
**never blank** on anything that reaches a seal: `synthesizeScopeStatement`
(`security-plan-assembly.ts:358-371`) fills a canonical honest-view sentence
("Full assessed estate — no scope narrowing applied.") when the caller supplied none for the
unscoped case, and the seal route (`msp-security-plan.ts:419-427`) hard-fails a scoped seal with no
human statement via `scopeMissingRequiredStatement` (`security-plan-assembly.ts:341-343`) — a 400,
not a synthesized fallback, for the scoped case (#1564's distinction between the two: an honest
seal still needs a canonical bounded claim; a scoped seal needs a *real, human* one).

### 2.3 Authored prose (#1566) — the module's only self-owned content

```ts
// msp.ts:6526-6539 — verbatim
export const SECURITY_PLAN_PROSE_SECTIONS = ["scope", "methodology", "exclusions", "executiveSummary"] as const;
export interface SecurityPlanProseSectionContent {
  readonly text: string;
  readonly editedInThisVersion: boolean;
}
export type SecurityPlanProse = Record<SecurityPlanProseSection, SecurityPlanProseSectionContent>;
```

Carried forward by default from the plan's last version; only sections actually touched while
authoring the current draft are marked `editedInThisVersion` (`security-plan-prose.ts:37-52`,
`:64-81`), diffed against a `baselineProse` snapshot fixed once at draft creation — never against
the section's own last edit — so reverting text to its baseline correctly clears the flag again
(`security-plan-prose.ts:65-70`; `security-plan-draft.ts:98-120` wires this server-side, never
client-set). `null` only on a version sealed before #1566 shipped (`msp.ts:6552-6556`) — a real
legacy case, not a live gap: `carryForwardLegacyOrProse` (`security-plan-prose.ts:54-62`) treats
that old free-text stub the same as "no prior version" rather than fabricating a section split that
was never authored.

### 2.4 The fixed authoring sequence (#1566)

`freeze → author prose against the frozen state → seal`, enforced structurally, not just by
convention:

1. **`POST /draft/freeze`** (`msp-security-plan.ts:308-332`) — `freezeSecurityPlanDraft`
   (`security-plan-draft.ts:44-86`) assembles NOW (optionally scoped) into `frozenContent`. First
   freeze for a plan also seeds `baselineProse`/`prose` from the current sealed version's prose (or
   an empty baseline). A re-freeze refreshes only `frozenContent` — never touches in-progress
   `prose`.
2. **`GET /draft`**, **`PATCH /draft/prose`** — read/edit one section against the frozen snapshot.
3. **`POST /versions`** (`msp-security-plan.ts:397-456`) — **seals the draft, does not re-assemble
   live and does not accept inline prose/scope.** No frozen draft → `409 CONFLICT`
   (`msp-security-plan.ts:406-415`), never a silent fallback to "assemble now." On success, the
   draft's `frozenContent` + `prose` are combined into one `SecurityPlanContent` and the draft row
   is deleted (`msp-security-plan.ts:429, 444`; `security-plan-draft.ts:122-128`).

### 2.5 Versioning/sealing (#1561, #1562 — "the RBD pattern one level up")

```ts
// msp.ts:6601-6629 — verbatim (comments trimmed)
export const mspSecurityPlanVersionsTable = pgTable("msp_security_plan_versions", {
  id: serial("id").primaryKey(),
  versionUid: uuid("version_uid").notNull().unique().defaultRandom(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  tenantName: text("tenant_name").notNull(),
  versionNumber: integer("version_number").notNull(),
  content: jsonb("content").$type<SecurityPlanContent>().notNull(),
  createdBy: jsonb("created_by").$type<MspAssessor>().notNull(),
  signed: boolean("signed").notNull().default(false),
  signedBy: jsonb("signed_by").$type<ClientApprover>(),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_security_plan_versions_msp_id_customer_id_idx").on(t.mspId, t.customerId),
  index("msp_security_plan_versions_customer_superseded_idx").on(t.customerId, t.supersededAt),
  unique("msp_security_plan_versions_msp_customer_version_uidx").on(t.mspId, t.customerId, t.versionNumber),
]);
```

`createSecurityPlanVersion` (`security-plan-versioning.ts:52-95`) runs supersede-then-insert in one
transaction: a reader can never observe two `supersededAt IS NULL` rows for the same
`(mspId, customerId)`, nor a moment with zero. `content` is a full, self-contained snapshot — never
a pointer re-resolved against live rows at read time (matching `msp_rbd_versions`'s own rule).
`signSecurityPlanVersion` (`:164-185`) only updates a row matching current-and-unsigned
(`supersededAt IS NULL AND signed = false`); signing a superseded or already-signed version is
structurally impossible via this function, not merely discouraged.

`getLastSignedSecurityPlanVersion` (`:121-138`) is the one addition beyond the RBD shape — the
anchor `security-plan-drift.ts` compares the live view against.

```ts
// msp-security-plan.ts:86-107 — verbatim, the wire shape
interface WireSecurityPlanVersion {
  readonly versionUid: string;
  readonly customerId: number;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly versionNumber: number;
  readonly content: unknown;
  readonly scopeStatement: string;   // mirrored out of content.footprint.scope.statement
  readonly createdBy: unknown;
  readonly createdAt: string;
  readonly signed: boolean;
  readonly signedBy: unknown;
  readonly signedAt: string | null;
  readonly isCurrent: boolean;       // supersededAt === null
}
```

### 2.6 Signing (#1564)

`PATCH /versions/:versionUid/sign` requires `MSPAdmin` (a stricter role floor than every other
route on this router, all `MSPOperator`) and a real signature payload (`name`, `title`, `email`,
`ipAddress`, `signatureHash`, `msp-security-plan.ts:458-464`). Signing attaches to the version's own
recorded `scopeStatement`, never to an unqualified claim — see §2.2's synthesized-statement
guarantee, which exists specifically so this signature never attaches to a blank scope.

### 2.7 Drift (#1562, #1567)

```ts
// msp.ts:6590-6599 — verbatim
export interface SecurityPlanDrift {
  readonly hasLastSignedVersion: boolean;
  readonly lastSignedVersionUid: string | null;
  readonly lastSignedVersionNumber: number | null;
  readonly lastSignedAt: string | null;
  readonly modules: readonly SecurityPlanModuleDrift[];
  readonly totalAdded: number;
  readonly totalRemoved: number;
  readonly totalChanged: number;
}
```

`computeSecurityPlanDrift` (`security-plan-drift.ts:42-123`) is pure — diffs the live (always
honest/unscoped, `msp-security-plan.ts:246`) assembled document against the last **signed**
snapshot, module-by-module, item-by-item-id. `sameContent` (`:31-33`) compares only `state` and
`detail` — the two fields a reader can actually see change. **It never reads `.prose` at all**
(`security-plan-drift.ts:20-22`) — this is the structural enforcement of #1567's "mechanical data
drift only, never prose staleness" rule, not a policy note that could be bypassed by a future edit
to the same function. `hasLastSignedVersion: false` (nothing ever signed) returns an all-empty
drift with no baseline to compare against — a distinct case from "signed and unchanged."

### 2.8 Draft holding pen

```ts
// msp.ts:6650-6674 — verbatim (comments trimmed)
export const mspSecurityPlanDraftsTable = pgTable("msp_security_plan_drafts", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  tenantName: text("tenant_name").notNull(),
  frozenContent: jsonb("frozen_content").$type<SecurityPlanContent>().notNull(),
  frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull(),
  baselineProse: jsonb("baseline_prose").$type<SecurityPlanProse>().notNull(),
  prose: jsonb("prose").$type<SecurityPlanProse>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("msp_security_plan_drafts_msp_customer_uidx").on(t.mspId, t.customerId),
]);
```

One draft row per `(mspId, customerId)` — enforced by the unique index, not just convention.

### 2.9 Local DB state, honestly reported

`msp_security_plan_versions` and `msp_security_plan_drafts` both report **0 rows** locally. No
version has ever been sealed for either seeded tenant on this database. This does not indicate a
bug — the sealing flow requires an explicit freeze→author→seal sequence that nothing has triggered
yet on this environment — but it means every wire shape in §2.5–§2.8 above is verified against the
route/schema/test code, not against a live row on this database.

---

## 3. Real enum unions

| Vocabulary | Values | Where fixed | Status |
|---|---|---|---|
| Portal (customer-side) requirement row state | `met`, `partial`, `gap` | `PORTAL_SECURITY_PLAN_ROW_STATE`, `msp.ts:7468-7469`; a Drizzle `text(...,{enum})` column, not a Postgres `pgEnum`/CHECK (`msp.ts:7462-7464` — deliberate, so the vocabulary can widen without a migration) | CURRENT on the orphaned §1 model; **not** used or referenced anywhere in the §2 assembly model — the two `state` concepts are unrelated strings from different tables |
| Security Plan scope dimension | `pillar`, `framework`, `businessUnit` | `SECURITY_PLAN_SCOPE_DIMENSIONS`, `msp.ts:6437` — a TS `as const` tuple, not a DB enum (there is no DB column literally named "dimension"; each dimension is backed by its own real column, §2.1) | CURRENT, all three real (#2085 closed the last gap) |
| Security Plan prose section | `scope`, `methodology`, `exclusions`, `executiveSummary` | `SECURITY_PLAN_PROSE_SECTIONS`, `msp.ts:6526` | CURRENT |
| Assembled item `state`/`detail` per module | free text, sourced from each module's own status/state column (§2, table) | not a single fixed vocabulary — each source module keeps its own | CURRENT, honestly heterogeneous — the assembly layer does not normalize seven different modules' state vocabularies into one enum, and does not claim to |

No `pgEnum` (a real Postgres `CREATE TYPE ... AS ENUM`) exists anywhere in this module's own
tables — every vocabulary above is either a Drizzle `text({enum})` column or a TypeScript-only
`as const` tuple, consistent with the rest of this codebase's stated convention of keeping
in-code vocabularies widenable without a migration.

---

## 4. Cross-surface edges — now REAL reads, not named-but-unconsumed borrows

The #1495 pack's whole §4 was a table of fields Security Plan *would need to borrow* from seven
other modules, each marked "not consumed here." That is no longer accurate for the MSP-side
assembly — §2's table above **is** that consumption, cited to the actual `readXxx()` function for
each module. What remains genuinely unconsumed:

| Module | What §2's assembly reads | What it does NOT read |
|---|---|---|
| Policy Decisions (#1490) | `title`, `pillar`, `obligation`, `decisionState`, `reviewState` | `rationale`, `compensating` (real fields on that module's own contract pack, not pulled in here) |
| Risk Register (#1487) | `title`, `pillar`, `framework`, `rawRiskLevel`, `residualRiskLevel`, `status` | The acceptance record (`WireRisk.accepted`), liability value |
| Ownership/RACI (#1491) | `rowId`, `objType`, `name`, `sub` | `ownerPersonId`, `roleKey`, delegation records |
| SOPs/Runbooks (#1493) | `sopId`, `title`, `category`, `automationType`, `versionStatus` | Run-history rows (`msp_sop_runs`) |
| Remediation (#1489) | `stepId`, `status`, `verificationState` | `verifiedByRunId` |
| Change Control (#1486) | `title`, `changeClass`, `riskLevel`, `status`, `category` | Approve/reject/rollback outcome linkage |
| Microsoft Changes (#1494) | `title`, `changeClass`, `status`, `controllable` | Cloud-instance/date-quality fields those modules' own packs document |

None of the "does NOT read" columns above are gaps to file — the assembly deliberately takes a
small, uniform slice (`id`/`title`/`state`/`detail`/dimensions) per module rather than every field
each source module owns; that is the "uniform display shape" design (`msp.ts:6478-6480`), not an
oversight.

**The old §4's genuinely open items carry forward unchanged, because nothing since has resolved
them:** #1527 (Policy Decisions' `decision_state` carrying `expired`, "DECIDED-wrong" per the Risk
Register pack), #1507 (Risk Register review-clock split), #1511 (role-based acceptance authority),
#1556/#1557 (SOPs/Runbooks unification), #1496 (Change Control's five dead buttons). None of these
block what §2 already reads — they are about fields §2 does not currently consume.

---

## 5. Honest-empty contract & the tri-state — now two separate contracts

### 5.1 Customer-facing (`/api/portal/security-plan`, §1) — orphaned, so this describes the route only, not a rendered page

| State | Wire behaviour |
|---|---|
| No plan authored | `200 { plan: null }` (`portal-security-plan.ts:129-133`) |
| Plan exists | `200 { plan: {...} }` with every field populated (no partial-plan shape) |
| Read failed | `500 { error: "Your security plan could not be loaded." }` (`:204-210`) |

Since no page currently calls this route (§0.3), there is no client-side tri-state to describe —
the old #1495 pack's four-state client contract (`loading` / `live` / `no-plan` / `error`) lived in
`securityPlanLive.ts`, which was removed with the rest of `artifacts/msp-portal`. If/when a page is
rebuilt against either this route or the §2 assembly, that four-state discipline (particularly
"no plan authored" as its own first-class state, distinct from a read failure) is worth carrying
forward — Git #1439 fixed exactly the failure mode of collapsing them.

### 5.2 MSP-side (`/api/msp/security-plan/:customerId/*`, §2)

| State | Wire behaviour |
|---|---|
| Tenant not owned by caller's MSP, or doesn't exist | `404 { error: "No such customer tenant" }` (`msp-security-plan.ts:196-204`) — deliberately identical for both cases, "do not leak that it exists" |
| No MSP context on the caller | `403 { error: "MSP context required" }` (`:186-189`) |
| `/assembled`, `/drift` | Always `200` with a real (possibly all-empty-modules) document — an assembly with zero rows in every module is a legitimate honest-empty result, not an error; nothing here distinguishes "no data" from "not yet built for this tenant" because there is no such distinction to make — the assembly always runs live |
| `/versions/current` with nothing ever sealed | `404 { error: "No version has been sealed for this Security Plan" }` (`:284-286`) |
| `/draft` with nothing frozen | `404 { error: "No draft — freeze the assembled state first" }` (`:345-347`) |
| `POST /versions` with no frozen draft | `409 CONFLICT` (`:406-414`) |
| `POST /versions` with a scoped draft carrying no statement | `400 VALIDATION` (`:419-427`) |
| Sign a version that's missing, superseded, or already signed | `409 { error: "Version not found, not current, or already signed" }` (`:493-496`) |
| Any route, unhandled exception | `500 INTERNAL` with the real error message (`apiError(..., ApiErrorCode.INTERNAL, ...)`) |

---

## 6. The forbidden list — declared, not merely absent

1. **No customer write path anywhere.** `portal-security-plan.ts` is GET-only (unchanged). The
   MSP-side authoring surface (`msp-security-plan.ts`) is entirely `MSPOperator`/`MSPAdmin`-gated —
   no route on that router accepts a `CustomerUser` token. If a customer-editable or
   customer-signable plan is ever wanted, that is new work, not a gap in what exists.
2. **No outcome filter on Security Plan scope, structurally, not just by convention** — §2.1: the
   accepted query schema has no key that could express severity/accepted/open/pass-fail, and any
   extra key sent is silently dropped rather than validated-and-rejected (which would at least
   acknowledge the attempt) or silently honored (which would violate #1563). Silently dropping is
   the deliberate choice recorded in the route's own header.
3. **No server-side re-derivation of a header verdict/percentage/gap badge on the MSP side** — the
   assembly returns raw per-module items and counts; nothing in `security-plan-assembly.ts`
   computes a single rolled-up score. (The old client-side derivation this rule described on the
   customer side no longer runs anywhere — its code was removed with `artifacts/msp-portal`.)
4. **Drift never reads `.prose`** (§2.7) — enforced by the function's own field access, not a
   comment that could silently drift out of sync with the code.
5. **A scoped seal can never reach the database without a real, human-authored statement** — checked
   before `createSecurityPlanVersion` is ever called (`msp-security-plan.ts:419-427`), not as a
   nullable column filled in later.
6. **No fabricated register/module data anywhere in either model.** The §1 rows are honestly
   hand-typed by design (not derived, and not pretending to be); the §2 rows are honestly derived
   from real source-table columns, cited per module in §2's table. Neither model claims to be the
   other.

---

## 7. Open, flagged — not resolved

1. **§0.3 (new, this pack) — the two Security Plan models are unbridged.** Not decided by this
   pack: whether the eventual customer-facing page reads the §1 table, the §2 assembly, or the §2
   assembly is migrated to replace §1 outright (the settled 2026-08-28 architecture comment on
   #1495 implies the latter, but no issue has actually scheduled that migration or the removal/
   repurposing of `portal_security_plans`). Filed as a sub-issue, §8.

2. **#1568 — is there a cross-customer MSP posture view — now split and partially answered.**
   `security-plan-cross-tenant.ts` exists (Git #2145, closed) and is a real, tested, fail-closed
   read primitive (`resolveSecurityPlanCrossTenantBook`/`readSecurityPlanAcrossCustomers`,
   `security-plan-cross-tenant.ts:63-143`; guard tests in `security-plan-cross-tenant.test.ts:21-44`
   covering no-user, CustomerUser, unscoped MSP-staff, and Free/Assessment-tier callers all
   resolving to an empty book). Its own header is explicit that this is deliberately a read
   primitive only: *"No route is registered against it and no page reads it; v1.2 wires the actual
   'posture across every customer' surface on top of this once that page exists."* So #1568's
   question ("is there a cross-customer view") is answered **"the safe primitive exists; the
   surface does not yet"** — not fully open, not fully resolved. Nothing to file: the module's own
   header already states the plan and the version gate (v1.2) precisely.

3. **Carried forward from the #1495 pack, still genuinely open, nothing since has touched them:**
   #1527 (Policy Decisions `decision_state` carrying `expired`), #1507 (Risk Register review-clock
   split), #1511 (role-based acceptance authority), #1556/#1557 (SOPs/Runbooks unification), #1496
   (Change Control's dead buttons). See §4.

---

## 8. Findings filed at pack time

- **New sub-issue, filed under #1495** (the module's own Feature-tier parent — #1731 has no
  Feature-tier parent of its own beyond #1495 itself, so per the standing convention the finding
  parents to the Feature the contract-pack issue belongs to): the customer-facing
  `portal_security_plans` model (§1) and the MSP-facing assembled/versioned model (§2) are two
  live, independently-functioning, completely disconnected representations of "the Security Plan,"
  and no issue currently schedules reconciling them. See §0.3 / §7.1. Filed as **#2576** (`bug`,
  Feature-tier parent #1495, board status "AI Batter Up").

---

## 9. Provenance

Extracted 2026-09-03 against `agent/1731-q1391` (branch base `origin/main` at the time of
extraction). Sources cited inline by file:line: `artifacts/api-server/src/routes/portal-security-plan.ts`,
`artifacts/api-server/src/routes/msp-security-plan.ts`, `artifacts/api-server/src/lib/security-plan-assembly.ts`
(+ its test file), `security-plan-versioning.ts`, `security-plan-drift.ts` (+ test),
`security-plan-prose.ts`, `security-plan-draft.ts`, `security-plan-cross-tenant.ts` (+ test),
`lib/db/src/schema/msp.ts:6391-6679` and `:7441-7580`, `artifacts/api-server/src/routes/admin-active-directory.ts:636-674`,
`artifacts/api-server/src/lib/portal-customer-scope.ts`, `routes/index.ts:180,268,487,537`,
the four migration files under `lib/db/migrations/manual/` named above, and a direct query against
the local `DATABASE_URL` for real row counts (§1.1, §2.9). Confirmed via `git log` that
`portal-security-plan.ts` carries exactly one commit (`d3c3bfa3c`) since the #1495 pack, and that
`artifacts/msp-portal` was removed and replaced by `artifacts/portal` at `f40438cdc` — the reason
§0/§1/§5.1 differ so substantially from the #1495 pack's account of the customer-facing side.
Architecture deltas cited to GitHub issues #1495, #1561–#1568, #2085, #2145, under epic #1485 and
method issues #1577/#1578/#1642. Read-only pass: no product code, schema, or UI was changed.

**#2601 re-verification, 2026-09-03, same commit range (no relevant file changed since
`6b7c2f72c`):** re-read `msp-security-plan.ts` in full — every route path, line range, wire
interface (`WireSecurityPlanVersion`, `WireSecurityPlanDraft`), role gate
(`MSPOperator`/`MSPAdmin`), and error-response shape in §2/§5.2/§6 above matches the live file
exactly, byte-for-byte line numbers included. Re-queried the local `DATABASE_URL`:
`portal_security_plans`, `msp_security_plan_versions`, `msp_security_plan_drafts` still all report
0 rows, unchanged from §1.1/§2.9. Confirmed `artifacts/msp-console` does not exist in the repo
(#1689's own stated blocker, #1680). No new backend, schema, or UI change was made or needed —
this was a read-only confirmation, not a regeneration, because nothing to regenerate against had
changed.
