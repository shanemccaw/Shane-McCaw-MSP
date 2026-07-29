import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

/**
 * ensureLeadForEmail bridges quiz/portal-login identity into a real leadsTable
 * row so the Engagement Offer Engine's findLeadByEmail lookup has something to
 * find. No DATABASE_URL in this environment, so the DB is mocked with a FIFO
 * queue, same convention as portal-customer-search.test.ts.
 */

let mockSelectQueue: any[][] = [];
let mockInsertQueue: any[][] = [];
let insertValuesArg: any = null;

vi.mock("@workspace/db", () => {
  function makeSelectChain() {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(mockSelectQueue.shift() ?? []).then(onFulfilled, onRejected),
    };
    return chain;
  }
  function makeInsertChain() {
    const chain: any = {
      values: (v: any) => {
        insertValuesArg = v;
        return chain;
      },
      returning: () => Promise.resolve(mockInsertQueue.shift() ?? []),
    };
    return chain;
  }

  const tbl = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, c]));

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      insert: vi.fn(() => makeInsertChain()),
    },
    leadsTable: tbl(["id", "email", "name", "company", "source", "status", "stage"]),
    leadIntentEventsTable: tbl(["id", "leadId", "eventType", "metadata", "occurredAt"]),
    leadScoringRulesTable: tbl(["id", "ruleType", "key", "points", "isActive"]),
    leadScoringTrackedPagesTable: tbl(["id", "path", "isActive"]),
    leadScoringConfigTable: tbl(["id", "mspId", "lookbackDays", "maxScore"]),
  };
});

process.env.JWT_SECRET = "test-secret";

/**
 * Imported ONCE, in a hook with its own budget, rather than per-test.
 *
 * lead-intent.ts transitively pulls in the Zoho sync/client graph, and that load
 * costs ~5s on a cold module registry. With `await import()` inside the first
 * test, the whole cost was charged to that test's default 5s timeout, leaving it
 * about 40ms of headroom — so it went red whenever the suite got marginally
 * busier (adding any two test files anywhere was enough). The import still
 * happens after the module body, so the env assignment above and the hoisted
 * vi.mock both still apply.
 */
let ensureLeadForEmail: typeof import("./lead-intent").ensureLeadForEmail;

beforeAll(async () => {
  ({ ensureLeadForEmail } = await import("./lead-intent"));
}, 60_000);

beforeEach(() => {
  mockSelectQueue = [];
  mockInsertQueue = [];
  insertValuesArg = null;
  vi.clearAllMocks();
});

describe("ensureLeadForEmail", () => {
  it("returns the existing lead id without inserting when a lead already exists for the email", async () => {
    mockSelectQueue.push([{ id: 42 }]);

    const leadId = await ensureLeadForEmail("Someone@Example.com", { name: "Someone", source: "quiz" });

    expect(leadId).toBe(42);
    expect(insertValuesArg).toBeNull();
  });

  it("creates a new lead with normalized email, honest source, and default CRM fields when none exists (quiz)", async () => {
    mockSelectQueue.push([]);
    mockInsertQueue.push([{ id: 7 }]);

    const leadId = await ensureLeadForEmail(" Jane@Example.com ", { name: "Jane Doe", company: "Acme", source: "quiz" });

    expect(leadId).toBe(7);
    expect(insertValuesArg).toMatchObject({
      email: "jane@example.com",
      name: "Jane Doe",
      company: "Acme",
      source: "quiz",
      status: "new",
      stage: "Cold",
    });
  });

  it("creates a new lead tagged portal_login for the Assessment first-login bridge", async () => {
    mockSelectQueue.push([]);
    mockInsertQueue.push([{ id: 8 }]);

    const leadId = await ensureLeadForEmail("assessment-user@example.com", { name: "Assessment User", source: "portal_login" });

    expect(leadId).toBe(8);
    expect(insertValuesArg).toMatchObject({ source: "portal_login", status: "new", stage: "Cold" });
  });

  it("falls back to the normalized email as the lead name when no name is given", async () => {
    mockSelectQueue.push([]);
    mockInsertQueue.push([{ id: 9 }]);

    await ensureLeadForEmail("noname@example.com", { source: "portal_login" });

    expect(insertValuesArg).toMatchObject({ name: "noname@example.com" });
  });

  it("is non-fatal: swallows a DB error and returns 0 instead of throwing", async () => {
    mockSelectQueue = undefined as any; // shift() on undefined throws inside the mocked chain

    const leadId = await ensureLeadForEmail("broken@example.com", { source: "quiz" });

    expect(leadId).toBe(0);
  });
});
