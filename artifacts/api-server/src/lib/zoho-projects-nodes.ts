// Zoho Projects node catalog (#85) — pure data, zero imports.
//
// Same shape as zoho-crm-nodes.ts (#83): dependency-free so
// node-type-registry.ts can derive its entries without pulling in
// zoho-projects.ts and, transitively, @workspace/db.
//
// The node type string and the msp_job_queue jobType string are identical for
// a given node — there is no mapping table to drift. No delete nodes — Zoho
// is the system of record and deletion stays a manual Zoho-side action, same
// rule Zoho CRM established.

export type ZohoProjectsEntity = "Project" | "Tasklist" | "Task" | "Milestone";

export interface ZohoProjectsNodeSpec {
  nodeType: string;
  entity: ZohoProjectsEntity;
  /** read → inline zohoGet during the run; write → enqueueJob + drain handler. */
  mode: "read" | "write";
  description: string;
}

export const ZOHO_PROJECTS_NODES: ZohoProjectsNodeSpec[] = [
  // ── Project (4) ──
  { nodeType: "zoho_create_project", entity: "Project", mode: "write", description: "Creates a Zoho Project — queued, no AI" },
  { nodeType: "zoho_update_project", entity: "Project", mode: "write", description: "Updates a Zoho Project — queued, no AI" },
  { nodeType: "zoho_get_project", entity: "Project", mode: "read", description: "Fetches one Zoho Project by id — no AI" },
  { nodeType: "zoho_list_projects", entity: "Project", mode: "read", description: "Lists Zoho Projects in the portal — no AI" },

  // ── Tasklist (2) ──
  { nodeType: "zoho_create_tasklist", entity: "Tasklist", mode: "write", description: "Creates a Zoho Tasklist within a Project — queued, no AI" },
  { nodeType: "zoho_get_tasklist", entity: "Tasklist", mode: "read", description: "Fetches one Zoho Tasklist by id — no AI" },

  // ── Task (4) ──
  { nodeType: "zoho_create_task", entity: "Task", mode: "write", description: "Creates a Zoho Task — queued, no AI" },
  { nodeType: "zoho_update_task", entity: "Task", mode: "write", description: "Updates a Zoho Task (percent complete, owner, dates, …) — queued, no AI" },
  { nodeType: "zoho_get_task", entity: "Task", mode: "read", description: "Fetches one Zoho Task by id — no AI" },
  { nodeType: "zoho_list_tasks", entity: "Task", mode: "read", description: "Lists Zoho Tasks for a Project (optionally filtered to one Tasklist) — no AI" },

  // ── Milestone (4) ──
  { nodeType: "zoho_create_milestone", entity: "Milestone", mode: "write", description: "Creates a Zoho Milestone — queued, no AI" },
  { nodeType: "zoho_update_milestone", entity: "Milestone", mode: "write", description: "Updates a Zoho Milestone — queued, no AI" },
  { nodeType: "zoho_get_milestone", entity: "Milestone", mode: "read", description: "Fetches one Zoho Milestone by id — no AI" },
  { nodeType: "zoho_list_milestones", entity: "Milestone", mode: "read", description: "Lists Zoho Milestones for a Project — no AI" },
];

export const ZOHO_PROJECTS_NODE_TYPES: string[] = ZOHO_PROJECTS_NODES.map((n) => n.nodeType);

const NODE_SPECS = new Map(ZOHO_PROJECTS_NODES.map((n) => [n.nodeType, n]));

export function isZohoProjectsNodeType(nodeType: string): boolean {
  return NODE_SPECS.has(nodeType);
}

export function getZohoProjectsNodeSpec(nodeType: string): ZohoProjectsNodeSpec | undefined {
  return NODE_SPECS.get(nodeType);
}
