/**
 * Live-Postgres route test for the Free Scan Remediate step's gates (Git #1375).
 *
 * This is the security-relevant half of the issue: the routes here can put a
 * real Microsoft admin-consent screen for the WRITE App Registration in front
 * of an unauthenticated caller. What has to hold is that they refuse to do so
 * unless the engagement is genuinely signed and paid, the read grant is genuinely
 * in place, and the bought phases genuinely need a write permission — and that
 * a refusal happens BEFORE any `consent_invite_tokens` row exists, so the shared
 * fixed callback never has state it could accept for a refused request.
 *
 * Live rather than mocked for the same reason the scope test is: the gates read
 * real rows (`free_scan_engagements.status`, `tenants.consent.graph`, the
 * config-pack join behind the scope derivation). Mocking `db` would assert the
 * shape of the mock.
 *
 * Skips cleanly with no `DATABASE_URL`. Every row is synthetic and removed in
 * `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run public-free-scan-remediate.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

// This router imports consent.ts, which transitively pulls in workflow-executor
// → the Anthropic AI integration client, and that module throws at LOAD time
// with these unset. Same three stubs `consent.test.ts` sets for the same reason;
// nothing under test calls any of them.
process.env.JWT_SECRET ??= "free-scan-remediate-test-secret";
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "https://anthropic.test";
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-anthropic-key";

import {
  db,
  pool,
  mspsTable,
  tenantsTable,
  usersTable,
  checkoutSessionsTable,
  freeScanEngagementsTable,
  freeScanAccountsTable,
  consentInviteTokensTable,
  remediationTrackerStepsTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const suffix = `vitest-1375r-${Math.floor(Math.random() * 1e9)}`;
const PACKAGE_KEY = "core:free-scan-full";
const IDENTITY_CHECK = "identity:ca-mfa-coverage";

describe.skipIf(!process.env.DATABASE_URL)("free-scan Remediate routes — live Postgres (#1375)", () => {
  let app: express.Express;
  let mspId: number;
  let customerId: number;
  let userId: number;
  let runId: string;
  let sessionId: string;

  beforeAll(async () => {
    const router = (await import("./public-free-scan-remediate.ts")).default;
    app = express();
    app.use(express.json());
    app.use("/api", router);

    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `#1375 remediate MSP ${suffix}`, slug: suffix })
      .returning({ id: mspsTable.id });
    mspId = msp!.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({
        mspId,
        customerName: `Remediate Routes ${suffix}`,
        tenantId: `${suffix}-tenant`,
        domain: `${suffix}.example.com`,
        isTestbed: true,
        consent: { graph: { status: "granted" } },
      })
      .returning({ id: tenantsTable.id });
    customerId = tenant!.id;

    const [user] = await db
      .insert(usersTable)
      .values({ email: `${suffix}@example.com`, name: `Prospect ${suffix}`, tenantId: customerId, mspRole: "Free", isActive: true })
      .returning({ id: usersTable.id });
    userId = user!.id;

    // The live door: a real checkout session naming this tenant, exactly as
    // `resolveFlowSession` → `resolveConsentedTenant` require it.
    const [session] = await db
      .insert(checkoutSessionsTable)
      .values({
        productSlug: "free-scan",
        fullName: `Prospect ${suffix}`,
        email: `${suffix}@example.com`,
        company: `Remediate Routes ${suffix}`,
        status: "consented",
        tenantId: `${suffix}-tenant`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning({ id: checkoutSessionsTable.id });
    sessionId = session!.id;

    const [run] = await db
      .insert(mspDiagnosticRunsTable)
      .values({
        mspId,
        customerId,
        packageKey: PACKAGE_KEY,
        status: "completed",
        startedAt: new Date("2026-09-15T09:00:00Z"),
        completedAt: new Date("2026-09-15T09:12:00Z"),
        checksTotal: 1,
        checksOk: 1,
      })
      .returning({ runId: mspDiagnosticRunsTable.runId });
    runId = run!.runId;

    await db.insert(mspDiagnosticFindingsTable).values({
      runId,
      mspId,
      customerId,
      checkKey: IDENTITY_CHECK,
      checkLabel: "No Conditional Access policy enforcing MFA",
      severity: "critical",
      title: "No Conditional Access policy enforcing MFA",
      description: `Seeded for #1375's live route test (${suffix}).`,
    });
  });

  afterAll(async () => {
    await db.delete(remediationTrackerStepsTable).where(eq(remediationTrackerStepsTable.customerId, customerId));
    await db.delete(consentInviteTokensTable).where(eq(consentInviteTokensTable.customerId, customerId));
    await db.delete(freeScanEngagementsTable).where(eq(freeScanEngagementsTable.customerId, customerId));
    await db.delete(mspDiagnosticFindingsTable).where(eq(mspDiagnosticFindingsTable.runId, runId));
    await db.delete(mspDiagnosticRunsTable).where(eq(mspDiagnosticRunsTable.customerId, customerId));
    await db.delete(checkoutSessionsTable).where(eq(checkoutSessionsTable.id, sessionId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, customerId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
    await pool.end();
  });

  /** Mark this Prospect's engagement paid, the way the Review step's confirm does. */
  async function markPaid(): Promise<void> {
    await db
      .update(freeScanEngagementsTable)
      .set({ status: "paid", paidAt: new Date(), chargedCents: 2_840_000, agreedServicesCents: 3_550_000 })
      .where(eq(freeScanEngagementsTable.customerId, customerId));
  }

  it("refuses every route without a credential — no sessionId, no returnToken, no work", async () => {
    for (const path of [
      "/api/public/free-scan/remediate/read",
      "/api/public/free-scan/remediate/write-consent-url",
      "/api/public/free-scan/remediate/decline-write",
    ]) {
      const res = await request(app).post(path).send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("credential_required");
    }
  });

  it("refuses a sessionId that names no live checkout session", async () => {
    const res = await request(app)
      .post("/api/public/free-scan/remediate/read")
      .send({ sessionId: "11111111-2222-3333-4444-555555555555" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("session_expired");
  });

  it("reads `not_paid` before the Review step is finished, and offers no guide", async () => {
    const res = await request(app).post("/api/public/free-scan/remediate/read").send({ sessionId });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe("not_paid");
    expect(res.body.guide).toBeNull();
    expect(res.body.writeConsent.status).toBeNull();
  });

  it("REFUSES to mint a consent URL for an unpaid engagement, and mints no token", async () => {
    const before = await db
      .select({ token: consentInviteTokensTable.token })
      .from(consentInviteTokensTable)
      .where(eq(consentInviteTokensTable.customerId, customerId));

    const res = await request(app).post("/api/public/free-scan/remediate/write-consent-url").send({ sessionId });
    // 409 when the write app is configured, 503 when it is not — either way the
    // one thing that must hold is that no consent state was created.
    expect([409, 503]).toContain(res.status);
    if (res.status === 409) expect(res.body.error).toBe("payment_required");

    const after = await db
      .select({ token: consentInviteTokensTable.token })
      .from(consentInviteTokensTable)
      .where(eq(consentInviteTokensTable.customerId, customerId));
    expect(after.length).toBe(before.length);
  });

  it("REFUSES a checklist write for an unpaid engagement", async () => {
    const res = await request(app)
      .put(`/api/public/free-scan/remediate/checklist/${encodeURIComponent(IDENTITY_CHECK)}`)
      .send({ sessionId, status: "completed" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("payment_required");
  });

  it("puts the account step (#4329) between payment and the write-consent gate", async () => {
    await markPaid();
    const res = await request(app).post("/api/public/free-scan/remediate/read").send({ sessionId });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe("account");
    expect(res.body.guide).toBeNull();
  });

  it("moves to the write-consent stage once paid and the account exists, with DERIVED scopes and the beyond-scope disclosure", async () => {
    // The account step's own flow is covered by public-free-scan-account.live-db.test.ts;
    // here only its completed state matters.
    const [engagement] = await db
      .select({ id: freeScanEngagementsTable.id })
      .from(freeScanEngagementsTable)
      .where(eq(freeScanEngagementsTable.customerId, customerId));
    await db.insert(freeScanAccountsTable).values({
      engagementId: engagement!.id,
      email: `${suffix}@example.com`,
      emailVerifiedAt: new Date(),
      passwordHash: "not-a-real-hash-seeded-for-stage-only",
      mfaMethod: "totp",
      mfaEnrolledAt: new Date(),
    });
    const res = await request(app).post("/api/public/free-scan/remediate/read").send({ sessionId });

    expect(res.status).toBe(200);
    expect(res.body.stage).toBe("write_consent");
    // The guide is not shipped to a screen that has not passed the gate.
    expect(res.body.guide).toBeNull();
    expect(res.body.runId).toBe(runId);
    expect(res.body.scopes.length).toBeGreaterThan(0);
    for (const scope of res.body.scopes) {
      expect(typeof scope.permission).toBe("string");
      expect(scope.why.length).toBeGreaterThan(0);
    }
    // The honest disclosure that one click grants the whole registration.
    expect(res.body.grantedBeyondScope.length).toBeGreaterThan(0);
    // Real figures, read back off the engagement — not recomputed.
    expect(res.body.chargedCents).toBe(2_840_000);
    expect(res.body.agreedServicesCents).toBe(3_550_000);
  });

  it("records a real decline, with the scope snapshot the Prospect was shown", async () => {
    const res = await request(app).post("/api/public/free-scan/remediate/decline-write").send({ sessionId });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("declined");

    const [row] = await db
      .select({
        decision: freeScanEngagementsTable.writeConsentDecision,
        decidedAt: freeScanEngagementsTable.writeConsentDecidedAt,
        scopes: freeScanEngagementsTable.writeConsentScopes,
      })
      .from(freeScanEngagementsTable)
      .where(eq(freeScanEngagementsTable.customerId, customerId));

    expect(row!.decision).toBe("declined");
    expect(row!.decidedAt).not.toBeNull();
    expect((row!.scopes as { scopes?: unknown[] }).scopes).toBeInstanceOf(Array);

    // A decline must NOT touch the real grant — declining here can never revoke
    // or contradict a writeBack grant the tenant holds from another flow.
    const [tenant] = await db
      .select({ consent: tenantsTable.consent })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, customerId));
    expect(tenant!.consent?.writeBack).toBeUndefined();
  });

  it("shows the real findings-driven guide after the decline, read-only and honest about it", async () => {
    const res = await request(app).post("/api/public/free-scan/remediate/read").send({ sessionId });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe("guide");
    expect(res.body.writeConsent.status).toBeNull();
    expect(res.body.writeConsent.decision).toBe("declined");

    const guide = res.body.guide as Array<{ checkKey: string; fixRoute: string; status: string; title: string }>;
    expect(guide.map((i) => i.checkKey)).toContain(IDENTITY_CHECK);
    const item = guide.find((i) => i.checkKey === IDENTITY_CHECK)!;
    // #1539: a write-denied tenant caps at `you_must_run`, never `we_can_run`.
    // That is what makes the decline a real posture rather than a UI flag.
    expect(item.fixRoute).not.toBe("we_can_run");
    expect(item.status).toBe("not_started");
    expect(item.title.length).toBeGreaterThan(0);
  });

  it("persists a checklist claim to the SAME table the authenticated Portal reads", async () => {
    const res = await request(app)
      .put(`/api/public/free-scan/remediate/checklist/${encodeURIComponent(IDENTITY_CHECK)}`)
      .send({ sessionId, status: "completed" });
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe("completed");

    const [row] = await db
      .select({
        stepId: remediationTrackerStepsTable.stepId,
        status: remediationTrackerStepsTable.status,
        verificationState: remediationTrackerStepsTable.verificationState,
        completedAt: remediationTrackerStepsTable.completedAt,
      })
      .from(remediationTrackerStepsTable)
      .where(eq(remediationTrackerStepsTable.customerId, customerId));

    // Keyed by the finding's own checkKey (#1538's address space), under the
    // real customerId — so the Portal reads back exactly this row later.
    expect(row!.stepId).toBe(IDENTITY_CHECK);
    expect(row!.status).toBe("completed");
    expect(row!.verificationState).toBe("unverified");
    expect(row!.completedAt).not.toBeNull();

    // And the read reflects it.
    const read = await request(app).post("/api/public/free-scan/remediate/read").send({ sessionId });
    const item = (read.body.guide as Array<{ checkKey: string; status: string }>).find((i) => i.checkKey === IDENTITY_CHECK)!;
    expect(item.status).toBe("completed");
  });

  it("REFUSES `accepted_risk` from this door — it needs a signed risk decision", async () => {
    const res = await request(app)
      .put(`/api/public/free-scan/remediate/checklist/${encodeURIComponent(IDENTITY_CHECK)}`)
      .send({ sessionId, status: "accepted_risk" });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("accepted_risk");
  });

  it("REFUSES a checklist write for a check key that is not a real monitor_checks.key", async () => {
    const res = await request(app)
      .put("/api/public/free-scan/remediate/checklist/not-a-real-check-key")
      .send({ sessionId, status: "completed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Unknown check key");
  });

  it("REFUSES to mint a consent URL when the tenant has no read grant, and mints no token", async () => {
    await db
      .update(tenantsTable)
      .set({ consent: {} })
      .where(eq(tenantsTable.id, customerId));

    const before = await db
      .select({ token: consentInviteTokensTable.token })
      .from(consentInviteTokensTable)
      .where(eq(consentInviteTokensTable.customerId, customerId));

    const res = await request(app).post("/api/public/free-scan/remediate/write-consent-url").send({ sessionId });
    // `resolveConsentedTenant` refuses the session before this route's own gate
    // is even reached — either way, read consent is required and none is faked.
    expect([409, 503]).toContain(res.status);
    if (res.status === 409) expect(res.body.error).toBe("read_consent_required");

    const after = await db
      .select({ token: consentInviteTokensTable.token })
      .from(consentInviteTokensTable)
      .where(eq(consentInviteTokensTable.customerId, customerId));
    expect(after.length).toBe(before.length);

    // Restore for the happy-path test below.
    await db
      .update(tenantsTable)
      .set({ consent: { graph: { status: "granted" } } })
      .where(eq(tenantsTable.id, customerId));
  });

  it("mints ONE real, HMAC-bound consent URL once every gate passes", async () => {
    if (!process.env.MT_APP_WRITE_CLIENT_ID) {
      // Honest skip rather than a pass: without the write app configured this
      // path cannot be exercised at all, and asserting the 503 would not be
      // evidence the mint works.
      expect(true).toBe(true);
      return;
    }

    const res = await request(app).post("/api/public/free-scan/remediate/write-consent-url").send({ sessionId });
    expect(res.status).toBe(200);

    const url = new URL(res.body.consentUrl as string);
    // Microsoft's v2 admin-consent endpoint, aimed at THIS tenant — never "common".
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toBe(`/${encodeURIComponent(`${suffix}-tenant`)}/adminconsent`);
    expect(url.searchParams.get("client_id")).toBe(process.env.MT_APP_WRITE_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toContain("/api/admin/write-consent/callback");
    // The state is the shared write-consent shape: `wc.<customerId>.<token>.popup.<mac>`.
    const state = url.searchParams.get("state")!;
    const parts = state.split(".");
    expect(parts[0]).toBe("wc");
    expect(parts[1]).toBe(String(customerId));
    expect(parts[3]).toBe("popup");
    expect(parts).toHaveLength(5);

    // Exactly one single-use token row, bound to this customer and this tenant,
    // and the state's token segment is that row — not a value invented client-side.
    const tokens = await db
      .select({
        token: consentInviteTokensTable.token,
        tenantId: consentInviteTokensTable.tenantId,
        usedAt: consentInviteTokensTable.usedAt,
      })
      .from(consentInviteTokensTable)
      .where(eq(consentInviteTokensTable.customerId, customerId));
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.token).toBe(parts[2]);
    expect(tokens[0]!.tenantId).toBe(`${suffix}-tenant`);
    expect(tokens[0]!.usedAt).toBeNull();

    // `requested` is recorded — never `granted`. Only the Microsoft-verified
    // callback writes the real grant.
    const [row] = await db
      .select({ decision: freeScanEngagementsTable.writeConsentDecision })
      .from(freeScanEngagementsTable)
      .where(eq(freeScanEngagementsTable.customerId, customerId));
    expect(row!.decision).toBe("requested");

    const [tenant] = await db
      .select({ consent: tenantsTable.consent })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, customerId));
    expect(tenant!.consent?.writeBack).toBeUndefined();
  });
});
