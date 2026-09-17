#!/usr/bin/env node
// scripts/db/psql.mjs
//
// Git #4526: build agents kept hand-rolling `psql "$DATABASE_URL" -c ...` per
// the CLAUDE.md Database recipe, but their Bash tool shell never has
// DATABASE_URL exported (and never should -- sourcing .env.local leaks
// MT_APP_CERT_PRIVATE_KEY, see the env-local-bash-source-leaks-pem-key
// memory). With $DATABASE_URL empty, psql silently falls back to its default
// connection params (localhost/current OS user) and prompts for a password
// directly against the controlling terminal, bypassing stdout/stderr
// redirection entirely. In a non-interactive tool invocation that prompt
// blocks forever with zero captured output -- reproduced live: `timeout 5
// psql "$DATABASE_URL" -c "select 1"` with $DATABASE_URL unset -> empty
// output, exit 124. Six of the last 60 build-queue logs hit exactly this
// shape before the CLI auto-backgrounded the hung process.
//
// This wrapper removes both failure modes structurally:
//   1. Loads DATABASE_URL the safe way (loadDatabaseUrl(), already used by
//      find-tenant-scoped-tables.mjs) -- a single regex line out of
//      .env.local, never a full `source`, so the key material a few lines
//      further down in that file is never touched.
//   2. Always passes `-w` (never prompt) and a bounded PGCONNECT_TIMEOUT, so
//      any future case with genuinely missing/wrong credentials fails fast
//      with a real, capturable error instead of hanging silently.
//
// Usage: node scripts/db/psql.mjs -c "select 1"
//        node scripts/db/psql.mjs -c "\d remediation_knowledge_base"
// Any argv is passed straight through to the real psql binary.

import { spawnSync } from "node:child_process";
import { loadDatabaseUrl } from "./find-tenant-scoped-tables.mjs";
import { pgCli } from "./pg-cli.mjs";

const databaseUrl = loadDatabaseUrl();
const { conninfo, env } = pgCli(databaseUrl);

const result = spawnSync(
  "psql",
  ["-w", conninfo, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...env, PGCONNECT_TIMEOUT: env.PGCONNECT_TIMEOUT ?? "10" },
  },
);

if (result.error) {
  console.error(`Failed to launch psql: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
