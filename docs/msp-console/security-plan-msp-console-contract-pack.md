# Security Plan — MSP Console contract extraction pack

**#4082**, generated per the #1642 pattern, under **#1689** (Feature: Security Plan (MSP
Console)), part of Epic #1485. Read-only extraction. Every field below is taken verbatim from
the route's own code and the Drizzle schema, cited to file:line, and cross-checked live against
local PostgreSQL. **Nothing here is authored or invented.** No product code, schema, or UI was
changed by this pass.

**Cites `docs/portal/security-plan-contract-pack.md` for the shared schema rather than
re-deriving it.** That pack (dated 2026-09-05, regenerated for #2949) already documents in full:
the seven-module assembly (`assembleSecurityPlan`), the scope-dimension model (`pillar` /
`framework` / `businessUnit`), the filter footprint (#1565), the authored-prose sections (#1566),
the fixed freeze → author → seal authoring sequence, and the drift model (#1567, data-only, never
reads `.prose`). None of that changed for this pass. **What has changed since that pack was
written is the signature model** — see §1 below, which is this pack's real content.

Backend route (live, mounted — `artifacts/api-server/src/routes/index.ts:300,596`):
`artifacts/api-server/src/routes/msp-security-plan.ts` — **576 lines, confirmed real**, 9 routes.
Supporting libs: `security-plan-versioning.ts` (256 lines, dual-signature functions added at
#3793), `security-plan-draft.ts`, `security-plan-assembly.ts`, `security-plan-drift.ts` (all
unchanged since the Portal pack — cited there, not reproduced here).

Schema: `lib/db/src/schema/msp.ts:7079-7118` (`mspSecurityPlanVersionsTable`, table
`msp_security_plan_versions`). Migrations: `lib/db/migrations/manual/2026-08-31-security-plan-versioning-1561.sql`
(original table), `2026-09-12-security-plan-dual-signature-3793.sql` (additive — the four new
signature columns, run by the agent itself per CLAUDE.md's Database section),
`2026-09-12-security-plan-drop-legacy-signature-columns-3793.sql` (destructive — drops the
original `signed`/`signed_by`/`signed_at` columns; per its own header this is Shane's to run
himself, and `simulator_migration_runs` confirms it has been: `ran_at 2026-09-14 11:39:14-04`).

**Confirmed complete, not half-built.** Read in full, not sampled: no `TODO`/`FIXME`/`XXX`/stub
markers in `msp-security-plan.ts` or `security-plan-versioning.ts`. Every route the file's own
header comment (`:1-60`) declares is actually implemented below, matching behavior.

---

## 0. The surface and its consumers

### 0.1 No MSP Console UI reads this route

**`artifacts/msp-console` has no Security Plan page or component.** Confirmed: no file matching
`*security-plan*` anywhere under `artifacts/msp-console` (the one `*security*` hit,
`console/modules/AccountSecurity.tsx` + `api/account-security-api.ts`, is the unrelated Account
Security module — MFA/session posture, not this Feature). `Design/MSP_Console/design_handoff_msp_console/github.md:324`
lists `msp-security-plan` on its "route files on main with no screen in this console yet" line —
the expected pre-Design state for a Feature parked at the Document step, not a gap this pack
invents. This is the same state the Portal pack's §0.1 describes for the portal side (no
`.dc.html` export in `Design/portal/` either) — **neither half of this Feature has a screen yet.**

No other surface (MCP server, admin-panel) reads or writes `msp_security_plan_versions` — grep-
confirmed no reference to `mspSecurityPlanVersionsTable` or `msp_security_plan_versions` outside
`lib/db/src/schema/msp.ts`, `security-plan-versioning.ts`, `msp-security-plan.ts`, and the portal
routes (`portal-security-plan.ts`, `portal-security-plan-document.ts`) covered by the Portal pack.

### 0.2 The endpoint map, current

| Endpoint | Method | Route file:line | Capability | Consumed by |
|---|---|---|---|---|
| `/api/msp/security-plan/:customerId/assembled` | GET | `:230-256` | `ladder.msp-operator` | Nothing yet |
| `/api/msp/security-plan/:customerId/drift` | GET | `:269-294` | `ladder.msp-operator` | Nothing yet |
| `/api/msp/security-plan/:customerId/versions` | GET | `:297-323` | `ladder.msp-operator` | Nothing yet |
| `/api/msp/security-plan/:customerId/versions/current` | GET | `:327-357` | `ladder.msp-operator` | Nothing yet |
| `/api/msp/security-plan/:customerId/draft/freeze` | POST | `:371-395` | `ladder.msp-operator` | Nothing yet |
| `/api/msp/security-plan/:customerId/draft` | GET | `:399-428` | `ladder.msp-operator` | Nothing yet |
| `/api/msp/security-plan/:customerId/draft/prose` | PATCH | `:438-462` | `ladder.msp-operator` | Nothing yet |
| `/api/msp/security-plan/:customerId/versions` | POST | `:470-529` | `ladder.msp-operator` | Nothing yet |
| `/api/msp/security-plan/:customerId/versions/:versionUid/sign` | PATCH | `:538-573` | **`ladder.msp-admin`** — a higher floor than every other route in this file | Nothing yet |

**Live-verified capability floors** (`psql` against `msp_feature_role_mapping` joined to
`msp_roles`, platform-level rows, `msp_id IS NULL`):

| Capability | Allow set |
|---|---|
| `ladder.msp-operator` | `{MSPOperator, MSPAdmin, PlatformAdmin}` |
| `ladder.msp-admin` | `{MSPAdmin, PlatformAdmin}` — **no `MSPOperator`** |

Every route except the final `PATCH .../sign` clears at the `MSPOperator` floor; the MSP's own
sign action requires `MSPAdmin` or above — an `MSPOperator` can assemble, draft, and seal a
version, but cannot sign it as the MSP's own party. This matches the route file's own inline
`requireCapability("ladder.msp-admin")` at `:541` and is a deliberately higher bar than the
`ladder.msp-operator` floor every other MSP-console pack in this directory documents as its
default gate.

`resolveOwnedTenant` (`:205-227`) is the shared scoping helper every route calls first:
`resolveMspIdStrict` → 403 `"MSP context required"` if the caller has no `mspId`; `:customerId`
resolved via `resolveTenantScope`; a tenant belonging to another MSP 404s identically to a
non-existent one (`:221-224`, deliberate no-leak). No `auditPrivilegedRead` call on the two
draft-mutation routes (`draft/freeze`, `draft/prose`) or either seal/sign route — only the four
read routes (`assembled`, `drift`, `versions`, `versions/current`, `draft` GET) call it, matching
the same "audit reads, not writes" convention the communications-push pack's §0 already documents
for this codebase's `auditPrivilegedRead` pattern generally.

---

## 1. What changed since the Portal pack: dual signature (#1689/#3793)

**This is the real content of this pack** — the Portal pack (`docs/portal/security-plan-contract-pack.md`,
extracted 2026-09-05) documents the MSP-side sign route as it existed *then*: a single
`signed`/`signedBy`/`signedAt` slot, an `MSPAdmin` entering a full client-collected signature
payload (`name`, `title`, `email`, `ipAddress`, `signatureHash`) in the request body (that pack's
§3.6, §5.4). **That shape no longer exists.** #1689 (2026-09-12, "settled that BOTH the customer
and the MSP must sign it — dual signature, not MSP-only or customer-only") and its implementing
commit #3793 replaced it. **The Portal pack's §2.6, §3.6, and §5.4 (MSP-side sign row) are now
stale on this specific point** — flagged here per this issue's own instruction, not corrected in
place, since read-only extraction packs document what they found, not silently patch a sibling
pack.

### 1.1 The real shape now

Two fully independent signature slots on the same row — `customerSignedBy`/`customerSignedAt`
(`msp.ts:7101-7102`) and `mspSignedBy`/`mspSignedAt` (`msp.ts:7103-7104`). Confirmed live via
`\d msp_security_plan_versions`: columns `customer_signed_by jsonb`, `customer_signed_at
timestamptz`, `msp_signed_by jsonb`, `msp_signed_at timestamptz` — and **the original
`signed`/`signed_by`/`signed_at` columns are confirmed absent** (the destructive drop migration
has run, §above).

- **The MSP's own signature** — `signSecurityPlanVersionAsMsp` (`security-plan-versioning.ts:234-255`)
  — is what this file's `PATCH .../versions/:versionUid/sign` route (`:538-573`) calls. Identity
  is derived **entirely server-side** from the authenticated session (`req.user.email`/`req.user.name`,
  `:548-550`) — there is **no request body accepted or read at all** on this route anymore. The
  guarded `UPDATE` (`:241-254`) only ever touches a row matching `mspId + customerId + versionUid
  + supersededAt IS NULL + mspSignedAt IS NULL`; any failure (not found, wrong tenant, superseded,
  already MSP-signed) collapses to a **single `409 CONFLICT`** (`msp-security-plan.ts:558-561`,
  `"Version not found, not current, or already signed by the MSP"`) — **never a 404**, unlike the
  customer-facing sign route below.
- **The customer's own signature** — `signSecurityPlanVersionAsCustomer` (`:205-226`) — is called
  by `portal-security-plan-document.ts` (§2949, unchanged route file, updated internals), which
  **does** do a scoped-read-first via `getSecurityPlanVersionByUid` before the guarded update, so
  a wrong-tenant `versionUid` 404s there rather than 409ing. The two sign paths are asymmetric in
  this one respect, confirmed by direct comparison of both route files — not a bug, just an
  un-unified error-shape choice between the two independently-authored sign endpoints.

**Neither party's signature blocks or is satisfied by the other's.** `isSecurityPlanVersionFullyExecuted`
(`security-plan-versioning.ts:125-127`) and the wire's own `fullyExecuted` field (both
`msp-security-plan.ts:147` and `portal-security-plan-document.ts:120`) require **both**
`customerSignedAt !== null && mspSignedAt !== null`. `getLastFullyExecutedSecurityPlanVersion`
(`:136-154`) — the anchor the drift view (`security-plan-drift.ts`, unchanged) and the portal's
own `assembledPlan` (`portal-security-plan.ts:120`, confirmed by grep — it now calls
`getLastFullyExecutedSecurityPlanVersion`, **not** the Portal pack's documented
`getLastSignedSecurityPlanVersion`, which no longer exists in the codebase) both read — requires
the **same both-signed condition**, ordered by `versionNumber DESC` so a later un-executed reseal
does not shadow an older, still-valid fully-executed one.

### 1.2 Backfill, on the destructive-drop path

The additive migration's backfill (`2026-09-12-security-plan-dual-signature-3793.sql:26-30`)
copies any historical single-slot signature into the **customer** slot (`customerSignedBy =
signed_by, customerSignedAt = signed_at WHERE signed = true`) — the file's own comment states the
reasoning: every historical write to the old slot was, in substance, a customer's signature
(either self-serve via the portal's `/sign` route, or MSP staff entering one collected
off-platform on the customer's behalf), so nothing is lost, but **no historical row is
retroactively treated as MSP-signed** — the MSP side of every pre-#3793 version starts unsigned
under the new model. Locally this backfill was a documented no-op (0 rows existed in
`msp_security_plan_versions` at authoring time, confirmed again below) — this only matters for a
future Staging/Replit replay against a database that has real historical rows, which is out of
this agent's reach per CLAUDE.md's production-change gate (the migration is written to behave
correctly there; it is not applied there by this pack).

---

## 2. Wire shape (MSP console side)

`WireSecurityPlanVersion` (`msp-security-plan.ts:96-124`, `toWireVersion` at `:130-150`):

```ts
{
  versionUid: string;
  customerId: number;
  tenantId: string;
  tenantName: string;
  versionNumber: number;
  content: unknown;
  scopeStatement: string;        // mirrored from content.footprint.scope.statement, never empty
  createdBy: unknown;            // MspAssessor — who sealed this version (msp.ts:6326)
  createdAt: string;
  customerSigned: boolean;       // customerSignedAt !== null
  customerSignedBy: unknown;     // ClientApprover (msp.ts:6332) | null
  customerSignedAt: string | null;
  mspSigned: boolean;            // mspSignedAt !== null
  mspSignedBy: unknown;          // MspAssessor | null
  mspSignedAt: string | null;
  fullyExecuted: boolean;        // customerSigned && mspSigned
  isCurrent: boolean;            // supersededAt === null
}
```

`WireSecurityPlanDraft` (`:154-163`, `toWireDraft` at `:165-173`) — the frozen-state-plus-prose
holding pen, unchanged since the Portal pack's own §3.8 description:

```ts
{ customerId: number; frozenContent: unknown; frozenAt: string; prose: unknown; updatedAt: string }
```

---

## 3. Real vocabularies

Unchanged from the Portal pack's §4 — reproduced here, not re-derived, since this pack's own
routes reference the same two:

| Vocabulary | Values | Where fixed |
|---|---|---|
| Security Plan scope dimension | `pillar`, `framework`, `businessUnit` | `SECURITY_PLAN_SCOPE_DIMENSIONS`, `msp.ts:6719` (per Portal pack §4; this route's own `scopeSchema`, `msp-security-plan.ts:177-185`, exposes only `pillar`/`framework` on the wire — `businessUnit` is derived from `tenants.business_unit`, not a caller-supplied dimension, matching the Portal pack's own note) |
| Security Plan prose section | `scope`, `methodology`, `exclusions`, `executiveSummary` | `SECURITY_PLAN_PROSE_SECTIONS`, `msp.ts:6808` |

No `pgEnum` exists on `msp_security_plan_versions` itself — confirmed by the live `\d` output
(§1.1): every column is `jsonb`, `text`, `integer`, `uuid`, or `timestamptz`, none DB-CHECK
constrained. Sign/seal state is entirely derived from nullability (`*_signed_at IS NULL` vs not),
never a stored status string.

---

## 4. Live data — queried against local PostgreSQL, 2026-09-14

```
select count(*) from msp_security_plan_versions;  -- 0
select count(*) from msp_security_plan_drafts;     -- 0
```

**Both tables are genuinely empty**, same honest state the Portal pack's §0.4 reported at its own
extraction — no version has ever been sealed or signed by either party on this database, under
either the old single-slot model or the new dual-slot one. `simulator_migration_runs` confirms
all six real migrations touching this module have run, most recently the destructive
legacy-column drop (`2026-09-14 11:39:14-04`, §above).

---

## 5. The forbidden list — declared, not merely absent

1. **The MSP's own sign route accepts no request body at all.** Identity (`name`/`upn`) and
   timestamp are derived entirely server-side from the authenticated session
   (`msp-security-plan.ts:548-556`) — there is no client-supplied signature payload to validate,
   because there is no client-supplied payload, period. This is a stronger guarantee than the
   Portal pack's now-stale §2.4 describes for the *customer's* route (which does accept a typed
   `fullName`/`title` but computes `ipAddress`/`signatureHash` server-side) — the MSP route has no
   analogous accept-list to enforce because the entire body is ignored.
2. **Neither signature can satisfy or block the other.** §1.1 — structurally enforced by two
   independent nullable columns and two independent guarded updates, not a single shared slot with
   a role check.
3. **No outcome filter on Security Plan scope, structurally** — unchanged from the Portal pack's
   §6.3, this route's own `scopeSchema` (`:177-185`) still exposes only `pillar`/`framework`.
4. **The authoring sequence remains fixed and unbypassable**: `POST /versions` 409s with no live
   fallback if no draft was frozen first (`:479-488`) — unchanged since #1566.
5. **No fabricated register/module data anywhere** — every assembled row is a real read from its
   own source table, per the Portal pack's §3 module table (unchanged, cited not reproduced).

---

## 6. Open, flagged — not resolved

1. **No MSP Console screen exists for this Feature** (§0.1) — the expected pre-Design state for
   #1689 parked at the Document step, not a gap this pack invents or is scoped to fix.
2. **The two sign routes' error-shape asymmetry** (§1.1: MSP-side collapses not-found/superseded/
   already-signed to a single 409; customer-side 404s a wrong-tenant id before ever reaching that
   guard) is real and current, but not something this read-only pass is positioned to judge as a
   bug versus an intentional difference in how much each route is willing to reveal about a bad
   id — flagged for Design/#1689 to see, not filed as a finding, since it does not leak the
   wrong-tenant *existence* signal in either case (the MSP route's blanket 409 is if anything
   more conservative, not less).
3. **Carried forward from the Portal pack's own §7, unchanged, not re-derived:** whether the two
   independent sign actions should ever be sequenced or notify the other party (nothing in this
   codebase currently does either), and the still-open items the Portal pack's §7.2 lists
   (#1568 cross-tenant posture view, etc.) — see that pack directly rather than reproducing its
   citation list here.

---

## 7. Findings filed at pack time

None. This pack found a real, accurately-flagged divergence between it and the Portal pack's own
prior text (§1) — that is documentation drift in a sibling contract pack, not a product bug, and
is corrected by this pack's own existence (the Portal pack will be regenerated the next time its
own module is touched, per this repo's standing "regenerate, don't hand-patch" convention). No
missing column, missing endpoint, or broken behavior was found in `msp-security-plan.ts` or
`security-plan-versioning.ts` themselves — both are complete for what they declare, with the one
open item (§6.2) explicitly not asserted as a bug.

---

## 8. Provenance

- Extracted against `origin/main` at commit `e73fd6b4b2271f63d9bba21b914b68356e707d05`, 2026-09-14.
- Route file: `artifacts/api-server/src/routes/msp-security-plan.ts` (576 lines), mounted
  `routes/index.ts:300,596`.
- Versioning lib: `artifacts/api-server/src/lib/security-plan-versioning.ts` (256 lines) —
  dual-signature functions (`signSecurityPlanVersionAsCustomer`, `signSecurityPlanVersionAsMsp`,
  `getLastFullyExecutedSecurityPlanVersion`, `isSecurityPlanVersionFullyExecuted`) added at #3793
  (commit `f8acc78c0`, "Security Plan dual signature: independent customer + MSP signer slots").
- Schema: `lib/db/src/schema/msp.ts:7079-7118` (table), `:6326-6338` (`MspAssessor`/`ClientApprover`,
  unchanged, shared with `msp_rbd_versions`/`msp_risk_decisions` per the Portal pack's own citation).
- Migrations: `2026-08-31-security-plan-versioning-1561.sql` (original table),
  `2026-09-12-security-plan-dual-signature-3793.sql` (additive, agent-run),
  `2026-09-12-security-plan-drop-legacy-signature-columns-3793.sql` (destructive, Shane-run,
  confirmed applied via `simulator_migration_runs`).
- Test coverage: `artifacts/api-server/src/lib/security-plan-dual-signature.live-db.test.ts` (one
  live-DB test: "lets the customer and the MSP each sign independently, and only reads
  fully-executed once both have"); `portal-security-plan-document.test.ts` (10 tests, customer-side).
  **No dedicated test file exists for `msp-security-plan.ts`'s own routes** — confirmed by
  directory listing (`artifacts/api-server/src/routes/*security-plan*`), a gap the dual-signature
  live-db test partially covers at the library level but not at the route/HTTP level. Not filed as
  a finding (a pre-existing test gap on an unchanged-shape set of routes, not something this
  session's own scope touched or broke), noted here for completeness.
- Live schema and row counts confirmed via direct `psql "$DATABASE_URL"` against local PostgreSQL
  18, not `shaneapp://executeSql` (this is local dev work, not Replit/Staging debugging).
- Architecture deltas cited to GitHub issues #1561–#1567, #1689, #3793, #2949, under Feature
  #1689 and Epic #1485. Read-only pass — no product code, schema, or UI changed by this pack.
