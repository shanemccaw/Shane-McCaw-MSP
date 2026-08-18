Shipped: `GET /api/portal/customer/rescoring-status` (`portal-customer-engines.ts`, commit `69033c6e`) returning `lastScan` / `nextScheduledRun` / `coverage` — customer-facing, plain-language, no internal engine names or per-check breakdown.

- `lastScan` / `coverage`: from the customer's latest completed/partial `msp_diagnostic_runs` row (same source `scan-status` uses).
- `nextScheduledRun`: from the real `wf_triggers.next_run_at` for the seeded weekly **Copilot Assessment Rescan** (#1058, cron `0 3 * * 0`) — not the older Retargeting Rescan — gated on the same Assessment-tier + active-user + Graph-consent eligibility the seed's own fan-out query uses.
- Does not touch the rescan add-on purchase/checkout flow — SOW/billing pipeline's own concern, untouched.

Self-verified against live DB via `shaneapp://executeSql` (real trigger row, real testbed run data) before writing the endpoint. Extended `test-manifests/copilot-readiness/assessment-monitoring-rescan.json` with RESCORE E1-E4 and ran it via `shaneapp://runTest`: 20/28 passed — the 4 new steps 404 because the deployed dev origin predates this commit (documented redeploy gap, same class as this manifest's prior entries).

**Shane To-Do:** redeploy api-server, then re-run `test-manifests/copilot-readiness/assessment-monitoring-rescan.json` — the 4 RESCORE steps should go green against the real data already confirmed in the manifest's notes.
