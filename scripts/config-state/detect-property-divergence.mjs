#!/usr/bin/env node
/**
 * #1846 — Persist the divergence between what Graph `$metadata` declares and what Graph
 * actually returns live.
 *
 * #1794's live sample found Graph returning properties (`createdDateTime`, `domainName`,
 * `extensionAttributes`, `externalSourceName`, `sourceType` on `/devices`; `createdDateTime`
 * on `/servicePrincipals`) that its own published `$metadata` does not declare for those
 * resources. That was a one-off query result recorded in a doc — this makes it durable,
 * queryable data that a later run keeps current, not a snapshot of 2026-08-30.
 *
 * Two real cases, distinguished because they have different implications:
 *   - version_gap          the property IS declared, just in the OTHER Graph version's
 *                           `$metadata` (typically beta) — a versioning gap.
 *   - undeclared_anywhere  the property is declared in NEITHER v1.0 nor beta `$metadata` —
 *                           Graph returning something no published CSDL document describes.
 *                           Nobody can anticipate this class; it must be visible on its own.
 *
 * This does not re-derive the Graph half of the model (no re-parsing of $metadata/DSC) and
 * makes no Graph calls itself — it reads the evidence `verify-sample.mjs` already recorded in
 * `config_resource_samples` (the newest successful sample per resource) and reconciles it
 * against the already-parsed `graph_entity_types` / `graph_entity_properties` tables.
 *
 * Deliberately keyed on `config_resources.resource_key`, not `config_resources.id` — see the
 * schema comment on `configResourcePropertyDivergenceTable` (`lib/db/src/schema/config-state.ts`)
 * for why a hard FK to that volatile serial id would repeat the #1895 bug class.
 *
 * Usage: node scripts/config-state/detect-property-divergence.mjs
 * Also called from verify-sample.mjs after every live sample, so a later run surfaces newly
 * observed undeclared properties automatically.
 */
import { pathToFileURL } from "node:url";
import { connect } from "./db.mjs";

/**
 * Recompute the divergence table from whatever is currently in `config_resource_samples`.
 * Safe to call repeatedly and safe to call with an empty samples table (no-op, 0 detected) —
 * it never deletes prior findings, only refreshes what the current evidence supports.
 */
export async function detectPropertyDivergence(client) {
  // The newest OK sample per resource is "current reality"; older samples for the same
  // resource are superseded, not accumulated, so a property that stops appearing does not
  // keep inflating a divergence count forever.
  const observed = await client.query(`
    WITH latest_sample AS (
      SELECT DISTINCT ON (config_resource_id) *
        FROM config_resource_samples
       WHERE ok
       ORDER BY config_resource_id, observed_at DESC
    )
    SELECT r.id AS config_resource_id, r.resource_key, r.graph_path, r.graph_version,
           r.graph_entity_type, ls.sample_run_id, o AS property_name,
           ls.observed_shape ->> o AS observed_json_type
      FROM latest_sample ls
      JOIN config_resources r ON r.id = ls.config_resource_id,
           jsonb_array_elements_text(ls.observed_property_names) o
     WHERE NOT EXISTS (
       SELECT 1 FROM config_resource_properties p
        WHERE p.config_resource_id = r.id
          AND p.source = 'graph-metadata' AND p.name = o
     )
     ORDER BY r.resource_key, o`);

  let versionGap = 0;
  let undeclaredAnywhere = 0;
  const rowsOut = [];

  for (const row of observed.rows) {
    // Declared elsewhere? Re-derived fresh every run, keyed on the qualified entity type name,
    // which is stable across graph_version — exactly the join the issue's own reproduce query
    // uses. If this resource's OWN version declared it, the row would not be in `observed`
    // above (it would have matched config_resource_properties), so any hit here is necessarily
    // the OTHER version.
    let declaredInGraphVersions = [];
    if (row.graph_entity_type) {
      const declared = await client.query(
        `SELECT DISTINCT t.graph_version
           FROM graph_entity_types t
           JOIN graph_entity_properties p ON p.entity_type_id = t.id
          WHERE t.qualified_name = $1 AND p.name = $2
          ORDER BY 1`,
        [row.graph_entity_type, row.property_name],
      );
      declaredInGraphVersions = declared.rows.map((r) => r.graph_version);
    }
    const divergenceClass = declaredInGraphVersions.length > 0 ? "version_gap" : "undeclared_anywhere";
    if (divergenceClass === "version_gap") versionGap++; else undeclaredAnywhere++;

    await client.query(
      `INSERT INTO config_resource_property_divergence
         (resource_key, config_resource_id, graph_path, graph_version, graph_entity_type,
          property_name, divergence_class, declared_in_graph_versions, observed_json_type,
          last_sample_run_id, observation_count, first_observed_at, last_observed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,now(),now())
       ON CONFLICT (resource_key, property_name) DO UPDATE SET
         config_resource_id = EXCLUDED.config_resource_id,
         graph_path = EXCLUDED.graph_path,
         graph_version = EXCLUDED.graph_version,
         graph_entity_type = EXCLUDED.graph_entity_type,
         divergence_class = EXCLUDED.divergence_class,
         declared_in_graph_versions = EXCLUDED.declared_in_graph_versions,
         observed_json_type = EXCLUDED.observed_json_type,
         last_sample_run_id = EXCLUDED.last_sample_run_id,
         observation_count = config_resource_property_divergence.observation_count + 1,
         last_observed_at = now()`,
      [
        row.resource_key, row.config_resource_id, row.graph_path, row.graph_version,
        row.graph_entity_type, row.property_name, divergenceClass,
        JSON.stringify(declaredInGraphVersions), row.observed_json_type, row.sample_run_id,
      ],
    );
    rowsOut.push({ ...row, divergenceClass, declaredInGraphVersions });
  }

  return { total: observed.rows.length, versionGap, undeclaredAnywhere, rows: rowsOut };
}

async function main() {
  const client = await connect();
  try {
    const result = await detectPropertyDivergence(client);
    console.log(`Property divergence detection: ${result.total} observed-but-undeclared properties found`);
    console.log(`  ${result.versionGap} version_gap (declared in the other Graph version)`);
    console.log(`  ${result.undeclaredAnywhere} undeclared_anywhere (in neither v1.0 nor beta)`);
    for (const r of result.rows) {
      console.log(`  ${r.divergenceClass.padEnd(20)} ${r.resource_key}  ${r.property_name}`);
    }
    if (result.total === 0) {
      console.log("  (no OK rows in config_resource_samples — run verify-sample.mjs first)");
    }
  } finally {
    await client.end();
  }
}

// Only run as a CLI entry point when invoked directly, not when imported by verify-sample.mjs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`detect-property-divergence failed: ${err.stack ?? err.message}`);
    process.exit(1);
  });
}
