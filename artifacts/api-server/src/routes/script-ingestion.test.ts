/**
 * script-ingestion.test.ts
 *
 * Unit tests for POST /api/script-ingestion.
 *
 * All DB calls are mocked via vi.mock("@workspace/db").
 * Token validation, viability gate, and ingestion recording are tested in isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "crypto";

// ── Mock @workspace/db ─────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@workspace/db", () => {
  const scriptDownloadTokensTable = { tokenHash: "tokenHash", id: "id", scriptId: "scriptId", mspId: "mspId", customerId: "customerId", clientUserId: "clientUserId", expiresAt: "expiresAt", usedAt: "usedAt", revokedAt: "revokedAt" };
  const scriptRunResultsTable = { id: "id", customerId: "customerId", libraryScriptId: "libraryScriptId", rawOutput: "rawOutput", status: "status", executionSource: "executionSource", uploadedBy: "uploadedBy", uploadedAt: "uploadedAt", scriptName: "scriptName" };
  const powershellScriptsTable = { id: "id", description: "description", title: "title" };

  const dbMock = {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  };

  return {
    db: dbMock,
    scriptDownloadTokensTable,
    scriptRunResultsTable,
    powershellScriptsTable,
    pool: { query: vi.fn() },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...args: unknown[]) => ({ and: args }),
  isNull: (a: unknown) => ({ isNull: a }),
}));

// ── Mock AI analyzer (fire-and-forget — we don't assert on it) ─────────────────
vi.mock("../lib/ai-analyzer.ts", () => ({
  runAiAnalyzer: vi.fn().mockResolvedValue({ findings: [], recommendations: [], scoreImpact: 0, profileUpdates: {} }),
}));

vi.mock("../lib/parse-m365-script-output.ts", () => ({
  parseM365ScriptOutput: vi.fn().mockReturnValue({}),
  normaliseProfileUpdates: vi.fn().mockReturnValue({}),
}));

vi.mock("../lib/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Import router under test ───────────────────────────────────────────────────
// Dynamic import so mocks are applied first
let app: express.Express;

beforeEach(async () => {
  vi.resetModules();
  const { default: router } = await import("./script-ingestion.ts");
  app = express();
  app.use(express.json());
  app.use(router);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

function makeTokenRow(overrides: Partial<{
  id: number;
  scriptId: string;
  mspId: number | null;
  customerId: number | null;
  clientUserId: number | null;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}> = {}) {
  return {
    id: 42,
    scriptId: "aaaabbbb-cccc-dddd-eeee-ffff00001111",
    mspId: 1,
    customerId: 7,
    clientUserId: null,
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    usedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function setupDbMocks(tokenRow: ReturnType<typeof makeTokenRow> | undefined, runResultId = 99) {
  // mockSelect: chained select → from → where → limit → returns [tokenRow]
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(tokenRow ? [tokenRow] : []),
      }),
    }),
  });

  // mockInsert: insert → values → returning → returns [{ id: runResultId }]
  mockInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: runResultId }]),
    }),
  });

  // mockUpdate: update → set → where → returns void
  mockUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("POST /script-ingestion — auth guards", () => {
  it("returns 401 when no Authorization header", async () => {
    const res = await request(app).post("/script-ingestion").send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Bearer/i);
  });

  it("returns 401 when Authorization header is malformed", async () => {
    const res = await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Basic abc123")
      .send({});
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is not found in DB", async () => {
    setupDbMocks(undefined);
    const res = await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer unknowntoken")
      .send({ scriptType: "t", schemaVersion: "1.0", payload: { x: 1 } });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid token/i);
  });

  it("returns 401 when token is revoked", async () => {
    setupDbMocks(makeTokenRow({ revokedAt: new Date() }));
    const res = await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer sometoken")
      .send({ scriptType: "t", schemaVersion: "1.0", payload: { x: 1 } });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it("returns 409 when token is already used", async () => {
    setupDbMocks(makeTokenRow({ usedAt: new Date() }));
    const res = await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer usedtoken")
      .send({ scriptType: "t", schemaVersion: "1.0", payload: { x: 1 } });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already been used/i);
  });

  it("returns 401 when token is expired", async () => {
    setupDbMocks(makeTokenRow({ expiresAt: new Date(Date.now() - 1000) }));
    const res = await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer expiredtoken")
      .send({ scriptType: "t", schemaVersion: "1.0", payload: { x: 1 } });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });
});

describe("POST /script-ingestion — structural validation", () => {
  beforeEach(() => setupDbMocks(makeTokenRow()));

  it("returns 400 when scriptType is missing", async () => {
    const res = await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer goodtoken")
      .send({ schemaVersion: "1.0", payload: { x: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scriptType/i);
  });

  it("returns 400 when schemaVersion is missing", async () => {
    const res = await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer goodtoken")
      .send({ scriptType: "m365-health", payload: { x: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/schemaVersion/i);
  });

  it("returns 400 when payload is missing", async () => {
    const res = await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer goodtoken")
      .send({ scriptType: "m365-health", schemaVersion: "1.0" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/payload/i);
  });

  it("returns 400 when payload is an array (not object)", async () => {
    const res = await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer goodtoken")
      .send({ scriptType: "m365-health", schemaVersion: "1.0", payload: [1, 2, 3] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/payload/i);
  });
});

describe("POST /script-ingestion — viability gate", () => {
  beforeEach(() => setupDbMocks(makeTokenRow()));

  it("returns 422 when payload is empty object", async () => {
    const res = await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer goodtoken")
      .send({ scriptType: "m365-health", schemaVersion: "1.0", payload: {} });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/viability/i);
  });

  it("returns 422 when output contains fatal error pattern", async () => {
    const res = await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer goodtoken")
      .send({
        scriptType: "m365-health",
        schemaVersion: "1.0",
        payload: { output: "Error: could not connect to Exchange Online" },
      });
    expect(res.status).toBe(422);
    expect(res.body.reason).toMatch(/fatal error pattern/i);
  });

  it("returns 422 when payload is too small", async () => {
    const res = await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer goodtoken")
      .send({ scriptType: "m365-health", schemaVersion: "1.0", payload: { x: 1 } });
    expect(res.status).toBe(422);
    expect(res.body.reason).toMatch(/too small/i);
  });
});

describe("POST /script-ingestion — successful ingestion", () => {
  const goodPayload = {
    scriptType: "m365-health",
    schemaVersion: "1.0",
    payload: {
      licenses: { total: 100, assigned: 87, available: 13 },
      mfaEnabled: true,
      conditionalAccessPolicies: 5,
      lastSyncAt: "2026-07-11T06:00:00Z",
    },
  };

  it("returns 202 Accepted with runResultId for valid request", async () => {
    setupDbMocks(makeTokenRow(), 77);
    const res = await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer validtoken")
      .send(goodPayload);
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
    expect(res.body.runResultId).toBe(77);
    expect(res.body.viabilityResult).toBeTruthy();
  });

  it("calls insert on scriptRunResultsTable to record ingestion", async () => {
    setupDbMocks(makeTokenRow());
    await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer validtoken")
      .send(goodPayload);
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("calls update to burn the token after successful insert", async () => {
    setupDbMocks(makeTokenRow());
    await request(app)
      .post("/script-ingestion")
      .set("Authorization", "Bearer validtoken")
      .send(goodPayload);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});
