/**
 * workflow-executor.ts
 *
 * In-process workflow executor. Walks a WfGraph in topological order,
 * evaluates conditions, handles delays, records per-node logs/outputs,
 * and writes run status transitions.
 *
 * Called fire-and-forget from the trigger handlers.
 */

import { db, pool } from "@workspace/db";
import {
  wfRunsTable,
  wfVersionsTable,
  wfDefinitionsTable,
  wfRunNodeLogsTable,
  wfRunNodeOutputsTable,
  wfTriggersTable,
  type WfGraph,
  type WfNode,
} from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { logger } from "./logger";

// ── Topological sort ──────────────────────────────────────────────────────────

function topoSort(graph: WfGraph): WfNode[] {
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    adjList.set(node.id, []);
  }

  for (const edge of graph.edges) {
    adjList.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: WfNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);
    for (const next of adjList.get(id) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  return sorted;
}

// ── Safe condition evaluation ─────────────────────────────────────────────────
// Does NOT use eval/new Function. Supports:
//   path op literal   e.g.  status == 'active'  count > 5  name contains 'foo'
//   boolean path      e.g.  isActive
//   logical           e.g.  a == 1 && b == 2   x > 0 || y > 0

function evalCondition(expression: string, payload: Record<string, unknown>): boolean {
  function resolvePath(p: string): unknown {
    const parts = p.trim().split(".");
    let cur: unknown = payload;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }

  function parseValue(s: string): unknown {
    const t = s.trim();
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    if (t === "undefined") return undefined;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (/^["'].*["']$/.test(t)) return t.slice(1, -1);
    return resolvePath(t);
  }

  function evalClause(clause: string): boolean {
    const c = clause.trim();
    for (const op of [">=", "<=", "!=", "==", ">", "<", " contains "]) {
      const idx = c.indexOf(op);
      if (idx !== -1) {
        const lhs = resolvePath(c.slice(0, idx).trim());
        const rhs = parseValue(c.slice(idx + op.length));
        switch (op.trim()) {
          case "==": return lhs == rhs; // eslint-disable-line eqeqeq
          case "!=": return lhs != rhs; // eslint-disable-line eqeqeq
          case ">":  return Number(lhs) > Number(rhs);
          case "<":  return Number(lhs) < Number(rhs);
          case ">=": return Number(lhs) >= Number(rhs);
          case "<=": return Number(lhs) <= Number(rhs);
          case "contains": return String(lhs).includes(String(rhs));
        }
      }
    }
    return Boolean(resolvePath(c));
  }

  try {
    const orParts = expression.split(" || ");
    for (const orPart of orParts) {
      const andParts = orPart.split(" && ");
      if (andParts.every(p => evalClause(p))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Node execution ────────────────────────────────────────────────────────────

async function executeNode(
  node: WfNode,
  payload: Record<string, unknown>,
  runId: number,
): Promise<{
  output: Record<string, unknown>;
  nextPayload: Record<string, unknown>;
  cancelRun: boolean;
  nodeError: boolean;
  conditionResult?: boolean;
}> {
  const startMs = Date.now();
  let output: Record<string, unknown> = {};
  let cancelRun = false;
  let nodeError = false;
  let conditionResult: boolean | undefined;

  try {
    switch (node.type) {
      case "start":
        output = { started: true };
        break;

      case "end":
        output = { finished: true, label: node.data.label ?? "End" };
        break;

      case "action": {
        const actionType = node.data.actionType as string | undefined;
        if (actionType === "cancel_workflow") {
          cancelRun = true;
          output = { cancelled: true };
        } else if (actionType === "http_request") {
          const url = node.data.params?.url as string | undefined;
          if (url) {
            const resp = await fetch(url, {
              method: (node.data.params?.method as string | undefined) ?? "GET",
              headers: (node.data.params?.headers as Record<string, string> | undefined),
              body: node.data.params?.body ? JSON.stringify(node.data.params.body) : undefined,
            });
            output = { status: resp.status, ok: resp.ok };
            if (!resp.ok) {
              nodeError = true;
              output.errorDetail = `HTTP ${resp.status}`;
            }
          } else {
            output = { skipped: true, reason: "no url configured" };
          }
        } else {
          output = { actionType, note: "action executed (no-op in this environment)" };
        }
        break;
      }

      case "condition": {
        const expression = node.data.expression as string | undefined;
        const result = expression ? evalCondition(expression, payload) : false;
        conditionResult = result;
        output = { result, expression };
        // Check for cancel_on_false flag
        if (!result && node.data.cancelOnFalse === true) {
          cancelRun = true;
          output.cancelledReason = "condition false + cancelOnFalse flag";
        }
        break;
      }

      case "delay": {
        const mode = (node.data.mode ?? "fixed") as string;
        if (mode === "fixed") {
          const durationMs = ((node.data.duration as number | undefined) ?? 0) * 1000;
          if (durationMs > 0 && durationMs <= 300_000) {
            await new Promise(r => setTimeout(r, durationMs));
          }
          output = { mode, durationMs };
        } else if (mode === "until_timestamp") {
          const ts = node.data.timestamp as string | number | undefined;
          if (ts) {
            const targetMs = typeof ts === "number" ? ts : new Date(ts).getTime();
            const waitMs = Math.max(0, Math.min(targetMs - Date.now(), 300_000));
            if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
          }
          output = { mode, waitedUntil: ts ?? null };
        } else if (mode === "until_condition") {
          const expression = node.data.expression as string | undefined;
          const intervalMs = Math.max(1000, ((node.data.interval as number | undefined) ?? 30) * 1000);
          const timeoutMs = Math.min(300_000, ((node.data.timeout as number | undefined) ?? 300) * 1000);
          const deadline = Date.now() + timeoutMs;
          let met = false;
          while (Date.now() < deadline) {
            if (expression && evalCondition(expression, payload)) { met = true; break; }
            await new Promise(r => setTimeout(r, Math.min(intervalMs, deadline - Date.now())));
          }
          output = { mode, conditionMet: met };
        } else {
          output = { mode, note: "unknown delay mode" };
        }
        break;
      }

      case "error":
        output = { caught: true, label: node.data.label ?? "Error handler" };
        break;

      default:
        output = { note: "unknown node type", nodeType: node.type };
    }
  } catch (err) {
    nodeError = true;
    output = { error: String(err), nodeType: node.type };
  }

  const durationMs = Date.now() - startMs;
  const status = nodeError ? "error" : "ok";

  await db.insert(wfRunNodeOutputsTable).values({
    runId,
    nodeId: node.id,
    input: payload,
    output,
    durationMs,
    status,
    errorMessage: nodeError ? (output.error as string ?? "node error") : null,
  }).catch(() => { /* non-fatal */ });

  await db.insert(wfRunNodeLogsTable).values({
    runId,
    nodeId: node.id,
    level: nodeError ? "error" : "info",
    message: nodeError
      ? `Node ${node.type} (${node.id}) failed: ${output.error ?? "error"}`
      : `Node ${node.type} (${node.id}) completed in ${durationMs}ms`,
  }).catch(() => { /* non-fatal */ });

  const nextPayload = {
    ...payload,
    nodes: { ...(payload.nodes as Record<string, unknown> ?? {}), [node.id]: output },
  };

  return { output, nextPayload, cancelRun, nodeError, conditionResult };
}

// ── Concurrency check ─────────────────────────────────────────────────────────

async function countRunningRuns(definitionId: number): Promise<number> {
  const rows = await db
    .select({ cnt: count() })
    .from(wfRunsTable)
    .where(and(
      eq(wfRunsTable.definitionId, definitionId),
      eq(wfRunsTable.status, "running"),
    ));
  return Number(rows[0]?.cnt ?? 0);
}

// ── Main executor ─────────────────────────────────────────────────────────────

export async function executeWorkflowRun(runId: number): Promise<void> {
  const runRows = await db.select().from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
  const run = runRows[0];
  if (!run) {
    logger.warn({ runId }, "wf-executor: run not found");
    return;
  }

  const defRows = await db.select().from(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, run.definitionId)).limit(1);
  const def = defRows[0];
  if (!def) {
    logger.warn({ runId }, "wf-executor: definition not found");
    return;
  }

  const runningCount = await countRunningRuns(run.definitionId);
  if (runningCount >= def.concurrencyLimit) {
    await db.update(wfRunsTable)
      .set({ status: "failed", errorMessage: `Concurrency limit (${def.concurrencyLimit}) exceeded`, finishedAt: new Date() })
      .where(eq(wfRunsTable.id, runId));
    logger.warn({ runId, runningCount, limit: def.concurrencyLimit }, "wf-executor: concurrency limit exceeded");
    return;
  }

  const versionRows = await db.select().from(wfVersionsTable).where(eq(wfVersionsTable.id, run.versionId)).limit(1);
  const version = versionRows[0];
  if (!version) {
    await db.update(wfRunsTable)
      .set({ status: "failed", errorMessage: "Version not found", finishedAt: new Date() })
      .where(eq(wfRunsTable.id, runId));
    return;
  }

  await db.update(wfRunsTable)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(wfRunsTable.id, runId));

  const graph: WfGraph = (version.graph as WfGraph) ?? { nodes: [], edges: [] };
  const sorted = topoSort(graph);
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const branchPath: string[] = [];
  const skippedNodes = new Set<string>();
  let payload: Record<string, unknown> = { ...(run.payload as Record<string, unknown> ?? {}) };

  try {
    for (const node of sorted) {
      // Check for external cancellation
      const freshRun = await db.select({ status: wfRunsTable.status }).from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
      if (freshRun[0]?.status === "cancelled") {
        logger.info({ runId, nodeId: node.id }, "wf-executor: run cancelled mid-execution");
        return;
      }

      if (skippedNodes.has(node.id)) {
        await db.insert(wfRunNodeOutputsTable).values({
          runId, nodeId: node.id, input: payload, output: { skipped: true }, status: "skipped",
        }).catch(() => { });
        continue;
      }

      branchPath.push(node.id);

      const { output, nextPayload, cancelRun, nodeError, conditionResult } = await executeNode(
        node, payload, runId,
      );
      payload = nextPayload;

      if (cancelRun) {
        await db.update(wfRunsTable)
          .set({ status: "cancelled", finishedAt: new Date(), branchPath: branchPath as unknown as string[] })
          .where(eq(wfRunsTable.id, runId));
        return;
      }

      // On node error: look for an outgoing "error" branch or error node
      if (nodeError) {
        const errorEdge = graph.edges.find(e =>
          e.source === node.id && (e.sourceHandle === "error" || e.sourceHandle === "onError"),
        );
        if (errorEdge) {
          // Route only through the error branch — skip all other successors
          for (const edge of graph.edges) {
            if (edge.source === node.id && edge.target !== errorEdge.target) {
              skippedNodes.add(edge.target);
              graph.nodes
                .filter(n => isDescendant(n.id, edge.target, graph))
                .forEach(n => skippedNodes.add(n.id));
            }
          }
          await db.insert(wfRunNodeLogsTable).values({
            runId, nodeId: node.id, level: "warn",
            message: `Node error — routing to error branch (${errorEdge.target})`,
          }).catch(() => { });
        } else {
          // No error handler — fail the run
          await db.update(wfRunsTable)
            .set({
              status: "failed",
              finishedAt: new Date(),
              errorMessage: (output.error as string) ?? `Node ${node.id} failed`,
              branchPath: branchPath as unknown as string[],
            })
            .where(eq(wfRunsTable.id, runId));
          logger.warn({ runId, nodeId: node.id }, "wf-executor: node error — no error handler, run failed");
          return;
        }
      }

      // Condition node: route true/false/cancel branches
      if (node.type === "condition" && conditionResult !== undefined) {
        const result = conditionResult;
        const outEdges = graph.edges.filter(e => e.source === node.id);

        // Identify special handles
        const trueEdge   = outEdges.find(e => e.sourceHandle === "true"   || e.sourceHandle == null);
        const falseEdge  = outEdges.find(e => e.sourceHandle === "false");
        const cancelEdge = outEdges.find(e => e.sourceHandle === "cancel");

        // If the selected branch leads to the cancel edge target, cancel the run
        const takenEdge = result ? trueEdge : (falseEdge ?? cancelEdge);
        if (takenEdge && cancelEdge && takenEdge.target === cancelEdge.target) {
          await db.update(wfRunsTable)
            .set({ status: "cancelled", finishedAt: new Date(), branchPath: branchPath as unknown as string[] })
            .where(eq(wfRunsTable.id, runId));
          return;
        }

        // Skip the branch NOT taken
        const skipEdge = result ? falseEdge : trueEdge;
        if (skipEdge) {
          skippedNodes.add(skipEdge.target);
          graph.nodes
            .filter(n => isDescendant(n.id, skipEdge.target, graph))
            .forEach(n => skippedNodes.add(n.id));
        }
      }

      await db.update(wfRunsTable)
        .set({ branchPath: branchPath as unknown as string[] })
        .where(eq(wfRunsTable.id, runId));
    }

    // Mark as completed — suppress unused variable warning
    void nodeMap;
    await db.update(wfRunsTable)
      .set({ status: "completed", finishedAt: new Date(), branchPath: branchPath as unknown as string[] })
      .where(eq(wfRunsTable.id, runId));

    logger.info({ runId, stepCount: sorted.length }, "wf-executor: run completed");
  } catch (err) {
    const errMsg = String(err);
    await db.update(wfRunsTable)
      .set({ status: "failed", finishedAt: new Date(), errorMessage: errMsg, branchPath: branchPath as unknown as string[] })
      .where(eq(wfRunsTable.id, runId));

    await db.insert(wfRunNodeLogsTable).values({
      runId,
      nodeId: "__executor__",
      level: "error",
      message: `Executor error: ${errMsg}`,
    }).catch(() => { });

    logger.warn({ runId, err }, "wf-executor: run failed");
  }
}

function isDescendant(nodeId: string, fromId: string, graph: WfGraph): boolean {
  const visited = new Set<string>();
  const queue = [fromId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === nodeId) return true;
    if (visited.has(curr)) continue;
    visited.add(curr);
    for (const edge of graph.edges) {
      if (edge.source === curr) queue.push(edge.target);
    }
  }
  return false;
}

// ── Scheduled trigger scanner ─────────────────────────────────────────────────

export async function triggerScheduledWorkflows(): Promise<void> {
  const rows = await pool.query<{
    id: number;
    definition_id: number;
    config: Record<string, unknown>;
  }>(`
    SELECT id, definition_id, config
    FROM wf_triggers
    WHERE type = 'schedule'
      AND enabled = true
      AND next_run_at IS NOT NULL
      AND next_run_at <= NOW()
  `);

  for (const trigger of rows.rows) {
    const cronExpr = trigger.config.cron as string | undefined;
    const nextRun = cronExpr ? computeNextCronRun(cronExpr) : null;

    // Atomic claim: update next_run_at only if it's still due (prevents double-fire)
    const claimed = await pool.query(
      `UPDATE wf_triggers SET next_run_at = $1 WHERE id = $2 AND next_run_at <= NOW() RETURNING id`,
      [nextRun, trigger.id],
    );
    if (!claimed.rowCount || claimed.rowCount === 0) continue;

    const fanOutMode = trigger.config.fan_out_mode as string | undefined;
    const fanOutQuery = trigger.config.fan_out_query as string | undefined;

    if (fanOutMode === "per_record" && fanOutQuery) {
      try {
        const records = await pool.query(fanOutQuery);
        for (const row of records.rows) {
          await fireWorkflowForDefinition(
            trigger.definition_id, "schedule", `trigger:${trigger.id}`,
            row as Record<string, unknown>,
          );
        }
        logger.info({ triggerId: trigger.id, rowCount: records.rowCount }, "wf-engine: per_record fan-out fired");
      } catch (err) {
        logger.warn({ err, triggerId: trigger.id }, "wf-engine: fan_out_query failed (non-fatal)");
        await fireWorkflowForDefinition(
          trigger.definition_id, "schedule", `trigger:${trigger.id}`,
          trigger.config.payload as Record<string, unknown> ?? {},
        );
      }
    } else {
      await fireWorkflowForDefinition(
        trigger.definition_id, "schedule", `trigger:${trigger.id}`,
        trigger.config.payload as Record<string, unknown> ?? {},
      );
    }
  }
}

// ── Event emitter helper ──────────────────────────────────────────────────────
// Call this from anywhere in the API to fire event-triggered workflows.

export async function emitWorkflowEvent(
  eventType: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    const triggers = await db
      .select()
      .from(wfTriggersTable)
      .where(and(
        eq(wfTriggersTable.type, "event"),
        eq(wfTriggersTable.enabled, true),
      ));

    for (const trigger of triggers) {
      const cfg = trigger.config as Record<string, unknown>;
      const filterEventType = cfg.eventType as string | undefined;
      if (!filterEventType || filterEventType === eventType) {
        await fireWorkflowForDefinition(
          trigger.definitionId, "event", `event:${eventType}`,
          { ...payload, _eventType: eventType },
        );
      }
    }
  } catch (err) {
    logger.warn({ err, eventType }, "wf-engine: emitWorkflowEvent failed (non-fatal)");
  }
}

export async function fireWorkflowForDefinition(
  definitionId: number,
  triggerType: "manual" | "schedule" | "webhook" | "event",
  triggerRef: string,
  payload: Record<string, unknown> = {},
): Promise<number | null> {
  try {
    const versionRows = await db
      .select()
      .from(wfVersionsTable)
      .where(and(
        eq(wfVersionsTable.definitionId, definitionId),
        eq(wfVersionsTable.status, "published"),
      ))
      .limit(1);

    const version = versionRows[0];
    if (!version) {
      logger.warn({ definitionId }, "wf-executor: no published version found");
      return null;
    }

    const inserted = await db.insert(wfRunsTable).values({
      versionId: version.id,
      definitionId,
      triggerType,
      triggerRef,
      payload,
      status: "pending",
    }).returning({ id: wfRunsTable.id });

    const runId = inserted[0]?.id;
    if (!runId) return null;

    setImmediate(() => {
      executeWorkflowRun(runId).catch(err => {
        logger.warn({ err, runId }, "wf-executor: detached run failed (non-fatal)");
      });
    });

    return runId;
  } catch (err) {
    logger.warn({ err, definitionId }, "wf-executor: fireWorkflowForDefinition failed (non-fatal)");
    return null;
  }
}

// ── Cron "next run" computation ───────────────────────────────────────────────
// Supports standard 5-field cron (minute hour dom month dow) with * wildcards.
// Steps through time minute-by-minute until all fields match (max 1 year ahead).

export function computeNextCronRun(cron: string): Date | null {
  try {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [minStr, hourStr, domStr, monthStr, dowStr] = parts;

    function matches(value: number, spec: string): boolean {
      if (spec === "*") return true;
      if (spec.includes(",")) return spec.split(",").some(s => matches(value, s.trim()));
      if (spec.includes("-")) {
        const [lo, hi] = spec.split("-").map(Number);
        return value >= lo && value <= hi;
      }
      if (spec.includes("/")) {
        const [base, step] = spec.split("/");
        const stepN = parseInt(step, 10);
        const start = base === "*" ? 0 : parseInt(base, 10);
        return (value - start) % stepN === 0;
      }
      return value === parseInt(spec, 10);
    }

    const next = new Date();
    next.setSeconds(0, 0);
    next.setTime(next.getTime() + 60_000); // advance at least 1 minute

    for (let i = 0; i < 525_600; i++) {
      const m     = next.getMinutes();
      const h     = next.getHours();
      const dom   = next.getDate();
      const month = next.getMonth() + 1;
      const dow   = next.getDay();

      if (
        matches(m, minStr) &&
        matches(h, hourStr) &&
        matches(dom, domStr) &&
        matches(month, monthStr) &&
        matches(dow, dowStr)
      ) return new Date(next);

      next.setTime(next.getTime() + 60_000);
    }

    return null;
  } catch {
    return null;
  }
}
