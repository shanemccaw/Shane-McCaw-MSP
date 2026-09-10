/**
 * Live-Postgres regression test for Git #3081 (Phase 1b of #1935) — real
 * bidirectional conversion between a POA&M (`msp_poams`) and a risk
 * acceptance (`msp_risk_decisions` / RBD).
 *
 * Live rather than mocked, deliberately: the whole point of this build is
 * that the SOURCE row's status genuinely flips to a real terminal
 * `converted_...` value and points forward at the row it became, while the
 * NEW row points back — a mocked `db` would assert the route calls SOME
 * insert/update, not that both real rows end up cross-referenced and the
 * source is never left dangling.
 *
 * Skips cleanly with no `DATABASE_URL`, matching `msp-changes-reject.live-db.test.ts`.
 * Every row it writes is synthetic, suffixed, and removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-poam-rbd-conversion.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { db, mspsTable, tenantsTable, mspPoamsTable, mspRiskDecisionsTable, mspAuditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JWT_SECRET = "test-msp-poam-rbd-conversion-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 1, email: "admin@msp.com", role: "client", mspRole: "MSPAdmin", mspId: 1, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe.skipIf(!process.env.DATABASE_URL)("POA&M <-> RBD bidirectional conversion — live Postgres (#3081)", () => {
  const suffix = `vitest-3081-${Math.floor(Math.random() * 1e9)}`;
  let mspId: number;
  const tenantMsId = `${suffix}.onmicrosoft.com`;

  const poamIdsToClean: number[] = [];
  const riskDecisionIdsToClean: number[] = [];

  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `POAM/RBD Conversion Test MSP ${suffix}`, slug: suffix })
      .returning({ id: mspsTable.id });
    mspId = msp.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `POAM/RBD Conversion Test Customer ${suffix}`, tenantId: tenantMsId })
      .returning({ id: tenantsTable.id });
    // Keep tenant row cleanup keyed off mspId cascade below — no separate ref needed.
    void tenant;
  });

  afterAll(async () => {
    for (const id of riskDecisionIdsToClean) {
      await db.delete(mspAuditLogsTable).where(eq(mspAuditLogsTable.entityId, String(id)));
      await db.delete(mspRiskDecisionsTable).where(eq(mspRiskDecisionsTable.id, id));
    }
    for (const id of poamIdsToClean) {
      await db.delete(mspAuditLogsTable).where(eq(mspAuditLogsTable.entityId, String(id)));
      await db.delete(mspPoamsTable).where(eq(mspPoamsTable.id, id));
    }
    await db.delete(tenantsTable).where(eq(tenantsTable.tenantId, tenantMsId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  async function mountPoamsApp() {
    const { default: router } = await import("./msp-poams.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    return app;
  }

  async function mountRbdApp() {
    const { default: router } = await import("./msp-rbd.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    return app;
  }

  it("converts an active POA&M to a pending-signature risk acceptance, cross-linking both real rows", async () => {
    const [poam] = await db
      .insert(mspPoamsTable)
      .values({
        mspId,
        poamId: `POAM-TEST-${suffix}`,
        tenantId: tenantMsId,
        tenantName: `POAM/RBD Conversion Test Customer ${suffix}`,
        primaryDomain: "contoso.com",
        title: "Disable legacy auth protocols",
        weaknessDescription: "Legacy authentication remains enabled on Exchange Online.",
        checkKey: "identity:legacy-auth",
        scheduledCompletionDate: "2026-12-01",
        originalScheduledCompletionDate: "2026-12-01",
        interimCompensatingControl: "Conditional Access blocks legacy auth for all but the break-glass account.",
        resourcesRequired: "2 engineer-days",
        status: "active",
      })
      .returning({ id: mspPoamsTable.id, poamId: mspPoamsTable.poamId });
    poamIdsToClean.push(poam.id);

    const app = await mountPoamsApp();
    const token = makeToken({ mspId });
    const res = await request(app)
      .post(`/api/msp/poams/${poam.poamId}/convert-to-risk-acceptance`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        reason: "Remediation cost exceeds the tenant's budget for this cycle; accepting the residual risk instead.",
        controlViolated: "Legacy Authentication",
        framework: "Internal Policy",
        rawRiskLevel: "high",
        residualRiskLevel: "medium",
        rawRiskScore: 60,
        residualRiskScore: 30,
        liabilityValueUsd: 5000,
        clientApprover: { name: "Jane Customer", title: "IT Director", email: "jane@contoso.com" },
        expirationDate: "27 Dec 2026",
      });

    expect(res.status).toBe(201);
    expect(res.body.rbdId).toBeTruthy();
    expect(res.body.registerRef).toBeTruthy();
    riskDecisionIdsToClean.push(res.body.riskDecisionId);

    const [updatedPoam] = await db.select().from(mspPoamsTable).where(eq(mspPoamsTable.id, poam.id));
    expect(updatedPoam.status).toBe("converted_to_risk_acceptance");
    expect(updatedPoam.convertedToRiskDecisionId).toBe(res.body.riskDecisionId);
    expect(updatedPoam.conversionReason).toMatch(/exceeds the tenant's budget/);

    const [newRbd] = await db.select().from(mspRiskDecisionsTable).where(eq(mspRiskDecisionsTable.id, res.body.riskDecisionId));
    expect(newRbd.status).toBe("pending_signature");
    expect(newRbd.spawnedByPoamId).toBe(poam.id);
    expect(newRbd.checkKey).toBe("identity:legacy-auth");
    expect(newRbd.hazardDescription).toBe("Legacy authentication remains enabled on Exchange Online.");
    // No compensatingControls supplied — falls back to the plan's own real interim control.
    expect(newRbd.compensatingControls).toEqual([
      { type: "operational", description: "Conditional Access blocks legacy auth for all but the break-glass account." },
    ]);

    // Real audit trail — Git #3081's own explicit requirement.
    const auditRows = await db.select().from(mspAuditLogsTable).where(eq(mspAuditLogsTable.entityId, String(poam.id)));
    expect(auditRows.some((r) => r.actionType === "msp.poam.convert_to_risk_acceptance")).toBe(true);
  });

  it("refuses to convert a non-active POA&M (409)", async () => {
    const [poam] = await db
      .insert(mspPoamsTable)
      .values({
        mspId,
        poamId: `POAM-TEST-CANCELLED-${suffix}`,
        tenantId: tenantMsId,
        tenantName: `POAM/RBD Conversion Test Customer ${suffix}`,
        primaryDomain: "contoso.com",
        title: "Already cancelled plan",
        weaknessDescription: "n/a",
        scheduledCompletionDate: "2026-12-01",
        originalScheduledCompletionDate: "2026-12-01",
        interimCompensatingControl: "n/a",
        resourcesRequired: "n/a",
        status: "cancelled",
      })
      .returning({ id: mspPoamsTable.id, poamId: mspPoamsTable.poamId });
    poamIdsToClean.push(poam.id);

    const app = await mountPoamsApp();
    const token = makeToken({ mspId });
    const res = await request(app)
      .post(`/api/msp/poams/${poam.poamId}/convert-to-risk-acceptance`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        reason: "Should be rejected.",
        controlViolated: "x",
        framework: "x",
        rawRiskLevel: "high",
        residualRiskLevel: "medium",
        rawRiskScore: 1,
        residualRiskScore: 1,
        liabilityValueUsd: 0,
        clientApprover: { name: "x", title: "x", email: "x@contoso.com" },
        expirationDate: "1 Jan 2027",
      });

    expect(res.status).toBe(409);
    const [unchanged] = await db.select().from(mspPoamsTable).where(eq(mspPoamsTable.id, poam.id));
    expect(unchanged.status).toBe("cancelled");
    expect(unchanged.convertedToRiskDecisionId).toBeNull();
  });

  it("converts an active risk acceptance to a pending-signature POA&M, cross-linking both real rows", async () => {
    const [rbd] = await db
      .insert(mspRiskDecisionsTable)
      .values({
        mspId,
        rbdId: `RBD-TEST-${suffix}`,
        tenantId: tenantMsId,
        tenantName: `POAM/RBD Conversion Test Customer ${suffix}`,
        primaryDomain: "contoso.com",
        title: "MFA not enforced for guest accounts",
        controlViolated: "MFA Enforcement",
        framework: "Internal Policy",
        checkKey: "identity:mfa-coverage",
        rawRiskLevel: "high",
        residualRiskLevel: "medium",
        rawRiskScore: 60,
        residualRiskScore: 30,
        liabilityValueUsd: 2000,
        hazardDescription: "Guest accounts can authenticate without MFA.",
        graphEndpoint: "/identity/conditionalAccess/policies",
        compensatingControls: [{ type: "administrative", description: "Guest accounts are manually reviewed monthly." }],
        mspAssessor: { name: "MSP Assessor", upn: "assessor@msp.com", timestamp: new Date().toISOString() },
        clientApprover: { name: "Jane Customer", title: "IT Director", email: "jane@contoso.com", signedAt: "2026-01-01 00:00:00 UTC", ipAddress: "127.0.0.1", signatureHash: "abc" },
        expirationDate: "1 Jan 2027",
        status: "active",
      })
      .returning({ id: mspRiskDecisionsTable.id, rbdId: mspRiskDecisionsTable.rbdId });
    riskDecisionIdsToClean.push(rbd.id);

    const app = await mountRbdApp();
    const token = makeToken({ mspId });
    const res = await request(app)
      .patch(`/api/msp/rbd/${rbd.rbdId}/convert-to-poam`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        reason: "Customer decided to actually enforce MFA for guests this quarter.",
        scheduledCompletionDate: "2026-12-15",
        interimCompensatingControl: "Guest accounts continue to be manually reviewed monthly until enforcement lands.",
        resourcesRequired: "1 engineer-day",
      });

    expect(res.status).toBe(201);
    expect(res.body.poamId).toBeTruthy();
    poamIdsToClean.push(res.body.poamRowId);

    const [updatedRbd] = await db.select().from(mspRiskDecisionsTable).where(eq(mspRiskDecisionsTable.id, rbd.id));
    expect(updatedRbd.status).toBe("converted_to_poam");
    expect(updatedRbd.convertedToPoamId).toBe(res.body.poamRowId);
    expect(updatedRbd.conversionReason).toMatch(/enforce MFA for guests/);

    const [newPoam] = await db.select().from(mspPoamsTable).where(eq(mspPoamsTable.id, res.body.poamRowId));
    expect(newPoam.status).toBe("pending_signature");
    expect(newPoam.spawnedByRiskDecisionId).toBe(rbd.id);
    expect(newPoam.checkKey).toBe("identity:mfa-coverage");
    expect(newPoam.weaknessDescription).toBe("Guest accounts can authenticate without MFA.");

    const auditRows = await db.select().from(mspAuditLogsTable).where(eq(mspAuditLogsTable.entityId, String(rbd.id)));
    expect(auditRows.some((r) => r.actionType === "msp.rbd.convert_to_poam")).toBe(true);
  });

  it("refuses to convert a non-active risk acceptance (409)", async () => {
    const [rbd] = await db
      .insert(mspRiskDecisionsTable)
      .values({
        mspId,
        rbdId: `RBD-TEST-REVOKED-${suffix}`,
        tenantId: tenantMsId,
        tenantName: `POAM/RBD Conversion Test Customer ${suffix}`,
        primaryDomain: "contoso.com",
        title: "Already revoked decision",
        controlViolated: "x",
        framework: "x",
        rawRiskLevel: "high",
        residualRiskLevel: "medium",
        rawRiskScore: 1,
        residualRiskScore: 1,
        liabilityValueUsd: 0,
        hazardDescription: "n/a",
        graphEndpoint: "",
        compensatingControls: [],
        mspAssessor: { name: "MSP Assessor", upn: "assessor@msp.com", timestamp: new Date().toISOString() },
        clientApprover: { name: "x", title: "x", email: "x@contoso.com", signedAt: null, ipAddress: null, signatureHash: null },
        expirationDate: "1 Jan 2027",
        status: "revoked",
      })
      .returning({ id: mspRiskDecisionsTable.id, rbdId: mspRiskDecisionsTable.rbdId });
    riskDecisionIdsToClean.push(rbd.id);

    const app = await mountRbdApp();
    const token = makeToken({ mspId });
    const res = await request(app)
      .patch(`/api/msp/rbd/${rbd.rbdId}/convert-to-poam`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        reason: "Should be rejected.",
        scheduledCompletionDate: "2026-12-15",
        interimCompensatingControl: "x",
        resourcesRequired: "x",
      });

    expect(res.status).toBe(409);
    const [unchanged] = await db.select().from(mspRiskDecisionsTable).where(eq(mspRiskDecisionsTable.id, rbd.id));
    expect(unchanged.status).toBe("revoked");
    expect(unchanged.convertedToPoamId).toBeNull();
  });
});
