// Unit tests for the pure logic of the Zoho Desk layer (#89): the node
// catalog's shape and read/write split, and the contact-name splitting used
// by the Contact upsert (Zoho Desk requires a lastName, so a bare email or a
// single-word name must still produce a valid create payload).
//
// DB- and network-touching paths (org id resolution, the drain handlers,
// enqueueZohoDeskWrite/enqueueEscalationTicket) are not exercised here — they
// need a live queue and a live Zoho. Mirrors zoho-books.ts/zoho-projects.test.ts.

import { describe, it, expect } from "vitest";

// zoho-desk transitively imports @workspace/db, whose index throws on import
// unless DATABASE_URL is set. Nothing here runs a query. Mirrors
// zoho-crm.test.ts / zoho-projects.test.ts / zoho-foundation.test.ts.
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

import {
  ZOHO_DESK_NODES,
  ZOHO_DESK_NODE_TYPES,
  isZohoDeskNodeType,
  getZohoDeskNodeSpec,
} from "./zoho-desk-nodes.ts";
import { splitContactName } from "./zoho-desk.ts";

describe("Zoho Desk node catalog", () => {
  it("registers exactly the 4 nodes the phase specifies", () => {
    expect(ZOHO_DESK_NODES).toHaveLength(4);
  });

  it("has no duplicate node types", () => {
    expect(new Set(ZOHO_DESK_NODE_TYPES).size).toBe(ZOHO_DESK_NODE_TYPES.length);
  });

  it("names every node in snake_case with a zoho_desk_ prefix", () => {
    // The drain claims jobs by the `zoho_` prefix and jobType === nodeType, so
    // a node that breaks this convention would never be picked up.
    for (const type of ZOHO_DESK_NODE_TYPES) {
      expect(type).toMatch(/^zoho_desk_[a-z0-9_]+$/);
    }
  });

  it("ships no delete node — Zoho is the system of record", () => {
    expect(ZOHO_DESK_NODE_TYPES.filter((t) => t.includes("delete"))).toEqual([]);
  });

  it("classifies only zoho_desk_get_ticket as a read, the rest as writes", () => {
    for (const node of ZOHO_DESK_NODES) {
      expect(node.mode).toBe(node.nodeType === "zoho_desk_get_ticket" ? "read" : "write");
    }
  });

  it("resolves specs by node type and rejects unknown ones", () => {
    expect(isZohoDeskNodeType("zoho_desk_create_ticket")).toBe(true);
    expect(isZohoDeskNodeType("zoho_desk_delete_ticket")).toBe(false);
    expect(isZohoDeskNodeType("create_ticket")).toBe(false);
    expect(getZohoDeskNodeSpec("zoho_desk_create_ticket")?.entity).toBe("Ticket");
    expect(getZohoDeskNodeSpec("zoho_desk_upsert_contact")?.entity).toBe("Contact");
    expect(getZohoDeskNodeSpec("zoho_desk_add_comment")?.entity).toBe("Comment");
  });

  it("does not collide with any Zoho CRM/Projects/Books node type", async () => {
    const { ZOHO_CRM_NODE_TYPES } = await import("./zoho-crm-nodes.ts");
    const { ZOHO_PROJECTS_NODE_TYPES } = await import("./zoho-projects-nodes.ts");
    const { ZOHO_BOOKS_NODE_TYPES } = await import("./zoho-books-nodes.ts");
    const others = [...ZOHO_CRM_NODE_TYPES, ...ZOHO_PROJECTS_NODE_TYPES, ...ZOHO_BOOKS_NODE_TYPES];
    const overlap = ZOHO_DESK_NODE_TYPES.filter((t) => others.includes(t));
    expect(overlap).toEqual([]);
  });
});

describe("splitContactName", () => {
  it("splits a full name into first/last", () => {
    expect(splitContactName("Shane McCaw", "shane@example.com")).toEqual({ firstName: "Shane", lastName: "McCaw" });
  });

  it("keeps a middle name attached to firstName", () => {
    expect(splitContactName("Mary Jane Watson", "mj@example.com")).toEqual({ firstName: "Mary Jane", lastName: "Watson" });
  });

  it("falls back to the single word as lastName when there is no separable last name", () => {
    expect(splitContactName("Shane", "shane@example.com")).toEqual({ lastName: "Shane" });
  });

  it("falls back to the email as lastName when no name is given — Zoho Desk requires a non-empty lastName", () => {
    expect(splitContactName(undefined, "shane@example.com")).toEqual({ lastName: "shane@example.com" });
    expect(splitContactName("   ", "shane@example.com")).toEqual({ lastName: "shane@example.com" });
  });
});
