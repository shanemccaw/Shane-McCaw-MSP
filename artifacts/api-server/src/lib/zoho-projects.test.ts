// Unit tests for the pure logic of the Zoho Projects layer (#85): the node
// catalog's shape and read/write split, field sanitization, and Zoho Projects'
// index/range pagination math.
//
// DB- and network-touching paths (portal id resolution, the drain handlers,
// enqueueZohoProjectsWrite) are not exercised here — they need a live queue
// and a live Zoho. Mirrors zoho-crm.test.ts.

import { describe, it, expect, vi } from "vitest";

// zoho-projects transitively imports @workspace/db, whose index throws on
// import unless DATABASE_URL is set. Nothing here runs a query. Mirrors
// zoho-crm.test.ts / zoho-foundation.test.ts.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

import {
  ZOHO_PROJECTS_NODES,
  ZOHO_PROJECTS_NODE_TYPES,
  isZohoProjectsNodeType,
  getZohoProjectsNodeSpec,
} from "./zoho-projects-nodes.ts";
import { sanitizeFields } from "./zoho-projects.ts";
import { normalizeZohoProjectsPaging } from "./zoho-projects-read.ts";

describe("Zoho Projects node catalog", () => {
  it("registers exactly the 14 nodes the phase specifies", () => {
    expect(ZOHO_PROJECTS_NODES).toHaveLength(14);
  });

  it("splits 4 Project / 2 Tasklist / 4 Task / 4 Milestone nodes", () => {
    const byEntity = (e: string) => ZOHO_PROJECTS_NODES.filter((n) => n.entity === e).length;
    expect(byEntity("Project")).toBe(4);
    expect(byEntity("Tasklist")).toBe(2);
    expect(byEntity("Task")).toBe(4);
    expect(byEntity("Milestone")).toBe(4);
  });

  it("has no duplicate node types", () => {
    expect(new Set(ZOHO_PROJECTS_NODE_TYPES).size).toBe(ZOHO_PROJECTS_NODE_TYPES.length);
  });

  it("names every node in snake_case with a zoho_ prefix", () => {
    // The drain claims jobs by the `zoho_` prefix and jobType === nodeType, so
    // a node that breaks this convention would never be picked up.
    for (const type of ZOHO_PROJECTS_NODE_TYPES) {
      expect(type).toMatch(/^zoho_[a-z0-9_]+$/);
    }
  });

  it("ships no delete nodes — Zoho is the system of record", () => {
    expect(ZOHO_PROJECTS_NODE_TYPES.filter((t) => t.includes("delete"))).toEqual([]);
  });

  it("classifies every get_/list_ node as a read and the rest as writes", () => {
    for (const node of ZOHO_PROJECTS_NODES) {
      const looksLikeRead = /^zoho_(get|list)_/.test(node.nodeType);
      expect(node.mode).toBe(looksLikeRead ? "read" : "write");
    }
  });

  it("resolves specs by node type and rejects unknown ones", () => {
    expect(isZohoProjectsNodeType("zoho_create_task")).toBe(true);
    expect(isZohoProjectsNodeType("zoho_delete_task")).toBe(false);
    expect(isZohoProjectsNodeType("create_task")).toBe(false);
    expect(getZohoProjectsNodeSpec("zoho_list_milestones")?.entity).toBe("Milestone");
  });

  it("does not collide with any Zoho CRM node type", async () => {
    const { ZOHO_CRM_NODE_TYPES } = await import("./zoho-crm-nodes.ts");
    const overlap = ZOHO_PROJECTS_NODE_TYPES.filter((t) => ZOHO_CRM_NODE_TYPES.includes(t));
    expect(overlap).toEqual([]);
  });
});

describe("sanitizeFields", () => {
  it("keeps only string/number/boolean/null values", () => {
    expect(sanitizeFields({ name: "Task", percent_complete: 50, done: false, junk: undefined, nested: { a: 1 }, arr: [1, 2] }))
      .toEqual({ name: "Task", percent_complete: 50, done: false });
  });

  it("returns an empty object for non-object input", () => {
    expect(sanitizeFields(null)).toEqual({});
    expect(sanitizeFields("x")).toEqual({});
    expect(sanitizeFields([1, 2])).toEqual({});
  });
});

describe("normalizeZohoProjectsPaging", () => {
  it("defaults to page 1, range 50, index 1", () => {
    expect(normalizeZohoProjectsPaging()).toEqual({ index: 1, range: 50, page: 1, perPage: 50 });
  });

  it("computes index from (page - 1) * range + 1", () => {
    expect(normalizeZohoProjectsPaging(3, 20)).toEqual({ index: 41, range: 20, page: 3, perPage: 20 });
  });

  it("clamps range to 200", () => {
    expect(normalizeZohoProjectsPaging(1, 500).range).toBe(200);
  });
});
