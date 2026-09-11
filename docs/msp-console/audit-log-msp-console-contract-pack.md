# Audit Log — MSP Console contract extraction pack

**#3370**, under the reset **#1571** (EPIC: Portal Admin) and its fixed 4-step order:
API build-out → **Document (this pack)** → Design → Implement & wire. `artifacts/msp-console`
now exists as bare scaffolding (`package.json`, `App.tsx`, `pages/index.tsx`, `pages/not-found.tsx`
— 11 files total, no audit page yet), so the Design/wire steps ahead of this one have nothing to
build against yet; the backend this pack documents is real, complete, and already mounted.

Read-only. Every field below is extracted verbatim from the route's own code and the Drizzle
schema, cited to file:line, and cross-checked live against local PostgreSQL. **Nothing here is
authored or invented.** No product code, schema, or UI was changed by this pass — one out-of-scope
finding hit while researching consumers (§6) is filed separately, not fixed here.

Backend route (live, mounted — `artifacts/api-server/src/routes/index.ts:487`):
`artifacts/api-server/src/routes/msp-audit-log.ts` — **146 lines, 1 route**, `GET /api/msp/audit`.

**Confirmed complete, not half-built.** Read in full, not sampled: no `TODO`/`FIXME`/stub markers,
no dead branches, no half-wired filter. Every query param the route declares in its own header
comment (`page, limit, search, actionType, mspId, outcome, from, to`) is actually implemented
(§1.2). The one thing genuinely absent — a UI to call it from — is a Design/wire-step gap (§0),
not a backend gap this pack's own module is responsible for.

Schema: `lib/db/src/schema/msp.ts:929-954` (`mspAuditLogsTable`, table `msp_audit_logs`). Verified
live against local PostgreSQL (`psql "$DATABASE_URL" -c '\d msp_audit_logs'`) — every column below
is confirmed present on the running schema, column-for-column identical to the Drizzle source,
including the three real indexes (`msp_id`, `actor_user_id`, `occurred_at`) and the one FK
(`msp_id → msps.id ON DELETE SET NULL`). **No DB CHECK constraint exists on `outcome`** despite
Drizzle declaring it `{ enum: [...] }` — confirmed by the live `\d` output listing only the PK,
one unique constraint (`event_id`), three indexes, and the one FK; `{enum: [...]}` in Drizzle's
pg-core is a TypeScript-only annotation here, not a generated CHECK (contrast `risk_instances.status`
in the RBD pack, which *is* DB-CHECK-enforced). Same is true of every other narrowed-looking column
on this table — `actor_role`, `entity_type`, `action_type` are all plain `text`, unconstrained at
the database.

---

## 0. The surface and its consumers

| Endpoint | Method | Gate | Consumer today | Status |
|---|---|---|---|---|
| `/api/msp/audit` | GET | `requireRole("MSPAdmin")` (`:22`) | **MCP server** `get_audit_logs` tool, `source="msp"` (default) — `artifacts/mcp-server/src/tools/get-audit-logs.ts:55` | live, cross-surface reuse, real HTTP round-trip via `apiFetch` |

**No MSP Console UI reads this route yet.** `artifacts/msp-console` is scaffolding only (§ above)
— no audit page exists to wire it to. This is the expected pre-Design state for a Feature at the
Document step, not a gap this pack invents; the same "orphaned but explicitly staged" pattern the
RBD pack's §0.1 documents for its own unconsumed routes.

`requireRole("MSPAdmin")` is a **floor**, not an exact match (`requireAuth.ts:115-123`'s
`ROLE_ORDER`, ascending: `Assessment, Free, CustomerUser, ServiceAccount, MSPOperator, MSPAdmin,
PlatformAdmin`) — both `MSPAdmin` and `PlatformAdmin` clear it; `MSPOperator` and below do not.
Legacy `role === "admin"` users are normalized to `PlatformAdmin` (`requireAuth.ts:145`,
`effectiveMspRole`) before the floor check runs, so an "admin"-role account reaches this route the
same as a real `PlatformAdmin`.

---

## 1. Wire contract — `GET /api/msp/audit`

### 1.1 Scoping (`:30-42`)

| Caller | Scope applied |
|---|---|
| `PlatformAdmin` (`role === "admin"` or `mspRole === "PlatformAdmin"`) | Unscoped by default — sees every MSP's rows. If `?mspId=` is supplied and parses as a number, narrows to that one MSP (`:37-42`) — no ownership check needed since PlatformAdmin is cross-MSP by design. |
| `MSPAdmin` | Hard-scoped to `mspAuditLogsTable.mspId = user.mspId` (`:36`) — the request cannot override this; `?mspId=` in the query string is silently ignored for a non-PlatformAdmin caller (the `else if` at `:37` only runs for the PlatformAdmin branch). |
| `MSPAdmin` with **no** `mspId` on their own user row | `res.json({ entries: [], total: 0, page, limit })` and returns immediately (`:32-35`) — a genuine 200 empty result, not a 403 or 500. This is a real, honest edge case: an MSPAdmin account somehow lacking `mspId` sees nothing rather than erroring or leaking cross-MSP rows. |

### 1.2 Filters (`:44-76`) — every one from the route's own header comment, all real

| Query param | Behavior | Implementation |
|---|---|---|
| `actionType` | Substring match, case-insensitive | `ilike(actionType, '%<val>%')` (`:44-47`) |
| `outcome` | Exact match, **only** if the value is literally one of `success`/`failure`/`partial` — anything else is silently dropped (no error, filter just doesn't apply) | `:49-51` |
| `from` | `occurredAt >= <parsed Date>` — invalid date string is silently dropped, no error | `:53-56` |
| `to` | `occurredAt <= <parsed Date>`, **end-of-day**: the route mutates the parsed date to `23:59:59.999` local-clock-relative before comparing (`:59-63`) — so `?to=2026-09-09` includes the whole day of the 9th, not just midnight | `:58-64` |
| `search` | One `OR` across four columns, each `ilike '%<val>%'`: `actionType`, `entityType`, `entityLabel`, `actorRole` (`:68-75`) — **does not search `entityId`, `metadata`, or the actor's real name/email** (those aren't columns on this table at all for the latter two — see §1.4) | `:66-76` |
| `page` / `limit` | `page` floors at 1; `limit` clamped `[1, 100]`, default `30` (`:24-25`) — no zod schema on this route at all, unlike every write-side sibling in this module family; validation is hand-rolled via the local `p()` helper and `parseInt` | `:18-26` |

**Update (Git #3671):** a `customerId` filter param now exists — exact match on
`mspAuditLogsTable.customerId`, AND'd with whatever MSP-scoping §1.1 already applies (so an
`MSPAdmin` supplying `?customerId=` still only ever sees their own MSP's rows narrowed further to
that customer; `PlatformAdmin` can combine it with `?mspId=`). This closed the gap the rest of this
section originally documented — the paragraph below is left for historical record of the prior
state this pack captured before #3671.

~~No query param does cross-tenant/cross-MSP filtering beyond what §1.1 already fixed — there is no
`customerId` filter param today even though the table carries a `customerId` column (§1.4);
narrowing to one customer's rows would currently require client-side filtering of the page.~~

### 1.3 Query shape (`:78-102`)

Two real queries, not one: a `count()` for `total` and a separate `select` for the page of rows,
both built from the same `where` conditions array so they can never disagree on scope
(`:78-102`). Ordered `desc(occurredAt)` — newest first, no secondary tiebreaker (two rows with an
identical `occurredAt` timestamp have no guaranteed relative order; `id` would be the natural
tiebreaker but isn't applied).

### 1.4 Response shape — real field aliasing, not a passthrough (`:104-143`)

The route does **not** return the raw row. It re-shapes every entry with UI-friendly aliases
(route's own comment, `:115-117`) and does a real second query to batch-resolve actor identity:

```ts
// msp-audit-log.ts:118-141 — the actual shape, paraphrased field-by-field below
{
  id, eventId, actorEmail, actorName, actorRole, action, resource, detail,
  metadata, outcome, createdAt
}
```

| Wire field | Source | Notes |
|---|---|---|
| `id` | `mspAuditLogsTable.id` | verbatim |
| `eventId` | `.eventId` | verbatim — the UUID `recordAuditEvent`/`auditedToolCall` (§2) use to finalize a row later |
| `actorEmail` | `usersTable.email` for `actorUserId`, joined via a **second, batched query** (`:104-113`) | **Falls back to `e.actorRole` when no user row resolves** (`:128`, `actor?.email ?? e.actorRole ?? null`) — a real, live quirk: for a row with no `actorUserId` (e.g. a service-driven or system event) or a stale/deleted user id, `actorEmail` on the wire can literally be a role string like `"MSPAdmin"`, not an email address at all. Nothing on the wire distinguishes "genuine email" from "role fallback" — a consuming UI that assumes `actorEmail` always looks like an email will render a role name in that slot for those rows. |
| `actorName` | `usersTable.name`, same joined lookup | `null` whenever the fallback above applies (no user row → no name either) |
| `actorRole` | `.actorRole` (raw column) | independent of the fallback above — always the stored value, even when it's also being reused as `actorEmail` |
| `action` | `.actionType` | renamed on the wire; see §2 for the real vocabulary of values that land here |
| `resource` | `.entityLabel ?? .entityType ?? null` | a 3-way collapse — a row with an `entityLabel` never shows its `entityType` here even if both are set, and a row with neither shows `null` |
| `detail` | derived from `.metadata`: `null` if absent, the string itself if `metadata` is already a string, else `JSON.stringify(metadata)` (`:120-124`) | a short-string rendering of the same data `metadata` (below) carries structured |
| `metadata` | `.metadata ?? null` | **verbatim raw JSONB**, added by a later commit (`a29e3a09c`, "Added AuditEntry metadata and details") per the code's own `// NEW: raw metadata for frontend dialog` comment (`:134`) — both `detail` (string) and `metadata` (object) are sent together, not one or the other |
| `outcome` | `.outcome` | verbatim, real enum values below (§3) |
| `createdAt` | `.occurredAt`, ISO-stringified (`:136-139`) | **renamed** — the DB column is `occurred_at`, the wire field is `createdAt`; a consumer expecting the two to be synonyms for "row insert time" should know this is actually "when the audited event happened," which for the write-ahead MCP pattern (§2.2) is set at attempt time, not at finalize time |

**Columns on `msp_audit_logs` that never reach the wire at all:** `actorServiceAccountId`,
`customerId`, `entityId`, `correlationId`, `ipAddress`, `userAgent`. All six are real, populated
columns (§4 shows real writers for most of them) that this GET route reads nowhere — not filtered
on, not selected, not aliased. A consumer wanting "which customer was this action against" or "what
IP did this come from" cannot get it from this endpoint today; that would require either a new
field on this wire shape or a raw DB read, neither of which exists.

Response envelope: `{ entries: <enriched[]>, total, page, limit }` (`:143`) — no `hasMore`/
`totalPages` convenience field, a caller computes pagination state itself from `total`/`limit`.

---

## 2. Cross-surface writers — the real "who writes here"

Unlike the RBD module (one file's worth of routes), `msp_audit_logs` has **no shared insert
helper**. Every writer either calls `db.insert(mspAuditLogsTable).values(...)` inline, or through a
**locally-scoped, per-file** `writeAuditLog()`/`writeAuthAuditLog()` closure that is copy-pasted in
shape, not imported, across files — confirmed independently defined in `msp-settings.ts:153-166`,
`msp-admin-settings.ts:59-73`, `msp-sales-bundles.ts:102-112`, `msp-plan-management.ts:42-52`,
`msp-plan-self-service.ts:53-61`, and `auth.ts:124-152` (`writeAuthAuditLog`, the one variant with a
`try/catch` swallowing insert failures — "Audit log is non-fatal", `:149-151`). This route's own
read side has no visibility into any of this; it is documented here because a caller of `GET
/api/msp/audit` needs to know the real shape of what it's reading, not just this file's own code.

### 2.1 Direct `db.insert(mspAuditLogsTable)` call sites (real, not exhaustive prose — every
`actionType` string these files actually write)

| File | `actionType` values written | Typical `entityType` |
|---|---|---|
| `auth.ts` (`writeAuthAuditLog`, `:137-148`) | `AUTH_LOGIN`, `AUTH_LOGOUT`, `AUTH_ACCOUNT_SETUP`, `IMPERSONATION_SESSION_STARTED` | none set — this helper takes no `entityType` param at all (`:127-134`), so every row it writes has `entityType = null` |
| `msp-portal.ts` | `msp.offboarding.request`, `msp.offboarding.export`, `msp.offboarding.archive` (all documented in the existing offboarding pack — see §5), `customer.create`, `customer.update` | `msp`, `customer` |
| `msp-settings.ts` (local `writeAuditLog`) | `msp.profile.update`, `connector.mode.update`, `connector.exchange.configure`, `connector.exchange.remove`, `service_account.create`, `service_account.revoke`, `user.customer_scopes.update`, `user.role.update`, `user.approve_purchases.update`, `user.remove`, `user.password.reset_email_sent`, `user.password.temp_set`, `user.mfa.reset`, `user.mfa.enforcement_toggle`, `user.activate`/`user.suspend`, `user.sessions.revoke_all`, `email_template.upsert`, `email_template.delete`, `agreement_template.update`, `mailbox_connector.connect.initiated`, `mailbox_connector.disconnect`, `msp.automated_customer_emails.update`, `msp.write_back.update`, `session.revoke`, `invite.create`, `invite.revoke` | `msp`, `msp_connector_config`, `msp_service_account`, `msp_user`, `msp_email_template`, `msp_mailbox_connector`, `session`, `msp_invite` — the largest single vocabulary of any writer file (documented in full in `docs/msp-console/msp-settings-contract-pack.md`) |
| `msp-admin-settings.ts` (local `writeAuditLog`) | `msp.create`, `msp.update`, `msp.suspend`, `msp.reactivate`, `msp.overrides.upsert`, `msp.overrides.delete`, `plan_capability.upsert`, `plan_capability.delete`, `session.${type}.revoke` (templated) | `msp`, `msp_override`, `msp_plan_capability`, `session` |
| `msp-custom-domain.ts` | `msp.custom_domain.register`, `msp.custom_domain.verify`, `msp.custom_domain.remove` | (not read from this file per this pass — inline inserts, no local helper) |
| `msp-plan-management.ts` (local `writeAuditLog`) | `plan.new_price.create`, `plan.subscriber.migrate` | `service`, `msp_subscription` |
| `msp-plan-self-service.ts` (local `writeAuditLog`) | `plan.self_service_change.scheduled`, `plan.self_service_change.canceled` | `msp_subscription` |
| `msp-sales-bundles.ts` (local `writeAuditLog`) | `bundle.created`, `bundle.updated`, `bundle.deleted`, `bundle.assigned`, `bundle.assignment.revoked` | `msp_sales_bundle`, `msp_sales_bundle_assignment` |
| `msp-staff.ts` | `IMPERSONATION_TOKEN_ISSUED` | (none set) |
| `admin-active-directory.ts` | `user.role.update`, `user.assignment.update`, `user.entitlement.{grant,revoke,clear}` (templated), `active_directory.ou_assignment.{set,move,clear}`, `admin_forced_password_reset`, `IMPERSONATION_TOKEN_ISSUED`, `admin_impersonation_started`, `user.hard_delete{,.refused_env}`, `customer.hard_delete{,.refused_env,.consent_revoked,.phase_a_pre_state}` | `user`, `msp_user`, `active_directory_ou`, `customer` |
| `portal-customer-engines.ts` | `retainer_cancelled`, `customer.offboarding.deactivate` | (not read from this file per this pass) |
| `portal-404-events.ts` | `portal.route.not_found` (`:55`) | `route` — the **only** writer reachable by a plain `requireAuth` (any authenticated portal user, not `requireRole("MSPAdmin")`); everything else in this table is written by MSP-staff or PlatformAdmin-gated routes, or by the MCP server acting as an operator (§2.2). This route's own header comment (`:6-8`) states its purpose plainly: "so dead links surface in the Audit Log UI" |

`entityLabel` (when set) is consistently a human-readable name, not an id — `msp.name`
(`msp-portal.ts:669`), `customer!.name` (`:1038`), `target.name ?? target.email`
(`admin-active-directory.ts:1573` and others), `tenant.name` (`:2110`). This matches `resource`
(§1.4)'s own preference for `entityLabel` over `entityType`.

### 2.2 The MCP server writes directly to Postgres, not through this API

`artifacts/mcp-server/src/audit.ts` (full header at `:8-44`) is a **second, independent writer
path** — not a caller of any api-server route, a raw `pg.Pool` connection straight to
`msp_audit_logs` (`recordAuditEvent`, `:140-179`). Two properties worth stating plainly for anyone
consuming this table's data going forward:

- **Every MCP tool call gets an audit row**, `actionType = "mcp.tool.<toolName>"`, `entityType`
  defaulting to `"mcp_tool"` unless the tool's own spec overrides it (`:159`, `ToolAuditSpec.entityType`).
  `entityLabel` is always the tool's own name (`:221`). This is the entire `mcp.tool.*` slice of
  §3's live distinct-value list.
- **Write tools are write-ahead and fail-closed** (module header, `:18-33`): before a mutating
  tool's handler runs, an `outcome: "partial"` attempt row is durably inserted; the tool is refused
  entirely (throws `AuditUnavailableError`) if that insert fails. The same row is later finalized
  by `event_id` to `success`/`failure`. **A row genuinely stuck at `outcome = "partial"` on read
  means the MCP server process died mid-call** — an honest, load-bearing signal this GET route
  exposes (via `?outcome=partial`) but does not itself explain; a UI built against this route
  should treat a `partial` row as "attempted, completion unknown," not as a bug in the reader.
  Read tools get one best-effort row after the call and are never blocked by an audit failure
  (`:35-36`).

---

## 3. Real vocabularies — and where each is (not) enforced

None of `outcome`, `actionType`, `entityType`, or `actorRole` has a database CHECK constraint
(confirmed live, § above) — every one is plain `text`. `outcome` is the only column with even a
DB-level default (`'success'`, confirmed live) and the only one enforced anywhere close to the
database, and only weakly: `msp-audit-log.ts:49` itself validates an incoming `?outcome=` filter
against a hardcoded `["success", "failure", "partial"]` array, and the MCP tool's zod schema
(`get-audit-logs.ts:21`) mirrors the same three values — but nothing stops a future writer from
inserting a fourth string into the column itself.

`actionType` has **no enum anywhere** — every value in §2's tables is a bare string literal chosen
independently per call site, with no shared constant or naming-convention enforcement. Three
distinct casing/separator conventions coexist live today: `SCREAMING_SNAKE` (`AUTH_LOGIN`,
`IMPERSONATION_SESSION_STARTED`), `dot.namespaced` (`msp.profile.update`, `mcp.tool.whoami`), and a
few bare single words (`retainer_cancelled`). A future consumer building a filter dropdown or
grouping UI against `actionType` should expect to normalize across all three, not assume one
convention.

`entityType` is similarly free text — real live values include `msp`, `customer`, `user`,
`msp_user`, `route`, `checkout_session`, `mcp_tool`, `audit_check`, and the empty/`null` case
(§4) — no canonical list is declared anywhere in the codebase for this column.

---

## 4. Live data — queried against local PostgreSQL, 2026-09-10

```sql
SELECT count(*) FROM msp_audit_logs;                                    -- 522
SELECT outcome, count(*) FROM msp_audit_logs GROUP BY outcome;          -- success 508, failure 14
SELECT action_type, count(*) FROM msp_audit_logs GROUP BY action_type;  -- see below
SELECT entity_type, count(*) FROM msp_audit_logs GROUP BY entity_type;  -- see below
```

| `action_type` | count | | `entity_type` | count |
|---|---|---|---|---|
| `AUTH_LOGOUT` | 302 | | *(blank/null)* | 487 |
| `AUTH_LOGIN` | 179 | | `checkout_session` | 16 |
| `mcp.tool.create_account` | 16 | | `mcp_tool` | 11 |
| `AUTH_ACCOUNT_SETUP` | 6 | | `route` | 4 |
| `portal.route.not_found` | 4 | | `user` | 2 |
| `mcp.tool.whoami` | 4 | | `customer` | 1 |
| `mcp.tool.platform_health` | 3 | | `audit_check` | 1 |
| `IMPERSONATION_SESSION_STARTED` | 2 | | | |
| `mcp.tool.query_customers` | 1 | | | |
| `mcp.tool.audit_check_write_fail` | 1 | | | |
| `mcp.tool.audit_check_undeclared_mutation` | 1 | | | |
| `mcp.tool.audit_check_read` | 1 | | | |
| `customer.create` | 1 | | | |
| `mcp.tool.audit_check_write_ok` | 1 | | | |

**No `partial` outcome exists live** — every MCP write-tool attempt in this local dataset resolved
to a terminal `success`/`failure`, so the "process died mid-attempt" state (§2.2) is real and
reachable in code but has zero rows to demonstrate it today, same shape of honest gap the RBD
pack's §6 documents for a different table. **The large `msp-settings.ts`/`msp-admin-settings.ts`/
`msp-sales-bundles.ts`/`msp-custom-domain.ts`/`admin-active-directory.ts` vocabulary cataloged in
§2.1 has zero live rows** in this local database — every one of those ~45 distinct `actionType`
values is real, reachable code, just never yet exercised against this local dataset. The live
picture today is dominated by auth lifecycle events (login/logout/setup — 487 of 522 rows, 93%)
and MCP tool calls (30 rows).

Other live counts checked: `actor_service_account_id` is set on **0** rows (the column exists,
`msp-audit-log.ts` even reads it, §1.4 already notes it never reaches the wire — and no writer in
this codebase currently populates it either). `customer_id` is set on 31/522 rows. `correlation_id`
is set on all 522/522 (every writer path threads one through). `metadata` is set on 214/522.

---

## 5. `msp_audit_logs` vs. the legacy `audit_logs` table — two real, separate trails

`get-audit-logs.ts`'s own header (`:6-14`) states this plainly and it is worth restating here since
it's the first pack to document `msp_audit_logs` on its own terms: **`audit_logs`** (different
table, `lib/db/src/schema/index.ts:1535`, written via `createAuditLog()` in
`artifacts/api-server/src/lib/audit.ts:18-35`) is a **separate, older trail**, keyed on
`actorName`/`clientId`/`projectId`, read by `GET /audit-logs` (`requireAdmin`). It is not this
table and this route does not read it. The offboarding pack (§310-313 of
`docs/msp-console/offboarding-msp-console-contract-pack.md`) already flags that its own routes
write **only** `msp_audit_logs`, "no legacy audit-log call anywhere" — consistent with what this
pack finds: nothing in §2's writer list touches `auditLogsTable`. The MCP `get_audit_logs` tool
(§0) is the one surface that deliberately bridges both, via its `source="msp"|"platform"` param —
a caller of that tool needs to know which of two genuinely different tables it's asking about.

---

## 6. Real out-of-scope finding hit while researching consumers — filed separately, not fixed here

While tracing every real consumer of `GET /api/msp/audit` (§0), one admin-panel dev tool referenced
a URL for this route that has **never existed**: `artifacts/admin-panel/src/components/
GraphProbeModal.tsx:20` lists a preset `{ url: "/api/msp/audit-logs", label: "MSP Audit Log
Telemetry" }` — plural, hyphenated. The real, only-ever-mounted path is `/api/msp/audit` (singular,
confirmed §0/`routes/index.ts:487`); `/api/msp/audit-logs` has no route anywhere in the codebase.
Reading the modal's own `handleTestProbe` (`:58-121`) further shows the whole component is
**entirely simulated** — no real `fetch` call is ever made; every "response" (status code, headers,
body, even a fake `x-request-id`) is hardcoded/randomly generated client-side. This is a live
violation of this project's own "never invent data to display" rule (a dev tool that fabricates
fake HTTP responses instead of making a real call), independent of the dead-URL preset. Filed as
its own issue per the mandatory-finding rule (not fixed in this pass — out of scope for a
read-only contract-pack extraction, and a real behavioral decision about what this tool should
actually do belongs to whoever owns it).

---

## 7. The forbidden list — declared, not merely absent

1. **No cross-MSP read for a non-PlatformAdmin.** `MSPAdmin` is hard-scoped to its own `mspId`
   server-side (§1.1) — the request cannot widen this via any query param.
2. **No cross-tenant customer filter exists at all** (§1.2) — there is no way to ask this endpoint
   for one customer's rows; the closest available filter is MSP-wide.
3. **Failed/missing audit inserts never block the action they're auditing**, for every writer that
   uses a local `writeAuditLog`/`writeAuthAuditLog` closure without awaiting failure handling —
   `auth.ts`'s variant explicitly swallows insert errors (`:149-151`, "Audit log is non-fatal").
   **The one deliberate exception is MCP write tools** (§2.2), which invert this and refuse the
   action if the attempt row can't be persisted — a real, stated asymmetry between the two writer
   families, not an inconsistency to "fix."

---

## 8. Provenance

**Generated 2026-09-10** against `main`, for **#3370**, Document step of the Audit Log Feature
under the reset #1571 Epic. Read in full: `msp-audit-log.ts` (146 lines, the whole file). Cross-
referenced for the writer catalog (§2): `auth.ts`, `msp-portal.ts`, `msp-settings.ts`,
`msp-admin-settings.ts`, `msp-custom-domain.ts`, `msp-plan-management.ts`,
`msp-plan-self-service.ts`, `msp-sales-bundles.ts`, `msp-staff.ts`, `admin-active-directory.ts`,
`portal-customer-engines.ts`, `portal-404-events.ts`, and `artifacts/mcp-server/src/audit.ts` +
`artifacts/mcp-server/src/tools/get-audit-logs.ts`. Verified live against local PostgreSQL —
`msp_audit_logs`'s schema re-confirmed to match the Drizzle source exactly (column-for-column,
including the absence of any CHECK constraint), and every count in §4 queried directly, not
estimated. No product code, schema, or UI was changed by this pass. One real, out-of-scope finding
(§6) was hit and filed separately rather than folded into this read-only pack.
