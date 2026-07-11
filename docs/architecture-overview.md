# Architecture Overview — MSP Portal Platform

**Audience:** Engineers and operators picking up this codebase. This document focuses on the five cross-cutting concerns that govern the entire system: authentication, event bus, workflow engine, engine registry, and tiered data ownership.

For a broader component map (route namespaces, data flows, integrations, database tables) see `docs/architecture.md`.

---

## System Layers (ASCII Diagram)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Replit Reverse Proxy                         │
│              (path-based routing, mTLS, HTTPS termination)          │
└───────┬─────────────┬────────────┬─────────────┬────────────────────┘
        │             │            │             │
   path: /       path: /crm   path: /portal  path: /admin-panel
        │             │            │             │
┌───────▼──┐  ┌───────▼──┐  ┌──────▼────┐  ┌────▼─────────┐
│ Marketing│  │  Client  │  │   MSP     │  │    Admin     │
│  Website │  │  Portal  │  │  Portal   │  │    Panel     │
│ (static) │  │  (React) │  │  (React)  │  │   (React)    │
└──────────┘  └────┬─────┘  └─────┬─────┘  └──────┬───────┘
                   │              │               │
                   └──────────────┼───────────────┘
                                  │ path: /api
                        ┌─────────▼──────────┐
                        │     API Server     │
                        │  (Express + TS)    │
                        │                   │
                        │  ┌─────────────┐  │
                        │  │ Event Bus   │  │
                        │  │ (append-    │  │
                        │  │  only store)│  │
                        │  └──────┬──────┘  │
                        │         │         │
                        │  ┌──────▼──────┐  │
                        │  │  Workflow   │  │
                        │  │  Executor   │  │
                        │  └──────┬──────┘  │
                        │         │         │
                        │  ┌──────▼──────┐  │
                        │  │  Engine     │  │
                        │  │  Registry   │  │
                        │  └─────────────┘  │
                        └─────────┬──────────┘
                                  │
                        ┌─────────▼──────────┐
                        │    PostgreSQL DB    │
                        │  (Drizzle ORM)     │
                        └────────────────────┘
```

---

## 1. Authentication Model

### Token Strategy

The platform uses a **dual-token JWT strategy**:

| Token | TTL | Storage | Purpose |
|-------|-----|---------|---------|
| Access token | 15 minutes | `Authorization` header (Bearer) | Authenticates every API call |
| Refresh token | 7 days (sliding) | `httpOnly` cookie (web) or request body (mobile) | Exchanges for a new access + refresh pair |

Refresh tokens are SHA-256 hashed before being stored in the `msp_refresh_tokens` table. The raw token is never persisted. A refresh rotates both tokens (old refresh is invalidated atomically) so refresh token reuse is detectable.

### Role Hierarchy (RBAC)

Roles are ordered from least to most privileged. Middleware enforces a minimum role level — any role above the required level is also accepted.

```
Free
  └── CustomerUser
        └── ServiceAccount
              └── MSPOperator
                    └── MSPAdmin
                          └── PlatformAdmin
```

**Enforcement middleware** (`middlewares/requireAuth.ts`):
- `requireRole(minRole)` — access token must carry a role at or above `minRole`
- `requireMspScope(mspId)` — JWT `mspId` claim must match the requested MSP resource
- `requireCustomerScope(customerId)` — `customerId` claim must match the requested customer resource

### Impersonation

A `PlatformAdmin` can exchange a **single-use impersonation token** for a short-lived session JWT that carries both the admin's own identity and an `impersonatedMspId` claim. All events and AI billing costs recorded during the session are attributed to `impersonatedMspId`. Impersonation start events are written to the event store with `eventType = "auth.impersonation.session_started"`.

---

## 2. Event Bus

**File:** `artifacts/api-server/src/lib/event-bus.ts`

### Contract

Every event carries a canonical envelope:

```typescript
{
  eventId:       string   // UUID, assigned at dispatch
  eventType:     string   // e.g. "customer.created", "auth.login"
  eventVersion:  string   // semver, default "1.0"
  occurredAt:    Date
  correlationId: UUID     // groups causally-related events; auto-generated if absent
  causationId:   UUID     // id of the event that caused this one; auto-generated if absent
  actor: {
    id:       string | number
    role:     string        // e.g. "MSPAdmin", "system"
    type:     string        // "user" | "system" | "service_account"
    actingAs?: number       // set on impersonation actors
  }
  source:     string   // originating module, e.g. "msp-customers"
  ownerType:  "customer" | "msp" | "platform"   // derived from mspId/customerId if absent
  mspId?:     number
  customerId?: number
  payload:    Record<string, unknown>
  meta: {
    tenant: { mspId, customerId }
    ...extraMeta
  }
}
```

### Dispatch Behaviour

1. `dispatchEvent(opts)` — **never throws**. Errors are logged and swallowed so callers are not disrupted by event store failures.
2. `dispatchUnsafe(opts)` — propagates errors; use inside an explicit DB transaction.
3. Both functions write synchronously to `msp_event_store`, then fire two asynchronous (fire-and-forget) fan-outs:
   - **In-process listeners** — lightweight pub/sub (`addEventListener` / `removeEventListener`) consumed by the workflow engine trigger.
   - **Outbound webhooks** — `webhook-delivery.ts` fans out to registered MSP webhook endpoints.

### Well-Known Event Types

A `EVENT_TYPES` constant in `event-bus.ts` enumerates all first-class event types (`auth.login`, `customer.created`, `dlq.item.enqueued`, etc.). New event types must be added to this constant and documented.

### DLQ Integration

When a webhook delivery or event handler fails, the item is parked in the Dead Letter Queue (`msp_dlq_store`). See `docs/runbooks/dlq-replay.md` for the replay procedure.

---

## 3. Workflow Engine

**File:** `artifacts/api-server/src/lib/workflow-executor.ts`

### Graph Model

A workflow is a **directed acyclic graph (DAG)** of `WfNode` objects connected by edges. Execution is BFS-ordered (topological). Each node:
- Receives the full `payload` (merged output of all preceding nodes via `{{steps.<nodeId>.*}}` template resolution).
- Writes its output to `workflow_run_node_outputs`.
- On success, edges fan out to downstream nodes.
- On failure, the node's output is `{error: true, ...}` and the run status becomes `error`.

### Node Categories

| Category | Node Types |
|----------|-----------|
| **Structural** | `start`, `end`, `condition`, `switch_case`, `loop` |
| **Intelligence engines** | `calculate_priority`, `calculate_health`, `calculate_drift`, `calculate_forecast`, `calculate_crm`, `calculate_msp` |
| **Document / AI** | `generate_document`, `generate_script`, `analyze_news`, `generate_image` |
| **Communication** | `send_email`, `send_push` |
| **Azure** | `azure_automation`, `execute_runbook` |
| **Platform data** | `create_project`, `create_opportunity`, `add_kanban_card`, `qualify_lead`, `resolve_fulfillment`, `create_kanban_task` |
| **Flow control** | `run_workflow` (child workflow), `wait`, `check_script_output` |
| **Data** | `sql_query`, `find_object`, `collect_input`, `http_request` |
| **Social** | `post_linkedin`, `post_twitter`, `post_facebook` |
| **MSP billing** | `advance_dunning`, `meter_tenant_overage` |

### Template Resolution

Node `data` fields support `{{steps.<nodeId>.<fieldPath>}}` interpolation. Two resolver functions exist:
- `interp(expr, payload)` — always returns a string (for text fields).
- `resolveExprNative(expr, payload)` — preserves native type (for fields that must be an array, number, or object, e.g., `run_workflow` input mappings).

### Dry-Run Mode

Every node type supports a `dryRun` flag. Structural nodes (`condition`, `switch_case`, `start`, `end`) execute normally; all other nodes return a synthetic success output without performing side-effects. Dry-run runs are not persisted.

### Stuck Run Recovery

A background reconciler detects runs that have been `running` for longer than a configured threshold and marks them `error` with a `force-failed by reconciler` reason. Operators can also force-fail manually. See `docs/runbooks/workflow-run-remediation.md`.

---

## 4. Engine Registry

**File:** `artifacts/api-server/src/lib/engine-registry.ts`

### Pattern

All 11 intelligence engines share one contract (`EngineDef`) and are registered in a single `ENGINE_DEFS` array. The generic `admin-engines` routes drive any engine without engine-specific branching.

```typescript
interface EngineDef {
  key: string              // e.g. "priority", "sla"
  label: string
  description: string
  categoryPrefix: string   // scopes signal rule/group list in Config tab
  tenantScoped: boolean    // false only for MSP Portfolio engine
  ruleOwnership: "platform" | "msp"
  runForTenant(tenantId: number): Promise<unknown>   // real execution
  runForPayload(input: EngineTestInput): unknown      // test/simulation
}
```

### Registered Engines

| Key | Label | Tenant-scoped | Rule owner |
|-----|-------|:---:|:---:|
| `priority` | Priority Engine | ✓ | platform |
| `pricing` | Pricing Engine | ✓ | platform |
| `health` | Architecture Health Engine | ✓ | platform |
| `drift` | Drift Engine | ✓ | platform |
| `forecasting` | Forecasting Engine | ✓ | platform |
| `crm` | CRM Engine | ✓ | platform |
| `msp` | MSP Portfolio Engine | ✗ | platform |
| `sla` | SLA Engine | ✓ | msp |
| `scope_creep` | Scope Creep Engine | ✓ | msp |
| `monitoring` | Monitoring Engine | ✓ | platform |
| `sales_offer` | Sales Offer Engine | ✓ | msp |

### Signal Pipeline

Every `runForTenant` call follows the same pipeline:

```
buildTenantProfileAndFindings(tenantId)   → mergedProfile + parsedFindings
  + fetchSignalRulesAndGroups()           → rules + groups
  + getDisabledSignalKeys()               → Set<string>
  → computeTenantSignals(...)             → firedSignals Set
  → engine-specific scoring function      → typed result
```

Disabled signals (toggled off in Admin Panel → Tenant Signals) are excluded at the `computeTenantSignals` step and therefore cannot contribute to any engine score.

---

## 5. Tiered Data Ownership

The platform enforces a strict three-tier ownership hierarchy:

```
Platform  (Shane / PlatformAdmin)
    │
    └── MSP  (Managed Service Provider org)
            │
            └── Customer  (MSP's end-client tenant)
                        │
                        └── Resource  (document, project, signal, credential, …)
```

### Ownership Fields

Every DB row that belongs to a tenant carries ownership columns:

| Tier | Column(s) | Example tables |
|------|-----------|----------------|
| Platform-owned | no `msp_id` / `customer_id` | `signal_derivation_rules` (platform rules), `ai_prompts`, `email_templates` |
| MSP-owned | `msp_id` | `msps`, `msp_users`, `sla_policies`, `msp_audit_logs` |
| Customer-owned | `msp_id` + `customer_id` | `client_m365_profiles`, `engagement_projects`, `client_documents` |

The `ownerType` column in `msp_event_store` is auto-derived at dispatch time: `"customer"` if `customerId` is set, `"msp"` if only `mspId` is set, `"platform"` otherwise.

### Enforcement

- **Route middleware:** `requireMspScope(mspId)` and `requireCustomerScope(customerId)` verify that the JWT's `mspId` / `customerId` claims match the resource being accessed. Mismatches return `403`.
- **DLQ visibility:** `listDlqItems(mspId?)` — `PlatformAdmin` may omit `mspId` to see all items; MSP operators see only their tenant's items.
- **Engine rules:** `ruleOwnership: "platform"` engines cannot be reconfigured by MSP operators; `ruleOwnership: "msp"` engines (SLA, scope_creep, sales_offer) allow MSP operators to add and override rules within their own organisation scope.
- **Event bus:** `fanOutWebhooks` routes each event only to webhooks registered by the owning MSP; platform-owned events are not fanned out to MSP endpoints.

### Impersonation Fence

When a `PlatformAdmin` impersonates an MSP user, the `actingAs` field on the actor record preserves the impersonated MSP's identity. All resource-ownership checks use `actingAs` as the effective `mspId`, so the admin cannot access MSP-A's data while impersonating MSP-B.

---

## Related Documents

- `docs/architecture.md` — component map, route namespaces, data flows, database table groups, third-party integrations
- `docs/acceptance-checklist.md` — go-live verification checklist
- `docs/runbooks/dlq-replay.md` — DLQ replay procedure
- `docs/runbooks/workflow-run-remediation.md` — stuck/failed workflow remediation
- `docs/runbooks/key-vault-credential-rotation.md` — Key Vault credential rotation
- `docs/runbooks/incident-response.md` — production incident triage and escalation
