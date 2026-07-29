// Zoho Desk node catalog (#89) — pure data, zero imports.
//
// Same shape as zoho-books-nodes.ts / zoho-projects-nodes.ts / zoho-crm-nodes.ts:
// dependency-free so node-type-registry.ts can derive its entries without
// pulling in zoho-desk.ts and, transitively, @workspace/db.
//
// Built to connect the AI Support Chat's human-escalation path
// (escalateToAdmin() in support-chat.ts) to a real Zoho Desk ticket instead of
// an in-platform notification — see support-chat.ts for the wiring. These
// nodes are also generically available to the workflow builder, same as every
// other Zoho product's nodes.
//
// No delete node. No list/browse UI — this connects an existing flow to
// Zoho, it doesn't add a new ticket-management surface in-platform.
//
// The node type string and the msp_job_queue jobType string are identical for
// a given node — there is no mapping table to drift.

export type ZohoDeskEntity = "Ticket" | "Contact" | "Comment";

export interface ZohoDeskNodeSpec {
  nodeType: string;
  entity: ZohoDeskEntity;
  /** read → inline zohoGet during the run; write → enqueueJob + drain handler. */
  mode: "read" | "write";
  description: string;
}

export const ZOHO_DESK_NODES: ZohoDeskNodeSpec[] = [
  { nodeType: "zoho_desk_create_ticket", entity: "Ticket", mode: "write", description: "Creates a Zoho Desk Ticket — queued, no AI" },
  { nodeType: "zoho_desk_upsert_contact", entity: "Contact", mode: "write", description: "Finds a Zoho Desk Contact by email then creates or updates it — queued, no AI" },
  { nodeType: "zoho_desk_add_comment", entity: "Comment", mode: "write", description: "Adds a comment to a Zoho Desk Ticket's thread — queued, no AI" },
  { nodeType: "zoho_desk_get_ticket", entity: "Ticket", mode: "read", description: "Fetches one Zoho Desk Ticket by record id — no AI" },
];

export const ZOHO_DESK_NODE_TYPES: string[] = ZOHO_DESK_NODES.map((n) => n.nodeType);

const NODE_SPECS = new Map(ZOHO_DESK_NODES.map((n) => [n.nodeType, n]));

export function isZohoDeskNodeType(nodeType: string): boolean {
  return NODE_SPECS.has(nodeType);
}

export function getZohoDeskNodeSpec(nodeType: string): ZohoDeskNodeSpec | undefined {
  return NODE_SPECS.get(nodeType);
}
