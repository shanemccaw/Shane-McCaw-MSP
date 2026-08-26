import { z } from "zod";
import { apiFetch } from "../api-client.ts";
import type { ToolDef } from "./registry.ts";

/**
 * get_change_controls — the operator's change requests (msp_changes.ts's real
 * GET /msp/change-requests, requireRole MSPOperator, scoped by
 * resolveMspIdStrict). Returns the CRs newest-first with their human CR-2026-XXX
 * ids, optionally narrowed to a single status.
 */

const CR_STATUSES = ["pending_approval", "scheduled", "in_progress", "completed", "rolled_back", "rejected"] as const;

const inputSchema = {
  status: z.enum(CR_STATUSES).optional().describe("Narrow to a single change-request status."),
  limit: z.number().int().positive().max(500).optional().describe("Max change requests to return (default 100)."),
};

interface ChangeRequest {
  id: string; // formatted CR-2026-XXX
  tenantName?: string;
  title?: string;
  status?: string;
  changeClass?: string;
  riskLevel?: string;
  category?: string;
  requestedBy?: string;
  requestedAt?: string;
  scheduledFor?: string;
  approvedBy?: string | null;
  executedAt?: string | null;
  [k: string]: unknown;
}

export const getChangeControlsTool: ToolDef = {
  name: "get_change_controls",
  description:
    "The operator's change requests / change-control records across their customers (GET /msp/change-requests), " +
    "newest first, with their CR-2026-XXX ids. Optionally filter to one status " +
    "(pending_approval, scheduled, in_progress, completed, rolled_back, rejected).",
  inputSchema,
  handler: async (args) => {
    const status = args.status as string | undefined;
    const limit = typeof args.limit === "number" ? args.limit : 100;

    const rows = await apiFetch<ChangeRequest[]>("/msp/change-requests");
    let list = Array.isArray(rows) ? rows : [];
    if (status) list = list.filter((c) => c.status === status);

    const byStatus: Record<string, number> = {};
    for (const c of Array.isArray(rows) ? rows : []) {
      if (c.status) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    }

    return {
      count: list.length,
      totalChangeControls: Array.isArray(rows) ? rows.length : 0,
      byStatus,
      filter: { status: status ?? null },
      changeControls: list.slice(0, limit).map((c) => ({
        id: c.id,
        title: c.title,
        tenantName: c.tenantName,
        status: c.status,
        changeClass: c.changeClass,
        riskLevel: c.riskLevel,
        category: c.category,
        requestedBy: c.requestedBy,
        requestedAt: c.requestedAt,
        scheduledFor: c.scheduledFor,
        approvedBy: c.approvedBy ?? null,
        executedAt: c.executedAt ?? null,
      })),
    };
  },
};
