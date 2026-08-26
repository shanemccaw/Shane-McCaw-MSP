import { z } from "zod";
import { apiFetch } from "../api-client.ts";
import type { ToolDef } from "./registry.ts";

/**
 * get_customer_findings — the per-customer detail dossier, wrapping the real
 * admin client-detail routes (`/admin/clients/:id/*`): the Command Center
 * (projects, open tasks, recent emails, quiz results, M365 profile,
 * app-registration status) plus the Health Summary (per-category scores, their
 * first→latest delta, and which categories tripped a recent-change alert).
 *
 * `clientId` is the platform customer id — a users.id with role='client', the
 * same id query_customers returns. Both underlying routes are requireAdmin, so
 * the operator token reaches them directly.
 */

const inputSchema = {
  clientId: z.number().int().positive().describe("The platform customer id (users.id, role='client') — as returned by query_customers."),
};

interface CommandCenter {
  client?: Record<string, unknown> & { id?: number; name?: string; email?: string; company?: string };
  projects?: Array<Record<string, unknown>>;
  recentTasks?: Array<Record<string, unknown>>;
  recentEmails?: Array<Record<string, unknown>>;
  quiz?: Record<string, unknown> | null;
  m365Profile?: unknown;
  appRegStatus?: string | null;
  hasM365Profile?: boolean;
}

interface HealthSummary {
  hasData: boolean;
  overallFirst?: number;
  overallLatest?: number;
  overallDelta?: number;
  lastUpdated?: string;
  categories?: Array<{ key: string; label: string; firstScore: number; latestScore: number; delta: number; hasAlert: boolean }>;
}

export const getCustomerFindingsTool: ToolDef = {
  name: "get_customer_findings",
  description:
    "Detailed per-customer dossier for one customer id: their projects and open tasks, recent client emails, quiz " +
    "results, M365 profile and app-registration status (GET /admin/clients/:id/command-center), plus the customer's " +
    "health summary — per-category scores, deltas and which categories have a recent-change alert " +
    "(GET /admin/clients/:id/health/summary). Pass a clientId from query_customers.",
  inputSchema,
  handler: async (args) => {
    const clientId = args.clientId as number;

    // Health summary answers 200 with { hasData:false } for an unscored client;
    // command-center 404s for a non-existent client — let that surface as isError.
    const [cc, health] = await Promise.all([
      apiFetch<CommandCenter>(`/admin/clients/${clientId}/command-center`),
      apiFetch<HealthSummary>(`/admin/clients/${clientId}/health/summary`),
    ]);

    const client = cc.client ?? {};
    return {
      clientId,
      client: {
        id: client.id ?? clientId,
        name: client.name ?? null,
        email: client.email ?? null,
        company: client.company ?? null,
        appRegStatus: cc.appRegStatus ?? null,
        hasM365Profile: cc.hasM365Profile ?? false,
      },
      m365Profile: cc.m365Profile ?? null,
      quiz: cc.quiz ?? null,
      projects: (cc.projects ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        phase: p.phase,
        progress: p.progress,
        projectType: p.projectType,
        taskCounts: p.taskCounts ?? null,
      })),
      openTasks: (cc.recentTasks ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        column: t.column,
        priority: t.priority,
        dueDate: t.dueDate,
        projectTitle: t.projectTitle,
      })),
      recentEmailCount: Array.isArray(cc.recentEmails) ? cc.recentEmails.length : 0,
      health: health.hasData
        ? {
            hasData: true,
            overallFirst: health.overallFirst,
            overallLatest: health.overallLatest,
            overallDelta: health.overallDelta,
            lastUpdated: health.lastUpdated,
            categories: health.categories ?? [],
            alertingCategories: (health.categories ?? []).filter((c) => c.hasAlert),
          }
        : { hasData: false },
    };
  },
};
