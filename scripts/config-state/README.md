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
node scripts/config-state/build-resource-model.mjs   # build + reconcile + resolve duplicates + map checks
node scripts/config-state/derive-ps-shapes-from-dsc.mjs # #1853 — derive shapes for shapeless PS survey cmdlets
node scripts/config-state/verify-sample.mjs          # live READ-ONLY sample (testbed only)
node scripts/config-state/build-snapshot-registry.mjs # #1795 — populate the snapshot registry
```

Steps 1–2 need no tenant credentials. Step 3 (`derive-ps-shapes-from-dsc.mjs`) reads only
what's already in the local database — `config_resources`/`config_resource_properties` from
step 2 and `ps_capability_survey_results` from #1793's survey — and needs no tenant
credentials either. Step 4 uses `MT_APP_CLIENT_ID` /
`MT_APP_CLIENT_SECRET` and refuses to run against a tenant not flagged `is_testbed`. Step 4
also calls `detect-property-divergence.mjs` (Git #1846) itself, so the
`$metadata`-vs-observed divergence table stays current on every sample; re-run
`node scripts/config-state/render-property-divergence-doc.mjs` afterwards to regenerate the
doc section from it.

All four are safely re-runnable. `build-resource-model.mjs` replaces the model wholesale
each run and records a new `config_model_extractions` row for provenance.

`build-snapshot-registry.mjs` (Git #1795) is the exception to "replaces wholesale" and
deliberately so: it **UPSERTs and never deletes**. It feeds the snapshot store, whose rows are
immutable evidence keyed by the stable text `resource_key`, so a resource that leaves
`config_resources` is *retired* in the registry rather than removed — deleting it would strip
the meaning from snapshot objects that already reference that key. Re-run it after
`build-resource-model.mjs` so the registry's cached availability and shape provenance track the
rebuilt model.

## Files

| File | Role |
|---|---|
| `sources.mjs` | Where the sources are, and the **data** defining the configuration surface: included container roots, excluded roots *with the reason*, excluded per-item path segments, workload/surface mapping |
| `fetch-sources.mjs` | Downloads Graph `$metadata` (v1.0 + beta), Microsoft's permissions reference, and the Microsoft365DSC tarball into gitignored `.cache/config-state/`; resolves and records the exact M365DSC commit |
| `parse-graph-metadata.mjs` | CSDL parser: types, properties, EntityContainer, bound Functions; walks containment navigation into real addressable configuration paths |
| `parse-graph-permissions.mjs` | Inverts Microsoft's permission→paths dataset into path→**any-of** app-only GET permissions |
| `parse-m365dsc.mjs` | Reads each DSC resource's `settings.json` (permissions, cmdlets, mode), `.schema.mof` (property model with allowed values) and `.psm1` (literal Graph URIs, invoked read cmdlets) |
| `map-monitor-checks.mjs` | Maps every `monitor_checks` row onto the model, recording the match basis, confidence and the exact string matched on. Prefers the CANONICAL row when two rows carry the same `graph_path` (#2821) |
| `resolve-canonical-resources.mjs` | Git #2821 — resolves `origin='m365dsc'` rows onto the `origin='graph-metadata'`/`'both'` row that models the same real tenant object, so a duplicate stops counting as an independent, permanently-uncoverable resource. Two evidence rules (`same-graph-path`, `dsc-cmdlet-path-walk`) behind two precision gates (name correspondence, target uniqueness); anything unresolved gets a `canonical_gap_reason` rather than being dropped. LINKS, never merges — the m365dsc row keeps its own MOF shape, cmdlets and permission set. Runs inside `build-resource-model.mjs` and is also runnable standalone (`--dry-run`, `--verbose`) against the current model, needing no credentials or source cache |
| `build-resource-model.mjs` | The pipeline: parse → load the reachable Graph entity model → link DSC to Graph → emit `config_resources` + properties → reconcile availability against real grants → map the check catalog |
| `verify-sample.mjs` | Live read-only sample against the testbed. `GET` only, no templated paths, no bound Functions, `$top=1`, serialised. Stores **shape only** — property names and JSON types, never values. Calls `detect-property-divergence.mjs` at the end of every run |
| `detect-property-divergence.mjs` | Git #1846 — recomputes `config_resource_property_divergence` from whatever is currently in `config_resource_samples`: properties Graph returned live with no matching `graph-metadata` property row, classified `version_gap` (declared in the other Graph version) vs `undeclared_anywhere` (declared in neither). Keyed on the stable `resource_key`, not the volatile `config_resources.id`, so a model rebuild can't cascade-delete it (see #1895) |
| `render-property-divergence-doc.mjs` | Git #1846 — regenerates the generated section of `docs/graph-resource-model.md` from `config_resource_property_divergence` |
| `build-snapshot-registry.mjs` | Git #1795 — populates `config_snapshot_resource_types`, the snapshot store's registry of what the collector may collect. Derives the **identity strategy** no published source states (Graph CSDL `<Key>` resolved through `BaseType` inheritance; DSC `Identity`/MOF Key parameters), marks a type non-collectable when identity is `unresolved` or its transport has no executor, and labels shape provenance `observed_live` vs `derived_from_dsc` per #1853. UPSERT only, never DELETE |
| `reconcile-ps-survey.mjs` | Git #1865 — reconciles powershell-transport `config_resources.availability` against #1793's real survey results (an `ok` cmdlet upgrades a derived verdict to live-confirmed; a negative status downgrades it). Availability only — not shape |
| `derive-ps-shapes-from-dsc.mjs` | Git #1853 — for the `ok` survey cmdlets whose `property_names` is null (the tenant has zero instances of that resource), matches the cmdlet against `config_resources.read_cmdlets` (powershell transport) and copies the matched resource's non-connection `config_resource_properties` names onto new `ps_capability_survey_results` columns (`derived_property_names`, `derived_from_m365dsc_resources`, `shape_derivation`), labelled `derived_from_dsc` and never written into `property_names`. Unmatched cmdlets get `derivation_gap_reason` instead of being left silently unlabeled. Safely re-runnable; run after `build-resource-model.mjs` so it sees the current DSC-derived model |
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
- **Canonical resolution LINKS; it must never MERGE (#2821).** A duplicate `m365dsc` row's
  MOF property model, `read_cmdlets` and DSC ALL-OF permission set are real and are read by
  `derive-ps-shapes-from-dsc.mjs` and `build-snapshot-registry.mjs`. Folding it into the
  graph row would destroy all three and force a decision about whose shape wins — a decision
  nothing needs to make, because only coverage CREDIT has to be unified.
- **Erring toward NOT linking is deliberate, and the two gates are why.** A false link
  credits a genuinely uncovered resource with another row's coverage and *hides a real gap* —
  strictly worse than leaving it unlinked, which is just the status quo plus a stated reason.
  So a cmdlet noun resolving to a real path is not sufficient on its own: 184 DSC resources
  invoke `Get-MgGroup` and 46 invoke `Get-MgBetaDeviceManagementDeviceConfiguration` to
  resolve an id or read a shared polymorphic collection. The DSC resource's own name must
  also account for the path word-for-word (only a trailing `Policy` is treated as noise —
  adding `Settings` to that list immediately mislinked `AADGroupsSettings` onto `/groups`),
  and no other DSC resource may claim the same path.
