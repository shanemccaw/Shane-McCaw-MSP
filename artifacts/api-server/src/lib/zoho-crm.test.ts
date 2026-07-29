// Unit tests for the pure logic of the Zoho CRM layer (#83): the node
// catalog's shape and read/write split, Zoho response-envelope parsing, field
// sanitization, and the lead_staging → Zoho Lead field mapping.
//
// DB- and network-touching paths (the drain handlers, enqueueZohoWrite) are not
// exercised here — they need a live queue and a live Zoho.

import { describe, it, expect, vi } from "vitest";

// zoho-crm transitively imports @workspace/db, whose index throws on import
// unless DATABASE_URL is set. Nothing here runs a query. Mirrors
// zoho-foundation.test.ts.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

import {
  ZOHO_CRM_NODES,
  ZOHO_CRM_NODE_TYPES,
  isZohoCrmNodeType,
  getZohoCrmNodeSpec,
} from "./zoho-crm-nodes.ts";
import { firstRecord, extractWriteResult, sanitizeFields } from "./zoho-crm.ts";
import { mapStagingToZohoLead } from "./zoho-lead-sync.ts";
import type { LeadStaging } from "@workspace/db";

describe("Zoho CRM node catalog", () => {
  it("registers exactly the 26 nodes the phase specifies", () => {
    expect(ZOHO_CRM_NODES).toHaveLength(26);
  });

  it("splits 8 Lead / 8 Deal / 5 Contact / 5 Account nodes", () => {
    const byModule = (m: string) => ZOHO_CRM_NODES.filter((n) => n.module === m).length;
    expect(byModule("Leads")).toBe(8);
    expect(byModule("Deals")).toBe(8);
    expect(byModule("Contacts")).toBe(5);
    expect(byModule("Accounts")).toBe(5);
  });

  it("has no duplicate node types", () => {
    expect(new Set(ZOHO_CRM_NODE_TYPES).size).toBe(ZOHO_CRM_NODE_TYPES.length);
  });

  it("names every node in snake_case with a zoho_ prefix", () => {
    // The drain claims jobs by the `zoho_` prefix and jobType === nodeType, so a
    // node that breaks this convention would never be picked up.
    for (const type of ZOHO_CRM_NODE_TYPES) {
      expect(type).toMatch(/^zoho_[a-z0-9_]+$/);
    }
  });

  it("ships no delete nodes — Zoho is the system of record", () => {
    expect(ZOHO_CRM_NODE_TYPES.filter((t) => t.includes("delete"))).toEqual([]);
  });

  it("classifies every get_/find_/search_ node as a read and the rest as writes", () => {
    for (const node of ZOHO_CRM_NODES) {
      const looksLikeRead = /^zoho_(get|find|search)_/.test(node.nodeType);
      expect(node.mode).toBe(looksLikeRead ? "read" : "write");
    }
  });

  it("resolves specs by node type and rejects unknown ones", () => {
    expect(isZohoCrmNodeType("zoho_convert_lead")).toBe(true);
    expect(isZohoCrmNodeType("zoho_delete_lead")).toBe(false);
    expect(isZohoCrmNodeType("create_lead")).toBe(false);
    expect(getZohoCrmNodeSpec("zoho_get_deal")?.module).toBe("Deals");
  });
});

describe("firstRecord", () => {
  it("returns the first record from a data envelope", () => {
    expect(firstRecord({ data: [{ id: "1" }, { id: "2" }] })).toEqual({ id: "1" });
  });

  it("returns null for an empty search — Zoho answers 204, mapped to {}", () => {
    expect(firstRecord({})).toBeNull();
    expect(firstRecord({ data: [] })).toBeNull();
  });
});

describe("extractWriteResult", () => {
  it("pulls the created id out of Zoho's nested details envelope", () => {
    const result = extractWriteResult({
      data: [{ code: "SUCCESS", status: "success", details: { id: "554023000000524001" } }],
    });
    expect(result.id).toBe("554023000000524001");
    expect(result.status).toBe("success");
  });

  it("reports a per-record failure even though the HTTP status was 200", () => {
    // Zoho returns 200 with a per-record error status; treating that as success
    // would report a write that never happened.
    const result = extractWriteResult({
      data: [{ code: "MANDATORY_NOT_FOUND", status: "error", message: "required field not found" }],
    });
    expect(result.status).toBe("error");
    expect(result.id).toBeNull();
  });
});

describe("sanitizeFields", () => {
  it("keeps strings, numbers, booleans and explicit nulls", () => {
    expect(sanitizeFields({ Last_Name: "Doe", Amount: 1200, Won: true, Phone: null }))
      .toEqual({ Last_Name: "Doe", Amount: 1200, Won: true, Phone: null });
  });

  it("drops nested objects and arrays rather than letting Zoho reject the record", () => {
    expect(sanitizeFields({ Last_Name: "Doe", Meta: { a: 1 }, Tags: ["x"] }))
      .toEqual({ Last_Name: "Doe" });
  });

  it("returns an empty object for non-object input", () => {
    expect(sanitizeFields(undefined)).toEqual({});
    expect(sanitizeFields("nope")).toEqual({});
    expect(sanitizeFields(["a"])).toEqual({});
  });
});

describe("mapStagingToZohoLead", () => {
  const base = {
    id: 1,
    name: "Ada Lovelace",
    email: "  ADA@Example.COM ",
    company: "Analytical Engines",
    phone: null,
    role: null,
    location: null,
    companySize: null,
    industry: null,
    source: "quiz",
    notes: null,
  } as unknown as LeadStaging;

  it("splits a full name and normalizes the email", () => {
    const fields = mapStagingToZohoLead(base);
    expect(fields.First_Name).toBe("Ada");
    expect(fields.Last_Name).toBe("Lovelace");
    expect(fields.Email).toBe("ada@example.com");
    expect(fields.Company).toBe("Analytical Engines");
  });

  it("uses the whole name as Last_Name when there is no surname", () => {
    // Zoho rejects a Lead with no Last_Name, so a single-word name must not be
    // dropped into First_Name and lost.
    const fields = mapStagingToZohoLead({ ...base, name: "Cher" } as LeadStaging);
    expect(fields.Last_Name).toBe("Cher");
    expect(fields.First_Name).toBeUndefined();
  });

  it("omits fields that are not set rather than sending empty strings", () => {
    const fields = mapStagingToZohoLead(base);
    expect(fields).not.toHaveProperty("Phone");
    expect(fields).not.toHaveProperty("Industry");
    expect(fields).not.toHaveProperty("Description");
  });
});
