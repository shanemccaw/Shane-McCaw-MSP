import { z } from "zod";
import { apiFetch } from "../api-client.ts";
import type { ToolDef } from "./registry.ts";

/**
 * get_microsoft_drift — "what is Microsoft doing to us this week": itemized
 * configuration drift on the operator's monitored customer tenants, from the
 * Configuration Drift engine's drift_events (#1270 producer + #1290
 * open/resolved/reopened lifecycle).
 *
 * There was no read endpoint over drift_events before this phase — this tool
 * wraps the NEW GET /admin/drift/events (added in the same #1322 change).
 * Defaults to the last 7 days of ACTIVE drift (open + reopened) across all
 * tenants, and the summary foregrounds `unapprovedChanges` — currently-drifted
 * settings with no approved change request covering them, which is the risk the
 * engine exists to surface.
 */

const inputSchema = {
  tenantId: z.string().optional().describe("Narrow to a single M365 tenant id."),
  domainKey: z.string().optional().describe('Drift domain slug, e.g. "ca-policy".'),
  status: z
    .enum(["active", "open", "reopened", "resolved", "all"])
    .optional()
    .describe('"active" (default) = open+reopened; a single status; or "all".'),
  verdict: z
    .enum(["unattributed", "attributed_unapproved", "approved", "informational"])
    .optional()
    .describe("Filter by attribution verdict."),
  sinceDays: z
    .number()
    .int()
    .min(0)
    .max(365)
    .optional()
    .describe("Look-back window in days (default 7). 0 = no time window (full history)."),
  limit: z.number().int().positive().max(500).optional().describe("Max events to return (default 100)."),
};

export const getMicrosoftDriftTool: ToolDef = {
  name: "get_microsoft_drift",
  description:
    '"What is Microsoft doing to us this week" — itemized configuration drift on monitored customer tenants ' +
    "(GET /admin/drift/events over the drift engine's drift_events). Defaults to the last 7 days of active drift " +
    "(open+reopened) across all tenants. The summary highlights unapprovedChanges — drifted settings with no " +
    "approved change request covering them. Filter by tenantId, domainKey, status, verdict, or sinceDays.",
  inputSchema,
  handler: async (args) => {
    const query: Record<string, string | number | undefined> = {
      tenantId: typeof args.tenantId === "string" && args.tenantId.trim() ? args.tenantId.trim() : undefined,
      domainKey: typeof args.domainKey === "string" && args.domainKey.trim() ? args.domainKey.trim() : undefined,
      status: typeof args.status === "string" ? args.status : undefined,
      verdict: typeof args.verdict === "string" ? args.verdict : undefined,
      sinceDays: typeof args.sinceDays === "number" ? args.sinceDays : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
    };
    return await apiFetch("/admin/drift/events", { query });
  },
};
