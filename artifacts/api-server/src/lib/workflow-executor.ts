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
  type WfGraph,
  type WfNode,
} from "@workspace/db";
import { eq, and, sql, count } from "drizzle-orm";
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

// ── Condition evaluation ──────────────────────────────────────────────────────

function evalCondition(expression: string, payload: Record<string, unknown>): boolean {
  try {
    const fn = new Function(...Object.keys(payload), `"use strict"; return !!(${expression});`);
    return fn(...Object.values(payload));
  } catch {
    return false;
  }
}

// ── Node execution ────────────────────────────────────────────────────────────

async function executeNode(
  node: WfNode,
  payload: Record<string, unknown>,
  runId: number,
  branchPath: string[],
  skippedNodes: Set<string>,
): Promise<{ output: Record<string, unknown>; nextPayload: Record<string, unknown>; cancelRun: boolean; skipTargets: Set<string> }> {
  const startMs = Date.now();
  let output: Record<string, unknown> = {};
  let cancelRun = false;
  const skipTargets = new Set<string>();

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
            try {
              const resp = await fetch(url, {
                method: (node.data.params?.method as string | undefined) ?? "GET",
                headers: (node.data.params?.headers as Record<string, string> | undefined),
                body: node.data.params?.body ? JSON.stringify(node.data.params.body) : undefined,
              });
              output = { status: resp.status, ok: resp.ok };
            } catch (fetchErr) {
              output = { error: String(fetchErr) };
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
        output = { result };
        break;
      }

      case "delay": {
        const mode = node.data.mode ?? "fixed";
        if (mode === "fixed") {
          const durationMs = ((node.data.duration as number | undefined) ?? 0) * 1000;
          if (durationMs > 0 && durationMs <= 300_000) {
            await new Promise(r => setTimeout(r, durationMs));
          }
        } else if (mode === "until_condition") {
          const expression = node.data.expression as string | undefined;
          const intervalMs = ((node.data.interval as number | undefined) ?? 30) * 1000;
          const timeoutMs = ((node.data.timeout as number | undefined) ?? 300) * 1000;
          const deadline = Date.now() + timeoutMs;
          let met = false;
          while (Date.now() < deadline) {
            if (expression && evalCondition(expression, payload)) { met = true; break; }
            await new Promise(r => setTimeout(r, Math.min(intervalMs, deadline - Date.now())));
          }
          output = { conditionMet: met };
        }
        output = { ...output, mode };
        break;
      }

      case "error":
        output = { caught: true, label: node.data.label ?? "Error handler" };
        break;

      default:
        output = { note: "unknown node type" };
    }
  } catch (err) {
    output = { error: String(err) };
  }

  const durationMs = Date.now() - startMs;

  await db.insert(wfRunNodeOutputsTable).values({
    runId,
    nodeId: node.id,
    input: payload,
    output,
    durationMs,
    status: "ok",
  }).catch(() => { /* non-fatal */ });

  await db.insert(wfRunNodeLogsTable).values({
    runId,
    nodeId: node.id,
    level: "info",
    message: `Node ${node.type} (${node.id}) completed in ${durationMs}ms`,
  }).catch(() => { /* non-fatal */ });

  const nextPayload = { ...payload, [`nodes`]: { ...(payload.nodes as Record<string, unknown> ?? {}), [node.id]: output } };

  return { output, nextPayload, cancelRun, skipTargets };
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
  const branchPath: string[] = [];
  const skippedNodes = new Set<string>();
  let payload: Record<string, unknown> = { ...(run.payload as Record<string, unknown> ?? {}) };

  try {
    for (const node of sorted) {
      const freshRun = await db.select({ status: wfRunsTable.status }).from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
      if (freshRun[0]?.status === "cancelled") {
        logger.info({ runId, nodeId: node.id }, "wf-executor: run cancelled mid-execution");
        return;
      }

      if (skippedNodes.has(node.id)) {
        await db.insert(wfRunNodeOutputsTable).values({
          runId, nodeId: node.id, input: payload, output: {}, status: "skipped",
        }).catch(() => { });
        continue;
      }

      branchPath.push(node.id);

      const { output, nextPayload, cancelRun } = await executeNode(
        node, payload, runId, branchPath, skippedNodes,
      );
      payload = nextPayload;

      if (cancelRun) {
        await db.update(wfRunsTable)
          .set({ status: "cancelled", finishedAt: new Date(), branchPath: branchPath as unknown as string[] })
          .where(eq(wfRunsTable.id, runId));
        return;
      }

      if (node.type === "condition") {
        const result = output.result as boolean;
        const trueEdge = graph.edges.find(e => e.source === node.id && (e.sourceHandle === "true" || e.sourceHandle === null || e.sourceHandle === undefined));
        const falseEdge = graph.edges.find(e => e.source === node.id && e.sourceHandle === "false");
        if (trueEdge && falseEdge) {
          const losingTarget = result ? falseEdge.target : trueEdge.target;
          skippedNodes.add(losingTarget);
          graph.nodes
            .filter(n => isDescendant(n.id, losingTarget, graph))
            .forEach(n => skippedNodes.add(n.id));
        }
      }

      await db.update(wfRunsTable)
        .set({ branchPath: branchPath as unknown as string[] })
        .where(eq(wfRunsTable.id, runId));
    }

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

// ── Schedule trigger helper ───────────────────────────────────────────────────

export async function triggerScheduledWorkflows(): Promise<void> {
  try {
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

      const claimed = await pool.query(
        `UPDATE wf_triggers SET next_run_at = $1 WHERE id = $2 AND next_run_at <= NOW() RETURNING id`,
        [nextRun, trigger.id],
      );

      if (claimed.rowCount === 0) continue;

      await fireWorkflowForDefinition(trigger.definition_id, "schedule", `trigger:${trigger.id}`, trigger.config.payload as Record<string, unknown> ?? {});
    }
  } catch (err) {
    logger.warn({ err }, "wf-executor: scheduled trigger scan failed (non-fatal)");
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

// ── Simple cron "next run" computation ───────────────────────────────────────
// Supports "0 9 * * *" style 5-field cron (minute hour dom month dow).
// Returns next Date rounded to the nearest minute after now.

export function computeNextCronRun(cron: string): Date | null {
  try {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [minStr, hourStr] = parts;
    const minute = minStr === "*" ? 0 : parseInt(minStr, 10);
    const hour = hourStr === "*" ? 0 : parseInt(hourStr, 10);
    const next = new Date();
    next.setSeconds(0, 0);
    next.setMinutes(isNaN(minute) ? 0 : minute);
    next.setHours(isNaN(hour) ? 0 : hour);
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    return next;
  } catch {
    return null;
  }
}
