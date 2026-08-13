// Zoho Books node catalog (#87) — pure data, zero imports.
//
// Same shape as zoho-projects-nodes.ts / zoho-crm-nodes.ts: dependency-free
// so node-type-registry.ts can derive its entries without pulling in
// zoho-books.ts and, transitively, @workspace/db.
//
// Invisible sync only — no UI anywhere reads these. Write-only, no
// admin-facing read/list nodes (unlike CRM/Projects), per #87's explicit
// scope: this is one-way outbound sync of financial facts, not something
// read back into the platform. No delete, no update-after-creation nodes —
// Zoho Books is the system of record for accounting; corrections happen
// manually in Zoho.
//
// The node type string and the msp_job_queue jobType string are identical for
// a given node — there is no mapping table to drift, same discipline CRM and
// Projects established.

export type ZohoBooksEntity = "Contact" | "Invoice" | "Payment" | "Expense";

export interface ZohoBooksNodeSpec {
  nodeType: string;
  entity: ZohoBooksEntity;
  mode: "write";
  description: string;
}

export const ZOHO_BOOKS_NODES: ZohoBooksNodeSpec[] = [
  { nodeType: "zoho_books_upsert_contact", entity: "Contact", mode: "write", description: "Finds a Zoho Books Contact by email, creates or updates it — queued, no AI" },
  { nodeType: "zoho_books_create_invoice", entity: "Invoice", mode: "write", description: "Creates a Zoho Books Invoice, idempotent via reference_number (local Stripe invoice/session id) — queued, no AI" },
  { nodeType: "zoho_books_record_payment", entity: "Payment", mode: "write", description: "Records a Zoho Books Customer Payment against an invoice — queued, no AI" },
  { nodeType: "zoho_books_create_expense", entity: "Expense", mode: "write", description: "Posts one day's AI/Anthropic cost rollup as a Zoho Books Expense, idempotent via reference_number (the date) — queued, no AI" },
];

export const ZOHO_BOOKS_NODE_TYPES: string[] = ZOHO_BOOKS_NODES.map((n) => n.nodeType);

const NODE_SPECS = new Map(ZOHO_BOOKS_NODES.map((n) => [n.nodeType, n]));

export function isZohoBooksNodeType(nodeType: string): boolean {
  return NODE_SPECS.has(nodeType);
}

export function getZohoBooksNodeSpec(nodeType: string): ZohoBooksNodeSpec | undefined {
  return NODE_SPECS.get(nodeType);
}
