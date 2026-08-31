#!/usr/bin/env node
/**
 * #1853 — Derive property shapes for #1793's shapeless `ok` cmdlets from
 * Microsoft365DSC's own resource definitions.
 *
 * 130 of 337 working cmdlets in the latest completed survey run returned `ok` with
 * `item_count = 0`: the cmdlet genuinely works app-only, but this tenant has no
 * instance of that resource, so #1793 had nothing to read a shape off. Re-running
 * the survey cannot change that — the gap is in the tenant's data, not the cmdlet.
 *
 * Shane's recorded decision on #1853 (option 2, over #1852's OutputType metadata
 * and seeding real tenant instances, both explicitly rejected): take the property
 * set from Microsoft365DSC's resource definitions instead. #1794 already parsed
 * every DSC resource's `.schema.mof` into `config_resource_properties`
 * (`source = 'm365dsc-mof'`) when it built `config_resources` — this script does not
 * re-parse DSC, it MATCHES each shapeless cmdlet to the `config_resources` row(s)
 * that already declare it as a read cmdlet, and copies the non-connection property
 * names across.
 *
 * Hard rules, per #1853:
 *   - NEVER writes `property_names` — that column is live-observed evidence only.
 *     This script only ever touches the five `derived_*` / `shape_*` columns added
 *     by the matching migration, and only for rows where `property_names IS NULL`.
 *   - NEVER infers a shape from a similarly-named cmdlet or a family resemblance —
 *     the only match this script trusts is an exact (case-insensitive) cmdlet name
 *     appearing in `config_resources.read_cmdlets`.
 *   - Where no DSC resource matches, or the matched resource(s) publish zero
 *     non-connection properties, the row is left shapeless and `derivation_gap_reason`
 *     records exactly why — a recorded gap, not a silent omission.
 *   - Idempotent / safely re-runnable: re-run after `build-resource-model.mjs`
 *     rebuilds `config_resources` to pick up any change in the DSC-derived model.
 *
 * Usage:
 *   node scripts/config-state/derive-ps-shapes-from-dsc.mjs [--run <id>] [--dry-run]
 */
import { connect } from "./db.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const RUN_ARG = process.argv.includes("--run") ? Number(process.argv[process.argv.indexOf("--run") + 1]) : null;

async function loadRun(client) {
  const { rows } = await client.query(
    RUN_ARG
      ? `SELECT id, container_revision FROM ps_capability_survey_runs WHERE id = $1`
      : `SELECT id, container_revision FROM ps_capability_survey_runs WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1`,
    RUN_ARG ? [RUN_ARG] : [],
  );
  if (rows.length === 0) {
    throw new Error("no completed ps_capability_survey_runs row found — run the survey first, or pass --run <id>");
  }
  return rows[0];
}

/** All powershell-transport DSC resources, with their read cmdlets and real (non-connection) property names. */
async function loadPowershellResources(client) {
  const { rows } = await client.query(`
    SELECT cr.id, cr.resource_key, cr.read_cmdlets,
           COALESCE(
             (SELECT array_agg(crp.name ORDER BY crp.ordinal, crp.name)
                FROM config_resource_properties crp
               WHERE crp.config_resource_id = cr.id
                 AND crp.source = 'm365dsc-mof'
                 AND crp.is_connection_parameter = false),
             ARRAY[]::text[]
           ) AS property_names
      FROM config_resources cr
     WHERE cr.read_transport = 'powershell'
  `);
  // cmdlet (lowercased) -> [{ resourceKey, propertyNames }]
  const byCmdlet = new Map();
  for (const r of rows) {
    const cmdlets = Array.isArray(r.read_cmdlets) ? r.read_cmdlets : [];
    for (const c of cmdlets) {
      const key = String(c).toLowerCase();
      if (!byCmdlet.has(key)) byCmdlet.set(key, []);
      byCmdlet.get(key).push({ resourceKey: r.resource_key, propertyNames: r.property_names });
    }
  }
  return byCmdlet;
}

async function main() {
  const client = await connect();
  try {
    const run = await loadRun(client);
    const byCmdlet = await loadPowershellResources(client);

    const { rows: shapeless } = await client.query(
      `SELECT id, session_type, cmdlet_name
         FROM ps_capability_survey_results
        WHERE run_id = $1 AND status = 'ok' AND property_names IS NULL`,
      [run.id],
    );

    const stats = { total: shapeless.length, derived: 0, noResourceMatch: 0, matchedButEmpty: 0, bySession: {} };
    for (const r of shapeless) {
      stats.bySession[r.session_type] ??= { total: 0, derived: 0, gap: 0 };
      stats.bySession[r.session_type].total++;
    }

    for (const row of shapeless) {
      const matches = byCmdlet.get(row.cmdlet_name.toLowerCase()) ?? [];

      if (matches.length === 0) {
        stats.noResourceMatch++;
        stats.bySession[row.session_type].gap++;
        const reason = `No Microsoft365DSC resource declares ${row.cmdlet_name} as a read cmdlet (checked ${byCmdlet.size} distinct powershell-transport cmdlets from #1794's model).`;
        if (!DRY_RUN) {
          await client.query(
            `UPDATE ps_capability_survey_results
                SET derivation_gap_reason = $2, shape_derived_at = now()
              WHERE id = $1`,
            [row.id, reason],
          );
        }
        continue;
      }

      const propertyNames = [...new Set(matches.flatMap((m) => m.propertyNames))].sort();
      const resourceKeys = [...new Set(matches.map((m) => m.resourceKey))].sort();

      if (propertyNames.length === 0) {
        stats.matchedButEmpty++;
        stats.bySession[row.session_type].gap++;
        const reason = `Matched Microsoft365DSC resource(s) ${resourceKeys.join(", ")} for ${row.cmdlet_name}, but the schema declares zero non-connection properties.`;
        if (!DRY_RUN) {
          await client.query(
            `UPDATE ps_capability_survey_results
                SET derivation_gap_reason = $2, shape_derived_at = now()
              WHERE id = $1`,
            [row.id, reason],
          );
        }
        continue;
      }

      stats.derived++;
      stats.bySession[row.session_type].derived++;
      if (!DRY_RUN) {
        await client.query(
          `UPDATE ps_capability_survey_results
              SET derived_property_names = $2::jsonb,
                  derived_from_m365dsc_resources = $3::jsonb,
                  shape_derivation = 'derived_from_dsc',
                  derivation_gap_reason = NULL,
                  shape_derived_at = now()
            WHERE id = $1`,
          [row.id, JSON.stringify(propertyNames), JSON.stringify(resourceKeys)],
        );
      }
    }

    console.log(`${DRY_RUN ? "[dry-run] " : ""}run #${run.id} (${run.container_revision ?? "no revision recorded"})`);
    console.log(`  shapeless ok cmdlets: ${stats.total}`);
    console.log(`  derived from DSC:     ${stats.derived} (${((stats.derived / stats.total) * 100).toFixed(1)}%)`);
    console.log(`  no DSC resource match:${stats.noResourceMatch}`);
    console.log(`  matched, zero props:  ${stats.matchedButEmpty}`);
    for (const [session, s] of Object.entries(stats.bySession).sort()) {
      console.log(`  ${session}: ${s.total} shapeless, ${s.derived} derived, ${s.gap} gap`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
