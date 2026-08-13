/**
 * Unit tests for MSP-scoped email routing.
 *
 * Tests:
 *  1. Connected mailbox → routes through MSP's own Exchange Online tenant.
 *  2. Consent-revoked path → deactivates connector, falls back to platform mailbox.
 *  3. No connector → platform mailbox with display-name override.
 *  4. No transport at all → throws with a clear message.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  emailTemplatesTable: {},
  emailEventsTable: {},
  clientHealthHistoryTable: {},
  mspMailboxConnectorsTable: {},
  mspsTable: {},
}));

vi.mock("./graph", () => ({
  graphCredentialsPresent: vi.fn(),
  sendMailViaGraph: vi.fn(),
  sendMailViaGraphForMsp: vi.fn(),
  mtAppCredentialsPresent: vi.fn(),
  ConsentRevokedError: class ConsentRevokedError extends Error {
    tenantId: string;
    constructor(tenantId: string) {
      super(`Admin consent revoked or missing for tenant ${tenantId}`);
      this.name = "ConsentRevokedError";
      this.tenantId = tenantId;
    }
  },
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./tenant-signals", () => ({
  computeTenantHealthVars: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  sendEmailForMspOrThrow,
  getMspMailboxConnector,
} from "./mailer.ts";

import * as graphMod from "./graph.ts";
import { db } from "@workspace/db";

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return chain as AnyMock;
}

function makeInsertChain() {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    catch: vi.fn(),
  };
  return chain as AnyMock;
}

function makeUpdateChain() {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    catch: vi.fn(),
  };
  return chain as AnyMock;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getMspMailboxConnector", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns null when no row exists", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([]));
    const result = await getMspMailboxConnector(1);
    expect(result).toBeNull();
  });

  it("returns connector fields when row exists", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([{
      tenantId: "tenant-abc",
      mailboxUpn: "noreply@contoso.com",
      fromDisplayName: "Contoso IT",
    }]));
    const result = await getMspMailboxConnector(1);
    expect(result).toEqual({
      tenantId: "tenant-abc",
      mailboxUpn: "noreply@contoso.com",
      fromDisplayName: "Contoso IT",
    });
  });

  it("returns null and warns on DB error", async () => {
    vi.mocked(db.select).mockImplementation(() => { throw new Error("DB down"); });
    const result = await getMspMailboxConnector(1);
    expect(result).toBeNull();
  });
});

describe("sendEmailForMspOrThrow — connected mailbox (Path 1)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("routes through MSP mailbox when connector exists and MT app is configured", async () => {
    vi.mocked(graphMod.mtAppCredentialsPresent).mockReturnValue(true);

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      const rows = callCount === 1
        ? [{ tenantId: "tenant-xyz", mailboxUpn: "mail@acme.com", fromDisplayName: "Acme IT" }]
        : [];
      return makeSelectChain(rows);
    });

    vi.mocked(graphMod.sendMailViaGraphForMsp).mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue(makeInsertChain());

    await sendEmailForMspOrThrow(1, "client@example.com", "Hello", "<p>Hi</p>", { skipWrapper: true });

    expect(graphMod.sendMailViaGraphForMsp).toHaveBeenCalledWith(
      expect.objectContaining({
        mspTenantId: "tenant-xyz",
        fromMailboxUpn: "mail@acme.com",
        fromDisplayName: "Acme IT",
        to: "client@example.com",
        subject: "Hello",
      }),
    );
    expect(graphMod.sendMailViaGraph).not.toHaveBeenCalled();
  });
});

describe("sendEmailForMspOrThrow — consent revoked (deactivate + fallback)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("deactivates connector and falls back to platform mailbox on ConsentRevokedError", async () => {
    vi.mocked(graphMod.mtAppCredentialsPresent).mockReturnValue(true);
    vi.mocked(graphMod.graphCredentialsPresent).mockReturnValue(true);
    process.env.GRAPH_MAIL_USER_ID = "platform@shanemccaw.com";

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      const rows = callCount === 1
        ? [{ tenantId: "tenant-xyz", mailboxUpn: "mail@acme.com", fromDisplayName: "Acme IT" }]
        : [{ name: "Acme Managed Services" }];
      return makeSelectChain(rows);
    });

    const { ConsentRevokedError } = await import("./graph.ts");
    vi.mocked(graphMod.sendMailViaGraphForMsp).mockRejectedValue(
      new ConsentRevokedError("tenant-xyz"),
    );

    vi.mocked(db.update).mockReturnValue(makeUpdateChain());
    vi.mocked(graphMod.sendMailViaGraph).mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue(makeInsertChain());

    await sendEmailForMspOrThrow(1, "client@example.com", "Fallback test", "<p>Hi</p>", { skipWrapper: true });

    expect(graphMod.sendMailViaGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        fromDisplayName: "Acme Managed Services",
        to: "client@example.com",
      }),
    );

    delete process.env.GRAPH_MAIL_USER_ID;
  });
});

describe("sendEmailForMspOrThrow — no connector (display-name fallback)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("uses platform mailbox with MSP name override when no connector exists", async () => {
    vi.mocked(graphMod.mtAppCredentialsPresent).mockReturnValue(true);
    vi.mocked(graphMod.graphCredentialsPresent).mockReturnValue(true);
    process.env.GRAPH_MAIL_USER_ID = "platform@shanemccaw.com";

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      const rows = callCount === 1 ? [] : [{ name: "Contoso MSP" }];
      return makeSelectChain(rows);
    });

    vi.mocked(graphMod.sendMailViaGraph).mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue(makeInsertChain());

    await sendEmailForMspOrThrow(42, "client@example.com", "No connector test", "<p>Hi</p>", { skipWrapper: true });

    expect(graphMod.sendMailViaGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        fromDisplayName: "Contoso MSP",
        to: "client@example.com",
      }),
    );
    expect(graphMod.sendMailViaGraphForMsp).not.toHaveBeenCalled();

    delete process.env.GRAPH_MAIL_USER_ID;
  });
});

describe("sendEmailForMspOrThrow — no transport", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("throws when no Graph credentials are configured at all", async () => {
    vi.mocked(graphMod.mtAppCredentialsPresent).mockReturnValue(false);
    vi.mocked(graphMod.graphCredentialsPresent).mockReturnValue(false);
    delete process.env.GRAPH_MAIL_USER_ID;

    await expect(
      sendEmailForMspOrThrow(1, "client@example.com", "No transport", "<p>Hi</p>", { skipWrapper: true }),
    ).rejects.toThrow(/No email transport available/);
  });
});
