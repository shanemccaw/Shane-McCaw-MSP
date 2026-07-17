import { describe, expect, it } from "vitest";
import {
  buildConfigPackGraph,
  ConfigPackError,
  templateNodeId,
  topologicalOrder,
  type PackTemplateResolved,
} from "./config-pack-graph";

const t = (
  templateId: string,
  sortOrder: number,
  overrides: Partial<PackTemplateResolved> = {},
): PackTemplateResolved => ({
  templateId,
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
