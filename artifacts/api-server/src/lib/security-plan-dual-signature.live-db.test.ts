/**
 * Live-Postgres regression test for #3793 (parented under #1689, Feature:
 * Security Plan (MSP Console)) — the dual-signature decision: a Security Plan
 * version is signed by BOTH the customer and the MSP, independently. The
 * original single `signed`/`signedBy`/`signedAt` triple had room for exactly
 * one signer; whichever party signed first blocked the other outright.
 *
 * Live rather than mocked, deliberately: the whole point of this build is
 * that the customer's own signature and the MSP's own signature land in two
 * genuinely independent DB columns and neither write's guard clause trips on
 * the other party's row state — a mocked `db` would assert the function calls
 * SOME update, not that both real signatures coexist on the same row.
 *
 * Skips cleanly with no `DATABASE_URL`, matching
 * `msp-poam-rbd-conversion.live-db.test.ts`. Every row it writes is synthetic,
 * suffixed, and removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run security-plan-dual-signature.live-db
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, mspsTable, tenantsTable } from "@workspace/db";
import type { SecurityPlanContent } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  createSecurityPlanVersion,
  getLastFullyExecutedSecurityPlanVersion,
  isSecurityPlanVersionFullyExecuted,
  signSecurityPlanVersionAsCustomer,
  signSecurityPlanVersionAsMsp,
} from "./security-plan-versioning.ts";

describe.skipIf(!process.env.DATABASE_URL)("Security Plan dual signature — live Postgres (#1689/#3793)", () => {
  const suffix = `vitest-3793-${Math.floor(Math.random() * 1e9)}`;
  let mspId: number;
  let customerId: number;
  const tenantMsId = `${suffix}.onmicrosoft.com`;

  const content: SecurityPlanContent = {
    customerId: 0, // filled in after customerId is known
    tenantId: tenantMsId,
    tenantName: "Dual Signature Test Co",
    assembledAt: "2026-09-12T00:00:00.000Z",
    modules: [],
    footprint: {
      scope: { dimensions: {}, statement: "Full assessed estate — no scope narrowing applied." },
      isHonestView: true,
      excludedByModule: [],
      totalExcluded: 0,
      computedAt: "2026-09-12T00:00:00.000Z",
    },
    prose: null,
  } as unknown as SecurityPlanContent;

  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `Dual Signature Test MSP ${suffix}`, slug: suffix })
      .returning({ id: mspsTable.id });
    mspId = msp.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: "Dual Signature Test Co", tenantId: tenantMsId })
      .returning({ id: tenantsTable.id });
    customerId = tenant.id;
  });

  afterAll(async () => {
    await db.delete(tenantsTable).where(eq(tenantsTable.id, customerId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  it("lets the customer and the MSP each sign independently, and only reads fully-executed once both have", async () => {
    const created = await createSecurityPlanVersion({
      mspId,
      customerId,
      tenantId: tenantMsId,
      tenantName: "Dual Signature Test Co",
      content: { ...content, customerId },
      createdBy: { name: "Shane McCaw", upn: "shane@shanemccaw.com", timestamp: "2026-09-12 00:00:00 UTC" },
    });

    expect(created.customerSignedAt).toBeNull();
    expect(created.mspSignedAt).toBeNull();
    expect(isSecurityPlanVersionFullyExecuted(created)).toBe(false);

    // Nothing is fully executed yet — the customer alone signing does not count.
    const afterCustomerSign = await signSecurityPlanVersionAsCustomer(mspId, customerId, created.versionUid, {
      name: "Jordan Diaz",
      title: "IT Administrator",
      email: "jordan@clientdomain.com",
      signedAt: "2026-09-12 01:00:00 UTC",
      ipAddress: "203.0.113.5",
      signatureHash: "deadbeef",
    });
    expect(afterCustomerSign).not.toBeNull();
    expect(afterCustomerSign!.customerSignedAt).not.toBeNull();
    expect(afterCustomerSign!.customerSignedBy).toMatchObject({ name: "Jordan Diaz" });
    expect(afterCustomerSign!.mspSignedAt).toBeNull(); // untouched by the customer's own signature
    expect(isSecurityPlanVersionFullyExecuted(afterCustomerSign!)).toBe(false);

    let lastExecuted = await getLastFullyExecutedSecurityPlanVersion(mspId, customerId);
    expect(lastExecuted).toBeNull(); // still not fully executed — the MSP hasn't signed

    // A second attempt at the CUSTOMER's own slot is refused (already signed by
    // this party) — but the MSP's independent slot is completely unaffected by it.
    const rejectedDoubleCustomerSign = await signSecurityPlanVersionAsCustomer(mspId, customerId, created.versionUid, {
      name: "Someone Else",
      title: "",
      email: "someone@clientdomain.com",
      signedAt: "2026-09-12 02:00:00 UTC",
      ipAddress: null,
      signatureHash: "cafebabe",
    });
    expect(rejectedDoubleCustomerSign).toBeNull();

    // The MSP now signs its own, independent slot — this must succeed even
    // though the customer's slot is already filled (the real bug #3793 fixes:
    // the old single-slot guard would have refused this as "already signed").
    const afterMspSign = await signSecurityPlanVersionAsMsp(mspId, customerId, created.versionUid, {
      name: "Shane McCaw",
      upn: "shane@shanemccaw.com",
      timestamp: "2026-09-12 03:00:00 UTC",
    });
    expect(afterMspSign).not.toBeNull();
    expect(afterMspSign!.mspSignedAt).not.toBeNull();
    expect(afterMspSign!.mspSignedBy).toMatchObject({ name: "Shane McCaw" });
    // The customer's own signature from earlier is still intact, untouched by the MSP's write.
    expect(afterMspSign!.customerSignedBy).toMatchObject({ name: "Jordan Diaz" });
    expect(isSecurityPlanVersionFullyExecuted(afterMspSign!)).toBe(true);

    lastExecuted = await getLastFullyExecutedSecurityPlanVersion(mspId, customerId);
    expect(lastExecuted).not.toBeNull();
    expect(lastExecuted!.versionUid).toBe(created.versionUid);

    // A second attempt at the MSP's own slot is refused the same way.
    const rejectedDoubleMspSign = await signSecurityPlanVersionAsMsp(mspId, customerId, created.versionUid, {
      name: "Another Assessor",
      upn: "other@shanemccaw.com",
      timestamp: "2026-09-12 04:00:00 UTC",
    });
    expect(rejectedDoubleMspSign).toBeNull();
  });
});
