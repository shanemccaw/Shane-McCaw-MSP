import { z } from "zod";
import { apiFetch } from "../api-client.ts";
import type { ToolDef } from "./registry.ts";

/**
 * get_alerts — recent alert firings, from either of the two real alert engines:
 *
 *  • source="customer" (default) — customer-tenant alerts: conditions on a
 *    monitored customer's M365 tenant (findings, drift, billing, …).
 *    admin-customer-alert-rules.ts: GET /admin/customer-alert-events (+ the rule
 *    catalog via GET /admin/customer-alert-rules).
 *  • source="platform" — MSP platform-ops alerts: DLQ backlog, billing failure,
 *    SLA breach, etc. admin-observability.ts: GET /admin/observability/alert-events
 *    (+ /admin/observability/alert-rules).
 *
 * Both surfaces are requireAdmin, reachable as the operator.
 */

const inputSchema = {
  source: z
    .enum(["customer", "platform"])
    .optional()
    .describe('"customer" (default) = customer-tenant alerts; "platform" = MSP platform-ops alerts.'),
  unresolvedOnly: z.boolean().optional().describe("Only return events not yet resolved. Default false."),
  includeRules: z.boolean().optional().describe("Also return the rule catalog for the chosen source. Default false."),
  limit: z.number().int().positive().max(200).optional().describe("Max events to return (default 50)."),
};

export const getAlertsTool: ToolDef = {
  name: "get_alerts",
  description:
    "Recent alert firings. source=customer (default) returns customer-tenant alerts (conditions on a monitored " +
    "customer's M365 tenant); source=platform returns MSP platform-ops alerts (DLQ, billing, SLA). unresolvedOnly " +
    "limits to open events; includeRules also returns the rule catalog. Newest first.",
  inputSchema,
  handler: async (args) => {
    const source = (args.source as string) === "platform" ? "platform" : "customer";
    const unresolvedOnly = args.unresolvedOnly === true;
    const includeRules = args.includeRules === true;
    const limit = typeof args.limit === "number" ? args.limit : 50;

    const query = { limit, unresolvedOnly: unresolvedOnly ? "true" : undefined };

    if (source === "platform") {
      const events = await apiFetch<{ events: unknown[] }>("/admin/observability/alert-events", { query });
      const rules = includeRules
        ? await apiFetch<{ rules: unknown[] }>("/admin/observability/alert-rules")
        : null;
      const list = events.events ?? [];
      return {
        source,
        unresolvedOnly,
        count: list.length,
        events: list,
        ...(rules ? { rules: rules.rules ?? [] } : {}),
      };
    }

    const events = await apiFetch<{ events: unknown[] }>("/admin/customer-alert-events", { query });
    const rules = includeRules ? await apiFetch<{ rules: unknown[] }>("/admin/customer-alert-rules") : null;
    const list = events.events ?? [];
    return {
      source,
      unresolvedOnly,
      count: list.length,
      events: list,
      ...(rules ? { rules: rules.rules ?? [] } : {}),
    };
  },
};
