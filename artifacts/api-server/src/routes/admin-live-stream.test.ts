/**
 * Phase 3b Step 0 regression guard — the CHANNEL_TAXONOMY drift check.
 *
 * Phase 3a shipped a phantom "inbox" channel (no file anywhere tags a logger
 * with channel: "inbox" — routes/inbox.ts is actually "growth.booking"). Step 0
 * removed it; this test locks the resulting count and content so a future edit
 * can't silently reintroduce drift between the array and the real taxonomy.
 *
 * Also covers: GET /channels requires admin auth, and ?channel=* routes to the
 * firehose registrar rather than the ordinary per-channel one.
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import http from "node:http";
import type { AddressInfo } from "node:net";

const registerHubClient = vi.fn();
const registerFirehoseClient = vi.fn();

vi.mock("../lib/sse-hub.ts", () => ({
  registerHubClient: (...args: unknown[]) => registerHubClient(...args),
  registerFirehoseClient: (...args: unknown[]) => registerFirehoseClient(...args),
}));

// requireAuth.ts (imported transitively via requireAdmin) imports @workspace/db
// at module scope, which throws on import unless DATABASE_URL is set. This
// router test only exercises JWT verification + routing, never a DB query.
vi.mock("@workspace/db", () => ({
  db: {},
  mspCustomersTable: {},
}));

const JWT_SECRET = "test-live-stream-secret";
process.env.JWT_SECRET = JWT_SECRET;

function adminToken(): string {
  return jwt.sign({ id: 1, role: "admin" }, JWT_SECRET, { expiresIn: "1h" });
}

async function loadRouter() {
  // requireAdmin (via requireAuth) verifies the Bearer JWT itself — no auth
  // middleware needs to run upstream in this isolated router test.
  const { default: router } = await import("./admin-live-stream.ts");
  const app = express();
  app.use("/api", router);
  return app;
}

describe("GET /api/admin/live-stream/channels", () => {
  it("returns exactly the real channel taxonomy, no phantom entries", async () => {
    const app = await loadRouter();
    const res = await request(app)
      .get("/api/admin/live-stream/channels")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.channels).toHaveLength(30);
    expect(res.body.channels).not.toContain("inbox");
    expect(res.body.channels).toContain("engine.sla");
    expect(res.body.channels).toContain("growth.booking");
    // Sorted, no duplicates — a real static taxonomy, not accidental noise.
    expect(new Set(res.body.channels).size).toBe(res.body.channels.length);
  });

  it("rejects unauthenticated requests with 401 (missing Authorization header)", async () => {
    const app = await loadRouter();
    const res = await request(app).get("/api/admin/live-stream/channels");
    expect(res.status).toBe(401);
  });
});

// The SSE route never ends its response (it holds the connection open for the
// life of the client) — supertest's promise only resolves on response 'end',
// so it hangs here. Connect with raw http instead, read until the handler's
// synchronous body has run (the first written chunk proves it has, since the
// handler has no `await` between res.write and the registrar call), then
// tear the socket down like a real EventSource client disconnecting.
function connectAndReadOneChunk(port: number, qs: string): Promise<void> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/admin/live-stream?${qs}`, (res) => {
      res.once("data", () => { req.destroy(); resolve(); });
      res.on("error", () => resolve());
    });
    req.on("error", () => resolve());
    setTimeout(() => { req.destroy(); resolve(); }, 2000);
  });
}

describe("GET /api/admin/live-stream routing", () => {
  it("routes ?channel=* to the firehose registrar, not the per-channel one", async () => {
    const app = await loadRouter();
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const token = jwt.sign({ id: 1, role: "admin" }, JWT_SECRET);
      await connectAndReadOneChunk(port, `channel=*&token=${token}`);
      expect(registerFirehoseClient).toHaveBeenCalledTimes(1);
      expect(registerHubClient).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it("routes a named channel to the per-channel registrar, not the firehose", async () => {
    registerHubClient.mockClear();
    registerFirehoseClient.mockClear();
    const app = await loadRouter();
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const token = jwt.sign({ id: 1, role: "admin" }, JWT_SECRET);
      await connectAndReadOneChunk(port, `channel=engine.sla&mspId=42&token=${token}`);
      expect(registerHubClient).toHaveBeenCalledTimes(1);
      expect(registerHubClient).toHaveBeenCalledWith("engine.sla", 42, expect.anything(), expect.any(Function));
      expect(registerFirehoseClient).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});
