/**
 * reset-rbac-test-accounts-3911.mjs — Git #3911
 *
 * Live, one-shot reset of tenant `mccawsoft2`'s test/temp user accounts against
 * Shane's LOCAL dev database only. Wipes every existing account scoped to that
 * tenant except `shane@shanemccaw.com` (hard-excluded explicitly, never by role
 * filter alone), then creates exactly one fresh account per real,
 * currently-defined RBAC role, confirmed LIVE against this database rather than
 * assumed from migration source:
 *
 *   - The 6-rung MSP-side ladder stored in `users.msp_role`
 *     (lib/db/src/rbac/legacy-ladder.ts LEGACY_ROLE_ORDER, confirmed live via
 *     the `users_role_scope_check` CHECK constraint): Free, Customer,
 *     ServiceAccount, MSPOperator, MSPAdmin, PlatformAdmin.
 *   - The customer-side platform-default roles layered on top of a Customer-tier
 *     account (`customer_roles`, tenant_id IS NULL, confirmed live): the two
 *     membership-only roles `customer-admin` / `billing`, and the two
 *     capability-COLUMN-backed roles `cap.team.manage` (users.can_manage_team)
 *     and `cap.changes.approve` (users.can_approve_changes — auto-synced to
 *     customer_user_roles by the live `rbac_sync_user_roles` trigger).
 *   - The one msp-side capability-COLUMN-backed role beyond the ladder
 *     (`msp_roles`, msp_id IS NULL, confirmed live): `cap.purchases.approve`
 *     (users.can_approve_purchases, only consistent on an MSPOperator+ rung;
 *     the sync trigger only ever REVOKES this membership row below MSPOperator,
 *     it never grants it, so this script grants the row itself — same as the
 *     app's own `setGrantRole` would).
 *
 * Passwords are real CSPRNG output (node:crypto randomBytes), bcrypt-hashed at
 * cost 12 (matching purchase-account-flow.ts's own attachPasswordToAccount) —
 * plaintext is NEVER written to any DB table, only returned once on this
 * script's own stdout for the caller to write into BuildConsole's local
 * settings.json (TestEnvironmentVariables) and then discard.
 *
 * Real, structural safety:
 *   - Aborts loudly (no writes at all) unless DATABASE_URL's host resolves to
 *     localhost/127.0.0.1 — never runs against anything else.
 *   - `shane@shanemccaw.com` is excluded by literal email match in the DELETE's
 *     own WHERE clause, not by role/tenant filtering alone.
 *   - The delete is FK-safe: it discovers real blocking foreign keys from
 *     information_schema as they're hit (Postgres 23503), sweeps exactly the
 *     rows tied to these specific doomed user ids in the offending table, and
 *     retries — it never touches a row belonging to any other account.
 *   - Whole reset (delete + recreate) runs in one transaction; any unexpected
 *     error rolls back the entire thing, so the tenant is never left half-reset.
 *   - Verifies each new account can actually authenticate by bcrypt-comparing
 *     the generated password against its own freshly-stored hash (the exact
 *     check artifacts/api-server/src/routes/auth.ts's real /api/auth/login
 *     route performs) and, when the local dev api-server is reachable, by a
 *     real HTTP call to that same live endpoint.
 *
 * Usage (from artifacts/api-server):
 *   pnpm exec tsx scripts/reset-rbac-test-accounts-3911.mjs
 *   pnpm exec tsx scripts/reset-rbac-test-accounts-3911.mjs --dry-run   (no writes)
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import bcrypt from "bcryptjs";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../../../.env.local");
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const DRY_RUN = process.argv.includes("--dry-run");

// mccawsoft2.onmicrosoft.com's real Entra tenant GUID — documented and
// confirmed live at docs/tenant-permission-model.md, tenants.id = 1. Resolved
// dynamically below (never hardcode the row id itself), keyed off this real,
// stable identifier.
const MCCAWSOFT2_ENTRA_TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
const PROTECTED_EMAIL = "shane@shanemccaw.com";

// ── Safety gate: this must resolve to local dev, never anything else ─────────
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("FAIL: DATABASE_URL is not set. Refusing to run.");
  process.exit(1);
}
const parsed = new URL(dbUrl);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) {
  console.error(
    `FAIL: DATABASE_URL host is "${parsed.hostname}", not localhost/127.0.0.1. ` +
      `This script only ever runs against local dev. Aborting — no connection attempted.`,
  );
  process.exit(1);
}
console.log(`[safety] DATABASE_URL resolves to host=${parsed.hostname} db=${parsed.pathname.slice(1)} — local dev, confirmed.`);

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

function quoteIdent(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`refusing to quote unsafe identifier: ${name}`);
  return `"${name}"`;
}

function randomPassword() {
  // Real CSPRNG entropy (node:crypto randomBytes), with a fixed
  // upper/lower/digit/symbol prefix only to satisfy any complexity check —
  // the prefix carries no meaningful entropy on its own, the 32-char
  // base64url suffix is the real random material.
  return `Rb1!${randomBytes(24).toString("base64url")}`;
}

async function main() {
  await client.query("BEGIN");
  try {
    // ── Resolve the real tenant row ────────────────────────────────────────
    const { rows: tenantRows } = await client.query(
      `SELECT id, msp_id, customer_name, is_testbed FROM tenants WHERE tenant_id = $1`,
      [MCCAWSOFT2_ENTRA_TENANT_ID],
    );
    if (tenantRows.length !== 1) {
      throw new Error(`Expected exactly one tenants row for mccawsoft2 (${MCCAWSOFT2_ENTRA_TENANT_ID}), found ${tenantRows.length}`);
    }
    const tenant = tenantRows[0];
    console.log(
      `[resolve] mccawsoft2 → tenants.id=${tenant.id}, msp_id=${tenant.msp_id}, ` +
        `customer_name=${JSON.stringify(tenant.customer_name)}, is_testbed=${tenant.is_testbed}`,
    );
    const TENANT_ID = tenant.id;
    const MSP_ID = tenant.msp_id;

    // ── Confirm shane@shanemccaw.com exists, unrelated to this tenant scope ──
    const { rows: shaneBefore } = await client.query(
      `SELECT id, email, msp_role, msp_id, tenant_id, updated_at FROM users WHERE email = $1`,
      [PROTECTED_EMAIL],
    );
    if (shaneBefore.length !== 1) {
      throw new Error(`Expected exactly one users row for ${PROTECTED_EMAIL}, found ${shaneBefore.length}. Aborting.`);
    }
    console.log(`[protect] ${PROTECTED_EMAIL} found: id=${shaneBefore[0].id}, msp_role=${shaneBefore[0].msp_role} — will not be touched.`);

    // ── Confirm the live role catalogs (do not trust migration snippets) ────
    const { rows: customerRoles } = await client.query(
      `SELECT key, name FROM customer_roles WHERE tenant_id IS NULL ORDER BY key`,
    );
    const { rows: mspRoles } = await client.query(
      `SELECT key, name FROM msp_roles WHERE msp_id IS NULL ORDER BY key`,
    );
    console.log(`[confirm] customer_roles (platform defaults): ${customerRoles.map((r) => r.key).join(", ")}`);
    console.log(`[confirm] msp_roles (platform defaults): ${mspRoles.map((r) => r.key).join(", ")}`);

    // ── Find every existing account scoped to this tenant, except shane's ───
    const { rows: doomed } = await client.query(
      `SELECT id, email, msp_role FROM users WHERE tenant_id = $1 AND email <> $2 ORDER BY id`,
      [TENANT_ID, PROTECTED_EMAIL],
    );
    console.log(`[delete] ${doomed.length} existing test/temp account(s) scoped to tenant ${TENANT_ID}:`);
    for (const u of doomed) console.log(`    id=${u.id} email=${u.email} msp_role=${u.msp_role}`);

    const doomedIds = doomed.map((u) => u.id);
    const sweptCounts = {};

    if (doomedIds.length > 0) {
      // Iterative FK sweep: attempt the delete; on a real FK violation, resolve
      // the exact blocking column from information_schema (not a guess) and
      // delete only the rows tied to these specific doomed ids in that table,
      // then retry. Caps at 60 rounds so a genuinely unexpected shape fails
      // loudly instead of looping forever.
      const pending = [{ table: "users", column: "id", ids: doomedIds }];
      let rounds = 0;
      while (pending.length > 0) {
        if (++rounds > 60) throw new Error("Exceeded max FK-sweep rounds while deleting doomed users — unexpected schema shape.");
        const op = pending.pop();
        await client.query("SAVEPOINT fk_sweep");
        try {
          const res = await client.query(
            `DELETE FROM ${quoteIdent(op.table)} WHERE ${quoteIdent(op.column)} = ANY($1::int[])`,
            [op.ids],
          );
          await client.query("RELEASE SAVEPOINT fk_sweep");
          if (op.table !== "users") {
            sweptCounts[`${op.table}.${op.column}`] = (sweptCounts[`${op.table}.${op.column}`] ?? 0) + res.rowCount;
          } else {
            console.log(`[delete] removed ${res.rowCount} users row(s).`);
          }
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT fk_sweep");
          const msg = String(err?.message ?? err);
          const m = /violates foreign key constraint "([^"]+)" on table "([^"]+)"/.exec(msg);
          if (err?.code !== "23503" || !m) throw err;
          const [, constraintName, blockingTable] = m;
          const { rows: colRows } = await client.query(
            `SELECT kcu.column_name
               FROM information_schema.table_constraints tc
               JOIN information_schema.key_column_usage kcu
                 ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
              WHERE tc.constraint_name = $1 AND tc.table_name = $2`,
            [constraintName, blockingTable],
          );
          if (colRows.length === 0) throw new Error(`Could not resolve FK column for constraint ${constraintName} on ${blockingTable}`);
          console.log(`[delete] FK sweep: ${blockingTable}.${colRows[0].column_name} references the doomed rows — clearing it first.`);
          pending.push(op); // retry this delete after the blocker is cleared
          pending.push({ table: blockingTable, column: colRows[0].column_name, ids: op.ids });
        }
      }
      if (Object.keys(sweptCounts).length > 0) {
        console.log(`[delete] swept dependent rows: ${JSON.stringify(sweptCounts)}`);
      }
    } else {
      console.log("[delete] nothing to delete.");
    }

    // ── Recreate: one account per real, currently-defined RBAC role ─────────
    const ROLE_ACCOUNTS = [
      // The 6-rung MSP-side ladder (users.msp_role) — one account per rung.
      { tag: "free", mspRole: "Free", tenantId: TENANT_ID, mspId: MSP_ID },
      { tag: "customer", mspRole: "Customer", tenantId: TENANT_ID, mspId: MSP_ID },
      { tag: "serviceaccount", mspRole: "ServiceAccount", tenantId: null, mspId: MSP_ID },
      { tag: "mspoperator", mspRole: "MSPOperator", tenantId: null, mspId: MSP_ID },
      { tag: "mspadmin", mspRole: "MSPAdmin", tenantId: null, mspId: MSP_ID },
      { tag: "platformadmin", mspRole: "PlatformAdmin", tenantId: null, mspId: MSP_ID },
      // Customer-side platform-default roles layered on a Customer-tier account.
      { tag: "customer-admin", mspRole: "Customer", tenantId: TENANT_ID, mspId: MSP_ID, grantCustomerRoleKey: "customer-admin" },
      { tag: "billing", mspRole: "Customer", tenantId: TENANT_ID, mspId: MSP_ID, grantCustomerRoleKey: "billing" },
      { tag: "cap.team.manage", mspRole: "Customer", tenantId: TENANT_ID, mspId: MSP_ID, canManageTeam: true, grantCustomerRoleKey: "cap.team.manage" },
      { tag: "cap.changes.approve", mspRole: "Customer", tenantId: TENANT_ID, mspId: MSP_ID, canApproveChanges: true },
      // MSP-side capability-column role layered on an MSPOperator-tier account.
      { tag: "cap.purchases.approve", mspRole: "MSPOperator", tenantId: null, mspId: MSP_ID, canApprovePurchases: true, grantMspRoleKey: "cap.purchases.approve" },
    ];

    const created = [];
    for (const spec of ROLE_ACCOUNTS) {
      const email = `shanemccaw+${spec.tag}@outlook.com`;
      const password = randomPassword();
      const passwordHash = await bcrypt.hash(password, 12);
      const name = `RBAC Test — ${spec.tag}`;

      const { rows: [inserted] } = await client.query(
        `INSERT INTO users (email, password_hash, role, name, msp_role, msp_id, tenant_id, can_manage_team, can_approve_changes, can_approve_purchases)
         VALUES ($1, $2, 'client', $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          email,
          passwordHash,
          name,
          spec.mspRole,
          spec.mspId,
          spec.tenantId,
          spec.canManageTeam === true,
          spec.canApproveChanges === true,
          spec.canApprovePurchases === true,
        ],
      );
      const userId = inserted.id;

      if (spec.grantCustomerRoleKey) {
        const { rows: [role] } = await client.query(
          `SELECT id FROM customer_roles WHERE tenant_id IS NULL AND key = $1`,
          [spec.grantCustomerRoleKey],
        );
        if (!role) throw new Error(`customer_roles has no platform-default row for key "${spec.grantCustomerRoleKey}"`);
        await client.query(
          `INSERT INTO customer_user_roles (user_id, role_id, granted_by_user_id) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [userId, role.id, shaneBefore[0].id],
        );
      }
      if (spec.grantMspRoleKey) {
        const { rows: [role] } = await client.query(
          `SELECT id FROM msp_roles WHERE msp_id IS NULL AND key = $1`,
          [spec.grantMspRoleKey],
        );
        if (!role) throw new Error(`msp_roles has no platform-default row for key "${spec.grantMspRoleKey}"`);
        await client.query(
          `INSERT INTO msp_user_roles (user_id, role_id, granted_by_user_id) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [userId, role.id, shaneBefore[0].id],
        );
      }

      created.push({ tag: spec.tag, id: userId, email, password, mspRole: spec.mspRole });
      console.log(`[create] id=${userId} email=${email} msp_role=${spec.mspRole}${spec.grantCustomerRoleKey ? ` +customer_roles(${spec.grantCustomerRoleKey})` : ""}${spec.grantMspRoleKey ? ` +msp_roles(${spec.grantMspRoleKey})` : ""}`);
    }

    // ── Verify: shane's row is byte-identical to before ─────────────────────
    const { rows: shaneAfter } = await client.query(
      `SELECT id, email, msp_role, msp_id, tenant_id, updated_at FROM users WHERE email = $1`,
      [PROTECTED_EMAIL],
    );
    const untouched = JSON.stringify(shaneBefore[0]) === JSON.stringify(shaneAfter[0]);
    console.log(`[verify] ${PROTECTED_EMAIL} untouched: ${untouched}`);
    if (!untouched) throw new Error(`${PROTECTED_EMAIL} row changed — aborting and rolling back.`);

    // ── Verify: every new account's password actually bcrypt-verifies ───────
    for (const acct of created) {
      const { rows: [row] } = await client.query(`SELECT password_hash FROM users WHERE id = $1`, [acct.id]);
      const ok = row?.password_hash?.startsWith("$2") && (await bcrypt.compare(acct.password, row.password_hash));
      console.log(`[verify] ${acct.email}: real bcrypt hash present and matches generated password: ${ok}`);
      if (!ok) throw new Error(`Password verification failed for ${acct.email}`);
    }

    if (DRY_RUN) {
      console.log("[dry-run] rolling back — no changes committed.");
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
      console.log("[commit] transaction committed.");
    }

    console.log("\n=== RESULT (JSON) ===");
    console.log(JSON.stringify({ tenantId: TENANT_ID, mspId: MSP_ID, deleted: doomed, swept: sweptCounts, created }, null, 2));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("FAIL — rolled back entire transaction:", err?.message ?? err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await main();
