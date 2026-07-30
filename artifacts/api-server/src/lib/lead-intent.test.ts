import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

/**
 * ensureLeadForEmail bridges quiz/portal-login identity into a `lead_staging`
 * row (#136 — Decommission Legacy CRM Phase B; it no longer creates a legacy
 * `leads` row), and returns the LEGACY lead id carried on that staged row so
 * the Engagement Offer Engine's findLeadByEmail lookup keeps working in the
 * id space its satellite FK columns still store. A staged row with no
 * legacy_lead_id honestly returns 0.
 *
 * No DATABASE_URL in this environment, so the DB is mocked with a FIFO queue,
 * same convention as portal-customer-search.test.ts.
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
    leadStagingTable: tbl([
      "id", "email", "name", "company", "source", "status", "stage",
      "legacyLeadId", "legacyQuizLeadId", "ga4ClientId",
    ]),
    leadIntentEventsTable: tbl(["id", "leadId", "eventType", "metadata", "occurredAt"]),
    leadScoringRulesTable: tbl(["id", "ruleType", "key", "points", "isActive"]),
    leadScoringTrackedPagesTable: tbl(["id", "path", "isActive"]),
    leadScoringConfigTable: tbl(["id", "mspId", "lookbackDays", "maxScore"]),
  };
});

/**
 * The Zoho push queued after a staging insert is bookkeeping, not part of this
 * bridge's contract — and it writes via db.update(), which the FIFO mock above
 * deliberately does not implement. Stubbed so a staging insert resolves the way
 * it does in production, where the push is fire-and-forget.
 */
vi.mock("./zoho-lead-sync.ts", () => ({
  queueLeadStagingPush: vi.fn(async () => ({ queued: true })),
}));

process.env.JWT_SECRET = "test-secret";

/**
 * Imported ONCE, in a hook with its own budget, rather than per-test — the
 * module graph behind lead-intent.ts is expensive enough on a cold registry
 * that charging it to the first test's default 5s timeout made that test go red
 * whenever the suite got marginally busier.
 */
let ensureLeadForEmail: typeof import("./lead-intent").ensureLeadForEmail;
let findLeadByEmail: typeof import("./lead-intent").findLeadByEmail;

beforeAll(async () => {
  ({ ensureLeadForEmail, findLeadByEmail } = await import("./lead-intent"));
}, 60_000);

beforeEach(() => {
  mockSelectQueue = [];
  mockInsertQueue = [];
  insertValuesArg = null;
  vi.clearAllMocks();
});

describe("ensureLeadForEmail", () => {
  it("returns the staged row's legacy lead id without inserting when the email is already staged", async () => {
    mockSelectQueue.push([{ id: 500, legacyLeadId: 42 }]);

    const leadId = await ensureLeadForEmail("Someone@Example.com", { name: "Someone", source: "quiz" });

    expect(leadId).toBe(42);
    expect(insertValuesArg).toBeNull();
  });

  it("returns 0 for an already-staged row that has no legacy lead id, without inserting", async () => {
    mockSelectQueue.push([{ id: 501, legacyLeadId: null }]);

    const leadId = await ensureLeadForEmail("staged-only@example.com", { source: "quiz" });

    expect(leadId).toBe(0);
    expect(insertValuesArg).toBeNull();
  });

  it("stages a new row with normalized email, honest source, and default CRM fields when none exists (quiz)", async () => {
    mockSelectQueue.push([]);
    mockInsertQueue.push([{ id: 7, legacyLeadId: null }]);

    const leadId = await ensureLeadForEmail(" Jane@Example.com ", { name: "Jane Doe", company: "Acme", source: "quiz" });

    // Newly staged post-cutover, so there is no legacy id to return.
    expect(leadId).toBe(0);
    expect(insertValuesArg).toMatchObject({
      email: "jane@example.com",
      name: "Jane Doe",
      company: "Acme",
      source: "quiz",
      status: "new",
      stage: "Cold",
      legacyLeadId: null,
    });
  });

  it("stages a new row tagged portal_login for the Assessment first-login bridge", async () => {
    mockSelectQueue.push([]);
    mockInsertQueue.push([{ id: 8, legacyLeadId: null }]);

    await ensureLeadForEmail("assessment-user@example.com", { name: "Assessment User", source: "portal_login" });

    expect(insertValuesArg).toMatchObject({ source: "portal_login", status: "new", stage: "Cold" });
  });

  it("falls back to the normalized email as the staged name when no name is given", async () => {
    mockSelectQueue.push([]);
    mockInsertQueue.push([{ id: 9, legacyLeadId: null }]);

    await ensureLeadForEmail("noname@example.com", { source: "portal_login" });

    expect(insertValuesArg).toMatchObject({ name: "noname@example.com" });
  });

  it("is non-fatal: swallows a DB error and returns 0 instead of throwing", async () => {
    mockSelectQueue = undefined as any; // shift() on undefined throws inside the mocked chain

    const leadId = await ensureLeadForEmail("broken@example.com", { source: "quiz" });

    expect(leadId).toBe(0);
  });
});

describe("findLeadByEmail", () => {
  it("resolves to the legacy lead id carried on the staged row", async () => {
    mockSelectQueue.push([{ legacyLeadId: 42 }]);

    expect(await findLeadByEmail("Someone@Example.com")).toEqual({ id: 42 });
  });

  it("resolves to null when no staged row carries a legacy lead id", async () => {
    mockSelectQueue.push([]);

    expect(await findLeadByEmail("staged-only@example.com")).toBeNull();
  });
});
