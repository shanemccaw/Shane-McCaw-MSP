/**
 * #1895 — Shared reconciliation between `config_resource_samples` (accumulated, NEVER
 * wiped, live Graph evidence) and `config_resources` (fully derived, DELETEd and
 * re-INSERTed from scratch by `build-resource-model.mjs` on every run).
 *
 * Both `verify-sample.mjs` (right after it inserts a fresh sample run) and
 * `build-resource-model.mjs` (right after it rebuilds `config_resources`) call the
 * functions here, so the two callers can never drift on what counts as a live
 * license/feature gap — there is exactly one definition of that condition, not two
 * copies that could go out of sync.
 */

/**
 * `config_resource_samples.config_resource_id` is a best-effort pointer, not a FK
 * (see the schema comment on `configResourceSamplesTable`) — `build-resource-model.mjs`
 * reissues `config_resources.id` from scratch on every rebuild, so an id recorded at
 * sample time can go stale. `resource_key` is the stable identity; re-point every
 * sample's `config_resource_id` at whatever id `resource_key` resolves to right now.
 *
 * A sample whose `resource_key` no longer exists in the freshly-rebuilt model (the
 * resource was retired from the published sources) is left with its old, now-dangling
 * id and reported as `orphaned` — surfaced, not silently dropped.
 */
export async function refreshSampleResourceLinks(client) {
  const relinked = await client.query(`
    UPDATE config_resource_samples s
       SET config_resource_id = r.id
      FROM config_resources r
     WHERE r.resource_key = s.resource_key
       AND s.config_resource_id IS DISTINCT FROM r.id`);
  const orphaned = await client.query(`
    SELECT count(*)::int AS n
      FROM config_resource_samples s
     WHERE NOT EXISTS (SELECT 1 FROM config_resources r WHERE r.resource_key = s.resource_key)`);
  return { relinked: relinked.rowCount ?? 0, orphaned: orphaned.rows[0].n };
}

/**
 * Re-applies `verification_status` (`verified_live` / `failed_live`) and the ONLY
 * evidence that may ever set `availability = 'needs_license'` onto `config_resources`,
 * from `config_resource_samples`.
 *
 * Pass `sampleRunId` to scope to one just-inserted run (what `verify-sample.mjs` wants
 * right after it samples). Omit it to reconcile from the latest sample per resource
 * across ALL accumulated history (what `build-resource-model.mjs` wants after a
 * rebuild has just reset every resource to its purely-derived verdict, so evidence
 * from earlier runs is restored even though this run didn't re-sample anything).
 */
export async function applyLiveEvidence(client, { sampleRunId = null } = {}) {
  const latestCte = sampleRunId
    ? `SELECT resource_key, ok, error_code, error_message
         FROM config_resource_samples
        WHERE sample_run_id = $1`
    : `SELECT DISTINCT ON (resource_key) resource_key, ok, error_code, error_message
         FROM config_resource_samples
        ORDER BY resource_key, observed_at DESC, id DESC`;
  const params = sampleRunId ? [sampleRunId] : [];

  const verified = await client.query(
    `WITH latest AS (${latestCte})
     UPDATE config_resources r
        SET verification_status = 'verified_live', updated_at = now()
       FROM latest l
      WHERE l.resource_key = r.resource_key AND l.ok = TRUE`,
    params,
  );
  const failed = await client.query(
    `WITH latest AS (${latestCte})
     UPDATE config_resources r
        SET verification_status = 'failed_live', updated_at = now()
       FROM latest l
      WHERE l.resource_key = r.resource_key AND l.ok = FALSE`,
    params,
  );
  // A live license/feature gap is the ONLY evidence that may set needs_license.
  const licenseGap = await client.query(
    `WITH latest AS (${latestCte})
     UPDATE config_resources r
        SET availability = 'needs_license',
            availability_reason = 'live read returned a license/feature gap: ' || l.error_code,
            updated_at = now()
       FROM latest l
      WHERE l.resource_key = r.resource_key AND l.ok = FALSE
        AND (l.error_message ILIKE '%license%' OR l.error_code IN ('ResourceNotFound', 'NotLicensed'))
      RETURNING r.resource_key`,
    params,
  );

  return {
    verifiedCount: verified.rowCount ?? 0,
    failedCount: failed.rowCount ?? 0,
    licenseGapKeys: licenseGap.rows.map((r) => r.resource_key),
  };
}
