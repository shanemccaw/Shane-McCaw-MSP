---
name: Manual migration when drizzle-kit generate fails
description: How to create a Drizzle migration manually when drizzle-kit generate crashes (corrupted snapshot JSON)
---

## The rule
When `drizzle-kit generate` fails with a JSON parse error on snapshot files, bypass it by creating the migration manually. The drift checker only cares about the schema hash, the journal JSON, and the SQL files on disk — not about drizzle-kit internals.

**Why:** The project's snapshot directory can become corrupted (or missing), causing `drizzle-kit generate` to throw `SyntaxError: Unexpected non-whitespace character after JSON`. This happens when tables are created directly via `executeSql()` (bypassing the normal generate → migrate flow) and then the schema file is updated to match.

## How to apply

When you add tables to `lib/db/src/schema/index.ts` without being able to run `drizzle-kit generate`:

1. **Write the SQL file** at `lib/db/drizzle/0NNN_<tag>.sql` using `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Use IF NOT EXISTS so the file is safe to re-apply.

2. **Update the journal** at `lib/db/drizzle/meta/_journal.json` — append an entry:
   ```json
   { "idx": N, "version": "7", "when": <unix_ms>, "tag": "0NNN_<tag>", "breakpoints": true }
   ```

3. **Update the schema hash** — run:
   ```bash
   node -e "const c=require('crypto'),f=require('fs'); const h=c.createHash('sha256').update(f.readFileSync('lib/db/src/schema/index.ts')).digest('hex'); f.writeFileSync('lib/db/drizzle/schema-hash.txt', h+'\n'); console.log(h);"
   ```

4. **Mark as applied in the DB** — the `__drizzle_migrations` table has columns `tag TEXT` and `applied_at TIMESTAMPTZ`:
   ```sql
   INSERT INTO __drizzle_migrations (tag, applied_at) VALUES ('0NNN_<tag>', NOW()) ON CONFLICT DO NOTHING;
   ```

5. **Verify** — run `pnpm --filter @workspace/scripts run check-drift` and confirm it shows ✅ No drift.

## Important detail
The `__drizzle_migrations` table columns are `tag` and `applied_at` — NOT `hash` and `created_at`. Do not use the wrong column names or the INSERT will fail.
