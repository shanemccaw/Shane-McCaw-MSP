# scripts/db/

## `reset-dev-database.mjs` — reset the local dev DB to a clean-slate MSP (Git #4393)

Resets the real direct MSP (the `msps` row with `is_direct_business = true`) back to a
freshly-purchased, no-customers-yet state: its tenants/customers and all their downstream
data gone, its MSP-staff logins intact, every other MSP (including vitest/test fixtures)
completely untouched. This is the reusable, self-service version of the one-off reset #4272
executed by hand.

```
node scripts/db/reset-dev-database.mjs --dry-run   # BEGIN...ROLLBACK only -- prints the plan, changes nothing
node scripts/db/reset-dev-database.mjs              # real reset -- backs up first, then prompts to confirm
node scripts/db/reset-dev-database.mjs --yes        # real reset -- skips the confirmation prompt
```

**Safety floor:** refuses to run against anything whose `DATABASE_URL` doesn't look like the
real local dev database (host must be `localhost`/`127.0.0.1`, and the URL can't match a
remote-hosting pattern like `neon.tech`/`replit`/`amazonaws`/`rds.`/`supabase`). This script
never runs against Staging/Replit or production, by design — not a flag, a hard refusal.

**What it does, in order:**
1. Live-derives the target MSP (`is_direct_business = true`) — never a hardcoded id.
2. Reuses `find-tenant-scoped-tables.mjs` (#4313, imported not reimplemented) to discover —
   live, from real `information_schema` FK edges — every table transitively reachable from
   `tenants`/`users`/`msps`. This is the reset candidate population; nothing here hardcodes a
   stale table list.
3. Computes each table's real SQL scope via a fixpoint over **every** real FK edge from that
   table into an already-scoped parent (not just the first/shortest edge the closure tool
   reports for display) — so a table with more than one path into scope is correctly scoped by
   the OR of all of them.
4. Deletes in reverse-resolution order (children before the parent tables their own scope
   query reads from) inside a `BEGIN...ROLLBACK` dry run first, then the real transaction.
5. Leaves two curated exception sets alone, both real audited decisions from #4271 (not
   re-derivable from FK shape alone) — see the script's own header comment for the full lists:
   - 26 MSP-authored-config tables (§4) — e.g. `policy_rules`, `msp_sops`.
   - 9 tables with genuinely no FK path to any root (§6) — global workflow-execution history,
     full-wiped unconditionally (`wf_runs`, `wf_run_node_logs`, etc.).
6. Takes a fresh timestamped `pg_dump -Fc` backup to `C:\Source\ShaneMcCawConsulting\db-backups\`
   before any real change, verified with `pg_restore --list`.
7. Prints real before/after row counts for every table that changed, then checks
   `GET /api/health` and the MSP-staff login count to confirm the platform still boots and
   staff logins survived.

**Other MSPs (including vitest fixtures) need no hardcoded id list to stay safe** — they're
protected because their rows never match the live target-MSP scope, not because their ids are
enumerated anywhere in this script. That's also why the script keeps working correctly as new
vitest fixtures are added or removed over time.

**Known live gap this script works around (filed as #4399):** a handful of real per-MSP/
per-customer columns (`msp_refresh_tokens.user_id`, and `msp_id`/`customer_id` on
`sla_breaches`/`sla_compliance_records`/`sla_timers`) have no enforced `FOREIGN KEY`
constraint in the live schema, so the FK-based closure discovery in step 2 can't see them on
its own. The script injects synthetic edges for these (`UNCONSTRAINED_FK_SHAPED_EDGES` in the
script) so they're still scoped correctly. If #4399 is ever fixed (the constraints added), the
manual entries become redundant but harmless — remove them once confirmed.

## `find-tenant-scoped-tables.mjs` — live FK-reachability report (Git #4313)

Reports, from real `information_schema` FK edges, every table transitively reachable from a
given set of root tables (default `tenants,users,msps`). Read-only, makes no schema/data
change. See the script's own header comment for full usage. `reset-dev-database.mjs` imports
its `loadDatabaseUrl`/`queryAllFkEdges`/`walkClosure` functions directly rather than
reimplementing the FK discovery.
