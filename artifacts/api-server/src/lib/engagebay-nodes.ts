// EngageBay node catalog (EngageBay Webhooks + Workflow Nodes, #105) — pure
// data, zero imports. Mirrors zoho-crm-nodes.ts.
//
// Deliberately dependency-free so `node-type-registry.ts` (which is imported by
// tests that run without a DATABASE_URL) can derive its EngageBay entries from
// the same list the executor and the job handlers use, without pulling in
// `engagebay-nodes-exec.ts` and, transitively, `@workspace/db`.
//
// The node type string and the msp_job_queue jobType string are identical for a
// given node — there is no mapping table to drift.
//
// Scope is #104's confirmed client methods only (createContact/updateContact/
// addTag/startSequence, getContact/getContactByEmail/listContacts~searchContacts/
// listTags). No sequence-list/sequence-membership nodes — listSequences and
// getSequenceMembership still throw EngageBayUnverifiedEndpointError pending
// live-account verification.

export interface EngageBayNodeSpec {
  nodeType: string;
  /** read → inline engagebay client call during the run; write → enqueueJob + drain handler. */
  mode: "read" | "write";
  description: string;
}

export const ENGAGEBAY_NODES: EngageBayNodeSpec[] = [
  // ── Write (queued) ──
  { nodeType: "engagebay_create_contact", mode: "write", description: "Creates an EngageBay contact — queued, no AI" },
  { nodeType: "engagebay_update_contact", mode: "write", description: "Updates an EngageBay contact — queued, no AI" },
  { nodeType: "engagebay_add_tag", mode: "write", description: "Adds a tag to an EngageBay contact — queued, no AI" },
  { nodeType: "engagebay_start_sequence", mode: "write", description: "Enrolls an EngageBay contact into a sequence — queued, no AI" },

  // ── Read (inline) ──
  { nodeType: "engagebay_get_contact", mode: "read", description: "Fetches one EngageBay contact by id — no AI" },
  { nodeType: "engagebay_get_contact_by_email", mode: "read", description: "Fetches one EngageBay contact by email address — no AI" },
  { nodeType: "engagebay_search_contacts", mode: "read", description: "Searches EngageBay contacts by query — no AI" },
  { nodeType: "engagebay_list_tags", mode: "read", description: "Lists all tags in the EngageBay account — no AI" },
];

export const ENGAGEBAY_NODE_TYPES: string[] = ENGAGEBAY_NODES.map((n) => n.nodeType);

const NODE_SPECS = new Map(ENGAGEBAY_NODES.map((n) => [n.nodeType, n]));

export function isEngageBayNodeType(nodeType: string): boolean {
  return NODE_SPECS.has(nodeType);
}

export function getEngageBayNodeSpec(nodeType: string): EngageBayNodeSpec | undefined {
  return NODE_SPECS.get(nodeType);
}
