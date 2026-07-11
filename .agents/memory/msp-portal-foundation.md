---
name: MSP Portal Foundation
description: Auth, RBAC, event bus, idempotency/DLQ, and portal URL for the MSP platform layer
---

# MSP Portal Foundation

## Portal URL
- Served at `/portal/` — artifact slug is `msp-portal` but previewPath/BASE_PATH/paths all use `/portal/`
- `artifact.toml` at `artifacts/msp-portal/.replit-artifact/artifact.toml`

## Auth Session Model
- Access tokens: 15-min JWT, claims include `mspRole`, `mspId`, `customerId`
- Refresh tokens: 7-day sliding window, stored hashed in `msp_refresh_tokens` table
- Rotation: old token marked `revokedAt` + `replacedByHash`; new token inserted on each valid refresh
- `buildUserPayload` is async (awaits `getMspClaims` to look up MSP user row)
- `seedAdminUser()` creates a row in `msp_users` with `mspRole="PlatformAdmin"` for the admin user

## RBAC Role Hierarchy (lowest → highest)
Free < CustomerUser < ServiceAccount < MSPOperator < MSPAdmin < PlatformAdmin

- `requireRole(minimumRole)` — wraps requireAuth, checks ROLE_ORDER index
- `requireMspScope(source)` — reads `req.user` directly (call AFTER requireAuth), PlatformAdmin bypasses
- `requireCustomerScope(source)` — customer-level fence
- Legacy `role: "admin"` users are treated as PlatformAdmin everywhere

**Why:** requireMspScope reads req.user directly (not JWT), so it must run after requireAuth. requireRole wraps requireAuth internally for convenience.

## Event Bus ownerType Auto-Derivation
`ownerType` defaults: `customerId != null → "customer"`, `mspId != null → "msp"`, else `"platform"`.
Callers can override by passing `ownerType` explicitly.

## DB Tables (all in lib/db/src/schema/msp.ts)
msps, msp_customers, msp_users, msp_service_accounts, msp_refresh_tokens,
msp_event_store, msp_idempotency_store, msp_dlq_store,
msp_documents, msp_document_versions, msp_audit_logs

Tables were pushed directly via executeSql — not in the drizzle migration journal.
No `drizzle-kit generate` was run for these tables, so check-drift will NOT flag them.

## Test File
`artifacts/api-server/src/lib/msp.test.ts` — 19 tests covering role hierarchy, tenant isolation, event envelope, idempotency, DLQ. Must be listed in `vitest.config.ts` include array (already added).

## requireCustomerScope IDOR fix
MSPAdmin/MSPOperator must NOT bypass the customer scope fence unconditionally. The middleware is async and does a DB lookup (`db.select().from(mspCustomersTable).where(eq(id) AND eq(mspId)).limit(1)`) to confirm the target customer belongs to the caller's MSP. Only PlatformAdmin bypasses. Missing mspId claim → 403 before DB query.

## Idempotency null-mspId lookup
Always use `isNull(mspIdempotencyStoreTable.mspId)` (not `eq(col, null)`) for platform-scoped null-mspId idempotency key lookups. Import `isNull` from `drizzle-orm`.

## mock.module() — Node test runner pattern
`mock.module()` is SYNCHRONOUS (no `await`), takes `{ namedExports: {} }` not a factory function. Must be called at top level BEFORE the module under test is imported. Load the module under test via dynamic `import()` inside `before()`. Mocking `drizzle-orm` operators (`and/eq/isNull/gt`) as simple string returns is sufficient when the query chain is also mocked.

## DLQ Tenancy
`listDlqItems(mspId?)` must scope by mspId when provided. PlatformAdmin callers omit mspId to see all items. `incrementDlqAttempt` uses `sql\`col + 1\`` for atomic increment, not a read-modify-write.

## Event Envelope Validation
`dispatchUnsafe` auto-generates UUID v4 for correlationId and causationId if caller omits them — they must always be populated (canonical envelope requirement). Zod validates `z.string().uuid()` (matches the DB `uuid` column type). Never use `z.string().min(1)` here — the DB column is typed `uuid` and non-UUID strings will fail at insert.

## Session Expiry UX
The "Are you still there?" modal tracks REFRESH token expiry (7-day), not access token (15-min). The access token silently auto-renews every 13min via `setInterval`. Login/refresh responses include `refreshExpiresAt` (ISO string). Client stores it in `sessionStorage` under `msp_refresh_expires_at`.

## JWT Mocking in Tests
requireRole wraps requireAuth which validates the Bearer token via jwt.verify. Tests must mock `jsonwebtoken` to make verify return a decoded payload from a base64url-encoded JWT middle segment. Pattern: `makeJwt(payload)` → `hdr.<base64url(JSON)>.sig`.
