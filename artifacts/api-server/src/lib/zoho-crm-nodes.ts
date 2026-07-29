// Zoho CRM node catalog (#83) — pure data, zero imports.
//
// Deliberately dependency-free so `node-type-registry.ts` (which is imported by
// tests that run without a DATABASE_URL) can derive its 26 Zoho entries from
// the same list the executor and the job handlers use, without pulling in
// `zoho-crm.ts` and, transitively, `@workspace/db`.
//
// The node type string and the msp_job_queue jobType string are identical for a
// given node — there is no mapping table to drift.

export type ZohoCrmModule = "Leads" | "Deals" | "Contacts" | "Accounts";

export interface ZohoCrmNodeSpec {
  nodeType: string;
  module: ZohoCrmModule;
  /** read → inline zohoGet during the run; write → enqueueJob + drain handler. */
  mode: "read" | "write";
  description: string;
}

export const ZOHO_CRM_NODES: ZohoCrmNodeSpec[] = [
  // ── Lead (8) ──
  { nodeType: "zoho_create_lead", module: "Leads", mode: "write", description: "Creates a Zoho CRM Lead — queued, no AI" },
  { nodeType: "zoho_update_lead", module: "Leads", mode: "write", description: "Updates a Zoho CRM Lead — queued, no AI" },
  { nodeType: "zoho_upsert_lead", module: "Leads", mode: "write", description: "Finds a Zoho Lead by email then creates or updates it — queued, idempotent, no AI" },
  { nodeType: "zoho_find_lead_by_email", module: "Leads", mode: "read", description: "Looks up a Zoho Lead by email address — no AI" },
  { nodeType: "zoho_get_lead", module: "Leads", mode: "read", description: "Fetches one Zoho Lead by record id — no AI" },
  { nodeType: "zoho_add_lead_note", module: "Leads", mode: "write", description: "Adds a note to a Zoho Lead — queued, no AI" },
  { nodeType: "zoho_attach_file_to_lead", module: "Leads", mode: "write", description: "Attaches a file (by URL) to a Zoho Lead — queued, no AI" },
  { nodeType: "zoho_convert_lead", module: "Leads", mode: "write", description: "Converts a Zoho Lead into Contact + Account + Deal atomically — queued, costs 5 API credits, no AI" },

  // ── Deal (8) ──
  { nodeType: "zoho_create_deal", module: "Deals", mode: "write", description: "Creates a Zoho CRM Deal — queued, no AI" },
  { nodeType: "zoho_update_deal", module: "Deals", mode: "write", description: "Updates a Zoho CRM Deal — queued, no AI" },
  { nodeType: "zoho_update_deal_stage", module: "Deals", mode: "write", description: "Moves a Zoho Deal to a new stage — queued, no AI" },
  { nodeType: "zoho_update_deal_amount", module: "Deals", mode: "write", description: "Updates a Zoho Deal's amount — queued, no AI" },
  { nodeType: "zoho_get_deal", module: "Deals", mode: "read", description: "Fetches one Zoho Deal by record id — no AI" },
  { nodeType: "zoho_add_deal_note", module: "Deals", mode: "write", description: "Adds a note to a Zoho Deal — queued, no AI" },
  { nodeType: "zoho_attach_file_to_deal", module: "Deals", mode: "write", description: "Attaches a file (by URL) to a Zoho Deal — queued, no AI" },
  { nodeType: "zoho_find_open_deal_for_contact", module: "Deals", mode: "read", description: "Finds an existing open Deal for a Contact — duplicate guard before create — no AI" },

  // ── Contact (5) ──
  { nodeType: "zoho_create_contact", module: "Contacts", mode: "write", description: "Creates a Zoho CRM Contact — queued, no AI" },
  { nodeType: "zoho_update_contact", module: "Contacts", mode: "write", description: "Updates a Zoho CRM Contact — queued, no AI" },
  { nodeType: "zoho_upsert_contact", module: "Contacts", mode: "write", description: "Finds a Zoho Contact by email then creates or updates it — queued, idempotent, no AI" },
  { nodeType: "zoho_find_contact_by_email", module: "Contacts", mode: "read", description: "Looks up a Zoho Contact by email address — no AI" },
  { nodeType: "zoho_get_contact", module: "Contacts", mode: "read", description: "Fetches one Zoho Contact by record id — no AI" },

  // ── Account (5) ──
  { nodeType: "zoho_create_account", module: "Accounts", mode: "write", description: "Creates a Zoho CRM Account — queued, no AI" },
  { nodeType: "zoho_search_accounts", module: "Accounts", mode: "read", description: "Searches Zoho Accounts by name or word — no AI" },
  { nodeType: "zoho_get_account", module: "Accounts", mode: "read", description: "Fetches one Zoho Account by record id — no AI" },
  { nodeType: "zoho_update_account", module: "Accounts", mode: "write", description: "Updates a Zoho CRM Account — queued, no AI" },
  { nodeType: "zoho_attach_file_to_account", module: "Accounts", mode: "write", description: "Attaches a file (by URL) to a Zoho Account — queued, no AI" },
];

export const ZOHO_CRM_NODE_TYPES: string[] = ZOHO_CRM_NODES.map((n) => n.nodeType);

const NODE_SPECS = new Map(ZOHO_CRM_NODES.map((n) => [n.nodeType, n]));

export function isZohoCrmNodeType(nodeType: string): boolean {
  return NODE_SPECS.has(nodeType);
}

export function getZohoCrmNodeSpec(nodeType: string): ZohoCrmNodeSpec | undefined {
  return NODE_SPECS.get(nodeType);
}
