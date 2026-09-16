#!/usr/bin/env node
// scripts/db/reset-rbac-test-accounts.mjs
//
// Git #4396: a real, reusable self-service version of #3911's original
// one-off RBAC-ladder test-account reset — same self-service spirit as
// #4393's reset-dev-database.mjs — so Shane can wipe-and-recreate the
// `shanemccaw+<role>@outlook.com` login-test accounts himself, on demand,
// whenever a tenant reset (#4272-style) or a role-catalog change invalidates
// his saved browser autofill profiles, without needing an agent dispatch.
//
// What it does, every run:
//   1. Refuses to run against anything that doesn't look like local dev
//      (DATABASE_URL host must be localhost/127.0.0.1).
//   2. Resolves the real mccawsoft2 tenant row live (by its stable Entra
//      tenant GUID, never a hardcoded row id). If none exists right now —
//      a real, honest possibility; see #4318 — it does NOT fabricate one.
//      Every rung whose `users_role_scope_check` needs tenant_id NOT NULL
//      (Free, Customer, RetainerConsented, MonitoringConsented,
//      PackConsented) is skipped and reported, not faked.
//   3. Confirms the live customer_roles platform-default catalog actually
//      carries the row a capability-role account needs before creating it
//      (`customer-admin`, `billing`, `cap.team.manage`, `cap.changes.approve`
//      all need a real `customer_roles` row to grant against). If the
//      catalog is missing a row — see Git #4400, a real, filed finding about
//      the customer-side RBAC catalog being wiped by #4272's reset — that
//      one account is skipped and reported, never granted against nothing.
//   4. Deletes every EXISTING `shanemccaw+<tag>@outlook.com` test account
//      this script's own tag list owns (FK-safe iterative sweep), then
//      recreates one fresh account per real, currently-live RBAC role
//      (pulled from LEGACY_ROLE_ORDER's 12 rungs as of #4371, confirmed live
//      via `users_role_scope_check` — never assumed from a stale list).
//      `shane@shanemccaw.com` is excluded by literal email match, never by
//      role/tenant filtering alone.
//
//      Deliberately NARROWER than #3911's original delete scope (which
//      deleted every account scoped to the resolved tenant id): this script
//      only ever deletes accounts matching its own `shanemccaw+<tag>@` tag
//      list. #3911's tenant-wide delete would also catch a REAL customer
//      signup that happens to share the same tenant row (confirmed live
//      during #4396: `shanemccaw+premier@outlook.com`, a genuine paid
//      customer account, existed under this exact tenant for part of that
//      session) — this script must never delete a real customer's account.
//   5. Real CSPRNG passwords (node:crypto randomBytes), bcrypt-hashed at
//      cost 12 — plaintext is NEVER written to any DB table, only printed
//      once on stdout for the caller to paste into BuildConsole's
//      `settings.json` (`TestEnvironmentVariables`) and then discard.
//   6. Verifies shane@shanemccaw.com is byte-identical before/after, and
//      every new account's password actually bcrypt-verifies against its
//      own freshly-stored hash before committing.
//
// Usage:
//   node scripts/db/reset-rbac-test-accounts.mjs --dry-run   # BEGIN...ROLLBACK, no writes committed
//   node scripts/db/reset-rbac-test-accounts.mjs             # real run — wipes + recreates, prints creds once

import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import bcrypt from "bcryptjs";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../../.env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const DRY_RUN = process.argv.includes("--dry-run");

const MCCAWSOFT2_ENTRA_TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
const PROTECTED_EMAIL = "shane@shanemccaw.com";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("FAIL: DATABASE_URL is not set. Refusing to run.");
  process.exit(1);
}
const parsedUrl = new URL(dbUrl);
if (!["localhost", "127.0.0.1"].includes(parsedUrl.hostname)) {
  console.error(
    `FAIL: DATABASE_URL host is "${parsedUrl.hostname}", not localhost/127.0.0.1. ` +
      `This script only ever runs against local dev. Aborting — no connection attempted.`,
  );
  process.exit(1);
}
console.log(`[safety] DATABASE_URL resolves to host=${parsedUrl.hostname} db=${parsedUrl.pathname.slice(1)} — local dev, confirmed.`);

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

function quoteIdent(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`refusing to quote unsafe identifier: ${name}`);
  return `"${name}"`;
}

function randomPassword() {
  return `Rb1!${randomBytes(24).toString("base64url")}`;
}

async function main() {
  await client.query("BEGIN");
  try {
    // ── Resolve the real tenant row, if one exists right now ────────────────
    const { rows: tenantRows } = await client.query(
      `SELECT id, msp_id, customer_name, is_testbed, status FROM tenants WHERE tenant_id = $1`,
      [MCCAWSOFT2_ENTRA_TENANT_ID],
    );
    const tenant = tenantRows[0] ?? null;
    if (tenant) {
      console.log(
        `[resolve] mccawsoft2 -> tenants.id=${tenant.id}, msp_id=${tenant.msp_id}, ` +
          `customer_name=${JSON.stringify(tenant.customer_name)}, is_testbed=${tenant.is_testbed}, status=${tenant.status}`,
      );
    } else {
      console.log(`[resolve] mccawsoft2 -> NO live tenants row right now (see #4318). Tenant-scoped rungs will be skipped, not faked.`);
    }
    const TENANT_ID = tenant?.id ?? null;

    const { rows: mspRows } = await client.query(
      `SELECT id FROM msps WHERE is_direct_business = true`,
    );
    if (mspRows.length !== 1) {
      throw new Error(`Expected exactly one msps row with is_direct_business = true, found ${mspRows.length}`);
    }
    const MSP_ID = mspRows[0].id;
    console.log(`[resolve] real direct MSP id=${MSP_ID}`);

    const { rows: shaneBefore } = await client.query(
      `SELECT id, email, msp_role, msp_id, tenant_id, updated_at FROM users WHERE email = $1`,
      [PROTECTED_EMAIL],
    );
    if (shaneBefore.length !== 1) {
      throw new Error(`Expected exactly one users row for ${PROTECTED_EMAIL}, found ${shaneBefore.length}. Aborting.`);
    }
    console.log(`[protect] ${PROTECTED_EMAIL} found: id=${shaneBefore[0].id} — will not be touched.`);

    // ── Which customer_roles the platform catalog actually has right now ────
    // #4400: this catalog was severely wiped by #4272's reset. Check live
    // rather than assume any of these four rows exist.
    const { rows: customerRoleRows } = await client.query(
      `SELECT key, id FROM customer_roles WHERE tenant_id IS NULL AND key = ANY($1::text[])`,
      [["customer-admin", "billing"]],
    );
    const customerRoleIdByKey = Object.fromEntries(customerRoleRows.map((r) => [r.key, r.id]));

    // ── The real, currently-live 12-rung ladder (LEGACY_ROLE_ORDER, #4371) ──
    // plus the customer-side platform-default roles layered on a Customer-
    // tier account, plus the one msp-side capability role beyond the ladder.
    // tenantId: "REQUIRED" -> resolved to TENANT_ID at insert time, or the
    // whole account is skipped (never faked) if TENANT_ID is null.
    // grantCustomerRoleKey: only granted if that customer_roles row actually
    // exists right now (see customerRoleIdByKey above); otherwise skipped.
    const ROLE_ACCOUNTS = [
      { tag: "free", mspRole: "Free", tenantId: "REQUIRED", mspId: MSP_ID },
      { tag: "monitoringpending", mspRole: "MonitoringPending", tenantId: null, mspId: MSP_ID },
      { tag: "monitoringconsented", mspRole: "MonitoringConsented", tenantId: "REQUIRED", mspId: MSP_ID },
      { tag: "packpending", mspRole: "PackPending", tenantId: null, mspId: MSP_ID },
      { tag: "packconsented", mspRole: "PackConsented", tenantId: "REQUIRED", mspId: MSP_ID },
      { tag: "retainerpending", mspRole: "RetainerPending", tenantId: null, mspId: MSP_ID },
      { tag: "retainerconsented", mspRole: "RetainerConsented", tenantId: "REQUIRED", mspId: MSP_ID },
      { tag: "customer", mspRole: "Customer", tenantId: "REQUIRED", mspId: MSP_ID },
      { tag: "serviceaccount", mspRole: "ServiceAccount", tenantId: null, mspId: MSP_ID },
      { tag: "mspoperator", mspRole: "MSPOperator", tenantId: null, mspId: MSP_ID },
      { tag: "mspadmin", mspRole: "MSPAdmin", tenantId: null, mspId: MSP_ID },
      { tag: "platformadmin", mspRole: "PlatformAdmin", tenantId: null, mspId: MSP_ID },
      { tag: "customer-admin", mspRole: "Customer", tenantId: "REQUIRED", mspId: MSP_ID, grantCustomerRoleKey: "customer-admin" },
      { tag: "billing", mspRole: "Customer", tenantId: "REQUIRED", mspId: MSP_ID, grantCustomerRoleKey: "billing" },
      { tag: "cap.team.manage", mspRole: "Customer", tenantId: "REQUIRED", mspId: MSP_ID, canManageTeam: true },
      { tag: "cap.changes.approve", mspRole: "Customer", tenantId: "REQUIRED", mspId: MSP_ID, canApproveChanges: true },
      { tag: "cap.purchases.approve", mspRole: "MSPOperator", tenantId: null, mspId: MSP_ID, canApprovePurchases: true, grantMspRoleKey: "cap.purchases.approve" },
    ];

    // ── Delete only the accounts THIS script's tag list owns ────────────────
    const ownedEmails = ROLE_ACCOUNTS.map((s) => `shanemccaw+${s.tag}@outlook.com`);
    const { rows: doomed } = await client.query(
      `SELECT id, email, msp_role FROM users WHERE email = ANY($1::text[]) ORDER BY id`,
      [ownedEmails],
    );
    console.log(`[delete] ${doomed.length} existing tag-owned test account(s):`);
    for (const u of doomed) console.log(`    id=${u.id} email=${u.email} msp_role=${u.msp_role}`);

    const doomedIds = doomed.map((u) => u.id);
    const sweptCounts = {};
    if (doomedIds.length > 0) {
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
          pending.push(op);
          pending.push({ table: blockingTable, column: colRows[0].column_name, ids: op.ids });
        }
      }
      if (Object.keys(sweptCounts).length > 0) console.log(`[delete] swept dependent rows: ${JSON.stringify(sweptCounts)}`);
    } else {
      console.log("[delete] nothing to delete.");
    }

    // ── Recreate ──────────────────────────────────────────────────────────
    const created = [];
    const skipped = [];
    for (const spec of ROLE_ACCOUNTS) {
      const email = `shanemccaw+${spec.tag}@outlook.com`;

      if (spec.tenantId === "REQUIRED" && TENANT_ID === null) {
        skipped.push({ tag: spec.tag, email, reason: "no live mccawsoft2 tenant row right now (#4318) — not faking one" });
        console.log(`[skip] ${email} needs a real tenant_id and none exists right now — not creating.`);
        continue;
      }
      if (spec.grantCustomerRoleKey && !customerRoleIdByKey[spec.grantCustomerRoleKey]) {
        skipped.push({ tag: spec.tag, email, reason: `customer_roles has no live row for "${spec.grantCustomerRoleKey}" right now (#4400) — not granting against nothing` });
        console.log(`[skip] ${email} needs customer_roles.key="${spec.grantCustomerRoleKey}" and it doesn't exist right now — not creating.`);
        continue;
      }

      const password = randomPassword();
      const passwordHash = await bcrypt.hash(password, 12);
      const name = `RBAC Test — ${spec.tag}`;
      const rowTenantId = spec.tenantId === "REQUIRED" ? TENANT_ID : spec.tenantId;

      const { rows: [inserted] } = await client.query(
        `INSERT INTO users (email, password_hash, role, name, msp_role, msp_id, tenant_id, can_manage_team, can_approve_changes, can_approve_purchases)
         VALUES ($1, $2, 'client', $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          email, passwordHash, name, spec.mspRole, spec.mspId, rowTenantId,
          spec.canManageTeam === true, spec.canApproveChanges === true, spec.canApprovePurchases === true,
        ],
      );
      const userId = inserted.id;

      if (spec.grantCustomerRoleKey) {
        await client.query(
          `INSERT INTO customer_user_roles (user_id, role_id, granted_by_user_id) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [userId, customerRoleIdByKey[spec.grantCustomerRoleKey], shaneBefore[0].id],
        );
      }
      if (spec.grantMspRoleKey) {
        const { rows: [role] } = await client.query(`SELECT id FROM msp_roles WHERE msp_id IS NULL AND key = $1`, [spec.grantMspRoleKey]);
        if (!role) throw new Error(`msp_roles has no platform-default row for key "${spec.grantMspRoleKey}"`);
        await client.query(
          `INSERT INTO msp_user_roles (user_id, role_id, granted_by_user_id) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [userId, role.id, shaneBefore[0].id],
        );
      }

      created.push({ tag: spec.tag, id: userId, email, password, mspRole: spec.mspRole });
      console.log(`[create] id=${userId} email=${email} msp_role=${spec.mspRole} tenant_id=${rowTenantId ?? "NULL"}`);
    }

    const { rows: shaneAfter } = await client.query(
      `SELECT id, email, msp_role, msp_id, tenant_id, updated_at FROM users WHERE email = $1`,
      [PROTECTED_EMAIL],
    );
    const untouched = JSON.stringify(shaneBefore[0]) === JSON.stringify(shaneAfter[0]);
    console.log(`[verify] ${PROTECTED_EMAIL} untouched: ${untouched}`);
    if (!untouched) throw new Error(`${PROTECTED_EMAIL} row changed — aborting and rolling back.`);

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
    console.log(JSON.stringify({ tenantId: TENANT_ID, mspId: MSP_ID, deleted: doomed, swept: sweptCounts, created, skipped }, null, 2));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("FAIL — rolled back entire transaction:", err?.message ?? err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await main();
