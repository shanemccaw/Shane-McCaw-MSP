# `scripts/config-state/` — the configuration resource model pipeline (Git #1794)

Derives the tenant configuration **resource model** from published descriptions and
persists it as queryable data. Full explanation of the model, and what the first
extraction measured, is in [`docs/graph-resource-model.md`](../../docs/graph-resource-model.md).

**This pipeline never probes Microsoft Graph.** Three downloads of published material,
then a deliberately small read-only live sample. Blind endpoint enumeration is explicitly
out of scope — see the issue.

## Run order

```bash
node scripts/config-state/fetch-sources.mjs          # cache the 3 published sources
node scripts/config-state/build-resource-model.mjs   # build + reconcile + map checks
node scripts/config-state/verify-sample.mjs          # live READ-ONLY sample (testbed only)
```

Steps 1–2 need no tenant credentials. Step 3 uses `MT_APP_CLIENT_ID` /
`MT_APP_CLIENT_SECRET` and refuses to run against a tenant not flagged `is_testbed`.

All three are safely re-runnable. `build-resource-model.mjs` replaces the model wholesale
each run and records a new `config_model_extractions` row for provenance.

## Files

| File | Role |
|---|---|
| `sources.mjs` | Where the sources are, and the **data** defining the configuration surface: included container roots, excluded roots *with the reason*, excluded per-item path segments, workload/surface mapping |
| `fetch-sources.mjs` | Downloads Graph `$metadata` (v1.0 + beta), Microsoft's permissions reference, and the Microsoft365DSC tarball into gitignored `.cache/config-state/`; resolves and records the exact M365DSC commit |
| `parse-graph-metadata.mjs` | CSDL parser: types, properties, EntityContainer, bound Functions; walks containment navigation into real addressable configuration paths |
| `parse-graph-permissions.mjs` | Inverts Microsoft's permission→paths dataset into path→**any-of** app-only GET permissions |
| `parse-m365dsc.mjs` | Reads each DSC resource's `settings.json` (permissions, cmdlets, mode), `.schema.mof` (property model with allowed values) and `.psm1` (literal Graph URIs, invoked read cmdlets) |
| `map-monitor-checks.mjs` | Maps every `monitor_checks` row onto the model, recording the match basis, confidence and the exact string matched on |
| `build-resource-model.mjs` | The pipeline: parse → load the reachable Graph entity model → link DSC to Graph → emit `config_resources` + properties → reconcile availability against real grants → map the check catalog |
| `verify-sample.mjs` | Live read-only sample against the testbed. `GET` only, no templated paths, no bound Functions, `$top=1`, serialised. Stores **shape only** — property names and JSON types, never values |
| `db.mjs` | Direct local Postgres connection via `DATABASE_URL`, plus chunked multi-row insert |

## Things worth knowing before changing any of this

- **Two permission columns are not redundant.** `required_app_permissions` is Microsoft365DSC's
  **ALL-OF** set; `graph_read_permission_options` is Microsoft's **ANY-OF** set. Merging them
  misreports availability in both directions.
- **`needs_license` is live-evidence-only.** No published source states license requirements,
  so only `verify-sample.mjs` may set it, and only from a real Graph response.
- **Actions are never emitted as read paths** — only OData Functions, which are
  side-effect-free by definition. That is what keeps a read model structurally unable to
  suggest a write.
- **Eight of the 536 `.schema.mof` files are UTF-16LE.** Reading them as UTF-8 parses to zero
  properties silently. `parse-m365dsc.mjs` decodes by BOM.
- **142 Exchange/Purview DSC resources declare no `commands` block.** Their real cmdlets appear
  only in the module body, so `parse-m365dsc.mjs` extracts invoked read cmdlets from the
  `.psm1` too. Without that, the whole Exchange workload has no cmdlet in the model and every
  Exchange monitor check reads as unmatched.
- **`services/ps-execution/cmdlet-catalog.ps1` is parsed with real brace matching.** Some
  entries are `Script = { … }` blocks several levels deep; a non-greedy regex truncates at the
  first inner `}` and loses the cmdlet entirely.
