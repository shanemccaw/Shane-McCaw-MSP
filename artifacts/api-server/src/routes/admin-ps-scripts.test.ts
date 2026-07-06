/**
 * Integration tests for the prose-only guard in the real /fix and /generate
 * PS-script route handlers.
 *
 * Approach:
 *  - mock.module() stubs the Anthropic client so it returns a prose-only
 *    response (no ```powershell fence, no PS keywords anywhere in the text).
 *  - mock.module() stubs requireAdmin as a pass-through (no auth needed in
 *    tests) and @workspace/db so loading the route doesn't open a real DB
 *    connection.
 *  - The real router from admin-ps-scripts.ts is mounted in a lightweight
 *    Express server and called over HTTP.
 *
 * /fix uses messages.create() and returns plain JSON (HTTP 500 on guard fail).
 * /generate uses messages.stream() and returns SSE; guard failures appear as
 *   an SSE event { type: "error", message: "..." } with HTTP 200.
 *
 * Because the actual route handlers run, any refactor that removes or bypasses
 * hasPsKeywords() / hasPsKeywordsFullText() in admin-ps-scripts.ts will break
 * these tests.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 *
 * (The test script passes --experimental-test-module-mocks so mock.module()
 *  is available. The route file uses explicit .ts extensions on relative
 *  imports so the mock module loader can resolve them correctly alongside
 *  --experimental-strip-types.)
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Prose-only text: no PS keywords anywhere ──────────────────────────────────
const PROSE_RESPONSE =
  "This connects to your Microsoft 365 tenant and applies the " +
  "required governance policies. Please ensure you have the Exchange " +
  "Administrator role assigned before running any automation routines.";

// ── Fake streaming helper ─────────────────────────────────────────────────────
// Mimics the subset of the Anthropic stream object used by the /generate route:
//   stream.on("text", cb)  — registers a text-delta handler
//   stream.finalMessage()  — resolves after firing all registered text handlers
function makeProseStream() {
  const textHandlers: ((text: string) => void)[] = [];
  return {
    on(event: string, cb: (...args: unknown[]) => void) {
      if (event === "text") textHandlers.push(cb as (text: string) => void);
      return this;
    },
    async finalMessage() {
      for (const cb of textHandlers) cb(PROSE_RESPONSE);
      return { content: [{ type: "text", text: PROSE_RESPONSE }] };
    },
  };
}

// ── Register mocks BEFORE the route module is dynamically imported ─────────────
// mock.module() must be called before the target module loads. We use dynamic
// imports below to control load order. The route file uses .ts extensions on
// all relative imports (requireAuth.ts, logger.ts, ps-guard.ts) so mock
// specifiers with .ts match exactly.

// 1. Stub the Anthropic client:
//    - create() is used by /fix (plain JSON response)
//    - stream() is used by /generate (SSE streaming)
mock.module("@workspace/integrations-anthropic-ai", {
  namedExports: {
    anthropic: {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: PROSE_RESPONSE }],
        }),
        stream: () => makeProseStream(),
      },
    },
  },
});

// 2. Bypass requireAdmin — no auth session needed in tests.
mock.module("../middlewares/requireAuth.ts", {
  namedExports: {
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  },
});

// 3. Stub @workspace/db so loading the route doesn't attempt a real DB
//    connection. The prose guard path returns before any DB call.
mock.module("@workspace/db", {
  namedExports: {
    db: {},
    powershellScriptsTable: {},
    scriptPackagesTable: {},
    scriptModulesTable: {},
    serviceScriptSetsTable: {},
    servicesTable: {},
    workflowTemplatesTable: {},
    workflowTemplateStepsTable: {},
    workflowTemplateStepTasksTable: {},
    kanbanTasksTable: {},
    clientServicesTable: {},
    scriptRunResultsTable: {},
    aiPromptsTable: {},
    projectsTable: {},
    insightsGeneratedDocumentsTable: {},
    pool: {},
  },
});

// 4. Suppress logger output (pino) to keep test output clean.
const noop = () => {};
const noopLogger = {
  info: noop, warn: noop, error: noop, debug: noop,
  fatal: noop, trace: noop, child: () => noopLogger,
};
mock.module("../lib/logger.ts", {
  namedExports: { logger: noopLogger },
});

// 5. Stub ps-script-gen helpers (imported with .js extension by admin-ps-scripts.ts).
//    The prose guard path returns before any of these are called, but the module
//    must be resolvable at load time under node:test's mock loader.
mock.module("../lib/ps-script-gen.ts", {
  namedExports: {
    normalizeAppPerms: (perms: unknown[]) => perms,
    extractPowershellFences: () => new Map(),
    extractJson: () => null,
    extractJsonArray: () => null,
    repairJsonStrings: (s: string) => s,
    jsonParse: () => null,
    extractEnvelopeJson: () => null,
    hasPsKeywords: () => false,
    hasPsKeywordsFullText: () => false,
    generateScriptFromService: async () => ({ scriptId: null, packageId: null, title: "" }),
  },
});

// ── Dynamically import the REAL route module AFTER mocks are registered ───────
const { default: psRouter } = await import("./admin-ps-scripts.ts");

// ── Build a minimal Express app around the real router ────────────────────────
const { default: express } = await import("express");
const app = express();
app.use(express.json());
app.use("/api", psRouter);

// ── Start / stop a test HTTP server ──────────────────────────────────────────
let server: http.Server;
let baseUrl: string;

before(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    }),
);

after(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json as Record<string, unknown> };
}

// Read an SSE response to completion and return all parsed event objects.
// The /generate route streams "data: {...}\n\n" lines and ends with res.end().
async function postSse(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const events = text
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => {
      const line = chunk.replace(/^data: /, "").trim();
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((e): e is Record<string, unknown> => e !== null);
  return { status: res.status, events };
}

// ── POST /api/admin/ps-scripts/generate ──────────────────────────────────────
// The /generate endpoint uses SSE streaming. Guard failures are sent as an
// SSE event { type: "error", message: "..." } — not as HTTP 500 + JSON.

describe("POST /api/admin/ps-scripts/generate — real route: prose-only AI response guard", () => {
  const generatePayload = { prompt: "List all M365 users", category: "m365" };

  it("sends an SSE error event when the AI returns only prose (no PS keywords)", async () => {
    const { events } = await postSse("/api/admin/ps-scripts/generate", generatePayload);
    const errorEvent = events.find((e) => e["type"] === "error");
    assert.ok(
      errorEvent,
      `expected an SSE { type: "error" } event; got: ${JSON.stringify(events)}`,
    );
  });

  it("returns the exact error message the client surfaces to the user", async () => {
    const { events } = await postSse("/api/admin/ps-scripts/generate", generatePayload);
    const errorEvent = events.find((e) => e["type"] === "error");
    assert.equal(
      errorEvent?.["message"],
      "AI returned a summary instead of a script. Please try again.",
    );
  });
});

// ── POST /api/admin/ps-scripts/fix ───────────────────────────────────────────
// The /fix endpoint uses messages.create() and returns plain JSON (HTTP 500).

describe("POST /api/admin/ps-scripts/fix — real route: prose-only AI response guard", () => {
  const fixPayload = {
    scriptContent: "$users = Get-MgUser -All\n$users | Export-Csv users.csv",
    bugDescription: "The Export-Csv step throws a permission error",
  };

  it("returns HTTP 500 when the AI returns only prose (no PS keywords in first 200 chars)", async () => {
    const { status, body } = await postJson("/api/admin/ps-scripts/fix", fixPayload);
    assert.equal(
      status,
      500,
      `expected HTTP 500, got ${status}; body: ${JSON.stringify(body)}`,
    );
  });

  it("returns the exact error message the client surfaces to the user", async () => {
    const { body } = await postJson("/api/admin/ps-scripts/fix", fixPayload);
    assert.equal(
      (body as { error: string }).error,
      "AI returned a summary instead of a script. Please try again.",
    );
  });
});
