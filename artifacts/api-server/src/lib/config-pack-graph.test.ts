import { describe, expect, it } from "vitest";
import {
  AUTO_DERIVED_VARIABLES,
  buildConfigPackGraph,
  ConfigPackError,
  MID_RUN_PROVIDED_VARIABLES,
  operatorRequiredVariables,
  packProvidedVariables,
  monitorCheckNodeId,
  templateNodeId,
  topologicalOrder,
  type PackTemplateResolved,
} from "./config-pack-graph.ts";
import { findGraphStructuralDefects, hasGraphStructuralDefects } from "./workflow-graph-integrity.ts";

const t = (
  templateId: string,
  sortOrder: number,
  overrides: Partial<PackTemplateResolved> = {},
): PackTemplateResolved => ({
  templateId,
  checkKey: null,
  parameterMapping: null,
  label: templateId,
  sortOrder,
  effectiveDependsOn: [],
  requiresVerificationGate: false,
  requiredVariables: [],
  ...overrides,
});

/** The quickstart-v1 pack exactly as seeded (0194/0195 + effective overrides). */
const quickstart = (): PackTemplateResolved[] => [
  t("entra-security-defaults-enable", 1),
  t("tenant-branding-configure", 2, { requiredVariables: ["organizationId", "tenantName", "tenantDomain"] }),
  t("breakglass-user-create", 3, {
    requiresVerificationGate: true,
    requiredVariables: ["tenantDomain", "generatedPassword"],
  }),
  t("breakglass-assign-global-admin", 4, {
    requiresVerificationGate: true,
    // depends_on_override REPLACES the (empty) base dependsOn
    effectiveDependsOn: ["breakglass-user-create"],
    requiredVariables: ["breakglassUserId"],
  }),
  t("pim-role-assignment-rules", 5, {
    effectiveDependsOn: ["breakglass-assign-global-admin"],
    requiredVariables: ["roleDefinitionId", "principalId", "currentDateTime"],
  }),
  t("guest-access-restrict", 6),
  t("conditional-access-baseline", 7, { effectiveDependsOn: ["breakglass-assign-global-admin"] }),
  t("group-naming-policy", 8, { requiredVariables: ["tenantPrefix"] }),
];

describe("topologicalOrder", () => {
  it("orders the quickstart pack by sortOrder (already dependency-consistent)", () => {
    expect(topologicalOrder(quickstart()).map((x) => x.templateId)).toEqual([
      "entra-security-defaults-enable",
      "tenant-branding-configure",
      "breakglass-user-create",
      "breakglass-assign-global-admin",
      "pim-role-assignment-rules",
      "guest-access-restrict",
      "conditional-access-baseline",
      "group-naming-policy",
    ]);
  });

  it("moves a dependency ahead of its dependent even when sortOrder disagrees", () => {
    const ordered = topologicalOrder([
      t("b", 1, { effectiveDependsOn: ["a"] }),
      t("a", 2),
    ]);
    expect(ordered.map((x) => x.templateId)).toEqual(["a", "b"]);
  });

  it("throws dependency_not_in_pack for a dep outside the pack", () => {
    expect(() => topologicalOrder([t("a", 1, { effectiveDependsOn: ["ghost"] })])).toThrowError(
      expect.objectContaining({ code: "dependency_not_in_pack" }),
    );
  });

  it("throws dependency_cycle on cycles", () => {
    const err = (() => {
      try {
        topologicalOrder([
          t("a", 1, { effectiveDependsOn: ["b"] }),
          t("b", 2, { effectiveDependsOn: ["a"] }),
        ]);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ConfigPackError);
    expect((err as ConfigPackError).code).toBe("dependency_cycle");
  });
});

describe("buildConfigPackGraph", () => {
  it("builds a strictly linear chain with map + gate spliced after the first flagged template", () => {
    const { graph, gatedTemplateId, coalescedGateTemplateIds } = buildConfigPackGraph(quickstart());

    expect(gatedTemplateId).toBe("breakglass-user-create");
    // The second flagged template shares the pack's single gate (a second gate
    // would find no plaintext secret post-redaction).
    expect(coalescedGateTemplateIds).toEqual(["breakglass-assign-global-admin"]);

    expect(graph.nodes.map((n) => n.id)).toEqual([
      "start",
      "tpl-entra-security-defaults-enable",
      "tpl-tenant-branding-configure",
      "tpl-breakglass-user-create",
      "map-breakglass-user-create-outputs",
      "gate-breakglass-user-create",
      "tpl-breakglass-assign-global-admin",
      "tpl-pim-role-assignment-rules",
      "tpl-guest-access-restrict",
      "tpl-conditional-access-baseline",
      "tpl-group-naming-policy",
      "end",
    ]);

    // Strict linearity: the edges walk the node list in order, one edge per hop.
    const ids = graph.nodes.map((n) => n.id);
    expect(graph.edges).toHaveLength(ids.length - 1);
    graph.edges.forEach((e, i) => {
      expect(e.source).toBe(ids[i]);
      expect(e.target).toBe(ids[i + 1]);
    });
  });

  it("puts sourceHandle 'success' on template out-edges only (executor routes them by switchChosenHandle)", () => {
    const { graph } = buildConfigPackGraph(quickstart());
    for (const e of graph.edges) {
      const sourceNode = graph.nodes.find((n) => n.id === e.source)!;
      if (sourceNode.type === "execute_baseline_template") {
        expect(e.sourceHandle).toBe("success");
      } else {
        // start / map / gate edges must stay handle-less: resumeWorkflowRun
        // treats a no-handle gate edge as "approved".
        expect(e.sourceHandle).toBeUndefined();
      }
    }
  });

  it("wires gate fields explicitly and maps the created account id into flat payload keys", () => {
    const { graph } = buildConfigPackGraph(quickstart());

    const gate = graph.nodes.find((n) => n.type === "break_glass_verification_gate")!;
    expect(gate.data.secretField).toBe("generatedPassword");
    expect(gate.data.customerIdField).toBe("customerId");
    expect(gate.data.accountIdField).toBe("breakGlassAccountId");

    const map = graph.nodes.find((n) => n.id === "map-breakglass-user-create-outputs")!;
    expect(map.type).toBe("action");
    expect(map.data.actionType).toBe("sql_query");
    expect(map.data.params).toEqual([
      `{{steps.${templateNodeId("breakglass-user-create")}.data.id}}`,
    ]);
    expect(map.data.query).toContain('AS "breakglassUserId"');
    expect(map.data.query).toContain('AS "principalId"');
    expect(map.data.query).toContain('AS "breakGlassAccountId"');
  });

  it("template nodes execute via templateId + interpolated customerId", () => {
    const { graph } = buildConfigPackGraph(quickstart());
    const tplNodes = graph.nodes.filter((n) => n.type === "execute_baseline_template");
    expect(tplNodes).toHaveLength(8);
    for (const n of tplNodes) {
      expect(n.data.templateId).toBe(n.id.replace(/^tpl-/, ""));
      expect(n.data.customerId).toBe("{{customerId}}");
    }
  });

  it("emits no gate or map node for packs without flagged templates", () => {
    const { graph, gatedTemplateId, coalescedGateTemplateIds } = buildConfigPackGraph([
      t("a", 1),
      t("b", 2, { effectiveDependsOn: ["a"] }),
    ]);
    expect(gatedTemplateId).toBeNull();
    expect(coalescedGateTemplateIds).toEqual([]);
    expect(graph.nodes.map((n) => n.id)).toEqual(["start", "tpl-a", "tpl-b", "end"]);
    expect(graph.nodes.some((n) => n.type === "break_glass_verification_gate")).toBe(false);
  });

  it("keeps every dependent strictly after the gate covering its flagged dependency", () => {
    const { graph } = buildConfigPackGraph(quickstart());
    const ids = graph.nodes.map((n) => n.id);
    const gateIdx = ids.indexOf("gate-breakglass-user-create");
    for (const dependent of [
      "tpl-breakglass-assign-global-admin",
      "tpl-pim-role-assignment-rules",
      "tpl-conditional-access-baseline",
    ]) {
      expect(ids.indexOf(dependent)).toBeGreaterThan(gateIdx);
    }
  });
});

describe("operatorRequiredVariables", () => {
  it("returns only the required vars with no derivable source (the sole operator inputs)", () => {
    // The quickstart pack's only non-derivable required var is tenantPrefix —
    // everything else (tenantName, tenantDomain, organizationId, roleDefinitionId,
    // generatedPassword, breakglassUserId, principalId, currentDateTime) is
    // supplied by the orchestrator itself.
    const ordered = topologicalOrder(quickstart());
    expect(operatorRequiredVariables(ordered)).toEqual(["tenantPrefix"]);
  });

  it("excludes every AUTO_DERIVED variable even when a template requires it", () => {
    const ordered = topologicalOrder([
      t("only-derived", 1, {
        requiredVariables: [...AUTO_DERIVED_VARIABLES],
      }),
    ]);
    expect(operatorRequiredVariables(ordered)).toEqual([]);
  });

  it("dedupes across steps and preserves first-appearance order", () => {
    const ordered = topologicalOrder([
      t("a", 1, { requiredVariables: ["tenantPrefix", "siteName"] }),
      t("b", 2, { requiredVariables: ["siteName", "ownerUpn"] }),
    ]);
    expect(operatorRequiredVariables(ordered)).toEqual(["tenantPrefix", "siteName", "ownerUpn"]);
  });
});

// ── Git #1316: dotted ids, template-output mappings, breakGlassUserId ─────────

describe("Git #1316 graph-builder additions", () => {
  it("sanitizes dotted template ids out of every node id and mapping reference (interp splits on dots)", () => {
    const { graph } = buildConfigPackGraph([
      t("quickstart-v1.create-break-glass-account", 1, {
        requiresVerificationGate: true,
        requiredVariables: ["generatedPassword"],
      }),
      t("quickstart-v1.assign-global-admin-role", 2, {
        effectiveDependsOn: ["quickstart-v1.create-break-glass-account"],
      }),
    ]);
    for (const n of graph.nodes) expect(n.id).not.toContain(".");
    const map = graph.nodes.find((n) => n.data.label === "Map Break-Glass Step Outputs")!;
    expect(map.data.params).toEqual([
      "{{steps.tpl-quickstart-v1-create-break-glass-account.data.id}}",
    ]);
  });

  it("gate map also emits the capital-G breakGlassUserId the seeded templates reference", () => {
    const { graph } = buildConfigPackGraph(quickstart());
    const map = graph.nodes.find((n) => n.id === "map-breakglass-user-create-outputs")!;
    expect(map.data.query).toContain('AS "breakGlassUserId"');
    expect(MID_RUN_PROVIDED_VARIABLES).toContain("breakGlassUserId");
  });

  it("materializes a template-output mapping node AFTER a checkKey-less template step", () => {
    const { graph } = buildConfigPackGraph([
      t("group-create", 1, {
        parameterMapping: { breakGlassGroupId: "id", staticThing: "static:fixed" },
      }),
      t("group-use", 2, {
        effectiveDependsOn: ["group-create"],
        requiredVariables: ["breakGlassGroupId"],
      }),
    ]);
    expect(graph.nodes.map((n) => n.id)).toEqual([
      "start",
      "tpl-group-create",
      "map-group-create-tpl-outputs",
      "tpl-group-use",
      "end",
    ]);
    const map = graph.nodes.find((n) => n.id === "map-group-create-tpl-outputs")!;
    expect(map.data.actionType).toBe("sql_query");
    expect(map.data.params).toEqual(["{{steps.tpl-group-create.data.id}}", "fixed"]);
    expect(map.data.query).toContain('AS "breakGlassGroupId"');
    // The edge INTO the mapping node leaves a template node, so it must carry
    // the success handle (switchChosenHandle routing).
    const edge = graph.edges.find((e) => e.target === "map-group-create-tpl-outputs")!;
    expect(edge.source).toBe("tpl-group-create");
    expect(edge.sourceHandle).toBe("success");
  });

  it("treats parameterMapping keys as mid-run provided in operatorRequiredVariables", () => {
    const templates = [
      t("group-create", 1, { parameterMapping: { breakGlassGroupId: "id" } }),
      t("group-use", 2, {
        effectiveDependsOn: ["group-create"],
        requiredVariables: ["breakGlassGroupId", "tenantPrefix"],
      }),
    ];
    expect([...packProvidedVariables(templates)]).toEqual(["breakGlassGroupId"]);
    expect(operatorRequiredVariables(topologicalOrder(templates))).toEqual(["tenantPrefix"]);
  });
});

// ── Git #4510: a step with BOTH check_key and template_id ─────────────────────

/**
 * Replays the executor's scheduling rule (workflow-executor.ts: in-degree per
 * edge, a node is queued only once resolvedCount === inDegree) on the happy
 * path, returning the node ids in the order they would be reached.
 */
function replayReadyQueue(graph: { nodes: { id: string }[]; edges: { source: string; target: string }[] }): string[] {
  const inDegree = new Map<string, number>();
  for (const n of graph.nodes) inDegree.set(n.id, 0);
  for (const e of graph.edges) inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  const resolved = new Map<string, number>();
  const queue = graph.nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const reached: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    reached.push(id);
    for (const e of graph.edges.filter((edge) => edge.source === id)) {
      const r = (resolved.get(e.target) ?? 0) + 1;
      resolved.set(e.target, r);
      if (r === inDegree.get(e.target)) queue.push(e.target);
    }
  }
  return reached;
}

describe("Git #4510 check_key + template_id on the same step", () => {
  const bothSet = (): PackTemplateResolved[] => [
    t("action-create-ca-legacy-auth-block-policy", 1, { checkKey: "identity:ca-legacy-auth-block" }),
    t("quickstart-v1.create-break-glass-account", 2, {
      checkKey: "identity:break-glass-health",
      requiresVerificationGate: true,
      requiredVariables: ["generatedPassword"],
    }),
    t("guest-access-restrict", 3),
  ];

  it("gives the monitor-check node its own chk- id — no duplicate ids, no self-loops", () => {
    const { graph } = buildConfigPackGraph(bothSet());
    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(graph.edges.filter((e) => e.source === e.target)).toEqual([]);
    expect(ids).toEqual([
      "start",
      monitorCheckNodeId("action-create-ca-legacy-auth-block-policy"),
      templateNodeId("action-create-ca-legacy-auth-block-policy"),
      "chk-quickstart-v1-create-break-glass-account",
      "tpl-quickstart-v1-create-break-glass-account",
      "map-quickstart-v1-create-break-glass-account-outputs",
      "gate-quickstart-v1-create-break-glass-account",
      "tpl-guest-access-restrict",
      "end",
    ]);
    const chk = graph.nodes.find((n) => n.id === "chk-action-create-ca-legacy-auth-block-policy")!;
    expect(chk.type).toBe("execute_monitor_check");
    expect(chk.data.checkKey).toBe("identity:ca-legacy-auth-block");
    const tpl = graph.nodes.find((n) => n.id === "tpl-action-create-ca-legacy-auth-block-policy")!;
    expect(tpl.type).toBe("execute_baseline_template");
    // The check runs first and feeds straight into its own template.
    expect(graph.edges.find((e) => e.target === tpl.id)!.source).toBe(chk.id);
  });

  it("every template node is reached by the executor's in-degree scheduling, not just start", () => {
    const { graph } = buildConfigPackGraph(bothSet());
    expect(replayReadyQueue(graph)).toEqual(graph.nodes.map((n) => n.id));
  });

  it("points the check's parameter mapping at the chk- node, clear of the gate's map node", () => {
    const { graph } = buildConfigPackGraph([
      t("quickstart-v1.create-break-glass-account", 1, {
        checkKey: "identity:break-glass-health",
        parameterMapping: { existingAccountId: "id" },
        requiresVerificationGate: true,
        requiredVariables: ["generatedPassword"],
      }),
    ]);
    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const checkMap = graph.nodes.find((n) => n.id === "map-chk-quickstart-v1-create-break-glass-account-outputs")!;
    expect(checkMap.data.params).toEqual([
      "{{steps.chk-quickstart-v1-create-break-glass-account.extractedProperties.0.id}}",
    ]);
    expect(ids).toContain("map-quickstart-v1-create-break-glass-account-outputs");
    expect(replayReadyQueue(graph)).toEqual(ids);
  });

  it("keys a checkKey-only step's node chk-<checkKey>", () => {
    const { graph } = buildConfigPackGraph([
      { ...t("unused", 1), templateId: null, checkKey: "sharepoint:anonymous-links" },
    ]);
    expect(graph.nodes.map((n) => n.id)).toEqual(["start", "chk-sharepoint:anonymous-links", "end"]);
  });
});

describe("findGraphStructuralDefects", () => {
  it("reports duplicate node ids and self-loop edges", () => {
    const defects = findGraphStructuralDefects({
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: { nodeType: "start" } },
        { id: "tpl-x", type: "execute_monitor_check", position: { x: 0, y: 0 }, data: { nodeType: "execute_monitor_check" } },
        { id: "tpl-x", type: "execute_baseline_template", position: { x: 0, y: 0 }, data: { nodeType: "execute_baseline_template" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "tpl-x" },
        { id: "e2", source: "tpl-x", target: "tpl-x" },
      ],
    });
    expect(defects.duplicateNodeIds).toEqual(["tpl-x"]);
    expect(defects.selfLoops).toEqual([{ edgeId: "e2", nodeId: "tpl-x" }]);
    expect(hasGraphStructuralDefects(defects)).toBe(true);
  });

  it("finds nothing wrong with the quickstart chain", () => {
    expect(hasGraphStructuralDefects(findGraphStructuralDefects(buildConfigPackGraph(quickstart()).graph))).toBe(false);
  });
});
