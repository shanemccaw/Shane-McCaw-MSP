/**
 * create-portal-test-account.ts — Git #4395.
 *
 * Creates (idempotently) a real Portal login account for the real mccawsoft2
 * customer, via the SAME account-provisioning mechanism the live self-service
 * signup funnel uses — `provisionProspectAccount` (direct-tenant-provisioning.ts)
 * — rather than a raw `INSERT INTO users`. This is deliberately a different door
 * from `scripts/db/reset-rbac-test-accounts.mjs` (#3911/#4396), which inserts
 * `users` rows directly and never links a real `customers`/`msp_users` bridge;
 * this script exists specifically so a test account has the SAME real
 * customer-bridge linkage (`ensureDirectCustomerRecord` / `ensureClientMspUser`)
 * a genuine paid signup gets, for tests that depend on that bridge existing.
 *
 * Real, existing mccawsoft2 tenant only — this script resolves the tenant row
 * by its real Entra GUID and NEVER creates a new tenant row itself
 * (`resolveOrCreateDirectTenant` no-ops to "resolve" when the row already
 * exists, which it does: tenants.id=2080, a real live-consented signup from
 * #4318's walkthrough). Refuses to run if that tenant does not exist right now
 * rather than fabricating one.
 *
 * A fresh CSPRNG password is generated and bcrypt-hashed (cost 12, matching
 * purchase-account-flow.ts's own real password-setting cost) directly onto the
 * `users` row BEFORE calling provisionProspectAccount — the same "account-first,
 * real password from day one" shape #4374/#4392's own live-DB tests use — since
 * provisionProspectAccount itself deliberately never sets a password (real
 * customers set their own via the account-setup flow). Idempotent: re-running
 * finds the existing account by email and prints its real current password
 * ONLY if this run just (re)set it — an already-provisioned account's password
 * is never silently overwritten.
 *
 * Usage (from artifacts/api-server):
 *   node --import tsx src/scripts/create-portal-test-account.ts [--reset-password]
 *
 *   --reset-password   also rotate the password on an already-existing account
 *                       (prints the new plaintext). Without this flag, a second
 *                       run against an existing account reports its state but
 *                       prints no password (it was already reported once).
 */

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, usersTable, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";
import { provisionProspectAccount } from "../lib/direct-tenant-provisioning.ts";

const MCCAWSOFT2_ENTRA_TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
const EMAIL = "shanemccaw+portal-test@outlook.com";
const FULL_NAME = "Portal Test Account";
const RESET_PASSWORD = process.argv.includes("--reset-password");

function randomPassword(): string {
  return `Pt4395!${randomBytes(24).toString("base64url")}`;
}

async function main() {
  const [tenant] = await db
    .select({ id: tenantsTable.id, mspId: tenantsTable.mspId, tenantId: tenantsTable.tenantId, status: tenantsTable.status, customerName: tenantsTable.customerName })
    .from(tenantsTable)
    .where(eq(tenantsTable.tenantId, MCCAWSOFT2_ENTRA_TENANT_ID))
    .limit(1);

  if (!tenant) {
    console.error(
      `FAIL: no real tenants row for mccawsoft2 (tenant_id=${MCCAWSOFT2_ENTRA_TENANT_ID}) exists right now. ` +
        `Refusing to fabricate one — see Git #4318/#4423.`,
    );
    process.exit(1);
  }
  console.log(
    `[resolve] mccawsoft2 -> tenants.id=${tenant.id}, customer_name=${JSON.stringify(tenant.customerName)}, status=${tenant.status}`,
  );

  const [existing] = await db
    .select({ id: usersTable.id, tenantId: usersTable.tenantId, mspId: usersTable.mspId, mspRole: usersTable.mspRole, hasPassword: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.email, EMAIL))
    .limit(1);

  let plaintextPassword: string | null = null;

  if (!existing) {
    plaintextPassword = randomPassword();
    const passwordHash = await bcrypt.hash(plaintextPassword, 12);
    // The real mccawsoft2 tenant is already consented and known (unlike the
    // genuine pre-consent *Pending door #4374 models), so this account is
    // created directly at its final Customer rung with the tenant/msp scope
    // stamped inline — users_role_scope_check requires Customer rows to carry
    // tenant_id NOT NULL. Going through a *Pending rung first would only
    // trigger ensureClientMspUser's promote-on-consent swap to that product's
    // own *Consented rung (e.g. RetainerConsented), not Customer — the wrong
    // rung for "a normal paying customer" per Shane's own instruction.
    await db.insert(usersTable).values({
      email: EMAIL,
      role: "client",
      name: FULL_NAME,
      passwordHash,
      mspRole: LEGACY_ROLE.customer,
      tenantId: tenant.id,
      mspId: tenant.mspId,
    });
    console.log(`[create] inserted users row for ${EMAIL} at rung Customer, tenantId=${tenant.id}, mspId=${tenant.mspId}, with a real password set.`);
  } else {
    console.log(
      `[resolve] ${EMAIL} already exists: id=${existing.id}, mspRole=${existing.mspRole}, tenantId=${existing.tenantId}, mspId=${existing.mspId}, hasPassword=${Boolean(existing.hasPassword)}.`,
    );
    if (RESET_PASSWORD) {
      plaintextPassword = randomPassword();
      const passwordHash = await bcrypt.hash(plaintextPassword, 12);
      await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, existing.id));
      console.log(`[reset] rotated password for ${EMAIL}.`);
    }
  }

  // The REAL provisioning path: resolves the (already-existing) tenant,
  // creates/links the real customers + msp_users bridge rows, and promotes
  // the row to the Customer rung — exactly what a live paid signup does.
  const result = await provisionProspectAccount({
    email: EMAIL,
    fullName: FULL_NAME,
    company: tenant.customerName ?? "McCawSoft",
    tenantId: MCCAWSOFT2_ENTRA_TENANT_ID,
    role: LEGACY_ROLE.customer,
  });

  if (!result) {
    console.error("FAIL: provisionProspectAccount returned null (missing email — should be unreachable here).");
    process.exit(1);
  }
  console.log(`[provision] userId=${result.userId} customerId=${result.customerId}`);
  if (result.customerId == null) {
    console.error("FAIL: no real customer bridge (customers/msp_users) was linked — see server log for the swallowed error.");
    process.exit(1);
  }

  const [final] = await db
    .select({ id: usersTable.id, mspRole: usersTable.mspRole, tenantId: usersTable.tenantId, mspId: usersTable.mspId, passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.id, result.userId))
    .limit(1);
  const passwordVerifies =
    plaintextPassword != null && final?.passwordHash ? await bcrypt.compare(plaintextPassword, final.passwordHash) : null;

  console.log("\n=== RESULT (JSON) ===");
  console.log(
    JSON.stringify(
      {
        email: EMAIL,
        userId: final?.id,
        mspRole: final?.mspRole,
        tenantId: final?.tenantId,
        mspId: final?.mspId,
        customerId: result.customerId,
        passwordChangedThisRun: plaintextPassword != null,
        passwordVerifies,
        password: plaintextPassword, // null unless this run set/rotated it — never re-print an old password
      },
      null,
      2,
    ),
  );
}

await main();
