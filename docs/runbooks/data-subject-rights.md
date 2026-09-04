# Runbook: Data Subject Rights (Deletion & Export Requests)

**Purpose:** Manual fulfillment procedure for right-to-erasure (deletion) and
right-to-portability (export) requests recorded by the platform. This is the
runbook linked from the admin notification email sent for every deletion
request (`artifacts/api-server/src/lib/data-rights.ts`).

---

## Where requests come from

Two entry points, both funneling through the same shared logic in
`artifacts/api-server/src/lib/data-rights.ts` — there is no divergent second
code path:

- **Customer self-service:** `POST /api/portal/deletion-request` (and the
  export flow at `GET /api/portal/data-export`) — the customer is logged in
  and acting on their own account.
- **MSP-admin-initiated:** `POST /api/msp/data-rights/customers/:customerId/deletion-request`
  (`artifacts/api-server/src/routes/msp-data-rights.ts`) — an MSP admin
  records a request on behalf of a customer who contacted them directly
  instead of using self-service.

Neither endpoint performs deletion itself. Each writes one `audit_logs` row
(`actionType: "deletion_request_submitted"`) and sends a one-time admin
notification email to `ADMIN_EMAIL` / `CRM_ADMIN_EMAIL`. **There is no
`deletion_requests` table and no status/lifecycle field anywhere in this
codebase.** The audit_logs row IS the entire record of the request; treat the
admin email as the trigger to act, and the audit_logs row as your source of
truth for "did we already see this."

---

## What to do when you receive the admin notification email

The email itself contains everything needed to act: requester name, email,
company, user ID, and — if the account has current-schema (MSP tenant) data —
a breakdown of diagnostic runs, diagnostic findings, SOWs, MSP documents, and
engine snapshots tied to that `customer_id`.

### Step 1: Confirm identity and scope

1. Match the requester's email/name against the account shown in the
   notification (`users.id` in the email = the account being acted on).
2. If the request came in through a channel other than the two endpoints
   above (phone, support ticket, etc.) and no notification email exists yet,
   record it the same way an MSP admin would — via the Admin Panel
   (see `artifacts/api-server/src/routes/msp-data-rights.ts`,
   `submitAdminInitiatedDeletionRequest`) so it lands in `audit_logs` and this
   runbook's SLA clock has a real, queryable start time.

### Step 2: Erase legacy CRM data

Go to **Admin Panel → CRM → Clients → Delete Client** and delete the client
record. This clears the legacy portal data path.

### Step 3: Erase current-schema (MSP tenant) data, if present

**CRM → Delete Client does NOT reach current-schema data.** If the admin
email's "Current-schema data" table is present (i.e. the account has a linked
`tenants` row), the following must be erased manually, scoped by the
`customer_id` shown in that table:

| Table | Column to filter by |
|-------|---------------------|
| `msp_diagnostic_runs` | `customer_id` |
| `msp_diagnostic_findings` | `customer_id` |
| `msp_documents` | `customer_id` |
| `tenant_engine_snapshots` | `customer_id` |
| `msp_sows` | `customer_id` — **only unsigned SOWs**; see retention below |
| `tenants` | `id` — the tenant row itself, once dependents above are cleared |

Use the direct local/dev `DATABASE_URL` connection (or, for production, hand
this off per the CLAUDE.md production-change gate — this is a real DB write
against a live tenant's data and is exactly the kind of destructive/sensitive
operation that stays a manual, eyes-on action, not something scripted blind).

### Step 4: Apply retention exceptions — do NOT delete these

Legal/financial retention requirements override the erasure request for:

- **Signed contracts**
- **Invoices**
- **Signed SOWs** (`msp_sows` rows with a completed signature — leave these
  in place even while deleting the customer's other current-schema rows
  above)

Retain these per standard legal/tax retention periods, not indefinitely by
default — check with Shane if a specific retention window isn't already
documented elsewhere for the entity type in question.

### Step 5: Send the retention notice

Once deletion is complete, send the client the standard retention notice
confirming what was deleted and what was retained (and why — the legal basis
for retaining signed contracts/invoices/SOWs).

### Step 6: Meet the SLA

**Action required within 30 days of the request** (the same 30-day window
quoted back to the requester in the self-service confirmation message,
`portal-privacy.ts`). Steps 2–5 above should be completed and the retention
notice sent inside that window.

---

## Export requests (right to portability)

`GET /api/portal/data-export` is fully self-service and requires no manual
fulfillment step — it streams the requester's own data directly. This runbook
does not cover it further; see the deletion-request handling above for the
manual half of data-subject-rights work.

---

## Implementation Reference

- Shared deletion-request logic (both entry points): `artifacts/api-server/src/lib/data-rights.ts`
- Customer self-service endpoints: `artifacts/api-server/src/routes/portal.ts` / `portal-privacy.ts`
- MSP-admin-initiated endpoint + MSP-facing view of request history: `artifacts/api-server/src/routes/msp-data-rights.ts`
- Wire contract detail: `docs/data-rights-and-privacy-contract-pack.md`
