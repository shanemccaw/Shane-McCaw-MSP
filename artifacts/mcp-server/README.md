# @workspace/mcp-server — Shane's operating MCP server

MCP (Model Context Protocol) server exposing real platform capability as
tools, so Shane can ask natural-language questions and execute real actions
from Claude, grounded in real query results. This is Shane's **own operating
tool against his own platform** — it is not customer-facing and it always
runs as Shane. Epic: Git #1319; this scaffolding phase: Git #1320.

## How it works (the pattern every later phase follows)

```
Claude (MCP client, stdio)
   │  JSON-RPC over stdio            ← stdout is protocol-only; ALL logs go to stderr
   ▼
src/index.ts        boots: load .env.local → resolve operator → register tools → serve
   │
   ▼
src/tools/*.ts      one file per tool (ToolDef: name/description/inputSchema/handler)
   │  handler calls apiFetch("/route/path", …)
   ▼
src/api-client.ts   HTTP against the RUNNING api-server (default http://localhost:8080/api)
   │  Authorization: Bearer <minted JWT>
   ▼
src/auth.ts         operator identity from the real users table (role='admin' enforced)
                    + short-lived JWT signed with the platform's own JWT_SECRET
   ▼
api-server          real routes, real requireAuth/requireAdmin/requireRole middleware,
                    real request logging + audit attribution — zero api-server changes
```

### Why auth works this way

`requireAuth` verifies a Bearer JWT signed with `JWT_SECRET` and reads the
claims `buildUserPayload` (routes/auth.ts) puts in a login session: `id`,
`email`, `name`, `role`, `mspRole`, `mspId`, `customerId`, `mspSlug`.
`src/auth.ts` resolves Shane's **real users row** from the same local
Postgres the api-server uses, refuses to run as any non-`admin` row, and
signs that exact claim shape with the same secret, 15-minute TTL, re-minted
automatically before expiry. To the api-server the session is
indistinguishable from Shane logging in — so every tool call flows through
the real middleware stack (role gates, per-request log enrichment with
mspId/customerId, audit actor attribution) with **no parallel auth mechanism
and no api-server modifications**. Tools never talk to the DB directly; the
only direct DB touch in this package is the one identity lookup at startup.

### Error surfacing

- `apiFetch` throws `ApiError` on any non-2xx answer, carrying the real
  status code and the route's own error body (`{ error: "..." }`).
- The registry wrapper (src/tools/registry.ts) catches anything a handler
  throws and returns an MCP `isError` text result with the real message —
  the model sees the api-server's actual refusal, never a paraphrase, and
  never a fake-successful result.
- Every call (ok or failed) is logged to stderr with tool name, duration,
  and for ApiError the status + path, under channel `admin.mcp`.

### Tool results

Handlers return raw JSON-serializable data; the registry stringifies it into
the MCP text content. Handlers never build MCP envelopes and never fabricate
fields the API didn't return.

## Adding a tool (Phase 2–5)

1. Create `src/tools/<your-tool>.ts` exporting a `ToolDef`:

   ```ts
   import { z } from "zod";
   import { apiFetch } from "../api-client.ts";
   import type { ToolDef } from "./registry.ts";

   const args = { customerId: z.number().describe("tenants.id of the customer") };

   export const myTool: ToolDef = {
     name: "my_tool",
     description: "What it really does, including which real route it calls.",
     inputSchema: args,
     handler: async (raw) => {
       const { customerId } = raw as { customerId: number }; // SDK already validated
       return apiFetch(`/admin/clients/${customerId}/health/summary`);
     },
   };
   ```

2. Append it to `ALL_TOOLS` in `src/tools/index.ts`. That's the entire
   registration surface.

Rules that hold for every tool:
- Go through `apiFetch` → real routes. No direct-DB query tools, no cached
  answers presented as live.
- Let errors throw. The registry surfaces them honestly.
- Write tools (Phase 4+) operate on **real production tenants** per Shane's
  explicit decision on #1319 — mandatory audit logging is its own phase and
  the primary safety net. Until that audit phase lands, do not add write
  tools casually.

## Running / registering

- Registered in the repo root `.mcp.json` as `shane-msp` — any Claude Code
  session in this repo picks it up. No build step: Node ≥ 23 runs the
  TypeScript sources directly (type stripping; `erasableSyntaxOnly` is
  enforced by tsconfig so the sources stay strippable).
- Requirements at runtime: the local dev api-server up on :8080, and the
  repo root `.env.local` providing `JWT_SECRET` + `DATABASE_URL`.
- Manual run: `pnpm --dir artifacts/mcp-server start` (speaks MCP on stdio).
- For Claude Desktop or other machines, register command `node` with args
  `["<absolute repo path>/artifacts/mcp-server/src/index.ts"]`.

Env overrides: `MCP_API_BASE_URL` (default `http://localhost:8080/api` —
point at Staging to operate there), `MCP_OPERATOR_EMAIL` (default
`shane@shanemccaw.com`; the resolved row must have `role='admin'`).

## Verification

- `pnpm --dir artifacts/mcp-server typecheck` — tsc, no emit.
- `pnpm --dir artifacts/mcp-server e2e` — spawns the real server, does the
  real MCP handshake over stdio, and calls both tools against the live local
  api-server + Postgres (no mocks). `whoami` passing means the minted token
  was accepted by a real `requireAdmin` route.
