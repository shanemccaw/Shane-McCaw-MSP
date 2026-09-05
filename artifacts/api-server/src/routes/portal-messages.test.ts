import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// Top level variables prefixed with 'mock' to bypass hoisting checks.
// mockSelectResultsQueue is consumed in FIFO order by successive db.select()
// chains, falling back to [] once exhausted — same pattern as
// portal-team.test.ts / portal-billing.test.ts.
let mockSelectResultsQueue: any[][] = [];
let mockDefaultSelectResult: any[] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (onfulfilled: any, onrejected?: any) => {
        const result = mockSelectResultsQueue.length > 0
          ? mockSelectResultsQueue.shift()!
          : mockDefaultSelectResult;
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };
    return chain;
  };

  const insertChain: any = {
    values: () => insertChain,
    returning: () => Promise.resolve([{ id: 1 }]),
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  const updateChain: any = {
    set: () => updateChain,
    where: () => updateChain,
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  const mockDb = {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    insert: vi.fn().mockImplementation(() => insertChain),
    update: vi.fn().mockImplementation(() => updateChain),
  };

  const table = (name: string) => ({ __table: name });

  // Trimmed to exactly the tables portal-messages.ts imports directly from
  // @workspace/db, plus tenantsTable/mspStaffCustomerScopesTable so the real
  // ../middlewares/requireAuth (used un-mocked here) resolves its own
  // @workspace/db imports to a defined value.
  return {
    db: mockDb,
    messagesTable: table("messages"),
    usersTable: { id: "id", email: "email", role: "role", name: "name", tenantId: "tenant_id", mspId: "msp_id", mspRole: "msp_role" },
    notificationsTable: table("notifications"),
    deviceTokensTable: table("deviceTokens"),
    tenantsTable: { id: "id", mspId: "msp_id" },
    mspStaffCustomerScopesTable: table("mspStaffCustomerScopes"),
  };
});

const mockSendEmailFromTemplate = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/mailer", () => ({
  sendEmailFromTemplate: (...args: unknown[]) => mockSendEmailFromTemplate(...args),
  getTenantHealthBlockHtml: vi.fn().mockResolvedValue(""),
  canSendAutomatedCustomerEmailForUser: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/push", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/web-push", () => ({
  sendWebPushToAdmins: vi.fn().mockResolvedValue(undefined),
}));

// portal-messages.ts does `const log = logger.child(...)` at module scope.
vi.mock("../lib/logger", () => {
  const child = vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child,
  }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

// Deliberately NOT mocking ../lib/portal-url — the whole point of this
// regression test is to exercise the REAL getMspPortalBaseUrl() and prove it,
// not a stub, drives the notification email's portalLink/anchor.

// #1397: portal-messages.ts now customer-scopes the client thread via this
// bridge. Stub to the single-login set so no extra DB select is issued and this
// file's mockSelectResultsQueue expectations stay valid.
vi.mock("../lib/tenant-signals", () => ({
  resolveSiblingUserIds: async (id: number) => [id],
}));

import router from "./portal-messages";

// getMspPortalBaseUrl() resolves off PORTAL_BASE_URL (highest priority, see
// ../lib/portal-url.ts) so this test drives it deterministically rather than
// falling through to REPLIT_DOMAINS/REPLIT_DEV_DOMAIN or the "" default.
const REAL_PORTAL_BASE_URL = "https://msp.example.com";
process.env.PORTAL_BASE_URL = REAL_PORTAL_BASE_URL;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).log = { child: () => (req as any).log, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  next();
});
app.use("/api", router);

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeAdminToken(userId: number): string {
  return jwt.sign({ id: userId, email: "admin@example.com", role: "admin" }, JWT_SECRET, { expiresIn: "1h" });
}

// #177 (follow-up to #175): the client-message-notification email hardcoded
// the retired `/crm/portal/messages` path AND the wrong domain
// (shanemccaw.consulting instead of the real portal base URL). Guard against
// either regressing.
describe("POST /api/portal/messages (#177)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
  });

  it("builds the client-notification email's portalLink and anchor off getMspPortalBaseUrl(), never the retired /crm path or shanemccaw.consulting", async () => {
    const adminId = 1;
    const clientId = 21;
    const token = makeAdminToken(adminId);

    mockSelectResultsQueue = [
      // customerNotificationPreferencesTable lookup inside createNotification's
      // getCustomerPreference (#2849) — no row, so it defaults to emailEnabled:
      // false and createNotification's own deliverPreferenceEmail stays a
      // no-op, same as this route's real `suppressPreferenceEmail: true` (#2933).
      [],
      // usersTable lookup inside createNotification's fanOutToCustomerWebhook ->
      // resolveMspUserContext (#2849) — no matching row, so webhook fan-out is
      // a no-op.
      [],
      // usersTable lookup for the target client's email/name
      [{ email: "client@example.com", name: "Test Client" }],
    ];

    const res = await request(app)
      .post("/api/portal/messages")
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Hello from Shane", clientId });

    expect(res.status).toBe(201);
    expect(mockSendEmailFromTemplate).toHaveBeenCalledTimes(1);

    const [, , vars, , html] = mockSendEmailFromTemplate.mock.calls[0];
    expect(vars.portalLink).toBe(`${REAL_PORTAL_BASE_URL}/portal/messages`);
    expect(vars.portalLink).not.toContain("/crm");
    expect(vars.portalLink).not.toContain("shanemccaw.consulting");
    expect(html).toContain(`${REAL_PORTAL_BASE_URL}/portal/messages`);
    expect(html).not.toContain("/crm");
    expect(html).not.toContain("shanemccaw.consulting");
  });
});
