import { apiFetch } from "../api-client.ts";
import { apiBaseUrl } from "../env.ts";
import type { ToolDef } from "./registry.ts";

/** Trivial reachability proof: the real /healthz route, no auth. */
export const platformHealthTool: ToolDef = {
  name: "platform_health",
  description:
    "Liveness check against the running api-server (GET /api/healthz, unauthenticated). " +
    "Proves the MCP server can reach the platform API at all; returns the base URL in use.",
  handler: async () => {
    const health = await apiFetch<{ status: string }>("/healthz", { auth: false });
    return { baseUrl: apiBaseUrl(), health };
  },
};
