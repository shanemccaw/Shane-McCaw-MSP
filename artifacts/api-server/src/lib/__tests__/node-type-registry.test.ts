import { describe, it, expect } from "vitest";
import { NODE_TYPE_REGISTRY } from "../node-type-registry";

describe("node-type-registry completeness", () => {
  it("every entry has isAIDependent as a strict boolean (not undefined)", () => {
    for (const entry of NODE_TYPE_REGISTRY) {
      expect(
        typeof entry.isAIDependent,
        `node type "${entry.nodeType}": isAIDependent must be a boolean, got ${typeof entry.isAIDependent}`,
      ).toBe("boolean");
    }
  });

  it("every AI-dependent entry has aiCostOwner set to 'msp' or 'platform' (not undefined)", () => {
    for (const entry of NODE_TYPE_REGISTRY) {
      if (entry.isAIDependent) {
        expect(
          ["msp", "platform"],
          `node type "${entry.nodeType}": isAIDependent is true but aiCostOwner is "${(entry as { aiCostOwner?: unknown }).aiCostOwner}" — must be 'msp' or 'platform'`,
        ).toContain((entry as { aiCostOwner?: unknown }).aiCostOwner);
      }
    }
  });

  it("no entry has aiCostOwner set when isAIDependent is false", () => {
    for (const entry of NODE_TYPE_REGISTRY) {
      if (!entry.isAIDependent) {
        expect(
          (entry as { aiCostOwner?: unknown }).aiCostOwner,
          `node type "${entry.nodeType}": isAIDependent is false but aiCostOwner is set — remove it`,
        ).toBeUndefined();
      }
    }
  });

  it("check_script_output is NOT AI-dependent", () => {
    const entry = NODE_TYPE_REGISTRY.find((e) => e.nodeType === "check_script_output");
    expect(entry, "check_script_output must be registered").toBeDefined();
    expect(
      entry!.isAIDependent,
      "check_script_output must have isAIDependent: false",
    ).toBe(false);
  });

  it("chat_message (AI Support Assistant) has isAIDependent: true and aiCostOwner: 'msp'", () => {
    const entry = NODE_TYPE_REGISTRY.find((e) => e.nodeType === "chat_message");
    expect(entry, "chat_message must be registered").toBeDefined();
    expect(
      entry!.isAIDependent,
      "chat_message must have isAIDependent: true",
    ).toBe(true);
    if (entry!.isAIDependent) {
      expect(
        entry!.aiCostOwner,
        "chat_message must have aiCostOwner: 'msp'",
      ).toBe("msp");
    }
  });

  it("every AI-dependent node type has a non-empty description", () => {
    for (const entry of NODE_TYPE_REGISTRY) {
      if (entry.isAIDependent) {
        expect(
          entry.description?.trim().length ?? 0,
          `node type "${entry.nodeType}": AI-dependent nodes should have a description`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("there are no duplicate nodeType keys in the registry", () => {
    const seen = new Set<string>();
    for (const entry of NODE_TYPE_REGISTRY) {
      expect(
        seen.has(entry.nodeType),
        `node type "${entry.nodeType}" is registered more than once`,
      ).toBe(false);
      seen.add(entry.nodeType);
    }
  });
});
