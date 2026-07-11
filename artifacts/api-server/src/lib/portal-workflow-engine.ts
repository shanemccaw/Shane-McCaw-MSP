/**
 * portal-workflow-engine.ts
 *
 * MSP Portal Workflow Engine — tenant-aware, durable, idempotent node execution.
 *
 * Architecture:
 *   1. Start Mappings  — event patterns → workflow keys (loaded from DB, hot-reloaded on demand).
 *   2. Event Hook      — portal engine registers a listener on the canonical event bus.
 *                        When a matching event fires, a portal_wf_runs record is created and
 *                        a background job is enqueued for durable execution.
 *   3. Node Executor   — each node runs with retry, idempotency, and per-attempt output persistence.
 *   4. Failure Path    — exhausted retries → DLQ entry + operator task with run deep-link.
 *
 * Workflow graph format (stored in portal_wf_workflows.graph):
 *   {
 *     nodes: Array<{ id: string; type: string; config: Record<string,unknown> }>,
 *     edges: Array<{ from: string; to: string; condition?: string }>
 *   }
 *
 * Core node types (registered at module load):
 *   start        — passes trigger event payload downstream; every graph must have exactly one.
 *   http_call    — generic outbound HTTP request.
 *   db_write     — parameterized SQL (SELECT/INSERT/UPDATE/DELETE).
 *   emit_event   — dispatches a new canonical event.
 *   wait         — noop delay (useful for test graphs).
 */

import { randomUUID } from "crypto";
import { db, pool } from "@workspace/db";
import {
  portalWfWorkflowsTable,
  portalWfStartMappingsTable,
  portalWfRunsTable,
  portalWfNodeOutputsTable,
  portalWfOperatorTasksTable,
  portalWfIdempotencyTable,
  mspDlqStoreTable,
} from "@workspace/db";
import { eq, and, inArray, sql as drizzleSql } from "drizzle-orm";
import { logger } from "./logger";
import { addEventListener, dispatchEvent, systemActor } from "./event-bus";
import type { DispatchedEvent } from "./event-bus";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TenantContext {
  mspId: number | null;
  customerId: number | null;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffBaseSeconds: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffBaseSeconds: 30,
  backoffMultiplier: 2,
};

export interface PortalWfNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface PortalWfEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface PortalWfGraph {
  nodes: PortalWfNode[];
  edges: PortalWfEdge[];
}

export interface NodeExecutionContext {
  runId: string;
  nodeId: string;
  nodeType: string;
  config: Record<string, unknown>;
  /** Merged payload: trigger input + outputs from predecessor nodes (keyed by nodeId) */
  input: Record<string, unknown>;
  tenantContext: TenantContext;
  attemptNumber: number;
}

export type NodeHandler = (ctx: NodeExecutionContext) => Promise<Record<string, unknown>>;

// ── Node Handler Registry ─────────────────────────────────────────────────────

const nodeHandlers = new Map<string, NodeHandler>();

export function registerNodeHandler(nodeType: string, handler: NodeHandler): void {
  nodeHandlers.set(nodeType, handler);
  logger.debug({ nodeType }, "portal-wf: registered node handler");
}

// ── In-memory event subscription state ───────────────────────────────────────
// Loaded from portal_wf_start_mappings on init, refreshable at runtime.

interface StartMapping {
  pattern: string;
  workflowKey: string;
  isActive: boolean;
}

let startMappings: StartMapping[] = [];
let mappingsLoadedAt: Date | null = null;

/**
 * Load (or reload) start mappings from DB into memory.
 * Called at engine init and available for hot-reload.
 */
export async function reloadStartMappings(): Promise<void> {
  try {
    const rows = await db.select({
      eventPattern: portalWfStartMappingsTable.eventPattern,
      workflowKey: portalWfStartMappingsTable.workflowKey,
      isActive: portalWfStartMappingsTable.isActive,
    }).from(portalWfStartMappingsTable);

    startMappings = rows.map((r) => ({
      pattern: r.eventPattern,
      workflowKey: r.workflowKey,
      isActive: r.isActive,
    }));
    mappingsLoadedAt = new Date();
    logger.info({ count: startMappings.length }, "portal-wf: start mappings loaded");
  } catch (err) {
    logger.error({ err }, "portal-wf: failed to load start mappings");
  }
}

/**
 * Test whether an event type matches a subscription pattern.
 * Supports:
 *   exact:  "customer.created"  matches only "customer.created"
 *   single: "customer.*"        matches "customer.created", "customer.updated" (not "customer.a.b")
 *   multi:  "customer.**"       matches any event starting with "customer."
 */
function matchesPattern(eventType: string, pattern: string): boolean {
  if (pattern === eventType) return true;
  if (pattern.endsWith(".**")) {
    const prefix = pattern.slice(0, -3);
    return eventType === prefix || eventType.startsWith(prefix + ".");
  }
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    const suffix = eventType.slice(prefix.length + 1);
    return eventType.startsWith(prefix + ".") && !suffix.includes(".");
  }
  return false;
}

function findMatchingWorkflowKeys(eventType: string): string[] {
  const keys: string[] = [];
  for (const m of startMappings) {
    if (m.isActive && matchesPattern(eventType, m.pattern)) {
      keys.push(m.workflowKey);
    }
  }
  return keys;
}

// ── Run creation ──────────────────────────────────────────────────────────────

export async function createRun(opts: {
  workflowKey: string;
  tenantContext: TenantContext;
  triggerEventId?: string;
  triggerEventType?: string;
  inputPayload?: Record<string, unknown>;
}): Promise<string> {
  const [row] = await db.insert(portalWfRunsTable).values({
    workflowKey: opts.workflowKey,
    tenantContext: opts.tenantContext as unknown as Record<string, unknown>,
    status: "pending",
    triggerEventId: opts.triggerEventId,
    triggerEventType: opts.triggerEventType,
    inputPayload: opts.inputPayload ?? {},
    mspId: opts.tenantContext.mspId,
    customerId: opts.tenantContext.customerId,
  }).returning({ runId: portalWfRunsTable.runId });

  const runId = row!.runId;
  logger.info({ runId, workflowKey: opts.workflowKey, ...opts.tenantContext }, "portal-wf: run created");
  return runId;
}

// ── Event handler (called by event bus listener) ──────────────────────────────

async function handleEventFired(event: DispatchedEvent & {
  mspId?: number | null;
  customerId?: number | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const matchedKeys = findMatchingWorkflowKeys(event.eventType);
  if (matchedKeys.length === 0) return;

  logger.info({ eventType: event.eventType, matchedKeys }, "portal-wf: event matched workflows");

  const tenantContext: TenantContext = {
    mspId: event.mspId ?? null,
    customerId: event.customerId ?? null,
  };

  for (const workflowKey of matchedKeys) {
    try {
      const runId = await createRun({
        workflowKey,
        tenantContext,
        triggerEventId: event.eventId,
        triggerEventType: event.eventType,
        inputPayload: event.payload ?? {},
      });
      // Enqueue execution immediately (non-blocking)
      void executeRunAsync(runId);
    } catch (err) {
      logger.error({ err, workflowKey, eventType: event.eventType }, "portal-wf: failed to create run from event");
    }
  }
}

// ── Topological sort ──────────────────────────────────────────────────────────

function topoSort(graph: PortalWfGraph): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    adjacency.get(edge.from)?.push(edge.to);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    order.push(nodeId);
    for (const next of (adjacency.get(nodeId) ?? [])) {
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  if (order.length !== graph.nodes.length) {
    throw new Error("portal-wf: graph contains a cycle");
  }
  return order;
}

// ── Idempotency helpers ───────────────────────────────────────────────────────

async function checkIdempotency(sideEffectKey: string): Promise<Record<string, unknown> | null> {
  const [row] = await db.select({ result: portalWfIdempotencyTable.result })
    .from(portalWfIdempotencyTable)
    .where(eq(portalWfIdempotencyTable.sideEffectKey, sideEffectKey))
    .limit(1);
  return row?.result ?? null;
}

async function markIdempotent(sideEffectKey: string, runId: string, nodeId: string, result: Record<string, unknown>): Promise<void> {
  await db.insert(portalWfIdempotencyTable)
    .values({ sideEffectKey, runId, nodeId, result })
    .onConflictDoNothing({ target: portalWfIdempotencyTable.sideEffectKey });
}

// ── Node execution (single attempt) ──────────────────────────────────────────

async function executeNodeAttempt(
  node: PortalWfNode,
  input: Record<string, unknown>,
  tenantContext: TenantContext,
  runId: string,
  attemptNumber: number,
): Promise<Record<string, unknown>> {
  const handler = nodeHandlers.get(node.type);
  if (!handler) {
    throw new Error(`No handler registered for node type: ${node.type}`);
  }

  const ctx: NodeExecutionContext = {
    runId,
    nodeId: node.id,
    nodeType: node.type,
    config: node.config,
    input,
    tenantContext,
    attemptNumber,
  };

  return handler(ctx);
}

// ── Per-node output record management ────────────────────────────────────────

async function upsertNodeOutput(opts: {
  runId: string;
  nodeId: string;
  nodeType: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  attemptCount?: number;
  inputPayload?: Record<string, unknown>;
  outputPayload?: Record<string, unknown>;
  errorMessage?: string;
  errorStack?: string;
  startedAt?: Date;
  completedAt?: Date;
}): Promise<void> {
  await db.insert(portalWfNodeOutputsTable).values({
    runId: opts.runId,
    nodeId: opts.nodeId,
    nodeType: opts.nodeType,
    status: opts.status,
    attemptCount: opts.attemptCount ?? 0,
    inputPayload: opts.inputPayload,
    outputPayload: opts.outputPayload,
    errorMessage: opts.errorMessage,
    errorStack: opts.errorStack,
    startedAt: opts.startedAt,
    completedAt: opts.completedAt,
  }).onConflictDoUpdate({
    target: [portalWfNodeOutputsTable.runId, portalWfNodeOutputsTable.nodeId],
    set: {
      status: opts.status,
      attemptCount: opts.attemptCount,
      inputPayload: opts.inputPayload,
      outputPayload: opts.outputPayload,
      errorMessage: opts.errorMessage,
      errorStack: opts.errorStack,
      startedAt: opts.startedAt,
      completedAt: opts.completedAt,
    },
  });
}

// ── Node execution with retry ─────────────────────────────────────────────────

async function executeNodeWithRetry(
  node: PortalWfNode,
  input: Record<string, unknown>,
  tenantContext: TenantContext,
  runId: string,
  retryPolicy: RetryPolicy,
): Promise<{ output: Record<string, unknown>; failed: false } | { failed: true; error: string; stack?: string }> {
  let lastError: Error | null = null;
  const startedAt = new Date();

  await upsertNodeOutput({
    runId,
    nodeId: node.id,
    nodeType: node.type,
    status: "running",
    attemptCount: 0,
    inputPayload: input,
    startedAt,
  });

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
    const sideEffectKey = `run:${runId}:node:${node.id}:attempt:${attempt}`;

    // Check idempotency cache first
    const cached = await checkIdempotency(sideEffectKey);
    if (cached) {
      logger.info({ runId, nodeId: node.id, attempt }, "portal-wf: node idempotent hit — reusing cached output");
      await upsertNodeOutput({
        runId,
        nodeId: node.id,
        nodeType: node.type,
        status: "completed",
        attemptCount: attempt,
        inputPayload: input,
        outputPayload: cached,
        completedAt: new Date(),
      });
      return { output: cached, failed: false };
    }

    try {
      logger.info({ runId, nodeId: node.id, nodeType: node.type, attempt }, "portal-wf: executing node");
      const output = await executeNodeAttempt(node, input, tenantContext, runId, attempt);

      // Persist idempotency marker
      await markIdempotent(sideEffectKey, runId, node.id, output);

      await upsertNodeOutput({
        runId,
        nodeId: node.id,
        nodeType: node.type,
        status: "completed",
        attemptCount: attempt,
        inputPayload: input,
        outputPayload: output,
        startedAt,
        completedAt: new Date(),
      });

      logger.info({ runId, nodeId: node.id, attempt }, "portal-wf: node completed");
      return { output, failed: false };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const backoffSec = Math.pow(retryPolicy.backoffMultiplier, attempt - 1) * retryPolicy.backoffBaseSeconds;

      logger.warn({ runId, nodeId: node.id, attempt, backoffSec, err: lastError.message }, "portal-wf: node failed — will retry");

      await upsertNodeOutput({
        runId,
        nodeId: node.id,
        nodeType: node.type,
        status: attempt < retryPolicy.maxAttempts ? "running" : "failed",
        attemptCount: attempt,
        inputPayload: input,
        errorMessage: lastError.message,
        errorStack: lastError.stack,
        startedAt,
      });

      if (attempt < retryPolicy.maxAttempts) {
        await sleep(backoffSec * 1000);
      }
    }
  }

  return {
    failed: true,
    error: lastError?.message ?? "Unknown error",
    stack: lastError?.stack,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Operator task creation ────────────────────────────────────────────────────

async function createOperatorTask(opts: {
  runId: string;
  workflowKey: string;
  nodeId?: string;
  tenantContext: TenantContext;
  title: string;
  description?: string;
}): Promise<void> {
  try {
    const deepLink = `/admin-panel/portal-wf/runs/${opts.runId}`;
    await db.insert(portalWfOperatorTasksTable).values({
      runId: opts.runId,
      workflowKey: opts.workflowKey,
      nodeId: opts.nodeId,
      severity: "error",
      title: opts.title,
      description: opts.description,
      deepLink,
      status: "open",
      mspId: opts.tenantContext.mspId,
      customerId: opts.tenantContext.customerId,
    });
    logger.info({ runId: opts.runId, workflowKey: opts.workflowKey }, "portal-wf: operator task created");
  } catch (err) {
    logger.error({ err, runId: opts.runId }, "portal-wf: failed to create operator task");
  }
}

// ── DLQ routing ───────────────────────────────────────────────────────────────

async function routeToDlq(opts: {
  runId: string;
  workflowKey: string;
  tenantContext: TenantContext;
  inputPayload: Record<string, unknown>;
  errorMessage: string;
  errorStack?: string;
  attemptCount: number;
  triggerEventId?: string;
}): Promise<void> {
  try {
    await db.insert(mspDlqStoreTable).values({
      sourceEventId: opts.triggerEventId as unknown as string | undefined,
      eventType: `portal_wf.run.failed:${opts.workflowKey}`,
      payload: {
        runId: opts.runId,
        workflowKey: opts.workflowKey,
        inputPayload: opts.inputPayload,
      },
      errorMessage: opts.errorMessage,
      errorStack: opts.errorStack,
      attemptCount: opts.attemptCount,
      mspId: opts.tenantContext.mspId ?? undefined,
      customerId: opts.tenantContext.customerId ?? undefined,
    });
    logger.warn({ runId: opts.runId, workflowKey: opts.workflowKey }, "portal-wf: run routed to DLQ");
  } catch (err) {
    logger.error({ err, runId: opts.runId }, "portal-wf: failed to route run to DLQ");
  }
}

// ── Run execution ─────────────────────────────────────────────────────────────

export async function executeRun(runId: string): Promise<void> {
  // Load run record
  const [run] = await db.select()
    .from(portalWfRunsTable)
    .where(eq(portalWfRunsTable.runId, runId))
    .limit(1);

  if (!run) {
    logger.error({ runId }, "portal-wf: run not found");
    return;
  }
  if (run.status === "completed" || run.status === "cancelled") {
    logger.info({ runId, status: run.status }, "portal-wf: run already in terminal state — skipping");
    return;
  }

  // Load workflow definition
  const [wf] = await db.select()
    .from(portalWfWorkflowsTable)
    .where(eq(portalWfWorkflowsTable.workflowKey, run.workflowKey))
    .limit(1);

  if (!wf || !wf.isActive) {
    logger.error({ runId, workflowKey: run.workflowKey }, "portal-wf: workflow not found or inactive");
    await db.update(portalWfRunsTable).set({
      status: "failed",
      errorMessage: `Workflow '${run.workflowKey}' not found or inactive`,
      completedAt: new Date(),
    }).where(eq(portalWfRunsTable.runId, runId));
    return;
  }

  const graph = wf.graph as unknown as PortalWfGraph;
  const retryPolicy = (wf.retryPolicy as unknown as RetryPolicy | null) ?? DEFAULT_RETRY_POLICY;
  const tenantContext: TenantContext = run.tenantContext as unknown as TenantContext;

  // Mark run as running
  await db.update(portalWfRunsTable).set({
    status: "running",
    startedAt: new Date(),
  }).where(eq(portalWfRunsTable.runId, runId));

  logger.info({ runId, workflowKey: run.workflowKey, nodes: graph.nodes.length }, "portal-wf: starting run execution");

  // Topological sort
  let executionOrder: string[];
  try {
    executionOrder = topoSort(graph);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.update(portalWfRunsTable).set({
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    }).where(eq(portalWfRunsTable.runId, runId));
    return;
  }

  // Accumulated outputs from all nodes (for input injection)
  const nodeOutputs: Record<string, Record<string, unknown>> = {};
  // Start node seeds the input payload
  const inputPayload = run.inputPayload as Record<string, unknown>;

  let runFailed = false;
  let failedNodeId: string | undefined;
  let terminalError: string | undefined;
  let terminalStack: string | undefined;

  for (const nodeId of executionOrder) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    // Merge: base input payload + all predecessor node outputs
    const mergedInput: Record<string, unknown> = {
      ...inputPayload,
      steps: nodeOutputs,
    };

    if (node.type === "start") {
      // Start node: just pass the trigger payload through
      nodeOutputs[nodeId] = inputPayload;
      await upsertNodeOutput({
        runId,
        nodeId,
        nodeType: "start",
        status: "completed",
        attemptCount: 1,
        inputPayload,
        outputPayload: inputPayload,
        startedAt: new Date(),
        completedAt: new Date(),
      });
      continue;
    }

    const result = await executeNodeWithRetry(node, mergedInput, tenantContext, runId, retryPolicy);

    if (result.failed) {
      runFailed = true;
      failedNodeId = nodeId;
      terminalError = result.error;
      terminalStack = result.stack;
      break;
    } else {
      nodeOutputs[nodeId] = result.output;
    }
  }

  if (runFailed) {
    const errorMessage = terminalError ?? "Node execution failed";

    // Update run status
    await db.update(portalWfRunsTable).set({
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    }).where(eq(portalWfRunsTable.runId, runId));

    // Create operator task
    await createOperatorTask({
      runId,
      workflowKey: run.workflowKey,
      nodeId: failedNodeId,
      tenantContext,
      title: `Workflow '${run.workflowKey}' failed at node '${failedNodeId}'`,
      description: errorMessage,
    });

    // Route to DLQ
    await routeToDlq({
      runId,
      workflowKey: run.workflowKey,
      tenantContext,
      inputPayload,
      errorMessage,
      errorStack: terminalStack,
      attemptCount: retryPolicy.maxAttempts,
      triggerEventId: run.triggerEventId ?? undefined,
    });

    logger.error({ runId, workflowKey: run.workflowKey, failedNodeId, errorMessage }, "portal-wf: run failed");

    // Emit failure event (best-effort)
    void dispatchEvent({
      eventType: "portal_wf.run.failed",
      source: "portal-workflow-engine",
      actor: systemActor(),
      mspId: tenantContext.mspId,
      customerId: tenantContext.customerId,
      correlationId: randomUUID(),
      causationId: run.triggerEventId ?? randomUUID(),
      payload: { runId, workflowKey: run.workflowKey, failedNodeId, errorMessage },
    });
  } else {
    // Collect final output (last non-start node's output)
    const lastNodeId = executionOrder[executionOrder.length - 1];
    const finalOutput = lastNodeId ? (nodeOutputs[lastNodeId] ?? {}) : {};

    await db.update(portalWfRunsTable).set({
      status: "completed",
      output: finalOutput,
      completedAt: new Date(),
    }).where(eq(portalWfRunsTable.runId, runId));

    logger.info({ runId, workflowKey: run.workflowKey }, "portal-wf: run completed");

    // Emit success event (best-effort)
    void dispatchEvent({
      eventType: "portal_wf.run.completed",
      source: "portal-workflow-engine",
      actor: systemActor(),
      mspId: tenantContext.mspId,
      customerId: tenantContext.customerId,
      correlationId: randomUUID(),
      causationId: run.triggerEventId ?? randomUUID(),
      payload: { runId, workflowKey: run.workflowKey },
    });
  }
}

/** Execute a run in the background — fire-and-forget with error logging. */
function executeRunAsync(runId: string): void {
  executeRun(runId).catch((err) => {
    logger.error({ err, runId }, "portal-wf: unhandled error in executeRun");
  });
}

// ── Manual retry / replay ─────────────────────────────────────────────────────

/**
 * Retry a failed run from the beginning.
 * Creates a fresh run record (retaining original tenant context + input payload)
 * and executes it immediately.
 */
export async function retryRun(runId: string): Promise<string> {
  const [run] = await db.select()
    .from(portalWfRunsTable)
    .where(eq(portalWfRunsTable.runId, runId))
    .limit(1);

  if (!run) throw new Error(`Run '${runId}' not found`);
  if (run.status !== "failed" && run.status !== "cancelled") {
    throw new Error(`Run '${runId}' is not in a retryable state (current: ${run.status})`);
  }

  const newRunId = await createRun({
    workflowKey: run.workflowKey,
    tenantContext: run.tenantContext as unknown as TenantContext,
    triggerEventId: run.triggerEventId ?? undefined,
    triggerEventType: run.triggerEventType ?? undefined,
    inputPayload: run.inputPayload as Record<string, unknown>,
  });

  void executeRunAsync(newRunId);
  logger.info({ originalRunId: runId, newRunId }, "portal-wf: run retry initiated");
  return newRunId;
}

/**
 * Replay a DLQ entry by creating a fresh run.
 */
export async function replayDlqItem(dlqId: string): Promise<string> {
  const { mspDlqStoreTable: dlqTable } = await import("@workspace/db");
  const [dlq] = await db.select()
    .from(dlqTable)
    .where(eq(dlqTable.dlqId, dlqId))
    .limit(1);

  if (!dlq) throw new Error(`DLQ item '${dlqId}' not found`);
  if (dlq.resolvedAt) throw new Error(`DLQ item '${dlqId}' is already resolved`);

  const payload = dlq.payload as { runId?: string; workflowKey?: string; inputPayload?: Record<string, unknown> };
  if (!payload.workflowKey) throw new Error("DLQ item has no workflowKey in payload");

  const tenantContext: TenantContext = {
    mspId: dlq.mspId ?? null,
    customerId: dlq.customerId ?? null,
  };

  const newRunId = await createRun({
    workflowKey: payload.workflowKey,
    tenantContext,
    inputPayload: payload.inputPayload ?? {},
  });

  // Mark DLQ item as resolved
  await db.update(dlqTable).set({
    resolvedAt: new Date(),
    resolution: "replayed",
  }).where(eq(dlqTable.dlqId, dlqId));

  void executeRunAsync(newRunId);
  logger.info({ dlqId, newRunId, workflowKey: payload.workflowKey }, "portal-wf: DLQ item replayed");
  return newRunId;
}

// ── Engine initialization ─────────────────────────────────────────────────────

let engineInitialized = false;

/**
 * Initialize the portal workflow engine.
 * - Loads start mappings from DB.
 * - Registers event bus listener.
 * - Registers built-in node handlers.
 * Call once at server startup.
 */
export async function initPortalWorkflowEngine(): Promise<void> {
  if (engineInitialized) return;
  engineInitialized = true;

  // Register built-in node handlers (imported lazily to avoid circular deps)
  const { registerBuiltinHandlers } = await import("./portal-workflow-nodes");
  registerBuiltinHandlers();

  // Load start mappings
  await reloadStartMappings();

  // Subscribe to event bus
  addEventListener((event) => {
    void handleEventFired(event);
  });

  logger.info({}, "portal-wf: engine initialized");
}

// ── Workflow definition CRUD helpers ──────────────────────────────────────────
// (Used by API routes — keeps DB access centralized.)

export async function listWorkflows(opts: { isActive?: boolean } = {}): Promise<typeof portalWfWorkflowsTable.$inferSelect[]> {
  const conditions = [];
  if (opts.isActive !== undefined) conditions.push(eq(portalWfWorkflowsTable.isActive, opts.isActive));
  return db.select().from(portalWfWorkflowsTable).where(conditions.length ? and(...conditions) : undefined).orderBy(portalWfWorkflowsTable.workflowKey);
}

export async function getWorkflow(workflowKey: string): Promise<typeof portalWfWorkflowsTable.$inferSelect | null> {
  const [row] = await db.select().from(portalWfWorkflowsTable).where(eq(portalWfWorkflowsTable.workflowKey, workflowKey)).limit(1);
  return row ?? null;
}

export async function upsertWorkflow(data: {
  workflowKey: string;
  label: string;
  description?: string;
  graph: PortalWfGraph;
  retryPolicy?: RetryPolicy;
  isActive?: boolean;
}): Promise<typeof portalWfWorkflowsTable.$inferSelect> {
  const [row] = await db.insert(portalWfWorkflowsTable).values({
    workflowKey: data.workflowKey,
    label: data.label,
    description: data.description,
    graph: data.graph as unknown as Record<string, unknown>,
    retryPolicy: (data.retryPolicy ?? DEFAULT_RETRY_POLICY) as unknown as Record<string, unknown>,
    isActive: data.isActive ?? true,
  }).onConflictDoUpdate({
    target: portalWfWorkflowsTable.workflowKey,
    set: {
      label: data.label,
      description: data.description,
      graph: data.graph as unknown as Record<string, unknown>,
      retryPolicy: (data.retryPolicy ?? DEFAULT_RETRY_POLICY) as unknown as Record<string, unknown>,
      isActive: data.isActive ?? true,
      updatedAt: new Date(),
    },
  }).returning();
  return row!;
}

export async function listStartMappings(): Promise<typeof portalWfStartMappingsTable.$inferSelect[]> {
  return db.select().from(portalWfStartMappingsTable).orderBy(portalWfStartMappingsTable.eventPattern);
}

export async function upsertStartMapping(data: {
  eventPattern: string;
  workflowKey: string;
  isActive?: boolean;
}): Promise<void> {
  await db.insert(portalWfStartMappingsTable).values({
    eventPattern: data.eventPattern,
    workflowKey: data.workflowKey,
    isActive: data.isActive ?? true,
  }).onConflictDoUpdate({
    target: [portalWfStartMappingsTable.eventPattern, portalWfStartMappingsTable.workflowKey],
    set: { isActive: data.isActive ?? true },
  });
  await reloadStartMappings();
}

export async function deleteStartMapping(eventPattern: string, workflowKey: string): Promise<void> {
  await db.delete(portalWfStartMappingsTable)
    .where(and(
      eq(portalWfStartMappingsTable.eventPattern, eventPattern),
      eq(portalWfStartMappingsTable.workflowKey, workflowKey),
    ));
  await reloadStartMappings();
}

// Re-export for use in API routes
export { startMappings, mappingsLoadedAt };
