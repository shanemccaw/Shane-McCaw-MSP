/**
 * Tests for the Portal Delivery Kanban routes.
 *
 * Covers:
 *   1. GET /portal/projects/:id/delivery-kanban-tasks
 *      - Admin receives internalNotes; customer receives tasks without internalNotes
 *   2. POST /portal/delivery-kanban-tasks — admin-only create
 *   3. PATCH /portal/delivery-kanban-tasks/:id — customer column-move restrictions
 *   4. DELETE /portal/delivery-kanban-tasks/:id — admin-only
 *   5. POST /portal/delivery-kanban-tasks/:id/run-workflow — fires fireWorkflowForDefinition
 *   6. POST /portal/delivery-kanban-tasks/:id/run-monitoring — fires executeMonitoringPackage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq:  vi.fn((_col, _val) => ({ type: "eq" })),
  and: vi.fn((...args) => ({ type: "and", args })),
  or:  vi.fn((...args) => ({ type: "or", args })),
  asc: vi.fn((col) => ({ type: "asc", col })),
  desc: vi.fn((col) => ({ type: "desc", col })),
  isNull: vi.fn((col) => ({ type: "isNull", col })),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
    leftJoin: vi.fn(),
    innerJoin: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
    returning: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
  kanbanTasksTable: { id: "id", projectId: "project_id", column: "column", order: "order", publicNotes: "public_notes", internalNotes: "internal_notes", taskMetadata: "task_metadata" },
  projectsTable: { id: "id", clientUserId: "client_user_id" },
  usersTable: { id: "id", role: "role" },
  clientAppRegistrationsTable: { clientUserId: "client_user_id", tenantId: "tenant_id" },
  wfDefinitionsTable: { id: "id", name: "name" },
}));

vi.mock("../lib/sse-channels.ts", () => ({
  broadcastKanbanChange: vi.fn(),
}));

vi.mock("../lib/workflow-executor.ts", () => ({
  fireWorkflowForDefinition: vi.fn(),
}));

vi.mock("../lib/monitor-executor.ts", () => ({
  executeMonitoringPackage: vi.fn(),
}));

vi.mock("../lib/logger.ts", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Import router after mocks ──────────────────────────────────────────────────

import portalDeliveryKanbanRouter from "./portal-delivery-kanban.ts";
import { db } from "@workspace/db";
import { fireWorkflowForDefinition } from "../lib/workflow-executor.ts";
import { executeMonitoringPackage } from "../lib/monitor-executor.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const JWT_SECRET = "delivery-kanban-test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function adminToken(): string {
  return jwt.sign({ id: 1, email: "admin@test.com", role: "admin" }, JWT_SECRET, { expiresIn: "1h" });
}

function customerToken(): string {
  return jwt.sign({ id: 2, email: "customer@test.com", role: "client", mspRole: "CustomerUser", mspId: 1 }, JWT_SECRET, { expiresIn: "1h" });
}

const app = express();
app.use(express.json());
app.use("/", portalDeliveryKanbanRouter);

type MockDb = Record<string, ReturnType<typeof vi.fn>>;

function mockDb(): MockDb {
  return db as unknown as MockDb;
}

/**
 * Set up the db mock as a chainable object where every method returns `this`
 * by default. Individual tests can override specific methods with `mockResolvedValueOnce`.
 * Uses vi.resetAllMocks() to drain any lingering once-queue values between tests.
 */
function setupChainableMock(overrides: Partial<Record<keyof MockDb, unknown[]>> = {}): void {
  vi.resetAllMocks();
  const m = mockDb();
  // All methods return this by default (chainable)
  for (const key of ["select", "from", "where", "orderBy", "leftJoin", "innerJoin", "update", "set", "delete", "insert", "values"]) {
    m[key].mockReturnThis();
  }
  // Terminal methods resolve to empty arrays by default
  m["limit"].mockResolvedValue([]);
  m["returning"].mockResolvedValue([]);
  // Apply caller-supplied overrides (once values)
  for (const [key, values] of Object.entries(overrides)) {
    for (const value of (values ?? [])) {
      m[key]?.mockResolvedValueOnce(value);
    }
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /portal/projects/:id/delivery-kanban-tasks", () => {
  it("admin receives tasks including internalNotes", async () => {
    const task = {
      id: 1, projectId: 5, title: "Setup SharePoint", column: "backlog",
      publicNotes: "Client note", internalNotes: "Internal admin note",
      description: null, order: 0, priority: "medium",
      taskMetadata: null, dueDate: null, assignedTo: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setupChainableMock({
      limit: [[{ clientUserId: 99 }]],   // project access check
      orderBy: [[task]],                  // tasks list
    });

    const res = await request(app)
      .get("/portal/projects/5/delivery-kanban-tasks")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    const tasks = res.body as typeof task[];
    expect(tasks[0]).toHaveProperty("internalNotes", "Internal admin note");
  });

  it("customer does NOT receive internalNotes", async () => {
    const task = {
      id: 2, projectId: 5, title: "Migrate data", column: "in_progress",
      publicNotes: "Please review", internalNotes: "SECRET admin note",
      description: null, order: 1, priority: "high",
      taskMetadata: null, dueDate: null, assignedTo: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setupChainableMock({
      limit: [[{ clientUserId: 2 }]],    // project belongs to customer user 2
      orderBy: [[task]],
    });

    const res = await request(app)
      .get("/portal/projects/5/delivery-kanban-tasks")
      .set("Authorization", `Bearer ${customerToken()}`);

    expect(res.status).toBe(200);
    const tasks = res.body as Record<string, unknown>[];
    expect(tasks[0]).not.toHaveProperty("internalNotes");
    expect(tasks[0]).toHaveProperty("publicNotes", "Please review");
  });

  it("returns 401 when no token", async () => {
    setupChainableMock();
    const res = await request(app).get("/portal/projects/5/delivery-kanban-tasks");
    expect(res.status).toBe(401);
  });

  it("returns 404 when customer tries to access another client's project", async () => {
    setupChainableMock({
      limit: [[{ clientUserId: 99 }]],   // project belongs to user 99, but customer is user 2
    });

    const res = await request(app)
      .get("/portal/projects/5/delivery-kanban-tasks")
      .set("Authorization", `Bearer ${customerToken()}`);

    expect(res.status).toBe(404);
  });
});

describe("POST /portal/delivery-kanban-tasks", () => {
  it("admin can create a task", async () => {
    const newTask = {
      id: 10, projectId: 5, title: "New task", column: "backlog",
      description: null, order: 0, priority: "medium", publicNotes: null,
      internalNotes: null, taskMetadata: null, dueDate: null, assignedTo: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setupChainableMock({
      limit: [
        [{ id: 5 }],       // project existence check
        [],                // max order check (no existing tasks)
      ],
      returning: [[newTask]],
    });

    const res = await request(app)
      .post("/portal/delivery-kanban-tasks")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ projectId: 5, title: "New task" });

    expect(res.status).toBe(201);
    expect((res.body as typeof newTask).title).toBe("New task");
  });

  it("customer cannot create a task — returns 403", async () => {
    setupChainableMock();

    const res = await request(app)
      .post("/portal/delivery-kanban-tasks")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ projectId: 5, title: "My task" });

    expect(res.status).toBe(403);
  });

  it("returns 400 when title is missing", async () => {
    setupChainableMock();

    const res = await request(app)
      .post("/portal/delivery-kanban-tasks")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ projectId: 5 });

    expect(res.status).toBe(400);
  });
});

describe("PATCH /portal/delivery-kanban-tasks/:id — column-move restrictions", () => {
  const baseTask = {
    id: 3, projectId: 5, title: "T", column: "in_progress",
    publicNotes: null, internalNotes: null, description: null,
    order: 0, priority: "medium", taskMetadata: null, dueDate: null,
    assignedTo: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };

  it("admin can move a task to any column", async () => {
    const updated = { ...baseTask, column: "completed" };
    setupChainableMock({
      limit: [
        [baseTask],               // task lookup
        [{ clientUserId: 99 }],   // project access check
      ],
      returning: [[updated]],     // update result
    });

    const res = await request(app)
      .patch("/portal/delivery-kanban-tasks/3")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ column: "completed" });

    expect(res.status).toBe(200);
    expect((res.body as { task: { column: string } }).task.column).toBe("completed");
  });

  it("customer can move waiting_on_customer task back to in_progress", async () => {
    const waitingTask = { ...baseTask, column: "waiting_on_customer" };
    const updated = { ...waitingTask, column: "in_progress" };
    setupChainableMock({
      limit: [
        [waitingTask],            // task lookup
        [{ clientUserId: 2 }],   // project access (customer 2 → project owned by 2)
      ],
      returning: [[updated]],
    });

    const res = await request(app)
      .patch("/portal/delivery-kanban-tasks/3")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ column: "in_progress" });

    expect(res.status).toBe(200);
  });

  it("customer cannot move a task from in_progress to completed — returns 403", async () => {
    setupChainableMock({
      limit: [
        [baseTask],               // task lookup (column: "in_progress")
        [{ clientUserId: 2 }],   // project access
      ],
    });

    const res = await request(app)
      .patch("/portal/delivery-kanban-tasks/3")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ column: "completed" });

    expect(res.status).toBe(403);
  });
});

describe("DELETE /portal/delivery-kanban-tasks/:id", () => {
  it("admin can delete a task — returns 204", async () => {
    setupChainableMock({
      limit: [[{ id: 4, projectId: 5 }]],  // task existence check
    });

    const res = await request(app)
      .delete("/portal/delivery-kanban-tasks/4")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(204);
  });

  it("customer cannot delete a task — returns 403", async () => {
    setupChainableMock();

    const res = await request(app)
      .delete("/portal/delivery-kanban-tasks/4")
      .set("Authorization", `Bearer ${customerToken()}`);

    expect(res.status).toBe(403);
  });
});

describe("POST /portal/delivery-kanban-tasks/:id/run-workflow", () => {
  it("admin fires workflow for task with linkedWorkflowId", async () => {
    const taskWithWorkflow = {
      id: 8, projectId: 10, title: "T", column: "in_progress",
      taskMetadata: { linkedWorkflowId: 55 },
      publicNotes: null, internalNotes: null, description: null,
      order: 0, priority: "medium", dueDate: null, assignedTo: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setupChainableMock({
      limit: [
        [taskWithWorkflow],           // task lookup
        [{ id: 55, name: "My Workflow" }],  // definition lookup
        [{ clientUserId: 2 }],        // project lookup for payload
      ],
    });
    vi.mocked(fireWorkflowForDefinition).mockResolvedValue(42 as never);

    const res = await request(app)
      .post("/portal/delivery-kanban-tasks/8/run-workflow")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    expect((res.body as Record<string, unknown>).runId).toBe(42);
    expect(fireWorkflowForDefinition).toHaveBeenCalledWith(
      55, "manual", expect.anything(), expect.anything()
    );
  });

  it("returns 400 if no linkedWorkflowId in taskMetadata", async () => {
    setupChainableMock({
      limit: [[{ id: 9, projectId: 10, title: "T", taskMetadata: {}, column: "in_progress", order: 0, priority: "medium" }]],
    });

    const res = await request(app)
      .post("/portal/delivery-kanban-tasks/9/run-workflow")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(400);
  });

  it("customer cannot run a workflow — returns 403", async () => {
    setupChainableMock();

    const res = await request(app)
      .post("/portal/delivery-kanban-tasks/8/run-workflow")
      .set("Authorization", `Bearer ${customerToken()}`);

    expect(res.status).toBe(403);
  });
});

describe("POST /portal/delivery-kanban-tasks/:id/run-monitoring", () => {
  it("admin fires monitoring package for task with monitoringPackageKey", async () => {
    const taskWithMonitoring = {
      id: 10, projectId: 10, title: "T", column: "in_progress",
      taskMetadata: { monitoringPackageKey: "m365.health" },
      publicNotes: null, internalNotes: null, description: null,
      order: 0, priority: "medium", dueDate: null, assignedTo: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setupChainableMock({
      limit: [
        [taskWithMonitoring],              // task lookup
        [{ clientUserId: 2 }],            // project → clientUserId
        [{ tenantId: "tenant-abc" }],     // app registration → tenantId
      ],
    });
    vi.mocked(executeMonitoringPackage).mockResolvedValue({
      packageKey: "m365.health",
      tenantId: "tenant-abc",
      triggerId: "trig-1",
      runStatus: "ok",
      checks: [],
      enginesRecomputed: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    } as never);

    const res = await request(app)
      .post("/portal/delivery-kanban-tasks/10/run-monitoring")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    expect(executeMonitoringPackage).toHaveBeenCalledWith(
      expect.objectContaining({ packageKey: "m365.health", tenantId: "tenant-abc" })
    );
  });

  it("returns 400 if no monitoringPackageKey", async () => {
    setupChainableMock({
      limit: [[{ id: 11, projectId: 10, title: "T", taskMetadata: {}, column: "in_progress", order: 0, priority: "medium" }]],
    });

    const res = await request(app)
      .post("/portal/delivery-kanban-tasks/11/run-monitoring")
      .set("Authorization", `Bearer ${adminToken()}`);

    expect(res.status).toBe(400);
  });

  it("customer cannot run monitoring — returns 403", async () => {
    setupChainableMock();

    const res = await request(app)
      .post("/portal/delivery-kanban-tasks/10/run-monitoring")
      .set("Authorization", `Bearer ${customerToken()}`);

    expect(res.status).toBe(403);
  });
});
