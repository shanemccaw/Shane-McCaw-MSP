/**
 * Live-Postgres acceptance test for #4397 — the monitoring scan kickoff
 * backstop (#1314's ensureMonitoringScanKickoff) never fired for an
 * account-first Monitoring buyer, because its only call site was
 * set-password's `ok` outcome and an account-first buyer (#4374's door)
 * always reaches set-password as `already_set` instead (the account's
 * password was attached before consent, not through that call).
 *
 * The fix (public-purchase-payment.ts's /payment-confirmed handler) resolves
 * the just-paid session and fires the same ensureMonitoringScanKickoff the
 * legacy pay-then-account flow already relies on, whenever the session
 * carries an accountUserId at payment time — which is exactly the
 * account-first shape (the pre-consent door records it at account creation,
 * long before payment). This test drives that exact call path — the real
 * resolvePaidPurchaseSession + ensureMonitoringScanKickoff functions the
 * route now calls — against the real database, with only the outbound scan
 * trigger itself stubbed (a real runDiagnostics call hits Microsoft Graph,
 * which is out of scope for this fix).
 *
 * Synthetic identities only: `zz-test-4397-<tag>-*@example.invalid`. afterAll
 * deletes everything created here.
 *
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run public-purchase-payment-account-first-monitoring-kickoff.live-db
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  checkoutSessionsTable,
  usersTable,
  tenantsTable,
  mspsTable,
  servicesTable,
  mspDiagnosticRunsTable,
} from "@workspace/db";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

const TAG = `zz-test-4397-${randomUUID().slice(0, 8)}`;

describeLive("#4397 — account-first buyer's monitoring scan kickoff fires at payment confirmation", () => {
  let flow: typeof import("../lib/purchase-account-flow.ts");
  let kickoffModule: typeof import("../lib/monitoring-onboarding-scan.ts");

  let mspId: number;
  let tenantRowId: number;
  let userId: number;
  let sessionId: string;
  let monitoringSlug: string;

  beforeAll(async () => {
    flow = await import("../lib/purchase-account-flow.ts");
    kickoffModule = await import("../lib/monitoring-onboarding-scan.ts");

    const [svc] = await db
      .select({ slug: servicesTable.slug })
      .from(servicesTable)
      .where(and(eq(servicesTable.category, "monitoring"), eq(servicesTable.visibility, "public")))
      .limit(1);
    if (!svc) throw new Error("live catalog must carry at least one public monitoring service row");
    monitoringSlug = svc.slug!;

    const [msp] = await db.insert(mspsTable).values({ name: `${TAG} MSP`, slug: TAG }).returning({ id: mspsTable.id });
    mspId = msp.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `${TAG} Customer`, tenantId: randomUUID() })
      .returning({ id: tenantsTable.id });
    tenantRowId = tenant.id;

    // The account-first door's real shape: a real users row, password already
    // set, tenant already linked — accountUserId on the checkout session
    // points at exactly this row, same as createPreConsentAccount records it.
    const [user] = await db
      .insert(usersTable)
      .values({
        email: `${TAG}@example.invalid`,
        passwordHash: "not-a-real-hash",
        mspRole: "MonitoringConsented",
        mspId,
        tenantId: tenantRowId,
      })
      .returning({ id: usersTable.id });
    userId = user.id;

    const [session] = await db
      .insert(checkoutSessionsTable)
      .values({
        productSlug: monitoringSlug,
        fullName: `${TAG} Buyer`,
        email: `${TAG}@example.invalid`,
        company: `${TAG} Co`,
        status: "paid",
        accountUserId: userId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: checkoutSessionsTable.id });
    sessionId = session.id;
  });

  afterAll(async () => {
    if (sessionId) await db.delete(checkoutSessionsTable).where(eq(checkoutSessionsTable.id, sessionId));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    if (tenantRowId) await db.delete(mspDiagnosticRunsTable).where(eq(mspDiagnosticRunsTable.customerId, tenantRowId));
    if (tenantRowId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantRowId));
    if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  it("resolvePaidPurchaseSession carries the pre-consent-recorded accountUserId at payment time", async () => {
    const resolved = await flow.resolvePaidPurchaseSession(sessionId);
    expect(resolved.ok, JSON.stringify(resolved)).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.session.accountUserId).toBe(userId);
  });

  it("ensureMonitoringScanKickoff — the exact call the payment-confirmed route now makes — fires for this account-first session", async () => {
    const resolved = await flow.resolvePaidPurchaseSession(sessionId);
    if (!resolved.ok) throw new Error("session must resolve");

    const triggerScan = vi.fn().mockResolvedValue(undefined);
    const result = await kickoffModule.ensureMonitoringScanKickoff(resolved.session, { triggerScan });

    expect(result).toEqual({ fired: true, reason: "kicked_off", customerId: tenantRowId, packageKey: expect.anything() });
    // triggerScan is fire-and-forget inside ensureMonitoringScanKickoff; give its
    // microtask a tick to run before asserting it was actually invoked.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(triggerScan).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: tenantRowId, isAssessmentTriggered: false }),
    );
  });

  it("is idempotent — a second call after a run exists is a no-op, matching a resumed/replayed payment confirm", async () => {
    await db.insert(mspDiagnosticRunsTable).values({ mspId, customerId: tenantRowId, status: "pending" });

    const resolved = await flow.resolvePaidPurchaseSession(sessionId);
    if (!resolved.ok) throw new Error("session must resolve");

    const triggerScan = vi.fn().mockResolvedValue(undefined);
    const result = await kickoffModule.ensureMonitoringScanKickoff(resolved.session, { triggerScan });

    expect(result).toEqual({ fired: false, reason: "already_kicked_off" });
    expect(triggerScan).not.toHaveBeenCalled();
  });
});
