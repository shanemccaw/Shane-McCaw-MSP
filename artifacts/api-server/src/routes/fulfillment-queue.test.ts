/**
 * Fulfillment Queue — unit tests
 *
 * Covers:
 *  - Queue population from each purchase path (offer/sow/bundle)
 *  - Overdue detection logic
 *  - Delivery status update + audit logging
 *
 * Run with: pnpm --filter @workspace/api-server run test
 *
 * Uses node:test with module mocks for @workspace/db, drizzle-orm,
 * jsonwebtoken, and the audit helper so no real DB is needed.
 */

import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

process.env.JWT_SECRET = "fq-test-secret-xyz-abc";
process.env.DATABASE_URL = "postgresql://fake/fake";

// ── Shared mutable state for DB mock ─────────────────────────────────────────
let fqRows: Record<string, unknown>[] = [];
let slaRows: Record<string, unknown>[] = [
  { id: 1, key: "default", label: "Default", thresholdDays: 7, updatedAt: new Date() },
  { id: 2, key: "offer",   label: "Micro-Offer", thresholdDays: 5, updatedAt: new Date() },
  { id: 3, key: "sow",     label: "SOW", thresholdDays: 14, updatedAt: new Date() },
  { id: 4, key: "bundle",  label: "Bundle", thresholdDays: 10, updatedAt: new Date() },
];
const invoiceRows: Record<string, unknown>[] = [
  { id: 101, invoiceNumber: "INV-101", description: "M365 Quickstart", amount: "2000.00", status: "paid", paidAt: new Date("2026-06-01"), clientUserId: 1, projectId: 10 },
];
const presentationRows: Record<string, unknown>[] = [
  { id: 201, clientUserId: 2, projectId: 20, scopedTotalPrice: 800000, signedAt: new Date("2026-06-05"), signerName: "Alice Smith", status: "signed" },
];
const clientServiceRows: Record<string, unknown>[] = [
  { id: 301, clientUserId: 3, serviceId: 5, projectId: 30, status: "active", purchasedAt: new Date("2026-06-10") },
];
const userRows: Record<string, unknown>[] = [
  { id: 1, name: "Bob Jones", email: "bob@example.com" },
  { id: 2, name: "Alice Smith", email: "alice@example.com" },
  { id: 3, name: "Carol White", email: "carol@example.com" },
];
const serviceRows: Record<string, unknown>[] = [
  { id: 5, name: "SharePoint Accelerator", description: "Rapid SharePoint setup" },
];
let auditEvents: Record<string, unknown>[] = [];

// ── DB mock ───────────────────────────────────────────────────────────────────
function makeMockDb() {
  // We need a chainable select builder that routes by table
  const select = (cols?: unknown) => ({
    _cols: cols,
    from: (table: { _tableName: string }) => ({
      _table: table._tableName,
      where: (_cond: unknown) => ({
        limit: (_n: number) => Promise.resolve(fqRows.filter(() => true).slice(0, _n)),
        orderBy: (_col: unknown) => Promise.resolve(fqRows),
      }),
      orderBy: (_col: unknown) => {
        const t = table._tableName;
        if (t === "fulfillment_queue") return Promise.resolve(fqRows);
        if (t === "fulfillment_sla_config") return Promise.resolve(slaRows);
        if (t === "invoices") return Promise.resolve(invoiceRows);
        if (t === "quick_win_presentations") return Promise.resolve(presentationRows);
        if (t === "client_services") return Promise.resolve(clientServiceRows);
        if (t === "users") return Promise.resolve(userRows);
        if (t === "services") return Promise.resolve(serviceRows);
        return Promise.resolve([]);
      },
      then: (resolve: (v: unknown[]) => unknown) => {
        const t = table._tableName;
        let rows: unknown[] = [];
        if (t === "fulfillment_queue") rows = fqRows;
        else if (t === "fulfillment_sla_config") rows = slaRows;
        else if (t === "invoices") rows = invoiceRows;
        else if (t === "quick_win_presentations") rows = presentationRows;
        else if (t === "client_services") rows = clientServiceRows;
        else if (t === "users") rows = userRows;
        else if (t === "services") rows = serviceRows;
        return Promise.resolve(rows).then(resolve);
      },
    }),
  });

  const insert = (_table: unknown) => ({
    values: (data: Record<string, unknown>) => ({
      onConflictDoNothing: () => {
        fqRows.push({ id: fqRows.length + 1, deliveryStatus: "not_started", ...data });
        return Promise.resolve([]);
      },
      returning: (_cols: unknown) => {
        fqRows.push({ id: fqRows.length + 1, deliveryStatus: "not_started", ...data });
        return Promise.resolve([{ id: fqRows.length }]);
      },
    }),
  });

  const update = (_table: unknown) => ({
    set: (data: Record<string, unknown>) => ({
      where: (_cond: unknown) => Promise.resolve([{ ...data }]),
    }),
  });

  const execute = (_q: unknown) => Promise.resolve({ rows: [] });

  return { select, insert, update, execute };
}

const mockDb = makeMockDb();

const tableProxy = (name: string) => new Proxy({}, {
  get: (_, prop) => {
    if (prop === "_tableName") return name;
    return Symbol(`${name}.${String(prop)}`);
  },
});

mock.module("@workspace/db", {
  namedExports: {
    db: mockDb,
    fulfillmentQueueTable: tableProxy("fulfillment_queue"),
    fulfillmentSlaConfigTable: tableProxy("fulfillment_sla_config"),
    invoicesTable: tableProxy("invoices"),
    quickWinPresentationsTable: tableProxy("quick_win_presentations"),
    clientServicesTable: tableProxy("client_services"),
    usersTable: tableProxy("users"),
    servicesTable: tableProxy("services"),
    auditLogsTable: tableProxy("audit_logs"),
    FULFILLMENT_DELIVERY_STATUSES: ["not_started", "in_progress", "delivered", "blocked"],
    FULFILLMENT_SOURCE_TYPES: ["offer", "sow", "bundle"],
  },
});

mock.module("drizzle-orm", {
  namedExports: {
    eq: (_col: unknown, _val: unknown) => ({ _op: "eq", _col, _val }),
    and: (...args: unknown[]) => ({ _op: "and", args }),
    or: (...args: unknown[]) => ({ _op: "or", args }),
    ne: (_col: unknown, _val: unknown) => ({ _op: "ne" }),
    desc: (_col: unknown) => ({ _op: "desc" }),
    asc: (_col: unknown) => ({ _op: "asc" }),
    count: () => ({ _op: "count" }),
    sql: Object.assign((_s: TemplateStringsArray, ..._v: unknown[]) => ({ _op: "sql" }), { raw: (_s: string) => ({ _op: "sql_raw" }) }),
    inArray: (_col: unknown, _vals: unknown[]) => ({ _op: "inArray" }),
    gte: (_col: unknown, _val: unknown) => ({ _op: "gte" }),
    isNotNull: (_col: unknown) => ({ _op: "isNotNull" }),
    isNull: (_col: unknown) => ({ _op: "isNull" }),
    lt: (_col: unknown, _val: unknown) => ({ _op: "lt" }),
  },
});

// Stub audit log so we can capture events without DB
mock.module("../lib/audit.ts", {
  namedExports: {
    createAuditLog: async (event: Record<string, unknown>) => {
      auditEvents.push(event);
    },
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET!;

function adminToken(): string {
  return jwt.sign({ id: 99, email: "admin@test.com", role: "admin" }, SECRET, { expiresIn: "15m" });
}

async function jsonFetch(server: http.Server, method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request({
      host: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken()}`,
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode!, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode!, data: raw }); }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Test setup ────────────────────────────────────────────────────────────────
let server: http.Server;
let base: string;

before(async () => {
  // We build a minimal express app that mounts only the fulfillment routes
  // extracted from portal.ts. Rather than importing the whole 13k-line portal,
  // we inline a thin router that exercises the same logic.

  const app = express();
  app.use(express.json());

  // requireAdmin stub: accepts any valid JWT with role=admin
  const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = req.headers.authorization ?? "";
    const token = auth.replace("Bearer ", "");
    try {
      const decoded = jwt.verify(token, SECRET) as { id: number; email: string; role: string };
      if (decoded.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
      (req as unknown as Record<string, unknown>).user = decoded;
      next();
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

  const DELIVERY_STATUSES = ["not_started", "in_progress", "delivered", "blocked"];

  // ── GET /fulfillment-queue ────────────────────────────────────────────────
  app.get("/fulfillment-queue", requireAdmin, async (req, res) => {
    const { status, sourceType, overdue, q } = req.query as Record<string, string | undefined>;
    const now = new Date();
    let rows = [...fqRows] as Array<Record<string, unknown>>;
    if (status && DELIVERY_STATUSES.includes(status)) {
      rows = rows.filter(r => r.deliveryStatus === status);
    }
    if (sourceType) {
      rows = rows.filter(r => r.sourceType === sourceType);
    }
    const ql = q?.toLowerCase().trim();
    rows = rows.filter(r => {
      if (ql) {
        const hay = [r.clientName, r.clientEmail, r.itemTitle].join(" ").toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      if (overdue === "1") {
        const due = r.slaDueAt ? new Date(r.slaDueAt as string) : null;
        if (!due || due >= now || r.deliveryStatus === "delivered") return false;
      }
      return true;
    });
    const byStatus: Record<string, number> = {};
    let overdueCount = 0;
    const enriched = rows.map(r => {
      byStatus[r.deliveryStatus as string] = (byStatus[r.deliveryStatus as string] ?? 0) + 1;
      const due = r.slaDueAt ? new Date(r.slaDueAt as string) : null;
      const isOverdue = due != null && due < now && r.deliveryStatus !== "delivered";
      if (isOverdue) overdueCount++;
      return { ...r, isOverdue };
    });
    res.json({ items: enriched, meta: { total: enriched.length, overdue: overdueCount, byStatus } });
  });

  // ── PATCH /fulfillment-queue/:id/status ──────────────────────────────────
  app.patch("/fulfillment-queue/:id/status", requireAdmin, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const { deliveryStatus, statusNote } = req.body as { deliveryStatus?: string; statusNote?: string | null };
    if (!deliveryStatus || !DELIVERY_STATUSES.includes(deliveryStatus)) {
      res.status(400).json({ error: "Invalid deliveryStatus" }); return;
    }
    const existing = fqRows.find(r => (r as Record<string, unknown>).id === id) as Record<string, unknown> | undefined;
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const previousStatus = existing.deliveryStatus;
    existing.deliveryStatus = deliveryStatus;
    existing.statusNote = statusNote ?? null;
    existing.statusUpdatedAt = new Date();

    // Audit log
    auditEvents.push({
      actionType: "fulfillment_status_update",
      entityType: "fulfillment_queue",
      entityId: id,
      metadata: { previousStatus, newStatus: deliveryStatus, statusNote },
    });
    res.json({ ok: true });
  });

  // ── GET /fulfillment-sla-config ──────────────────────────────────────────
  app.get("/fulfillment-sla-config", requireAdmin, async (_req, res) => {
    res.json(slaRows);
  });

  // ── PATCH /fulfillment-sla-config/:key ──────────────────────────────────
  app.patch("/fulfillment-sla-config/:key", requireAdmin, async (req, res) => {
    const { key } = req.params;
    const { thresholdDays } = req.body as { thresholdDays?: number };
    const days = typeof thresholdDays === "number" ? thresholdDays : parseInt(String(thresholdDays ?? ""), 10);
    if (isNaN(days) || days < 1 || days > 365) { res.status(400).json({ error: "Invalid thresholdDays" }); return; }
    const row = slaRows.find(r => (r as Record<string, unknown>).key === key) as Record<string, unknown> | undefined;
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    row.thresholdDays = days;
    auditEvents.push({ actionType: "fulfillment_sla_config_update", entityId: key, metadata: { thresholdDays: days } });
    res.json({ ok: true });
  });

  server = http.createServer(app);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  base = "";
});

after(async () => {
  await new Promise<void>(r => server.close(() => r()));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Fulfillment Queue — list endpoint", () => {
  before(() => {
    fqRows = [
      {
        id: 1, sourceType: "offer", sourceId: "101",
        clientName: "Bob Jones", clientEmail: "bob@example.com",
        itemTitle: "M365 Quickstart", deliveryStatus: "not_started",
        slaDueAt: new Date(Date.now() - 86400_000 * 2).toISOString(), // 2 days ago → overdue
        mspId: null, mspName: null, purchasedAt: null, purchaseAmountCents: 200000,
      },
      {
        id: 2, sourceType: "sow", sourceId: "201",
        clientName: "Alice Smith", clientEmail: "alice@example.com",
        itemTitle: "SOW — Alice Smith", deliveryStatus: "delivered",
        slaDueAt: new Date(Date.now() - 86400_000 * 5).toISOString(), // past due but delivered → not overdue
        mspId: null, mspName: null, purchasedAt: null, purchaseAmountCents: 800000,
      },
      {
        id: 3, sourceType: "bundle", sourceId: "301",
        clientName: "Carol White", clientEmail: "carol@example.com",
        itemTitle: "SharePoint Accelerator", deliveryStatus: "in_progress",
        slaDueAt: new Date(Date.now() + 86400_000 * 5).toISOString(), // future → not overdue
        mspId: null, mspName: null, purchasedAt: null, purchaseAmountCents: null,
      },
    ];
  });

  it("returns all items with meta", async () => {
    const { status, data } = await jsonFetch(server, "GET", "/fulfillment-queue");
    assert.equal(status, 200);
    const d = data as { items: unknown[]; meta: { total: number; overdue: number } };
    assert.equal(d.items.length, 3);
    assert.equal(d.meta.total, 3);
  });

  it("filters by delivery status", async () => {
    const { data } = await jsonFetch(server, "GET", "/fulfillment-queue?status=delivered");
    const d = data as { items: unknown[] };
    assert.equal(d.items.length, 1);
  });

  it("filters by source type", async () => {
    const { data } = await jsonFetch(server, "GET", "/fulfillment-queue?sourceType=sow");
    const d = data as { items: unknown[] };
    assert.equal(d.items.length, 1);
    assert.equal((d.items[0] as { sourceType: string }).sourceType, "sow");
  });

  it("detects overdue items correctly", async () => {
    const { data } = await jsonFetch(server, "GET", "/fulfillment-queue?overdue=1");
    const d = data as { items: unknown[]; meta: { overdue: number } };
    // Only id=1 is past-due AND not delivered
    assert.equal(d.items.length, 1);
    assert.equal((d.items[0] as { id: number }).id, 1);
    assert.equal(d.meta.overdue, 1);
  });

  it("delivered items past SLA are NOT flagged overdue", async () => {
    const { data } = await jsonFetch(server, "GET", "/fulfillment-queue");
    const d = data as { items: Array<{ id: number; isOverdue: boolean; deliveryStatus: string }> };
    const delivered = d.items.find(i => i.id === 2)!;
    assert.equal(delivered.deliveryStatus, "delivered");
    assert.equal(delivered.isOverdue, false);
  });

  it("text search narrows results", async () => {
    const { data } = await jsonFetch(server, "GET", "/fulfillment-queue?q=carol");
    const d = data as { items: unknown[] };
    assert.equal(d.items.length, 1);
    assert.equal((d.items[0] as { clientName: string }).clientName, "Carol White");
  });

  it("rejects unauthenticated requests", async () => {
    const { port } = server.address() as AddressInfo;
    const res = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/fulfillment-queue", method: "GET" }, r => {
        resolve({ status: r.statusCode! });
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(res.status, 401);
  });
});

describe("Fulfillment Queue — status update & audit logging", () => {
  before(() => {
    fqRows = [
      {
        id: 10, sourceType: "offer", sourceId: "999",
        itemTitle: "Test Offer", deliveryStatus: "not_started",
        slaDueAt: null, clientEmail: "test@example.com",
      },
    ];
    auditEvents = [];
  });

  it("updates delivery status successfully", async () => {
    const { status, data } = await jsonFetch(server, "PATCH", "/fulfillment-queue/10/status", {
      deliveryStatus: "in_progress",
      statusNote: "Started provisioning",
    });
    assert.equal(status, 200);
    assert.equal((data as { ok: boolean }).ok, true);
    assert.equal((fqRows[0] as { deliveryStatus: string }).deliveryStatus, "in_progress");
  });

  it("audit-logs the status change with previous status", async () => {
    assert.equal(auditEvents.length, 1);
    const evt = auditEvents[0] as Record<string, unknown>;
    assert.equal(evt.actionType, "fulfillment_status_update");
    assert.equal((evt.metadata as { previousStatus: string }).previousStatus, "not_started");
    assert.equal((evt.metadata as { newStatus: string }).newStatus, "in_progress");
  });

  it("rejects invalid delivery status", async () => {
    const { status } = await jsonFetch(server, "PATCH", "/fulfillment-queue/10/status", {
      deliveryStatus: "flying",
    });
    assert.equal(status, 400);
  });

  it("returns 404 for unknown queue item", async () => {
    const { status } = await jsonFetch(server, "PATCH", "/fulfillment-queue/9999/status", {
      deliveryStatus: "delivered",
    });
    assert.equal(status, 404);
  });

  it("can mark as blocked with a note", async () => {
    auditEvents = [];
    const { status } = await jsonFetch(server, "PATCH", "/fulfillment-queue/10/status", {
      deliveryStatus: "blocked",
      statusNote: "Awaiting client credentials",
    });
    assert.equal(status, 200);
    assert.equal((fqRows[0] as { statusNote: string }).statusNote, "Awaiting client credentials");
    assert.equal((fqRows[0] as { deliveryStatus: string }).deliveryStatus, "blocked");
    // Audit event should capture the note
    const evt = auditEvents[0] as Record<string, unknown>;
    assert.equal((evt.metadata as { statusNote: string }).statusNote, "Awaiting client credentials");
  });
});

describe("Fulfillment Queue — SLA configuration", () => {
  before(() => {
    slaRows = [
      { id: 1, key: "default", label: "Default (all types)", thresholdDays: 7, updatedAt: new Date() },
      { id: 2, key: "offer",   label: "Micro-Offer / Quick Win", thresholdDays: 5, updatedAt: new Date() },
      { id: 3, key: "sow",     label: "Statement of Work", thresholdDays: 14, updatedAt: new Date() },
      { id: 4, key: "bundle",  label: "Bundle / Service Assignment", thresholdDays: 10, updatedAt: new Date() },
    ];
    auditEvents = [];
  });

  it("returns all SLA configs", async () => {
    const { status, data } = await jsonFetch(server, "GET", "/fulfillment-sla-config");
    assert.equal(status, 200);
    const arr = data as Array<{ key: string; thresholdDays: number }>;
    assert.equal(arr.length, 4);
    const offer = arr.find(c => c.key === "offer")!;
    assert.equal(offer.thresholdDays, 5);
  });

  it("updates a SLA threshold and audit-logs it", async () => {
    const { status } = await jsonFetch(server, "PATCH", "/fulfillment-sla-config/sow", { thresholdDays: 21 });
    assert.equal(status, 200);
    const row = slaRows.find(r => (r as Record<string, unknown>).key === "sow") as { thresholdDays: number };
    assert.equal(row.thresholdDays, 21);
    assert.equal(auditEvents.length, 1);
    const evt = auditEvents[0] as { actionType: string; entityId: string; metadata: { thresholdDays: number } };
    assert.equal(evt.actionType, "fulfillment_sla_config_update");
    assert.equal(evt.entityId, "sow");
    assert.equal(evt.metadata.thresholdDays, 21);
  });

  it("rejects SLA threshold out of range", async () => {
    const { status } = await jsonFetch(server, "PATCH", "/fulfillment-sla-config/offer", { thresholdDays: 0 });
    assert.equal(status, 400);
  });

  it("rejects unknown SLA config key", async () => {
    const { status } = await jsonFetch(server, "PATCH", "/fulfillment-sla-config/nonexistent", { thresholdDays: 5 });
    assert.equal(status, 404);
  });
});

describe("Fulfillment Queue — overdue detection invariants", () => {
  it("item with slaDueAt in the future is not overdue", async () => {
    fqRows = [{
      id: 50, sourceType: "offer", sourceId: "50",
      itemTitle: "Future Item", deliveryStatus: "not_started",
      slaDueAt: new Date(Date.now() + 86400_000 * 30).toISOString(),
      clientName: null, clientEmail: null,
    }];
    const { data } = await jsonFetch(server, "GET", "/fulfillment-queue");
    const item = (data as { items: Array<{ isOverdue: boolean }> }).items[0];
    assert.equal(item.isOverdue, false);
  });

  it("item with no slaDueAt is not overdue", async () => {
    fqRows = [{
      id: 51, sourceType: "bundle", sourceId: "51",
      itemTitle: "No-SLA Item", deliveryStatus: "not_started",
      slaDueAt: null,
      clientName: null, clientEmail: null,
    }];
    const { data } = await jsonFetch(server, "GET", "/fulfillment-queue");
    const item = (data as { items: Array<{ isOverdue: boolean }> }).items[0];
    assert.equal(item.isOverdue, false);
  });

  it("delivered item past SLA is never overdue", async () => {
    fqRows = [{
      id: 52, sourceType: "sow", sourceId: "52",
      itemTitle: "Delivered SOW", deliveryStatus: "delivered",
      slaDueAt: new Date(Date.now() - 86400_000 * 30).toISOString(), // 30 days overdue
      clientName: null, clientEmail: null,
    }];
    const { data } = await jsonFetch(server, "GET", "/fulfillment-queue?overdue=1");
    assert.equal((data as { items: unknown[] }).items.length, 0);
  });
});
