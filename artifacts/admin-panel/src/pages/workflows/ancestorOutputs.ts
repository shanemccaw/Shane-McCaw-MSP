/**
 * ancestorOutputs.ts
 *
 * Pure, framework-free helpers for resolving which variables are visible to a
 * given workflow node in the builder.  Extracted from WorkflowBuilderPage.tsx so
 * the logic can be unit-tested independently of React / ReactFlow.
 *
 * WorkflowBuilderPage.tsx imports these and wraps them with the app-level
 * KNOWN_EVENTS and NODE_OUTPUTS registries.
 */

// ── Minimal structural interfaces ─────────────────────────────────────────────
// These are intentionally minimal subsets of ReactFlow's Node/Edge types so
// the helpers stay framework-free and easily testable.

export interface AncestorNode {
  id: string;
  data: Record<string, unknown>;
}

export interface AncestorEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface AncestorTrigger {
  type: "manual" | "schedule" | "webhook" | "event";
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface KnownEvent {
  name: string;
  payloadFields: Array<{ key: string; label: string; enumValues?: string[] }>;
}

export type NodeOutputRegistry = Record<
  string,
  Array<{ key: string; label: string; enumValues?: string[] }>
>;

// ── AncestorGroup ─────────────────────────────────────────────────────────────

export interface AncestorGroup {
  nodeId: string;
  nodeName: string;
  /** true for start/trigger nodes and injected loop variables — keys live at
   *  the top-level payload, not under steps.<nodeId>. */
  isStartNode: boolean;
  outputs: Array<{ key: string; label: string; enumValues?: string[] }>;
}

// ── reachableForward ──────────────────────────────────────────────────────────

/**
 * Forward DFS from a set of start node IDs, following all outgoing edges.
 * Used to find all nodes inside a foreach loop body.
 */
export function reachableForward(
  startIds: string[],
  edges: AncestorEdge[],
): Set<string> {
  const seen = new Set<string>();
  const q = [...startIds];
  while (q.length > 0) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) {
      if (e.source === id && !seen.has(e.target)) q.push(e.target);
    }
  }
  return seen;
}

/**
 * Returns the set of node IDs that live inside the body of any *nested*
 * foreach nodes found within `loopBodyIds`.
 *
 * Used to filter the sibling-injection scan: a set_variable node that lives
 * inside a nested foreach's own body should NOT be injected into the enclosing
 * (outer) foreach scope.
 */
function nestedForeachBodyIds(
  loopBodyIds: Set<string>,
  nodes: AncestorNode[],
  edges: AncestorEdge[],
): Set<string> {
  const nested = new Set<string>();
  for (const id of loopBodyIds) {
    const node = nodes.find(n => n.id === id);
    if (!node || (node.data.nodeType as string) !== "foreach") continue;

    const bodyHandleTargets = edges
      .filter(
        e =>
          e.source === id &&
          (e.sourceHandle === "item" ||
            e.sourceHandle === "body" ||
            e.sourceHandle === "loop"),
      )
      .map(e => e.target);

    if (bodyHandleTargets.length > 0) {
      for (const rid of reachableForward(bodyHandleTargets, edges)) {
        nested.add(rid);
      }
    }
  }
  return nested;
}

// ── resolveItemSubfields ──────────────────────────────────────────────────────

/**
 * Derives the expanded sub-field list for a ForEach node's loop variable.
 *
 * Priority:
 *  1. manualItemFields (declared by user on the ForEach config panel)
 *  2. Bracket-notation entries in nodeOutputs, e.g. `flatTasks[].linkedWorkflowId`
 *  3. Empty array (graceful fallback for unknown schemas)
 *
 * Returns keys as `item.{subfield}` or `{alias}.{subfield}` when itemAlias is set.
 */
export function resolveItemSubfields(
  arrayPath: string,
  nodes: AncestorNode[],
  nodeOutputs: NodeOutputRegistry,
  itemAlias?: string,
  manualItemFields?: Array<{ key: string; label: string }>,
): Array<{ key: string; label: string }> {
  const prefix = itemAlias?.trim() || "item";

  if (manualItemFields && manualItemFields.length > 0) {
    return manualItemFields
      .filter(f => f.key.trim())
      .map(f => ({ key: `${prefix}.${f.key.trim()}`, label: f.label || f.key }));
  }

  // Parse {{steps.nodeId.fieldName}} from arrayPath
  const match = (arrayPath ?? "").match(/\{\{steps\.([^.]+)\.([^}]+)\}\}/);
  if (!match) return [];

  const [, sourceNodeId, fieldName] = match;

  const sourceNode = nodes.find(n => n.id === sourceNodeId);
  if (!sourceNode) return [];

  const srcType = (sourceNode.data.nodeType as string) ?? "action";
  const srcActionType = sourceNode.data.actionType as string | undefined;
  const registryKey = srcActionType || srcType;

  const outputs = nodeOutputs[registryKey] ?? [];
  const bracketPrefix = `${fieldName}[].`;
  const subfields = outputs.filter(o => o.key.startsWith(bracketPrefix));

  if (subfields.length === 0) return [];

  return subfields.map(o => ({
    key: `${prefix}.${o.key.slice(bracketPrefix.length)}`,
    label: o.label,
  }));
}

// ── getAncestorOutputs ────────────────────────────────────────────────────────

/**
 * Backward BFS from `nodeId` collecting all variable groups that are visible
 * to that node in the workflow builder (variable picker + validator).
 *
 * @param nodeId        The node being configured in the right-hand panel.
 * @param nodes         Full node list from the ReactFlow graph.
 * @param edges         Full edge list from the ReactFlow graph.
 * @param eventTriggers Trigger definitions for the workflow definition.
 * @param knownEvents   Registry of well-known event payload shapes.
 * @param nodeOutputs   Registry of per-action-type output schemas.
 *
 * Coverage: correctly resolves siblings for ALL configured node types —
 * Action, Compose, Condition, and Switch-Case — because the foreach sibling
 * injection is driven by the *foreach ancestor* type, not the configured
 * node type.
 */
export function getAncestorOutputs(
  nodeId: string,
  nodes: AncestorNode[],
  edges: AncestorEdge[],
  eventTriggers: AncestorTrigger[],
  knownEvents: KnownEvent[],
  nodeOutputs: NodeOutputRegistry,
): AncestorGroup[] {
  const visited = new Set<string>();
  const queue: string[] = edges.filter(e => e.target === nodeId).map(e => e.source);
  const result: AncestorGroup[] = [];
  const injectedLoopVars = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes.find(n => n.id === id);
    if (!node) continue;

    const type = (node.data.nodeType as string) ?? "action";
    const actionType = node.data.actionType as string | undefined;
    let outputs: Array<{ key: string; label: string; enumValues?: string[] }> = [];

    if (type === "start") {
      const declaredFields =
        (node.data.payloadFields as Array<{ key: string; label: string }> | undefined) ?? [];
      const enabledTriggers = eventTriggers.filter(t => t.enabled);
      const fieldMap = new Map<string, { key: string; label: string }>();

      if (enabledTriggers.length === 0) {
        fieldMap.set("payload", {
          key: "payload",
          label: "Trigger payload (fields depend on trigger type)",
        });
      } else {
        for (const trigger of enabledTriggers) {
          if (trigger.type === "event") {
            const eventName = trigger.config.eventName as string | undefined;
            const knownEv = eventName
              ? knownEvents.find(e => e.name === eventName)
              : undefined;
            if (knownEv) {
              for (const f of knownEv.payloadFields) fieldMap.set(f.key, f);
            } else {
              fieldMap.set("payload", {
                key: "payload",
                label: eventName
                  ? `Event payload from "${eventName}"`
                  : "Event payload object",
              });
            }
          } else if (trigger.type === "schedule") {
            // schedule runs inject only triggeredAt — no extra fields
          } else if (trigger.type === "manual") {
            fieldMap.set("payload", {
              key: "payload",
              label: "Manually supplied payload (any fields)",
            });
          } else if (trigger.type === "webhook") {
            fieldMap.set("payload", { key: "payload", label: "Webhook request body" });
          }
        }
      }

      for (const f of declaredFields)
        if (f.key) fieldMap.set(f.key, { key: f.key, label: f.label || f.key });
      fieldMap.set("triggeredAt", {
        key: "triggeredAt",
        label: "ISO timestamp when this run started",
      });
      outputs = Array.from(fieldMap.values());
    } else if (
      type === "action" &&
      (actionType === "set_variable" || actionType === "update_variable")
    ) {
      outputs = nodeOutputs[actionType] ?? [];
      const svName = (node.data.variableName as string | undefined)?.trim();
      if (svName) {
        const svType = (node.data.variableType as string | undefined)?.trim() ?? "string";
        const nodeName =
          (node.data.label as string | undefined) || actionType.replace(/_/g, " ");
        result.unshift({
          nodeId: `${id}__var__${svName}`,
          nodeName: `${nodeName} → {{${svName}}}`,
          isStartNode: true,
          outputs: [{ key: svName, label: `Set Variable "${svName}" (${svType})` }],
        });
      }
    } else if (type === "action" && actionType) {
      outputs = nodeOutputs[actionType] ?? [];
    } else if (type === "ask_for_input") {
      const fields =
        (node.data.fields as Array<{ variableName: string; label: string }> | undefined) ?? [];
      outputs = fields
        .filter(f => f.variableName)
        .map(f => ({ key: f.variableName, label: f.label || f.variableName }));
    } else if (
      type !== "end" &&
      type !== "condition" &&
      type !== "delay" &&
      type !== "error"
    ) {
      outputs = nodeOutputs[type] ?? [];
    }

    // ── Loop-body sibling injection ─────────────────────────────────────────
    // Intentionally outside the else-if chain above so it fires unconditionally
    // for every foreach ancestor, regardless of that chain's exclusion list and
    // regardless of what type the CONFIGURED node (nodeId) is.
    //
    // This is what makes {{myVar}} visible in Condition and Switch-Case expression
    // fields when a sibling Set Variable node lives in the same foreach body.
    if (type === "foreach" || type === "for") {
      const itemHandleTargets = edges
        .filter(
          e =>
            e.source === id &&
            (e.sourceHandle === "item" ||
              e.sourceHandle === "body" ||
              e.sourceHandle === "loop"),
        )
        .map(e => e.target);

      if (itemHandleTargets.length > 0) {
        const loopBodyIds = reachableForward(itemHandleTargets, edges);

        if (loopBodyIds.has(nodeId)) {
          // Compute nodes that belong to deeper (nested) foreach bodies so we
          // can exclude their set_variable nodes from THIS foreach's injection.
          // This prevents inner-loop variables from leaking into the outer
          // loop's picker while still letting the outer foreach inject its own
          // variables into inner nodes (nodeId may be inside a nested foreach
          // and should still receive this outer foreach's variables).
          const nestedBodyIds = nestedForeachBodyIds(loopBodyIds, nodes, edges);

          for (const bid of loopBodyIds) {
            if (bid === nodeId || visited.has(bid)) continue;
            // Skip set_variable nodes that live inside a nested foreach body —
            // they are scoped to that inner loop, not this one.
            if (nestedBodyIds.has(bid)) continue;
            const bn = nodes.find(x => x.id === bid);
            if (!bn) continue;
            const bType = (bn.data.nodeType as string) ?? "action";
            const bActionType = bn.data.actionType as string | undefined;
            if (
              bType === "action" &&
              (bActionType === "set_variable" || bActionType === "update_variable")
            ) {
              const svName = (bn.data.variableName as string | undefined)?.trim();
              if (svName && !injectedLoopVars.has(`${bid}__${svName}`)) {
                injectedLoopVars.add(`${bid}__${svName}`);
                const svType =
                  (bn.data.variableType as string | undefined)?.trim() ?? "string";
                const nodeName =
                  (bn.data.label as string | undefined) ||
                  bActionType!.replace(/_/g, " ");
                result.unshift({
                  nodeId: `${bid}__var__${svName}`,
                  nodeName: `${nodeName} → {{${svName}}}`,
                  isStartNode: true,
                  outputs: [
                    { key: svName, label: `Set Variable "${svName}" (${svType})` },
                  ],
                });
              }
            }
          }

          // Expand item sub-fields from the array source so loop body nodes
          // see {{item.fieldName}} chips rather than just {{item}}.
          const arrayPath = (node.data.arrayPath as string) ?? "";
          const itemAlias = (node.data.itemAlias as string | undefined)?.trim();
          const manualItemFields = node.data.itemFields as
            | Array<{ key: string; label: string }>
            | undefined;
          const subfields = resolveItemSubfields(
            arrayPath,
            nodes,
            nodeOutputs,
            itemAlias,
            manualItemFields,
          );
          if (subfields.length > 0) {
            outputs = [...outputs, ...subfields];
          }
        }
      }
    }

    if (outputs.length > 0) {
      const name =
        (node.data.label as string | undefined) ||
        (actionType ? actionType.replace(/_/g, " ") : type.replace(/_/g, " "));
      result.unshift({
        nodeId: id,
        nodeName: name,
        isStartNode: type === "start",
        outputs,
      });
    }

    edges
      .filter(e => e.target === id)
      .forEach(e => {
        if (!visited.has(e.source)) queue.push(e.source);
      });
  }

  return result;
}
