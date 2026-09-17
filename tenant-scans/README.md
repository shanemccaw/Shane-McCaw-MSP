# tenant-scans/

Exports of real, completed diagnostics scans, committed so a session can read them directly (Git #4471).

## Naming

`<YYYY-MM-DD>-<tenant>-<scope>.json`, dated by the scan's UTC completion day. Each export has a companion
`*.index.json`: the same findings and remediation cross-reference without the raw evidence payloads, small
enough to read in one pass. The full file keeps every finding's `evidence` (its `extracted_properties`).

## How an export is produced

1. Run the scan in its own process, so a dev-server restart cannot kill it:
   `node artifacts/api-server/run-script.mjs src/scripts/run-full-scan-4471.ts <tenants.id>`
   This calls `runDiagnostics()` with the package resolved the same way the MSP re-check route does.
2. Export the completed run. The script refuses a run that is still running or failed:
   `node artifacts/api-server/run-script.mjs src/scripts/export-scan-findings-4471.ts <runId> tenant-scans/<name>.json`

Every value comes from that run's rows and the live catalog tables. `method` in the file defines the remediation
buckets (`executable` / `knowledge_base_only` / `none`) and cites the source lines each rule comes from, and
`sourceCommit` records the commit the export was run at.

## Files

- `2026-09-17-testbed-full-scan.json`: mccawsoft2 testbed (`tenants.id` 2080), `core:premier`, run
  `d1dc0ffe-db89-403a-91b9-d94b77d873b6`.
