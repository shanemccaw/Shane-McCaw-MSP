/**
 * Live integrity harness for the RBAC foundation (#2455, part of #1696).
 *
 * KEPT, re-runnable tool — not a scratch script. The unit tests next to this file
 * cover the pure half (the catalog's enumerability, the evaluator's deny-wins /
 * default-deny / fail-closed rules). They structurally cannot cover the other
 * half, which lives in the database: the composite FK onto the capability
 * catalog, and the three trigger pairs that supply the referential integrity a
 * `jsonb` column cannot have (#1696 requirement 2). This is the only automated
 * proof those actually hold, and they are the load-bearing security mechanism —
 * #2457 and #2458 both build directly on them, so re-run this after touching the
 * migration or either mapping table.
 *
 * Run:
 *   pnpm --filter @workspace/db run check-rbac-integrity
 *
 * Safe by construction: everything it does happens inside ONE transaction that is
 * always rolled back, and the run ends by asserting every table holds exactly the
 * rows it held before. It needs `DATABASE_URL` pointed at a database the
 * migration has been applied to (local dev — never staging or production).
 *
 * ── Why it clears the tables first (#2457) ──────────────────────────────────
 * These checks were written against empty tables, and #2457 stopped them being
 * empty: it seeds the seven ladder rungs, three capability-column roles, a
 * platform mapping for every catalogued capability, and a grant for every real
 * user. Several checks here assert an exact set — "the loader returns both held
 * roles", "an unmapped capability defaults to deny" — and a platform-scoped
 * `billing.view` mapping row now already exists, which the "real writes the
 * product will make" block would collide with.
 *
 * So the transaction begins by deleting every RBAC row, restoring the
 * precondition these assertions were designed for, and the rollback puts the
 * seed back untouched. That keeps this harness testing what it was written to
 * test — the schema's integrity mechanisms — rather than turning it into a
 * second, weaker parity check. Whether the SEEDED rows are correct is
 * ./parity-check.ts's job, against the real seed, with the real evaluator.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { loadRbacEvaluator } from "./load.ts";
import { syncCapabilityCatalog } from "./sync.ts";
import { RBAC_CAPABILITIES } from "./capabilities.ts";
import {
  customerFeatureRoleMappingTable,
  customerRolesTable,
  customerUserRolesTable,
  mspRolesTable,
  mspUserRolesTable,
} from "../schema/rbac.ts";

type Tx = Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0];

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS " : "FAIL "} ${label}${ok ? "" : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

/**
 * Assert that a write the schema is supposed to REFUSE actually is refused.
 *
 * Each attempt runs in its own savepoint (a nested drizzle transaction), because
 * a failed statement poisons the enclosing transaction until it is rolled back to
 * one — so a negative check must not be able to take the rest of the run with it.
 */
async function expectRefused(tx: Tx, label: string, write: (tx: Tx) => Promise<unknown>): Promise<void> {
  try {
    await tx.transaction(async (nested) => {
      await write(nested);
    });
    failures++;
    console.log(`FAIL  ${label} — the write was ACCEPTED`);
  } catch (err) {
    // Drizzle wraps the driver error; the `cause` is the actual Postgres message,
    // which is the part worth printing (it names the constraint or the trigger).
    const cause = (err as { cause?: Error }).cause;
    console.log(`PASS  ${label} — refused: ${(cause ?? (err as Error)).message.split("\n")[0]}`);
  }
}

class Rollback extends Error {}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Real rows in the local dev database. Nothing here is created or modified
// outside the rolled-back transaction.
const MSP = 1;
const OTHER_MSP = 1626;
const TENANT = 1;
const OTHER_TENANT = 3;
const MSP_USER = 1;
const CUSTOMER_USER = 39;

/** Row counts across the six RBAC tables, in a fixed order. */
async function rbacCounts(handle: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> }): Promise<number[]> {
  const [row] = (await handle.execute(sql`
    SELECT (SELECT count(*)::int FROM msp_roles)                     AS msp_roles,
           (SELECT count(*)::int FROM customer_roles)                AS customer_roles,
           (SELECT count(*)::int FROM msp_user_roles)                AS msp_user_roles,
           (SELECT count(*)::int FROM customer_user_roles)           AS customer_user_roles,
           (SELECT count(*)::int FROM msp_feature_role_mapping)      AS msp_mappings,
           (SELECT count(*)::int FROM customer_feature_role_mapping) AS customer_mappings
  `)).rows as Array<Record<string, number>>;
  return Object.values(row!);
}

// Taken BEFORE the transaction opens, and re-taken after it rolls back. The
// harness is only safe if these agree.
const countsBefore = await rbacCounts(db);

try {
  await db.transaction(async (tx) => {
    // ── clear the seed, inside the rollback ────────────────────────────────
    // See the header: these assertions were written against empty tables and
    // #2457's seed populated them. Deleting here is scoped to this transaction
    // and undone by the rollback below; the mapping rows go first because the
    // role-delete trigger rewrites them.
    await tx.execute(sql`DELETE FROM msp_feature_role_mapping`);
    await tx.execute(sql`DELETE FROM customer_feature_role_mapping`);
    await tx.execute(sql`DELETE FROM msp_user_roles`);
    await tx.execute(sql`DELETE FROM customer_user_roles`);
    await tx.execute(sql`DELETE FROM msp_roles`);
    await tx.execute(sql`DELETE FROM customer_roles`);

    // ── roles: uuid pks, both scopes, both systems ─────────────────────────
    const [platformMspRole] = await tx.insert(mspRolesTable)
      .values({ mspId: null, key: "zz-check-platform", name: "Platform Baseline", isSystem: true }).returning();
    const [ownMspRole] = await tx.insert(mspRolesTable)
      .values({ mspId: MSP, key: "zz-check-own", name: "Own MSP Role" }).returning();
    const [foreignMspRole] = await tx.insert(mspRolesTable)
      .values({ mspId: OTHER_MSP, key: "zz-check-foreign", name: "Another MSP's Role" }).returning();

    const [engineer] = await tx.insert(customerRolesTable)
      .values({ tenantId: TENANT, key: "zz-check-engineer", name: "Engineer" }).returning();
    const [billingBaseline] = await tx.insert(customerRolesTable)
      .values({ tenantId: null, key: "zz-check-billing", name: "Billing Contact", isSystem: true }).returning();
    const [foreignCustomerRole] = await tx.insert(customerRolesTable)
      .values({ tenantId: OTHER_TENANT, key: "zz-check-foreign", name: "Another Tenant's Role" }).returning();
    console.log("PASS  roles insert — uuid pks, platform + org scope, both systems");

    // ── many-to-many: a user holds several roles ───────────────────────────
    await tx.insert(mspUserRolesTable).values([
      { userId: MSP_USER, roleId: ownMspRole.id },
      { userId: MSP_USER, roleId: platformMspRole.id },
    ]);
    await tx.insert(customerUserRolesTable).values([
      { userId: CUSTOMER_USER, roleId: engineer.id },
      { userId: CUSTOMER_USER, roleId: billingBaseline.id },
    ]);
    console.log("PASS  many-to-many grants — one user, two roles, in each system");

    // ── a role from another org may never be granted ───────────────────────
    await expectRefused(tx, "cross-MSP grant", (t) =>
      t.insert(mspUserRolesTable).values({ userId: MSP_USER, roleId: foreignMspRole.id }));
    await expectRefused(tx, "cross-tenant grant", (t) =>
      t.insert(customerUserRolesTable).values({ userId: CUSTOMER_USER, roleId: foreignCustomerRole.id }));

    // ── the capability catalog is a real FK, not a convention ──────────────
    await expectRefused(tx, "uncatalogued capability key", (t) =>
      t.insert(customerFeatureRoleMappingTable).values({
        tenantId: TENANT, capabilityKey: "not.a.capability", roles: { allow: [engineer.id], deny: [] },
      }));
    await expectRefused(tx, "a capability belonging to the OTHER system", (t) =>
      t.insert(customerFeatureRoleMappingTable).values({
        tenantId: TENANT, capabilityKey: "purchases.approve", roles: { allow: [engineer.id], deny: [] },
      }));

    // ── roles referenced by stable id, never by name (#1696 req 2) ─────────
    await expectRefused(tx, "a role NAME inside the jsonb", (t) =>
      t.insert(customerFeatureRoleMappingTable).values({
        tenantId: TENANT, capabilityKey: "billing.view", roles: { allow: ["Engineer"], deny: [] },
      }));
    await expectRefused(tx, "a dangling role uuid", (t) =>
      t.insert(customerFeatureRoleMappingTable).values({
        tenantId: TENANT, capabilityKey: "billing.view", roles: { allow: ["99999999-9999-4999-8999-999999999999"], deny: [] },
      }));
    await expectRefused(tx, "another tenant's role cited in this tenant's mapping", (t) =>
      t.insert(customerFeatureRoleMappingTable).values({
        tenantId: TENANT, capabilityKey: "billing.view", roles: { allow: [foreignCustomerRole.id], deny: [] },
      }));
    await expectRefused(tx, "a platform-wide mapping citing one org's role", (t) =>
      t.insert(customerFeatureRoleMappingTable).values({
        tenantId: null, capabilityKey: "billing.view", roles: { allow: [engineer.id], deny: [] },
      }));
    await expectRefused(tx, "a malformed roles payload", (t) =>
      t.execute(sql`INSERT INTO customer_feature_role_mapping (tenant_id, capability_key, roles) VALUES (${TENANT}, 'billing.view', '{"allow": "everyone"}'::jsonb)`));

    // ── the real writes the product will make ──────────────────────────────
    // Platform default grants billing.view to the baseline billing role...
    await tx.insert(customerFeatureRoleMappingTable).values({
      tenantId: null, capabilityKey: "billing.view", roles: { allow: [billingBaseline.id], deny: [] },
    });
    // ...and this tenant denies it to its engineers. The user holds BOTH roles —
    // the exact conflict #1696 requirement 1 exists to resolve.
    await tx.insert(customerFeatureRoleMappingTable).values({
      tenantId: TENANT, capabilityKey: "billing.view", roles: { allow: [], deny: [engineer.id] },
    });
    await tx.insert(customerFeatureRoleMappingTable).values({
      tenantId: TENANT, capabilityKey: "changes.approve", roles: { allow: [engineer.id], deny: [] },
    });
    console.log("PASS  valid mappings stored — platform default + tenant override");

    await expectRefused(tx, "a second mapping row for the same (tenant, capability)", (t) =>
      t.insert(customerFeatureRoleMappingTable).values({ tenantId: TENANT, capabilityKey: "billing.view" }));

    // ── the loader + evaluator, against those real rows ────────────────────
    const evaluator = await loadRbacEvaluator(tx as never, { system: "customer", userId: CUSTOMER_USER, orgId: TENANT });
    check("loader returns both held roles", [...evaluator.context.roleIds].sort(), [engineer.id, billingBaseline.id].sort());
    check("loader returns the platform row and the override row", evaluator.context.mappings.length, 3);
    check("DENY WINS over a platform allow, from real rows", evaluator.decide("billing.view").effect, "deny");
    check("the denying role is named in the decision", evaluator.decide("billing.view").decidedBy, [engineer.id]);
    check("a sideways grant still resolves", evaluator.can("changes.approve"), true);
    check("an unmapped capability defaults to deny", evaluator.decide("team.manage").effect, "unset");
    check("the granted set excludes the denied capability", evaluator.grantedCapabilities(), ["changes.approve"]);

    const mspEvaluator = await loadRbacEvaluator(tx as never, { system: "msp", userId: CUSTOMER_USER, orgId: MSP });
    check("customer roles do not leak into the MSP system", mspEvaluator.context.roleIds.length, 0);
    check("an MSP-side check on a customer user denies", mspEvaluator.can("purchases.approve"), false);

    // ── rename is free; delete must not orphan (#1696 requirement 2) ───────
    await tx.update(customerRolesTable).set({ name: "Renamed After The Fact" })
      .where(sql`${customerRolesTable.id} = ${engineer.id}`);
    const afterRename = await loadRbacEvaluator(tx as never, { system: "customer", userId: CUSTOMER_USER, orgId: TENANT });
    check("renaming a role changes no decision — nothing stores the name", afterRename.decide("billing.view").effect, "deny");

    await tx.delete(customerRolesTable).where(sql`${customerRolesTable.id} = ${engineer.id}`);
    const [payload] = (await tx.execute(sql`SELECT roles FROM customer_feature_role_mapping WHERE tenant_id = ${TENANT} AND capability_key = 'billing.view'`)).rows as Array<{ roles: { allow: string[]; deny: string[] } }>;
    check("deleting a role strips its id from every mapping", payload.roles.deny.includes(engineer.id), false);
    const [platformPayload] = (await tx.execute(sql`SELECT roles FROM customer_feature_role_mapping WHERE tenant_id IS NULL AND capability_key = 'billing.view'`)).rows as Array<{ roles: { allow: string[]; deny: string[] } }>;
    check("the purge leaves unrelated role references alone", platformPayload.roles.allow, [billingBaseline.id]);
    const [{ n: survivingGrants }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM customer_user_roles WHERE role_id = ${engineer.id}::uuid`)).rows as Array<{ n: number }>;
    check("grants pointing at the deleted role cascade away", survivingGrants, 0);

    // ── the catalog table tracks the TS catalog ────────────────────────────
    const synced = await syncCapabilityCatalog(tx as never);
    check("catalog sync upserts every TS entry", synced.upserted, RBAC_CAPABILITIES.length);
    check("catalog sync deactivates nothing still catalogued", synced.deactivated, 0);
    const [{ n: active }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM rbac_capabilities WHERE is_active`)).rows as Array<{ n: number }>;
    check("the table matches the TS catalog after sync", active, RBAC_CAPABILITIES.length);

    throw new Rollback("rolling back — this harness never keeps its rows");
  });
} catch (err) {
  if (!(err instanceof Rollback)) {
    failures++;
    console.error("FAIL  harness threw:", err);
  }
}

// The rollback must have restored the #2457 seed exactly — both the rows this
// harness wrote and the rows it deleted to make room for them.
check("rollback restored every row it touched", await rbacCounts(db), countsBefore);

await pool.end();
console.log(failures === 0 ? "\n--- RBAC LIVE INTEGRITY: ALL CHECKS PASSED ---" : `\n--- RBAC LIVE INTEGRITY: ${failures} FAILURE(S) ---`);
process.exit(failures === 0 ? 0 : 1);
