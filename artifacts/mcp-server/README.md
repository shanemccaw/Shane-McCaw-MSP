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
only direct DB touches in this package are the one identity lookup at
startup and the mandatory audit-trail writes (see "Mandatory audit logging"
below for why those are deliberately not routed through the api-server).

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

## Mandatory audit logging (Phase 6 — Git #1325)

Every tool call this server executes lands as a real row in
`msp_audit_logs` — the **same** trail the api-server's own routes write and
the same one `GET /api/msp/audit` (api-server/src/routes/msp-audit-log.ts)
reads. Nothing parallel: filter with `actionType=mcp.tool` on the existing
surface. Each row records the actor (Shane's real users row), the MSP, the
target tenant (`customer_id`), `action_type` = `mcp.tool.<name>`, outcome,
timestamp, and jsonb metadata carrying the **full tool parameters
verbatim**, the real (size-capped) result or error, duration, and the actual
API calls the tool made (`metadata.apiCalls`). Audit lines also go to stderr
under the platform taxonomy's own `audit` channel (src/logger.ts).

- **Read tools** — the default; no declaration needed. One best-effort row
  after the call; an audit failure is logged loudly but never breaks a read.
- **Write tools** must declare their posture on the ToolDef:

  ```ts
  audit: { access: "write", tenantArg: "customerId", entityType: "change_request", entityIdArg: "crId" }
  ```

  Their audit is **write-ahead and fail-closed**: an attempt row (outcome
  `partial`, `metadata.phase: "attempt"`) is durably inserted BEFORE the
  handler runs — if that insert fails, the tool is refused (`AUDIT REFUSAL`
  isError; no audit, no write). After the handler settles the same row is
  finalized to `success`/`failure` with the real result/error. A row left at
  `partial`/`attempt` means the process died mid-call: attempted, completion
  unknown — an honest record, never a silent gap.
- **Structural enforcement, not convention**: `apiFetch` refuses
  POST/PATCH/PUT/DELETE unless the running tool declared
  `access: "write"` and its attempt row is persisted (src/audit.ts
  `guardApiMutation`). A Phase 4/5 tool that forgets the declaration is
  blocked at runtime, not silently under-audited.
- **Secrets never persist in the trail**: a ToolDef's audit spec may name
  args in `redactParams` (e.g. `redactParams: ["code", "password"]` on
  `create_account`) — those values are masked to `[redacted]` in the row's
  `metadata.params` while the handler still receives them and the call stays
  fully audited. Same doctrine as the routes' own "the code is never logged".
- Phase 4/5 tools can also call `recordAuditEvent()` /
  `finalizeAuditEvent()` (src/audit.ts) directly for extra per-entity rows
  inside one call — they inherit the call's correlation id automatically, so
  the trail groups them with the parent tool call.
- The audit write goes **direct to the local Postgres**, not through the
  api-server, on purpose: the trail must capture attempts and failures even
  when the api-server is down or dies mid-call (exactly the moments a safety
  net exists for), and an HTTP "write my audit log" endpoint would be a
  spoofable surface the platform doesn't need.

## Query tools (Phase 3, Git #1322)

Read-only tools wrapping real existing endpoints. Every one runs as the
operator (PlatformAdmin, `mspId=1`) and returns real data — verified against a
real customer at land time.

| Tool | Real route(s) |
|------|---------------|
| `query_customers` | `GET /admin/clients/enriched` — filterable by any of the 7 pillar scores + name/company/email |
| `get_customer_findings` | `GET /admin/clients/:id/command-center` + `GET /admin/clients/:id/health/summary` |
| `get_running_sops` | `GET /msp/sops` + `GET /msp/sop-runs` |
| `get_change_controls` | `GET /msp/change-requests` |
| `get_alerts` | customer: `GET /admin/customer-alert-events` (+ `/customer-alert-rules`); platform: `GET /admin/observability/alert-events` (+ `/alert-rules`) |
| `get_audit_logs` | msp: `GET /msp/audit`; platform: `GET /audit-logs` |
| `get_invoices` | `GET /admin/invoices` (+ `GET /zoho/auth/status`) |
| `get_risk_register` | `GET /msp/rbd` |
| `get_microsoft_drift` | `GET /admin/drift/events` — **new** read endpoint over `drift_events` added in the same change (there was none) |

Two things worth knowing:

- **SOPs and the risk register wrap the MSP-operator surfaces, not the portal
  ones.** The issue named `portal-sops.ts` / `portal-risk-register.ts`, but every
  GET there is `requireRole("CustomerUser")` and reads the tenant off the JWT's
  `customerId` claim — which the operator (no `customerId`) does not carry, so
  those routes answer 403 for this server. `get_running_sops` / `get_risk_register`
  wrap the MSP-operator siblings (`msp-sops.ts`, `msp-rbd.ts`) that read the SAME
  tables and ARE reachable as the operator.
- **`get_invoices` reports Zoho Books honestly.** The invoices are the
  platform's own Stripe/onboarding records; Zoho Books (#87) is outbound-only and
  is never read back into the platform, so the tool annotates that explicitly
  rather than presenting the figures as a live Books sync.

Tickets and scan results are **deliberately not covered** — both are confirmed
real backend gaps (only a single-ticket-by-id customer route exists; no scan
query endpoint at all). Filing those is their own follow-up, not a fabricated
response shape here.

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
  explicit decision on #1319 — mandatory audit logging (Git #1325, above) is
  the primary safety net. Any tool that mutates state MUST declare
  `audit: { access: "write", ... }` on its ToolDef; apiFetch refuses
  mutating methods from tools that don't.

## execute_write_pack (Phase 5 — Git #1324)

Full config-pack execution as a write tool: wraps the real
`POST /admin/config-packs/:packKey/run` (api-server
routes/admin-config-pack-run.ts → lib/config-pack-orchestrator.ts — the
same engine the purchase flow fires; no second execution path). The pack is
materialized into a real Workflow Definition + published Version and fired
through the standard Workflow Engine, so the run appears on the Workflow
Runs page and performs REAL Graph writes against the customer's real
connected tenant. `planOnly: true` previews the real materialized plan
(step order, gate position, `operatorVariables`) without executing
anything. Declared `audit: { access: "write" }`, so every call is
write-ahead audited per Phase 6 above. The engine's own v1 guard currently
refuses non-testbed customers (`customer_not_testbed`) and is surfaced
verbatim; when purchase-triggered automation (#1316) lifts that guard the
tool inherits it automatically. Manual verification harness:
`node scripts/execute-write-pack-check.mjs --pack <key> --customer <id>`
(plan preview; add `--fire` to REALLY execute — real Graph writes).

## create_account (Phase 2 — Git #1321)

The buyer's portal account for a PAID purchase session, created through
#1310's real generalized inline account-creation flow (api-server
routes/public-purchase-account.ts → lib/purchase-account-flow.ts — the exact
code Buy.tsx runs; nothing re-implemented). One tool drives the inherently
multi-step flow via `action`: `status` (start here — a resumed session may
already be past a step) → `send_verification_code` (a REAL six-digit code is
emailed to the buyer's own mailbox via Exchange Online/Graph) →
`verify_code` (5 attempts per issued code) → `set_password` (bcrypt(12)
attach; provisions the users row via the same `provisionProspectAccount` the
consent flow uses when no earlier step created one). Every server-side gate
applies verbatim — paid+unexpired session only, verified-address-must-still-
match, and a repeat buyer's existing password is never overwritten
(`already_set`). Declared `audit: { access: "write" }` with
`redactParams: ["code", "password"]`; set_password's returned `portalUrl`
has the single-use no-MFA auto-login `signupToken` stripped
(`signupTokenWithheld: true`) so it never transits the model or the audit
trail — the buyer signs in with the credentials just set. MFA enrollment is
deliberately not wrapped (passkeys are origin-bound; the portal owns it
after first sign-in). Manual verification harness:
`node scripts/e2e-create-account.mjs` (seeds a paid session + known code
against the local Postgres, runs the full flow over real MCP stdio, cleans
up after itself).

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
  was accepted by a real `requireAdmin` route. Also asserts both calls
  landed as rows in `msp_audit_logs` (Git #1325).
- `node artifacts/mcp-server/scripts/audit-check.mjs` — exercises the
  mandatory audit flow through the REAL registry against the REAL local
  Postgres: write-ahead + finalize on success, failure finalization, the
  undeclared-mutation block, and the fail-closed refusal when the audit
  trail is unreachable.