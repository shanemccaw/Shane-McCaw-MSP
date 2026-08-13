/**
 * Tests for the prose-only guard in the /modularize endpoint.
 *
 * A separate file is needed because the existing admin-ps-scripts.test.ts
 * registers a top-level mock that returns plain prose (no JSON fence), which
 * means extractJsonArray() fails before hasPsKeywords() is ever reached.
 * Here the mock returns a valid JSON array whose content fields contain no
 * PS keywords — that is the exact scenario the guard is designed to catch.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── AI response: a valid JSON array but every content field is prose only ──────
// No PS keywords appear in the first 200 chars of any content value.
const PROSE_MODULES_RESPONSE = `\`\`\`json
[
  {
    "filename": "ConnectionHelper.ps1",
    "description": "Handles tenant connectivity",
    "content": "This module is responsible for connecting to your Microsoft 365 tenant. Please ensure the administrator has granted the required permissions before attempting to run this automation routine."
  },
  {
    "filename": "Main.ps1",
    "description": "Orchestrator",
    "content": "This is the main entry point. It coordinates all the other modules and should be executed last after reviewing the documentation provided by your IT department."
  }
]
\`\`\``;

// ── Register mocks BEFORE the route module loads ──────────────────────────────

mock.module("@workspace/integrations-anthropic-ai", {
  namedExports: {
    anthropic: {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: PROSE_MODULES_RESPONSE }],
        }),
      },
    },
  },
});

mock.module("../middlewares/requireAuth.ts", {
  namedExports: {
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  },
});

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

const noop = () => {};
const noopLogger = {
  info: noop, warn: noop, error: noop, debug: noop,
  fatal: noop, trace: noop, child: () => noopLogger,
};
mock.module("../lib/logger.ts", {
  namedExports: { logger: noopLogger },
});

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

// ── Load the REAL route module AFTER mocks are registered ─────────────────────
const { default: psRouter } = await import("./admin-ps-scripts.ts");

const { default: express } = await import("express");
const app = express();
app.use(express.json());
app.use("/api", psRouter);

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

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json as Record<string, unknown> };
}

// ── POST /api/admin/ps-scripts/modularize ─────────────────────────────────────

describe("POST /api/admin/ps-scripts/modularize — real route: prose-only AI response guard", () => {
  const modularizePayload = {
    scriptContent: "$users = Get-MgUser -All\n$users | Export-Csv users.csv -NoTypeInformation",
    title: "Export Users",
    category: "m365",
  };

  it("returns HTTP 500 when every module content field contains only prose (no PS keywords)", async () => {
    const { status, body } = await postJson("/api/admin/ps-scripts/modularize", modularizePayload);
    assert.equal(
      status,
      500,
      `expected HTTP 500, got ${status}; body: ${JSON.stringify(body)}`,
    );
  });

  it("returns the exact error message the client surfaces to the user", async () => {
    const { body } = await postJson("/api/admin/ps-scripts/modularize", modularizePayload);
    assert.equal(
      (body as { error: string }).error,
      "AI response did not contain a valid module array",
    );
  });
});
