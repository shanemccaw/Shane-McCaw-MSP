# Runbook: Azure Key Vault Credential Rotation

**Purpose:** How to rotate an MSP customer's Azure Key Vault credentials (App Registration client secret) without downtime.

---

## Background

Each MSP customer's Azure App Registration client secret is stored in Azure Key Vault using a **deterministic naming convention**: `client-{customerId}-appreg`. The platform stores only the `keyVaultSecretName` in the database — the actual secret value never enters the application database. Rotation overwrites the existing Key Vault secret rather than creating a new one.

Credential expiry is surfaced via the `/api/admin/azure-credentials/expiring-summary` endpoint 60 days before expiration.

---

## Trigger Condition

Use this runbook when:
- The Admin Panel → Script Runner → Credentials shows an **Expiring Soon** badge (within 60 days).
- A credential has already expired and Azure Automation runbooks are returning auth failures.
- A security incident requires emergency rotation of a customer's credentials.
- An MSP operator requests a planned rotation.

---

## Pre-checks

1. Confirm you have access to the **Admin Panel** (the credential routes use the legacy `requireAdmin` middleware — the `ADMIN_PASSWORD` bearer token, not an MSP JWT).
2. Verify that `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, and `AZURE_KEY_VAULT_URL` are set in Replit Secrets (the service principal used by this platform needs **Key Vault Secrets Officer** on the vault).
3. In the Azure portal, confirm you have permission to create a new client secret on the customer's App Registration.
4. Schedule the rotation during a low-traffic window if possible — the window between creating the new secret and uploading it to the vault is the only brief exposure point.

---

## Step-by-Step Procedure

### 1. Generate a new client secret in Azure AD

1. Log in to the [Azure Portal](https://portal.azure.com).
2. Navigate to **Azure Active Directory → App Registrations**.
3. Find the customer's App Registration (name or client ID is in the platform's credential record).
4. Go to **Certificates & secrets → Client secrets → + New client secret**.
5. Set a description (e.g., `platform-rotation-YYYY-MM`) and an expiry (recommend 24 months).
6. Click **Add** and **immediately copy** the new secret value — it is shown only once.

> **Important:** Do not delete the old secret yet. The new secret must be live in the vault first.

### 2. Upload the new secret to Key Vault via the Admin Panel

**Via Admin Panel:**
1. Navigate to **Admin Panel → Script Runner → Customers → [Customer] → Credentials**.
2. Open the credential edit form.
3. Paste the new secret value into the **Client Secret** field.
4. Save — the platform calls `PUT /api/admin/azure-credentials/<credentialId>` with the secret in the request body.

**Via API (two steps):**

First, find the credential record ID for this customer:
```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://<host>/api/admin/azure-credentials" | jq '.[] | select(.clientUserId == <customerId>) | .id'
```

Then update the credential, passing the new secret value as `clientSecretValue`:
```bash
curl -s -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"clientSecretValue":"<new-secret>"}' \
  "https://<host>/api/admin/azure-credentials/<credentialId>"
```

The server derives the Key Vault secret name as `client-{linkedClientId}-appreg`, where `linkedClientId` is the credential record's `clientUserId` value (i.e., the linked client/customer ID), falling back to the credential record's own `id` if `clientUserId` is null. The `keyVaultSecretName` column is updated in the DB to match the derived name. The credential DB record is only updated on success — a Key Vault write failure returns `502` and leaves the DB record unchanged.

### 3. Verify the new credential works

Run a test script against the customer's tenant to confirm the new secret authenticates correctly:

1. Navigate to **Admin Panel → Script Runner → [Customer] → Run Script**.
2. Select a lightweight read-only runbook (e.g., a diagnostic check).
3. Confirm the job completes without an `AADSTS70011` or `401 Unauthorized` error.

### 4. Delete the old secret in Azure AD

Once the new secret is verified:
1. Return to **Azure AD → App Registrations → [Customer App] → Certificates & secrets**.
2. Delete the old (now-superseded) client secret.

### 5. Update the expiry record

The expiry is read from Key Vault secret metadata on each call to `getSecretMetadata`. No manual DB update is needed — the next expiring-summary check will reflect the new expiry date.

---

## Emergency Rotation (Secret Compromised)

If a credential is suspected compromised, complete steps 1–4 as fast as possible with no scheduled window:

1. Immediately delete the compromised secret in Azure AD (step 4 first to stop attacker use).
2. Create a new secret (step 1).
3. Upload it (step 2).
4. Verify (step 3).
5. Raise an incident record per `incident-response.md`.

---

## Verification

1. Check `azure_tenant_credentials.updatedAt` is current in the Admin Panel.
2. The expiring-summary endpoint no longer shows this customer as expiring.
3. A test runbook completes successfully against the customer tenant.
4. No `AADSTS` errors appear in server logs for this customer.

---

## Escalation

If the Key Vault write fails or Azure AD permissions prevent secret creation:
- Check that the service principal (`AZURE_CLIENT_ID`) has **Key Vault Secrets Officer** on the vault (not just **Secrets User**).
- Check that the operator rotating in Azure AD has the **Application Administrator** or **Owner** role on that App Registration.
- Escalate to the platform engineer on call (see `incident-response.md`).

---

## Implementation Reference

- Key Vault client: `artifacts/api-server/src/lib/azure-keyvault.ts`
- Credential routes: `artifacts/api-server/src/routes/admin-azure-credentials.ts`
- DB table: `azure_tenant_credentials` (columns: `customerId`, `keyVaultSecretName`, `updatedAt`)
- Expiry horizon: 60 days (configurable in the expiring-summary query)
