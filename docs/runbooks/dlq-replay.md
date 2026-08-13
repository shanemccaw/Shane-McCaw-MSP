# Runbook: DLQ Replay

**Purpose:** Step-by-step procedure to inspect and replay failed entries in the Dead Letter Queue (DLQ).

---

## Trigger Condition

Use this runbook when:
- An admin alert or log line shows `dlq: item enqueued` (logged at `warn` level).
- A client reports a missing event, document, or webhook that should have fired.
- The DLQ list in the Admin Panel shows unresolved items.

---

## Pre-checks

1. Confirm you have `MSPOperator` role or higher (the DLQ API requires an MSP JWT). PlatformAdmins impersonating an MSP can also access it.
2. Identify whether the failure is transient (network/timeout) or permanent (bad payload / schema error).
3. Check the downstream service is healthy before replaying — replaying into a broken dependency will re-enqueue the item.

---

## Step-by-Step Procedure

### 1. List unresolved DLQ items

**Via Admin Panel:**
- Navigate to **Admin Panel → Observability → DLQ** (or equivalent path).
- The table shows `eventType`, `errorMessage`, `mspId`, `customerId`, `createdAt`, and `attemptCount`.

**Via direct API (curl):**

DLQ routes are mounted at `/api/msp/v1/portal-wf` and require a valid MSP JWT (`Authorization: Bearer <msp-access-token>`).

```bash
# List unresolved DLQ entries for the authenticated MSP
curl -s -H "Authorization: Bearer $MSP_ACCESS_TOKEN" \
  "https://<host>/api/msp/v1/portal-wf/dlq?resolved=false" | jq .

# List resolved entries
curl -s -H "Authorization: Bearer $MSP_ACCESS_TOKEN" \
  "https://<host>/api/msp/v1/portal-wf/dlq?resolved=true" | jq .
```

### 2. Triage the root cause

Inspect the `errorMessage` and `errorStack` fields on the DLQ row:

| Pattern | Likely cause | Action |
|---------|--------------|--------|
| `ECONNREFUSED` / `timeout` | Downstream service unavailable | Wait for service recovery, then replay |
| `validation error` / `ZodError` | Malformed payload | Fix upstream producer, then discard |
| `unique constraint` / `duplicate key` | Event already processed | Discard (idempotent success) |
| `RBAC` / `not found` | Missing tenant record | Investigate MSP/customer setup, then discard or replay |

Check `attemptCount`. Items with `attemptCount >= 3` that still fail likely require a permanent fix before replay.

### 3. Replay a single item

**Via Admin Panel:** Click **Replay** next to the row.

**Via API:**
```bash
curl -s -X POST \
  -H "Authorization: Bearer $MSP_ACCESS_TOKEN" \
  "https://<host>/api/msp/v1/portal-wf/dlq/<dlqId>/replay"
```

Returns `202 Accepted` with `{ok: true, dlqId, newRunId, status: "pending"}`.

The server:
1. Increments `attemptCount` and sets `lastAttemptAt` atomically.
2. Re-dispatches the original payload to the event handler.
3. On success, marks the row `resolvedAt = now`, `resolution = "replayed"`.
4. On failure, the row remains unresolved and `attemptCount` increments again.

### 4. Discard a non-recoverable item

Use when the event is permanently stale or the root cause has been addressed another way.

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $MSP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resolution":"discarded"}' \
  "https://<host>/api/msp/v1/portal-wf/dlq/<dlqId>"
```

Sets `resolution = "discarded"`.

### 5. Mark as manually resolved

Use when the effect was achieved out-of-band (e.g., operator performed the action manually).

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $MSP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resolution":"manual"}' \
  "https://<host>/api/msp/v1/portal-wf/dlq/<dlqId>"
```

Both discard and manual resolve use the same `PATCH /dlq/:dlqId` endpoint with a `resolution` body field (`"discarded"` or `"manual"`). A `409 Conflict` is returned if the item is already resolved.

---

## Verification

After replaying:
1. Confirm the DLQ row is no longer in the unresolved list (`resolvedAt` is set).
2. Check the `msp_event_store` table (or Admin Panel → Events) for a new event of the same `eventType`.
3. Verify the downstream effect (webhook delivered, document generated, project created, etc.).

---

## Escalation

If items continue to re-enqueue after two replay attempts:
- Check server logs for the underlying error (`pino` logger, search for the `dlqId`).
- Check that the `msp_dlq_store` table is not approaching row-count limits.
- Escalate to the platform engineer on call (see `incident-response.md`).

---

## Implementation Reference

- DLQ store: `artifacts/api-server/src/lib/dlq.ts`
- Table: `msp_dlq_store` (columns: `dlqId`, `eventType`, `payload`, `errorMessage`, `errorStack`, `attemptCount`, `lastAttemptAt`, `resolvedAt`, `resolution`, `mspId`, `customerId`)
- Resolution states: `replayed` | `discarded` | `manual`
