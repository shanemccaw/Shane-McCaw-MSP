# Backup & Disaster Recovery Runbook

**Last reviewed:** 2026-07-11
**Owner:** Platform Operations

---

## 1. Backup Policy

### 1.1 Database (PostgreSQL via Replit)

| Property | Value |
|----------|-------|
| Provider | Replit managed PostgreSQL |
| Backup frequency | **Continuous WAL streaming** (point-in-time recovery available); logical snapshots taken **daily at 02:00 UTC** |
| Retention window | **7 days** of point-in-time recovery; most-recent daily snapshot retained for **30 days** |
| Backup location | Replit-managed object storage (US region) |
| Encryption at rest | AES-256 (Replit platform) |
| Backup verification | Monthly restore drill (see §3) |

> **Note for Phase 2:** Evaluate exporting daily `pg_dump` archives to an independently-owned S3 bucket (e.g. `us-east-1`) to eliminate single-vendor dependency.

### 1.2 File Storage

- Uploaded documents, generated PDFs, and contract files are stored via Replit object storage (same daily snapshot schedule as the database).
- Azure Key Vault (customer App Registration secrets) is managed by Azure and has its own independent backup with **geo-redundancy** enabled. No action required from platform ops.

---

## 2. Recovery Objectives

| Objective | Target | Notes |
|-----------|--------|-------|
| **RPO** (Recovery Point Objective) | ≤ 1 hour | Continuous WAL streaming limits data loss to the last ~60 minutes in a worst-case failure |
| **RTO** (Recovery Time Objective) | ≤ 4 hours | Time to restore database from last snapshot + replay WAL + restart services |
| **MTTR** (Mean Time to Recovery) | ≤ 2 hours | For common failure modes (service restart, connection pool exhaustion) |

---

## 3. Restore Procedure

### 3.1 Full Database Restore (Replit platform)

1. Log in to the Replit workspace as an owner.
2. Navigate to **Database** → **Backups** in the Replit dashboard.
3. Select the target restore point (point-in-time or daily snapshot).
4. Click **Restore** and confirm. The platform will provision a new database instance.
5. Update the `DATABASE_URL` secret in Replit Secrets to point to the restored instance URL.
6. Restart all workflows: API Server, CRM, Admin Panel, MSP Portal.
7. Verify via `GET /api/healthz` and `GET /api/admin/db-status` that migrations are current.
8. Run `pnpm --filter @workspace/scripts run migrate-prod` to ensure any pending DDL migrations are applied.

### 3.2 Monthly Restore Drill

Run this drill on the **first Monday of each month** in a staging environment:

```bash
# 1. Trigger a database export from Replit dashboard
# 2. Restore to a separate staging database
# 3. Point staging API server at restored DB
# 4. Run smoke tests:
curl https://<staging-domain>/api/healthz
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<staging-domain>/api/admin/db-status
# 5. Verify row counts are plausible:
# SELECT COUNT(*) FROM users;
# SELECT COUNT(*) FROM projects;
# SELECT COUNT(*) FROM invoices;
# 6. Document result in the ops log
```

---

## 4. Incident Response

### 4.1 Database Unreachable

1. Check `GET /api/healthz` — if DB pool errors are present, proceed.
2. Verify `DATABASE_URL` secret is set correctly.
3. Check Replit platform status at [status.replit.com](https://status.replit.com).
4. If Replit DB is degraded, escalate to Replit support with workspace ID.
5. If degraded > 30 minutes, initiate failover from last known good backup (§3.1).

### 4.2 Data Corruption Detected

1. Immediately set API server to read-only mode (set `READ_ONLY_MODE=true` env var; the API will return 503 on mutating requests).
2. Capture a `pg_dump` snapshot of the corrupted state for forensics.
3. Identify the corruption window from audit logs (`GET /api/admin/audit-logs`).
4. Restore to a point-in-time snapshot **before** the corruption event.
5. Replay any legitimate write operations from the audit log after the restore point.
6. Re-enable writes and notify affected customers.

---

## 5. Data Residency

- **v1 hosting:** United States only. All application servers, databases, and object storage run on Replit infrastructure hosted in US data centers.
- Customer data (profiles, project documents, invoices, M365 diagnostic data) never leaves US-region infrastructure in the current architecture.
- Azure Key Vault region: configured per customer App Registration — defaults to the region selected during vault provisioning. Operators should use `eastus` or `westus2` for US-only residency.

---

## 6. Related Runbooks

- `compliance-posture.md` — SOC 2 target, accessibility baseline, known v1 gaps
- `data-subject-rights.md` — customer data export and deletion request process
