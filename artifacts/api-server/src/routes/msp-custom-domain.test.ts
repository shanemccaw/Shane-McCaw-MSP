/**
 * Tests for MSP Custom Domain routes — branding resolution, verification flow,
 * and slug-based tenant lookup.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-custom-domain
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockMsp = {
  id: 42,
  name: "Contoso IT",
  slug: "contoso-it",
  logoUrl: "https://cdn.contoso.com/logo.svg",
  primaryColor: "#0078D4",
  status: "active",
};

const mockCustomDomain = {
  id: 1,
  mspId: 42,
  domain: "portal.contoso.com",
  verificationToken: "abc123token",
  verificationStatus: "pending",
  verifiedAt: null,
  lastCheckedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const mockDbChain = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([mockCustomDomain]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  execute: vi.fn().mockResolvedValue({ rows: [] }),
};

vi.mock("@workspace/db", () => ({
  db: mockDbChain,
  mspsTable: {
    id: "id",
    name: "name",
    slug: "slug",
    logoUrl: "logo_url",
    primaryColor: "primary_color",
    status: "status",
  },
  mspCustomDomainsTable: {
    id: "id",
    mspId: "msp_id",
    domain: "domain",
    verificationToken: "verification_token",
    verificationStatus: "verification_status",
    verifiedAt: "verified_at",
    lastCheckedAt: "last_checked_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  mspAuditLogsTable: { id: "id" },
}));

vi.mock("dns/promises", () => ({
  resolveTxt: vi.fn(),
}));

vi.mock("../middlewares/requireAuth.ts", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: (_role: string) => (req: { user?: unknown }, _res: unknown, next: () => void) => {
    if (!req.user) {
      (req as Record<string, unknown>).user = {
        id: 1,
        email: "admin@contoso.com",
        role: "client",
        mspRole: "MSPAdmin",
        mspId: 42,
      };
    }
    next();
  },
}));

vi.mock("../lib/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 1, email: "admin@contoso.com", role: "client", mspRole: "MSPAdmin", mspId: 42, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function makeApp() {
  return import("./msp-custom-domain.ts").then(({ default: router }) => {
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    return app;
  });
}

// ── Branding resolution tests ─────────────────────────────────────────────────

describe("GET /api/portal/branding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbChain.select.mockReturnThis();
    mockDbChain.from.mockReturnThis();
    mockDbChain.where.mockReturnThis();
    mockDbChain.limit.mockResolvedValue([]);
  });

  it("returns 404 when slug not found", async () => {
    mockDbChain.limit.mockResolvedValueOnce([]);
    const app = await makeApp();
    const res = await request(app).get("/api/portal/branding?slug=no-such-msp");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns branding for valid slug", async () => {
    mockDbChain.limit.mockResolvedValueOnce([mockMsp]);
    const app = await makeApp();
    const res = await request(app).get("/api/portal/branding?slug=contoso-it");
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("contoso-it");
    expect(res.body.name).toBe("Contoso IT");
    expect(res.body.logoUrl).toBe("https://cdn.contoso.com/logo.svg");
    expect(res.body.primaryColor).toBe("#0078D4");
    expect(res.body).not.toHaveProperty("mspId");
  });

  it("returns 403 for suspended MSP", async () => {
    mockDbChain.limit.mockResolvedValueOnce([{ ...mockMsp, status: "suspended" }]);
    const app = await makeApp();
    const res = await request(app).get("/api/portal/branding?slug=contoso-it");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/i);
  });

  it("resolves branding via verified custom domain Host header", async () => {
    // First query: custom domain lookup
    mockDbChain.limit
      .mockResolvedValueOnce([{ mspId: 42, verificationStatus: "verified" }])
      // Second query: MSP lookup by id
      .mockResolvedValueOnce([mockMsp]);

    const app = await makeApp();
    const res = await request(app)
      .get("/api/portal/branding")
      .set("Host", "portal.contoso.com");
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("contoso-it");
  });

  it("returns 404 when Host header matches an unverified domain", async () => {
    // Custom domain row found but NOT verified → empty result from DB
    mockDbChain.limit.mockResolvedValueOnce([]); // no verified domain match
    const app = await makeApp();
    const res = await request(app)
      .get("/api/portal/branding")
      .set("Host", "portal.contoso.com");
    expect(res.status).toBe(404);
  });

  it("ignores replit domains in Host header and falls back to slug", async () => {
    mockDbChain.limit.mockResolvedValueOnce([mockMsp]);
    const app = await makeApp();
    const res = await request(app)
      .get("/api/portal/branding?slug=contoso-it")
      .set("Host", "my-app.replit.app");
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("contoso-it");
  });
});

// ── Tenant lookup tests ───────────────────────────────────────────────────────

describe("GET /api/portal/tenant/:slug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbChain.select.mockReturnThis();
    mockDbChain.from.mockReturnThis();
    mockDbChain.where.mockReturnThis();
    mockDbChain.limit.mockResolvedValue([]);
  });

  it("returns 404 for unknown slug", async () => {
    mockDbChain.limit.mockResolvedValueOnce([]);
    const app = await makeApp();
    const res = await request(app).get("/api/portal/tenant/unknown-slug");
    expect(res.status).toBe(404);
  });

  it("returns tenant info for known slug", async () => {
    mockDbChain.limit.mockResolvedValueOnce([mockMsp]);
    const app = await makeApp();
    const res = await request(app).get("/api/portal/tenant/contoso-it");
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("contoso-it");
    expect(res.body.name).toBe("Contoso IT");
  });
});

// ── Custom domain management tests ───────────────────────────────────────────

describe("GET /api/msp/settings/custom-domain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbChain.select.mockReturnThis();
    mockDbChain.from.mockReturnThis();
    mockDbChain.where.mockReturnThis();
    mockDbChain.limit.mockResolvedValue([]);
  });

  it("returns slug URL and null customDomain when none registered", async () => {
    mockDbChain.limit
      .mockResolvedValueOnce([{ slug: "contoso-it" }]) // MSP lookup
      .mockResolvedValueOnce([]); // no custom domain
    const app = await makeApp();
    const token = makeToken();
    const res = await request(app)
      .get("/api/msp/settings/custom-domain")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("contoso-it");
    expect(res.body.slugUrl).toBe("/portal/?t=contoso-it");
    expect(res.body.customDomain).toBeNull();
  });

  it("returns existing custom domain config", async () => {
    mockDbChain.limit
      .mockResolvedValueOnce([{ slug: "contoso-it" }])
      .mockResolvedValueOnce([mockCustomDomain]);
    const app = await makeApp();
    const token = makeToken();
    const res = await request(app)
      .get("/api/msp/settings/custom-domain")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.customDomain.domain).toBe("portal.contoso.com");
    expect(res.body.customDomain.verificationStatus).toBe("pending");
  });
});

describe("POST /api/msp/settings/custom-domain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbChain.select.mockReturnThis();
    mockDbChain.from.mockReturnThis();
    mockDbChain.where.mockReturnThis();
    mockDbChain.limit.mockResolvedValue([]);
    mockDbChain.delete.mockReturnThis();
    mockDbChain.insert.mockReturnThis();
    mockDbChain.values.mockReturnThis();
    mockDbChain.returning.mockResolvedValue([mockCustomDomain]);
  });

  it("rejects invalid hostname", async () => {
    const app = await makeApp();
    const token = makeToken();
    const res = await request(app)
      .post("/api/msp/settings/custom-domain")
      .set("Authorization", `Bearer ${token}`)
      .send({ domain: "not_a_valid_domain!" });
    expect(res.status).toBe(400);
  });

  it("registers valid custom domain and returns TXT instructions", async () => {
    mockDbChain.limit.mockResolvedValueOnce([]); // domain not taken by another MSP
    const app = await makeApp();
    const token = makeToken();
    const res = await request(app)
      .post("/api/msp/settings/custom-domain")
      .set("Authorization", `Bearer ${token}`)
      .send({ domain: "portal.contoso.com" });
    expect(res.status).toBe(201);
    expect(res.body.domain).toBe("portal.contoso.com");
    expect(res.body.dnsInstructions.type).toBe("TXT");
    expect(res.body.dnsInstructions.host).toBe("_msp-platform-verify.portal.contoso.com");
    expect(res.body.dnsInstructions.value).toBeTruthy();
  });

  it("rejects domain already claimed by another MSP", async () => {
    mockDbChain.limit.mockResolvedValueOnce([{ mspId: 99 }]); // different MSP owns it
    const app = await makeApp();
    const token = makeToken();
    const res = await request(app)
      .post("/api/msp/settings/custom-domain")
      .set("Authorization", `Bearer ${token}`)
      .send({ domain: "portal.taken.com" });
    expect(res.status).toBe(409);
  });
});

// ── DNS verification tests ────────────────────────────────────────────────────

describe("POST /api/msp/settings/custom-domain/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbChain.select.mockReturnThis();
    mockDbChain.from.mockReturnThis();
    mockDbChain.where.mockReturnThis();
    mockDbChain.limit.mockResolvedValue([]);
    mockDbChain.update.mockReturnThis();
    mockDbChain.set.mockReturnThis();
    mockDbChain.returning.mockResolvedValue([{ ...mockCustomDomain, verificationStatus: "verified", verifiedAt: new Date() }]);
    mockDbChain.insert.mockReturnThis();
    mockDbChain.values.mockReturnThis();
  });

  it("returns 404 when no domain registered", async () => {
    mockDbChain.limit.mockResolvedValueOnce([]);
    const app = await makeApp();
    const token = makeToken();
    const res = await request(app)
      .post("/api/msp/settings/custom-domain/verify")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("marks domain as verified when TXT record matches", async () => {
    mockDbChain.limit.mockResolvedValueOnce([mockCustomDomain]);
    const { resolveTxt } = await import("dns/promises");
    vi.mocked(resolveTxt).mockResolvedValueOnce([[mockCustomDomain.verificationToken]]);

    const app = await makeApp();
    const token = makeToken();
    const res = await request(app)
      .post("/api/msp/settings/custom-domain/verify")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.verificationStatus).toBe("verified");
  });

  it("marks domain as failed when TXT record not found", async () => {
    mockDbChain.limit.mockResolvedValueOnce([mockCustomDomain]);
    mockDbChain.returning.mockResolvedValueOnce([{ ...mockCustomDomain, verificationStatus: "failed" }]);
    const { resolveTxt } = await import("dns/promises");
    const err = Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    vi.mocked(resolveTxt).mockRejectedValueOnce(err);

    const app = await makeApp();
    const token = makeToken();
    const res = await request(app)
      .post("/api/msp/settings/custom-domain/verify")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.verificationStatus).toBe("failed");
  });

  it("marks domain as failed when TXT value does not match", async () => {
    mockDbChain.limit.mockResolvedValueOnce([mockCustomDomain]);
    mockDbChain.returning.mockResolvedValueOnce([{ ...mockCustomDomain, verificationStatus: "failed" }]);
    const { resolveTxt } = await import("dns/promises");
    vi.mocked(resolveTxt).mockResolvedValueOnce([["wrong-token-value"]]);

    const app = await makeApp();
    const token = makeToken();
    const res = await request(app)
      .post("/api/msp/settings/custom-domain/verify")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
  });

  it("returns verified immediately if already verified", async () => {
    mockDbChain.limit.mockResolvedValueOnce([
      { ...mockCustomDomain, verificationStatus: "verified", verifiedAt: new Date("2026-01-10") },
    ]);
    const app = await makeApp();
    const token = makeToken();
    const res = await request(app)
      .post("/api/msp/settings/custom-domain/verify")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe("verified");
    expect(res.body.message).toMatch(/already verified/i);
  });
});

// ── DELETE tests ─────────────────────────────────────────────────────────────

describe("DELETE /api/msp/settings/custom-domain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbChain.select.mockReturnThis();
    mockDbChain.from.mockReturnThis();
    mockDbChain.where.mockReturnThis();
    mockDbChain.limit.mockResolvedValue([]);
    mockDbChain.delete.mockReturnThis();
    mockDbChain.insert.mockReturnThis();
    mockDbChain.values.mockReturnThis();
    mockDbChain.returning.mockResolvedValue([]);
  });

  it("returns 404 when no domain registered", async () => {
    mockDbChain.limit.mockResolvedValueOnce([]);
    const app = await makeApp();
    const token = makeToken();
    const res = await request(app)
      .delete("/api/msp/settings/custom-domain")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("deletes domain and returns 204", async () => {
    mockDbChain.limit.mockResolvedValueOnce([{ id: 1, domain: "portal.contoso.com" }]);
    const app = await makeApp();
    const token = makeToken();
    const res = await request(app)
      .delete("/api/msp/settings/custom-domain")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
