/**
 * Integration tests for the prose-only guard in the real /fix and /generate
 * PS-script route handlers.
 *
 * Approach:
 *  - mock.module() stubs the Anthropic client so it returns a prose-only
 *    response (no ```powershell fence, no PS keywords in first 200 chars).
 *  - mock.module() stubs requireAdmin as a pass-through (no auth needed in
 *    tests) and @workspace/db so loading the route doesn't open a real DB
 *    connection — the prose path returns 500 before reaching any DB code.
 *  - The real router from admin-ps-scripts.ts is mounted in a lightweight
 *    Express server and called over HTTP.
 *
 * Because the actual route handlers run, any refactor that removes or bypasses
 * hasPsKeywords() in admin-ps-scripts.ts will break these tests.
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

// ── Prose-only text: no PS keywords in first 200 chars ───────────────────────
const PROSE_RESPONSE =
  "This script connects to your Microsoft 365 tenant and applies the " +
  "required governance policies. Please ensure you have the Exchange " +
  "Administrator role assigned before running any automation routines.";

// ── Register mocks BEFORE the route module is dynamically imported ─────────────
// mock.module() must be called before the target module loads. We use dynamic
// imports below to control load order. The route file uses .ts extensions on
// all relative imports (requireAuth.ts, logger.ts, ps-guard.ts) so mock
// specifiers with .ts match exactly.

// 1. Stub the Anthropic client to return prose-only text.
mock.module("@workspace/integrations-anthropic-ai", {
  namedExports: {
    anthropic: {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: PROSE_RESPONSE }],
        }),
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
//    connection. The prose guard path returns 500 before any DB call.
mock.module("@workspace/db", {
  namedExports: {
    db: {},
    powershellScriptsTable: {},
    scriptPackagesTable: {},
    scriptModulesTable: {},
    servicesTable: {},
    workflowTemplatesTable: {},
    workflowTemplateStepsTable: {},
    workflowTemplateStepTasksTable: {},
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

// ── Helper ────────────────────────────────────────────────────────────────────
async function postJson(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json as Record<string, unknown> };
}

// ── POST /api/admin/ps-scripts/generate ──────────────────────────────────────

describe("POST /api/admin/ps-scripts/generate — real route: prose-only AI response guard", () => {
  it("returns HTTP 500 when the AI returns only prose (no PS keywords in first 200 chars)", async () => {
    const { status, body } = await postJson("/api/admin/ps-scripts/generate", {
      prompt: "List all M365 users",
      category: "m365",
    });
    assert.equal(
      status,
      500,
      `expected HTTP 500, got ${status}; body: ${JSON.stringify(body)}`,
    );
  });

  it("returns the exact error message the client surfaces to the user", async () => {
    const { body } = await postJson("/api/admin/ps-scripts/generate", {
      prompt: "List all M365 users",
      category: "m365",
    });
    assert.equal(
      (body as { error: string }).error,
      "AI returned a summary instead of a script. Please try again.",
    );
  });
});

// ── POST /api/admin/ps-scripts/fix ───────────────────────────────────────────

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
