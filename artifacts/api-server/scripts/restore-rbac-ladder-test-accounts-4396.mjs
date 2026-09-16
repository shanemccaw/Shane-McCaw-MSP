/**
 * restore-rbac-ladder-test-accounts-4396.mjs — Git #4396
 *
 * Additive-only restore of tenant `mccawsoft2`'s MSP-side RBAC-ladder test
 * accounts against Shane's LOCAL dev database only, after #4272's destructive
 * tenant reset wiped every tenant-scoped account #3911 had created.
 *
 * Unlike #3911's own script (reset-rbac-test-accounts-3911.mjs), this one does
 * NOT delete anything first — #4272 already did the destructive reset, and the
 * tenant currently resolved for mccawsoft2 (see below) now also holds a real,
 * live-consented account (`shanemccaw+premier@outlook.com`) that must not be
 * touched. This script only CREATES whichever of the real, currently-defined
 * LEGACY_ROLE_ORDER ladder rungs (lib/db/src/rbac/legacy-ladder.ts, 12 rungs as
 * of #4371 — confirmed live via `users_role_scope_check`) do not already have a
 * `shanemccaw+<tag>@outlook.com` test account; it skips any tag that already
 * exists (ServiceAccount/MSPOperator/MSPAdmin/PlatformAdmin/cap.purchases.approve
 * survived #4272's reset untouched, since they carry tenant_id IS NULL).
 *
 * Deliberately OUT of scope (see Git #4400, filed while investigating this):
 * `customer-admin`, `billing`, `cap.team.manage`, `cap.changes.approve` — these
 * need a `customer_user_roles` grant against a `customer_roles` row, and the
 * `customer_roles` platform-default catalog is itself severely wiped right now
 * (down to 4 of ~14 rows, `customer_feature_role_mapping` completely empty).
 * Creating these 4 accounts today would either fail outright (no role_id to
 * grant) or produce a non-functional grant against a fail-closed evaluator —
 * both are exactly the kind of fake state CLAUDE.md's "never invent data" rule
 * forbids. #4400 tracks the real repair.
 *
 * Passwords are real CSPRNG output (node:crypto randomBytes), bcrypt-hashed at
 * cost 12 — plaintext is NEVER written to any DB table, only returned once on
 * this script's own stdout for the caller to write into BuildConsole's local
 * settings.json (TestEnvironmentVariables) and then discard.
 *
 * Usage (from artifacts/api-server):
 *   pnpm exec tsx scripts/restore-rbac-ladder-test-accounts-4396.mjs
 *   pnpm exec tsx scripts/restore-rbac-ladder-test-accounts-4396.mjs --dry-run
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

// mccawsoft2.onmicrosoft.com's real Entra tenant GUID — same identifier
// #3911's script resolved against. Resolved dynamically below (never hardcode
// the row id), keyed off this real, stable identifier.
const MCCAWSOFT2_ENTRA_TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
const PROTECTED_EMAIL = "shane@shanemccaw.com";

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

function randomPassword() {
  return `Rb1!${randomBytes(24).toString("base64url")}`;
}

async function main() {
  await client.query("BEGIN");
  try {
    // Git #4396 live finding: earlier in this same session a real, live-consented
    // tenants row (id 1886, real Graph+SharePoint consent dated today) existed for
    // mccawsoft2, evidently from Shane completing #4318's walkthrough. It was
    // deleted by something else running concurrently against this shared local DB
    // before this script's real (non-dry-run) pass — confirmed gone and stable
    // across repeated checks ~40s apart. So TENANT_ID resolves to null right now:
    // #4318 (no live testbed tenant) is genuinely, currently true again, even
    // though it briefly wasn't. Every rung whose CHECK constraint needs tenant_id
    // NOT NULL is skipped below rather than faked with an invented tenant row.
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
      console.log(`[resolve] mccawsoft2 -> NO live tenants row right now (see #4318/#4396). Tenant-scoped rungs will be skipped, not faked.`);
    }
    const TENANT_ID = tenant?.id ?? null;
    // msp_id=1 is the real, stable MSP row id regardless of whether a tenant row
    // exists for it — confirmed live (shane@shanemccaw.com and every existing
    // ladder test account already carry msp_id=1).
    const MSP_ID = 1;

    const { rows: shaneBefore } = await client.query(
      `SELECT id, email, msp_role, msp_id, tenant_id, updated_at FROM users WHERE email = $1`,
      [PROTECTED_EMAIL],
    );
    if (shaneBefore.length !== 1) {
      throw new Error(`Expected exactly one users row for ${PROTECTED_EMAIL}, found ${shaneBefore.length}. Aborting.`);
    }
    console.log(`[protect] ${PROTECTED_EMAIL} found: id=${shaneBefore[0].id} — will not be touched.`);

    // ── The real, currently-live 12-rung ladder (LEGACY_ROLE_ORDER, #4371) ──
    // Group membership per the live `users_role_scope_check` CHECK constraint,
    // confirmed directly against \d users rather than assumed:
    //   tenant_id required : Free, Customer, RetainerConsented, MonitoringConsented, PackConsented
    //   no extra requirement: RetainerPending, MonitoringPending, PackPending
    //   msp_id required    : ServiceAccount, MSPOperator, MSPAdmin
    //   neither required   : PlatformAdmin
    // tenantId: "REQUIRED" means this rung's CHECK constraint needs tenant_id NOT
    // NULL — resolved to the real TENANT_ID at insert time, or skipped entirely
    // (never faked) if TENANT_ID is null right now.
    const LADDER_ACCOUNTS = [
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
    ];

    const { rows: existing } = await client.query(
      `SELECT email FROM users WHERE email = ANY($1::text[])`,
      [LADDER_ACCOUNTS.map((s) => `shanemccaw+${s.tag}@outlook.com`)],
    );
    const existingEmails = new Set(existing.map((r) => r.email));

    const created = [];
    const skipped = [];
    for (const spec of LADDER_ACCOUNTS) {
      const email = `shanemccaw+${spec.tag}@outlook.com`;
      if (existingEmails.has(email)) {
        skipped.push({ tag: spec.tag, email, reason: "already exists" });
        console.log(`[skip] ${email} already exists — leaving untouched.`);
        continue;
      }
      if (spec.tenantId === "REQUIRED" && TENANT_ID === null) {
        skipped.push({ tag: spec.tag, email, reason: "blocked on #4318 — no live mccawsoft2 tenant row right now" });
        console.log(`[skip] ${email} needs a real tenant_id and none exists right now (#4318) — not creating, not faking one.`);
        continue;
      }
      const password = randomPassword();
      const passwordHash = await bcrypt.hash(password, 12);
      const name = `RBAC Test — ${spec.tag}`;
      const rowTenantId = spec.tenantId === "REQUIRED" ? TENANT_ID : spec.tenantId;

      const { rows: [inserted] } = await client.query(
        `INSERT INTO users (email, password_hash, role, name, msp_role, msp_id, tenant_id)
         VALUES ($1, $2, 'client', $3, $4, $5, $6)
         RETURNING id`,
        [email, passwordHash, name, spec.mspRole, spec.mspId, rowTenantId],
      );
      created.push({ tag: spec.tag, id: inserted.id, email, password, mspRole: spec.mspRole });
      console.log(`[create] id=${inserted.id} email=${email} msp_role=${spec.mspRole} tenant_id=${rowTenantId ?? "NULL"}`);
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
    console.log(JSON.stringify({ tenantId: TENANT_ID, mspId: MSP_ID, created, skipped }, null, 2));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("FAIL — rolled back entire transaction:", err?.message ?? err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await main();
