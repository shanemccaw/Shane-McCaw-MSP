# Security Plan — contract extraction pack for Claude Design

**#2949's own regeneration ask** ("Once built, this is real new capability the current contract
pack has no knowledge of — regenerate per the #1642 pattern"), replacing the pack shipped under
**#1731**/**#2601** on 2026-09-03. Method fixed by **#1577** (contract extraction pack, run per
module as step 3 of **#1578**), under **#1485** (EPIC: Portal New Design).

Read-only. Every field below is extracted verbatim from a route's own `Wire*`/exported interface
and the Drizzle schema, cited to file:line. **Nothing here is authored or invented.** No product
code, no schema changes, no UI, no `drizzle-kit push` — this pack documents #2949's own build
(already committed), it does not perform it.

**Why this pack replaces the #1731/#2601 one wholesale, not edited.** That pack's whole §0.3
finding was that `portal-security-plan.ts` still served the ORIGINAL legacy
`portal_security_plans` model while the real MSP-side assembled/versioned/signed pipeline sat
disconnected and page-less. Since that pack was written, **#2576 and #2829 already bridged and
then finished that bridge** — `portal-security-plan.ts` now serves `assembledPlan` (the last
**signed** `msp_security_plan_versions` row) and no longer reads the legacy table at all — and
**#2949 (this build) closed the other half**: a genuine customer-facing sign action now exists,
where before only an MSP-side proxy-sign did. So every one of the prior pack's headline findings
(§0.3's "two disconnected models," §6 rule 1's "no customer write path anywhere") is now
**resolved**, not merely re-described. This pack documents the surface as it now stands.

Backend routes: `artifacts/api-server/src/routes/portal-security-plan.ts` (customer-scoped,
GET-only, the plan of record), `artifacts/api-server/src/routes/portal-security-plan-document.ts`
(customer-scoped, **new at #2949** — the review + genuine customer sign surface), and
`artifacts/api-server/src/routes/msp-security-plan.ts` (MSP-scoped, the assembled/versioned/sealed
authoring surface, #1561–#1567)
Assembly/versioning/drift/prose/draft libs: `artifacts/api-server/src/lib/security-plan-assembly.ts`,
`security-plan-versioning.ts` (extended at #2949 with `getSecurityPlanVersionByUid`),
`security-plan-drift.ts`, `security-plan-prose.ts`, `security-plan-draft.ts`,
`security-plan-cross-tenant.ts` (#2145, no route yet — §7.2)
Schema: `lib/db/src/schema/msp.ts:6163-6170` (`ClientApprover`, shared with `msp_rbd_versions` and
`msp_risk_decisions`), `:6883-6915` (`msp_security_plan_versions`), `:6917+` (`msp_security_plan_drafts`)
— **no schema change at #2949**, see §2.6.
Seed/DDL migrations: `lib/db/migrations/manual/2026-08-21-portal-v2-security-plan.sql`,
`2026-08-31-security-plan-versioning-1561.sql`, `2026-08-31-security-plan-prose-1566.sql`,
`2026-09-01-tenants-business-unit-2085.sql`, `2026-09-04-drop-legacy-portal-security-plans.sql`
(destructive, not yet run locally — §0.2)
Customer-facing page: **none currently in the live portal build** — see §0.1.

---

## 0. The surfaces and their consumers

### 0.1 No Design export, no page — same honest state as before, now with a real backend to design against

`Design/portal/` has no Security Plan `.dc.html` export. `artifacts/portal/src/pages` has no
Security Plan page. This pack is exactly the input the CLAUDE.md-mandated order of work
("architect → build the endpoints → regenerate the contract pack → Design → wire") calls for at
this stage — #2949 is the "build the endpoints" step for the customer-facing half; this pack is
the "regenerate" step; Design has not run yet. The shell nav placeholder
(`artifacts/portal/src/components/shell/moduleNav.ts:52`,
`{ key: "security-plan", ..., builtPath: null }`) is unchanged.

### 0.2 The legacy `portal_security_plans` model — code path removed, tables not yet dropped

`portal-security-plan.ts` no longer references `portal_security_plans` or its three child tables
at all (#2576 bridged the route onto `assembledPlan`; #2829 removed the legacy read path and
`plan` field entirely — `portal-security-plan.ts:13-32`'s own header documents both). The four
`portal_security_plan*` tables (`portal_security_plans`, `portal_security_plan_sections`,
`portal_security_plan_rows`, `portal_security_plan_versions`) still physically exist in the local
DB, all reporting 0 rows (confirmed again at this pack's extraction — §0.4), because dropping them
is destructive DDL and per CLAUDE.md's Database section that is Shane's to run, not self-executed
in a build. `lib/db/migrations/manual/2026-09-04-drop-legacy-portal-security-plans.sql` is the
real, already-written file for that drop; nothing in this pack changes that state.

### 0.3 The endpoint map, current

| Endpoint | Method | Route file:line | Role | Consumed by | Orphaned? |
|---|---|---|---|---|---|
| `/api/portal/security-plan` | GET | `portal-security-plan.ts:129-156` | `CustomerUser` | **Nothing yet** — no page in `artifacts/portal` calls it | Yes, but deliberately — see §0.1 |
| `/api/portal/security-plan/versions` | GET | `portal-security-plan-document.ts` — new at #2949 | `CustomerUser` | Nothing yet | Yes, same reason |
| `/api/portal/security-plan/versions/current` | GET | `portal-security-plan-document.ts` — new at #2949 | `CustomerUser` | Nothing yet | Yes, same reason |
| `/api/portal/security-plan/versions/:versionUid/sign` | POST | `portal-security-plan-document.ts` — new at #2949 | `CustomerUser` | Nothing yet | Yes, same reason |
| `/api/msp/security-plan/:customerId/assembled` | GET | `msp-security-plan.ts:209-225` | `MSPOperator` | Nothing | Yes, deliberately (route's own header) |
| `/api/msp/security-plan/:customerId/drift` | GET | `msp-security-plan.ts:238-253` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/versions` | GET | `msp-security-plan.ts:256-271` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/versions/current` | GET | `msp-security-plan.ts:275-294` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/draft/freeze` | POST | `msp-security-plan.ts:308-332` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/draft` | GET | `msp-security-plan.ts:336-355` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/draft/prose` | PATCH | `msp-security-plan.ts:365-389` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/versions` | POST | `msp-security-plan.ts:397-456` | `MSPOperator` | Nothing | Yes, same reason |
| `/api/msp/security-plan/:customerId/versions/:versionUid/sign` | PATCH | `msp-security-plan.ts:468-508` | `MSPAdmin` | Nothing | Yes, same reason — see §2.6 for how this now coexists with the customer's own sign path |

All routers are genuinely mounted and live: `routes/index.ts:517` (`portalSecurityPlanRouter`),
`:518` (`portalSecurityPlanDocumentRouter`, new), `:572` (`mspSecurityPlanRouter`) — imported at
`:192`, `:193`, `:286` respectively.

### 0.4 Local DB state, honestly reported

Queried directly against the local `DATABASE_URL` at this pack's extraction:

| Table | Row count |
|---|---|
| `msp_security_plan_versions` | 0 |
| `msp_security_plan_drafts` | 0 |
| `portal_security_plans` / `_sections` / `_rows` / `_versions` (legacy, §0.2) | 0 (all four) |

`simulator_migration_runs` confirms three real migrations have run
(`2026-08-21-portal-v2-security-plan.sql`, `2026-08-31-security-plan-versioning-1561.sql`,
`2026-08-31-security-plan-prose-1566.sql`); the `2085` business-unit migration and the `2026-09-04`
drop migration are separate files not queried again here (§0.2 already covers the drop). No
version has ever been sealed for either seeded tenant on this database — every wire shape below is
verified against route/schema code, not against a live row.

---

## 1. Customer-facing wire contract — the plan of record (`portal-security-plan.ts`)

```ts
// portal-security-plan.ts:87-101 — verbatim
export interface WireAssembledSecurityPlan {
  readonly versionNumber: number;
  readonly content: unknown;
  readonly scopeStatement: string;
  readonly signedAt: string;
  readonly signedBy: unknown;
}
export interface WireSecurityPlanPayload {
  readonly assembledPlan: WireAssembledSecurityPlan | null;
}
```

`GET /api/portal/security-plan` (`:129-156`) resolves `resolveCustomerId(req)` →
`resolveTenantScope(customerId)` → `getLastSignedSecurityPlanVersion(mspId, customerId)`
(`security-plan-versioning.ts:121-138`). Only ever the **last SIGNED** version — an unsigned
current version is not served here (that is what §2 (below) exists for). `content` is the full
`SecurityPlanContent` snapshot, passed through untyped exactly as `msp-security-plan.ts`'s own
`WireSecurityPlanVersion.content` is. `signedBy` is `ClientApprover` (`msp.ts:6163-6170`),
likewise untyped here. Fails closed to `{ assembledPlan: null }` on any resolution error
(`portal-security-plan.ts:120-126`), never a 500 for "nothing signed yet."

---

## 2. Customer-facing wire contract — review + sign (`portal-security-plan-document.ts`, new at #2949)

The gap #2949 closed: `msp-security-plan.ts`'s own header called the customer-facing sign action
"a separate, not-yet-built concern," and the only existing sign path
(`PATCH /api/msp/.../versions/:versionUid/sign`, §3.6) required `MSPAdmin` — an MSP staff member
entering a signature collected off-platform, not the customer acting themselves. This module is
the real thing, modeled directly on `portal-rbd-document.ts` (the RBD module's own identical
problem, already solved) since `msp.ts:6682-6687`'s own comment already calls the Security Plan
version chain "the RBD pattern one level up."

### 2.1 Signature record shape — REUSED, no schema change

**Decision, made and built at #2949:** `msp_security_plan_versions` already had room for both
halves of the real workflow without adding a column. `createdBy`/`createdAt` records the MSP-side
SEAL (who finalized this version's content, already real, already built via `POST .../versions`).
`signed`/`signedBy`/`signedAt` records the CLIENT'S OWN sign-off — the exact `ClientApprover` shape
(`msp.ts:6163-6170`) `msp_rbd_versions` and `msp_risk_decisions` already use. `signSecurityPlanVersion`
(`security-plan-versioning.ts:187-209`) is reused completely unchanged: it only ever updates a row
matching `supersededAt IS NULL AND signed = false`, so this route and the pre-existing MSP-side
`PATCH .../sign` structurally cannot both succeed against the same version — whichever call lands
first wins the guarded update; the other gets `409`. No new table, no new column.

### 2.2 Wire shapes

```ts
// portal-security-plan-document.ts — verbatim
interface WireSecurityPlanVersionSummary {
  readonly versionUid: string;
  readonly versionNumber: number;
  readonly createdAt: string;
  readonly signed: boolean;
  readonly signedAt: string | null;
  readonly isCurrent: boolean;
}
interface WireSecurityPlanVersionDetail extends WireSecurityPlanVersionSummary {
  readonly content: unknown;
  readonly scopeStatement: string;
}
```

### 2.3 Endpoints

- **`GET /api/portal/security-plan/versions`** — `{ versions: WireSecurityPlanVersionSummary[] }`,
  scoped to `(mspId, customerId)`, newest first (`listSecurityPlanVersions`).
- **`GET /api/portal/security-plan/versions/current`** — `{ version: WireSecurityPlanVersionDetail }`
  for the current (`supersededAt IS NULL`) version, **signed or not**. `404 NOT_FOUND` ("No version
  has been sealed for this Security Plan yet") if nothing has ever been sealed. This is
  deliberately **not** restricted to signed-only the way §1's `assembledPlan` is: `assembledPlan`
  answers "what is the plan of record"; this answers "what is there for me to review and act on
  right now" — a customer must be able to see a sealed-but-unsigned version's actual content before
  deciding to sign it.
- **`POST /api/portal/security-plan/versions/:versionUid/sign`** — body
  `{ fullName: string (min 2, max 200), title?: string (max 200) }`. Returns
  `{ version: WireSecurityPlanVersionDetail }` (201) with `signed: true`.

### 2.4 What the sign route computes vs. accepts from the client

| Field | Source |
|---|---|
| `signedBy.name` | Client body `fullName`, typed at sign time — NOT the account's own display name, matching `portal-rbd-document.ts`'s reasoning that the signer may legitimately be signing in a role |
| `signedBy.title` | Client body `title`, optional, `""` if omitted |
| `signedBy.email` | **`req.user.email`** — the authenticated session's own real identity claim, never accepted from the body |
| `signedBy.signedAt` | Server clock at the moment of signing |
| `signedBy.ipAddress` | `req.ip`, server-derived — same known Replit-proxy limitation `portal-risk-register.ts`/`portal-rbd-document.ts` already document (not `trust proxy`-corrected yet, so it currently records the proxy hop, not the customer's real address) |
| `signedBy.signatureHash` | `sha256(customerId + versionUid + fullName + signedAt)`, server-computed |

A client-supplied `ipAddress`/`signatureHash` in the request body is accepted by neither the zod
schema (only `fullName`/`title` are in it) nor read anywhere in the handler — this is enforced
structurally, not merely by convention, and is covered by
`portal-security-plan-document.test.ts`'s "ignores a client-supplied ipAddress/signatureHash" case.

### 2.5 Scoping + guards

Same pair every other customer-facing Security Plan/RBD route uses:
`resolveCustomerId(req)` → `resolveTenantScope(customerId)` → `{ mspId, customerId }`. The sign
route does a **scoped read first** (`getSecurityPlanVersionByUid`, new at #2949,
`security-plan-versioning.ts`) before ever calling `signSecurityPlanVersion` — a `versionUid`
belonging to another tenant 404s exactly like one that does not exist, never leaking into a `409`
that would confirm the id is real elsewhere. Role floor is `CustomerUser` (matching
`portal-rbd-document.ts`/`portal-risk-register.ts`'s "this transfers real weight" reasoning), a
higher floor than the lower-stakes read-only customer routes.

### 2.6 Coexistence with the MSP-side `PATCH .../sign`

Both call the same `signSecurityPlanVersion` function against the same guarded predicate. Nothing
here removes or gates the MSP-side path — it remains the route for a signature MSP staff collected
off-platform and are recording on the customer's behalf (its own body still accepts
`ipAddress`/`signatureHash` from the caller, unlike this route, because that route is asserting
"this is what was told to us," not "the platform itself observed this act"). Whichever act happens
first wins; the loser's request 409s. No sequencing between the two routes is enforced beyond that
natural race guard — deciding whether the MSP-side proxy-sign path should eventually be
deprecated now that a genuine customer path exists is a product call for Design/#1495, not settled
by this pack.

### 2.7 Test coverage

`artifacts/api-server/src/routes/portal-security-plan-document.test.ts` (10 tests, registered in
`vitest.config.ts`'s explicit include list): server-derived audit trail (ipAddress/signatureHash
ignored from a poisoned body), typed-name floor (400 below 2 chars), tenant-scoped 404 (not 409,
for another tenant's version), 409 on a superseded version, 409 on an already-signed version, 409
on a lost signing race, and `GET .../versions/current` returning an unsigned version (unlike
`assembledPlan`).

---

## 3. MSP-side wire contract — the SETTLED architecture (unchanged by #2949)

Everything in this section is unchanged since the #1731/#2601 pack — #2949 added a customer-facing
consumer of the same version chain but did not touch `msp-security-plan.ts`, `security-plan-assembly.ts`,
`security-plan-drift.ts`, `security-plan-prose.ts`, or `security-plan-draft.ts`. Reproduced here
(not re-derived) so this pack is a complete single reference.

`assembleSecurityPlan(tenant, scope)` (`security-plan-assembly.ts:424-451`) reads seven source
tables:

```
Policy Decisions   (#1490) — policy_decisions            (security-plan-assembly.ts:122-149)
Risk Register      (#1487) — msp_risk_decisions           (:151-179)
Ownership / RACI    (#1491) — portal_ownership_rows        (:181-207)
SOPs / Runbooks     (#1493) — msp_sops                     (:209-240)
Remediation         (#1489) — remediation_tracker_steps    (:242-267)
Change Control      (#1486) — msp_change_requests          (:269-296)
Microsoft Changes   (#1494) — m365_change_interpretations  (:298-324)
```

```ts
// msp.ts:6777-6785 — verbatim
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

### 3.1 Scope dimensions (#1563, #2085) — real, all three backed

```ts
// msp.ts:6719 — verbatim
export const SECURITY_PLAN_SCOPE_DIMENSIONS = ["pillar", "framework", "businessUnit"] as const;
```

`pillar`/`framework` vary per row (Policy Decisions, Risk Register); `businessUnit` is
`tenants.business_unit`, one value per tenant (all-or-nothing within a single plan). No outcome
filter exists anywhere — `scopeSchema` (`msp-security-plan.ts:156-164`) accepts only the three
dimension keys plus `statement`; any other query key is silently ignored.

### 3.2 Filter footprint (#1565) — always computed, snapshotted at seal

```ts
// msp.ts:6750-6758 — verbatim
export interface SecurityPlanFilterFootprint {
  readonly scope: SecurityPlanScope & { readonly statement: string };
  readonly isHonestView: boolean;
  readonly excludedByModule: readonly SecurityPlanModuleExclusion[];
  readonly totalExcluded: number;
  readonly computedAt: string;
}
```

`scope.statement` is never blank on anything that reaches a seal — synthesized for the honest-view
case, hard-required (400) for a scoped seal with no human statement.

### 3.3 Authored prose (#1566)

```ts
// msp.ts:6808-6821 — verbatim
export const SECURITY_PLAN_PROSE_SECTIONS = ["scope", "methodology", "exclusions", "executiveSummary"] as const;
export interface SecurityPlanProseSectionContent {
  readonly text: string;
  readonly editedInThisVersion: boolean;
}
export type SecurityPlanProse = Record<SecurityPlanProseSection, SecurityPlanProseSectionContent>;
```

Carried forward by default from the plan's last version; only sections actually touched are marked
`editedInThisVersion`, diffed against a baseline fixed at draft creation.

### 3.4 The fixed authoring sequence

`freeze → author prose against the frozen state → seal`, enforced structurally:
`POST /draft/freeze` (`msp-security-plan.ts:308-332`) → `GET /draft`/`PATCH /draft/prose`
(`:336-389`) → `POST /versions` (`:397-456`, seals, does not re-assemble live, `409` with no
frozen draft).

### 3.5 Versioning/sealing (#1561, #1562 — "the RBD pattern one level up")

```ts
// msp.ts:6883-6911 — verbatim (comments trimmed)
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
transaction. `signSecurityPlanVersion` (`:187-209`) only updates a row matching
current-and-unsigned. `getLastSignedSecurityPlanVersion` (`:121-138`) is what §1's `assembledPlan`
reads. `getSecurityPlanVersionByUid` (new at #2949, `:144-162`) is a scoped lookup by uid — added
specifically so §2's sign route can 404 a wrong-tenant id before ever touching the guarded update.

### 3.6 MSP-side signing (#1564) — coexists with §2's customer path

`PATCH /versions/:versionUid/sign` requires `MSPAdmin` and a full signature payload in the body
(`name`, `title`, `email`, `ipAddress`, `signatureHash`, `msp-security-plan.ts:458-464`) — MSP staff
recording a signature collected off-platform. See §2.6 for how this now coexists, unmodified, with
the customer's own sign action added at #2949.

### 3.7 Drift (#1562, #1567)

`computeSecurityPlanDrift` (`security-plan-drift.ts:42-123`) diffs the live (always
honest/unscoped) assembled document against the last **signed** snapshot. Never reads `.prose`.

### 3.8 Draft holding pen

One draft row per `(mspId, customerId)`, enforced by a unique index — the frozen-state holding pen
between freeze and seal.

---

## 4. Real enum unions

| Vocabulary | Values | Where fixed |
|---|---|---|
| Security Plan scope dimension | `pillar`, `framework`, `businessUnit` | `SECURITY_PLAN_SCOPE_DIMENSIONS`, `msp.ts:6719` |
| Security Plan prose section | `scope`, `methodology`, `exclusions`, `executiveSummary` | `SECURITY_PLAN_PROSE_SECTIONS`, `msp.ts:6808` |
| Assembled item `state`/`detail` per module | free text, each module's own status/state column | not a single fixed vocabulary — honestly heterogeneous |

No `pgEnum` exists anywhere in this module's own tables. The old §3 "Portal (customer-side)
requirement row state (`met`/`partial`/`gap`)" entry from the #1731 pack is **removed here** — it
belonged to the now-fully-retired legacy `portal_security_plans` model (§0.2); `assembledPlan`
never used that vocabulary.

---

## 5. Honest-empty contract & the tri-state

### 5.1 `GET /api/portal/security-plan` (plan of record)

| State | Wire behaviour |
|---|---|
| Nothing ever signed | `200 { assembledPlan: null }` |
| A version is signed | `200 { assembledPlan: {...} }`, fully populated |
| Resolution error | `200 { assembledPlan: null }` — fails closed, never a 500 for "nothing signed yet" |

### 5.2 `GET /api/portal/security-plan/versions/current` (review before sign, new at #2949)

| State | Wire behaviour |
|---|---|
| Nothing ever sealed | `404 { error: { code: NOT_FOUND, message: "No version has been sealed for this Security Plan yet" } }` |
| Current version exists, unsigned | `200 { version: {..., signed: false, signedAt: null} }` |
| Current version exists, signed | `200 { version: {..., signed: true, ...} }` — same shape either way, `signed` is the only discriminator |

### 5.3 `POST /api/portal/security-plan/versions/:versionUid/sign` (new at #2949)

| State | Wire behaviour |
|---|---|
| Invalid `fullName` (missing/too short) | `400 VALIDATION` |
| Version doesn't exist for this tenant | `404 NOT_FOUND` — never a `409`, never distinguishes "doesn't exist" from "exists for someone else" |
| Version superseded | `409 CONFLICT` |
| Version already signed | `409 CONFLICT` |
| Signing race lost (concurrent request won) | `409 CONFLICT` |
| Success | `201 { version: {..., signed: true} }` |

### 5.4 MSP-side (unchanged)

| State | Wire behaviour |
|---|---|
| Tenant not owned by caller's MSP, or doesn't exist | `404` — identical for both cases |
| No MSP context | `403` |
| `/versions/current` with nothing sealed | `404` |
| `POST /versions` with no frozen draft | `409` |
| `POST /versions` scoped with no statement | `400` |
| MSP-side sign of a missing/superseded/signed version | `409` |

---

## 6. The forbidden list — declared, not merely absent

1. **No customer EDIT path exists.** #2949 added a genuine customer SIGN action, not a
   customer-editable plan — `portal-security-plan.ts` remains GET-only for the plan of record, and
   `portal-security-plan-document.ts` accepts only a typed name/title to attach a signature, never
   a write to `content`/`prose`/scope. The MSP-side authoring surface remains entirely
   `MSPOperator`/`MSPAdmin`-gated. (This replaces the #1731 pack's stronger, now-false claim "no
   customer write path anywhere.")
2. **The customer-facing sign route cannot choose its own audit trail.** `ipAddress`/`signatureHash`
   are computed server-side and are not present in the accepted request schema at all — see §2.4.
3. **No outcome filter on Security Plan scope, structurally** — §3.1.
4. **No server-side re-derivation of a header verdict/percentage/gap badge.**
5. **Drift never reads `.prose`** — §3.7.
6. **A scoped seal can never reach the database without a real, human-authored statement.**
7. **No fabricated register/module data anywhere.** Every assembled row is a real read from its
   own source table, cited per module in §3's table.

---

## 7. Open, flagged — not resolved

1. **The legacy `portal_security_plan*` tables (4, all 0 rows) are not yet dropped** — §0.2. The
   migration file exists (`2026-09-04-drop-legacy-portal-security-plans.sql`) but is destructive
   DDL, so it is Shane's to run per CLAUDE.md's Database section, not this pack's to execute.
2. **Whether the MSP-side proxy-sign path (§3.6) should eventually be deprecated now that a real
   customer sign path exists is an open product call, not settled here** — §2.6. Nothing currently
   schedules that decision; flagged so Design/#1495 sees it rather than assuming one path was meant
   to replace the other.
3. **Carried forward, still genuinely open, nothing since has touched them:** #1527 (Policy
   Decisions `decision_state` carrying `expired`), #1507 (Risk Register review-clock split), #1511
   (role-based acceptance authority), #1556/#1557 (SOPs/Runbooks unification), #1496 (Change
   Control's dead buttons). See the #1731 pack's §4 for the original per-module citation — none of
   these block anything §3 currently reads, and re-deriving that table added no new information at
   this pack's extraction, so it is referenced rather than reproduced.
4. **#1568 — cross-customer MSP posture view.** Unchanged since the #1731 pack:
   `security-plan-cross-tenant.ts` is a real, tested, fail-closed read primitive with no route
   registered against it yet; its own header states the plan (v1.2) precisely.

---

## 8. Findings filed at pack time

None new. The #1731 pack's own finding (#2576, the two-model split) is now resolved in code, not
merely superseded by a newer finding — see the header's "Why this pack replaces... wholesale."
#2949's own build (this pack documents) filed one unrelated finding discovered during its own
verification pass, **#2950** (a pre-existing failing test / bad `services.is_public` catalog data
for the Free Scan product) — parented under #1096 (Application Core), not this module, since it
has nothing to do with the Security Plan.

---

## 9. Provenance

Regenerated 2026-09-05 against `agent/2949-q1703` (branch base `origin/main` at the time of
extraction), immediately after #2949's own commit landed. Sources cited inline by file:line:
`artifacts/api-server/src/routes/portal-security-plan.ts`,
`artifacts/api-server/src/routes/portal-security-plan-document.ts` (new),
`artifacts/api-server/src/routes/msp-security-plan.ts`,
`artifacts/api-server/src/lib/security-plan-versioning.ts` (extended),
`artifacts/api-server/src/lib/security-plan-assembly.ts` (+ test),
`security-plan-drift.ts` (+ test), `security-plan-prose.ts`, `security-plan-draft.ts`,
`security-plan-cross-tenant.ts` (+ test), `lib/db/src/schema/msp.ts:6163-6170,6682-6915`,
`routes/index.ts:192-193,286,517-518,572`, the migration files named in the header, and direct
queries against the local `DATABASE_URL` for real row counts (§0.4). Architecture deltas cited to
GitHub issues #1495, #1561–#1568, #2085, #2145, #2576, #2829, #2949, under epic #1485 and method
issues #1577/#1578/#1642. Read-only pass over everything except the #2949 commit itself, which
this pack documents rather than performs.
