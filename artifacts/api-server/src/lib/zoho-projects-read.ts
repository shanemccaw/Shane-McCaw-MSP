// Zoho Projects read/list passthrough (#85), mirroring zoho-read.ts (#82).
//
// Synchronous, paginated list/get reads against Zoho Projects for the
// zoho_get_*/zoho_list_* workflow nodes zoho-projects.ts dispatches. Per the
// "never leave the platform" principle these reads back page loads directly —
// deliberately NOT routed through msp_job_queue: a page waiting on a Zoho GET
// is fine, only writes get deferred to the 5-minute drain.
//
// #1574 (2026-08-30): msp-portal's own Zoho Projects board and its API
// (portal-zoho-projects.ts, projects.zoho_project_id) were removed — the
// board's page was deleted when artifacts/msp-portal was retired and nothing
// ever linked a local project to a Zoho one (zoho_project_id was NULL on all
// 6 rows). This module's read surface stays: it backs the workflow-automation
// node layer below, which is genuinely wired into node-type-registry.ts /
// workflow-executor.ts the same way Zoho CRM/Desk/Books nodes are.
//
// Also owns Zoho Projects' portal id resolution — a Projects-specific
// concept zoho-client.ts deliberately stays out of ("No CRM-specific logic
// belongs in this file" — same rule applies to any one product). Portal id
// isn't known at OAuth callback time (unlike zoho_connection.zohoOrgId,
// captured then), so it's resolved lazily here on first use and cached on
// zoho_connection.zohoPortalId. Both zoho-projects.ts (writes) and this file
// (reads) need it, so it lives in the read module both build on.

import { zohoGet, ZOHO_DEFAULT_MSP_ID, getZohoConnection } from "./zoho-client.ts";
import { db, zohoConnectionTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.zoho" });

// #1162: found alongside the Zoho Desk base-URL bug this same issue fixed.
// Zoho Projects, like Desk, does NOT live on the unified www.zohoapis.com
// gateway CRM/Books use -- its real API root is projectsapi.zoho.com/api/v3.
// This file's own header still says "Endpoints NOT live-verified", same
// caveat Desk's file carried before today -- never live-tested, so this
// never surfaced until now.
export const ZOHO_PROJECTS_API_HOST = process.env.ZOHO_PROJECTS_API_BASE_URL ?? "https://projectsapi.zoho.com";

export type ZohoProjectsEnvelopeEntity = "Project" | "Tasklist" | "Task" | "Milestone";

const ENVELOPE_KEY: Record<ZohoProjectsEnvelopeEntity, string> = {
  Project: "projects",
  Tasklist: "tasklists",
  Task: "tasks",
  Milestone: "milestones",
};

interface ZohoPortalsResponse {
  portals?: Array<{ id?: string | number; name?: string }>;
}

/**
 * Returns the cached zoho_connection.zohoPortalId, or resolves it via
 * GET /api/v3/portals/ (the account's accessible portals) and caches the
 * first one — this integration is single-portal-per-MSP by construction, same
 * single-tenant shape ZOHO_DEFAULT_MSP_ID already assumes for the connection
 * itself.
 */
export async function resolveZohoPortalId(mspId: number = ZOHO_DEFAULT_MSP_ID): Promise<string> {
  const connection = await getZohoConnection(mspId);
  if (connection?.zohoPortalId) return connection.zohoPortalId;

  const body = (await zohoGet("/api/v3/portals/", undefined, mspId, undefined, ZOHO_PROJECTS_API_HOST)) as ZohoPortalsResponse;
  const first = Array.isArray(body.portals) ? body.portals[0] : undefined;
  if (!first || first.id === undefined || first.id === null) {
    throw new Error("Zoho Projects: no portal found for this connection — confirm Zoho Projects is enabled for the account");
  }
  const portalId = String(first.id);

  await db
    .update(zohoConnectionTable)
    .set({ zohoPortalId: portalId, updatedAt: new Date() })
    .where(eq(zohoConnectionTable.mspId, mspId));

  log.info({ mspId, portalId, portalName: first.name }, "zoho-projects-read: resolved and cached portal id");
  return portalId;
}

/** `/api/v3/portal/{portal_id}` — the prefix every Zoho Projects call below builds on. */
export function zohoProjectsBasePath(portalId: string): string {
  return `/api/v3/portal/${encodeURIComponent(portalId)}`;
}

function firstFromEnvelope(body: Record<string, unknown>, entity: ZohoProjectsEnvelopeEntity): Record<string, unknown> | null {
  const arr = body[ENVELOPE_KEY[entity]];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return (arr[0] ?? null) as Record<string, unknown> | null;
}

function listFromEnvelope(body: Record<string, unknown>, entity: ZohoProjectsEnvelopeEntity): Array<Record<string, unknown>> {
  const arr = body[ENVELOPE_KEY[entity]];
  return Array.isArray(arr) ? (arr as Array<Record<string, unknown>>) : [];
}

/** Zoho Projects paginates with index (1-based start row) + range (page size), not page/per_page. */
export function normalizeZohoProjectsPaging(page?: number, perPage?: number): { index: number; range: number; page: number; perPage: number } {
  const p = Number.isFinite(page) && (page as number) >= 1 ? Math.floor(page as number) : 1;
  const range = Number.isFinite(perPage) && (perPage as number) >= 1 ? Math.min(Math.floor(perPage as number), 200) : 50;
  return { index: (p - 1) * range + 1, range, page: p, perPage: range };
}

export interface ZohoProjectsListResult {
  records: Array<Record<string, unknown>>;
  page: number;
  perPage: number;
}

// ── Project ──────────────────────────────────────────────────────────────────

export async function listProjects(params: { page?: number; perPage?: number; mspId?: number } = {}): Promise<ZohoProjectsListResult> {
  const portalId = await resolveZohoPortalId(params.mspId);
  const { index, range, page, perPage } = normalizeZohoProjectsPaging(params.page, params.perPage);
  const body = await zohoGet(`${zohoProjectsBasePath(portalId)}/projects/`, { index, range }, params.mspId, undefined, ZOHO_PROJECTS_API_HOST);
  const records = listFromEnvelope(body, "Project");
  log.debug({ page, perPage, count: records.length }, "zoho-projects-read: listed projects");
  return { records, page, perPage };
}

export async function getProject(projectId: string, mspId?: number): Promise<Record<string, unknown> | null> {
  const portalId = await resolveZohoPortalId(mspId);
  const body = await zohoGet(`${zohoProjectsBasePath(portalId)}/projects/${encodeURIComponent(projectId)}/`, undefined, mspId, undefined, ZOHO_PROJECTS_API_HOST);
  return firstFromEnvelope(body, "Project");
}

// ── Tasklist ─────────────────────────────────────────────────────────────────

export async function getTasklist(projectId: string, tasklistId: string, mspId?: number): Promise<Record<string, unknown> | null> {
  const portalId = await resolveZohoPortalId(mspId);
  const body = await zohoGet(`${zohoProjectsBasePath(portalId)}/projects/${encodeURIComponent(projectId)}/tasklists/${encodeURIComponent(tasklistId)}/`, undefined, mspId, undefined, ZOHO_PROJECTS_API_HOST);
  return firstFromEnvelope(body, "Tasklist");
}

// ── Task ─────────────────────────────────────────────────────────────────────

export async function listTasks(projectId: string, params: { page?: number; perPage?: number; tasklistId?: string; mspId?: number } = {}): Promise<ZohoProjectsListResult> {
  const portalId = await resolveZohoPortalId(params.mspId);
  const { index, range, page, perPage } = normalizeZohoProjectsPaging(params.page, params.perPage);
  const query: Record<string, string | number | undefined> = { index, range };
  if (params.tasklistId) query.tasklist_id = params.tasklistId;
  const body = await zohoGet(`${zohoProjectsBasePath(portalId)}/projects/${encodeURIComponent(projectId)}/tasks/`, query, params.mspId, undefined, ZOHO_PROJECTS_API_HOST);
  const records = listFromEnvelope(body, "Task");
  log.debug({ projectId, page, perPage, count: records.length }, "zoho-projects-read: listed tasks");
  return { records, page, perPage };
}

export async function getTask(projectId: string, taskId: string, mspId?: number): Promise<Record<string, unknown> | null> {
  const portalId = await resolveZohoPortalId(mspId);
  const body = await zohoGet(`${zohoProjectsBasePath(portalId)}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/`, undefined, mspId, undefined, ZOHO_PROJECTS_API_HOST);
  return firstFromEnvelope(body, "Task");
}

// ── Milestone ────────────────────────────────────────────────────────────────

export async function listMilestones(projectId: string, params: { page?: number; perPage?: number; mspId?: number } = {}): Promise<ZohoProjectsListResult> {
  const portalId = await resolveZohoPortalId(params.mspId);
  const { index, range, page, perPage } = normalizeZohoProjectsPaging(params.page, params.perPage);
  const body = await zohoGet(`${zohoProjectsBasePath(portalId)}/projects/${encodeURIComponent(projectId)}/milestones/`, { index, range }, params.mspId, undefined, ZOHO_PROJECTS_API_HOST);
  const records = listFromEnvelope(body, "Milestone");
  log.debug({ projectId, page, perPage, count: records.length }, "zoho-projects-read: listed milestones");
  return { records, page, perPage };
}

export async function getMilestone(projectId: string, milestoneId: string, mspId?: number): Promise<Record<string, unknown> | null> {
  const portalId = await resolveZohoPortalId(mspId);
  const body = await zohoGet(`${zohoProjectsBasePath(portalId)}/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}/`, undefined, mspId, undefined, ZOHO_PROJECTS_API_HOST);
  return firstFromEnvelope(body, "Milestone");
}
