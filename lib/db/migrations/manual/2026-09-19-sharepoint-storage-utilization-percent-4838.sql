-- #4838 — sharepoint:storage-utilization read /sites `id` (a hostname) into
-- sharepointStorageUsagePercent. Repoint at the code-owned sharepoint-admin op
-- `tenant-storage-utilization` (Tenant.StorageQuota + Graph usage-storage report).
BEGIN;
UPDATE monitor_checks
SET executor_type = 'sharepoint-admin',
    sp_operation  = 'tenant-storage-utilization',
    endpoint      = '(unused — executor_type=sharepoint-admin drives dispatch, not endpoint)',
    properties    = '[]'::jsonb,
    mapping       = '[{"transform":"first","sourceField":"sharepointStorageUsagePercent","targetField":"sharepointStorageUsagePercent"},{"transform":"first","sourceField":"sharepointStorageUsedBytes","targetField":"sharepointStorageUsedBytes"},{"transform":"first","sourceField":"sharepointStorageQuotaBytes","targetField":"sharepointStorageQuotaBytes"}]'::jsonb,
    updated_at    = now()
WHERE key = 'sharepoint:storage-utilization';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-19-sharepoint-storage-utilization-percent-4838.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;
