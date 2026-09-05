import { describe, it, expect, vi, beforeEach } from "vitest";

// #2933: portal-messages.ts / admin-status-reports.ts call sites that already
// send their OWN branded template email now pass `suppressPreferenceEmail:
// true` into createNotification() so it never ALSO fires its own
// deliverPreferenceEmail() once the recipient has opted into email for that
// category (#2849's migration introduced this real double-email risk since a
// customer who never opted in never exercised the code path where both
// emails fire). This test proves the flag actually gates
// deliverPreferenceEmail's real Graph send, both ways.

let mockSelectResultsQueue: any[][] = [];
let mockDefaultSelectResult: any[] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      leftJoin: () => chain,
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
    returning: () => Promise.resolve([{ id: 999 }]),
  };

  const mockDb = {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    insert: vi.fn().mockImplementation(() => insertChain),
  };

  const table = (name: string) => ({ __table: name });

  return {
    db: mockDb,
    notificationsTable: table("notifications"),
    usersTable: { id: "id", email: "email", mspId: "msp_id", tenantId: "tenant_id" },
    customerNotificationPreferencesTable: {
      userId: "user_id",
      category: "category",
      inAppEnabled: "in_app_enabled",
      emailEnabled: "email_enabled",
    },
    portalOwnershipAssignmentsTable: table("portalOwnershipAssignments"),
  };
});

vi.mock("./sse-channels", () => ({
  broadcastNotification: vi.fn(),
  broadcastUnreadCount: vi.fn(),
}));

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
vi.mock("./graphEmail.ts", () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

const mockDispatchEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("./event-bus.ts", () => ({
  dispatchEvent: (...args: unknown[]) => mockDispatchEvent(...args),
}));

vi.mock("./portal-deep-links", () => ({
  resolvePortalDeepLink: vi.fn().mockReturnValue(null),
}));

vi.mock("./logger", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { createNotification } from "./notification-center";

const CUSTOMER_USER_ID = 42;

describe("createNotification — suppressPreferenceEmail (#2933)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
    process.env["GRAPH_MAIL_USER_ID"] = "mailer@example.com";
  });

  it("does NOT call deliverPreferenceEmail's real Graph send when suppressPreferenceEmail is true, even with emailEnabled: true", async () => {
    mockSelectResultsQueue = [
      // getCustomerPreference — opted in
      [{ inAppEnabled: true, emailEnabled: true }],
      // unread-count select (feedType defaults to "personal")
      [{ n: 0 }],
      // resolveMspUserContext (webhook fan-out) — no row, no-op
      [],
    ];

    await createNotification({
      title: "New message from Shane",
      body: "hello",
      category: "message",
      recipient: { type: "customer_user", userId: CUSTOMER_USER_ID },
      suppressPreferenceEmail: true,
    });

    // Give any (wrongly) fired fire-and-forget deliverPreferenceEmail call a
    // real chance to resolve before asserting it never happened.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("DOES call deliverPreferenceEmail's real Graph send when the caller does not suppress it and the preference is opted in", async () => {
    mockSelectResultsQueue = [
      // getCustomerPreference — opted in
      [{ inAppEnabled: true, emailEnabled: true }],
      // unread-count select (feedType defaults to "personal")
      [{ n: 0 }],
      // deliverPreferenceEmail's own usersTable email lookup — this fires
      // (void, but synchronously starts) before fanOutToCustomerWebhook does.
      [{ email: "client@example.com" }],
      // resolveMspUserContext (webhook fan-out) — no row, no-op
      [],
    ];

    await createNotification({
      title: "Some other notification",
      body: "hello",
      category: "drift",
      recipient: { type: "customer_user", userId: CUSTOMER_USER_ID },
    });

    // deliverPreferenceEmail is fired `void` (fire-and-forget) inside
    // createNotification, so its own internal awaits (the email lookup, then
    // sendMessage) resolve after createNotification itself has already
    // returned — flush the microtask queue before asserting.
    await vi.waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1));
  });
});
