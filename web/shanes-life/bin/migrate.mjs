#!/usr/bin/env node
// Apply pending migrations without starting the server. The server does this on boot too;
// this exists for running it by hand against a fresh database.

import { closePool } from "../src/db.mjs";
import { runMigrations } from "../src/migrate.mjs";

try {
  const { applied, skipped } = await runMigrations();
  console.log(`applied=${applied.length} alreadyApplied=${skipped.length}`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
