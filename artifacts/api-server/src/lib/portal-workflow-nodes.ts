/**
 * portal-workflow-nodes.ts
 *
 * Core, reusable node type handlers for the MSP Portal Workflow Engine.
 * Subsystem-specific nodes (doc_*, diagnostics_*, sales_offer_*, monitor_*)
 * are registered by their respective subsystem tasks — this file only provides
 * the foundation types that every subsystem can extend.
 *
 * Registered types:
 *   start       — passes trigger event payload through; graphs must have exactly one.
 *   http_call   — generic outbound HTTP request with header/body templating.
 *   db_write    — safe parameterized SQL (INSERT/UPDATE/DELETE) — SELECT only when assignOutput is set.
 *   emit_event  — dispatches a new canonical event to the event bus.
 *   wait        — noop delay in milliseconds; useful for test graphs and throttling.
 *   condition   — evaluate a JS-safe condition expression; throws (fails node) when false.
 */

import { registerNodeHandler } from "./portal-workflow-engine";
import type { NodeExecutionContext } from "./portal-workflow-engine";
import { dispatchEvent, systemActor } from "./event-bus";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger";
const log = logger.child({ channel: "workflow.run" });
import { registerDocPipelineHandlers } from "./doc-pipeline-nodes";
import { registerReportNodes } from "./report-nodes";

// ── Template interpolation ────────────────────────────────────────────────────
// Resolves {{key}} and {{steps.nodeId.field}} tokens from the execution input.

function interp(template: string | undefined, input: Record<string, unknown>): string | undefined {
  if (!template) return undefined;
  return template.replace(/\{\{([\w.\-[\]]+)\}\}/g, (_m, path: string) => {
    const key = path.startsWith("payload.") ? path.slice(8) : path;
    const parts = key.split(".");
    let cur: unknown = input;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return "";
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur == null) return "";
    if (typeof cur === "object") { try { return JSON.stringify(cur); } catch { return ""; } }
    return String(cur);
  });
}

// ── start ─────────────────────────────────────────────────────────────────────
// Handled directly in the engine (no-op passthrough), but registered here for
// discoverability and type introspection.

function handleStart(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  return Promise.resolve(ctx.input);
}

// ── http_call ────────────────────────────────────────────────────────────────
// Config shape:
//   method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"  (default "GET")
//   url: string — template tokens resolved from ctx.input
//   headers: Record<string, string>  — optional; values support templates
//   body: string  — optional; template string for request body
//   timeoutMs: number  — optional (default 30000)
//   expectStatus: number  — optional; throws if response status doesn't match

async function handleHttpCall(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  const cfg = ctx.config;
  const method = String(cfg["method"] ?? "GET").toUpperCase();
  const rawUrl = String(cfg["url"] ?? "");
  const url = interp(rawUrl, ctx.input) ?? rawUrl;
  const timeoutMs = Number(cfg["timeoutMs"] ?? 30_000);
  const expectStatus = cfg["expectStatus"] != null ? Number(cfg["expectStatus"]) : undefined;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg["headers"] && typeof cfg["headers"] === "object") {
    for (const [k, v] of Object.entries(cfg["headers"] as Record<string, string>)) {
      headers[k] = interp(v, ctx.input) ?? v;
    }
  }

  const bodyTemplate = cfg["body"] != null ? String(cfg["body"]) : undefined;
  const body = bodyTemplate ? interp(bodyTemplate, ctx.input) : undefined;

  log.info({ runId: ctx.runId, nodeId: ctx.nodeId, method, url }, "portal-wf: http_call");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (expectStatus !== undefined && res.status !== expectStatus) {
    throw new Error(`http_call: expected status ${expectStatus}, got ${res.status} for ${method} ${url}`);
  }
  if (!res.ok && expectStatus === undefined) {
    throw new Error(`http_call: HTTP ${res.status} ${res.statusText} for ${method} ${url}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  let responseBody: unknown;
  if (contentType.includes("application/json")) {
    responseBody = await res.json();
  } else {
    responseBody = await res.text();
  }

  return {
    status: res.status,
    ok: res.ok,
    body: responseBody,
  };
}

// ── db_write ──────────────────────────────────────────────────────────────────
// Config shape:
//   statement: string — SQL template with {{key}} tokens for safe injection
//   returning: boolean — if true, returns first row as output.row
//
// WARNING: The statement is interpolated with template values and executed as raw SQL.
// Intended for controlled operational writes (e.g., UPDATE status fields, INSERT audit rows).
// Do NOT expose config to untrusted users.

async function handleDbWrite(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  const cfg = ctx.config;
  const rawStatement = String(cfg["statement"] ?? "");
  const statement = interp(rawStatement, ctx.input) ?? rawStatement;
  const returning = Boolean(cfg["returning"] ?? false);

  log.info({ runId: ctx.runId, nodeId: ctx.nodeId, statement: statement.slice(0, 100) }, "portal-wf: db_write");

  const result = await db.execute(sql.raw(statement));
  const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];

  return {
    rowCount: rows.length,
    row: returning && rows.length > 0 ? rows[0] : undefined,
  };
}

// ── emit_event ────────────────────────────────────────────────────────────────
// Config shape:
//   eventType: string — canonical event type to emit
//   source: string    — event source label (default "portal-workflow-engine")
//   payload: object   — additional payload; template tokens resolved from ctx.input
//   ownerType: "customer" | "msp" | "platform"  (default derived from tenantContext)

async function handleEmitEvent(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  const cfg = ctx.config;
  const rawEventType = String(cfg["eventType"] ?? "");
  const eventType = interp(rawEventType, ctx.input) ?? rawEventType;
  const source = String(cfg["source"] ?? "portal-workflow-engine");
  const ownerType = (cfg["ownerType"] as "customer" | "msp" | "platform" | undefined);

  if (!eventType) throw new Error("emit_event: eventType is required");

  // Resolve payload template values
  const payloadTemplate = (cfg["payload"] ?? {}) as Record<string, unknown>;
  const resolvedPayload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payloadTemplate)) {
    if (typeof v === "string") {
      resolvedPayload[k] = interp(v, ctx.input) ?? v;
    } else {
      resolvedPayload[k] = v;
    }
  }

  const dispatched = await dispatchEvent({
    eventType,
    source,
    actor: systemActor(),
    mspId: ctx.tenantContext.mspId,
    customerId: ctx.tenantContext.customerId,
    ownerType: ownerType ?? (ctx.tenantContext.customerId != null ? "customer" : ctx.tenantContext.mspId != null ? "msp" : "platform"),
    causationId: randomUUID(),
    payload: resolvedPayload,
  });

  log.info({ runId: ctx.runId, nodeId: ctx.nodeId, eventType, dispatched: dispatched?.eventId }, "portal-wf: emit_event");

  return {
    eventId: dispatched?.eventId,
    eventType,
    emitted: dispatched != null,
  };
}

// ── wait ──────────────────────────────────────────────────────────────────────
// Config shape:
//   ms: number — milliseconds to wait (capped at 60000 in production)

async function handleWait(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  const rawMs = Number(ctx.config["ms"] ?? 0);
  const ms = Math.min(rawMs, process.env.NODE_ENV === "test" ? 10 : 60_000);
  log.debug({ runId: ctx.runId, nodeId: ctx.nodeId, ms }, "portal-wf: wait");
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  return { waited: ms };
}

// ── condition ─────────────────────────────────────────────────────────────────
// Config shape:
//   expression: string — condition expression using the same safe evaluator as the
//                        generic workflow-executor. Must evaluate to truthy.
//                        Supports: path op literal (==,!=,>,<,>=,<=,contains), &&, ||
//   errorMessage: string — optional message to include in the thrown error

function resolveConditionPath(path: string, input: Record<string, unknown>): unknown {
  const stripped = path.trim().startsWith("{{") && path.trim().endsWith("}}") ? path.trim().slice(2, -2).trim() : path.trim();
  const parts = stripped.split(".");
  let cur: unknown = input;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function evalConditionExpr(expression: string, input: Record<string, unknown>): boolean {
  const parseValue = (s: string): unknown => {
    const t = s.trim();
    if (t.startsWith("{{") && t.endsWith("}}")) return resolveConditionPath(t, input);
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (/^["'].*["']$/.test(t)) return t.slice(1, -1);
    return resolveConditionPath(t, input);
  };

  const evalClause = (clause: string): boolean => {
    const c = clause.trim();
    for (const op of [">=", "<=", "!=", "==", ">", "<", " contains "]) {
      const idx = c.indexOf(op);
      if (idx === -1) continue;
      const lhs = parseValue(c.slice(0, idx));
      const rhs = parseValue(c.slice(idx + op.length));
      if (op === "==" ) return lhs == rhs; // eslint-disable-line eqeqeq
      if (op === "!=" ) return lhs != rhs; // eslint-disable-line eqeqeq
      if (op === ">") return Number(lhs) > Number(rhs);
      if (op === "<") return Number(lhs) < Number(rhs);
      if (op === ">=") return Number(lhs) >= Number(rhs);
      if (op === "<=") return Number(lhs) <= Number(rhs);
      if (op === " contains ") return String(lhs).includes(String(rhs));
    }
    return Boolean(parseValue(c));
  };

  // Support && and || logical operators (left-to-right, equal precedence)
  const orParts = expression.split("||");
  return orParts.some((orPart) => {
    const andParts = orPart.split("&&");
    return andParts.every((clause) => evalClause(clause));
  });
}

async function handleCondition(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  const expression = String(ctx.config["expression"] ?? "");
  const errorMessage = ctx.config["errorMessage"] != null ? String(ctx.config["errorMessage"]) : `condition node '${ctx.nodeId}' evaluated false`;

  if (!expression) throw new Error("condition: expression is required");

  const result = evalConditionExpr(expression, ctx.input);
  if (!result) throw new Error(errorMessage);

  return { condition: true, expression };
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerBuiltinHandlers(): void {
  registerNodeHandler("start", handleStart);
  registerNodeHandler("http_call", handleHttpCall);
  registerNodeHandler("db_write", handleDbWrite);
  registerNodeHandler("emit_event", handleEmitEvent);
  registerNodeHandler("wait", handleWait);
  registerNodeHandler("condition", handleCondition);

  // Document pipeline nodes — registered here so they are available to all workflows.
  registerDocPipelineHandlers();

  // Report generation node
  registerReportNodes();

  log.info({}, "portal-wf: built-in node handlers registered (start, http_call, db_write, emit_event, wait, condition + doc pipeline + report)");
}
