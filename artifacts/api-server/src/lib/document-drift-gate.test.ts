/**
 * document-drift-gate.test.ts
 *
 * Unit tests for `findReusableDocument()` (tenant-signals.ts) — the drift gate
 * that stops the Document Generator paying for an AI call to regenerate a
 * document whose inputs have not moved (Document Generator IDE Phase 11).
 *
 * The contract under test:
 *   - a tenant with no prior reusable document always generates
 *   - only `approved` / `delivered` / `draft` rows are reusable; `generating`,
 *     `failed` and `archived` are not, and that filter is asserted on the real
 *     query rather than inferred
 *   - drift is the MAX of three real timestamps — tenant_monitor_profiles
 *     .collectedAt, client_m365_profiles.updatedAt, script_run_results.createdAt
 *     — and ANY one of them being newer than the document forces regeneration
 *   - `<=` is reuse: a data timestamp exactly equal to the document's createdAt
 *     is NOT drift (the document was generated from that very reading)
 *   - a tenant with no telemetry at all reuses, rather than burning an AI call
 *     to reproduce the same "no telemetry was captured" document
 *   - a customer with no linked M365 tenant skips the monitor read instead of
 *     erroring, and a customer with no linked portal logins skips the two
 *     users.id-keyed reads — in both cases the remaining sources still decide
 *
 * Run: pnpm --filter @workspace/api-server run test -- document-drift-gate
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => {
  const sqlFn = (strings: TemplateStringsArray, ...vals: unknown[]) => ({ type: "sql", strings, vals });
  (sqlFn as unknown as { raw: (s: string) => unknown }).raw = (s: string) => ({ type: "sql.raw", s });
  return {
    eq: (...args: unknown[]) => ({ type: "eq", args }),
    and: (...args: unknown[]) => ({ type: "and", args }),
    asc: (...args: unknown[]) => ({ type: "asc", args }),
    desc: (...args: unknown[]) => ({ type: "desc", args }),
    inArray: (...args: unknown[]) => ({ type: "inArray", args }),
    sql: sqlFn,
  };
});

vi.mock("./logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

vi.mock("./sla-engine", () => ({ startSlaTimer: vi.fn() }));

/** Every `where(...)` clause the harness saw, so a test can assert on the real
 *  query shape (e.g. which statuses count as reusable) instead of trusting it. */
let whereClauses: unknown[] = [];

function chainStub(rows: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    from: () => obj,
    innerJoin: () => obj,
    where: (clause: unknown) => { whereClauses.push(clause); return obj; },
    orderBy: () => obj,
    limit: () => obj,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return obj;
}

// findReusableDocument issues five differently-SHAPED selects, which is how this
// harness routes them without a real DB. Every shape is distinct.
let documentRows: Array<{ id: number; htmlContent: string; createdAt: Date; status: string }> = [];
let customerRows: Array<{ tenantId: string | null }> = [];
let userRows: Array<{ userId: number }> = [];
let monitorRows: Array<{ collectedAt: Date }> = [];
let profileRows: Array<{ updatedAt: Date }> = [];
let scriptRunRows: Array<{ createdAt: Date }> = [];

/** Select shapes actually issued, so "this source was skipped entirely" is
 *  provable rather than assumed from the result. */
let issuedShapes: string[] = [];

const { mockSelect, mockExecute } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockExecute: vi.fn(),
}));

mockSelect.mockImplementation((shape?: Record<string, unknown>) => {
  const keys = shape ? Object.keys(shape).sort() : [];
  const signature = keys.join(",");
  issuedShapes.push(signature);
  if (signature === "createdAt,htmlContent,id,status") return chainStub(documentRows);
  if (signature === "tenantId") return chainStub(customerRows);
  if (signature === "userId") return chainStub(userRows);
  if (signature === "collectedAt") return chainStub(monitorRows);
  if (signature === "updatedAt") return chainStub(profileRows);
  if (signature === "createdAt") return chainStub(scriptRunRows);
  return chainStub([]);
});

vi.mock("@workspace/db", () => ({
  db: { select: mockSelect, execute: mockExecute },
  clientM365ProfilesTable: { clientId: "clientId", updatedAt: "updatedAt" },
  insightsGeneratedDocumentsTable: {
    id: "id",
    htmlContent: "htmlContent",
    createdAt: "createdAt",
    status: "status",
    docType: "docType",
    mspCustomerId: "mspCustomerId",
  },
  scriptRunResultsTable: { customerId: "customerId", createdAt: "createdAt" },
  mspCustomersTable: { id: "id", tenantId: "tenantId", mspId: "mspId" },
  mspUsersTable: { id: "id", userId: "userId", customerId: "customerId", isActive: "isActive", mspRole: "mspRole", createdAt: "createdAt" },
  tenantMonitorProfilesTable: { tenantId: "tenantId", collectedAt: "collectedAt", checkKey: "checkKey" },
  signalDerivationRulesTable: { signalKey: "signalKey", sourceKey: "sourceKey" },
  monitorChecksTable: { key: "key", frequency: "frequency" },
}));

import { findReusableDocument } from "./tenant-signals.ts";

const DOC_CREATED_AT = new Date("2026-07-20T12:00:00.000Z");
const BEFORE = new Date("2026-07-19T12:00:00.000Z");
const AFTER = new Date("2026-07-21T12:00:00.000Z");

/** The default happy state: one reusable document, a linked tenant + login, and
 *  every telemetry source strictly OLDER than the document. */
function seedNoDriftTenant(): void {
  documentRows = [{ id: 501, htmlContent: "<h1>Report</h1>", createdAt: DOC_CREATED_AT, status: "approved" }];
  customerRows = [{ tenantId: "tenant-abc" }];
  userRows = [{ userId: 21 }, { userId: 22 }];
  monitorRows = [{ collectedAt: BEFORE }];
  profileRows = [{ updatedAt: BEFORE }];
  scriptRunRows = [{ createdAt: BEFORE }];
}

beforeEach(() => {
  documentRows = [];
  customerRows = [];
  userRows = [];
  monitorRows = [];
  profileRows = [];
  scriptRunRows = [];
  whereClauses = [];
  issuedShapes = [];
  mockSelect.mockClear();
  mockExecute.mockReset();
});

describe("findReusableDocument — no candidate", () => {
  it("returns null when the tenant has no prior document of this type", async () => {
    customerRows = [{ tenantId: "tenant-abc" }];
    expect(await findReusableDocument(77, "security_report")).toBeNull();
  });

  it("does no drift work at all when there is no candidate to reuse", async () => {
    await findReusableDocument(77, "security_report");
    // Only the document lookup itself — no tenant read, no telemetry reads.
    expect(issuedShapes).toEqual(["createdAt,htmlContent,id,status"]);
  });

  it("restricts the candidate query to genuinely complete statuses", async () => {
    await findReusableDocument(77, "security_report");
    const statusClause = JSON.stringify(whereClauses[0]);
    // `generating` has empty HTML, `failed` never produced content, and
    // `archived` was deliberately superseded — none may be handed back as a
    // "reusable" document.
    expect(statusClause).toContain("approved");
    expect(statusClause).toContain("delivered");
    expect(statusClause).toContain("draft");
    expect(statusClause).not.toContain("generating");
    expect(statusClause).not.toContain("failed");
    expect(statusClause).not.toContain("archived");
  });
});

describe("findReusableDocument — no drift", () => {
  it("returns the existing document when every data source predates it", async () => {
    seedNoDriftTenant();
    expect(await findReusableDocument(77, "security_report")).toEqual({
      documentId: 501,
      htmlContent: "<h1>Report</h1>",
      docTypeKey: "security_report",
    });
  });

  it("treats a data timestamp exactly equal to the document's createdAt as no drift", async () => {
    seedNoDriftTenant();
    // The document was generated FROM this reading, so it is not newer than it.
    monitorRows = [{ collectedAt: DOC_CREATED_AT }];
    const result = await findReusableDocument(77, "security_report");
    expect(result?.documentId).toBe(501);
  });

  it("reuses when the tenant has no telemetry at all rather than regenerating an identical document", async () => {
    seedNoDriftTenant();
    monitorRows = [];
    profileRows = [];
    scriptRunRows = [];
    const result = await findReusableDocument(77, "security_report");
    expect(result?.documentId).toBe(501);
  });

  it("reuses a testMode draft — a draft is a complete document, not an in-flight one", async () => {
    seedNoDriftTenant();
    documentRows = [{ id: 502, htmlContent: "<h1>Draft</h1>", createdAt: DOC_CREATED_AT, status: "draft" }];
    const result = await findReusableDocument(77, "security_report");
    expect(result?.documentId).toBe(502);
  });
});

describe("findReusableDocument — drift detected", () => {
  it("regenerates when a monitor check collected newer data", async () => {
    seedNoDriftTenant();
    monitorRows = [{ collectedAt: AFTER }];
    expect(await findReusableDocument(77, "security_report")).toBeNull();
  });

  it("regenerates when a client_m365_profiles row was updated after the document", async () => {
    seedNoDriftTenant();
    profileRows = [{ updatedAt: AFTER }];
    expect(await findReusableDocument(77, "security_report")).toBeNull();
  });

  it("regenerates when a script run landed after the document", async () => {
    seedNoDriftTenant();
    scriptRunRows = [{ createdAt: AFTER }];
    expect(await findReusableDocument(77, "security_report")).toBeNull();
  });
});

describe("findReusableDocument — partial tenant linkage", () => {
  it("skips the monitor read entirely when msp_customers.tenantId is NULL, rather than erroring", async () => {
    seedNoDriftTenant();
    customerRows = [{ tenantId: null }];
    const result = await findReusableDocument(77, "security_report");
    expect(result?.documentId).toBe(501);
    expect(issuedShapes).not.toContain("collectedAt");
  });

  it("still detects drift from the users.id-keyed sources when there is no linked M365 tenant", async () => {
    seedNoDriftTenant();
    customerRows = [{ tenantId: null }];
    profileRows = [{ updatedAt: AFTER }];
    expect(await findReusableDocument(77, "security_report")).toBeNull();
  });

  it("skips both users.id-keyed reads when the customer has no linked portal login", async () => {
    seedNoDriftTenant();
    userRows = [];
    const result = await findReusableDocument(77, "security_report");
    expect(result?.documentId).toBe(501);
    expect(issuedShapes).not.toContain("updatedAt");
    expect(issuedShapes).not.toContain("createdAt");
  });

  it("still detects monitor drift for a customer with no linked portal login", async () => {
    seedNoDriftTenant();
    userRows = [];
    monitorRows = [{ collectedAt: AFTER }];
    expect(await findReusableDocument(77, "security_report")).toBeNull();
  });
});
