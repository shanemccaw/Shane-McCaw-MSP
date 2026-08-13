# Data Subject Rights Runbook

**Last reviewed:** 2026-07-11
**Owner:** Platform Operations

---

## 1. Overview

This runbook documents how Shane McCaw Consulting LLC handles customer-initiated data rights requests under applicable privacy regulations (GDPR, CCPA, and equivalent). Two rights are supported:

1. **Right to data portability** — customer requests a copy of their own data
2. **Right to erasure ("right to be forgotten")** — customer requests deletion of their personal data

---

## 2. Data Export (Right to Portability)

### 2.1 Self-Service Path (v1)

Clients can request their own data export directly from the portal:

1. Log in to the client portal at `https://shanemccaw.com/crm/portal`.
2. Navigate to **Privacy & Data** in the left sidebar.
3. Click **Download My Data**.
4. The platform generates a JSON archive containing all tenant-owned data and returns it as a downloadable file.

**What is included in the export:**

| Data category | Contents |
|--------------|----------|
| Profile | Name, email, company, phone, created date |
| Projects | All projects with status, titles, descriptions |
| Documents | Document metadata (filenames, types, created dates); file content links where stored |
| Invoices | All invoice records (amounts, dates, status) — **no raw Stripe payment instrument data** |
| Messages | All message threads with Shane's team |
| M365 Profile | Microsoft 365 tenant profile data if collected |
| Client documents | Uploaded documents and generated reports |
| Audit activity | The client's own portal action history |
| Quiz results | Quick-win diagnostic results if completed |

**What is NOT included:**

- Stripe payment card details (held by Stripe under PCI-DSS; clients access this at stripe.com)
- Other clients' data
- Internal admin notes and workflow state not directly owned by the client

### 2.2 Supported Request Path

If the self-service export fails or is unavailable, the client may email `info@shanemccaw.com` with subject line `Data Export Request`. The operator will:

1. Log in to the Admin Panel.
2. Navigate to **CRM → Clients** and locate the client record.
3. Use the admin data-export endpoint to generate the archive.
4. Send the archive to the client's verified email address within **30 days** of the request.

---

## 3. Data Deletion (Right to Erasure)

### 3.1 Client-Initiated Request

Clients can submit a deletion request from the portal:

1. Log in to the client portal.
2. Navigate to **Privacy & Data** in the left sidebar.
3. Click **Request Account Deletion**.
4. Read and acknowledge the retention notice (see §3.2).
5. Submit the request.

The request is logged in the platform audit trail and an email notification is sent to the platform operator (`ADMIN_EMAIL`).

**SLA:** Deletion is completed within **30 days** of the verified request.

### 3.2 What Is Deleted vs. Retained

| Data | Action | Reason |
|------|--------|--------|
| User account (name, email, password hash) | **Deleted** | Personal data; no retention obligation |
| Project records, documents, messages | **Deleted** | Client-owned operational data |
| M365 profile data | **Deleted** | Tenant diagnostic data |
| App Registration credentials (Azure Key Vault) | **Deleted from Key Vault** | Sensitive secrets |
| Health history, quiz results | **Deleted** | Operational data |
| **Signed SOWs and contracts** | **Retained for 7 years** | Legal record-keeping obligation (contract law) |
| **Invoices and payment records** | **Retained for 7 years** | Financial/tax compliance obligation (IRS, accounting standards) |
| **Audit logs referencing the client** | **Retained for 3 years, then anonymized** | Security and compliance audit trail |

> **Customer communication:** When a deletion request is confirmed, the operator sends the following notice:
>
> *"Your personal data and all client-owned project data have been deleted from our platform. As required by law, signed contracts and invoices are retained for 7 years from the date of execution for legal and tax purposes — you will not receive marketing or service communications based on this data, and it is not shared with third parties. Audit log entries referencing your account are retained for 3 years for security purposes and are then anonymized."*

### 3.3 Operator Deletion Procedure

1. Receive deletion request notification email (sent automatically when client submits via portal).
2. Verify client identity: confirm the request came from the verified account email.
3. Log in to the Admin Panel → **CRM → Clients**.
4. Click the client record → **Delete Client**.
5. The Admin Panel shows a deletion preview listing all dependent records.
6. Confirm deletion. The platform cascades deletes across projects, documents, messages, and health data.
7. Manually delete the Azure Key Vault secret named `client-{id}-appreg` if present.
8. Send the retention notice email to the client's last known address (see §3.2 wording above).
9. Log the completion in the admin audit log with note `"data_erasure_completed"`.

---

## 4. Retention Schedule Summary

| Record type | Retention | Basis |
|------------|-----------|-------|
| Personal profile data | Until deletion request + 30-day processing window | Privacy obligation |
| Project / document data | Until deletion request + 30-day processing window | Client consent |
| Signed contracts / SOWs | **7 years** from signature date | Contract law |
| Invoices / payment records | **7 years** from invoice date | Tax / financial compliance |
| Audit logs | **3 years**, then anonymized | Security compliance |
| Backup snapshots | **30 days** (rolling) | Operational continuity |

---

## 5. Related Runbooks

- `backup-dr.md` — database backup policy, RTO/RPO, restore procedure
- `compliance-posture.md` — SOC 2 target, data residency statement, known v1 gaps
