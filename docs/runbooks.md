# Operational Runbooks

These runbooks are written for the **Shane McCaw Consulting** platform. They assume access to the Replit workspace, the Replit Secrets panel, and (for Azure operations) the Azure Portal or Azure CLI.

---

## RB-01 — DLQ Replay

**When to use:** Messages are piling up in the dead-letter queue, visible in the Admin Panel → Observability → DLQ, or via `GET /api/admin/dlq`. Root cause is typically a transient downstream error (Stripe unavailable, Azure API timeout, MS Graph 429).

### Steps

1. **Identify the failed items**
   - Admin Panel → Observability → DLQ (or `GET /api/admin/dlq?limit=50`).
   - Note the `eventType`, `payload`, and `failureReason` for each entry.

2. **Diagnose root cause**
   - If `failureReason` contains a network error or 5xx, the upstream service was temporarily unavailable. Proceed to replay.
   - If `failureReason` contains a 4xx or schema validation error, fix the underlying data or code bug first — replaying will re-fail identically.
   - If `failureReason` contains `duplicate`/`idempotency`, the event was already processed — mark as resolved without replaying.

3. **Replay individual items**
   ```
   POST /api/admin/dlq/:id/replay
   Authorization: Bearer <ADMIN_PASSWORD>
   ```
   Or use the **Replay** button in Admin Panel → Observability → DLQ.

4. **Bulk replay** (same event type, all failed)
   ```
   POST /api/admin/dlq/bulk-replay
   Authorization: Bearer <ADMIN_PASSWORD>
   Content-Type: application/json
   {"eventType": "stripe.payment_intent.succeeded"}
   ```

5. **Verify**
   - Monitor the DLQ: count should decrease.
   - Check the relevant downstream state (e.g., `client_services` row updated, Kanban card advanced).
   - Check API server logs for any re-failure.

6. **If items continue to fail**
   - Escalate to incident response (RB-04).
   - Do not replay more than 3 times without understanding root cause.

### Key files
- `artifacts/api-server/src/lib/dlq.ts`
- `artifacts/api-server/src/routes/admin-observability.ts`

---

## RB-02 — Workflow Run Remediation

**When to use:** A `wf_run` is stuck in `running` or `pending` state, a node failed mid-execution, or a client's engagement project is stalled and the admin cannot advance it manually.

### Diagnosing a Stuck Run

1. **Find the run**
   - Admin Panel → Workflows → Runs, filter by `status = running` or `status = pending`.
   - Or via MSP Portal → Operator Tasks if it surfaced as an operator task.
   - Or query the DB: `SELECT id, status, "createdAt", "updatedAt" FROM wf_runs WHERE status IN ('running','pending') ORDER BY "updatedAt" ASC;`

2. **Identify the stuck node**
   - `GET /api/admin/workflow-runs/:runId` — returns the full run including `stepResults`.
   - Look for the last node in `stepResults` that has no `completedAt`.

3. **Common causes and fixes**

   | Symptom | Cause | Fix |
   |---|---|---|
   | Node `type: execute_runbook` stuck `running` | Azure Automation job hung or never started | See "Cancelling a hung runbook" below |
   | Node `type: generate_document` stuck | AI provider timeout / rate limit | Retry via `POST /api/admin/workflow-runs/:runId/retry-node` with the node ID |
   | Node `type: send_email` failed | Exchange Online / Graph error (see `error` in node output) | Check `GRAPH_MAIL_USER_ID` and Graph app credentials are configured; check `failed_notifications` table for the specific recipient; retry |
   | Entire run `pending` for >10 min | Scheduler missed the run (server restart during execution) | Trigger the reconciler: `POST /api/admin/workflow-runs/reconcile` |

4. **Manually advance a stuck run**
   ```
   POST /api/admin/workflow-runs/:runId/advance
   Authorization: Bearer <ADMIN_PASSWORD>
   Content-Type: application/json
   {"nodeId": "<stuck-node-id>", "status": "skipped", "reason": "Manual remediation — runbook timed out"}
   ```
   This marks the node skipped and lets the executor continue to the next node.

5. **Cancel a run entirely**
   ```
   POST /api/admin/workflow-runs/:runId/cancel
   Authorization: Bearer <ADMIN_PASSWORD>
   ```
   Sets the run to `cancelled`. The client's engagement project will show as `paused` — notify the client if appropriate.

### Cancelling a Hung Azure Runbook

1. Azure Portal → Automation Accounts → `<AZURE_AUTOMATION_ACCOUNT_NAME>` → Jobs.
2. Find the job for the stuck runbook (match by `runbookName` and approximate start time).
3. Click **Stop**.
4. Return to step 4 above to advance or cancel the wf_run.

### Kanban Card Stuck in `queued`

Kanban auto-fire has a stuck-queue reconciler. If a card remains `queued` for >15 minutes:

1. Admin Panel → Kanban → find the card.
2. Click **Force Advance** (visible only to admins).
3. If unavailable: `PATCH /api/admin/kanban/:cardId/status` with `{"status": "active"}`.

### Key files
- `artifacts/api-server/src/lib/workflow-executor.ts`
- `artifacts/api-server/src/lib/kanban-auto-fire.ts`
- `artifacts/api-server/src/lib/dlq.ts`

---

## RB-03 — Key Vault Credential Rotation

**When to use:** A client's M365 app registration secret is expiring, a credential was potentially compromised, or a client requests a credential change.

### Rotating a Client Credential in Key Vault

1. **Generate the new credential**
   - Azure Portal → Azure Active Directory → App Registrations → `<client's app reg>` → Certificates & secrets → New client secret.
   - Copy the new secret value immediately (it is shown only once).

2. **Update the secret in Key Vault**
   - Azure Portal → Key Vault → `<AZURE_KEY_VAULT_URL>` → Secrets.
   - Find the secret named for the client (convention: `client-<clientId>-secret` or as configured at onboarding).
   - Click **New Version** and paste the new secret value.
   - Set an appropriate expiry date (recommend 12 months).

3. **Verify the new credential works**
   - Admin Panel → Clients → `<client>` → Diagnostics → Run Connectivity Check.
   - This triggers `GET /api/admin/clients/:clientId/diagnostics` which re-reads the credential from Key Vault and tests it against MS Graph.

4. **Retire the old secret**
   - Once diagnostics pass, delete the old app registration secret in Azure AD (the one that was just superseded).

5. **Audit log**
   - The Key Vault access is audit-logged via Azure Monitor. Optionally add a manual audit entry:
     ```
     POST /api/admin/audit-logs
     Authorization: Bearer <ADMIN_PASSWORD>
     {"action": "credential_rotated", "clientId": "...", "reason": "Annual rotation"}
     ```

### Rotating the Platform Service Principal (`AZURE_CLIENT_ID`)

This is the credential the API server itself uses to talk to Key Vault and Azure Automation.

1. Azure Portal → Azure AD → App Registrations → `<AZURE_CLIENT_ID app>` → Certificates & secrets → New client secret.
2. Copy the new secret value.
3. **Update Replit Secrets:** In the Replit workspace → Secrets panel, update `AZURE_CLIENT_SECRET` with the new value.
4. **Restart the API Server workflow** in Replit to pick up the new secret.
5. Verify: Admin Panel → Overview → healthz should show `azure: ok` within 60 seconds.
6. Delete the old secret from the app registration in Azure AD.

### Key files
- `artifacts/api-server/src/lib/azure-keyvault.ts`
- `artifacts/api-server/src/lib/azure-credentials.ts`

---

## RB-04 — Incident Response

**When to use:** The platform is down, payments are failing, clients cannot access their portal, or a data integrity issue is detected.

### Severity Levels

| Level | Description | Target Response |
|---|---|---|
| P1 — Critical | Full platform down, all clients affected, payments failing | Immediate (within 15 min) |
| P2 — High | Partial outage (one subsystem down), payment webhook failing | Within 1 hour |
| P3 — Medium | Non-critical feature broken, one client affected | Within 4 hours |
| P4 — Low | Cosmetic issue, minor data inconsistency | Next business day |

### P1 Response Playbook

1. **Confirm the outage**
   - Check `GET /api/health` (unauthenticated). If this fails, the API server is down.
   - Check the Replit workflow panel — are all workflows running?

2. **Restart affected workflows**
   - If `artifacts/api-server: API Server` is stopped: `restart_workflow "artifacts/api-server: API Server"`.
   - Wait 30 seconds; re-check `/api/health`.

3. **Check for DB connectivity issues**
   - API server logs will show `pg connection error` if the database is unreachable.
   - Replit-provisioned PostgreSQL: check Replit status page (status.replit.com).
   - If DB is down, there is no self-service fix — contact Replit support.

4. **Payment webhook failure**
   - Symptom: Stripe sends events but `client_services` are not updating.
   - Check Stripe Dashboard → Developers → Webhooks → recent deliveries for failures.
   - Run: `pnpm --filter @workspace/scripts run sync-webhooks -- --fix` to re-register the endpoint.
   - Check `STRIPE_WEBHOOK_SECRET_PROD` in Replit Secrets matches the Stripe Dashboard signing secret.

5. **Stripe charges failing**
   - Symptom: `POST /api/portal/checkout` returns errors.
   - Check `STRIPE_SECRET_KEY_PROD` is set correctly (starts with `sk_live_`).
   - Check Stripe Dashboard → Developers → Logs for the failing API call.
   - If the key is expired or revoked: generate a new restricted key in the Stripe Dashboard, update `STRIPE_SECRET_KEY_PROD` in Replit Secrets, restart API server workflow.

6. **MS Graph / Azure errors**
   - Symptom: Script runner fails, calendar shows empty, SharePoint provisioning fails.
   - Check that `AZURE_CLIENT_SECRET` / `GRAPH_CLIENT_SECRET` have not expired.
   - Rotate if needed (see RB-03).

7. **Escalate if unresolved within 30 min**
   - Contact Replit support for infrastructure issues.
   - For Stripe: contact Stripe support with the request IDs from their dashboard.
   - Notify affected clients with a status update.

### Post-Incident

1. Write a brief incident summary: what happened, timeline, root cause, fix applied.
2. Add a manual audit log entry via the Admin Panel.
3. If a DB migration was involved in the incident, run `pnpm --filter @workspace/scripts run check-migration-drift` to verify state.
4. Review whether the incident type warrants a new alert rule in Admin Panel → Live Monitor.

### Key health endpoints

| Endpoint | What it checks |
|---|---|
| `GET /api/health` | API server alive |
| `GET /api/admin/db-status` | Database connectivity + migration status |
| `GET /api/admin/monitor-checks` | All active live-monitor checks |
| `GET /api/admin/dlq` | Dead-letter queue depth |
