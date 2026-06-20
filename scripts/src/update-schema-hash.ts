/**
 * update-schema-hash.ts
 *
 * Computes a SHA-256 hash of lib/db/src/schema/index.ts and writes it to
 * lib/db/drizzle/meta/schema-hash.txt.
 *
 * Run this after `pnpm --filter @workspace/db run generate` so the hash file
 * stays in sync with the journal. The check-drift script reads this hash to
 * detect schema changes that haven't been turned into a migration yet.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run update-schema-hash
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEMA_PATH = path.resolve(__dirname, "../../lib/db/src/schema/index.ts");
const HASH_PATH = path.resolve(__dirname, "../../lib/db/drizzle/meta/schema-hash.txt");

const schemaContent = fs.readFileSync(SCHEMA_PATH);
const hash = crypto.createHash("sha256").update(schemaContent).digest("hex");

fs.writeFileSync(HASH_PATH, hash + "\n");
console.log(`Schema hash updated: ${hash}`);
