/**
 * sop-workflow-graph.ts — the execution hook's materializer (#1559).
 *
 * Pure graph-materialization for an SOP's automated steps — no DB, no executor
 * imports, unit-testable in isolation. This is `config-pack-graph.ts`'s sibling
 * for the SOP/Runbooks module: same separation (pure materialization here, IO —
 * loading, definition/version persistence, CR gating, firing — in
 * `sop-execution.ts`), same reason for the split.
 *
 * ── Why this exists at all ───────────────────────────────────────────────────
 * #1559 is explicit: the run write path must be "routed through the CR gate
 * (#1497) and the config-pack orchestrator — never a second execution path."
 * `msp_sops.steps[].graphEndpoint` is a plain string an operator typed —
 * `"PATCH /v1.0/users/{id} { accountEnabled: false }"` — not a
 * `baseline_action_templates` row, so it cannot be handed to
 * `runConfigPackForCustomer` directly. This module turns that string into
 * EXACTLY the same kind of thing a config pack already runs: a `WfNode` of type
 * `graph_write_operation` — the one workflow-engine node whose whole job is a
 * raw Graph write (`workflow-executor.ts`'s `graph_write_operation` case),
 * already fail-closed on the tenant write-back + write-consent gates inside
 * `graphWriteForTenant`. The materialized graph then fires through the exact
 * same `fireWorkflowForDefinition` the config-pack orchestrator uses. There is
 * no second Graph-calling loop anywhere in this module.
 *
 * ── What gets materialized, and what does not ────────────────────────────────
 * Only a step whose `graphEndpoint` starts with a WRITE verb (`POST`, `PATCH`,
 * `PUT`, `DELETE`) becomes a node — that is the one thing `graph_write_operation`
 * can execute. A `GET` step (e.g. IAM-03's sign-in inventory) is a genuine read,
 * not a tenant write, and is deliberately left unmaterialized: it is not what
 * the CR gate exists to authorize, and stays a step the run record carries but
 * does not automate. A step with no `graphEndpoint` at all (a `manual`-type
 * step) is the same — always left for a human, closed out through the
 * pre-existing `PATCH /api/msp/sop-runs/:runId`.
 *
 * ── Parsing `graphEndpoint` ───────────────────────────────────────────────────
 * The stored string is `"METHOD /path[ { loose object body }]"`. The trailing
 * body is NOT valid JSON (`{ accountEnabled: false }`, `{ destinationId:
 * 'deleteditems' }` — unquoted keys, single-quoted strings, bare identifiers) —
 * it is what an operator naturally typed. `parseLooseObjectBody` is a small,
 * safe, non-`eval` parser for exactly that shape; it never executes anything.
 * A step whose body fails to parse is left unmaterialized rather than firing a
 * malformed write — the same "don't guess, don't fire something wrong" posture
 * `prepareConfigPackRun`'s missing-variables guard takes.
 *
 * ── Placeholders ─────────────────────────────────────────────────────────────
 * `{upn}` / `{id}` / `{messageId}` are single-brace author-time placeholders —
 * a DIFFERENT syntax from the workflow engine's own `{{path}}` run-time
 * interpolation (`interp()` in workflow-executor.ts). This module rewrites the
 * former into the latter so the SAME node, executed by the SAME engine as any
 * other workflow, resolves them from the fired run's own payload.
 */

import type { WfEdge, WfGraph, WfNode } from "@workspace/db";
import type { StoredSopStep } from "./portal-sops";

/** Graph verbs `graph_write_operation` can actually execute — see the header. */
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export const sopDefinitionName = (sopId: string): string => `SOP: ${sopId}`;

/** No dots — same Git #1316 constraint `config-pack-graph.ts`'s `nodeIdSafe` documents. */
export function sopStepNodeId(stepNumber: number): string {
  return `sop-step-${stepNumber}`;
}

export interface ParsedGraphEndpoint {
  readonly method: string;
  readonly path: string;
  /** Raw, still single-brace — not yet rewritten to `{{...}}`. */
  readonly rawBody: string | null;
}

/**
 * `"PATCH /v1.0/users/{id} { accountEnabled: false }"` → its three parts.
 * Returns null for anything that doesn't match the "METHOD /path [ {body} ]"
 * shape — including every GET (its query string routinely contains a bare
 * space, e.g. `eq 'IMAP4'`, which this intentionally does not try to parse,
 * since a GET is never materialized regardless — see the header).
 */
export function parseGraphEndpointShape(raw: string): ParsedGraphEndpoint | null {
  const match = /^(\S+)\s+(\S+)(?:\s+(\{[\s\S]*\}))?$/.exec(raw.trim());
  if (!match) return null;
  const [, method, path, body] = match;
  return { method: method.toUpperCase(), path, rawBody: body ?? null };
}

/**
 * A small, safe, non-`eval` parser for the loose object-literal bodies
 * `graphEndpoint` strings carry — see the header. Handles the real shapes in
 * use: `true`/`false`, integers, single/double-quoted strings, and bare
 * identifiers (treated as string values — the only sensible reading of an
 * unquoted `state: enabled`). Returns null on anything it cannot confidently
 * parse, rather than guessing.
 */
export function parseLooseObjectBody(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === "") return {};

  const out: Record<string, unknown> = {};
  for (const entry of inner.split(",")) {
    const idx = entry.indexOf(":");
    if (idx === -1) return null;
    const key = entry.slice(0, idx).trim().replace(/^["']|["']$/g, "");
    const rawValue = entry.slice(idx + 1).trim();
    if (!key || !rawValue) return null;

    if (rawValue === "true") out[key] = true;
    else if (rawValue === "false") out[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(rawValue)) out[key] = Number(rawValue);
    else if (
      (rawValue.startsWith("'") && rawValue.endsWith("'")) ||
      (rawValue.startsWith('"') && rawValue.endsWith('"'))
    ) {
      out[key] = rawValue.slice(1, -1);
    } else if (/^[A-Za-z_][\w-]*$/.test(rawValue)) {
      // A bare identifier like `enabled` — no other reading of an unquoted
      // token in this position makes sense than the string it names.
      out[key] = rawValue;
    } else {
      return null;
    }
  }
  return out;
}

/** `{upn}` / `{id}` single-brace tokens — never `{{...}}`, which this does not match. */
const PLACEHOLDER_RE = /(?<!\{)\{([A-Za-z_][\w-]*)\}(?!\})/g;

/** The distinct placeholder names a string references, in first-appearance order. */
export function extractPlaceholders(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const name = m[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** `{upn}` → `{{upn}}` — author-time placeholder to the engine's own `interp()` syntax. */
export function toInterpTemplate(text: string): string {
  return text.replace(PLACEHOLDER_RE, (_m, name: string) => `{{${name}}}`);
}

/** A body object's string values get the same placeholder rewrite as the endpoint path. */
function rewriteBodyPlaceholders(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = typeof v === "string" ? toInterpTemplate(v) : v;
  }
  return out;
}

/** One step successfully turned into a graph node, plus its snapshot record. */
export interface MaterializedSopStep {
  readonly nodeId: string;
  readonly stepIndex: number;
  readonly stepNumber: number;
  readonly label: string;
}

export interface SopWorkflowGraphResult {
  readonly graph: WfGraph;
  readonly materialized: readonly MaterializedSopStep[];
  /** Union of every materialized step's placeholders, first-appearance order. */
  readonly requiredVariables: readonly string[];
}

/**
 * Build the executable graph for an SOP's automated steps: a linear chain,
 * `start -> step -> step -> ... -> end`, over exactly the steps whose
 * `graphEndpoint` is a materializable write. Steps that are not automatable
 * (manual, GET, or an endpoint this module can't safely parse) are skipped —
 * they stay in the run's step list for a human to close out, never silently
 * dropped from the SOP itself.
 */
export function buildSopWorkflowGraph(steps: readonly StoredSopStep[]): SopWorkflowGraphResult {
  const nodes: WfNode[] = [];
  const edges: WfEdge[] = [];
  let y = 80;
  const nextPos = () => {
    const pos = { x: 300, y };
    y += 140;
    return pos;
  };

  nodes.push({ id: "start", type: "start", position: nextPos(), data: { nodeType: "start", label: "SOP Run" } });

  let prev: { id: string; sourceHandle?: string } = { id: "start" };
  let edgeSeq = 0;
  const link = (targetId: string) => {
    edges.push({
      id: `e${++edgeSeq}`,
      source: prev.id,
      target: targetId,
      ...(prev.sourceHandle ? { sourceHandle: prev.sourceHandle } : {}),
    });
  };

  const materialized: MaterializedSopStep[] = [];
  const requiredVariables: string[] = [];
  const seenVars = new Set<string>();

  steps.forEach((step, stepIndex) => {
    const raw = (step.graphEndpoint ?? "").trim();
    if (!raw) return;

    const firstWord = raw.split(/\s+/, 1)[0]?.toUpperCase() ?? "";
    if (!WRITE_METHODS.has(firstWord)) return; // GET, or anything unrecognized — left manual.

    const shape = parseGraphEndpointShape(raw);
    if (!shape) return;

    let body: Record<string, unknown> = {};
    if (shape.rawBody !== null) {
      const parsedBody = parseLooseObjectBody(shape.rawBody);
      if (parsedBody === null) return; // Can't safely parse — don't fire a guess.
      body = rewriteBodyPlaceholders(parsedBody);
    }

    const stepNumber = step.stepNumber ?? stepIndex + 1;
    const nodeId = sopStepNodeId(stepNumber);
    const endpoint = toInterpTemplate(shape.path);
    const label = (step.title ?? "").trim() || `Step ${stepNumber}`;

    for (const name of [...extractPlaceholders(shape.path), ...extractPlaceholders(shape.rawBody ?? "")]) {
      if (!seenVars.has(name)) {
        seenVars.add(name);
        requiredVariables.push(name);
      }
    }

    nodes.push({
      id: nodeId,
      type: "graph_write_operation",
      position: nextPos(),
      data: {
        nodeType: "graph_write_operation",
        label,
        endpoint,
        method: shape.method,
        body,
        customerId: "{{customerId}}",
      },
    });
    link(nodeId);
    // graph_write_operation routes outgoing edges via switchChosenHandle — the
    // happy-path edge MUST carry sourceHandle "success" or it is skipped
    // (same contract execute_baseline_template's chain follows).
    prev = { id: nodeId, sourceHandle: "success" };

    materialized.push({ nodeId, stepIndex, stepNumber, label });
  });

  nodes.push({ id: "end", type: "end", position: nextPos(), data: { nodeType: "end", label: "SOP Run Complete" } });
  link("end");

  return { graph: { nodes, edges }, materialized, requiredVariables };
}
