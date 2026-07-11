# Runbook: Incident Response

**Purpose:** Triage and escalation path for production incidents affecting the MSP Portal platform.

---

## Severity Levels

| Level | Definition | Response Time |
|-------|-----------|---------------|
| **P1 – Critical** | Platform completely down, payments broken, data loss risk, security breach | Immediate (< 15 min) |
| **P2 – High** | Core feature unavailable (auth, SOW generation, workflow engine), affecting multiple MSPs | < 1 hour |
| **P3 – Medium** | Feature degraded, single MSP affected, workaround available | < 4 hours |
| **P4 – Low** | Cosmetic issue, minor inconvenience, no data impact | Next business day |

---

## Pre-checks (before declaring an incident)

1. **Check deployment logs** — confirm the API server started cleanly after the last deploy (`pnpm --filter @workspace/scripts run migrate-prod` must have succeeded).
2. **Check Stripe webhook status** — run `pnpm --filter @workspace/scripts run sync-webhooks` to confirm the webhook endpoint exists.
3. **Check environment secrets** — confirm `STRIPE_SECRET_KEY_PROD`, `DATABASE_URL`, and `AZURE_*` secrets are set in Replit Secrets (production environment).
4. **Check DLQ** — visit Admin Panel → Observability → DLQ for a burst of new unresolved items (indicates a systemic failure, not a one-off).

---

## Step-by-Step Triage

### Step 1: Identify the blast radius

Answer these questions before taking any action:

- Is the API server responding? → `curl https://<host>/api/healthz`
- Is the database reachable? → Check Admin Panel → DB Status.
- Is the issue isolated to one MSP, or all MSPs?
- Is payment processing (Stripe) involved?
- Is a deployment or config change the proximate cause?

### Step 2: Classify severity (table above)

Document the start time, affected surface, and initial hypothesis in a timestamped incident note.

### Step 3: Contain

**API server down / crash loop:**
1. Check Replit deployment logs for startup errors.
2. If a missing secret caused the crash, add the secret via Replit Secrets, then redeploy.
3. If a bad migration caused the crash, roll back the last DDL change and redeploy.

**Database connectivity lost:**
1. Check Replit PostgreSQL status page.
2. Do not attempt manual DB restarts — the managed DB recovers automatically.
3. If a migration left the schema in a broken state, use `executeSql` in the Replit shell to drop the partial object.

**Stripe payments broken:**
1. Run `pnpm --filter @workspace/scripts run sync-webhooks -- --fix` to recreate the webhook endpoint.
2. Verify `STRIPE_SECRET_KEY_PROD` is set and starts with `sk_live_`.
3. Check Stripe Dashboard → Webhooks for recent delivery failures.

**Auth broken (all users cannot log in):**
1. Check that the JWT secret environment variable is set and non-empty.
2. Check `msp_refresh_tokens` — if the table is unexpectedly empty, sessions have been wiped (check for a bad migration).
3. Users can re-authenticate; refresh tokens will be reissued.

**AI generation failing:**
1. Check Anthropic API status at [status.anthropic.com](https://status.anthropic.com).
2. Check AI billing balance in Admin Panel → AI Billing.
3. If the Anthropic integration is misconfigured, verify the integration is connected (see Replit Integrations → Anthropic).

### Step 4: Communicate

For P1/P2 incidents, notify affected MSP administrators via direct email within 30 minutes of incident start. Include:
- What is affected.
- Current status (investigating / mitigating / resolved).
- ETA for resolution (if known).

### Step 5: Resolve and verify

- Confirm the root cause is fixed.
- Verify the affected feature end-to-end (not just that the server starts).
- Check the DLQ — replay any events that failed during the incident window.
- Check workflow runs — force-fail any stuck runs from the incident window and re-trigger where safe.

### Step 6: Post-incident review (P1/P2)

Within 24 hours of resolution, document:
1. **Timeline** — when it started, when detected, when resolved.
2. **Root cause** — the specific change or condition that caused the incident.
3. **Impact** — which MSPs/customers were affected, for how long.
4. **Remediation** — what was done to resolve it.
5. **Follow-up actions** — what will prevent recurrence.

---

## Escalation Contacts

| Role | Responsibility | Contact |
|------|---------------|---------|
| Platform Engineer | Code-level fixes, DB changes, secret rotation | *(fill in)* |
| Shane McCaw | Business decisions, client communication, P1 escalation owner | *(fill in from Replit Secrets / ops doc)* |
| Replit Support | Infrastructure/hosting issues | support.replit.com |
| Stripe Support | Payment processing issues | support.stripe.com |
| Anthropic Support | AI API issues | support.anthropic.com |
| Azure Support | Key Vault / Automation issues | Azure portal support ticket |

---

## Useful Diagnostic Commands

```bash
# API healthcheck
curl https://<host>/api/healthz

# Sync Stripe webhooks
pnpm --filter @workspace/scripts run sync-webhooks

# Apply DB migrations (idempotent)
pnpm --filter @workspace/scripts run migrate-prod

# Full typecheck (catch startup errors before deploy)
pnpm run typecheck

# Check server logs (Replit deployment logs)
# Use Replit deployment dashboard → Logs tab
```

---

## Implementation Reference

- API startup / secret validation: `artifacts/api-server/src/index.ts`
- DB migration scripts: `scripts/src/`
- Webhook sync: `scripts/src/sync-webhooks.ts`
- DLQ: `artifacts/api-server/src/lib/dlq.ts` — follow `dlq-replay.md` after any incident
- Workflow remediation: follow `workflow-run-remediation.md` for stuck runs
