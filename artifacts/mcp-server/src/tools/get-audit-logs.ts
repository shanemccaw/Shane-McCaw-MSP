import { z } from "zod";
import { apiFetch } from "../api-client.ts";
import type { ToolDef } from "./registry.ts";

/**
 * get_audit_logs — the platform's two real audit trails:
 *
 *  • source="msp" (default) — the MSP operational audit trail (msp_audit_logs),
 *    every MSP staff action against a customer. msp-audit-log.ts: GET /msp/audit,
 *    requireRole("MSPAdmin"); PlatformAdmin (the operator) sees all MSPs.
 *    Filterable by search, actionType, outcome, from, to.
 *  • source="platform" — the legacy platform audit trail (audit_logs), keyed on
 *    the acting client. audit-logs.ts: GET /audit-logs, requireAdmin. Filterable
 *    by entityType, from, to.
 */

const inputSchema = {
  source: z.enum(["msp", "platform"]).optional().describe('"msp" (default) = MSP operational trail; "platform" = legacy platform audit_logs.'),
  search: z.string().optional().describe("MSP trail only: substring match on action/entity/actor."),
  actionType: z.string().optional().describe("MSP trail: filter by action type. Platform trail: maps to entityType."),
  outcome: z.enum(["success", "failure", "partial"]).optional().describe("MSP trail only: filter by outcome."),
  from: z.string().optional().describe("ISO date/datetime lower bound."),
  to: z.string().optional().describe("ISO date/datetime upper bound."),
  page: z.number().int().positive().optional().describe("1-based page (default 1)."),
  limit: z.number().int().positive().max(100).optional().describe("Max entries per page (default 30 msp / 25 platform)."),
};

export const getAuditLogsTool: ToolDef = {
  name: "get_audit_logs",
  description:
    "Filterable audit trail. source=msp (default) is the MSP operational trail (every staff action against a " +
    "customer, GET /msp/audit) — filter by search/actionType/outcome/from/to. source=platform is the legacy " +
    "platform audit_logs (GET /audit-logs) — filter by actionType(=entityType)/from/to. Newest first, paginated.",
  inputSchema,
  handler: async (args) => {
    const source = (args.source as string) === "platform" ? "platform" : "msp";
    const page = typeof args.page === "number" ? args.page : undefined;
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const from = typeof args.from === "string" ? args.from : undefined;
    const to = typeof args.to === "string" ? args.to : undefined;

    if (source === "platform") {
      const res = await apiFetch<{ entries: unknown[]; total: number; page: number; pageSize: number }>("/audit-logs", {
        query: {
          page,
          limit,
          from,
          to,
          entityType: typeof args.actionType === "string" ? args.actionType : undefined,
        },
      });
      return { source, total: res.total, page: res.page, pageSize: res.pageSize, count: res.entries?.length ?? 0, entries: res.entries };
    }

    const res = await apiFetch<{ entries: unknown[]; total: number; page: number; limit: number }>("/msp/audit", {
      query: {
        page,
        limit,
        from,
        to,
        search: typeof args.search === "string" ? args.search : undefined,
        actionType: typeof args.actionType === "string" ? args.actionType : undefined,
        outcome: typeof args.outcome === "string" ? args.outcome : undefined,
      },
    });
    return { source, total: res.total, page: res.page, limit: res.limit, count: res.entries?.length ?? 0, entries: res.entries };
  },
};
