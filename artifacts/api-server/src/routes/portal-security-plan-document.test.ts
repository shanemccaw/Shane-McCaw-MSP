/**
 * portal-security-plan-document.test.ts — the genuinely customer-driven sign
 * action (#2949).
 *
 * The properties worth failing a build over, same discipline as
 * portal-risk-register.test.ts's own header:
 *
 *   1. THE AUDIT TRAIL IS SERVER-DERIVED. `signatureHash`/`ipAddress` sent in
 *      the body are ignored — `signSecurityPlanVersion` is always called with
 *      values this route computed itself, never the client's.
 *   2. A NAME MUST BE TYPED. `fullName` below the 2-character floor is a 400,
 *      never silently accepted as an empty/near-empty signature.
 *   3. ANOTHER TENANT'S VERSION IS A 404, NOT A 409. Scoped lookup returning
 *      null reads as "not found," exactly like a real miss — it never leaks
 *      into a 409 that would confirm the id exists elsewhere.
 *   4. A SUPERSEDED OR ALREADY-SIGNED VERSION CANNOT BE SIGNED AGAIN — 409 in
 *      both cases, checked from the scoped row before ever calling the
 *      underlying signing function.
 *   5. `GET .../versions/current` returns the current version REGARDLESS of
 *      signed state — this is deliberately NOT the same tri-state
 *      `portal-security-plan.ts`'s `assembledPlan` (signed-only) enforces;
 *      the customer must be able to review an unsigned sealed version before
 *      deciding to sign it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../middlewares/requireAuth", () => ({
  requireRole: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../lib/logger", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

let mockScope: any = null;
vi.mock("../lib/portal-customer-scope", () => ({
  resolveCustomerId: (req: any) => req.user?.customerId ?? null,
  resolveTenantScope: async () => mockScope,
}));

const versioning = vi.hoisted(() => ({
  getCurrentSecurityPlanVersion: vi.fn(),
  getSecurityPlanVersionByUid: vi.fn(),
  listSecurityPlanVersions: vi.fn(),
  signSecurityPlanVersion: vi.fn(),
}));
vi.mock("../lib/security-plan-versioning.ts", () => versioning);

import router from "./portal-security-plan-document";

function makeApp(user: Record<string, unknown> | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) (req as any).user = user;
    next();
  });
  app.use("/api", router);
  return app;
}

const CUSTOMER = { id: 7, customerId: 42, email: "customer@clientdomain.com" };
const SCOPE = { customerId: 42, mspId: 1, tenantId: "0a361ab2-9e85-4bbf-8b75-c1ebf042dfba", tenantName: "Test Me", primaryDomain: "shanemccaw.onmicrosoft.com", businessUnit: null };

const CONTENT = {
  customerId: 42,
  tenantId: SCOPE.tenantId,
  tenantName: "Test Me",
  assembledAt: "2026-09-05T00:00:00.000Z",
  modules: [],
  footprint: { scope: { dimensions: {}, statement: "Full assessed estate — no scope narrowing applied." }, isHonestView: true, excludedByModule: [], totalExcluded: 0, computedAt: "2026-09-05T00:00:00.000Z" },
  prose: null,
};

function sealedVersion(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    versionUid: "11111111-1111-1111-1111-111111111111",
    mspId: 1,
    customerId: 42,
    tenantId: SCOPE.tenantId,
    tenantName: "Test Me",
    versionNumber: 1,
    content: CONTENT,
    createdBy: { name: "Shane McCaw", upn: "shane@shanemccaw.com", timestamp: "2026-09-05 00:00:00 UTC" },
    signed: false,
    signedBy: null,
    signedAt: null,
    supersededAt: null,
    createdAt: new Date("2026-09-05T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  mockScope = SCOPE;
  vi.clearAllMocks();
});

describe("GET /api/portal/security-plan/versions/current", () => {
  it("returns the current version even when unsigned — unlike assembledPlan", async () => {
    versioning.getCurrentSecurityPlanVersion.mockResolvedValue(sealedVersion());
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/security-plan/versions/current");
    expect(res.status).toBe(200);
    expect(res.body.version.signed).toBe(false);
    expect(res.body.version.versionUid).toBe("11111111-1111-1111-1111-111111111111");
    expect(res.body.version.scopeStatement).toBe("Full assessed estate — no scope narrowing applied.");
    expect(versioning.getCurrentSecurityPlanVersion).toHaveBeenCalledWith(SCOPE.mspId, SCOPE.customerId);
  });

  it("404s honestly when nothing has ever been sealed", async () => {
    versioning.getCurrentSecurityPlanVersion.mockResolvedValue(null);
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/security-plan/versions/current");
    expect(res.status).toBe(404);
  });

  it("403s with no customer context on the token", async () => {
    const res = await request(makeApp({ id: 7 })).get("/api/portal/security-plan/versions/current");
    expect(res.status).toBe(403);
  });
});

describe("POST /api/portal/security-plan/versions/:versionUid/sign", () => {
  const path = "/api/portal/security-plan/versions/11111111-1111-1111-1111-111111111111/sign";

  it("signs a current, unsigned version and returns it", async () => {
    versioning.getSecurityPlanVersionByUid.mockResolvedValue(sealedVersion());
    versioning.signSecurityPlanVersion.mockResolvedValue(sealedVersion({ signed: true, signedAt: new Date("2026-09-05T01:00:00Z"), signedBy: { name: "Jordan Diaz", title: "IT Administrator", email: CUSTOMER.email, signedAt: "2026-09-05 01:00:00 UTC", ipAddress: "203.0.113.5", signatureHash: "deadbeef" } }));

    const res = await request(makeApp(CUSTOMER)).post(path).send({ fullName: "Jordan Diaz", title: "IT Administrator" });

    expect(res.status).toBe(201);
    expect(res.body.version.signed).toBe(true);
    expect(versioning.signSecurityPlanVersion).toHaveBeenCalledTimes(1);
    const [mspId, customerId, versionUid, signedBy] = versioning.signSecurityPlanVersion.mock.calls[0];
    expect([mspId, customerId, versionUid]).toEqual([SCOPE.mspId, SCOPE.customerId, "11111111-1111-1111-1111-111111111111"]);
    expect(signedBy.name).toBe("Jordan Diaz");
    expect(signedBy.title).toBe("IT Administrator");
    // The real identity claim comes off the session, never the body.
    expect(signedBy.email).toBe(CUSTOMER.email);
  });

  it("ignores a client-supplied ipAddress/signatureHash — the audit trail is server-derived", async () => {
    versioning.getSecurityPlanVersionByUid.mockResolvedValue(sealedVersion());
    versioning.signSecurityPlanVersion.mockResolvedValue(sealedVersion({ signed: true }));

    await request(makeApp(CUSTOMER))
      .post(path)
      .send({ fullName: "Jordan Diaz", ipAddress: "1.2.3.4", signatureHash: "attacker-chosen" });

    const [, , , signedBy] = versioning.signSecurityPlanVersion.mock.calls[0];
    expect(signedBy.ipAddress).not.toBe("1.2.3.4");
    expect(signedBy.signatureHash).not.toBe("attacker-chosen");
  });

  it("400s when fullName is not actually typed", async () => {
    const res = await request(makeApp(CUSTOMER)).post(path).send({ fullName: "J" });
    expect(res.status).toBe(400);
    expect(versioning.getSecurityPlanVersionByUid).not.toHaveBeenCalled();
  });

  it("404s a version belonging to another tenant — never a 409 that would leak existence", async () => {
    versioning.getSecurityPlanVersionByUid.mockResolvedValue(null);
    const res = await request(makeApp(CUSTOMER)).post(path).send({ fullName: "Jordan Diaz" });
    expect(res.status).toBe(404);
    expect(versioning.signSecurityPlanVersion).not.toHaveBeenCalled();
  });

  it("409s a superseded version", async () => {
    versioning.getSecurityPlanVersionByUid.mockResolvedValue(sealedVersion({ supersededAt: new Date("2026-09-04T00:00:00Z") }));
    const res = await request(makeApp(CUSTOMER)).post(path).send({ fullName: "Jordan Diaz" });
    expect(res.status).toBe(409);
    expect(versioning.signSecurityPlanVersion).not.toHaveBeenCalled();
  });

  it("409s an already-signed version", async () => {
    versioning.getSecurityPlanVersionByUid.mockResolvedValue(sealedVersion({ signed: true, signedAt: new Date() }));
    const res = await request(makeApp(CUSTOMER)).post(path).send({ fullName: "Jordan Diaz" });
    expect(res.status).toBe(409);
    expect(versioning.signSecurityPlanVersion).not.toHaveBeenCalled();
  });

  it("409s when the guarded update races and loses (signSecurityPlanVersion returns null)", async () => {
    versioning.getSecurityPlanVersionByUid.mockResolvedValue(sealedVersion());
    versioning.signSecurityPlanVersion.mockResolvedValue(null);
    const res = await request(makeApp(CUSTOMER)).post(path).send({ fullName: "Jordan Diaz" });
    expect(res.status).toBe(409);
  });
});
