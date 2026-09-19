-- #4579 — appgov:cert-secret-expiration: add a combined expired-credential total.
-- Additive: appends one mapping rule (sumOf transform, monitor-executor.ts) AFTER the
-- two rules it sums; expiredPasswordCredentialCount / expiredKeyCredentialCount are kept.
-- "expired" (olderThanDays 0), not "expiring soon" — a forward window is a separate decision (#541).
BEGIN;
UPDATE monitor_checks
SET mapping = mapping || '[{"sourceField":"*","targetField":"expiredCredentialCount","transform":"sumOf(''expiredPasswordCredentialCount'',''expiredKeyCredentialCount'')"}]'::jsonb,
    schema_version = schema_version + 1,
    updated_at = now()
WHERE key = 'appgov:cert-secret-expiration'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(mapping) e WHERE e->>'targetField' = 'expiredCredentialCount');

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-19-cert-secret-expiration-combined-total-4579.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;
