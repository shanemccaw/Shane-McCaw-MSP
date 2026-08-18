SELECT status, COUNT(*)::text AS n
FROM msp_job_queue
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;

SELECT (resolved_at IS NOT NULL) AS resolved, COUNT(*)::text AS n
FROM msp_dlq_store
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY resolved;

SELECT status, COUNT(*)::text AS n
FROM outbound_webhook_deliveries
WHERE attempted_at > NOW() - INTERVAL '24 hours'
GROUP BY status;

SELECT status, COUNT(*)::text AS n
FROM portal_wf_runs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;

SELECT pg_size_pretty(pg_database_size(current_database())) as size,
       pg_database_size(current_database())::text as bytes;

SELECT
  (count(*)::float / NULLIF((SELECT setting::int FROM pg_settings WHERE name = 'max_connections'), 0)) as saturation,
  count(*)::text as active,
  (SELECT setting FROM pg_settings WHERE name = 'max_connections')::text as max
FROM pg_stat_activity;
