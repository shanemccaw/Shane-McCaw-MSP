/**
 * monitoring-onboarding-scan.test.ts — Git #1314 (Epic #1309 Phase 5).
 *
 * Integration tests for ensureMonitoringScanKickoff, run against the REAL local
 * Postgres (the same DATABASE_URL the dev api-server uses), because every branch
 * under test is a decision made from real rows: the monitoring-only product
 * gate (services.service_type), the completed-account tenant resolution
 * (users.tenant_id), and the idempotency guard (an existing msp_diagnostic_runs
 * row for the customer). The scan trigger itself is injected so no real,
 * Graph-hitting scan fires from the test — only the DECISION is exercised.
 *
 * All rows are created under a unique per-run marker and deleted in afterAll.
 */

import { describe, it, expect, afterAll, vi } from "vitest";
import { randomBytes, randomUUID } from "crypto";
import {
  db,
  servicesTable,
  usersTable,
  tenantsTable,
  mspsTable,
  mspDiagnosticRunsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  ensureMonitoringScanKickoff,
  type OnboardingScanTriggerOpts,
} from "./monitoring-onboarding-scan.ts";
import type { PaidPurchaseSession } from "./purchase-account-flow.ts";

const RUN_TAG = randomBytes(4).toString("hex");
const createdServiceSlugs: string[] = [];
const createdUserIds: number[] = [];
const createdTenantIds: number[] = [];

/** A session object shaped exactly as the route passes one; the function reads
 * only productSlug + accountUserId from it, never re-querying checkout_sessions. */
function fakeSession(overrides: Partial<PaidPurchaseSession>): PaidPurchaseSession {
  return {
    id: randomUUID(),
    productSlug: "unset",
    email: `test-1314-${RUN_TAG}@onboarding-scan-test.invalid`,
    fullName: "Test Buyer 1314",
    company: null,
    industry: null,
    tenantId: null,
    accountUserId: null,
    ...overrides,
  };
}

async function anyMspId(): Promise<number> {
  const [msp] = await db.select({ id: mspsTable.id }).from(mspsTable).limit(1);
  if (!msp) throw new Error("no MSP row exists in the local DB to anchor test rows to");
  return msp.id;
}

async function makeService(serviceType: string, packageKey?: string): Promise<string> {
  const slug = `test-1314-${RUN_TAG}-${serviceType}-${randomBytes(2).toString("hex")}`;
  await db.insert(servicesTable).values({
    slug,
    name: `Test 1314 ${serviceType}`,
    serviceType,
    typeAttributes: packageKey ? { packageKey } : null,
  });
  createdServiceSlugs.push(slug);
  return slug;
}

async function makeTenant(mspId: number): Promise<number> {
  const [row] = await db
    .insert(tenantsTable)
    .values({ mspId, customerName: `Test 1314 Tenant ${RUN_TAG}`, tenantId: randomUUID() })
    .returning({ id: tenantsTable.id });
  createdTenantIds.push(row.id);
  return row.id;
}

async function makeUser(tenantId: number | null): Promise<number> {
  const [row] = await db
    .insert(usersTable)
    .values({ email: `test-1314-${RUN_TAG}-${randomBytes(3).toString("hex")}@onboarding-scan-test.invalid`, tenantId })
    .returning({ id: usersTable.id });
  createdUserIds.push(row.id);
  return row.id;
}

afterAll(async () => {
  if (createdTenantIds.length > 0) {
    await db.delete(mspDiagnosticRunsTable).where(inArray(mspDiagnosticRunsTable.customerId, createdTenantIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  if (createdTenantIds.length > 0) {
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, createdTenantIds));
  }
  if (createdServiceSlugs.length > 0) {
    await db.delete(servicesTable).where(inArray(servicesTable.slug, createdServiceSlugs));
  }
});

describe("ensureMonitoringScanKickoff (Git #1314)", () => {
  it("skips a non-monitoring product (retainer) without firing a scan", async () => {
    const slug = await makeService("retainer");
    const trigger = vi.fn(async (_o: OnboardingScanTriggerOpts) => undefined);

    const result = await ensureMonitoringScanKickoff(
      fakeSession({ productSlug: slug, accountUserId: 1 }),
      { triggerScan: trigger },
    );

    expect(result).toEqual({ fired: false, reason: "not_monitoring" });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("skips when the account was not completed (no accountUserId)", async () => {
    const slug = await makeService("monitoring_tier", "core:security-baseline");
    const trigger = vi.fn(async (_o: OnboardingScanTriggerOpts) => undefined);

    const result = await ensureMonitoringScanKickoff(
      fakeSession({ productSlug: slug, accountUserId: null }),
      { triggerScan: trigger },
    );

    expect(result).toEqual({ fired: false, reason: "account_not_completed" });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("skips when the completed account has no tenant link", async () => {
    const slug = await makeService("monitoring_tier", "core:security-baseline");
    const userId = await makeUser(null); // account exists but is unlinked
    const trigger = vi.fn(async (_o: OnboardingScanTriggerOpts) => undefined);

    const result = await ensureMonitoringScanKickoff(
      fakeSession({ productSlug: slug, accountUserId: userId }),
      { triggerScan: trigger },
    );

    expect(result).toEqual({ fired: false, reason: "no_tenant_link" });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("skips (idempotent) when a diagnostic run already exists for the customer — the consent-time scan already covered it", async () => {
    const mspId = await anyMspId();
    const slug = await makeService("monitoring_tier", "core:security-baseline");
    const tenantId = await makeTenant(mspId);
    const userId = await makeUser(tenantId);
    // Simulate the consent-callback scan having already inserted its run row.
    await db.insert(mspDiagnosticRunsTable).values({ mspId, customerId: tenantId, status: "running" });
    const trigger = vi.fn(async (_o: OnboardingScanTriggerOpts) => undefined);

    const result = await ensureMonitoringScanKickoff(
      fakeSession({ productSlug: slug, accountUserId: userId }),
      { triggerScan: trigger },
    );

    expect(result).toEqual({ fired: false, reason: "already_kicked_off" });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("fires exactly one scan for a monitoring customer with no prior run, with the product's packageKey", async () => {
    const mspId = await anyMspId();
    const slug = await makeService("monitoring_tier", "monitoring:standard-tier");
    const tenantId = await makeTenant(mspId);
    const userId = await makeUser(tenantId);
    const trigger = vi.fn(async (_o: OnboardingScanTriggerOpts) => undefined);

    const result = await ensureMonitoringScanKickoff(
      fakeSession({ productSlug: slug, accountUserId: userId }),
      { triggerScan: trigger },
    );

    expect(result).toEqual({
      fired: true,
      reason: "kicked_off",
      customerId: tenantId,
      packageKey: "monitoring:standard-tier",
    });
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith({
      customerId: tenantId,
      packageKey: "monitoring:standard-tier",
      isAssessmentTriggered: false,
    });
  });

  it("fires with an undefined packageKey (baseline fallback) when the product declares none", async () => {
    const mspId = await anyMspId();
    const slug = await makeService("monitoring_tier"); // no packageKey in type_attributes
    const tenantId = await makeTenant(mspId);
    const userId = await makeUser(tenantId);
    const trigger = vi.fn(async (_o: OnboardingScanTriggerOpts) => undefined);

    const result = await ensureMonitoringScanKickoff(
      fakeSession({ productSlug: slug, accountUserId: userId }),
      { triggerScan: trigger },
    );

    expect(result).toEqual({ fired: true, reason: "kicked_off", customerId: tenantId, packageKey: undefined });
    expect(trigger).toHaveBeenCalledWith({ customerId: tenantId, packageKey: undefined, isAssessmentTriggered: false });
  });
});
