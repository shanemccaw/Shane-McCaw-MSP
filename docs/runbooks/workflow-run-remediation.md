# Runbook: Workflow Run Remediation

**Purpose:** How to diagnose and manually remediate a stuck or failed workflow run.

---

## Trigger Condition

Use this runbook when:
- A workflow run shows status `running` for longer than its expected duration (typical runs complete within 5–30 minutes; long AI-generation runs may take up to 10 minutes per node).
- A client or operator reports that an automated workflow did not complete its expected action (e.g., SOW not generated, email not sent, kanban card not created).
- The Admin Panel → Workflows → Run History shows a run in `error` or `stuck` state.

---

## Pre-checks

1. Confirm you have `PlatformAdmin` or `MSPAdmin` access.
2. Note the `runId` from the run history table — all log lines and DB rows key off this value.
3. Check server logs for errors referencing the `runId` before taking any manual action.

---

## Step-by-Step Procedure

### 1. Identify the stuck/failed run

**Via Admin Panel:**
- Navigate to **Admin Panel → Workflows → Run History**.
- Filter by MSP, workflow name, or status (`running` / `error`).
- Copy the `runId`.

**Via API:**
```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://<host>/api/admin/workflows/runs?status=running" | jq .
```

### 2. Inspect the run detail

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://<host>/api/admin/workflows/runs/<runId>" | jq .
```

Key fields to check:
- `status` — one of `pending` | `running` | `completed` | `failed` | `cancelled` | `awaiting_approval`. A run stuck in `running` with no recent activity is the primary signal.
- `errorMessage` — the error that stopped the run (set on `failed` status).
- `nodeOutputs` — JSONB map of each completed node's output; look for entries with `{error: true}`.
- `startedAt` vs `finishedAt` — `finishedAt` is null on an actively-running or stuck run. A large gap between `startedAt` and the current time with no `finishedAt` confirms the run is stuck.

### 3. Diagnose the failure type

| Symptom | Likely cause | See |
|---------|--------------|-----|
| `error: unknown node type` | Node type removed or renamed | Promote/migrate the graph |
| `error: clientId required` | Trigger fired without MSP/customer context | Check trigger payload |
| `error: AI generation failed` | Anthropic API timeout or quota | Check AI billing; retry |
| `error: azure_automation failed` | Azure Automation job rejected | Check runbook/credential validity |
| Run never left `queued` | Worker process crashed before pick-up | Restart API server; reconciler will requeue |
| Run stuck `running` > 1 hour | Worker killed mid-execution | Cancel the run (step 4) |

### 4. Cancel a stuck run

Stuck runs (status = `running` with no `updatedAt` activity for > 1 hour) should be cancelled to unlock any downstream waits. The **cancel** endpoint sets the run to `status = "cancelled"` and records `finishedAt`.

**Via Admin Panel:** Click **Cancel** next to the run row in Workflows → Run History.

**Via API:**
```bash
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://<host>/api/admin/workflows/runs/<runId>/cancel"
```

> Note: The API returns `409 Conflict` if the run is not in a cancellable state (i.e., it has already finished). Check the current `status` from step 2 first.

### 5. Re-run after cancellation or failure

Once the root cause is resolved, re-run the cancelled or failed workflow:

**Via Admin Panel:** Click **Re-run** next to the cancelled/failed run.

**Via API:**
```bash
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "https://<host>/api/admin/workflows/runs/<runId>/rerun"
```

The `rerun` endpoint clones the original run's payload and triggers a fresh execution. It accepts only runs with `status = "failed"`, `"cancelled"`, or `"completed"`.

For kanban-driven triggers (auto-fire on card move), move the card back to the trigger column after fixing the underlying issue.

### 6. Patch a single node output (advanced)

When only one node failed and you want to resume from after it, an operator can manually insert a synthetic node output into `workflow_run_node_outputs` and set `currentNodeId` to the next node. This is an advanced procedure — always take a DB snapshot first.

```sql
-- Snapshot the run first
SELECT * FROM workflow_runs WHERE run_id = '<runId>';

-- Insert synthetic output for the failed node
INSERT INTO workflow_run_node_outputs (run_id, node_id, output, completed_at)
VALUES ('<runId>', '<failedNodeId>', '{"synthetic":true,"skipped":true}', NOW())
ON CONFLICT DO NOTHING;

-- Advance the pointer (only if you are certain of the next node id)
UPDATE workflow_runs
SET current_node_id = '<nextNodeId>', status = 'running', updated_at = NOW()
WHERE run_id = '<runId>';
```

Then re-kick the executor. Use this path only when a force-fail + re-trigger is not feasible (e.g., idempotency concerns).

---

## Verification

1. Confirm `status = "completed"` in the run history.
2. Check `nodeOutputs` in the run detail — every node should have a non-error output.
3. Verify the side-effect: document generated, email delivered, kanban card created, etc.
4. If the run produced a DLQ entry, follow `dlq-replay.md` to resolve it.

---

## Escalation

If the run fails again after a clean re-trigger:
1. Capture `runId`, `workflowId`, and the full `errorLog`.
2. Check whether a downstream service (Azure Automation, Anthropic, Stripe) is degraded.
3. Escalate to the platform engineer on call (see `incident-response.md`).

---

## Implementation Reference

- Executor: `artifacts/api-server/src/lib/workflow-executor.ts`
- Engine: `artifacts/api-server/src/lib/portal-workflow-engine.ts`
- Run tables: `workflow_runs`, `workflow_run_node_outputs`
- Stuck-run reconciler: `artifacts/api-server/src/lib/kanban-stuck-queued-reconciliation` (see memory note)
