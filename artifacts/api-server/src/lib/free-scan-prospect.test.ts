/**
 * free-scan-prospect.test.ts — Git #1355 (Phase 3 of Epic #1352, Free Scan).
 *
 * Phase 3 owns ONE guarantee: when a Free Scan visitor grants read-only M365
 * consent, a REAL passwordless "Prospect" shell account with a REAL customerId
 * comes into existence — so Phase 4's scan trigger and Phase 7's return link
 * have something real to attach to — WITHOUT ever handing that visitor a way
 * into the portal.
 *
 * The account itself is already created by the existing consent callback
 * (routes/consent.ts): the Free Scan wires its read consent through the #1311
 * session-keyed checkout-session flow (#1361), and the callback provisions the
 * Prospect via provisionProspectAccount the instant Microsoft confirms the
 * grant. The role that call passes is chosen from the product's service_type
 * (`serviceType === "assessment" ? "Assessment" : "CustomerUser"`), and the Free
 * Scan product `license-waste-audit-free` is an `assessment`, so the Prospect
 * lands with the low-privilege "Assessment" role.
 *
 * This suite regression-LOCKS both halves of that invariant so a later change
 * cannot silently break them:
 *   1. the product mapping (`license-waste-audit-free` → service_type
 *      "assessment" → role "Assessment"), and
 *   2. the shape of the shell account provisionProspectAccount produces for that
 *      exact call — passwordless, low-privilege, tenant-linked (real customerId),
 *      and crucially WITHOUT a client_services entitlement.
 *
 * The entitlement assertion is the security core (#656): /auth/setup-password
 * and /auth/forgot-password both gate password/session issuance on
 * hasRealEntitlement(), whose sole input is "does a client_services row exist
 * for this user". A Free Scan Prospect has none, so it can reach neither a
 * password nor a session nor any authenticated portal route until it actually
 * converts and a real entitlement is created later. This suite asserts that
 * gate's input is empty for the freshly-provisioned Prospect.
 *
 * Runs against the REAL local Postgres (the same DATABASE_URL the dev
 * api-server uses), like purchase-account-flow.test.ts — the invariant lives in
 * the rows provisionProspectAccount writes, not in a mock. Every row it creates
 * is swept in afterAll, and the staged lead + queued Zoho job the real path
 * emits for a `.invalid` address are swept too so nothing fake drains into Zoho.
 */

import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  tenantsTable,
  servicesTable,
  clientServicesTable,
  accountSetupTokensTable,
  leadStagingTable,
  mspJobQueueTable,
} from "@workspace/db";
import { eq, inArray, like, sql } from "drizzle-orm";
import { provisionProspectAccount } from "./direct-tenant-provisioning.ts";

const FREE_SCAN_PRODUCT_SLUG = "license-waste-audit-free";

// The exact role selection routes/consent.ts makes for a checkout-session
// Prospect. Mirrored here so the test breaks if the product's service_type
// drifts away from "assessment" and the Free Scan silently starts minting
// higher-privilege "CustomerUser" prospects.
function roleForServiceType(serviceType: string | null): "Assessment" | "CustomerUser" {
  return serviceType === "assessment" ? "Assessment" : "CustomerUser";
}

const createdEmails: string[] = [];
const createdTenantGuids: string[] = [];

function testEmail(label: string): string {
  const email = `test-1355-${label}-${randomUUID().slice(0, 8)}@free-scan-prospect-test.invalid`;
  createdEmails.push(email);
  return email;
}

function testTenantGuid(): string {
  const guid = randomUUID();
  createdTenantGuids.push(guid);
  return guid;
}

afterAll(async () => {
  // users first (they carry the tenant FK), then the tenants rows.
  if (createdEmails.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.email, createdEmails));
  }
  if (createdTenantGuids.length > 0) {
    await db.delete(tenantsTable).where(inArray(tenantsTable.tenantId, createdTenantGuids));
  }
  // The REAL provisioning path stages a lead + a queued Zoho upsert job — right
  // in production, garbage here. Sweep both so no fake lead for a .invalid
  // address ever drains into Zoho CRM.
  await db.delete(leadStagingTable).where(like(leadStagingTable.email, "%free-scan-prospect-test.invalid"));
  await db
    .delete(mspJobQueueTable)
    .where(sql`${mspJobQueueTable.payload}::text LIKE '%free-scan-prospect-test.invalid%'`);
});

describe("Free Scan product mapping (Git #1355)", () => {
  it("license-waste-audit-free is a landing-page-only, free assessment → role resolves to Assessment", async () => {
    const [svc] = await db
      .select({
        serviceType: servicesTable.serviceType,
        isPublic: servicesTable.isPublic,
        visibility: servicesTable.visibility,
        priceCents: servicesTable.priceCents,
      })
      .from(servicesTable)
      .where(eq(servicesTable.slug, FREE_SCAN_PRODUCT_SLUG))
      .limit(1);

    expect(svc, `services row for '${FREE_SCAN_PRODUCT_SLUG}' must exist`).toBeTruthy();
    // service_type "assessment" is what routes the consent-time Prospect to the
    // low-privilege "Assessment" role instead of "CustomerUser".
    expect(svc.serviceType).toBe("assessment");
    // Git #1169: this product is reached only through the marketing /scan
    // consent funnel, never the general public catalog. GET
    // /api/catalog/assessments filters on isPublic (not visibility), so both
    // must be set for it to actually stay off the general pricing page —
    // isPublic=true here was a real gap (#1169's migration fixed it).
    expect(svc.isPublic).toBe(false);
    expect(svc.visibility).toBe("landing_page_only");
    // A Free Scan carries no payment gate.
    expect(svc.priceCents).toBe(0);
    expect(roleForServiceType(svc.serviceType)).toBe("Assessment");
  });
});

describe("Prospect shell-account creation at consent time (Git #1355)", () => {
  it("provisions a passwordless, low-privilege, tenant-linked account with NO entitlement", async () => {
    const email = testEmail("prospect");
    const tenantGuid = testTenantGuid();

    // The exact call routes/consent.ts makes for the Free Scan's
    // (assessment-typed) checkout session on a real grant.
    const result = await provisionProspectAccount({
      email,
      fullName: "Free Scan Tester",
      company: "Free Scan Test Co",
      industry: "Unknown",
      tenantId: tenantGuid,
      role: "Assessment",
    });

    expect(result, "provisionProspectAccount must return an account").toBeTruthy();
    const { userId, customerId } = result!;

    // A REAL customerId exists — the whole point of Phase 3: later phases (scan
    // trigger, results, return link) now have a real tenant to attach to.
    expect(customerId).toBeTypeOf("number");
    expect(customerId).not.toBeNull();

    const [user] = await db
      .select({
        id: usersTable.id,
        passwordHash: usersTable.passwordHash,
        role: usersTable.role,
        mspRole: usersTable.mspRole,
        tenantId: usersTable.tenantId,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    expect(user, "the users row must exist").toBeTruthy();
    // Passwordless — /auth/login refuses an account with no passwordHash
    // ("No password set for this account"), so it can never be logged into.
    expect(user.passwordHash).toBeNull();
    // Low-privilege scope: a funnel Prospect, promoted to CustomerUser only on a
    // real payment (promoteMspUserToCustomer). It never lands at CustomerUser here.
    expect(user.mspRole).toBe("Assessment");
    expect(user.role).toBe("client");
    // The users row is genuinely tenant-linked, and to the SAME customer id the
    // function returned.
    expect(user.tenantId).toBe(customerId);

    // The tenants row it links to really exists for the consented GUID.
    const [tenant] = await db
      .select({ id: tenantsTable.id, tenantId: tenantsTable.tenantId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, customerId!))
      .limit(1);
    expect(tenant, "the linked tenants row must exist").toBeTruthy();
    expect(tenant.tenantId).toBe(tenantGuid);

    // ── The security core (#656) ────────────────────────────────────────────
    // hasRealEntitlement() (auth.ts) — the gate BOTH /auth/setup-password and
    // /auth/forgot-password check before issuing a password or session — asks
    // exactly one question: does a client_services row exist for this user? A
    // Free Scan Prospect has none, so:
    //   - /auth/forgot-password refuses to mint an account-setup token, and
    //   - /auth/setup-password refuses to consume one even if it somehow had one,
    // meaning this account cannot reach /setup-password, a session, or any
    // authenticated portal route until it actually converts and a real
    // entitlement is created later. Assert the gate's input is empty.
    const entitlements = await db
      .select({ id: clientServicesTable.id })
      .from(clientServicesTable)
      .where(eq(clientServicesTable.clientUserId, userId))
      .limit(1);
    expect(entitlements.length).toBe(0);

    // And nothing minted an account-setup token for it either.
    const setupTokens = await db
      .select({ id: accountSetupTokensTable.id })
      .from(accountSetupTokensTable)
      .where(eq(accountSetupTokensTable.userId, userId))
      .limit(1);
    expect(setupTokens.length).toBe(0);
  });

  it("is idempotent — a repeat grant for the same email reuses the same account", async () => {
    const email = testEmail("idempotent");
    const tenantGuid = testTenantGuid();

    const first = await provisionProspectAccount({
      email,
      fullName: "Repeat Tester",
      company: "Repeat Test Co",
      tenantId: tenantGuid,
      role: "Assessment",
    });
    const second = await provisionProspectAccount({
      email,
      fullName: "Repeat Tester",
      company: "Repeat Test Co",
      tenantId: tenantGuid,
      role: "Assessment",
    });

    expect(first?.userId).toBeTypeOf("number");
    expect(second?.userId).toBe(first?.userId);

    // Still exactly one users row for this email — the repeat did not fork a
    // second account, and it still has no password.
    const rows = await db
      .select({ id: usersTable.id, passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(eq(usersTable.email, email));
    expect(rows.length).toBe(1);
    expect(rows[0].passwordHash).toBeNull();
  });
});
