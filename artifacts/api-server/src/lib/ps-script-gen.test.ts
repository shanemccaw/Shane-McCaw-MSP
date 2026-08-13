/**
 * Unit tests for generateScriptFromService() in ps-script-gen.ts.
 *
 * Two critical paths that the workflow executor's `generate_script` node relies on:
 *
 *   1. Prose-only AI response — AI returns plain English, no JSON envelope and no
 *      PowerShell code.  generateScriptFromService() must throw so that the executor's
 *      catch block sets nodeError = true and surfaces the error in the run log.
 *
 *   2. Valid PS AI response — AI returns the expected JSON envelope + powershell fence.
 *      generateScriptFromService() must insert a DB row and return { scriptId, ... }.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared Anthropic response text — changed per suite via beforeEach ─────────
const anthropicState = vi.hoisted(() => ({ text: "" }));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: "text", text: anthropicState.text }],
      })),
    },
  },
}));

// ── DB mock ────────────────────────────────────────────────────────────────────
// Queue-based: each db.select() pops the next result from dbState.queue.
// db.insert().values() captures the values for assertion and returns a fake ID.
const dbState = vi.hoisted(() => ({
  queue:    [] as unknown[][],
  inserted: undefined as unknown,
}));

vi.mock("@workspace/db", () => {
  function makeSelectChain(result: unknown[]): Record<string, unknown> {
    const c: Record<string, unknown> = {
      from:    () => c,
      where:   () => c,
      limit:   () => c,
      orderBy: () => c,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(res, rej),
    };
    return c;
  }

  const db = {
    select: () => makeSelectChain(dbState.queue.shift() ?? []),
    insert: () => ({
      values: (vals: unknown) => {
        dbState.inserted = vals;
        return { returning: async () => [{ id: "script-uuid-test" }] };
      },
    }),
  };

  return {
    db,
    pool: { query: async () => ({ rows: [], rowCount: 0 }) },
    powershellScriptsTable:          {},
    scriptPackagesTable:             {},
    scriptModulesTable:              {},
    servicesTable:                   {},
    workflowTemplatesTable:          {},
    workflowTemplateStepsTable:      {},
    workflowTemplateStepTasksTable:  {},
    insightsGeneratedDocumentsTable: {},
  };
});

// ── prompt-loader mock ─────────────────────────────────────────────────────────
// Returns the fallback system prompt so no DB call is required.
vi.mock("./prompt-loader.js", () => ({
  getPrompt: vi.fn(async (_key: string, fallback: string) => fallback),
}));

// ── logger mock ────────────────────────────────────────────────────────────────
vi.mock("./logger.js", () => {
  const n = () => {};
  const l = { info: n, warn: n, error: n, debug: n, fatal: n, trace: n, child: () => l };
  return { logger: l };
});

// ── Import module under test AFTER all mocks are registered ──────────────────
import { generateScriptFromService } from "./ps-script-gen";

// ── Fixtures ──────────────────────────────────────────────────────────────────

// A response with no PS keywords and no JSON envelope — should trigger the guard.
const PROSE_RESPONSE =
  "This solution connects to your Microsoft 365 tenant and applies the " +
  "required governance policies. Please ensure you have the Exchange " +
  "Administrator role assigned before running any automation tasks.";

// A well-formed AI response: JSON envelope (single-script shape) + powershell fence.
const VALID_PS_RESPONSE = [
  "```json",
  '{ "type": "single", "title": "M365 User Audit", "humanOnlyTasks": [],',
  '  "permissions": { "appPermissions": ["User.Read.All"], "delegatedPermissions": [], "notes": "" } }',
  "```",
  "```powershell",
  "# file: audit-users.ps1",
  "$ErrorActionPreference = 'Stop'",
  "[CmdletBinding()]",
  "Param([string]$TenantId, [string]$ClientId, [string]$ClientSecret)",
  "Get-MgUser -All | Select-Object DisplayName, UserPrincipalName | Write-Output",
  "```",
].join("\n");

// Minimal service row — workflowTemplateId: null skips the template DB calls.
const FAKE_SERVICE = {
  id: 42,
  name: "M365 Tenant Health Audit",
  description: "Comprehensive M365 audit",
  category: "assessment",
  tagline: null,
  workflowTemplateId: null,
  deliverables: [],
  inclusions: [],
  features: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Prose-only AI response (executor nodeError path)
//
// The executor wraps generateScriptFromService in a try/catch and sets
// nodeError = true on throw.  These tests verify the throw happens correctly.
// ─────────────────────────────────────────────────────────────────────────────

describe("generateScriptFromService — prose-only AI response (executor nodeError path)", () => {
  beforeEach(() => {
    anthropicState.text = PROSE_RESPONSE;
    dbState.queue    = [[FAKE_SERVICE]];
    dbState.inserted = undefined;
  });

  it("throws when the AI returns prose with no JSON envelope", async () => {
    await expect(generateScriptFromService(42)).rejects.toThrow();
  });

  it("throws with a message containing 'AI did not return a valid JSON envelope'", async () => {
    await expect(generateScriptFromService(42)).rejects.toThrow(
      /AI did not return a valid JSON envelope/,
    );
  });

  it("does not insert any DB row when the AI returns prose", async () => {
    await expect(generateScriptFromService(42)).rejects.toThrow();
    expect(dbState.inserted).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Valid PowerShell AI response (executor success path)
//
// These tests verify that a correctly-structured AI response saves a DB row
// and returns { scriptId, packageId: null, title } so the executor can
// populate its output map and continue the workflow.
// ─────────────────────────────────────────────────────────────────────────────

describe("generateScriptFromService — valid PowerShell AI response (executor success path)", () => {
  beforeEach(() => {
    anthropicState.text = VALID_PS_RESPONSE;
    dbState.queue    = [[FAKE_SERVICE]];
    dbState.inserted = undefined;
  });

  it("resolves without throwing", async () => {
    await expect(generateScriptFromService(42)).resolves.toBeDefined();
  });

  it("returns a non-null scriptId from the saved DB row", async () => {
    const result = await generateScriptFromService(42);
    expect(result.scriptId).toBe("script-uuid-test");
  });

  it("returns packageId = null for a single-script response", async () => {
    const result = await generateScriptFromService(42);
    expect(result.packageId).toBeNull();
  });

  it("returns the title from the AI JSON envelope", async () => {
    const result = await generateScriptFromService(42);
    expect(result.title).toBe("M365 User Audit");
  });

  it("inserts a script body containing the generated PowerShell commands", async () => {
    await generateScriptFromService(42);
    expect(dbState.inserted).toBeDefined();
    const vals = dbState.inserted as Record<string, unknown>;
    expect(vals.scriptBody).toContain("Get-MgUser");
  });

  it("tags the inserted script row with 'workflow-generated'", async () => {
    await generateScriptFromService(42);
    const vals = dbState.inserted as Record<string, unknown>;
    expect(vals.tags as string[]).toContain("workflow-generated");
  });
});
