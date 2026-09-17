# scripts/db/

## `psql.mjs` — the safe way to run ad-hoc `psql` against local dev (Git #4526)

A build agent's Bash tool shell never has `DATABASE_URL` exported (correctly — sourcing
`.env.local` risks leaking `MT_APP_CERT_PRIVATE_KEY`). Hand-rolling `psql "$DATABASE_URL"`
against that empty var makes real `psql` silently fall back to its default connection params
and block on an interactive password prompt written directly to the controlling terminal,
invisible to stdout/stderr capture — a silent, permanent hang, not an error. Confirmed live:
6 of the last 60 build-queue sessions ended a turn with exactly this shape, auto-backgrounded,
holding the queue slot up to the 30-minute background-task ceiling.

```
node scripts/db/psql.mjs -c "select 1"
node scripts/db/psql.mjs -c "\d remediation_knowledge_base"
```

Loads `DATABASE_URL` via `find-tenant-scoped-tables.mjs`'s `loadDatabaseUrl()` (a single regex
line out of `.env.local`, never a full `source`), builds a password-free conninfo + `PGPASSWORD`
env via `pg-cli.mjs`'s `pgCli()`, and always passes `-w` (never prompt) plus a bounded
`PGCONNECT_TIMEOUT`. Any real connection failure — bad credentials, unreachable server, a
genuinely missing `DATABASE_URL` — now surfaces as a fast, capturable error instead of hanging.
Any argv after the script path passes straight through to the real `psql` binary.

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

**From BuildConsole's Command Center (Ctrl+K, Git #4415):** the "Reset dev database" row only
ever runs `--dry-run` — Enter on it (once or repeatedly) never resets anything. The preview's
output ends with a confirm phrase carrying the live target MSP id (`reset msp #<id>`); typing that
exact phrase into the palette's search box and pressing Enter is the only way it runs `--yes`, and
only after a successful preview in that same palette window. One confirmation = one real run. The
result pane leads with the real backup file path the script reported.

**Safety floor:** refuses to run against anything whose `DATABASE_URL` doesn't look like the
real local dev database (host must be `localhost`/`127.0.0.1`, and the URL can't match a
remote-hosting pattern like `neon.tech`/`replit`/`amazonaws`/`rds.`/`supabase`). This script
never runs against Staging/Replit or production, by design — not a flag, a hard refusal.

**`reset_protected` — a real, live-consented tenant survives this script no matter who runs it
(Git #4423):** the same live-consented mccawsoft2 tenant row (a real M365 admin consent + real
Stripe signup, walked through by hand) was deleted six times in one day, every time by a build
session's own "live verify the script/gate I just wrote" step running this script's real `--yes`
mode against the shared local dev DB — never a scheduled job, never a test teardown. Nothing
distinguished "scratch data safe to nuke" from "a walkthrough that must survive," because both
live at the exact same `msp_id` scope this script targets.

If ANY tenant in the target MSP's scope has `tenants.reset_protected = true`, the script refuses
its **entire** run — dry run included, so the BuildConsole Command Center gate never arms its
confirm phrase either — and changes nothing. This is a whole-run refusal, not a per-tenant skip,
and it lives in the script's own shared logic, not a UI-layer confirmation, so it holds no matter
whether the script is invoked directly, through the Command Center gate, through the "Clean Dev
Database" chain below, or through an agent's own verification harness. Flip it on right after a
real walkthrough:

```sql
UPDATE tenants SET reset_protected = true WHERE tenant_id = '<the real Entra tenant GUID>';
```

and clear it yourself, deliberately, only once that walkthrough is genuinely done with:

```sql
UPDATE tenants SET reset_protected = false WHERE id IN (<ids the refusal message printed>);
```

**A build session verifying this script or its Command Center gate must never do so by running
the real `--yes` mode (or typing a gate's real confirm phrase) against this shared database.**
That is exactly the pattern that caused #4423. Verify against `--dry-run` output, a throwaway
database, or a synthetic tenant/MSP that isn't `is_direct_business = true` — never the real
target MSP's live data.

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

## `reset-rbac-test-accounts.mjs` — wipe/recreate the RBAC-ladder login-test accounts (Git #4396)

Reusable, self-service version of #3911's one-off RBAC-ladder test-account reset — run it
yourself whenever a tenant reset (#4272-style) or an RBAC role-catalog change breaks your
saved browser autofill profiles for `shanemccaw+<role>@outlook.com`, instead of needing an
agent dispatch.

```
node scripts/db/reset-rbac-test-accounts.mjs --dry-run   # BEGIN...ROLLBACK -- prints the plan, changes nothing
node scripts/db/reset-rbac-test-accounts.mjs              # real run -- wipes + recreates, prints creds once
```

**From BuildConsole's Command Center (Ctrl+K, Git #4416):** same typed-phrase gate as the dev
reset above. The "Reset RBAC test accounts" row only ever runs `--dry-run` (the rolled-back
passwords in its output are redacted, and it lists which `TEST_RBAC_*` settings.json vars a real
run would add/update). Typing the phrase the preview prints (`reset rbac #<live msp id>`) and
pressing Enter runs the real wipe/recreate once. BuildConsole — not this script — then writes the
new `TEST_RBAC_<ROLE>_EMAIL` / `TEST_RBAC_<ROLE>_PASSWORD` pairs into `settings.json`
(`TestEnvironmentVariables`), re-reads the file to confirm every value, and shows the new
credentials in the result pane. Pairs for accounts the run skipped (and so deleted without
recreating) are left in settings.json untouched and named in the result.

**What it does:** deletes only the `shanemccaw+<tag>@outlook.com` accounts it itself owns (a
fixed tag list — never a blanket "everything under this tenant" delete, since a real customer
signup can share the same tenant row), then recreates one fresh account per real,
currently-live RBAC role — the 12-rung `LEGACY_ROLE_ORDER` ladder, the customer-side
`customer-admin`/`billing` roles, and the `cap.team.manage`/`cap.changes.approve`/
`cap.purchases.approve` capability roles. `shane@shanemccaw.com` is excluded by literal email
match, never by role/tenant filtering alone. Real CSPRNG passwords, bcrypt-hashed at cost 12
in the DB — plaintext is only ever printed once on stdout for you to paste into BuildConsole's
`settings.json` (`TestEnvironmentVariables`).

**Honest, not fabricated, when real state is missing:** any rung whose `users_role_scope_check`
needs a real `tenant_id` (Free, Customer, RetainerConsented, MonitoringConsented,
PackConsented, and the four Customer-tier capability roles) is skipped and reported — never
given a fake tenant row — if no live mccawsoft2 `tenants` row exists (see #4318, the real
live M365 admin-consent + Stripe walkthrough gate). Likewise `customer-admin`/`billing` are
skipped if the `customer_roles` platform-default catalog doesn't actually carry that row right
now (see #4400 — the catalog was severely wiped by #4272's reset and needs its own repair).

## Command Center "Clean Dev Database" — the three scripts as one confirmed chain (Git #4417)

BuildConsole's Command Center (Ctrl+K) has a "Clean Dev Database" row that runs
`find-tenant-scoped-tables.mjs` → `reset-dev-database.mjs --yes` → `reset-rbac-test-accounts.mjs`
in that order, through the same gates as the individual rows above (no second runner or confirm).

- **Enter on the row only previews:** step 1 for real (read-only), then the `--dry-run` of steps 2
  and 3, each shown in the right pane as it runs. Nothing changes. The preview ends with the phrase
  `clean dev db #<live msp id>`; typing it and pressing Enter runs the real chain once.
- **Step 1 never blocks** — its output is shown whatever it reports.
- **Fail-stop on step 2:** if the real reset fails, step 3 is marked not run and never starts —
  including a step-2 refusal because of a `reset_protected` tenant (Git #4423), which now shows
  up here the same way any other reset-dev-database.mjs failure does.
- **Tenant admin consent before step 3:** after the reset, the chain re-runs step 3's dry run
  against the reset database. If the script reports no live mccawsoft2 `tenants` row (the row only a
  manual, browser-based admin consent creates, #4318), the chain stops before step 3 and says so.
  While that row belongs to the direct MSP, a real reset always deletes it, so the chain stops here
  every time — grant consent, then run "Reset RBAC test accounts" **on its own**. Re-running the
  chain would delete the newly consented tenant row again.

## `find-tenant-scoped-tables.mjs` — live FK-reachability report (Git #4313)

Reports, from real `information_schema` FK edges, every table transitively reachable from a
given set of root tables (default `tenants,users,msps`). Read-only, makes no schema/data
change. See the script's own header comment for full usage. `reset-dev-database.mjs` imports
its `loadDatabaseUrl`/`queryAllFkEdges`/`walkClosure` functions directly rather than
reimplementing the FK discovery.
