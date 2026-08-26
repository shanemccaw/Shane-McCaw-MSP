import { apiFetch } from "../api-client.ts";
import { resolveOperatorIdentity } from "../auth.ts";
import type { ToolDef } from "./registry.ts";

/**
 * End-to-end auth proof: reports the operator identity this server runs as,
 * then calls a real admin-only route (GET /admin/clients/enriched, the same
 * requireAdmin-gated route the Admin Panel's client list reads) with a
 * minted session token. If that call answers 200, the whole chain — identity
 * resolution from the real DB, JWT minting with the platform's own secret,
 * requireAdmin acceptance — is proven, not assumed.
 */
export const whoamiTool: ToolDef = {
  name: "whoami",
  description:
    "Reports which platform account this MCP server is operating as, and verifies admin access " +
    "end to end by calling the admin-only client list route with a real minted session token " +
    "(returns the live customer count, not the full list).",
  handler: async () => {
    const op = await resolveOperatorIdentity();
    const clients = await apiFetch<unknown[]>("/admin/clients/enriched");
    return {
      operator: {
        id: op.id,
        email: op.email,
        name: op.name,
        role: op.role,
        mspRole: op.mspRole,
        mspId: op.mspId,
      },
      adminAccessVerified: true,
      liveCustomerCount: Array.isArray(clients) ? clients.length : null,
    };
  },
};
