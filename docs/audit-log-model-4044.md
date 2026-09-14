# Audit Log — data model (#4044, part of #1946)

Step 1 of 4 of the Full Audit Log feature (#1946): the real data model plus the
fail-open logging wrapper. This documents the shape that landed and, critically,
**where the trail under this model begins**.

## Where the new trail begins

The `audit_logs` table has existed and been written to by 179 call sites for a long
time. Migration `lib/db/migrations/manual/2026-09-14-audit-log-actor-tenant-catalogue-4044.sql`
added the new columns **additively** — it rewrote nothing.

- Every row that existed before that migration keeps its original `actor_role`,
  `action_type` and `entity_type` verbatim.
- Those rows have `action_category = NULL` and `tenant_id = NULL`. **They are not
  backfilled or reinterpreted** (#1946 question F, confirmed 2026-08-30).
- Therefore: **a NULL `action_category` means "written before the catalogue landed,"
  not "uncategorised action."** The categorised, tenant-scoped trail begins at the
  first row written after this migration ran.

## Actor model (`actor_role`)

Widened from the old two-value `["admin","client"]` — which could not honestly answer
the M365-style question *"who did this"* — to the real closed set of principals:

| value | principal |
|---|---|
| `admin` | platform / MSP administrator (legacy value, retained) |
| `client` | customer-portal user (legacy value, retained) |
| `customer` | customer-tenant principal acting in their own tenant |
| `msp` | MSP operator acting on a customer's behalf |
| `platform_admin` | platform-level administrator |
| `service_account` | non-human service principal |
| `agent` | automation agent (#1931) — indistinguishable in the trail except by name |
| `microsoft` | external Microsoft Graph-initiated change |
| `system` | genuinely unattended action with **no** real principal |

`system` is never a catch-all where a real actor exists (#1946 standing constraint). The
`msp`, `customer`, `system` and `microsoft` values were already being written by live call
sites against the old two-value type (a latent type mismatch); widening the enum makes them
first-class and correct.

The enum is a compile-time TypeScript constraint. Following this repo's established pattern
for `text(col, { enum: [...] })` (e.g. the `msp_alert` enums), the column is plain `text`
with **no DB CHECK constraint**, so the migration needed no DDL for the role change.

## Tenant scoping (`tenant_id`)

A customer-facing audit log scopes to the customer's **tenant**, not to a single person —
the same defect #1923 records for status reports. `tenant_id` references `tenants.id`
(the `users.tenant_id → tenants.id` value is the JWT `customerId`). It is nullable:
platform-wide admin actions have no tenant. The older `client_id` (references `users.id`)
is retained for backward compatibility with existing call sites but is superseded by
`tenant_id` for scoping.

## Enumerable action catalogue (`action_category`)

`action_type` stays an **open** detail string (the specific verb — ~175 real values, some
passed as variables at the call site, so it is deliberately *not* hardened into a closed
union). Filterability comes from a new coarse, closed **operation-class** enum
`action_category` — the same class of fix as #1826's `notifications.category`, and the
M365-unified-audit-log analogue of `RecordType`:

`create · update · delete · action · settings · auth · access · security · system`

Ordinary reads are deliberately **absent**: per the settled read boundary (#1946,
2026-09-14) only privileged / cross-boundary reads are audited (break-glass, an operator
reading a specific customer's data, export/download, anything crossing a tenant boundary),
and those are `access`, not a generic `read`.

`AUDIT_ACTOR_ROLES`, `AUDIT_ACTION_CATEGORIES` and their `AuditActorRole` /
`AuditActionCategory` types are exported from `@workspace/db` for read surfaces and filter
UIs to consume (Steps 2–4).

### How `action_category` gets populated

Call sites should pass `actionCategory` explicitly. When they don't,
`createAuditLog` fills it on a **best-effort** basis via `deriveAuditActionCategory`
(`artifacts/api-server/src/lib/audit.ts`), which maps the open verb to a category by
pattern (auth/access/security tested before the generic create/update). This categorises
**new** writes only — it never touches stored rows. It is a fallback, not a source of
truth: pass the category explicitly wherever the derivation would be wrong.

## Immutability

Append-only, following the proven `cr_events` pattern (#1503, #1946 question D confirmed
2026-09-14): **there is no update or delete route against `audit_logs` anywhere in the
repo** — grep-verifiable:

```
grep -rniE '(router|app)\.(post|put|patch|delete)\([^)]*audit' artifacts/api-server/src --include=*.ts | grep -v '.test.ts'
grep -rn '\.update(auditLogsTable)\|\.delete(auditLogsTable)' artifacts --include=*.ts | grep -v '.test.ts'
```

Both return nothing. (Test files delete their own fixture rows during cleanup; that is
test teardown, not a product route, and does not create a mutation surface.)

## Fail-open, log loudly

`createAuditLog` never blocks the real action on an audit-write failure (#1946 question C,
decided 2026-09-14) — but the failure is logged **loudly** on the `audit` channel with the
error message and stack serialized explicitly (a bare `log.error({ err }, …)` can flatten a
non-Error to `{}` in this repo's log stream). A genuine crash in the caller is a distinct
failure class, out of a DB-write catch's reach, and is intentionally not masked here.
`createAuditLogOrThrow` remains available for call sites where a missing audit row must
itself fail loudly (Git #3935).
